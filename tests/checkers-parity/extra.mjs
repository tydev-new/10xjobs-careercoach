#!/usr/bin/env node
// Tester-owned parity corpus for plan step 3 (docs/design-web-agent.md § 5),
// written from the contract, independent of packages/checkers/test/parity.mjs.
//
// Three engines, each run against the SAME absolute workspace path (reset
// and re-seeded between engines, so no path normalization is needed):
//   py     the real Python script (writers: clock frozen via a bootstrap
//          that swaps datetime.datetime before jobs_md imports it)
//   jsbin  packages/checkers/bin/<x>.mjs (Node io; CHECKER_NOW_ISO frozen)
//   jsbash the shipping path: just-bash + python3Command dispatch over an
//          InMemoryFs seeded with the same bytes (real clock, so writer
//          files are compared with timestamps masked)
// Compared: stdout (exact), exit code, stderr (exact, and first line),
// and every file in the workspace afterwards (bytes).
//
//   node tests/checkers-parity/extra.mjs            # summary + diffs
//   node tests/checkers-parity/extra.mjs --json     # machine-readable
//   node tests/checkers-parity/extra.mjs <filter>   # cases whose id contains <filter>
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, utimesSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SKILLS = join(ROOT, "skills");
const PKG = join(ROOT, "packages", "checkers");
// A fresh dir per run (2026-09-24): a FIXED $TMPDIR/checkers-parity-extra was shared by
// every checkout and session on the host, so concurrent runs deleted each other's ws
// (intermittent ENOENT crashes, and a 144/156 run).
const SCRATCH = process.env.PARITY_SCRATCH || mkdtempSync(join(process.env.TMPDIR || "/tmp", "checkers-parity-extra-"));
const FROZEN = "2026-09-23T12:34:56+00:00";

const { Bash, InMemoryFs } = await import(pathToFileURL(join(PKG, "node_modules", "just-bash", "dist", "bundle", "index.js")).href);
const { python3Command } = await import(pathToFileURL(join(PKG, "src", "just-bash-command.mjs")).href);

const SCRIPTS = {
  check_materials: "apply/scripts/check_materials.py",
  proposal_block: "apply/scripts/proposal_block.py",
  render_resume: "apply/scripts/render_resume.py",
  record_verdict: "evaluate/scripts/record_verdict.py",
  update_job: "search/scripts/update_job.py",
  check_files: "profile/scripts/check_files.py",
  check_closeout: "coach/scripts/check_closeout.py",
};
const WRITERS = new Set(["record_verdict", "update_job"]);

const BOOT = `
import sys, runpy, os, datetime as D
f = os.environ.get("FREEZE_ISO")
if f:
    base = D.datetime.fromisoformat(f)
    class FD(D.datetime):
        @classmethod
        def now(cls, tz=None):
            return base if tz is None else base.astimezone(tz)
    D.datetime = FD
script = sys.argv[1]
sys.argv = sys.argv[1:]
sys.path[0] = os.path.dirname(os.path.abspath(script))
runpy.run_path(script, run_name="__main__")
`;

// ------------------------------------------------------------------ corpus
const C = [];
const add = (c) => C.push(c);
const CRLF = (s) => s.replace(/\n/g, "\r\n");
const EMOJI60 = "🚀".repeat(40);
const LONG = ("word ".repeat(4000)).trim();

