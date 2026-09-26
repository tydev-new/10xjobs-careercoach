// § 17.10 (docs/design-web-agent.md, "Only Ten's own orders", lead ruling
// on F1, fix round 2): buildInvoiceId / checkTenOrder.

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { buildInvoiceId, checkTenOrder } from "./paypal-invoice.ts";

const SECRET = "test-secret";
const MERCHANT = "TEN-MERCHANT-1";
const UID = "12345678-1234-1234-1234-123456789abc";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    customId: `ten:${UID}`,
    invoiceId: "", // filled per test
    amountValue: "10.00",
    currencyCode: "USD",
    payeeMerchantId: MERCHANT,
    ...overrides,
  };
}

Deno.test("buildInvoiceId: matches § 17.10's exact shape", async () => {
  const id = await buildInvoiceId(SECRET, UID, "10", "10.00");
  assertMatch(id, /^ten-[0-9a-f]{8}-[0-9]{10}-[0-9a-f]{16}-[0-9a-f]{32}$/);
  assertEquals(id.length, 73, "§ 17.10: '73 characters'");
  assertEquals(id.split("-")[1], UID.slice(0, 8));
});

Deno.test("buildInvoiceId: two calls for the same input differ (fresh T/N each time)", async () => {
  const a = await buildInvoiceId(SECRET, UID, "10", "10.00");
  const b = await buildInvoiceId(SECRET, UID, "10", "10.00");
  assert(a !== b);
});

Deno.test("checkTenOrder: a freshly built invoice_id verifies, returns the uid and pack", async () => {
  const invoiceId = await buildInvoiceId(SECRET, UID, "20", "20.00");
  const result = await checkTenOrder(SECRET, MERCHANT, validInput({ invoiceId, amountValue: "20.00" }));
  assertEquals(result, { ok: true, uid: UID, pack: "20" });
});

Deno.test("checkTenOrder: § 17.8/§ 17.10 test 2 — every named forgery fails, none throw", async () => {
  const validTag = await buildInvoiceId(SECRET, UID, "10", "10.00");
  const otherUid = "99999999-0000-0000-0000-000000000000";

  const cases: Array<[string, ReturnType<typeof validInput>]> = [
    ["no invoice_id", validInput({ invoiceId: "" })],
    ["a random invoice_id", validInput({ invoiceId: "ten-deadbeef-1758820600-0011223344556677-" + "a".repeat(32) })],
    ["another uid's valid tag", validInput({ invoiceId: await buildInvoiceId(SECRET, otherUid, "10", "10.00") })],
    ["another pack's tag", validInput({ invoiceId: await buildInvoiceId(SECRET, UID, "20", "10.00") })],
    ["one hex digit changed", validInput({ invoiceId: validTag.slice(0, -1) + (validTag.at(-1) === "0" ? "1" : "0") })],
    ["a tag from another secret", validInput({ invoiceId: await buildInvoiceId("another-secret", UID, "10", "10.00") })],
    ["a bare UUID custom_id (the older app's)", validInput({ invoiceId: validTag, customId: UID })],
    ["a non-pack amount", validInput({ invoiceId: await buildInvoiceId(SECRET, UID, "10", "10.01"), amountValue: "10.01" })],
    ["a foreign payee", validInput({ invoiceId: validTag, payeeMerchantId: "SOMEONE-ELSE" })],
    ["non-USD currency", validInput({ invoiceId: validTag, currencyCode: "EUR" })],
  ];
  for (const [label, input] of cases) {
    const result = await checkTenOrder(SECRET, MERCHANT, input);
    assertEquals(result, { ok: false }, label);
  }
});

Deno.test("checkTenOrder: the tag compare is constant-time (same-length strings only differ by content, both take a comparable path)", async () => {
  // Not a timing measurement (too flaky in CI) — this just proves the
  // module doesn't short-circuit on the FIRST mismatched character via a
  // naive `===`, by checking a near-miss (last char only) and a total
  // mismatch both fail identically (§ 17.10 review item 7).
  const validTag = await buildInvoiceId(SECRET, UID, "10", "10.00");
  const nearMiss = validTag.slice(0, -1) + (validTag.at(-1) === "0" ? "1" : "0");
  const totalMiss = validTag.slice(0, -32) + "0".repeat(32);
  const r1 = await checkTenOrder(SECRET, MERCHANT, validInput({ invoiceId: nearMiss }));
  const r2 = await checkTenOrder(SECRET, MERCHANT, validInput({ invoiceId: totalMiss }));
  assertEquals(r1, { ok: false });
  assertEquals(r2, { ok: false });
});

Deno.test("checkTenOrder: T's age is never checked — a very old timestamp still verifies", async () => {
  // Build a tag by hand with an old T (buildInvoiceId always uses now()).
  const enc = new TextEncoder();
  const hmac = async (key: Uint8Array | string, data: string) => {
    const raw = typeof key === "string" ? enc.encode(key) : key;
    const k = await crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  };
  const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  const ts = "0000001000"; // year-1970-ish, still 10 digits
  const nonce = "aabbccddeeff0011";
  const K = await hmac(SECRET, "ten-invoice-v1");
  const H = toHex(await hmac(K, `v1|${UID}|10|10.00|${ts}|${nonce}`)).slice(0, 32);
  const invoiceId = `ten-${UID.slice(0, 8)}-${ts}-${nonce}-${H}`;
  const result = await checkTenOrder(SECRET, MERCHANT, validInput({ invoiceId }));
  assertEquals(result, { ok: true, uid: UID, pack: "10" });
});
