// Unit/table tests for Jobs' own reader/view-model logic
// (design-web-ui.md § 5.3 "Jobs: the pipeline record"; § 5.9 Stage 3b's
// own exit list). Run: node --test src/workspace/jobs.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceError } from "../types.ts";
import type { FileInfo, FileRead, WorkspaceStore } from "../types.ts";
import {
  applicationKeyForRow,
  competencySection,
  cultureSection,
  dealbreakersDisplay,
  datePart,
  dismissedFromLabel,
  dismissedRows,
  firstRowInPageOrder,
  firstRowOfStage,
  fitSection,
  groupJobsByStage,
  hasLinkedApplication,
  isQuickScan,
  loadFieldFile,
  roleLabel,
  rowKey,
  safeHref,
  scoreDisplay,
  snapshotSection,
  verdictLabel,
  type JobsMdRow,
} from "./jobs.ts";

function row(partial: Partial<JobsMdRow> & Pick<JobsMdRow, "company" | "title">): JobsMdRow {
  return { stage: "To Review", dismissed: false, ...partial };
}

// ------------------------------------------------------------- grouping

test("groupJobsByStage: STAGES order, file order within a stage, empty stages left out", () => {
  const rows: JobsMdRow[] = [
    row({ company: "Zeta", title: "PM", stage: "Applied" }),
    row({ company: "Acme", title: "Eng", stage: "To Review" }),
    row({ company: "Beta", title: "Eng", stage: "To Review" }),
    row({ company: "Gone", title: "Eng", stage: "To Review", dismissed: true, was_stage: "To Review" }),
  ];
  const groups = groupJobsByStage(rows);
  assert.deepEqual(
    groups.map((g) => g.stage),
    ["To Review", "Applied"],
  );
  assert.deepEqual(
    groups[0].rows.map((r) => r.company),
    ["Acme", "Beta"], // file order, never re-sorted
  );
  assert.equal(groups[1].rows.length, 1);
});

test("dismissedRows: only dismissed rows, file order", () => {
  const rows: JobsMdRow[] = [
    row({ company: "A", title: "1", dismissed: true }),
    row({ company: "B", title: "2", dismissed: false }),
    row({ company: "C", title: "3", dismissed: true }),
  ];
  assert.deepEqual(
    dismissedRows(rows).map((r) => r.company),
    ["A", "C"],
  );
});

test("firstRowInPageOrder: the first stage group's first row", () => {
  const rows: JobsMdRow[] = [
    row({ company: "Zeta", title: "PM", stage: "Applied" }),
    row({ company: "Acme", title: "Eng", stage: "To Review" }),
  ];
  assert.equal(firstRowInPageOrder(rows)?.company, "Acme");
});

test("firstRowInPageOrder: falls through to Dismissed when no active rows exist", () => {
  const rows: JobsMdRow[] = [row({ company: "Gone", title: "Role", dismissed: true, was_stage: "Applied" })];
  assert.equal(firstRowInPageOrder(rows)?.company, "Gone");
});

test("firstRowInPageOrder: undefined with no rows at all", () => {
  assert.equal(firstRowInPageOrder([]), undefined);
});

test("firstRowOfStage: the first row of a named stage, file order", () => {
  const rows: JobsMdRow[] = [
    row({ company: "Zeta", title: "PM", stage: "Interested" }),
    row({ company: "Acme", title: "Eng", stage: "Interested" }),
  ];
  assert.equal(firstRowOfStage(rows, "Interested")?.company, "Zeta");
  assert.equal(firstRowOfStage(rows, "Offer"), undefined);
});

test("rowKey: stable identity across a re-fetch, distinguishes company/title", () => {
  const a = row({ company: "Acme", title: "Staff PM" });
  const b = { ...a }; // simulates the SAME row re-read after a re-verdict
  assert.equal(rowKey(a), rowKey(b));
  assert.notEqual(rowKey(a), rowKey(row({ company: "Acme", title: "Senior PM" })));
});

// -------------------------------------------------------- field display

