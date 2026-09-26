// supabase/functions/ten-paypal-webhook/index.ts
// Deploy-time entry point (docs/design-web-agent.md § 17.1 step 5). Logic
// lives in handler.ts, which imports no Deno/Edge-Runtime global. Deployed
// with `--no-verify-jwt` — PayPal calls this directly, with no Supabase
// session. NOT deployed by this change (see supabase/functions/README.md).

import { handleRequest, type WebhookDeps } from "./handler.ts";
import { getAccessToken, getCapture, getOrder, verifyWebhookSignature, type PayPalConfig } from "../_shared/paypal.ts";
import { checkTenOrder } from "../_shared/paypal-invoice.ts";
import { envFromDeno, insertLedgerCredit, isMemberByUid } from "../_shared/supabase.ts";

const env = envFromDeno((name) => Deno.env.get(name));

// § 17.6: same secrets as ten-paypal, shared. The functions refuse to
// start unless the base is exactly one of PayPal's two real hosts, and
// unless the client id/secret are set — both are needed for the signature
// verify call and the capture re-fetch REGARDLESS of whether
// TEN_PAYPAL_WEBHOOK_ID happens to be set yet (see below).
const paypalConfig: PayPalConfig = {
  apiBase: Deno.env.get("TEN_PAYPAL_API_BASE") ?? "",
  clientId: Deno.env.get("TEN_PAYPAL_CLIENT_ID") ?? "",
  clientSecret: Deno.env.get("TEN_PAYPAL_CLIENT_SECRET") ?? "",
};
const ALLOWED_API_BASES = ["https://api-m.sandbox.paypal.com", "https://api-m.paypal.com"];
if (!ALLOWED_API_BASES.includes(paypalConfig.apiBase)) {
  throw new Error(
    `ten-paypal-webhook: TEN_PAYPAL_API_BASE must be one of ${ALLOWED_API_BASES.join(", ")}, got ${JSON.stringify(paypalConfig.apiBase)}`,
  );
}
if (!paypalConfig.clientId || !paypalConfig.clientSecret) {
  throw new Error("ten-paypal-webhook: TEN_PAYPAL_CLIENT_ID/TEN_PAYPAL_CLIENT_SECRET must both be set");
}
// § 17.10's payee closure (lead ruling, 2026-09-25): a non-secret setting,
// read like the others. "The setting unset -> refuse, never skip: ...
// the webhook 503, so PayPal retries until it is set" — a per-REQUEST
// refusal in handler.ts (`deps.merchantConfigured`), same posture as
// TEN_PAYPAL_WEBHOOK_ID below: this function still starts even if the
// owner hasn't set it yet.
const merchantId = Deno.env.get("TEN_PAYPAL_MERCHANT_ID") ?? "";

// § 17.7 step 6: this function is deployed BEFORE PayPal hands out the
// webhook id (you need this function's own URL to register the webhook
// first) — so, unlike the base/client checks above, a missing
// TEN_PAYPAL_WEBHOOK_ID must NOT stop the function from starting. Every
// request just answers 503 until it's set (handler.ts's one branch for
// "the call failing, or the secret unset").
const webhookId = Deno.env.get("TEN_PAYPAL_WEBHOOK_ID") ?? "";

const deps: WebhookDeps = {
  verifyWebhookSignature: async (headers, event) => {
    if (!webhookId) return { ok: false };
    const accessToken = await getAccessToken(paypalConfig);
    return verifyWebhookSignature(paypalConfig, accessToken, webhookId, headers, event);
  },
  isMemberByUid: (uid) => isMemberByUid(env, uid),
  getCapture: async (captureId) => {
    const accessToken = await getAccessToken(paypalConfig);
    return getCapture(paypalConfig, accessToken, captureId);
  },
  getOrder: async (orderId) => {
    const accessToken = await getAccessToken(paypalConfig);
    return getOrder(paypalConfig, accessToken, orderId);
  },
  insertLedgerCredit: (row) => insertLedgerCredit(env, row),
  checkTenOrder: (input) => checkTenOrder(paypalConfig.clientSecret, merchantId, input),
  merchantConfigured: merchantId.length > 0,
  log: { warn: (e) => console.warn(e), error: (e) => console.error(e) },
};

Deno.serve((req) => handleRequest(req, deps));
