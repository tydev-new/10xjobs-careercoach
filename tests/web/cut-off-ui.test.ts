// Tester-owned: § 9.8 (vii), the UI side of cut-off replies —
// docs/design-web-agent.md § 9.1/§ 9.3 and design-web-ui.md § 2.7, § 3
// (amended 2026-09-24, commit 0d8588a). Written from the spec.
//
// The coach's REAL chunks (packages/agent + the real OpenRouter provider
// over a stubbed fetch) are assembled by apps/web's OWN copy of `ai` (the
// one the browser bundles) and rendered by apps/web's own components.
// Run: node --test tests/web/cut-off-ui.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { readUIMessageStream } from "../../apps/web/node_modules/ai/dist/index.js";
import { CUT_OFF_MESSAGE, TOOL_CLOSE_TEXT } from "../agent/_spec9.ts";
import { sse, stubbedOpenRouter, textReply } from "../agent/_openrouter_stub.ts";
import { makeCoach, runTurn, user } from "../agent/_support.ts";

const WEB = new URL("../../apps/web/", import.meta.url);
const req = createRequire(new URL("package.json", WEB));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

/** Transpiles an apps/web component and renders it to static HTML. `open`
 *  forces every useState(false) toggle to start true (the expanded view). */
function render(file: string, exportName: string, props: any, open = false): string {
  const ts = req("typescript");
  const src = readFileSync(new URL(`src/components/${file}`, WEB), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const React = req("react");
  const patched = open ? { ...React, useState: (v: unknown) => React.useState(v === false ? true : v) } : React;
  const localReq = (id: string) => (id === "react" ? patched : req(id));
  const mod: any = { exports: {} };
  new Function("require", "exports", "module", out)(localReq, mod.exports, mod);
  const { renderToStaticMarkup } = req("react-dom/server");
  return renderToStaticMarkup(React.createElement(mod.exports[exportName], props));
}
const metas = (html: string) => [...html.matchAll(/<p class="card-meta">([^<]*)<\/p>/g)].map((m) => m[1]);

async function assemble(chunks: any[]) {
  const s = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); } });
  let last: any;
  for await (const m of readUIMessageStream({ stream: s as any })) last = m;
  return last;
}

const PARTIAL = '{"path":"evaluations/beta.md","content":"# Beta Corp\\n\\nVerdict: Strong fit because';

// ------------------------------------------------------------ ErrorPart

test("(vii) ErrorPart: a cut_off part shows its message word for word, the retryable line, and no next-step line", () => {
  const html = render("ErrorPart.tsx", "ErrorPart", { data: { code: "cut_off", message: CUT_OFF_MESSAGE, retryable: true } });
  assert.ok(html.includes(`<p class="card-body">${esc(CUT_OFF_MESSAGE)}</p>`), html);
  assert.deepEqual(metas(html), ["This can be retried."], "only the retryable line");
});

// ------------------------------------------------------------ the "ran …" line

test("(vii) a part closed by tool-input-error shows the § 9.1 text in the expanded 'ran …' line, one row per call id (apps/web's own ai)", async () => {
  const m = stubbedOpenRouter([
    sse().text("Writing both.").toolCallCutOff(0, "call_1", "write_file", PARTIAL).finish("length").usage(0.04, 8192),
    sse().text("Again.").toolCallCutOff(0, "call_2", "write_file", PARTIAL).finish("length").usage(0.04, 8192),
    textReply("MUST NOT BE REQUESTED"),
  ]);
  const { coach } = makeCoach({ model: m.model });
  const { chunks } = await runTurn(coach, "c-vii", [user("u1", "Evaluate both")]);
  const message = await assemble(chunks); // apps/web's ai, not packages/agent's

  const tools = message.parts.filter((p: any) => p.type.startsWith("tool-"));
  const ids = tools.map((p: any) => p.toolCallId);
  assert.deepEqual(ids, ["call_1", "call_2"], "one part per call id — the late tool-input-error updated the open part, no duplicate");
  for (const p of tools) {
    assert.equal(p.state, "output-error");
    assert.equal(p.errorText, TOOL_CLOSE_TEXT);
  }

  for (const p of tools) {
    const html = render("ToolRun.tsx", "ToolRun", { parts: [p] }, true);
    assert.ok(html.includes("aria-expanded=\"true\""), "rendered expanded");
    assert.equal(html.split(esc(TOOL_CLOSE_TEXT)).length - 1, 1, `the § 9.1 text once, word for word: ${html}`);
    assert.equal((html.match(/class="tool-run-row"/g) ?? []).length, 1, "one row");
    assert.ok(!html.includes("Strong fit because"), "the partial arguments are not shown as the input");
  }

  const err = message.parts.filter((p: any) => p.type === "data-error");
  assert.deepEqual(err.map((p: any) => p.data), [{ code: "cut_off", message: CUT_OFF_MESSAGE, retryable: true }], "the cut_off part survives assembly");
  const html = render("ErrorPart.tsx", "ErrorPart", { data: err[0].data });
  assert.ok(html.includes(esc(CUT_OFF_MESSAGE)));
});

// ------------------------------------------------------------ types

test("(vii) apps/web's ErrorCode names every code packages/agent can send (cut_off included)", () => {
  const codes = (file: string) => {
    const src = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    const m = src.match(/export type ErrorCode\s*=([\s\S]*?);/);
    assert.ok(m, `${file}: ErrorCode`);
    return [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
  };
  const web = codes("../../apps/web/src/types.ts");
  const agent = codes("../../packages/agent/src/types.ts");
  assert.ok(web.includes("cut_off"));
  assert.deepEqual(web, agent);
});

test("(vii) apps/web typechecks (tsc -b --noEmit)", () => {
  const tsc = new URL("node_modules/typescript/bin/tsc", WEB).pathname;
  const r = spawnSync(process.execPath, [tsc, "-b", "--noEmit"], { cwd: WEB.pathname, encoding: "utf8" });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
});
