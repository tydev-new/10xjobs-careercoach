// Mirrors tests/test_check_materials.py against the JS port's pure
// functions (checkResume/checkLetter). CLI-level (argparse errors, file
// I/O) parity is proved separately by test/parity.mjs against the real
// Python script.
import test from "node:test";
import assert from "node:assert/strict";
import { checkResume, checkLetter } from "../../src/check-materials.mjs";

const RESUME_TWO_SECTIONS = `# Alex Chen

## Summary

${"word ".repeat(133)}

## Selected experience against this role

**Sell — technical discovery through executive close**

- Ran a solutions-led transformation.
`;

const RESUME_CLEAN = `# Alex Chen

## Summary

**Forward-Deployed & Solutions Engineering Leader**
*Turning deployment friction into product strategy.*

Built the function twice, from zero, by treating deployment friction as product
intelligence rather than support noise. Still shipping production code today.

- **8+ years leading technical teams:** yes — shipping today.
- **Lead and scale a team:** built the function from zero.
- **Own discovery through close:** cut cycles 4 months to 3 weeks.
- **Executive sponsor:** redirected the account from near-cancellation.
- **Reusable playbooks:** 12-week engagements became 4-week.
- **Escalate product gaps:** built the field-metrics dashboard.

## Experience

Platform Lead — Northwind Labs.
`;

const LETTER_INFORMAL = `# Cover letter

Hello —

${Array.from({ length: 6 }, () => "filler ".repeat(45).trim()).join("\n\n")}

Alex Chen
`;

const LETTER_CLEAN = `# Cover letter

Dear Hiring Manager,

${Array.from({ length: 5 }, () => "filler ".repeat(60).trim()).join("\n\n")}

Alex Chen
`;

const LETTER_HAZARD = `# Cover letter

Dear Hiring Manager,

${Array.from({ length: 4 }, () => "filler ".repeat(60).trim()).join("\n\n")}

I built it solo, and I am excited to bring 25+ years of experience.

Alex Chen
`;

function fails(results) {
  return results.filter(([l]) => l === "FAIL").map(([, m]) => m);
}
function warns(results) {
  return results.filter(([l]) => l === "WARN").map(([, m]) => m);
}

test("two opening sections caught (the real defect, 2026-08-01)", () => {
  assert.ok(fails(checkResume(RESUME_TWO_SECTIONS)).some((m) => m.includes("two opening sections")));
});
test("over-long case caught (133-word case vs the 7-11s scan budget)", () => {
  assert.ok(fails(checkResume(RESUME_TWO_SECTIONS)).some((m) => m.includes("Summary opens with")));
});
test("clean résumé passes", () => {
  assert.deepEqual(fails(checkResume(RESUME_CLEAN)), []);
});
test("DM-register salutation caught", () => {
  assert.ok(fails(checkLetter(LETTER_INFORMAL)).some((m) => m.includes("DM register")));
});
test("block count flags as WARN, never FAILs (the earned-FAIL bar, #11 demote)", () => {
  assert.ok(warns(checkLetter(LETTER_INFORMAL)).some((m) => m.includes("blocks")));
  assert.ok(!fails(checkLetter(LETTER_INFORMAL)).some((m) => m.includes("blocks")));
});
test("clean letter passes", () => {
  assert.deepEqual(fails(checkLetter(LETTER_CLEAN)), []);
});
test("hazard/never-say rungs migrated away (#29) — the code floor must not re-catch them", () => {
  const f = fails(checkLetter(LETTER_HAZARD));
  assert.ok(!f.some((m) => m.includes("never-say") || m.includes("struck form")));
});
test("aggregate year count still caught", () => {
  assert.ok(fails(checkLetter(LETTER_HAZARD)).some((m) => m.includes("year count")));
});
test("the JD's bar quoted in a bolded opener is exempt from rule 3", () => {
  const quoting = RESUME_CLEAN.replace(
    "- **8+ years leading technical teams:** yes — shipping today.",
    "- **10+ years in software engineering, with 5+ years leading delivery teams:** yes — shipping today."
  );
  assert.ok(!fails(checkResume(quoting)).some((m) => m.includes("year count")));
});
test("the candidate's own aggregate total is still caught", () => {
  const own = RESUME_CLEAN.replace("Built the function twice", "With 25+ years of experience, built the function twice");
  assert.ok(fails(checkResume(own)).some((m) => m.includes("year count")));
});

const BASE_RW = `# Alex Chen

## Professional Experience

### Meridian Health — Senior Data Analyst
**2022 - Present**

- Wrote and maintained SQL pipelines in Postgres over claims data, feeding the finance team.
- Collaborated with team on the quarterly forecast.

## Claim rules
- ⚠ never "solo" — team of two.
`;

function rw(body) {
  return "# Alex Chen\n\n## Summary\n\nSenior analyst.\n\n## Selected Experience\n\n### Meridian Health\n**2022**\n\n" + body;
}

test("declared rewording is exempt (candidate ruling 2026-08-19)", () => {
  const body =
    "- Built and owned data pipelines in Postgres over claims data, feeding the finance team.\n\n" +
    "## Reworded\n\n" +
    "- base: Wrote and maintained SQL pipelines in Postgres over claims data, feeding the finance team.\n" +
    "  tailored: Built and owned data pipelines in Postgres over claims data, feeding the finance team.\n";
  assert.ok(!fails(checkResume(rw(body), BASE_RW)).some((m) => m.includes("not verbatim")));
});

test("undeclared rewording still fails", () => {
  const body = "- Built and owned data pipelines in Postgres over claims data, feeding the finance team.\n";
  assert.ok(fails(checkResume(rw(body), BASE_RW)).some((m) => m.includes("not verbatim")));
});

test("a Reworded block cannot self-issue its own exemption", () => {
  const body =
    "- Led a 60-person organization across three continents.\n\n" +
    "## Reworded\n\n" +
    "- base: Led a 60-person organization across three continents.\n" +
    "  tailored: Led a 60-person organization across three continents.\n";
  assert.ok(fails(checkResume(rw(body), BASE_RW)).some((m) => m.includes("not in the base")));
});

test("accented text: an é in a bullet does not break the base-verbatim word boundary (design-web-agent.md § 5 known risk)", () => {
  const base = "# Base\n\n## Experience\n- Wrote the café pipeline in Montréal for the finance team.\n";
  const doc = "# A\n\n## Summary\n\nok.\n\n## Experience\n\n- Wrote the café pipeline in Montréal for the finance team.\n";
  assert.deepEqual(fails(checkResume(doc, base)), []);
});
