#!/usr/bin/env node
// J1 (docs/design-js-only.md § 5.2): record Python's output as the
// expected-output cases, one JSON file per case, under cases/<script>/.
// Deleted at the end of J1, once all eleven scripts are recorded; it stays
// in git history.
//
//   node tests/checkers/freeze.mjs          # refuses unless python3 --version matches FROZEN_AT
//
// Where the cases come from (§ 5.2):
//   parity-*   every case in packages/checkers/test/parity.mjs
//   extra-*    every case in tests/checkers-parity/extra.mjs (the tester's, plus S1's)
//   py-*       every CLI call the Python tests make to one of the eleven
//              scripts (tests/test_*.py run under a recorder that snapshots
//              the workspace before and after each call; that includes
//              test_e2e_lifecycle, the sequence e2e_both.py replays, and the
//              jobs_md save/round-trip calls in test_search_s1_tester)
//   j1-*       written here from the three unported checkers' Python tests
//              (library-level tests turned into CLI cases), help text for
//              every command, and render_resume --pdf with a stub Chrome
//
// Every case is then run through run-cases.mjs's own python path, so the
// record is exactly what a replay reproduces.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, utimesSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { cpus } from "node:os";
import {
  ROOT, SKILLS, PKG, HERE, CASES_DIR, PORTED, UNPORTED, LIBRARY, base, tokenize,
  freshWs, snapDisk, treeFromState, stateFromTree, diffStates, runCase, scratch, cleanup,
} from "./run-cases.mjs";

const FROZEN = "2026-09-23T12:34:56+00:00";
const FROZEN_AT = join(HERE, "FROZEN_AT");

// ------------------------------------------------------------ the version gate
{
  const want = (readFileSync(FROZEN_AT, "utf-8").match(/^python: (.+)$/m) || [])[1];
  const got = spawnSync("python3", ["--version"], { encoding: "utf-8" });
  const have = (got.stdout || got.stderr || "").trim();
  if (!want || have !== want) {
    console.error(`freeze.mjs refuses: python3 --version is "${have}", FROZEN_AT says "${want}"`);
    process.exit(2);
  }
}

