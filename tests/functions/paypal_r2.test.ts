// Independent tester — docs/design-web-agent.md § 17.10 (lead rulings on
// round 1's F1, 2026-09-25): the signed invoice_id, the one shared check on
// both paths, the payee rule (TEN_PAYPAL_MERCHANT_ID), honest capture
// errors, and the breakdown checks. Written from the spec; runs the REAL
// index.ts files over the loopback PayPal and Supabase stubs (_harness.ts).

// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  breakdownFor,
  FOREIGN_MERCHANT_ID,
  harness,
  HOOK,
  member,
  mintTag,
  observe,
  PAY,
  PAYPAL_CLIENT_SECRET,
  ppPlantOrder,
  ppSignedEvent,
  preq,
  t,
  TAG_RE,
  tagHash,
} from "./_harness.ts";
import { createApproved, hook, paid, pay } from "./_paypal.ts";

type H = Awaited<ReturnType<typeof harness>>;
const captureHits = (h: H) => h.pp.hits.filter((x) => x.method === "POST" && x.path.endsWith("/capture"));
const flipHex = (c: string) => (c === "0" ? "1" : "0");
const flipLast = (s: string) => s.slice(0, -1) + flipHex(s.at(-1)!);

/** A captured order at PayPal for the webhook path, with full control of the
 * tag and the payee (what a browser-made order could carry). */
async function capturedAt(h: H, customId: string, invoiceId: string, o: { value?: string; payee?: string | null; noOrderId?: boolean; orderGone?: boolean } = {}) {
  const value = o.value ?? "10.00";
  const orderId = ppPlantOrder(h.pp, { customId, value, status: "COMPLETED", invoiceId, payee: o.payee });
  const id = "C" + crypto.randomUUID().replace(/-/g, "").slice(0, 15).toUpperCase();
  const cap: any = {
    id,
    status: "COMPLETED",
    amount: { currency_code: "USD", value },
    custom_id: customId,
    invoice_id: invoiceId,
    seller_receivable_breakdown: breakdownFor(value),
  };
  if (!o.noOrderId) cap.supplementary_data = { related_ids: { order_id: orderId } };
  h.pp.captures.set(id, cap);
  h.pp.orders.get(orderId)!.capture = cap;
  if (o.orderGone) h.pp.orders.delete(orderId);
  return cap;
}

// ------------------------------------------------------------------ 1
t("§ 17.10(1) the tag: a fixed vector (independent Python HMAC) and create-order's tag recomputes", async () => {
  // python3: K = HMAC(secret, "ten-invoice-v1"); H = HMAC(K, "v1|uid|20|20.00|1790000000|0123456789abcdef")[:32]
  const vec = await mintTag("1fce4304-60fc-4efa-a6b3-b44f3bd6a6ce", "20", { secret: PAYPAL_CLIENT_SECRET, t: "1790000000", n: "0123456789abcdef" });
  assertEquals(vec, "ten-1fce4304-1790000000-0123456789abcdef-deec39dd37437e44974e759071d7c527");
  assertEquals(vec.length, 73);
  assertMatch(vec, TAG_RE);
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  const seen = new Set<string>();
  for (const pack of ["10", "20", "40", "10"]) {
    const r = await pay(h, "/create-order", { pack }, tok);
    const inv = h.pp.orders.get(r.j.orderId)!.purchase_units[0].invoice_id as string;
    assertMatch(inv, TAG_RE);
    const [, U, T, N, Hh] = inv.split("-");
    assertEquals(U, uid.slice(0, 8));
    assert(Math.abs(Number(T) - Date.now() / 1000) < 60, "T is Unix seconds, now");
    assertEquals(Hh, await tagHash(PAYPAL_CLIENT_SECRET, uid, pack, `${pack}.00`, T, N));
    seen.add(N);
  }
  assertEquals(seen.size, 4, "N differs per order (unique invoice ids)");
});

