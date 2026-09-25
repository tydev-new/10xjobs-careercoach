// Unit/integration tests for ten-paypal, run with `deno test`.
// Uses a local stub PayPal server and a local stub Supabase server
// (supabase/functions/_shared/test-support.ts) — no real network, no
// TEN_PAYPAL_CLIENT_SECRET, no live PayPal/Supabase project. Covers
// docs/design-web-agent.md § 17.1 steps 2/4, § 17.10 ("Only Ten's own
// orders"), and the relevant § 17.8 test plan items.
//
// uidFromCustomId (F6, fix round 2) requires the STRICT `ten:<lowercase
// UUID>` shape, so every test uid below is a real UUID-shaped string —
// never a short placeholder like "u1" (which § 17.10's own check now
// correctly refuses as malformed).

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { handleRequest, MESSAGES, type PaypalDeps } from "./handler.ts";
import { captureOrder, createOrder, getAccessToken, getOrder, type PayPalConfig } from "../_shared/paypal.ts";
import { buildInvoiceId, checkTenOrder } from "../_shared/paypal-invoice.ts";
import { insertLedgerCredit, isMember, verifyUser, type SupabaseEnv } from "../_shared/supabase.ts";
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

const PROD_ORIGIN = "https://ten.example.com";
const BASE_ENV = { TEN_APP_ORIGIN: PROD_ORIGIN } satisfies Record<string, string>;
const TEST_CLIENT_SECRET = "test-secret";

const UID_A = "aaaaaaaa-1111-1111-1111-111111111111";
const UID_B = "bbbbbbbb-2222-2222-2222-222222222222";
const UID_N = "99999999-3333-3333-3333-333333333333"; // a non-member

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

async function harness(opts: { merchantConfigured?: boolean } = {}): Promise<Harness> {
  const state = freshState();
  const paypalState = freshPaypalState();
  const supabase = await startMockSupabase(state);
  const paypal = await startMockPaypal(paypalState);
  const supEnv: SupabaseEnv = { url: supabase.url, anonKey: state.anonKey, serviceRoleKey: state.serviceRoleKey };
  const paypalConfig: PayPalConfig = { apiBase: paypal.url, clientId: "test-client-id", clientSecret: TEST_CLIENT_SECRET };
  const warnings: unknown[] = [];
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
    signInvoiceId: (uid, pack, amountUsd) => buildInvoiceId(TEST_CLIENT_SECRET, uid, pack, amountUsd),
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
    stop: async () => {
      await supabase.stop();
      await paypal.stop();
    },
  };
}

/** A valid Ten-created, approved order — same shape create-order would
 * leave, but planted directly (no HTTP round trip through this handler) so
 * a test can jump straight to capture-order. */
async function plantValidOrder(h: Harness, uid: string, pack: "10" | "20" | "40" = "10", amountUsd?: string): Promise<string> {
  const amount = amountUsd ?? { "10": "10.00", "20": "20.00", "40": "40.00" }[pack];
  const invoiceId = await buildInvoiceId(TEST_CLIENT_SECRET, uid, pack, amount);
  const id = `order-${h.paypalState.nextOrderSeq++}`;
  h.paypalState.orders[id] = {
    id,
    customId: `ten:${uid}`,
    amountValue: amount,
    currencyCode: "USD",
    invoiceId,
    payeeMerchantId: MOCK_TEN_MERCHANT_ID,
    approved: true,
  };
  return id;
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
    h.state.users["tok-a"] = { id: UID_A };
    const res = await handleRequest(req("/create-order", { pack: "10" }, { token: "tok-a" }), h.deps, BASE_ENV);
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
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    const res = await handleRequest(req("/create-order", { pack: "999" }, { token: "tok-a" }), h.deps, BASE_ENV);
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
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    const res = await handleRequest(
      req("/create-order", { pack: "20", amount: "999.99", custom_id: `ten:${UID_B}` }, { token: "tok-a" }),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 200);
    // deno-lint-ignore no-explicit-any
    const sent = h.paypalState.createOrderRequests[0] as any;
    assertEquals(sent.purchase_units[0].amount.value, "20.00");
    assertEquals(sent.purchase_units[0].amount.currency_code, "USD");
    assertEquals(sent.purchase_units[0].custom_id, `ten:${UID_A}`);
  } finally {
    await h.stop();
  }
});

