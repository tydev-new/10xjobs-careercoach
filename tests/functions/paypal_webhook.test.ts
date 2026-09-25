// Independent tester — docs/design-web-agent.md § 17.1 step 5 (with § 17.9's
// signature-first decision), § 17.6 secrets, § 17.8 item 4, and § 17.2 / § 17.5
// (rule 7: a purchase changes no ceiling). Runs the REAL deploy entry point
// supabase/functions/ten-paypal-webhook/index.ts (twice: with and without
// TEN_PAYPAL_WEBHOOK_ID) over the loopback PayPal and Supabase stubs.

// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  baseBody,
  breakdownFor,
  call,
  DEL,
  harness,
  HOOK,
  member,
  nonMember,
  observe,
  OPENROUTER_KEY,
  PAY,
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_TOKEN,
  PAYPAL_WEBHOOK_ID,
  ppPlantOrder,
  ppSignedEvent,
  preq,
  PROD_ORIGIN,
  t,
} from "./_harness.ts";
import { createApproved, hook, paid, pay } from "./_paypal.ts";

type H = Awaited<ReturnType<typeof harness>>;
const refetches = (h: H) => h.pp.hits.filter((x) => x.method === "GET" && x.path.startsWith("/v2/payments/captures/"));
const verifies = (h: H) => h.pp.hits.filter((x) => x.path === "/v1/notifications/verify-webhook-signature");

/** A completed capture at PayPal for `customId` (not through ten-paypal). */
function plantCapture(h: H, customId: string, value = "10.00", status = "COMPLETED") {
  const orderId = ppPlantOrder(h.pp, { customId, value, status: "COMPLETED" });
  const id = "C" + crypto.randomUUID().replace(/-/g, "").slice(0, 15).toUpperCase();
  const cap: any = {
    id,
    status,
    amount: { currency_code: "USD", value },
    custom_id: customId,
    invoice_id: `inv-${id}`,
    supplementary_data: { related_ids: { order_id: orderId } },
  };
  if (status === "COMPLETED") cap.seller_receivable_breakdown = breakdownFor(value);
  h.pp.captures.set(id, cap);
  h.pp.orders.get(orderId)!.capture = cap;
  return cap;
}

// ------------------------------------------------------------- signature
t("§ 17.8(4) a bad signature -> 401; no re-fetch, no row", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const cap = plantCapture(h, `ten:${a}`);
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  const variants: Array<[string, Record<string, string>, any]> = [
    ["forged sig", { ...headers, "paypal-transmission-sig": "forged" }, event],
    ["unknown transmission id", { ...headers, "paypal-transmission-id": crypto.randomUUID() }, event],
    ["body changed after signing (custom_id)", headers, { ...event, resource: { ...event.resource, custom_id: `ten:${crypto.randomUUID()}` } }],
    ["body changed after signing (amount)", headers, { ...event, resource: { ...event.resource, amount: { currency_code: "USD", value: "40.00" } } }],
  ];
  for (const [label, hd, ev] of variants) {
    const r = await hook(h, ev, hd);
    assertEquals(r.status, 401, `${label}: ${r.status} ${r.txt}`);
  }
  assertEquals(refetches(h).length, 0);
  assertEquals(paid(h).length, 0);
});

t("§ 17.8(4) a MISSING signature (no paypal-* headers, or one missing) -> 401; no re-fetch, no row", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const cap = plantCapture(h, `ten:${a}`);
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  const results: string[] = [];
  const r0 = await hook(h, event, {});
  results.push(`no headers -> ${r0.status}`);
  for (const k of Object.keys(headers)) {
    const hd = { ...headers };
    delete hd[k];
    const r = await hook(h, event, hd);
    results.push(`without ${k} -> ${r.status}`);
  }
  observe(results.join("; "));
  assertEquals(refetches(h).length, 0);
  assertEquals(paid(h).length, 0);
  assert(results.every((x) => x.endsWith("-> 401")), `a missing signature is not a 401: ${results.join("; ")}`);
});

