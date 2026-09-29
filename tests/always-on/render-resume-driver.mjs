#!/usr/bin/env node
// The subprocess seam tests/test_always_on_fake_chrome.py uses to reach
// skills/apply/scripts/render_resume.mjs's named exports (findChrome,
// toPdf, pdfPages, toHtml, CSS) — the retired render_resume.py's `rr.*`
// calls, ported (docs/design-js-only.md § 6, J2, lead ruling 1). The test
// FILE stays Python (tooling moves last, stage T); only what it calls
// changes, the same seam tests/checkers/jobs-md-driver.mjs already uses
// for jobs_md.
//
//   node render-resume-driver.mjs find-chrome
//   node render-resume-driver.mjs to-pdf <html> <pdf> [chrome] [timeoutMs]
//   node render-resume-driver.mjs pdf-pages <pdf>
//   node render-resume-driver.mjs to-html <mdPath>
//   node render-resume-driver.mjs css
//
// Every op prints one line of JSON. `chrome`/`timeoutMs` may be the
// literal string "null"/"" to mean "not given" (so env-var fallback and
// the default timeout are exercised the same way a real caller with no
// explicit argument would).
import { readFileSync } from "node:fs";
import { findChrome, toPdf, pdfPages, toHtml, CSS } from "../../skills/apply/scripts/render_resume.mjs";

const [op, ...rest] = process.argv.slice(2);

function undef(s) {
  return s === undefined || s === "" || s === "null" ? undefined : s;
}

if (op === "find-chrome") {
  console.log(JSON.stringify({ path: findChrome() ?? null }));
} else if (op === "to-pdf") {
  const [html, pdf, chrome, timeoutMs] = rest;
  const args = [html, pdf, undef(chrome)];
  if (undef(timeoutMs) !== undefined) args.push(Number(timeoutMs));
  const { ok, err } = await toPdf(...args);
  console.log(JSON.stringify({ ok, err: err ?? null }));
} else if (op === "pdf-pages") {
  const [pdf] = rest;
  console.log(JSON.stringify({ pages: await pdfPages(pdf) }));
} else if (op === "to-html") {
  const [mdPath] = rest;
  const mdText = readFileSync(mdPath, "utf-8");
  console.log(JSON.stringify({ html: toHtml(mdText) }));
} else if (op === "css") {
  console.log(JSON.stringify({ css: CSS }));
} else {
  process.stderr.write(`unknown op ${op}\n`);
  process.exitCode = 2;
}
