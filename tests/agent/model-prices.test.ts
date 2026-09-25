// Tester-owned: docs/design-web-agent.md § 13.3 (estimates use the active
// model; approved § 13.6) — § 13.5 (viii), plus § 13.3's web-search and
// spend-fallback rows. The active model is the REAL OpenRouter provider's own
// modelId (stubbed fetch), exactly what the browser's deps.model carries.
// Written from the spec, not estimate-cost.ts.
// Run: node --test tests/agent/model-prices.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { AITEST, dataChunks, makeCoach, runTurn, user } from "./_support.ts";
import { contentText, sse, stubbedOpenRouter, textReply, toolReply } from "./_openrouter_stub.ts";

const CLAUDE = "anthropic/claude-sonnet-5";
const DEEPSEEK = "deepseek/deepseek-v4.1-flash";
// § 13.3's table (per step, per search)
const PRICE = {
  [CLAUDE]: { stepMedian: 0.0019, stepMax: 0.0025, searchMedian: 0.035, searchMax: 0.047 },
  [DEEPSEEK]: { stepMedian: 0.0004, stepMax: 0.0005, searchMedian: 0.013, searchMax: 0.015 },
};
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const EST = { action: "Evaluate three roles", steps: 10, webSearches: 2 };

/** The estimate_cost tool result the model sees on the next request. */
async function turnOneEstimate(model: any, m: { requests?: any[]; prompts?: any[] }) {
  const { coach } = makeCoach({ model, limits: { spendGateUsd: 100 } });
  await runTurn(coach, `est-${Math.random()}`, [user("u1", "how much would it cost?")]);
  const reqs = m.requests ?? [];
  const toolMsg = reqs[1]?.messages?.filter((x: any) => x.role === "tool").at(-1);
  return JSON.parse(contentText(toolMsg.content));
}

for (const id of [CLAUDE, DEEPSEEK]) {
  test(`§ 13.5 (viii): turn-1 estimate_cost on ${id} uses its § 13.3 prices (steps and searches)`, async () => {
    const m = stubbedOpenRouter([toolReply("estimate_cost", EST, 0.0001), textReply("ok")], { modelId: id });
    const out = await turnOneEstimate(m.model, m);
    const p = PRICE[id];
    assert.ok(close(out.lowUsd, 10 * p.stepMedian + 2 * p.searchMedian), `low ${JSON.stringify(out)}`);
    assert.ok(close(out.highUsd, 10 * p.stepMax + 2 * p.searchMax), `high ${JSON.stringify(out)}`);
    if (id === DEEPSEEK) assert.match(out.method, /derived from listed prices \(2026-09-24\), not measured/, "DeepSeek's figures are labelled derived");
    else assert.ok(!/derived/.test(out.method), `Claude's are measured: ${out.method}`);
  });
}

test("§ 13.5 (viii): a stub model id (not in the table) uses Claude's — the higher — prices", async () => {
  let n = 0;
  const bodies: any[] = [];
  const model = new (AITEST as any).MockLanguageModelV4({
    doStream: async (o: any) => {
      bodies.push(o.prompt);
      const steps = [
        [{ type: "stream-start", warnings: [] }, { type: "tool-call", toolCallId: "e1", toolName: "estimate_cost", input: JSON.stringify(EST) }, { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } }],
        [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "ok" }, { type: "text-end", id: "t" }, { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } }],
      ];
      return { stream: (AITEST as any).simulateReadableStream({ chunks: steps[n++] }) };
    },
  });
  assert.ok(!Object.keys(PRICE).includes(model.modelId), `precondition: a stub id (${model.modelId})`);
  const { coach } = makeCoach({ model, limits: { spendGateUsd: 100 } });
  await runTurn(coach, "est-stub", [user("u1", "cost?")]);
  const tool = bodies[1].filter((x: any) => x.role === "tool").at(-1).content[0];
  const out = tool.output.value ?? JSON.parse(tool.output.text ?? "{}");
  assert.ok(close(out.highUsd, 10 * PRICE[CLAUDE].stepMax + 2 * PRICE[CLAUDE].searchMax), JSON.stringify(out));
});

test("§ 13.5 (viii): with measured steps, both models price steps from the chat's own measurements", async () => {
  for (const id of [CLAUDE, DEEPSEEK]) {
    const m = stubbedOpenRouter([toolReply("list_files", {}, 0.01), toolReply("estimate_cost", { ...EST, webSearches: 0 }, 0.02), textReply("ok")], { modelId: id });
    const { coach } = makeCoach({ model: m.model, limits: { spendGateUsd: 100 } });
    await runTurn(coach, `meas-${id}`, [user("u1", "list, then estimate")]);
    const out = JSON.parse(contentText(m.requests[2].messages.filter((x: any) => x.role === "tool").at(-1).content));
    assert.ok(close(out.highUsd, 10 * 0.01) && close(out.lowUsd, 10 * 0.01), `${id}: ${JSON.stringify(out)}`);
  }
});

// § 13.3: the spend fallback for a web_search that reports no cost is the
// active model's highest search price. Observed through the allowance: a
// $0.001 turn allowance opens the "Continue this run" gate right after the
// search step, and the gate text states the spend so far.
for (const id of [CLAUDE, DEEPSEEK]) {
  test(`§ 13.3: a web_search with no reported cost adds ${id}'s highest search price to the turn's spend`, async () => {
    const m = stubbedOpenRouter([toolReply("web_search", { query: "acme funding" }, 0.0001), textReply("MUST NOT BE REQUESTED")], { modelId: id });
    const { coach } = makeCoach({ model: m.model, limits: { spendGateUsd: 0.001 }, webSearch: async () => ({ results: [] }) as any });
    const { chunks } = await runTurn(coach, `ws-${id}`, [user("u1", "search")]);
    const gate = dataChunks(chunks, "data-gate")[0]?.data;
    assert.ok(gate, "the allowance gate opened");
    const spent = Number(/Spent so far this turn: \$([0-9.]+)/.exec(gate.text)?.[1]);
    assert.ok(close(spent, 0.0001 + PRICE[id].searchMax), `${id}: spent ${spent} (text: ${JSON.stringify(gate.text)})`);
  });
}

test("§ 13.3: a step with no reported cost is recorded at the active model's median", async () => {
  // a gated turn shows the spend; a step with NO usage.cost at all
  for (const id of [CLAUDE, DEEPSEEK]) {
    const noCost = sse().toolCall(0, "l1", "list_files", {}).finish("tool_calls");
    const m = stubbedOpenRouter([noCost, textReply("MUST NOT BE REQUESTED")], { modelId: id });
    const { coach } = makeCoach({ model: m.model, limits: { spendGateUsd: 0.0001 } });
    const { chunks } = await runTurn(coach, `nc-${id}`, [user("u1", "list")]);
    const gate = dataChunks(chunks, "data-gate")[0]?.data;
    assert.ok(gate, `${id}: the allowance gate opened`);
    const spent = Number(/Spent so far this turn: \$([0-9.]+)/.exec(gate.text)?.[1]);
    assert.ok(close(spent, PRICE[id].stepMedian), `${id}: spent ${spent}`);
  }
});
