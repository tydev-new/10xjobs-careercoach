// Independent tester — docs/design-web-agent.md § 17.1 steps 2 and 4, § 17.3,
// § 17.8 items 1, 2, 3, 5, 6 and design-web-ui.md § 1.11. Written from the
// spec, run against the REAL deploy entry point supabase/functions/ten-paypal/
// index.ts (its own getAccessToken/createOrder/getOrder/captureOrder and
// insertLedgerCredit) over a loopback PayPal stub and the Supabase stub
// (_harness.ts). Nothing reaches paypal.com or supabase.co.

// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  breakdownFor,
  harness,
  member,
  nonMember,
  observe,
  PAY,
  PAYPAL_BASE,
  PAYPAL_TOKEN,
  ppPlantOrder,
  ppSetCapture,
  ppSignedEvent,
  preq,
  t,
  TAG_RE,
  tagHash,
  PAYPAL_CLIENT_SECRET,
  userJwt,
} from "./_harness.ts";
import { createApproved, hook, paid, pay } from "./_paypal.ts";

type H = Awaited<ReturnType<typeof harness>>;

const captureHits = (h: H) => h.pp.hits.filter((x) => x.method === "POST" && x.path.endsWith("/capture"));
const orderCreates = (h: H) => h.pp.hits.filter((x) => x.method === "POST" && x.path === "/v2/checkout/orders");

