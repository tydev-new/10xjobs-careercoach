// The testable core of ten-feedback (docs/design-feedback.md § 9): the one
// door through which a note reaches public.ten_feedback. Every side effect
// (the one database call, the status log) comes through `FeedbackDeps`, so
// this runs under `deno test` against a fake database, with no
// `window`/`document`/`localStorage`/`node:` API and no network at import
// time. index.ts wires the real deps and calls `Deno.serve`.
//
// Deployed with `--no-verify-jwt` (the local script has no key to send). It
// answers a body of status only: {"status":"sent"|"busy"|"invalid"|"failed"}.
//
// NEVER read, stored, logged or passed on: Authorization, apikey, cookies,
// x-forwarded-for or any address header, user-agent. Origin is read only to
// pick the CORS headers, and content-length only for the size cap. The one
// thing logged is the status code answered, never a body (§ 9.2).

import { allowedOrigins, corsHeaders } from "../_shared/cors.ts";
import { type FeedbackArgs, MAX_BODY_BYTES, validateBody } from "./core.ts";

export type FeedbackOutcome = "sent" | "limited" | "closed";

/** The one database member (§ 9.2 step 4, § 17.2 item 16). */
export interface FeedbackDeps {
  addFeedback(args: FeedbackArgs): Promise<FeedbackOutcome>;
  /** The status code answered, and nothing else. */
  logStatus?(status: number): void;
  /** § 9.2 step 5: 10 seconds by default; a test shortens it. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MARKER = "/ten-feedback";

/** `/functions/v1/ten-feedback` (deployed), `/ten-feedback`, or `/` (invoked
 * directly): the function's own address, with nothing after it. */
function isOwnAddress(url: URL): boolean {
  const idx = url.pathname.indexOf(MARKER);
  if (idx === -1) return url.pathname === "/";
  const tail = url.pathname.slice(idx + MARKER.length);
  return tail === "" || tail === "/";
}

function reply(status: number, body: Record<string, string>, cors: HeadersInit, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors, ...extra },
  });
}

/** Same shape as ten-model-proxy and ten-paypal-webhook: reads incrementally
 * and stops as soon as the body passes `maxBytes`, counting bytes while they
 * stream in (a missing or lying Content-Length changes nothing). */
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

/** Runs the one database call with a deadline; the timer is always cleared. */
async function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("deadline")), ms) as unknown as number;
  });
  try {
    return await Promise.race([p, deadline]);
  } finally {
    clearTimeout(timer);
    // a call that loses the race must not become an unhandled rejection
    p.catch(() => {});
  }
}

async function answer(
  req: Request,
  deps: FeedbackDeps,
  env: Record<string, string | undefined>,
): Promise<Response> {
  const url = new URL(req.url);
  const cors = corsHeaders(req.headers.get("origin"), allowedOrigins(env));

  // 1. Route: POST and OPTIONS on the function's own address; all else 404.
  if (!isOwnAddress(url)) return new Response("Not found", { status: 404 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response("Not found", { status: 404 });

  try {
    // 2. Size: counted as the body streams in.
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      await req.body?.cancel().catch(() => {});
      return reply(413, { status: "invalid" }, cors);
    }
    const capped = await readCappedBody(req, MAX_BODY_BYTES);
    if (!capped.ok) return reply(413, { status: "invalid" }, cors);

    // 3. Shape: exactly the eight keys, each passing its rule.
    let parsed: unknown;
    try {
      parsed = JSON.parse(capped.text);
    } catch {
      return reply(400, { status: "invalid" }, cors);
    }
    const checked = validateBody(parsed);
    if (!checked.ok) return reply(400, { status: "invalid" }, cors);

    // 4. One call, with arguments taken only from the validated body.
    let outcome: FeedbackOutcome;
    try {
      outcome = await withDeadline(deps.addFeedback(checked.args), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    } catch {
      return reply(503, { status: "failed" }, cors);
    }

    // 5. Answer: a body of status only.
    if (outcome === "sent") return reply(201, { status: "sent" }, cors);
    if (outcome === "limited" || outcome === "closed") {
      return reply(429, { status: "busy" }, cors, { "Retry-After": "3600" });
    }
    return reply(503, { status: "failed" }, cors);
  } catch {
    // fail closed on anything unexpected, saying nothing about it
    return reply(503, { status: "failed" }, cors);
  }
}

export async function handleRequest(
  req: Request,
  deps: FeedbackDeps,
  env: Record<string, string | undefined>,
): Promise<Response> {
  const res = await answer(req, deps, env);
  deps.logStatus?.(res.status);
  return res;
}
