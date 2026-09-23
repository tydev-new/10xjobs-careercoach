#!/usr/bin/env node
// The step-3 parity test (docs/design-web-agent.md § 5): for every ported
// CLI, run the real Python script and the JS port's Node CLI against
// IDENTICAL temp workspaces and diff stdout, exit code, and (for writers)
// the resulting files, byte for byte. The corpus covers at least one case
// per CLI, every `def test_` in the matching tests/test_*.py file (see the
// `covers:` field on each case — N/A cases are documented, not skipped
// silently), every CLI's argparse error, and accented text (the regex
// parity risk design-web-agent.md § 5 names).
//
// Skips loudly (never silently) if `python3` isn't on PATH — see
// tests/run.py's wiring of this file.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PKG_ROOT = join(HERE, "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const SKILLS = join(REPO_ROOT, "skills");

// Skip loudly (not silently, and not a failure) if python3 isn't on
// PATH — this harness's whole point is diffing against the REAL Python
// scripts, so there is nothing to run without it. Mirrors tests/run.py's
// own "no `node` on PATH" skip for tests/web.
{
  const probe = spawnSync("python3", ["--version"]);
  if (probe.error || probe.status !== 0) {
    console.log("SKIPPED packages/checkers/test/parity.mjs: no `python3` on PATH");
    process.exit(0);
  }
}

function mkws() {
  return mkdtempSync(join(tmpdir(), "checkers-parity-"));
}
function writeFiles(ws, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(ws, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, "utf-8");
  }
}
function readIfExists(p) {
  return existsSync(p) ? readFileSync(p, "utf-8") : null;
}
function runPy(scriptRelToSkills, args, env) {
  const script = join(SKILLS, scriptRelToSkills);
  return spawnSync("python3", [script, ...args], { encoding: "utf-8", env: env || process.env });
}
function runJs(bin, args, env) {
  const script = join(PKG_ROOT, "bin", bin);
  return spawnSync("node", [script, ...args], { encoding: "utf-8", env: env || process.env });
}

// ---- the corpus -------------------------------------------------------
// Each case: { script, bin, name, covers, setup(ws)->argsExtra?, args,
//              diffFiles?, freezeClockFrom? }
// setup(ws) writes fixture files (relative to ws) and MAY return an
// {args} override (used when a case needs a path INSIDE ws, e.g.
// --resume <ws>/applications/x-resume.md).
const CASES = [];
function addCase(c) {
  CASES.push(c);
}

