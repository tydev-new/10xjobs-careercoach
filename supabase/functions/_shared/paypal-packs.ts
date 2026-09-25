// Shared between ten-paypal and ten-paypal-webhook (docs/design-web-agent.md
// § 17.1/§ 17.3): the server-side credit-pack table and the `ten:<uid>`
// custom_id shape. Pure, no side effects — both functions' pre-credit
// checks read from the SAME table, so a capture only ever credits an
// amount this file names.

/** § 17: "packs of $10, $20, $40; the $5 starter stays" — the $5 starter is
 * never purchasable here (it's the owner's initial credit insert, the
 * init migration), only these three. The only thing the client ever sends
 * is the PACK ID ("10"|"20"|"40"); the amount charged/credited always comes
 * from THIS table, never from a request body or a webhook payload. */
export const PACKS: Readonly<Record<string, string>> = {
  "10": "10.00",
  "20": "20.00",
  "40": "40.00",
};

export type PackId = keyof typeof PACKS;

export function isKnownPack(pack: unknown): pack is PackId {
  return typeof pack === "string" && Object.prototype.hasOwnProperty.call(PACKS, pack);
}

/** The pack's amount, as PayPal's own decimal string — undefined for an
 * unknown/missing pack id. */
export function packAmountUsd(pack: unknown): string | undefined {
  return isKnownPack(pack) ? PACKS[pack] : undefined;
}

/** § 17.1 step 2: `custom_id: "ten:<uid>"`. */
export function customIdFor(uid: string): string {
  return `ten:${uid}`;
}

const CUSTOM_ID_RE = /^ten:(.+)$/;

/** The uid embedded in a `ten:<uid>` custom_id, or undefined for anything
 * else (a bare UUID from the older app, another prefix, empty). */
export function uidFromCustomId(customId: string): string | undefined {
  const m = CUSTOM_ID_RE.exec(customId ?? "");
  return m ? m[1] : undefined;
}

/** True when `amountValue` (PayPal's own decimal string) is exactly one of
 * PACKS's values and `currencyCode` is USD. */
export function isPackAmount(amountValue: string, currencyCode: string): boolean {
  if (currencyCode !== "USD") return false;
  return Object.values(PACKS).includes(amountValue);
}