// ------------------------------------------------------------------ 2
async function forgedTags(a: string, b: string): Promise<Array<[string, string | null]>> {
  const good = await mintTag(a, "10");
  const [, U, T, N, Hh] = good.split("-");
  return [
    ["no invoice_id", null],
    ["a random invoice_id", `ten-${crypto.randomUUID()}`],
    ["another uid's valid tag", await mintTag(b, "10")],
    ["another pack's tag (20 on a $10 order)", await mintTag(a, "20")],
    ["one hex digit of H changed", flipLast(good)],
    ["a tag from another secret", await mintTag(a, "10", { secret: "some-other-client-secret" })],
    ["U tampered", `ten-${flipLast(U)}-${T}-${N}-${Hh}`],
    ["T tampered", `ten-${U}-${String(Number(T) + 1)}-${N}-${Hh}`],
    ["N tampered", `ten-${U}-${T}-${flipLast(N)}-${Hh}`],
    ["H in upper case", `ten-${U}-${T}-${N}-${Hh.toUpperCase()}`],
    ["H truncated", `ten-${U}-${T}-${N}-${Hh.slice(0, 31)}`],
    ["a valid tag with a trailing char", good + "0"],
  ];
}

t("§ 17.10(2) capture-order: each forged tag -> 403 not_ten_order, no capture call, no row", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const [b] = await member(h);
  const problems: string[] = [];
  for (const [label, inv] of await forgedTags(a, b)) {
    const orderId = ppPlantOrder(h.pp, { customId: `ten:${a}`, value: "10.00", invoiceId: inv ?? undefined });
    if (inv === null) delete h.pp.orders.get(orderId)!.purchase_units[0].invoice_id;
    const n = captureHits(h).length;
    const r = await pay(h, "/capture-order", { orderId }, ta);
    if (r.status !== 403 || r.j?.error?.code !== "not_ten_order") problems.push(`${label}: ${r.status} ${r.txt}`);
    if (captureHits(h).length !== n) problems.push(`${label}: capture was called`);
  }
  assertEquals(paid(h).length, 0);
  assertEquals(problems, []);
  // control: the same order shape with a genuine tag is captured and credited
  const ok = ppPlantOrder(h.pp, { customId: `ten:${a}`, value: "10.00", invoiceId: await mintTag(a, "10") });
  const r = await pay(h, "/capture-order", { orderId: ok }, ta);
  assertEquals(r.j?.status, "credited", r.txt);
});

t("§ 17.10(2) webhook: each forged tag on the re-fetched capture -> 200, a log line, no row", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const [b] = await member(h);
  const problems: string[] = [];
  for (const [label, inv] of await forgedTags(a, b)) {
    h.logs.length = 0;
    const cap = await capturedAt(h, `ten:${a}`, inv ?? "");
    if (inv === null) delete cap.invoice_id;
    // the event body carries a GENUINE tag: the check must read the re-fetched capture
    const { event, headers } = ppSignedEvent(h.pp, { ...structuredClone(cap), invoice_id: await mintTag(a, "10") });
    const r = await hook(h, event, headers);
    if (r.status !== 200) problems.push(`${label}: ${r.status} ${r.txt}`);
    if (!h.logs.some((l) => l.includes(cap.id))) problems.push(`${label}: no log line naming the capture`);
    if (h.logs.some((l) => /payer|email/i.test(l))) problems.push(`${label}: payer data in a log line`);
  }
  assertEquals(paid(h).length, 0);
  assertEquals(problems, []);
  const good = await capturedAt(h, `ten:${a}`, await mintTag(a, "10"));
  const e = ppSignedEvent(h.pp, structuredClone(good));
  assertEquals((await hook(h, e.event, e.headers)).status, 200);
  assertEquals(paid(h, a).length, 1, "control: a genuine tag credits");
});