// ---------------------------------------------------------------- check_materials.py
{
  const script = "apply/scripts/check_materials.py";
  const bin = "check_materials.mjs";
  const BASE = '# Base résumé\n\n## Claim rules\n\n- never an aggregate year count ("25+ years") on any surface.\n';
  const RESUME_TWO_SECTIONS =
    "# Alex Chen\n\n## Summary\n\n" +
    "word ".repeat(133) +
    "\n\n## Selected experience against this role\n\n**Sell — technical discovery through executive close**\n\n- Ran a solutions-led transformation.\n";
  const RESUME_CLEAN =
    "# Alex Chen\n\n## Summary\n\n**Forward-Deployed & Solutions Engineering Leader**\n" +
    "*Turning deployment friction into product strategy.*\n\n" +
    "Built the function twice, from zero, by treating deployment friction as product\n" +
    "intelligence rather than support noise. Still shipping production code today.\n\n" +
    "- **8+ years leading technical teams:** yes — shipping today.\n" +
    "- **Lead and scale a team:** built the function from zero.\n" +
    "- **Own discovery through close:** cut cycles 4 months to 3 weeks.\n" +
    "- **Executive sponsor:** redirected the account from near-cancellation.\n" +
    "- **Reusable playbooks:** 12-week engagements became 4-week.\n" +
    "- **Escalate product gaps:** built the field-metrics dashboard.\n\n" +
    "## Experience\n\nPlatform Lead — Northwind Labs.\n";
  const LETTER_INFORMAL =
    "# Cover letter\n\nHello —\n\n" +
    Array.from({ length: 6 }, () => "filler ".repeat(45).trim()).join("\n\n") +
    "\n\nAlex Chen\n";
  const LETTER_CLEAN =
    "# Cover letter\n\nDear Hiring Manager,\n\n" +
    Array.from({ length: 5 }, () => "filler ".repeat(60).trim()).join("\n\n") +
    "\n\nAlex Chen\n";
  const LETTER_HAZARD =
    "# Cover letter\n\nDear Hiring Manager,\n\n" +
    Array.from({ length: 4 }, () => "filler ".repeat(60).trim()).join("\n\n") +
    "\n\nI built it solo, and I am excited to bring 25+ years of experience.\n\nAlex Chen\n";

  addCase({
    script, bin, name: "resume-two-sections-overlong-case",
    covers: "test_mechanical_cases (1, 2)",
    setup: (ws) => writeFiles(ws, { "resume.md": RESUME_TWO_SECTIONS }),
    args: (ws) => ["--workspace", ws, "--resume", join(ws, "resume.md")],
  });
  addCase({
    script, bin, name: "resume-clean",
    covers: "test_mechanical_cases (3)",
    setup: (ws) => writeFiles(ws, { "resume.md": RESUME_CLEAN }),
    args: (ws) => ["--workspace", ws, "--resume", join(ws, "resume.md")],
  });
  addCase({
    script, bin, name: "letter-informal-many-blocks",
    covers: "test_mechanical_cases (4, 5, 6)",
    setup: (ws) => writeFiles(ws, { "letter.md": LETTER_INFORMAL }),
    args: (ws) => ["--workspace", ws, "--letter", join(ws, "letter.md")],
  });
  addCase({
    script, bin, name: "letter-clean",
    covers: "test_mechanical_cases (7... clean letter passes)",
    setup: (ws) => writeFiles(ws, { "letter.md": LETTER_CLEAN }),
    args: (ws) => ["--workspace", ws, "--letter", join(ws, "letter.md")],
  });
  addCase({
    script, bin, name: "letter-hazard-year-count",
    covers: "test_mechanical_cases (8, 9)",
    setup: (ws) => writeFiles(ws, { "letter.md": LETTER_HAZARD }),
    args: (ws) => ["--workspace", ws, "--letter", join(ws, "letter.md")],
  });
  addCase({
    script, bin, name: "resume-jd-bar-quoted-exempt",
    covers: "test_mechanical_cases (10)",
    setup: (ws) =>
      writeFiles(ws, {
        "resume.md": RESUME_CLEAN.replace(
          "- **8+ years leading technical teams:** yes — shipping today.",
          "- **10+ years in software engineering, with 5+ years leading delivery teams:** yes — shipping today."
        ),
      }),
    args: (ws) => ["--workspace", ws, "--resume", join(ws, "resume.md")],
  });
  addCase({
    script, bin, name: "resume-own-aggregate-caught",
    covers: "test_mechanical_cases (11)",
    setup: (ws) =>
      writeFiles(ws, {
        "resume.md": RESUME_CLEAN.replace("Built the function twice", "With 25+ years of experience, built the function twice"),
      }),
    args: (ws) => ["--workspace", ws, "--resume", join(ws, "resume.md")],
  });

  const BASE_RW =
    "# Alex Chen\n\n## Professional Experience\n\n### Meridian Health — Senior Data Analyst\n**2022 - Present**\n\n" +
    "- Wrote and maintained SQL pipelines in Postgres over claims data, feeding the finance team.\n" +
    "- Collaborated with team on the quarterly forecast.\n\n## Claim rules\n- never \"solo\" — team of two.\n";
  function rw(body) {
    return "# Alex Chen\n\n## Summary\n\nSenior analyst.\n\n## Selected Experience\n\n### Meridian Health\n**2022**\n\n" + body;
  }
  addCase({
    script, bin, name: "rewording-declared-exempt",
    covers: "test_declared_rewording_is_exempt",
    setup: (ws) =>
      writeFiles(ws, {
        "base-resume.md": BASE_RW,
        "resume.md": rw(
          "- Built and owned data pipelines in Postgres over claims data, feeding the finance team.\n\n" +
            "## Reworded\n\n" +
            "- base: Wrote and maintained SQL pipelines in Postgres over claims data, feeding the finance team.\n" +
            "  tailored: Built and owned data pipelines in Postgres over claims data, feeding the finance team.\n"
        ),
      }),
    args: (ws) => ["--workspace", ws, "--resume", join(ws, "resume.md")],
  });
  addCase({
    script, bin, name: "rewording-undeclared-fails",
    covers: "test_undeclared_rewording_still_fails",
    setup: (ws) =>
      writeFiles(ws, {
        "base-resume.md": BASE_RW,
        "resume.md": rw("- Built and owned data pipelines in Postgres over claims data, feeding the finance team.\n"),
      }),
    args: (ws) => ["--workspace", ws, "--resume", join(ws, "resume.md")],
  });
  addCase({
    script, bin, name: "rewording-cannot-self-issue",
    covers: "test_reworded_block_cannot_self_issue_its_exemption",
    setup: (ws) =>
      writeFiles(ws, {
        "base-resume.md": BASE_RW,
        "resume.md": rw(
          "- Led a 60-person organization across three continents.\n\n## Reworded\n\n" +
            "- base: Led a 60-person organization across three continents.\n" +
            "  tailored: Led a 60-person organization across three continents.\n"
        ),
      }),
    args: (ws) => ["--workspace", ws, "--resume", join(ws, "resume.md")],
  });

  addCase({
    script, bin, name: "e2e-stage5-writer-application",
    covers: "test_e2e_lifecycle (Stage 5)",
    setup: (ws) =>
      writeFiles(ws, {
        "applications/writer-staff-infra-application.md": "# Application: Writer\n\n## Standard\n- S001 cited\n",
        "applications/writer-staff-infra-resume.md":
          "# Alex Chen — Staff Systems Engineer\n\n## Experience\n### Principal Infrastructure Engineer — CloudScale Inc (2021–Present)\n" +
          "- Architected distributed event stream processing 50M events/day with 99.99% availability.\n",
        "applications/writer-staff-infra-cover-letter.md":
          "# Cover Letter — Writer\n\nDear Hiring Team,\n\nI am writing to express my strong interest in the Staff Infrastructure Engineer role at Writer.\n",
      }),
    args: (ws) => [
      "--workspace", ws,
      "--resume", join(ws, "applications", "writer-staff-infra-resume.md"),
      "--letter", join(ws, "applications", "writer-staff-infra-cover-letter.md"),
    ],
  });

  addCase({
    script, bin, name: "argparse-missing-workspace",
    covers: "argparse: --workspace required",
    setup: () => {},
    args: () => ["--resume", "x.md"],
  });
  addCase({
    script, bin, name: "argparse-neither-resume-nor-letter",
    covers: "p.error('pass --resume and/or --letter')",
    setup: (ws) => {},
    args: (ws) => ["--workspace", ws],
  });
  addCase({
    script, bin, name: "argparse-unrecognized-flag",
    covers: "argparse: unrecognized arguments",
    setup: (ws) => {},
    args: (ws) => ["--workspace", ws, "--resume", "x.md", "--bogus", "y"],
  });
  addCase({
    script, bin, name: "resume-file-not-found",
    covers: "main(): 'file not found'",
    setup: (ws) => {},
    args: (ws) => ["--workspace", ws, "--resume", join(ws, "nope.md")],
  });
  addCase({
    script, bin, name: "accented-text-base-verbatim",
    covers: "design-web-agent.md § 5 known risk: accented text",
    setup: (ws) =>
      writeFiles(ws, {
        "base-resume.md": "# Base\n\n## Experience\n- Wrote the café pipeline in Montréal for the finance team.\n",
        "resume.md": "# A\n\n## Summary\n\nok café.\n\n## Experience\n\n- Wrote the café pipeline in Montréal for the finance team.\n",
      }),
    args: (ws) => ["--workspace", ws, "--resume", join(ws, "resume.md")],
  });
}

