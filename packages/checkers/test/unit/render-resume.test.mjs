// Mirrors tests/test_render_resume.py against the JS port's pure functions.
import test from "node:test";
import assert from "node:assert/strict";
import { toHtml, wordCount, run } from "../../src/render-resume.mjs";
import { makeFakeIo } from "./fake-io.mjs";

const WRAPPED = `# ALEX CHEN

## Summary

Built the solutions engineering function three times and wrote the standards it
ran on — the hiring bar, the POC playbook, the deployment playbook. Now builds
production agent systems.

- **Deep fluency in the pre-sales craft — discovery, proofs of concept:** ran it
  as Director of Solutions Engineering, then wrote the playbooks the team used.
`;

test("wrapped prose is one paragraph (bug 1, shipped 2026-08-18)", () => {
  const h = toHtml(WRAPPED);
  assert.equal((h.match(/<p>/g) || []).length, 1, h);
  assert.match(h, /wrote the standards it ran on/);
});

test("bold spanning a line break converts (bug 2, shipped 2026-08-18)", () => {
  const h = toHtml(WRAPPED);
  assert.ok(!h.includes("**"), "literal markdown survived into the HTML");
  assert.match(h, /<strong>Deep fluency in the pre-sales craft — discovery, proofs of concept:<\/strong>/);
});

test("HTML is escaped by the builder", () => {
  const h = toHtml("# A\n\n- Scaled 40+ engineers & <ops> teams\n");
  assert.match(h, /&amp;/);
  assert.match(h, /&lt;ops&gt;/);
  assert.ok(!h.includes("<ops>"));
});

test("bullets group into one list", () => {
  const h = toHtml("# A\n\n- one\n- two\n\n## Next\n\n- three\n");
  assert.equal((h.match(/<ul>/g) || []).length, 2, h);
  assert.equal((h.match(/<\/ul>/g) || []).length, 2, h);
  assert.equal((h.match(/<li>/g) || []).length, 3);
});

test("word count ignores markup", () => {
  const n = wordCount("# Alex Chen\n\n- **Bold lead:** three more words\n");
  assert.equal(n, 7); // "Alex Chen" (2) + "Bold lead: three more words" (5)
});

test("--pdf is ignored with a one-line note, never a page count claim (design-web-agent.md § 5)", async () => {
  const io = makeFakeIo({ "resume.md": "# A\n\n- one\n" });
  const r = await run(["--md", "resume.md", "--html", "out.html", "--pdf", "out.pdf"], io);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /words: 2 {2}->/);
  assert.match(r.stdout, /PDF: NOT RENDERED/);
  assert.ok(!/pages:/.test(r.stdout), "must never claim a page count (UNVERIFIED per design doc)");
});
