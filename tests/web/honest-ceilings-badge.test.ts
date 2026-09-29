// Independent tester's render check for the document card's badge —
// docs/design-honest-ceilings.md § 6A "The web badge" (a render check in
// tests/web/, which the build did not add) and design-web-ui.md § 5.3.1
// rows T2-T6, T8, which § 6A says the badge's words come from.
//
//   node --test tests/web/honest-ceilings-badge.test.ts
//
// Cards.tsx reads `import.meta.env` for its print button; a CommonJS
// transpile can't carry `import.meta`, so this harness substitutes an empty
// env object in memory before transpiling (the print button is not under
// test, and no htmlPath is passed).
//
// Tests named "RED" state the spec and currently FAIL against the build.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";

const WEB = new URL("../../apps/web/", import.meta.url);
const req = createRequire(new URL("package.json", WEB));

function render(file: string, exportName: string, props: any): string {
  const ts = req("typescript");
  const React = req("react");
  const cache = new Map<string, any>();
  const resolve = (spec: string, from: URL): URL => {
    for (const suffix of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
      const u = new URL(spec + suffix, from);
      if (existsSync(u) && statSync(u).isFile()) return u;
    }
    throw new Error(`badge harness: cannot resolve "${spec}" from ${from.pathname}`);
  };
  const load = (url: URL): any => {
    const hit = cache.get(url.href);
    if (hit) return hit.exports;
    const src = readFileSync(url, "utf8").replaceAll("import.meta.env", "({} as Record<string, string>)");
    const out = ts.transpileModule(src, {
      fileName: url.pathname,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod: any = { exports: {} };
    cache.set(url.href, mod);
    const localReq = (id: string) => (id.startsWith(".") ? load(resolve(id, url)) : req(id));
    new Function("require", "exports", "module", out)(localReq, mod.exports, mod);
    return mod.exports;
  };
  const exports = load(new URL(`src/components/${file}`, WEB));
  const { renderToStaticMarkup } = req("react-dom/server");
  return renderToStaticMarkup(React.createElement(exports[exportName], props));
}

const noop = () => {};
const doc = (props: any) =>
  render("Cards.tsx", "Card", { data: { card: "document", props, ref: "applications/acme-resume.md" }, onOpen: noop, onPrint: noop });
const badgeText = (html: string) => {
  const m = html.match(/<span class="badge badge--[^"]*">([\s\S]*?)<\/span>/);
  return m ? m[1] : null;
};
const metaText = (html: string) => {
  const m = html.match(/<p class="card-meta">([\s\S]*?)<\/p>/);
  return m ? m[1].replace(/<[^>]+>/g, "") : null;
};

test("§ 6A: warn with one warning shows 'no failures, 1 warning' and never 'clean'", () => {
  const html = doc({ words: 412, checker: "warn", warnCount: 1 });
  assert.equal(badgeText(html), "no failures, 1 warning", html);
  assert.ok(!/clean/i.test(html), html);
});

test("§ 6A / T8: warn with two warnings shows 'no failures, 2 warnings'", () => {
  const html = doc({ words: 412, checker: "warn", warnCount: 2 });
  assert.equal(badgeText(html), "no failures, 2 warnings", html);
  assert.ok(!/clean/i.test(html), html);
});

test("§ 6A: clean and fail read as today (T3, T5)", () => {
  assert.equal(badgeText(doc({ words: 412, checker: "clean" })), "clean");
  assert.equal(badgeText(doc({ words: 412, checker: "fail" })), "fail");
});

test("RED — § 6A 'Words' / design-web-ui.md § 5.3.1 T2: the meta line reads '<W> words · automatic checks: <badge>', not 'checker'", () => {
  const html = doc({ words: 412, checker: "warn", warnCount: 1 });
  assert.equal(metaText(html), "412 words · automatic checks: no failures, 1 warning", html);
});

test("RED — § 6A 'Words' / design-web-ui.md § 5.3.1 T6: not-run renders as 'not run'", () => {
  assert.equal(badgeText(doc({ words: 412, checker: "not-run" })), "not run");
});
