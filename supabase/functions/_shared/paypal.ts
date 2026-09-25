// A small PayPal REST client shared by ten-paypal and ten-paypal-webhook.
// Contract: docs/design-web-agent.md § 17. Ported in our own words from the
// pattern read in the older CareerCoach app (never its code verbatim, never
// its .env/secrets) — restructured to this repo's style: every function
// takes its config and an injectable `fetchImpl` explicitly (no class, no
// module-level state), so it runs under `deno test` against a local stub
// server and carries no `window`/`document`/`localStorage`/`node:` API
// (browser- and Edge-Runtime-safe either way, even though only the two
// PayPal Edge Functions actually import it).
//
// Money values are passed through PayPal's OWN decimal strings end to end —
// never parsed to a JS float and re-serialized. PayPal's
// `seller_receivable_breakdown` already carries the authoritative
// gross/fee/net split; recomputing `net = gross - fee` ourselves in
// floating point is exactly the class of bug the older app's own
// known-issue note (docs/old-app-paypal-ten-prefix.md) warns about, so this
// client never does that arithmetic — it only forwards PayPal's strings to
// the caller, which forwards them unparsed into the numeric(12,2) ledger
// columns (the migration's own check constraint verifies the arithmetic,
// in Postgres's exact decimal `numeric`, not float).

export interface PayPalConfig {
  /** https://api-m.sandbox.paypal.com or https://api-m.paypal.com — the
   *  caller (index.ts) already refused to start on any other value. */
  apiBase: string;
  clientId: string;
  clientSecret: string;
}

/** POST /v1/oauth2/token (client_credentials). Throws on any failure — the
 * caller maps that to a 503, never logs `config.clientSecret`. */
export async function getAccessToken(
  config: PayPalConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const basic = btoa(`${config.clientId}:${config.clientSecret}`);
  const res = await fetchImpl(`${config.apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`paypal oauth2/token failed: ${res.status}`);
  }
  const body = await res.json();
  if (typeof body?.access_token !== "string" || !body.access_token) {
    throw new Error("paypal oauth2/token: no access_token in response");
  }
  return body.access_token;
}

export interface CreateOrderParams {
  /** PayPal's own decimal string, e.g. "10.00" — from the SERVER'S pack
   *  table (core.ts), never a client-supplied amount (§ 17.1 step 2). */
  amountUsd: string;
  /** "ten:<uid>" (§ 17.1). */
  customId: string;
  /** "ten-<random uuid>" — PayPal wants it unique per order. */
  invoiceId: string;
  /** "Ten credit $10". */
  description: string;
}

/** POST /v2/checkout/orders, intent CAPTURE. No shipping address, no
 * vault/saved-method/agreement/plan field anywhere in the body (§ 17.1: "No
 * vault, saved method, agreement or plan"). Throws on any failure. */
export async function createOrder(
  config: PayPalConfig,
  accessToken: string,
  params: CreateOrderParams,
  fetchImpl: typeof fetch = fetch,
): Promise<{ orderId: string }> {
  const res = await fetchImpl(`${config.apiBase}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: params.amountUsd },
          custom_id: params.customId,
          invoice_id: params.invoiceId,
          description: params.description,
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`paypal create order failed: ${res.status} ${text}`);
  }
  const body = await res.json();
  if (typeof body?.id !== "string" || !body.id) {
    throw new Error("paypal create order: no id in response");
  }
  return { orderId: body.id };
}

export interface CaptureInfo {
  captureId: string;
  status: string; // "COMPLETED" | "PENDING" | "DECLINED" | ...
  customId: string;
  currencyCode: string;
  /** PayPal's own decimal strings from `seller_receivable_breakdown`, or
   *  `null` when the breakdown isn't there yet (e.g. status PENDING —
   *  § 17.1 step 4: "no fee breakdown until it clears"). Never parsed to a
   *  JS number here — see the file header. */
  grossUsd: string | null;
  feeUsd: string | null;
  netUsd: string | null;
}

// deno-lint-ignore no-explicit-any
function extractCaptureFromOrderBody(body: any): CaptureInfo | undefined {
  const capture = body?.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture) return undefined;
  return captureInfoFrom(capture);
}

// deno-lint-ignore no-explicit-any
function captureInfoFrom(capture: any): CaptureInfo {
  const breakdown = capture.seller_receivable_breakdown;
  return {
    captureId: String(capture.id ?? ""),
    status: String(capture.status ?? ""),
    customId: String(capture.custom_id ?? ""),
    currencyCode: String(capture.amount?.currency_code ?? ""),
    grossUsd: typeof breakdown?.gross_amount?.value === "string" ? breakdown.gross_amount.value : null,
    feeUsd: typeof breakdown?.paypal_fee?.value === "string" ? breakdown.paypal_fee.value : null,
    netUsd: typeof breakdown?.net_amount?.value === "string" ? breakdown.net_amount.value : null,
  };
}

