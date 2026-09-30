// Home's readers over the shared § 5.7 page fixture
// (apps/web/fixtures/workspace-pages.json) — design-web-ui.md § 5.7: six
// invented roles across every jobs.md stage plus Dismissed, a plan.md
// with three To do lines in C § 18.1's minutes form plus one without (so
// the minutes sum must not show), refs both present and absent in both
// Waiting on you and To do, and a last assistant message with tool parts
// plus a text part over 280 code points (Home's own last-reply cut).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { readPlanBoard } from "../../../../packages/agent/src/plan-board.ts";
import { FixtureStore } from "../store.ts";
import type { AppMessage, Fixture } from "../types.ts";
import { activityLinesFor, cutQuote, lastReply, minutesSum } from "./home-reader.ts";
import { pipelineCounts } from "./pipeline.ts";
import { storeIo } from "./store-io.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE: Fixture = JSON.parse(
  readFileSync(join(HERE, "../../fixtures/workspace-pages.json"), "utf8"),
);

test("workspace-pages fixture: pipelineCounts — one count per stage, one dismissed", async () => {
  const store = new FixtureStore(FIXTURE);
  const counts = await pipelineCounts(storeIo(store));
  assert.deepEqual(counts.stages, [
    { label: "To Review", count: 1 },
    { label: "Interested", count: 1 },
    { label: "Applied", count: 1 },
    { label: "Interviewing", count: 1 },
    { label: "Offer", count: 1 },
  ]);
  assert.equal(counts.dismissed, 1);
});

test("workspace-pages fixture: minutesSum is undefined (one To do line has no minutes)", () => {
  const board = readPlanBoard(FIXTURE.files["plan.md"]);
  const toDo = board.sections.find((s) => s.label === "To do");
  assert.equal(minutesSum(toDo, board.budgetLine), undefined);
});

test("workspace-pages fixture: lastReply — the quote is cut at 280 code points, the activity line reuses groupParts/summarize", () => {
  const result = lastReply(FIXTURE.messages as AppMessage[], "ready");
  assert.ok(result, "the last assistant message qualifies");
  const lastText = (FIXTURE.messages.at(-1)!.parts as Array<{ type: string; text?: string }>)
    .filter((p) => p.type === "text")
    .map((p) => p.text as string)
    .at(-1)!;
  assert.ok(Array.from(lastText).length > 280, "fixture precondition: the reply is over 280 code points");
  assert.equal(result!.quote, cutQuote(lastText));
  assert.ok(result!.quote.endsWith("…"));
  assert.ok(Array.from(result!.quote).length <= 281); // 280 kept + the "…" mark
  assert.deepEqual(result!.activityLines, activityLinesFor(FIXTURE.messages.at(-1) as AppMessage));
  assert.ok(result!.activityLines.length > 0, "the last message carries tool parts");
});