// ---------------------------------------------------------------- check_closeout.py
{
  const script = "coach/scripts/check_closeout.py";
  const bin = "check_closeout.mjs";
  const PLAN =
    "Goal: x by 2026-10-01\nBudget: 60 min/day\n\n## Board\nWaiting on you\n" +
    "- the comp floor — criteria.md § Compensation\n" +
    "- warm-path pick: which of the three mutuals to Flo\n" +
    "To do\n- review the Corvid letter (10 min)\n";
  const closeoutCases = [
    { name: "clean", covers: "test_clean", plan: PLAN, args: ["--stage", "applying", "--asked", "which mutual to Flo", "--asked", "your comp floor"] },
    { name: "bad_stage_fails", covers: "test_bad_stage_fails", plan: PLAN, args: ["--stage", "planning"] },
    { name: "question_without_row_fails", covers: "test_question_without_row_fails", plan: PLAN, args: ["--stage", "applying", "--asked", "do you want the two-page version"] },
    { name: "stale_plan_fails", covers: "test_stale_plan_fails", plan: PLAN, args: ["--stage", "applying"], old: true },
    { name: "missing_plan_fails", covers: "test_missing_plan_fails", plan: null, args: ["--stage", "applying"] },
    { name: "stage_auto_inferred", covers: "test_stage_auto_inferred", plan: PLAN, args: ["--asked", "which mutual to Flo", "--asked", "your comp floor"] },
  ];
  for (const c of closeoutCases) {
    addCase({
      script, bin, name: c.name, covers: c.covers,
      setup: (ws) => {
        if (c.plan === null) return;
        writeFiles(ws, { "plan.md": c.plan });
        if (c.old) {
          const past = new Date(Date.now() - 3600 * 1000);
          utimesSync(join(ws, "plan.md"), past, past);
        }
      },
      args: (ws) => ["--workspace", ws, ...c.args],
    });
  }
  addCase({
    script, bin, name: "argparse-missing-workspace",
    covers: "argparse: --workspace required",
    setup: () => {},
    args: () => ["--stage", "applying"],
  });
}

