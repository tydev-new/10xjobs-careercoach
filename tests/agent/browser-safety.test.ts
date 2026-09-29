// Tester-owned: § 1 "imports no window, document, localStorage, node:*, or
// Supabase client" + step 4 exit "a lint rule or test fails on any
// window/document/localStorage use in packages/agent".
//  1. a REAL browser-platform bundle (rolldown, from apps/web) of
//     src/index.ts, recording every import the bundler resolves;
//  2. a TypeScript-AST scan for browser globals in every reachable file;
//  3. mutation tests: plant forbidden uses in a COPY of the package and
//     check that (a) this scanner and (b) the package's own lint catch them.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { builtinModules } from "node:module";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { AGENT, REPO, tmp } from "./_support.ts";
import ts from "../../packages/agent/node_modules/typescript/lib/typescript.js";

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const FORBIDDEN_GLOBALS = new Set(["window", "document", "localStorage", "sessionStorage", "indexedDB", "navigator"]);

async function bundleGraph(agentRoot: string) {
  const { rolldown } = await import(path.join(REPO, "apps/web/node_modules/rolldown/dist/index.mjs"));
  const edges: Array<{ importer: string; source: string }> = [];
  const modules = new Set<string>();
  const bundle = await rolldown({
    input: path.join(agentRoot, "src/index.ts"),
    platform: "browser",
    logLevel: "silent",
    plugins: [{
      name: "record",
      resolveId(source: string, importer: string | undefined) {
        if (importer) edges.push({ importer, source });
        if (BUILTINS.has(source) || source.startsWith("node:")) return { id: source, external: true };
        return null;
      },
      load(id: string) { modules.add(id); return null; },
    }],
  });
  const out = await bundle.generate({ format: "esm" });
  for (const o of out.output) for (const id of (o as any).moduleIds ?? []) modules.add(id);
  await bundle.close?.();
  return { edges, modules: [...modules] };
}

/** Identifiers used as browser globals (not property names, not declarations). */
function globalUses(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (n: any) => {
    if (ts.isIdentifier(n) && FORBIDDEN_GLOBALS.has(n.text)) {
      const p = n.parent;
      const isPropName = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isPropertySignature?.(p) && p.name === n) || (ts.isMethodDeclaration?.(p) && p.name === n);
      const isDecl = (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isImportSpecifier(p)) && p.name === n;
      if (!isPropName && !isDecl) hits.push(`${path.basename(file)}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${n.text}`);
    }
    // globalThis.window / globalThis["document"] / const { localStorage } = globalThis
    if (ts.isPropertyAccessExpression(n) && n.expression.getText() === "globalThis" && FORBIDDEN_GLOBALS.has(n.name.text)) hits.push(`${path.basename(file)} globalThis.${n.name.text}`);
    if (ts.isElementAccessExpression(n) && n.expression.getText() === "globalThis" && ts.isStringLiteral(n.argumentExpression) && FORBIDDEN_GLOBALS.has(n.argumentExpression.text)) hits.push(`${path.basename(file)} globalThis[${n.argumentExpression.text}]`);
    if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent) && ts.isVariableDeclaration(n.parent.parent) && n.parent.parent.initializer?.getText() === "globalThis") {
      const nm = (n.propertyName ?? n.name).getText();
      if (FORBIDDEN_GLOBALS.has(nm)) hits.push(`${path.basename(file)} destructured ${nm}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return hits;
}

async function scan(agentRootIn: string) {
  const agentRoot = realpathSync(agentRootIn); // macOS: /var -> /private/var; the bundler reports real paths
  const { edges, modules } = await bundleGraph(agentRoot);
  const own = (f: string) => f.startsWith(path.join(agentRoot, "src"));
  const badImports = edges.filter((e) => BUILTINS.has(e.source) || e.source.startsWith("node:") || e.source.includes("@supabase/"));
  const ownFiles = modules.filter(own);
  const globals = ownFiles.flatMap(globalUses);
  return { edges, modules, badImports, ownFiles, globals };
}

test("browser bundle of src/index.ts: no node:* / builtin / Supabase import anywhere in the graph; Node-only adapters unreachable", async () => {
  const r = await scan(AGENT);
  assert.ok(r.ownFiles.length > 10, `graph has ${r.ownFiles.length} package files`);
  const rel = (f: string) => path.relative(REPO, f);
  assert.deepEqual(r.badImports.map((e) => `${rel(e.importer)} -> ${e.source}`), []);
  for (const f of ["src/workspace/local-folder-store.ts", "src/skills/skill-bundle-fs.ts"]) {
    assert.ok(!r.modules.includes(path.join(AGENT, f)), `${f} is reachable from index.ts`);
  }
  console.log(`[tester] browser graph: ${r.ownFiles.length} package files, ${r.modules.length} modules total`);
});

test("no window/document/localStorage (or sibling browser globals) used in any reachable package file", async () => {
  const r = await scan(AGENT);
  assert.deepEqual(r.globals, []);
});

test("no Node-only global (Buffer, process, require, __dirname) in any reachable package file", async () => {
  const r = await scan(AGENT);
  const hits: string[] = [];
  for (const f of r.ownFiles) {
    const src = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const visit = (n: any) => {
      if (ts.isIdentifier(n) && ["Buffer", "process", "require", "__dirname", "__filename"].includes(n.text)) {
        const p = n.parent;
        if (!(ts.isPropertyAccessExpression(p) && p.name === n) && !(ts.isPropertyAssignment(p) && p.name === n)) hits.push(`${path.relative(AGENT, f)}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${n.text}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  assert.deepEqual(hits, []);
});

