// The ScriptRunner seam (§ 4/§ 5) that the `bash` tool calls. This is the
// FAKE implementation: packages/checkers (a parallel worktree) is porting
// the real checkers to JS; until that lands, tests and the headless
// runner's default config use this canned-output runner so this package
// does not block on that port. A real ScriptRunner backed by just-bash +
// the ported checkers can be dropped in later with no change to the
// `bash` tool or Deps shape.
//
// Dispatch matches spike 2's proven mechanism (docs/spikes/spike-2-just-
// bash-commands.md; docs/design-js-only.md § 3.5, J2 — "node" is the real
// dispatcher now, "python3" only points at it): the FIRST argv token
// after "node" is matched by file name, so "scripts/x.mjs",
// "../apply/scripts/x.mjs", and "skills/apply/scripts/x.mjs" all reach
// the same canned script. "python3 <name>.py" is never dispatched — it
// behaves like the production dispatch's pointer
// (packages/checkers/src/dispatch.mjs's dispatchPython3): if a canned
// script named "<name>.mjs" exists, it exits 127 naming the "node
// <name>.mjs" command to run instead; otherwise the plain unrecognized-
// command message. Unrecognized commands exit 127 with "not available
// in the web app: <name>", per § 5.
import { tokenizeCommand } from "../shell-tokenize.ts";
import type { RunResult, ScriptRunner } from "../types.ts";

export interface CannedScript {
  /** matched against the basename of argv[1] when argv[0] is "node" */
  name: string;
  run(
    argv: string[],
    files: Readonly<Record<string, string>>,
  ): { result: Omit<RunResult, "changed">; changedFiles?: Record<string, string> };
}

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

export function createFakeScriptRunner(scripts: CannedScript[]): ScriptRunner {
  const byName = new Map(scripts.map((s) => [s.name, s]));
  return {
    async run(command, files) {
      // L8 (fix round 2): the shared tokenizer, not a hand-rolled regex
      // — single-quoted, double-quoted, and mixed-quoted argv values all
      // split the way just-bash/a real shell would.
      const argv = tokenizeCommand(command);
      const [bin, scriptPath] = argv;
      if (bin === "python3" && scriptPath) {
        // The pointer-only path (never a real runner): point at the
        // equivalent "node …mjs" command when one exists, otherwise fall
        // through to the plain unrecognized-command message below.
        const name = basename(scriptPath);
        const mjsName = name.endsWith(".py") ? name.slice(0, -3) + ".mjs" : null;
        if (mjsName && byName.has(mjsName)) {
          const nodePath = scriptPath.endsWith(".py") ? scriptPath.slice(0, -3) + ".mjs" : scriptPath;
          return {
            result: {
              stdout: "",
              stderr: `python3 is not available here. Run the same check with node: node ${nodePath}\n`,
              exitCode: 127,
              changed: [],
            },
            changedFiles: {},
          };
        }
        return {
          result: { stdout: "", stderr: `not available in the web app: ${name}\n`, exitCode: 127, changed: [] },
          changedFiles: {},
        };
      }
      if (bin !== "node" || !scriptPath) {
        return {
          result: { stdout: "", stderr: `not available in the web app: ${command}\n`, exitCode: 127, changed: [] },
          changedFiles: {},
        };
      }
      const script = byName.get(basename(scriptPath));
      if (!script) {
        return {
          result: {
            stdout: "",
            stderr: `not available in the web app: ${basename(scriptPath)}\n`,
            exitCode: 127,
            changed: [],
          },
          changedFiles: {},
        };
      }
      const { result, changedFiles = {} } = script.run(argv.slice(2), files);
      return {
        result: { ...result, changed: Object.keys(changedFiles) },
        changedFiles,
      };
    },
  };
}
