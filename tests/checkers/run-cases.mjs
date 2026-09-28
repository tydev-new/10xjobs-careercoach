#!/usr/bin/env node
// Expected-output cases: the specification every shipped script is held to
// (docs/design-js-only.md § 5). Each case under cases/<script>/<id>.json is
// one recorded Python 3.14 run (see FROZEN_AT); this file replays it and
// compares stdout exactly, the exit code, stderr (exactly, or only the first
// line where the case says `first-line`, the crash cases), and every file in
// the workspace afterwards, byte for byte.
//
// Paths (§ 5.3):
//   node    the JavaScript port, run with `node` (packages/checkers/bin/ until
//           J2 moves the ports under skills/). The three scripts with no port
//           yet (check_knowledge, check_messages, check_stories) run through
//           `python3` on this path until J3 ports them.
//   web     the web's dispatch: just-bash + python3Command over an InMemoryFs.
//           Its clock is not frozen, so a writer's files compare with
//           timestamps masked. Needs just-bash, so Node 20.18.1 or newer.
//   python  every step through python3 (the determinism check: the record
//           must reproduce byte for byte, § 5.4). Not in the default set.
//
//   node tests/checkers/run-cases.mjs                     # node + web
//   node tests/checkers/run-cases.mjs --paths=node        # e.g. on Node 18
//   node tests/checkers/run-cases.mjs --paths=python      # re-run the Python
//   node tests/checkers/run-cases.mjs --self-test         # § 5.4 tester checks
//   node tests/checkers/run-cases.mjs <filter> --verbose  # ids containing <filter>
//
// Tokens: the workspace path is written `<ws>` in argv, stdout and stderr;
// the repo's skills/ folder `<skills>`, the repo root `<repo>`. render_resume
// with no --html writes to a random temp folder; that folder is written
// `<tmp>` (its file name is kept, so a renamed file still fails).
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync,
  utimesSync, realpathSync, existsSync, chmodSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cpus, tmpdir } from "node:os";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = realpathSync(join(HERE, "..", ".."));
export const SKILLS = join(ROOT, "skills");
export const PKG = join(ROOT, "packages", "checkers");
export const CASES_DIR = join(HERE, "cases");

// The eleven shipped scripts (§ 5.2): seven commands with ports, the job
// list library (jobs_md, reached as a library, ported as jobs-md.mjs), and
// three checkers with no port until J3.
export const PORTED = {
  "check_materials.py": "check_materials.mjs",
  "proposal_block.py": "proposal_block.mjs",
  "render_resume.py": "render_resume.mjs",
  "record_verdict.py": "record_verdict.mjs",
  "update_job.py": "update_job.mjs",
  "check_files.py": "check_files.mjs",
  "check_closeout.py": "check_closeout.mjs",
};
// Where each port's Node CLI actually lives after J2 moved
// packages/checkers/bin/*.mjs under skills/ (docs/design-js-only.md § 2,
// § 6 J2). Keyed by the `.mjs` name (PORTED's values).
export const SCRIPT_LOCATION = {
  "check_materials.mjs": join(SKILLS, "apply", "scripts", "check_materials.mjs"),
  "proposal_block.mjs": join(SKILLS, "apply", "scripts", "proposal_block.mjs"),
  "render_resume.mjs": join(SKILLS, "apply", "scripts", "render_resume.mjs"),
  "record_verdict.mjs": join(SKILLS, "evaluate", "scripts", "record_verdict.mjs"),
  "update_job.mjs": join(SKILLS, "search", "scripts", "update_job.mjs"),
  "check_files.mjs": join(SKILLS, "profile", "scripts", "check_files.mjs"),
  "check_closeout.mjs": join(SKILLS, "coach", "scripts", "check_closeout.mjs"),
};
export const UNPORTED = new Set(["check_knowledge.py", "check_messages.py", "check_stories.py"]);
export const LIBRARY = "jobs_md.py";
export const WRITERS = new Set(["record_verdict.py", "update_job.py", "jobs_md.py"]);
export const TRACEBACK = "Traceback (most recent call last):";

// Cases a path cannot pass yet, by design. Each entry names the stage that
// ends it; a case listed here that PASSES fails the run (so the entry is
// removed the moment it is stale). Keep this list short and named.
//
// J2 added the Chrome path to render_resume.mjs (docs/design-js-only.md
// § 6): all six render_resume --pdf cases now clear on the node path, so
// PENDING is empty again.
export const PENDING = {
  node: {},
};
// A path that never runs a case (reported as SKIPPED with the reason, never
// silently): the web has no Chrome and "keeps its PDF: NOT RENDERED line"
// (§ 6 J2), and jobs_md is a library the web reaches only through
// record_verdict and update_job.
function webSkipReason(c) {
  for (const s of c.steps) {
    const name = base(s.script);
    if (s.chrome) return "the web has no Chrome and keeps its PDF: NOT RENDERED line (§ 6 J2)";
    if (name === LIBRARY) return "jobs_md is a library; the web reaches it only through record_verdict/update_job";
    if (UNPORTED.has(name)) return `${name} has no port until J3 (the web exits 127)`;
  }
  return null;
}