// ------------------------------------------------------------------ 3
t("§ 17.10(3) capture 500 / a timeout / an unknown error -> 503 unconfirmed; DECLINED or FAILED -> declined", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const cases: Array<[string, () => void]> = [
    ["capture 500", () => void (h.pp.fail = { "/capture": 500 })],
    ["capture 502", () => void (h.pp.fail = { "/capture": 502 })],
    ["capture times out", () => void (h.pp.throwOn = { "/capture": "TimeoutError" })],
    ["connection reset", () => void (h.pp.throwOn = { "/capture": "NetworkError" })],
    ["an unknown 422", () => void (h.pp.fail = { "/capture": 422 })],
  ];
  const problems: string[] = [];
  for (const [label, arm] of cases) {
    const orderId = await createApproved(h, ta);
    arm();
    const r = await pay(h, "/capture-order", { orderId }, ta);
    h.pp.fail = {};
    h.pp.throwOn = {};
    observe(`${label} -> ${r.status} ${r.txt}`);
    if (r.status !== 503 || r.j?.error?.code !== "unconfirmed") problems.push(`${label}: ${r.status} ${r.txt}`);
    if (r.txt.includes("No money moved")) problems.push(`${label}: claims no money moved`);
  }
  for (const st of ["DECLINED", "FAILED"]) {
    const orderId = await createApproved(h, ta);
    h.pp.nextCapture = { status: st, breakdown: null };
    const r = await pay(h, "/capture-order", { orderId }, ta);
    if (r.j?.status !== "declined") problems.push(`${st}: ${r.status} ${r.txt}`);
  }
  assertEquals(paid(h, a).length, 0);
  assertEquals(problems, []);
});

// ------------------------------------------------------------------ 4
t("§ 17.10(4) breakdown: a non-USD field, a missing fee or net, net off by a cent -> no row, an ALERT; capture-order 503 paid_not_credited, webhook 200", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const bd = () => breakdownFor("10.00") as any;
  const cases: Array<[string, any]> = [
    ["gross in EUR", (() => { const x = bd(); x.gross_amount.currency_code = "EUR"; return x; })()],
    ["fee in EUR", (() => { const x = bd(); x.paypal_fee.currency_code = "EUR"; return x; })()],
    ["net in EUR", (() => { const x = bd(); x.net_amount.currency_code = "EUR"; return x; })()],
    ["no fee", (() => { const x = bd(); delete x.paypal_fee; return x; })()],
    ["no net", (() => { const x = bd(); delete x.net_amount; return x; })()],
    ["no gross", (() => { const x = bd(); delete x.gross_amount; return x; })()],
    ["net one cent low", (() => { const x = bd(); x.net_amount.value = "9.15"; return x; })()],
    ["net one cent high", (() => { const x = bd(); x.net_amount.value = "9.17"; return x; })()],
    ["net = gross (fee ignored)", (() => { const x = bd(); x.net_amount.value = "10.00"; return x; })()],
  ];
  const problems: string[] = [];
  for (const [label, breakdown] of cases) {
    h.logs.length = 0;
    const orderId = await createApproved(h, ta);
    h.pp.nextCapture = { breakdown };
    const r = await pay(h, "/capture-order", { orderId }, ta);
    if (r.status !== 503 || r.j?.error?.code !== "paid_not_credited") problems.push(`${label}: capture-order ${r.status} ${r.txt}`);
    if (!h.logs.some((l) => l.includes("ALERT"))) problems.push(`${label}: capture-order no ALERT`);
    h.logs.length = 0;
    const cap = h.pp.orders.get(orderId)!.capture!;
    const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
    const w = await hook(h, event, headers);
    if (w.status !== 200) problems.push(`${label}: webhook ${w.status} ${w.txt}`);
    if (!h.logs.some((l) => l.includes("ALERT"))) problems.push(`${label}: webhook no ALERT`);
  }
  assertEquals(paid(h, a).length, 0);
  assertEquals(problems, []);
});

t("§ 17.3/§ 17.10 a $0 fee that adds up (fee_usd >= 0; net = gross - fee) is credited, not refused", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  h.pp.nextCapture = { breakdown: { gross_amount: { currency_code: "USD", value: "10.00" }, paypal_fee: { currency_code: "USD", value: "0.00" }, net_amount: { currency_code: "USD", value: "10.00" } } };
  const r = await pay(h, "/capture-order", { orderId }, ta);
  observe(`zero fee -> ${r.status} ${r.txt}`);
  assertEquals(r.j?.status, "credited", r.txt);
  assertEquals(paid(h, a).length, 1);
});

// ---- 7 (constant-time tag compare) is a code review, recorded in the tester report.