Deno.test("create-order: § 17.10's invoice_id shape — ten-<8hex>-<10digit>-<16hex>-<32hex>, no vault/agreement/plan/shipping", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    await handleRequest(req("/create-order", { pack: "10" }, { token: "tok-a" }), h.deps, BASE_ENV);
    // deno-lint-ignore no-explicit-any
    const sent = h.paypalState.createOrderRequests[0] as any;
    assertEquals(sent.purchase_units[0].custom_id, `ten:${UID_A}`);
    assertMatch(sent.purchase_units[0].invoice_id, /^ten-[0-9a-f]{8}-[0-9]{10}-[0-9a-f]{16}-[0-9a-f]{32}$/);
    assertEquals(sent.intent, "CAPTURE");
    const json = JSON.stringify(sent);
    for (const forbidden of ["vault", "saved", "agreement", "plan", "shipping"]) {
      assert(!json.toLowerCase().includes(forbidden), `outgoing body must not mention "${forbidden}": ${json}`);
    }
  } finally {
    await h.stop();
  }
});

Deno.test("create-order: the invoice_id's U is the caller's uid, first 8 chars, lowercase", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    await handleRequest(req("/create-order", { pack: "10" }, { token: "tok-a" }), h.deps, BASE_ENV);
    // deno-lint-ignore no-explicit-any
    const sent = h.paypalState.createOrderRequests[0] as any;
    const invoiceId = sent.purchase_units[0].invoice_id as string;
    assertEquals(invoiceId.split("-")[1], UID_A.slice(0, 8));
  } finally {
    await h.stop();
  }
});

Deno.test("create-order: § 17.10 test vector — a fixed key/uid/pack/T/N reproduces the documented H", async () => {
  // Independent hand-computation (not calling buildInvoiceId): H is the
  // first 32 lowercase hex chars of HMAC-SHA256(K, "v1|uid|pack|amount|T|N"),
  // K = HMAC-SHA256(TEN_PAYPAL_CLIENT_SECRET, "ten-invoice-v1").
  const enc = new TextEncoder();
  const hmac = async (key: Uint8Array | string, data: string) => {
    const raw = typeof key === "string" ? enc.encode(key) : key;
    const k = await crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  };
  const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  const secret = "vector-secret";
  const uid = "12345678-1234-1234-1234-123456789abc";
  const pack = "10";
  const amount = "10.00";
  const ts = "1758820600";
  const nonce = "00112233445566ff";
  const K = await hmac(secret, "ten-invoice-v1");
  const H = toHex(await hmac(K, `v1|${uid}|${pack}|${amount}|${ts}|${nonce}`)).slice(0, 32);
  // The production module can't be forced to use a fixed T/N (both are
  // generated internally), so this test only pins the ALGORITHM by
  // reproducing it independently and cross-checking `checkTenOrder` accepts
  // an invoice_id built from this exact hand-computed H.
  const invoiceId = `ten-${uid.slice(0, 8)}-${ts}-${nonce}-${H}`;
  const result = await checkTenOrder(secret, "M1", {
    customId: `ten:${uid}`,
    invoiceId,
    amountValue: amount,
    currencyCode: "USD",
    payeeMerchantId: "M1",
  });
  assertEquals(result, { ok: true, uid, pack: "10" });
});