t("§ 17.8(4) the verify call failing -> 503, no re-fetch, no row; TEN_PAYPAL_WEBHOOK_ID unset -> 503, no row", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const cap = plantCapture(h, `ten:${a}`);
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  for (const f of ["/v1/notifications/verify-webhook-signature", "/v1/oauth2/token"]) {
    h.pp.fail = { [f]: 500 };
    const r = await hook(h, event, headers);
    assertEquals(r.status, 503, `${f}: ${r.txt}`);
  }
  h.pp.fail = {};
  assertEquals(refetches(h).length, 0);
  assertEquals(paid(h).length, 0);
  const n0 = verifies(h).length;
  const r = await hook(h, event, headers, h.webhookNoId);
  assertEquals(r.status, 503, r.txt);
  assertEquals(verifies(h).length, n0, "no verify call without the webhook id");
  assertEquals(refetches(h).length, 0);
  assertEquals(paid(h).length, 0);
  // once the id is set, PayPal's retry of the same delivery credits once
  assertEquals((await hook(h, event, headers)).status, 200);
  assertEquals(paid(h, a).length, 1);
});

t("the verify call carries the five headers, TEN_PAYPAL_WEBHOOK_ID and the event; Bearer auth", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const cap = plantCapture(h, `ten:${a}`);
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  await hook(h, event, headers);
  const v = verifies(h)[0];
  assertEquals(v.headers.get("authorization"), `Bearer ${PAYPAL_TOKEN}`);
  assertEquals(v.body.webhook_id, PAYPAL_WEBHOOK_ID);
  assertEquals(v.body.auth_algo, headers["paypal-auth-algo"]);
  assertEquals(v.body.cert_url, headers["paypal-cert-url"]);
  assertEquals(v.body.transmission_id, headers["paypal-transmission-id"]);
  assertEquals(v.body.transmission_sig, headers["paypal-transmission-sig"]);
  assertEquals(v.body.transmission_time, headers["paypal-transmission-time"]);
  assertEquals(v.body.webhook_event, event);
});

// --------------------------------------------------------------- filters
t("§ 17.8(4) valid signature, but another event type / a non-ten: custom_id / other text -> 200, no row (and no re-fetch)", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const cases: Array<[string, any, string?]> = [];
  const capA = plantCapture(h, `ten:${a}`);
  for (const et of ["PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED", "CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.DENIED"]) {
    cases.push([et, structuredClone(capA), et]);
  }
  const bare = plantCapture(h, a); // the older app's: a bare UUID that IS a Ten member
  cases.push(["older app bare UUID of a member", structuredClone(bare)]);
  for (const c of ["user-abc", "", `TEN:${a}`, `xten:${a}`, `ten-${a}`, `ten:`, `ten:${a}\n`]) {
    const cap = plantCapture(h, c);
    cases.push([`custom_id ${JSON.stringify(c)}`, structuredClone(cap)]);
  }
  const noCustom = plantCapture(h, "x");
  delete (noCustom as any).custom_id;
  cases.push(["no custom_id", structuredClone(noCustom)]);
  const problems: string[] = [];
  for (const [label, resource, et] of cases) {
    const n = refetches(h).length;
    const { event, headers } = ppSignedEvent(h.pp, resource, et);
    const r = await hook(h, event, headers);
    observe(`${label} -> ${r.status} ${r.txt}`);
    if (r.status !== 200) problems.push(`${label}: ${r.status} ${r.txt}`);
    if (refetches(h).length !== n) problems.push(`${label}: re-fetched`);
  }
  assertEquals(paid(h).length, 0);
  assertEquals(problems, []);
});

t("§ 17.8(4) valid signature, custom_id 'ten:' + text that is not exactly a uuid -> 200, no row, no re-fetch", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const cases: Array<[string, any, string?]> = [];
  for (const c of [`ten: ${a}`, `ten:${a} `, `ten:${a}:extra`, `ten:not-a-uuid`, `ten:../${a}`]) {
    const cap = plantCapture(h, c);
    cases.push([`custom_id ${JSON.stringify(c)}`, structuredClone(cap)]);
  }
  const problems: string[] = [];
  for (const [label, resource, et] of cases) {
    const n = refetches(h).length;
    const { event, headers } = ppSignedEvent(h.pp, resource, et);
    const r = await hook(h, event, headers);
    observe(`${label} -> ${r.status} ${r.txt}`);
    if (r.status !== 200) problems.push(`${label}: ${r.status} ${r.txt}`);
    if (refetches(h).length !== n) problems.push(`${label}: re-fetched`);
  }
  assertEquals(paid(h).length, 0);
  assertEquals(problems, []);
});

t("§ 17.8(4) valid ten: signature but an UNKNOWN capture -> 200, no row", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const cap = plantCapture(h, `ten:${a}`);
  const ghost = { ...structuredClone(cap), id: "CNOSUCHCAPTURE01" };
  const { event, headers } = ppSignedEvent(h.pp, ghost);
  const r = await hook(h, event, headers);
  observe(`unknown capture -> ${r.status} ${r.txt}`);
  assertEquals(paid(h).length, 0);
  assertEquals(r.status, 200, `an unknown capture is answered ${r.status} (PayPal retries a non-2xx for 3 days)`);
});

