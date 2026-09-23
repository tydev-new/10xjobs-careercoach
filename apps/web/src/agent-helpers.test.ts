// Unit tests for the pure helpers (docs/design-web-agent.md § 3, § 6.1,
// § 6.2). Run with `node --test src/agent-helpers.test.ts` (Node 25's
// native TypeScript support — no ts-node/build step needed).
import assert from "node:assert/strict";
import test from "node:test";
import { matchGateReply, parsePlanTodo, statusOf } from "./agent-helpers.ts";
import type { AppMessage } from "./types.ts";

// ---------------------------------------------------------------------
// matchGateReply — C § 3's own table.
// ---------------------------------------------------------------------

test("matchGateReply: exact typed yes/Yes./YES! approve", () => {
  assert.equal(matchGateReply("yes", "typed"), "approve");
  assert.equal(matchGateReply("Yes.", "typed"), "approve");
  assert.equal(matchGateReply("YES!", "typed"), "approve");
  assert.equal(matchGateReply("  yes  ", "typed"), "approve");
});

test("matchGateReply: yes but / y / sure / pasted-yes do not approve", () => {
  assert.equal(matchGateReply("yes but", "typed"), "none");
  assert.equal(matchGateReply("y", "typed"), "none");
  assert.equal(matchGateReply("sure", "typed"), "none");
  assert.equal(matchGateReply("ok here's the thing, yes I guess", "typed"), "none");
  assert.equal(matchGateReply("yes!!", "typed"), "none"); // more than one trailing mark
});

test("matchGateReply: a ui-origin yes does not approve", () => {
  assert.equal(matchGateReply("yes", "ui"), "none");
});

test("matchGateReply: exact no/don't/cancel/stop decline", () => {
  for (const word of ["no", "don't", "cancel", "stop", "No.", "STOP!"]) {
    assert.equal(matchGateReply(word, "typed"), "decline");
  }
});

test("matchGateReply: anything else leaves the gate open", () => {
  assert.equal(matchGateReply("maybe later", "typed"), "none");
  assert.equal(matchGateReply("", "typed"), "none");
});

// ---------------------------------------------------------------------
// parsePlanTodo — C § 6.2.
// ---------------------------------------------------------------------

test("parsePlanTodo: numbered and dash bullets, with and without a backticked path", () => {
  const md = [
    "Goal: an offer",
    "",
    "## Board",
    "",
    "Waiting on you",
    "",
    "To do",
    "- Send the letter (`applications/x.md`) — 5 min",
    "1. Submit the application (`applications/y.md`) — 10 min",
    "* Keep looking for more roles — 2 min",
    "",
    "Doing",
    "",
    "Done",
  ].join("\n");
  const items = parsePlanTodo(md);
  assert.deepEqual(items, [
    { text: "Send the letter (`applications/x.md`) — 5 min", ref: "applications/x.md" },
    { text: "Submit the application (`applications/y.md`) — 10 min", ref: "applications/y.md" },
    { text: "Keep looking for more roles — 2 min" },
  ]);
});

test("parsePlanTodo: stops at the next board heading, never reorders", () => {
  const md = "To do\n- one\n- two\n\nDoing\n- should not appear\n";
  const items = parsePlanTodo(md);
  assert.deepEqual(items.map((i) => i.text), ["one", "two"]);
});

test("parsePlanTodo: no 'To do' section returns empty", () => {
  assert.deepEqual(parsePlanTodo("Goal: x\n\n## Board\n\nDoing\n"), []);
});

// ---------------------------------------------------------------------
// statusOf — C § 6.1's five states, first match wins.
// ---------------------------------------------------------------------

function userMsg(text: string): AppMessage {
  return { id: "u1", role: "user", parts: [{ type: "text", text }] } as AppMessage;
}

function assistantMsg(parts: unknown[]): AppMessage {
  return { id: "a1", role: "assistant", parts } as AppMessage;
}

test("statusOf: idle when no turn has run", () => {
  assert.deepEqual(statusOf([], "ready"), { state: "idle" });
});

test("statusOf: working when streaming and the latest part is an unfinished tool part", () => {
  const messages = [
    userMsg("hi"),
    assistantMsg([{ type: "tool-bash", state: "input-available", input: {} }]),
  ];
  assert.deepEqual(statusOf(messages, "streaming"), { state: "working", action: "running a checker" });
});

test("statusOf: thinking when submitted, or streaming with a non-tool latest part", () => {
  const messages = [userMsg("hi"), assistantMsg([{ type: "text", text: "..." }])];
  assert.deepEqual(statusOf(messages, "submitted"), { state: "thinking" });
  assert.deepEqual(statusOf(messages, "streaming"), { state: "thinking" });
});

test("statusOf: needs-you when ready and a gate is pending, action is the gate's label", () => {
  const messages = [
    userMsg("evaluate please"),
    assistantMsg([
      {
        type: "data-gate",
        data: { gateId: "g1", label: "evaluate 6 roles", kind: "spend" },
      },
      { type: "data-gate-status", data: { gateId: "g1", status: "pending" } },
    ]),
  ];
  assert.deepEqual(statusOf(messages, "ready"), { state: "needs-you", action: "evaluate 6 roles" });
});

test("statusOf: done once ready after the gate is approved", () => {
  const messages = [
    userMsg("evaluate please"),
    assistantMsg([
      { type: "data-gate", data: { gateId: "g1", label: "evaluate 6 roles", kind: "spend" } },
      { type: "data-gate-status", data: { gateId: "g1", status: "pending" } },
    ]),
    userMsg("yes"),
    assistantMsg([{ type: "data-gate-status", data: { gateId: "g1", status: "approved" } }]),
  ];
  assert.deepEqual(statusOf(messages, "ready"), { state: "done" });
});

test("statusOf: done after ready or error with at least one turn", () => {
  const messages = [userMsg("hi"), assistantMsg([{ type: "text", text: "done" }])];
  assert.deepEqual(statusOf(messages, "ready"), { state: "done" });
  assert.deepEqual(statusOf(messages, "error"), { state: "done" });
});
