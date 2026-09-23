#!/usr/bin/env node
// Tester-owned parity corpus for plan step 3 (docs/design-web-agent.md § 5),
// written from the contract, independent of packages/checkers/test/parity.mjs.
//
// Three engines, each run against the SAME absolute workspace path (reset
// and re-seeded between engines, so no path normalization is needed):
//   py     the real Python script (writers: clock frozen via a bootstrap
//          that swaps datetime.datetime before jobs_md imports it)
//   jsbin  packages/checkers/bin/<x>.mjs (Node io; CHECKER_NOW_ISO frozen)
//   jsbash the shipping path: just-bash + python3Command dispatch over an
//          InMemoryFs seeded with the same bytes (real clock, so writer
//          files are compared with timestamps masked)
// Compared: stdout (exact), exit code, stderr (exact, and first line),
// and every file in the workspace afterwards (bytes).
//
//   node tests/checkers-parity/extra.mjs            # summary + diffs
//   node tests/checkers-parity/extra.mjs --json     # machine-readable
//   node tests/checkers-parity/extra.mjs <filter>   # cases whose id contains <filter>
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, utimesSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SKILLS = join(ROOT, "skills");
const PKG = join(ROOT, "packages", "checkers");
const SCRATCH = process.env.PARITY_SCRATCH || join(process.env.TMPDIR || "/tmp", "checkers-parity-extra");
const FROZEN = "2026-09-23T12:34:56+00:00";

const { Bash, InMemoryFs } = await import(pathToFileURL(join(PKG, "node_modules", "just-bash", "dist", "bundle", "index.js")).href);
const { python3Command } = await import(pathToFileURL(join(PKG, "src", "just-bash-command.mjs")).href);

const SCRIPTS = {
  check_materials: "apply/scripts/check_materials.py",
  proposal_block: "apply/scripts/proposal_block.py",
  render_resume: "apply/scripts/render_resume.py",
  record_verdict: "evaluate/scripts/record_verdict.py",
  update_job: "search/scripts/update_job.py",
  check_files: "profile/scripts/check_files.py",
  check_closeout: "coach/scripts/check_closeout.py",
};
const WRITERS = new Set(["record_verdict", "update_job"]);

const BOOT = `
import sys, runpy, os, datetime as D
f = os.environ.get("FREEZE_ISO")
if f:
    base = D.datetime.fromisoformat(f)
    class FD(D.datetime):
        @classmethod
        def now(cls, tz=None):
            return base if tz is None else base.astimezone(tz)
    D.datetime = FD
script = sys.argv[1]
sys.argv = sys.argv[1:]
sys.path[0] = os.path.dirname(os.path.abspath(script))
runpy.run_path(script, run_name="__main__")
`;

// ------------------------------------------------------------------ corpus
const C = [];
const add = (c) => C.push(c);
const CRLF = (s) => s.replace(/\n/g, "\r\n");
const EMOJI60 = "🚀".repeat(40);
const LONG = ("word ".repeat(4000)).trim();

