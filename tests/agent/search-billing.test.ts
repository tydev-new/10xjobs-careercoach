// Tester-owned: docs/design-web-agent.md § 14 (web search is billed per
// request, amendment 2026-09-24, b4332f9), test plan § 14.4 (i), (ii),
// (iii) and (vi). Written from the spec, not from estimate-cost.ts.
//
// § 14.1: one search is priced at what a search CALL bills (the $0.007 Exa
// fee plus the call's own tokens), measured 2026-09-24: median $0.035,
// highest $0.047.
//   lowUsd  = steps × the step median  + webSearches × 0.035
//   highUsd = steps × the step highest + webSearches × 0.047
// with or without the chat's measured steps. The spend fallback, when a
// search reports no cost, is the highest: 0.047.
//
// Run: node --test tests/agent/search-billing.test.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { CardBuilder, VersionTracker, createTools } from "../../packages/agent/src/index.ts";
import { createInMemoryGate } from "../../packages/agent/src/gate.ts";
import { createFakeScriptRunner } from "../../packages/agent/src/tools/fake-script-runner.ts";
import { createInMemoryWorkspaceStore } from "../../packages/agent/src/workspace/in-memory-store.ts";
import { makeCoach, realBundle, REPO, runTurn, scriptedModel, textStep, toolStep, user } from "./_support.ts";

const SEARCH_MEDIAN = 0.035;
const SEARCH_MAX = 0.047;
// § 4's turn-1 step constants (step 4, dated 2026-09-23), as § 14.4 (i) states them.
const STEP_MEDIAN = 0.0019;
const STEP_MAX = 0.0025;
const EPS = 1e-9;

/** The tools over a bare context, so the test controls the turn's measured
 *  steps and reads the turn's spend directly. `limits.spendGateUsd` is set
 *  high so no gate opens and the estimate is the only thing under test. */
function toolsFor(extra: Record<string, unknown> = {}, measuredSteps: Array<{ usd: number }> = []) {
  const ctx: any = {
    chatId: "c-s14",
    writer: { write: () => {}, merge: () => {} },
    versionTracker: new VersionTracker(),
    cardBuilder: new CardBuilder(),
    turnState: { measuredSteps, spentSoFarUsd: 0 },
    gateGrammarMd: realBundle()["skills/coach/references/gate-grammar.md"],
    idFor: () => crypto.randomUUID(),
  };
  const deps: any = {
    workspace: createInMemoryWorkspaceStore(),
    skills: realBundle(),
    gate: createInMemoryGate(),
    balance: async () => 5,
    fetch: async () => { throw new Error("no network in tests"); },
    clock: { now: () => new Date("2026-09-24T12:00:00Z") },
    scripts: createFakeScriptRunner([]),
    limits: { spendGateUsd: 1000 },
    ...extra,
  };
  const tools: any = createTools(deps, ctx);
  const call = (name: string, input: any) => tools[name].execute(input, { toolCallId: "x", messages: [] });
  return { call, ctx };
}

const estimate = async (steps: number, webSearches: number, measured: Array<{ usd: number }> = []) => {
  const out = await toolsFor({}, measured).call("estimate_cost", { action: "Check a role", steps, webSearches });
  assert.ok(!out.error, JSON.stringify(out));
  return out as { lowUsd: number; highUsd: number; method: string };
};

// ------------------------------------------------------------------ (i)

test("§ 14.4 (i): no measured steps, { steps: 0, webSearches: 1 } → low 0.035, high 0.047", async () => {
  const out = await estimate(0, 1);
  assert.ok(Math.abs(out.lowUsd - SEARCH_MEDIAN) < EPS, `lowUsd ${out.lowUsd}`);
  assert.ok(Math.abs(out.highUsd - SEARCH_MAX) < EPS, `highUsd ${out.highUsd}`);
});

test("§ 14.4 (i): no measured steps, { steps: 2, webSearches: 3 } → low 2 × 0.0019 + 3 × 0.035 = 0.1088, high 2 × 0.0025 + 3 × 0.047 = 0.146", async () => {
  assert.ok(Math.abs(2 * STEP_MEDIAN + 3 * SEARCH_MEDIAN - 0.1088) < EPS, "the spec's low arithmetic");
  assert.ok(Math.abs(2 * STEP_MAX + 3 * SEARCH_MAX - 0.146) < EPS, "the spec's high arithmetic");
  const out = await estimate(2, 3);
  assert.ok(Math.abs(out.lowUsd - 0.1088) < EPS, `lowUsd ${out.lowUsd}`);
  assert.ok(Math.abs(out.highUsd - 0.146) < EPS, `highUsd ${out.highUsd}`);
});

test("§ 14.4 (i): through a real turn (the coach's own chat context, turn 1) the estimate_cost result is the same 0.1088 / 0.146", async () => {
  const m = scriptedModel([toolStep([{ name: "estimate_cost", input: { action: "Check two roles", steps: 2, webSearches: 3 } }]), textStep("ok")]);
  const { chunks } = await runTurn(makeCoach({ model: m.model }).coach, "c-s14-turn", [user("u1", "how much?")]);
  const out = chunks.find((c: any) => c.type === "tool-output-available")?.output;
  assert.ok(out && !out.error, JSON.stringify(out));
  assert.ok(Math.abs(out.lowUsd - 0.1088) < EPS && Math.abs(out.highUsd - 0.146) < EPS, JSON.stringify(out));
});

