// supabase/functions/ten-paypal/index.ts
// Deploy-time entry point (docs/design-web-agent.md § 17.1). Logic lives in
// handler.ts/core.ts, which import no Deno/Edge-Runtime global. NOT
// deployed by this change (see supabase/functions/README.md).

import { handleRequest, type PaypalDeps } from "./handler.ts";
import { captureOrder, createOrder, getAccessToken, getOrder, type PayPalConfig } from "../_shared/paypal.ts";
import { buildInvoiceId, checkTenOrder } from "../_shared/paypal-invoice.ts";
import { envFromDeno, insertLedgerCredit, isMember, verifyUser } from "../_shared/supabase.ts";

const env = envFromDeno((name) => Deno.env.get(name));

// § 17.6: function secrets, owner-set — never logged. The functions refuse
// to start unless the base is exactly one of PayPal's two real hosts.
const paypalConfig: PayPalConfig = {
  apiBase: Deno.env.get("TEN_PAYPAL_API_BASE") ?? "",
  clientId: Deno.env.get("TEN_PAYPAL_CLIENT_ID") ?? "",
  clientSecret: Deno.env.get("TEN_PAYPAL_CLIENT_SECRET") ?? "",
};
const ALLOWED_API_BASES = ["https://api-m.sandbox.paypal.com", "https://api-m.paypal.com"];
if (!ALLOWED_API_BASES.includes(paypalConfig.apiBase)) {
  throw new Error(
    `ten-paypal: TEN_PAYPAL_API_BASE must be one of ${ALLOWED_API_BASES.join(", ")}, got ${JSON.stringify(paypalConfig.apiBase)}`,
  );
}
if (!paypalConfig.clientId || !paypalConfig.clientSecret) {
  throw new Error("ten-paypal: TEN_PAYPAL_CLIENT_ID/TEN_PAYPAL_CLIENT_SECRET must both be set");
}
// § 17.10's payee closure (lead ruling, 2026-09-25): a non-secret setting,
// read like the others. "The setting unset -> refuse, never skip: ...
// answer 503 before calling PayPal" — a per-REQUEST refusal in
// handler.ts (`deps.merchantConfigured`), not a boot-time crash: the
// function still starts (and stays up for the OTHER Edge Functions on the
// same project) even if the owner hasn't set this yet.
const merchantId = Deno.env.get("TEN_PAYPAL_MERCHANT_ID") ?? "";

const deps: PaypalDeps = {
  verifyUser: (token) => verifyUser(env, token),
  isMember: (token) => isMember(env, token),
  createOrder: async (params) => {
    const accessToken = await getAccessToken(paypalConfig);
    return createOrder(paypalConfig, accessToken, params);
  },
  getOrder: async (orderId) => {
    const accessToken = await getAccessToken(paypalConfig);
    return getOrder(paypalConfig, accessToken, orderId);
  },
  captureOrder: async (orderId, requestId) => {
    const accessToken = await getAccessToken(paypalConfig);
    return captureOrder(paypalConfig, accessToken, orderId, requestId);
  },
  insertLedgerCredit: (row) => insertLedgerCredit(env, row),
  // § 17.10 (fix round 2): the client secret and the merchant id never
  // leave this closure — handler.ts only ever sees these two functions,
  // never the raw values.
  signInvoiceId: (uid, pack, amountUsd) => buildInvoiceId(paypalConfig.clientSecret, uid, pack, amountUsd),
  checkTenOrder: (input) => checkTenOrder(paypalConfig.clientSecret, merchantId, input),
  merchantConfigured: merchantId.length > 0,
  log: { warn: (e) => console.warn(e), error: (e) => console.error(e) },
};

Deno.serve((req) => handleRequest(req, deps, Deno.env.toObject()));
