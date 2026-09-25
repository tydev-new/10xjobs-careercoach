// § 13.3: the estimate_cost/web_search TOOLS price per the ACTIVE model
// (deps.model's id), end to end through createTools — not just
// estimate-cost.ts's own pure functions (see estimate-cost.test.ts for
// those). Local ctx builder (not tools.test.ts's own makeCtx, kept
// private there) so this file stays self-contained.
import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryWorkspaceStore } from "../src/workspace/in-memory-store.ts";
import { createFakeScriptRunner } from "../src/tools/fake-script-runner.ts";
import { CardBuilder } from "../src/cards.ts";
import { VersionTracker } from "../src/tools/version-tracker.ts";
import { createTools, type ToolContext } from "../src/tools/index.ts";
import { CLAUDE_MODEL_ID, DEEPSEEK_MODEL_ID } from "../src/estimate-cost.ts";
import type { Deps } from "../src/types.ts";
import { loadRealSkillBundle } from "./support.ts";

function fakeWriter() {
  const written: any[] = [];
  return { written, write: (chunk: any) => written.push(chunk) } as any;
}

async function makeCtx(model: unknown, overrides: Partial<Deps> = {}) {
  const skills = await loadRealSkillBundle();
  const writer = fakeWriter();
  const deps: Deps = {
    model: model as any,
    workspace: overrides.workspace ?? createInMemoryWorkspaceStore(),
    skills,
    gate: overrides.gate ?? ({ open: async () => {}, decide: async () => {}, pending: async () => null, expireOtherChats: async () => {} } as any),
    balance: overrides.balance ?? (async () => 5),
    fetch: overrides.fetch ?? (globalThis.fetch as any),
    clock: overrides.clock ?? { now: () => new Date("2026-09-24T00:00:00Z") },
    scripts: overrides.scripts ?? createFakeScriptRunner([]),
    limits: overrides.limits ?? { spendGateUsd: 1000 },
    webSearch: overrides.webSearch,
    checkLanguage: overrides.checkLanguage,
  };
  const ctx: ToolContext = {
    chatId: "chat-model-cost",
    writer,
    versionTracker: new VersionTracker(),
    cardBuilder: new CardBuilder(),
    turnState: { measuredSteps: [], spentSoFarUsd: 0 },
    gateGrammarMd: skills["skills/coach/references/gate-grammar.md"],
    idFor: () => "gate-model-cost",
  };
  return { deps, ctx, writer, tools: createTools(deps, ctx) };
}

// ---------------------------------------------------------------- estimate_cost

test("§ 13.3: estimate_cost prices a Claude turn at Claude's constants", async () => {
  const { tools } = await makeCtx(CLAUDE_MODEL_ID);
  const out: any = await (tools.estimate_cost.execute as any)({ action: "check a role", steps: 2, webSearches: 3 }, {});
  assert.ok(Math.abs(out.lowUsd - (2 * 0.0019 + 3 * 0.035)) < 1e-9, `lowUsd ${out.lowUsd}`);
  assert.ok(Math.abs(out.highUsd - (2 * 0.0025 + 3 * 0.047)) < 1e-9, `highUsd ${out.highUsd}`);
});

test("§ 13.3: estimate_cost prices a DeepSeek turn at DeepSeek's derived constants", async () => {
  const { tools } = await makeCtx(DEEPSEEK_MODEL_ID);
  const out: any = await (tools.estimate_cost.execute as any)({ action: "check a role", steps: 2, webSearches: 3 }, {});
  assert.ok(Math.abs(out.lowUsd - (2 * 0.0004 + 3 * 0.013)) < 1e-9, `lowUsd ${out.lowUsd}`);
  assert.ok(Math.abs(out.highUsd - (2 * 0.0005 + 3 * 0.015)) < 1e-9, `highUsd ${out.highUsd}`);
});

test("§ 13.3: estimate_cost with the AI SDK's object model shape ({ modelId }) reads the id off .modelId, not just a bare string", async () => {
  const { tools } = await makeCtx({ modelId: DEEPSEEK_MODEL_ID });
  const out: any = await (tools.estimate_cost.execute as any)({ action: "check a role", steps: 1, webSearches: 0 }, {});
  assert.ok(Math.abs(out.lowUsd - 0.0004) < 1e-9);
});

test("§ 13.3: an unrecognized/undefined model uses Claude's constants (errs toward opening a gate)", async () => {
  const { tools } = await makeCtx(undefined);
  const out: any = await (tools.estimate_cost.execute as any)({ action: "check a role", steps: 1, webSearches: 0 }, {});
  assert.ok(Math.abs(out.lowUsd - 0.0019) < 1e-9);
});

// ---------------------------------------------------------------- web_search fallback

test("§ 13.3: web_search's no-cost fallback is DeepSeek's own highest ($0.015), not Claude's ($0.047), when DeepSeek is active", async () => {
  const { tools, ctx } = await makeCtx(DEEPSEEK_MODEL_ID, {
    webSearch: async () => ({ results: [{ url: "https://x.example", title: "x", excerpt: "x" }] }),
  });
  await (tools.web_search.execute as any)({ query: "acme" }, {});
  assert.ok(Math.abs(ctx.turnState.spentSoFarUsd - 0.015) < 1e-9, `spent ${ctx.turnState.spentSoFarUsd}`);
});

test("§ 13.3: web_search's no-cost fallback stays Claude's ($0.047) when Claude is active (unchanged from § 14)", async () => {
  const { tools, ctx } = await makeCtx(CLAUDE_MODEL_ID, {
    webSearch: async () => ({ results: [] }),
  });
  await (tools.web_search.execute as any)({ query: "acme" }, {});
  assert.ok(Math.abs(ctx.turnState.spentSoFarUsd - 0.047) < 1e-9, `spent ${ctx.turnState.spentSoFarUsd}`);
});