// ---- check_materials
{
  const s = "check_materials";
  const BASE = "# Base\n\n## Experience\n- Wrote SQL pipelines in Postgres for the finance team.\n";
  add({ s, id: "cm-empty-resume", files: { "resume.md": "" }, args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-empty-letter", files: { "letter.md": "" }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-missing-both-files", files: {}, args: ["--workspace", ".", "--resume", "nope.md", "--letter", "gone.md"] });
  add({ s, id: "cm-resume-is-a-directory", files: {}, dirs: ["resume.md"], args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-crlf-multiline-bullet", files: { "base-resume.md": BASE,
    "resume.md": CRLF("# A\n\n## Summary\n\nok.\n\n## Experience\n\n- Wrote SQL pipelines in Postgres for the finance team.\n  and single-handedly invented a new database engine.\n") },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-lf-multiline-bullet-control", files: { "base-resume.md": BASE,
    "resume.md": "# A\n\n## Summary\n\nok.\n\n## Experience\n\n- Wrote SQL pipelines in Postgres for the finance team.\n  and single-handedly invented a new database engine.\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-crlf-letter-informal", files: { "letter.md": CRLF("# Letter\n\nHi there —\n\nI want this job.\n\nSincerely,\nA\n") },
    args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-cjk-education-year", files: { "resume.md": "# 王\n\n## Summary\n\nok.\n\n## Education\n\n清华大学，2015年毕业\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-fullwidth-digits-education", files: { "resume.md": "# 山田\n\n## Summary\n\nok.\n\n## Education\n\n東京大学 ２０１５\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-accents-headings-filler", files: { "resume.md": "# Zoë\n\n## Résumé professionnel\n\nPassionate about café culture in Montréal.\n\n## Expérience\n\n- Led the naïve-Bayes rewrite → 3x faster.\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-emoji-long-bullet-truncation", files: { "base-resume.md": BASE,
    "resume.md": `# A\n\n## Summary\n\nok.\n\n## Experience\n\n- ${EMOJI60} shipped\n` }, args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-emoji-summary-sentence-truncation", files: {
    "resume.md": `# A\n\n## Summary\n\n${"🙂 ".repeat(35)}one two three four five six seven eight. More.\n\n## Experience\n\n- ${"🙂 ".repeat(35)}one two three four five six seven eight. More.\n` },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-very-long-line", files: { "resume.md": `# A\n\n## Summary\n\n${LONG}\n\n## Experience\n\n- ${LONG}\n` },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-duplicate-rows", files: { "base-resume.md": BASE,
    "resume.md": "# A\n\n## Summary\n\nCut costs 40% and then cut costs 40% again with 3x speed and 3x scale.\n\n## Experience\n\n- Wrote SQL pipelines in Postgres for the finance team.\n- Wrote SQL pipelines in Postgres for the finance team.\n\n## Experience\n\n- dup section\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-u2028-in-heading", files: { "resume.md": "# A\n\n## Summary Highlights\n\nok.\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-latin1-bytes", files: { "resume.md": Buffer.from("# R\xe9sum\xe9\n\n## Summary\n\nok.\n", "latin1") },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-bom-letter", files: { "letter.md": "﻿Hello —\n\nbody.\n" }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-arg-equals-form", files: { "resume.md": "# A\n\n## Summary\n\nok.\n" }, args: ["--workspace=.", "--resume=resume.md"] });
  add({ s, id: "cm-arg-abbrev", files: { "resume.md": "# A\n\n## Summary\n\nok.\n" }, args: ["--work", ".", "--res", "resume.md"] });
  add({ s, id: "cm-arg-help", files: {}, args: ["-h"] });
  add({ s, id: "cm-arg-missing-value", files: {}, args: ["--workspace", ".", "--resume"] });
  add({ s, id: "cm-arg-value-looks-like-flag", files: {}, args: ["--workspace", ".", "--resume", "--letter"] });
  add({ s, id: "cm-arg-positional", files: {}, args: ["stray", "--workspace", "."] });
}

// ---- proposal_block
{
  const s = "proposal_block";
  const COV = "## Coverage\n\n| requirement | status | evidence | decision |\n|---|---|---|---|\n";
  const SEL = "## Selection\n\n| # | role | bullet | in/out | source | words | why |\n|---|---|---|---|---|---|---|\n";
  add({ s, id: "pb-empty-application", files: { "applications/a.md": "" }, args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-missing-application", files: {}, args: ["--workspace", ".", "--application", "applications/nope.md"] });
  add({ s, id: "pb-emoji-bullet-truncation", files: { "applications/a.md": COV + "| Python | have | x | answered |\n\n" + SEL +
    `| 1 | Acme | ${EMOJI60} big launch | out | base | 12 | weakest |\n| 2 | Acme | kept | in | base | 5 | strong |\n` },
    args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-cjk-astral-evidence-truncation", files: { "applications/a.md": COV +
    `| Kubernetes | gap | ${"𠀀".repeat(50)}${"é".repeat(40)} | open |\n| Go | shown-but-unnamed | ${"𠀀".repeat(40)} ok | answered |\n\n` + SEL },
    args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-crlf", files: { "applications/a.md": CRLF(COV + "| Python | have | x | answered |\n| Rust | gap | none | open |\n\n" + SEL +
    "| 3 | Acme | a | out | base | 12 | weak |\n| 5 | Acme | b | out | base | 9 | weaker |\n| 7 | Acme | c | out | base | — | |\n"), "base-resume.md": CRLF("# B\n- Python work\n") },
    args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-duplicate-rows", files: { "applications/a.md": COV + "| Python | have | x | answered |\n| Python | have | x | answered |\n\n" + SEL +
    "| 1 | Acme | same | out | base | 12 | weak |\n| 1 | Acme | same | out | base | 12 | weak |\n" },
    args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-formfeed-and-u2028-lines", files: { "applications/a.md": COV + "| Python | gap | none | open |\f| Go | gap | none | open | | Rust | gap | none | open |\n\n" + SEL },
    args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-very-long-line", files: { "applications/a.md": COV + `| ${LONG} | gap | ${LONG} | open |\n\n` + SEL },
    args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-arg-missing-application", files: {}, args: ["--workspace", "."] });
  add({ s, id: "pb-arg-help", files: {}, args: ["--help"] });
  add({ s, id: "pb-arg-abbrev", files: { "applications/a.md": "" }, args: ["--workspace", ".", "--app", "applications/a.md"] });
}