export const base = (p) => p.slice(p.lastIndexOf("/") + 1);

// ------------------------------------------------------------ tokens and masks
function variants(ws) {
  const out = new Set([ws]);
  if (ws.startsWith("/private/")) out.add(ws.slice("/private".length));
  return [...out].sort((a, b) => b.length - a.length);
}
export function tokenize(text, ws) {
  if (!text) return text;
  let s = text;
  for (const v of variants(ws)) s = s.split(v).join("<ws>");
  s = s.split(SKILLS).join("<skills>");
  s = s.split(ROOT).join("<repo>");
  return s;
}
export function detokenize(arg, ws) {
  return arg.split("<ws>").join(ws).split("<skills>").join(SKILLS).split("<repo>").join(ROOT);
}
// render_resume with no --html: "words: N  ->  /some/random/dir/resume.html".
// Only an absolute path that is not the workspace is masked, and only its
// folder: the file name stays, so a changed name still fails (§ 5.4).
export function maskTmp(stdout) {
  return stdout.replace(/^(words: \d+ {2}-> {2})(\/[^\n]*)\/([^/\n]*)$/m, "$1<tmp>/$3");
}
export const TS_MASK = (s) =>
  s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00/g, "<TS>").replace(/updated \d{4}-\d{2}-\d{2}/g, "updated <D>");