/** PayPal captures on its side (the browser's capture-order never arrived). */
async function captureAtPayPal(orderId: string, requestId: string) {
  const r = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${PAYPAL_TOKEN}`, "content-type": "application/json", "paypal-request-id": requestId },
    body: "{}",
  });
  const j = await r.json();
  return j.purchase_units[0].payments.captures[0];
}

// ============================================================ create-order
t("§ 17.8(1) create-order: no token 401, a bad token 401, a non-member 403, an unknown pack 400 — no PayPal order in any", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const [, ntok] = await nonMember(h);
  assertEquals((await pay(h, "/create-order", { pack: "10" })).status, 401);
  assertEquals((await pay(h, "/create-order", { pack: "10" }, "not.a.jwt")).status, 401);
  assertEquals((await pay(h, "/create-order", { pack: "10" }, await userJwt(crypto.randomUUID()))).status, 401, "a signed JWT for no auth user");
  assertEquals((await pay(h, "/create-order", { pack: "10" }, ntok)).status, 403);
  for (const pack of ["5", "15", "100", "10.00", "$10", " 10", "", null, 10, 20, ["10"], { pack: "10" }, "__proto__", "constructor", "toString", "hasOwnProperty"]) {
    const r = await pay(h, "/create-order", { pack }, tok);
    assertEquals(r.status, 400, `pack ${JSON.stringify(pack)} -> ${r.status} ${r.txt}`);
  }
  assertEquals((await pay(h, "/create-order", {}, tok)).status, 400, "no pack");
  assertEquals((await pay(h, "/create-order", undefined, tok, { raw: "{not json" })).status, 400, "bad JSON");
  assertEquals(orderCreates(h).length, 0, "no PayPal order was created by any refused call");
});

t("§ 17.8(1) create-order: the amount comes from the table whatever the body adds; custom_id ten:<caller>; invoice ten-<uuid>; description; no vault/agreement/plan/shipping", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  const [other] = await member(h);
  const want: Record<string, string> = { "10": "10.00", "20": "20.00", "40": "40.00" };
  const invoices = new Set<string>();
  for (const pack of ["10", "20", "40"]) {
    const r = await pay(h, "/create-order", {
      pack,
      amount: "0.01",
      value: "0.01",
      currency_code: "JPY",
      custom_id: `ten:${other}`,
      invoice_id: "attacker-chosen",
      description: "free credit",
      purchase_units: [{ amount: { currency_code: "USD", value: "0.01" }, custom_id: `ten:${other}` }],
      payment_source: { paypal: { attributes: { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT" } } } },
      intent: "AUTHORIZE",
    }, tok);
    assertEquals(r.status, 200, r.txt);
    assertEquals(Object.keys(r.j), ["orderId"], "returns { orderId } only");
    const sent = orderCreates(h).at(-1)!.body;
    observe(`create-order ${pack} -> PayPal body ${JSON.stringify(sent)}`);
    assertEquals(sent.intent, "CAPTURE");
    assertEquals(sent.purchase_units.length, 1);
    const pu = sent.purchase_units[0];
    assertEquals(pu.amount, { currency_code: "USD", value: want[pack] }, "amount from the server's table, not the body");
    assertEquals(pu.custom_id, `ten:${uid}`, "custom_id is ten:<caller>, never the body's");
    // § 17.10: ten-<U>-<T>-<N>-<H>, 73 chars, H recomputed from the spec
    assertMatch(pu.invoice_id, TAG_RE);
    assertEquals(pu.invoice_id.length, 73);
    const [, U, T, N, Hh] = pu.invoice_id.split("-");
    assertEquals(U, uid.slice(0, 8));
    assertEquals(Hh, await tagHash(PAYPAL_CLIENT_SECRET, uid, pack, want[pack], T, N), "H = HMAC(K, v1|uid|pack|amount|T|N)");
    invoices.add(pu.invoice_id);
    assertEquals(pu.description, `Ten credit $${pack}`);
    assert(!("shipping" in pu), "no shipping address");
    const flat = JSON.stringify(sent).toLowerCase();
    for (const bad of ["vault", "store_in_vault", "agreement", "plan_id", "billing", "subscription", "setup_token", "payment_source", "usage_type"]) {
      assert(!flat.includes(bad), `order body carries "${bad}": ${flat}`);
    }
    assertEquals(h.pp.orders.get(r.j.orderId)!.purchase_units[0].amount.value, want[pack]);
  }
  assertEquals(invoices.size, 3, "invoice ids are unique");
  assertEquals(paid(h).length, 0, "creating an order credits nothing");
});

t("create-order: a PayPal failure (token or order) -> 5xx with § 1.11's create-failed copy, no order id, no row", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  for (const f of ["/v1/oauth2/token", "/v2/checkout/orders"]) {
    h.pp.fail = { [f]: 500 };
    const r = await pay(h, "/create-order", { pack: "10" }, tok);
    assert(r.status >= 500, `${f}: ${r.status}`);
    assert(r.txt.includes("Couldn't start a payment. No money moved."), r.txt);
    assert(!r.txt.includes("orderId"));
  }
  h.pp.fail = {};
  assertEquals(paid(h).length, 0);
});

t("routes: GET/PUT on create-order/capture-order and unknown paths never reach PayPal", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    for (const p of ["/create-order", "/capture-order"]) {
      const res = await h.paypal(preq(undefined, { url: PAY + p, token: tok, method }));
      await res.body?.cancel();
      assert(res.status === 404 || res.status === 405, `${method} ${p} -> ${res.status}`);
    }
  }
  for (const p of ["/", "/create-order/x", "/capture", "/webhook", "/../ten-model-proxy"]) {
    const r = await pay(h, p, { pack: "10" }, tok);
    assert(r.status === 404, `${p} -> ${r.status}`);
  }
  assertEquals(h.pp.hits.length, 0);
});

// =========================================================== capture-order
t("§ 17.8(2) capture-order: another user's order 403, an older-app order (bare UUID) 403, a ten: order with a non-pack amount 400 — no capture call", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const [b, tb] = await member(h);
  const bOrder = await createApproved(h, tb, "10");
  const oldApp = ppPlantOrder(h.pp, { customId: a, value: "10.00" }); // the older app: bare UUID
  const oddAmount = ppPlantOrder(h.pp, { customId: `ten:${a}`, value: "10.01" });
  const five = ppPlantOrder(h.pp, { customId: `ten:${a}`, value: "5.00" });
  const big = ppPlantOrder(h.pp, { customId: `ten:${a}`, value: "1000.00" });
  const eur = ppPlantOrder(h.pp, { customId: `ten:${a}`, value: "10.00", currency: "EUR" });
  const noDec = ppPlantOrder(h.pp, { customId: `ten:${a}`, value: "10" });
  const lookalikes = [`ten:${a} `, `TEN:${a}`, `ten:${a.toUpperCase()}`, `ten:${a}:x`, `xten:${a}`, `ten:ten:${a}`, `ten: ${a}`, ""].map((c) =>
    ppPlantOrder(h.pp, { customId: c, value: "10.00" })
  );
  const cases: Array<[string, string, number]> = [
    ["B's order", bOrder, 403],
    ["older-app bare UUID", oldApp, 403],
    // § 17.8(2) as amended by § 17.10: "all 403 (the last two not_ten_order)"
    ["10.01", oddAmount, 403],
    ["5.00 (the starter is not a pack)", five, 403],
    ["1000.00", big, 403],
    ["EUR", eur, 403],
    ["'10' without cents", noDec, 403],
    ...lookalikes.map((o, i) => [`lookalike custom_id #${i}`, o, 403] as [string, string, number]),
  ];
  for (const [label, orderId, want] of cases) {
    const r = await pay(h, "/capture-order", { orderId }, ta);
    assertEquals(r.status, want, `${label}: ${r.txt}`);
  }
  assertEquals(captureHits(h).length, 0, "nothing was captured");
  assertEquals(paid(h).length, 0);
  assertEquals((await pay(h, "/capture-order", { orderId: bOrder }, tb)).j?.status, "credited", "B can still capture B's own order");
  assertEquals(paid(h, b).length, 1);
  assertEquals(paid(h, a).length, 0);
});

