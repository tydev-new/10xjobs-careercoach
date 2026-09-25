// Tester-owned: docs/design-web-agent.md § 17.6 — "/privacy.html gains
// 'Payments go through PayPal': you pay in PayPal's window; Ten never sees
// your card or login; PayPal gets an internal account id; Ten keeps the
// amount, fee and PayPal's transaction id, nothing else; records survive a
// delete." Each clause checked from the spec, not the page's own wording.
// Run: node --test tests/web/paypal-privacy.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../../apps/web/public/privacy.html", import.meta.url), "utf8");
const section = (() => {
  const i = html.indexOf("<h2>Payments go through PayPal</h2>");
  assert.ok(i >= 0, "the section heading 'Payments go through PayPal'");
  const j = html.indexOf("<h2>", i + 5);
  return html.slice(i, j === -1 ? undefined : j).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
})();

test("§ 17.6 privacy: the 'Payments go through PayPal' section exists", () => {
  assert.ok(section.length > 40, section);
});
test("§ 17.6 privacy: you pay in PayPal's window", () => {
  assert.match(section, /PayPal's (own )?window/i);
});
test("§ 17.6 privacy: Ten never sees your card or your login", () => {
  assert.match(section, /never sees your card/i);
  assert.match(section, /login/i);
});
test("§ 17.6 privacy: PayPal GETS an internal account id (from Ten) — the direction the data flows", () => {
  // What leaves Ten is its own internal account id (custom_id ten:<uid>) —
  // PayPal receives it. A sentence saying PayPal gives Ten an id reverses
  // the disclosure of what Ten sends to a third party.
  assert.doesNotMatch(section, /PayPal[^.]*gives Ten an internal account id/i, `reversed: ${section}`);
  assert.match(section, /(PayPal (gets|receives)|(Ten )?(gives|sends|passes) PayPal)[^.]*internal account id/i, section);
});
test("§ 17.6 privacy: Ten keeps the amount, the fee and PayPal's transaction id, nothing else", () => {
  assert.match(section, /amount/i);
  assert.match(section, /fee/i);
  assert.match(section, /transaction id/i);
  assert.match(section, /nothing else/i);
});
test("§ 17.6 privacy: the records survive a delete", () => {
  assert.match(section, /surviv|stay|kept/i);
  assert.match(section, /delet/i);
});
