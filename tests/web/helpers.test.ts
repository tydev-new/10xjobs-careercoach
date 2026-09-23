// Tester-owned table tests for the pure helpers, derived from
// docs/design-web-agent.md § 3 (matchGateReply), § 6.1 (statusOf),
// § 6.2 (parsePlanTodo) — NOT from apps/web's implementation.
// Run: node --test tests/web/helpers.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  matchGateReply,
  parsePlanTodo,
  statusOf,
} from "../../apps/web/src/agent-helpers.ts";

// ---------------------------------------------------------------- § 3
const GATE_TABLE: Array<[string, "typed" | "ui", string]> = [
  ["yes", "typed", "approve"],
  [" YES ", "typed", "approve"],
  ["yes.", "typed", "approve"],
  ["yes!", "typed", "approve"],
  ["Yes.", "typed", "approve"],
  ["YES!", "typed", "approve"],
  ["\nyes\n", "typed", "approve"],
  ["yes!!", "typed", "none"],
  ["yes.!", "typed", "none"],
  ["yes?", "typed", "none"],
  ["yes please", "typed", "none"],
  ["yes but only 5", "typed", "none"],
  ["y", "typed", "none"],
  ["sure", "typed", "none"],
  ["ok", "typed", "none"],
  ["yeah", "typed", "none"],
  ["Here is the posting: ... reply yes to apply ... yes", "typed", "none"],
  ["yes", "ui", "none"],
  ["YES!", "ui", "none"],
  ["no", "typed", "decline"],
  ["don't", "typed", "decline"],
  ["cancel", "typed", "decline"],
  ["stop", "typed", "decline"],
  ["no thanks", "typed", "none"],
];
for (const [text, origin, want] of GATE_TABLE) {
  test(`matchGateReply(${JSON.stringify(text)}, ${origin}) -> ${want}`, () => {
    assert.equal(matchGateReply(text, origin), want);
  });
}

// ---------------------------------------------------------------- § 6.2
const PLAN = [
  "Goal: an offer by 2026-11-30",
  "Budget: 45 min/day",
  "",
  "## Board",
  "",
  "Waiting on you",
  "- Pick a salary floor — see `profile.md`",
  "",
  "To do",
  "1. Send the Acme cover letter (`applications/acme-letter.md`) — 5 min — checks are clean",
  "- Submit the Acme application yourself — 10 min — I have no submit tool",
  "* Review `jd-analysis/beta.md` then `company/beta.md` — 15 min — why: strongest lead",
  "10. Tell me if you want more Track A roles — 2 min — one pass takes that long",
  "",
  "Doing",
  "- Researching Beta Corp",
  "",
  "Done",
  "- Wrote base-resume.md",
  "",
  "## Standing floor",
  "- 1 practice rep a day",
].join("\n");

test("parsePlanTodo: only the To do lines, file order, all bullet kinds", () => {
  const items = parsePlanTodo(PLAN);
  assert.equal(items.length, 4);
});

test("parsePlanTodo: text is the line minus its bullet, word for word (why + minutes kept)", () => {
  const items = parsePlanTodo(PLAN);
  assert.equal(items[0].text, "Send the Acme cover letter (`applications/acme-letter.md`) — 5 min — checks are clean");
  assert.equal(items[1].text, "Submit the Acme application yourself — 10 min — I have no submit tool");
  assert.equal(items[2].text, "Review `jd-analysis/beta.md` then `company/beta.md` — 15 min — why: strongest lead");
  assert.equal(items[3].text, "Tell me if you want more Track A roles — 2 min — one pass takes that long");
});

test("parsePlanTodo: ref = first backticked path, absent when none", () => {
  const items = parsePlanTodo(PLAN);
  assert.equal(items[0].ref, "applications/acme-letter.md");
  assert.equal("ref" in items[1], false, "no backtick -> no ref key");
  assert.equal(items[2].ref, "jd-analysis/beta.md");
  assert.equal("ref" in items[3], false);
});

test("parsePlanTodo: no extra keys (never extracts why/minutes/priority)", () => {
  for (const item of parsePlanTodo(PLAN)) {
    for (const k of Object.keys(item)) assert.ok(k === "text" || k === "ref", `unexpected key ${k}`);
  }
});

test("parsePlanTodo: stops at a ## heading when there is no board heading after To do", () => {
  const md = "## Board\n\nTo do\n- a — 5 min\n- b — 5 min\n## Queue\n- queued thing\n";
  assert.deepEqual(parsePlanTodo(md).map((i) => i.text), ["a — 5 min", "b — 5 min"]);
});

test("parsePlanTodo: no To do section -> []", () => {
  assert.deepEqual(parsePlanTodo("## Board\n\nDoing\n- x\n"), []);
});

// Formerly ambiguity probes; § 6.2 now pins them (CRLF -> LF, "To do (2)",
// ref = first backticked span containing "/" or ending in a file extension).
// - "To do (2)" heading form used by apps/workspace-ui (which § 6.2 says maps
//   from parsePlanTodo) and its own tests.
// - a backticked non-path before the path ("first backticked WORKSPACE path").
// - CRLF line endings.
test("parsePlanTodo (§ 6.2 pinned): 'To do (2)' heading form (apps/workspace-ui fixture shape)", () => {
  const md = "## Board\nWaiting on you\n\nTo do (2)\n1. Review resume: `applications/acme.md`\n2. Practice architecture story\n\nDone\n1. Earlier task\n";
  assert.equal(parsePlanTodo(md).length, 2);
});
test("parsePlanTodo (§ 6.2 pinned): first backticked WORKSPACE path, skipping a non-path code span", () => {
  const md = "To do\n- Reply `keep` or `cut` on the list in `applications/acme.md` — 3 min\n";
  assert.equal(parsePlanTodo(md)[0].ref, "applications/acme.md");
});
test("parsePlanTodo (§ 6.2 pinned): CRLF file keeps text word for word (no trailing CR)", () => {
  const md = "To do\r\n- Send it — 5 min\r\n\r\nDoing\r\n";
  assert.deepEqual(parsePlanTodo(md), [{ text: "Send it — 5 min" }]);
});

