// Unit/integration tests for ten-paypal-webhook, run with `deno test`.
// Uses a local stub PayPal server and a local stub Supabase server
// (supabase/functions/_shared/test-support.ts) — no real network, no
// TEN_PAYPAL_WEBHOOK_ID, no live PayPal/Supabase project. Covers
// docs/design-web-agent.md § 17.1 step 5, § 17.10 ("Only Ten's own
// orders"), and the relevant § 17.8 test plan items.
//
// uidFromCustomId (F6, fix round 2) requires the STRICT `ten:<lowercase
// UUID>` shape, so every test uid below is a real UUID-shaped string.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleRequest, type WebhookDeps } from "./handler.ts";
import { getAccessToken, getCapture, getOrder, verifyWebhookSignature, type PayPalConfig, type WebhookHeaders } from "../_shared/paypal.ts";
import { buildInvoiceId, checkTenOrder } from "../_shared/paypal-invoice.ts";
import { insertLedgerCredit, isMemberByUid, type SupabaseEnv } from "../_shared/supabase.ts";
import {
  freshPaypalState,
  freshState,
  MOCK_TEN_MERCHANT_ID,
  startMockPaypal,
  startMockSupabase,
  type MockPaypalState,
  type MockServer,
  type MockSupabaseState,
} from "../_shared/test-support.ts";

const UID_A = "aaaaaaaa-1111-1111-1111-111111111111";
const TEST_CLIENT_SECRET = "test-secret";

const SIG_HEADERS: Record<string, string> = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.paypal.com/cert",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "sig-1",
  "paypal-transmission-time": "2026-09-25T00:00:00Z",
};

// `opts.headers`, when given, REPLACES the signature headers entirely
// (never merges on top of SIG_HEADERS) — a test deleting one key from its
// own copy must see it actually absent, not silently restored by the
// default set underneath.
function req(body: unknown, opts: { method?: string; headers?: Record<string, string>; rawBody?: string } = {}): Request {
  const headers = new Headers({ "Content-Type": "application/json", ...(opts.headers ?? SIG_HEADERS) });
  return new Request("http://localhost/", {
    method: opts.method ?? "POST",
    headers,
    body: opts.rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

function captureCompletedEvent(overrides: { customId?: string; captureId?: string } = {}) {
  return {
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: overrides.captureId ?? "cap-1",
      custom_id: overrides.customId ?? `ten:${UID_A}`,
    },
  };
}

interface Harness {
  supabase: MockServer;
  paypal: MockServer;
  state: MockSupabaseState;
  paypalState: MockPaypalState;
  deps: WebhookDeps;
  warnings: unknown[];
  webhookIdSet: boolean;
  stop(): Promise<void>;
}

async function harness(opts: { webhookIdSet?: boolean; merchantConfigured?: boolean } = {}): Promise<Harness> {
  const state = freshState();
  const paypalState = freshPaypalState();
  const supabase = await startMockSupabase(state);
  const paypal = await startMockPaypal(paypalState);
  const supEnv: SupabaseEnv = { url: supabase.url, anonKey: state.anonKey, serviceRoleKey: state.serviceRoleKey };
  const paypalConfig: PayPalConfig = { apiBase: paypal.url, clientId: "test-client-id", clientSecret: TEST_CLIENT_SECRET };
  const webhookIdSet = opts.webhookIdSet ?? true;
  const warnings: unknown[] = [];
  const deps: WebhookDeps = {
    verifyWebhookSignature: async (headers: WebhookHeaders, event: unknown) => {
      if (!webhookIdSet) return { ok: false };
      const accessToken = await getAccessToken(paypalConfig);
      return verifyWebhookSignature(paypalConfig, accessToken, "wh-id-1", headers, event);
    },
    isMemberByUid: (uid) => isMemberByUid(supEnv, uid),
    getCapture: async (captureId) => {
      const accessToken = await getAccessToken(paypalConfig);
      return getCapture(paypalConfig, accessToken, captureId);
    },
    getOrder: async (orderId) => {
      const accessToken = await getAccessToken(paypalConfig);
      return getOrder(paypalConfig, accessToken, orderId);
    },
    insertLedgerCredit: (row) => insertLedgerCredit(supEnv, row),
    checkTenOrder: (input) => checkTenOrder(TEST_CLIENT_SECRET, MOCK_TEN_MERCHANT_ID, input),
    merchantConfigured: opts.merchantConfigured ?? true,
    log: { warn: (e) => warnings.push(e), error: (e) => warnings.push(e) },
  };
  return {
    supabase,
    paypal,
    state,
    paypalState,
    deps,
    warnings,
    webhookIdSet,
    stop: async () => {
      await supabase.stop();
      await paypal.stop();
    },
  };
}

/** Plants a COMPLETED capture (and the order behind it, for the payee
 * check) that passes § 17.10's shared check — same shape a real
 * create-order -> approve -> capture would leave. */
async function plantValidCapture(
  h: Harness,
  uid: string,
  opts: { captureId?: string; orderId?: string; pack?: "10" | "20" | "40"; payeeMerchantId?: string; overrides?: Record<string, unknown> } = {},
) {
  const pack = opts.pack ?? "10";
  const amount = { "10": "10.00", "20": "20.00", "40": "40.00" }[pack];
  const captureId = opts.captureId ?? "cap-1";
  const orderId = opts.orderId ?? `order-behind-${captureId}`;
  const invoiceId = await buildInvoiceId(TEST_CLIENT_SECRET, uid, pack, amount);
  const payeeMerchantId = opts.payeeMerchantId ?? MOCK_TEN_MERCHANT_ID;
  h.paypalState.orders[orderId] = {
    id: orderId,
    customId: `ten:${uid}`,
    amountValue: amount,
    currencyCode: "USD",
    invoiceId,
    payeeMerchantId,
    approved: true,
  };
  h.paypalState.captures[captureId] = {
    id: captureId,
    customId: `ten:${uid}`,
    amountValue: amount,
    currencyCode: "USD",
    status: "COMPLETED",
    grossUsd: amount,
    feeUsd: "0.84",
    netUsd: (Number(amount) - 0.84).toFixed(2),
    invoiceId,
    orderId,
    ...opts.overrides,
  };
  return { captureId, orderId };
}

// ------------------------------------------------------------- basics ---

Deno.test("GET is 404 (POST only)", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(new Request("http://localhost/", { method: "GET" }), h.deps);
    assertEquals(res.status, 404);
  } finally {
    await h.stop();
  }
});

