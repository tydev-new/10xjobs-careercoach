// A faithful JS port of skills/apply/scripts/check_materials.py.
//
// Runs in Node AND in the browser — no node:fs, no node:path, nothing
// platform-specific. See skills/apply/scripts/check_materials.py for the
// prose this mirrors; this file intentionally keeps the same shape,
// comments, and message text so a diff against the Python original stays
// readable, and so the parity test's byte-for-byte comparison has a chance.
import { join, basename } from "./path-util.mjs";
import { pySplit, normSpace, pyListRepr } from "./py-text.mjs";
import { parseFlags, argError } from "./argx.mjs";

const STANDARD_SECTIONS = new Set([
  "summary", "professional experience", "experience", "selected experience",
  "earlier experience", "other experience", "education", "skills", "key skills & tools",
  "key skills and tools", "patents", "patents & publications", "patents and publications",
  "patents, architectures & education", "selected work and publications",
  "selected work & publications", "selected work, publications & patents",
  "selected work, patents & publications", "publications", "certifications",
  "independent ai projects", "projects",
]);

const CASE_MAX_WORDS = 50;
const LETTER_MIN_WORDS = 250;
const LETTER_MAX_WORDS = 400;
const LETTER_MAX_BLOCKS = 6;

const YEAR_COUNT = /\b\d{2}\+?\s*(?:\+\s*)?years\b/i;
const INFORMAL_SALUTATION = /^\s*(hello|hi|hey|greetings)\b[^,]*[—,-]?\s*$/i;
const ARROW_GLYPHS = /[→⇒▸►◄←↔]/;
const FILLER = /\b(passionate|motivated|fast-paced environments?|outside the box)\b/i;
const CLAIM_NUMBER = /\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?x\b/g;

function section(text, ...names) {
  const re = /^##\s+(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const heading = m[1].toLowerCase();
    if (names.some((n) => heading.includes(n))) {
      const rest = text.slice(m.index + m[0].length);
      const nxt = rest.match(/^##\s+/m);
      return nxt ? rest.slice(0, nxt.index) : rest;
    }
  }
  return "";
}