t("§ 17.8(4) a non-member ten:<uuid> -> 200, no row, an ALERT naming a refund by hand", async () => {
  const h = await harness();
  h.reset();
  const [n] = await nonMember(h);
  const cap = plantCapture(h, `ten:${n}`);
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  const r = await hook(h, event, headers);
  assertEquals(r.status, 200, r.txt);
  assertEquals(paid(h).length, 0);
  assert(h.logs.some((l) => /ALERT/.test(l) && /refund/i.test(l)), JSON.stringify(h.logs));
  // a ten:<uuid> for no auth user at all
  const ghostUid = crypto.randomUUID();
  const cap2 = plantCapture(h, `ten:${ghostUid}`);
  const e2 = ppSignedEvent(h.pp, structuredClone(cap2));
  const r2 = await hook(h, e2.event, e2.headers);
  assertEquals(r2.status, 200, r2.txt);
  assertEquals(paid(h).length, 0);
});

t("§ 17.8(4) the re-fetch disagrees with the event (custom_id, status, amount) -> no row; credit uses the RE-FETCHED numbers", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const [b] = await member(h);
  // event says ten:A, PayPal's capture says ten:B
  const capB = plantCapture(h, `ten:${b}`);
  const e1 = ppSignedEvent(h.pp, { ...structuredClone(capB), custom_id: `ten:${a}` });
  const r1 = await hook(h, e1.event, e1.headers);
  assertEquals(r1.status, 200, r1.txt);
  assertEquals(paid(h).length, 0, "custom_id mismatch credits no one");
  assert(h.logs.some((l) => /ALERT/.test(l)), "an alert for the mismatch");
  // event says COMPLETED, PayPal says REFUNDED
  const capR = plantCapture(h, `ten:${a}`);
  capR.status = "REFUNDED";
  const e2 = ppSignedEvent(h.pp, { ...structuredClone(capR), status: "COMPLETED" });
  assertEquals((await hook(h, e2.event, e2.headers)).status, 200);
  assertEquals(paid(h).length, 0);
  // event's amount/breakdown say $40, PayPal's capture is $10 -> the $10 net is credited
  const cap10 = plantCapture(h, `ten:${a}`, "10.00");
  const e3 = ppSignedEvent(h.pp, { ...structuredClone(cap10), amount: { currency_code: "USD", value: "40.00" }, seller_receivable_breakdown: breakdownFor("40.00") });
  assertEquals((await hook(h, e3.event, e3.headers)).status, 200);
  assertEquals(paid(h, a).length, 1);
  assertEquals(paid(h, a)[0].usd_micros, 9_160_000, "the re-fetched net, not the event's");
  // re-fetched capture with a non-pack amount
  const odd = plantCapture(h, `ten:${a}`, "12.34");
  const e4 = ppSignedEvent(h.pp, structuredClone(odd));
  assertEquals((await hook(h, e4.event, e4.headers)).status, 200);
  assertEquals(paid(h, a).length, 1, "a non-pack capture credits nothing");
});

t("§ 17.8(4) valid and ten: -> re-fetch -> one row at the net, replayed or not; PayPal/DB failures 503 then retry credits once", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const cap = plantCapture(h, `ten:${a}`, "20.00");
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  h.pp.fail = { "/v2/payments/captures/": 500 };
  assertEquals((await hook(h, event, headers)).status, 503, "re-fetch failure");
  h.pp.fail = {};
  h.st.fail = { "/rest/v1/ten_usage_ledger": 503 };
  assertEquals((await hook(h, event, headers)).status, 503, "membership/DB failure");
  h.st.fail = {};
  h.st.ledgerPlan = ["fail"];
  assertEquals((await hook(h, event, headers)).status, 503, "credit write failure");
  assertEquals(paid(h).length, 0);
  for (let i = 0; i < 4; i++) assertEquals((await hook(h, event, headers)).status, 200);
  assertEquals(paid(h, a).length, 1);
  const row = paid(h, a)[0];
  assertEquals(row.request_id, `paypal:${cap.id}`);
  assertEquals([row.usd_micros, row.gross_cents, row.fee_cents], [18_810_000, 2000, 119]);
  assert(refetches(h).length >= 5, "every accepted delivery re-fetched the capture");
  assertEquals(refetches(h)[0].headers.get("authorization"), `Bearer ${PAYPAL_TOKEN}`);
});

