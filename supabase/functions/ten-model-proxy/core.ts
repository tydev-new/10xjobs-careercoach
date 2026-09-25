// Pure, network-free pieces of ten-model-proxy (docs/design-web-agent.md § 8):
// the request-field allowlist that rebuilds the upstream body, the path
// matcher, and the SSE usage/cost parser used to meter each call. Kept apart
// from handler.ts so they're trivial to unit test without any fetch mocking.

export const MODEL = "anthropic/claude-sonnet-5";
// § 9.5 (docs/design-web-agent.md, amended 2026-09-24): 8,192, was 4,096.
// At the design's worst case of 30 tokens/s, 8,192 tokens take ~273 s —
// inside the meter's ~360 s deadline (Edge Runtime wall clock: 400 s);
// 16,384 tokens (~546 s) would not fit. About 10,000 tokens is the most
// that fits at all; going higher needs a longer-running host, not a
// bigger number.
export const MAX_TOKENS_CAP = 8192;
export const MAX_WEB_RESULTS = 5;

// N3 (fix round 1): the ceiling is computed from § 8's own formula, not a
// hand-picked constant — 64k input tokens, a full output at the cap above,
// and one search at the fixed plugin's per-request price (§ 14).
const CEILING_INPUT_TOKENS = 64_000;
const CEILING_INPUT_USD_PER_MILLION = 2;
const CEILING_OUTPUT_USD_PER_MILLION = 10;
// Exa Auto: $0.007 per request, up to 10 results included (OpenRouter
// docs and the ledger, 2026-09-24). MAX_WEB_RESULTS ≤ 10 keeps it flat;
// past 10 this term becomes 0.007 + (n − 10) × 0.001.
const CEILING_SEARCH_USD_PER_REQUEST = 0.007;
export const CEILING_USD =
  (CEILING_INPUT_TOKENS * CEILING_INPUT_USD_PER_MILLION) / 1_000_000 +
  (MAX_TOKENS_CAP * CEILING_OUTPUT_USD_PER_MILLION) / 1_000_000 +
  CEILING_SEARCH_USD_PER_REQUEST; // § 14: $0.21692, "about $0.22" (§ 9.5 had $0.22992)

export const MAX_BODY_BYTES = 256 * 1024;
export const BETA_CEILING_USD = 5;
export const UPSTREAM_URL = "https://openrouter.ai/api/v1/chat/completions";
export const INT4_MAX = 2147483647;

export type BuildResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

/** N4 (fix round 1): clamps a client-supplied number to a positive integer
 * cap, floor 1. Chosen over rejecting the call outright — max_tokens and
 * web max_results both have a safe, obvious ceiling, so a garbled value
 * (fractional, zero, negative, absurdly large, or the wrong type) is
 * clamped into range rather than failing the whole request. Stated here
 * once so both call sites (max_tokens, plugins.web.max_results) agree. */
function clampPositiveInt(value: unknown, cap: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), cap));
}

/** Rebuilds the upstream OpenRouter body from an explicit allowlist
 * (docs/design-web-agent.md § 8, point 4). Copies `messages`,
 * `tool_choice`, `temperature` verbatim; copies `tools` filtered to
 * `type: "function"` entries only (S2, fix round 1 — server-tool types such
 * as `web_search_*` are dropped; web search reaches the model only through
 * the fixed `plugins: [{ id: "web" }]` rewrite below); forces `model`,
 * `max_tokens` (clamped to a positive integer, capped), `stream: true`, the
 * provider privacy filter, and `cache_control`; rewrites a
 * `plugins: [{ id: "web" }]` request to the fixed engine and a capped,
 * clamped result count. Everything else — `models`, `max_completion_tokens`,
 * `reasoning`, `web_search_options`, other plugins, `stream: false`, … — is
 * silently dropped. */
