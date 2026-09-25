// § 17.10 (docs/design-web-agent.md, "Only Ten's own orders", lead ruling
// on the independent tester's finding F1, fix round 2): binds a PayPal
// order's own `invoice_id` — and its payee — to the exact member, pack and
// amount `ten-paypal/create-order` made it for. `capture-order` and the
// webhook both re-verify this (constant time) from the order/capture
// resource itself before ever crediting.
//
// Why: without it, an order a browser creates DIRECTLY against PayPal's own
// API (never through create-order) can still be captured and credited as
// long as its custom_id happens to read exactly `ten:<a real member's
// uid>` — the independent tester's own "SPEC GAP" case. Ten's own
// create-order controls the invoice_id; a forged/foreign order has no way
// to produce a tag that verifies, because it never had the secret. The
// payee check closes a narrower residual (§ 17.10, "Open for the lead"): a
// member could mint a VALID tag through create-order, then build their own
// order in the browser carrying that same invoice_id/custom_id/amount but
// naming another merchant as payee.
//
// Shape (§ 17.10, 73 characters, PayPal allows 127):
//   ten-<U>-<T>-<N>-<H>, matching
//   ^ten-[0-9a-f]{8}-[0-9]{10}-[0-9a-f]{16}-[0-9a-f]{32}$
//     U: the caller's uid, first 8 characters (for reading PayPal's reports).
//     T: Unix time in seconds, 10 digits.
//     N: 8 random bytes, 16 lowercase hex characters — makes the id unique
//        before an order id exists (PayPal wants invoice_id unique).
//     H: the first 32 lowercase hex characters of
//        HMAC-SHA256(K, `v1|<uid>|<pack>|<amount>|<T>|<N>`), where `uid` is
//        the CALLER'S FULL lowercase UUID (not just U), `pack` is exactly
//        "10"/"20"/"40", and `amount` is the exact decimal string sent to
//        PayPal ("10.00").
//   K = HMAC-SHA256(TEN_PAYPAL_CLIENT_SECRET, "ten-invoice-v1"), the raw 32
//   bytes — a purpose-specific subkey derived from the secret already read
//   for OAuth (no new secret is added or stored).
//   T's age is never checked: a pending payment can clear days later.
//
// Pure and side-effect-free beyond WebCrypto (`crypto.subtle`, available in
// both Deno and every modern browser) — no `window`/`document`/
// `localStorage`/`node:` API, so this file is safe wherever it's imported.

import { customIdFor, isPackAmount, packForAmount, uidFromCustomId, type PackId } from "./paypal-packs.ts";

const enc = new TextEncoder();

async function hmacRaw(keyBytes: Uint8Array | string, data: string): Promise<Uint8Array> {
  const keyMaterial = typeof keyBytes === "string" ? enc.encode(keyBytes) : keyBytes;
  const key = await crypto.subtle.importKey("raw", keyMaterial as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function subkey(clientSecret: string): Promise<Uint8Array> {
  return hmacRaw(clientSecret, "ten-invoice-v1");
}

/** H: the first 32 lowercase hex chars of HMAC-SHA256(K, "v1|uid|pack|amount|T|N"). */
async function tagFor(clientSecret: string, uid: string, pack: string, amountUsd: string, ts: string, nonce: string): Promise<string> {
  const sk = await subkey(clientSecret);
  const full = toHex(await hmacRaw(sk, `v1|${uid.toLowerCase()}|${pack}|${amountUsd}|${ts}|${nonce}`));
  return full.slice(0, 32);
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** § 17.10: "create-order sets ten-<U>-<T>-<N>-<H>". */
export async function buildInvoiceId(clientSecret: string, uid: string, pack: string, amountUsd: string): Promise<string> {
  const u = uid.slice(0, 8).toLowerCase();
  const ts = Math.floor(Date.now() / 1000).toString().padStart(10, "0");
  const nonce = randomHex(8); // 8 bytes -> 16 hex chars
  const tag = await tagFor(clientSecret, uid, pack, amountUsd, ts, nonce);
  return `ten-${u}-${ts}-${nonce}-${tag}`;
}

const INVOICE_RE = /^ten-([0-9a-f]{8})-([0-9]{10})-([0-9a-f]{16})-([0-9a-f]{32})$/;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface TenOrderCheckInput {
  customId: string;
  invoiceId: string;
  amountValue: string;
  currencyCode: string;
  /** `purchase_units[0].payee.merchant_id` (an order) — read via the order
   *  behind a capture for the webhook's own check (§ 17.10, "Open for the
   *  lead", closed by the payee check). */
  payeeMerchantId: string;
}

export type TenOrderCheckResult = { ok: true; uid: string; pack: PackId } | { ok: false };

/** § 17.10's ONE shared check, run before any credit — by capture-order on
 * the order it read, and by the webhook on the re-fetched capture (plus the
 * order behind it, for the payee). Passes only when: `customId` is exactly
 * `ten:` + a lowercase UUID; the amount is USD and its value string equals
 * one pack's exactly (which gives `pack`); the payee's `merchant_id` is
 * Ten's own; `invoiceId` matches the pattern; `U` is the uid's first 8
 * characters; and the recomputed `H` equals the given one, compared in
 * constant time. Never throws. */
export async function checkTenOrder(
  clientSecret: string,
  merchantId: string,
  input: TenOrderCheckInput,
): Promise<TenOrderCheckResult> {
  const uid = uidFromCustomId(input.customId);
  if (!uid) return { ok: false };
  if (!isPackAmount(input.amountValue, input.currencyCode)) return { ok: false };
  const pack = packForAmount(input.amountValue);
  if (!pack) return { ok: false };
  if (input.payeeMerchantId !== merchantId) return { ok: false };
  const m = INVOICE_RE.exec(input.invoiceId ?? "");
  if (!m) return { ok: false };
  const [, u, ts, nonce, tag] = m;
  if (u !== uid.slice(0, 8).toLowerCase()) return { ok: false };
  const expected = await tagFor(clientSecret, uid, pack, input.amountValue, ts, nonce);
  if (!constantTimeEqual(expected, tag)) return { ok: false };
  return { ok: true, uid, pack };
}

// Re-exported so a caller that only needs the customId shape (no HMAC) can
// import it from this same module too, without reaching into paypal-packs.ts.
export { customIdFor };