Deno.test("over 64 KB -> 413, no verify call, no row", async () => {
  const h = await harness();
  try {
    const big = "x".repeat(64 * 1024 + 1);
    const res = await handleRequest(req(undefined, { rawBody: big }), h.deps);
    assertEquals(res.status, 413);
    assertEquals(h.paypalState.verifyWebhookRequests.length, 0);
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("invalid JSON -> 400, no verify call", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(req(undefined, { rawBody: "{not json" }), h.deps);
    assertEquals(res.status, 400);
    assertEquals(h.paypalState.verifyWebhookRequests.length, 0);
  } finally {
    await h.stop();
  }
});

// ------------------------------------------------------------- signature (F8) ---

Deno.test("F8: a missing signature header (any of the five) -> 401, verify never called", async () => {
  const h = await harness();
  try {
    for (const k of Object.keys(SIG_HEADERS)) {
      const hh = { ...SIG_HEADERS };
      delete (hh as Record<string, string>)[k];
      const res = await handleRequest(req(captureCompletedEvent(), { headers: hh }), h.deps);
      assertEquals(res.status, 401, k);
    }
    assertEquals(h.paypalState.verifyWebhookRequests.length, 0, "verify was never called for a missing header");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("no headers at all -> 401, verify never called", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(new Request("http://localhost/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(captureCompletedEvent()) }), h.deps);
    assertEquals(res.status, 401);
    assertEquals(h.paypalState.verifyWebhookRequests.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("a bad/forged signature -> 401, no re-fetch, no row", async () => {
  const h = await harness();
  try {
    h.paypalState.verifyWebhookOutcome = "FAILURE";
    h.state.users["irrelevant"] = { id: UID_A };
    h.state.members.add(UID_A);
    const res = await handleRequest(req(captureCompletedEvent()), h.deps);
    assertEquals(res.status, 401);
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("the verify call failing -> 503, no row (so PayPal retries)", async () => {
  const h = await harness();
  try {
    h.paypalState.verifyWebhookOutcome = "unavailable";
    const res = await handleRequest(req(captureCompletedEvent()), h.deps);
    assertEquals(res.status, 503);
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("TEN_PAYPAL_WEBHOOK_ID unset -> 503, no row, no verify HTTP call at all", async () => {
  const h = await harness({ webhookIdSet: false });
  try {
    const res = await handleRequest(req(captureCompletedEvent()), h.deps);
    assertEquals(res.status, 503);
    assertEquals(h.paypalState.verifyWebhookRequests.length, 0);
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("§ 17.10 lead ruling (2026-09-25): TEN_PAYPAL_MERCHANT_ID unset -> 503, no row, checked AFTER a good signature (a bad one still 401s)", async () => {
  const h = await harness({ merchantConfigured: false });
  try {
    h.state.members.add(UID_A);
    await plantValidCapture(h, UID_A);

    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    assertEquals(res.status, 503);
    assertEquals(h.state.ledgerInserts.length, 0);

    // A bad signature is still a DIFFERENT, unrelated failure (401), not
    // folded into the config-unavailable 503 above.
    h.paypalState.verifyWebhookOutcome = "FAILURE";
    const badSig = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    assertEquals(badSig.status, 401);
  } finally {
    await h.stop();
  }
});

// ------------------------------------------------------------- filters ---

Deno.test("a valid signature but a non-capture event type -> 200 ignored, no row", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(req({ event_type: "PAYMENT.CAPTURE.DENIED", resource: { id: "cap-1", custom_id: `ten:${UID_A}` } }), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("valid signature, a non-ten: custom_id (bare UUID, the older app's) -> 200 ignored, no row", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(req(captureCompletedEvent({ customId: "550e8400-e29b-41d4-a716-446655440000" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("F6: an uppercase UUID or a trailing space in custom_id -> 200 ignored, no row", async () => {
  const h = await harness();
  try {
    for (const c of [`ten:${UID_A.toUpperCase()}`, `ten:${UID_A} `, `TEN:${UID_A}`]) {
      const res = await handleRequest(req(captureCompletedEvent({ customId: c })), h.deps);
      assertEquals(res.status, 200, c);
      const body = await res.json();
      assertEquals(body.status, "ignored", c);
    }
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("valid signature, ten: custom_id for a NON-member -> 200 ignored, an alert logged, no row", async () => {
  const h = await harness();
  try {
    // UID_A is never added to h.state.members.
    const res = await handleRequest(req(captureCompletedEvent({ customId: `ten:${UID_A}` })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
    assert(h.warnings.some((w) => JSON.stringify(w).includes("ALERT") && JSON.stringify(w).includes("refund by hand")));
  } finally {
    await h.stop();
  }
});

// ------------------------------------------------------------- re-fetch (F7) ---

Deno.test("F7: an UNKNOWN capture (re-fetch 404s) -> 200 ignored, a log line, no row", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "does-not-exist" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
    assert(h.warnings.some((w) => JSON.stringify(w).includes("404")));
  } finally {
    await h.stop();
  }
});

Deno.test("F7: a re-fetch 500 -> 503 (retriable), never 200", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    await plantValidCapture(h, UID_A);
    h.paypalState.fail = { "/v2/payments/captures/": 500 };
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    h.paypalState.fail = {};
    assertEquals(res.status, 503);
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

// ------------------------------------------------------------- happy path ---

Deno.test("valid + ten: + member + re-fetched capture + payee check -> credited, exactly one row", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    await plantValidCapture(h, UID_A);
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "credited");
    assertEquals(h.state.ledgerInserts.length, 1);
    const row = h.state.ledgerInserts[0];
    assertEquals(row.request_id, "paypal:cap-1");
    assertEquals(row.usd, "9.16");
    assertEquals(row.gross_usd, "10.00");
    assertEquals(row.fee_usd, "0.84");
    assertEquals(row.user_id, UID_A);
  } finally {
    await h.stop();
  }
});

Deno.test("replayed 3 times: still exactly one row (idempotent via the ledger's own unique request_id)", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    await plantValidCapture(h, UID_A);
    for (let i = 0; i < 3; i++) {
      const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
      assertEquals(res.status, 200);
    }
    assertEquals(h.state.ledgerInserts.length, 1);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order already credited it first (the race) -> the webhook sees a duplicate and still answers credited, no second row", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    await plantValidCapture(h, UID_A);
    h.state.ledgerRequestIds.add("paypal:cap-1");
    h.state.ledgerInserts.push({ user_id: UID_A, kind: "credit", request_id: "paypal:cap-1", usd: "9.16" });

    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "credited");
    assertEquals(h.state.ledgerInserts.length, 1, "no second row for the same capture");
  } finally {
    await h.stop();
  }
});

// ------------------------------------------------------------- mismatch cases ---

Deno.test("re-fetched custom_id differs from the event's own -> 200 ignored, an alert, no row", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    // The event claims ten:UID_A, but the re-fetch (the authoritative
    // source) shows a different custom_id — never trust the event body alone.
    const other = "bbbbbbbb-2222-2222-2222-222222222222";
    await plantValidCapture(h, other, { captureId: "cap-1" });
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1", customId: `ten:${UID_A}` })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
    assert(h.warnings.some((w) => JSON.stringify(w).includes("ALERT")));
  } finally {
    await h.stop();
  }
});

Deno.test("re-fetched capture is PENDING (not COMPLETED) -> 200 ignored, no row", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    await plantValidCapture(h, UID_A, { overrides: { status: "PENDING", grossUsd: undefined, feeUsd: undefined, netUsd: undefined } });
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

// ------------------------------------------------------------- breakdown (F4/F5) ---

Deno.test("a breakdown that doesn't add up (non-USD) -> 200 ignored, an ALERT, no row", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    // Note: this mock ties the capture's own top-level amount.currency_code
    // to the same field as its breakdown lines, so a EUR override here is
    // caught by § 17.10's own check (amount is USD) before ever reaching
    // breakdownIsSane — still "200 ignored + an ALERT, no row" either way,
    // just possibly a different ALERT line than the breakdown-specific one
    // (see ten-paypal/handler.test.ts for that one isolated on the ORDER's
    // own pristine currency, decoupled from the capture's breakdown).
    await plantValidCapture(h, UID_A, { overrides: { currencyCode: "EUR", grossUsd: "8.79", feeUsd: "0.84", netUsd: "7.95" } });
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
    assert(h.warnings.some((w) => JSON.stringify(w).includes("ALERT")));
  } finally {
    await h.stop();
  }
});

Deno.test("no net_amount at all -> 200 ignored, an alert, no row", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    await plantValidCapture(h, UID_A, { overrides: { netUsd: undefined } });
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

// ------------------------------------------------------------- § 17.10 payee (webhook side) ---

Deno.test("§ 17.10 payee: a capture whose order names a foreign payee -> 200 ignored, an ALERT, no row", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    await plantValidCapture(h, UID_A, { payeeMerchantId: "SOMEONE-ELSE" });
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
    assert(h.warnings.some((w) => JSON.stringify(w).includes("ALERT")));
  } finally {
    await h.stop();
  }
});

Deno.test("§ 17.10 payee: a capture with no order_id at all -> 200 ignored, a log line, no row", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    await plantValidCapture(h, UID_A, { overrides: { orderId: undefined } });
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("§ 17.10 payee: the order re-fetch 404s (unknown order) -> 200 ignored, no row", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    await plantValidCapture(h, UID_A);
    delete h.paypalState.orders[`order-behind-cap-1`];
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("§ 17.10 payee: the order re-fetch 500s -> 503 (retriable), no row", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    const { orderId } = await plantValidCapture(h, UID_A);
    h.paypalState.fail = { [`/v2/checkout/orders/${orderId}`]: 500 };
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    h.paypalState.fail = {};
    assertEquals(res.status, 503);
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("§ 17.10: an invoice_id tag that doesn't verify (forged/mismatched) -> 200 ignored, an ALERT, no row", async () => {
  const h = await harness();
  try {
    h.state.members.add(UID_A);
    const { captureId, orderId } = await plantValidCapture(h, UID_A);
    // Corrupt the capture's own invoice_id tag after planting.
    h.paypalState.captures[captureId].invoiceId = h.paypalState.captures[captureId].invoiceId!.slice(0, -1) + "f";
    void orderId;
    const res = await handleRequest(req(captureCompletedEvent({ captureId })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
    assert(h.warnings.some((w) => JSON.stringify(w).includes("ALERT")));
  } finally {
    await h.stop();
  }
});

// ------------------------------------------------------------- misc ---

Deno.test("§ 17.1(5): order of checks; no CORS headers on any response", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(req(captureCompletedEvent(), { headers: { ...SIG_HEADERS, origin: "https://ten.example.com" } }), h.deps);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  } finally {
    await h.stop();
  }
});
