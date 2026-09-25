// § 13.3: coach.ts's own step-cost FALLBACKS (recordStepCost when the
// stream reports no providerMetadata.openrouter.usage.cost;
// projectedNextStepUsd's last-resort constant) are per the ACTIVE model
// (deps.model.modelId), not always Claude's. A real createCoach() turn,
// not just the tools-level estimate_cost/web_search coverage in
// model-cost.test.ts.
import assert from "node:assert/strict";
import test from "node:test";
import { readUIMessageStream } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { createCoach } from "../src/coach.ts";
import { createInMemoryGate } from "../src/gate.ts";
import { createFakeScriptRunner } from "../src/tools/fake-script-runner.ts";
import { createInMemoryWorkspaceStore } from "../src/workspace/in-memory-store.ts";
import { CLAUDE_MODEL_ID, DEEPSEEK_MODEL_ID } from "../src/estimate-cost.ts";
import type { AppMessage } from "../src/types.ts";
import { loadRealSkillBundle } from "./support.ts";

function userMsg(id: string, text: string): AppMessage {
  return { id, role: "user", parts: [{ type: "text", text }], metadata: { origin: "typed" } } as AppMessage;
}

// A tool-call step with NO providerMetadata at all — recordStepCost's
// own fallback branch (`step.providerMetadata?.openrouter?.usage?.cost
// ?? fallbackStepMedianUsd`) is exactly what's under test here; a step
// with a real reported cost would never exercise it.
function toolCallStepNoCost(toolName: string, input: unknown, toolCallId: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: toolCallId, toolName },
        { type: "tool-input-delta", id: toolCallId, delta: JSON.stringify(input) },
        { type: "tool-input-end", id: toolCallId },
        { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } },
      ] as any,
    }),
  };
}

/** Runs ONE turn with `steps` scripted no-cost read_file calls (so the
 *  loop actually stops BETWEEN steps and recordStepCost fires each time —
 *  a plain text-only ending step never reaches the stop condition, per
 *  coach.ts's own § 9.1 comment) and returns the gate opened once the
 *  low spendGateUsd is exceeded — its `text` names spentSoFarUsd exactly. */
async function runAndGetGateText(modelId: string, steps: number): Promise<string | undefined> {
  const skills = await loadRealSkillBundle();
  const calls: any[] = [{}];
  for (let i = 0; i < steps; i++) calls.push(toolCallStepNoCost("read_file", { path: "CLAUDE.md" }, `c${i}`));
  let i = -1;
  const model = new MockLanguageModelV4({
    modelId,
    doStream: async () => {
      i++;
      return i < calls.length - 1 ? calls[i + 1] : calls[calls.length - 1];
    },
  });
  const workspace = createInMemoryWorkspaceStore({ "CLAUDE.md": "# guardrails\n" });
  const gate = createInMemoryGate();
  const coach = createCoach({
    model: model as any,
    workspace,
    skills,
    gate,
    balance: async () => 5,
    fetch: (async () => { throw new Error("no network"); }) as any,
    clock: { now: () => new Date("2026-09-24T00:00:00Z") },
    scripts: createFakeScriptRunner([]),
    // Small enough that ONE fallback-priced step already exceeds it, for
    // BOTH models (DeepSeek's fallback, $0.0004, must still trip a gate
    // set just below it).
    limits: { spendGateUsd: 0.0002, maxSteps: 25 },
  });

  let gateText: string | undefined;
  const stream = coach.stream({ chatId: `chat-${modelId}`, messages: [userMsg("u1", "read CLAUDE.md a few times")] });
  for await (const part of readUIMessageStream({ stream: stream as any })) {
    for (const p of (part as any).parts ?? []) {
      if (p.type === "data-gate") gateText = p.data.text;
    }
  }
  return gateText;
}

test("§ 13.3: a DeepSeek turn's spend-gate text is priced at DeepSeek's own step fallback ($0.0004), not Claude's ($0.0019)", async () => {
  const text = await runAndGetGateText(DEEPSEEK_MODEL_ID, 6);
  assert.ok(text, "expected a spend gate to open");
  assert.match(text!, /Spent so far this turn: \$0\.0004\b/, text);
});

test("§ 13.3: a Claude turn's spend-gate text is still priced at Claude's own fallback ($0.0019, unchanged)", async () => {
  const text = await runAndGetGateText(CLAUDE_MODEL_ID, 6);
  assert.ok(text, "expected a spend gate to open");
  assert.match(text!, /Spent so far this turn: \$0\.0019\b/, text);
});
