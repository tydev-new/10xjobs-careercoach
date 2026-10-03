// Independent tester, open sign-up review (design-web-agent.md § 20.6, § 8,
// § 20.11 "Proxy"; design-web-ui.md § 5.3.1 O6, E16; § 1.11 B7's promise).
// Written from the spec, run against the REAL ten-model-proxy/index.ts through
// tests/functions/_harness.ts (loopback stubs only; no live call can leave).
//
//   deno test --allow-net=127.0.0.1 tests/functions/open_signup_proxy.test.ts
//
// What the spec says, and what each test pins:
//   § 20.6  no daily spending ceiling of Ten's own, for anyone; the proxy asks
//           the database nothing about the day's spend
//   § 20.6  kept unchanged: 403 non-member, 402 over_balance at <= 0, the per-call
//           caps (256 KB in, 8,192 output tokens, 5 search results, two-model allowlist)
//   § 20.6  upstream 402 -> 503 model_error with E16, and NO ledger row (B7:
//           "None of your credit is used while Ten is paused")
//   O6      the 403's text, word for word

import { assert, assertEquals } from "jsr:@std/assert@1";
import { baseBody, call, callRows, harness, member, MODEL, nonMember, observe, okStream, preq, sse, t } from "./_harness.ts";

// The spec's words (design-web-ui.md § 5.3.1 and § 1.11), typed from the doc.
const O6 = "This account isn't set up to use Ten yet. Sign out, then sign in again to check.";
const E16 = "Ten's model service has reached its spending limit. Try again later.";
const OVER_BALANCE = "Your credit is used up. You can buy more from your balance at the top.";
const GENERAL = "The model is temporarily unavailable. Try again.";
const DEEPSEEK = "deepseek/deepseek-v4.1-flash";

async function send(tok: string, body: unknown = baseBody()) {
  const h = await harness();
  const res = await h.proxy(preq(body, { token: tok }));
  const txt = await res.text();
  await h.drain();
  return { res, txt };
}

// ---------------------------------------------------------- no daily ceiling
t("§ 20.6: a forwarded call makes exactly the auth, membership, balance and ledger requests, and nothing about the day's spend", async () => {
  const h = await harness();
  h.reset();
  const [other] = await member(h, 100000);
  for (let i = 0; i < 50; i++) call(h.st, other, 100); // $5,000 spent today by someone else
  const [, tok] = await member(h, 1);
  const { res, txt } = await send(tok);
  assertEquals(res.status, 200, txt);
  assertEquals(h.upstreamHits.length, 1);
  const paths = h.st.requests.map((r) => `${r.method} ${r.path}`);
  for (const p of paths) {
    assert(!/spend|today|is_paid|ceiling/i.test(p), `a day-spend request was made: ${p}`);
  }
  // every PostgREST path the proxy touched, by name, so a NEW read can't hide
  const rest = [...new Set(h.st.requests.filter((r) => r.path.startsWith("/rest/")).map((r) => r.path.split("?")[0]))].sort();
  assertEquals(rest, ["/rest/v1/rpc/ten_balance_for", "/rest/v1/rpc/ten_is_member", "/rest/v1/ten_usage_ledger"], JSON.stringify(rest));
});

t("§ 20.6: a $1 welcome member, at any total spend today, is held only by their own balance", async () => {
  const h = await harness();
  h.reset();
  const [other] = await member(h, 1e6);
  call(h.st, other, 9999.99);
  const [uid, tok] = await member(h, 1);
  assertEquals((await send(tok)).res.status, 200);
  call(h.st, uid, 1); // their own $1 is gone
  const r = await send(tok);
  assertEquals(r.res.status, 402, r.txt);
  assert(r.txt.includes("over_balance") && r.txt.includes(OVER_BALANCE), r.txt);
});

// (The source scan, "the proxy's code names no daily ceiling", needs file reads,
// which run.py's deno flags don't grant: it lives in tests/web/open-signup-review.test.ts.)

// ------------------------------------------------------------ kept unchanged
t("§ 20.6 kept: a non-member gets 403 not_a_member with O6 word for word; no balance read, no upstream", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await nonMember(h);
  const { res, txt } = await send(tok);
  assertEquals(res.status, 403);
  assertEquals(JSON.parse(txt), { error: { code: "not_a_member", message: O6 } });
  assertEquals(h.upstreamHits.length, 0);
  assertEquals(h.st.requests.filter((r) => r.path.includes("ten_balance_for")).length, 0);
});