const skeletons = [];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
const groupOf = (steps) => {
  const names = [...new Set(steps.map((s) => base(s.script).replace(/\.py$/, "")))];
  return names.length === 1 ? names[0] : "lifecycle";
};
const warnings = [];
// A file's age is an input only to check_closeout (plan.md must be fresh);
// everywhere else it is noise (a fixture copied with copy2 keeps the repo
// file's own time), so it is kept only in cases that run check_closeout.
function stripMtimes(tree) {
  const out = {};
  for (const [k, v] of Object.entries(tree || {})) {
    if (v && typeof v === "object" && v.mtimeAgo) {
      const { mtimeAgo, ...rest } = v;
      out[k] = rest.base64 !== undefined ? rest : rest.text;
    } else out[k] = v;
  }
  return out;
}
function addSkeleton(id, note, before, steps, extra = {}) {
  const group = groupOf(steps);
  if (!steps.some((s) => base(s.script) === "check_closeout.py")) {
    before = stripMtimes(before);
    for (const s of steps) if (s.write) s.write = stripMtimes(s.write);
  }
  skeletons.push({ id: `${group}/${id}`, note, before, steps, ...extra });
}
// a relative path argument that is not under the workspace would be resolved
// against whatever cwd the replay uses; flag it for review.
function checkArgv(id, argv) {
  for (const a of argv) {
    if (/\/(private\/)?var\/folders\/|^\/tmp\//.test(a) || a.includes(scratch())) warnings.push(`${id}: absolute temp path left in argv: ${a.slice(0, 120)}`);
  }
}

// ------------------------------------------------------------ parity.mjs
{
  const src = readFileSync(join(PKG, "test", "parity.mjs"), "utf-8");
  const cut = src.indexOf("// ---- run the corpus");
  const hereLine = 'const HERE = fileURLToPath(new URL(".", import.meta.url));';
  if (cut < 0 || !src.includes(hereLine)) throw new Error("parity.mjs changed shape; update freeze.mjs's extractor");
  const mod = src.slice(0, cut).replace(hereLine, `const HERE = ${JSON.stringify(join(PKG, "test") + "/")};`) + "\nexport { CASES };\n";
  const f = join(scratch(), "parity-corpus.mjs");
  writeFileSync(f, mod);
  const { CASES } = await import(pathToFileURL(f).href);
  const seen = new Set();
  for (const c of CASES) {
    const ws = freshWs();
    c.setup(ws);
    const argv = c.args(ws).map((a) => tokenize(a, ws));
    const before = treeFromState(snapDisk(ws));
    rmSync(ws, { recursive: true, force: true });
    let id = `parity-${slug(c.name)}`;
    while (seen.has(id)) id += "-b";
    seen.add(id);
    checkArgv(id, argv);
    addSkeleton(id, `packages/checkers/test/parity.mjs: ${c.name} (covers: ${c.covers})`, before,
      [{ script: c.script, argv, cwd: ".", clock: FROZEN }]);
  }
  console.log(`parity.mjs: ${CASES.length} cases`);
}

// ------------------------------------------------------------ extra.mjs
function seedExtra(ws, c) {
  for (const d of c.dirs || []) mkdirSync(join(ws, d), { recursive: true });
  for (const [rel, content] of Object.entries(c.files || {})) {
    const p = join(ws, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  for (const rel of c.old || []) utimesSync(join(ws, rel), old, old);
}
{
  const EXTRA = join(ROOT, "tests", "checkers-parity", "extra.mjs");
  const src = readFileSync(EXTRA, "utf-8");
  const cut = src.indexOf("// ------------------------------------------------------------------ engines");
  const hereLine = "const HERE = dirname(fileURLToPath(import.meta.url));";
  if (cut < 0 || !src.includes(hereLine)) throw new Error("extra.mjs changed shape; update freeze.mjs's extractor");
  const mod = src.slice(0, cut).replace(hereLine, `const HERE = ${JSON.stringify(dirname(EXTRA))};`) + "\nexport { C, SCRIPTS };\n";
  const f = join(scratch(), "extra-corpus.mjs");
  writeFileSync(f, mod);
  process.env.PARITY_SCRATCH = scratch(); // extra.mjs makes a temp dir on import otherwise
  const { C, SCRIPTS } = await import(pathToFileURL(f).href);
  for (const c of C) {
    const ws = freshWs();
    seedExtra(ws, c);
    const before = treeFromState(snapDisk(ws));
    rmSync(ws, { recursive: true, force: true });
    const argv = c.args.map((a) => tokenize(a, ws));
    const id = `extra-${slug(c.id)}`;
    checkArgv(id, argv);
    addSkeleton(id, `tests/checkers-parity/extra.mjs: ${c.id}${c.note ? ` — ${c.note}` : ""}`, before,
      [{ script: SCRIPTS[c.s], argv, cwd: c.cwdRel || ".", clock: FROZEN }],
      c.mount === "design" ? { webSkillsInWorkspace: true } : {});
  }
  console.log(`extra.mjs: ${C.length} cases`);
}

// ------------------------------------------------------------ the J1 corpus (written here)
{
  const J = [];
  const add = (c) => J.push(c);
  const CRLF = (s) => s.replace(/\n/g, "\r\n");

  // ---- help text for every command (§ 5.5's rename check needs each one)
  const ALL = {
    check_materials: "apply/scripts/check_materials.py", proposal_block: "apply/scripts/proposal_block.py",
    render_resume: "apply/scripts/render_resume.py", record_verdict: "evaluate/scripts/record_verdict.py",
    update_job: "search/scripts/update_job.py", check_files: "profile/scripts/check_files.py",
    check_closeout: "coach/scripts/check_closeout.py", check_knowledge: "learn/scripts/check_knowledge.py",
    check_messages: "outreach/scripts/check_messages.py", check_stories: "storybank/scripts/check_stories.py",
  };
  for (const [n, s] of Object.entries(ALL)) {
    add({ s, id: `help-${n}`, files: {}, args: ["-h"], note: "help text names the script (§ 5.5's rename check)" });
    add({ s, id: `no-args-${n}`, files: {}, args: [], note: "argparse with no arguments" });
  }

  // ---- check_knowledge (tests/test_check_knowledge.py; learn/references schema)
  {
    const s = ALL.check_knowledge;
    const HEAD = "# K\n\n## Map\n\n| Topic | Scope | Source | Status |\n|---|---|---|---|\n";
    const W = ["--workspace", "."];
    const k = (id, text, note, extra = {}) => add({ s, id: `ck-${id}`, files: text === null ? {} : { "knowledge.md": text }, args: W, note, ...extra });
    k("no-file", null, "covers: test_check_knowledge.py (absent file is not an error)");
    k("clean", HEAD + "| X | track-A | [inferred] | gap |\n| Y | role: mesh-head-of-fde | Mesh JD | studying |\n", "covers: tests/test_check_knowledge.py::test_clean_map_passes (CLI, fixed path)");
    k("em-dash-scope", HEAD + "| X | role: mesh—head-of-fde | Mesh JD | gap |\n", "covers: tests/test_check_knowledge.py::test_em_dash_scope_fails");
    k("prose-status", HEAD + "| X | track-A | [inferred] | gap (long shot, skip) |\n", "covers: tests/test_check_knowledge.py::test_prose_status_fails");
    k("every-status-and-scope-form", HEAD + "| a | track-A1 | s | gap |\n| b | role: a.b/c-d | s | studying |\n| c | track-x | s | credible |\n| d | role: 9x | s | retired |\n", "every legal status and scope form");
    k("scope-near-misses", HEAD + "| a | track- | s | gap |\n| b | role:  x | s | gap |\n| c | role: X | s | gap |\n| d | Track-A | s | gap |\n| e | role: -x | s | gap |\n| f | track-A B | s | gap |\n", "scope forms one character off");
    k("status-near-misses", HEAD + "| a | track-A | s | Gap |\n| b | track-A | s | gap. |\n| c | track-A | s |  |\n| d | track-A | s | credible, mostly |\n", "status forms one character off; an empty status");
    k("topic-truncated-40-code-points", HEAD + `| ${"é".repeat(30)}${"🚀".repeat(15)} | bad | s | gap |\n`, "topic[:40] counts code points (an astral character is one)");
    k("repr-quotes-and-escapes", HEAD + "| q1 | it's | s | gap |\n| q2 | say \"hi\" it's | s | gap |\n| q3 | tab\there | s | gap |\n| q4 | café | s | gap  |\n| q5 | a b | s | gap |\n| q6 | back\\slash | s | gap |\n",
      "Python repr() of the bad cell: quote choice, escapes, a non-printable character");
    k("missing-status-column", "# K\n\n## Map\n\n| Topic | Scope |\n|---|---|\n| X | track-A |\n", "no Status column: the row's status is empty");
    k("missing-topic-column", "# K\n\n## Map\n\n| Scope | Status |\n|---|---|\n| bad | gap |\n", "no Topic column: the topic prints as ?");
    k("extra-and-short-rows", HEAD + "| X | track-A | s | gap | extra |\n| Y | track-A |\n", "zip() stops at the shorter of header and row");
    k("header-case-and-spaces", "# K\n\n## Map\n\n|  TOPIC | scope  | Source | STATUS |\n|:---|---:|:-:|---|\n| X | track-A | s | gap |\n", "header matched lower-cased; alignment separators skipped");
    k("map-heading-variants", "# K\n\n## MAP of topics\n\n| Topic | Scope | Source | Status |\n|---|---|---|---|\n| X | bad | s | gap |\n\n## Notes\n\n| Topic | Scope | Source | Status |\n|---|---|---|---|\n| Y | bad | s | gap |\n\n## map\n\n| Topic | Scope | Source | Status |\n|---|---|---|---|\n| Z | track-A | s | nope |\n",
      "a heading starting with map (any case) opens a map; any other ## closes it");
    k("h3-does-not-close-map", HEAD + "| X | track-A | s | gap |\n\n### Sub\n\n| Y | bad | s | gap |\n", "### is not a ## heading");
    k("no-map-section", "# K\n\n## Topics\n\n| Topic | Scope | Source | Status |\n|---|---|---|---|\n| X | bad | s | bad |\n", "tables outside a Map section are ignored");
    k("header-only", HEAD, "no rows");
    k("indented-rows-and-trailing-space", "# K\n\n## Map\n\n  | Topic | Scope | Source | Status |  \n|---|---|---|---|\n   | X | track-A | s | gap |   \n", "leading/trailing whitespace around a row");
    k("escaped-pipe-splits", HEAD + "| a \\| b | track-A | s | gap |\n", "an escaped pipe still splits the row (plain split)");
    k("crlf", CRLF(HEAD + "| X | track-A | s | gap |\n| Y | bad | s | gap |\n"), "CRLF file");
    k("lone-cr", (HEAD + "| X | track-A | s | gap |\n| Y | bad | s | gap |\n").replace(/\n/g, "\r"), "lone CR line endings (universal newlines)");
    k("bom-before-map-heading", "﻿## Map\n\n| Topic | Scope | Source | Status |\n|---|---|---|---|\n| X | bad | s | gap |\n", "a BOM before the first heading hides it");
    k("u2028-in-row", HEAD + "| X | track-A | s | gap | | Y | bad | s | gap |\n", "U+2028 inside a line is not a line break to file iteration");
    k("whitespace-status-cells", HEAD + "| X | track-A | s | \u0085gap\u0085 |\n| Y | track-A | s |  gap |\n| Z | track-A | s | \x1cgap |\n", "str.strip() whitespace set (NEL, NBSP, \\x1c)");
    k("unicode-digits-and-letters", HEAD + "| X | track-Ａ | s | gap |\n| Y | role: é-x | s | gap |\n| Z | track-٣ | s | gap |\n", "A-Za-z0-9 are ASCII only");
    k("latin1-bytes", Buffer.from("# K\n\n## Map\n\n| Topic | Scope | Source | Status |\n|---|---|---|---|\n| caf\xe9 | track-A | s | gap |\n", "latin1"), "invalid UTF-8: Python crashes (first line compared)");
    add({ s, id: "ck-knowledge-md-is-a-directory", files: {}, dirs: ["knowledge.md"], args: W, note: "knowledge.md is a folder: open() crashes" });
    add({ s, id: "ck-workspace-is-a-file", files: { "f": "x" }, args: ["--workspace", "f"], note: "a file as the workspace: no knowledge.md under it" });
    add({ s, id: "ck-arg-equals-and-abbrev", files: { "knowledge.md": HEAD + "| X | bad | s | gap |\n" }, args: ["--work=."], note: "argparse --flag=value and a prefix" });
    add({ s, id: "ck-arg-unknown", files: {}, args: ["--workspace", ".", "--bogus"], note: "argparse: unrecognized arguments" });
    add({ s, id: "ck-arg-missing-value", files: {}, args: ["--workspace"], note: "argparse: expected one argument" });
    add({ s, id: "ck-cwd-below-workspace", files: { "knowledge.md": HEAD + "| X | bad | s | gap |\n", "sub/x.md": "x\n" }, cwdRel: "sub", args: ["--workspace", ".."], note: "run from a folder below the workspace" });
  }

  // ---- check_stories (tests/test_check_stories.py)
  {
    const s = ALL.check_stories;
    const HEAD = "# Storybank\n\n## Coverage\n\n| Competency | Source | Covered by |\n|---|---|---|\n| X | [inferred] | S001 |\n\n## Stories\n\n| ID | Title | Strength | Status | Notes |\n|---|---|---|---|---|\n";
    const W = ["--workspace", "."];
    const st = (id, rows, stories, note, extra = {}) => {
      const files = rows === null ? {} : { "storybank.md": HEAD + rows };
      for (const n of stories) files[`stories/${n}`] = "# story\n";
      add({ s, id: `cs-${id}`, files, args: W, note, ...extra });
    };
    st("no-file", null, [], "no storybank.md: nothing to check");
    st("clean", "| S001 | A | 4 | confirmed | |\n| S002 | B | 2 | draft [source: old-resume.pdf] | |\n", ["S001-a.md", "S002-b.md"], "covers: tests/test_check_stories.py::test_clean_bank_passes (CLI, fixed path)");
    st("duplicate-id", "| S001 | A | 4 | confirmed | |\n| S001 | B | 3 | confirmed | |\n", ["S001-a.md"], "covers: tests/test_check_stories.py::test_duplicate_id_fails");
    st("bad-status", "| S001 | A | 4 | pending | |\n", ["S001-a.md"], "covers: tests/test_check_stories.py::test_bad_status_fails");
    st("row-without-file-and-orphan", "| S001 | A | 4 | confirmed | |\n", ["S002-b.md"], "covers: tests/test_check_stories.py::test_row_without_file_and_orphan_file_fail");
    st("id-gap-warns", "| S001 | A | 4 | confirmed | |\n| S003 | C | 3 | confirmed | |\n", ["S001-a.md", "S003-c.md"], "covers: tests/test_check_stories.py::test_id_gap_warns_but_passes");
    st("empty-bank", "", [], "covers: tests/test_check_stories.py::test_empty_bank_passes (no stories/ folder at all)");
    st("malformed-ids", "| S01 | A | 4 | confirmed | |\n| s001 | B | 4 | confirmed | |\n| S001a | C | 4 | confirmed | |\n|  | D | 4 | confirmed | |\n| S１２３ | E | 4 | confirmed | |\n", [], "malformed IDs, an empty ID, full-width digits");
    st("four-digit-ids-and-gaps", "| S0001 | A | 4 | confirmed | |\n| S001 | B | 4 | confirmed | |\n| S0005 | C | 4 | confirmed | |\n", ["S0001-a.md", "S001-b.md", "S0005-c.md"], "S0001 and S001 are two IDs with one number; gaps printed as S###");
    st("status-near-misses", "| S001 | A | 4 | Confirmed | |\n| S002 | B | 4 | draft [source: ] | |\n| S003 | C | 4 | draft [source: a] extra | |\n| S004 | D | 4 | draft [source: x]] | |\n| S005 | E | 4 |  confirmed  | |\n| S006 | F | 4 | draft [source: a|b] | |\n",
      ["S001-a.md", "S002-a.md", "S003-a.md", "S004-a.md", "S005-a.md", "S006-a.md"], "status one character off; a pipe inside the source splits the cell");
    st("repr-of-status", "| S001 | A | 4 | it's | |\n| S002 | B | 4 | \"q\" it's | |\n| S003 | C | 4 | café x | |\n", ["S001-a.md", "S002-a.md", "S003-a.md"], "Python repr() of the bad status");
    st("file-name-forms", "| S001 | A | 4 | confirmed | |\n| S002 | B | 4 | confirmed | |\n", ["S001.md", "S002-b.txt", "notes.md", "S1-x.md", "S0002-x.md"], "files the glob or the S###- pattern skips; S0002 is not S002");
    add({ s, id: "cs-story-in-subfolder-ignored", files: { "storybank.md": HEAD + "| S001 | A | 4 | confirmed | |\n", "stories/old/S001-a.md": "# s\n" }, args: W, note: "the glob is not recursive" });
    add({ s, id: "cs-bold-header", files: { "storybank.md": "# Storybank\n\n## Stories\n\n| **ID** | Title | Strength | **Status** | Notes |\n|---|---|---|---|---|\n| S001 | A | 4 | confirmed | |\n", "stories/S001-a.md": "# s\n" }, args: W, note: "header cells lose * and spaces" });
    add({ s, id: "cs-no-status-column", files: { "storybank.md": "# Storybank\n\n## Stories\n\n| ID | Title |\n|---|---|\n| S001 | A |\n", "stories/S001-a.md": "# s\n" }, args: W, note: "no Status column: status is empty, so invalid" });
    add({ s, id: "cs-stories-heading-variants", files: { "storybank.md": "# Storybank\n\n## Stories (12)\n\n| ID | Status |\n|---|---|\n| S001 | confirmed |\n\n## Story bank\n\n| ID | Status |\n|---|---|\n| bad | x |\n\n## STORIES\n\n| ID | Status |\n|---|---|\n| S002 | nope |\n", "stories/S001-a.md": "# s\n", "stories/S002-a.md": "# s\n" }, args: W, note: "## Stories... opens the table; other ## headings close it" });
    add({ s, id: "cs-crlf", files: { "storybank.md": CRLF(HEAD + "| S001 | A | 4 | confirmed | |\n| S001 | B | 4 | nope | |\n"), "stories/S001-a.md": "# s\n" }, args: W, note: "CRLF index" });
    add({ s, id: "cs-latin1-bytes", files: { "storybank.md": Buffer.from(HEAD + "| S001 | caf\xe9 | 4 | confirmed | |\n", "latin1") }, args: W, note: "invalid UTF-8: Python crashes (first line compared)" });
    add({ s, id: "cs-storybank-is-a-directory", files: {}, dirs: ["storybank.md"], args: W, note: "storybank.md is a folder: open() crashes" });
    add({ s, id: "cs-cwd-below-workspace", files: { "storybank.md": HEAD + "| S001 | A | 4 | confirmed | |\n", "stories/S001-a.md": "# s\n" }, cwdRel: "stories", args: ["--workspace", ".."], note: "run from a folder below the workspace" });
    add({ s, id: "cs-arg-unknown", files: {}, args: ["--workspace", ".", "--fix"], note: "argparse: unrecognized arguments" });
    // Not recorded on purpose: two orphan story files, or two files for one ID
    // with no row. The script walks glob() in the file system's own order,
    // so their message order is not deterministic (reported to the lead).
  }

  // ---- check_messages (tests/test_check_messages.py, test_three_lens_review.py)
  {
    const s = ALL.check_messages;
    const W = ["--workspace", ".", "--contacts", "contacts/acme.md"];
    const PINNED = "# P\n\n## Messages rubric\n\nPINNED 2026-08-17\n| tier | claim |\n";
    const m = (id, contacts, note, pitch = PINNED, extra = {}) => {
      const files = { "contacts/acme.md": contacts };
      if (pitch !== null) files["pitch.md"] = pitch;
      add({ s, id: `cmsg-${id}`, files, args: W, note, ...extra });
    };
    const D = "> Hi Sam, saw your eval write-up. Would love to connect.\n";
    m("rubric-absent", D, "covers: tests/test_check_messages.py::test_rubric_pinned_probe (no pitch.md: WARN)", null);
    m("rubric-proposed", D, "covers: tests/test_check_messages.py::test_rubric_pinned_probe (PROPOSED: WARN)", "# P\n\n## Messages rubric\n\nPROPOSED — confirm with the candidate\n| tier | claim |\n");
    m("rubric-pinned", D, "covers: tests/test_check_messages.py::test_rubric_pinned_probe (PINNED: no WARN)");
    m("rubric-no-section", D, "pitch.md with no Messages rubric section: WARN", "# P\n\n## Pitch\n\nx\n");
    m("rubric-proposed-after-400-chars", D, "the PROPOSED probe reads only the first 400 characters of the section", "# P\n\n## messages RUBRIC\n\n" + "x".repeat(420) + " proposed\n");
    m("rubric-proposed-in-next-section", D, "PROPOSED in the next ## section does not count", "# P\n\n## Messages rubric\n\nPINNED\n\n## Other\n\nPROPOSED\n");
    m("rubric-watch-rows", D, "the two-WATCH-row rubric fixture (PROPOSED below the table)", "# Pitch\n\n## Messages rubric\n\n| Tier | Claims |\n|---|---|\n| PRIMARY | good claim |\n| ⚠ WATCH | \"$500M projected\" — projected travels with it |\n| ⚠ WATCH | \"193K lines\" — qualified or unused |\n\nStatus: PROPOSED 2026-08-15 — pin pending.\n");
    m("third-party-quote-not-a-draft", "Enrichment hook — their own post: \"we need more synergy here\"\n\n> Hi — saw your eval write-up. Would love to connect.\n", "covers: tests/test_check_messages.py::test_never_say_scopes_to_drafts_not_third_party_quotes");
    m("multiparagraph-draft-is-one", "**To the HM:**\n\n> First paragraph of the message, quite long indeed.\n\n> Second paragraph continues the same single message.\n\nSome prose after.\n\n> A second, separate draft.\n", "covers: tests/test_check_messages.py::test_multiparagraph_draft_is_one_draft");
    m("year-count-unquoted-fails-quoted-exempt", "> I've spent 20 years making products reliable.\n\nnote\n\n> Your posting asks for \"10+ years in ML infra\" — here is my answer.\n", "covers: tests/test_check_messages.py::test_year_count_fails_unquoted_but_quoted_jd_bar_exempt");
    m("year-count-forms", "> 15+ years here.\n\nx\n\n> 20 + years there.\n\nx\n\n> 30 YEARS of work.\n\nx\n\n> 100 years is not two digits.\n\nx\n\n> “12+ years” in curly quotes is exempt.\n\nx\n\n> 5 years is one digit.\n", "YEAR_COUNT forms: +, spaces, case, three digits, curly quotes, one digit");
    m("year-count-unicode-digits-and-boundaries", "> ٢٠ years in Arabic-Indic digits.\n\nx\n\n> café20 years glued to a letter.\n\nx\n\n> x_20 years after an underscore.\n", "Python's \\d and \\b are Unicode-aware");
    m("arrow-glyph-live-defect", "> batch failures 80%→<1%\n\nx\n\n> batch failures from 80% to under 1%\n", "covers: tests/test_check_messages.py::test_arrow_glyph_matches_the_live_defect");
    m("every-arrow-glyph", "> a → b\n\nx\n\n> a ⇒ b\n\nx\n\n> a ▸ b\n\nx\n\n> a ► b\n\nx\n\n> a ◄ b\n\nx\n\n> a ← b\n\nx\n\n> a ↔ b\n", "each glyph in ARROW_GLYPHS");
    m("ascii-arrow-in-draft-fails", "> Grew signal 80%->90% this quarter, consistently, across every team we support.\n", "covers: tests/test_check_messages.py::test_ascii_arrow_in_draft_fails_and_in_url_is_exempt (draft)");
    m("ascii-arrow-in-url-exempt", "> See https://example.com/a->b for the writeup, thanks for reading it all today.\n", "covers: tests/test_check_messages.py::test_ascii_arrow_in_draft_fails_and_in_url_is_exempt (url)");
    m("ascii-arrow-forms-and-spans", "> a<=>b\n\nx\n\n> a<-b\n\nx\n\n> a==>b\n\nx\n\n> keep `a->b` then c=>d\n\nx\n\n> <!-- a->b --> fine\n\nx\n\n> HTTPS://x.com/a->b is case-bound\n", "ASCII arrow forms; exempt spans inside one draft line");
    m("no-drafts", "# Acme\n\nJust notes, no blockquotes.\n", "no draft blockquotes: WARN, exit 0");
    m("connect-limit-and-thankyou-limit", "> " + "word ".repeat(125).trim() + " " + "x".repeat(10) + "\n", "over 300 characters and over 120 words");
    m("astral-characters-under-the-limit", "> " + "a".repeat(290) + " 🚀🚀🚀\n", "len() counts code points: 294 characters, under the 300 limit (a UTF-16 count would be 297)");
    m("astral-characters-over-the-limit", "> " + "a".repeat(296) + " 🚀🚀🚀🚀\n", "301 code points: over the limit");
    m("python-whitespace-in-word-count", "> one\x1ctwo\x1dthree\u0085four five　six\n", "str.split() whitespace: \\x1c-\\x1f, NEL, NBSP, U+3000");
    m("splitlines-breaks-on-u2028", "> first part second part of the same line\n\n> other\u000bthird\n", "str.splitlines() breaks on U+2028 and \\v; the rest is prose and closes the draft");
    m("blockquote-markers", ">> nested quote\n>no space\n>    lots of space   \n>\n> > spaced nested\n", "lstrip('> ') strips every leading > and space; an empty > line joins nothing");
    m("crlf-contacts", CRLF("# Acme\n\n> Hi Sam -> one question.\n\nNotes a->b.\n"), "CRLF contacts file");
    m("bom-first-line", "﻿> Hi Sam, a->b first line after a BOM.\n\n> Second draft.\n", "a BOM before the first > makes that line prose");
    m("three-lens-draft-spans", "> Notes ``a->b`` stay internal.\n\nx\n\n> ~~~\n> a->b\n> ~~~\n> Thanks for the time.\n", "the round-2 exempt spans inside drafts");
    add({ s, id: "cmsg-contacts-missing", files: { "pitch.md": PINNED }, args: W, note: "missing contacts file: Python crashes (first line compared)" });
    add({ s, id: "cmsg-contacts-latin1", files: { "pitch.md": PINNED, "contacts/acme.md": Buffer.from("> caf\xe9\n", "latin1") }, args: W, note: "invalid UTF-8: Python crashes" });
    add({ s, id: "cmsg-pitch-latin1", files: { "pitch.md": Buffer.from("## Messages rubric\ncaf\xe9\n", "latin1"), "contacts/acme.md": D }, args: W, note: "invalid UTF-8 in pitch.md: Python crashes" });
    add({ s, id: "cmsg-contacts-absolute-and-cwd-below", files: { "pitch.md": PINNED, "contacts/acme.md": D }, cwdRel: "contacts", args: ["--workspace", "..", "--contacts", "acme.md"], note: "run from contacts/: --contacts resolves against cwd" });
    add({ s, id: "cmsg-arg-missing-contacts", files: {}, args: ["--workspace", "."], note: "argparse: --contacts required" });
    add({ s, id: "cmsg-arg-abbrev", files: { "pitch.md": PINNED, "contacts/acme.md": D }, args: ["--w", ".", "--c=contacts/acme.md"], note: "argparse prefixes and --flag=value" });
  }

  // ---- render_resume --pdf (§ 5.2): a stub Chrome on PATH, and no Chrome
  {
    const s = ALL.render_resume;
    const MD = "# Alex Chen\n\n## Summary\n\nPlatform leader.\n\n## Experience\n\n- Built the **deploy** machine.\n";
    add({ s, id: "pdf-stub-2pages-html-in-ws", files: { "r.md": MD }, args: ["--md", "r.md", "--html", "out.html", "--pdf", "out.pdf"], chrome: "stub-2pages", note: "stub Chrome writes a fixed two-page PDF" });
    add({ s, id: "pdf-stub-2pages-html-tmp", files: { "r.md": MD }, args: ["--md", "r.md", "--pdf", "out.pdf"], chrome: "stub-2pages", note: "HTML to a random temp folder, masked to <tmp>" });
    add({ s, id: "pdf-stub-2pages-over-target-strict", files: { "r.md": MD }, args: ["--md", "r.md", "--html", "out.html", "--pdf", "out.pdf", "--pages", "1", "--strict"], chrome: "stub-2pages", note: "over the page target with --strict: exit 1" });
    add({ s, id: "pdf-stub-big-file", files: { "r.md": MD }, args: ["--md", "r.md", "--html", "out.html", "--pdf", "out.pdf"], chrome: "stub-big", note: "a PDF over ~100KB" });
    add({ s, id: "pdf-stub-writes-no-file", files: { "r.md": MD }, args: ["--md", "r.md", "--html", "out.html", "--pdf", "out.pdf"], chrome: "stub-nofile", note: "Chrome runs but produces no file" });
    add({ s, id: "pdf-no-chrome", files: { "r.md": MD }, args: ["--md", "r.md", "--html", "out.html", "--pdf", "out.pdf"], chrome: "none", note: "no Chrome at all" });
    add({ s, id: "no-html-tmp-path", files: { "r.md": MD }, args: ["--md", "r.md"], note: "no --html: the random temp folder is masked, the file name kept" });
  }

  for (const c of J) {
    const ws = freshWs();
    seedExtra(ws, c);
    const before = treeFromState(snapDisk(ws));
    rmSync(ws, { recursive: true, force: true });
    const step = { script: c.s, argv: c.args, cwd: c.cwdRel || ".", clock: FROZEN };
    if (c.chrome) step.chrome = c.chrome;
    addSkeleton(`j1-${c.id}`, `tests/checkers/freeze.mjs (J1): ${c.note}`, before, [step]);
  }
  console.log(`J1 corpus: ${J.length} cases`);
}

// ------------------------------------------------------------ the Python tests' CLI calls
const RECORDER = String.raw`
import sys, os, json, base64, time, subprocess, importlib, glob, traceback
ROOT, OUT = sys.argv[1], sys.argv[2]
TESTS = os.path.join(ROOT, "tests"); SKILLS = os.path.join(ROOT, "skills")
sys.path.insert(0, TESTS); sys.path.insert(0, os.path.join(SKILLS, "profile", "scripts"))
NAMES = set(json.loads(sys.argv[3]))
SCRIPTS = {}
for p in glob.glob(os.path.join(SKILLS, "*", "scripts", "*.py")):
    if os.path.basename(p) in NAMES:
        SCRIPTS[os.path.realpath(p)] = os.path.relpath(p, SKILLS)
RROOT = os.path.realpath(ROOT)
orig = subprocess.run
recs, skipped, jm_ops, failures = [], [], [], []
cur = {"test": None}

def snap(ws):
    files, dirs, now = {}, [], time.time()
    for dp, dns, fns in os.walk(ws):
        dns.sort()
        for d in dns:
            dirs.append(os.path.relpath(os.path.join(dp, d), ws))
        for f in sorted(fns):
            p = os.path.join(dp, f)
            if os.path.islink(p):
                continue
            with open(p, "rb") as fh:
                data = fh.read()
            files[os.path.relpath(p, ws)] = {"b64": base64.b64encode(data).decode(), "ago": now - os.stat(p).st_mtime}
    return {"files": files, "dirs": dirs}

def opt(args, name):
    for i, a in enumerate(args):
        if a == name and i + 1 < len(args):
            return args[i + 1]
        if a.startswith(name + "="):
            return a.split("=", 1)[1]
    return None

def text(x):
    if x is None:
        return None
    return x if isinstance(x, str) else x.decode("utf-8", "replace")

def record(cmd, idx, a, kw):
    script = SCRIPTS[os.path.realpath(cmd[idx])]
    args = [str(x) for x in cmd[idx + 1:]]
    why = None
    if kw.get("input") is not None or kw.get("stdin") is not None:
        why = "stdin"
    env = kw.get("env")
    if env and not why:
        diff = sorted(k for k, v in env.items() if os.environ.get(k) != v)
        if diff:
            why = "env " + ",".join(diff)
    cwd = kw.get("cwd")
    basedir = os.path.realpath(cwd) if cwd else os.getcwd()
    wsarg = opt(args, "--workspace")
    ws = os.path.realpath(os.path.join(basedir, os.path.expanduser(wsarg))) if wsarg else (os.path.realpath(cwd) if cwd else None)
    if not why and ws is None:
        why = "no workspace"
    if not why and (ws == RROOT or ws.startswith(RROOT + os.sep)):
        why = "workspace inside the repo"
    if not why and not os.path.isdir(ws):
        why = "workspace is not a folder"
    run_cwd = os.path.realpath(cwd) if cwd else None
    if not why and run_cwd and not (run_cwd == ws or run_cwd.startswith(ws + os.sep)):
        why = "cwd outside the workspace"
    if not why and not cwd:
        for x in args:
            if not x.startswith("-") and not os.path.isabs(x) and ("/" in x or x.endswith(".md")) and os.path.exists(os.path.join(os.getcwd(), x)):
                why = "relative path resolved against the runner's cwd: " + x
    if why:
        skipped.append({"test": cur["test"], "script": script, "why": why, "args": args[:8]})
        return orig(cmd, *a, **kw)
    pre = snap(ws)
    res = orig(cmd, *a, **kw)
    post = snap(ws)
    recs.append({"test": cur["test"], "script": script, "args": args, "ws": ws,
                 "cwd": os.path.relpath(run_cwd, ws) if run_cwd else ".",
                 "pre": pre, "post": post, "exit": res.returncode,
                 "stdout": text(res.stdout), "stderr": text(res.stderr)})
    return res

def run(cmd, *a, **kw):
    try:
        if isinstance(cmd, (list, tuple)) and cmd and "python" in os.path.basename(str(cmd[0])):
            idx = next((i for i, x in enumerate(cmd) if isinstance(x, str) and x.endswith(".py") and os.path.realpath(x) in SCRIPTS), None)
            if idx is not None:
                return record(list(cmd), idx, a, kw)
    except Exception as e:
        skipped.append({"test": cur["test"], "why": "recorder error " + repr(e)})
    return orig(cmd, *a, **kw)

subprocess.run = run

def hook_s1(mod):
    o_save, o_rt = mod._both_save, mod._both_roundtrip
    def _both_save(rows, notes=None):
        jm_ops.append({"test": cur["test"], "op": "save", "rows": json.dumps(rows, ensure_ascii=False), "notes": json.dumps(notes, ensure_ascii=False)})
        return o_save(rows, notes)
    def _both_roundtrip(seed_bytes):
        jm_ops.append({"test": cur["test"], "op": "roundtrip", "seed": base64.b64encode(seed_bytes).decode()})
        return o_rt(seed_bytes)
    mod._both_save, mod._both_roundtrip = _both_save, _both_roundtrip

for path in sorted(glob.glob(os.path.join(TESTS, "test_*.py"))):
    name = os.path.basename(path)[:-3]
    mod = importlib.import_module(name)
    if name == "test_search_s1_tester":
        hook_s1(mod)
    for fn in sorted(dir(mod)):
        if fn.startswith("test_"):
            cur["test"] = name + "::" + fn
            try:
                getattr(mod, fn)()
            except Exception:
                failures.append({"test": cur["test"], "tb": traceback.format_exc()[-2000:]})
json.dump({"recs": recs, "skipped": skipped, "jm_ops": jm_ops, "failures": failures}, open(OUT, "w"))
`;
{
  const out = join(scratch(), "py-recorded.json");
  const names = [...Object.keys(PORTED), ...UNPORTED];
  const r = spawnSync("python3", ["-c", RECORDER, ROOT, out, JSON.stringify(names)], { cwd: ROOT, encoding: "utf-8", maxBuffer: 1 << 30 });
  if (r.status !== 0 || !existsSync(out)) {
    console.error(r.stdout.slice(-4000), r.stderr.slice(-4000));
    throw new Error("the Python recorder failed");
  }
  const { recs, skipped, jm_ops, failures } = JSON.parse(readFileSync(out, "utf-8"));
  if (failures.length) {
    for (const f of failures) console.error(`PYTHON TEST FAILED under the recorder: ${f.test}\n${f.tb}`);
    throw new Error("a Python test failed while recording");
  }
  const fromSnap = (s, now) => {
    const st = { files: new Map(), dirs: new Set(s.dirs) };
    for (const [k, v] of Object.entries(s.files)) {
      const ago = Math.round(v.ago);
      st.files.set(k, ago > 60 ? { buf: Buffer.from(v.b64, "base64"), mtimeAgo: ago } : { buf: Buffer.from(v.b64, "base64") });
    }
    return st;
  };
  // group consecutive calls by (test, workspace)
  const groups = new Map();
  for (const rc of recs) {
    const k = `${rc.test}\u0000${rc.ws}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(rc);
  }
  const perTest = {};
  const observed = {};
  for (const calls of groups.values()) {
    const test = calls[0].test;
    const [modName, fn] = test.split("::");
    perTest[test] = (perTest[test] || 0) + 1;
    const n = perTest[test];
    const steps = [];
    let prevPost = null;
    for (const rc of calls) {
      const step = { script: rc.script, argv: rc.args.map((a) => tokenize(a, rc.ws)), cwd: rc.cwd, clock: FROZEN };
      if (prevPost) {
        const w = diffStates(fromSnap(prevPost), fromSnap(rc.pre));
        if (Object.keys(w).length) step.write = w;
      }
      steps.push(step);
      prevPost = rc.post;
    }
    const id = `py-${slug(modName.replace(/^test_/, ""))}-${slug(fn.replace(/^test_/, ""))}${n > 1 ? `-${n}` : ""}`;
    for (const st of steps) checkArgv(id, st.argv);
    const before = treeFromState(fromSnap(calls[0].pre));
    addSkeleton(id, `tests/${modName}.py::${fn}${steps.length > 1 ? ` (${steps.length} calls on one workspace)` : ""}`, before, steps);
    observed[skeletons[skeletons.length - 1].id] = calls.map((rc) => ({ stdout: tokenize(rc.stdout || "", rc.ws), exit: rc.exit, script: rc.script }));
  }
  const opsPerTest = {};
  for (const op of jm_ops) {
    const [modName, fn] = op.test.split("::");
    opsPerTest[op.test] = (opsPerTest[op.test] || 0) + 1;
    const id = `py-${slug(modName.replace(/^test_/, ""))}-${slug(fn.replace(/^test_/, ""))}-${op.op}-${opsPerTest[op.test]}`;
    const before = op.op === "roundtrip" ? treeFromState({ files: new Map([["jobs.md", { buf: Buffer.from(op.seed, "base64") }]]), dirs: new Set() }) : {};
    const argv = op.op === "roundtrip" ? ["roundtrip", "<ws>"] : ["save", "<ws>", op.rows, op.notes];
    addSkeleton(id, `tests/${modName}.py::${fn} (jobs_md.${op.op === "save" ? "save" : "load then save"}, as _both_${op.op === "save" ? "save" : "roundtrip"} calls it)`, before,
      [{ script: "search/scripts/jobs_md.py", argv, cwd: ".", clock: FROZEN }]);
  }
  console.log(`Python tests: ${recs.length} script calls in ${groups.size} cases; ${jm_ops.length} jobs_md operations; ${skipped.length} calls not recorded`);
  for (const s of skipped) console.log(`  not recorded: ${s.test} ${s.script || ""} — ${s.why}`);
  globalThis.__observed = observed;
}

// ------------------------------------------------------------ record through the python path
{
  const ids = new Set();
  for (const s of skeletons) {
    if (ids.has(s.id)) throw new Error(`duplicate case id ${s.id}`);
    ids.add(s.id);
  }
  if (existsSync(CASES_DIR)) rmSync(CASES_DIR, { recursive: true, force: true });
  let next = 0, done = 0;
  const mismatch = [];
  const conc = Math.max(2, Math.min(12, cpus().length));
  const worker = async () => {
    while (next < skeletons.length) {
      const sk = skeletons[next++];
      const rec = await runCase({ before: sk.before, steps: sk.steps, webSkillsInWorkspace: sk.webSkillsInWorkspace }, "python", { record: true });
      const multi = sk.steps.length > 1;
      const c = { note: sk.note };
      if (sk.webSkillsInWorkspace) c.webSkillsInWorkspace = true;
      c.steps = sk.steps;
      c.before = sk.before;
      c.expect = rec.steps.map((x) => x.expect);
      c.after = multi ? diffStates(stateFromTree(sk.before), rec.steps[rec.steps.length - 1].post) : diffStates(rec.steps[0].pre, rec.steps[0].post);
      const [group, name] = sk.id.split("/");
      mkdirSync(join(CASES_DIR, group), { recursive: true });
      writeFileSync(join(CASES_DIR, group, `${name}.json`), JSON.stringify(c, null, 1) + "\n");
      const obs = globalThis.__observed[sk.id];
      if (obs) obs.forEach((o, i) => {
        const w = c.expect[i];
        if (o.exit !== w.exit || (o.stdout !== w.stdout && !["record_verdict.py", "update_job.py"].includes(base(o.script)))) {
          mismatch.push(`${sk.id} step ${i + 1}: the test saw exit ${o.exit}, the record has ${w.exit}${o.stdout !== w.stdout ? " (stdout differs)" : ""}`);
        }
      });
      done++;
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  console.log(`recorded ${done} cases into ${CASES_DIR}`);
  for (const m of mismatch) console.log(`  RECORD DIFFERS FROM THE TEST'S OWN RUN: ${m}`);
  for (const w of warnings) console.log(`  WARN ${w}`);
}

// ------------------------------------------------------------ FROZEN_AT, and a leak scan
{
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf-8" }).stdout.trim();
  const dirty = spawnSync("git", ["status", "--porcelain", "--", "skills", "packages/checkers", "tests"], { cwd: ROOT, encoding: "utf-8" }).stdout
    .split("\n").filter((l) => l && !l.includes("tests/checkers/")).length;
  const py = spawnSync("python3", ["--version"], { encoding: "utf-8" }).stdout.trim();
  writeFileSync(FROZEN_AT,
    `python: ${py}\n` +
    `commit: ${commit}${dirty ? ` (+${dirty} uncommitted change(s) outside tests/checkers)` : ""}\n` +
    `date: ${new Date().toISOString().slice(0, 10)}\n` +
    `platform: ${process.platform}-${process.arch}\n` +
    `clock: ${FROZEN} (writers; datetime frozen as tests/checkers-parity/extra.mjs does)\n`);
  const leaks = [];
  const home = process.env.HOME || "/nonexistent-home";
  for (const g of readdirSync(CASES_DIR)) for (const f of readdirSync(join(CASES_DIR, g))) {
    const t = readFileSync(join(CASES_DIR, g, f), "utf-8");
    for (const bad of [scratch(), "/var/folders/", "/private/var/", ROOT, home + "/"]) if (t.includes(bad)) leaks.push(`${g}/${f}: contains ${bad === home + "/" ? "$HOME" : bad}`);
  }
  for (const l of leaks) console.log(`  LEAK ${l}`);
  console.log(`FROZEN_AT written; ${leaks.length} leak(s)`);
}
cleanup();
