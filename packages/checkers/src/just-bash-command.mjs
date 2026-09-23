// Registers a custom just-bash "python3" command that dispatches to the JS
// checker ports (src/dispatch.mjs) by the target script's FILE NAME, so
// skill prose that runs `python3 scripts/check_materials.py ...` (or any
// other relative prefix) reaches the same port unchanged — the mechanism
// spikes/2-just-bash/ proved for check_closeout.py, generalized to file-name
// matching (closes the independent review's S12 flag; see
// docs/spikes/spike-2-just-bash-commands.md's addendum).
import { defineCommand } from "just-bash";
import { dispatchPython3 } from "./dispatch.mjs";

// Adapts just-bash's IFileSystem (ctx.fs, ctx.cwd) to the checkers' `io`
// interface. Paths are resolved against cwd exactly like the Python
// scripts resolve them against the process's real cwd.
function makeIo(ctx) {
  const resolve = (p) => ctx.fs.resolvePath(ctx.cwd, p);
  return {
    async exists(path) {
      return ctx.fs.exists(resolve(path));
    },
    async readFile(path) {
      return ctx.fs.readFile(resolve(path));
    },
    async writeFile(path, content) {
      await ctx.fs.writeFile(resolve(path), content);
    },
    async mtimeMs(path) {
      const st = await ctx.fs.stat(resolve(path));
      return st.mtime.getTime();
    },
    async isDir(path) {
      try {
        const st = await ctx.fs.stat(resolve(path));
        return st.isDirectory;
      } catch {
        return false;
      }
    },
    async readdir(path) {
      try {
        return await ctx.fs.readdir(resolve(path));
      } catch {
        return [];
      }
    },
  };
}

export const python3Command = defineCommand("python3", async (argv, ctx) => {
  const io = makeIo(ctx);
  // The real clock — never CHECKER_NOW_ISO (that override is a Node-only,
  // parity-harness-only escape hatch; see bin/record_verdict.mjs).
  const now = () => new Date();
  return dispatchPython3(argv, io, now);
});
