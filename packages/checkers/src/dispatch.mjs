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
import { join } from "./path-util.mjs";

// Each ported script's own position inside the skills/ bundle
// (docs/design-web-agent.md § 5's port table) — the ONE fact this file
// needs to know to reconstruct "where does this script's __file__ live"
// for check_files.py's --skills default (fix round 2, item 1). Not used
// for ROUTING (that's file-name-only, per S12) — only for this one
// script's default-value computation.
export const CANONICAL_SKILL_PATH = {
  "check_materials.py": "apply/scripts/check_materials.py",
  "proposal_block.py": "apply/scripts/proposal_block.py",
  "render_resume.py": "apply/scripts/render_resume.py",
  "record_verdict.py": "evaluate/scripts/record_verdict.py",
  "update_job.py": "search/scripts/update_job.py",
  "check_closeout.py": "coach/scripts/check_closeout.py",
  "check_files.py": "profile/scripts/check_files.py",
};

// name -> (argv, io, now, invokedScriptPath) => Promise<{stdout, stderr, exitCode}>
export const REGISTRY = {
  "check_materials.py": (argv, io) => checkMaterials(argv, io),
  "check_files.py": (argv, io, now, invokedScriptPath) => checkFiles(argv, io, invokedScriptPath),
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
 *
 * `skillsMountRoot` (optional): the directory the skills bundle is
 * mounted at in THIS caller's filesystem — docs/design-web-agent.md § 4:
 * "the bundle mounted read-only at `skills/`" of the sandboxed workspace,
 * i.e. `<cwd>/skills`. When given, it's combined with the matched
 * script's own CANONICAL_SKILL_PATH to reconstruct "where this script's
 * `__file__` would be" — fed to check_files.py's port for its --skills
 * default (fix round 2, item 1), the same way Python computes it from its
 * own `__file__`, and deliberately IGNORING argv[0]'s own (often
 * fictional — see the S12 file-name-only routing above) path. If omitted,
 * the handler falls back to its own caller-appropriate default (see
 * bin/check_files.mjs for the Node CLI's).
 */
export async function dispatchPython3(argv, io, now, skillsMountRoot) {
  const scriptArg = argv[0];
  if (!scriptArg) {
    return { stdout: "", stderr: "not available in the web app: (no script given)\n", exitCode: 127 };
  }
  const name = basenameOf(scriptArg);
  const handler = REGISTRY[name];
  if (!handler) {
    return { stdout: "", stderr: `not available in the web app: ${name}\n`, exitCode: 127 };
  }
  const invokedScriptPath =
    skillsMountRoot != null && CANONICAL_SKILL_PATH[name] ? join(skillsMountRoot, "skills", CANONICAL_SKILL_PATH[name]) : undefined;
  return handler(argv.slice(1), io, now, invokedScriptPath);
}