// ---------------------------------------------------------------- proposal_block.py
{
  const script = "apply/scripts/proposal_block.py";
  const bin = "proposal_block.mjs";
  const BASE = "# Base\n## Experience\n- Set up scheduled job monitoring with alerting on failed overnight loads.\n- Built tested dbt models with peer review.\n";
  const COV =
    "## Coverage\n| requirement | status | evidence | decision |\n|---|---|---|---|\n" +
    "| Orchestrate scheduled data workflows | have | monitoring bullet | answered |\n" +
    "| Tested dbt models | have | dbt bullet | answered |\n" +
    "| A/B testing | gap | none | open |\n";
  const SEL =
    "## Selection\n| # | role | bullet | in/out | source | words | why |\n|---|---|---|---|---|---|---|\n" +
    "| 1 | A | one | in | base | 5 | lead |\n" +
    "| 2 | A | two | out | base | 6 | weakest |\n" +
    "| 3 | A | three | out | base | 7 | next |\n" +
    "| 4 | A | four | out | base | 8 | furthest |\n";
  addCase({
    script, bin, name: "prints-cut-list",
    covers: "test_prints_the_cut_list_short_with_why, test_have_row_missing_their_word_warns_and_near_vocab_does_not, test_out_rows_in_base_order_warns",
    setup: (ws) => writeFiles(ws, { "base-resume.md": BASE, "applications/x.md": COV + SEL }),
    args: (ws) => ["--workspace", ws, "--application", "applications/x.md"],
  });
  addCase({
    script, bin, name: "out-row-without-why-fails",
    covers: "test_out_row_without_why_fails",
    setup: (ws) =>
      writeFiles(ws, {
        "base-resume.md": BASE,
        "applications/x.md": COV + SEL.replace("| 2 | A | two | out | base | 6 | weakest |", "| 2 | A | two | out | base | — | — |"),
      }),
    args: (ws) => ["--workspace", ws, "--application", "applications/x.md"],
  });
  addCase({
    script, bin, name: "missing-table-fails",
    covers: "test_missing_table_fails",
    setup: (ws) => writeFiles(ws, { "base-resume.md": BASE, "applications/x.md": COV }),
    args: (ws) => ["--workspace", ws, "--application", "applications/x.md"],
  });
  addCase({
    script, bin, name: "argparse-missing-required",
    covers: "argparse: --workspace, --application required",
    setup: () => {},
    args: () => [],
  });
}

