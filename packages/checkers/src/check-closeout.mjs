// A faithful JS port of skills/coach/scripts/check_closeout.py. Reused
// (per docs/spikes/spike-2-just-bash-commands.md) from spikes/2-just-bash/
// src/check-closeout.mjs, with a `run(argv, io, now)` wrapper added so this
// port matches every other checker's uniform entry point for dispatch.mjs.
//
// Runs in Node AND in the browser — no node:fs, no node:path, nothing
// platform-specific. Callers inject an `io` object:
//   io.exists(path)   -> Promise<boolean>
//   io.readFile(path)  -> Promise<string>       (utf-8 text)
//   io.mtimeMs(path)   -> Promise<number>        (epoch ms)
// and a `now` function returning epoch ms (defaults to Date.now so tests
// can freeze time the way the Python test's os.utime() does).
import { parseFlags, argError, argHelp } from "./argx.mjs";
import { cpSlice, pySplitlines } from "./py-text.mjs";
import { HELP } from "./help-text.mjs";

export const STAGES = ["groundwork", "searching", "applying", "interviewing", "deciding"];

const STOP = new Set(
  "the a an of to in on for and or is are be with at by from your my their it this that which what".split(" ")
);

function posixJoin(...parts) {
  const [a, b] = parts;
  if (a === "" || a === undefined) return b;
  return a.endsWith("/") ? a + b : `${a}/${b}`;
}

