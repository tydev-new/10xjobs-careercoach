// Unit/integration tests for ten-paypal, run with `deno test`.
// Uses a local stub PayPal server and a local stub Supabase server
// (supabase/functions/_shared/test-support.ts) — no real network, no
// TEN_PAYPAL_CLIENT_SECRET, no live PayPal/Supabase project. Covers
// docs/design-web-agent.md § 17.1 steps 2/4 and the relevant § 17.8 test
// plan items (1, 2, 3, 5, 6).

import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleRequest, MESSAGES, type PaypalDeps } from "./handler.ts";
import { captureOrder, createOrder, getAccessToken, getOrder, type PayPalConfig } from "../_shared/paypal.ts";
import { insertLedgerCredit, isMember, verifyUser, type SupabaseEnv } from "../_shared/supabase.ts";
import {
  freshPaypalState,
  freshState,
  startMockPaypal,
  startMockSupabase,
  type MockPaypalState,
  type MockServer,
  type MockSupabaseState,
} from "../_shared/test-support.ts";

const PROD_ORIGIN = "https://ten.example.com";
const BASE_ENV = { TEN_APP_ORIGIN: PROD_ORIGIN } satisfies Record<string, string>;

function req(path: string, body: unknown, opts: { token?: string; origin?: string; method?: string } = {}): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opts.token !== undefined) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.origin !== undefined) headers.set("origin", opts.origin);
  return new Request(`http://localhost${path}`, {
    method: opts.method ?? "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface Harness {
  supabase: MockServer;
  paypal: MockServer;
  state: MockSupabaseState;
  paypalState: MockPaypalState;
  deps: PaypalDeps;
  warnings: unknown[];
  stop(): Promise<void>;
}

async function harness(): Promise<Harness> {
  const state = freshState();
  const paypalState = freshPaypalState();
  const supabase = await startMockSupabase(state);
  const paypal = await startMockPaypal(paypalState);
  const supEnv: SupabaseEnv = { url: supabase.url, anonKey: state.anonKey, serviceRoleKey: state.serviceRoleKey };
  const paypalConfig: PayPalConfig = { apiBase: paypal.url, clientId: "test-client-id", clientSecret: "test-secret" };
  const warnings: unknown[] = [];
  let seq = 0;
  const deps: PaypalDeps = {
    verifyUser: (token) => verifyUser(supEnv, token),
    isMember: (token) => isMember(supEnv, token),
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
    insertLedgerCredit: (row) => insertLedgerCredit(supEnv, row),
    randomId: () => `fixed-id-${seq++}`,
    log: { warn: (e) => warnings.push(e) },
  };
  return {
    supabase,
    paypal,
    state,
    paypalState,
    deps,
    warnings,
    stop: async () => {
      await supabase.stop();
      await paypal.stop();
    },
  };
}

// ------------------------------------------------------------- create-order ---

Deno.test("create-order: 401 without a JWT", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(req("/create-order", { pack: "10" }), h.deps, BASE_ENV);
    assertEquals(res.status, 401);
  } finally {
    await h.stop();
  }
});

Deno.test("create-order: 403 signed in but not a member", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    const res = await handleRequest(req("/create-order", { pack: "10" }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.error.code, "not_a_member");
  } finally {
    await h.stop();
  }
});

Deno.test("create-order: 400 unknown pack", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    const res = await handleRequest(req("/create-order", { pack: "999" }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error.code, "unknown_pack");
  } finally {
    await h.stop();
  }
});

Deno.test("create-order: the amount comes from the server's table, whatever the body ALSO adds (amount, custom_id)", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    const res = await handleRequest(
      req("/create-order", { pack: "20", amount: "999.99", custom_id: "ten:someone-else" }, { token: "tok-1" }),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 200);
    // deno-lint-ignore no-explicit-any
    const sent = h.paypalState.createOrderRequests[0] as any;
    assertEquals(sent.purchase_units[0].amount.value, "20.00");
    assertEquals(sent.purchase_units[0].amount.currency_code, "USD");
    assertEquals(sent.purchase_units[0].custom_id, "ten:u1");
  } finally {
    await h.stop();
  }
});

