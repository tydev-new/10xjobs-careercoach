// § 4 — estimate_cost is computed by code:
//   lowUsd/highUsd = steps * the median/highest cost per step so far in
//   this chat (on turn 1, a dated constant), plus web searches at the
//   listed plugin price; balanceUsd = deps.balance(); needsGate =
//   highUsd > spendGateUsd.

/**
 * step 4's measured per-step cost (dated 2026-09-23, from
 * docs/spikes/spike-1-browser-loop.md's live run: turn1 $0.0018757, turn2
 * $0.0019051 for a Claude Sonnet 5 tool-call turn through OpenRouter).
 * Used only until a chat has its own measured steps to average.
 */
export const DEFAULT_STEP_COST_MEDIAN_USD = 0.0019;
export const DEFAULT_STEP_COST_MAX_USD = 0.0025;
/** OpenRouter's `web` plugin — no published flat per-call price at
 *  authoring time; treated as a dated placeholder alongside the step
 *  costs above until the real price list (`GET /api/v1/models`, § 4) is
 *  wired into the entry point. Flagged in the coder hand-back. */
export const DEFAULT_WEB_SEARCH_COST_USD = 0.004;

export interface StepCostSample {
  usd: number;
}

export interface CostEstimateInput {
  steps: number;
  webSearches: number;
  /** this chat's own measured per-step costs so far (empty on turn 1). */
  measuredSteps?: StepCostSample[];
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
  const measured = input.measuredSteps ?? [];
  let median = DEFAULT_STEP_COST_MEDIAN_USD;
  let max = DEFAULT_STEP_COST_MAX_USD;
  let method = "dated-constant (step 4, 2026-09-23)";
  if (measured.length > 0) {
    const sorted = [...measured.map((m) => m.usd)].sort((a, b) => a - b);
    median = sorted[Math.floor((sorted.length - 1) / 2)];
    max = sorted[sorted.length - 1];
    method = "measured (this chat's own steps so far)";
  }
  const webCost = input.webSearches * DEFAULT_WEB_SEARCH_COST_USD;
  const lowUsd = round(input.steps * median + webCost);
  const highUsd = round(input.steps * max + webCost);
  return { lowUsd, highUsd, method };
}

export function needsGate(highUsd: number, spendGateUsd: number): boolean {
  return highUsd > spendGateUsd;
}
