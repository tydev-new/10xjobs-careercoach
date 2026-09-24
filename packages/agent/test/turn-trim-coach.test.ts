// § 12 (docs/design-web-agent.md, amended 2026-09-24) — "a turn that grows
// too large", exercised through the coach's public surface (the pattern
// every other coach test in this package already uses,
// test/cut-off.test.ts). turn-trim.test.ts covers the pure algorithm;
// this file covers the WIRING: prepareStep really runs on both the first
// call and § 9.2's continuation, the proxy's 413 maps to the new
// too_large code, and § 9.4's next-turn note gains its third entry.
import assert from "node:assert/strict";
import test from "node:test";
import { readUIMessageStream } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { createCoach, ERROR_MESSAGES } from "../src/coach.ts";
import { createInMemoryGate } from "../src/gate.ts";
import { createFakeScriptRunner } from "../src/tools/fake-script-runner.ts";
import { createInMemoryWorkspaceStore } from "../src/workspace/in-memory-store.ts";
import { messagesByteLength, stubFor, TRIM_TRIGGER_BYTES } from "../src/turn-trim.ts";
import type { AppMessage } from "../src/types.ts";
import { loadRealSkillBundle } from "./support.ts";

function userMsg(id: string, text: string): AppMessage {
  return { id, role: "user", parts: [{ type: "text", text }], metadata: { origin: "typed" } } as AppMessage;
}

function textStep(text: string, finish: "stop" | "length" = "stop") {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: text },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: finish, raw: finish }, usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
      ] as any,
    }),
  };
}

/** A step that calls `read_file` on a fixed workspace path — the § 12.3
 *  (i) shape: "12 steps each reading a 10,000-character file". */
function readFileStep(id: string, path: string) {
  const input = JSON.stringify({ path });
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id, toolName: "read_file" },
        { type: "tool-input-delta", id, delta: input },
        { type: "tool-input-end", id },
        { type: "tool-call", toolCallId: id, toolName: "read_file", input },
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

test("§ 12.1 (i): a synthetic long turn (20 read_file steps over a 10,000-character file) keeps every request's messages within budget, stubs the oldest step's output word for word, and the whole thing lands well under the proxy's 256 KB cap", async () => {
  const bigContent = "x".repeat(10_000);
  const workspace = createInMemoryWorkspaceStore({ "big.md": bigContent });
  const N = 20;
  const steps = Array.from({ length: N }, (_, i) => readFileStep(`r${i}`, "big.md"));
  const model = new MockLanguageModelV4({ doStream: [...steps, textStep("done reading")] as any });
  const coach = await baseCoach(model, { workspace });

  const last = await run(coach, "chat-1", [userMsg("u1", "read big.md 20 times")]);

  assert.equal((model as any).doStreamCalls.length, N + 1, "one streamText call, N tool steps + one final text step");
  assert.equal((last.parts as any[]).filter((p) => p.type === "data-error").length, 0, "no error — the turn just completed, trimmed");

  const calls = (model as any).doStreamCalls;

  // § 12.1's own measure (UTF-8 bytes of JSON.stringify(messages)) applies
  // to the `messages` array, not `system` — EVERY request actually sent
  // (not just the last) must already reflect prepareStep's decision, so
  // none of them ever carries an over-budget `messages` array past the
  // model — checked with a small margin for the ModelMessage ->
  // LanguageModelV2 prompt format's own (minor) shape differences.
  for (const [i, call] of calls.entries()) {
    const prompt = call.prompt as any[];
    assert.equal(prompt[0].role, "system", `call ${i}: system is always prompt[0]`);
    const nonSystem = prompt.slice(1);
    assert.ok(
      messagesByteLength(nonSystem) <= TRIM_TRIGGER_BYTES + 5_000,
      `call ${i}: messages must stay near the ${TRIM_TRIGGER_BYTES}-byte trigger, was ${messagesByteLength(nonSystem)}`,
    );
  }

  const finalPrompt = calls[calls.length - 1].prompt as any[];
  // The whole request (system + messages + this package's own tool
  // descriptions, all fixed at "~30 KB", § 12.1) stays comfortably under
  // the proxy's 256 KB body cap (§ 8).
  assert.ok(messagesByteLength(finalPrompt) < 256_000, "well under the proxy's 256 KB cap after trimming");

  // The trim actually fired at some point (this fixture crosses 160,000
  // partway through the 20 reads): the stub text (word for word) shows up
  // once the trim engages, and the OLDEST read (r0) — stubbed oldest-first
  // — never reappears in full once that happens, while a recent read
  // still carries its own full content (nothing here ever drops a whole
  // message, only long strings inside one).
  const sawStub = calls.some((c: any) => JSON.stringify(c.prompt).includes(stubFor(10_000)));
  assert.ok(sawStub, "the stub text (word for word) appears in at least one real request once the trigger was crossed");

  const finalText = JSON.stringify(finalPrompt);
  const r0Part = finalPrompt.find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.toolCallId === "r0" && c.type === "tool-result"));
  assert.ok(r0Part, "r0's tool-result message is still present in the final request (never a whole message dropped)");
  assert.equal(
    r0Part.content.find((c: any) => c.toolCallId === "r0").output.value.content,
    stubFor(10_000),
    "by the final request, the oldest read (r0) has been stubbed, oldest-first",
  );
  assert.ok(finalText.includes("x".repeat(10_000)), "a RECENT read still carries its full content — trimming only touches what crossing the trigger actually required");
});