// ------------------------------------------------------------------ mutation tests

const MUTANTS: Record<string, string> = {
  "multi-line node import": 'import {\n  readFileSync,\n} from "node:fs";\nexport const __m = readFileSync;\n',
  "side-effect node import": 'import "node:fs";\n',
  "bare builtin import": 'import { readFileSync as __r } from "fs";\nexport const __m = __r;\n',
  "typeof window": 'export const __m = typeof window !== "undefined";\n',
  "globalThis.localStorage": "export const __m = () => globalThis.localStorage;\n",
  "destructured document": "const { document: __d } = globalThis as any;\nexport const __m = __d;\n",
  "window[...] access": 'export const __m = () => (window as any)["localStorage"];\n',
  "multi-line supabase import": 'import {\n  createClient,\n} from "@supabase/supabase-js";\nexport const __m = createClient;\n',
};

function mutantCopy(code: string): string {
  // design-web-search.md § 4.4 (S2): src/tools/boards.ts imports
  // skills/search/scripts/lib/{board-readers,jobs-md}.mjs by a relative
  // path that climbs OUT of packages/agent ("../../../../skills/..." —
  // "one implementation", not a copy). A bare `root = tmp(...)` used
  // directly as "AGENT" (the ORIGINAL shape here) breaks that import
  // in the isolated copy: `root` sits directly under the OS tmpdir, four
  // levels up from `root/src/tools/` lands nowhere near a `skills/`
  // folder, so EVERY mutant — including harmless ones — failed to
  // resolve and was (wrongly) reported as "caught". Fix: nest the copy
  // two levels deeper (`outer/packages/agent`, mirroring this repo's own
  // REPO/packages/agent), and symlink `outer/skills` to the real
  // skills/ tree, so the same relative climb lands correctly. The
  // returned path is still "AGENT-shaped" (src/, test/, node_modules,
  // package.json, tsconfig.json all directly inside it) — every existing
  // caller (scan(), theirLintCatches()) is unchanged.
  const outer = tmp("agent-mutant-");
  const root = path.join(outer, "packages", "agent");
  mkdirSync(root, { recursive: true });
  symlinkSync(path.join(REPO, "skills"), path.join(outer, "skills"));
  for (const d of ["src", "test"]) cpSync(path.join(AGENT, d), path.join(root, d), { recursive: true });
  for (const f of ["package.json", "tsconfig.json"]) cpSync(path.join(AGENT, f), path.join(root, f));
  symlinkSync(path.join(AGENT, "node_modules"), path.join(root, "node_modules"));
  const target = path.join(root, "src/helpers.ts"); // reachable from index.ts
  writeFileSync(target, code + readFileSync(target, "utf8"));
  return root;
}

function theirLintCatches(root: string): boolean {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; // else the nested runner reports to us and exits 0
  const r = spawnSync(process.execPath, ["--test", "test/no-forbidden-imports.test.ts"], { cwd: root, encoding: "utf8", env });
  return r.status !== 0;
}

test("mutants: THIS scanner catches every planted forbidden use (validates the tests above)", async () => {
  const missed: string[] = [];
  for (const [name, code] of Object.entries(MUTANTS)) {
    const root = mutantCopy(code);
    let caught = false;
    try {
      const r = await scan(root);
      caught = r.badImports.length > 0 || r.globals.length > 0;
    } catch { caught = true; /* unresolvable (e.g. no @supabase installed) also fails the build */ }
    if (!caught) missed.push(name);
  }
  assert.deepEqual(missed, []);
});

test("mutant harness control: the package's own lint DOES catch the plain single-line forms (so misses below are real)", () => {
  assert.ok(theirLintCatches(mutantCopy('import { readFileSync as __r } from "node:fs";\nexport const __m = __r;\n')), "single-line node: import");
  assert.ok(theirLintCatches(mutantCopy("export const __m = () => window.localStorage;\n")), "window.x");
  assert.ok(!theirLintCatches(mutantCopy("export const __m = 1;\n")), "a harmless mutant passes");
});

