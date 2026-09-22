// A faithful JS port of skills/coach/scripts/check_closeout.py.
//
// Runs in Node AND in the browser — no node:fs, no node:path, nothing
// platform-specific. Callers inject an `io` object:
//   io.exists(path)   -> Promise<boolean>
//   io.readFile(path)  -> Promise<string>       (utf-8 text)
//   io.mtimeMs(path)   -> Promise<number>        (epoch ms)
// and a `now` function returning epoch ms (defaults to Date.now so tests
// can freeze time the way the Python test's os.utime() does).
//
// See skills/coach/scripts/check_closeout.py for the prose this mirrors —
// this file intentionally keeps the same shape, comments, and message
// text so a diff against the Python original stays readable.

export const STAGES = ["groundwork", "searching", "applying", "interviewing", "deciding"];

const STOP = new Set(
  "the a an of to in on for and or is are be with at by from your my their it this that which what".split(" ")
);

function posixJoin(...parts) {
  // Mirrors os.path.join for the two-segment calls this script makes.
  const [a, b] = parts;
  if (a === "" || a === undefined) return b;
  return a.endsWith("/") ? a + b : `${a}/${b}`;
}

export function waitingRows(text) {
  // Python: re.search(r"^Waiting on you\s*\n(.*?)(?=^(?:To do|Doing|Done|##)\b|\Z)", text, re.S|re.M)
  // then splits the captured block into bullet rows (a row can span
  // multiple wrapped lines).
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^Waiting on you\s*$/.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return [];
  const block = [];
  for (let i = start; i < lines.length; i++) {
    if (/^(To do|Doing|Done|##)\b/.test(lines[i])) break;
    block.push(lines[i]);
  }
  const rows = [];
  let cur = null;
  for (const ln of block) {
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
        findings.push(["FAIL", `asked "${q.slice(0, 60)}" — no Waiting-on-you row shares a word with it; write the row this turn`]);
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