function blocks(text) {
  const body = text.replace(/^#.*$/gm, "");
  return body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
}

export function checkResume(text, baseText = null, appText = null) {
  const res = [];
  const add = (level, msg) => res.push([level, msg]);
  const headings = [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
  const lower = headings.map((h) => h.toLowerCase().trim());

  if (baseText) {
    const norm = (s) => normSpace(s.replaceAll("**", "").replaceAll("*", ""));
    const normBase = norm(baseText);
    const declared = section(text, "reworded") + "\n" + section(appText || "", "reworded");
    const approved = new Set();
    const reRw = /-\s*base:\s*(.+?)\n\s*tailored:\s*(.+?)(?=\n\s*-\s*base:|\n\s*#|$)/gs;
    let m;
    while ((m = reRw.exec(declared)) !== null) {
      const nbSrc = norm(m[1]);
      const nbOut = norm(m[2]);
      if (!normBase.includes(nbSrc)) {
        add("FAIL", `§ Reworded declares a base line that is not in the base: "${nbSrc.slice(0, 60)}…" — the exemption cannot be self-issued`);
      } else {
        approved.add(nbOut);
      }
    }
    const exp = section(text, "selected experience", "professional experience") || section(text, "experience");
    const reBul = /^-\s+(.*(?:\n(?![-#]).+)*)/gm;
    let bm;
    while ((bm = reBul.exec(exp)) !== null) {
      const nb = norm(bm[1]);
      if (nb && !normBase.includes(nb) && !approved.has(nb)) {
        add("FAIL", `Experience bullet not verbatim from base: "${nb.slice(0, 70)}…" — patterns.md: selection is the tailoring. A JD-vocabulary rewording is allowed only when the candidate approved it and it is declared in § Reworded (base: / tailored: pair)`);
      }
    }
  }

  const summ = section(text, "summary");
  const nums = summ.match(CLAIM_NUMBER) || [];
  const counts = new Map();
  for (const n of nums) counts.set(n, (counts.get(n) || 0) + 1);
  const dupes = [...new Set(nums.filter((n) => counts.get(n) > 1).map((n) => n.trim()))].sort();
  if (dupes.length) {
    add("WARN", `claim number repeated inside the Summary: ${pyListRepr(dupes)} — the case carries the strongest number once; a repeat carries next-best evidence instead (labels make a defended repeat legitimate)`);
  }

  const edu = section(text, "education");
  const yr = edu.match(/\b(19|20)\d{2}\b/);
  if (yr) {
    add("WARN", `year "${yr[0]}" in Education — no graduation dates`);
  }

  const expAll = pySplit(text).join(" ");
  const summSentences = normSpace(summ).split(/[.;]\s+/);
  for (const sent of summSentences) {
    if (pySplit(sent).length >= 8 && countOccurrences(expAll, sent) > 1) {
      add("WARN", `sentence appears in Summary AND Experience: "${sent.slice(0, 60)}…" — Summary carries the number, the role bullet carries the how`);
      break;
    }
  }

  const openerKeywords = ["summary", "highlight", "why i fit", "selected experience against", "qualification", "profile"];
  const openerLike = lower.filter((h) => openerKeywords.some((k) => h.includes(k)));
  if (openerLike.length > 1) {
    add("FAIL", `two opening sections drawing on the same wins: ${pyListRepr(openerLike)} — patterns.md allows ONE (case + checklist), never Summary + a highlights band`);
  }

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const hl = lower[i];
    if (!STANDARD_SECTIONS.has(hl)) {
      add("WARN", `non-standard section name "${h}" — ATS parsers rank on standard names ('Professional Experience', not 'Where I've Made Impact'); put the ambition in a subtitle line instead`);
    }
  }

  const firstHeading = text.match(/^##\s+.*$/m);
  if (firstHeading && openerLike.length) {
    const after = text.slice(firstHeading.index + firstHeading[0].length);
    const caseText = after.split("\n- ")[0];
    let prose = pySplitlines(caseText).filter((ln) => ln.trim() && !["#", "-", "*", ">"].some((c) => ln.startsWith(c)));
    prose = prose.filter((ln) => !/^[*_].*[*_]$/.test(ln.trim()));
    const words = prose.reduce((sum, ln) => sum + pySplit(ln).length, 0);
    if (words > CASE_MAX_WORDS) {
      add("FAIL", `case is ${words} words (max ${CASE_MAX_WORDS}) — the summary obeys the scan budget: a recruiter reads 7-11s in an F-pattern and prose past ~2 lines is invisible`);
    }
  }

  shared(text, add);
  return res;
}

export function checkLetter(text) {
  const res = [];
  const add = (level, msg) => res.push([level, msg]);
  let body = text.replace(/^#.*$/gm, "");
  const cut = body.match(/\n\s*(?:Sincerely|Best regards|Best,|Regards|Warm regards|Thank you,)/);
  if (cut) body = body.slice(0, cut.index);
  const words = pySplit(body).length;
  if (!(words >= LETTER_MIN_WORDS && words <= LETTER_MAX_WORDS)) {
    add("WARN", `letter is ${words} words — patterns.md § Cover letter wants ${LETTER_MIN_WORDS}-${LETTER_MAX_WORDS}`);
  }
  const bl = blocks(body);
  if (bl.length > LETTER_MAX_BLOCKS) {
    add("WARN", `${bl.length} blocks — max ${LETTER_MAX_BLOCKS} (salutation + hook + 2-3 body + why-us + close)`);
  }
  if (bl.length && INFORMAL_SALUTATION.test(bl[0])) {
    add("FAIL", `salutation "${bl[0].trim()}" is DM register — patterns.md: "an application letter, not a relationship DM"; never invent a name, use "Dear Hiring Manager"`);
  }
  shared(text, add);
  return res;
}

function shared(text, add) {
  const claimIdx = text.match(/^##\s*Claim rules/im);
  if (claimIdx) text = text.slice(0, claimIdx.index);
  let m = text.match(ARROW_GLYPHS);
  if (m) {
    add("FAIL", `arrow/scaffolding glyph "${m[0]}" — write transitions in words ("from 80% to under 1%"); glyphs garble in ATS parsers`);
  }
  m = text.match(FILLER);
  if (m) {
    add("FAIL", `banned filler "${m[0]}" — patterns.md § Shape`);
  }
  const prose = text.replace(/^-\s*\*\*[^*]+\*\*/gm, "- ");
  m = prose.match(YEAR_COUNT);
  if (m) {
    add("FAIL", `aggregate year count "${m[0]}" in the candidate's own prose — patterns.md § The Summary: answer with THEIR number instead. (Quoting the JD's bar inside a bolded bullet opener is exempt.)`);
  }
  if ((text.match(/\b80\s*%|\b80%/g) || []).length > 1) {
    add("WARN", "more than one 80%-shaped claim on this surface — base-resume.md requires labels (onboarding failures / production defects / test coverage)");
  }
}

function pySplitlines(s) {
  if (s === "") return [];
  return s.split(/\r\n|\r|\n/);
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  for (;;) {
    idx = haystack.indexOf(needle, idx);
    if (idx === -1) break;
    count++;
    idx += needle.length;
  }
  return count;
}

const PROG = "check_materials.py";
const USAGE =
  "usage: check_materials.py [-h] --workspace WORKSPACE [--resume RESUME]\n" +
  "                          [--letter LETTER] [--base BASE]\n";
const OPTIONS = [
  { flag: "--workspace", dest: "workspace", required: true },
  { flag: "--resume", dest: "resume" },
  { flag: "--letter", dest: "letter" },
  { flag: "--base", dest: "base" },
];

const HEADER =
  "structure tier{maybe} — language tier (never-say, struck forms, confirm-tier, paraphrases) → independent checker: profile/references/language-check.md (#29)\n";

/**
 * @param {string[]} argv
 * @param {{exists(p:string):Promise<boolean>, readFile(p:string):Promise<string>}} io
 * @returns {Promise<{stdout:string, stderr:string, exitCode:number}>}
 */
export async function run(argv, io) {
  const parsed = parseFlags(argv, { options: OPTIONS });
  if (parsed.error) return argError(PROG, USAGE, parsed.error);
  const a = parsed.args;
  if (!a.resume && !a.letter) return argError(PROG, USAGE, "pass --resume and/or --letter");

  const basePath = a.base || join(a.workspace, "base-resume.md");
  const baseText = (await io.exists(basePath)) ? await io.readFile(basePath) : null;

  let stdout = HEADER.replace("{maybe}", baseText ? ", base résumé loaded for the verbatim check" : "");

  let failed = false;
  const jobs = [
    ["RESUME", a.resume, "resume"],
    ["LETTER", a.letter, "letter"],
  ];
  for (const [label, path, kind] of jobs) {
    if (!path) continue;
    if (!(await io.exists(path))) {
      stdout += `${label}: file not found: ${path}\n`;
      failed = true;
      continue;
    }
    const text = await io.readFile(path);
    let results;
    if (kind === "resume") {
      let appText;
      const appCand = path.replace(/-resume\.md$/, "-application.md");
      if (appCand !== path && (await io.exists(appCand))) appText = await io.readFile(appCand);
      results = checkResume(text, baseText, appText);
    } else {
      results = checkLetter(text);
    }
    const fails = results.filter((r) => r[0] === "FAIL");
    stdout += `\n${label} ${basename(path)}: ${fails.length ? "FAIL" : "pass"} (${fails.length} fail, ${results.length - fails.length} warn)\n`;
    for (const [level, msg] of results) stdout += `  [${level}] ${msg}\n`;
    failed = failed || fails.length > 0;
  }
  stdout += "\n" + (failed ? "✘ fix the FAILs before delivering" : "✔ mechanical checks clean") + "\n";
  return { stdout, stderr: "", exitCode: failed ? 1 : 0 };
}