t("capture-order: 401 / 403 / missing orderId 400 before any PayPal call; an unknown order is no credit", async () => {
  const h = await harness();
  h.reset();
  const [, ta] = await member(h);
  const [, tn] = await nonMember(h);
  const orderId = await createApproved(h, ta);
  const before = h.pp.hits.length;
  assertEquals((await pay(h, "/capture-order", { orderId })).status, 401);
  assertEquals((await pay(h, "/capture-order", { orderId }, tn)).status, 403);
  assertEquals((await pay(h, "/capture-order", {}, ta)).status, 400);
  assertEquals((await pay(h, "/capture-order", { orderId: 42 }, ta)).status, 400);
  assertEquals(h.pp.hits.length, before, "no PayPal call for a refused request");
  const unknown = await pay(h, "/capture-order", { orderId: "NOSUCHORDER" }, ta);
  observe(`unknown order -> ${unknown.status} ${unknown.txt}`);
  assert(unknown.status >= 400, unknown.txt);
  for (const evil of ["../../v1/oauth2/token", "X/capture", "X?y=1", "%2e%2e"]) {
    const r = await pay(h, "/capture-order", { orderId: evil }, ta);
    assert(r.status >= 400, `${evil}: ${r.txt}`);
  }
  assert(h.pp.hits.every((x) => /^\/v1\/oauth2\/token$|^\/v2\/checkout\/orders\/[^/]+(\/capture)?$|^\/v2\/checkout\/orders$/.test(x.path)), JSON.stringify(h.pp.hits.map((x) => x.path)));
  assertEquals(captureHits(h).length, 0);
  assertEquals(paid(h).length, 0);
});

