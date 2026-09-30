// readPlanBoard / splitPlanMinutes / budgetMinutesPerDay — docs/design-web-agent.md
// § 18 and § 18.1 (amended 2026-09-26). Coder-owned: derived from the
// contract, not from the implementation.
import assert from "node:assert/strict";
import test from "node:test";

import { budgetMinutesPerDay, readPlanBoard, splitPlanMinutes } from "../src/plan-board.ts";
import { parsePlanTodo } from "../src/helpers.ts";
import { waitingRows } from "../../../skills/coach/scripts/lib/check-closeout.mjs";
import { universalNewlines } from "../../../skills/profile/scripts/lib/py-text.mjs";

function sectionOf(md: string, label: "Waiting on you" | "To do" | "Doing" | "Done") {
  return readPlanBoard(md).sections.find((s) => s.label === label);
}

// ---------------------------------------------------------------- head lines

test("readPlanBoard: goalLine/budgetLine, word for word, with an optional H1 title above them", () => {
  const md = ["# Plan — Alex Chen", "Goal: an offer by 2026-11-01.", "Budget: 60 min/day floor.", "", "## Board", ""].join("\n");
  const board = readPlanBoard(md);
  assert.equal(board.goalLine, "Goal: an offer by 2026-11-01.");
  assert.equal(board.budgetLine, "Budget: 60 min/day floor.");
});

test("readPlanBoard: no Goal/Budget line -> both undefined", () => {
  const board = readPlanBoard("## Board\n\nTo do\n- x\n");
  assert.equal(board.goalLine, undefined);
  assert.equal(board.budgetLine, undefined);
});

test("readPlanBoard: Goal/Budget after the first ## heading is not read", () => {
  const md = "## Board\n\nGoal: too late\nBudget: too late\n";
  const board = readPlanBoard(md);
  assert.equal(board.goalLine, undefined);
  assert.equal(board.budgetLine, undefined);
});

test("readPlanBoard: no board at all -> no sections, head lines still read", () => {
  const board = readPlanBoard("Goal: x\nBudget: 30 min/day\n");
  assert.deepEqual(board.sections, []);
  assert.equal(board.goalLine, "Goal: x");
});

// ---------------------------------------------------------------- board labels

test("readPlanBoard: 'to do' (lower case) is not a label (case-sensitive)", () => {
  const md = "## Board\n\nto do\n- x\n";
  assert.equal(sectionOf(md, "To do"), undefined);
});

test("readPlanBoard: '  To do' (indented) is not a label", () => {
  const md = "## Board\n\n  To do\n- x\n";
  assert.equal(sectionOf(md, "To do"), undefined);
});

test("readPlanBoard: 'To do (2)' and 'To do:' are labels", () => {
  for (const heading of ["To do (2)", "To do:", "To do list"]) {
    const md = `## Board\n\n${heading}\n- x\n`;
    const s = sectionOf(md, "To do");
    assert.ok(s, `${heading} should be a label`);
    assert.equal(s!.items.length, 1);
  }
});

test("readPlanBoard: each of the four labels", () => {
  const md = ["## Board", "", "Waiting on you", "- w1", "", "To do", "- t1", "", "Doing", "- d1", "", "Done", "- z1"].join("\n");
  const board = readPlanBoard(md);
  assert.deepEqual(board.sections.map((s) => s.label), ["Waiting on you", "To do", "Doing", "Done"]);
  assert.equal(sectionOf(md, "Doing")!.items[0].text, "d1");
  assert.equal(sectionOf(md, "Done")!.items[0].text, "z1");
});

test("readPlanBoard: a label missing from the file is simply absent from sections", () => {
  const board = readPlanBoard("## Board\n\nTo do\n- x\n");
  assert.deepEqual(board.sections.map((s) => s.label), ["To do"]);
});

test("readPlanBoard: CRLF file, To do items word for word (no trailing CR)", () => {
  const md = "## Board\r\n\r\nTo do\r\n- Send it — 5 min\r\n\r\nDoing\r\n";
  assert.deepEqual(sectionOf(md, "To do")!.items, [{ text: "Send it — 5 min" }]);
});

// ---------------------------------------------------------------- section boundaries

test("readPlanBoard: a section ends at the next board label", () => {
  const md = "To do\n- a\n- b\n\nDoing\n- should not appear\n";
  assert.deepEqual(sectionOf(md, "To do")!.items.map((i) => i.text), ["a", "b"]);
});

