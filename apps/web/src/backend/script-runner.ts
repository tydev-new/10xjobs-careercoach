// The real ScriptRunner (docs/design-web-agent.md § 4/§ 5): just-bash over
// an in-memory copy of the workspace, running packages/checkers' ported
// checker scripts through its file-name `python3` dispatch
// (packages/checkers/src/just-bash-command.mjs) so skill prose
// (`python3 scripts/check_materials.py ...`) is unchanged.
//
// packages/agent's `bash` tool (src/tools/index.ts) calls
// `deps.scripts.run(command, snapshot)` with a snapshot of every workspace
// file PLUS the read-only skill bundle already prefixed `skills/...` — so
// this runner's only job is to mount that snapshot as-is (no extra
// "skills/" prefixing of its own) and hand back whatever changed.
//
// Browser-safe: just-bash (per packages/checkers/README.md) has no
// Node-only/browser-only imports; this file itself touches no
// window/document/localStorage/node:*.
import { Bash } from "just-bash";
// @ts-expect-error - plain .mjs, no type declarations (same posture as
// packages/checkers/test/browser/browser-main.ts's own import of it).
import { python3Command } from "../../../../packages/checkers/src/just-bash-command.mjs";
import type { RunResult, ScriptRunner } from "../../../../packages/agent/src/types.ts";

// An arbitrary absolute root for just-bash's in-memory filesystem — never
// exposed to the model (§ 4's `snapshot` keys, and the tool's own
// write-back, all use workspace-RELATIVE paths; this prefix exists only
// because just-bash's Bash requires absolute file keys).
const ROOT = "/workspace";

function toAbs(relPath: string): string {
  return `${ROOT}/${relPath}`;
}

function fromAbs(absPath: string): string | null {
  const prefix = `${ROOT}/`;
  return absPath.startsWith(prefix) ? absPath.slice(prefix.length) : null;
}

export function createRealScriptRunner(): ScriptRunner {
  return {
    async run(command: string, files: Readonly<Record<string, string>>) {
      const initialFiles: Record<string, string> = {};
      for (const [path, content] of Object.entries(files)) {
        initialFiles[toAbs(path)] = content;
      }
      const bash = new Bash({
        customCommands: [python3Command],
        files: initialFiles,
        cwd: ROOT,
      });

      const exec = await bash.exec(command);

      // Diff every path the sandbox now has against what it started with —
      // this is how a script's own write-back (e.g. record_verdict.py
      // rewriting jobs.md) is discovered; § 4: "Each changed file goes
      // back through WorkspaceStore.write with its tracked version." A
      // script never legitimately touches `skills/...` (the bundle is
      // mounted read-only, and no ported checker writes there), so those
      // paths are NOT special-cased here: if one somehow did change, it's
      // included like any other changed path and the `bash` tool's own
      // write-back through WorkspaceStore then refuses it (`not_editable`,
      // § 2/§ 4's "fails the command with exit 1 and names the file") —
      // one refusal path, not a second silent one in this runner.
      const changedFiles: Record<string, string> = {};
      for (const absPath of bash.fs.getAllPaths()) {
        const relPath = fromAbs(absPath);
        if (relPath === null) continue; // outside the mounted workspace (shouldn't happen)
        let after: string;
        try {
          after = await bash.fs.readFile(absPath);
        } catch {
          continue; // a directory entry, or unreadable — not a text file change
        }
        if (files[relPath] !== after) changedFiles[relPath] = after;
      }

      const result: RunResult = {
        stdout: exec.stdout,
        stderr: exec.stderr,
        exitCode: exec.exitCode,
        changed: Object.keys(changedFiles),
      };
      return { result, changedFiles };
    },
  };
}