// ---- render_resume
{
  const s = "render_resume";
  add({ s, id: "rr-empty-md", files: { "r.md": "" }, args: ["--md", "r.md", "--html", "out.html"] });
  add({ s, id: "rr-missing-md", files: {}, args: ["--md", "nope.md", "--html", "out.html"] });
  add({ s, id: "rr-unicode", files: { "r.md": "# Zoë 王 🚀\n\n## Expérience\n\n- **Café** lead in Montréal — 東京 *naïve* `code`\n- 𠀀 & <tag> \"q\" 'a'\n" },
    args: ["--md", "r.md", "--html", "out.html"] });
  add({ s, id: "rr-crlf", files: { "r.md": CRLF("# A\n\nwrapped line one\nwrapped **bold\nacross** two\n\n- bullet\n  continued\n") }, args: ["--md", "r.md", "--html", "out.html"] });
  add({ s, id: "rr-u2028-and-formfeed", files: { "r.md": "# A\n\npara one - sneaky bullet\fmore\n" }, args: ["--md", "r.md", "--html", "out.html"] });
  add({ s, id: "rr-very-long-line", files: { "r.md": `# A\n\n${LONG}\n` }, args: ["--md", "r.md", "--html", "out.html"] });
  add({ s, id: "rr-default-html-path", files: { "applications/acme-resume.md": "# A\n\nhi\n", "applications/resume.html": "PRE-EXISTING\n" },
    args: ["--md", "applications/acme-resume.md"], note: "Python writes to a mkdtemp() dir; path is random by design" });
  add({ s, id: "rr-arg-bad-pages", files: { "r.md": "# A\n" }, args: ["--md", "r.md", "--pages", "two"] });
  add({ s, id: "rr-arg-pages-spaces", files: { "r.md": "# A\n" }, args: ["--md", "r.md", "--html", "o.html", "--pages", " 3"] });
  add({ s, id: "rr-arg-help", files: {}, args: ["-h"] });
  add({ s, id: "rr-arg-strict-with-value", files: { "r.md": "# A\n" }, args: ["--md", "r.md", "--html", "o.html", "--strict=yes"] });
}

