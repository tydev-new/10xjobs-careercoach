// § 1 — "The package never sees the key, and imports no `window`,
// `document`, `localStorage`, `node:*`, or Supabase client." Two checks,
// both AST-based (fix round 1, M9: a line-based/regex scanner missed
// multi-line imports, bare builtin specifiers, and browser globals used
// outside a bare `x.y` shape — tests/agent/browser-safety.test.ts's own
// mutation tests proved it):
//   1. no file reachable from src/index.ts (the BROWSER entry point)
//      statically or dynamically imports a Node builtin (with or
//      without the "node:" prefix) or a Supabase client;
//   2. no reachable file references a forbidden browser global
//      (window/document/localStorage/sessionStorage/indexedDB/
//      navigator), including typeof, globalThis.x, globalThis["x"], or
//      a destructured binding from globalThis.
import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const ENTRY = path.join(SRC, "index.ts");

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const FORBIDDEN_GLOBALS = new Set(["window", "document", "localStorage", "sessionStorage", "indexedDB", "navigator"]);

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...listFiles(abs));
    else if (abs.endsWith(".ts")) out.push(abs);
  }
  return out;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

/** Every static AND dynamic import specifier in a file, regardless of
 *  whether the import spans one line or many. */
function importSpecifiers(src: ts.SourceFile): string[] {
  const specs: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      specs.push(n.moduleSpecifier.text);
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = n.arguments[0];
      if (arg && ts.isStringLiteral(arg)) specs.push(arg.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return specs;
}

/** Identifiers used as browser globals (not property names, not
 *  declarations) — window/document/localStorage/etc. as a bare
 *  reference, `typeof window`, `globalThis.x`, `globalThis["x"]`, or a
 *  binding destructured from `globalThis`. */
function globalUses(file: string, src: ts.SourceFile): string[] {
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && FORBIDDEN_GLOBALS.has(n.text)) {
      const p = n.parent;
      const isPropName =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n) ||
        (ts.isPropertySignature(p) && p.name === n) ||
        (ts.isMethodDeclaration(p) && p.name === n);
      const isDecl =
        (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isImportSpecifier(p)) &&
        p.name === n;
      if (!isPropName && !isDecl) {
        hits.push(`${path.relative(SRC, file)}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${n.text}`);
      }
    }
    if (ts.isPropertyAccessExpression(n) && n.expression.getText() === "globalThis" && FORBIDDEN_GLOBALS.has(n.name.text)) {
      hits.push(`${path.relative(SRC, file)} globalThis.${n.name.text}`);
    }
    if (
      ts.isElementAccessExpression(n) &&
      n.expression.getText() === "globalThis" &&
      ts.isStringLiteralLike(n.argumentExpression) &&
      FORBIDDEN_GLOBALS.has(n.argumentExpression.text)
    ) {
      hits.push(`${path.relative(SRC, file)} globalThis[${(n.argumentExpression as ts.StringLiteral).text}]`);
    }
    if (
      ts.isBindingElement(n) &&
      ts.isObjectBindingPattern(n.parent) &&
      ts.isVariableDeclaration(n.parent.parent) &&
      n.parent.parent.initializer?.getText() === "globalThis"
    ) {
      const nm = (n.propertyName ?? n.name).getText();
      if (FORBIDDEN_GLOBALS.has(nm)) hits.push(`${path.relative(SRC, file)} destructured ${nm}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return hits;
}

function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // a package specifier ("ai", "node:*", ...), not a local file
  return path.resolve(path.dirname(fromFile), spec);
}

function walkGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importSpecifiers(parse(file))) {
      const resolved = resolveRelative(file, spec);
      if (resolved) queue.push(resolved);
    }
  }
  return [...seen];
}

test("no file reachable from src/index.ts (the browser entry) imports node:*/a bare Node builtin/a Supabase client", () => {
  const files = walkGraph(ENTRY);
  const offenders: string[] = [];
  for (const file of files) {
    for (const spec of importSpecifiers(parse(file))) {
      if (BUILTINS.has(spec) || spec.includes("@supabase/")) {
        offenders.push(`${path.relative(SRC, file)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
  // sanity: the graph walk actually visited more than just the entry file
  assert.ok(files.length > 10, `graph walk only visited ${files.length} file(s) — the walker may be broken`);
});

test("no window/document/localStorage (or sibling browser globals) referenced in any file under src/", () => {
  // The WHOLE package, not just the reachable graph — the Node-only
  // adapters must never touch a browser global either (they just may
  // import node:*, which is fine off the browser entry's graph).
  const hits: string[] = [];
  for (const file of listFiles(SRC)) hits.push(...globalUses(file, parse(file)));
  assert.deepEqual(hits, []);
});

test("the Node-only adapters are NOT reachable from src/index.ts (proves the isolation the imports test relies on)", () => {
  const files = walkGraph(ENTRY).map((f) => path.relative(SRC, f));
  assert.ok(!files.includes(path.join("workspace", "local-folder-store.ts")));
  assert.ok(!files.includes(path.join("skills", "skill-bundle-fs.ts")));
});