t("§ 17.1(4)/§ 17.3 COMPLETED: one credit row, usd = PayPal's net, gross/fee recorded, request_id paypal:<captureId>, PayPal-Request-Id ten-capture-<orderId>", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  for (const [pack, gross, fee, net] of [["10", "10.00", "0.84", "9.16"], ["20", "20.00", "1.19", "18.81"], ["40", "40.00", "1.89", "38.11"]]) {
    const orderId = await createApproved(h, ta, pack);
    const r = await pay(h, "/capture-order", { orderId }, ta);
    assertEquals(r.status, 200, r.txt);
    assertEquals(r.j, { status: "credited", grossUsd: gross, feeUsd: fee, creditedUsd: net });
    const hit = captureHits(h).at(-1)!;
    assertEquals(hit.headers.get("paypal-request-id"), `ten-capture-${orderId}`);
    const cap = h.pp.orders.get(orderId)!.capture!;
    const row = paid(h, a).find((x) => x.request_id === `paypal:${cap.id}`);
    assert(row, "a row keyed paypal:<captureId>");
    assertEquals(row!.kind, "credit");
    assertEquals(row!.usd_micros, Math.round(Number(net) * 1e6), "usd = net_amount, exactly");
    assertEquals(row!.gross_cents, Math.round(Number(gross) * 100));
    assertEquals(row!.fee_cents, Math.round(Number(fee) * 100));
    assertEquals(row!.user_id, a);
  }
  assertEquals(paid(h, a).length, 3);
  const inserts = h.st.requests.filter((x) => x.method === "POST" && x.path.startsWith("/rest/v1/ten_usage_ledger"));
  for (const ins of inserts) {
    const b = JSON.parse(ins.body);
    observe(`ledger insert body ${ins.body}`);
    assertEquals(typeof b.usd, "string", "PayPal's decimal string reaches Postgres unparsed (§ 17.3)");
    assertEquals(typeof b.gross_usd, "string");
    assertEquals(typeof b.fee_usd, "string");
    for (const k of Object.keys(b)) assert(!/payer|email|name|address/i.test(k), `stores ${k}`);
  }
});

t("§ 17.8(3) parallel captures of one order (x6): one row; every answer is 'credited' or a non-credit, never two credits", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  let release!: () => void;
  h.pp.captureGate = new Promise<void>((r) => (release = r));
  const all = Array.from({ length: 6 }, () => pay(h, "/capture-order", { orderId }, ta));
  await new Promise((r) => setTimeout(r, 50));
  release();
  const rs = await Promise.all(all);
  h.pp.captureGate = undefined;
  observe(`parallel: ${rs.map((r) => `${r.status}:${r.j?.status ?? r.j?.error?.code}`).join(", ")}`);
  assertEquals(paid(h, a).length, 1, "exactly one row");
  assert(rs.every((r) => r.status === 200 && r.j.status === "credited"), "each caller learns it was credited");
});

t("§ 17.8(3) capture then webhook, and a webhook replayed 3 times: one row", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  assertEquals((await pay(h, "/capture-order", { orderId }, ta)).j.status, "credited");
  const cap = h.pp.orders.get(orderId)!.capture!;
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  for (let i = 0; i < 4; i++) {
    const r = await hook(h, event, headers);
    assertEquals(r.status, 200, `delivery ${i + 1}: ${r.txt}`);
  }
  assertEquals(paid(h, a).length, 1);
});

t("§ 17.8(3) webhook then capture (PayPal captured, the tab's capture-order arrives late): one row, the late capture-order still answers credited", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  const cap = await captureAtPayPal(orderId, `ten-capture-${orderId}`);
  const { event, headers } = ppSignedEvent(h.pp, cap);
  assertEquals((await hook(h, event, headers)).status, 200);
  assertEquals(paid(h, a).length, 1);
  const late = await pay(h, "/capture-order", { orderId }, ta);
  assertEquals(late.status, 200, late.txt);
  assertEquals(late.j.status, "credited");
  assertEquals(paid(h, a).length, 1, "still one row");
});

