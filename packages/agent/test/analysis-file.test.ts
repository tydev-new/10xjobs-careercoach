// rowAnalysisFile — design-web-agent.md C § 6.2, "A row's analysis file,
// legacy rows included" (lead ruling 2026-09-30, issue #32): the ruling's
// own table, over rows in the jobs_md port's load() shape (real rows parsed
// by skills/search/scripts/lib/jobs-md.mjs, plus bare objects).
import assert from "node:assert/strict";
import test from "node:test";
import { rowAnalysisFile } from "../src/index.ts";
import * as jm from "../../../skills/search/scripts/lib/jobs-md.mjs";

const TABLE: { name: string; row: { analysis_file?: string | null; jd_file?: string | null }; want: string | undefined }[] = [
  { name: "Analysis only", row: { analysis_file: "jd-analysis/acme-pm.md" }, want: "jd-analysis/acme-pm.md" },
  { name: "JD under jd-analysis/ only (legacy)", row: { jd_file: "jd-analysis/acme-pm.md" }, want: "jd-analysis/acme-pm.md" },
  { name: "JD under jd-inbox/ only -> none", row: { jd_file: "jd-inbox/acme-pm.md" }, want: undefined },
  {
    name: "both -> Analysis",
    row: { analysis_file: "jd-analysis/acme-pm.md", jd_file: "jd-inbox/acme-pm.md" },
    want: "jd-analysis/acme-pm.md",
  },
  {
    name: "both, JD also under jd-analysis/ -> Analysis",
    row: { analysis_file: "jd-analysis/acme-pm-v2.md", jd_file: "jd-analysis/acme-pm.md" },
    want: "jd-analysis/acme-pm-v2.md",
  },
  { name: "neither -> none", row: {}, want: undefined },
  { name: "neither (load()'s null for an empty value) -> none", row: { analysis_file: null, jd_file: null }, want: undefined },
  { name: "JD is the bare folder prefix -> none", row: { jd_file: "jd-analysis/" }, want: undefined },
  { name: "JD merely contains jd-analysis/ -> none", row: { jd_file: "old/jd-analysis/acme-pm.md" }, want: undefined },
];

for (const { name, row, want } of TABLE) {
  test(`rowAnalysisFile: ${name}`, () => {
    assert.equal(rowAnalysisFile(row), want);
  });
}

test("rowAnalysisFile over the real port's load() rows: the same table", async () => {
  const md = [
    "## To Review",
    "",
    "### A — Analysis only",
    "- Analysis: jd-analysis/a.md",
    "",
    "### B — Legacy JD",
    "- JD: jd-analysis/b.md",
    "",
    "### C — Inbox JD",
    "- JD: jd-inbox/c.md",
    "",
    "### D — Both",
    "- JD: jd-inbox/d.md",
    "- Analysis: jd-analysis/d.md",
    "",
    "### E — Neither",
    "- Verdict: weak",
    "",
    "### F — Empty Analysis, legacy JD",
    "- Analysis:",
    "- JD: jd-analysis/f.md",
    "",
  ].join("\n");
  const rows: any[] = await jm.load({ exists: async () => true, readFile: async () => md }, "");
  assert.deepEqual(
    rows.map((r) => [r.company, rowAnalysisFile(r)]),
    [
      ["A", "jd-analysis/a.md"],
      ["B", "jd-analysis/b.md"],
      ["C", undefined],
      ["D", "jd-analysis/d.md"],
      ["E", undefined],
      ["F", "jd-analysis/f.md"],
    ],
  );
});
