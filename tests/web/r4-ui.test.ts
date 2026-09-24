// Tester-owned: the r4 UI rules, derived from docs/design-web-agent.md § 8
// and docs/design-web-ui.md § 1.1, § 1.5, § 2.5, § 2.7 — not from the code.
// Run: node --test tests/web/r4-ui.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { formatBalanceUsd, formatUsd } from "../../apps/web/src/format.ts";

const WEB = new URL("../../apps/web/", import.meta.url);
const req = createRequire(new URL("package.json", WEB));

// ---- § 8 / ui § 1.1: the chip rounds DOWN to cents; at or below zero reads $0.00
const CHIP: Array<[number, string]> = [
  [5, "5.00"],
  [4.999, "4.99"],
  [4.999999, "4.99"], // numeric(12,6) resolution: still never rounds up
  [4.2, "4.20"],
  [0.29, "0.29"], // 0.29*100 = 28.999999999999996 in floating point
  [1.005, "1.00"],
  [19.99, "19.99"],
  [123.456789, "123.45"],
  [0.01, "0.01"],
  [0.009999, "0.00"],
  [1e-7, "0.00"],
  [0, "0.00"],
  [-0, "0.00"],
  [-0.000001, "0.00"],
  [-0.5, "0.00"],
  [-12.34, "0.00"],
];
for (const [n, want] of CHIP) {
  test(`chip: formatBalanceUsd(${n}) -> "${want}" (round down, clamp at 0)`, () => {
    assert.equal(formatBalanceUsd(n), want);
  });
}
test("chip: never shows more than the balance, over a sweep of 6-decimal values", () => {
  for (let micro = -2_000_000; micro <= 6_000_000; micro += 1_337) {
    const n = micro / 1e6;
    const shown = Number(formatBalanceUsd(n));
    assert.ok(shown <= Math.max(0, n) + 1e-12, `${n} shown as ${shown}`);
    assert.ok(shown >= 0);
    assert.ok(Math.max(0, n) - shown < 0.01 + 1e-9, `${n} shown as ${shown} (more than a cent low)`);
  }
});
test("cost card formatting is unchanged (ui § 2.6: no rounding): formatUsd(0.6) = 0.60, 0.567 kept", () => {
  assert.equal(formatUsd(0.6), "0.60");
  assert.equal(formatUsd(0.567), "0.567");
});