test("mutants: the package's own lint (test/no-forbidden-imports.test.ts) fails on each planted forbidden use", () => {
  const missed: string[] = [];
  for (const [name, code] of Object.entries(MUTANTS)) {
    if (!theirLintCatches(mutantCopy(code))) missed.push(name);
  }
  assert.deepEqual(missed, [], "the package's lint passed these mutants");
});

// ------------------------------------------------------------------ skills/*/scripts/lib (JS-only J2)
// docs/design-js-only.md § 2: "A file under `scripts/lib/` imports no `node:`
// module, except `profile/scripts/lib/io-node.mjs`, which only the command
// files import. `tests/agent/browser-safety.test.ts` is widened to scan
// `skills/*/scripts/lib/` with that one named exception." § 6 J2 *Exit*: "the
// browser-safety lint covers `skills/*/scripts/lib/`". The web dispatch
// (packages/checkers/src/dispatch.mjs) imports these files into the browser.

const LIB_EXCEPTION = "profile/scripts/lib/io-node.mjs"; // relative to skills/
const NODE_ONLY_GLOBALS = ["Buffer", "process", "require", "__dirname", "__filename"];

function libFiles(skillsRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.(mjs|js|ts)$/.test(name)) out.push(abs);
    }
  };
  for (const skill of readdirSync(skillsRoot)) {
    const lib = path.join(skillsRoot, skill, "scripts", "lib");
    if (existsSync(lib)) walk(lib);
  }
  return out.sort();
}

/** Bundle every lib file (the exception left out) for the browser and report
 *  (a) every node:/builtin/Supabase import in the graph, (b) every module
 *  reached that is the exception or not a lib file at all (a lib importing a
 *  command file would pull its node:child_process in), and (c) any Node-only
 *  global used in a lib file. */
