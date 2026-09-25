// Tester-owned: § 11.9 (xii) "UI § 1.8–1.9 word for word, by saved state" and
// § 12.3 (vii) "the message and nextStep word for word" — every sentence read
// from docs/design-web-ui.md and docs/design-web-agent.md (6641e1a), each
// component rendered from apps/web's own source.
// Run: node --test tests/web/conversation-copy.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const WEB = new URL("../../apps/web/", import.meta.url);
const req = createRequire(new URL("package.json", WEB));
const UI = readFileSync(new URL("../../docs/design-web-ui.md", import.meta.url), "utf8").replace(/\s+/g, " ");
const C = readFileSync(new URL("../../docs/design-web-agent.md", import.meta.url), "utf8").replace(/\s+/g, " ");
const q = (hay: string, re: RegExp) => {
  const m = hay.match(re);
  assert.ok(m, `spec sentence not found: ${re}`);
  return m![1];
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

function render(file: string, exportName: string, props: any): string {
  const ts = req("typescript");
  const src = readFileSync(new URL(`src/${file}`, WEB), "utf8");
  const out = ts.transpileModule(src, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod: any = { exports: {} };
  new Function("require", "exports", "module", out)(req, mod.exports, mod);
  const React = req("react");
  return req("react-dom/server").renderToStaticMarkup(React.createElement(mod.exports[exportName], props));
}
const paras = (html: string) => [...html.matchAll(/<p class="([^"]+)">([^<]*)<\/p>/g)].map((m) => [m[1], m[2]]);

// ------------------------------------------------------------------ § 12 too_large (vii)

test("§ 12.3 (vii): ErrorPart renders too_large's fixed message and its next-step line, word for word, plus the retryable line", () => {
  const MSG = q(C, /Message, fixed: "(This turn got too big to send[^"]+)"/);
  const S27 = UI.slice(UI.indexOf("**Amended 2026-09-24 (C § 12).**"));
  const NEXT = q(S27, /`nextStep` line: "([^"]+)"/);
  assert.equal(MSG, "This turn got too big to send, so it stopped partway.");
  const html = render("components/ErrorPart.tsx", "ErrorPart", { data: { code: "too_large", message: MSG, retryable: true } });
  assert.deepEqual(paras(html), [["card-body", esc(MSG)], ["card-meta", esc(NEXT)], ["card-meta", "This can be retried."]], html);
  assert.ok(!/Request too large/.test(html), "never the proxy's own sentence");
});

// ------------------------------------------------------------------ § 1.8 by saved state

const S18 = UI.slice(UI.indexOf("### 1.8 A newer version is live"), UI.indexOf("### 1.9"));
const NEWER = q(S18, /Notice, with a `Reload` button: "([^"]+)"/);
const BLOCKED = q(S18, /After a blocked send \(C § 10\.3\): "([^"]+)"/);
const FAILED_END = q(S18, /both lines end instead with: "([^"]+)"/);
const SAVED_END = "Your files and this conversation are saved.";

test("§ 1.8 (amended): both notice lines end 'Your files and this conversation are saved.' when the save held", () => {
  assert.ok(NEWER.endsWith(SAVED_END) && BLOCKED.endsWith(SAVED_END), "the spec's own lines");
  for (const [mode, want] of [["newer", NEWER], ["blocked", BLOCKED]] as const) {
    const html = render("real/VersionNotice.tsx", "VersionNotice", { mode, saveFailed: false });
    assert.ok(html.includes(`<p class="version-notice-text">${esc(want)}</p>`), `${mode}: ${html}`);
  }
});

test("§ 1.8 (amended): after a failed save both lines end with the failed ending instead, word for word", () => {
  for (const [mode, line] of [["newer", NEWER], ["blocked", BLOCKED]] as const) {
    const want = line.slice(0, line.length - SAVED_END.length) + FAILED_END;
    const html = render("real/VersionNotice.tsx", "VersionNotice", { mode, saveFailed: true });
    assert.ok(html.includes(`<p class="version-notice-text">${esc(want)}</p>`), `${mode}: ${html}`);
    assert.ok(!html.includes(SAVED_END), "never both endings");
  }
});

// ------------------------------------------------------------------ § 1.9

const S19 = UI.slice(UI.indexOf("### 1.9 The saved conversation"), UI.indexOf("## 2. The card catalog"));
const LINES: Array<[string, string]> = [
  ["older-dropped", q(S19, /\*\*Older turns not kept\*\* \(C § 11\.4\), at the top of the restored transcript: "([^"]+)"/)],
  ["save-failed", q(S19, /\*\*A save failed\*\* \(C § 11\.4\): "([^"]+)"/)],
  ["stale-blocked", q(S19, /\*\*Stale tab, before a send\*\* \(C § 11\.5; the message is not sent and its text stays in the composer\): "([^"]+)"/)],
  ["save-conflict", q(S19, /\*\*Save conflict\*\* \(C § 11\.5\): "([^"]+)"/)],
];
for (const [kind, line] of LINES) {
  test(`§ 1.9: the ${kind} line, word for word, neutral (role status, no error styling)`, () => {
    const html = render("real/ConversationNotice.tsx", "ConversationNotice", { kind });
    assert.ok(html.includes(`>${esc(line)}</p>`), html);
    assert.ok(/role="status"/.test(html));
    assert.ok(!/error|danger|alert/.test(html.replace(/role="status"/, "")), `neutral: ${html}`);
  });
}