// ---------------------------------------------------------------- render_resume.py
{
  const script = "apply/scripts/render_resume.py";
  const bin = "render_resume.mjs";
  const WRAPPED =
    "# ALEX CHEN\n\n## Summary\n\nBuilt the solutions engineering function three times and wrote the standards it\n" +
    "ran on — the hiring bar, the POC playbook, the deployment playbook. Now builds\n" +
    "production agent systems.\n\n- **Deep fluency in the pre-sales craft — discovery, proofs of concept:** ran it\n" +
    "  as Director of Solutions Engineering, then wrote the playbooks the team used.\n";
  addCase({
    script, bin, name: "wrapped-prose-and-bold-span",
    covers: "test_wrapped_prose_is_one_paragraph, test_bold_spanning_a_line_break_converts, test_html_is_escaped_by_the_builder, test_bullets_group_into_one_list, test_word_count_ignores_markup",
    setup: (ws) => writeFiles(ws, { "resume.md": WRAPPED }),
    args: (ws) => ["--md", join(ws, "resume.md"), "--html", join(ws, "out.html")],
    diffFiles: ["out.html"],
  });
  addCase({
    script, bin, name: "escaping-and-lists",
    covers: "test_html_is_escaped_by_the_builder, test_bullets_group_into_one_list",
    setup: (ws) => writeFiles(ws, { "resume.md": "# A\n\n- Scaled 40+ engineers & <ops> teams\n- one\n- two\n\n## Next\n\n- three\n" }),
    args: (ws) => ["--md", join(ws, "resume.md"), "--html", join(ws, "out.html")],
    diffFiles: ["out.html"],
  });
  addCase({
    script, bin, name: "argparse-missing-md",
    covers: "argparse: --md required",
    setup: () => {},
    args: () => [],
  });
}

// ---------------------------------------------------------------- record_verdict.py / jobs_md.py
{
  const script = "evaluate/scripts/record_verdict.py";
  const bin = "record_verdict.mjs";
  addCase({
    script, bin, name: "creates-new-role",
    covers: "test_e2e_lifecycle (Stage 4)",
    setup: () => {},
    args: (ws) => [
      "--workspace", ws, "--company", "Writer", "--title", "Staff Infrastructure Engineer",
      "--verdict", "strong", "--score", "88", "--track", "A", "--reasons", "evaluated: strong distributed systems fit",
    ],
    diffFiles: ["jobs.md"],
    freezeClock: true,
  });
  addCase({
    script, bin, name: "updates-existing-role-reverdict",
    covers: "record_verdict.py docstring: re-verdict semantics upsert",
    setup: (ws) =>
      writeFiles(ws, {
        "jobs.md":
          "# Pipeline\n\n**Active: 1** · dismissed: 0 · updated 2026-08-01\n\n## To Review\n\n### Writer — Staff Infrastructure Engineer\n- Seen: 2026-08-01T00:00:00+00:00\n",
      }),
    args: (ws) => ["--workspace", ws, "--company", "Writer", "--title", "Staff Infrastructure Engineer", "--verdict", "long_shot", "--score", "40"],
    diffFiles: ["jobs.md"],
    freezeClock: true,
  });
  addCase({
    script, bin, name: "duplicate-key-hard-error",
    covers: "jobs_md.py: SystemExit on canonical collision",
    setup: (ws) =>
      writeFiles(ws, {
        "jobs.md":
          "# Pipeline\n\n**Active: 1** · dismissed: 0 · updated 2026-08-01\n\n## To Review\n\n### Cursor — Regional Director\n- Seen: 2026-08-01T00:00:00+00:00\n\n### Cursor, Inc — Regional Director\n- Seen: 2026-08-01T00:00:00+00:00\n",
      }),
    args: (ws) => ["--workspace", ws, "--company", "Cursor", "--title", "Regional Director", "--verdict", "strong"],
    diffFiles: ["jobs.md"],
    freezeClock: true,
  });
  addCase({
    script, bin, name: "argparse-bad-score",
    covers: "main(): --score must be 0-100",
    setup: () => {},
    args: (ws) => ["--workspace", ws, "--company", "A", "--title", "B", "--verdict", "strong", "--score", "200"],
  });
  addCase({
    script, bin, name: "argparse-bad-verdict-choice",
    covers: "argparse: --verdict choices",
    setup: () => {},
    args: (ws) => ["--workspace", ws, "--company", "A", "--title", "B", "--verdict", "bogus"],
  });
  addCase({
    script, bin, name: "argparse-missing-required",
    covers: "argparse: --company, --title, --verdict required",
    setup: () => {},
    args: (ws) => ["--workspace", ws],
  });
}

