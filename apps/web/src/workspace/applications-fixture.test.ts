// Applications' readers over the shared § 5.7 page fixture
// (apps/web/fixtures/workspace-pages.json) — § 5.9 3d's own exit: "the
// page's roles, stages and 'Not linked' line match the fixture" and "the
// coverage and cut rows equal proposalRows' output on the fixture."
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { readPlanBoard } from "../../../../packages/agent/src/plan-board.ts";
import { load as loadJobsRows } from "../../../../skills/search/scripts/lib/jobs-md.mjs";
import { FixtureStore } from "../store.ts";
import type { Fixture } from "../types.ts";
import {
  groupApplications,
  linkedApplicationRow,
  nextFromYou,
  notesFilesOf,
  readApplicationTables,
} from "./applications.ts";
import { storeIo } from "./store-io.ts";

// The jobs_md port's own row shape, the fields this test reads — same
// posture as ApplicationsPage.tsx's own JobsRow.
interface JobsRow {
  company: string;
  title: string;
  stage: string | null;
  analysis_file?: string | null;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE: Fixture = JSON.parse(readFileSync(join(HERE, "../../fixtures/workspace-pages.json"), "utf8"));

test("workspace-pages fixture: groupApplications returns exactly the four entries the fixture's applications/ folder implies", async () => {
  const store = new FixtureStore(FIXTURE);
  const files = await store.list("applications");
  const entries = groupApplications(files);
  assert.deepEqual(
    entries.map((e) => e.key).sort(),
    [
      "applications/relocation-notes.txt", // an unknown suffix (.txt): its own entry
      "fernway-senior-pm", // <key>.md name form
      "juniper-analytics-pm", // an unmatched key: no jobs.md row's Analysis names it
      "novagrid-staff-pm", // <key>-application.md name form, plus the .html résumé
    ].sort()
  );

  const novagrid = entries.find((e) => e.key === "novagrid-staff-pm")!;
  assert.deepEqual(
    novagrid.files.map((f) => f.path).sort(),
    [
      "applications/novagrid-staff-pm-application.md",
      "applications/novagrid-staff-pm-cover-letter.md",
      "applications/novagrid-staff-pm-resume.html",
      "applications/novagrid-staff-pm-resume.md",
    ].sort()
  );
});

test("workspace-pages fixture: the exact Analysis join — stages, and the unlinked 'Not linked' entries", async () => {
  const store = new FixtureStore(FIXTURE);
  const files = await store.list("applications");
  const entries = groupApplications(files);
  const rows = (await loadJobsRows(storeIo(store), "")) as JobsRow[];

  const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));

  const fernwayRow = linkedApplicationRow(byKey["fernway-senior-pm"], rows);
  assert.ok(fernwayRow, "fernway-senior-pm links to its jobs.md row");
  assert.equal(fernwayRow.company, "Fernway Robotics");
  assert.equal(fernwayRow.stage, "Interviewing");

  const novagridRow = linkedApplicationRow(byKey["novagrid-staff-pm"], rows);
  assert.ok(novagridRow, "novagrid-staff-pm links to its jobs.md row");
  assert.equal(novagridRow.company, "NovaGrid Energy");
  assert.equal(novagridRow.stage, "Applied");

  // "an unmatched key" and "an unknown suffix": neither links to any row —
  // the page shows "Not linked to a role on your job list." for both.
  assert.equal(linkedApplicationRow(byKey["juniper-analytics-pm"], rows), undefined);
  assert.equal(linkedApplicationRow(byKey["applications/relocation-notes.txt"], rows), undefined);
});

test("workspace-pages fixture: the coverage and cut rows equal proposalRows' own output, field by field", async () => {
  const store = new FixtureStore(FIXTURE);
  const files = await store.list("applications");
  const entries = groupApplications(files);
  const novagrid = entries.find((e) => e.key === "novagrid-staff-pm")!;
  const notes = notesFilesOf(novagrid);
  assert.equal(notes.length, 1);
  const raw = await store.read(notes[0].path);
  assert.equal(raw.binary, false);

  const tables = readApplicationTables(raw.binary ? "" : raw.content);
  assert.ok(tables.coverage);
  assert.equal(tables.coverage!.length, 4);
  assert.deepEqual(tables.coverage![0], [
    "partner ecosystem platform ownership",
    "have",
    "Argent Grid Systems partner analytics platform ownership, 12% to 65% adoption",
    "answered",
  ]);
  assert.deepEqual(tables.coverage![3], [
    "direct people-management experience",
    "gap",
    "no direct reports in either role; both were cross-functional leads",
    "open",
  ]);

  assert.ok(tables.cuts);
  assert.equal(tables.cuts!.length, 2);
  assert.deepEqual(
    tables.cuts!.map((r) => r[1]),
    ["Halcyon Metering", "Halcyon Metering"]
  );
  assert.equal(tables.unreadable.length, 0);
});

test("workspace-pages fixture: fernway-senior-pm's notes file has no ## Coverage/## Selection tables — both null, no tables shown", async () => {
  const store = new FixtureStore(FIXTURE);
  const files = await store.list("applications");
  const entries = groupApplications(files);
  const fernway = entries.find((e) => e.key === "fernway-senior-pm")!;
  const notes = notesFilesOf(fernway);
  assert.equal(notes.length, 1);
  const raw = await store.read(notes[0].path);
  const tables = readApplicationTables(raw.binary ? "" : raw.content);
  assert.equal(tables.coverage, null);
  assert.equal(tables.cuts, null);
});

test("workspace-pages fixture: 'Next, from you' for fernway-senior-pm — Waiting on you (via the linked row's Analysis path) then To do (via the entry's own résumé path)", async () => {
  const store = new FixtureStore(FIXTURE);
  const files = await store.list("applications");
  const entries = groupApplications(files);
  const rows = (await loadJobsRows(storeIo(store), "")) as JobsRow[];
  const fernway = entries.find((e) => e.key === "fernway-senior-pm")!;
  const row = linkedApplicationRow(fernway, rows);

  const planFile = await store.read("plan.md");
  assert.equal(planFile.binary, false);
  const board = readPlanBoard(planFile.binary ? "" : planFile.content);

  const items = nextFromYou(board, fernway, row?.analysis_file);
  assert.equal(items.length, 2);
  assert.equal(items[0].ref, "jd-analysis/fernway-senior-pm.md");
  assert.equal(items[1].ref, "applications/fernway-senior-pm-resume.md");
});

test("workspace-pages fixture: 'Next, from you' for novagrid-staff-pm is empty — its only plan refs sit under Done, never matched", async () => {
  const store = new FixtureStore(FIXTURE);
  const files = await store.list("applications");
  const entries = groupApplications(files);
  const rows = (await loadJobsRows(storeIo(store), "")) as JobsRow[];
  const novagrid = entries.find((e) => e.key === "novagrid-staff-pm")!;
  const row = linkedApplicationRow(novagrid, rows);

  const planFile = await store.read("plan.md");
  const board = readPlanBoard(planFile.binary ? "" : planFile.content);
  const items = nextFromYou(board, novagrid, row?.analysis_file);
  assert.deepEqual(items, []);
});
