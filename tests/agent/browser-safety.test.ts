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
import { cpSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
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
  const root = tmp("agent-mutant-");
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