Deno.test("create-order: custom_id is ten:<caller>, invoice_id is unique, no vault/agreement/plan field anywhere in the body", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    await handleRequest(req("/create-order", { pack: "10" }, { token: "tok-1" }), h.deps, BASE_ENV);
    // deno-lint-ignore no-explicit-any
    const sent = h.paypalState.createOrderRequests[0] as any;
    assertEquals(sent.purchase_units[0].custom_id, "ten:u1");
    assert(typeof sent.purchase_units[0].invoice_id === "string" && sent.purchase_units[0].invoice_id.startsWith("ten-"));
    assertEquals(sent.intent, "CAPTURE");
    const json = JSON.stringify(sent);
    for (const forbidden of ["vault", "saved", "agreement", "plan", "shipping"]) {
      assert(!json.toLowerCase().includes(forbidden), `outgoing body must not mention "${forbidden}": ${json}`);
    }
  } finally {
    await h.stop();
  }
});

// ------------------------------------------------------------ capture-order ---

Deno.test("capture-order: another user's order -> 403, no capture call", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.paypalState.orders["order-x"] = { id: "order-x", customId: "ten:someone-else", amountValue: "10.00", currencyCode: "USD", approved: true };
    const res = await handleRequest(req("/capture-order", { orderId: "order-x" }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 403);
    assertEquals(h.paypalState.captureRequestIdsSeen.length, 0, "capture is never called once the pre-read fails ownership");
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: an older-app order (bare UUID custom_id) -> 403, no capture call", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.paypalState.orders["order-old"] = { id: "order-old", customId: "550e8400-e29b-41d4-a716-446655440000", amountValue: "10.00", currencyCode: "USD", approved: true };
    const res = await handleRequest(req("/capture-order", { orderId: "order-old" }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 403);
    assertEquals(h.paypalState.captureRequestIdsSeen.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: a ten: order with a non-pack amount -> 400, no capture call", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.paypalState.orders["order-bad-amt"] = { id: "order-bad-amt", customId: "ten:u1", amountValue: "13.37", currencyCode: "USD", approved: true };
    const res = await handleRequest(req("/capture-order", { orderId: "order-bad-amt" }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error.code, "bad_amount");
    assertEquals(h.paypalState.captureRequestIdsSeen.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: a completed capture credits exactly one ledger row, keyed by paypal:<captureId>, with the PayPal-Request-Id header set", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.paypalState.orders["order-1"] = { id: "order-1", customId: "ten:u1", amountValue: "10.00", currencyCode: "USD", approved: true };
    const res = await handleRequest(req("/capture-order", { orderId: "order-1" }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "credited");
    assertEquals(body.grossUsd, "10.00");
    assertEquals(body.feeUsd, "0.84");
    assertEquals(body.creditedUsd, "9.16");
    assertEquals(h.state.ledgerInserts.length, 1);
    const row = h.state.ledgerInserts[0];
    assertEquals(row.kind, "credit");
    assertEquals(row.request_id, "paypal:cap-order-1");
    assertEquals(row.usd, "9.16");
    assertEquals(row.gross_usd, "10.00");
    assertEquals(row.fee_usd, "0.84");
    assertEquals(h.paypalState.captureRequestIdsSeen, ["ten-capture-order-1"]);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: ORDER_ALREADY_CAPTURED re-reads the order's own capture and still credits exactly once", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.paypalState.orders["order-2"] = { id: "order-2", customId: "ten:u1", amountValue: "20.00", currencyCode: "USD", approved: true };
    // Pre-capture it directly on the mock, simulating a race where the
    // capture already landed before THIS call's capture attempt.
    h.paypalState.orders["order-2"].capture = { id: "cap-order-2", customId: "ten:u1", currencyCode: "USD", status: "COMPLETED", grossUsd: "20.00", feeUsd: "1.14", netUsd: "18.86" };
    h.paypalState.captures["cap-order-2"] = h.paypalState.orders["order-2"].capture!;

    const res = await handleRequest(req("/capture-order", { orderId: "order-2" }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "credited");
    assertEquals(body.creditedUsd, "18.86");
    assertEquals(h.state.ledgerInserts.length, 1);
    assertEquals(h.state.ledgerInserts[0].request_id, "paypal:cap-order-2");
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: a replayed capture (same captureId already in the ledger) still answers 'credited', no second row", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.paypalState.orders["order-3"] = { id: "order-3", customId: "ten:u1", amountValue: "10.00", currencyCode: "USD", approved: true };
    // Seed the ledger as though the webhook already credited this exact
    // capture (same id the mock will produce: cap-order-3).
    h.state.ledgerRequestIds.add("paypal:cap-order-3");
    h.state.ledgerInserts.push({ user_id: "u1", kind: "credit", request_id: "paypal:cap-order-3", usd: "9.16" });

    const res = await handleRequest(req("/capture-order", { orderId: "order-3" }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "credited");
    assertEquals(h.state.ledgerInserts.length, 1, "no second row for the same capture");
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: ORDER_NOT_APPROVED -> window_closed, no ledger row", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.paypalState.orders["order-4"] = { id: "order-4", customId: "ten:u1", amountValue: "10.00", currencyCode: "USD", approved: false };
    const res = await handleRequest(req("/capture-order", { orderId: "order-4" }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "window_closed");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: PENDING -> 'pending', no ledger row (no fee breakdown until it clears)", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.paypalState.orders["order-5"] = {
      id: "order-5",
      customId: "ten:u1",
      amountValue: "10.00",
      currencyCode: "USD",
      approved: true,
      captureOverride: { status: "PENDING", grossUsd: undefined, feeUsd: undefined, netUsd: undefined },
    };
    const res = await handleRequest(req("/capture-order", { orderId: "order-5" }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "pending");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: a breakdown that doesn't add up (non-USD gross) -> no row, an alert, 503 paid_not_credited", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.paypalState.orders["order-6"] = {
      id: "order-6",
      customId: "ten:u1",
      amountValue: "10.00",
      currencyCode: "USD",
      approved: true,
      captureOverride: { grossUsd: "8.79", currencyCode: "EUR", feeUsd: "0.84", netUsd: "7.95" },
    };
    const res = await handleRequest(req("/capture-order", { orderId: "order-6" }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.error.code, "paid_not_credited");
    assertEquals(h.state.ledgerInserts.length, 0);
    assert(h.warnings.some((w) => JSON.stringify(w).includes("ALERT")));
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: a declined capture -> 'declined', no ledger row", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.paypalState.orders["order-7"] = {
      id: "order-7",
      customId: "ten:u1",
      amountValue: "10.00",
      currencyCode: "USD",
      approved: true,
      captureOverride: { status: "DECLINED", grossUsd: undefined, feeUsd: undefined, netUsd: undefined },
    };
    const res = await handleRequest(req("/capture-order", { orderId: "order-7" }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "declined");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: 401/403 checked before routing, same as create-order", async () => {
  const h = await harness();
  try {
    const res401 = await handleRequest(req("/capture-order", { orderId: "x" }), h.deps, BASE_ENV);
    assertEquals(res401.status, 401);

    h.state.users["tok-1"] = { id: "u1" };
    const res403 = await handleRequest(req("/capture-order", { orderId: "x" }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res403.status, 403);
  } finally {
    await h.stop();
  }
});

Deno.test("unknown path -> 404; CORS restricted to the allowlist, same as the other functions", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(req("/something-else", {}, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 404);

    const preflight = await handleRequest(req("/create-order", undefined, { method: "OPTIONS", origin: PROD_ORIGIN }), h.deps, BASE_ENV);
    assertEquals(preflight.status, 204);
    assertEquals(preflight.headers.get("Access-Control-Allow-Origin"), PROD_ORIGIN);

    const badOrigin = await handleRequest(req("/create-order", undefined, { method: "OPTIONS", origin: "https://evil.example" }), h.deps, BASE_ENV);
    assertEquals(badOrigin.headers.get("Access-Control-Allow-Origin"), null);
  } finally {
    await h.stop();
  }
});

Deno.test("MESSAGES.paypalError is the § 1.11 create-order-failed copy, word for word", () => {
  assertEquals(MESSAGES.paypalError, "Couldn't start a payment. No money moved.");
});
