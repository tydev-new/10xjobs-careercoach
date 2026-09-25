// F1 (fix round 2, lead ruling): binds a PayPal order's own `invoice_id` to
// the exact member, pack and amount `ten-paypal/create-order` made it for,
// with an HMAC tag capture-order and the webhook both re-verify (constant
// time) from the order/capture resource itself before ever crediting.
//
// Why: without this, an order a browser creates DIRECTLY against PayPal's
// own API (never through create-order) can still be captured and credited
// as long as its custom_id happens to read exactly `ten:<a real member's
// uid>` — the independent tester's "SPEC GAP" case. Ten's own create-order
// controls the invoice_id; a forged/foreign order has no way to produce a
// tag that verifies, because it never had the secret.
//
// Shape: "ten-<uid's first hex group>-<unix seconds>-<32 hex char tag>".
//   tag = HMAC-SHA256(subkey, `${uid}|${pack}|${amountUsd}|${ts}`),
//         the first 32 hex chars (16 bytes) of the usual 64-hex-char digest.
//   subkey = HMAC-SHA256(TEN_PAYPAL_CLIENT_SECRET, "ten-invoice-v1") — a
//         purpose-specific subkey derived from the secret already read for
//         OAuth (no new secret is added or stored).
//
// Pure and side-effect-free beyond WebCrypto (`crypto.subtle`, available in
// both Deno and every modern browser) — no `window`/`document`/
// `localStorage`/`node:` API, so this file is safe wherever it's imported.

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

async function tagFor(clientSecret: string, uid: string, pack: string, amountUsd: string, ts: string): Promise<string> {
  const sk = await subkey(clientSecret);
  const full = toHex(await hmacRaw(sk, `${uid}|${pack}|${amountUsd}|${ts}`));
  return full.slice(0, 32);
}

/** A UUID's own first hyphen-delimited group (8 hex chars) — stable,
 * present on every Supabase auth uid, and short enough to keep invoice_id
 * well under PayPal's 127-char limit alongside the timestamp and tag. */
function uidPrefixOf(uid: string): string {
  return (uid.split("-")[0] ?? "").toLowerCase();
}

export async function buildInvoiceId(clientSecret: string, uid: string, pack: string, amountUsd: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const tag = await tagFor(clientSecret, uid, pack, amountUsd, ts);
  return `ten-${uidPrefixOf(uid)}-${ts}-${tag}`;
}

const INVOICE_RE = /^ten-([0-9a-f]{8})-(\d+)-([0-9a-f]{32})$/;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifies an order/capture's own `invoice_id` binds it to `uid` + `pack`
 * + `amountUsd` — the exact triple `create-order` signed, at the time
 * embedded in the invoice_id itself (the `ts` is part of the signed
 * message, not trusted on its own). Constant-time tag comparison; never
 * throws — a malformed/missing invoice_id or a uid-prefix mismatch just
 * fails the check without touching WebCrypto. */
export async function verifyInvoiceId(
  clientSecret: string,
  invoiceId: string | undefined,
  uid: string,
  pack: string,
  amountUsd: string,
): Promise<boolean> {
  const m = INVOICE_RE.exec(invoiceId ?? "");
  if (!m) return false;
  if (m[1] !== uidPrefixOf(uid)) return false;
  const expected = await tagFor(clientSecret, uid, pack, amountUsd, m[2]);
  return constantTimeEqual(expected, m[3]);
}
