// Unit + table tests for groupApplications and its small companions
// (design-web-ui.md § 5.3 "Applications", § 5.9 3d's own exit: "a table
// test over both name forms, the .html, an unknown suffix and an
// unmatched key"). Run: node --test src/workspace/applications.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  applicationKeyFor,
  groupApplications,
  linkedApplicationRow,
  nextFromYou,
  notesFilesOf,
  readApplicationTables,
  type ApplicationEntry,
} from "./applications.ts";
import type { FileInfo } from "../types.ts";
import { readPlanBoard } from "../../../../packages/agent/src/plan-board.ts";

function file(path: string, updatedAt = "2026-09-22T10:00:00.000Z"): FileInfo {
  return { path, version: "v1", size: 10, updatedAt, editable: true };
}

// ---------------------------------------------------------------------
// applicationKeyFor — § 5.9 3d's own table: "both name forms, the .html,
// an unknown suffix and an unmatched key."
// ---------------------------------------------------------------------

test("applicationKeyFor: the suffix table, in order", () => {
  const cases: [string, string][] = [
    // both notes-file name forms (§ 5.3, "there are two suffixes for the
    // application notes because the chain disagrees today")
    ["applications/acme-staff-pm.md", "acme-staff-pm"],
    ["applications/acme-staff-pm-application.md", "acme-staff-pm"],
    // the .html résumé
    ["applications/acme-staff-pm-resume.html", "acme-staff-pm"],
    // the other résumé forms, earlier in the try-order than the bare .md
    ["applications/acme-staff-pm-resume.pdf", "acme-staff-pm"],
    ["applications/acme-staff-pm-resume.md", "acme-staff-pm"],
    ["applications/acme-staff-pm-cover-letter.md", "acme-staff-pm"],
    // an unknown suffix: its own entry, keyed by its full name (path)
    ["applications/relocation-notes.txt", "applications/relocation-notes.txt"],
    // a bare, unusually short name (guards the length check: a leaf that
    // IS the suffix, with nothing before it, is never emptied out)
    [".md", ".md"],
  ];
  for (const [path, expected] of cases) {
    assert.equal(applicationKeyFor(path), expected, path);
  }
});

// ---------------------------------------------------------------------
// groupApplications
// ---------------------------------------------------------------------

test("groupApplications: nothing is dropped, every file lands in exactly one entry", () => {
  const files = [
    file("applications/acme-staff-pm.md"),
    file("applications/acme-staff-pm-resume.md"),
    file("applications/acme-staff-pm-resume.html"),
    file("applications/acme-staff-pm-cover-letter.md"),
    file("applications/globex-pm-application.md"),
    file("applications/globex-pm-resume.md"),
    file("applications/relocation-notes.txt"),
  ];
  const groups = groupApplications(files);
  const seen: string[] = [];
  for (const g of groups) for (const f of g.files) seen.push(f.path);
  assert.deepEqual(seen.sort(), files.map((f) => f.path).sort());
  assert.equal(groups.length, 3);
});

test("groupApplications: both notes-file name forms key to the same entry", () => {
  const a = groupApplications([file("applications/acme-staff-pm.md")]);
  assert.deepEqual(a.map((g) => g.key), ["acme-staff-pm"]);

  const b = groupApplications([file("applications/acme-staff-pm-application.md")]);
  assert.deepEqual(b.map((g) => g.key), ["acme-staff-pm"]);
});

