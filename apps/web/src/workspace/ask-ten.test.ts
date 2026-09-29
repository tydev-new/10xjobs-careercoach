// Unit tests for "Ask Ten about this"'s draft (design-web-ui.md § 5.4,
// § 5.9 Stage 3a). Run: node --test src/workspace/ask-ten.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildAskTenDraft } from "./ask-ten.ts";
import { matchGateReply } from "../agent-helpers.ts";

test("a short path -> the exact 'About <path>: ' form", () => {
  assert.equal(buildAskTenDraft("documents/resume.pdf"), "About documents/resume.pdf: ");
});

test("a label longer than the 120-char budget is cut to fit — About/: stay whole", () => {
  const longPath = `jd-analysis/${"a".repeat(200)}.md`;
  const draft = buildAskTenDraft(longPath);
  assert.equal(draft.length, 120);
  assert.ok(draft.startsWith("About "));
  assert.ok(draft.endsWith(": "));
});

test("a label exactly at the budget is not cut", () => {
  const label = "x".repeat(112); // 120 - "About ".length - ": ".length
  const draft = buildAskTenDraft(label);
  assert.equal(draft, `About ${label}: `);
  assert.equal(draft.length, 120);
});

test("the draft never matches a typed gate 'yes', for any label (§ 5.4's own proof)", () => {
  for (const label of ["", "yes", "resume.pdf", "Yes — the company"]) {
    assert.equal(matchGateReply(buildAskTenDraft(label), "typed"), "none");
  }
});

// N4 (Stage 3a review): a label with a character outside the BMP (an
// emoji in an uploaded file's own name) must never be cut mid-surrogate-
// pair — that leaves a lone surrogate, not valid text.
test("N4: the cut never splits a surrogate pair, for every cut point near an emoji", () => {
  const bad: string[] = [];
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  for (let n = 100; n <= 115; n++) {
    const label = `documents/${"x".repeat(n)}😀résumé.pdf`;
    const draft = buildAskTenDraft(label);
    if (draft.length > 120) bad.push(`n=${n}: ${draft.length} UTF-16 units`);
    if (LONE_SURROGATE.test(draft)) bad.push(`n=${n}: a lone surrogate in ${JSON.stringify(draft.slice(-6))}`);
  }
  assert.deepEqual(bad, []);
});

test("N4: a label entirely within the budget, emoji included, is not cut at all", () => {
  const label = "😀".repeat(10); // 20 UTF-16 units, well under the 112-unit budget
  assert.equal(buildAskTenDraft(label), `About ${label}: `);
});
