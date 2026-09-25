import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { customIdFor, isKnownPack, isPackAmount, packAmountUsd, PACKS, uidFromCustomId } from "./paypal-packs.ts";

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

Deno.test("customIdFor / uidFromCustomId round-trip; anything else is undefined", () => {
  assertEquals(customIdFor("abc-123"), "ten:abc-123");
  assertEquals(uidFromCustomId("ten:abc-123"), "abc-123");
  assertEquals(uidFromCustomId("550e8400-e29b-41d4-a716-446655440000"), undefined);
  assertEquals(uidFromCustomId("tenant:abc"), undefined);
  assertEquals(uidFromCustomId(""), undefined);
});

Deno.test("isPackAmount: exact match on value AND currency", () => {
  assert(isPackAmount("10.00", "USD"));
  assert(isPackAmount("40.00", "USD"));
  assertFalse(isPackAmount("10.00", "EUR"));
  assertFalse(isPackAmount("10.01", "USD"));
  assertFalse(isPackAmount("5.00", "USD"));
});
