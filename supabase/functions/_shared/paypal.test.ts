// Unit tests for _shared/paypal.ts, run with `deno test`. Exercises the
// client against the local stub PayPal server (test-support.ts) — no real
// network, no PayPal credentials.

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  captureOrder,
  createOrder,
  getAccessToken,
  getCapture,
  getOrder,
  verifyWebhookSignature,
  type PayPalConfig,
} from "./paypal.ts";
import { freshPaypalState, startMockPaypal, type MockPaypalState, type MockServer } from "./test-support.ts";

async function harness(opts: { timeoutMs?: number } = {}): Promise<{ paypal: MockServer; state: MockPaypalState; config: PayPalConfig; stop(): Promise<void> }> {
  const state = freshPaypalState();
  const paypal = await startMockPaypal(state);
  const config: PayPalConfig = { apiBase: paypal.url, clientId: "cid", clientSecret: "secret", timeoutMs: opts.timeoutMs };
  return { paypal, state, config, stop: () => paypal.stop() };
}

Deno.test("getAccessToken: returns the token; sends Basic auth built from clientId:clientSecret", async () => {
  const h = await harness();
  try {
    const token = await getAccessToken(h.config);
    assertEquals(token, "mock-paypal-access-token");
  } finally {
    await h.stop();
  }
});

Deno.test("getAccessToken: throws on a failing token endpoint", async () => {
  const h = await harness();
  try {
    h.state.oauthFails = true;
    await assertRejects(() => getAccessToken(h.config));
  } finally {
    await h.stop();
  }
});

async function assertRejects(fn: () => Promise<unknown>): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert(threw, "expected the call to throw");
}

Deno.test("createOrder: intent CAPTURE, amount/customId/invoiceId/description passed through, no vault/agreement/plan", async () => {
  const h = await harness();
  try {
    const token = await getAccessToken(h.config);
    const { orderId } = await createOrder(h.config, token, {
      amountUsd: "10.00",
      customId: "ten:u1",
      invoiceId: "ten-abc",
      description: "Ten credit $10",
    });
    assert(orderId.startsWith("order-"));
    // deno-lint-ignore no-explicit-any
    const sent = h.state.createOrderRequests[0] as any;
    assertEquals(sent.intent, "CAPTURE");
    assertEquals(sent.purchase_units[0].amount, { currency_code: "USD", value: "10.00" });
    assertEquals(sent.purchase_units[0].custom_id, "ten:u1");
    assertEquals(sent.purchase_units[0].invoice_id, "ten-abc");
    assertEquals(sent.purchase_units[0].description, "Ten credit $10");
    const json = JSON.stringify(sent).toLowerCase();
    for (const forbidden of ["vault", "agreement", "plan", "shipping"]) {
      assert(!json.includes(forbidden));
    }
  } finally {
    await h.stop();
  }
});

Deno.test("getOrder: parses status/customId/amount, and the capture once one exists", async () => {
  const h = await harness();
  try {
    const token = await getAccessToken(h.config);
    const { orderId } = await createOrder(h.config, token, { amountUsd: "10.00", customId: "ten:u1", invoiceId: "i1", description: "d" });
    const before = await getOrder(h.config, token, orderId);
    assertEquals(before.status, "APPROVED");
    assertEquals(before.customId, "ten:u1");
    assertEquals(before.amountValue, "10.00");
    assertEquals(before.currencyCode, "USD");
    assertEquals(before.capture, undefined);

    await captureOrder(h.config, token, orderId, "req-1");
    const after = await getOrder(h.config, token, orderId);
    assertEquals(after.status, "COMPLETED");
    assert(after.capture);
    assertEquals(after.capture!.status, "COMPLETED");
  } finally {
    await h.stop();
  }
});

Deno.test("captureOrder: a fresh capture returns 'captured' with the breakdown", async () => {
  const h = await harness();
  try {
    const token = await getAccessToken(h.config);
    const { orderId } = await createOrder(h.config, token, { amountUsd: "20.00", customId: "ten:u1", invoiceId: "i1", description: "d" });
    const outcome = await captureOrder(h.config, token, orderId, "ten-capture-x");
    assertEquals(outcome.kind, "captured");
    if (outcome.kind === "captured") {
      assertEquals(outcome.capture.status, "COMPLETED");
      assertEquals(outcome.capture.customId, "ten:u1");
      assertEquals(outcome.capture.grossUsd, "20.00");
    }
    assertEquals(h.state.captureRequestIdsSeen, ["ten-capture-x"]);
  } finally {
    await h.stop();
  }
});

