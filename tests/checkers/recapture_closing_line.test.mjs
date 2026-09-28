// Unit tests for the substitution rule recapture_closing_line.mjs applies
// to the frozen expected-output corpus (design-honest-ceilings.md § 6A,
// item 4). Each case's own coverage in run-cases.mjs proves the recapture
// happened; these prove the RULE itself, off fixture strings, no I/O.
//
//   node --test tests/checkers/recapture_closing_line.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { substituteCheckMaterials, substituteCheckMessages, substituteProposalBlock } from "./recapture_closing_line.mjs";

test("check_materials: a WARN-only pass swaps the clean line for the new one", () => {
  const before = "RESUME r.md: pass (0 fail, 1 warn)\n  [WARN] letter is 3 words\n\n✔ automatic checks clean\n";
  const after = substituteCheckMaterials(before);
  assert.equal(after, "RESUME r.md: pass (0 fail, 1 warn)\n  [WARN] letter is 3 words\n\nno failures, 1 warning above — fix each one or tell the candidate\n");
});

test("check_materials: two WARNs use the plural form", () => {
  const before = "RESUME r.md: pass (0 fail, 2 warn)\n  [WARN] a\n  [WARN] b\n\n✔ automatic checks clean\n";
  const after = substituteCheckMaterials(before);
  assert.match(after, /no failures, 2 warnings above/);
});

test("check_materials: a genuinely clean run (0 warn) is untouched", () => {
  const before = "RESUME r.md: pass (0 fail, 0 warn)\n\n✔ automatic checks clean\n";
  assert.equal(substituteCheckMaterials(before), before);
});

test("check_materials: a FAIL run is untouched (no clean line to swap)", () => {
  const before = "RESUME r.md: FAIL (1 fail, 0 warn)\n  [FAIL] x\n\n✘ fix the FAILs before delivering\n";
  assert.equal(substituteCheckMaterials(before), before);
});

test("check_messages: the same swap, on its own clean line", () => {
  const before = "acme.md: pass (0 fail, 1 warn, 1 drafts)\n  [WARN] x\n✔ message floor clean\n  language tier...\n";
  const after = substituteCheckMessages(before);
  assert.equal(after, "acme.md: pass (0 fail, 1 warn, 1 drafts)\n  [WARN] x\nno failures, 1 warning above — fix each one or tell the candidate\n  language tier...\n");
});

test("proposal_block: a WARN-only run gets the new line APPENDED (there was no clean line before)", () => {
  const before = "Otherwise this is the version.\n\n--- paste everything above this line into the reply, beside the delivered document ---\nWARN  `have` row \"x\": missing\n";
  const after = substituteProposalBlock(before);
  assert.equal(after, before + "no failures, 1 warning above — fix each one or tell the candidate\n");
});

test("proposal_block: two WARN lines -> plural form", () => {
  const before = "---\nWARN  a\nWARN  b\n";
  assert.match(substituteProposalBlock(before), /no failures, 2 warnings above — fix each one or tell the candidate\n$/);
});

test("proposal_block: a FAIL present -> untouched, no closing line added", () => {
  const before = "---\nFAIL  no coverage table\nWARN  a\n";
  assert.equal(substituteProposalBlock(before), before);
});

test("proposal_block: no findings at all -> untouched (the existing clean line stays)", () => {
  const before = "Otherwise this is the version.\n\n---\nclean: proposal block printed; no FAIL, no WARN\n";
  assert.equal(substituteProposalBlock(before), before);
});