test("verdictLabel: J1 no verdict; § 2.1's four labels; an unknown value as written", () => {
  assert.equal(verdictLabel(undefined), "Not evaluated yet");
  assert.equal(verdictLabel(null), "Not evaluated yet");
  assert.equal(verdictLabel(""), "Not evaluated yet");
  assert.equal(verdictLabel("strong"), "Strong Fit");
  assert.equal(verdictLabel("investable_stretch"), "Investable Stretch");
  assert.equal(verdictLabel("long_shot"), "Long-Shot Stretch");
  assert.equal(verdictLabel("weak"), "Weak Fit");
  assert.equal(verdictLabel("something_new"), "something_new");
});

test("isQuickScan: case-insensitive 'quick-scan:' prefix, matching Cards.tsx", () => {
  assert.equal(isQuickScan("quick-scan: consumer CPG"), true);
  assert.equal(isQuickScan("Quick-Scan: still matches"), true);
  assert.equal(isQuickScan("a full reason, no prefix"), false);
  assert.equal(isQuickScan(undefined), false);
  assert.equal(isQuickScan(null), false);
});

test("dealbreakersDisplay: only shown on a row with a Verdict; 'none' when absent", () => {
  assert.equal(dealbreakersDisplay({ fit_verdict: null, dealbreakers: undefined }), undefined);
  assert.equal(dealbreakersDisplay({ fit_verdict: "strong", dealbreakers: undefined }), "none");
  assert.equal(dealbreakersDisplay({ fit_verdict: "strong", dealbreakers: "" }), "none");
  assert.equal(dealbreakersDisplay({ fit_verdict: "strong", dealbreakers: "on-site 5 days" }), "on-site 5 days");
});

test("scoreDisplay: N1's one form, <n>/100; no score, no number", () => {
  assert.equal(scoreDisplay(82), "82/100");
  assert.equal(scoreDisplay(0), "0/100");
  assert.equal(scoreDisplay(undefined), undefined);
  assert.equal(scoreDisplay(null), undefined);
});

test("datePart: the first 10 characters, as written; absent field -> undefined", () => {
  assert.equal(datePart("2026-09-22T22:36:05+00:00"), "2026-09-22");
  assert.equal(datePart(undefined), undefined);
  assert.equal(datePart(null), undefined);
});

test("roleLabel: P4's exact form", () => {
  assert.equal(roleLabel({ company: "Acme", title: "Staff PM" }), "Acme — Staff PM");
});

test("dismissedFromLabel: J5's exact form, reading the row's own (already-folded) stage", () => {
  assert.equal(dismissedFromLabel({ dismissed: false, stage: "To Review" }), undefined);
  assert.equal(dismissedFromLabel({ dismissed: true, stage: "Interested" }), "Dismissed from Interested");
  assert.equal(dismissedFromLabel({ dismissed: true, stage: null }), "Dismissed from To Review");
});

// ---------------------------------------------- § 5.2 rule 7, the URL table

test("safeHref: § 5.2 rule 7's own table", () => {
  assert.equal(safeHref("https://example.com/job/1"), "https://example.com/job/1");
  assert.equal(safeHref("http://example.com/job/1"), "http://example.com/job/1");
  assert.equal(safeHref("javascript:alert(1)"), undefined);
  assert.equal(safeHref("data:text/html,<script>alert(1)</script>"), undefined);
  assert.equal(safeHref(" https://x"), undefined); // a leading space
  assert.equal(safeHref(undefined), undefined);
  assert.equal(safeHref(null), undefined);
  assert.equal(safeHref(""), undefined);
});

// --------------------------------------------------------- the detail's files

class FakeStore implements WorkspaceStore {
  private files: Record<string, string>;
  constructor(files: Record<string, string>) {
    this.files = files;
  }
  async list(): Promise<FileInfo[]> {
    return [];
  }
  async read(path: string): Promise<FileRead> {
    if (!(path in this.files)) throw new WorkspaceError("resource_missing", path);
    const info: FileInfo = { path, version: "v1", size: 1, updatedAt: "2026-09-22T00:00:00Z", editable: true };
    return { ...info, binary: false, content: this.files[path] };
  }
  async write(): Promise<FileInfo> {
    throw new Error("never called");
  }
  async upload(): Promise<FileInfo> {
    throw new Error("never called");
  }
}

