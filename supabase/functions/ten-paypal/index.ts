// supabase/functions/ten-paypal/index.ts
// Deploy-time entry point (docs/design-web-agent.md § 17.1). Logic lives in
// handler.ts/core.ts, which import no Deno/Edge-Runtime global. NOT
// deployed by this change (see supabase/functions/README.md).

import { handleRequest, type PaypalDeps } from "./handler.ts";
import { captureOrder, createOrder, getAccessToken, getOrder, type PayPalConfig } from "../_shared/paypal.ts";
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
  randomId: () => crypto.randomUUID(),
  log: { warn: (e) => console.warn(e) },
};

Deno.serve((req) => handleRequest(req, deps, Deno.env.toObject()));