// ---- ui § 2.7: data-error rendered as carried; nextStep only for tool_error/offline/step_cap
function renderErrorPart(data: unknown): string {
  const ts = req("typescript");
  const src = readFileSync(new URL("src/components/ErrorPart.tsx", WEB), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod: any = { exports: {} };
  new Function("require", "exports", "module", out)(req, mod.exports, mod);
  const React = req("react");
  const { renderToStaticMarkup } = req("react-dom/server");
  return renderToStaticMarkup(React.createElement(mod.exports.ErrorPart, { data }));
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
const metas = (html: string) => [...html.matchAll(/<p class="card-meta">([^<]*)<\/p>/g)].map((m) => m[1]);

const OVER = "Your beta credit is used up. Ask the person who invited you for more.";
const CEILING = "The beta has reached today's limit. Try again tomorrow.";
// The proxy's other real model_error sentence (handler.ts MESSAGES.modelError). The old
// cut-off model_error sentence is retired: a cut-off is its own code, cut_off (§ 9.3).
const UNAVAILABLE = "The model is temporarily unavailable. Try again.";

test("error card: over_balance shows the proxy's sentence verbatim and NO extra next-step line", () => {
  const html = renderErrorPart({ code: "over_balance", message: OVER, retryable: false });
  assert.ok(html.includes(`<p class="card-body">${esc(OVER)}</p>`), html);
  assert.deepEqual(metas(html), []);
  assert.ok(!/add funds/i.test(html));
});
for (const [label, msg, retryable] of [["beta ceiling", CEILING, false], ["upstream unavailable", UNAVAILABLE, true]] as const) {
  test(`error card: model_error (${label}) shows its own sentence verbatim, no static next-step`, () => {
    const html = renderErrorPart({ code: "model_error", message: msg, retryable });
    assert.ok(html.includes(`<p class="card-body">${esc(msg)}</p>`), html);
    assert.deepEqual(metas(html), retryable ? ["This can be retried."] : []);
    assert.ok(!/try again in a moment/i.test(html));
  });
}
// ui § 2.7 as amended again 2026-09-24 (issue #2 round 2) + C § 9.8 (xii):
// step_cap's message and next-step line, read from the docs themselves.
const UI_DOC = readFileSync(new URL("../../docs/design-web-ui.md", import.meta.url), "utf8").replace(/\s+/g, " ");
const UI_27 = UI_DOC.slice(UI_DOC.indexOf("### 2.7 `data-error`"), UI_DOC.indexOf("## 3. The collapsed"));
const STEP_CAP_NEXT = UI_27.match(/`nextStep` line: "([^"]+)"/)?.[1] ?? "(nextStep line not found in design-web-ui.md § 2.7)";
const STEP_CAP_MSG = UI_27.match(/message, fixed \(C § 6\.1\): "([^"]+)"/)?.[1] ?? "(message not found in design-web-ui.md § 2.7)";
const C_DOC = readFileSync(new URL("../../docs/design-web-agent.md", import.meta.url), "utf8").replace(/\s+/g, " ");
test("ui § 2.7 / C § 6.1 / C § 9.8 (xii): the step_cap sentences agree across the docs", () => {
  assert.equal(STEP_CAP_NEXT, "Say continue to carry on from what's already saved.");
  assert.equal(STEP_CAP_MSG, "This turn ran out of steps before finishing.");
  assert.ok(C_DOC.includes(`has a fixed message, "${STEP_CAP_MSG}"`), "C § 6.1 carries the same message");
  assert.ok(C_DOC.includes(`The UI adds the line "${STEP_CAP_NEXT}"`), "C § 6.1 carries the same line");
  assert.ok(C_DOC.includes(`the next-step line "${STEP_CAP_NEXT}" word for word`), "C § 9.8 (xii) carries the same line");
});
for (const [code, next] of [
  ["tool_error", "A tool call failed."],
  ["offline", "Check your connection and try again."],
  ["step_cap", STEP_CAP_NEXT],
] as const) {
  test(`error card: ${code} shows its next-step line (§ 2.7 as amended)`, () => {
    const html = renderErrorPart({ code, message: "x", retryable: false });
    assert.deepEqual(metas(html), [esc(next)]);
  });
}
test("(xii) error card: step_cap shows the message and the next-step line word for word; no line mentions a gate or promises what the agent will do", () => {
  const html = renderErrorPart({ code: "step_cap", message: STEP_CAP_MSG, retryable: true });
  assert.ok(html.includes(`<p class="card-body">${esc(STEP_CAP_MSG)}</p>`), html);
  assert.deepEqual(metas(html), [esc(STEP_CAP_NEXT), "This can be retried."]);
  const lines = [...html.matchAll(/<p class="card-(?:body|meta)">([^<]*)<\/p>/g)].map((m) => m[1]);
  assert.equal(lines.length, 3, "message, next-step line, retryable line");
  for (const line of lines) {
    assert.ok(!/\bgate\b|type yes|\byes\b/i.test(line), `mentions a gate: ${line}`);
    // L2 (ErrorPart.tsx; C § 9.3): what happened / what the candidate can do, never what the agent will do.
    assert.ok(!/\bwill\b|\bI(?:'|&#x27;)ll\b|\bwe(?:'|&#x27;)ll\b|\bpick up where\b|\bI(?:'|&#x27;)m going\b|\bTen (?:will|is going)/i.test(line), `promises agent behaviour: ${line}`);
  }
});

// ---- ui § 2.5 / fixture: over_balance is a pre-call refusal -> no model reply after it
test("over-limit-error.json: the proxy's exact over_balance sentence, and nothing after it", () => {
  const fx = JSON.parse(readFileSync(new URL("fixtures/over-limit-error.json", WEB), "utf8"));
  const last = fx.messages.at(-1);
  assert.equal(last.role, "assistant");
  const parts = last.parts;
  const i = parts.findIndex((p: any) => p.type === "data-error");
  assert.ok(i >= 0, "no data-error");
  assert.deepEqual(parts[i].data, { code: "over_balance", message: OVER, retryable: false });
  assert.equal(i, parts.length - 1, "parts after the refusal: " + JSON.stringify(parts.slice(i + 1).map((p: any) => p.type)));
  assert.ok(!parts.some((p: any) => p.type.startsWith("tool-") && p.state === "output-error"), "an upstream-rejected tool call implies the call was forwarded");
});
test("empty-first-run.json: a member starts at $5 (ui § 1.5)", () => {
  const fx = JSON.parse(readFileSync(new URL("fixtures/empty-first-run.json", WEB), "utf8"));
  assert.equal(formatBalanceUsd(fx.meta.startingBalanceUsd), "5.00");
});

// ---- ui § 1.1: "Manage your usage key" is gone from the product
// Comments are stripped first: a comment recording the removal is not product text.
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
test('"usage key" appears in no product text in apps/web/src or index.html', () => {
  const hits: string[] = [];
  const walk = (u: URL) => {
    for (const f of readdirSync(u)) {
      const c = new URL(f, u);
      if (statSync(c).isDirectory()) walk(new URL(f + "/", u));
      else if (/usage key/i.test(noComments(readFileSync(c, "utf8")))) hits.push(c.pathname);
    }
  };
  walk(new URL("src/", WEB));
  if (/usage key/i.test(readFileSync(new URL("index.html", WEB), "utf8"))) hits.push("index.html");
  assert.deepEqual(hits, []);
});