t("§ 17.8(3) capture-order and the webhook at the same moment: one row", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  for (let i = 0; i < 5; i++) {
    const orderId = await createApproved(h, ta);
    const cap = await captureAtPayPal(orderId, `ten-capture-${orderId}`);
    const { event, headers } = ppSignedEvent(h.pp, cap);
    const [c, w] = await Promise.all([pay(h, "/capture-order", { orderId }, ta), hook(h, event, headers), hook(h, event, headers)]);
    assertEquals(c.j?.status, "credited", c.txt);
    assertEquals(w.status, 200);
    assertEquals(paid(h, a).filter((r) => r.request_id === `paypal:${cap.id}`).length, 1);
  }
  assertEquals(paid(h, a).length, 5);
});

t("§ 17.1(4) ORDER_ALREADY_CAPTURED (captured under another request id): read the order's capture; one row", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  await captureAtPayPal(orderId, "some-other-request-id");
  const r = await pay(h, "/capture-order", { orderId }, ta);
  assertEquals(r.status, 200, r.txt);
  assertEquals(r.j.status, "credited");
  assertEquals(paid(h, a).length, 1);
  const again = await pay(h, "/capture-order", { orderId }, ta);
  assertEquals(again.j.status, "credited");
  assertEquals(paid(h, a).length, 1);
});

t("§ 17.2 ORDER_NOT_APPROVED: nothing captured, no row, the window-closed outcome", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const r0 = await pay(h, "/create-order", { pack: "10" }, ta);
  const r = await pay(h, "/capture-order", { orderId: r0.j.orderId }, ta);
  observe(`not approved -> ${r.status} ${r.txt}`);
  assertEquals(r.status, 200);
  assertEquals(r.j.status, "window_closed");
  assertEquals(h.pp.orders.get(r0.j.orderId)!.capture, undefined);
  assertEquals(paid(h, a).length, 0);
});

t("§ 17.8(5) PENDING: 'pending', no row; the later webhook's COMPLETED: one row at the net", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  h.pp.nextCapture = { status: "PENDING" };
  const r = await pay(h, "/capture-order", { orderId }, ta);
  assertEquals(r.j, { status: "pending" });
  assertEquals(paid(h, a).length, 0);
  const cap = h.pp.orders.get(orderId)!.capture!;
  // a PENDING-state event (or a COMPLETED event while the re-fetch still says PENDING) credits nothing
  const early = ppSignedEvent(h.pp, { ...structuredClone(cap), status: "COMPLETED" });
  assertEquals((await hook(h, early.event, early.headers)).status, 200);
  assertEquals(paid(h, a).length, 0, "the re-fetch still says PENDING");
  const pend = ppSignedEvent(h.pp, structuredClone(cap), "PAYMENT.CAPTURE.PENDING");
  assertEquals((await hook(h, pend.event, pend.headers)).status, 200);
  assertEquals(paid(h, a).length, 0);
  // it clears
  ppSetCapture(h.pp, cap.id, { status: "COMPLETED", seller_receivable_breakdown: breakdownFor("10.00") });
  const done = ppSignedEvent(h.pp, structuredClone(cap));
  assertEquals((await hook(h, done.event, done.headers)).status, 200);
  assertEquals(paid(h, a).length, 1);
  assertEquals(paid(h, a)[0].usd_micros, 9_160_000);
  assertEquals((await hook(h, done.event, done.headers)).status, 200);
  const retry = await pay(h, "/capture-order", { orderId }, ta);
  assertEquals(retry.j.status, "credited", "the tab's retry after it cleared");
  assertEquals(paid(h, a).length, 1);
});

t("§ 17.1(4) a DECLINED capture: 'declined', no row", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  h.pp.nextCapture = { status: "DECLINED", breakdown: null };
  const r = await pay(h, "/capture-order", { orderId }, ta);
  assertEquals(r.j, { status: "declined" });
  assertEquals(paid(h, a).length, 0);
});

