// The real database member of ten-feedback's deps: one PostgREST call to
// `rpc/ten_feedback_add` with the service role (docs/design-feedback.md § 9.2
// step 4). Kept out of handler.ts so the handler stays free of the network,
// and out of ../_shared/supabase.ts so this slice touches nothing shared.
// Plain `fetch`, no supabase-js; no `window`/`document`/`localStorage`/`node:`.

import type { SupabaseEnv } from "../_shared/supabase.ts";
import type { FeedbackArgs } from "./core.ts";
import type { FeedbackDeps, FeedbackOutcome } from "./handler.ts";

const RPC_TIMEOUT_MS = 10_000;
const OUTCOMES: readonly string[] = ["sent", "limited", "closed"];

/** Calls `ten_feedback_add`. Throws on any failure and on any answer that is
 * not one of the function's three statuses; the thrown text never carries the
 * arguments (the note's words) and is never logged by the handler. */
export async function addFeedback(
  env: SupabaseEnv,
  args: FeedbackArgs,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = RPC_TIMEOUT_MS,
): Promise<FeedbackOutcome> {
  const res = await fetchImpl(`${env.url}/rest/v1/rpc/ten_feedback_add`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.serviceRoleKey}`,
      apikey: env.serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`ten_feedback_add failed: ${res.status}`);
  }
  const body = await res.json();
  const status = body && typeof body === "object" ? (body as { status?: unknown }).status : undefined;
  if (typeof status !== "string" || !OUTCOMES.includes(status)) {
    throw new Error("ten_feedback_add answered with an unknown status");
  }
  return status as FeedbackOutcome;
}

/** The deps index.ts hands the handler: one database member, and a log of the
 * status code answered. */
export function buildDeps(
  env: SupabaseEnv,
  fetchImpl: typeof fetch = fetch,
  log: (line: string) => void = (line) => console.log(line),
): FeedbackDeps {
  return {
    addFeedback: (args) => addFeedback(env, args, fetchImpl),
    logStatus: (status) => log(`ten-feedback: ${status}`),
  };
}
