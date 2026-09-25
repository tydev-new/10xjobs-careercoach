// Pure, network-free pieces of ten-model-proxy (docs/design-web-agent.md § 8,
// amended by § 13 "the site's model is a setting" and § 14 "web search is
// billed per request"): the request-field allowlist that rebuilds the
// upstream body, the path matcher, and the SSE usage/cost parser used to
// meter each call. Kept apart from handler.ts so they're trivial to unit
// test without any fetch mocking.

// § 13: exactly two model ids allowed, no default fill-in — the site
// always names the model it wants (§ 13.1/§ 13.2). Order here is the
// canonical order the agreement test (apps/web's coach-model.test.ts)
// compares against.
export const CLAUDE_MODEL_ID = "anthropic/claude-sonnet-5";
export const DEEPSEEK_MODEL_ID = "deepseek/deepseek-v4.1-flash";
export const MODEL_IDS = [CLAUDE_MODEL_ID, DEEPSEEK_MODEL_ID] as const;
export type ModelId = (typeof MODEL_IDS)[number];

/** Kept for callers that only ever spoke of one model (pre-§ 13 tests,
 *  code that hasn't been touched by § 13 yet): the fallback model — the
 *  one Claude Sonnet 5 is the "measured model; the fallback" (§ 13's own
 *  table). NOT used by buildUpstreamBody to fill in a missing `model`
 *  anymore — § 13.1: "The proxy no longer fills in a model: the site
 *  always names it." A missing/invalid model is refused (400), never
 *  defaulted. */
export const MODEL: ModelId = CLAUDE_MODEL_ID;

function isModelId(v: unknown): v is ModelId {
  return typeof v === "string" && (MODEL_IDS as readonly string[]).includes(v);
}

// § 9.5 (docs/design-web-agent.md, amended 2026-09-24): 8,192, was 4,096.
// At the design's worst case of 30 tokens/s, 8,192 tokens take ~273 s —
// inside the meter's ~360 s deadline (Edge Runtime wall clock: 400 s);
// 16,384 tokens (~546 s) would not fit. About 10,000 tokens is the most
// that fits at all; going higher needs a longer-running host, not a
// bigger number. § 13.1: max_tokens is the same cap for both models.
export const MAX_TOKENS_CAP = 8192;
export const MAX_WEB_RESULTS = 5;

// N3 (fix round 1) + § 14 + § 13: the ceiling is computed from § 8/§ 14's
// own formula, per model — 64k input tokens at the dearest no-data-kept,
// tool-capable host's price, a full output at the cap above, and one
// search at the fixed plugin's per-request price.
const CEILING_INPUT_TOKENS = 64_000;
// Exa Auto: $0.007 per request, up to 10 results included (OpenRouter
// docs and the ledger, 2026-09-24). MAX_WEB_RESULTS ≤ 10 keeps it flat;
// past 10 this term becomes 0.007 + (n − 10) × 0.001.
const CEILING_SEARCH_USD_PER_REQUEST = 0.007;

/** § 13's price table — prices read 2026-09-24 from OpenRouter's public
 *  API (`GET /api/v1/models`, `/api/v1/models/{id}/endpoints`,
 *  `/api/v1/endpoints/zdr`), the DEAREST no-data-kept (`zdr: true`,
 *  `data_collection: "deny"`), tool-capable host for each model — the
 *  filter means only those hosts can ever serve a call, so those are the
 *  prices that matter, not the model's headline price:
 *
 *  - Claude Sonnet 5: the regional Bedrock/Vertex host's CACHE-WRITE
 *    price, $2.75/M — the proxy forces caching (§ 13.1) and the first
 *    call of a turn writes the cache at that price, so it's the input
 *    term that matters for the ceiling, not the plain input price.
 *    Output $11.00/M (regional).
 *  - DeepSeek V4.1 Flash: Venice, the dearest of the 21 tool-capable
 *    no-data-kept hosts — $0.375/M in, $1.50/M out. DeepSeek gets no
 *    cache-write price (none of its hosts lists one; § 13.1 also never
 *    sets `cache_control` for it).
 */