// ------------------------------------------------------------ workspace state
// state = { files: Map<rel, {buf: Buffer, mtimeAgo?: number}>, dirs: Set<rel> }
// (dirs holds every folder, not only empty ones).
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export function encodeEntry(buf, extra = {}) {
  let text = null;
  try { text = utf8.decode(buf); if (!Buffer.from(text, "utf-8").equals(buf)) text = null; } catch { text = null; }
  const hasExtra = Object.keys(extra).length > 0;
  if (text !== null && !hasExtra) return text;
  return text !== null ? { text, ...extra } : { base64: buf.toString("base64"), ...extra };
}
export function decodeEntry(e) {
  if (typeof e === "string") return { buf: Buffer.from(e, "utf-8") };
  if (e && e.dir) return { dir: true };
  const buf = e.base64 !== undefined ? Buffer.from(e.base64, "base64") : Buffer.from(e.text, "utf-8");
  return e.mtimeAgo ? { buf, mtimeAgo: e.mtimeAgo } : { buf };
}
function parents(rel) {
  const out = [];
  let d = dirname(rel);
  while (d && d !== ".") { out.push(d); d = dirname(d); }
  return out;
}
export function stateFromTree(tree) {
  const st = { files: new Map(), dirs: new Set() };
  applyTree(st, tree || {});
  return st;
}
export function cloneState(st) {
  return { files: new Map(st.files), dirs: new Set(st.dirs) };
}
export function applyTree(st, tree) {
  for (const [k, v] of Object.entries(tree || {})) {
    if (k.endsWith("/")) {
      const d = k.slice(0, -1);
      if (v === null) { for (const x of [...st.dirs]) if (x === d || x.startsWith(d + "/")) st.dirs.delete(x); }
      else { st.dirs.add(d); for (const p of parents(d)) st.dirs.add(p); }
      continue;
    }
    if (v === null) { st.files.delete(k); continue; }
    const e = decodeEntry(v);
    st.files.set(k, e);
    for (const p of parents(k)) st.dirs.add(p);
  }
  return st;
}
// The tree form of a state: every file, plus each folder no file or folder sits in.
export function treeFromState(st) {
  const tree = {};
  for (const d of [...st.dirs].sort()) {
    const occupied = [...st.files.keys()].some((f) => f.startsWith(d + "/")) || [...st.dirs].some((x) => x.startsWith(d + "/"));
    if (!occupied) tree[d + "/"] = { dir: true };
  }
  for (const [k, e] of [...st.files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    tree[k] = encodeEntry(e.buf, e.mtimeAgo ? { mtimeAgo: e.mtimeAgo } : {});
  }
  return tree;
}
// What changed from a to b: new or changed files, null for a deleted file or
// folder, {dir:true} for a new empty folder. Modification times are not compared.
export function diffStates(a, b) {
  const out = {};
  for (const [k, e] of b.files) {
    const old = a.files.get(k);
    if (!old || !old.buf.equals(e.buf)) out[k] = encodeEntry(e.buf);
  }
  for (const k of a.files.keys()) if (!b.files.has(k)) out[k] = null;
  for (const d of b.dirs) {
    if (a.dirs.has(d)) continue;
    const implied = [...b.files.keys()].some((f) => f.startsWith(d + "/")) || [...b.dirs].some((x) => x.startsWith(d + "/"));
    if (!implied) out[d + "/"] = { dir: true };
  }
  for (const d of a.dirs) if (!b.dirs.has(d)) out[d + "/"] = null;
  return Object.fromEntries(Object.entries(out).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
}
// Compare two states; returns a list of differing paths. `mask` compares
// file text with timestamps masked (the web path's writers).
export function compareStates(want, got, { mask = false } = {}) {
  const diffs = [];
  const keys = new Set([...want.files.keys(), ...got.files.keys()]);
  for (const k of [...keys].sort()) {
    const a = want.files.get(k), b = got.files.get(k);
    if (!a) { diffs.push(`file:${k}(unexpected)`); continue; }
    if (!b) { diffs.push(`file:${k}(missing)`); continue; }
    if (a.buf.equals(b.buf)) continue;
    if (mask && TS_MASK(a.buf.toString("utf-8")) === TS_MASK(b.buf.toString("utf-8"))) continue;
    diffs.push(`file:${k}`);
  }
  for (const d of want.dirs) if (!got.dirs.has(d)) diffs.push(`dir:${d}(missing)`);
  for (const d of got.dirs) if (!want.dirs.has(d)) diffs.push(`dir:${d}(unexpected)`);
  return diffs;
}

// ------------------------------------------------------------ disk workspaces
export function snapDisk(ws, now = Date.now()) {
  const st = { files: new Map(), dirs: new Set() };
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const s = statSync(p);
      const rel = relative(ws, p);
      if (s.isDirectory()) { st.dirs.add(rel); walk(p); }
      else {
        const ago = Math.round((now - s.mtimeMs) / 1000);
        st.files.set(rel, ago > 60 ? { buf: readFileSync(p), mtimeAgo: ago } : { buf: readFileSync(p) });
      }
    }
  };
  walk(ws);
  return st;
}
export function writeTreeToDisk(ws, tree, now = Date.now()) {
  for (const [k, v] of Object.entries(tree || {})) {
    const p = join(ws, k);
    if (k.endsWith("/")) {
      if (v === null) rmSync(p, { recursive: true, force: true });
      else mkdirSync(p, { recursive: true });
      continue;
    }
    if (v === null) { rmSync(p, { force: true }); continue; }
    const e = decodeEntry(v);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, e.buf);
  }
  for (const [k, v] of Object.entries(tree || {})) {
    if (k.endsWith("/") || v === null) continue;
    const e = decodeEntry(v);
    if (e.mtimeAgo) { const t = new Date(now - e.mtimeAgo * 1000); utimesSync(join(ws, k), t, t); }
  }
}
let SCRATCH = null;
export function scratch() {
  if (!SCRATCH) SCRATCH = realpathSync(mkdtempSync(join(process.env.TMPDIR || tmpdir(), "j1-cases-")));
  return SCRATCH;
}
export function cleanup() {
  if (SCRATCH) rmSync(SCRATCH, { recursive: true, force: true });
  SCRATCH = null;
}
let wsN = 0;
export function freshWs() {
  const ws = join(scratch(), `ws-${process.pid}-${++wsN}`);
  mkdirSync(ws, { recursive: true });
  return ws;
}

// ------------------------------------------------------------ engines
// Python: the real script, clock frozen by swapping datetime.datetime before
// the script (and jobs_md) import it — the bootstrap tests/checkers-parity/
// extra.mjs uses. /Applications is hidden from os.path.exists so a Chrome
// installed on the recording machine can never stand in for the case's own
// stub (render_resume.find_chrome checks /Applications first).
export const PY_BOOT = `
import sys, runpy, os, datetime as D
f = os.environ.get("FREEZE_ISO")
if f:
    base = D.datetime.fromisoformat(f)
    class FD(D.datetime):
        @classmethod
        def now(cls, tz=None):
            return base if tz is None else base.astimezone(tz)
    D.datetime = FD
_exists = os.path.exists
os.path.exists = lambda p: False if str(p).startswith("/Applications/") else _exists(p)
script = sys.argv[1]
sys.argv = sys.argv[1:]
sys.path[0] = os.path.dirname(os.path.abspath(script))
runpy.run_path(script, run_name="__main__")
`;
// jobs_md is a library: its cases run one operation. argv is
// ["roundtrip", ws] (load() then save(); prints the loaded rows as JSON) or
// ["save", ws, rowsJson, notesJson]. JSON is sorted and compact in both
// languages so the bytes compare.
export const PY_JM = `
import sys, os, json, datetime as D
f = os.environ.get("FREEZE_ISO")
if f:
    base = D.datetime.fromisoformat(f)
    class FD(D.datetime):
        @classmethod
        def now(cls, tz=None):
            return base if tz is None else base.astimezone(tz)
    D.datetime = FD
sys.path.insert(0, os.path.dirname(os.path.abspath(sys.argv[1])))
import jobs_md as jm
op, ws = sys.argv[2], sys.argv[3]
if op == "roundtrip":
    rows = jm.load(ws)
    print(json.dumps([dict(r) for r in rows], ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    jm.save(ws, rows)
elif op == "save":
    notes = json.loads(sys.argv[5])
    jm.save(ws, json.loads(sys.argv[4]), notes=notes)
else:
    sys.exit("unknown op " + op)
`;
const PYTHON = process.env.J1_PYTHON || "python3";
let PYTHON_ABS = null;
function pythonAbs() {
  if (PYTHON_ABS) return PYTHON_ABS;
  const r = spawnSync(PYTHON, ["-c", "import sys; print(sys.executable)"], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`cannot run ${PYTHON}: ${r.stderr || r.error}`);
  PYTHON_ABS = r.stdout.trim();
  return PYTHON_ABS;
}
let NODE_BIN = process.execPath;
export function setNodeBin(p) { NODE_BIN = p; }