// ---------------------------------------------------------------- update_job.py
{
  const script = "search/scripts/update_job.py";
  const bin = "update_job.mjs";
  const JOBS =
    "# Pipeline\n\n**Active: 1** · dismissed: 0 · updated 2026-08-01\n\n## To Review\n\n### Cursor — Regional Director, Forward Deployed Engineering\n- Seen: 2026-08-01T00:00:00+00:00\n";
  addCase({
    script, bin, name: "stage-move",
    covers: "update_job.py docstring example 1",
    setup: (ws) => writeFiles(ws, { "jobs.md": JOBS }),
    args: (ws) => ["--workspace", ws, "--company", "Cursor", "--title", "Forward Deployed", "--stage", "Applied"],
    diffFiles: ["jobs.md"],
    freezeClock: true,
  });
  addCase({
    script, bin, name: "dismiss-with-reason",
    covers: "update_job.py docstring example 2",
    setup: (ws) => writeFiles(ws, { "jobs.md": JOBS }),
    args: (ws) => ["--workspace", ws, "--company", "Cursor", "--title", "Forward Deployed", "--dismiss", "--reason", "internal CI/CD, not FDE"],
    diffFiles: ["jobs.md"],
    freezeClock: true,
  });
  addCase({
    script, bin, name: "restore",
    covers: "update_job.py docstring example 3",
    setup: (ws) =>
      writeFiles(ws, {
        "jobs.md":
          "# Pipeline\n\n**Active: 0** · dismissed: 1 · updated 2026-08-01\n\n## Dismissed\n\n### Cursor — Regional Director, Forward Deployed Engineering\n- Seen: 2026-08-01T00:00:00+00:00\n- Was: To Review\n",
      }),
    args: (ws) => ["--workspace", ws, "--company", "Cursor", "--title", "Forward Deployed", "--restore"],
    diffFiles: ["jobs.md"],
    freezeClock: true,
  });
  addCase({
    script, bin, name: "zero-matches",
    covers: "main(): --company/--title matched no roles",
    setup: (ws) => writeFiles(ws, { "jobs.md": JOBS }),
    args: (ws) => ["--workspace", ws, "--company", "Nope", "--title", "Anything", "--restore"],
  });
  addCase({
    script, bin, name: "ambiguous-matches",
    covers: "main(): --company/--title matched N roles",
    setup: (ws) =>
      writeFiles(ws, {
        "jobs.md":
          "# Pipeline\n\n**Active: 2** · dismissed: 0 · updated 2026-08-01\n\n## To Review\n\n### A — Director One\n- Seen: 2026-08-01T00:00:00+00:00\n\n### A — Director Two\n- Seen: 2026-08-01T00:00:00+00:00\n",
      }),
    args: (ws) => ["--workspace", ws, "--company", "A", "--title", "Director", "--restore"],
  });
  addCase({
    script, bin, name: "argparse-mutex-required-missing",
    covers: "argparse: one of --stage/--dismiss/--restore required",
    setup: () => {},
    args: (ws) => ["--workspace", ws, "--company", "A", "--title", "B"],
  });
  addCase({
    script, bin, name: "argparse-mutex-conflict",
    covers: "argparse: --stage not allowed with --dismiss",
    setup: () => {},
    args: (ws) => ["--workspace", ws, "--company", "A", "--title", "B", "--stage", "Applied", "--dismiss"],
  });
  addCase({
    script, bin, name: "argparse-invalid-stage-choice",
    covers: "argparse: --stage choices",
    setup: () => {},
    args: (ws) => ["--workspace", ws, "--company", "A", "--title", "B", "--stage", "Bogus"],
  });
  addCase({
    script, bin, name: "argparse-missing-workspace",
    covers: "argparse: --workspace, --company, --title required",
    setup: () => {},
    args: () => ["--company", "A", "--title", "B", "--dismiss"],
  });
}

