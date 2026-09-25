// § 12.1 (docs/design-web-agent.md, amended 2026-09-24) — pure-function
// tests for turn-trim.ts's own trimming algorithm, against synthetic
// ModelMessage[] arrays (the coder's own unit tests; the independent
// tester writes the § 12.3 acceptance suite separately against the real
// packages, per that section's own preamble).
import assert from "node:assert/strict";
import test from "node:test";
import {
  messagesByteLength,
  stubFor,
  TRIM_TARGET_BYTES,
  TRIM_TRIGGER_BYTES,
  trimTurnStepsForBudget,
} from "../src/turn-trim.ts";

function userMsg(text: string) {
  return { role: "user", content: text };
}

function bigString(n: number, ch = "x"): string {
  return ch.repeat(n);
}

/** One "step": an assistant message with one tool-call, then its tool
 *  message with one tool-result — the shape coach.ts's own history takes. */
function step(id: string, outputLen: number, inputLen = 20) {
  return [
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: id, toolName: "read_file", input: { path: bigString(inputLen, "p") } },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: id,
          toolName: "read_file",
          output: { type: "json", value: { path: `${id}.md`, content: bigString(outputLen), readOnly: false } },
        },
      ],
    },
  ];
}

function textOnlyStep(text: string) {
  return [{ role: "assistant", content: [{ type: "text", text }] }];
}

test("stubFor: word for word, N the removed length", () => {
  assert.equal(
    stubFor(12345),
    "[Removed to save space: 12345 characters. The workspace files hold what was saved; read a file again if you need it.]",
  );
});

test("messagesByteLength: UTF-8 bytes of JSON.stringify(messages)", () => {
  const messages = [userMsg("hello")];
  assert.equal(messagesByteLength(messages), new TextEncoder().encode(JSON.stringify(messages)).length);
});

test("(ii) under budget: no trim, same reference returned", () => {
  const messages = [userMsg("hi"), ...step("s1", 100)];
  assert.ok(messagesByteLength(messages) <= TRIM_TRIGGER_BYTES, "sanity: this fixture is under the trigger");
  const { messages: out, trimmed } = trimTurnStepsForBudget(messages, 1);
  assert.equal(trimmed, false);
  assert.equal(out, messages, "the very same array reference — no override");
});

test("(i) trim: 20 steps each with a 10,000-character output — every request's messages end up <= 160,000 bytes, oldest stubbed first, the last 2 steps untouched, user messages and the pre-turn prefix byte-identical", () => {
  const prefix = [userMsg("evaluate these files, one read per step")];
  const turnStartIndex = prefix.length;
  let messages: unknown[] = [...prefix];
  for (let i = 0; i < 20; i++) messages.push(...step(`s${i}`, 10_000));

  assert.ok(messagesByteLength(messages) > TRIM_TRIGGER_BYTES, "sanity: this fixture is over the trigger");

  const { messages: out, trimmed } = trimTurnStepsForBudget(messages, turnStartIndex);
  assert.equal(trimmed, true);
  assert.ok(messagesByteLength(out) <= TRIM_TRIGGER_BYTES, `trimmed result must be <= ${TRIM_TRIGGER_BYTES} bytes`);

  // Prefix (everything before turnStartIndex — the windowed history and
  // the candidate's own latest message) is byte-identical.
  assert.deepEqual(out.slice(0, turnStartIndex), prefix);

  // The last 2 steps (4 messages: 2 assistant + 2 tool) are untouched —
  // still carrying their full 10,000-character content.
  const lastFour = out.slice(out.length - 4);
  const lastTwoOutputs = lastFour.filter((m: any) => m.role === "tool").map((m: any) => m.content[0].output.value.content);
  assert.equal(lastTwoOutputs.length, 2);
  for (const c of lastTwoOutputs) assert.equal((c as string).length, 10_000, "the last 2 steps keep their full content");

  // The oldest step (s0) is stubbed.
  const s0ToolMsg = (out as any[]).find(
    (m) => m.role === "tool" && m.content[0]?.toolCallId === "s0",
  );
  assert.ok(s0ToolMsg, "s0's tool message is still present (never a whole message dropped)");
  assert.equal(
    s0ToolMsg.content[0].output.value.content,
    stubFor(10_000),
    "the oldest step's long output string became the stub, word for word",
  );

  // Oldest-first: if s1 was left unstubbed while s0 was stubbed, that
  // would violate "oldest first" — walk forward from s0 and confirm no
  // stubbed step is followed by an unstubbed one among the eligible
  // (non-last-2) steps.
  const eligibleToolMsgs = (out as any[]).filter((m) => m.role === "tool").slice(0, -2);
  let sawUnstubbed = false;
  for (const m of eligibleToolMsgs) {
    const content = m.content[0].output.value.content as string;
    const isStub = content.startsWith("[Removed to save space:");
    if (!isStub) sawUnstubbed = true;
    else assert.ok(!sawUnstubbed, "a later (newer) step was stubbed while an earlier one was left full — not oldest-first");
  }
});

