// Independent tester — round 3 (owner-approved, 846a8c7): every PayPal call
// is bounded by a timeout (15 s in production), and a timed-out call is
// answered per § 17.10 / § 17.1(5): capture -> 503 unconfirmed (never
// "declined"); the webhook's verify, capture re-fetch and order read -> 503
// (PayPal retries). Runs the REAL index.ts files. The stub PayPal never
// answers the hung path; the test shortens AbortSignal.timeout while it runs
// and records every duration asked for, so the production 15 s wiring is
// checked without waiting 15 s.

// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "jsr:@std/assert@1";
import { breakdownFor, harness, member, mintTag, observe, ppPlantOrder, ppReleaseHangs, ppSignedEvent, t } from "./_harness.ts";
import { createApproved, hook, paid, pay } from "./_paypal.ts";

type H = Awaited<ReturnType<typeof harness>>;
const SHORT_MS = 80;

async function withShortTimeouts<T>(h: H, fn: (asked: number[]) => Promise<T>): Promise<T> {
  const orig = AbortSignal.timeout.bind(AbortSignal);
  const asked: number[] = [];
  (AbortSignal as any).timeout = (ms: number) => {
    asked.push(ms);
    return orig(SHORT_MS);
  };
  // Watchdog: if a call is NOT bounded by the timeout, release it after 2 s
  // and fail, instead of hanging the suite forever.
  let watchdogFired = false;
  const wd = setTimeout(() => {
    watchdogFired = true;
    ppReleaseHangs(h.pp);
  }, 2000);
  try {
    const out = await fn(asked);
    assert(!watchdogFired, "a PayPal call hung past its timeout (the watchdog had to release it)");
    return out;
  } finally {
    clearTimeout(wd);
    (AbortSignal as any).timeout = orig;
    ppReleaseHangs(h.pp);
  }
}

async function capturedAt(h: H, uid: string) {
  const inv = await mintTag(uid, "10");
  const orderId = ppPlantOrder(h.pp, { customId: `ten:${uid}`, value: "10.00", status: "COMPLETED", invoiceId: inv });
  const id = "C" + crypto.randomUUID().replace(/-/g, "").slice(0, 15).toUpperCase();
  const cap: any = {
    id,
    status: "COMPLETED",
    amount: { currency_code: "USD", value: "10.00" },
    custom_id: `ten:${uid}`,
    invoice_id: inv,
    seller_receivable_breakdown: breakdownFor("10.00"),
    supplementary_data: { related_ids: { order_id: orderId } },
  };
  h.pp.captures.set(id, cap);
  h.pp.orders.get(orderId)!.capture = cap;
  return cap;
}

t("round 3: production wiring asks for a 15 s timeout on EVERY PayPal call of a purchase and its webhook", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  await withShortTimeouts(h, async (asked) => {
    const orderId = await createApproved(h, ta);
    const r = await pay(h, "/capture-order", { orderId }, ta);
    assertEquals(r.j?.status, "credited", r.txt);
    const cap = h.pp.orders.get(orderId)!.capture!;
    const e = ppSignedEvent(h.pp, structuredClone(cap));
    assertEquals((await hook(h, e.event, e.headers)).status, 200);
    observe(`${h.pp.hits.length} PayPal calls, timeouts asked: ${JSON.stringify(asked)}`);
    assert(asked.length >= h.pp.hits.length, `${h.pp.hits.length} PayPal calls but only ${asked.length} timeouts`);
    assert(asked.every((ms) => ms === 15_000), `not all 15 s: ${JSON.stringify(asked)}`);
  });
  assertEquals(paid(h, a).length, 1);
});