// ---------------------------------------------------------------- check_files.py
{
  const script = "profile/scripts/check_files.py";
  const bin = "check_files.mjs";
  const FULL_PROFILE =
    "# P\n## Snapshot\n## Experience\n## Intake findings\n### Positioning strengths\n### Likely interviewer concerns\n" +
    "### Career-narrative gaps\n### Story seeds\n## Interview history\n## Constraints\n## Application defaults\n";
  const TIER1 = "| date | round | driver | scored vs FIXED | what changed |";
  addCase({
    script, bin, name: "conforming-profile",
    covers: "test_conforming_profile_passes",
    setup: (ws) => writeFiles(ws, { "profile.md": FULL_PROFILE }),
    args: (ws) => ["--workspace", ws, "--skills", SKILLS],
  });
  addCase({
    script, bin, name: "missing-required-section",
    covers: "test_missing_required_section_fails",
    setup: (ws) => writeFiles(ws, { "profile.md": "# P\n## Snapshot\n" }),
    args: (ws) => ["--workspace", ws, "--skills", SKILLS],
  });
  addCase({
    script, bin, name: "foreign-section",
    covers: "test_foreign_section_fails_with_its_owner_named",
    setup: (ws) =>
      writeFiles(ws, {
        "criteria.md":
          "# C\n## Targets\n## Level\n## Geo\n## Compensation\n## Dealbreakers\n## Target companies\n## Retired\n## Interview history\n",
      }),
    args: (ws) => ["--workspace", ws, "--skills", SKILLS],
  });
  addCase({
    script, bin, name: "unknown-section-warns",
    covers: "test_unknown_section_only_warns, test_escape_hatch_contents_are_not_policed",
    setup: (ws) => writeFiles(ws, { "profile.md": FULL_PROFILE + "## Wildcard\n## Other notes\n### Anything At All\n" }),
    args: (ws) => ["--workspace", ws, "--skills", SKILLS],
  });
  addCase({
    script, bin, name: "singular-plural-fold",
    covers: "test_singular_plural_folds",
    setup: (ws) => writeFiles(ws, { "profile.md": FULL_PROFILE + "## Target\n" }),
    args: (ws) => ["--workspace", ws, "--skills", SKILLS],
  });
  addCase({
    script, bin, name: "absent-workspace-files",
    covers: "test_absent_file_is_not_an_error",
    setup: () => {},
    args: (ws) => ["--workspace", ws, "--skills", SKILLS],
  });
  addCase({
    script, bin, name: "storybank-schema",
    covers: "test_storybank_schema_registered_and_enforced",
    setup: (ws) => writeFiles(ws, { "storybank.md": "# Storybank\n\n## Coverage\n\n- FDE org design [source: jd-analysis]\n\n## Stories\n\n| ID | Title |\n|---|---|\n" }),
    args: (ws) => ["--workspace", ws, "--skills", SKILLS],
  });
  addCase({
    script, bin, name: "candidate-history-not-policed",
    covers: "test_candidate_history_file_is_not_policed",
    setup: (ws) => writeFiles(ws, { "interview-history.md": "# My interviews\n\nnotes in prose\n" }),
    args: (ws) => ["--workspace", ws, "--skills", SKILLS],
  });
  addCase({
    script, bin, name: "inlined-rounds-table",
    covers: "test_inlined_rounds_table_enforced",
    setup: (ws) =>
      writeFiles(ws, {
        "base-resume.md":
          "# Base\n## Experience\n- Staff Eng\n## Claim rules\n- x\n## Rounds\n" +
          TIER1 +
          "\n|---|---|---|---|---|\n| 2026-08-24 | 1 | improve | 5/5 held | trimmed intro |\n| 2026-08-24 | 2 | improve | short row |\n",
      }),
    args: (ws) => ["--workspace", ws, "--skills", SKILLS],
  });
  addCase({
    script, bin, name: "stray-file-and-dir",
    covers: "test_stray_file_and_dir_warn_but_never_fail",
    setup: (ws) => {
      writeFiles(ws, { "profile.md": "# ok\n", "Old_Master_Resume.md": "# stray\n" });
      mkdirSync(join(ws, "random-notes"), { recursive: true });
    },
    args: (ws) => ["--workspace", ws, "--skills", SKILLS],
  });
  addCase({
    script, bin, name: "application-tables",
    covers: "test_selection_table_enums_and_cell_count, test_a_realistic_multi_table_application_is_silent",
    setup: (ws) =>
      writeFiles(ws, {
        "applications/acme-role.md":
          "# Acme — Staff Engineer\n\n## Coverage\n\n| requirement | status | evidence | decision |\n|---|---|---|---|\n" +
          "| Python | have | bullet 3 | answered |\n| Payments | sort of | — | maybe |\n\n" +
          "## Selection\n\n| # | role | bullet | in/out | source | words | why |\n|---|---|---|---|---|---|---|\n" +
          "| 1 | Northwind Labs | Built the deployment machine | in | base | 42 | org scale |\n" +
          "| 2 | Cheetah | Ad platform features | dropped | invented | 22 |\n",
      }),
    args: (ws) => ["--workspace", ws, "--skills", SKILLS],
  });
  addCase({
    script, bin, name: "accented-heading-not-a-schema-break",
    covers: "design-web-agent.md § 5 known risk: accented text",
    setup: (ws) => writeFiles(ws, { "profile.md": FULL_PROFILE + "## Café notes\n" }),
    args: (ws) => ["--workspace", ws, "--skills", SKILLS],
  });
  addCase({
    script, bin, name: "argparse-missing-workspace",
    covers: "argparse: --workspace required",
    setup: () => {},
    args: () => ["--skills", SKILLS],
  });
}