// ---- record_verdict (writer)
{
  const s = "record_verdict";
  const JOBS = (body, notes = "") =>
    "# Pipeline\n\n*x*\n\n**Active: 2** · dismissed: 0 · updated 2026-01-01\n\n" + body + (notes ? `## Search notes\n\n${notes}\n` : "");
  const rv = (extra) => ["--workspace", ".", "--company", "Acme", "--title", "Staff Engineer", "--verdict", "strong", ...extra];
  add({ s, id: "rv-empty-jobs-file", files: { "jobs.md": "" }, args: rv(["--score", "80"]) });
  add({ s, id: "rv-no-jobs-file-unicode", files: {}, args: ["--workspace", ".", "--company", "Café Montréal 🚀", "--title", "エンジニア 𠀀", "--verdict", "long_shot", "--reasons", "naïve — ok"] });
  add({ s, id: "rv-crlf-jobs-with-notes", files: { "jobs.md": CRLF(JOBS("## To Review\n\n### Beta — PM\n- URL: https://b\n- Seen: 2026-01-01T00:00:00+00:00\n\n", "### 2026-01-01\n\nline one\nline two")) },
    args: rv(["--score", "70"]) });
  add({ s, id: "rv-nonint-scores-in-file", files: { "jobs.md": JOBS("## To Review\n\n### Beta — PM\n- Score: 7.5\n\n### Gamma — PM\n- Score: 12abc\n\n### Delta — PM\n- Score: １２\n\n") },
    args: rv(["--score", "10"]) });
  add({ s, id: "rv-sort-astral-vs-bmp", files: { "jobs.md": JOBS("## To Review\n\n### ｆoo Corp — PM\n- URL: u1\n\n### 😀bar — PM\n- URL: u2\n\n") },
    args: rv([]) });
  add({ s, id: "rv-duplicate-rows-in-file", files: { "jobs.md": JOBS("## To Review\n\n### Beta Inc — PM\n\n### Beta — PM\n\n") }, args: rv([]) });
  add({ s, id: "rv-reverdict-updates-existing", files: { "jobs.md": JOBS("## Applied\n\n### ACME, Inc. — Staff Engineer\n- URL: https://old\n- Score: 50\n- JD: jd-analysis/acme.md\n\n") },
    args: rv(["--score", "90", "--url", "https://new", "--jd-file", "jd-analysis/other.md"]) });
  add({ s, id: "rv-u2028-in-company", files: {}, args: ["--workspace", ".", "--company", "A B", "--title", "PM", "--verdict", "weak"] });
  add({ s, id: "rv-very-long-reason", files: {}, args: rv(["--reasons", LONG]) });
  add({ s, id: "rv-arg-score-negative", files: {}, args: rv(["--score", "-5"]) });
  add({ s, id: "rv-arg-score-leading-space", files: {}, args: rv(["--score", " 5"]) });
  add({ s, id: "rv-arg-score-underscore", files: {}, args: rv(["--score", "1_0"]) });
  add({ s, id: "rv-arg-score-not-int", files: {}, args: rv(["--score", "ten"]) });
  add({ s, id: "rv-arg-bad-track", files: {}, args: rv(["--track", "D"]) });
  add({ s, id: "rv-arg-ambiguous-abbrev", files: {}, args: ["--workspace", ".", "--comp", "Acme", "--title", "x", "--verdict", "weak"] });
  add({ s, id: "rv-arg-unique-abbrev", files: {}, args: ["--workspace", ".", "--company", "Acme", "--title", "x", "--verd", "weak"] });
  add({ s, id: "rv-arg-title-missing-value", files: {}, args: ["--workspace", ".", "--company", "Acme", "--verdict", "weak", "--title"] });
  add({ s, id: "rv-arg-help", files: {}, args: ["-h"] });
}

// ---- update_job (writer)
{
  const s = "update_job";
  const JOBS = (body) => "# Pipeline\n\n*x*\n\n**Active: 1** · dismissed: 0 · updated 2026-01-01\n\n" + body;
  const ONE = JOBS("## To Review\n\n### Café Labs — Staff Engineer\n- URL: https://c\n- Seen: 2026-01-01T00:00:00+00:00\n\n");
  const uj = (extra) => ["--workspace", ".", "--company", "Café", "--title", "Staff", ...extra];
  add({ s, id: "uj-empty-jobs-file", files: { "jobs.md": "" }, args: uj(["--stage", "Applied"]) });
  add({ s, id: "uj-missing-jobs-file", files: {}, args: uj(["--dismiss"]) });
  add({ s, id: "uj-crlf-stage-move", files: { "jobs.md": CRLF(ONE + "## Search notes\n\nnote a\nnote b\n") }, args: uj(["--stage", "Applied"]) });
  add({ s, id: "uj-unicode-dismiss-reason", files: { "jobs.md": ONE }, args: uj(["--dismiss", "--reason", "trop loin — 通勤 🚗"]) });
  add({ s, id: "uj-ambiguous-emoji-titles", files: { "jobs.md": JOBS("## To Review\n\n### Café — Staff Engineer 🚀\n\n### Café — Staff Engineer II 🛰\n\n") }, args: uj(["--stage", "Offer"]) });
  add({ s, id: "uj-duplicate-rows-in-file", files: { "jobs.md": JOBS("## To Review\n\n### Café — Staff Engineer\n\n## Applied\n\n### Café Inc — Staff Engineer\n\n") }, args: ["--workspace", ".", "--company", "Café", "--title", "Staff Engineer", "--restore"] });
  add({ s, id: "uj-arg-stage-twice", files: { "jobs.md": ONE }, args: uj(["--stage", "Applied", "--stage", "Offer"]) });
  add({ s, id: "uj-arg-dismiss-twice", files: { "jobs.md": ONE }, args: uj(["--dismiss", "--dismiss"]) });
  add({ s, id: "uj-arg-conflict-plus-unrecognized", files: { "jobs.md": ONE }, args: uj(["--stage", "Applied", "--dismiss", "--bogus"]) });
  add({ s, id: "uj-arg-conflict-no-workspace", files: {}, args: ["--company", "x", "--title", "y", "--dismiss", "--restore"] });
  add({ s, id: "uj-arg-dismiss-with-value", files: { "jobs.md": ONE }, args: uj(["--dismiss=yes"]) });
  add({ s, id: "uj-arg-bad-stage", files: {}, args: uj(["--stage", "applied"]) });
  add({ s, id: "uj-arg-help", files: {}, args: ["--help"] });
}