export function buildUpstreamBody(input: unknown): BuildResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, status: 400, code: "bad_request", message: "Invalid request body." };
  }
  const client = input as Record<string, unknown>;

  if ("model" in client && client.model !== undefined && client.model !== MODEL) {
    return {
      ok: false,
      status: 400,
      code: "model_not_allowed",
      message: `Only ${MODEL} is allowed.`,
    };
  }

  const out: Record<string, unknown> = {};
  if ("messages" in client) out.messages = client.messages;
  if ("tools" in client) {
    const tools = Array.isArray(client.tools) ? client.tools : [];
    out.tools = tools.filter(
      (tool) => tool && typeof tool === "object" && (tool as Record<string, unknown>).type === "function",
    );
  }
  if ("tool_choice" in client) out.tool_choice = client.tool_choice;
  if ("temperature" in client) out.temperature = client.temperature;

  out.model = MODEL;
  out.max_tokens = clampPositiveInt(client.max_tokens, MAX_TOKENS_CAP, MAX_TOKENS_CAP);
  out.stream = true;
  out.provider = { data_collection: "deny", zdr: true };
  out.cache_control = { type: "ephemeral" };

  const plugins = Array.isArray(client.plugins) ? client.plugins : [];
  const webPlugin = plugins.find(
    (p) => p && typeof p === "object" && (p as Record<string, unknown>).id === "web",
  ) as Record<string, unknown> | undefined;
  if (webPlugin) {
    const n = clampPositiveInt(webPlugin.max_results, MAX_WEB_RESULTS, MAX_WEB_RESULTS);
    out.plugins = [{ id: "web", engine: "exa", max_results: n }];
  }

  return { ok: true, body: out };
}

/** The path after the function's own name, so the same check works whether
 * the request arrives as `/functions/v1/ten-model-proxy/chat/completions`
 * (deployed) or `/chat/completions` (invoked directly in tests). */
export function pathTail(url: URL): string {
  const marker = "/ten-model-proxy";
  const idx = url.pathname.indexOf(marker);
  return idx === -1 ? url.pathname : url.pathname.slice(idx + marker.length) || "/";
}

export interface ParsedUsage {
  id?: string;
  cost?: number;
  tokensIn?: number;
  tokensOut?: number;
  tokensCached?: number;
  /** § 9.6: the LAST non-null `choices[0].finish_reason` seen across the
   *  whole stream (OpenRouter's normalized value, not `native_finish_reason`).
   *  Only a string survives this pass; length (1–32) is checked later, in
   *  `sanitizeUsageForLedger`, alongside the ledger column's own check. */
  finishReason?: string;
}

/** Parses an OpenRouter SSE stream's text for cost/tokens (round 2, item 5:
 * "the meter parses only the final `data:` line carrying usage", per § 8),
 * and for `finish_reason` (§ 9.6, amended 2026-09-24: "in the meter's
 * existing pass over the `data:` lines"). `usage` is REPLACED, never
 * merged, each time a line with a `usage` object is seen, so
 * `cost`/`tokensIn`/`tokensOut`/`tokensCached` always come from one single
 * line — the last one that carried `usage` — never mixed across chunks.
 * `id` is read independently (the first chunk that has one; it's the same
 * value on every chunk in practice, and this keeps a truncated final
 * `usage` line from losing the key the row is written under — see the
 * "truncated final line" test). `finishReason` is likewise read
 * independently of `usage`/`id`: it's kept updated to the LAST NON-NULL
 * `choices[0].finish_reason` seen, so the usage chunk that so often follows
 * with an empty `choices` array (§ 9.6) never blanks out the value the
 * content chunk before it carried. Tolerates `[DONE]`, keep-alive comments,
 * and a stream cut off mid-line (a malformed trailing `data:` line is
 * skipped rather than thrown). */
