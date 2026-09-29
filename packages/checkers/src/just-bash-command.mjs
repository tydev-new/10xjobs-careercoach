// Registers custom just-bash "node" and "python3" commands that dispatch
// to the JS checker ports (src/dispatch.mjs) — "node" by the target
// script's FILE NAME, so skill prose that runs `node scripts/check_materials.mjs
// ...` (or any other relative prefix) reaches the same port unchanged;
// "python3" only points the way to the equivalent `node` command
// (docs/design-js-only.md § 3.5) — the mechanism spikes/2-just-bash/
// proved for check_closeout.py, generalized to file-name matching
// (closes the independent review's S12 flag; see
// docs/spikes/spike-2-just-bash-commands.md's addendum).
import { defineCommand } from "just-bash";
import { dispatchNode, dispatchPython3 } from "./dispatch.mjs";
import { universalNewlines } from "../../../skills/profile/scripts/lib/py-text.mjs";
import { dirname } from "../../../skills/profile/scripts/lib/path-util.mjs";

// Same as lib/io-node.mjs's utf8Strict: the retired Python's
// open(..., encoding="utf-8") raised UnicodeDecodeError on invalid
// UTF-8; ctx.fs.readFile's own decoding may not, so bytes are decoded
// here instead (a standard Web API, not Node-only) to get the same
// failure shape (the corpus's `cm-latin1-bytes` case).
const utf8Strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// Adapts just-bash's IFileSystem (ctx.fs, ctx.cwd) to the checkers' `io`
// interface. Paths are resolved against cwd exactly like a local run
// resolves them against the process's real cwd.
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

export const nodeCommand = defineCommand("node", async (argv, ctx) => {
  const io = makeIo(ctx);
  // The real clock — never CHECKER_NOW_ISO (that override is a Node-CLI-
  // only, expected-output-case-only escape hatch; see
  // skills/evaluate/scripts/record_verdict.mjs).
  const now = () => new Date();
  // dispatchNode reconstructs check_files.mjs's --skills default itself,
  // from the script's OWN (already-parsed) --workspace argument — see
  // dispatch.mjs's doc comment. This command doesn't need to pass ctx.cwd
  // for that: relative paths built from --workspace are resolved against
  // ctx.cwd anyway, by `io` (via ctx.fs.resolvePath(ctx.cwd, ...) above),
  // the same as every other relative path this command handles.
  return dispatchNode(argv, io, now);
});

export const python3Command = defineCommand("python3", async (argv) => dispatchPython3(argv));
