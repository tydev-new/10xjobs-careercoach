// Unit/table tests for splitSections/pickSection (design-web-ui.md § 5.3,
// "Pieces the pages share"; § 5.9 Stage 3b's own exit list). Run:
// node --test src/workspace/sections.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { pickSection, splitSections } from "./sections.ts";

test("a file with all of evaluate's headings splits into one section per heading, bodies word for word", () => {
  const md = [
    "# Acme — Staff PM: decode",
    "",
    "## Competency extraction",
    "1. Partner ecosystem — HIGH",
    "2. Cross-functional leadership — HIGH",
    "",
    "## Fit assessment (Track A lens)",
    "- Requirement coverage: Strong.",
    "",
    "## Verdict: **Strong Fit — 88/100**",
    "Eight years of platform PM work.",
  ].join("\n");
  const sections = splitSections(md);
  assert.deepEqual(
    sections.map((s) => s.heading),
    ["Competency extraction", "Fit assessment (Track A lens)", "Verdict: **Strong Fit — 88/100**"],
  );
  assert.equal(sections[0].body, "1. Partner ecosystem — HIGH\n2. Cross-functional leadership — HIGH\n");
  assert.equal(sections[1].body, "- Requirement coverage: Strong.\n");
  assert.equal(sections[2].body, "Eight years of platform PM work.");
});

test("a `### ` line stays inside the body — it never starts or ends a section", () => {
  const md = ["## Snapshot", "- Stage: Series C", "### not a section", "- more"].join("\n");
  const sections = splitSections(md);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, "Snapshot");
  assert.equal(sections[0].body, "- Stage: Series C\n### not a section\n- more");
});

test("`## Fit assessment (Track A lens)` is found by the prefix `Fit assessment`, heading kept whole", () => {
  const md = ["## Fit assessment (Track A lens)", "body here"].join("\n");
  const sections = splitSections(md);
  const found = pickSection(sections, "Fit assessment");
  assert.ok(found);
  assert.equal(found!.heading, "Fit assessment (Track A lens)");
});

test("pickSection returns undefined when the heading is absent", () => {
  const sections = splitSections("## Snapshot\nbody");
  assert.equal(pickSection(sections, "Culture & hiring signals"), undefined);
});

test("CRLF line endings are normalized before splitting", () => {
  const md = "## Snapshot\r\n- Stage: Series C\r\n\r\n## Culture & hiring signals\r\n- values here\r\n";
  const sections = splitSections(md);
  assert.deepEqual(
    sections.map((s) => s.heading),
    ["Snapshot", "Culture & hiring signals"],
  );
  assert.equal(sections[0].body, "- Stage: Series C\n");
  assert.equal(sections[1].body, "- values here\n");
});

test("a file with no `## ` line returns no sections", () => {
  assert.deepEqual(splitSections("just prose\nno headings at all"), []);
});

test("a `# ` line ends the section before it", () => {
  const md = ["## Snapshot", "- Stage: Series C", "# Some H1", "trailing prose, no section"].join("\n");
  const sections = splitSections(md);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, "Snapshot");
  assert.equal(sections[0].body, "- Stage: Series C");
});

test("lines before the first `## ` belong to no section", () => {
  const md = ["# Title", "some prose before any section", "## Snapshot", "body"].join("\n");
  const sections = splitSections(md);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, "Snapshot");
});

test("a real U+2028/U+2029 inside a heading or body survives byte for byte", () => {
  const md = `## Snapshot extra\n- line with   inside\n`;
  const sections = splitSections(md);
  assert.equal(sections[0].heading, "Snapshot extra");
  assert.equal(sections[0].body, "- line with   inside\n");
});