// ---- check_materials
{
  const s = "check_materials";
  const BASE = "# Base\n\n## Experience\n- Wrote SQL pipelines in Postgres for the finance team.\n";
  add({ s, id: "cm-empty-resume", files: { "resume.md": "" }, args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-empty-letter", files: { "letter.md": "" }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-missing-both-files", files: {}, args: ["--workspace", ".", "--resume", "nope.md", "--letter", "gone.md"] });
  add({ s, id: "cm-resume-is-a-directory", files: {}, dirs: ["resume.md"], args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-crlf-multiline-bullet", files: { "base-resume.md": BASE,
    "resume.md": CRLF("# A\n\n## Summary\n\nok.\n\n## Experience\n\n- Wrote SQL pipelines in Postgres for the finance team.\n  and single-handedly invented a new database engine.\n") },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-lf-multiline-bullet-control", files: { "base-resume.md": BASE,
    "resume.md": "# A\n\n## Summary\n\nok.\n\n## Experience\n\n- Wrote SQL pipelines in Postgres for the finance team.\n  and single-handedly invented a new database engine.\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-crlf-letter-informal", files: { "letter.md": CRLF("# Letter\n\nHi there —\n\nI want this job.\n\nSincerely,\nA\n") },
    args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-cjk-education-year", files: { "resume.md": "# 王\n\n## Summary\n\nok.\n\n## Education\n\n清华大学，2015年毕业\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-fullwidth-digits-education", files: { "resume.md": "# 山田\n\n## Summary\n\nok.\n\n## Education\n\n東京大学 ２０１５\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-accents-headings-filler", files: { "resume.md": "# Zoë\n\n## Résumé professionnel\n\nPassionate about café culture in Montréal.\n\n## Expérience\n\n- Led the naïve-Bayes rewrite → 3x faster.\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-emoji-long-bullet-truncation", files: { "base-resume.md": BASE,
    "resume.md": `# A\n\n## Summary\n\nok.\n\n## Experience\n\n- ${EMOJI60} shipped\n` }, args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-emoji-summary-sentence-truncation", files: {
    "resume.md": `# A\n\n## Summary\n\n${"🙂 ".repeat(35)}one two three four five six seven eight. More.\n\n## Experience\n\n- ${"🙂 ".repeat(35)}one two three four five six seven eight. More.\n` },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-very-long-line", files: { "resume.md": `# A\n\n## Summary\n\n${LONG}\n\n## Experience\n\n- ${LONG}\n` },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-duplicate-rows", files: { "base-resume.md": BASE,
    "resume.md": "# A\n\n## Summary\n\nCut costs 40% and then cut costs 40% again with 3x speed and 3x scale.\n\n## Experience\n\n- Wrote SQL pipelines in Postgres for the finance team.\n- Wrote SQL pipelines in Postgres for the finance team.\n\n## Experience\n\n- dup section\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-u2028-in-heading", files: { "resume.md": "# A\n\n## Summary Highlights\n\nok.\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-latin1-bytes", files: { "resume.md": Buffer.from("# R\xe9sum\xe9\n\n## Summary\n\nok.\n", "latin1") },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-bom-letter", files: { "letter.md": "﻿Hello —\n\nbody.\n" }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-arg-equals-form", files: { "resume.md": "# A\n\n## Summary\n\nok.\n" }, args: ["--workspace=.", "--resume=resume.md"] });
  add({ s, id: "cm-arg-abbrev", files: { "resume.md": "# A\n\n## Summary\n\nok.\n" }, args: ["--work", ".", "--res", "resume.md"] });
  add({ s, id: "cm-arg-help", files: {}, args: ["-h"] });
  add({ s, id: "cm-arg-missing-value", files: {}, args: ["--workspace", ".", "--resume"] });
  add({ s, id: "cm-arg-value-looks-like-flag", files: {}, args: ["--workspace", ".", "--resume", "--letter"] });
  add({ s, id: "cm-arg-positional", files: {}, args: ["stray", "--workspace", "."] });

  // owner ruling 6 (2026-09-25, docs/design-apply-three-lens.md § 4): ASCII
  // arrow chains, the same failure class as the Unicode glyphs above.
  const letter = (body) => "# Letter\n\nDear Hiring Manager,\n\n" + body + "\n\nAlex Chen\n";
  add({ s, id: "cm-ascii-arrow-form-arrow", files: { "letter.md": letter("Growth went 80->90 this quarter, every week, without exception at all.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-ascii-arrow-form-long-arrow", files: { "letter.md": letter("Growth went 80-->90 this quarter, every week, without exception at all.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-ascii-arrow-form-back-arrow", files: { "letter.md": letter("Growth went 80<-90 this quarter, every week, without exception at all.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-ascii-arrow-form-double-arrow", files: { "letter.md": letter("Growth went 80<->90 this quarter, every week, without exception at all.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-ascii-arrow-form-fat-arrow", files: { "letter.md": letter("Growth went 80=>90 this quarter, every week, without exception at all.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-ascii-arrow-form-long-fat-arrow", files: { "letter.md": letter("Growth went 80==>90 this quarter, every week, without exception at all.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-ascii-arrow-form-bidi-fat-arrow", files: { "letter.md": letter("Growth went 80<=>90 this quarter, every week, without exception at all.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-ascii-arrow-exempt-url", files: { "letter.md": letter("See https://example.com/a->b for the writeup, thanks for reading it all today.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-ascii-arrow-exempt-inline-code", files: { "letter.md": letter("The old macro was `a->b` in the legacy build script, never shipped externally.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-ascii-arrow-exempt-fence", files: { "letter.md": letter("```\na->b\n```\n\nExplained the diagram above to the whole panel, calmly and clearly.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-ascii-arrow-exempt-comment", files: { "letter.md": letter("<!-- a->b -->\n\nReviewed the whole draft twice before sending, carefully and calmly.") }, args: ["--workspace", ".", "--letter", "letter.md"] });

  // Round 2 additions (docs/design-apply-three-lens.md § 4/§ 9 item 8):
  // the tilde fence and double-backtick branches (round 1's known false
  // FAILs, now fixed), plus the two accepted limits that stay a known
  // false FAIL by design.
  add({ s, id: "cm-r2-arrow-exempt-tilde-fence", files: { "letter.md": letter("~~~\na->b\n~~~\n\nExplained the diagram above to the whole panel, calmly and clearly.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-r2-arrow-exempt-double-backtick", files: { "letter.md": letter("Documented ``a->b`` in the internal wiki only, never in customer docs.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-r2-arrow-double-backtick-then-text-still-scanned", files: { "letter.md": letter("Documented ``a->b`` here, then separately wrote c=>d in the same paragraph today.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-r2-arrow-accepted-four-space-indent", files: { "letter.md": letter("    a->b\n\nThat indented line above is plain prose in this document, not code.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-r2-arrow-accepted-schemeless-url", files: { "letter.md": letter("See example.com/a->b for the writeup, thanks for reading it all today.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-ascii-le-ge-no-finding", files: { "letter.md": letter("Latency stayed <=5ms and throughput >=99% the whole quarter without incident.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-unicode-and-ascii-arrows-unicode-first", files: { "letter.md": letter("We cut cost 80%→<1%, then kept it flat at 80->90 the rest of the year, steadily.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-accented-text-beside-ascii-arrow", files: { "letter.md": letter("Latence baissée café->café à Montréal, chaque trimestre sans faute aucune fois.") }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s, id: "cm-bullets-only-summary-passes-case-budget", files: { "resume.md":
    "# Alex Chen\n\n## Summary\n\n- Platform engineering leader delivering reliability at scale.\n- Cut incident response time from 4 hours to 40 minutes.\n- Built the on-call rotation from zero to a 6-person bench.\n\n## Experience\n\nPlatform Lead — Northwind Labs.\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });

  // Independent review of 9842d81 (2026-09-25), adversarial ASCII-arrow corpus.
  // The URL exemption is `https?://\S+`; Python's \s and JS's \s differ on
  // U+001C-U+001F, U+0085 (Python: whitespace) and U+FEFF (JS: whitespace) —
  // the same gap py-text.mjs's PY_S / PY_NOT_S exist to close.
  const L = letter;
  const LA = ["--workspace", ".", "--letter", "letter.md"];
  add({ s, id: "cm-review-arrow-url-then-x1c", files: { "letter.md": L("Notes at https://example.com/notes\x1c->next steps, thanks for reading them all today.") }, args: LA });
  add({ s, id: "cm-review-arrow-url-then-x1f", files: { "letter.md": L("Notes at https://example.com/notes\x1f->next steps, thanks for reading them all today.") }, args: LA });
  add({ s, id: "cm-review-arrow-url-then-nel", files: { "letter.md": L("Notes at https://example.com/notes\u0085->next steps, thanks for reading them all today.") }, args: LA });
  add({ s, id: "cm-review-arrow-url-then-bom", files: { "letter.md": L("Notes at https://example.com/notes﻿->next steps, thanks for reading them all today.") }, args: LA });
  add({ s, id: "cm-review-arrow-url-then-nbsp", files: { "letter.md": L("Notes at https://example.com/notes ->next steps, thanks for reading them all today.") }, args: LA });
  add({ s, id: "cm-review-arrow-inline-code-u2028", files: { "letter.md": L("The macro `a ->b` stayed internal, never shipped to any customer at all.") }, args: LA });
  add({ s, id: "cm-review-arrow-inline-code-lone-cr", files: { "letter.md": L("The macro `a\r->b` stayed internal, never shipped to any customer at all.") }, args: LA });
  add({ s, id: "cm-review-arrow-crlf-fence", files: { "letter.md": CRLF(L("```\na->b\n```\n\nExplained the diagram above to the whole panel, calmly and clearly.")) }, args: LA });
  add({ s, id: "cm-review-negative-number", files: { "letter.md": L("Hardware held at <-5 C in the field trials, every unit, all winter long.") }, args: LA });
  add({ s, id: "cm-review-gt-chain-no-finding", files: { "letter.md": L("Moved work from intake > triage > fix across teams, every week without fail.") }, args: LA });
  add({ s, id: "cm-review-math-le-no-finding", files: { "letter.md": L("Kept p99 latency x <= 5 ms and error rate <== budget all quarter long.") }, args: LA });
  add({ s, id: "cm-review-double-backtick-code", files: { "letter.md": L("Documented ``a->b`` in the internal wiki only, never in customer docs.") }, args: LA });
  add({ s, id: "cm-review-url-adjacent-arrow", files: { "letter.md": L("See https://example.com->then the appendix, thanks for reading it all.") }, args: LA });
  add({ s, id: "cm-review-exempt-no-glue", files: { "letter.md": L("Split -`x`> and -<!-- c -->> never form an arrow when the spans go.") }, args: LA });
  add({ s, id: "cm-review-multiline-comment", files: { "letter.md": L("<!-- draft note\na->b\nstill internal -->\n\nReviewed twice before sending, carefully and calmly.") }, args: LA });
  add({ s, id: "cm-review-first-match-only", files: { "letter.md": L("Went a=>b, then c->d, then e<-f over the whole year, steadily enough.") }, args: LA });
  add({ s, id: "cm-review-claim-rules-stripped", files: { "resume.md":
    "# Alex Chen\n\n## Summary\n\n- Platform engineering leader delivering reliability at scale.\n\n## Claim rules\n\n- never write a->b transitions\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-review-seven-bullet-summary", files: { "resume.md":
    "# Alex Chen\n\n*Platform engineering leader — reliability at scale*\n\n## Summary\n\n" +
    "- Platform engineering leader who keeps a payments platform available through 10x growth.\n" +
    "- **8+ years in SRE:** yes — Northwind Labs on-call lead since 2021.\n" +
    "- Cut incident response time from 4 hours to 40 minutes across 12 services.\n" +
    "- Built the on-call rotation from zero to a 6-person bench.\n" +
    "- Moved deploys from weekly to daily with zero customer-facing rollbacks.\n" +
    "- Reduced cloud spend 30% by retiring two legacy clusters.\n" +
    "- Ran the incident review program for 40 engineers.\n\n" +
    "## Experience\n\n### Northwind Labs — Platform Lead\n\n- Led the reliability program.\n" },
    args: ["--workspace", ".", "--resume", "resume.md"] });

  // Independent review of round 2 (a0abefe): the tilde-fence and
  // double-backtick branches, and PY_NOT_S at the URL's edges, probed on
  // both engines (docs/design-apply-three-lens.md § 4, amended 86089d7).
  add({ s, id: "cm-r2rev-tilde-fence-crlf", files: { "letter.md": CRLF(L("~~~\na->b\n~~~\n\nExplained the diagram above to the whole panel, calmly and clearly.")) }, args: LA });
  add({ s, id: "cm-r2rev-tilde-fence-lone-cr", files: { "letter.md": L("~~~\ra->b\r~~~\n\nExplained the diagram above to the whole panel, calmly and clearly.") }, args: LA });
  add({ s, id: "cm-r2rev-tilde-fence-unclosed", files: { "letter.md": L("~~~\na->b\n\nExplained the diagram above to the whole panel, calmly and clearly.") }, args: LA });
  add({ s, id: "cm-r2rev-tilde-fence-with-info-string", files: { "letter.md": L("~~~text\nx => y\n~~~\n\nExplained the diagram above to the whole panel, calmly and clearly.") }, args: LA });
  add({ s, id: "cm-r2rev-backtick-fence-inside-tilde", files: { "letter.md": L("~~~\n```\na->b\n~~~\nthen c=>d outside, in the prose that follows it.") }, args: LA });
  add({ s, id: "cm-r2rev-double-backtick-holds-a-backtick", files: { "letter.md": L("Documented `` a`->b `` in the internal wiki only, never in customer docs.") }, args: LA });
  add({ s, id: "cm-r2rev-double-backtick-unclosed-crosses-no-line", files: { "letter.md": L("Opened `` here, a->b\nand closed `` there, in the internal wiki only.") }, args: LA });
  add({ s, id: "cm-r2rev-double-backtick-u2028", files: { "letter.md": L("Documented ``a ->b`` in the internal wiki only, never in customer docs.") }, args: LA });
  add({ s, id: "cm-r2rev-double-backtick-u2029-then-arrow", files: { "letter.md": L("Documented ``a`` c->d in the internal wiki only, never in customer docs.") }, args: LA });
  add({ s, id: "cm-r2rev-double-backtick-lone-cr", files: { "letter.md": L("Documented ``a\r->b`` in the internal wiki only, never in customer docs.") }, args: LA });
  add({ s, id: "cm-r2rev-two-double-backtick-spans", files: { "letter.md": L("Documented ``a->b``, then ``c=>d``, in the internal wiki only today.") }, args: LA });
  add({ s, id: "cm-r2rev-url-then-u2028", files: { "letter.md": L("Notes at https://example.com/notes ->next steps, thanks for reading them all today.") }, args: LA });
  add({ s, id: "cm-r2rev-url-then-u2029", files: { "letter.md": L("Notes at https://example.com/notes ->next steps, thanks for reading them all today.") }, args: LA });
  add({ s, id: "cm-r2rev-url-then-u3000", files: { "letter.md": L("Notes at https://example.com/notes　->next steps, thanks for reading them all today.") }, args: LA });
  add({ s, id: "cm-r2rev-url-then-u200b", files: { "letter.md": L("Notes at https://example.com/notes​->next steps, thanks for reading them all today.") }, args: LA });
  add({ s, id: "cm-r2rev-url-astral", files: { "letter.md": L("Notes at https://example.com/\u{1F680}->next steps, thanks for reading them all today.") }, args: LA });
  add({ s, id: "cm-r2rev-url-uppercase-scheme", files: { "letter.md": L("Notes at HTTPS://example.com/a->b for the writeup, thanks for reading it.") }, args: LA });
  add({ s, id: "cm-r2rev-summary-prose-51-words", files: { "resume.md":
    "# Alex Chen\n\n## Summary\n\n" + Array(51).fill("word").join(" ") + "\n\n- Cut costs 30%.\n" }, args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-r2rev-summary-prose-50-words", files: { "resume.md":
    "# Alex Chen\n\n## Summary\n\n" + Array(50).fill("word").join(" ") + "\n\n- Cut costs 30%.\n" }, args: ["--workspace", ".", "--resume", "resume.md"] });
  add({ s, id: "cm-r2rev-summary-repeated-number-warn", files: { "resume.md":
    "# Alex Chen\n\n## Summary\n\n- Cut costs 30%.\n- Grew revenue 30%.\n" }, args: ["--workspace", ".", "--resume", "resume.md"] });
}

// ---- proposal_block
{
  const s = "proposal_block";
  const COV = "## Coverage\n\n| requirement | status | evidence | decision |\n|---|---|---|---|\n";
  const SEL = "## Selection\n\n| # | role | bullet | in/out | source | words | why |\n|---|---|---|---|---|---|---|\n";
  add({ s, id: "pb-empty-application", files: { "applications/a.md": "" }, args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-missing-application", files: {}, args: ["--workspace", ".", "--application", "applications/nope.md"] });
  add({ s, id: "pb-emoji-bullet-truncation", files: { "applications/a.md": COV + "| Python | have | x | answered |\n\n" + SEL +
    `| 1 | Acme | ${EMOJI60} big launch | out | base | 12 | weakest |\n| 2 | Acme | kept | in | base | 5 | strong |\n` },
    args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-cjk-astral-evidence-truncation", files: { "applications/a.md": COV +
    `| Kubernetes | gap | ${"𠀀".repeat(50)}${"é".repeat(40)} | open |\n| Go | shown-but-unnamed | ${"𠀀".repeat(40)} ok | answered |\n\n` + SEL },
    args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-crlf", files: { "applications/a.md": CRLF(COV + "| Python | have | x | answered |\n| Rust | gap | none | open |\n\n" + SEL +
    "| 3 | Acme | a | out | base | 12 | weak |\n| 5 | Acme | b | out | base | 9 | weaker |\n| 7 | Acme | c | out | base | — | |\n"), "base-resume.md": CRLF("# B\n- Python work\n") },
    args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-duplicate-rows", files: { "applications/a.md": COV + "| Python | have | x | answered |\n| Python | have | x | answered |\n\n" + SEL +
    "| 1 | Acme | same | out | base | 12 | weak |\n| 1 | Acme | same | out | base | 12 | weak |\n" },
    args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-formfeed-and-u2028-lines", files: { "applications/a.md": COV + "| Python | gap | none | open |\f| Go | gap | none | open | | Rust | gap | none | open |\n\n" + SEL },
    args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-very-long-line", files: { "applications/a.md": COV + `| ${LONG} | gap | ${LONG} | open |\n\n` + SEL },
    args: ["--workspace", ".", "--application", "applications/a.md"] });
  add({ s, id: "pb-arg-missing-application", files: {}, args: ["--workspace", "."] });
  add({ s, id: "pb-arg-help", files: {}, args: ["--help"] });
  add({ s, id: "pb-arg-abbrev", files: { "applications/a.md": "" }, args: ["--workspace", ".", "--app", "applications/a.md"] });
}

// ---- render_resume
{
  const s = "render_resume";
  add({ s, id: "rr-empty-md", files: { "r.md": "" }, args: ["--md", "r.md", "--html", "out.html"] });
  add({ s, id: "rr-missing-md", files: {}, args: ["--md", "nope.md", "--html", "out.html"] });
  add({ s, id: "rr-unicode", files: { "r.md": "# Zoë 王 🚀\n\n## Expérience\n\n- **Café** lead in Montréal — 東京 *naïve* `code`\n- 𠀀 & <tag> \"q\" 'a'\n" },
    args: ["--md", "r.md", "--html", "out.html"] });
  add({ s, id: "rr-crlf", files: { "r.md": CRLF("# A\n\nwrapped line one\nwrapped **bold\nacross** two\n\n- bullet\n  continued\n") }, args: ["--md", "r.md", "--html", "out.html"] });
  add({ s, id: "rr-u2028-and-formfeed", files: { "r.md": "# A\n\npara one - sneaky bullet\fmore\n" }, args: ["--md", "r.md", "--html", "out.html"] });
  add({ s, id: "rr-very-long-line", files: { "r.md": `# A\n\n${LONG}\n` }, args: ["--md", "r.md", "--html", "out.html"] });
  add({ s, id: "rr-default-html-path", files: { "applications/acme-resume.md": "# A\n\nhi\n", "applications/resume.html": "PRE-EXISTING\n" },
    args: ["--md", "applications/acme-resume.md"], htmlMask: true, untouched: { "applications/resume.html": "PRE-EXISTING\n" },
    note: "html path masked (mkdtemp); pre-existing applications/resume.html must be untouched" });
  add({ s, id: "rr-arg-bad-pages", files: { "r.md": "# A\n" }, args: ["--md", "r.md", "--pages", "two"] });
  add({ s, id: "rr-arg-pages-spaces", files: { "r.md": "# A\n" }, args: ["--md", "r.md", "--html", "o.html", "--pages", " 3"] });
  add({ s, id: "rr-arg-help", files: {}, args: ["-h"] });
  add({ s, id: "rr-arg-strict-with-value", files: { "r.md": "# A\n" }, args: ["--md", "r.md", "--html", "o.html", "--strict=yes"] });
}

// ---- record_verdict (writer)
{
  const s = "record_verdict";
  const JOBS = (body, notes = "") =>
    "# Pipeline\n\n*x*\n\n**Active: 2** · dismissed: 0 · updated 2026-01-01\n\n" + body + (notes ? `## Search notes\n\n${notes}\n` : "");
  const rv = (extra) => ["--workspace", ".", "--company", "Acme", "--title", "Staff Engineer", "--verdict", "strong", ...extra];
  add({ s, id: "rv-empty-jobs-file", files: { "jobs.md": "" }, args: rv(["--score", "80"]) });
  add({ s, id: "rv-no-jobs-file-unicode", files: {}, args: ["--workspace", ".", "--company", "Café Montréal 🚀", "--title", "エンジニア 𠀀", "--verdict", "long_shot", "--reasons", "naïve — ok"] });
  add({ s, id: "rv-crlf-jobs-with-notes", files: { "jobs.md": CRLF(JOBS("## To Review\n\n### Beta — PM\n- URL: https://b\n- Seen: 2026-01-01T00:00:00+00:00\n\n", "### 2026-01-01\n\nline one\nline two")) },
    args: rv(["--score", "70"]) });
  add({ s, id: "rv-nonint-scores-in-file", files: { "jobs.md": JOBS("## To Review\n\n### Beta — PM\n- Score: 7.5\n\n### Gamma — PM\n- Score: 12abc\n\n### Delta — PM\n- Score: １２\n\n") },
    args: rv(["--score", "10"]) });
  add({ s, id: "rv-sort-astral-vs-bmp", files: { "jobs.md": JOBS("## To Review\n\n### ｆoo Corp — PM\n- URL: u1\n\n### 😀bar — PM\n- URL: u2\n\n") },
    args: rv([]) });
  add({ s, id: "rv-duplicate-rows-in-file", files: { "jobs.md": JOBS("## To Review\n\n### Beta Inc — PM\n\n### Beta — PM\n\n") }, args: rv([]) });
  add({ s, id: "rv-reverdict-updates-existing", files: { "jobs.md": JOBS("## Applied\n\n### ACME, Inc. — Staff Engineer\n- URL: https://old\n- Score: 50\n- JD: jd-analysis/acme.md\n\n") },
    args: rv(["--score", "90", "--url", "https://new", "--jd-file", "jd-analysis/other.md"]) });
  add({ s, id: "rv-u2028-in-company", files: {}, args: ["--workspace", ".", "--company", "A B", "--title", "PM", "--verdict", "weak"] });
  add({ s, id: "rv-very-long-reason", files: {}, args: rv(["--reasons", LONG]) });
  add({ s, id: "rv-arg-score-negative", files: {}, args: rv(["--score", "-5"]) });
  add({ s, id: "rv-arg-score-leading-space", files: {}, args: rv(["--score", " 5"]) });
  add({ s, id: "rv-arg-score-underscore", files: {}, args: rv(["--score", "1_0"]) });
  add({ s, id: "rv-arg-score-not-int", files: {}, args: rv(["--score", "ten"]) });
  add({ s, id: "rv-arg-bad-track", files: {}, args: rv(["--track", "D"]) });
  add({ s, id: "rv-arg-ambiguous-abbrev", files: {}, args: ["--workspace", ".", "--comp", "Acme", "--title", "x", "--verdict", "weak"] });
  add({ s, id: "rv-arg-unique-abbrev", files: {}, args: ["--workspace", ".", "--company", "Acme", "--title", "x", "--verd", "weak"] });
  add({ s, id: "rv-arg-title-missing-value", files: {}, args: ["--workspace", ".", "--company", "Acme", "--verdict", "weak", "--title"] });
  add({ s, id: "rv-arg-help", files: {}, args: ["-h"] });
}

// ---- update_job (writer)
{
  const s = "update_job";
  const JOBS = (body) => "# Pipeline\n\n*x*\n\n**Active: 1** · dismissed: 0 · updated 2026-01-01\n\n" + body;
  const ONE = JOBS("## To Review\n\n### Café Labs — Staff Engineer\n- URL: https://c\n- Seen: 2026-01-01T00:00:00+00:00\n\n");
  const uj = (extra) => ["--workspace", ".", "--company", "Café", "--title", "Staff", ...extra];
  add({ s, id: "uj-empty-jobs-file", files: { "jobs.md": "" }, args: uj(["--stage", "Applied"]) });
  add({ s, id: "uj-missing-jobs-file", files: {}, args: uj(["--dismiss"]) });
  add({ s, id: "uj-crlf-stage-move", files: { "jobs.md": CRLF(ONE + "## Search notes\n\nnote a\nnote b\n") }, args: uj(["--stage", "Applied"]) });
  add({ s, id: "uj-unicode-dismiss-reason", files: { "jobs.md": ONE }, args: uj(["--dismiss", "--reason", "trop loin — 通勤 🚗"]) });
  add({ s, id: "uj-ambiguous-emoji-titles", files: { "jobs.md": JOBS("## To Review\n\n### Café — Staff Engineer 🚀\n\n### Café — Staff Engineer II 🛰\n\n") }, args: uj(["--stage", "Offer"]) });
  add({ s, id: "uj-duplicate-rows-in-file", files: { "jobs.md": JOBS("## To Review\n\n### Café — Staff Engineer\n\n## Applied\n\n### Café Inc — Staff Engineer\n\n") }, args: ["--workspace", ".", "--company", "Café", "--title", "Staff Engineer", "--restore"] });
  add({ s, id: "uj-arg-stage-twice", files: { "jobs.md": ONE }, args: uj(["--stage", "Applied", "--stage", "Offer"]) });
  add({ s, id: "uj-arg-dismiss-twice", files: { "jobs.md": ONE }, args: uj(["--dismiss", "--dismiss"]) });
  add({ s, id: "uj-arg-conflict-plus-unrecognized", files: { "jobs.md": ONE }, args: uj(["--stage", "Applied", "--dismiss", "--bogus"]) });
  add({ s, id: "uj-arg-conflict-no-workspace", files: {}, args: ["--company", "x", "--title", "y", "--dismiss", "--restore"] });
  add({ s, id: "uj-arg-dismiss-with-value", files: { "jobs.md": ONE }, args: uj(["--dismiss=yes"]) });
  add({ s, id: "uj-arg-bad-stage", files: {}, args: uj(["--stage", "applied"]) });
  add({ s, id: "uj-arg-help", files: {}, args: ["--help"] });
}

// ---- check_files
{
  const s = "check_files";
  const PROFILE = "# P\n## Snapshot\n## Experience\n## Intake findings\n### Positioning strengths\n### Likely interviewer concerns\n" +
    "### Career-narrative gaps\n### Story seeds\n## Interview history\n## Constraints\n## Application defaults\n";
  const sk = ["--skills", SKILLS];
  add({ s, id: "cf-empty-profile", files: { "profile.md": "" }, args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-missing-workspace-dir", files: {}, args: ["--workspace", "does-not-exist", ...sk] });
  add({ s, id: "cf-workspace-is-a-file", files: { "f.md": "x" }, args: ["--workspace", "f.md", ...sk] });
  add({ s, id: "cf-crlf-profile", files: { "profile.md": CRLF(PROFILE + "## Café notes\n") }, args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-hidden-application-file", files: { "applications/.draft.md": "## Coverage\n\n| requirement | status |\n", "applications/ok.md": "# ok\n" },
    args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-unicode-stray-order", files: { "ｆ-notes.txt": "x", "😀.txt": "x", "é.txt": "x", "z.txt": "x", "Zebra.txt": "x" }, args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-emoji-long-table-row", files: { "applications/a.md": `## Coverage\n\n| requirement | status | evidence | decision |\n|---|---|---|---|\n| ${EMOJI60} | have |\n` },
    args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-u2028-heading", files: { "profile.md": PROFILE + "## Foo Snapshot\n" }, args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-duplicate-sections-and-rows", files: { "profile.md": PROFILE + "## Snapshot\n## Snapshot\n", "base-resume-history.md": "| date | round | driver | scored vs FIXED | what changed |\n|---|---|---|---|---|\n| a | 1 | x | y | z |\n| a | 1 | x | y | z |\n| a | 1 | x | y |\n" },
    args: ["--workspace", ".", ...sk] });
  add({ s, id: "cf-very-long-line", files: { "profile.md": PROFILE + `## ${LONG}\n` }, args: ["--workspace", ".", ...sk] });
  // Rewritten 2026-09-23 per LEAD RULING (round 2): round 1 simulated the
  // sandbox by mirroring the bundle at its HOST absolute path, which is not
  // the spec. design-web-agent.md § 4 is: "the bundle mounted read-only at
  // `skills/`" of the workspace — so this case now uses that mount.
  add({ s, id: "cf-default-skills-as-the-skill-prose-calls-it", files: { "profile.md": PROFILE }, args: ["--workspace", "."], mount: "design",
    note: "every MVP SKILL.md runs `check_files.py --workspace .` with no --skills; bundle at <ws>/skills (§ 4)" });
  add({ s, id: "cf-arg-help", files: {}, args: ["-h"] });
  add({ s, id: "cf-arg-unrecognized", files: {}, args: ["--workspace", ".", "--skill", SKILLS, "--x"] });
}

// ---- check_closeout
{
  const s = "check_closeout";
  const PLAN = "Goal: x\n\n## Board\nWaiting on you\n- the comp floor — criteria.md\n- café visit to Montréal\nTo do\n- review the letter\n";
  add({ s, id: "cc-empty-plan", files: { "plan.md": "" }, args: ["--workspace", ".", "--stage", "applying"] });
  add({ s, id: "cc-missing-plan-bad-stage", files: {}, args: ["--workspace", ".", "--stage", "Planning"] });
  add({ s, id: "cc-crlf-plan", files: { "plan.md": CRLF(PLAN) }, args: ["--workspace", ".", "--stage", "applying", "--asked", "your comp floor"] });
  add({ s, id: "cc-emoji-asked-truncation", files: { "plan.md": PLAN }, args: ["--workspace", ".", "--stage", "applying", "--asked", EMOJI60 + " unmatched"] });
  add({ s, id: "cc-unicode-rows", files: { "plan.md": PLAN }, args: ["--workspace", ".", "--stage", "applying", "--asked", "the café visit?", "--asked", "東京 relocation"] });
  add({ s, id: "cc-duplicate-asked", files: { "plan.md": PLAN }, args: ["--workspace", ".", "--stage", "applying", "--asked", "comp floor", "--asked", "comp floor"] });
  add({ s, id: "cc-infer-stage-from-crlf-jobs", files: { "plan.md": PLAN, "jobs.md": CRLF("| Acme | Interviewing |\n") }, args: ["--workspace", "."] });
  add({ s, id: "cc-stale-plan", files: { "plan.md": PLAN }, old: ["plan.md"], args: ["--workspace", ".", "--stage", "deciding"] });
  add({ s, id: "cc-very-long-line", files: { "plan.md": `## Board\nWaiting on you\n- ${LONG}\n` }, args: ["--workspace", ".", "--stage", "applying", "--asked", LONG] });
  add({ s, id: "cc-arg-minutes-not-int", files: {}, args: ["--workspace", ".", "--minutes", "ten"] });
  add({ s, id: "cc-arg-minutes-spaces", files: { "plan.md": PLAN }, args: ["--workspace", ".", "--stage", "applying", "--minutes", " 30 "] });
  add({ s, id: "cc-arg-help", files: {}, args: ["-h"] });
  add({ s, id: "cc-arg-asked-missing-value", files: {}, args: ["--workspace", ".", "--asked"] });
}

// ------------------------------------------------------------------ round 2
// New adversarial cases (re-verify of fix round 1), aimed at the areas round 1
// found broken: CRLF / lone CR, BOM, argparse, code-point lengths, code-point
// sort, and the check_files default under the design's own skills mount.
{
  const PROFILE = "# P\n## Snapshot\n## Experience\n## Intake findings\n### Positioning strengths\n### Likely interviewer concerns\n" +
    "### Career-narrative gaps\n### Story seeds\n## Interview history\n## Constraints\n## Application defaults\n";
  const sk = ["--skills", SKILLS];
  const J = (body) => "# Pipeline\n\n**Active: 1** · dismissed: 0 · updated 2026-01-01\n\n" + body;
  const RV = ["--workspace", ".", "--company", "Acme", "--title", "Staff Engineer", "--verdict", "strong"];
  const UJ = ["--workspace", ".", "--company", "Café", "--title", "Staff"];
  const ONE = J("## To Review\n\n### Café Labs — Staff Engineer\n- URL: https://c\n\n");
  const BASE = "# Base\n\n## Experience\n- Wrote SQL pipelines in Postgres for the finance team.\n";
  const R = ["--workspace", ".", "--resume", "resume.md"];
  const COV = "## Coverage\n\n| requirement | status | evidence | decision |\n|---|---|---|---|\n";
  const SEL = "## Selection\n\n| # | role | bullet | in/out | source | words | why |\n|---|---|---|---|---|---|---|\n";
  const PB = ["--workspace", ".", "--application", "a.md"];
  const PLAN = "## Board\nWaiting on you\n- the comp floor\nTo do\n- x\n";

  // CRLF / lone CR / mixed
  add({ s: "check_materials", id: "r2-cm-lone-cr-multiline-bullet", files: { "base-resume.md": BASE,
    "resume.md": "# A\r\r## Summary\r\rok.\r\r## Experience\r\r- Wrote SQL pipelines in Postgres for the finance team.\r  and invented a database.\r" }, args: R });
  add({ s: "check_materials", id: "r2-cm-crlf-reworded-pair", files: { "base-resume.md": BASE,
    "resume.md": CRLF("# A\n\n## Summary\n\nok.\n\n## Experience\n\n- Built Postgres pipelines for finance.\n\n## Reworded\n\n- base: Wrote SQL pipelines in Postgres for the finance team.\n  tailored: Built Postgres pipelines for finance.\n") }, args: R });
  add({ s: "update_job", id: "r2-uj-mixed-endings", files: { "jobs.md": "# Pipeline\r\n\n## To Review\r\r### Café Labs — Staff Engineer\n- URL: https://c\r\n- Reason: a\rb\n\n## Search notes\r\n\r\nn1\rn2\r\n" }, args: [...UJ, "--stage", "Offer"] });
  add({ s: "check_files", id: "r2-cf-crlf-history-bad-row", files: { "base-resume-history.md": CRLF("| date | round | driver | scored vs FIXED | what changed |\n|---|---|---|---|---|\n| a | 1 | x | y |\n") }, args: ["--workspace", ".", ...sk] });
  add({ s: "check_closeout", id: "r2-cc-lone-cr-plan", files: { "plan.md": "## Board\rWaiting on you\r- the comp floor\r  continued row\rTo do\r- x\r" }, args: ["--workspace", ".", "--stage", "applying", "--asked", "comp floor"] });
  add({ s: "proposal_block", id: "r2-pb-crlf-escaped-pipe", files: { "a.md": CRLF(COV + "| C\\|C++ | gap | none | open |\n\n" + SEL) }, args: PB });

  // BOM
  add({ s: "record_verdict", id: "r2-rv-bom-before-stage-heading", files: { "jobs.md": "﻿## To Review\n\n### Beta — PM\n- URL: u\n\n" }, args: RV });
  add({ s: "check_files", id: "r2-cf-bom-profile", files: { "profile.md": "﻿" + PROFILE.replace("# P\n", "") }, args: ["--workspace", ".", ...sk] });
  add({ s: "render_resume", id: "r2-rr-bom-heading", files: { "r.md": "﻿# Title\n\nbody ﻿ word\n" }, args: ["--md", "r.md", "--html", "o.html"] });
  add({ s: "check_closeout", id: "r2-cc-bom-waiting", files: { "plan.md": "## Board\n﻿Waiting on you\n- comp floor\n" }, args: ["--workspace", ".", "--stage", "applying", "--asked", "comp floor"] });
  add({ s: "check_materials", id: "r2-cm-bom-and-nel-word-count", files: { "letter.md": "Dear Hiring Manager,\n\none\u0085two\u001cthree ﻿ four\n" }, args: ["--workspace", ".", "--letter", "letter.md"] });

  // argparse
  add({ s: "record_verdict", id: "r2-rv-arg-double-dash", files: {}, args: ["--", ...RV] });
  add({ s: "record_verdict", id: "r2-rv-arg-abbrev-with-equals", files: {}, args: [...RV, "--sco=50", "--trac=B"] });
  add({ s: "record_verdict", id: "r2-rv-arg-help-after-bad-choice", files: {}, args: ["--verdict", "STRONG", "-h"] });
  add({ s: "record_verdict", id: "r2-rv-arg-help-before-bad-choice", files: {}, args: ["-h", "--verdict", "STRONG"] });
  add({ s: "record_verdict", id: "r2-rv-arg-score-equals-negative", files: {}, args: [...RV, "--score=-5"] });
  add({ s: "record_verdict", id: "r2-rv-arg-empty-equals-workspace", files: {}, args: ["--workspace=", "--company", "A", "--title", "B", "--verdict", "weak"] });
  add({ s: "check_closeout", id: "r2-cc-arg-asked-dash-value", files: { "plan.md": PLAN }, args: ["--workspace", ".", "--stage", "applying", "--asked", "-x"] });
  add({ s: "check_closeout", id: "r2-cc-arg-asked-negative-number", files: { "plan.md": PLAN }, args: ["--workspace", ".", "--stage", "applying", "--asked", "-5"] });
  add({ s: "check_closeout", id: "r2-cc-arg-asked-equals-dash", files: { "plan.md": PLAN }, args: ["--workspace", ".", "--s", "applying", "--ask=--comp floor", "--ask", "floor"] });
  add({ s: "check_materials", id: "r2-cm-arg-single-dash-unknown", files: {}, args: ["-w", ".", "--resume", "x.md"] });
  add({ s: "update_job", id: "r2-uj-arg-help-with-value", files: {}, args: ["--help=foo"] });
  add({ s: "update_job", id: "r2-uj-arg-dismiss-then-stage", files: { "jobs.md": ONE }, args: [...UJ, "--dismiss", "--stage", "Applied"] });
  add({ s: "update_job", id: "r2-uj-arg-stage-abbrev-and-space-value", files: { "jobs.md": ONE }, args: [...UJ, "--sta", "To Review", "--rea", "x"] });
  add({ s: "render_resume", id: "r2-rr-arg-pages-zero-strict", files: { "r.md": "# A\n" }, args: ["--md", "r.md", "--html", "o.html", "--pages", "0", "--strict"] });
  add({ s: "check_files", id: "r2-cf-arg-workspace-twice", files: { "profile.md": PROFILE }, args: ["--workspace", "nope", "--workspace", ".", ...sk] });

  // code-point lengths
  const astral = (n) => "𝐀".repeat(n);
  add({ s: "proposal_block", id: "r2-pb-exactly-70-astral-no-truncation", files: { "a.md": COV + "\n" + SEL + `| 1 | Acme | ${astral(70)} | out | base | 3 | w |\n` }, args: PB });
  add({ s: "proposal_block", id: "r2-pb-71-astral-truncation", files: { "a.md": COV + "\n" + SEL + `| 1 | Acme | ${astral(66)} ${astral(4)} | out | base | 3 | w |\n` }, args: PB });
  add({ s: "proposal_block", id: "r2-pb-have-row-astral-req-50", files: { "a.md": COV + `| ${astral(49)} Kubernetes | have | x | answered |\n\n` + SEL, "base-resume.md": "# B\n- Python\n" }, args: PB });
  add({ s: "check_closeout", id: "r2-cc-asked-zwj-and-combining", files: { "plan.md": PLAN }, args: ["--workspace", ".", "--stage", "applying", "--asked", "👨‍👩‍👧‍👦".repeat(9) + "é".repeat(20)] });
  add({ s: "check_materials", id: "r2-cm-reworded-base-missing-astral-60", files: { "base-resume.md": BASE,
    "resume.md": `# A\n\n## Summary\n\nok.\n\n## Experience\n\n- x\n\n## Reworded\n\n- base: ${astral(61)} gone\n  tailored: x\n` }, args: R });
  add({ s: "check_files", id: "r2-cf-table-row-exactly-60-astral", files: { "applications/a.md": COV + `| ${astral(56)} |\n` }, args: ["--workspace", ".", ...sk] });

  // code-point sort
  add({ s: "record_verdict", id: "r2-rv-sort-titles-astral-vs-fffd", files: { "jobs.md": J("## To Review\n\n### Acme — � lead\n\n### Acme — 😀 lead\n\n### Acme — ａ lead\n\n") }, args: ["--workspace", ".", "--company", "Zed", "--title", "PM", "--verdict", "weak"] });
  add({ s: "update_job", id: "r2-uj-sort-dismissed-astral", files: { "jobs.md": J("## Dismissed\n\n### 😀co — PM\n- Was: To Review\n\n### ￠co — PM\n- Was: Applied\n\n## To Review\n\n### Café — Staff Engineer\n\n") }, args: [...UJ, "--dismiss"] });
  add({ s: "record_verdict", id: "r2-rv-unicode-digit-scores", files: { "jobs.md": J("## To Review\n\n### A — PM\n- Score: ٣\n\n### B — PM\n- Score: +05\n\n### C — PM\n- Score: 0\n\n### D — PM\n- Score: -3\n\n### E — PM\n- Score: 1e3\n\n### F — PM\n- Score: ５\n\n") }, args: ["--workspace", ".", "--company", "G", "--title", "PM", "--verdict", "weak", "--score", "4"] });
  add({ s: "check_files", id: "r2-cf-application-order-astral", files: { "applications/😀.md": COV + "| x | bad |\n", "applications/￠.md": COV + "| y | bad |\n", "applications/z.md": COV + "| z | bad |\n" }, args: ["--workspace", ".", ...sk] });

  // whitespace edges Python strips and JS trim() does not (and vice versa)
  add({ s: "record_verdict", id: "r2-rv-nel-and-u2028-in-fields", files: { "jobs.md": J("## To Review\n\n### Beta — PM\n- Reason: foo\u0085\n- URL: a b\n- Location:  x﻿\n\n") }, args: RV });
  add({ s: "record_verdict", id: "r2-rv-newline-in-title-arg", files: {}, args: ["--workspace", ".", "--company", "Acme", "--title", "PM\n## Offer", "--verdict", "weak"] });

  // check_files default --skills under the design's own mount (skills/ inside the workspace)
  add({ s: "check_files", id: "r2-cf-default-skills-design-mount", files: { "profile.md": PROFILE }, args: ["--workspace", "."], mount: "design",
    note: "design-web-agent.md § 4: bundle mounted read-only at `skills/`; skill prose passes no --skills" });
}

// ------------------------------------------------------------------ round 3
// Final re-verify (coder's fix round 2): PY_S whitespace set, Unicode Nd
// digits in int(), argparse `--` / `--help=`, and the --skills default
// derived from the invoked script path (incl. a cwd below the workspace).
{
  const PROFILE = "# P\n## Snapshot\n## Experience\n## Intake findings\n### Positioning strengths\n### Likely interviewer concerns\n" +
    "### Career-narrative gaps\n### Story seeds\n## Interview history\n## Constraints\n## Application defaults\n";
  const J = (body) => "# Pipeline\n\n**Active: 1** · dismissed: 0 · updated 2026-01-01\n\n" + body;
  const RV = ["--workspace", ".", "--company", "Acme", "--title", "Staff Engineer", "--verdict", "strong"];
  const PLAN = "## Board\nWaiting on you\n- the comp floor\nTo do\n- x\n";
  // PY_S: \x1c-\x1f and \x85 are whitespace to Python's str.split()/strip()
  add({ s: "check_materials", id: "r3-cm-info-separators-split", files: { "letter.md": "Dear Hiring Manager,\n\na\x1db\x1ec\x1fd\x85e　f᠎g​h\n" }, args: ["--workspace", ".", "--letter", "letter.md"] });
  add({ s: "record_verdict", id: "r3-rv-strip-info-separators", files: { "jobs.md": J("## To Review\n\n### Beta — PM\n- Reason: \x1cfoo\x1f\n- URL: \x85u\x1d\n- Location: ᠎x​\n\n") }, args: RV });
  add({ s: "render_resume", id: "r3-rr-info-separators", files: { "r.md": "# A\x1c\n\nw1\x1ew2\x85w3\n\x1f\n- b\x1d\n" }, args: ["--md", "r.md", "--html", "o.html"] });
  add({ s: "check_closeout", id: "r3-cc-nel-rows", files: { "plan.md": "## Board\nWaiting on you\n\x85- comp floor\x85\n  \x1c\nTo do\n- x\n" }, args: ["--workspace", ".", "--stage", "applying", "--asked", "comp floor"] });
  // Unicode Nd digits: Python int() accepts any Nd (Devanagari, NKo, math bold, Thai)
  add({ s: "record_verdict", id: "r3-rv-nd-digit-scores-in-file", files: { "jobs.md": J("## To Review\n\n### A — PM\n- Score: १२\n\n### B — PM\n- Score: ߃\n\n### C — PM\n- Score: 𝟓\n\n### D — PM\n- Score: ๙_๙\n\n### E — PM\n- Score: 1__0\n\n### F — PM\n- Score: ²\n\n") }, args: RV });
  add({ s: "record_verdict", id: "r3-rv-nd-digit-score-arg", files: {}, args: [...RV, "--score", "٩٠"] });
  add({ s: "check_closeout", id: "r3-cc-nd-digit-minutes-arg", files: { "plan.md": PLAN }, args: ["--workspace", ".", "--stage", "applying", "--minutes", "३०"] });
  add({ s: "render_resume", id: "r3-rr-superscript-pages-arg", files: { "r.md": "# A\n" }, args: ["--md", "r.md", "--html", "o.html", "--pages", "²"] });
  // argparse `--` and --help=
  add({ s: "update_job", id: "r3-uj-arg-double-dash-tail", files: { "jobs.md": J("## To Review\n\n### Café — Staff\n\n") }, args: ["--workspace", ".", "--company", "Café", "--title", "Staff", "--stage", "Offer", "--", "extra"] });
  add({ s: "check_materials", id: "r3-cm-arg-double-dash-empty-tail", files: { "r.md": "# A\n" }, args: ["--workspace", ".", "--resume", "r.md", "--"] });
  add({ s: "check_closeout", id: "r3-cc-arg-help-empty-equals", files: {}, args: ["--help="] });
  add({ s: "check_files", id: "r3-cf-arg-short-help-equals", files: {}, args: ["-h=x"] });
  add({ s: "record_verdict", id: "r3-rv-arg-asked-like-empty-equals", files: {}, args: [...RV, "--reasons="] });
  // --skills default derived from the invoked script path
  add({ s: "check_files", id: "r3-cf-default-skills-from-subdir-cwd", files: { "profile.md": PROFILE, "applications/a.md": "# a\n" }, cwdRel: "applications", args: ["--workspace", ".."], mount: "design",
    note: "agent cd's below the workspace; Python still resolves skills from __file__" });
  add({ s: "check_files", id: "r3-cf-explicit-skills-beats-default", files: { "profile.md": PROFILE }, args: ["--workspace", ".", "--skills", "nowhere"], mount: "design" });
}

// ------------------------------------------------------------------ engines
function seed(ws, c) {
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(ws, { recursive: true });
  for (const d of c.dirs || []) mkdirSync(join(ws, d), { recursive: true });
  for (const [rel, content] of Object.entries(c.files)) {
    const p = join(ws, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  for (const rel of c.old || []) utimesSync(join(ws, rel), old, old);
}
function snapDisk(ws) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { out[relative(ws, p) + "/"] = "<dir>"; walk(p); }
      else out[relative(ws, p)] = readFileSync(p).toString("base64");
    }
  };
  walk(ws);
  return out;
}
function runPy(c, ws) {
  const script = join(SKILLS, SCRIPTS[c.s]);
  const env = { ...process.env, FREEZE_ISO: WRITERS.has(c.s) ? FROZEN : "" };
  const r = spawnSync("python3", ["-c", BOOT, script, ...c.args], { cwd: join(ws, c.cwdRel || "."), env, encoding: "utf-8" });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status, files: snapDisk(ws) };
}
function runJsBin(c, ws) {
  const bin = join(PKG, "bin", `${c.s}.mjs`);
  const env = { ...process.env, CHECKER_NOW_ISO: WRITERS.has(c.s) ? FROZEN : "" };
  const r = spawnSync("node", [bin, ...c.args], { cwd: join(ws, c.cwdRel || "."), env, encoding: "utf-8" });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status, files: snapDisk(ws) };
}
let SKILL_FILES = null;
function skillFiles() {
  if (SKILL_FILES) return SKILL_FILES;
  SKILL_FILES = {};
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else SKILL_FILES[p] = readFileSync(p);
    }
  };
  walk(SKILLS);
  return SKILL_FILES;
}
const q = (a) => `'${a.replace(/'/g, `'\\''`)}'`;
async function runJsBash(c, ws) {
  // Default: skills seeded at their HOST absolute paths (so explicit
  // `--skills <host path>` args resolve). mount:"design" instead mounts them
  // ONLY where design-web-agent.md § 4 puts them: "the bundle mounted
  // read-only at `skills/`" of the workspace — and nowhere else.
  const files = {};
  for (const [p, b] of Object.entries(skillFiles())) {
    files[c.mount === "design" ? join(ws, "skills", relative(SKILLS, p)) : p] = b;
  }
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  for (const [rel, content] of Object.entries(c.files)) {
    files[join(ws, rel)] = { content: new Uint8Array(content instanceof Buffer ? content : Buffer.from(content, "utf-8")), ...((c.old || []).includes(rel) ? { mtime: old } : {}) };
  }
  const fs = new InMemoryFs(files);
  await fs.mkdir(ws, { recursive: true });
  for (const d of c.dirs || []) await fs.mkdir(join(ws, d), { recursive: true });
  const bash = new Bash({ fs, cwd: join(ws, c.cwdRel || "."), customCommands: [python3Command] });
  const cmd = `python3 ../some/prefix/${SCRIPTS[c.s].split("/").pop()} ${c.args.map(q).join(" ")}`;
  let r;
  try { r = await bash.exec(cmd); } catch (e) { r = { stdout: "", stderr: `THROWN ${e && e.message}\n`, exitCode: -1 }; }
  const out = {};
  const walk = async (d) => {
    for (const n of (await fs.readdir(d)).sort()) {
      const p = join(d, n);
      const st = await fs.stat(p);
      if (c.mount === "design" && p === join(ws, "skills")) continue;
      if (st.isDirectory) { out[relative(ws, p) + "/"] = "<dir>"; await walk(p); }
      else out[relative(ws, p)] = Buffer.from(await fs.readFileBuffer(p)).toString("base64");
    }
  };
  await walk(ws);
  return { stdout: r.stdout, stderr: r.stderr, code: r.exitCode, files: out };
}

const CRASH = new Set(["cm-resume-is-a-directory", "cm-latin1-bytes", "pb-missing-application", "rr-missing-md",
  "cf-missing-workspace-dir", "cf-workspace-is-a-file"]);
const MASK = (s) => s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00/g, "<TS>").replace(/updated \d{4}-\d{2}-\d{2}/g, "updated <D>");
// LEAD RULING (2026-09-23, fix round 1): on an uncaught-exception path,
// parity = the same exit code + a stderr whose FIRST line is exactly
// "Traceback (most recent call last):" on BOTH sides; the rest of the
// traceback may differ. stdout (Python flushes what it printed before the
// crash) and the workspace files are still compared exactly.
const TRACEBACK = "Traceback (most recent call last):";
// render_resume without --html: Python writes to tempfile.mkdtemp() (a fresh
// random dir), so the path after "->" is masked on both sides; the rest of
// stdout and every workspace file are still compared exactly.
const HTML_PATH = (s) => s.replace(/^(words: \d+ {2}-> {2}).*$/m, "$1<TMP>/resume.html");
function compare(a, b, { mask = false, crash = false, htmlMask = false } = {}) {
  const diffs = [];
  const so = htmlMask ? HTML_PATH : (x) => x;
  if (so(a.stdout) !== so(b.stdout)) diffs.push("stdout");
  if (a.code !== b.code) diffs.push(`exit ${a.code}!=${b.code}`);
  const a1 = (a.stderr || "").split("\n")[0], b1 = (b.stderr || "").split("\n")[0];
  if (crash) {
    if (a1 !== TRACEBACK) diffs.push(`py-not-a-traceback`);
    if (b1 !== TRACEBACK) diffs.push(`stderr-line1-not-traceback`);
  } else if (a1 !== b1) diffs.push("stderr-line1");
  else if (a.stderr !== b.stderr) diffs.push("stderr-rest");
  const keys = new Set([...Object.keys(a.files), ...Object.keys(b.files)]);
  for (const k of [...keys].sort()) {
    const fa = a.files[k], fb = b.files[k];
    if (fa === fb) continue;
    if (mask && fa && fb && fa !== "<dir>" && fb !== "<dir>" &&
        MASK(Buffer.from(fa, "base64").toString("utf-8")) === MASK(Buffer.from(fb, "base64").toString("utf-8"))) continue;
    diffs.push(`file:${k}${fa === undefined ? "(only-js)" : fb === undefined ? "(only-py)" : ""}`);
  }
  return diffs;
}

const filter = process.argv.slice(2).find((x) => !x.startsWith("--"));
const asJson = process.argv.includes("--json");
const verbose = process.argv.includes("--verbose");
const results = [];
for (const c of C) {
  if (filter && !c.id.includes(filter)) continue;
  const ws = join(SCRATCH, "ws");
  seed(ws, c); const py = runPy(c, ws);
  seed(ws, c); const jb = runJsBin(c, ws);
  seed(ws, c); const bs = await runJsBash(c, ws);
  const opts = { crash: CRASH.has(c.id), htmlMask: !!c.htmlMask };
  const dBin = compare(py, jb, opts);
  const dBash = compare(py, bs, { ...opts, mask: WRITERS.has(c.s) });
  for (const [label, r] of [["py", py], ["jsbin", jb], ["jsbash", bs]]) {
    for (const [rel, want] of Object.entries(c.untouched || {})) {
      const got = r.files[rel];
      if (got !== Buffer.from(want).toString("base64")) (label === "jsbash" ? dBash : dBin).push(`${label}-touched:${rel}`);
    }
  }
  results.push({ id: c.id, script: c.s, bin: dBin, bash: dBash, py, jb, bs, note: c.note });
}
rmSync(SCRATCH, { recursive: true, force: true });

if (asJson) {
  console.log(JSON.stringify(results.map(({ id, script, bin, bash, note }) => ({ id, script, bin, bash, note })), null, 1));
} else {
  const show = (label, r) => `  ${label}: exit=${r.code}\n    stdout=${JSON.stringify(r.stdout).slice(0, 700)}\n    stderr=${JSON.stringify(r.stderr).slice(0, 300)}`;
  let nb = 0, nbs = 0;
  for (const r of results) {
    const ok = !r.bin.length && !r.bash.length;
    if (r.bin.length) nb++;
    if (r.bash.length) nbs++;
    console.log(`[${ok ? "SAME" : "DIFF"}] ${r.id}${r.bin.length ? `  bin:{${r.bin.join(", ")}}` : ""}${r.bash.length ? `  bash:{${r.bash.join(", ")}}` : ""}${r.note ? `  (${r.note})` : ""}`);
    if (!ok && verbose) {
      console.log(show("py", r.py)); console.log(show("jsbin", r.jb)); console.log(show("jsbash", r.bs));
    }
  }
  const per = {};
  for (const r of results) { per[r.script] ??= [0, 0, 0]; per[r.script][0]++; if (!r.bin.length) per[r.script][1]++; if (!r.bash.length) per[r.script][2]++; }
  console.log("\nper script: identical(py vs jsbin) / identical(py vs jsbash, writers timestamp-masked) / cases");
  for (const [k, [n, a, b]] of Object.entries(per)) console.log(`  ${k.padEnd(16)} ${a}/${n}  ${b}/${n}`);
  console.log(`\n${results.length - nb}/${results.length} identical py vs jsbin; ${results.length - nbs}/${results.length} identical py vs jsbash`);
  process.exit(nb || nbs ? 1 : 0);
}
