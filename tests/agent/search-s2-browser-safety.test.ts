// Tester-owned (S2 review, known items 1 and 8): proves the builder's
// change to browser-safety.test.ts's mutantCopy layout, and that the
// browser-safety lints cover skills/search/scripts/lib/board-readers.mjs
// (design-web-search.md § 4.8 last bullet, § 9 S2 Exit).
//
// The mutant layouts below mirror browser-safety.test.ts's mutantCopy
// (old: 8469c65; new: 8d4ff45) line for line; the bundle scan mirrors its
// scan(). Each mutant lives in a fresh temp copy; the repo is never edited.
//
// Run: node --test tests/agent/search-s2-browser-safety.test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { builtinModules } from "node:module";
import { cpSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { AGENT, REPO, tmp } from "./_support.ts";
import ts from "../../packages/agent/node_modules/typescript/lib/typescript.js";

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const FORBIDDEN_GLOBALS = new Set(["window", "document", "localStorage", "sessionStorage", "indexedDB", "navigator"]);

type Layout = "old" | "new" | "new-copied-skills";

/** old = the pre-S2 mutantCopy (root straight under tmp); new = the
 *  builder's (outer/packages/agent + outer/skills symlink);
 *  new-copied-skills = the new layout with skills/ COPIED, so a mutant can
 *  be planted in board-readers.mjs without touching the repo. */
function layout(kind: Layout): { root: string; outer: string | null } {
  if (kind === "old") {
    const root = tmp("s2t-mutant-old-");
    for (const d of ["src", "test"]) cpSync(path.join(AGENT, d), path.join(root, d), { recursive: true });
    for (const f of ["package.json", "tsconfig.json"]) cpSync(path.join(AGENT, f), path.join(root, f));
    symlinkSync(path.join(AGENT, "node_modules"), path.join(root, "node_modules"));
    return { root, outer: null };
  }
  const outer = tmp("s2t-mutant-new-");
  const root = path.join(outer, "packages", "agent");
  mkdirSync(root, { recursive: true });
  if (kind === "new") symlinkSync(path.join(REPO, "skills"), path.join(outer, "skills"));
  else cpSync(path.join(REPO, "skills"), path.join(outer, "skills"), { recursive: true });
  for (const d of ["src", "test"]) cpSync(path.join(AGENT, d), path.join(root, d), { recursive: true });
  for (const f of ["package.json", "tsconfig.json"]) cpSync(path.join(AGENT, f), path.join(root, f));
  symlinkSync(path.join(AGENT, "node_modules"), path.join(root, "node_modules"));
  return { root, outer };
}

function plant(file: string, code: string) {
  writeFileSync(file, code + readFileSync(file, "utf8"));
}

async function bundleScan(agentRootIn: string) {
  const agentRoot = realpathSync(agentRootIn);
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
  const badImports = edges.filter((e) => BUILTINS.has(e.source) || e.source.startsWith("node:") || e.source.includes("@supabase/"));
  const ownFiles = [...modules].filter((f) => f.startsWith(path.join(agentRoot, "src")));
  const globals: string[] = [];
  for (const f of ownFiles) {
    const src = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const visit = (n: any) => {
      if (ts.isIdentifier(n) && FORBIDDEN_GLOBALS.has(n.text)) {
        const p = n.parent;
        const isProp = ts.isPropertyAccessExpression(p) && p.name === n;
        const isDecl = (ts.isVariableDeclaration(p) || ts.isParameter(p)) && p.name === n;
        if (!isProp && !isDecl) globals.push(`${path.basename(f)} ${n.text}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return { badImports, globals, modules: [...modules] };
}

/** browser-safety.test.ts's verdict rule, verbatim: a throw counts as caught. */
async function scannerSaysCaught(root: string): Promise<{ caught: boolean; threw: boolean }> {
  try {
    const r = await bundleScan(root);
    return { caught: r.badImports.length > 0 || r.globals.length > 0, threw: false };
  } catch {
    return { caught: true, threw: true };
  }
}

function packageLintFails(root: string): boolean {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--test", "test/no-forbidden-imports.test.ts"], { cwd: root, encoding: "utf8", env });
  return r.status !== 0;
}

const HARMLESS = "export const __s2tHarmless = 1;\n";
const NODE_FS = 'import { readFileSync as __s2tR } from "node:fs";\nexport const __s2tM = __s2tR;\n';

// ------------------------------------------------------------------ known item 1

test("known item 1: under the OLD mutantCopy layout a HARMLESS mutant is judged 'caught' by both checks (the builder's claim)", async () => {
  const { root } = layout("old");
  plant(path.join(root, "src/helpers.ts"), HARMLESS);
  const s = await scannerSaysCaught(root);
  assert.equal(s.threw, true, "the bundle fails to resolve ../../../../skills from the old layout");
  assert.equal(s.caught, true, "…and the scanner's catch-all counts that as caught");
  assert.equal(packageLintFails(root), true, "the package lint also fails on the unresolved skills import, so a harmless mutant reads as caught");
});

test("known item 1: under the NEW layout a harmless mutant passes both checks and a node:fs mutant fails both", async () => {
  const ok = layout("new").root;
  plant(path.join(ok, "src/helpers.ts"), HARMLESS);
  const s1 = await scannerSaysCaught(ok);
  assert.deepEqual(s1, { caught: false, threw: false }, "harmless mutant: scanner clean");
  assert.equal(packageLintFails(ok), false, "harmless mutant: package lint passes");

  const bad = layout("new").root;
  plant(path.join(bad, "src/helpers.ts"), NODE_FS);
  const s2 = await scannerSaysCaught(bad);
  assert.deepEqual(s2, { caught: true, threw: false }, "node:fs mutant: caught by the scan itself, not by a throw");
  assert.equal(packageLintFails(bad), true, "node:fs mutant: package lint fails");
});

// ------------------------------------------------------------------ known item 8

test("known item 8: a node:fs import planted in board-readers.mjs is caught by the tester scan, the package lint, and tests/boards.test.mjs", async () => {
  const { root, outer } = layout("new-copied-skills");
  const lib = path.join(outer!, "skills/search/scripts/lib/board-readers.mjs");
  plant(lib, 'import { readFileSync as __s2tR } from "node:fs";\nexport const __s2tM = __s2tR;\n');

  const r = await bundleScan(root);
  const hits = r.badImports.map((e) => `${path.basename(e.importer)} -> ${e.source}`);
  assert.ok(hits.includes("board-readers.mjs -> node:fs"), JSON.stringify(hits));
  assert.equal(packageLintFails(root), true, "the package lint walks into board-readers.mjs");

  // builder's own lint in tests/boards.test.mjs, run from a copy beside the planted skills/
  mkdirSync(path.join(outer!, "tests"), { recursive: true });
  cpSync(path.join(REPO, "tests/boards.test.mjs"), path.join(outer!, "tests/boards.test.mjs"));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const b = spawnSync(process.execPath, ["--test", "--test-name-pattern=browser-safety", path.join(outer!, "tests/boards.test.mjs")], { encoding: "utf8", env });
  assert.notEqual(b.status, 0, "tests/boards.test.mjs's browser-safety test fails on the planted import");
  assert.ok(/forbidden node: import: node:fs/.test(b.stdout + b.stderr), b.stdout.slice(-800));
});

test("known item 8 control: the same copied layout with an UNCHANGED board-readers.mjs is clean", async () => {
  const { root } = layout("new-copied-skills");
  const r = await bundleScan(root);
  assert.deepEqual(r.badImports, []);
  assert.ok(r.modules.some((m) => m.endsWith("skills/search/scripts/lib/board-readers.mjs")), "board-readers.mjs is in the browser graph");
});

test("known item 8: a `window` use planted in board-readers.mjs is caught by at least one lint", async () => {
  const { root, outer } = layout("new-copied-skills");
  plant(path.join(outer!, "skills/search/scripts/lib/board-readers.mjs"), 'export const __s2tW = () => typeof window !== "undefined";\n');
  mkdirSync(path.join(outer!, "tests"), { recursive: true });
  cpSync(path.join(REPO, "tests/boards.test.mjs"), path.join(outer!, "tests/boards.test.mjs"));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const b = spawnSync(process.execPath, ["--test", "--test-name-pattern=browser-safety", path.join(outer!, "tests/boards.test.mjs")], { encoding: "utf8", env });
  assert.notEqual(b.status, 0, "tests/boards.test.mjs's regex check catches it");
  void root;
});

test(
  "known item 8 gap: the TESTER-owned scan and the package lint check browser GLOBALS only under packages/agent/src — a `window` in board-readers.mjs passes both",
  { todo: "design-js-only.md § 3 says browser-safety.test.ts is widened to scan skills/*/scripts/lib/; it isn't (J2 gap). Today only tests/boards.test.mjs's regex covers globals in board-readers.mjs." },
  async () => {
    const { root, outer } = layout("new-copied-skills");
    plant(path.join(outer!, "skills/search/scripts/lib/board-readers.mjs"), 'export const __s2tW = () => typeof window !== "undefined";\n');
    const r = await bundleScan(root);
    assert.ok(r.globals.length > 0 || packageLintFails(root), "neither the scanner nor the package lint saw `window` in board-readers.mjs");
  },
);
