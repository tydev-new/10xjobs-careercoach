import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseReferenceSections, defaultSeed, todayISO } from "../design-sample.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "design-sample.mjs");
const FIXTURES = path.join(HERE, "fixtures");
const FONTS_FILE = path.join(FIXTURES, "fonts.json");
const PAIRINGS_FILE = path.join(FIXTURES, "pairings.json");
const REFS_FILE = path.join(FIXTURES, "design-references.md");

function run(args, opts = {}) {
  try {
    const out = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8", ...opts });
    return { code: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function runWithFixtures(extraArgs) {
  return run([
    "--fonts-file",
    FONTS_FILE,
    "--pairings-file",
    PAIRINGS_FILE,
    "--refs-file",
    REFS_FILE,
    ...extraArgs,
  ]);
}

test("parseReferenceSections splits headings and excludes nothing itself", () => {
  const md = "## One\nbody one\n## Two\nbody two\n";
  const sections = parseReferenceSections(md);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].heading, "One");
  assert.equal(sections[0].body, "body one");
  assert.equal(sections[1].heading, "Two");
});

test("defaultSeed embeds today's date and a random suffix", () => {
  const a = defaultSeed(new Date("2026-09-24T12:00:00Z"));
  const b = defaultSeed(new Date("2026-09-24T12:00:00Z"));
  assert.match(a, /^2026-09-24-[0-9a-f]{8}$/);
  assert.notEqual(a, b, "two default seeds should not collide (random suffix)");
  assert.equal(todayISO(new Date("2026-09-24T12:00:00Z")), "2026-09-24");
});

test("exits 1 with a clear message when a source file is missing", () => {
  const result = run(["--fonts-file", path.join(FIXTURES, "does-not-exist.json")]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /missing fonts source file/);
});

test("samples the requested counts and stays deterministic for a fixed seed", () => {
  const r1 = runWithFixtures(["--fonts", "2", "--pairings", "1", "--refs", "2", "--seed", "fixed-seed"]);
  const r2 = runWithFixtures(["--fonts", "2", "--pairings", "1", "--refs", "2", "--seed", "fixed-seed"]);
  assert.equal(r1.code, 0);
  assert.equal(r1.stdout, r2.stdout, "same seed must produce byte-identical output");

  const fontsSection = r1.stdout.split("## Fonts")[1].split("## Pairings")[0];
  const fontNames = [...fontsSection.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
  assert.equal(fontNames.length, 2);
});

test("tolerates fonts with only name/category/license (missing optional fields)", () => {
  // all 3 fixture fonts requested -> deterministically includes the sparse one
  const r = runWithFixtures(["--fonts", "3", "--pairings", "0", "--refs", "0", "--seed", "s"]);
  assert.equal(r.code, 0);
  const fontsSection = r.stdout.split("## Fonts")[1].split("## Pairings")[0];
  const blocks = fontsSection.split(/^### /m).filter(Boolean);
  const mono = blocks.find((b) => b.startsWith("JetBrains Mono"));
  assert.ok(mono, "JetBrains Mono block not found");
  assert.match(mono, /- Category: monospace/);
  assert.doesNotMatch(mono, /- Weights:/);
  assert.doesNotMatch(mono, /- Variable:/);
  assert.doesNotMatch(mono, /- Avoid for:/);
});

test("tolerates a pairing with no mono_font key and no rationale key at all", () => {
  const r = runWithFixtures(["--fonts", "0", "--pairings", "3", "--refs", "0", "--seed", "s"]);
  assert.equal(r.code, 0);
  const pairingsSection = r.stdout.split("## Pairings")[1].split("## References")[0];
  const blocks = pairingsSection.split(/^### /m).filter(Boolean);
  const marketing = blocks.find((b) => b.includes("marketing-inter-inter"));
  assert.ok(marketing, "marketing-inter-inter block not found");
  assert.doesNotMatch(marketing, /- Mono:/);
  assert.doesNotMatch(marketing, /- Rationale:/);
});

test("tolerates a pairing whose mono_font is explicitly null", () => {
  const r = runWithFixtures(["--fonts", "0", "--pairings", "3", "--refs", "0", "--seed", "s"]);
  assert.equal(r.code, 0);
  const pairingsSection = r.stdout.split("## Pairings")[1].split("## References")[0];
  const blocks = pairingsSection.split(/^### /m).filter(Boolean);
  const doc = blocks.find((b) => b.includes("doc-fraunces-inter"));
  assert.ok(doc, "doc-fraunces-inter block not found");
  assert.doesNotMatch(doc, /- Mono:/);
  assert.match(doc, /- Rationale: restrained resume pairing/);
});

test("--use filters the pairings pool before sampling", () => {
  const r = runWithFixtures(["--fonts", "0", "--pairings", "5", "--refs", "0", "--seed", "s", "--use", "chat-ui"]);
  assert.equal(r.code, 0);
  const pairingsSection = r.stdout.split("## Pairings")[1].split("## References")[0];
  assert.match(pairingsSection, /chat-fraunces-inter/);
  assert.doesNotMatch(pairingsSection, /doc-fraunces-inter/);
  assert.doesNotMatch(pairingsSection, /marketing-inter-inter/);
  assert.match(r.stdout, /1 pairing\(s\) \(of 1\)/);
});

test("--use rejects a value outside the three allowed uses", () => {
  const r = runWithFixtures(["--use", "not-a-real-use"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--use must be one of chat-ui, document-resume, marketing-sign-in/);
});

test("excludes 'Patterns across the set' from sampled references, always appends Banned defaults in full", () => {
  const r = runWithFixtures(["--fonts", "0", "--pairings", "0", "--refs", "0", "--seed", "s"]);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stdout, /Patterns across the set/);
  assert.match(r.stdout, /## Banned defaults/);
  assert.match(r.stdout, /No fixture badness\./);
  assert.match(r.stdout, /No fixture gradients\./);
});

test("references section never includes Patterns or Banned-defaults as a sampled entry", () => {
  const r = runWithFixtures(["--fonts", "0", "--pairings", "0", "--refs", "3", "--seed", "s"]);
  assert.equal(r.code, 0);
  const refsSection = r.stdout.split("## References")[1].split("## Banned defaults")[0];
  assert.doesNotMatch(refsSection, /### Patterns across the set/);
  assert.doesNotMatch(refsSection, /### Banned defaults/);
  // only Alpha/Beta/Gamma are eligible
  const sampledHeadings = [...refsSection.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
  for (const h of sampledHeadings) {
    assert.ok(["Alpha", "Beta", "Gamma"].includes(h), `unexpected reference heading: ${h}`);
  }
});

test("header prints the effective seed so the run is reproducible", () => {
  const r = runWithFixtures(["--fonts", "1", "--pairings", "1", "--refs", "1", "--seed", "my-seed-123"]);
  assert.match(r.stdout, /seed `my-seed-123`/);
  assert.match(r.stdout, /--seed my-seed-123/);
});

test("clamps counts larger than the source pool instead of crashing", () => {
  const r = runWithFixtures(["--fonts", "999", "--pairings", "0", "--refs", "0", "--seed", "s"]);
  assert.equal(r.code, 0);
  const fontsSection = r.stdout.split("## Fonts")[1].split("## Pairings")[0];
  const fontNames = [...fontsSection.matchAll(/^### (.+)$/gm)];
  assert.equal(fontNames.length, 3, "only 3 fonts exist in the fixture");
});

test("rejects a fonts source file that is a bare array (old schema) with a clear message", () => {
  const r = runWithFixtures(["--fonts-file", path.join(FIXTURES, "bad-shape-fonts.json")]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /expected .* to be a JSON object with a "fonts" array/);
});

test("rejects a negative or non-integer count", () => {
  // "--fonts=-1" (not "--fonts", "-1"): node:util's parseArgs treats a
  // negative-looking value in the next argv slot as an ambiguous option,
  // not a value — the "=" form sidesteps that entirely.
  const r = runWithFixtures(["--fonts=-1"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--fonts must be a non-negative integer/);
});
