// Unit/integration tests for ten-paypal-webhook, run with `deno test`.
// Uses a local stub PayPal server and a local stub Supabase server
// (supabase/functions/_shared/test-support.ts) — no real network, no
// TEN_PAYPAL_WEBHOOK_ID, no live PayPal/Supabase project. Covers
// docs/design-web-agent.md § 17.1 step 5 and the relevant § 17.8 test plan
// items (4, 5, 6).

import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleRequest, type WebhookDeps } from "./handler.ts";
import { getAccessToken, getCapture, verifyWebhookSignature, type PayPalConfig, type WebhookHeaders } from "../_shared/paypal.ts";
import { insertLedgerCredit, isMemberByUid, type SupabaseEnv } from "../_shared/supabase.ts";
import {
  freshPaypalState,
  freshState,
  startMockPaypal,
  startMockSupabase,
  type MockPaypalState,
  type MockServer,
  type MockSupabaseState,
} from "../_shared/test-support.ts";

const SIG_HEADERS: Record<string, string> = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.paypal.com/cert",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "sig-1",
  "paypal-transmission-time": "2026-09-25T00:00:00Z",
};

function req(body: unknown, opts: { method?: string; headers?: Record<string, string>; rawBody?: string } = {}): Request {
  const headers = new Headers({ "Content-Type": "application/json", ...SIG_HEADERS, ...(opts.headers ?? {}) });
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
      custom_id: overrides.customId ?? "ten:u1",
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

async function harness(opts: { webhookIdSet?: boolean } = {}): Promise<Harness> {
  const state = freshState();
  const paypalState = freshPaypalState();
  const supabase = await startMockSupabase(state);
  const paypal = await startMockPaypal(paypalState);
  const supEnv: SupabaseEnv = { url: supabase.url, anonKey: state.anonKey, serviceRoleKey: state.serviceRoleKey };
  const paypalConfig: PayPalConfig = { apiBase: paypal.url, clientId: "test-client-id", clientSecret: "test-secret" };
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
    insertLedgerCredit: (row) => insertLedgerCredit(supEnv, row),
    log: { warn: (e) => warnings.push(e) },
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

Deno.test("a bad/missing signature -> 401, no re-fetch, no row", async () => {
  const h = await harness();
  try {
    h.paypalState.verifyWebhookOutcome = "FAILURE";
    h.state.users["irrelevant"] = { id: "u1" };
    h.state.members.add("u1");
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

Deno.test("a valid signature but a non-capture event type -> 200 ignored, no row", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(req({ event_type: "PAYMENT.CAPTURE.DENIED", resource: { id: "cap-1", custom_id: "ten:u1" } }), h.deps);
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

Deno.test("valid signature, ten: custom_id for a NON-member -> 200 ignored, an alert logged, no row", async () => {
  const h = await harness();
  try {
    // u1 is never added to h.state.members.
    const res = await handleRequest(req(captureCompletedEvent({ customId: "ten:u1" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
    assert(h.warnings.some((w) => JSON.stringify(w).includes("ALERT") && JSON.stringify(w).includes("refund by hand")));
  } finally {
    await h.stop();
  }
});

Deno.test("valid + ten: + member + an UNKNOWN capture id (re-fetch 404s) -> 503", async () => {
  const h = await harness();
  try {
    h.state.members.add("u1");
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "does-not-exist" })), h.deps);
    assertEquals(res.status, 503);
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("valid + ten: + member + re-fetched capture -> credited, exactly one row", async () => {
  const h = await harness();
  try {
    h.state.members.add("u1");
    h.paypalState.captures["cap-1"] = { id: "cap-1", customId: "ten:u1", currencyCode: "USD", status: "COMPLETED", grossUsd: "10.00", feeUsd: "0.84", netUsd: "9.16" };
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
  } finally {
    await h.stop();
  }
});

Deno.test("replayed 3 times: still exactly one row (idempotent via the ledger's own unique request_id)", async () => {
  const h = await harness();
  try {
    h.state.members.add("u1");
    h.paypalState.captures["cap-1"] = { id: "cap-1", customId: "ten:u1", currencyCode: "USD", status: "COMPLETED", grossUsd: "10.00", feeUsd: "0.84", netUsd: "9.16" };
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
    h.state.members.add("u1");
    h.paypalState.captures["cap-1"] = { id: "cap-1", customId: "ten:u1", currencyCode: "USD", status: "COMPLETED", grossUsd: "10.00", feeUsd: "0.84", netUsd: "9.16" };
    h.state.ledgerRequestIds.add("paypal:cap-1");
    h.state.ledgerInserts.push({ user_id: "u1", kind: "credit", request_id: "paypal:cap-1", usd: "9.16" });

    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "credited");
    assertEquals(h.state.ledgerInserts.length, 1, "no second row for the same capture");
  } finally {
    await h.stop();
  }
});

Deno.test("re-fetched custom_id differs from the event's own -> 200 ignored, an alert, no row", async () => {
  const h = await harness();
  try {
    h.state.members.add("u1");
    // The event claims ten:u1, but the re-fetch (the authoritative source)
    // shows a different custom_id — never trust the event body alone.
    h.paypalState.captures["cap-1"] = { id: "cap-1", customId: "ten:someone-else", currencyCode: "USD", status: "COMPLETED", grossUsd: "10.00", feeUsd: "0.84", netUsd: "9.16" };
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1", customId: "ten:u1" })), h.deps);
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
    h.state.members.add("u1");
    h.paypalState.captures["cap-1"] = { id: "cap-1", customId: "ten:u1", currencyCode: "USD", status: "PENDING" };
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("a breakdown that doesn't add up (non-USD) -> 200 ignored, an alert, no row", async () => {
  const h = await harness();
  try {
    h.state.members.add("u1");
    h.paypalState.captures["cap-1"] = { id: "cap-1", customId: "ten:u1", currencyCode: "EUR", status: "COMPLETED", grossUsd: "8.79", feeUsd: "0.84", netUsd: "7.95" };
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
    h.state.members.add("u1");
    h.paypalState.captures["cap-1"] = { id: "cap-1", customId: "ten:u1", currencyCode: "USD", status: "COMPLETED" };
    const res = await handleRequest(req(captureCompletedEvent({ captureId: "cap-1" })), h.deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ignored");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("no CORS headers on any response", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(req(captureCompletedEvent(), { headers: { origin: "https://ten.example.com" } }), h.deps);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  } finally {
    await h.stop();
  }
});