t("round 3: a timed-out capture -> 503 unconfirmed (never declined), no row; the late capture is then credited once by the webhook", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  const t0 = Date.now();
  const r = await withShortTimeouts(h, async () => {
    h.pp.hang = ["/capture"];
    return await pay(h, "/capture-order", { orderId }, ta);
  });
  observe(`capture hung -> ${r.status} ${r.txt} after ${Date.now() - t0} ms`);
  assertEquals(r.status, 503, r.txt);
  assertEquals(r.j?.error?.code, "unconfirmed");
  assert(r.j?.status !== "declined" && !r.txt.includes("No money moved"), r.txt);
  assertEquals(paid(h, a).length, 0);
  // PayPal did capture after all (the held request completes); the webhook credits it once
  const late = h.pp.orders.get(orderId)!;
  if (late.capture) {
    const e = ppSignedEvent(h.pp, structuredClone(late.capture));
    assertEquals((await hook(h, e.event, e.headers)).status, 200);
    assertEquals(paid(h, a).length, 1);
  }
});

t("round 3: timed-out order pre-read / create-order -> 5xx, no capture, no order id, no row", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  const [r1, r2] = await withShortTimeouts(h, async () => {
    h.pp.hang = [`/v2/checkout/orders/${orderId}`, "/v1/oauth2/token"];
    return [await pay(h, "/capture-order", { orderId }, ta), await pay(h, "/create-order", { pack: "10" }, ta)];
  });
  observe(`pre-read hung -> ${r1.status} ${r1.txt}; create hung -> ${r2.status} ${r2.txt}`);
  assert(r1.status >= 500 && r1.j?.status !== "declined", r1.txt);
  assert(r2.status >= 500 && !r2.txt.includes("orderId"), r2.txt);
  assertEquals(h.pp.orders.get(orderId)!.capture, undefined, "no capture after a timed-out pre-read");
  assertEquals(paid(h, a).length, 0);
});

t("round 3: webhook — a timed-out verify, capture re-fetch, or order read -> 503, no row; PayPal's retry then credits once", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const cap = await capturedAt(h, a);
  const orderId = cap.supplementary_data.related_ids.order_id;
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  const problems: string[] = [];
  for (const [label, path] of [
    ["verify", "/v1/notifications/verify-webhook-signature"],
    ["capture re-fetch", `/v2/payments/captures/${cap.id}`],
    ["order read", `/v2/checkout/orders/${orderId}`],
  ]) {
    const t0 = Date.now();
    const r = await withShortTimeouts(h, async () => {
      h.pp.hang = [path];
      return await hook(h, event, headers);
    });
    observe(`${label} hung -> ${r.status} ${r.txt} after ${Date.now() - t0} ms`);
    if (r.status !== 503) problems.push(`${label}: ${r.status} ${r.txt}`);
    if (paid(h, a).length !== 0) problems.push(`${label}: wrote a row`);
  }
  assertEquals(problems, []);
  assertEquals((await hook(h, event, headers)).status, 200);
  assertEquals(paid(h, a).length, 1, "the retry credits exactly once");
});

t("round 3 / § 17.3 (usd > 0): a breakdown whose fee eats the whole gross (net 0.00) -> no row, an ALERT; capture-order 503 paid_not_credited, webhook 200", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const orderId = await createApproved(h, ta);
  h.pp.nextCapture = { breakdown: { gross_amount: { currency_code: "USD", value: "10.00" }, paypal_fee: { currency_code: "USD", value: "10.00" }, net_amount: { currency_code: "USD", value: "0.00" } } };
  h.logs.length = 0;
  const r = await pay(h, "/capture-order", { orderId }, ta);
  assertEquals(r.status, 503, r.txt);
  assertEquals(r.j?.error?.code, "paid_not_credited");
  assert(h.logs.some((l) => l.includes("ALERT")), "capture-order logged no ALERT");
  h.logs.length = 0;
  const cap = h.pp.orders.get(orderId)!.capture!;
  const e = ppSignedEvent(h.pp, structuredClone(cap));
  const w = await hook(h, e.event, e.headers);
  assertEquals(w.status, 200, w.txt);
  assert(h.logs.some((l) => l.includes("ALERT")), "webhook logged no ALERT");
  assertEquals(paid(h, a).length, 0);
});
