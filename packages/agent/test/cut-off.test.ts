// § 9 (docs/design-web-agent.md, amended 2026-09-24) — cut-off replies.
// The coder's own unit tests, per the issue's scope: covers §§ 9.1–9.4
// through the coach's public surface with MockLanguageModelV4 (the same
// pattern every other coach test in this package already uses), plus a
// couple of pure-helper edge cases a mock chunk script can't produce. The
// independent tester writes the § 9.8 acceptance suite separately, against
// the real @openrouter/ai-sdk-provider with a stubbed fetch — not
// duplicated here.
import assert from "node:assert/strict";
import test from "node:test";
import { readUIMessageStream } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { createCoach, ERROR_MESSAGES } from "../src/coach.ts";
import { createInMemoryGate } from "../src/gate.ts";
import { createFakeScriptRunner } from "../src/tools/fake-script-runner.ts";
import { createInMemoryWorkspaceStore } from "../src/workspace/in-memory-store.ts";
import type { AppMessage } from "../src/types.ts";
import { loadRealSkillBundle } from "./support.ts";

function userMsg(id: string, text: string): AppMessage {
  return { id, role: "user", parts: [{ type: "text", text }], metadata: { origin: "typed" } } as AppMessage;
}

function textStep(text: string, finish: "stop" | "length" = "stop", cost?: number) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: text },
        { type: "text-end", id: "t" },
        {
          type: "finish",
          finishReason: { unified: finish, raw: finish },
          usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
          ...(cost !== undefined ? { providerMetadata: { openrouter: { usage: { cost } } } } : {}),
        },
      ] as any,
    }),
  };
}

// A step that starts a tool call and never finishes it — the cut-off's
// own shape (§ 9.1's "Why it was silent": the provider drops any tool
// call whose arguments were still being written when the reason is
// "length").
function danglingToolStep() {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: "c1", toolName: "write_file" },
        { type: "tool-input-delta", id: "c1", delta: '{"path":"a.md","content":"hi' },
        { type: "finish", finishReason: { unified: "length", raw: "length" }, usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
      ] as any,
    }),
  };
}

function writeFileStep(cost?: number) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: "c1", toolName: "write_file" },
        { type: "tool-input-delta", id: "c1", delta: JSON.stringify({ path: "a.md", content: "hi" }) },
        { type: "tool-input-end", id: "c1" },
        { type: "tool-call", toolCallId: "c1", toolName: "write_file", input: JSON.stringify({ path: "a.md", content: "hi" }) },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
          ...(cost !== undefined ? { providerMetadata: { openrouter: { usage: { cost } } } } : {}),
        },
      ] as any,
    }),
  };
}

function estimateCostStep(action: string, steps: number) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: "e1", toolName: "estimate_cost" },
        { type: "tool-input-delta", id: "e1", delta: JSON.stringify({ action, steps, webSearches: 0 }) },
        { type: "tool-input-end", id: "e1" },
        { type: "tool-call", toolCallId: "e1", toolName: "estimate_cost", input: JSON.stringify({ action, steps, webSearches: 0 }) },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } },
      ] as any,
    }),
  };
}

async function baseCoach(model: any, overrides: Record<string, unknown> = {}) {
  return createCoach({
    model,
    workspace: createInMemoryWorkspaceStore(),
    skills: await loadRealSkillBundle(),
    gate: createInMemoryGate(),
    balance: async () => 5,
    fetch: globalThis.fetch,
    clock: { now: () => new Date("2026-09-24T00:00:00Z") },
    scripts: createFakeScriptRunner([]),
    ...overrides,
  } as any);
}

async function run(coach: ReturnType<typeof createCoach>, chatId: string, messages: AppMessage[]) {
  const stream = coach.stream({ chatId, messages });
  const out: AppMessage[] = [];
  for await (const m of readUIMessageStream({ stream })) out.push(m as AppMessage);
  return out[out.length - 1];
}

test("§ 9.1/9.2: a text-only cut-off (no client tool call, so the SDK never calls the stop condition at all) triggers exactly one continuation, then succeeds — one assistant message, no cut_off", async () => {
  const model = new MockLanguageModelV4({
    doStream: [textStep("cut off text", "length"), textStep("all good now", "stop")] as any,
  });
  const coach = await baseCoach(model);
  const last = await run(coach, "chat-1", [userMsg("u1", "hi")]);

  assert.equal((model as any).doStreamCalls.length, 2, "exactly two requests");
  const [call1, call2] = (model as any).doStreamCalls;
  assert.equal(call1.prompt[0].content, call2.prompt[0].content, "the system prompt is byte-identical on both calls (prompt cache)");
  const tail = call2.prompt[call2.prompt.length - 1];
  assert.equal(tail.role, "user");
  assert.equal(
    tail.content[0].text,
    "Note from the Ten app, not the candidate: your last reply was cut off at the output limit. The part that was cut off never ran: a tool call it was writing did not happen, and nothing from it was saved. Tool calls that finished before it did run. Do the unfinished work in smaller pieces, one file per write, and check the files before repeating anything.",
    "the continuation's trailing message is § 9.2's note, word for word",
  );

  const texts = (last.parts as any[]).filter((p) => p.type === "text").map((p) => p.text);
  assert.deepEqual(texts, ["cut off text", "all good now"], "both calls' text landed in ONE assistant message");
  assert.equal((last.parts as any[]).filter((p) => p.type === "data-error").length, 0, "no visible cut_off — the continuation succeeded");
});

