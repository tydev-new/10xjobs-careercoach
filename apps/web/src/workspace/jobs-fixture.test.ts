// Jobs' own readers over the shared § 5.7 page fixture
// (apps/web/fixtures/workspace-pages.json) — design-web-ui.md § 5.9 Stage
// 3b's own exit list: "compare the page with load() over the fixture,
// field by field"; "the detail's sections equal the fixture files'
// sections string for string; a quick-scan row shows no analysis or
// company parts; the missing-file line and a failing read."
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { FixtureStore } from "../store.ts";
import type { FileInfo, FileRead, Fixture, WorkspaceStore } from "../types.ts";
import { WorkspaceError } from "../types.ts";
import {
  applicationKeyForRow,
  competencySection,
  cultureSection,
  dealbreakersDisplay,
  datePart,
  dismissedFromLabel,
  dismissedRows,
  fitSection,
  groupJobsByStage,
  hasLinkedApplication,
  loadFieldFile,
  loadJobsRows,
  roleLabel,
  safeHref,
  scoreDisplay,
  snapshotSection,
  verdictLabel,
} from "./jobs.ts";
import { splitSections } from "./sections.ts";
import { storeIo } from "./store-io.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE: Fixture = JSON.parse(readFileSync(join(HERE, "../../fixtures/workspace-pages.json"), "utf8"));

test("workspace-pages fixture: every role shows once, in its stage, in file order — one count per group", async () => {
  const store = new FixtureStore(FIXTURE);
  const rows = await loadJobsRows(storeIo(store));
  const groups = groupJobsByStage(rows);
  assert.deepEqual(
    groups.map((g) => [g.stage, g.rows.length, g.rows.map((r) => r.company)]),
    [
      ["To Review", 1, ["Cascadia Analytics"]],
      ["Interested", 1, ["Brightloom Foods"]],
      ["Applied", 1, ["NovaGrid Energy"]],
      ["Interviewing", 1, ["Fernway Robotics"]],
      ["Offer", 1, ["Solstice Health"]],
    ],
  );
  // every role appears exactly once across the whole page
  const allActive = groups.flatMap((g) => g.rows.map((r) => r.company));
  assert.equal(new Set(allActive).size, allActive.length);
});

