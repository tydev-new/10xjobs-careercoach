// The file-name dispatch table (docs/design-web-agent.md § 5, closing
// re-review S12): `python3 <any path>/<script>.py <args>` inside just-bash
// reaches the JS port matched by the script's FILE NAME, not its exact
// path — `scripts/check_materials.py`, `../apply/scripts/check_materials.py`,
// and `skills/apply/scripts/check_materials.py` all reach the same port,
// because the skills genuinely invoke the ported scripts with different
// relative prefixes depending on which skill is calling.
import { run as checkMaterials } from "./check-materials.mjs";
import { run as checkFiles } from "./check-files.mjs";
import { run as proposalBlock } from "./proposal-block.mjs";
import { run as recordVerdict } from "./record-verdict.mjs";
import { run as updateJob } from "./update-job.mjs";
import { run as checkCloseout } from "./check-closeout.mjs";
import { run as renderResume } from "./render-resume.mjs";

// name -> (argv, io, now) => Promise<{stdout, stderr, exitCode}>
export const REGISTRY = {
  "check_materials.py": (argv, io) => checkMaterials(argv, io),
  "check_files.py": (argv, io) => checkFiles(argv, io),
  "proposal_block.py": (argv, io) => proposalBlock(argv, io),
  "record_verdict.py": (argv, io, now) => recordVerdict(argv, io, now),
  "update_job.py": (argv, io, now) => updateJob(argv, io, now),
  "check_closeout.py": (argv, io, now) => checkCloseout(argv, io, now),
  "render_resume.py": (argv, io) => renderResume(argv, io),
};

export function basenameOf(p) {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

/**
 * Dispatches a `python3 <argv[0]> <argv.slice(1)>` command line to the JS
 * port matching argv[0]'s file name. Any script this repo hasn't ported
 * (e.g. `check_messages.py`), a bare `-c`, or no argument at all exits 127
 * with a clear message — the same shape a missing command would.
 */
export async function dispatchPython3(argv, io, now) {
  const scriptArg = argv[0];
  if (!scriptArg) {
    return { stdout: "", stderr: "not available in the web app: (no script given)\n", exitCode: 127 };
  }
  const name = basenameOf(scriptArg);
  const handler = REGISTRY[name];
  if (!handler) {
    return { stdout: "", stderr: `not available in the web app: ${name}\n`, exitCode: 127 };
  }
  return handler(argv.slice(1), io, now);
}