// ---- run the corpus ----------------------------------------------------
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00/g;

// jobs.md timestamps are wall-clock (Python's datetime.now(timezone.utc)),
// so the two engines could stamp a different second. Diff the file against
// its OWN pre-run content to find the timestamp(s) THIS run freshly wrote
// (not a preserved field like an existing row's "Seen:"), then freeze the
// JS run's clock to that exact instant — see bin/record_verdict.mjs.
function freezeEnvFromWrite(beforeContent, afterContent) {
  if (!afterContent) return process.env;
  const before = new Set((beforeContent || "").match(ISO_RE) || []);
  const after = afterContent.match(ISO_RE) || [];
  const fresh = after.find((t) => !before.has(t)) || after[0];
  if (!fresh) return process.env;
  return { ...process.env, CHECKER_NOW_ISO: fresh };
}

// Both engines run against DIFFERENT temp dirs (so writers can be diffed
// independently), so any absolute path embedded in stdout (a "file not
// found: <path>" or a rendered HTML's own path) differs between them for a
// reason that has nothing to do with checker behavior. Normalize each
// engine's own workspace path to a placeholder before comparing.
function normalize(text, ws) {
  return text.split(ws).join("<WS>");
}

let failures = 0;
const results = [];

for (const c of CASES) {
  const ws1 = mkws();
  const ws2 = mkws();
  c.setup(ws1);
  c.setup(ws2);
  const args1 = c.args(ws1);
  const args2 = c.args(ws2);

  const beforeFile = c.diffFiles ? c.diffFiles.map((rel) => readIfExists(join(ws1, rel))) : [];

  const py = runPy(c.script, args1);
  let jsEnv = process.env;
  if (c.freezeClock) {
    const after = readIfExists(join(ws1, "jobs.md"));
    jsEnv = freezeEnvFromWrite(beforeFile[0], after);
  }
  const js = runJs(c.bin, args2, jsEnv);

  const pyOut = normalize(py.stdout, ws1);
  const jsOut = normalize(js.stdout, ws2);
  const pyErr = normalize(py.stderr, ws1);
  const jsErr = normalize(js.stderr, ws2);

  let same = pyOut === jsOut && pyErr === jsErr && py.status === js.status;
  let fileNote = "";
  if (same && c.diffFiles) {
    c.diffFiles.forEach((rel, i) => {
      const a = readIfExists(join(ws1, rel));
      const b = readIfExists(join(ws2, rel));
      if (a !== b) {
        same = false;
        fileNote += ` FILE DIFF: ${rel}`;
      }
    });
  }

  results.push({ script: c.script, name: c.name, same });
  console.log(`[${same ? "PASS" : "FAIL"}] ${c.script.split("/").pop()} :: ${c.name}  py.exit=${py.status} js.exit=${js.status}${fileNote}`);
  if (!same) {
    failures++;
    console.log("  --- python stdout ---");
    console.log((pyOut || "").replace(/^/gm, "  "));
    if (pyErr) console.log("  --- python stderr ---\n" + pyErr.replace(/^/gm, "  "));
    console.log("  --- js stdout ---");
    console.log((jsOut || "").replace(/^/gm, "  "));
    if (jsErr) console.log("  --- js stderr ---\n" + jsErr.replace(/^/gm, "  "));
  }
}

console.log(`\n${CASES.length - failures}/${CASES.length} cases byte-identical (stdout + exit code${""})`);
process.exit(failures ? 1 : 0);