// A fixed text-only PDF with two /Type /Page objects (§ 5.2).
const PDF2 = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n" +
  "3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n4 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";
const CHROME_MODES = {
  "stub-2pages": PDF2,
  "stub-big": PDF2 + "%" + "x".repeat(110000) + "\n",
  "stub-nofile": null,
};
// PATH for a --pdf step: a folder holding only a `google-chrome` stub (or
// nothing at all, for "none").
function chromePath(mode) {
  const d = join(scratch(), `chrome-${mode}`);
  if (existsSync(d)) return d;
  mkdirSync(d, { recursive: true });
  if (mode === "none") return d;
  if (!(mode in CHROME_MODES)) throw new Error(`unknown chrome mode ${mode}`);
  const pdf = CHROME_MODES[mode];
  let sh = "#!/bin/sh\nout=\nfor a in \"$@\"; do case \"$a\" in --print-to-pdf=*) out=\"${a#--print-to-pdf=}\";; esac; done\n";
  if (pdf !== null) {
    writeFileSync(join(d, "fixed.pdf"), pdf);
    sh += `/bin/cat '${join(d, "fixed.pdf")}' > "$out"\n`;
  }
  sh += "exit 0\n";
  writeFileSync(join(d, "google-chrome"), sh);
  chmodSync(join(d, "google-chrome"), 0o755);
  return d;
}

function spawnP(cmd, args, opts) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    const out = [], err = [];
    p.stdout.on("data", (b) => out.push(b));
    p.stderr.on("data", (b) => err.push(b));
    p.on("error", (e) => resolve({ stdout: "", stderr: `SPAWN ERROR ${e.message}\n`, exit: -1 }));
    p.on("close", (code, sig) => resolve({
      stdout: Buffer.concat(out).toString("utf-8"),
      stderr: Buffer.concat(err).toString("utf-8"),
      exit: code === null ? `signal ${sig}` : code,
    }));
  });
}