t("§ 1.11 'no answer from capture': PayPal captures but its answer is a 5xx -> never told 'declined. No money moved'", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  // PayPal performs the capture, then the response is lost as a 500 (a gateway error).
  const realCapture = captureAtPayPal;
  await realCapture(orderId, "lost-response"); // money moved at PayPal
  h.pp.orders.get(orderId)!.requestId = `ten-capture-${orderId}`; // the same request, as PayPal sees it
  h.pp.fail = { "/capture": 500 };
  const r = await pay(h, "/capture-order", { orderId }, ta);
  h.pp.fail = {};
  observe(`capture answered 500 -> ${r.status} ${r.txt}`);
  assert(!(r.status === 200 && r.j?.status === "declined"), `a 5xx from PayPal is reported to the payer as "declined. No money moved": ${r.txt}`);
  assert(!r.txt.includes("No money moved"), `the function's own message claims no money moved: ${r.txt}`);
  // § 17.10: "A capture call answering 5xx ... -> 503 unconfirmed"
  assertEquals(r.status, 503, r.txt);
  assertEquals(r.j?.error?.code, "unconfirmed", r.txt);
  assertEquals(paid(h, a).length, 0, "nothing credited yet; the webhook is the backup");
});

t("§ 17.8(6) a breakdown that doesn't add up: no row, an ALERT (capture-order and webhook)", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  const bad = breakdownFor("10.00");
  bad.net_amount.value = "9.50"; // 10.00 - 0.84 != 9.50
  h.pp.nextCapture = { breakdown: bad };
  const r = await pay(h, "/capture-order", { orderId }, ta);
  observe(`capture-order, bad breakdown -> ${r.status} ${r.txt}`);
  assert(r.j?.status !== "credited", r.txt);
  assertEquals(paid(h, a).length, 0);
  assert(h.logs.some((l) => /ALERT/.test(l)), `no ALERT logged: ${JSON.stringify(h.logs)}`);
  h.logs.length = 0;
  const cap = h.pp.orders.get(orderId)!.capture!;
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  const w = await hook(h, event, headers);
  observe(`webhook, bad breakdown -> ${w.status} ${w.txt}`);
  assertEquals(paid(h, a).length, 0);
  assert(h.logs.some((l) => /ALERT/.test(l)), `no ALERT logged by the webhook: ${JSON.stringify(h.logs)}`);
});

t("§ 17.8(6) no net_amount / no breakdown / a non-USD capture / a non-pack gross: no row, an ALERT", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const noNet = breakdownFor("10.00") as any;
  delete noNet.net_amount;
  const eurBd = breakdownFor("10.00", "EUR");
  const cases: Array<[string, any]> = [
    ["no net_amount", { breakdown: noNet }],
    ["no breakdown at all", { breakdown: null }],
    ["capture in EUR", { currency: "EUR", breakdown: eurBd }],
    ["breakdown values in EUR on a USD capture", { breakdown: eurBd }],
    ["gross 9.99 (not a pack)", { breakdown: { ...breakdownFor("9.99") } }],
    ["numbers, not strings", { breakdown: { gross_amount: { currency_code: "USD", value: 10 }, paypal_fee: { currency_code: "USD", value: 0.84 }, net_amount: { currency_code: "USD", value: 9.16 } } }],
  ];
  const problems: string[] = [];
  for (const [label, nc] of cases) {
    h.logs.length = 0;
    const before = paid(h, a).length;
    const orderId = await createApproved(h, ta);
    h.pp.nextCapture = nc;
    const r = await pay(h, "/capture-order", { orderId }, ta);
    observe(`${label} -> ${r.status} ${r.txt}`);
    if (r.j?.status === "credited") problems.push(`${label}: capture-order answered credited`);
    if (paid(h, a).length !== before) problems.push(`${label}: capture-order wrote a row`);
    if (!h.logs.some((l) => /ALERT/.test(l))) problems.push(`${label}: capture-order logged no ALERT`);
    const cap = h.pp.orders.get(orderId)!.capture!;
    const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
    const n = paid(h, a).length;
    const w = await hook(h, event, headers);
    if (paid(h, a).length !== n) problems.push(`${label}: the webhook wrote a row`);
    observe(`${label} webhook -> ${w.status}`);
  }
  assertEquals(problems, []);
});

