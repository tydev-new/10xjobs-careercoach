// Tester-owned: workspace Stage 3d, the Applications page — the pure parts
// of docs/design-web-ui.md § 5.9 3d's exit, written from the spec, not from
// the builder's own apps/web/src/workspace/applications*.test.ts:
//   - `groupApplications` and the exact `Analysis` join (§ 5.3 "Parsed by"):
//     a table test over both notes-file name forms, the `.html`, an unknown
//     suffix and an unmatched key;
//   - `proposalRows` (docs/design-web-agent.md § 19): C § 19's own table
//     test, and a differential check that `run()` re-expressed through it
//     prints exactly what main's pre-3d `run()` (c3d6b08) printed (the parity corpus
//     itself is replayed, unchanged, by tests/checkers/run-cases.mjs);
//   - the stage steps (§ 5.3 "Pieces the pages share"): exactly one current
//     step, jobs.md's own words, in STAGES order;
//   - "Next, from you" (§ 5.3 Applications part 4): an exact `ref` match
//     over readPlanBoard's items, Waiting on you then To do, file order;
//   - the § 5.7 fixture: the entries, their roles, stages and "Not linked"
//     lines, and the coverage and cut rows, all derived here from the spec.
//
// Run: node --test tests/web/stage3d-units.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  groupApplications,
  linkedApplicationRow,
  nextFromYou,
  notesFilesOf,
  readApplicationTables,
} from "../../apps/web/src/workspace/applications.ts";
import { stageSteps } from "../../apps/web/src/workspace/stage-steps.ts";
import { readPlanBoard } from "../../packages/agent/src/plan-board.ts";
// @ts-expect-error - plain .mjs, no type declarations
import { proposalRows, run as runNow } from "../../skills/apply/scripts/lib/proposal-block.mjs";
// @ts-expect-error - plain .mjs, no type declarations
import { load, STAGES } from "../../skills/search/scripts/lib/jobs-md.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOC = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");
const FIXTURE = JSON.parse(readFileSync(path.join(REPO, "apps/web/fixtures/workspace-pages.json"), "utf8")).files as Record<string, string>;

type FI = { path: string; version: string; size: number; updatedAt: string; editable: boolean };
const fi = (p: string, updatedAt = "2026-09-22T03:30:00.000Z"): FI => ({ path: p, version: "v1", size: 1, updatedAt, editable: true });

// ------------------------------------------------------------ the spec's own rule

/** § 5.3 "Parsed by", read from the doc itself so a spec change shows here:
 *  "tried in this order: `-resume.html`, `-resume.pdf`, ... `.md`". */