const CEILING_PRICE_USD_PER_MILLION: Record<ModelId, { input: number; output: number }> = {
  [CLAUDE_MODEL_ID]: { input: 2.75, output: 11.0 },
  [DEEPSEEK_MODEL_ID]: { input: 0.375, output: 1.5 },
};

function ceilingFor(model: ModelId): number {
  const p = CEILING_PRICE_USD_PER_MILLION[model];
  return (
    (CEILING_INPUT_TOKENS * p.input) / 1_000_000 +
    (MAX_TOKENS_CAP * p.output) / 1_000_000 +
    CEILING_SEARCH_USD_PER_REQUEST
  );
}

/** § 13.1's own table: Claude $0.273112, DeepSeek $0.043288 (both "about"
 *  figures rounded in the doc; exact here, checked to 1e-9 in the tests). */
export const CEILING_USD_BY_MODEL: Record<ModelId, number> = {
  [CLAUDE_MODEL_ID]: ceilingFor(CLAUDE_MODEL_ID),
  [DEEPSEEK_MODEL_ID]: ceilingFor(DEEPSEEK_MODEL_ID),
};

/** Returns the request's own model's ceiling; an unrecognized id (should
 *  never reach here — buildUpstreamBody already refused it) falls back to
 *  Claude's, the higher of the two, so a caller that somehow skips the
 *  allowlist still never UNDERcounts. */
export function ceilingUsdFor(model: string | undefined): number {
  return isModelId(model) ? CEILING_USD_BY_MODEL[model] : CEILING_USD_BY_MODEL[CLAUDE_MODEL_ID];
}

/** Kept for callers written before § 13 (this package's own pre-§ 13
 *  tests; `tests/functions/*.test.ts`, the independent tester's, which
 *  import this name directly): Claude's ceiling, § 13's raised figure
 *  ($0.273112 — see § 13.6 (1)'s approval). Every NEW caller should use
 *  `ceilingUsdFor(model)` instead, since the ceiling is now per model. */
export const CEILING_USD = CEILING_USD_BY_MODEL[CLAUDE_MODEL_ID];

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
 * (docs/design-web-agent.md § 8, point 4; § 13.1 for the two-model
 * amendment). Copies `messages`, `tool_choice`, `temperature` verbatim;
 * copies `tools` filtered to `type: "function"` entries only (S2, fix
 * round 1 — server-tool types such as `web_search_*` are dropped; web
 * search reaches the model only through the fixed `plugins: [{ id: "web"
 * }]` rewrite below); forces `model` (§ 13: the client's own id, once
 * validated — the proxy no longer substitutes one), `max_tokens` (clamped
 * to a positive integer, capped), `stream: true`, the provider privacy
 * filter (`require_parameters: true` ADDED for DeepSeek only, § 13.1), and
 * `cache_control` (Claude only — never sent for DeepSeek, § 13.1); rewrites
 * a `plugins: [{ id: "web" }]` request to the fixed engine and a capped,
 * clamped result count, same for both models. Everything else — `models`,
 * `max_completion_tokens`, `reasoning`, `web_search_options`, other
 * plugins, `stream: false`, … — is silently dropped.
 *
 * § 13.5 (ii)'s golden-body test depends on this NOT reordering any key
 * already written for Claude: `messages`/`tools`/`tool_choice`/
 * `temperature` (if present), then `model`, `max_tokens`, `stream`,
 * `provider`, `cache_control` (Claude only), then `plugins` (if asked) —
 * unchanged insertion order from before § 13, so `JSON.stringify` of a
 * Claude body is byte-identical to what the single-model proxy sent. */
