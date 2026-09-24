// § 11.3 (what is saved) and § 11.4 (the 900,000-byte cap), written from
// docs/design-web-agent.md § 11.3/§ 11.4/§ 11.9 (iii)/(vii). Author-owned
// (packages/agent's coder built conversation.ts, so these are the coder's
// own tests — an independent reviewer still checks this file per PROCESS.md).
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONVERSATION_BYTE_CAP,
  STOPPED_BEFORE_RESULT_TEXT,
  STUB_THRESHOLD_CHARS,
  capConversationSize,
  conversationToSave,
  prepareConversationForSave,
  stubFor,
} from "../src/conversation.ts";
import type { AppMessage } from "../src/types.ts";

function msg(role: "user" | "assistant", parts: unknown[], extra: Partial<AppMessage> = {}): AppMessage {
  return { id: `${role}-${Math.random()}`, role, parts, ...extra } as AppMessage;
}

// ---------------------------------------------------------------------
// § 11.3 (iii) sanitize table
// ---------------------------------------------------------------------

test("stubFor: exact wording, N = the removed length", () => {
  assert.equal(
    stubFor(10000),
    "[Removed to save space: 10000 characters. The workspace files hold what was saved; read a file again if you need it.]",
  );
});

test("a 10,000-character tool output becomes the stub, N = 10000", () => {
  const messages = [msg("assistant", [{ type: "tool-read_file", toolCallId: "t1", state: "output-available", input: { path: "a.md" }, output: { content: "x".repeat(10000) } }])];
  const [out] = conversationToSave(messages);
  const part = out.parts[0] as any;
  assert.equal(part.output.content, stubFor(10000));
  assert.equal(part.input.path, "a.md", "a short string in input is untouched");
});

test("exactly 2,000 characters stays; 2,001 is stubbed", () => {
  const at = "x".repeat(STUB_THRESHOLD_CHARS);
  const over = "x".repeat(STUB_THRESHOLD_CHARS + 1);
  const messages = [msg("assistant", [{ type: "tool-read_file", toolCallId: "t1", state: "output-available", input: {}, output: { a: at, b: over } }])];
  const [out] = conversationToSave(messages);
  const part = out.parts[0] as any;
  assert.equal(part.output.a, at, "2,000 chars stays word for word");
  assert.equal(part.output.b, stubFor(over.length), "2,001 chars is stubbed");
});

test("text and data-* parts are kept word for word", () => {
  const messages = [
    msg("user", [{ type: "text", text: "Evaluate this role" }], { metadata: { origin: "typed" } }),
    msg("assistant", [
      { type: "text", text: "Sure." },
      { type: "data-card", data: { card: "verdict", props: { company: "Acme" } } },
      { type: "data-gate", data: { gateId: "g1", kind: "spend", label: "x", text: "y", textHash: "sha256:z", gateLine: "z", amountUsd: 1 } },
      { type: "data-gate-status", data: { gateId: "g1", status: "pending" } },
      { type: "data-error", data: { code: "cut_off", message: "m", retryable: true } },
      { type: "step-start" },
    ]),
  ];
  const out = conversationToSave(messages);
  assert.deepEqual(out[0].parts, messages[0].parts);
  assert.deepEqual(out[1].parts, messages[1].parts);
});

test("message-level metadata is kept word for word", () => {
  const messages = [msg("user", [{ type: "text", text: "hi" }], { metadata: { origin: "typed" } })];
  const [out] = conversationToSave(messages);
  assert.deepEqual((out as any).metadata, { origin: "typed" });
});

test("reasoning parts and non-workspace file parts are dropped; a workspace: file part is kept", () => {
  const messages = [
    msg("assistant", [
      { type: "reasoning", text: "internal thought" },
      { type: "file", mediaType: "application/pdf", url: "data:application/pdf;base64,AAA=" },
      { type: "file", mediaType: "application/pdf", filename: "resume.pdf", url: "workspace:documents/resume.pdf" },
    ]),
  ];
  const [out] = conversationToSave(messages);
  assert.equal(out.parts.length, 1);
  assert.equal((out.parts[0] as any).url, "workspace:documents/resume.pdf");
});

for (const state of ["input-streaming", "input-available", "approval-requested", "approval-responded", "output-denied"] as const) {
  test(`a tool part in state "${state}" is saved as output-error with the fixed text`, () => {
    const messages = [msg("assistant", [{ type: "tool-bash", toolCallId: "t1", state, input: { command: "ls" } }])];
    const [out] = conversationToSave(messages);
    const part = out.parts[0] as any;
    assert.equal(part.state, "output-error");
    assert.equal(part.errorText, STOPPED_BEFORE_RESULT_TEXT);
    assert.equal(part.output, undefined);
    assert.deepEqual(part.input, { command: "ls" });
  });
}