export function parseUsageFromSSE(text: string): ParsedUsage | null {
  let id: string | undefined;
  let usage: Record<string, unknown> | undefined;
  let finishReason: string | undefined;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") continue;
    let obj: unknown;
    try {
      obj = JSON.parse(payload);
    } catch {
      continue; // a partial/cut-off line: skip, don't throw
    }
    if (obj && typeof obj === "object") {
      const o = obj as Record<string, unknown>;
      if (!id && typeof o.id === "string") id = o.id;
      if (o.usage && typeof o.usage === "object") usage = o.usage as Record<string, unknown>;
      const choices = o.choices;
      if (Array.isArray(choices) && choices.length > 0 && choices[0] && typeof choices[0] === "object") {
        const fr = (choices[0] as Record<string, unknown>).finish_reason;
        // "last non-null wins": a null/absent finish_reason on a later
        // chunk (e.g. the trailing usage-only chunk) never overwrites an
        // earlier real value.
        if (typeof fr === "string") finishReason = fr;
      }
    }
  }

  if (!id && !usage && finishReason === undefined) return null;
  const promptDetails =
    usage && typeof usage.prompt_tokens_details === "object" && usage.prompt_tokens_details !== null
      ? (usage.prompt_tokens_details as Record<string, unknown>)
      : undefined;
  return {
    id,
    cost: typeof usage?.cost === "number" ? (usage!.cost as number) : undefined,
    tokensIn: typeof usage?.prompt_tokens === "number" ? (usage!.prompt_tokens as number) : undefined,
    tokensOut: typeof usage?.completion_tokens === "number" ? (usage!.completion_tokens as number) : undefined,
    tokensCached:
      typeof promptDetails?.cached_tokens === "number" ? (promptDetails!.cached_tokens as number) : undefined,
    finishReason,
  };
}

export interface LedgerAmounts {
  usd: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  /** true when `usd` is a reported cost accepted AS REPORTED but above
   * CEILING_USD (fix round 2) — worth its own anomaly log line, since a
   * legitimate call is not expected to land there. */
  costAboveCeiling: boolean;
  /** § 9.6: a string of 1–32 characters is kept; anything else (missing,
   *  wrong type, empty, or over 32 chars) becomes `null` — matching the
   *  `ten_usage_ledger.finish_reason` column's own check. Never blocks the
   *  insert (a parse problem gives `null`, never an exception). */
  finishReason: string | null;
}

/** S1 (fix round 1) + the round-2 contract amendment (docs/design-web-agent.md
 * § 8, "a reported cost above the ceiling is recorded, not capped"): a
 * garbled upstream `usage` object must never fail the ledger insert
 * silently, and never be taken on faith either — but a genuine, in-range
 * report must never be undercounted. `cost` is accepted AS REPORTED for any
 * finite number in `[0, CEILING_USD × 10]`, `costAboveCeiling` flagging the
 * `(CEILING_USD, CEILING_USD × 10]` slice for an anomaly log; anything else
 * (a string, `null`, negative, or beyond 10×) records the ceiling cost
 * instead. Each token count is accepted only as a finite non-negative int4
 * (`ten_usage_ledger`'s column type); anything else (fractional, negative,
 * over int4, or missing) becomes 0 rather than failing the whole row. */
export function sanitizeUsageForLedger(parsed: ParsedUsage | null): LedgerAmounts {
  const cost = parsed?.cost;
  const reportedInRange =
    typeof cost === "number" && Number.isFinite(cost) && cost >= 0 && cost <= CEILING_USD * 10;
  const usd = reportedInRange ? cost : CEILING_USD;
  const costAboveCeiling = reportedInRange && cost > CEILING_USD;
  const token = (v: unknown): number =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= INT4_MAX ? v : 0;
  const fr = parsed?.finishReason;
  const finishReason = typeof fr === "string" && fr.length >= 1 && fr.length <= 32 ? fr : null;
  return {
    usd,
    costAboveCeiling,
    tokensIn: token(parsed?.tokensIn),
    tokensOut: token(parsed?.tokensOut),
    tokensCached: token(parsed?.tokensCached),
    finishReason,
  };
}