class ThrowingStore implements WorkspaceStore {
  async list(): Promise<FileInfo[]> {
    return [];
  }
  async read(): Promise<FileRead> {
    throw new WorkspaceError("content_too_large", "too big");
  }
  async write(): Promise<FileInfo> {
    throw new Error("never called");
  }
  async upload(): Promise<FileInfo> {
    throw new Error("never called");
  }
}

test("loadFieldFile: absent (no field on the row)", async () => {
  const store = new FakeStore({});
  assert.deepEqual(await loadFieldFile(store, undefined), { kind: "absent" });
  assert.deepEqual(await loadFieldFile(store, null), { kind: "absent" });
});

test("loadFieldFile: missing (the field names a file that isn't there)", async () => {
  const store = new FakeStore({});
  assert.deepEqual(await loadFieldFile(store, "jd-analysis/never-written.md"), {
    kind: "missing",
    path: "jd-analysis/never-written.md",
  });
});

test("loadFieldFile: error (any other read failure)", async () => {
  const store = new ThrowingStore();
  assert.deepEqual(await loadFieldFile(store, "jd-analysis/acme.md"), {
    kind: "error",
    path: "jd-analysis/acme.md",
  });
});

test("loadFieldFile: ready, split into sections", async () => {
  const store = new FakeStore({ "jd-analysis/acme.md": "## Competency extraction\n1. a\n" });
  const result = await loadFieldFile(store, "jd-analysis/acme.md");
  assert.equal(result.kind, "ready");
  if (result.kind === "ready") {
    assert.equal(result.path, "jd-analysis/acme.md");
    assert.equal(competencySection(result.sections)?.body, "1. a\n");
    assert.equal(fitSection(result.sections), undefined);
  }
});

test("snapshotSection / cultureSection: the company file's own two headings", () => {
  const sections = [
    { heading: "Snapshot", body: "- Stage: Series C\n" },
    { heading: "Culture & hiring signals", body: "- values\n" },
    { heading: "Fit notes", body: "extra, not part of § 5.3" },
  ];
  assert.equal(snapshotSection(sections)?.body, "- Stage: Series C\n");
  assert.equal(cultureSection(sections)?.body, "- values\n");
});

test("a file with none of the named headings shows none of them", async () => {
  const store = new FakeStore({ "jd-analysis/acme.md": "## Verdict: strong\nprose only\n" });
  const result = await loadFieldFile(store, "jd-analysis/acme.md");
  assert.equal(result.kind, "ready");
  if (result.kind === "ready") {
    assert.equal(competencySection(result.sections), undefined);
    assert.equal(fitSection(result.sections), undefined);
  }
});

// ------------------------------------------------- "Open application" link

test("applicationKeyForRow: the exact jd-analysis/<key>.md shape only", () => {
  assert.equal(applicationKeyForRow({ analysis_file: "jd-analysis/acme-staff-pm.md" }), "acme-staff-pm");
  assert.equal(applicationKeyForRow({ analysis_file: undefined }), undefined);
  assert.equal(applicationKeyForRow({ analysis_file: null }), undefined);
  assert.equal(applicationKeyForRow({ analysis_file: "company/acme.md" }), undefined);
});

test("hasLinkedApplication: any of the six suffix forms, exact key match", () => {
  const files: FileInfo[] = [
    { path: "applications/acme-staff-pm-resume.md", version: "v1", size: 1, updatedAt: "x", editable: true },
  ];
  assert.equal(hasLinkedApplication(files, "acme-staff-pm"), true);
  assert.equal(hasLinkedApplication(files, "other-role"), false);
  assert.equal(hasLinkedApplication([], "acme-staff-pm"), false);
});

test("hasLinkedApplication: the plain <key>.md and <key>-application.md forms both count", () => {
  const plain: FileInfo[] = [
    { path: "applications/fernway-senior-pm.md", version: "v1", size: 1, updatedAt: "x", editable: true },
  ];
  assert.equal(hasLinkedApplication(plain, "fernway-senior-pm"), true);
  const application: FileInfo[] = [
    { path: "applications/acme-staff-pm-application.md", version: "v1", size: 1, updatedAt: "x", editable: true },
  ];
  assert.equal(hasLinkedApplication(application, "acme-staff-pm"), true);
});
