#!/usr/bin/env node
// Tester check (docs/design-js-only.md § 6 J2, *Tester checks*, first
// bullet): "a command run from another folder (`cd applications && node
// ../../…`) behaves as the case says".
//
// run-cases.mjs's node path always spawns the script by its ABSOLUTE path,
// so it never shows what a model's relative command does. This replays
// every node-path case of a ported command with the script reached by a
// RELATIVE path from the step's own working folder (the folder the case
// says: the workspace root, or `applications/` for the subfolder case),
// and compares stdout, exit code, stderr and every changed file exactly as
// run-cases.mjs does. A second pass runs each case from a folder OUTSIDE
// the workspace (only cases whose path arguments are all absolute), so the script can only
// find its own libraries and --skills root from its own location.
//
// Not covered here, by design: the library cases (jobs_md, reached only
// through a driver), the three J3 scripts (still Python), and the
// render_resume --pdf cases (they need run-cases.mjs's stub-Chrome PATH;
// the stub cases stay in run-cases.mjs).
//
//   node tests/checkers/relative-invocation.mjs [--node=/path/to/node]
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import {
  loadCases, PORTED, SCRIPT_LOCATION, UNPORTED, LIBRARY, base, tokenize, detokenize, maskTmp,
  freshWs, writeTreeToDisk, snapDisk, stateFromTree, applyTree, compareStates, cleanup, scratch,
} from "./run-cases.mjs";

const argv = process.argv.slice(2);
const nodeOpt = argv.find((a) => a.startsWith("--node="));
const NODE = nodeOpt ? nodeOpt.slice("--node=".length) : process.execPath;

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    const out = [], err = [];
    p.stdout.on("data", (b) => out.push(b));
    p.stderr.on("data", (b) => err.push(b));
    p.on("error", (e) => resolve({ stdout: "", stderr: `SPAWN ERROR ${e.message}\n`, exit: -1 }));
    p.on("close", (code) => resolve({
      stdout: Buffer.concat(out).toString("utf-8"),
      stderr: Buffer.concat(err).toString("utf-8"),
      exit: code,
    }));
  });
}

// Flags whose value is a path. The "outside" pass runs only cases whose
// every path value is already absolute (`<ws>/…`, `<skills>`, `<repo>`):
// making a relative value absolute would change the text an error prints,
// so such a case (or one using the `--flag=value` form) is replayed in
// the "relative" pass only.
const PATH_FLAGS = new Set(["--workspace", "--work", "--resume", "--res", "--letter", "--base", "--skills",
  "--application", "--app", "--analysis-file", "--jd-file", "--md", "--html", "--pdf", "--contacts"]);
function allPathsAbsolute(c) {
  return c.steps.every((s) => (s.cwd || ".") === "." && !s.argv.some((a) => /^--[\w-]+=/.test(a)) && s.argv.every((a, k) =>
    !(k > 0 && PATH_FLAGS.has(s.argv[k - 1])) || /^<(ws|skills|repo)>/.test(a)));
}

async function replay(c, mode) {
  const ws = freshWs();
  writeTreeToDisk(ws, c.before);
  const exp = stateFromTree(c.before);
  const diffs = [];
  for (let i = 0; i < c.steps.length; i++) {
    const step = c.steps[i];
    if (i > 0 && step.write) { writeTreeToDisk(ws, step.write); applyTree(exp, step.write); }
    const stepDir = join(ws, step.cwd || ".");
    const file = SCRIPT_LOCATION[PORTED[base(step.script)]];
    let cwd, args;
    const detok = step.argv.map((a) => detokenize(a, ws));
    if (mode === "relative") {
      cwd = stepDir;
      args = detok;
    } else {
      cwd = join(scratch(), `outside-${process.pid}`);
      mkdirSync(cwd, { recursive: true });
      args = detok;
    }
    const rel = relative(cwd, file);
    const env = { ...process.env, CHECKER_NOW_ISO: step.clock || "" };
    delete env.RENDER_RESUME_CHROME;
    const r = await run(NODE, [rel, ...args], { cwd, env });
    let stdout = tokenize(r.stdout, ws);
    if (base(step.script) === "render_resume.py") stdout = maskTmp(stdout);
    const stderr = tokenize(r.stderr, ws);
    const want = c.expect[i];
    const tag = c.steps.length > 1 ? `step ${i + 1}: ` : "";
    if (stdout !== want.stdout) diffs.push(`${tag}stdout\n      got:  ${JSON.stringify(stdout).slice(0, 300)}\n      want: ${JSON.stringify(want.stdout).slice(0, 300)}`);
    if (r.exit !== want.exit) diffs.push(`${tag}exit ${r.exit} (want ${want.exit})`);
    const fl = (s) => (s || "").split("\n")[0];
    if (want.stderrMatch === "first-line" ? fl(stderr) !== fl(want.stderr) : stderr !== want.stderr) {
      diffs.push(`${tag}stderr ${JSON.stringify(stderr).slice(0, 200)}`);
    }
    applyTree(exp, c.steps.length > 1 ? want.after : c.after);
    const d = compareStates(exp, snapDisk(ws));
    if (d.length) diffs.push(`${tag}${d.join(", ")}`);
  }
  rmSync(ws, { recursive: true, force: true });
  return diffs;
}

const cases = loadCases().filter((c) => c.steps.every((s) => {
  const n = base(s.script);
  return n !== LIBRARY && !UNPORTED.has(n) && PORTED[n] && !s.chrome;
}));
let fails = 0;
const counts = { relative: 0, outside: 0 };
const subfolder = [];
for (const mode of ["relative", "outside"]) {
  for (const c of cases) {
    if (mode === "outside" && !allPathsAbsolute(c)) continue;
    const diffs = await replay(c, mode);
    counts[mode]++;
    if (c.steps.some((s) => (s.cwd || ".") !== ".")) subfolder.push(`${mode}:${c.id}:${diffs.length ? "FAIL" : "ok"}`);
    if (diffs.length) {
      fails++;
      console.log(`[FAIL ${mode}] ${c.id}\n    ${diffs.join("\n    ")}`);
    }
  }
}
cleanup();
for (const s of subfolder) console.log(`subfolder case ${s}`);
console.log(`relative-invocation: ${counts.relative} cases by a relative path from the case's own folder; ${counts.outside} from a folder outside the workspace; ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