const SUFFIXES = (() => {
  const i = DOC.indexOf("The key is the name with the first");
  const para = DOC.slice(i, DOC.indexOf("A name that matches none", i));
  return [...para.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
})();

test("§ 5.3's suffix list is the one this test holds the code to", () => {
  assert.deepEqual(SUFFIXES, ["-resume.html", "-resume.pdf", "-resume.md", "-cover-letter.md", "-application.md", ".md"]);
});

/** The spec's key for one path; `null` when no suffix matches ("its own entry,
 *  keyed by its full name"). */
function specKey(p: string): string | null {
  const name = p.slice(p.lastIndexOf("/") + 1);
  for (const s of SUFFIXES) if (name.endsWith(s) && name.length > s.length) return name.slice(0, -s.length);
  return null;
}

// ------------------------------------------------------------ groupApplications

test("§ 5.9 3d exit — groupApplications table: both name forms, the .html, an unknown suffix, an unmatched key; nothing dropped", () => {
  const rows = [
    { company: "Acme", title: "Staff PM", stage: "Applied", dismissed: false, analysis_file: "jd-analysis/acme-staff-pm.md" },
    { company: "Beta", title: "Senior PM", stage: "Interested", dismissed: false, analysis_file: "jd-analysis/beta-senior-pm.md" },
    // A company-name look-alike: the page never guesses a link from a name.
    { company: "Gamma", title: "PM", stage: "To Review", dismissed: false, analysis_file: "jd-analysis/gamma-co-pm-v2.md" },
  ];
  const table: { files: string[]; key: string | null; notes: string[]; linked: string | null }[] = [
    // `<key>.md` notes form (apply schema.md), with a résumé, the .html, a pdf and a letter
    { files: ["applications/acme-staff-pm.md", "applications/acme-staff-pm-resume.md", "applications/acme-staff-pm-resume.html", "applications/acme-staff-pm-resume.pdf", "applications/acme-staff-pm-cover-letter.md"], key: "acme-staff-pm", notes: ["applications/acme-staff-pm.md"], linked: "Acme" },
    // `<key>-application.md` notes form (apply SKILL.md:16, mvp-journey)
    { files: ["applications/beta-senior-pm-application.md", "applications/beta-senior-pm-resume.md"], key: "beta-senior-pm", notes: ["applications/beta-senior-pm-application.md"], linked: "Beta" },
    // the .html alone still keys to its role
    { files: ["applications/delta-pm-resume.html"], key: "delta-pm", notes: [], linked: null },
    // an unmatched key: no row's Analysis is jd-analysis/gamma-co-pm.md (the look-alike ends -v2)
    { files: ["applications/gamma-co-pm-resume.md"], key: "gamma-co-pm", notes: [], linked: null },
    // unknown suffixes: each its own entry, never linked
    { files: ["applications/relocation-notes.txt"], key: null, notes: [], linked: null },
    { files: ["applications/acme-staff-pm-references.docx"], key: null, notes: [], linked: null },
  ];
  const all = table.flatMap((t) => t.files);
  const entries = groupApplications([...all].reverse().map((p) => fi(p)));
  const bad: string[] = [];

  // nothing dropped, each file once
  const listed = entries.flatMap((e) => e.files.map((f) => f.path));
  if (JSON.stringify([...listed].sort()) !== JSON.stringify([...all].sort())) bad.push(`files listed ${JSON.stringify(listed)} != ${JSON.stringify(all)}`);
  if (entries.length !== table.length) bad.push(`${entries.length} entries, want ${table.length}`);

  for (const t of table) {
    const e = entries.find((x) => t.files.every((p) => x.files.some((f) => f.path === p)));
    if (!e) {
      bad.push(`${t.files[0]}: its files are split across entries`);
      continue;
    }
    if (e.files.length !== t.files.length) bad.push(`${t.files[0]}: entry holds ${e.files.map((f) => f.path)}`);
    for (const p of t.files) if (specKey(p) !== t.key) bad.push(`oracle: ${p} keys ${specKey(p)}`);
    const notes = notesFilesOf(e).map((f) => f.path);
    if (JSON.stringify(notes) !== JSON.stringify(t.notes)) bad.push(`${t.files[0]}: notes ${JSON.stringify(notes)}, want ${JSON.stringify(t.notes)}`);
    const row = linkedApplicationRow(e, rows);
    if ((row?.company ?? null) !== t.linked) bad.push(`${t.files[0]}: linked to ${row?.company ?? null}, want ${t.linked}`);
  }
  assert.deepEqual(bad, []);
});

test("§ 5.3 'Parsed by': file names only — the suffix wins over what a name looks like (a `-resume.md` never keys as its own `.md` entry; `.md` is last)", () => {
  const e = groupApplications([fi("applications/x-resume.md"), fi("applications/x.md"), fi("applications/x-cover-letter.md"), fi("applications/x-application.md")]);
  assert.equal(e.length, 1, JSON.stringify(e.map((x) => x.files.map((f) => f.path))));
  // a name whose suffix is also a key word: "resume.md" alone has no key before "-resume.md"; "-resume" is not "-resume.md"
  const f = groupApplications([fi("applications/cover-letter.md"), fi("applications/y-resume.markdown")]);
  const paths = f.map((x) => x.files.map((y) => y.path));
  assert.equal(f.length, 2, JSON.stringify(paths));
});

test("§ 5.3 'Entries are ordered newest change first, by the latest updatedAt among the entry's files'", () => {
  const files = [
    fi("applications/old.md", "2026-09-01T00:00:00.000Z"),
    fi("applications/old-resume.md", "2026-09-20T00:00:00.000Z"), // makes `old` the newest entry
    fi("applications/mid.md", "2026-09-10T00:00:00.000Z"),
    fi("applications/new-resume.md", "2026-09-15T00:00:00.000Z"),
    fi("applications/z.txt", "2026-09-05T00:00:00.000Z"),
  ];
  for (const order of [files, [...files].reverse()]) {
    const got = groupApplications(order).map((e) => e.files[0].path.replace(/^applications\//, "").replace(/(-resume)?\.(md|txt)$/, ""));
    assert.deepEqual(got, ["old", "new", "mid", "z"]);
  }
});

test("§ 5.3 the join is exact: `Analysis` equal to `jd-analysis/<key>.md`, nothing looser (case, a `./`, a trailing space trimmed by load(), a JD field, a company name)", () => {
  const e = groupApplications([fi("applications/acme-pm.md")])[0];
  const near = [
    { company: "acme-pm", title: "t", analysis_file: "jd-analysis/Acme-PM.md" },
    { company: "Acme", title: "t", analysis_file: "./jd-analysis/acme-pm.md" },
    { company: "Acme", title: "t", analysis_file: "jd-analysis/acme-pm.md.bak" },
    { company: "Acme", title: "t", analysis_file: "jd-inbox/acme-pm.md" },
    { company: "Acme", title: "t", jd_file: "jd-analysis/acme-pm.md" } as any,
    { company: "Acme", title: "t", analysis_file: null },
  ];
  assert.equal(linkedApplicationRow(e, near), undefined);
  const exact = [...near, { company: "Acme", title: "Staff PM", analysis_file: "jd-analysis/acme-pm.md" }];
  assert.equal(linkedApplicationRow(e, exact)?.title, "Staff PM");
});

// ------------------------------------------------------------ proposalRows, C § 19

const COV_H = "| requirement | status | evidence | decision |";
const SEL_H = "| # | role | bullet | in/out | source | words | why |";
const APP = [
  "# Acme — Staff PM",
  "",
  "## Coverage",
  COV_H,
  "|---|---|---|---|",
  "| roadmap ownership | have | owned the roadmap | answered |",
  "| billing | shown-but-unnamed | metering pipeline | answered |",
  "| people management | gap | none yet | open |",
  "",
  "## Selection",
  SEL_H,
  "|---|---|---|---|---|---|---|",
  "| 1 | Argent | Kept bullet | in | base | 4 | strong |",
  "| 4 | Halcyon | Weakest bullet | out | base | 3 | weakest fit |",
  "| 2 | Argent | Second cut | **out** | base | 3 | second weakest |",
  "",
].join("\n");

test("C § 19 table: both tables present — coverage (4 cells), cuts (`out`, file order, the port's own `*_` strip), kept (`in`), nothing unreadable", () => {
  const r = proposalRows(APP);
  assert.deepEqual(r.coverage, [
    ["roadmap ownership", "have", "owned the roadmap", "answered"],
    ["billing", "shown-but-unnamed", "metering pipeline", "answered"],
    ["people management", "gap", "none yet", "open"],
  ]);
  assert.deepEqual(r.cuts, [
    ["4", "Halcyon", "Weakest bullet", "out", "base", "3", "weakest fit"],
    ["2", "Argent", "Second cut", "**out**", "base", "3", "second weakest"],
  ]);
  assert.deepEqual(r.kept, [["1", "Argent", "Kept bullet", "in", "base", "4", "strong"]]);
  assert.deepEqual(r.unreadable, []);
});

test("C § 19 table: a missing `## Coverage` header line gives coverage === null (Selection still read)", () => {
  const r = proposalRows(APP.replace(COV_H, "| requirement | status | evidence |"));
  assert.equal(r.coverage, null);
  assert.equal(r.cuts.length, 2);
});

test("C § 19 table: a Selection table with no `out` row gives cuts === [] (not null)", () => {
  const r = proposalRows(APP.replace(/\| out \|/g, "| in |").replace("| **out** |", "| in |"));
  assert.deepEqual(r.cuts, []);
  assert.equal(r.kept.length, 3);
});

test("C § 19 table: a missing Selection header gives cuts === null and kept === null", () => {
  const r = proposalRows(APP.replace(SEL_H, "| # | role | bullet |"));
  assert.equal(r.cuts, null);
  assert.equal(r.kept, null);
});

test("C § 19 table: a row with the wrong cell count lands in `unreadable` as split, not in coverage or cuts (under either header)", () => {
  const text = APP.replace("| billing | shown-but-unnamed | metering pipeline | answered |", "| billing | shown-but-unnamed | metering pipeline |").replace(
    "| 4 | Halcyon | Weakest bullet | out | base | 3 | weakest fit |",
    "| 4 | Halcyon | Weakest bullet | out | base | 3 | weakest fit | extra |",
  );
  const r = proposalRows(text);
  assert.deepEqual(r.unreadable, [
    ["billing", "shown-but-unnamed", "metering pipeline"],
    ["4", "Halcyon", "Weakest bullet", "out", "base", "3", "weakest fit", "extra"],
  ]);
  assert.ok(!r.coverage.some((c: string[]) => c[0] === "billing"));
  assert.ok(!r.cuts.some((c: string[]) => c[1] === "Halcyon"));
  assert.deepEqual(r.cuts.map((c: string[]) => c[2]), ["Second cut"]);
});

test("C § 19 table: a cell written `a \\| b` reads `a  b` (the escaped pipe removed, not kept)", () => {
  const r = proposalRows(APP.replace("| owned the roadmap |", "| a \\| b |"));
  assert.equal(r.coverage[0][2], "a  b");
});

test("C § 19 table: CRLF — proposalRows alone, and the page's reader (universalNewlines in, restoreLineSeparators out), both equal the LF result", () => {
  const lf = proposalRows(APP);
  assert.deepEqual(proposalRows(APP.replace(/\n/g, "\r\n")), lf);
  const page = readApplicationTables(APP.replace(/\n/g, "\r\n"));
  // `statuses` (docs/workspace-review-drift, C § 19, lead ruling
  // 2026-09-29, "A coverage status is matched once, here") is picked
  // alongside the other four fields, not left out — `page` and `lf` must
  // still agree on it under CRLF, the same as everything else here.
  assert.deepEqual({ coverage: page.coverage, statuses: page.statuses, cuts: page.cuts, kept: page.kept, unreadable: page.unreadable }, lf);
});

test("C § 19 table (lead ruling 2026-09-29, origin/docs/workspace-review-drift): `statuses[i]` is coverage[i]'s status as run() matches it — `**gap**`, `` `gap` ``, `Gap`, `Have`, `Shown-But-Unnamed`, `partly`; null exactly when coverage is; a wrong-count row has no status", () => {
  const text = [
    "## Coverage",
    COV_H,
    "|---|---|---|---|",
    "| r1 | **gap** | e | open |",
    "| r2 | `gap` | e | open |",
    "| short | gap | e |",
    "| r3 | Gap | e | open |",
    "| r4 | Have | e | answered |",
    "| r5 | Shown-But-Unnamed | e | answered |",
    "| r6 | partly | e | skipped |",
    "",
  ].join("\n");
  const r = proposalRows(text);
  assert.deepEqual(r.statuses, ["gap", "gap", "gap", "have", "shown-but-unnamed", "partly"]);
  assert.equal(r.statuses.length, r.coverage.length);
  assert.deepEqual(r.coverage.map((c: string[]) => c[1]), ["**gap**", "`gap`", "Gap", "Have", "Shown-But-Unnamed", "partly"], "the raw cells stay as written");
  assert.equal(proposalRows(APP.replace(COV_H, "| requirement | status |")).statuses, null);
  const page = readApplicationTables(text);
  assert.deepEqual(page.statuses, r.statuses);
});

test("C § 19: a U+2028 inside a cell — the page reads what the script reads (universalNewlines in, so splitlines breaks the row there, as Python's does): the row is unreadable, not dropped, and no sentinel leaks out", () => {
  const text = APP.replace("owned the roadmap", "owned the roadmap");
  const page = readApplicationTables(text);
  assert.deepEqual(page.unreadable, [["roadmap ownership", "have", "owned"]]);
  assert.deepEqual(page.coverage, []);
  // the table stops at the broken line (the rest no longer starts with "|"), exactly as run() sees it
  assert.deepEqual(page.cuts?.map((r) => r[1]), ["Halcyon", "Argent"]);
  assert.ok(!JSON.stringify(page).match(/[-]/), `a private-use sentinel leaked: ${JSON.stringify(page)}`);
});

// ------------------------------------------------------------ run() unchanged

/** proposal-block.mjs as main last shipped it before 3d (c3d6b08), with its
 *  relative imports pointed at this checkout's helpers, so its run() can be
 *  called beside today's.
 *  Re-pinned from 8a4eef7: main itself changed run() after that commit
 *  (8da873b, design-honest-ceilings.md § 6A — no script says "clean" while
 *  a WARN stands), so 8a4eef7 stopped being main's pre-3d run() and the
 *  differential failed on main's change, not 3d's. Pinned to a fixed commit,
 *  not origin/main: once 3d merges, origin/main carries proposalRows and the
 *  guard below would trip. */
async function oldRun(): Promise<(argv: string[], io: any) => Promise<any>> {
  const g = spawnSync("git", ["show", "c3d6b08:skills/apply/scripts/lib/proposal-block.mjs"], { cwd: REPO, encoding: "utf8" });
  assert.equal(g.status, 0, g.stderr);
  const lib = path.join(REPO, "skills/profile/scripts/lib");
  const src = g.stdout.replace(/from "\.\.\/\.\.\/\.\.\/profile\/scripts\/lib\/([^"]+)"/g, (_m, f) => `from "${pathToFileURL(path.join(lib, f)).href}"`);
  assert.ok(!src.includes("proposalRows"), "c3d6b08 already has proposalRows — this differential compares nothing");
  const dir = mkdtempSync(path.join(tmpdir(), "stage3d-review-oldpb-"));
  const f = path.join(dir, "proposal-block-main.mjs");
  writeFileSync(f, src);
  try {
    return (await import(pathToFileURL(f).href)).run;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("C § 19 'run() ... its output can't change': today's run() equals main's pre-3d run() (c3d6b08) on every parity-corpus application file and on malformed rows", async () => {
  const before = await oldRun();
  const inputs: string[] = [APP];
  const dir = path.join(REPO, "tests/checkers/cases/proposal_block");
  for (const f of readdirSync(dir)) {
    const c = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    for (const [p, v] of Object.entries(c.before ?? {})) if (p.startsWith("applications/") && typeof v === "string") inputs.push(v);
  }
  // malformed: short and long rows under both headers, an in/out cell that is neither, an empty table, the headers only
  inputs.push(
    APP.replace("| people management | gap | none yet | open |", "| people management | gap | none yet |"),
    APP.replace("| people management | gap | none yet | open |", "| people management | gap | none yet | open | extra |"),
    APP.replace("| 4 | Halcyon | Weakest bullet | out | base | 3 | weakest fit |", "| 4 | Halcyon | Weakest bullet | out | base | 3 |"),
    APP.replace("| 4 | Halcyon | Weakest bullet | out | base | 3 | weakest fit |", "| 4 | Halcyon | Weakest bullet | maybe | base | 3 | weakest fit |"),
    APP.replace("| 4 | Halcyon | Weakest bullet | out | base | 3 | weakest fit |", "| 4 | Halcyon | Weakest bullet | out | base | | |"),
    `${COV_H}\n|---|---|---|---|\n\n${SEL_H}\n|---|---|---|---|---|---|---|\n`,
    `${COV_H}\n${SEL_H}\n`,
    APP.replace(/\n/g, "\r\n"),
    APP.replace("| have |", "| `Have` |").replace("| gap |", "| **gap** |"),
  );
  const base = "# Base\n\n- owned the roadmap for billing\n";
  const bad: string[] = [];
  for (const [i, text] of inputs.entries()) {
    const io = { exists: async (p: string) => p.endsWith("a.md") || p.endsWith("base-resume.md"), readFile: async (p: string) => (p.endsWith("a.md") ? text : base) };
    const argv = ["--workspace", "/ws", "--application", "applications/a.md"];
    const [x, y] = [await before(argv, io), await runNow(argv, io)];
    if (JSON.stringify(x) !== JSON.stringify(y)) bad.push(`input ${i}: ${JSON.stringify(x).slice(0, 300)} != ${JSON.stringify(y).slice(0, 300)}`);
  }
  assert.ok(inputs.length >= 20, `only ${inputs.length} inputs`);
  assert.deepEqual(bad, []);
});

// ------------------------------------------------------------ stage steps

test("§ 5.3 stage-steps table: each of jobs.md's five stages — five steps, jobs.md's own words in STAGES order, exactly one current (the row's), no check mark or date field", () => {
  const WORDS = ["To Review", "Interested", "Applied", "Interviewing", "Offer"];
  assert.deepEqual([...STAGES], WORDS);
  for (const stage of WORDS) {
    const s = stageSteps(stage);
    assert.deepEqual(s.map((x) => x.label), WORDS, stage);
    assert.deepEqual(s.filter((x) => x.current).map((x) => x.label), [stage]);
    for (const step of s) assert.deepEqual(Object.keys(step).sort(), ["current", "label"], `${stage}: a step carries ${Object.keys(step)}`);
    assert.ok(!JSON.stringify(s).match(/\d{4}-\d{2}-\d{2}|✓|✔|done/i), JSON.stringify(s));
  }
});

// ------------------------------------------------------------ Next, from you

test("§ 5.3 part 4 'Next, from you': an exact `ref` match over readPlanBoard's items — Waiting on you then To do, in file order; Doing/Done never; a near-miss path never", () => {
  const plan = [
    "Goal: an offer",
    "Budget: 30 min/day",
    "",
    "## Board",
    "",
    "Done",
    "- Sent it (`applications/acme-pm-cover-letter.md`)",
    "",
    "To do",
    "- Read the letter (`applications/acme-pm-cover-letter.md`) — 5 min — before Friday",
    "- A near miss (`applications/acme-pm-cover-letter.md.bak`)",
    "- Another role (`applications/acme-pm-2-resume.md`)",
    "- The analysis (`jd-analysis/acme-pm.md`)",
    "- No path at all",
    "",
    "Waiting on you",
    "- Say which story (`applications/acme-pm.md`)",
    "- Case differs (`Applications/acme-pm.md`)",
    "",
    "Doing",
    "- Drafting (`applications/acme-pm-resume.md`)",
    "",
  ].join("\n");
  const board = readPlanBoard(plan);
  const e = groupApplications([fi("applications/acme-pm.md"), fi("applications/acme-pm-resume.md"), fi("applications/acme-pm-cover-letter.md")]);
  assert.equal(e.length, 1);
  // Oracle, from the spec: the items of the two sections, Waiting on you first, whose ref ∈ refs
  const refs = new Set([...e[0].files.map((f) => f.path), "jd-analysis/acme-pm.md"]);
  const want = ["Waiting on you", "To do"].flatMap((l) => board.sections.find((s) => s.label === l)?.items.filter((i) => i.ref !== undefined && refs.has(i.ref)) ?? []);
  const got = nextFromYou(board, e[0], "jd-analysis/acme-pm.md");
  assert.deepEqual(got, want);
  assert.deepEqual(got.map((i) => i.ref), ["applications/acme-pm.md", "applications/acme-pm-cover-letter.md", "jd-analysis/acme-pm.md"]);
  // unlinked: the Analysis path is not in the set
  assert.deepEqual(nextFromYou(board, e[0], undefined).map((i) => i.ref), ["applications/acme-pm.md", "applications/acme-pm-cover-letter.md"]);
  // no match: nothing (the page leaves the part out)
  assert.deepEqual(nextFromYou(board, groupApplications([fi("applications/zeta.md")])[0], null), []);
});

// ------------------------------------------------------------ the § 5.7 fixture

const memIo = (files: Record<string, string>) => ({
  exists: async (p: string) => p in files,
  readFile: async (p: string) => files[p],
  writeFile: async () => {
    throw new Error("read-only");
  },
});

/** What the page must show per entry, derived from § 5.3 over the fixture's
 *  own files and jobs.md rows (never from the page code). */
export async function expectedFixtureEntries(files: Record<string, string>) {
  const rows = (await load(memIo(files), "")) as any[];
  const apps = Object.keys(files).filter((p) => p.startsWith("applications/"));
  const keys = new Map<string, string[]>();
  for (const p of apps) {
    const k = specKey(p) ?? p;
    keys.set(k, [...(keys.get(k) ?? []), p]);
  }
  return [...keys].map(([key, paths]) => {
    const row = specKey(paths[0]) === null ? undefined : rows.find((r) => r.analysis_file === `jd-analysis/${key}.md`);
    const notes = paths.filter((p) => p.endsWith(`/${key}.md`) || p.endsWith(`/${key}-application.md`));
    return {
      key,
      paths: [...paths].sort(),
      notes,
      role: row ? `${row.company} — ${row.title}` : notes[0] ?? [...paths].sort()[0],
      stage: row ? (row.dismissed ? "Dismissed" : row.stage) : null,
      row,
    };
  });
}

test("§ 5.9 3d exit on the § 5.7 fixture: groupApplications' entries, roles, stages and links equal what § 5.3 derives from the fixture's files and jobs.md", async () => {
  const want = await expectedFixtureEntries(FIXTURE);
  const paths = Object.keys(FIXTURE).filter((p) => p.startsWith("applications/"));
  const got = groupApplications(paths.map((p) => fi(p)));
  const rows = (await load(memIo(FIXTURE), "")) as any[];
  const view = got.map((e) => {
    const row = linkedApplicationRow(e, rows);
    const notes = notesFilesOf(e).map((f) => f.path);
    return {
      paths: e.files.map((f) => f.path).sort(),
      role: row ? `${row.company} — ${row.title}` : notes[0] ?? e.files[0].path,
      stage: row ? (row.dismissed ? "Dismissed" : row.stage) : null,
    };
  });
  const wantView = want.map((w) => ({ paths: w.paths, role: w.role, stage: w.stage }));
  const byRole = (a: { role: string }, b: { role: string }) => (a.role < b.role ? -1 : 1);
  assert.deepEqual([...view].sort(byRole), [...wantView].sort(byRole));
  // What § 5.7 asks the fixture to hold for this exit
  assert.ok(want.some((w) => w.notes.some((n) => n.endsWith(`/${w.key}.md`)) && w.row), "no linked <key>.md entry");
  assert.ok(want.some((w) => w.notes.some((n) => n.endsWith("-application.md")) && w.row), "no linked <key>-application.md entry");
  assert.ok(want.some((w) => w.paths.some((p) => p.endsWith(".html"))), "no .html");
  assert.ok(want.some((w) => !w.row && specKey(w.paths[0]) !== null), "no entry whose key matches no jobs.md row");
  // fixture facts this review relies on, spelled out
  assert.deepEqual(
    [...wantView].sort(byRole).map((w) => [w.role, w.stage]),
    [
      ["Fernway Robotics — Senior PM", "Interviewing"],
      ["NovaGrid Energy — Staff PM", "Applied"],
      ["applications/juniper-analytics-pm-resume.md", null],
      ["applications/relocation-notes.txt", null],
    ],
  );
});

test("§ 5.9 3d exit on the § 5.7 fixture: the page's coverage and cut rows equal proposalRows' output field by field (readApplicationTables is proposalRows plus § 19's newline posture)", () => {
  const text = FIXTURE["applications/novagrid-staff-pm-application.md"];
  const direct = proposalRows(text);
  const page = readApplicationTables(text);
  assert.deepEqual(page.coverage, direct.coverage);
  assert.deepEqual(page.cuts, direct.cuts);
  assert.deepEqual(page.unreadable, []);
  // § 5.7: all three statuses, at least two `out` rows
  assert.deepEqual([...new Set(direct.coverage.map((r: string[]) => r[1]))].sort(), ["gap", "have", "shown-but-unnamed"]);
  assert.ok(direct.cuts.length >= 2);
});
