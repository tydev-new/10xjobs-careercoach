// The testable core of ten-model-proxy (docs/design-web-agent.md § 8).
// `handleRequest` takes every side effect through `ProxyDeps` so it can run
// under plain `deno test` against a mocked OpenRouter and a mocked Supabase,
// with no `window`/`document`/`localStorage`/`node:` API and no network
// access at import time. index.ts wires the real deps and calls `Deno.serve`.

import { allowedOrigins, corsHeaders } from "../_shared/cors.ts";
import {
  BETA_CEILING_USD,
  MAX_BODY_BYTES,
  buildUpstreamBody,
  ceilingUsdFor,
  parseUsageFromSSE,
  pathTail,
  sanitizeUsageForLedger,
} from "./core.ts";

export const MESSAGES = {
  overBalance: "Your beta credit is used up. Ask the person who invited you for more.",
  ceiling: "The beta has reached today's limit. Try again tomorrow.",
  notMember: "You're signed in, but this beta is invite-only. Ask the person who invited you to add you.",
  modelError: "The model is temporarily unavailable. Try again.",
} as const;

// S4 (fix round 1): the meter must not wait past this even if the upstream
// connection never closes — below the Edge Runtime's 400 s wall-clock limit
// (§ 8 "Time") so the worker itself never kills the meter mid-flight.
// Overridable via ProxyDeps.meterDeadlineMs (round 2: tests can shrink it to
// prove the "timed from the request's start" behavior deterministically,
// without waiting out the real 360 s).
const DEFAULT_METER_DEADLINE_MS = 360_000;

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
    // § 9.6 (amended 2026-09-24): null when absent/malformed; never blocks
    // the insert.
    finish_reason: string | null;
  }): Promise<void>;
  /** Calls the one hard-coded upstream URL (core.ts's `UPSTREAM_URL`) with
   * the built body and the `TEN_OPENROUTER_API_KEY` secret. Never logs the key. */
  fetchUpstream(body: Record<string, unknown>): Promise<Response>;
  /** Defaults to `EdgeRuntime.waitUntil` in production; tests pass one that
   * lets them await the metering work before asserting on it. */
  waitUntil(p: Promise<unknown>): void;
  randomId(): string;
  log?: { warn(e: unknown): void; error?(e: unknown): void };
  /** Overrides `DEFAULT_METER_DEADLINE_MS` (360 s); unset in production. */
  meterDeadlineMs?: number;
}

function jsonError(status: number, code: string, message: string, cors: HeadersInit): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

/** Reads an SSE stream to completion, or until `deadlineAt` (a `Date.now()`
 * timestamp — S4/round 2: timed from the REQUEST's start, not from when
 * this read began, so a slow auth/balance/upstream-connect phase eats into
 * the same budget rather than extending it past the Edge Runtime's 400 s
 * wall clock), whichever comes first. Returns whatever text was seen.
 * Never throws: an upstream reset or a deadline cancel both just stop the
 * read early, and the caller meters from whatever text was collected. */
async function readStreamWithDeadline(
  stream: ReadableStream<Uint8Array>,
  deps: ProxyDeps,
  deadlineAt: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let timedOut = false;
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  const timer = setTimeout(() => {
    timedOut = true;
    reader.cancel("meter deadline exceeded").catch(() => {});
  }, remainingMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (e) {
    // The upstream connection can drop mid-stream, or the deadline above
    // just cancelled the reader; meter what was seen so far.
    deps.log?.warn({ msg: "ten-model-proxy: metering read stopped early", err: String(e) });
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) {
    deps.log?.warn({ msg: "ten-model-proxy: meter deadline exceeded, recording the ceiling" });
  }
  return text;
}

/** True when `err` is a duplicate-`request_id` rejection (§ round 2, item 6:
 * a retry after a lost response — the first attempt's insert actually
 * landed, only its ack was lost — must not be logged as a lost row: a
 * duplicate on retry means the row IS there). `insertLedgerCall`
 * implementations mark this with a `duplicate: true` property so
 * handler.ts never has to depend on `_shared/supabase.ts`'s concrete error
 * shape or parse status codes out of a message string. */
function isDuplicateRequestId(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { duplicate?: unknown }).duplicate === true;
}