test("§ 9.1: a dangling tool part (tool-input-start with no matching tool-call) is closed with the SDK's tool-input-error chunk, word for word, and the run continues", async () => {
  const model = new MockLanguageModelV4({
    doStream: [danglingToolStep(), textStep("recovered", "stop")] as any,
  });
  const coach = await baseCoach(model);
  const last = await run(coach, "chat-1", [userMsg("u1", "hi")]);

  assert.equal((model as any).doStreamCalls.length, 2);
  const toolPart = (last.parts as any[]).find((p) => p.type === "tool-write_file");
  assert.ok(toolPart, "the dangling tool part is still on the message");
  assert.equal(toolPart.state, "output-error");
  assert.deepEqual(toolPart.rawInput ?? toolPart.input, {});
  assert.equal(toolPart.errorText, "Cut off at the output limit before it ran. Nothing from it was saved.");
  assert.equal((last.parts as any[]).filter((p) => p.type === "data-error").length, 0);
});

test("§ 9.3: two cut-offs in one turn — exactly two requests, no third call, one visible cut_off with the fixed message and retryable: true", async () => {
  const model = new MockLanguageModelV4({
    doStream: [textStep("first cut", "length"), textStep("second cut", "length")] as any,
  });
  const coach = await baseCoach(model);
  const last = await run(coach, "chat-1", [userMsg("u1", "hi")]);

  assert.equal((model as any).doStreamCalls.length, 2, "no third call, ever");
  const errs = (last.parts as any[]).filter((p) => p.type === "data-error").map((p) => p.data);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].code, "cut_off");
  assert.equal(errs[0].message, ERROR_MESSAGES.cut_off.message);
  assert.equal(errs[0].retryable, true);
});

test("§ 9.2 precondition 2 / § 9.8(iii)(b): a cut-off on the very last allowed step opens no continuation and no step_cap — just the visible cut_off (cut-off is checked BEFORE the step cap)", async () => {
  const model = new MockLanguageModelV4({
    doStream: [textStep("cut off at the cap", "length")] as any,
  });
  const coach = await baseCoach(model, { limits: { maxSteps: 1 } });
  const last = await run(coach, "chat-1", [userMsg("u1", "hi")]);

  assert.equal((model as any).doStreamCalls.length, 1, "no continuation — call 1 already used the whole step budget");
  const errs = (last.parts as any[]).filter((p) => p.type === "data-error").map((p) => p.data);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].code, "cut_off", "cut_off wins over step_cap");
});

test("§ 9.2: every step's cost is counted exactly once across both calls — a stop()-recorded step (a tool call), a catch-up-recorded cut-off step, and a catch-up-recorded continuation step all land in the SAME chat's measured-step set with no gap and no duplicate", async () => {
  const model = new MockLanguageModelV4({
    doStream: [
      writeFileStep(0.01), // call 1, step 1 — has a client tool call, so `stop()` records it.
      textStep("cut off text", "length", 0.02), // call 1, step 2 — text-only cut-off; `stop()` never runs for it (verified against the installed ai@7.0.111 — see the hand-back); the post-call catch-up records it.
      textStep("all good now", "stop", 0.05), // call 2 (the continuation)'s only step — also text-only; also caught by catch-up.
      estimateCostStep("check one job", 1),
      textStep("noted", "stop"), // the model's own follow-up after the tool result.
    ] as any,
  });
  const coach = await baseCoach(model);

  await run(coach, "chat-1", [userMsg("u1", "hi")]);
  const last2 = await run(coach, "chat-1", [userMsg("u1", "hi"), userMsg("u2", "estimate one more step")]);

  assert.equal((model as any).doStreamCalls.length, 5, "3 steps across 2 calls, then 2 more steps for the estimate_cost turn (the tool call, then its own follow-up reply)");
  const costCard = (last2.parts as any[]).find((p) => p.type === "data-card" && p.data.card === "cost");
  assert.ok(costCard, "estimate_cost always emits a cost card");
  // computeCostEstimate: steps=1 -> lowUsd = 1*median, highUsd = 1*max,
  // off the three samples [0.01, 0.02, 0.05] (median index floor((3-1)/2)
  // = the middle one, 0.02). Any of the three steps counted zero times OR
  // more than once shifts this sorted set and this exact pair of numbers
  // — a step1 double-count (the `stop()`-recorded one re-counted by the
  // catch-up) shifts the median down to 0.01; a step2 or step3 MISS (the
  // named "today the last step of every call goes uncounted" gap) shifts
  // the max down to 0.02.
  assert.equal(costCard.data.props.lowUsd, 0.02, "median of exactly [0.01, 0.02, 0.05] — no double count");
  assert.equal(costCard.data.props.highUsd, 0.05, "max of exactly [0.01, 0.02, 0.05] — no missed step, including the continuation's own last step");
});