test("§ 12.1: under budget — a short turn's requests are never touched by the trimmer (no stub text anywhere)", async () => {
  const model = new MockLanguageModelV4({ doStream: [textStep("just a short reply")] as any });
  const coach = await baseCoach(model);
  await run(coach, "chat-1", [userMsg("u1", "hi")]);
  const call = (model as any).doStreamCalls[0];
  assert.ok(!JSON.stringify(call.prompt).includes("Removed to save space"), "no stub — nowhere near the 160,000-byte trigger");
});

test("§ 12.1: prepareStep also runs on § 9.2's continuation call, and the continuation's own request stays within budget", async () => {
  const bigContent = "x".repeat(10_000);
  const workspace = createInMemoryWorkspaceStore({ "big.md": bigContent });
  // Call 1: enough big reads to be near/over budget by itself, then a
  // text cut-off (finishReason "length") so § 9.2 fires a continuation.
  const N = 16;
  const call1Steps = Array.from({ length: N }, (_, i) => readFileStep(`c1r${i}`, "big.md"));
  const model = new MockLanguageModelV4({
    doStream: [...call1Steps, textStep("cut off mid-sentence", "length"), textStep("finished now", "stop")] as any,
  });
  const coach = await baseCoach(model, { workspace });

  const last = await run(coach, "chat-1", [userMsg("u1", "read big.md many times then answer")]);
  assert.equal((last.parts as any[]).filter((p) => p.type === "data-error" && p.data.code === "cut_off").length, 0, "the continuation succeeded — no visible cut_off");

  const calls = (model as any).doStreamCalls;
  assert.equal(calls.length, N + 2, "N reads + the cut-off step + the continuation's own one step");
  // The continuation's own request (the very last doStream call) carries
  // call 1's ENTIRE step history (buildContinuationMessages) plus the
  // synthesized tool-result and the note — by far the largest single
  // request in the turn. It must still be trimmed.
  const continuationPrompt = calls[calls.length - 1].prompt as any[];
  const nonSystem = continuationPrompt.slice(1);
  assert.ok(
    messagesByteLength(nonSystem) <= TRIM_TRIGGER_BYTES + 5_000,
    `the continuation's own request must be trimmed too, was ${messagesByteLength(nonSystem)}`,
  );
  // § 9.2's note is still there, word for word, untouched by the trim.
  const tail = continuationPrompt[continuationPrompt.length - 1];
  assert.equal(tail.role, "user");
  assert.match(tail.content[0].text, /Note from the Ten app, not the candidate:/);
});