async function meterUsage(
  stream: ReadableStream<Uint8Array>,
  deps: ProxyDeps,
  uid: string,
  model: string,
  deadlineAt: number,
): Promise<void> {
  const text = await readStreamWithDeadline(stream, deps, deadlineAt);

  const parsed = parseUsageFromSSE(text);
  // S1 (fix round 1) + round 2's contract amendment + § 13.1 "Ceiling
  // uses: ... the request's model's ceiling": a garbled upstream usage
  // object must never fail the insert silently — cost and each token
  // count are validated and, if invalid, replaced (cost -> THIS request's
  // model's ceiling; a bad token count -> 0) rather than sent on faith or
  // dropped. A valid, in-range cost above the ceiling is now recorded AS
  // REPORTED (never undercounted) and gets its own anomaly log line — no
  // key, no content.
  const amounts = sanitizeUsageForLedger(parsed, ceilingUsdFor(model));
  const requestId = parsed?.id ?? deps.randomId();
  if (amounts.costAboveCeiling) {
    deps.log?.warn({
      msg: "ten-model-proxy: cost anomaly — a reported cost exceeds the ceiling",
      usd: amounts.usd,
      request_id: requestId,
    });
  }
  const row = {
    user_id: uid,
    kind: "call" as const,
    request_id: requestId,
    // § 13.1: "Ledger model records the id the proxy SENT: the validated
    // request id, not the stream's own `model` string" (an upstream may
    // add a dated suffix) — `model` here is exactly `built.body.model`
    // from handleRequest below, already validated by buildUpstreamBody.
    model,
    tokens_in: amounts.tokensIn,
    tokens_out: amounts.tokensOut,
    tokens_cached: amounts.tokensCached,
    usd: amounts.usd,
    finish_reason: amounts.finishReason,
  };

  // S1 (fix round 1): retry once before giving up, so a transient write
  // failure doesn't silently lose the row.
  try {
    await deps.insertLedgerCall(row);
    return;
  } catch (e1) {
    deps.log?.warn({ msg: "ten-model-proxy: ledger insert failed, retrying once", err: String(e1) });
  }
  try {
    await deps.insertLedgerCall(row);
  } catch (e2) {
    if (isDuplicateRequestId(e2)) {
      // Round 2, item 6: the retry hit a duplicate request_id, meaning a row
      // for this exact call already exists (most likely the first attempt's
      // own insert succeeded and only its response was lost). Nothing lost.
      deps.log?.warn({
        msg: "ten-model-proxy: ledger insert retry saw its own row already there (a lost response, not a lost row)",
        request_id: requestId,
      });
      return;
    }
    const alert = { msg: "ten-model-proxy: ALERT ledger insert failed twice; row lost", err: String(e2) };
    if (deps.log?.error) deps.log.error(alert);
    else deps.log?.warn(alert);
  }
}

/** S3 (fix round 1): reads the body incrementally and aborts as soon as it
 * exceeds `maxBytes`, without buffering the rest — a signed-in (even
 * non-member) caller could otherwise make the handler hold an arbitrarily
 * large body in memory before refusing it. A `null` body (no body at all)
 * reads as the empty string. */
async function readCappedBody(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const body = req.body;
  if (!body) return { ok: true, text: "" };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("body over the size cap").catch(() => {});
      return { ok: false };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { ok: true, text };
}

export async function handleRequest(
  req: Request,
  deps: ProxyDeps,
  env: Record<string, string | undefined>,
): Promise<Response> {
  // S4/round 2, item 2: the meter deadline is timed from here — the
  // request's own start — not from when metering happens to begin, so a
  // slow auth/balance/upstream-connect phase can't push the total past the
  // Edge Runtime's 400 s wall clock (360 s leaves 40 s of margin).
  const meterDeadlineAt = Date.now() + (deps.meterDeadlineMs ?? DEFAULT_METER_DEADLINE_MS);
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

  // N1 (fix round 1): any unexpected failure past this point (a down
  // Supabase RPC, an upstream throw code doesn't already catch, …) fails
  // CLOSED — a 503 model_error with the request's own CORS headers —
  // rather than an uncaught exception reaching the runtime.
  try {
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

    // 2. Size and membership (§ 8, point 2). S3: capped while reading, not
    // buffered fully then measured.
    const capped = await readCappedBody(req, MAX_BODY_BYTES);
    if (!capped.ok) {
      return jsonError(413, "too_large", "Request too large.", cors);
    }
    const raw = capped.text;
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

    // 4. Build the upstream body from the allowlist (§ 8, point 4). N5: an
    // empty body is refused outright, not silently treated as `{}`.
    if (raw.length === 0) {
      return jsonError(400, "bad_request", "Empty request body.", cors);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
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
    const sentModel = typeof built.body.model === "string" ? built.body.model : "";
    deps.waitUntil(meterUsage(meterStream, deps, user.id, sentModel, meterDeadlineAt));

    return new Response(clientStream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", ...cors },
    });
  } catch (e) {
    deps.log?.warn({ msg: "ten-model-proxy: unexpected failure, failing closed", err: String(e) });
    return jsonError(503, "model_error", MESSAGES.modelError, cors);
  }
}