Deno.test("create-order: a PayPal failure (token or order) -> 5xx with § 1.11's create-failed copy, no order id, no row", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    for (const f of ["/v1/oauth2/token", "/v2/checkout/orders"]) {
      h.paypalState.fail = { [f]: 500 };
      const res = await handleRequest(req("/create-order", { pack: "10" }, { token: "tok-a" }), h.deps, BASE_ENV);
      const txt = await res.text();
      assert(res.status >= 500, `${f}: ${res.status}`);
      assert(txt.includes("Couldn't start a payment. No money moved."), txt);
      assert(!txt.includes("orderId"));
    }
    h.paypalState.fail = {};
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

// ------------------------------------------------------------ capture-order ---

Deno.test("capture-order: § 17.10 — a lookalike/forged/foreign custom_id, a non-pack amount, or a foreign payee -> 403 not_ten_order, no capture call", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    const validTag = await buildInvoiceId(TEST_CLIENT_SECRET, UID_A, "10", "10.00");

    const cases: Array<[string, Record<string, unknown>]> = [
      ["bare UUID (older app)", { customId: UID_A, invoiceId: validTag }],
      ["lookalike custom_id, trailing space", { customId: `ten:${UID_A} `, invoiceId: validTag }],
      ["uppercase custom_id", { customId: `ten:${UID_A.toUpperCase()}`, invoiceId: validTag }],
      [
        "non-pack amount",
        { customId: `ten:${UID_A}`, amountValue: "10.01", invoiceId: await buildInvoiceId(TEST_CLIENT_SECRET, UID_A, "10", "10.01") },
      ],
      ["foreign payee, otherwise-valid tag", { customId: `ten:${UID_A}`, invoiceId: validTag, payeeMerchantId: "SOMEONE-ELSE" }],
      ["no invoice_id at all", { customId: `ten:${UID_A}`, invoiceId: "" }],
      ["a random invoice_id", { customId: `ten:${UID_A}`, invoiceId: "ten-deadbeef-1758820600-0011223344556677-" + "a".repeat(32) }],
      ["another uid's valid tag", { customId: `ten:${UID_A}`, invoiceId: await buildInvoiceId(TEST_CLIENT_SECRET, UID_B, "10", "10.00") }],
      ["another pack's tag (20, not 10)", { customId: `ten:${UID_A}`, invoiceId: await buildInvoiceId(TEST_CLIENT_SECRET, UID_A, "20", "10.00") }],
      ["one hex digit changed", { customId: `ten:${UID_A}`, invoiceId: validTag.slice(0, -1) + (validTag.at(-1) === "0" ? "1" : "0") }],
      ["a tag from another secret", { customId: `ten:${UID_A}`, invoiceId: await buildInvoiceId("some-other-secret", UID_A, "10", "10.00") }],
    ];
    for (const [label, overrides] of cases) {
      const id = `order-${h.paypalState.nextOrderSeq++}`;
      h.paypalState.orders[id] = {
        id,
        customId: `ten:${UID_A}`,
        amountValue: "10.00",
        currencyCode: "USD",
        invoiceId: validTag,
        payeeMerchantId: MOCK_TEN_MERCHANT_ID,
        approved: true,
        ...overrides,
      };
      const res = await handleRequest(req("/capture-order", { orderId: id }, { token: "tok-a" }), h.deps, BASE_ENV);
      const body = await res.json();
      assertEquals(res.status, 403, `${label}: ${res.status} ${JSON.stringify(body)}`);
      assertEquals(body.error.code, "not_ten_order", label);
    }
    assertEquals(h.paypalState.captureRequestIdsSeen.length, 0, "not_ten_order never captures");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: a valid Ten order belonging to someone else -> 403 not_your_order, no capture call", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    const orderId = await plantValidOrder(h, UID_B);
    const res = await handleRequest(req("/capture-order", { orderId }, { token: "tok-a" }), h.deps, BASE_ENV);
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.error.code, "not_your_order");
    assertEquals(h.paypalState.captureRequestIdsSeen.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: 401 / 403 / missing orderId 400 before any PayPal call", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.users["tok-n"] = { id: UID_N };
    const orderId = await plantValidOrder(h, UID_A);
    assertEquals((await handleRequest(req("/capture-order", { orderId }), h.deps, BASE_ENV)).status, 401);
    h.state.members.add(UID_A);
    assertEquals((await handleRequest(req("/capture-order", { orderId }, { token: "tok-n" }), h.deps, BASE_ENV)).status, 403);
    assertEquals((await handleRequest(req("/capture-order", {}, { token: "tok-a" }), h.deps, BASE_ENV)).status, 400);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: a completed capture credits exactly one ledger row, keyed by paypal:<captureId>, with the PayPal-Request-Id header set", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    const orderId = await plantValidOrder(h, UID_A);
    const res = await handleRequest(req("/capture-order", { orderId }, { token: "tok-a" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "credited");
    assertEquals(body.grossUsd, "10.00");
    assertEquals(body.feeUsd, "0.84");
    assertEquals(body.creditedUsd, "9.16");
    assertEquals(h.state.ledgerInserts.length, 1);
    const row = h.state.ledgerInserts[0];
    assertEquals(row.kind, "credit");
    assertEquals(row.request_id, `paypal:cap-${orderId}`);
    assertEquals(row.usd, "9.16");
    assertEquals(row.gross_usd, "10.00");
    assertEquals(row.fee_usd, "0.84");
    assertEquals(h.paypalState.captureRequestIdsSeen, [`ten-capture-${orderId}`]);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: ORDER_ALREADY_CAPTURED re-reads the order's own capture and still credits exactly once", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    const orderId = await plantValidOrder(h, UID_A, "20");
    h.paypalState.orders[orderId].capture = {
      id: `cap-${orderId}`,
      customId: `ten:${UID_A}`,
      currencyCode: "USD",
      status: "COMPLETED",
      grossUsd: "20.00",
      feeUsd: "1.19",
      netUsd: "18.81",
      invoiceId: h.paypalState.orders[orderId].invoiceId,
      orderId,
    };
    h.paypalState.captures[`cap-${orderId}`] = h.paypalState.orders[orderId].capture!;

    const res = await handleRequest(req("/capture-order", { orderId }, { token: "tok-a" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "credited");
    assertEquals(body.creditedUsd, "18.81");
    assertEquals(h.state.ledgerInserts.length, 1);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: a replayed capture (same captureId already in the ledger) still answers 'credited', no second row", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    const orderId = await plantValidOrder(h, UID_A);
    h.state.ledgerRequestIds.add(`paypal:cap-${orderId}`);
    h.state.ledgerInserts.push({ user_id: UID_A, kind: "credit", request_id: `paypal:cap-${orderId}`, usd: "9.16" });

    const res = await handleRequest(req("/capture-order", { orderId }, { token: "tok-a" }), h.deps, BASE_ENV);
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
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    const orderId = await plantValidOrder(h, UID_A);
    h.paypalState.orders[orderId].approved = false;
    const res = await handleRequest(req("/capture-order", { orderId }, { token: "tok-a" }), h.deps, BASE_ENV);
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
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    const orderId = await plantValidOrder(h, UID_A);
    h.paypalState.orders[orderId].captureOverride = { status: "PENDING" };
    const res = await handleRequest(req("/capture-order", { orderId }, { token: "tok-a" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "pending");
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: DECLINED or FAILED -> 'declined', no ledger row", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    for (const status of ["DECLINED", "FAILED"]) {
      const orderId = await plantValidOrder(h, UID_A);
      h.paypalState.orders[orderId].captureOverride = { status };
      const res = await handleRequest(req("/capture-order", { orderId }, { token: "tok-a" }), h.deps, BASE_ENV);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.status, "declined", status);
    }
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: § 17.10 'Errors' — a capture call answering 500/timeout/unknown error -> 503 unconfirmed, never 'declined'", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    const orderId = await plantValidOrder(h, UID_A);
    h.paypalState.fail = { "/capture": 500 };
    const res = await handleRequest(req("/capture-order", { orderId }, { token: "tok-a" }), h.deps, BASE_ENV);
    h.paypalState.fail = {};
    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.error.code, "unconfirmed");
    assert(!JSON.stringify(body).includes("No money moved"));
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: a breakdown that doesn't add up -> no row, an ALERT, 503 paid_not_credited", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    const orderId = await plantValidOrder(h, UID_A);
    h.paypalState.orders[orderId].captureOverride = { grossUsd: "8.79", currencyCode: "EUR", feeUsd: "0.84", netUsd: "7.95" };
    const res = await handleRequest(req("/capture-order", { orderId }, { token: "tok-a" }), h.deps, BASE_ENV);
    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.error.code, "paid_not_credited");
    assertEquals(h.state.ledgerInserts.length, 0);
    assert(h.warnings.some((w) => JSON.stringify(w).includes("ALERT paypal breakdown mismatch")));
  } finally {
    await h.stop();
  }
});

Deno.test("capture-order: a failed credit write -> 503 paid_not_credited with § 1.11's copy", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);
    const orderId = await plantValidOrder(h, UID_A);
    h.state.ledgerInsertPlan = ["fail"];
    const res = await handleRequest(req("/capture-order", { orderId }, { token: "tok-a" }), h.deps, BASE_ENV);
    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.error.code, "paid_not_credited");
    assert(body.error.message.includes("Ten couldn't confirm the credit yet"));
    assertEquals(h.state.ledgerInserts.length, 0);
  } finally {
    await h.stop();
  }
});

