// A faithful JS port of skills/evaluate/scripts/record_verdict.py. Runs in
// Node AND in the browser; no node:fs, no node:path. See jobs-md.mjs for
// the shared pipeline record it upserts into.
import * as jm from "./jobs-md.mjs";
import { parseFlags, argError, argHelp } from "./argx.mjs";
import { HELP } from "./help-text.mjs";
import { restoreLineSeparators } from "./py-text.mjs";

const VERDICTS = ["strong", "investable_stretch", "long_shot", "weak"];
const TRACKS = ["A", "B", "C"];

const PROG = "record_verdict.py";
const USAGE =
  "usage: record_verdict.py [-h] --workspace WORKSPACE --company COMPANY\n" +
  "                         --title TITLE\n" +
  "                         --verdict {strong,investable_stretch,long_shot,weak}\n" +
  "                         [--score SCORE] [--reasons REASONS]\n" +
  "                         [--dealbreakers DEALBREAKERS] [--url URL]\n" +
  "                         [--location LOCATION] [--jd-file JD_FILE]\n" +
  "                         [--company-file COMPANY_FILE] [--track {A,B,C}]\n";
const OPTIONS = [
  { flag: "--workspace", dest: "workspace", required: true },
  { flag: "--company", dest: "company", required: true },
  { flag: "--title", dest: "title", required: true },
  { flag: "--verdict", dest: "verdict", required: true, choices: VERDICTS },
  { flag: "--score", dest: "score", type: "int" },
  { flag: "--reasons", dest: "reasons" },
  { flag: "--dealbreakers", dest: "dealbreakers" },
  { flag: "--url", dest: "url" },
  { flag: "--location", dest: "location" },
  { flag: "--jd-file", dest: "jd_file" },
  { flag: "--company-file", dest: "company_file" },
  { flag: "--track", dest: "track", choices: TRACKS },
];

/**
 * @param {string[]} argv
 * @param {import("./io-node.mjs").Io} io
 * @param {() => Date} [now]
 */
export async function run(argv, io, now = () => new Date()) {
  const parsed = parseFlags(argv, { options: OPTIONS, help: HELP.record_verdict });
  if (parsed.help) return argHelp(parsed.text);
  if (parsed.error) return argError(PROG, USAGE, parsed.error);
  const a = parsed.args;
  if (a.score !== null && !(a.score >= 0 && a.score <= 100)) {
    return { stdout: "", stderr: "error: --score must be 0-100\n", exitCode: 2 };
  }

  const rows = await jm.load(io, a.workspace);
  const nowStr = jm.nowIso(now);
  const k = jm.key({ company: a.company, title: a.title });
  let row = rows.find((r) => jm.key(r) === k) || null;
  const existed = row !== null;
  if (!existed) {
    row = { company: a.company, title: a.title, stage: "To Review", dismissed: false, seen_at: nowStr };
    rows.push(row);
  }
  row.fit_verdict = a.verdict;
  row.fit_score = a.score;
  row.fit_reason = a.reasons;
  row.dealbreakers = a.dealbreakers;
  row.url = a.url || row.url;
  row.location = a.location || row.location;
  row.jd_file = row.jd_file || a.jd_file;
  row.company_file = a.company_file || row.company_file;
  row.track = a.track || row.track;
  row.evaluated_at = row.updated_at = nowStr;

  try {
    await jm.save(io, a.workspace, rows, { now });
  } catch (e) {
    if (e instanceof jm.DuplicateKeyError) return { stdout: "", stderr: e.message + "\n", exitCode: 1 };
    throw e;
  }
  const how = existed ? "updated existing role" : "created NEW role";
  const scoreStr = a.score === null ? "None" : String(a.score);
  return {
    stdout: restoreLineSeparators(`recorded (${how}): ${row.company} — ${row.title} → ${a.verdict} (${scoreStr})\n`),
    stderr: "",
    exitCode: 0,
  };
}
