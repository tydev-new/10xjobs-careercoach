// § 13.3's per-model turn-1 estimate table: Claude unchanged (measured),
// DeepSeek derived and labelled as such, an unknown id falls back to
// Claude's (the higher figures). Pure unit tests of estimate-cost.ts —
// no coach, no tools.
import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAUDE_MODEL_ID,
  computeCostEstimate,
  DEEPSEEK_MODEL_ID,
  DEFAULT_STEP_COST_MAX_USD,
  DEFAULT_STEP_COST_MEDIAN_USD,
  DEFAULT_WEB_SEARCH_COST_MAX_USD,
  DEFAULT_WEB_SEARCH_COST_MEDIAN_USD,
  MODEL_COST_TABLE,
  modelIdOf,
} from "../src/estimate-cost.ts";

const EPS = 1e-9;
const close = (a: number, b: number) => Math.abs(a - b) < EPS;

test("§ 13.3: MODEL_COST_TABLE's exact figures — Claude unchanged, DeepSeek derived", () => {
  assert.equal(MODEL_COST_TABLE[CLAUDE_MODEL_ID].stepMedianUsd, 0.0019);
  assert.equal(MODEL_COST_TABLE[CLAUDE_MODEL_ID].stepMaxUsd, 0.0025);
  assert.equal(MODEL_COST_TABLE[CLAUDE_MODEL_ID].searchMedianUsd, 0.035);
  assert.equal(MODEL_COST_TABLE[CLAUDE_MODEL_ID].searchMaxUsd, 0.047);

  assert.equal(MODEL_COST_TABLE[DEEPSEEK_MODEL_ID].stepMedianUsd, 0.0004);
  assert.equal(MODEL_COST_TABLE[DEEPSEEK_MODEL_ID].stepMaxUsd, 0.0005);
  assert.equal(MODEL_COST_TABLE[DEEPSEEK_MODEL_ID].searchMedianUsd, 0.013);
  assert.equal(MODEL_COST_TABLE[DEEPSEEK_MODEL_ID].searchMaxUsd, 0.015);

  // Claude's row IS the top-level defaults (unchanged from before § 13).
  assert.equal(MODEL_COST_TABLE[CLAUDE_MODEL_ID].stepMedianUsd, DEFAULT_STEP_COST_MEDIAN_USD);
  assert.equal(MODEL_COST_TABLE[CLAUDE_MODEL_ID].stepMaxUsd, DEFAULT_STEP_COST_MAX_USD);
  assert.equal(MODEL_COST_TABLE[CLAUDE_MODEL_ID].searchMedianUsd, DEFAULT_WEB_SEARCH_COST_MEDIAN_USD);
  assert.equal(MODEL_COST_TABLE[CLAUDE_MODEL_ID].searchMaxUsd, DEFAULT_WEB_SEARCH_COST_MAX_USD);

  assert.match(MODEL_COST_TABLE[DEEPSEEK_MODEL_ID].method, /derived/i);
  assert.match(MODEL_COST_TABLE[DEEPSEEK_MODEL_ID].method, /not measured/i);
});

test("§ 13.3: DeepSeek's step figures are Claude's × 0.1875, rounded up", () => {
  assert.ok(0.0019 * 0.1875 <= 0.0004 && 0.0004 - 0.0019 * 0.1875 < 0.0001);
  assert.ok(0.0025 * 0.1875 <= 0.0005 && 0.0005 - 0.0025 * 0.1875 < 0.0001);
});

test("§ 13.3: DeepSeek's search figures are Claude's TOKEN part (minus the $0.007 fee) × 0.1875, plus the fee back", () => {
  const derivedMedian = (0.035 - 0.007) * 0.1875 + 0.007;
  const derivedMax = (0.047 - 0.007) * 0.1875 + 0.007;
  assert.ok(derivedMedian <= 0.013 && 0.013 - derivedMedian < 0.001);
  assert.ok(derivedMax <= 0.015 && 0.015 - derivedMax < 0.001);
});

test("computeCostEstimate: no model given -> Claude's numbers (unchanged pre-§ 13 behavior)", () => {
  const noModel = computeCostEstimate({ steps: 2, webSearches: 3 });
  const claude = computeCostEstimate({ steps: 2, webSearches: 3, model: CLAUDE_MODEL_ID });
  assert.deepEqual(noModel, claude);
  assert.ok(close(noModel.lowUsd, 2 * 0.0019 + 3 * 0.035));
  assert.ok(close(noModel.highUsd, 2 * 0.0025 + 3 * 0.047));
});

test("computeCostEstimate: DeepSeek turn-1 (no measured steps) uses 0.0004/0.0005 and 0.013/0.015", () => {
  const out = computeCostEstimate({ steps: 2, webSearches: 3, model: DEEPSEEK_MODEL_ID });
  assert.ok(close(out.lowUsd, 2 * 0.0004 + 3 * 0.013), `lowUsd ${out.lowUsd}`);
  assert.ok(close(out.highUsd, 2 * 0.0005 + 3 * 0.015), `highUsd ${out.highUsd}`);
});

test("computeCostEstimate: a stub/unknown model id uses Claude's numbers (§ 13.5 (viii))", () => {
  const out = computeCostEstimate({ steps: 1, webSearches: 1, model: "stub/test-model" });
  assert.ok(close(out.lowUsd, 0.0019 + 0.035));
  assert.ok(close(out.highUsd, 0.0025 + 0.047));
});

test("computeCostEstimate: once a chat has measured steps, those are used whatever the model", () => {
  const measuredSteps = [{ usd: 0.01 }, { usd: 0.02 }, { usd: 0.05 }];
  const claude = computeCostEstimate({ steps: 3, webSearches: 0, measuredSteps, model: CLAUDE_MODEL_ID });
  const deepseek = computeCostEstimate({ steps: 3, webSearches: 0, measuredSteps, model: DEEPSEEK_MODEL_ID });
  assert.deepEqual(claude, deepseek, "the step part comes from the SAME measured samples regardless of model");
  assert.match(claude.method, /measured/);
});

test("computeCostEstimate: measured steps still price a search per the ACTIVE model (the search constants are separate from step pricing)", () => {
  const measuredSteps = [{ usd: 0.01 }];
  const claude = computeCostEstimate({ steps: 1, webSearches: 2, measuredSteps, model: CLAUDE_MODEL_ID });
  const deepseek = computeCostEstimate({ steps: 1, webSearches: 2, measuredSteps, model: DEEPSEEK_MODEL_ID });
  assert.ok(close(claude.highUsd - deepseek.highUsd, 2 * (0.047 - 0.015)), `${claude.highUsd} vs ${deepseek.highUsd}`);
});

// ---------------------------------------------------------------- modelIdOf

test("modelIdOf: a plain string id passes through", () => {
  assert.equal(modelIdOf(CLAUDE_MODEL_ID), CLAUDE_MODEL_ID);
});

test("modelIdOf: an object exposing .modelId (the AI SDK's LanguageModel shape) is read from it", () => {
  assert.equal(modelIdOf({ modelId: DEEPSEEK_MODEL_ID }), DEEPSEEK_MODEL_ID);
});

test("modelIdOf: undefined, null, or an object with no .modelId never throws — returns undefined", () => {
  assert.equal(modelIdOf(undefined), undefined);
  assert.equal(modelIdOf(null), undefined);
  assert.equal(modelIdOf({}), undefined);
  assert.equal(modelIdOf({ modelId: 5 }), undefined);
  assert.equal(modelIdOf(42), undefined);
});