// A case's own Chrome is the stub on its PATH (or none). render_resume.py
// reads RENDER_RESUME_CHROME before PATH (c8d6898, the always-on harness
// points it at its fake), so an ambient value would stand in for the case's
// stub and fail every --pdf case (or, recording, freeze the wrong output).
function caseEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.RENDER_RESUME_CHROME;
  return env;
}
async function runPythonStep(step, ws) {
  const name = base(step.script);
  const argv = step.argv.map((a) => detokenize(a, ws));
  const env = caseEnv({ FREEZE_ISO: step.clock || "", PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" });
  if (step.chrome) env.PATH = chromePath(step.chrome);
  const script = join(SKILLS, step.script);
  const args = name === LIBRARY ? ["-c", PY_JM, script, ...argv] : ["-c", PY_BOOT, script, ...argv];
  return spawnP(pythonAbs(), args, { cwd: join(ws, step.cwd || "."), env });
}
async function runNodeStep(step, ws) {
  const name = base(step.script);
  if (UNPORTED.has(name)) return runPythonStep(step, ws); // until J3 (§ 5.3)
  const argv = step.argv.map((a) => detokenize(a, ws));
  const env = caseEnv({ CHECKER_NOW_ISO: step.clock || "" });
  // A case that controls `chrome` (a PATH-only stub, or "none") must be
  // reproducible on ANY machine, including one with a real Chrome.app
  // installed at its usual macOS path — existsSync() doesn't consult
  // PATH, so render_resume.mjs's own hardcoded-absolute-path fallback
  // would otherwise always find that real browser regardless of what
  // PATH says. RENDER_RESUME_CHROME_PATH_ONLY (render_resume.mjs's own
  // comment) closes exactly that gap; production never sets it.
  if (step.chrome) {
    env.PATH = chromePath(step.chrome);
    env.RENDER_RESUME_CHROME_PATH_ONLY = "1";
  }
  const file = name === LIBRARY ? join(HERE, "jobs-md-driver.mjs") : SCRIPT_LOCATION[PORTED[name]];
  if (!file || (name !== LIBRARY && !PORTED[name])) throw new Error(`no node path for ${name}`);
  return spawnP(NODE_BIN, [file, ...argv], { cwd: join(ws, step.cwd || "."), env });
}

// ------------------------------------------------------------ web (dispatch) engine
let WEB = null;
async function web() {
  if (WEB) return WEB;
  const { Bash, InMemoryFs } = await import(pathToFileURL(join(PKG, "node_modules", "just-bash", "dist", "bundle", "index.js")).href);
  // docs/design-js-only.md § 3.5: "node" is the real dispatcher now;
  // "python3" only points at the equivalent node command. The web path
  // below constructs a `node <script>.mjs ...` command line, so it
  // exercises the real dispatch, not the pointer.
  const { nodeCommand, python3Command } = await import(pathToFileURL(join(PKG, "src", "just-bash-command.mjs")).href);
  const skillFiles = {};
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else skillFiles[p] = readFileSync(p);
    }
  };
  walk(SKILLS);
  WEB = { Bash, InMemoryFs, python3Command, skillFiles };
  return WEB;
}
const WEB_WS = "/home/j1-web-case/workspace";
const q = (a) => `'${a.replace(/'/g, `'\\''`)}'`;
// check_files with no --skills finds the bundle where the web mounts it:
// read-only at <workspace>/skills (design-web-agent.md § 4). A case can also
// ask for that mount outright (`webSkillsInWorkspace`, extra.mjs's
// mount:"design" cases, e.g. an explicit --skills that must beat it).
function mountsInWs(c) {
  if (c.webSkillsInWorkspace) return true;
  return c.steps.some((s) => base(s.script) === "check_files.py" && !s.argv.some((a) => a === "--skills" || a.startsWith("--skills=") || (a.startsWith("--sk") && "--skills".startsWith(a.split("=")[0]))));
}
async function webState(fs, ws, skipSkills) {
  const st = { files: new Map(), dirs: new Set() };
  const walk = async (d) => {
    for (const n of (await fs.readdir(d)).sort()) {
      const p = join(d, n);
      if (skipSkills && p === join(ws, "skills")) continue;
      const s = await fs.stat(p);
      const rel = relative(ws, p);
      if (s.isDirectory) { st.dirs.add(rel); await walk(p); }
      else st.files.set(rel, { buf: Buffer.from(await fs.readFileBuffer(p)) });
    }
  };
  await walk(ws);
  return st;
}
async function webWrite(fs, ws, tree) {
  const now = Date.now();
  for (const [k, v] of Object.entries(tree || {})) {
    const p = join(ws, k);
    if (k.endsWith("/")) {
      if (v === null) await fs.rm(p, { recursive: true, force: true });
      else await fs.mkdir(p, { recursive: true });
      continue;
    }
    if (v === null) { await fs.rm(p, { force: true }); continue; }
    const e = decodeEntry(v);
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, new Uint8Array(e.buf));
    if (e.mtimeAgo) { const t = new Date(now - e.mtimeAgo * 1000); await fs.utimes(p, t, t); }
  }
}

// ------------------------------------------------------------ one case, one path
function stdoutFor(step, raw, ws) {
  let s = tokenize(raw, ws);
  if (base(step.script) === "render_resume.py") s = maskTmp(s);
  return s;
}
function firstLine(s) { return (s || "").split("\n")[0]; }

// Runs a case on `path` ("node" | "python" | "web"). With `record`, returns
// what happened (the recorder's use); otherwise returns a list of diffs.
export async function runCase(c, path, { record = false } = {}) {
  const multi = c.steps.length > 1;
  const diffs = [];
  const got = [];
  let expState = stateFromTree(c.before);
  let fs = null, ws, skip = false;
  if (path === "web") {
    const W = await web();
    ws = WEB_WS;
    skip = mountsInWs(c);
    const files = {};
    for (const [p, b] of Object.entries(W.skillFiles)) files[skip ? join(ws, "skills", relative(SKILLS, p)) : p] = b;
    fs = new W.InMemoryFs(files);
    await fs.mkdir(ws, { recursive: true });
    await webWrite(fs, ws, c.before);
  } else {
    ws = freshWs();
    writeTreeToDisk(ws, c.before);
  }
  const current = async () => (fs ? webState(fs, ws, skip) : snapDisk(ws));
  const before0 = await current();
  if (!record) {
    const d0 = compareStates(expState, before0);
    if (d0.length) diffs.push(`setup:${d0.join(",")}`);
  }
  for (let i = 0; i < c.steps.length; i++) {
    const step = c.steps[i];
    if (i > 0 && step.write) {
      if (fs) await webWrite(fs, ws, step.write); else writeTreeToDisk(ws, step.write);
      applyTree(expState, step.write);
    }
    const pre = await current();
    let r;
    if (path === "web") {
      const W = await web();
      const bash = new W.Bash({ fs, cwd: join(ws, step.cwd || "."), customCommands: [W.nodeCommand, W.python3Command] });
      // Reachable only for a PORTED script (webSkipReason() already SKIPs
      // the library and the three unported scripts) — the case's own
      // step.script is recorded with its Python name (§ 5's spec is
      // frozen data); "node ...mjs" is the real dispatch (§ 3.5).
      const nodeScript = step.script.replace(/\.py$/, ".mjs");
      const cmd = `node ${nodeScript} ${step.argv.map((a) => q(detokenize(a, ws))).join(" ")}`;
      try {
        const x = await bash.exec(cmd);
        r = { stdout: x.stdout, stderr: x.stderr, exit: x.exitCode };
      } catch (e) {
        r = { stdout: "", stderr: `THROWN ${e && e.message}\n`, exit: -1 };
      }
    } else if (path === "python") r = await runPythonStep(step, ws);
    else r = await runNodeStep(step, ws);
    const post = await current();
    const stdout = stdoutFor(step, r.stdout, ws);
    const stderrFull = tokenize(r.stderr, ws);
    if (record) {
      const crash = firstLine(stderrFull) === TRACEBACK;
      const e = { stdout, stderr: crash ? TRACEBACK : stderrFull, stderrMatch: crash ? "first-line" : "exact", exit: r.exit };
      if (multi) e.after = diffStates(pre, post);
      got.push({ expect: e, pre, post });
      continue;
    }
    const want = c.expect[i];
    const tag = multi ? `step ${i + 1}: ` : "";
    if (stdout !== want.stdout) diffs.push(`${tag}stdout`);
    if (r.exit !== want.exit) diffs.push(`${tag}exit ${r.exit} (want ${want.exit})`);
    if (want.stderrMatch === "first-line") {
      if (firstLine(stderrFull) !== firstLine(want.stderr)) diffs.push(`${tag}stderr first line`);
    } else if (stderrFull !== want.stderr) diffs.push(`${tag}stderr`);
    applyTree(expState, multi ? want.after : c.after);
    const d = compareStates(expState, post, { mask: path === "web" && WRITERS.has(base(step.script)) });
    if (d.length) diffs.push(`${tag}${d.join(", ")}`);
    got.push({ stdout, stderr: stderrFull, exit: r.exit });
  }
  if (!fs) rmSync(ws, { recursive: true, force: true });
  if (record) return { steps: got, before: before0 };
  return { diffs, got };
}

// ------------------------------------------------------------ loading
export function loadCases(dir = CASES_DIR) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const group of readdirSync(dir).sort()) {
    const gd = join(dir, group);
    if (!statSync(gd).isDirectory()) continue;
    for (const f of readdirSync(gd).sort()) {
      if (!f.endsWith(".json")) continue;
      const c = JSON.parse(readFileSync(join(gd, f), "utf-8"));
      c.id = `${group}/${f.slice(0, -5)}`;
      c.group = group;
      out.push(c);
    }
  }
  return out;
}
export function scriptsOf(c) {
  return [...new Set(c.steps.map((s) => base(s.script).replace(/\.py$/, "")))];
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return results;
}

// ------------------------------------------------------------ self-test (§ 5.4 tester checks)
async function selfTest(cases) {
  const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
  const clone = (c) => JSON.parse(JSON.stringify(c));
  const checks = [];
  const must = async (label, c, path) => {
    const { diffs } = await runCase(c, path);
    checks.push({ label, ok: diffs.length > 0, diffs });
  };
  const mustPass = async (label, c, path) => {
    const { diffs } = await runCase(c, path);
    checks.push({ label, ok: diffs.length === 0, diffs });
  };
  const anyWithFile = cases.find((c) => c.steps.length === 1 && base(c.steps[0].script) === "check_materials.py" && Object.keys(c.before).some((k) => !k.endsWith("/")));
  const writer = cases.find((c) => c.steps.length === 1 && base(c.steps[0].script) === "record_verdict.py" && c.after && c.after["jobs.md"]);
  const tmpCase = byId["render_resume/j1-pdf-stub-2pages-html-tmp"];
  const noHtml = cases.find((c) => base(c.steps[0].script) === "render_resume.py" && !c.steps[0].chrome && /<tmp>\//.test(c.expect[0].stdout));
  const pdf = byId["render_resume/j1-pdf-stub-2pages-html-in-ws"];
  for (const [n, c] of Object.entries({ anyWithFile, writer, tmpCase, noHtml, pdf })) if (!c) throw new Error(`self-test: no ${n} case`);

  await mustPass("control: an untouched case passes (node)", anyWithFile, "node");
  let m = clone(anyWithFile); m.expect[0].stdout += "x"; await must("a planted wrong expected stdout fails (node)", m, "node");
  m = clone(anyWithFile); m.expect[0].exit = m.expect[0].exit === 0 ? 1 : 0; await must("a planted wrong exit code fails (node)", m, "node");
  m = clone(anyWithFile); m.expect[0].stdout += "x"; await must("a planted wrong expected stdout fails (web)", m, "web");
  m = clone(anyWithFile);
  { const k = Object.keys(m.before).find((x) => !x.endsWith("/")); const e = m.before[k];
    m.before[k] = typeof e === "string" ? e + "\nedited\n" : { ...e, text: (e.text || "") + "\nedited\n" }; }
  await must("a case whose before file is edited fails (node)", m, "node");
  m = clone(writer); m.after["jobs.md"] = m.after["jobs.md"].replace("strong", "weak").replace("Staff", "Stuff") + "x";
  await must("a planted wrong after file fails (node)", m, "node");
  await must("a planted wrong after file fails (web, timestamps masked)", m, "web");
  m = clone(noHtml); m.expect[0].stdout = m.expect[0].stdout.replace("<tmp>/resume.html", "<tmp>/resume.htm");
  await must("the masked temp path still catches a changed file name (node)", m, "node");
  m = clone(tmpCase); m.expect[0].stdout = m.expect[0].stdout.replace("<tmp>/resume.html", "<tmp>/cv.html");
  await must("the masked temp path still catches a changed file name (python, stub Chrome)", m, "python");
  await mustPass("control: the stub Chrome case passes (python)", pdf, "python");
  m = clone(pdf); m.expect[0].stdout = m.expect[0].stdout.replace("pages: 2", "pages: 3");
  if (m.expect[0].stdout === pdf.expect[0].stdout) throw new Error("self-test: stub case has no 'pages: 2' line");
  await must("the stub Chrome case fails if the page line changes (python)", m, "python");
  let bad = 0;
  for (const x of checks) {
    console.log(`[${x.ok ? "ok" : "NOT OK"}] ${x.label}${x.ok ? "" : `  diffs=${JSON.stringify(x.diffs)}`}`);
    if (!x.ok) bad++;
  }
  console.log(`\nself-test: ${checks.length - bad}/${checks.length}`);
  return bad;
}

// ------------------------------------------------------------ coverage (§ 5.2)
// Every `def test_` in the unported scripts' Python test files (and their
// steps in test_three_lens_review / test_e2e_lifecycle) names a case: a
// case's note carries "<file>::<test>". This is the checklist J3 deletes
// those tests by; a test file already deleted is not checked.
export const COVERAGE = [
  ["test_check_knowledge.py", /^test_/],
  ["test_check_messages.py", /^test_/],
  ["test_check_stories.py", /^test_/],
  ["test_three_lens_review.py", /^test_messages_/],
  ["test_e2e_lifecycle.py", /^test_/],
];
export function coverageGaps(cases) {
  const notes = cases.map((c) => c.note || "").join("\n");
  const gaps = [];
  for (const [file, re] of COVERAGE) {
    const p = join(ROOT, "tests", file);
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, "utf-8").matchAll(/^def (test_\w+)\(/gm)) {
      if (re.test(m[1]) && !notes.includes(`${file}::${m[1]}`)) gaps.push(`${file}::${m[1]}`);
    }
  }
  return gaps;
}

// ------------------------------------------------------------ main
async function main() {
  const argv = process.argv.slice(2);
  const opt = (k) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : null; };
  const verbose = argv.includes("--verbose");
  const asJson = argv.includes("--json");
  if (opt("node")) setNodeBin(opt("node"));
  const filter = argv.find((x) => !x.startsWith("--"));
  let cases = loadCases();
  if (!cases.length) { console.log("FAIL run-cases: no cases under tests/checkers/cases"); process.exit(1); }
  if (argv.includes("--self-test")) {
    const bad = await selfTest(cases);
    cleanup();
    process.exit(bad ? 1 : 0);
  }
  if (!filter) {
    const gaps = coverageGaps(cases);
    for (const g of gaps) console.log(`FAIL coverage: no case names ${g}`);
    if (gaps.length) { process.exitCode = 1; }
  }
  if (filter) cases = cases.filter((c) => c.id.includes(filter));
  const paths = (opt("paths") || "node,web").split(",");
  const major = Number(process.versions.node.split(".")[0]);
  // The python path, and the node path's three unported scripts, run the
  // local python3; argparse's text changes between versions (3.9 says
  // "optional arguments:", 3.14 "options:"), so say so up front.
  {
    const want = ((readFileSync(join(HERE, "FROZEN_AT"), "utf-8").match(/^python: (.+)$/m)) || [])[1];
    const got = spawnSync(PYTHON, ["--version"], { encoding: "utf-8" });
    const have = ((got.stdout || "") + (got.stderr || "")).trim() || "(no python3)";
    if (have !== want && (paths.includes("python") || paths.includes("node"))) {
      console.log(`NOTE: ${PYTHON} is "${have}"; the cases were recorded with "${want}" (FROZEN_AT). ` +
        "Python-run steps (the python path; check_knowledge, check_messages, check_stories on the node path until J3) may differ for that reason alone.");
    }
  }
  const conc = Math.max(2, Math.min(12, cpus().length));
  const results = [];
  const tally = {};
  let failures = 0;
  for (const path of paths) {
    if (path === "web" && (major < 20)) {
      console.log(`SKIPPED web path: just-bash needs Node >= 20.18.1 (this is ${process.version})`);
      continue;
    }
    if (path === "node" && NODE_BIN !== process.execPath) {
      const v = spawnSync(NODE_BIN, ["--version"], { encoding: "utf-8" }).stdout.trim();
      console.log(`node path runs the ports with ${NODE_BIN} (${v})`);
    }
    const rs = await pool(cases, path === "web" ? 1 : conc, async (c) => {
      const scripts = scriptsOf(c);
      const key = c.group;
      tally[key] ??= {};
      tally[key][path] ??= { run: 0, pass: 0, skip: 0, pending: 0, xpass: 0 };
      const t = tally[key][path];
      if (path === "web") {
        const why = webSkipReason(c);
        if (why) { t.skip++; return { id: c.id, path, status: "SKIP", why }; }
      }
      const pend = PENDING[path] && PENDING[path][c.id];
      t.run++;
      let r;
      try { r = await runCase(c, path); } catch (e) { r = { diffs: [`THROWN ${e.stack || e}`], got: [] }; }
      const ok = r.diffs.length === 0;
      if (pend) {
        if (ok) { t.xpass++; failures++; return { id: c.id, path, status: "XPASS", why: pend }; }
        t.pending++; return { id: c.id, path, status: "PENDING", why: pend, diffs: r.diffs };
      }
      if (ok) { t.pass++; return { id: c.id, path, status: "PASS" }; }
      failures++;
      return { id: c.id, path, status: "FAIL", diffs: r.diffs, got: r.got, want: c.expect, scripts };
    });
    results.push(...rs);
  }
  cleanup();
  if (asJson) {
    console.log(JSON.stringify(results.map(({ got, want, ...x }) => x), null, 1));
  } else {
    for (const r of results) {
      if (r.status === "PASS") continue;
      if (r.status === "SKIP" && !verbose) continue;
      console.log(`[${r.status} ${r.path}] ${r.id}${r.diffs ? `  {${r.diffs.join("; ")}}` : ""}${r.why ? `  (${r.why})` : ""}`);
      if (r.status === "FAIL" && verbose) {
        r.got.forEach((g, i) => {
          console.log(`  step ${i + 1} got  exit=${g.exit} stdout=${JSON.stringify(g.stdout).slice(0, 1500)}\n    stderr=${JSON.stringify(g.stderr).slice(0, 400)}`);
          const w = r.want[i];
          console.log(`  step ${i + 1} want exit=${w.exit} stdout=${JSON.stringify(w.stdout).slice(0, 1500)}\n    stderr=${JSON.stringify(w.stderr).slice(0, 400)}`);
        });
      }
    }
    const skipReasons = {};
    for (const r of results) if (r.status === "SKIP") skipReasons[r.why] = (skipReasons[r.why] || 0) + 1;
    console.log(`\nper case folder: pass/run on each path (skipped, pending)`);
    for (const k of Object.keys(tally).sort()) {
      const cols = paths.filter((p) => tally[k][p]).map((p) => {
        const t = tally[k][p];
        return `${p} ${t.pass}/${t.run}${t.skip ? ` (${t.skip} skipped)` : ""}${t.pending ? ` (${t.pending} pending)` : ""}${t.xpass ? ` (${t.xpass} XPASS)` : ""}`;
      });
      const n = cases.filter((c) => c.group === k).length;
      console.log(`  ${k.padEnd(16)} ${String(n).padStart(4)} cases   ${cols.join("   ")}`);
    }
    for (const [why, n] of Object.entries(skipReasons)) console.log(`  SKIPPED on web: ${n} case(s): ${why}`);
    const pend = results.filter((r) => r.status === "PENDING").length;
    console.log(`\nrun-cases: ${cases.length} cases; paths ${paths.join(",")}; ${failures} failure(s)${pend ? `; ${pend} pending (named in PENDING)` : ""}`);
  }
  process.exit(failures || process.exitCode ? 1 : 0);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