test("§ 9.4: the next turn's system prompt carries the stateless note, word for word, only when the assistant message just before the latest user message carries a cut_off part", async () => {
  const model = new MockLanguageModelV4({
    doStream: [textStep("first cut", "length"), textStep("second cut", "length"), textStep("ordinary reply", "stop")] as any,
  });
  const coach = await baseCoach(model);

  // turn 1: both calls cut off -> a visible cut_off part on the assistant message.
  const t1 = await run(coach, "chat-1", [userMsg("u1", "hi")]);
  const hasCutOff = (t1.parts as any[]).some((p) => p.type === "data-error" && p.data.code === "cut_off");
  assert.ok(hasCutOff);

  // turn 2: an ordinary follow-up — the system prompt must carry § 9.4's note.
  await run(coach, "chat-1", [userMsg("u1", "hi"), t1, userMsg("u2", "did it save?")]);
  const call3 = (model as any).doStreamCalls[2];
  assert.match(
    call3.prompt[0].content,
    /Your previous reply in this chat was cut off at the output limit and could not be finished, so part of that work was never saved\. Check the files for what is actually there\. Tell the candidate plainly what was saved and what wasn't \(never that nothing was attempted\), then do what's missing in smaller pieces, one file per write, unless they asked for something else\.$/,
    "§ 9.4's note, word for word, appended to the system prompt",
  );
});

test("§ 9.4: no cut_off part on the prior assistant message -> no note is appended", async () => {
  const model = new MockLanguageModelV4({
    doStream: [textStep("all fine", "stop"), textStep("still fine", "stop")] as any,
  });
  const coach = await baseCoach(model);

  const t1 = await run(coach, "chat-1", [userMsg("u1", "hi")]);
  await run(coach, "chat-1", [userMsg("u1", "hi"), t1, userMsg("u2", "and then?")]);
  const call2 = (model as any).doStreamCalls[1];
  assert.ok(!String(call2.prompt[0].content).includes("was cut off at the output limit"), "no note when the prior assistant message has no cut_off part");
});

test("§ 9.2 precondition 3: a gate already pending when the cut-off happens blocks the continuation, and the gate is untouched (still pending, not opened/decided/expired by this path)", async () => {
  // A model that opens a spend gate on step 1, then (since the gate is
  // pending) is cut off on the SAME turn's own step — the tool result
  // already ended the turn before a length finish could even occur in
  // practice, so this exercises the precondition directly via a turn
  // that starts with an ALREADY-pending gate from an earlier turn instead.
  const bigEstimate = estimateCostStep("evaluate many roles at once here", 500);
  const model = new MockLanguageModelV4({
    doStream: [bigEstimate, textStep("cut off while a gate is open", "length")] as any,
  });
  const gate = createInMemoryGate();
  const coach = await baseCoach(model, { gate });

  // turn 1: opens a gate, ends the turn (no cut-off yet).
  await run(coach, "chat-1", [userMsg("u1", "evaluate my 6 saved roles")]);
  const pendingBefore = await gate.pending("chat-1");
  assert.ok(pendingBefore, "gate opened");

  // turn 2: a genuine (non yes/no) reply reaches the model per § 3.2 and
  // is cut off — the continuation must be blocked by the pending gate.
  const last = await run(coach, "chat-1", [userMsg("u1", "evaluate my 6 saved roles"), userMsg("u2", "hmm, thinking about it")]);
  assert.equal((model as any).doStreamCalls.length, 2, "no continuation call — the gate was already pending");
  const errs = (last.parts as any[]).filter((p) => p.type === "data-error").map((p) => p.data);
  assert.equal(errs.filter((e) => e.code === "cut_off").length, 1, "the visible cut_off, not a continuation");
  const pendingAfter = await gate.pending("chat-1");
  assert.equal(pendingAfter?.gateId, pendingBefore!.gateId, "the SAME gate — untouched (not opened/decided/expired) by the cut-off path");
});