// ------------------------------------------------------------------ 8
t("§ 17.10(8) payee: a valid tag with a foreign payee -> capture-order 403 not_ten_order, no capture call; no payee at all -> the same", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const problems: string[] = [];
  for (const [label, payee] of [["foreign merchant", FOREIGN_MERCHANT_ID], ["no payee", null], ["empty merchant id", ""]] as Array<[string, string | null]>) {
    const orderId = ppPlantOrder(h.pp, { customId: `ten:${a}`, value: "10.00", invoiceId: await mintTag(a, "10"), payee });
    const n = captureHits(h).length;
    const r = await pay(h, "/capture-order", { orderId }, ta);
    if (r.status !== 403 || r.j?.error?.code !== "not_ten_order") problems.push(`${label}: ${r.status} ${r.txt}`);
    if (captureHits(h).length !== n) problems.push(`${label}: capture called`);
  }
  assertEquals(paid(h).length, 0);
  assertEquals(problems, []);
});

t("§ 17.10(8) payee on the webhook: a foreign payee, no order id, or the order 404 -> 200, no row; an order read failure -> 503", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const cases: Array<[string, Parameters<typeof capturedAt>[3], number]> = [
    ["foreign payee", { payee: FOREIGN_MERCHANT_ID }, 200],
    ["no payee on the order", { payee: null }, 200],
    ["no supplementary_data order id", { noOrderId: true }, 200],
    ["the order 404", { orderGone: true }, 200],
  ];
  const problems: string[] = [];
  for (const [label, o, want] of cases) {
    h.logs.length = 0;
    const cap = await capturedAt(h, `ten:${a}`, await mintTag(a, "10"), o);
    const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
    const r = await hook(h, event, headers);
    observe(`${label} -> ${r.status} ${r.txt}`);
    if (r.status !== want) problems.push(`${label}: ${r.status} ${r.txt}`);
    if (h.logs.length === 0) problems.push(`${label}: no log line`);
  }
  assertEquals(paid(h).length, 0);
  const cap = await capturedAt(h, `ten:${a}`, await mintTag(a, "10"));
  const orderId = cap.supplementary_data.related_ids.order_id;
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  h.pp.fail = { [`/v2/checkout/orders/${orderId}`]: 500 };
  const r5 = await hook(h, event, headers);
  h.pp.fail = {};
  if (r5.status !== 503) problems.push(`order read 500: ${r5.status}`);
  assertEquals(paid(h).length, 0);
  assertEquals((await hook(h, event, headers)).status, 200, "PayPal's retry once the order reads");
  assertEquals(paid(h, a).length, 1);
  const orderReads = h.pp.hits.filter((x) => x.method === "GET" && x.path === `/v2/checkout/orders/${orderId}`);
  assert(orderReads.length >= 2, "the webhook read the order named in supplementary_data.related_ids.order_id");
  assertEquals(problems, []);
});

t("§ 17.10(8) TEN_PAYPAL_MERCHANT_ID unset: create-order and capture-order 503 with NO PayPal call; the webhook 503, no row", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  const cap = await (async () => {
    const r = await pay(h, "/capture-order", { orderId: await createApproved(h, ta) }, ta);
    assertEquals(r.j?.status, "credited");
    return [...h.pp.captures.values()].at(-1)!;
  })();
  const before = paid(h, a).length;
  h.pp.hits.length = 0;
  const c = await h.paypalNoMerchant(preq({ pack: "10" }, { url: PAY + "/create-order", token: ta }));
  const ct = await c.text();
  const k = await h.paypalNoMerchant(preq({ orderId }, { url: PAY + "/capture-order", token: ta }));
  const kt = await k.text();
  assertEquals(c.status, 503, ct);
  assertEquals(k.status, 503, kt);
  assertEquals(h.pp.hits.length, 0, `PayPal was called: ${JSON.stringify(h.pp.hits.map((x) => x.path))}`);
  // a fresh capture the webhook would otherwise credit
  const fresh = await capturedAt(h, `ten:${a}`, await mintTag(a, "10"));
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(fresh));
  const w = await h.webhookNoMerchant(new Request(HOOK, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(event) }));
  const wt = await w.text();
  assertEquals(w.status, 503, wt);
  assertEquals(paid(h, a).length, before, "no row");
  void cap;
});
