// The file-name dispatch table (docs/design-web-agent.md § 5, closing
// re-review S12; docs/design-js-only.md § 3.5, J2): `node <any path>/<script>.mjs
// <args>` inside just-bash reaches the JS port matched by the script's
// FILE NAME, not its exact path — `scripts/check_materials.mjs`,
// `../apply/scripts/check_materials.mjs`, and
// `skills/apply/scripts/check_materials.mjs` all reach the same port,
// because the skills genuinely invoke the ported scripts with different
// relative prefixes depending on which skill is calling.
//
// The web runs the SAME module the local host runs: these imports point
// straight at skills/<skill>/scripts/lib/<name>.mjs — the one copy of
// each script's logic, per docs/design-js-only.md § 2.
import { run as checkMaterials } from "../../../skills/apply/scripts/lib/check-materials.mjs";
import { run as checkFiles } from "../../../skills/profile/scripts/lib/check-files.mjs";
import { run as proposalBlock } from "../../../skills/apply/scripts/lib/proposal-block.mjs";
import { run as recordVerdict } from "../../../skills/evaluate/scripts/lib/record-verdict.mjs";
import { run as updateJob } from "../../../skills/search/scripts/lib/update-job.mjs";
import { run as checkCloseout } from "../../../skills/coach/scripts/lib/check-closeout.mjs";
import { run as renderResume } from "../../../skills/apply/scripts/lib/render-resume.mjs";
import { join } from "../../../skills/profile/scripts/lib/path-util.mjs";

// Each ported script's own position inside the skills/ bundle
// (docs/design-web-agent.md § 5's port table) — the ONE fact this file
// needs to know to reconstruct "where does this script's __file__ live"
// for check_files.mjs's --skills default (fix round 2, item 1, carried
// forward from the retired Python-named table). Not used for ROUTING
// (that's file-name-only, per S12) — only for this one script's
// default-value computation. Keyed by the `.mjs` file name (post-switch).
export const CANONICAL_SKILL_PATH = {
  "check_materials.mjs": "apply/scripts/check_materials.mjs",
  "proposal_block.mjs": "apply/scripts/proposal_block.mjs",
  "render_resume.mjs": "apply/scripts/render_resume.mjs",
  "record_verdict.mjs": "evaluate/scripts/record_verdict.mjs",
  "update_job.mjs": "search/scripts/update_job.mjs",
  "check_closeout.mjs": "coach/scripts/check_closeout.mjs",
  "check_files.mjs": "profile/scripts/check_files.mjs",
};

// name -> (argv, io, now, resolveInvokedScriptPath) => Promise<{stdout, stderr, exitCode}>
export const REGISTRY = {
  "check_materials.mjs": (argv, io) => checkMaterials(argv, io),
  "check_files.mjs": (argv, io, now, resolveInvokedScriptPath) => checkFiles(argv, io, resolveInvokedScriptPath),
  "proposal_block.mjs": (argv, io) => proposalBlock(argv, io),
  "record_verdict.mjs": (argv, io, now) => recordVerdict(argv, io, now),
  "update_job.mjs": (argv, io, now) => updateJob(argv, io, now),
  "check_closeout.mjs": (argv, io, now) => checkCloseout(argv, io, now),
  "render_resume.mjs": (argv, io) => renderResume(argv, io),
};

export function basenameOf(p) {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

// argv[0] values that never name a script, per docs/design-js-only.md
// § 3.5: "An unknown script, -e, -p, --eval, or no argument exits 127
// with not available in the web app: <name>."
const NODE_FLAGS = new Set(["-e", "-p", "--eval"]);

/**
 * Dispatches a `node <argv[0]> <argv.slice(1)>` command line to the JS
 * port matching argv[0]'s file name. Any script this repo hasn't ported
 * (e.g. `check_messages.mjs`, not yet in MVP_SKILLS), a bare `-e`/`-p`/
 * `--eval`, or no argument at all exits 127 with a clear message — the
 * same shape a missing command would.
 *
 * docs/design-web-agent.md § 4: the skills bundle is mounted read-only at
 * `<workspace>/skills` of the sandboxed workspace — where `<workspace>`
 * is THIS SCRIPT'S OWN `--workspace` argument (not the shell's cwd at
 * large: fix round 3, item 1 — the shell can `cd` below the workspace
 * root before invoking `node`, e.g. `cd applications && node
 * .../check_files.mjs --workspace ..`, and the equivalent of Python's old
 * `__file__` resolution is independent of that; deriving from cwd
 * directly broke the moment cwd wasn't the workspace root).
 * check_files.mjs's port is the only handler that reads this: it's given
 * a resolver function, `(workspace) => join(workspace, "skills",
 * CANONICAL_SKILL_PATH[name])` — called AFTER the script has parsed its
 * OWN `--workspace` value — to reconstruct "where this script's `__file__`
 * would be", fed to check_files.mjs's port for its --skills default, and
 * deliberately IGNORING argv[0]'s own (often fictional — see the S12
 * file-name-only routing above) path. If a script has no
 * CANONICAL_SKILL_PATH entry, the resolver is omitted and the handler
 * falls back to its own caller-appropriate default (see
 * skills/profile/scripts/check_files.mjs for the Node CLI's).
 */
export async function dispatchNode(argv, io, now) {
  const scriptArg = argv[0];
  if (!scriptArg) {
    return { stdout: "", stderr: "not available in the web app: (no script given)\n", exitCode: 127 };
  }
  if (NODE_FLAGS.has(scriptArg)) {
    return { stdout: "", stderr: `not available in the web app: ${scriptArg}\n`, exitCode: 127 };
  }
  const name = basenameOf(scriptArg);
  const handler = REGISTRY[name];
  if (!handler) {
    return { stdout: "", stderr: `not available in the web app: ${name}\n`, exitCode: 127 };
  }
  const resolveInvokedScriptPath = CANONICAL_SKILL_PATH[name]
    ? (workspace) => join(workspace, "skills", CANONICAL_SKILL_PATH[name])
    : undefined;
  return handler(argv.slice(1), io, now, resolveInvokedScriptPath);
}

/**
 * `python3` stays a command only to point the way (docs/design-js-only.md
 * § 3.5): `python3 <name>.py …`, when `<name>.mjs` is in the dispatch
 * table, exits 127 with a message naming the exact `node …mjs` command to
 * run instead; anything else after `python3` (an unported script, `-c`,
 * or no argument) gets the plain unknown-script message.
 */
export async function dispatchPython3(argv) {
  const scriptArg = argv[0];
  if (!scriptArg) {
    return { stdout: "", stderr: "not available in the web app: (no script given)\n", exitCode: 127 };
  }
  const name = basenameOf(scriptArg);
  const mjsName = name.endsWith(".py") ? name.slice(0, -3) + ".mjs" : null;
  if (mjsName && REGISTRY[mjsName]) {
    const nodePath = scriptArg.slice(0, -3) + ".mjs"; // "the same path, ending .mjs"
    return {
      stdout: "",
      stderr: `python3 is not available here. Run the same check with node: node ${nodePath}\n`,
      exitCode: 127,
    };
  }
  return { stdout: "", stderr: `not available in the web app: ${name}\n`, exitCode: 127 };
}
