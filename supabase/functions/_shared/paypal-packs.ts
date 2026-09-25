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

/** The reverse of `packAmountUsd`: the pack id a gross amount belongs to —
 * undefined when it isn't exactly one of PACKS's own decimal strings. Used
 * at capture/webhook time (F1, fix round 2) to recover which pack an
 * already-created order/capture was for, so the invoice-id tag (bound to
 * uid + pack + amount) can be re-verified from the resource alone. */
export function packForAmount(amountValue: string): PackId | undefined {
  for (const [pack, amount] of Object.entries(PACKS)) {
    if (amount === amountValue) return pack as PackId;
  }
  return undefined;
}

/** § 17.1 step 2: `custom_id: "ten:<uid>"`. */
export function customIdFor(uid: string): string {
  return `ten:${uid}`;
}

// F6 (fix round 2, lead ruling): the uid portion must be EXACTLY a
// lowercase UUID — no surrounding whitespace, no trailing text, no case
// variants. `$` alone is not enough here: JS regex `$` (no `m` flag) also
// matches immediately before a single trailing "\n", so a customId ending
// in a newline would otherwise slip through — the explicit length check
// below closes that gap (uidFromCustomId's own test: `ten:<uid>\n` must be
// refused, not silently accepted as valid).
const CUSTOM_ID_RE = /^ten:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const TEN_CUSTOM_ID_LENGTH = 4 + 36; // "ten:" + a 36-char UUID string

/** The uid embedded in a `ten:<uid>` custom_id, or undefined for anything
 * else (a bare UUID from the older app, another prefix, wrong case,
 * trailing/leading text or whitespace, empty). */
export function uidFromCustomId(customId: string): string | undefined {
  const s = customId ?? "";
  if (s.length !== TEN_CUSTOM_ID_LENGTH) return undefined;
  const m = CUSTOM_ID_RE.exec(s);
  return m ? m[1] : undefined;
}

/** True when `amountValue` (PayPal's own decimal string) is exactly one of
 * PACKS's values and `currencyCode` is USD. */
export function isPackAmount(amountValue: string, currencyCode: string): boolean {
  if (currencyCode !== "USD") return false;
  return Object.values(PACKS).includes(amountValue);
}

export interface BreakdownLike {
  grossUsd: string | null;
  feeUsd: string | null;
  netUsd: string | null;
  currencyCode: string;
}

// F4 (fix round 2): a positive, exactly-two-decimal-place USD string —
// "10.00" but not "10", "10.0", "10.001" or a negative/zero value. Values
// coming from `_shared/paypal.ts`'s `captureInfoFrom` are already `null`
// unless each breakdown LINE's own `currency_code` was independently "USD"
// (F5) — this only re-checks shape and sign, never re-derives currency.
const TWO_DECIMAL_POSITIVE = /^\d+\.\d{2}$/;

function centsOf(v: string): number {
  return Math.round(Number(v) * 100);
}

/** F4 (fix round 2): true only when gross/fee/net are each present, a
 * positive two-decimal USD string, on a known pack's gross amount, with
 * net = gross − fee EXACTLY (computed in integer cents, never float —
 * mirrors the migration's own `ten_usage_ledger_paypal_breakdown` check,
 * so a capture that would violate the DB constraint is caught here first,
 * before the insert, with its own ALERT log line rather than a raw 400
 * bubbling up as "paid_not_credited" with no diagnosis). */
export function breakdownIsSane<T extends BreakdownLike>(
  b: T,
): b is T & { grossUsd: string; feeUsd: string; netUsd: string } {
  if (typeof b.grossUsd !== "string" || typeof b.feeUsd !== "string" || typeof b.netUsd !== "string") return false;
  if (
    !TWO_DECIMAL_POSITIVE.test(b.grossUsd) ||
    !TWO_DECIMAL_POSITIVE.test(b.feeUsd) ||
    !TWO_DECIMAL_POSITIVE.test(b.netUsd)
  ) {
    return false;
  }
  const gross = centsOf(b.grossUsd);
  const fee = centsOf(b.feeUsd);
  const net = centsOf(b.netUsd);
  if (gross <= 0 || fee <= 0 || net <= 0) return false;
  if (gross - fee !== net) return false;
  return isPackAmount(b.grossUsd, b.currencyCode);
}
