// Pure helpers for ten-paypal (docs/design-web-agent.md § 17.1): path
// routing and the capture idempotency key. The pack table and the
// `ten:<uid>` custom_id shape live in ../_shared/paypal-packs.ts (also used
// by ten-paypal-webhook) and are re-exported here so handler.ts/tests have
// one import to reach for. No side effects, no `window`/`document`/
// `localStorage`/`node:` API — testable with plain `deno test`.

export { customIdFor, isKnownPack, isPackAmount, packAmountUsd, PACKS, uidFromCustomId } from "../_shared/paypal-packs.ts";
export type { PackId } from "../_shared/paypal-packs.ts";

export function pathTail(url: URL): string {
  const marker = "/ten-paypal";
  const idx = url.pathname.indexOf(marker);
  return idx === -1 ? url.pathname : url.pathname.slice(idx + marker.length) || "/";
}

/** § 17.1 step 4: "PayPal-Request-Id: ten-capture-<orderId>". */
export function captureRequestId(orderId: string): string {
  return `ten-capture-${orderId}`;
}