// Python: re.search(r"^Waiting on you\s*\n(.*?)(?=^(?:To do|Doing|Done|##)\b|\Z)", text, re.S|re.M)
// `^`/`$` under Python's re.M matches only at real `\n` boundaries — NOT
// the broader set `.splitlines()` recognizes — so this extraction step
// stays LF-only (text is already through `universalNewlines`, which
// turns CRLF/CR into `\n` and swaps U+2028/U+2029 for non-line-terminator
// sentinels, so JS's own `^`/`$` (which under `m` treats \n, \r,
// U+2028/U+2029 as terminators) agrees with Python's here once neither
// of the other three remains in the text). `$(?![\s\S])` is `\Z`: end of
// the WHOLE string, not "before a trailing newline" (which plain `$`
// would also accept under the `m` flag).
const WAITING_RE = /^Waiting on you\s*\n([\s\S]*?)(?=^(?:To do|Doing|Done|##)\b|$(?![\s\S]))/m;

export function waitingRows(text) {
  const m = WAITING_RE.exec(text);
  if (!m) return [];
  // Python then splits the CAPTURED block with `.splitlines()` — the
  // broad boundary set (\v, \f, \x1c-\x1e, NEL, U+2028/U+2029 too), not
  // `\n` alone (fix round 3, item 2 — this port previously re-split the
  // whole text by `/\r?\n/` up front and lost every one of those; the
  // corpus's `r3-cc-nel-rows` case has a NEL-delimited bullet row and a
  // form-feed-only continuation line).
  const rows = [];
  let cur = null;
  for (const ln of pySplitlines(m[1])) {
    if (/^\s*[-*•]\s+/.test(ln)) {
      if (cur !== null) rows.push(cur);
      cur = ln.replace(/^\s*[-*•]\s+/, "");
    } else if (cur !== null && ln.trim()) {
      cur += " " + ln.trim();
    }
  }
  if (cur !== null) rows.push(cur);
  return rows;
}

export function keywords(s) {
  const matches = s.toLowerCase().match(/[a-z0-9][a-z0-9-]+/g) || [];
  return new Set(matches.filter((w) => !STOP.has(w) && w.length > 2));
}

function intersects(a, b) {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/**
 * @param {{workspace: string, stage?: string|null, asked?: string[], minutes?: number}} args
 * @param {{exists(p:string):Promise<boolean>, readFile(p:string):Promise<string>, mtimeMs(p:string):Promise<number>}} io
 * @param {() => number} [now]
 * @returns {Promise<{stdout: string, exitCode: number}>}
 */
export async function checkCloseout(args, io, now = () => Date.now()) {
  const workspace = args.workspace;
  const asked = args.asked ?? [];
  const minutes = args.minutes ?? 30;
  const findings = [];

  let stage = args.stage ?? null;
  if (stage === null || stage === undefined) {
    const jp = posixJoin(workspace, "jobs.md");
    if (await io.exists(jp)) {
      const jtext = (await io.readFile(jp)).toLowerCase();
      if (jtext.includes("| offer") || jtext.includes("| deciding")) stage = "deciding";
      else if (jtext.includes("| interview")) stage = "interviewing";
      else if (jtext.includes("| applied") || jtext.includes("| tailoring")) stage = "applying";
      else if (jtext.includes("| screen") || jtext.includes("| lead") || jtext.includes("| match")) stage = "searching";
      else stage = "groundwork";
    } else {
      stage = "groundwork";
    }
  }

  if (!STAGES.includes(stage.toLowerCase())) {
    findings.push(["FAIL", `stage "${stage}" is not one of ${STAGES.join(", ")} — name the stage the search is in`]);
  }

  const p = posixJoin(workspace, "plan.md");
  if (!(await io.exists(p))) {
    findings.push(["FAIL", "plan.md does not exist — the plan is written in the same reply"]);
  } else {
    const mtimeMs = await io.mtimeMs(p);
    const ageMin = (now() - mtimeMs) / 60000;
    if (ageMin > minutes) {
      findings.push([
        "FAIL",
        `plan.md was last written ${ageMin.toFixed(0)} min ago — every plan change the reply claims is WRITTEN before the reply ends`,
      ]);
    }
    const text = await io.readFile(p);
    if (!text.includes("## Board")) {
      findings.push(["FAIL", "plan.md has no ## Board"]);
    }
    const rows = waitingRows(text);
    for (const q of asked) {
      const kq = keywords(q);
      if (!rows.some((r) => intersects(kq, keywords(r)))) {
        findings.push(["FAIL", `asked "${cpSlice(q, 60)}" — no Waiting-on-you row shares a word with it; write the row this turn`]);
      }
    }
    if (asked.length && rows.length === 0) {
      findings.push(["FAIL", `${asked.length} question(s) asked, Waiting on you is empty`]);
    }
    const todo = /^To do\s*\n\s*[-*•]/m.test(text);
    if (!todo && rows.length === 0) {
      findings.push(["WARN", "the Board has no To do and no Waiting-on-you rows — a plan with nothing on it is rarely the plan"]);
    }
  }

  let stdout = "";
  for (const [level, msg] of findings) stdout += `${level}  ${msg}\n`;
  if (findings.length === 0) {
    stdout += `close-out clean: stage ${stage}; plan.md written; ${asked.length} question(s) each have a row\n`;
  }
  const exitCode = findings.some(([level]) => level === "FAIL") ? 1 : 0;
  return { stdout, exitCode };
}

const PROG = "check_closeout.py";
const USAGE =
  "usage: check_closeout.py [-h] --workspace WORKSPACE [--stage STAGE]\n" +
  "                         [--asked ASKED] [--minutes MINUTES]\n";
const OPTIONS = [
  { flag: "--workspace", dest: "workspace", required: true },
  { flag: "--stage", dest: "stage" },
  { flag: "--asked", dest: "asked", append: true },
  { flag: "--minutes", dest: "minutes", type: "int", default: 30 },
];

export async function run(argv, io, now = () => Date.now()) {
  const parsed = parseFlags(argv, { options: OPTIONS, help: HELP.check_closeout });
  if (parsed.help) return argHelp(parsed.text);
  if (parsed.error) return argError(PROG, USAGE, parsed.error);
  const { stdout, exitCode } = await checkCloseout(parsed.args, io, now);
  return { stdout, stderr: "", exitCode };
}