test("readPlanBoard: a section ends at a line starting '#' when there is no next label", () => {
  const md = "## Board\n\nTo do\n- a\n- b\n## Queue\n- queued thing\n";
  assert.deepEqual(sectionOf(md, "To do")!.items.map((i) => i.text), ["a", "b"]);
});

test("readPlanBoard: Done ends at a later ## heading (own-section fixture)", () => {
  const md = [
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
  assert.deepEqual(sectionOf(md, "Done")!.items.map((i) => i.text), ["Wrote base-resume.md"]);
  assert.deepEqual(sectionOf(md, "Waiting on you")!.items.map((i) => i.text), ["Pick a salary floor — see `profile.md`"]);
});

// ---------------------------------------------------------------- To do / Doing / Done grammar

test("readPlanBoard: bullet kinds — numbered, dash, star, bullet, INDENTED (new vs. old parsePlanTodo)", () => {
  const md = ["To do", "1. one", "- two", "* three", "• four", "  - five (indented)"].join("\n");
  assert.deepEqual(sectionOf(md, "To do")!.items.map((i) => i.text), ["one", "two", "three", "four", "five (indented)"]);
});

test("readPlanBoard: a non-bullet line AFTER the first item joins as a continuation, never ends the section", () => {
  const md = ["To do", "- item1", "Later", "- item2"].join("\n");
  assert.deepEqual(sectionOf(md, "To do")!.items.map((i) => i.text), ["item1 Later", "item2"]);
});

test("readPlanBoard: a non-bullet line BEFORE the first item is unreadable; later items still read", () => {
  const md = ["To do", "some prose", "- item1"].join("\n");
  const s = sectionOf(md, "To do")!;
  assert.deepEqual(s.unreadable, ["some prose"]);
  assert.deepEqual(s.items.map((i) => i.text), ["item1"]);
});

test("readPlanBoard: blank lines are skipped, both before and after the first item", () => {
  const md = ["To do", "", "- item1", "", "- item2", ""].join("\n");
  assert.deepEqual(sectionOf(md, "To do")!.items.map((i) => i.text), ["item1", "item2"]);
});

test("readPlanBoard: ref = first backticked WORKSPACE path, skipping a non-path code span", () => {
  const md = "To do\n- Reply `keep` or `cut` on the list in `applications/acme.md` — 3 min\n";
  assert.equal(sectionOf(md, "To do")!.items[0].ref, "applications/acme.md");
});

test("readPlanBoard: an empty To do section (label present, no items) -> [] items, [] unreadable", () => {
  const md = "To do\n\nDoing\n- x\n";
  assert.deepEqual(sectionOf(md, "To do"), { label: "To do", items: [], unreadable: [] });
});

// ---------------------------------------------------------------- Waiting on you (reuses waitingRows)

test("readPlanBoard: Waiting on you reuses waitingRows verbatim (a normal case)", () => {
  const md = "## Board\nWaiting on you\n- the comp floor — criteria.md\n- café visit\nTo do\n- x\n";
  const text = universalNewlines(md);
  const expected = (waitingRows(text) as string[]);
  assert.deepEqual(sectionOf(md, "Waiting on you")!.items.map((i) => i.text), expected);
  assert.ok(expected.length > 0);
});

test("readPlanBoard: a Waiting-on-you label form waitingRows' own pattern rejects ('Waiting on you (1)') -> unreadable, not silently empty", () => {
  const md = "## Board\nWaiting on you (1)\n- comp floor\n\nTo do\n- x\n";
  const s = sectionOf(md, "Waiting on you")!;
  assert.deepEqual(s.items, []);
  assert.deepEqual(s.unreadable, ["- comp floor"]);
});

test("readPlanBoard: Waiting on you present but truly empty (no non-blank lines) -> [] items, [] unreadable", () => {
  const md = "## Board\nWaiting on you\n\nTo do\n- x\n";
  assert.deepEqual(sectionOf(md, "Waiting on you"), { label: "Waiting on you", items: [], unreadable: [] });
});

// ---------------------------------------------------------------- parity with waitingRows over real corpus text
// (design-web-agent.md § 18, "Proved by": readPlanBoard's Waiting on you
// texts equal waitingRows(universalNewlines(text)) for check_closeout
// corpus plan.md's — these four are lifted verbatim from
// tests/checkers-parity/extra.mjs, including the named r2-cc-lone-cr-plan
// and r2-cc-bom-waiting cases.)

const COACH_CORPUS_PLANS = [
  "Goal: x\n\n## Board\nWaiting on you\n- the comp floor — criteria.md\n- café visit to Montréal\nTo do\n- review the letter\n",
  "## Board\rWaiting on you\r- the comp floor\r  continued row\rTo do\r- x\r", // r2-cc-lone-cr-plan
  "## Board\n﻿Waiting on you\n- comp floor\n", // r2-cc-bom-waiting
  "## Board\nWaiting on you\n\x85- comp floor\x85\n  \x1c\nTo do\n- x\n", // r3-cc-nel-rows
];

for (const [i, plan] of COACH_CORPUS_PLANS.entries()) {
  test(`readPlanBoard parity with waitingRows: corpus plan #${i}`, () => {
    const text = universalNewlines(plan);
    const expected = waitingRows(text) as string[];
    const got = (sectionOf(plan, "Waiting on you")?.items ?? []).map((it) => it.text);
    assert.deepEqual(got, expected);
  });
}

// ---------------------------------------------------------------- parsePlanTodo re-expressed through readPlanBoard

test("parsePlanTodo(md) === readPlanBoard(md)'s To do items, or [] when absent", () => {
  const md = "## Board\n\nWaiting on you\n- w\n\nTo do\n- Send it (`applications/x.md`) — 5 min\n";
  assert.deepEqual(parsePlanTodo(md), sectionOf(md, "To do")!.items);
  assert.deepEqual(parsePlanTodo("## Board\n\nDoing\n- x\n"), []);
});

// ---------------------------------------------------------------- splitPlanMinutes (§ 18.1)

const SPLIT_ROUND_TRIP: string[] = [
  "Send the Acme cover letter (`applications/acme-letter.md`) — 5 min — checks are clean",
  "Submit the Acme application yourself — 10 min — I have no submit tool",
  "Review `jd-analysis/beta.md` then `company/beta.md` — 15 min — why: strongest lead",
  "a — 10 min", // ends with the match, no why
];

for (const text of SPLIT_ROUND_TRIP) {
  test(`splitPlanMinutes: round trip holds — ${JSON.stringify(text)}`, () => {
    const split = splitPlanMinutes(text);
    assert.ok(split, "expected a split");
    const rebuilt = split!.action + " — " + split!.minutes + " min" + (split!.why === undefined ? "" : " — " + split!.why);
    assert.equal(rebuilt, text);
  });
}

const SPLIT_UNDEFINED: Array<[string, string]> = [
  ["5 minutes (not 'min')", "a — 5 minutes"],
  ["5-10 min (a range)", "a — 5-10 min"],
  [" - 5 min - (hyphen, not em dash)", "a - 5 min -"],
  ["en dash instead of em dash", "a – 5 min"],
  ["two matches", "a — 5 min — b — 10 min"],
  ["0 min (no leading zero rule / non-zero start)", "a — 0 min"],
  ["05 min (leading zero)", "a — 05 min"],
  ["1000 min (over 999)", "a — 1000 min"],
  ["no minutes at all", "just a plain line"],
  ["blank text before the match", " — 5 min"],
];

for (const [name, text] of SPLIT_UNDEFINED) {
  test(`splitPlanMinutes: undefined — ${name}`, () => {
    assert.equal(splitPlanMinutes(text), undefined);
  });
}

test("splitPlanMinutes: exact fields on a normal case", () => {
  const split = splitPlanMinutes("Send it — 5 min — because reasons");
  assert.deepEqual(split, { action: "Send it", minutes: 5, why: "because reasons" });
});

test("splitPlanMinutes: no why when the match ends the text", () => {
  const split = splitPlanMinutes("Send it — 5 min");
  assert.deepEqual(split, { action: "Send it", minutes: 5 });
  assert.equal("why" in split!, false);
});

// ---------------------------------------------------------------- budgetMinutesPerDay (§ 18.1)

const BUDGET_TABLE: Array<[string | undefined, number | undefined]> = [
  ["Budget: 45 min/day", 45],
  ["Budget: 60 min/day floor.", 60],
  ["Budget: 30 min per session, 3x a week", undefined],
  ["Budget: 45 min a day", undefined],
  ["Budget:45min/day", 45],
  [undefined, undefined],
];

for (const [line, want] of BUDGET_TABLE) {
  test(`budgetMinutesPerDay(${JSON.stringify(line)}) -> ${want}`, () => {
    assert.equal(budgetMinutesPerDay(line), want);
  });
}