async function scanSkillLibs(skillsRootIn: string) {
  const skillsRoot = realpathSync(skillsRootIn);
  const exception = path.join(skillsRoot, LIB_EXCEPTION);
  const inputs = libFiles(skillsRoot).filter((f) => f !== exception);
  const { rolldown } = await import(path.join(REPO, "apps/web/node_modules/rolldown/dist/index.mjs"));
  const edges: Array<{ importer: string; source: string }> = [];
  const modules = new Set<string>();
  const bundle = await rolldown({
    input: inputs,
    platform: "browser",
    logLevel: "silent",
    plugins: [{
      name: "record",
      resolveId(source: string, importer: string | undefined) {
        if (importer) edges.push({ importer, source });
        if (BUILTINS.has(source) || source.startsWith("node:")) return { id: source, external: true };
        return null;
      },
      load(id: string) { modules.add(id); return null; },
    }],
  });
  const out = await bundle.generate({ format: "esm" });
  for (const o of out.output) for (const id of (o as any).moduleIds ?? []) modules.add(id);
  await bundle.close?.();
  const rel = (f: string) => path.relative(skillsRoot, f);
  const badImports = edges
    .filter((e) => BUILTINS.has(e.source) || e.source.startsWith("node:") || e.source.includes("@supabase/"))
    .map((e) => `${rel(e.importer)} -> ${e.source}`);
  const notLib = [...modules]
    .filter((m) => !m.startsWith("node:") && !BUILTINS.has(m) && !m.startsWith("\0"))
    .filter((m) => m === exception || !m.startsWith(skillsRoot) || !/\/scripts\/lib\//.test(m))
    .map(rel);
  const globals: string[] = [];
  for (const f of inputs) {
    const src = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const visit = (n: any) => {
      if (ts.isIdentifier(n) && NODE_ONLY_GLOBALS.includes(n.text)) {
        const p = n.parent;
        const isPropName = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isMethodDeclaration?.(p) && p.name === n);
        const isDecl = (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isImportSpecifier(p)) && p.name === n;
        if (!isPropName && !isDecl) globals.push(`${rel(f)}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${n.text}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  // Browser globals too (S2 review: a `window` planted in a lib passed this
  // scan and the package lint). A lib runs in Node as well as the browser
  // (the command files import it), where `window`/`document`/`localStorage`
  // do not exist: the same globalUses() the agent package is held to.
  const browserGlobals = inputs.flatMap((f) => globalUses(f).map((h) => `${path.relative(skillsRoot, path.dirname(f))}/${h}`));
  return { inputs: inputs.map(rel), badImports, notLib, globals, browserGlobals };
}

test("skills/*/scripts/lib: a browser bundle of every lib file reaches no node:/builtin/Supabase import, no command file, and not io-node.mjs; no Node-only or browser global", async () => {
  const r = await scanSkillLibs(path.join(REPO, "skills"));
  assert.ok(r.inputs.length >= 15, `scanned ${r.inputs.length} lib files`);
  for (const must of ["apply/scripts/lib/check-materials.mjs", "profile/scripts/lib/shapecheck.mjs", "search/scripts/lib/jobs-md.mjs", "coach/scripts/lib/check-closeout.mjs"]) {
    assert.ok(r.inputs.includes(must), `${must} is scanned`);
  }
  assert.deepEqual(r.badImports, []);
  assert.deepEqual(r.notLib, []);
  assert.deepEqual(r.globals, []);
  assert.deepEqual(r.browserGlobals, []);
  console.log(`[tester] skills lib scan: ${r.inputs.length} files`);
});

test("skills/*/scripts/lib: the one exception is named, exists, is Node-only, and no lib file imports it", () => {
  const skills = path.join(REPO, "skills");
  const exc = path.join(skills, LIB_EXCEPTION);
  assert.ok(existsSync(exc), `${LIB_EXCEPTION} exists (a stale exception would be silent)`);
  assert.match(readFileSync(exc, "utf8"), /from "node:fs"/, "the exception really is Node-only");
  // real import/export-from statements only (a JSDoc `import("…")` type is a comment)
  const importers = libFiles(skills).filter((f) => {
    if (f === exc) return false;
    const src = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    return src.statements.some((s: any) => (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier && /io-node\.mjs$/.test(s.moduleSpecifier.text));
  });
  assert.deepEqual(importers.map((f) => path.relative(skills, f)), []);
});

const LIB_MUTANTS: Record<string, string> = {
  "node:fs import": 'import { readFileSync as __r } from "node:fs";\nexport const __m = __r;\n',
  "multi-line node:fs import": 'import {\n  readFileSync as __r,\n} from "node:fs";\nexport const __m = __r;\n',
  "side-effect node import": 'import "node:path";\n',
  "bare builtin import": 'import { spawn as __s } from "child_process";\nexport const __m = __s;\n',
  "dynamic node import": 'export const __m = () => import("node:fs");\n',
  "lib imports io-node.mjs": 'import { nodeIo as __io } from "../../../profile/scripts/lib/io-node.mjs";\nexport const __m = __io;\n',
  "lib imports a command file": 'import "../render_resume.mjs";\n',
  "process.env in a lib": "export const __m = () => process.env.HOME;\n",
  "Buffer in a lib": 'export const __m = () => Buffer.from("x");\n',
  "window in a lib": "export const __m = () => window.location.href;\n",
  "typeof window in a lib": 'export const __m = typeof window !== "undefined";\n',
  "document in a lib": 'export const __m = () => document.createElement("a");\n',
  "localStorage in a lib": 'export const __m = () => localStorage.getItem("k");\n',
  "globalThis.localStorage in a lib": "export const __m = () => globalThis.localStorage;\n",
  "destructured document in a lib": "const { document: __d } = globalThis;\nexport const __m = __d;\n",
  "navigator in a lib": "export const __m = () => navigator.userAgent;\n",
};

function skillsCopy(target: string, code: string): string {
  const root = tmp("skills-lib-mutant-");
  cpSync(path.join(REPO, "skills"), path.join(root, "skills"), { recursive: true });
  const f = path.join(root, "skills", target);
  writeFileSync(f, code + readFileSync(f, "utf8"));
  return path.join(root, "skills");
}

test("skills lib mutants: a planted node:fs import (and each sibling form) in a lib file fails the scan", async () => {
  const missed: string[] = [];
  for (const [name, code] of Object.entries(LIB_MUTANTS)) {
    const r = await scanSkillLibs(skillsCopy("apply/scripts/lib/check-materials.mjs", code));
    if (!(r.badImports.length || r.notLib.length || r.globals.length || r.browserGlobals.length)) missed.push(name);
  }
  assert.deepEqual(missed, []);
  // controls: a harmless mutant passes, and so does a node: import in the named exception
  const ok = await scanSkillLibs(skillsCopy("apply/scripts/lib/check-materials.mjs", "export const __m = 1;\n"));
  assert.deepEqual([ok.badImports, ok.notLib, ok.globals, ok.browserGlobals], [[], [], [], []]);
  const exc = await scanSkillLibs(skillsCopy(LIB_EXCEPTION, 'import { stat as __s } from "node:fs/promises";\nexport const __m = __s;\n'));
  assert.deepEqual([exc.badImports, exc.notLib, exc.globals, exc.browserGlobals], [[], [], [], []]);
});
