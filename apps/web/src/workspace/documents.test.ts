// Unit tests for Documents' own logic (design-web-ui.md § 5.3, § 5.9 Stage
// 3a): grouping, sorting, leads.md exclusion, the display split and the
// date part. Run: node --test src/workspace/documents.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_GROUP_LABELS,
  DOCUMENT_GROUP_ORDER,
  datePart,
  groupDocuments,
  splitPathForDisplay,
  TOP_LEVEL_GROUP_LABEL,
} from "./documents.ts";
import type { FileInfo } from "../types.ts";

function file(path: string, updatedAt = "2026-09-22T10:00:00.000Z"): FileInfo {
  return { path, version: "v1", size: 10, updatedAt, editable: true };
}

test("every fixture file is listed exactly once, across all its groups", () => {
  const files = [
    file("plan.md"),
    file("jobs.md"),
    file("CLAUDE.md"),
    file("documents/resume.pdf"),
    file("applications/acme-staff-pm.md"),
    file("applications/acme-staff-pm-resume.html"),
    file("jd-analysis/acme-staff-pm.md"),
    file("jd-inbox/acme-staff-pm.md"),
    file("company/acme.md"),
    file("contacts/jane-doe.md"),
    file("prep/acme-notes.md"),
    file("practice/session-1.md"),
    file("stories/leading-a-launch.md"),
    file("courses/negotiation-101.md"),
    file("negotiation/acme-numbers.md"),
    file("scratch/idea.md"), // an unknown folder
  ];
  const groups = groupDocuments(files);
  const seen: string[] = [];
  for (const group of groups) {
    for (const f of group.files) seen.push(f.path);
  }
  assert.deepEqual(seen.sort(), files.map((f) => f.path).sort());
  // exactly once: no duplicates
  assert.equal(new Set(seen).size, seen.length);
});

test("leads.md is dropped from every group, but nothing else at top level is", () => {
  const files = [file("plan.md"), file("leads.md"), file("jobs.md")];
  const groups = groupDocuments(files);
  const paths = groups.flatMap((g) => g.files.map((f) => f.path));
  assert.ok(!paths.includes("leads.md"));
  assert.deepEqual(paths, ["jobs.md", "plan.md"]); // sorted by path too
});

test("leads.md alone leaves no groups at all (the page's empty state)", () => {
  assert.deepEqual(groupDocuments([file("leads.md")]), []);
});

test("no top-level files -> no 'Your records' group at all", () => {
  const groups = groupDocuments([file("documents/resume.pdf")]);
  assert.ok(!groups.some((g) => g.label === TOP_LEVEL_GROUP_LABEL));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "documents");
});

test("top-level files come first, under 'Your records'", () => {
  const groups = groupDocuments([file("documents/resume.pdf"), file("plan.md")]);
  assert.equal(groups[0].label, TOP_LEVEL_GROUP_LABEL);
  assert.equal(groups[0].key, "");
  assert.deepEqual(groups[0].files.map((f) => f.path), ["plan.md"]);
});

test("known folders group in § 5.3's own order, regardless of file order", () => {
  const files = [
    file("negotiation/a.md"),
    file("documents/a.pdf"),
    file("company/a.md"),
    file("applications/a.md"),
  ];
  const groups = groupDocuments(files);
  assert.deepEqual(
    groups.map((g) => g.key),
    ["documents", "applications", "company", "negotiation"],
  );
});

test("an unknown folder shows under its own name, after every known folder, sorted", () => {
  const files = [file("zzz-folder/a.md"), file("aaa-folder/b.md"), file("documents/c.pdf")];
  const groups = groupDocuments(files);
  assert.deepEqual(
    groups.map((g) => g.key),
    ["documents", "aaa-folder", "zzz-folder"],
  );
  assert.equal(groups[1].label, "aaa-folder");
  assert.equal(groups[2].label, "zzz-folder");
});

test("within a group, files are sorted by path — never file order", () => {
  const files = [file("documents/c.pdf"), file("documents/a.pdf"), file("documents/b.pdf")];
  const groups = groupDocuments(files);
  assert.deepEqual(
    groups[0].files.map((f) => f.path),
    ["documents/a.pdf", "documents/b.pdf", "documents/c.pdf"],
  );
});

test("CLAUDE.md (the app-written file) is an ordinary top-level file — no special case", () => {
  const groups = groupDocuments([file("CLAUDE.md")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, TOP_LEVEL_GROUP_LABEL);
  assert.deepEqual(groups[0].files.map((f) => f.path), ["CLAUDE.md"]);
});

test("the label table copies § 5.3.1's rows D2-D12 word for word", () => {
  assert.deepEqual(DOCUMENT_GROUP_LABELS, {
    documents: "Your uploads",
    applications: "Applications",
    "jd-analysis": "Role analyses",
    "jd-inbox": "Saved postings",
    company: "Company notes",
    contacts: "Contacts",
    prep: "Interview prep",
    practice: "Interview practice",
    stories: "Your stories",
    courses: "Courses",
    negotiation: "Pay notes",
  });
});

test("a known folder's group shows § 5.3.1's label, not its own folder name", () => {
  const groups = groupDocuments([file("jd-analysis/acme.md"), file("negotiation/acme.md")]);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Role analyses", "Pay notes"],
  );
});

test("DOCUMENT_GROUP_ORDER matches § 5.3's own MANIFEST_DIRS list, in its own order", () => {
  assert.deepEqual(DOCUMENT_GROUP_ORDER, [
    "documents",
    "applications",
    "jd-analysis",
    "jd-inbox",
    "company",
    "contacts",
    "prep",
    "practice",
    "stories",
    "courses",
    "negotiation",
  ]);
});

test("splitPathForDisplay: a top-level path has no prefix", () => {
  assert.deepEqual(splitPathForDisplay("plan.md"), { prefix: "", leaf: "plan.md" });
});

test("splitPathForDisplay: a nested path splits at the LAST slash", () => {
  assert.deepEqual(splitPathForDisplay("jd-analysis/acme-staff-pm.md"), {
    prefix: "jd-analysis/",
    leaf: "acme-staff-pm.md",
  });
  assert.deepEqual(splitPathForDisplay("applications/sub/deep.md"), {
    prefix: "applications/sub/",
    leaf: "deep.md",
  });
});

test("datePart takes the ISO date, never reformatted", () => {
  assert.equal(datePart("2026-09-22T10:00:00.000Z"), "2026-09-22");
});
