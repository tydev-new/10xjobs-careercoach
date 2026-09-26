import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { breakdownIsSane, customIdFor, isKnownPack, isPackAmount, packAmountUsd, packForAmount, PACKS, uidFromCustomId } from "./paypal-packs.ts";

Deno.test("PACKS: exactly the three approved packs, § 17's own amounts", () => {
  assertEquals(PACKS, { "10": "10.00", "20": "20.00", "40": "40.00" });
});

Deno.test("isKnownPack / packAmountUsd: known packs only, the $5 starter is not purchasable here", () => {
  assert(isKnownPack("10"));
  assert(isKnownPack("20"));
  assert(isKnownPack("40"));
  assertFalse(isKnownPack("5"));
  assertFalse(isKnownPack("999"));
  assertFalse(isKnownPack(undefined));
  assertFalse(isKnownPack(10));
  assertEquals(packAmountUsd("10"), "10.00");
  assertEquals(packAmountUsd("5"), undefined);
  assertEquals(packAmountUsd(undefined), undefined);
});

Deno.test("customIdFor / uidFromCustomId round-trip on a real UUID; anything else is undefined (F6, fix round 2)", () => {
  const uid = "550e8400-e29b-41d4-a716-446655440000";
  assertEquals(customIdFor(uid), `ten:${uid}`);
  assertEquals(uidFromCustomId(`ten:${uid}`), uid);
  assertEquals(uidFromCustomId(uid), undefined, "a bare UUID (the older app's) is not a ten: id");
  assertEquals(uidFromCustomId("tenant:abc"), undefined);
  assertEquals(uidFromCustomId(""), undefined);
  // F6: the strict shape — no short/non-UUID uid, no case variant, no
  // surrounding whitespace or trailing text.
  assertEquals(uidFromCustomId("ten:abc-123"), undefined, "not a UUID at all");
  assertEquals(uidFromCustomId(`ten:${uid.toUpperCase()}`), undefined, "uppercase");
  assertEquals(uidFromCustomId(`ten:${uid} `), undefined, "trailing space");
  assertEquals(uidFromCustomId(` ten:${uid}`), undefined, "leading space");
  assertEquals(uidFromCustomId(`ten:${uid}:extra`), undefined, "trailing text");
  assertEquals(uidFromCustomId(`ten:${uid}\n`), undefined, "trailing newline (the JS regex $ gotcha)");
  assertEquals(uidFromCustomId(`TEN:${uid}`), undefined, "uppercase prefix");
});

Deno.test("isPackAmount: exact match on value AND currency", () => {
  assert(isPackAmount("10.00", "USD"));
  assert(isPackAmount("40.00", "USD"));
  assertFalse(isPackAmount("10.00", "EUR"));
  assertFalse(isPackAmount("10.01", "USD"));
  assertFalse(isPackAmount("5.00", "USD"));
});

Deno.test("packForAmount: the reverse of packAmountUsd", () => {
  assertEquals(packForAmount("10.00"), "10");
  assertEquals(packForAmount("20.00"), "20");
  assertEquals(packForAmount("40.00"), "40");
  assertEquals(packForAmount("5.00"), undefined);
  assertEquals(packForAmount("10.01"), undefined);
});

const OK = { grossUsd: "10.00", feeUsd: "0.84", netUsd: "9.16", currencyCode: "USD" };

Deno.test("F4/R2-1 (fix round 3): breakdownIsSane — net = gross - fee in whole cents, gross/net POSITIVE, fee >= 0 (§ 17.3), two decimals, gross a pack, all USD", () => {
  assert(breakdownIsSane(OK));
  assertFalse(breakdownIsSane({ ...OK, netUsd: "9.17" }), "net off by a cent");
  assertFalse(breakdownIsSane({ ...OK, currencyCode: "EUR" }), "not USD");
  assertFalse(breakdownIsSane({ ...OK, grossUsd: "9.99" }), "gross not a pack amount");
  assertFalse(breakdownIsSane({ ...OK, grossUsd: null }), "missing gross");
  assertFalse(breakdownIsSane({ ...OK, feeUsd: null }), "missing fee");
  assertFalse(breakdownIsSane({ ...OK, netUsd: null }), "missing net");
  assertFalse(breakdownIsSane({ ...OK, feeUsd: "0" }), "not exactly two decimals");
  // R2-1 (fix round 3): the independent tester's finding — § 17.3 allows
  // `fee_usd >= 0` and § 17.10 only requires `net == gross - fee`; a
  // genuine $0-fee capture (gross 10.00, fee 0.00, net 10.00) must be
  // CREDITED, not refused as "insane". This was the opposite assertion
  // before the fix (asserted False); flipped here to match the corrected
  // behavior, verified against the migration's own check in
  // tests/sql/r8-paypal.mjs and the independent tester's
  // tests/functions/paypal_r2.test.ts.
  assert(breakdownIsSane({ ...OK, feeUsd: "0.00", netUsd: "10.00" }), "a zero fee IS sane (§ 17.3: fee_usd >= 0)");
  assertFalse(breakdownIsSane({ ...OK, grossUsd: "0.00", feeUsd: "-0.84", netUsd: "0.84" }), "a negative fee (and a zero gross)");
  // A negative fee alone (gross/net still valid) — isolates the `fee < 0`
  // branch from the "zero gross" branch the case above also trips.
  assertFalse(breakdownIsSane({ grossUsd: "10.00", feeUsd: "-0.84", netUsd: "10.84", currencyCode: "USD" }), "a negative fee, gross/net otherwise fine");
  assertFalse(breakdownIsSane({ ...OK, netUsd: "0.00", grossUsd: "0.84", feeUsd: "0.84" }), "a zero net is not > 0");
  assertFalse(breakdownIsSane({ ...OK, grossUsd: "0.00", feeUsd: "0.00", netUsd: "0.00" }), "a zero gross is not > 0, even with a zero fee");
});