test("model-written text is never touched, even inside a trimmed step", () => {
  const prefix = [userMsg("go")];
  let messages: unknown[] = [...prefix];
  // A step that both writes prose AND makes a huge tool call, so the
  // group as a whole is eligible for trimming.
  messages.push({
    role: "assistant",
    content: [
      { type: "text", text: "Here is my huge finding: " + bigString(3_000, "z") },
      { type: "tool-call", toolCallId: "t0", toolName: "write_file", input: { path: "a.md", content: bigString(5_000) } },
    ],
  });
  messages.push({
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "t0", toolName: "write_file", output: { type: "json", value: { written: true } } }],
  });
  for (let i = 1; i < 20; i++) messages.push(...step(`s${i}`, 10_000));

  assert.ok(messagesByteLength(messages) > TRIM_TRIGGER_BYTES, "sanity: this fixture is over the trigger");
  const { messages: out, trimmed } = trimTurnStepsForBudget(messages, prefix.length);
  assert.equal(trimmed, true, "sanity: trimming actually happened");
  const firstAssistant = (out as any[]).find((m) => m.role === "assistant" && m.content?.[0]?.type === "text");
  assert.equal(firstAssistant.content[0].text, "Here is my huge finding: " + bigString(3_000, "z"), "the model's own prose survives untouched even though its step was eligible and its tool-call input was stubbed");
  assert.equal(firstAssistant.content[1].input.content, stubFor(5_000), "the tool-call's own long input STRING (nested under input.content) WAS stubbed");
  assert.equal(firstAssistant.content[1].input.path, "a.md", "the rest of the input object (a short field) survives untouched");
});

test("a user-role message inside the turn (§ 9.2's continuation note) is never touched or treated as a step boundary", () => {
  const prefix = [userMsg("go")];
  let messages: unknown[] = [...prefix];
  for (let i = 0; i < 18; i++) messages.push(...step(`s${i}`, 10_000));
  const note = { role: "user", content: "Note from the Ten app, not the candidate: ..." };
  messages.push(note);
  // one more step after the note, so the note isn't simply the trailing message.
  messages.push(...step("s18", 10_000));

  assert.ok(messagesByteLength(messages) > TRIM_TRIGGER_BYTES, "sanity: this fixture is over the trigger");
  const { messages: out, trimmed } = trimTurnStepsForBudget(messages, prefix.length);
  assert.equal(trimmed, true, "sanity: trimming actually happened");
  const outNote = (out as any[]).find((m) => m.role === "user" && m !== prefix[0]);
  assert.deepEqual(outNote, note, "the note is byte-identical and still present, in place");
});

test("(iii) between two trims, each request's messages begin with the previous request's (idempotent on already-stubbed content)", () => {
  const prefix = [userMsg("go")];
  let messages: unknown[] = [...prefix];
  for (let i = 0; i < 20; i++) messages.push(...step(`s${i}`, 10_000));

  const first = trimTurnStepsForBudget(messages, prefix.length);
  assert.equal(first.trimmed, true);

  // Simulate one more step being appended (as the SDK would for the next
  // step), then trim again — re-running over already-stubbed steps must
  // not further shrink them (the stub itself is short, so it can never
  // exceed 2,000 chars again) and the first N-1 messages must be
  // untouched relative to the first trim's own output.
  const withOneMore = [...first.messages, ...step("s20", 10_000)];
  const second = trimTurnStepsForBudget(withOneMore, prefix.length);
  assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages, "the second trim's messages begin with the first trim's own output");
});

test("if the never-touched remainder alone is still over budget once every eligible step is stubbed, the request goes as-is (no error, no dropped message)", () => {
  const prefix = [userMsg("go")];
  // Only 2 steps total — both are "the last 2" (never touched), so there
  // is nothing eligible to trim even though the fixture is over budget.
  let messages: unknown[] = [...prefix, ...step("s0", 90_000), ...step("s1", 90_000)];
  assert.ok(messagesByteLength(messages) > TRIM_TRIGGER_BYTES);

  const { messages: out, trimmed } = trimTurnStepsForBudget(messages, prefix.length);
  assert.equal(trimmed, false, "nothing eligible — both steps are protected");
  assert.deepEqual(out, messages, "sent as-is, nothing dropped");
});

test("only tool-call input / tool-result output are ever candidates — a step with neither (a bare text reply) is never mistaken for one with something to stub", () => {
  const prefix = [userMsg("go")];
  let messages: unknown[] = [...prefix];
  for (let i = 0; i < 20; i++) messages.push(...step(`s${i}`, 10_000));
  messages.push(...textOnlyStep(bigString(3_000, "y"))); // the turn's own final text-only step — not a tool step at all.

  assert.ok(messagesByteLength(messages) > TRIM_TRIGGER_BYTES, "sanity: this fixture is over the trigger");
  const { messages: out, trimmed } = trimTurnStepsForBudget(messages, prefix.length);
  assert.equal(trimmed, true, "sanity: trimming actually happened");
  const finalText = (out as any[])[out.length - 1];
  assert.equal(finalText.content[0].text, bigString(3_000, "y"), "the trailing text-only step (one of the protected last 2) is untouched");
});

test("exports: TRIM_TRIGGER_BYTES is 160,000 and TRIM_TARGET_BYTES is 120,000, per § 12.1", () => {
  assert.equal(TRIM_TRIGGER_BYTES, 160_000);
  assert.equal(TRIM_TARGET_BYTES, 120_000);
});