test("workspace-pages fixture: Dismissed, closed by default, with its count", async () => {
  const store = new FixtureStore(FIXTURE);
  const rows = await loadJobsRows(storeIo(store));
  const dismissed = dismissedRows(rows);
  assert.equal(dismissed.length, 1);
  assert.equal(dismissed[0].company, "Ashcroft Systems");
  assert.equal(dismissed[0].title, "Growth PM");
  assert.equal(dismissedFromLabel(dismissed[0]), "Dismissed from To Review");
  assert.match(dismissed[0].dismiss_note ?? "", /doesn't match the Track A target$/);
});

test("workspace-pages fixture: field by field, word for word — NovaGrid's row (full verdict)", async () => {
  const store = new FixtureStore(FIXTURE);
  const rows = await loadJobsRows(storeIo(store));
  const novagrid = rows.find((r) => r.company === "NovaGrid Energy")!;
  assert.equal(roleLabel(novagrid), "NovaGrid Energy — Staff PM");
  assert.equal(verdictLabel(novagrid.fit_verdict), "Strong Fit");
  assert.equal(scoreDisplay(novagrid.fit_score), "88/100");
  assert.equal(novagrid.location, "Remote (US)");
  assert.equal(datePart(novagrid.seen_at), "2026-09-29");
  assert.equal(datePart(novagrid.updated_at), "2026-09-29");
  assert.match(novagrid.fit_reason ?? "", /^Eight years leading platform PM work/);
  assert.equal(dealbreakersDisplay(novagrid), "none");
  assert.equal(safeHref(novagrid.url), "https://jobs.novagrid.example.com/staff-pm-4471");
  assert.equal(novagrid.analysis_file, "jd-analysis/novagrid-staff-pm.md");
  assert.equal(novagrid.company_file, "company/novagrid-energy.md");
});

test("workspace-pages fixture: Fernway's row carries a Dealbreakers line", async () => {
  const store = new FixtureStore(FIXTURE);
  const rows = await loadJobsRows(storeIo(store));
  const fernway = rows.find((r) => r.company === "Fernway Robotics")!;
  assert.match(fernway.dealbreakers ?? "", /quarterly travel to the Austin hardware lab/);
  assert.equal(dealbreakersDisplay(fernway), fernway.dealbreakers);
});

test("workspace-pages fixture: Brightloom is a quick-scan row with no Analysis or Company file", async () => {
  const store = new FixtureStore(FIXTURE);
  const rows = await loadJobsRows(storeIo(store));
  const brightloom = rows.find((r) => r.company === "Brightloom Foods")!;
  assert.match(brightloom.fit_reason ?? "", /^quick-scan:/);
  assert.equal(brightloom.analysis_file, undefined);
  assert.equal(brightloom.company_file, undefined);
  const analysis = await loadFieldFile(store, brightloom.analysis_file);
  const company = await loadFieldFile(store, brightloom.company_file);
  assert.deepEqual(analysis, { kind: "absent" });
  assert.deepEqual(company, { kind: "absent" });
});

test("workspace-pages fixture: Cascadia's Analysis field names a file that was never written (missing), its Company file is ready", async () => {
  const store = new FixtureStore(FIXTURE);
  const rows = await loadJobsRows(storeIo(store));
  const cascadia = rows.find((r) => r.company === "Cascadia Analytics")!;
  assert.equal(cascadia.analysis_file, "jd-analysis/cascadia-product-lead.md");
  const analysis = await loadFieldFile(store, cascadia.analysis_file);
  assert.deepEqual(analysis, { kind: "missing", path: "jd-analysis/cascadia-product-lead.md" });

  const company = await loadFieldFile(store, cascadia.company_file);
  assert.equal(company.kind, "ready");
  if (company.kind === "ready") {
    assert.equal(snapshotSection(company.sections)?.body, splitSections(FIXTURE.files["company/cascadia-analytics.md"])[0].body);
    assert.ok(cultureSection(company.sections));
  }
});

test("workspace-pages fixture: the detail's sections equal the fixture files' sections, string for string (NovaGrid)", async () => {
  const store = new FixtureStore(FIXTURE);
  const rows = await loadJobsRows(storeIo(store));
  const novagrid = rows.find((r) => r.company === "NovaGrid Energy")!;

  const analysis = await loadFieldFile(store, novagrid.analysis_file);
  assert.equal(analysis.kind, "ready");
  const expectedAnalysis = splitSections(FIXTURE.files["jd-analysis/novagrid-staff-pm.md"]);
  if (analysis.kind === "ready") {
    assert.deepEqual(analysis.sections, expectedAnalysis);
    assert.equal(competencySection(analysis.sections)?.heading, "Competency extraction");
    assert.equal(fitSection(analysis.sections)?.heading, "Fit assessment (Track A lens)");
  }

  const company = await loadFieldFile(store, novagrid.company_file);
  assert.equal(company.kind, "ready");
  const expectedCompany = splitSections(FIXTURE.files["company/novagrid-energy.md"]);
  if (company.kind === "ready") assert.deepEqual(company.sections, expectedCompany);
});

test("workspace-pages fixture: a failing (non-missing) read is loud, never the missing-file line", async () => {
  // A store whose read() throws a WorkspaceError with a NON-missing code
  // (store-io.test.ts's own posture for this case) — § 5.2 rule 6.
  const erroring: WorkspaceStore = {
    async list() {
      return [];
    },
    async read(): Promise<FileRead> {
      throw new WorkspaceError("content_too_large", "too big");
    },
    async write(): Promise<FileInfo> {
      throw new Error("never called");
    },
    async upload(): Promise<FileInfo> {
      throw new Error("never called");
    },
  };
  const result = await loadFieldFile(erroring, "jd-analysis/novagrid-staff-pm.md");
  assert.deepEqual(result, { kind: "error", path: "jd-analysis/novagrid-staff-pm.md" });
});

test("workspace-pages fixture: 'Open application' — NovaGrid and Fernway link, Solstice and Cascadia don't", async () => {
  const store = new FixtureStore(FIXTURE);
  const files = await store.list("applications");
  const rows = await loadJobsRows(storeIo(store));

  const novagrid = rows.find((r) => r.company === "NovaGrid Energy")!;
  const novagridKey = applicationKeyForRow(novagrid);
  assert.equal(novagridKey, "novagrid-staff-pm");
  assert.equal(hasLinkedApplication(files, novagridKey!), true);

  const fernway = rows.find((r) => r.company === "Fernway Robotics")!;
  const fernwayKey = applicationKeyForRow(fernway);
  assert.equal(fernwayKey, "fernway-senior-pm");
  assert.equal(hasLinkedApplication(files, fernwayKey!), true);

  const solstice = rows.find((r) => r.company === "Solstice Health")!;
  const solsticeKey = applicationKeyForRow(solstice);
  assert.equal(solsticeKey, "solstice-product-director");
  assert.equal(hasLinkedApplication(files, solsticeKey!), false);

  const cascadia = rows.find((r) => r.company === "Cascadia Analytics")!;
  // Cascadia's own Analysis field names a file that was never written —
  // applicationKeyForRow still derives a key from the field's own text
  // (never guessed from the company name), but no application file
  // exists under it either.
  const cascadiaKey = applicationKeyForRow(cascadia);
  assert.equal(cascadiaKey, "cascadia-product-lead");
  assert.equal(hasLinkedApplication(files, cascadiaKey!), false);
});