t("§ 20.6 kept: 402 over_balance at exactly 0 and below, with § 1.11's words; a hair above forwards", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h, 1);
  call(h.st, a, 1);
  let r = await send(ta);
  assertEquals(r.res.status, 402);
  assertEquals(JSON.parse(r.txt), { error: { code: "over_balance", message: OVER_BALANCE } });
  call(h.st, a, 0.5);
  assertEquals((await send(ta)).res.status, 402);
  const [b, tb] = await member(h, 1);
  call(h.st, b, 0.999999);
  r = await send(tb);
  assertEquals(r.res.status, 200, r.txt);
});

t("§ 20.6 kept: the per-call caps (8,192 tokens, 5 results, 256 KB, two models) for both models", async () => {
  const h = await harness();
  for (const model of [MODEL, DEEPSEEK]) {
    h.reset();
    const [, tok] = await member(h, 5);
    const r = await send(tok, { model, messages: [{ role: "user", content: "hi" }], max_tokens: 1_000_000, plugins: [{ id: "web", max_results: 99 }] });
    assertEquals(r.res.status, 200, r.txt);
    const up = h.upstreamHits[0].body;
    assertEquals(up.model, model);
    assertEquals(up.max_tokens, 8192);
    assertEquals(up.plugins, [{ id: "web", engine: "exa", max_results: 5 }]);
    assertEquals(up.stream, true);
    const big = "x".repeat(256 * 1024);
    const r413 = await send(tok, { model, messages: [{ role: "user", content: big }] });
    assertEquals(r413.res.status, 413, r413.txt);
  }
  h.reset();
  const [, tok] = await member(h, 5);
  const bad = await send(tok, { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }] });
  assertEquals(bad.res.status, 400);
  assert(bad.txt.includes("model_not_allowed"), bad.txt);
  assertEquals(h.upstreamHits.length, 0);
});

// ------------------------------------------------------------- upstream 402
for (const [label, mk] of [
  ["a JSON error body", () => new Response(JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }), { status: 402, headers: { "content-type": "application/json" } })],
  ["an empty body", () => new Response(null, { status: 402 })],
  // A 402 whose body even LOOKS like a finished stream with a cost: still nothing is charged.
  ["an SSE body carrying an id and usage.cost", () => new Response(sse(okStream("gen-402", { prompt_tokens: 10, completion_tokens: 10, cost: 0.5 })).body, { status: 402, headers: { "content-type": "text/event-stream" } })],
] as const) {
  t(`§ 20.6: upstream 402 (${label}) -> 503 model_error with E16 exactly, CORS kept, and no ledger row`, async () => {
    const h = await harness();
    h.reset();
    const [uid, tok] = await member(h, 1);
    const before = JSON.stringify(h.st.ledger);
    h.setUpstream(mk);
    const res = await h.proxy(preq(baseBody(), { token: tok, origin: "https://ten.example.com" }));
    const txt = await res.text();
    await h.drain();
    assertEquals(res.status, 503);
    assertEquals(JSON.parse(txt), { error: { code: "model_error", message: E16 } });
    assertEquals(res.headers.get("access-control-allow-origin"), "https://ten.example.com");
    assertEquals(JSON.stringify(h.st.ledger), before, "the ledger is byte-for-byte unchanged");
    assertEquals(callRows(h.st).filter((r) => r.user_id === uid).length, 0);
  });
}

t("§ 20.6: upstream 500/502/503 keep the general line, never E16", async () => {
  const h = await harness();
  for (const s of [500, 502, 503]) {
    h.reset();
    const [, tok] = await member(h, 1);
    h.setUpstream(() => new Response("x", { status: s }));
    const r = await send(tok);
    assertEquals(r.res.status, 503);
    assertEquals(JSON.parse(r.txt), { error: { code: "model_error", message: GENERAL } });
  }
});

t("§ 20.6 (reported): a 402-coded error INSIDE a 200 stream is metered like any error ending", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h, 1);
  h.setUpstream(() =>
    sse([`data: ${JSON.stringify({ id: "gen-mid402", error: { code: 402, message: "Insufficient credits" }, choices: [{ delta: {}, finish_reason: "error" }] })}`, "data: [DONE]"])
  );
  const r = await send(tok);
  const rows = callRows(h.st).filter((x) => x.user_id === uid);
  observe(`mid-stream 402: client status ${r.res.status}; ledger rows for the member: ${rows.length}; usd ${rows.map((x) => x.usd).join(",")}`);
});
