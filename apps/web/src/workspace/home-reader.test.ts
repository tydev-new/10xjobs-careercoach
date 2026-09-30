// Home's own readers (design-web-ui.md § 5.3, "Ten's last reply" / "The
// minutes sum"). Coder-owned: derived from the contract.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlanBoardSection } from "../../../../packages/agent/src/plan-board.ts";
import type { AppMessage } from "../types.ts";
import { activityLinesFor, cutQuote, lastReply, minutesSum } from "./home-reader.ts";

type M = { id: string; role: "user" | "assistant"; parts: unknown[] };
const user = (id: string): M => ({ id, role: "user", parts: [{ type: "text", text: "hi" }] });
const asst = (id: string, parts: unknown[]): M => ({ id, role: "assistant", parts });
const txt = (t: string) => ({ type: "text", text: t });
const tool = (name: string, state = "output-available") => ({ type: `tool-${name}`, toolCallId: `c-${name}`, state, input: {} });
const asMessages = (msgs: M[]) => msgs as unknown as AppMessage[];

// ---------------------------------------------------------------- cutQuote

test("cutQuote: a plain reply under 280 code points is trimmed, unchanged", () => {
  assert.equal(cutQuote("  hello there  "), "hello there");
});

test("cutQuote: over 280 code points — cut at the last whitespace at or before 280, then '…'", () => {
  const raw = "word ".repeat(60).trimEnd(); // 299 chars, whitespace throughout
  const cut = cutQuote(raw);
  assert.ok(cut.endsWith("…"));
  const kept = cut.slice(0, -1);
  assert.ok(raw.startsWith(kept), "the shown text minus … is a prefix of the part");
  assert.ok(kept.length <= 280);
  // ends right before whitespace (or at the very end of the prefix)
  const nextChar = raw[kept.length];
  assert.ok(nextChar === undefined || /\s/.test(nextChar));
});

test("cutQuote: 300 code points with no whitespace at all -> the first 280 and '…'", () => {
  const raw = "a".repeat(300);
  assert.equal(cutQuote(raw), "a".repeat(280) + "…");
});

test("cutQuote: exactly 280 code points is not cut", () => {
  const raw = "a".repeat(280);
  assert.equal(cutQuote(raw), raw);
});

// ---------------------------------------------------------------- activityLinesFor

test("activityLinesFor: one line per tool group, prefix included, in order — no tool parts, no line", () => {
  const msg = asst("a1", [txt("before"), tool("web_search"), tool("web_search"), txt("after"), tool("bash")]);
  assert.deepEqual(activityLinesFor(msg as unknown as AppMessage), ["ran web search ×2", "ran bash"]);
});

test("activityLinesFor: a message with no tool parts contributes no line", () => {
  assert.deepEqual(activityLinesFor(asst("a1", [txt("just text")]) as unknown as AppMessage), []);
});

// ---------------------------------------------------------------- lastReply

test("lastReply: a plain qualifying reply, status ready", () => {
  const r = lastReply(asMessages([user("u1"), asst("a1", [tool("bash"), txt("Here is the verdict.")])]), "ready");
  assert.deepEqual(r, { quote: "Here is the verdict.", activityLines: ["ran bash"] });
});

test("lastReply: no message qualifies -> undefined", () => {
  assert.equal(lastReply(asMessages([]), "ready"), undefined);
  assert.equal(lastReply(asMessages([user("u1")]), "ready"), undefined);
});

test("lastReply: a user message comes after the latest reply -> undefined", () => {
  const msgs = asMessages([user("u1"), asst("a1", [txt("an old reply")]), user("u2")]);
  assert.equal(lastReply(msgs, "ready"), undefined);
});

test("lastReply: a data-error part on the candidate message -> undefined", () => {
  const msgs = asMessages([user("u1"), asst("a1", [txt("partial work"), { type: "data-error", data: { code: "tool_error" } }])]);
  assert.equal(lastReply(msgs, "ready"), undefined);
});

test("lastReply: status error -> undefined, even with an otherwise-qualifying reply", () => {
  const msgs = asMessages([user("u1"), asst("a1", [txt("a reply")])]);
  assert.equal(lastReply(msgs, "error"), undefined);
});

for (const running of ["submitted", "streaming"] as const) {
  test(`lastReply: status ${running} (a turn is running) -> undefined`, () => {
    const msgs = asMessages([user("u1"), asst("a1", [txt("a reply")])]);
    assert.equal(lastReply(msgs, running), undefined);
  });
}

test("lastReply: a last text part that is only whitespace — the one before it is quoted", () => {
  const msgs = asMessages([user("u1"), asst("a1", [txt("the real reply"), txt("   ")])]);
  assert.equal(lastReply(msgs, "ready")?.quote, "the real reply");
});

test("lastReply: a reconcile-style message (data parts only, no text) is skipped — the real reply before it still shows", () => {
  const msgs = asMessages([
    user("u1"),
    asst("a1", [txt("the real reply")]),
    asst("gate-reconcile-1", [{ type: "data-gate-status", data: { gateId: "g", status: "expired" } }]),
  ]);
  assert.equal(lastReply(msgs, "ready")?.quote, "the real reply");
});

test("lastReply: an assistant message with no text part at all -> undefined (nothing else qualifies)", () => {
  const msgs = asMessages([user("u1"), asst("a1", [{ type: "data-gate-status", data: { gateId: "g", status: "expired" } }])]);
  assert.equal(lastReply(msgs, "ready"), undefined);
});

// ---------------------------------------------------------------- minutesSum

function section(items: Array<{ text: string; ref?: string }>, unreadable: string[] = []): PlanBoardSection {
  return { label: "To do", items, unreadable };
}

test("minutesSum: every item carries minutes, budget is per day -> N and M", () => {
  const s = section([{ text: "a — 5 min" }, { text: "b — 10 min" }]);
  assert.deepEqual(minutesSum(s, "Budget: 45 min/day"), { n: 15, m: 45 });
});

test("minutesSum: one item without minutes -> no sum", () => {
  const s = section([{ text: "a — 5 min" }, { text: "b, no minutes here" }]);
  assert.equal(minutesSum(s, "Budget: 45 min/day"), undefined);
});

test("minutesSum: a per-session budget line -> no sum", () => {
  const s = section([{ text: "a — 5 min" }]);
  assert.equal(minutesSum(s, "Budget: 30 min per session, 3x a week"), undefined);
});

test("minutesSum: 'Budget: 60 min/day floor.' sums", () => {
  const s = section([{ text: "a — 20 min" }, { text: "b — 40 min" }]);
  assert.deepEqual(minutesSum(s, "Budget: 60 min/day floor."), { n: 60, m: 60 });
});

test("minutesSum: N greater than M is shown as is (no warning style, no clamping)", () => {
  const s = section([{ text: "a — 50 min" }, { text: "b — 40 min" }]);
  assert.deepEqual(minutesSum(s, "Budget: 45 min/day"), { n: 90, m: 45 });
});

test("minutesSum: no To do section, or no items, or unreadable lines present -> no sum", () => {
  assert.equal(minutesSum(undefined, "Budget: 45 min/day"), undefined);
  assert.equal(minutesSum(section([]), "Budget: 45 min/day"), undefined);
  assert.equal(minutesSum(section([{ text: "a — 5 min" }], ["stray prose"]), "Budget: 45 min/day"), undefined);
});
