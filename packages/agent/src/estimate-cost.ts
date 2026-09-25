// § 4 — estimate_cost is computed by code:
//   lowUsd/highUsd = steps * the median/highest cost per step so far in
//   this chat (on turn 1, a dated constant), plus webSearches * the
//   median/highest measured cost of one search call (§ 14);
//   balanceUsd = deps.balance(); needsGate = highUsd > spendGateUsd.
// § 13 ("the site's model is a setting", § 13.3 "Honesty"): the turn-1
// constants become ONE PER MODEL — Claude's are unchanged (measured);
// DeepSeek's are derived from Claude's × a fixed ratio and labelled as
// such. An unknown model id (a stub/test model, or `deps.model` missing)
// uses Claude's — the higher figures, which err toward opening a spend
// gate rather than under-warning (rule 5). Once a chat has its own
// measured steps, those are used whatever the model (unchanged from § 4).

// § 13's own two ids (browser-safe: this file must not import anything
// Node/DOM-only, so the ids are repeated here rather than imported from
// the proxy's core.ts, which lives outside packages/agent).
export const CLAUDE_MODEL_ID = "anthropic/claude-sonnet-5";
export const DEEPSEEK_MODEL_ID = "deepseek/deepseek-v4.1-flash";

/**
 * step 4's measured per-step cost (dated 2026-09-23, from
 * docs/spikes/spike-1-browser-loop.md's live run: turn1 $0.0018757, turn2
 * $0.0019051 for a Claude Sonnet 5 tool-call turn through OpenRouter).
 * Used only until a chat has its own measured steps to average. Kept as
 * top-level exports (unchanged) for every caller written before § 13 —
 * these are exactly Claude's row of MODEL_COST_TABLE below.
 */
export const DEFAULT_STEP_COST_MEDIAN_USD = 0.0019;
export const DEFAULT_STEP_COST_MAX_USD = 0.0025;
/** § 14 (dated 2026-09-24): one web_search is one proxy call, billed as
 *  Exa's flat $0.007 per request (up to 10 results; the proxy caps at 5)
 *  PLUS that call's own model tokens — the results read in and the
 *  answer written out. Measured over the ledger's 24 search calls:
 *  median $0.0347, highest $0.0468 (the fee alone is about a fifth),
 *  rounded up. The highest is also the spend fallback when a search
 *  reports no cost, so a missing cost never undercounts. Claude's row. */
export const DEFAULT_WEB_SEARCH_COST_MEDIAN_USD = 0.035;
export const DEFAULT_WEB_SEARCH_COST_MAX_USD = 0.047;

export interface ModelCostRow {
  stepMedianUsd: number;
  stepMaxUsd: number;
  searchMedianUsd: number;
  searchMaxUsd: number;
  /** what the numbers ARE (measured vs derived) — never overstated
   *  (rule 8): shown in the tool's own `method` output, not the candidate
   *  UI (§ 13.3: "the method ... goes in the log/output only"). */
   method: string;
}

/** § 13.3's per-model table.
 *  - Claude: median $0.0019, highest $0.0025 per step (measured
 *    2026-09-23, unchanged); search median $0.035, highest $0.047
 *    (measured 2026-09-24, unchanged).
 *  - DeepSeek: derived, not measured — Claude's step values × 0.1875
 *    (the larger of 0.375/2.00 input and 1.50/10.00 output), rounded up:
 *    0.0019 × 0.1875 = 0.0003563 -> $0.0004; 0.0025 × 0.1875 = 0.0004688
 *    -> $0.0005. Search: Claude's TOKEN part only (each value minus the
 *    flat $0.007 fee, which doesn't scale with the model) × 0.1875, plus
 *    the $0.007 fee back: (0.035 − 0.007) × 0.1875 + 0.007 = 0.01225 ->
 *    $0.013; (0.047 − 0.007) × 0.1875 + 0.007 = 0.0145 -> $0.015.
 */
export const MODEL_COST_TABLE: Record<string, ModelCostRow> = {
  [CLAUDE_MODEL_ID]: {
    stepMedianUsd: DEFAULT_STEP_COST_MEDIAN_USD,
    stepMaxUsd: DEFAULT_STEP_COST_MAX_USD,
    searchMedianUsd: DEFAULT_WEB_SEARCH_COST_MEDIAN_USD,
    searchMaxUsd: DEFAULT_WEB_SEARCH_COST_MAX_USD,
    method: "measured (2026-09-23/2026-09-24)",
  },
  [DEEPSEEK_MODEL_ID]: {
    stepMedianUsd: 0.0004,
    stepMaxUsd: 0.0005,
    searchMedianUsd: 0.013,
    searchMaxUsd: 0.015,
    method: "derived from listed prices (2026-09-24), not measured",
  },
};

/** An id not in the table (a stub/test model, or none at all) uses
 *  Claude's row — the higher figures, § 13.3: "which err toward opening a
 *  gate". */
function rowFor(model: string | undefined): ModelCostRow {
  return (model !== undefined && MODEL_COST_TABLE[model]) || MODEL_COST_TABLE[CLAUDE_MODEL_ID];
}

/** `deps.model` (packages/agent/src/types.ts's `Deps.model`, an AI SDK
 *  `LanguageModel`) is either the model id string itself, or an object
 *  exposing `.modelId` (`@openrouter/ai-sdk-provider` 3.1.0's
 *  `readonly modelId`; `ai` 7.0.111's `LanguageModel` may be either) —
 *  § 13.2: "packages/agent gets no new field. The active id is
 *  deps.model's id: the string itself, or .modelId." Never throws on an
 *  unexpected shape (undefined, a bare object with no modelId, …) —
 *  falls through to `rowFor`'s own "unknown -> Claude" default. */
export function modelIdOf(model: unknown): string | undefined {
  if (typeof model === "string") return model;
  if (model && typeof model === "object" && typeof (model as { modelId?: unknown }).modelId === "string") {
    return (model as { modelId: string }).modelId;
  }
  return undefined;
}

export interface StepCostSample {
  usd: number;
}

export interface CostEstimateInput {
  steps: number;
  webSearches: number;
  /** this chat's own measured per-step costs so far (empty on turn 1). */
  measuredSteps?: StepCostSample[];
  /** § 13.3: the active model's id (or the raw `deps.model`, run through
   *  `modelIdOf` by the caller) — an unrecognized id or `undefined` uses
   *  Claude's row. Omitted entirely by every pre-§ 13 caller, which keeps
   *  their result identical to before (Claude's numbers). */
  model?: string;
}

export interface CostEstimateResult {
  lowUsd: number;
  highUsd: number;
  method: string;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function computeCostEstimate(input: CostEstimateInput): CostEstimateResult {
  const row = rowFor(input.model);
  const measured = input.measuredSteps ?? [];
  let median = row.stepMedianUsd;
  let max = row.stepMaxUsd;
  let method = `dated-constant (step 4, 2026-09-23; ${row.method})`;
  if (measured.length > 0) {
    const sorted = [...measured.map((m) => m.usd)].sort((a, b) => a - b);
    median = sorted[Math.floor((sorted.length - 1) / 2)];
    max = sorted[sorted.length - 1];
    method = "measured (this chat's own steps so far)";
  }
  const lowUsd = round(input.steps * median + input.webSearches * row.searchMedianUsd);
  const highUsd = round(input.steps * max + input.webSearches * row.searchMaxUsd);
  return { lowUsd, highUsd, method };
}

export function needsGate(highUsd: number, spendGateUsd: number): boolean {
  return highUsd > spendGateUsd;
}