t("§ 17.1(5) order of checks: non-POST, > 64 KB, non-JSON are refused before any PayPal call; no CORS headers on any answer", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    const res = await h.webhook(new Request(HOOK, { method, headers: { origin: PROD_ORIGIN } }));
    await res.body?.cancel();
    assert(res.status >= 400 && res.status < 500, `${method} -> ${res.status}`);
    assertEquals([...res.headers.keys()].filter((k) => k.startsWith("access-control")), []);
  }
  const opt = await h.webhook(new Request(HOOK, { method: "OPTIONS", headers: { origin: PROD_ORIGIN, "access-control-request-method": "POST" } }));
  await opt.body?.cancel();
  assertEquals([...opt.headers.keys()].filter((k) => k.startsWith("access-control")), [], "no CORS on a preflight");
  const cap = plantCapture(h, `ten:${a}`);
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  const big = { ...event, pad: "x".repeat(64 * 1024) };
  const rBig = await hook(h, big, headers);
  assert(rBig.status === 413 || rBig.status === 400, `> 64 KB -> ${rBig.status}`);
  const rBad = await h.webhook(new Request(HOOK, { method: "POST", headers, body: "{not json" }));
  await rBad.text();
  assertEquals(rBad.status, 400);
  assertEquals(h.pp.hits.length, 0, "no PayPal call for any of these");
  const ok = await hook(h, event, { ...headers, origin: PROD_ORIGIN });
  assertEquals(ok.status, 200);
  const res = await h.webhook(new Request(HOOK, { method: "POST", headers: { ...headers, origin: PROD_ORIGIN }, body: JSON.stringify(event) }));
  await res.text();
  assertEquals([...res.headers.keys()].filter((k) => k.startsWith("access-control")), []);
  assertEquals(paid(h, a).length, 1);
});

// --------------------------------------------------------------- CORS
t("§ 17.6 CORS on ten-paypal matches the other functions (same _shared/cors.ts answers, allowed / unlisted / no origin)", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const acHeaders = (res: Response) =>
    Object.fromEntries([...res.headers.entries()].filter(([k]) => k.startsWith("access-control") || k === "vary"));
  const diffs: string[] = [];
  for (const origin of [PROD_ORIGIN, "https://evil.example", "http://localhost:5173", undefined]) {
    const hdr: Record<string, string> = { "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type, apikey, x-client-info" };
    if (origin) hdr.origin = origin;
    const p1 = await h.paypal(new Request(PAY + "/create-order", { method: "OPTIONS", headers: hdr }));
    const d1 = await h.del(new Request(DEL, { method: "OPTIONS", headers: hdr }));
    await p1.body?.cancel();
    await d1.body?.cancel();
    if (p1.status !== d1.status) diffs.push(`OPTIONS ${origin}: status ${p1.status} vs ${d1.status}`);
    if (JSON.stringify(acHeaders(p1)) !== JSON.stringify(acHeaders(d1))) diffs.push(`OPTIONS ${origin}: ${JSON.stringify(acHeaders(p1))} vs delete ${JSON.stringify(acHeaders(d1))}`);
    // errors carry the same allow header, so the app can read 401/403
    const p2 = await h.paypal(preq({ pack: "10" }, { url: PAY + "/create-order", origin }));
    const d2 = await h.del(preq({}, { url: DEL, origin }));
    await p2.body?.cancel();
    await d2.body?.cancel();
    if (JSON.stringify(acHeaders(p2)) !== JSON.stringify(acHeaders(d2))) diffs.push(`401 ${origin}: ${JSON.stringify(acHeaders(p2))} vs delete ${JSON.stringify(acHeaders(d2))}`);
    const p3 = await h.paypal(preq({ pack: "10" }, { url: PAY + "/create-order", origin, token: tok }));
    await p3.body?.cancel();
    observe(`origin ${origin}: preflight ${JSON.stringify(acHeaders(p1))}; 200 ${JSON.stringify(acHeaders(p3))}`);
    if (origin === PROD_ORIGIN) assertEquals(p3.headers.get("access-control-allow-origin"), PROD_ORIGIN);
    if (origin === "https://evil.example") assertEquals(p3.headers.get("access-control-allow-origin"), null);
  }
  assertEquals(diffs, []);
});