test("groupApplications: the .html résumé keys with its role, not its own entry", () => {
  const groups = groupApplications([
    file("applications/acme-staff-pm.md"),
    file("applications/acme-staff-pm-resume.html"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "acme-staff-pm");
  assert.equal(groups[0].files.length, 2);
});

test("groupApplications: an unknown suffix is its own entry, keyed by its full name", () => {
  const groups = groupApplications([file("applications/relocation-notes.txt")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "applications/relocation-notes.txt");
  assert.equal(groups[0].files.length, 1);
});

test("groupApplications: an unmatched key (no jobs.md row's Analysis names it) — the join returns undefined, never a guess", () => {
  const groups = groupApplications([file("applications/juniper-analytics-pm-resume.md")]);
  assert.equal(groups.length, 1);
  const rows = [{ analysis_file: "jd-analysis/acme-staff-pm.md" }];
  assert.equal(linkedApplicationRow(groups[0], rows), undefined);
});

test("groupApplications: files within an entry are ordered notes, résumé, printable résumé, cover letter, other", () => {
  const groups = groupApplications([
    file("applications/acme-staff-pm-cover-letter.md"),
    file("applications/acme-staff-pm-resume.html"),
    file("applications/acme-staff-pm-resume.md"),
    file("applications/acme-staff-pm.md"),
  ]);
  assert.deepEqual(
    groups[0].files.map((f) => f.path),
    [
      "applications/acme-staff-pm.md",
      "applications/acme-staff-pm-resume.md",
      "applications/acme-staff-pm-resume.html",
      "applications/acme-staff-pm-cover-letter.md",
    ]
  );
});

test("groupApplications: entries are ordered newest change first, by the latest updatedAt among the entry's own files", () => {
  const groups = groupApplications([
    file("applications/older-role.md", "2026-09-01T00:00:00.000Z"),
    file("applications/newer-role.md", "2026-09-20T00:00:00.000Z"),
    // the newer role's OWN latest file is its resume, later still —
    // proves the entry's max is used, not just its first file's date.
    file("applications/newer-role-resume.md", "2026-09-25T00:00:00.000Z"),
  ]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ["newer-role", "older-role"]
  );
});

test("groupApplications: a tie in updatedAt keeps the input's own order (stable, never a second invented tiebreak)", () => {
  const groups = groupApplications([
    file("applications/b-role.md", "2026-09-22T10:00:00.000Z"),
    file("applications/a-role.md", "2026-09-22T10:00:00.000Z"),
  ]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ["b-role", "a-role"]
  );
});

// ---------------------------------------------------------------------
// notesFilesOf
// ---------------------------------------------------------------------

test("notesFilesOf: one notes file, the normal case", () => {
  const groups = groupApplications([
    file("applications/acme-staff-pm.md"),
    file("applications/acme-staff-pm-resume.md"),
  ]);
  assert.deepEqual(
    notesFilesOf(groups[0]).map((f) => f.path),
    ["applications/acme-staff-pm.md"]
  );
});

test("notesFilesOf: two notes files (both name forms present) — both returned, never a guess", () => {
  const groups = groupApplications([
    file("applications/acme-staff-pm.md"),
    file("applications/acme-staff-pm-application.md"),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    notesFilesOf(groups[0])
      .map((f) => f.path)
      .sort(),
    ["applications/acme-staff-pm-application.md", "applications/acme-staff-pm.md"]
  );
});

test("notesFilesOf: no notes file — an entry with only a résumé", () => {
  const groups = groupApplications([file("applications/acme-staff-pm-resume.md")]);
  assert.deepEqual(notesFilesOf(groups[0]), []);
});

// ---------------------------------------------------------------------
// linkedApplicationRow — the exact Analysis join (§ 5.3)
// ---------------------------------------------------------------------

test("linkedApplicationRow: exact match only, never a company-name guess", () => {
  const entry: ApplicationEntry = { key: "acme-staff-pm", files: [] };
  const rows = [
    { company: "Acme", analysis_file: "jd-analysis/acme-staff-pm.md" },
    { company: "Acme Robotics", analysis_file: "jd-analysis/acme-robotics.md" },
  ];
  assert.equal(linkedApplicationRow(entry, rows), rows[0]);
});

test("linkedApplicationRow: no row's Analysis matches — undefined", () => {
  const entry: ApplicationEntry = { key: "acme-staff-pm", files: [] };
  const rows = [{ company: "Globex", analysis_file: "jd-analysis/globex-pm.md" }];
  assert.equal(linkedApplicationRow(entry, rows), undefined);
});

test("linkedApplicationRow: a row with no Analysis field at all never matches", () => {
  const entry: ApplicationEntry = { key: "acme-staff-pm", files: [] };
  const rows = [{ company: "Acme", analysis_file: undefined }];
  assert.equal(linkedApplicationRow(entry, rows), undefined);
});

test("linkedApplicationRow: a legacy row (JD: jd-analysis/<key>.md, no Analysis) joins (C § 6.2, issue #32)", () => {
  const entry: ApplicationEntry = { key: "acme-staff-pm", files: [] };
  const rows = [
    { company: "Globex", analysis_file: "jd-analysis/globex-pm.md" },
    { company: "Acme", jd_file: "jd-analysis/acme-staff-pm.md" },
  ];
  assert.equal(linkedApplicationRow(entry, rows), rows[1]);
});

test("linkedApplicationRow: a JD under jd-inbox/ (the raw posting) never joins", () => {
  const entry: ApplicationEntry = { key: "acme-staff-pm", files: [] };
  const rows = [{ company: "Acme", jd_file: "jd-inbox/acme-staff-pm.md" }];
  assert.equal(linkedApplicationRow(entry, rows), undefined);
});

test("linkedApplicationRow: a row's Analysis field wins over its legacy JD", () => {
  const entry: ApplicationEntry = { key: "acme-staff-pm", files: [] };
  const rows = [{ company: "Acme", analysis_file: "jd-analysis/acme-other.md", jd_file: "jd-analysis/acme-staff-pm.md" }];
  assert.equal(linkedApplicationRow(entry, rows), undefined);
});

// ---------------------------------------------------------------------
// readApplicationTables — C § 19's proposalRows, wrapped with the page's
// own universalNewlines-in / restoreLineSeparators-out (§ 18's posture).
// ---------------------------------------------------------------------

const COVERAGE_HEADER = "## Coverage\n| requirement | status | evidence | decision |\n|---|---|---|---|\n";
const SELECTION_HEADER =
  "## Selection\n| # | role | bullet | in/out | source | words | why |\n|---|---|---|---|---|---|---|\n";

test("readApplicationTables: both tables present, in file order", () => {
  const text =
    COVERAGE_HEADER +
    "| Req one | have | Evidence one | answered |\n" +
    "| Req two | gap | Evidence two | open |\n\n" +
    SELECTION_HEADER +
    "| 1 | A | bullet one | in | base | 5 | lead |\n" +
    "| 2 | A | bullet two | out | base | 6 | weakest |\n";
  const tables = readApplicationTables(text);
  assert.deepEqual(tables.coverage, [
    ["Req one", "have", "Evidence one", "answered"],
    ["Req two", "gap", "Evidence two", "open"],
  ]);
  assert.deepEqual(tables.cuts, [["2", "A", "bullet two", "out", "base", "6", "weakest"]]);
  assert.deepEqual(tables.kept, [["1", "A", "bullet one", "in", "base", "5", "lead"]]);
});

test("readApplicationTables: a missing ## Coverage header — coverage is null", () => {
  const text = SELECTION_HEADER + "| 1 | A | bullet one | in | base | 5 | lead |\n";
  assert.equal(readApplicationTables(text).coverage, null);
});

test("readApplicationTables: a row with the wrong cell count — shown as unreadable, cells split, nothing dropped", () => {
  const text = COVERAGE_HEADER + "| Req two | gap | Evidence two |\n"; // 3 cells, not 4
  const tables = readApplicationTables(text);
  assert.deepEqual(tables.coverage, []);
  assert.deepEqual(tables.unreadable, [["Req two", "gap", "Evidence two"]]);
});

test("readApplicationTables: CRLF line endings parse the same as LF", () => {
  const text = (COVERAGE_HEADER + "| Req one | have | Evidence one | answered |\n").replace(/\n/g, "\r\n");
  const tables = readApplicationTables(text);
  assert.deepEqual(tables.coverage, [["Req one", "have", "Evidence one", "answered"]]);
});

test("readApplicationTables: an escaped `\\|` is removed, not kept (matches proposal_block's own strip)", () => {
  const text = COVERAGE_HEADER + "| Req a \\| b | have | Evidence a \\| b | answered |\n";
  const tables = readApplicationTables(text);
  assert.deepEqual(tables.coverage, [["Req a  b", "have", "Evidence a  b", "answered"]]);
});

// docs/workspace-review-drift, design-web-agent.md C § 19, lead ruling
// 2026-09-29: "A coverage status is matched once, here" — statuses[i] is
// run()'s own once-normalised status, so **gap**/`gap`/Gap all read the
// same value the reply used, and a value outside the table (e.g.
// "partly") is returned normalised but never dropped.
test("readApplicationTables: statuses normalises `**gap**`, `` `gap` ``, `Gap`, `Have` the same way run() always has, and passes through a status outside the table", () => {
  const text =
    COVERAGE_HEADER +
    "| r1 | **gap** | e1 | open |\n" +
    "| r2 | `gap` | e2 | open |\n" +
    "| r3 | Gap | e3 | open |\n" +
    "| r4 | Have | e4 | answered |\n" +
    "| r5 | partly | e5 | open |\n";
  const tables = readApplicationTables(text);
  assert.deepEqual(tables.statuses, ["gap", "gap", "gap", "have", "partly"]);
});

test("readApplicationTables: statuses is null exactly when coverage is null", () => {
  const text = "no tables here\n";
  const tables = readApplicationTables(text);
  assert.equal(tables.coverage, null);
  assert.equal(tables.statuses, null);
});

// ---------------------------------------------------------------------
// nextFromYou — design-web-ui.md § 5.3 Applications, part 4: "Waiting on
// you and then To do, in file order, whose ref ... is one of this
// entry's file paths or the linked row's Analysis path."
// ---------------------------------------------------------------------

const PLAN = `Goal: an offer
Budget: 45 min/day

## Board

Waiting on you
- Confirm the Fernway travel question (\`jd-analysis/fernway-senior-pm.md\`)
- Tell me if you want a wider search

To do
- Look over the Fernway materials (\`applications/fernway-senior-pm-resume.md\`) — 5 min — the check is clean
- Prep three STAR stories (\`prep/fernway-senior-pm.md\`) — 15 min — inside two weeks
- Decide something unrelated

Doing

Done
- Send the NovaGrid cover letter (\`applications/novagrid-staff-pm-cover-letter.md\`) — 5 min — sent
`;

function entry(key: string, ...files: string[]): ApplicationEntry {
  return { key, files: files.map((path) => file(path)) };
}

test("nextFromYou: matches by the entry's own file path (To do)", () => {
  const board = readPlanBoard(PLAN);
  const items = nextFromYou(board, entry("fernway-senior-pm", "applications/fernway-senior-pm-resume.md"));
  assert.equal(items.length, 1);
  assert.equal(items[0].ref, "applications/fernway-senior-pm-resume.md");
});

test("nextFromYou: matches by the linked row's Analysis path (Waiting on you)", () => {
  const board = readPlanBoard(PLAN);
  const items = nextFromYou(
    board,
    entry("fernway-senior-pm", "applications/fernway-senior-pm-cover-letter.md"), // no file-path match on its own
    "jd-analysis/fernway-senior-pm.md"
  );
  assert.equal(items.length, 1);
  assert.match(items[0].text, /Confirm the Fernway travel question/);
});

test("nextFromYou: both sections can match, Waiting on you first, then To do, each in file order", () => {
  const board = readPlanBoard(PLAN);
  const items = nextFromYou(
    board,
    entry("fernway-senior-pm", "applications/fernway-senior-pm-resume.md"),
    "jd-analysis/fernway-senior-pm.md"
  );
  assert.equal(items.length, 2);
  assert.match(items[0].text, /Confirm the Fernway travel question/);
  assert.equal(items[1].ref, "applications/fernway-senior-pm-resume.md");
});

test("nextFromYou: a Done-section match is never included (only Waiting on you and To do)", () => {
  const board = readPlanBoard(PLAN);
  const items = nextFromYou(
    board,
    entry("novagrid-staff-pm", "applications/novagrid-staff-pm-cover-letter.md"),
    "jd-analysis/novagrid-staff-pm.md"
  );
  assert.deepEqual(items, []);
});

test("nextFromYou: no match at all — an empty list, never a computed next step", () => {
  const board = readPlanBoard(PLAN);
  const items = nextFromYou(board, entry("unrelated-role", "applications/unrelated-role.md"));
  assert.deepEqual(items, []);
});