// ------------------------------------------------------------------ (ii)

test("§ 14.4 (ii): with measured steps the search part is still webSearches × 0.035 / × 0.047", async () => {
  // A step's measured cost never includes a search (§ 14.1), so measured
  // steps change the step part only. Compare the same steps with and
  // without searches: the difference is exactly the search part.
  const measured = [{ usd: 0.012 }, { usd: 0.031 }, { usd: 0.02 }, { usd: 0.09 }];
  for (const webSearches of [1, 2, 7]) {
    const without = await estimate(4, 0, measured);
    const withS = await estimate(4, webSearches, measured);
    assert.match(withS.method, /measured/, `the measured path ran: ${withS.method}`);
    assert.ok(Math.abs(withS.lowUsd - without.lowUsd - webSearches * SEARCH_MEDIAN) < EPS,
      `low search part for ${webSearches}: ${withS.lowUsd} − ${without.lowUsd}`);
    assert.ok(Math.abs(withS.highUsd - without.highUsd - webSearches * SEARCH_MAX) < EPS,
      `high search part for ${webSearches}: ${withS.highUsd} − ${without.highUsd}`);
  }
});

test("§ 14.4 (ii): measured steps that are cheaper than a search do not shrink the search price (steps: 0 → exactly the search part)", async () => {
  const out = await estimate(0, 2, [{ usd: 0.0001 }, { usd: 0.0002 }]);
  assert.ok(Math.abs(out.lowUsd - 2 * SEARCH_MEDIAN) < EPS, `lowUsd ${out.lowUsd}`);
  assert.ok(Math.abs(out.highUsd - 2 * SEARCH_MAX) < EPS, `highUsd ${out.highUsd}`);
});

// ------------------------------------------------------------------ (iii)

const RESULTS = [{ url: "https://example.com/a", title: "A", excerpt: "a" }];

test("§ 14.4 (iii): a web_search seam that returns no usd adds 0.047 to the turn's spend", async () => {
  const { call, ctx } = toolsFor({ webSearch: async () => ({ results: RESULTS }) });
  const out = await call("web_search", { query: "acme layoffs" });
  assert.ok(!out.error, JSON.stringify(out));
  assert.ok(Math.abs(ctx.turnState.spentSoFarUsd - SEARCH_MAX) < EPS, `spent ${ctx.turnState.spentSoFarUsd}`);
  await call("web_search", { query: "acme funding" });
  assert.ok(Math.abs(ctx.turnState.spentSoFarUsd - 2 * SEARCH_MAX) < EPS, `two searches, spent ${ctx.turnState.spentSoFarUsd}`);
});

test("§ 14.4 (iii): a web_search seam that returns usd adds exactly that (0.0347, and 0 stays 0)", async () => {
  for (const usd of [0.0347, 0.0254, 0]) {
    const { call, ctx } = toolsFor({ webSearch: async () => ({ results: RESULTS, usd }) });
    await call("web_search", { query: "acme" });
    assert.ok(Math.abs(ctx.turnState.spentSoFarUsd - usd) < EPS, `seam usd ${usd}, spent ${ctx.turnState.spentSoFarUsd}`);
  }
});

// ------------------------------------------------------------------ (vi)

const SCAN_ROOTS = ["packages", "apps/web/src", "supabase/functions"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".temp", ".git"]);
const TEXT = /\.(ts|tsx|mts|mjs|js|cjs|json|sql|md|py|toml)$/;
const STALE_NAMES = /\bCEILING_SEARCH_USD_PER_RESULT\b|\bDEFAULT_WEB_SEARCH_COST_USD\b/;
const STALE_PRICE = /(?<![\d.])0\.004(?!\d)/;
const isTestFile = (rel: string) => /(^|\/)test\/|\.test\.[cm]?[jt]sx?$/.test(rel);

function scan(): Array<{ rel: string; line: number; text: string; test: boolean }> {
  const hits: Array<{ rel: string; line: number; text: string; test: boolean }> = [];
  const walk = (abs: string) => {
    for (const name of readdirSync(abs)) {
      if (SKIP_DIRS.has(name)) continue;
      const p = path.join(abs, name);
      const st = statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!TEXT.test(name)) continue;
      const rel = path.relative(REPO, p).split(path.sep).join("/");
      readFileSync(p, "utf8").split("\n").forEach((text, i) => {
        if (STALE_NAMES.test(text) || STALE_PRICE.test(text)) hits.push({ rel, line: i + 1, text: text.trim(), test: isTestFile(rel) });
      });
    }
  };
  for (const r of SCAN_ROOTS) walk(path.join(REPO, r));
  return hits;
}

test("§ 14.4 (vi): no 0.004 search price, CEILING_SEARCH_USD_PER_RESULT or DEFAULT_WEB_SEARCH_COST_USD in packages/, apps/web/src/, supabase/functions/ (product code)", () => {
  const hits = scan().filter((h) => !h.test).map((h) => `${h.rel}:${h.line}: ${h.text}`);
  assert.deepEqual(hits, []);
});

test("§ 14.4 (vi): …nor in the co-located tests under those roots (a test pinning $0.004 keeps the stale price alive)", () => {
  const hits = scan().filter((h) => h.test).map((h) => `${h.rel}:${h.line}: ${h.text}`);
  assert.deepEqual(hits, []);
});