export function buildUpstreamBody(input: unknown): BuildResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, status: 400, code: "bad_request", message: "Invalid request body." };
  }
  const client = input as Record<string, unknown>;

  // § 13.1: "The request's `model` must be exactly one of the two ids.
  // Anything else, including a missing `model` ... gets 400
  // model_not_allowed ... with no upstream call and no ledger row."
  if (!isModelId(client.model)) {
    return {
      ok: false,
      status: 400,
      code: "model_not_allowed",
      message: "This model is not allowed.",
    };
  }
  const model = client.model;

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

  out.model = model;
  out.max_tokens = clampPositiveInt(client.max_tokens, MAX_TOKENS_CAP, MAX_TOKENS_CAP);
  out.stream = true;
  // § 13.1: DeepSeek gets `require_parameters: true` (OpenRouter routes a
  // `tools` request to tool hosts only "best effort", weighted toward the
  // cheapest — the cheapest no-data-kept DeepSeek host, DekaLLM, lists no
  // tool support). Claude does not get it: every Claude host supports
  // tools, and its body must stay byte-identical to before § 13.
  out.provider =
    model === DEEPSEEK_MODEL_ID
      ? { data_collection: "deny", zdr: true, require_parameters: true }
      : { data_collection: "deny", zdr: true };
  // § 13.1: no `cache_control` for DeepSeek at all (OpenRouter's prompt
  // caching docs list top-level `cache_control` for Anthropic/Vertex/
  // Azure/Bedrock only; DeepSeek caching, if any, is automatic).
  if (model === CLAUDE_MODEL_ID) out.cache_control = { type: "ephemeral" };

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
   * the ceiling (fix round 2) — worth its own anomaly log line, since a
   * legitimate call is not expected to land there. */
  costAboveCeiling: boolean;
  /** § 9.6: a string of 1–32 characters is kept; anything else (missing,
   *  wrong type, empty, or over 32 chars) becomes `null` — matching the
   *  `ten_usage_ledger.finish_reason` column's own check. Never blocks the
   *  insert (a parse problem gives `null`, never an exception). */
  finishReason: string | null;
}

/** S1 (fix round 1) + the round-2 contract amendment (docs/design-web-agent.md
 * § 8, "a reported cost above the ceiling is recorded, not capped") + § 13
 * (the ceiling is now per model, `ceilingUsd` — the CALLING request's own
 * model's ceiling, § 13.1 "Ceiling uses: ... the request's model's
 * ceiling"): a garbled upstream `usage` object must never fail the ledger
 * insert silently, and never be taken on faith either — but a genuine,
 * in-range report must never be undercounted. `cost` is accepted AS
 * REPORTED for any finite number in `[0, ceilingUsd × 10]`,
 * `costAboveCeiling` flagging the `(ceilingUsd, ceilingUsd × 10]` slice for
 * an anomaly log; anything else (a string, `null`, negative, or beyond
 * 10×) records `ceilingUsd` instead. Each token count is accepted only as
 * a finite non-negative int4 (`ten_usage_ledger`'s column type); anything
 * else (fractional, negative, over int4, or missing) becomes 0 rather than
 * failing the whole row.
 *
 * `ceilingUsd` defaults to Claude's ceiling (`CEILING_USD`) for callers
 * written before § 13 (this package's own pre-§ 13 tests and
 * `tests/functions/*.test.ts`, the independent tester's) that call this
 * with one argument. Every NEW caller passes the request's own model's
 * ceiling via `ceilingUsdFor(model)`. */
export function sanitizeUsageForLedger(parsed: ParsedUsage | null, ceilingUsd: number = CEILING_USD): LedgerAmounts {
  const cost = parsed?.cost;
  const reportedInRange =
    typeof cost === "number" && Number.isFinite(cost) && cost >= 0 && cost <= ceilingUsd * 10;
  const usd = reportedInRange ? cost : ceilingUsd;
  const costAboveCeiling = reportedInRange && cost > ceilingUsd;
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