test("an output-error tool part's own long errorText is stubbed too", () => {
  const messages = [msg("assistant", [{ type: "tool-bash", toolCallId: "t1", state: "output-error", input: {}, errorText: "e".repeat(3000) }])];
  const [out] = conversationToSave(messages);
  assert.equal((out.parts[0] as any).errorText, stubFor(3000));
});

test("a dynamic-tool part is sanitized the same way as a static tool part", () => {
  const messages = [msg("assistant", [{ type: "dynamic-tool", toolName: "web_search", toolCallId: "t1", state: "output-available", input: { query: "x" }, output: { results: [] } }])];
  const [out] = conversationToSave(messages);
  assert.equal((out.parts[0] as any).state, "output-available");
});

test("conversationToSave never mutates its input", () => {
  const original = [msg("assistant", [{ type: "tool-read_file", toolCallId: "t1", state: "output-available", input: {}, output: { a: "x".repeat(3000) } }])];
  const snapshot = JSON.parse(JSON.stringify(original));
  conversationToSave(original);
  assert.deepEqual(original, snapshot);
});

// ---------------------------------------------------------------------
// § 11.4 (vii) the 900,000-byte cap
// ---------------------------------------------------------------------

function bigTurn(id: number, bytes: number): AppMessage[] {
  return [
    msg("user", [{ type: "text", text: `turn ${id}` }], { id: `u${id}`, metadata: { origin: "typed" } }),
    msg("assistant", [{ type: "text", text: "x".repeat(bytes) }], { id: `a${id}` }),
  ];
}

test("under the cap: nothing dropped, older_dropped false", () => {
  const messages = [...bigTurn(1, 100), ...bigTurn(2, 100)];
  const { messages: kept, droppedAnyTurn } = capConversationSize(messages, CONVERSATION_BYTE_CAP);
  assert.deepEqual(kept, messages);
  assert.equal(droppedAnyTurn, false);
});

test("over the cap: drops the OLDEST whole turns only, keeps the newest", () => {
  const messages = [...bigTurn(1, 500_000), ...bigTurn(2, 500_000), ...bigTurn(3, 10_000)];
  const { messages: kept, droppedAnyTurn } = capConversationSize(messages, 600_000);
  assert.equal(droppedAnyTurn, true);
  const ids = kept.map((m) => (m as any).id);
  assert.ok(ids.includes("u3") && ids.includes("a3"), "the newest turn survives");
  assert.ok(!ids.includes("u1") && !ids.includes("a1"), "the oldest turn is gone");
  // never a split turn: for every turn, both its messages are present or both are gone
  for (const t of [["u1", "a1"], ["u2", "a2"], ["u3", "a3"]]) {
    const present = t.filter((id) => ids.includes(id));
    assert.ok(present.length === 0 || present.length === 2, `split turn: ${present}`);
  }
});

test("the result is always <= maxBytes once more than one turn remains", () => {
  const messages = [...bigTurn(1, 200_000), ...bigTurn(2, 200_000), ...bigTurn(3, 200_000), ...bigTurn(4, 200_000)];
  const { messages: kept } = capConversationSize(messages, 500_000);
  const size = new TextEncoder().encode(JSON.stringify(kept)).byteLength;
  assert.ok(size <= 500_000, `size ${size} exceeds the cap`);
});

test("a single turn alone over the cap is still kept whole (nothing left to drop) — outcomes are files, none is lost", () => {
  const messages = bigTurn(1, 2_000_000);
  const { messages: kept, droppedAnyTurn } = capConversationSize(messages, CONVERSATION_BYTE_CAP);
  assert.deepEqual(kept, messages);
  assert.equal(droppedAnyTurn, false, "nothing was actually dropped — one turn is the whole array");
});

test("prepareConversationForSave composes sanitize then cap", () => {
  const messages = [
    ...bigTurn(1, 5),
    msg("user", [{ type: "text", text: "final" }], { id: "u2", metadata: { origin: "typed" } }),
    msg("assistant", [{ type: "tool-read_file", toolCallId: "t1", state: "output-available", input: {}, output: { a: "y".repeat(3000) } }], { id: "a2" }),
  ];
  const { messages: prepared } = prepareConversationForSave(messages);
  const toolPart = (prepared.find((m: any) => m.id === "a2") as any).parts[0];
  assert.equal(toolPart.output.a, stubFor(3000), "the sanitizer ran");
});
