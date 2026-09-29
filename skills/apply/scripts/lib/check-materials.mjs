// A faithful JS port of the retired check_materials.py (J2; the Python is
// deleted — see docs/receipts.md and this file's own comments for the
// prose it carried).
//
// Runs in Node AND in the browser — no node:fs, no node:path, nothing
// platform-specific. This file intentionally kept the same shape,
// comments, and message text as the Python original so a diff against
// it stayed readable during the port, and so the parity test's
// byte-for-byte comparison against the frozen expected-output cases has
// a chance.
import { join, basename } from "../../../profile/scripts/lib/path-util.mjs";
import { pySplit, normSpace, pyListRepr, pySplitlines, restoreLineSeparators, cpSlice, pyStrip, PY_S, PY_NOT_S, PY_B_START, PY_B_END } from "../../../profile/scripts/lib/py-text.mjs";
import { parseFlags, argError, argHelp } from "../../../profile/scripts/lib/argx.mjs";
import { HELP } from "../../../profile/scripts/lib/help-text.mjs";
import { crashToTraceback } from "../../../profile/scripts/lib/traceback.mjs";

const STANDARD_SECTIONS = new Set([
  "summary", "professional experience", "experience", "selected experience",
  "earlier experience", "other experience", "education", "skills", "key skills & tools",
  "key skills and tools", "patents", "patents & publications", "patents and publications",
  "patents, architectures & education", "selected work and publications",
  "selected work & publications", "selected work, publications & patents",
  "selected work, patents & publications", "publications", "certifications",
  "independent ai projects", "projects",
]);

const SUMMARY_PROSE_MAX_WORDS = 50;
const LETTER_MIN_WORDS = 250;
const LETTER_MAX_WORDS = 400;
const LETTER_MAX_BLOCKS = 6;

const YEAR_COUNT = /\b\d{2}\+?\s*(?:\+\s*)?years\b/i;
const INFORMAL_SALUTATION = new RegExp(`^${PY_S}*(hello|hi|hey|greetings)\\b[^,]*[—,-]?${PY_S}*$`, "i");
// patterns.md assembly table: arrows garble in ATS parsers and read as audit
// scaffolding that leaked into the document (candidate-caught 2026-08-16).
const ARROW_GLYPHS = /[→⇒▸►◄←↔]/;
// Owner ruling 6 (2026-09-25, docs/design-apply-three-lens.md § 4): ASCII
// arrow chains — catches "->", "-->", "<-", "<->", "=>", "==>", "<=>";
// never matches "<=", ">=", "<", or ">" alone. A named exception to the
// earned-FAIL bar (goals § 2): no incident behind it, row in
// docs/receipts.md § apply. Same source text as check_materials.py's
// ASCII_ARROWS.
const ASCII_ARROWS = /<=+>|<-+>?|-+>|=+>/;
// Exempt spans (replaced with one space before scanning): backtick and
// tilde fences, HTML comments, double- and single-backtick inline code
// (one line — the double-backtick branch must come before the
// single-backtick one), and URLs ([\s\S] stands in for Python's re.S
// dot; the URL's \S is built from PY_NOT_S — never a bare JS \S, which
// differs from Python's on U+001C–U+001F, U+0085, and U+FEFF).
const ARROW_EXEMPT_SPANS = new RegExp("```[\\s\\S]*?```|~~~[\\s\\S]*?~~~|<!--[\\s\\S]*?-->|``[^\\n]*?``|`[^`\\n]*`|https?://" + PY_NOT_S + "+", "g");
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
  return body.split(/\n\s*\n/).map((b) => pyStrip(b)).filter(Boolean);
}