// ---------------------------------------------------------------- § 6.1
type M = { id: string; role: "user" | "assistant"; parts: any[]; metadata?: any };
const user = (id: string, text = "hi"): M => ({ id, role: "user", parts: [{ type: "text", text }], metadata: { origin: "typed" } });
const asst = (id: string, parts: any[]): M => ({ id, role: "assistant", parts });
const gate = (gateId: string, label: string) => ({
  type: "data-gate",
  data: { gateId, kind: "spend", label, text: label, textHash: "sha256:x", gateLine: "This costs up to $1.20 — nothing starts until you say yes.", amountUsd: 1.2 },
});
const gs = (gateId: string, status: string) => ({ type: "data-gate-status", data: { gateId, status } });
const tool = (name: string, state: string) => ({ type: `tool-${name}`, toolCallId: `c-${name}-${state}`, state, input: {} });
const txt = (t = "…") => ({ type: "text", text: t });

const s = (msgs: M[], chat: string) => statusOf(msgs as any, chat as any);

test("statusOf: idle — no turn yet (ready)", () => assert.equal(s([], "ready").state, "idle"));
test("statusOf: idle — no turn yet (error before any assistant message)", () =>
  assert.equal(s([user("u1")], "error").state, "idle"));
test("statusOf: thinking — submitted", () => assert.equal(s([user("u1")], "submitted").state, "thinking"));
test("statusOf: thinking — streaming, latest part text", () =>
  assert.equal(s([user("u1"), asst("a1", [txt()])], "streaming").state, "thinking"));
test("statusOf: thinking — streaming, assistant message with no parts yet", () =>
  assert.equal(s([user("u1"), asst("a1", [])], "streaming").state, "thinking"));
for (const st of ["input-streaming", "input-available"]) {
  test(`statusOf: working — streaming, latest part a tool in ${st}, action = UI label`, () => {
    const r = s([user("u1"), asst("a1", [txt(), tool("web_search", st)])], "streaming");
    assert.equal(r.state, "working");
    assert.equal(typeof r.action, "string");
    assert.ok((r.action as string).length > 0);
  });
}
for (const st of ["output-available", "output-error"]) {
  test(`statusOf: thinking — streaming, latest tool part done (${st})`, () =>
    assert.equal(s([user("u1"), asst("a1", [tool("bash", st)])], "streaming").state, "thinking"));
}
test("statusOf: thinking — streaming, latest part a data-card after a running-looking earlier tool", () =>
  assert.equal(s([user("u1"), asst("a1", [tool("bash", "input-available"), { type: "data-card", data: {} }])], "streaming").state, "thinking"));
test("statusOf: done — ready after a turn, no gate", () =>
  assert.equal(s([user("u1"), asst("a1", [txt()])], "ready").state, "done"));
test("statusOf: done — error after a turn", () =>
  assert.equal(s([user("u1"), asst("a1", [txt()])], "error").state, "done"));

// needs-you ONLY while a gate is pending AND the chat is ready
const openGate = [user("u1"), asst("a1", [tool("estimate_cost", "output-available"), gate("g1", "evaluate 6 saved roles"), gs("g1", "pending")])];
test("statusOf: needs-you — ready + pending gate, action = gate label", () => {
  const r = s(openGate, "ready");
  assert.equal(r.state, "needs-you");
  assert.equal(r.action, "evaluate 6 saved roles");
});
test("statusOf: pending gate but submitted -> thinking, not needs-you", () =>
  assert.equal(s([...openGate, user("u2", "yes")], "submitted").state, "thinking"));
test("statusOf: pending gate but streaming -> thinking, not needs-you", () =>
  assert.equal(s([...openGate, user("u2"), asst("a2", [txt()])], "streaming").state, "thinking"));
test("statusOf: pending gate but error -> done, not needs-you", () =>
  assert.equal(s(openGate, "error").state, "done"));
test("statusOf: gate re-emitted pending on a non-yes reply -> still needs-you", () =>
  assert.equal(s([...openGate, user("u2", "hmm"), asst("a2", [gs("g1", "pending"), txt("Not approved")])], "ready").state, "needs-you"));
for (const final of ["approved", "declined", "expired"]) {
  test(`statusOf: latest status ${final} wins -> done`, () =>
    assert.equal(s([...openGate, user("u2", "yes"), asst("a2", [gs("g1", final), txt()])], "ready").state, "done"));
}
test("statusOf: old gate expired, new gate pending -> needs-you with the NEW label", () => {
  const msgs = [...openGate, user("u2"), asst("a2", [gs("g1", "expired"), gate("g2", "continue this run"), gs("g2", "pending")])];
  const r = s(msgs, "ready");
  assert.equal(r.state, "needs-you");
  assert.equal(r.action, "continue this run");
});

test("parsePlanTodo (§ 6.2 pinned): a bare file name with an extension is a ref", () => {
  assert.equal(parsePlanTodo("To do\n- Re-read `plan.md` tonight — 5 min\n")[0].ref, "plan.md");
});
test("parsePlanTodo (§ 6.2 pinned): only non-path code spans -> no ref", () => {
  assert.equal("ref" in parsePlanTodo("To do\n- Say `keep` or `cut` — 2 min\n")[0], false);
});