test("§ 12.2: a proxy 413 maps to too_large, the FIXED message (not the proxy's own 'Request too large.'), retryable, no continuation, no gate touched", async () => {
  const gate = createInMemoryGate();
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const e: any = new Error("Request too large");
      e.statusCode = 413;
      e.responseBody = JSON.stringify({ error: { code: "too_large", message: "Request too large." } });
      throw e;
    },
  });
  const coach = await baseCoach(model, { gate });
  const last = await run(coach, "chat-1", [userMsg("u1", "hi")]);

  assert.equal((model as any).doStreamCalls.length, 1, "no continuation — a too_large refusal never continues (§ 9.2 condition 5, an error part)");
  const errs = (last.parts as any[]).filter((p) => p.type === "data-error").map((p) => p.data);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].code, "too_large");
  assert.equal(errs[0].message, "This turn got too big to send, so it stopped partway.");
  assert.equal(errs[0].message, ERROR_MESSAGES.too_large.message);
  assert.notEqual(errs[0].message, "Request too large.", "never the proxy's own sentence — § 12.2's message is fixed");
  assert.equal(errs[0].retryable, true);
  assert.equal(await gate.pending("chat-1"), null, "no gate opened, decided, or expired by this path");
});

test("§ 12.2: a 413 detected by the body's too_large code alone (a status a wrapper didn't surface as 413) still classifies as too_large", async () => {
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const e: any = new Error("wrapped");
      e.statusCode = 500; // NOT 413 — only the body's own code says too_large.
      e.responseBody = JSON.stringify({ error: { code: "too_large", message: "Request too large." } });
      throw e;
    },
  });
  const coach = await baseCoach(model);
  const last = await run(coach, "chat-1", [userMsg("u1", "hi")]);
  const errs = (last.parts as any[]).filter((p) => p.type === "data-error").map((p) => p.data);
  assert.equal(errs[0].code, "too_large");
});

test("§ 12.2/9.4: the next turn's system prompt carries the too_large note, word for word, after step_cap and cut_off in a hand-built triple", async () => {
  const model = new MockLanguageModelV4({ doStream: [textStep("ok", "stop")] as any });
  const coach = await baseCoach(model);

  const priorAssistant: AppMessage = {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "data-error", data: { code: "too_large", message: ERROR_MESSAGES.too_large.message, retryable: true } } as any,
      { type: "data-error", data: { code: "step_cap", message: ERROR_MESSAGES.step_cap.message, retryable: true } } as any,
      { type: "data-error", data: { code: "cut_off", message: ERROR_MESSAGES.cut_off.message, retryable: true } } as any,
    ],
  } as AppMessage;

  await run(coach, "chat-1", [userMsg("u1", "hi"), priorAssistant, userMsg("u2", "keep going")]);
  const call = (model as any).doStreamCalls[0];
  const content = String(call.prompt[0].content);

  const cutOffIndex = content.indexOf("was cut off at the output limit");
  const stepCapIndex = content.indexOf("stopped at its step limit");
  const tooLargeIndex = content.indexOf("grew too large to send");
  assert.ok(cutOffIndex >= 0 && stepCapIndex >= 0 && tooLargeIndex >= 0, "all three notes are present");
  assert.ok(cutOffIndex < stepCapIndex && stepCapIndex < tooLargeIndex, "order: cut_off, step_cap, too_large — regardless of the parts' own order on the message");
  assert.match(
    content,
    /Your previous turn in this chat stopped because its request grew too large to send\. The actions it finished did run; nothing after the stop ran\. Check the files for what was actually saved before redoing anything, tell the candidate plainly where it stopped, then carry on in smaller pieces, reading only what the next step needs, unless they asked for something else\. If the files don't show what that turn was working on, ask the candidate in one line\.$/,
    "the too_large note, word for word (§ 12.2)",
  );
});

test("§ 12.2/9.4: a too_large part alone adds only the too_large note", async () => {
  const model = new MockLanguageModelV4({ doStream: [textStep("ok", "stop")] as any });
  const coach = await baseCoach(model);
  const priorAssistant: AppMessage = {
    id: "a1",
    role: "assistant",
    parts: [{ type: "data-error", data: { code: "too_large", message: ERROR_MESSAGES.too_large.message, retryable: true } } as any],
  } as AppMessage;

  await run(coach, "chat-1", [userMsg("u1", "hi"), priorAssistant, userMsg("u2", "keep going")]);
  const call = (model as any).doStreamCalls[0];
  const content = String(call.prompt[0].content);
  assert.ok(content.includes("grew too large to send"));
  assert.ok(!content.includes("was cut off at the output limit"));
  assert.ok(!content.includes("stopped at its step limit"));
});