export interface OrderInfo {
  orderId: string;
  status: string;
  customId: string;
  amountValue: string;
  currencyCode: string;
  /** Present once the order has been captured — read here so
   *  ORDER_ALREADY_CAPTURED can be resolved with one more GET, not a
   *  second capture call (§ 17.1 step 4). */
  capture?: CaptureInfo;
}

/** GET /v2/checkout/orders/{id}. Throws on any failure. */
export async function getOrder(
  config: PayPalConfig,
  accessToken: string,
  orderId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OrderInfo> {
  const res = await fetchImpl(`${config.apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`paypal get order failed: ${res.status} ${text}`);
  }
  const body = await res.json();
  return {
    orderId: String(body?.id ?? ""),
    status: String(body?.status ?? ""),
    customId: String(body?.purchase_units?.[0]?.custom_id ?? ""),
    amountValue: String(body?.purchase_units?.[0]?.amount?.value ?? ""),
    currencyCode: String(body?.purchase_units?.[0]?.amount?.currency_code ?? ""),
    capture: extractCaptureFromOrderBody(body),
  };
}

export type CaptureOutcome =
  | { kind: "captured"; capture: CaptureInfo }
  | { kind: "already_captured" }
  | { kind: "not_approved" }
  | { kind: "error"; status: number; message: string };

// deno-lint-ignore no-explicit-any
function firstIssue(body: any): string | undefined {
  const issue = body?.details?.[0]?.issue;
  return typeof issue === "string" ? issue : typeof body?.name === "string" ? body.name : undefined;
}

/** POST /v2/checkout/orders/{id}/capture, with `PayPal-Request-Id` for
 * idempotency (§ 17.1 step 4: "kept 6 hours: a retry returns the same
 * capture" — PayPal's own behavior for that header, not anything this
 * client has to implement). Returns a result instead of throwing for the
 * two outcomes the caller must handle differently (ORDER_ALREADY_CAPTURED
 * → read the order's own capture; ORDER_NOT_APPROVED → the payer never
 * confirmed) — still throws on a transport failure or a malformed 2xx body. */
export async function captureOrder(
  config: PayPalConfig,
  accessToken: string,
  orderId: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CaptureOutcome> {
  const res = await fetchImpl(`${config.apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": requestId,
    },
    body: "{}",
  });
  const body = await res.json().catch(() => undefined);
  if (res.status === 200 || res.status === 201) {
    const capture = extractCaptureFromOrderBody(body);
    if (!capture) throw new Error("paypal capture order: no capture in response");
    return { kind: "captured", capture };
  }
  const issue = firstIssue(body);
  if (issue === "ORDER_ALREADY_CAPTURED") return { kind: "already_captured" };
  if (issue === "ORDER_NOT_APPROVED") return { kind: "not_approved" };
  return { kind: "error", status: res.status, message: issue ?? `HTTP ${res.status}` };
}

/** GET /v2/payments/captures/{id} — the webhook's own re-fetch (§ 17.1 step
 * 5: "the signature proves PayPal sent the event, the re-fetch proves the
 * capture"). Throws on any failure. */
export async function getCapture(
  config: PayPalConfig,
  accessToken: string,
  captureId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CaptureInfo> {
  const res = await fetchImpl(`${config.apiBase}/v2/payments/captures/${encodeURIComponent(captureId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`paypal get capture failed: ${res.status} ${text}`);
  }
  const body = await res.json();
  return captureInfoFrom(body);
}

export interface WebhookHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

export type VerifyOutcome = { ok: true; verified: boolean } | { ok: false };

/** POST /v1/notifications/verify-webhook-signature. `ok: false` means the
 * call itself failed (network/non-2xx/malformed body) — the caller (§ 17.1
 * step 5) maps that to 503 so PayPal retries; `ok: true, verified: false`
 * means PayPal answered and the signature did NOT check out — the caller
 * maps that to 401, no retry hint needed either way since PayPal always
 * retries a non-2xx regardless of which. Never throws. */
export async function verifyWebhookSignature(
  config: PayPalConfig,
  accessToken: string,
  webhookId: string,
  headers: WebhookHeaders,
  // deno-lint-ignore no-explicit-any
  event: any,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyOutcome> {
  try {
    const res = await fetchImpl(`${config.apiBase}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: headers.authAlgo,
        cert_url: headers.certUrl,
        transmission_id: headers.transmissionId,
        transmission_sig: headers.transmissionSig,
        transmission_time: headers.transmissionTime,
        webhook_id: webhookId,
        webhook_event: event,
      }),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false };
    }
    const body = await res.json();
    return { ok: true, verified: body?.verification_status === "SUCCESS" };
  } catch {
    return { ok: false };
  }
}
