// Registers a custom just-bash command so that running exactly
//   python3 skills/coach/scripts/check_closeout.py <args>
// inside the sandbox dispatches to the JS port instead of a real Python
// interpreter (there is none in the browser). Any other python3 target
// falls through with exit 127, same as an unimplemented command would.
import { defineCommand } from "just-bash";
import { checkCloseout } from "./check-closeout.mjs";

export const PORTED_SCRIPT_PATH = "skills/coach/scripts/check_closeout.py";

function parseArgs(argv) {
  const args = { workspace: null, stage: null, asked: [], minutes: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace") args.workspace = argv[++i];
    else if (a === "--stage") args.stage = argv[++i];
    else if (a === "--asked") args.asked.push(argv[++i]);
    else if (a === "--minutes") args.minutes = parseInt(argv[++i], 10);
    else return { error: `unrecognized argument: ${a}` };
  }
  if (!args.workspace) return { error: "--workspace is required" };
  return { args };
}

// Adapts just-bash's IFileSystem (ctx.fs, ctx.cwd) to the checkCloseout
// `io` interface. Paths are resolved against cwd exactly like the Python
// script resolves them against the process's real cwd.
function makeIo(ctx) {
  const resolve = (p) => ctx.fs.resolvePath(ctx.cwd, p);
  return {
    async exists(path) {
      return ctx.fs.exists(resolve(path));
    },
    async readFile(path) {
      return ctx.fs.readFile(resolve(path));
    },
    async mtimeMs(path) {
      const st = await ctx.fs.stat(resolve(path));
      return st.mtime.getTime();
    },
  };
}

export const python3Command = defineCommand("python3", async (argv, ctx) => {
  const scriptArg = argv[0];
  if (scriptArg !== PORTED_SCRIPT_PATH) {
    return {
      stdout: "",
      stderr: `python3: ${scriptArg ?? "(no script given)"}: no interpreter available in this spike — only ${PORTED_SCRIPT_PATH} is ported\n`,
      exitCode: 127,
    };
  }
  const { args, error } = parseArgs(argv.slice(1));
  if (error) {
    return { stdout: "", stderr: `error: ${error}\n`, exitCode: 2 };
  }
  const io = makeIo(ctx);
  const { stdout, exitCode } = await checkCloseout(args, io);
  return { stdout, stderr: "", exitCode };
});
