// A faithful JS port of skills/search/scripts/update_job.py. Runs in Node
// AND in the browser; no node:fs, no node:path.
import * as jm from "./jobs-md.mjs";
import { parseFlags, argError } from "./argx.mjs";

const PROG = "update_job.py";
const USAGE =
  "usage: update_job.py [-h] --workspace WORKSPACE --company COMPANY\n" +
  "                     --title TITLE\n" +
  "                     (--stage {To Review,Interested,Applied,Interviewing,Offer} |\n" +
  "                     --dismiss | --restore) [--reason REASON]\n";
const OPTIONS = [
  { flag: "--workspace", dest: "workspace", required: true },
  { flag: "--company", dest: "company", required: true },
  { flag: "--title", dest: "title", required: true },
  { flag: "--stage", dest: "stage", choices: jm.STAGES },
  { flag: "--dismiss", dest: "dismiss", boolean: true },
  { flag: "--restore", dest: "restore", boolean: true },
  { flag: "--reason", dest: "reason" },
];

export async function run(argv, io, now = () => new Date()) {
  const parsed = parseFlags(argv, { options: OPTIONS });
  if (parsed.error) return argError(PROG, USAGE, parsed.error);
  const a = parsed.args;

  // argparse's mutually-exclusive group: exactly one of --stage/--dismiss/
  // --restore, checked (and reported) in the order the flags appear on argv.
  const order = argv.map((t) => t.split("=")[0]).filter((t) => t === "--stage" || t === "--dismiss" || t === "--restore");
  if (order.length === 0) {
    return argError(PROG, USAGE, "one of the arguments --stage --dismiss --restore is required");
  }
  if (order.length > 1) {
    return argError(PROG, USAGE, `argument ${order[1]}: not allowed with argument ${order[0]}`);
  }

  const rows = await jm.load(io, a.workspace);
  const hits = jm.find(rows, a.company, a.title);
  if (hits.length !== 1) {
    const which = hits.length === 0 ? "no roles" : `${hits.length} roles: ` + hits.map((r) => r.title).join("; ");
    return { stdout: "", stderr: `error: --company/--title matched ${which} — be more specific\n`, exitCode: 2 };
  }
  const r = hits[0];
  r.updated_at = jm.nowIso(now);
  let action;
  if (a.stage) {
    r.stage = a.stage;
    r.dismissed = false;
    action = `stage -> ${a.stage}`;
  } else if (a.dismiss) {
    r.dismissed = true;
    if (a.reason) r.dismiss_reason = a.reason;
    action = "dismissed" + (a.reason ? ` (${a.reason})` : "");
  } else {
    r.dismissed = false;
    action = "restored";
  }
  try {
    await jm.save(io, a.workspace, rows, { now });
  } catch (e) {
    if (e instanceof jm.DuplicateKeyError) return { stdout: "", stderr: e.message + "\n", exitCode: 1 };
    throw e;
  }
  return { stdout: `updated: ${r.company} — ${r.title} — ${action}\n`, stderr: "", exitCode: 0 };
}