Deno.test("captureOrder: ORDER_ALREADY_CAPTURED and ORDER_NOT_APPROVED map to their own outcome kinds", async () => {
  const h = await harness();
  try {
    const token = await getAccessToken(h.config);
    const { orderId: capturedId } = await createOrder(h.config, token, { amountUsd: "10.00", customId: "ten:u1", invoiceId: "i1", description: "d" });
    await captureOrder(h.config, token, capturedId, "req-a");
    const again = await captureOrder(h.config, token, capturedId, "req-b");
    assertEquals(again.kind, "already_captured");

    h.state.orders["order-not-approved"] = { id: "order-not-approved", customId: "ten:u1", amountValue: "10.00", currencyCode: "USD", approved: false };
    const notApproved = await captureOrder(h.config, token, "order-not-approved", "req-c");
    assertEquals(notApproved.kind, "not_approved");
  } finally {
    await h.stop();
  }
});

Deno.test("getCapture: reads a capture independent of any order (the webhook's own re-fetch)", async () => {
  const h = await harness();
  try {
    h.state.captures["cap-x"] = { id: "cap-x", customId: "ten:u2", currencyCode: "USD", status: "COMPLETED", grossUsd: "40.00", feeUsd: "1.62", netUsd: "38.38" };
    const token = await getAccessToken(h.config);
    const capture = await getCapture(h.config, token, "cap-x");
    assertEquals(capture.customId, "ten:u2");
    assertEquals(capture.grossUsd, "40.00");
    assertEquals(capture.feeUsd, "1.62");
    assertEquals(capture.netUsd, "38.38");
  } finally {
    await h.stop();
  }
});

Deno.test("getCapture: PENDING carries no breakdown (grossUsd/feeUsd/netUsd all null)", async () => {
  const h = await harness();
  try {
    h.state.captures["cap-pending"] = { id: "cap-pending", customId: "ten:u1", currencyCode: "USD", status: "PENDING" };
    const token = await getAccessToken(h.config);
    const capture = await getCapture(h.config, token, "cap-pending");
    assertEquals(capture.status, "PENDING");
    assertEquals(capture.grossUsd, null);
    assertEquals(capture.feeUsd, null);
    assertEquals(capture.netUsd, null);
  } finally {
    await h.stop();
  }
});

const HEADERS = {
  authAlgo: "SHA256withRSA",
  certUrl: "https://api.paypal.com/cert",
  transmissionId: "tx-1",
  transmissionSig: "sig-1",
  transmissionTime: "2026-09-25T00:00:00Z",
};

Deno.test("verifyWebhookSignature: SUCCESS -> ok+verified; sends the five headers, webhook_id and the event", async () => {
  const h = await harness();
  try {
    h.state.verifyWebhookOutcome = "SUCCESS";
    const token = await getAccessToken(h.config);
    const outcome = await verifyWebhookSignature(h.config, token, "wh-1", HEADERS, { event_type: "X" });
    assertEquals(outcome, { ok: true, verified: true });
    // deno-lint-ignore no-explicit-any
    const sent = h.state.verifyWebhookRequests[0] as any;
    assertEquals(sent.auth_algo, HEADERS.authAlgo);
    assertEquals(sent.cert_url, HEADERS.certUrl);
    assertEquals(sent.transmission_id, HEADERS.transmissionId);
    assertEquals(sent.transmission_sig, HEADERS.transmissionSig);
    assertEquals(sent.transmission_time, HEADERS.transmissionTime);
    assertEquals(sent.webhook_id, "wh-1");
    assertEquals(sent.webhook_event, { event_type: "X" });
  } finally {
    await h.stop();
  }
});

Deno.test("verifyWebhookSignature: FAILURE -> ok:true, verified:false (not a transport failure)", async () => {
  const h = await harness();
  try {
    h.state.verifyWebhookOutcome = "FAILURE";
    const token = await getAccessToken(h.config);
    const outcome = await verifyWebhookSignature(h.config, token, "wh-1", HEADERS, {});
    assertEquals(outcome, { ok: true, verified: false });
  } finally {
    await h.stop();
  }
});