export function checkResume(text, baseText = null, appText = null) {
  const res = [];
  const add = (level, msg) => res.push([level, msg]);
  const headings = [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
  const lower = headings.map((h) => h.toLowerCase().trim());

  if (baseText) {
    const norm = (s) => normSpace(s.replaceAll("**", "").replaceAll("*", ""));
    const normBase = norm(baseText);
    // § Reworded declares JD-vocabulary rewordings the candidate approved
    // line by line (patterns.md § Rewording, candidate ruling 2026-08-19).
    // Each pair must name a REAL base line — a pair whose `base:` half is
    // not in the base would let anything through, so it is its own FAIL.
    const declared = section(text, "reworded") + "\n" + section(appText || "", "reworded");
    const approved = new Set();
    const reRw = /-\s*base:\s*(.+?)\n\s*tailored:\s*(.+?)(?=\n\s*-\s*base:|\n\s*#|$)/gs;
    let m;
    while ((m = reRw.exec(declared)) !== null) {
      const nbSrc = norm(m[1]);
      const nbOut = norm(m[2]);
      if (!normBase.includes(nbSrc)) {
        add("FAIL", `§ Reworded declares a base line that is not in the base: "${cpSlice(nbSrc, 60)}…" — the exemption cannot be self-issued`);
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
        add("FAIL", `Experience bullet not verbatim from base: "${cpSlice(nb, 70)}…" — patterns.md: selection is the tailoring. A JD-vocabulary rewording is allowed only when the candidate approved it and it is declared in § Reworded (base: / tailored: pair)`);
      }
    }
  }

  const summ = section(text, "summary");
  const nums = summ.match(CLAIM_NUMBER) || [];
  const counts = new Map();
  for (const n of nums) counts.set(n, (counts.get(n) || 0) + 1);
  const dupes = [...new Set(nums.filter((n) => counts.get(n) > 1).map((n) => n.trim()))].sort();
  if (dupes.length) {
    add("WARN", `claim number repeated inside the Summary: ${pyListRepr(dupes)} — the Summary carries each number once; a repeat carries next-best evidence instead (labels make a defended repeat legitimate)`);
  }

  const edu = section(text, "education");
  const yr = edu.match(new RegExp(`${PY_B_START}(19|20)\\d{2}${PY_B_END}`, "u"));
  if (yr) {
    add("WARN", `year "${yr[0]}" in Education — no graduation dates`);
  }

  const expAll = pySplit(text).join(" ");
  const summSentences = normSpace(summ).split(/[.;]\s+/);
  for (const sent of summSentences) {
    if (pySplit(sent).length >= 8 && countOccurrences(expAll, sent) > 1) {
      add("WARN", `sentence appears in Summary AND Experience: "${cpSlice(sent, 60)}…" — Summary carries the number, the role bullet carries the how`);
      break;
    }
  }

  const openerKeywords = ["summary", "highlight", "why i fit", "selected experience against", "qualification", "profile"];
  const openerLike = lower.filter((h) => openerKeywords.some((k) => h.includes(k)));
  if (openerLike.length > 1) {
    add("FAIL", `two opening sections drawing on the same wins: ${pyListRepr(openerLike)} — patterns.md allows ONE Summary, never Summary + a highlights band`);
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
    if (words > SUMMARY_PROSE_MAX_WORDS) {
      add("FAIL", `Summary opens with ${words} words of prose (max ${SUMMARY_PROSE_MAX_WORDS}) — the Summary is bullets (apply's patterns.md § The Summary); a recruiter reads 7-11s in an F-pattern and prose past ~2 lines is invisible`);
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
    add("FAIL", `salutation "${pyStrip(bl[0])}" is DM register — patterns.md: "an application letter, not a relationship DM"; never invent a name, use "Dear Hiring Manager"`);
  }
  shared(text, add);
  return res;
}

function shared(text, add) {
  // § Claim rules is internal ("never ships") AND it is meta-text ABOUT
  // forbidden forms — a rule that names the hazard it bans would fail the
  // scan that enforces it. Strip it before scanning the shippable body.
  // Earned 2026-08-18: the rebuilt base FAILed on its own age-tag rule.
  const claimIdx = text.match(/^##\s*Claim rules/im);
  if (claimIdx) text = text.slice(0, claimIdx.index);
  let m = text.match(ARROW_GLYPHS);
  if (m) {
    add("FAIL", `arrow/scaffolding glyph "${m[0]}" — write transitions in words ("from 80% to under 1%"); glyphs garble in ATS parsers`);
  }
  m = text.replace(ARROW_EXEMPT_SPANS, " ").match(ASCII_ARROWS);
  if (m) {
    add("FAIL", `arrow chain "${m[0]}" — write it in words ("from 80% to under 1%"); a reader sees an arrow as notes, not a sentence`);
  }
  m = text.match(FILLER);
  if (m) {
    add("FAIL", `banned filler "${m[0]}" — patterns.md § Shape`);
  }
  // Rule 3 bans the candidate's OWN aggregate year count ("25+ years of
  // experience"). It does NOT ban quoting the JD's bar, which the checklist
  // pattern actively requires — a bullet opening "**10+ years in software
  // engineering:** yes — ..." is the pattern working. So strip the bolded
  // JD-requirement openers before scanning.
  // Earned 2026-08-03: a Vercel résumé failed for echoing Vercel's own stated bar.
  const prose = text.replace(/^-\s*\*\*[^*]+\*\*/gm, "- ");
  m = prose.match(YEAR_COUNT);
  if (m) {
    add("FAIL", `aggregate year count "${m[0]}" in the candidate's own prose — patterns.md § The Summary: answer with THEIR number instead. (Quoting the JD's bar inside a bolded bullet opener is exempt.)`);
  }
  if ((text.match(/\b80\s*%|\b80%/g) || []).length > 1) {
    add("WARN", "more than one 80%-shaped claim on this surface — base-resume.md requires labels (onboarding failures / production defects / test coverage)");
  }
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

const PROG = "check_materials.mjs";
const USAGE =
  "usage: check_materials.mjs [-h] --workspace WORKSPACE [--resume RESUME]\n" +
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
  const parsed = parseFlags(argv, { options: OPTIONS, help: HELP.check_materials });
  if (parsed.help) return argHelp(parsed.text);
  if (parsed.error) return argError(PROG, USAGE, parsed.error);
  const a = parsed.args;
  if (!a.resume && !a.letter) return argError(PROG, USAGE, "pass --resume and/or --letter");

  let stdout = "";
  try {
    const basePath = a.base || join(a.workspace, "base-resume.md");
    const baseText = (await io.exists(basePath)) ? await io.readFile(basePath) : null;

    stdout = HEADER.replace("{maybe}", baseText ? ", base résumé loaded for the verbatim check" : "");

    let failed = false;
    let totalWarn = 0;
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
      const warns = results.length - fails.length;
      stdout += `\n${label} ${basename(path)}: ${fails.length ? "FAIL" : "pass"} (${fails.length} fail, ${warns} warn)\n`;
      for (const [level, msg] of results) stdout += `  [${level}] ${msg}\n`;
      failed = failed || fails.length > 0;
      totalWarn += warns;
    }
    // design-honest-ceilings.md § 6A: never say "clean" beside a standing
    // WARN. Exit codes don't change — a WARN-only run still exits 0.
    let closing;
    if (failed) {
      closing = "✘ fix the FAILs before delivering";
    } else if (totalWarn > 0) {
      closing = `no failures, ${totalWarn === 1 ? "1 warning" : `${totalWarn} warnings`} above — fix each one or tell the candidate`;
    } else {
      closing = "✔ automatic checks clean";
    }
    stdout += "\n" + closing + "\n";
    return { stdout: restoreLineSeparators(stdout), stderr: "", exitCode: failed ? 1 : 0 };
  } catch (e) {
    // Python's os.path.exists() is true for a directory too, so a
    // --resume/--letter pointing at one clears the "file not found"
    // branch and then open() raises IsADirectoryError — uncaught. A
    // corrupt (non-UTF-8) file raises UnicodeDecodeError the same way.
    return crashToTraceback(restoreLineSeparators(stdout), e);
  }
}
