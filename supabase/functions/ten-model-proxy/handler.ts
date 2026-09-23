// The testable core of ten-model-proxy (docs/design-web-agent.md § 8).
// `handleRequest` takes every side effect through `ProxyDeps` so it can run
// under plain `deno test` against a mocked OpenRouter and a mocked Supabase,
// with no `window`/`document`/`localStorage`/`node:` API and no network
// access at import time. index.ts wires the real deps and calls `Deno.serve`.

import { allowedOrigins, corsHeaders } from "../_shared/cors.ts";
import {
  BETA_CEILING_USD,
  CEILING_USD,
  MAX_BODY_BYTES,
  MODEL,
  buildUpstreamBody,
  parseUsageFromSSE,
  pathTail,
} from "./core.ts";

export const MESSAGES = {
  overBalance: "Your beta credit is used up. Ask the person who invited you for more.",
  ceiling: "The beta has reached today's limit. Try again tomorrow.",
  notMember: "Ten is in a private beta. Ask the person who invited you for access.",
  modelError: "The model is temporarily unavailable. Try again.",
} as const;

export interface ProxyDeps {
  verifyUser(token: string): Promise<{ id: string } | null>;
  isMember(token: string): Promise<boolean>;
  balanceFor(uid: string): Promise<number>;
  betaSpendToday(): Promise<number>;
  insertLedgerCall(row: {
    user_id: string;
    kind: "call";
    request_id: string;
    model: string;
    tokens_in: number;
    tokens_out: number;
    tokens_cached: number;
    usd: number;
  }): Promise<void>;
  /** Calls the one hard-coded upstream URL (core.ts's `UPSTREAM_URL`) with
   * the built body and the `TEN_OPENROUTER_API_KEY` secret. Never logs the key. */
  fetchUpstream(body: Record<string, unknown>): Promise<Response>;
  /** Defaults to `EdgeRuntime.waitUntil` in production; tests pass one that
   * lets them await the metering work before asserting on it. */
  waitUntil(p: Promise<unknown>): void;
  randomId(): string;
  log?: { warn(e: unknown): void };
}

function jsonError(status: number, code: string, message: string, cors: HeadersInit): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

async function meterUsage(
  stream: ReadableStream<Uint8Array>,
  deps: ProxyDeps,
  uid: string,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (e) {
    // The upstream connection can drop mid-stream; meter what we saw with
    // the ceiling cost below rather than losing the row entirely.
    deps.log?.warn({ msg: "ten-model-proxy: metering read failed", err: String(e) });
  }

  const parsed = parseUsageFromSSE(text);
  const usd = parsed?.cost ?? CEILING_USD;
  const requestId = parsed?.id ?? deps.randomId();

  try {
    await deps.insertLedgerCall({
      user_id: uid,
      kind: "call",
      request_id: requestId,
      model: MODEL,
      tokens_in: parsed?.tokensIn ?? 0,
      tokens_out: parsed?.tokensOut ?? 0,
      tokens_cached: parsed?.tokensCached ?? 0,
      usd,
    });
  } catch (e) {
    // One metering path only (§ 8): a failed insert (e.g. a retried/duplicate
    // request_id) is logged, never retried, never thrown into the response
    // the client already received.
    deps.log?.warn({ msg: "ten-model-proxy: ledger insert failed", err: String(e) });
  }
}

export async function handleRequest(
  req: Request,
  deps: ProxyDeps,
  env: Record<string, string | undefined>,
): Promise<Response> {
  const url = new URL(req.url);
  const path = pathTail(url);
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin, allowedOrigins(env));

  if (path !== "/chat/completions") {
    return new Response("Not found", { status: 404 });
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response("Not found", { status: 404 });
  }

  // 1. Auth (§ 8, point 1): a signed-in user, or 401. The anon/publishable
  // key alone fails `verifyUser` (it isn't a user access token) and also
  // gets 401 here.
  const authz = req.headers.get("authorization") ?? "";
  const match = authz.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1] ?? "";
  if (!token) {
    return jsonError(401, "not_signed_in", "Sign in required.", cors);
  }
  const user = await deps.verifyUser(token);
  if (!user) {
    return jsonError(401, "not_signed_in", "Sign in required.", cors);
  }

  // 2. Size and membership (§ 8, point 2).
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return jsonError(413, "too_large", "Request too large.", cors);
  }
  const member = await deps.isMember(token);
  if (!member) {
    return jsonError(403, "not_a_member", MESSAGES.notMember, cors);
  }

  // 3. Balance and the beta-wide ceiling (§ 8, point 3).
  const balance = await deps.balanceFor(user.id);
  if (!(balance > 0)) {
    return jsonError(402, "over_balance", MESSAGES.overBalance, cors);
  }
  const spendToday = await deps.betaSpendToday();
  if (spendToday >= BETA_CEILING_USD) {
    // Shown to the app as model_error, not over_balance (§ 8): this isn't
    // this user's balance, it's the shared daily ceiling.
    return jsonError(503, "model_error", MESSAGES.ceiling, cors);
  }

  // 4. Build the upstream body from the allowlist (§ 8, point 4).
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON.", cors);
  }
  const built = buildUpstreamBody(parsed);
  if (!built.ok) {
    return jsonError(built.status, built.code, built.message, cors);
  }

  // 5. Call upstream; an upstream 402/5xx is the shared key's own limit, not
  // this user's balance, so it maps to 503 model_error (§ 8, point 6).
  let upstream: Response;
  try {
    upstream = await deps.fetchUpstream(built.body);
  } catch (e) {
    deps.log?.warn({ msg: "ten-model-proxy: upstream fetch threw", err: String(e) });
    return jsonError(503, "model_error", MESSAGES.modelError, cors);
  }
  if (upstream.status === 402 || upstream.status >= 500) {
    // Drain the body so the connection can be reused/closed cleanly.
    await upstream.body?.cancel().catch(() => {});
    return jsonError(503, "model_error", MESSAGES.modelError, cors);
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => {});
    return jsonError(503, "model_error", MESSAGES.modelError, cors);
  }

  // 6. Stream back, metering a tee'd copy (§ 8, point 5). tee() keeps
  // feeding both branches independently, so a client disconnect that
  // cancels only the client-facing branch still lets the meter branch run
  // to completion.
  const [clientStream, meterStream] = upstream.body.tee();
  deps.waitUntil(meterUsage(meterStream, deps, user.id));

  return new Response(clientStream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...cors },
  });
}