Deno.test("verifyWebhookSignature: the call itself failing -> ok:false, never throws", async () => {
  const h = await harness();
  try {
    h.state.verifyWebhookOutcome = "unavailable";
    const token = await getAccessToken(h.config);
    const outcome = await verifyWebhookSignature(h.config, token, "wh-1", HEADERS, {});
    assertEquals(outcome, { ok: false });
  } finally {
    await h.stop();
  }
});

// ------------------------------------------------------- timeouts (fix round 3) ---
// Owner-approved: every fetch here carries an AbortSignal.timeout (15 s in
// production, PayPalConfig.timeoutMs below). A mock endpoint that NEVER
// answers (state.hang) proves the timeout itself is what ends the call —
// the config's timeoutMs is set to a few ms so these stay fast, never the
// real 15 s default.
const SHORT_TIMEOUT_MS = 30;

Deno.test("getAccessToken: a timed-out OAuth call throws (never hangs)", async () => {
  const h = await harness({ timeoutMs: SHORT_TIMEOUT_MS });
  try {
    h.state.hang["/v1/oauth2/token"] = true;
    await assertRejects(() => getAccessToken(h.config));
  } finally {
    await h.stop();
  }
});

Deno.test("createOrder: a timed-out call throws (never hangs)", async () => {
  const h = await harness();
  try {
    const token = await getAccessToken(h.config);
    h.state.hang["/v2/checkout/orders"] = true;
    // Only createOrder itself gets the short timeout — getAccessToken
    // above already succeeded on the un-hung default config.
    const shortConfig: PayPalConfig = { ...h.config, timeoutMs: SHORT_TIMEOUT_MS };
    await assertRejects(() => createOrder(shortConfig, token, { amountUsd: "10.00", customId: "ten:u1", invoiceId: "i1", description: "d" }));
  } finally {
    await h.stop();
  }
});

Deno.test("getOrder: a timed-out call throws (never hangs) — capture-order's pre-read and the webhook's payee re-fetch both rely on this", async () => {
  const h = await harness();
  try {
    const token = await getAccessToken(h.config);
    const { orderId } = await createOrder(h.config, token, { amountUsd: "10.00", customId: "ten:u1", invoiceId: "i1", description: "d" });
    h.state.hang["/v2/checkout/orders/"] = true;
    const shortConfig: PayPalConfig = { ...h.config, timeoutMs: SHORT_TIMEOUT_MS };
    await assertRejects(() => getOrder(shortConfig, token, orderId));
  } finally {
    await h.stop();
  }
});

Deno.test("captureOrder: a timed-out capture call throws — the caller (handler.ts) already maps ANY throw here to 503 unconfirmed, never 'declined'", async () => {
  const h = await harness();
  try {
    const token = await getAccessToken(h.config);
    const { orderId } = await createOrder(h.config, token, { amountUsd: "10.00", customId: "ten:u1", invoiceId: "i1", description: "d" });
    h.state.hang["/capture"] = true;
    const shortConfig: PayPalConfig = { ...h.config, timeoutMs: SHORT_TIMEOUT_MS };
    await assertRejects(() => captureOrder(shortConfig, token, orderId, "req-timeout"));
  } finally {
    await h.stop();
  }
});

Deno.test("getCapture: a timed-out re-fetch throws (never hangs) — the webhook's own capture re-fetch relies on this", async () => {
  const h = await harness();
  try {
    h.state.captures["cap-x"] = { id: "cap-x", customId: "ten:u1", currencyCode: "USD", status: "COMPLETED", grossUsd: "10.00", feeUsd: "0.84", netUsd: "9.16" };
    const token = await getAccessToken(h.config);
    h.state.hang["/v2/payments/captures/"] = true;
    const shortConfig: PayPalConfig = { ...h.config, timeoutMs: SHORT_TIMEOUT_MS };
    await assertRejects(() => getCapture(shortConfig, token, "cap-x"));
  } finally {
    await h.stop();
  }
});

Deno.test("verifyWebhookSignature: a timed-out verify call -> ok:false (never throws), same as any other transport failure -> the caller's own 503 so PayPal retries", async () => {
  const h = await harness();
  try {
    const token = await getAccessToken(h.config);
    h.state.hang["/v1/notifications/verify-webhook-signature"] = true;
    const shortConfig: PayPalConfig = { ...h.config, timeoutMs: SHORT_TIMEOUT_MS };
    const outcome = await verifyWebhookSignature(shortConfig, token, "wh-1", HEADERS, {});
    assertEquals(outcome, { ok: false });
  } finally {
    await h.stop();
  }
});
