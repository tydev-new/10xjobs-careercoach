// stripRefSpan — the plan item's own rendering rule (design-web-ui.md
// § 5.3, "The plan item"; coder call, see strip-ref-span.ts's header).
import assert from "node:assert/strict";
import { test } from "node:test";
import { stripRefSpan } from "./strip-ref-span.ts";

test("stripRefSpan: a line with a ref — the backtick span is removed, the chip carries it instead", () => {
  const text = "Send it so I can help you decide (`jobs.md`) soon";
  assert.equal(stripRefSpan(text, "jobs.md"), "Send it so I can help you decide soon");
});

test("stripRefSpan: the fixtures' own wrapping form, 'Send the Acme cover letter (`ref`)'", () => {
  const text = "Send the Acme cover letter (`applications/acme-staff-pm-cover-letter.md`)";
  assert.equal(stripRefSpan(text, "applications/acme-staff-pm-cover-letter.md"), "Send the Acme cover letter");
});

test("stripRefSpan: no ref -> the text is returned unchanged", () => {
  const text = "Keep looking for more roles";
  assert.equal(stripRefSpan(text, undefined), text);
});

test("stripRefSpan: the ref's backtick span at the very end of the line", () => {
  const text = "Review `jd-analysis/beta.md`";
  assert.equal(stripRefSpan(text, "jd-analysis/beta.md"), "Review");
});

test("stripRefSpan: a NON-path backtick span (not the ref) is left alone", () => {
  const text = "Say `keep` or `cut` on `applications/acme.md`";
  assert.equal(stripRefSpan(text, "applications/acme.md"), "Say `keep` or `cut` on");
});

test("stripRefSpan: only the ref's own span is removed when the ref text happens to also appear unbackticked elsewhere", () => {
  const text = "`notes.txt` — see notes.txt for the rest";
  assert.equal(stripRefSpan(text, "notes.txt"), "— see notes.txt for the rest");
});

test("stripRefSpan: collapses the double space the removal leaves in the middle of a line", () => {
  const text = "Review `notes.txt` tonight";
  assert.equal(stripRefSpan(text, "notes.txt"), "Review tonight");
});