// --------------------------------------------------------------- secrets
t("§ 17.6 secrets never logged or returned: client secret, basic auth, access token, service key, webhook id, across every failure path", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const bodies: string[] = [];
  const run = async (fail: Record<string, number | undefined>, f: () => Promise<string>) => {
    h.pp.fail = fail as Record<string, number>;
    bodies.push(await f());
    h.pp.fail = {};
  };
  for (const f of [{ "/v1/oauth2/token": 401 }, { "/v1/oauth2/token": 500 }, { "/v2/checkout/orders": 500 }, {}]) {
    await run(f, async () => (await pay(h, "/create-order", { pack: "10" }, ta)).txt);
  }
  const o1 = await createApproved(h, ta);
  for (const f of [{ "/v1/oauth2/token": 500 }, { "/capture": 500 }, { [`/v2/checkout/orders/${o1}`]: 500 }]) {
    await run(f, async () => (await pay(h, "/capture-order", { orderId: o1 }, ta)).txt);
  }
  h.st.ledgerPlan = ["fail"];
  bodies.push((await pay(h, "/capture-order", { orderId: await createApproved(h, ta) }, ta)).txt);
  const cap = h.pp.orders.get(o1)!.capture ?? (await pay(h, "/capture-order", { orderId: o1 }, ta), h.pp.orders.get(o1)!.capture!);
  const { event, headers } = ppSignedEvent(h.pp, structuredClone(cap));
  for (const f of [{ "/v1/oauth2/token": 401 }, { "/v1/notifications": 500 }, { "/v2/payments/captures/": 500 }]) {
    await run(f, async () => (await hook(h, event, headers)).txt);
  }
  h.st.ledgerPlan = ["fail"];
  bodies.push((await hook(h, event, headers)).txt);
  bodies.push((await hook(h, event, headers, h.webhookNoId)).txt);
  const nonTen = plantCapture(h, `ten:${(await nonMember(h))[0]}`);
  const e2 = ppSignedEvent(h.pp, structuredClone(nonTen));
  bodies.push((await hook(h, e2.event, e2.headers)).txt);
  const secrets: Record<string, string> = {
    "client secret": PAYPAL_CLIENT_SECRET,
    "basic auth": btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`),
    "access token": PAYPAL_TOKEN,
    "service key": h.serviceKey,
    "webhook id": PAYPAL_WEBHOOK_ID,
    "openrouter key": OPENROUTER_KEY,
  };
  observe(`${h.logs.length} log lines, ${bodies.length} responses scanned`);
  assert(h.logs.length >= 8, "the failure paths did log");
  for (const [name, v] of Object.entries(secrets)) {
    for (const l of h.logs) assert(!l.includes(v), `${name} in a log line: ${l}`);
    for (const b of bodies) assert(!b.includes(v), `${name} in a response: ${b}`);
  }
  void a;
});

// ------------------------------------------------ rule 7: ceilings unchanged
t("§ 17.2/§ 17.5 after a $40 purchase the $5/day beta ceiling still stops the proxy (503, not forwarded)", async () => {
  const h = await harness();
  h.reset();
  const [x] = await member(h);
  const [a, ta] = await member(h);
  call(h.st, x, 5.0);
  const orderId = await createApproved(h, ta, "40");
  assertEquals((await pay(h, "/capture-order", { orderId }, ta)).j.status, "credited");
  const res = await h.proxy(preq(baseBody(), { token: ta }));
  const txt = await res.text();
  await h.drain();
  assertEquals(res.status, 503, txt);
  assert(txt.includes("The beta has reached today's limit. Try again tomorrow."), txt);
  assertEquals(h.upstreamHits.length, 0);
  void a;
});

t("§ 17.2 over_balance points to buying; a purchase makes the next call go through (and nothing else changes)", async () => {
  const h = await harness();
  h.reset();
  const yesterday = new Date(Date.now() - 2 * 86400_000);
  const [a, ta] = await member(h, 5);
  call(h.st, a, 5, yesterday);
  const r0 = await h.proxy(preq(baseBody(), { token: ta }));
  const t0 = await r0.text();
  assertEquals(r0.status, 402);
  assert(t0.includes("Your credit is used up. You can buy more from your balance at the top."), t0);
  const orderId = await createApproved(h, ta, "10");
  assertEquals((await pay(h, "/capture-order", { orderId }, ta)).j.status, "credited");
  const r1 = await h.proxy(preq(baseBody(), { token: ta }));
  await r1.text();
  await h.drain();
  assertEquals(r1.status, 200);
});