t("§ 17.1(4) a failed credit write -> 503 paid_not_credited with § 1.11's copy; the webhook then credits once", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  h.st.ledgerPlan = ["fail"];
  const r = await pay(h, "/capture-order", { orderId }, ta);
  assertEquals(r.status, 503, r.txt);
  assertEquals(r.j?.error?.code, "paid_not_credited");
  assert(
    r.txt.includes("Ten couldn't confirm the credit yet. If PayPal took your payment, it's added automatically, usually within minutes. If not by tomorrow, email support@10xjobs.co with PayPal's receipt."),
    r.txt,
  );
  assertEquals(paid(h, a).length, 0);
  const cap = h.pp.orders.get(orderId)!.capture!;
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  assertEquals((await hook(h, event, headers)).status, 200);
  assertEquals(paid(h, a).length, 1);
  // a lost ack (row written, 503 back): the retry sees the duplicate -> credited, one row
  const o2 = await createApproved(h, ta);
  h.st.ledgerPlan = ["commit-then-fail"];
  const r2 = await pay(h, "/capture-order", { orderId: o2 }, ta);
  observe(`lost ack -> ${r2.status} ${r2.txt}`);
  const r3 = await pay(h, "/capture-order", { orderId: o2 }, ta);
  assertEquals(r3.j?.status, "credited", r3.txt);
  assertEquals(paid(h, a).length, 2);
});

t("§ 17.2 a purchase opens, approves or raises no gate and no allowance: ten-paypal and the webhook never touch ten_gate_log or any RPC but membership", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  h.st.gateLog.push({ user_id: a, id: "gate-1" });
  const orderId = await createApproved(h, ta, "40");
  await pay(h, "/capture-order", { orderId }, ta);
  const cap = h.pp.orders.get(orderId)!.capture!;
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  await hook(h, event, headers);
  const paths = h.st.requests.map((r) => `${r.method} ${r.path.split("?")[0]}`);
  observe(`Supabase calls in a purchase: ${JSON.stringify([...new Set(paths)])}`);
  assert(paths.every((p) => !p.includes("gate")), "touched the gate log");
  const allowed = new Set(["GET /auth/v1/user", "POST /rest/v1/rpc/ten_is_member", "POST /rest/v1/ten_usage_ledger", "GET /rest/v1/ten_usage_ledger"]);
  for (const p of paths) assert(allowed.has(p), `unexpected Supabase call during a purchase: ${p}`);
  assertEquals(h.st.gateLog, [{ user_id: a, id: "gate-1" }]);
  const writes = h.st.requests.filter((r) => r.method !== "GET" && r.path.startsWith("/rest/v1/ten_usage_ledger"));
  for (const w of writes) assertEquals(JSON.parse(w.body).kind, "credit");
});

t("§ 17.10 (was round 1's SPEC GAP / F1): an order Ten never created (invoice not ten-, another payee) with custom_id ten:<caller> and a pack amount -> 403 not_ten_order, no capture, no row", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = ppPlantOrder(h.pp, { customId: `ten:${a}`, value: "10.00" });
  const o = h.pp.orders.get(orderId)!;
  o.purchase_units[0].invoice_id = "client-made-1";
  o.purchase_units[0].payee = { email_address: "someone-else@example.com", merchant_id: "OTHERMERCHANT1" };
  const r = await pay(h, "/capture-order", { orderId }, ta);
  observe(`client-created order with a foreign payee -> ${r.status} ${r.txt}; rows=${paid(h, a).length}; capture calls=${captureHits(h).length}`);
  assertEquals(r.status, 403, r.txt);
  assertEquals(r.j?.error?.code, "not_ten_order");
  assertEquals(captureHits(h).length, 0, "no capture call");
  assertEquals(paid(h, a).length, 0, "no row");
});