// ---- check_files
{
  const s = "check_files";
  const PROFILE = "# P\n## Snapshot\n## Experience\n## Intake findings\n### Positioning strengths\n### Likely interviewer concerns\n" +
    "### Career-narrative gaps\n### Story seeds\n## Interview history\n## Constraints\n## Application defaults\n";
  const sk = ["--skills", SKILLS];
  add({ s, id: "cf-empty-profile", files: { "profile.md": "" }, args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-missing-workspace-dir", files: {}, args: ["--workspace", "does-not-exist", ...sk] });
  add({ s, id: "cf-workspace-is-a-file", files: { "f.md": "x" }, args: ["--workspace", "f.md", ...sk] });
  add({ s, id: "cf-crlf-profile", files: { "profile.md": CRLF(PROFILE + "## Café notes\n") }, args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-hidden-application-file", files: { "applications/.draft.md": "## Coverage\n\n| requirement | status |\n", "applications/ok.md": "# ok\n" },
    args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-unicode-stray-order", files: { "ｆ-notes.txt": "x", "😀.txt": "x", "é.txt": "x", "z.txt": "x", "Zebra.txt": "x" }, args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-emoji-long-table-row", files: { "applications/a.md": `## Coverage\n\n| requirement | status | evidence | decision |\n|---|---|---|---|\n| ${EMOJI60} | have |\n` },
    args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-u2028-heading", files: { "profile.md": PROFILE + "## Foo Snapshot\n" }, args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-duplicate-sections-and-rows", files: { "profile.md": PROFILE + "## Snapshot\n## Snapshot\n", "base-resume-history.md": "| date | round | driver | scored vs FIXED | what changed |\n|---|---|---|---|---|\n| a | 1 | x | y | z |\n| a | 1 | x | y | z |\n| a | 1 | x | y |\n" },
    args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-very-long-line", files: { "profile.md": PROFILE + `## ${LONG}\n` }, args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-default-skills-as-the-skill-prose-calls-it", files: { "profile.md": PROFILE }, args: ["--workspace", "."],
    note: "every MVP SKILL.md runs `check_files.py --workspace .` with no --skills" });
  add({ s, id: "cf-arg-help", files: {}, args: ["-h"] });
  add({ s, id: "cf-arg-unrecognized", files: {}, args: ["--workspace", ".", "--skill", SKILLS, "--x"] });
}

// ---- check_closeout
{
  const s = "check_closeout";
  const PLAN = "Goal: x\n\n## Board\nWaiting on you\n- the comp floor — criteria.md\n- café visit to Montréal\nTo do\n- review the letter\n";
  add({ s, id: "cc-empty-plan", files: { "plan.md": "" }, args: ["--workspace", ".", "--stage", "applying"] });
  add({ s, id: "cc-missing-plan-bad-stage", files: {}, args: ["--workspace", ".", "--stage", "Planning"] });
  add({ s, id: "cc-crlf-plan", files: { "plan.md": CRLF(PLAN) }, args: ["--workspace", ".", "--stage", "applying", "--asked", "your comp floor"] });
  add({ s, id: "cc-emoji-asked-truncation", files: { "plan.md": PLAN }, args: ["--workspace", ".", "--stage", "applying", "--asked", EMOJI60 + " unmatched"] });
  add({ s, id: "cc-unicode-rows", files: { "plan.md": PLAN }, args: ["--workspace", ".", "--stage", "applying", "--asked", "the café visit?", "--asked", "東京 relocation"] });
  add({ s, id: "cc-duplicate-asked", files: { "plan.md": PLAN }, args: ["--workspace", ".", "--stage", "applying", "--asked", "comp floor", "--asked", "comp floor"] });
  add({ s, id: "cc-infer-stage-from-crlf-jobs", files: { "plan.md": PLAN, "jobs.md": CRLF("| Acme | Interviewing |\n") }, args: ["--workspace", "."] });
  add({ s, id: "cc-stale-plan", files: { "plan.md": PLAN }, old: ["plan.md"], args: ["--workspace", ".", "--stage", "deciding"] });
  add({ s, id: "cc-very-long-line", files: { "plan.md": `## Board\nWaiting on you\n- ${LONG}\n` }, args: ["--workspace", ".", "--stage", "applying", "--asked", LONG] });
  add({ s, id: "cc-arg-minutes-not-int", files: {}, args: ["--workspace", ".", "--minutes", "ten"] });
  add({ s, id: "cc-arg-minutes-spaces", files: { "plan.md": PLAN }, args: ["--workspace", ".", "--stage", "applying", "--minutes", " 30 "] });
  add({ s, id: "cc-arg-help", files: {}, args: ["-h"] });
  add({ s, id: "cc-arg-asked-missing-value", files: {}, args: ["--workspace", ".", "--asked"] });
}

// ------------------------------------------------------------------ engines
function seed(ws, c) {
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(ws, { recursive: true });
  for (const d of c.dirs || []) mkdirSync(join(ws, d), { recursive: true });
  for (const [rel, content] of Object.entries(c.files)) {
    const p = join(ws, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  for (const rel of c.old || []) utimesSync(join(ws, rel), old, old);
}
function snapDisk(ws) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { out[relative(ws, p) + "/"] = "<dir>"; walk(p); }
      else out[relative(ws, p)] = readFileSync(p).toString("base64");
    }
  };
  walk(ws);
  return out;
}
function runPy(c, ws) {
  const script = join(SKILLS, SCRIPTS[c.s]);
  const env = { ...process.env, FREEZE_ISO: WRITERS.has(c.s) ? FROZEN : "" };
  const r = spawnSync("python3", ["-c", BOOT, script, ...c.args], { cwd: ws, env, encoding: "utf-8" });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status, files: snapDisk(ws) };
}
function runJsBin(c, ws) {
  const bin = join(PKG, "bin", `${c.s}.mjs`);
  const env = { ...process.env, CHECKER_NOW_ISO: WRITERS.has(c.s) ? FROZEN : "" };
  const r = spawnSync("node", [bin, ...c.args], { cwd: ws, env, encoding: "utf-8" });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status, files: snapDisk(ws) };
}
let SKILL_FILES = null;
function skillFiles() {
  if (SKILL_FILES) return SKILL_FILES;
  SKILL_FILES = {};
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else SKILL_FILES[p] = readFileSync(p);
    }
  };
  walk(SKILLS);
  return SKILL_FILES;
}
const q = (a) => `'${a.replace(/'/g, `'\\''`)}'`;
async function runJsBash(c, ws) {
  const files = { ...skillFiles() };
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  for (const [rel, content] of Object.entries(c.files)) {
    files[join(ws, rel)] = { content: new Uint8Array(content instanceof Buffer ? content : Buffer.from(content, "utf-8")), ...((c.old || []).includes(rel) ? { mtime: old } : {}) };
  }
  const fs = new InMemoryFs(files);
  await fs.mkdir(ws, { recursive: true });
  for (const d of c.dirs || []) await fs.mkdir(join(ws, d), { recursive: true });
  const bash = new Bash({ fs, cwd: ws, customCommands: [python3Command] });
  const cmd = `python3 ../some/prefix/${SCRIPTS[c.s].split("/").pop()} ${c.args.map(q).join(" ")}`;
  let r;
  try { r = await bash.exec(cmd); } catch (e) { r = { stdout: "", stderr: `THROWN ${e && e.message}\n`, exitCode: -1 }; }
  const out = {};
  const walk = async (d) => {
    for (const n of (await fs.readdir(d)).sort()) {
      const p = join(d, n);
      const st = await fs.stat(p);
      if (st.isDirectory) { out[relative(ws, p) + "/"] = "<dir>"; await walk(p); }
      else out[relative(ws, p)] = Buffer.from(await fs.readFileBuffer(p)).toString("base64");
    }
  };
  await walk(ws);
  return { stdout: r.stdout, stderr: r.stderr, code: r.exitCode, files: out };
}

const MASK = (s) => s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00/g, "<TS>").replace(/updated \d{4}-\d{2}-\d{2}/g, "updated <D>");
function compare(a, b, { mask = false } = {}) {
  const m = mask ? MASK : (x) => x;
  const diffs = [];
  if (a.stdout !== b.stdout) diffs.push("stdout");
  if (a.code !== b.code) diffs.push(`exit ${a.code}!=${b.code}`);
  const a1 = (a.stderr || "").split("\n")[0], b1 = (b.stderr || "").split("\n")[0];
  if (a1 !== b1) diffs.push("stderr-line1");
  else if (a.stderr !== b.stderr) diffs.push("stderr-rest");
  const keys = new Set([...Object.keys(a.files), ...Object.keys(b.files)]);
  for (const k of [...keys].sort()) {
    const fa = a.files[k], fb = b.files[k];
    if (fa === fb) continue;
    if (mask && fa && fb && fa !== "<dir>" && fb !== "<dir>" &&
        MASK(Buffer.from(fa, "base64").toString("utf-8")) === MASK(Buffer.from(fb, "base64").toString("utf-8"))) continue;
    diffs.push(`file:${k}${fa === undefined ? "(only-js)" : fb === undefined ? "(only-py)" : ""}`);
  }
  return diffs;
}

const filter = process.argv.slice(2).find((x) => !x.startsWith("--"));
const asJson = process.argv.includes("--json");
const verbose = process.argv.includes("--verbose");
const results = [];
for (const c of C) {
  if (filter && !c.id.includes(filter)) continue;
  const ws = join(SCRATCH, "ws");
  seed(ws, c); const py = runPy(c, ws);
  seed(ws, c); const jb = runJsBin(c, ws);
  seed(ws, c); const bs = await runJsBash(c, ws);
  const dBin = compare(py, jb);
  const dBash = compare(py, bs, { mask: WRITERS.has(c.s) });
  results.push({ id: c.id, script: c.s, bin: dBin, bash: dBash, py, jb, bs, note: c.note });
}
rmSync(SCRATCH, { recursive: true, force: true });

if (asJson) {
  console.log(JSON.stringify(results.map(({ id, script, bin, bash, note }) => ({ id, script, bin, bash, note })), null, 1));
} else {
  const show = (label, r) => `  ${label}: exit=${r.code}\n    stdout=${JSON.stringify(r.stdout).slice(0, 700)}\n    stderr=${JSON.stringify(r.stderr).slice(0, 300)}`;
  let nb = 0, nbs = 0;
  for (const r of results) {
    const ok = !r.bin.length && !r.bash.length;
    if (r.bin.length) nb++;
    if (r.bash.length) nbs++;
    console.log(`[${ok ? "SAME" : "DIFF"}] ${r.id}${r.bin.length ? `  bin:{${r.bin.join(", ")}}` : ""}${r.bash.length ? `  bash:{${r.bash.join(", ")}}` : ""}${r.note ? `  (${r.note})` : ""}`);
    if (!ok && verbose) {
      console.log(show("py", r.py)); console.log(show("jsbin", r.jb)); console.log(show("jsbash", r.bs));
    }
  }
  const per = {};
  for (const r of results) { per[r.script] ??= [0, 0, 0]; per[r.script][0]++; if (!r.bin.length) per[r.script][1]++; if (!r.bash.length) per[r.script][2]++; }
  console.log("\nper script: identical(py vs jsbin) / identical(py vs jsbash, writers timestamp-masked) / cases");
  for (const [k, [n, a, b]] of Object.entries(per)) console.log(`  ${k.padEnd(16)} ${a}/${n}  ${b}/${n}`);
  console.log(`\n${results.length - nb}/${results.length} identical py vs jsbin; ${results.length - nbs}/${results.length} identical py vs jsbash`);
  process.exit(nb || nbs ? 1 : 0);
}
