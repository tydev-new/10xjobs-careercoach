// readPlanBoard/splitPlanMinutes/budgetMinutesPerDay over the shared
// § 5.7 page fixture (apps/web/fixtures/workspace-pages.json) — real
// plan.md content, not hand-built strings: a Budget: 45 min/day line, To
// do lines in C § 18.1's strict form PLUS one line with no minutes (so
// the minutes sum must not show), a Waiting-on-you line with a
// backticked ref and one without, and the NovaGrid lines moved to Done
// (fixture update at 1e58518 — NovaGrid reaches Applied only after the
// candidate says they sent it).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { budgetMinutesPerDay, readPlanBoard, splitPlanMinutes } from "../src/plan-board.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(join(HERE, "../../../apps/web/fixtures/workspace-pages.json"), "utf8"),
);
const PLAN_MD: string = FIXTURE.files["plan.md"];

test("workspace-pages fixture: goalLine/budgetLine read word for word", () => {
  const board = readPlanBoard(PLAN_MD);
  assert.equal(board.goalLine, "Goal: an offer by 2026-12-15");
  assert.equal(board.budgetLine, "Budget: 45 min/day");
  assert.equal(budgetMinutesPerDay(board.budgetLine), 45);
});

test("workspace-pages fixture: Waiting on you has one line with a ref and one without", () => {
  const waiting = readPlanBoard(PLAN_MD).sections.find((s) => s.label === "Waiting on you");
  assert.ok(waiting);
  assert.equal(waiting!.items.length, 2);
  assert.equal(waiting!.items[0].ref, "jd-analysis/fernway-senior-pm.md");
  assert.equal("ref" in waiting!.items[1], false);
  assert.deepEqual(waiting!.unreadable, []);
});

test("workspace-pages fixture: To do has 2 lines with minutes and ONE without", () => {
  const toDo = readPlanBoard(PLAN_MD).sections.find((s) => s.label === "To do");
  assert.ok(toDo);
  assert.equal(toDo!.items.length, 3);
  const splits = toDo!.items.map((i) => splitPlanMinutes(i.text));
  assert.equal(splits.filter((s) => s !== undefined).length, 2);
  assert.equal(splits[2], undefined, "the third To do line carries no minutes");
  // the two refs the fixture names
  assert.equal(toDo!.items[0].ref, "applications/fernway-senior-pm-resume.md");
  assert.equal(toDo!.items[1].ref, "prep/fernway-senior-pm.md");
});

test("workspace-pages fixture: Done now carries the NovaGrid lines the To do table used to", () => {
  const done = readPlanBoard(PLAN_MD).sections.find((s) => s.label === "Done");
  assert.ok(done);
  assert.equal(done!.items.length, 2);
  assert.equal(done!.items[0].ref, "applications/novagrid-staff-pm-cover-letter.md");
  assert.equal(done!.items[1].ref, "applications/novagrid-staff-pm-application.md");
});

test("workspace-pages fixture: Home's minutes sum must NOT show (one To do item has no minutes)", () => {
  // Mirrors apps/web's own minutesSum rule (home-reader.ts): every item
  // must carry minutes, or nothing shows — proved here at the reader
  // level, independent of the component.
  const toDo = readPlanBoard(PLAN_MD).sections.find((s) => s.label === "To do")!;
  const everyItemHasMinutes = toDo.items.every((i) => splitPlanMinutes(i.text) !== undefined);
  assert.equal(everyItemHasMinutes, false);
});