Deno.test("unknown path -> 404; CORS restricted to the allowlist, same as the other functions", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(req("/something-else", {}, { token: "tok-a" }), h.deps, BASE_ENV);
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

Deno.test("§ 17.10 lead ruling (2026-09-25): TEN_PAYPAL_MERCHANT_ID unset -> both routes 503, no PayPal call, no row", async () => {
  const h = await harness({ merchantConfigured: false });
  try {
    h.state.users["tok-a"] = { id: UID_A };
    h.state.members.add(UID_A);

    const createRes = await handleRequest(req("/create-order", { pack: "10" }, { token: "tok-a" }), h.deps, BASE_ENV);
    assertEquals(createRes.status, 503);
    assertEquals(h.paypalState.createOrderRequests.length, 0, "create-order: no PayPal call when unconfigured");

    // Plant an order directly (bypassing create-order, which is itself
    // disabled above) so capture-order's own check is exercised in
    // isolation.
    const orderId = await plantValidOrder(h, UID_A);
    const captureRes = await handleRequest(req("/capture-order", { orderId }, { token: "tok-a" }), h.deps, BASE_ENV);
    assertEquals(captureRes.status, 503);
    assertEquals(h.paypalState.captureRequestIdsSeen.length, 0, "capture-order: no capture call when unconfigured");
    assertEquals(h.state.ledgerInserts.length, 0, "no ledger row either way");
  } finally {
    await h.stop();
  }
});

Deno.test("MESSAGES.paypalError is the § 1.11 create-order-failed copy, word for word", () => {
  assertEquals(MESSAGES.paypalError, "Couldn't start a payment. No money moved.");
});

Deno.test("MESSAGES.unconfirmed / paidNotCredited both carry § 1.11's 'couldn't confirm' copy, word for word", () => {
  const text =
    "Ten couldn't confirm the credit yet. If PayPal took your payment, it's added automatically, usually " +
    "within minutes. If not by tomorrow, email support@10xjobs.co with PayPal's receipt.";
  assertEquals(MESSAGES.unconfirmed, text);
  assertEquals(MESSAGES.paidNotCredited, text);
});
