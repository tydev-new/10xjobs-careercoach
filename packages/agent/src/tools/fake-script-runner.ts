// The ScriptRunner seam (§ 4/§ 5) that the `bash` tool calls. This is the
// FAKE implementation: packages/checkers (a parallel worktree) is porting
// the real checkers to JS; until that lands, tests and the headless
// runner's default config use this canned-output runner so this package
// does not block on that port. A real ScriptRunner backed by just-bash +
// the ported checkers can be dropped in later with no change to the
// `bash` tool or Deps shape.
//
// Dispatch matches spike 2's proven mechanism (docs/spikes/spike-2-just-
// bash-commands.md): the FIRST argv token after "python3" is matched by
// file name (basename), so "scripts/x.py", "../apply/scripts/x.py", and
// "skills/apply/scripts/x.py" all reach the same canned script, exactly
// as § 5's dispatch rule specifies. Unrecognized commands exit 127 with
// "not available in the web app: <name>", per § 5.
import { tokenizeCommand } from "../shell-tokenize.ts";
import type { RunResult, ScriptRunner } from "../types.ts";

export interface CannedScript {
  /** matched against the basename of argv[1] when argv[0] === "python3" */
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
      if (bin !== "python3" || !scriptPath) {
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
