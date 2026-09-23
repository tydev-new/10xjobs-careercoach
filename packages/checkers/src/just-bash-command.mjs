// Registers a custom just-bash "python3" command that dispatches to the JS
// checker ports (src/dispatch.mjs) by the target script's FILE NAME, so
// skill prose that runs `python3 scripts/check_materials.py ...` (or any
// other relative prefix) reaches the same port unchanged — the mechanism
// spikes/2-just-bash/ proved for check_closeout.py, generalized to file-name
// matching (closes the independent review's S12 flag; see
// docs/spikes/spike-2-just-bash-commands.md's addendum).
import { defineCommand } from "just-bash";
import { dispatchPython3 } from "./dispatch.mjs";
import { universalNewlines } from "./py-text.mjs";
import { dirname } from "./path-util.mjs";

// Same as io-node.mjs's utf8Strict: Python's open(..., encoding="utf-8")
// raises UnicodeDecodeError on invalid UTF-8; ctx.fs.readFile's own
// decoding may not, so bytes are decoded here instead (a standard Web
// API, not Node-only) to get the same failure shape (the corpus's
// `cm-latin1-bytes` case).
const utf8Strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

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
      const bytes = await ctx.fs.readFileBuffer(resolve(path));
      const text = utf8Strict.decode(bytes);
      return universalNewlines(text);
    },
    async writeFile(path, content) {
      const full = resolve(path);
      try {
        await ctx.fs.mkdir(dirname(full), { recursive: true });
      } catch {
        // already exists, or dirname(full) is "/" — either way, proceed.
      }
      await ctx.fs.writeFile(full, content);
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
