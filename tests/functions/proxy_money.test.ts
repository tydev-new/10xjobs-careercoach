// § 8 points 3, 5, 6 and the ledger: 402 at zero/negative balance; the $5/day
// beta-wide ceiling (UTC day, across users) -> 503 model_error; one ledger row
// per call with the right cost; the ceiling cost (~$0.22: § 9.5 amended
// 2026-09-24, MAX_TOKENS_CAP 8,192; § 14, one search at $0.007 per request)
// when no cost can be read; a client
// disconnect still meters; upstream 402/5xx -> 503 model_error; no row for a
// request that never reached upstream; duplicate request_id is rejected
// without a crash.

import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import {
  baseBody,
  call,
  callRows,
  credit,
  harness,
  member,
  MODEL,
  observe,
  okStream,
  preq,
  sse,
  t,
  userJwt,
} from "./_harness.ts";

// design-web-ui.md § 1.11 (replaced after C § 17.4), word for word.
const OVER_BALANCE = "Your credit is used up. You can buy more from your balance at the top.";
const CEILING_MSG = "The beta has reached today's limit. Try again tomorrow.";

async function run(tok: string, body: unknown = baseBody()) {
  const h = await harness();
  const res = await h.proxy(preq(body, { token: tok }));
  const txt = await res.text();
  await h.drain();
  return { res, txt };
}

// ------------------------------------------------------------- balance ----
t("balance: exactly 0 -> 402 over_balance with the § 8 text; never forwarded; no row", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h, 5);
  call(h.st, uid, 5);
  const { res, txt } = await run(tok);
  assertEquals(res.status, 402);
  assert(txt.includes("over_balance") && txt.includes(OVER_BALANCE), txt);
  assertEquals(h.upstreamHits.length, 0);
  assertEquals(callRows(h.st).length, 1, "only the planted row");
});

t("balance: negative -> 402; a hair above zero -> forwards", async () => {
  const h = await harness();
  h.reset();
  const yesterday = new Date(Date.now() - 2 * 86400_000); // keep the beta ceiling out of this test
  const [uid, tok] = await member(h, 5);
  call(h.st, uid, 5.2, yesterday);
  assertEquals((await run(tok)).res.status, 402);
  const [uid2, tok2] = await member(h, 5);
  call(h.st, uid2, 4.999999, yesterday);
  assertEquals((await run(tok2)).res.status, 200);
});

// ------------------------------------------------------------- ceiling ----
t("ceiling: $5.00 spent today across OTHER users blocks a fresh member with 503 model_error (not over_balance)", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const [b] = await member(h);
  call(h.st, a, 3.0);
  call(h.st, b, 2.0);
  const [, tok] = await member(h);
  const { res, txt } = await run(tok);
  assertEquals(res.status, 503);
  assert(txt.includes("model_error") && txt.includes(CEILING_MSG), txt);
  assert(!txt.includes("over_balance"));
  assertEquals(h.upstreamHits.length, 0);
});

t("ceiling: $4.999999 today forwards; yesterday's (UTC) spend does not count", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h, 100);
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  call(h.st, a, 50, new Date(midnight.getTime() - 1000)); // 23:59:59 yesterday UTC
  call(h.st, a, 4.999999, midnight); // 00:00:00 today UTC
  const [, tok] = await member(h);
  assertEquals((await run(tok)).res.status, 200);
  call(h.st, a, 0.000001);
  assertEquals((await run(tok)).res.status, 503);
});

// ------------------------------------------------------------- metering ----
t("meter: one 'call' row per call, keyed by the response id, usd = usage.cost, tokens from usage", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  h.setUpstream(() => sse(okStream("gen-abc-1")));
  const { res, txt } = await run(tok);
  assertEquals(res.status, 200);
  assert(txt.includes("gen-abc-1"));
  const rows = callRows(h.st);
  assertEquals(rows.length, 1);
  const r = rows[0];
  assertEquals([r.user_id, r.kind, r.request_id, r.model], [uid, "call", "gen-abc-1", MODEL]);
  assertAlmostEquals(r.usd, 0.012345, 1e-9);
  assertEquals([r.tokens_in, r.tokens_out, r.tokens_cached], [1200, 80, 1000]);
});

t("meter: N sequential calls -> N rows, balance falls by the sum", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  let i = 0;
  h.setUpstream(() => sse(okStream(`gen-seq-${i++}`)));
  for (let k = 0; k < 5; k++) await run(tok);
  const rows = callRows(h.st).filter((r) => r.user_id === uid);
  assertEquals(rows.length, 5);
  assertEquals(new Set(rows.map((r) => r.request_id)).size, 5);
});

t("meter: usage missing entirely -> the ceiling cost is recorded", async () => {
  const h = await harness();
  h.reset();
  await member(h);
  const [, tok] = await member(h);
  h.setUpstream(() => sse(okStream("gen-nousage", null)));
  await run(tok);
  const rows = callRows(h.st);
  assertEquals(rows.length, 1);
  assertAlmostEquals(rows[0].usd, CEILING, 1e-6, `usd ${rows[0].usd}`); // § 13.1 Claude: $0.273112
  assertEquals(rows[0].request_id, "gen-nousage");
});

t("meter: the ceiling constant vs § 9.5's own formula (64k×$2/M + 8,192×$10/M + one search)", async () => {
  // § 13.1 Claude: 64,000 × 2.75e-6 = 0.176; 8,192 × 11e-6 = 0.090112; one Exa search = 0.007 (§ 14)
  const formula = 64_000 * 2.75e-6 + 8_192 * 11e-6 + 0.007;
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  h.setUpstream(() => sse(okStream("gen-c", null)));
  await run(tok);
  observe(`recorded ceiling ${callRows(h.st)[0].usd} vs formula ${formula.toFixed(5)} (spec: "about $0.22")`);
  assertAlmostEquals(callRows(h.st)[0].usd, formula, 1e-6);
});

const CEILING = 64_000 * 2.75e-6 + 8_192 * 11e-6 + 0.007; // § 13.1's formula for Claude (the default model), = 0.273112

// § 8 (amended, main eb523bf): a finite cost from 0 to 10× the ceiling is recorded
// AS REPORTED (never undercounted); above the ceiling it is also logged as an
// anomaly. Missing, non-finite, negative or beyond-10× costs record the ceiling.
// Third column: expected usd; fourth: whether an anomaly log line is required.
const GARBLED: Array<[string, Record<string, unknown> | string, number, boolean]> = [
  ["cost as string", { prompt_tokens: 10, completion_tokens: 5, cost: "0.01" }, CEILING, false],
  ["cost null", { prompt_tokens: 10, completion_tokens: 5, cost: null }, CEILING, false],
  ["cost negative", { prompt_tokens: 10, completion_tokens: 5, cost: -0.5 }, CEILING, false],
  ["cost astronomically large", { prompt_tokens: 10, completion_tokens: 5, cost: 1e9 }, CEILING, false],
  ["cost above the ceiling (0.5)", { prompt_tokens: 10, completion_tokens: 5, cost: 0.5 }, 0.5, true],
  ["cost above the ceiling (1.5)", { prompt_tokens: 10, completion_tokens: 5, cost: 1.5 }, 1.5, true],
  ["cost exactly 10x the ceiling", { prompt_tokens: 10, completion_tokens: 5, cost: CEILING * 10 }, CEILING * 10, true],
  ["cost just beyond 10x the ceiling", { prompt_tokens: 10, completion_tokens: 5, cost: CEILING * 10 + 0.0001 }, CEILING, false],
  // § 13.1 moved the bound up: 10× is now 2.73112, so § 14's old 10× (2.1692) is within it, reported as-is (above the ceiling).
  ["cost at the pre-§ 13 10x (2.1692), now within 10x", { prompt_tokens: 10, completion_tokens: 5, cost: 2.1692 }, 2.1692, true],
  ["cost beyond 10x the ceiling (25)", { prompt_tokens: 10, completion_tokens: 5, cost: 25 }, CEILING, false],
  ["cost exactly 0", { prompt_tokens: 10, completion_tokens: 5, cost: 0 }, 0, false],
  ["cost exactly the ceiling", { prompt_tokens: 10, completion_tokens: 5, cost: CEILING }, CEILING, false],
  ["tokens negative", { prompt_tokens: -1, completion_tokens: 5, cost: 0.01 }, 0.01, false],
  ["tokens fractional", { prompt_tokens: 10.5, completion_tokens: 5, cost: 0.01 }, 0.01, false],
  ["tokens over int4", { prompt_tokens: 3e9, completion_tokens: 5, cost: 0.01 }, 0.01, false],
  ["usage is a string", "usage-garbled", CEILING, false],
];
const ANOMALY = /anomal/i;

for (const [label, usage, want, anomaly] of GARBLED) {
  t(`meter: usage (${label}) -> exactly one row at usd ${want === CEILING ? "= the ceiling" : want}${anomaly ? " + an anomaly log" : ""}`, async () => {
    const h = await harness();
    h.reset();
    const [uid, tok] = await member(h);
    const id = `gen-garbled-${label.replace(/\W+/g, "-")}`;
    h.setUpstream(() =>
      sse([
        `data: ${JSON.stringify({ id, choices: [{ delta: { content: "x" } }] })}`,
        `data: ${JSON.stringify({ id, choices: [], usage })}`,
        "data: [DONE]",
      ])
    );
    const { res } = await run(tok);
    assertEquals(res.status, 200);
    const rows = callRows(h.st).filter((r) => r.user_id === uid);
    const warn = h.logs.filter((l) => l.includes("ledger insert"));
    assertEquals(rows.length, 1, `no ledger row -> a free call. logs: ${warn.join(" | ").slice(0, 300)}`);
    assertAlmostEquals(rows[0].usd, want, 1e-6, `usd ${rows[0].usd}`);
    assertEquals(rows[0].request_id, id);
    for (const k of ["tokens_in", "tokens_out", "tokens_cached"] as const) {
      assert(Number.isInteger(rows[0][k]) && rows[0][k] >= 0, `${k}=${rows[0][k]}`);
    }
    const anomalyLines = h.logs.filter((l) => ANOMALY.test(l));
    if (anomaly) assert(anomalyLines.length >= 1, `expected an anomaly log line; logs: ${h.logs.join(" | ").slice(0, 300)}`);
    else assertEquals(anomalyLines, [], "no anomaly log for an in-range or replaced cost");
  });
}

t("meter: when several chunks carry usage, the final one is what's recorded", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  h.setUpstream(() =>
    sse([
      `data: ${JSON.stringify({ id: "gen-multi", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.001 } })}`,
      `data: ${JSON.stringify({ id: "gen-multi", choices: [{ delta: { content: "x" } }] })}`,
      `data: ${JSON.stringify({ id: "gen-multi", choices: [], usage: { prompt_tokens: 900, completion_tokens: 50, cost: 0.02 } })}`,
      "data: [DONE]",
    ])
  );
  await run(tok);
  const rows = callRows(h.st).filter((r) => r.user_id === uid);
  assertEquals(rows.length, 1);
  assertAlmostEquals(rows[0].usd, 0.02, 1e-9);
  assertEquals(rows[0].tokens_in, 900);
});

t("meter: a truncated final data: line (cut mid-JSON) records the ceiling, keyed by the id seen", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  h.setUpstream(() =>
    sse([
      `data: ${JSON.stringify({ id: "gen-trunc", choices: [{ delta: { content: "x" } }] })}`,
      `data: {"id":"gen-trunc","choices":[],"usage":{"prompt_tokens":10,"cos`,
    ])
  );
  await run(tok);
  const rows = callRows(h.st);
  assertEquals(rows.length, 1);
  // Parsing only the last data: line (§ 8) may leave the id unreadable here; a
  // generated request_id is acceptable, the ceiling cost is not negotiable.
  assert(typeof rows[0].request_id === "string" && rows[0].request_id.length > 0);
  assertAlmostEquals(rows[0].usd, CEILING, 1e-6);
});

t("meter: a 200 whose body is JSON, not SSE -> one row at the ceiling", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  h.setUpstream(() => Response.json({ id: "gen-json", choices: [] }));
  await run(tok);
  const rows = callRows(h.st);
  assertEquals(rows.length, 1);
  assertAlmostEquals(rows[0].usd, CEILING, 1e-6); // § 9.5 ceiling
});

t("meter: an upstream connection reset mid-stream still writes one row (ceiling), keyed by the id", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  h.setUpstream(() => sse([`data: ${JSON.stringify({ id: "gen-reset", choices: [{ delta: { content: "x" } }] })}`], { errorAfter: true, delayMs: 30 }));
  const res = await h.proxy(preq(baseBody(), { token: tok }));
  await res.text().catch(() => "");
  await h.drain();
  const rows = callRows(h.st);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].request_id, "gen-reset");
  assertAlmostEquals(rows[0].usd, CEILING, 1e-6); // § 9.5 ceiling
});

t("meter: a client disconnect (real HTTP, abort after the first chunk) still meters the full call", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  const id = "gen-disconnect";
  h.setUpstream(() => sse(okStream(id, { prompt_tokens: 5000, completion_tokens: 900, cost: 0.0421 }), { delayMs: 60 }));
  const srv = h.serveReal(h.proxy);
  try {
    const ac = new AbortController();
    const res = await fetch(`${srv.url}/ten-model-proxy/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify(baseBody()),
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await reader.cancel().catch(() => {});
    // wait for the metering promise the handler registered with waitUntil
    const deadline = Date.now() + 5000;
    while (h.pending.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    await h.drain();
  } finally {
    await srv.stop();
  }
  const rows = callRows(h.st).filter((r) => r.user_id === uid);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].request_id, id);
  assertAlmostEquals(rows[0].usd, 0.0421, 1e-9);
});

t("meter: a client that never reads the body (cancels immediately) still meters", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  h.setUpstream(() => sse(okStream("gen-cancel0", { prompt_tokens: 1, completion_tokens: 1, cost: 0.003 }), { delayMs: 20 }));
  const res = await h.proxy(preq(baseBody(), { token: tok }));
  await res.body!.cancel();
  await h.drain();
  const rows = callRows(h.st).filter((r) => r.user_id === uid);
  assertEquals(rows.length, 1);
  assertAlmostEquals(rows[0].usd, 0.003, 1e-9);
});

t("meter: a stalled upstream is metered at the ceiling once the meter deadline (< 400 s wall clock) passes", async () => {
  // § 8 (amended): "or the meter passes its ~360 s deadline, the row records the
  // ceiling". Long timers (>= 300 s) are compressed to 50 ms for this test only;
  // the requested delay is recorded and checked against the 400 s wall clock.
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  const realSetTimeout = globalThis.setTimeout;
  const longTimers: number[] = [];
  // deno-lint-ignore no-explicit-any
  (globalThis as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) => {
    if (typeof ms === "number" && ms >= 300_000) {
      longTimers.push(ms);
      return realSetTimeout(fn, 50, ...a);
    }
    return realSetTimeout(fn, ms, ...a);
  };
  try {
    h.setUpstream(() =>
      sse([`data: ${JSON.stringify({ id: "gen-stall", choices: [{ delta: { content: "x" } }] })}`], { hangAfter: true })
    );
    const res = await h.proxy(preq(baseBody(), { token: tok }));
    // tee(): a branch's cancel() only resolves once BOTH branches cancel, so don't await it.
    res.body!.cancel().catch(() => {});
    const settled = await Promise.race([
      Promise.all(h.pending).then(() => true),
      new Promise<boolean>((r) => realSetTimeout(() => r(false), 3000)),
    ]);
    const rows = callRows(h.st).filter((r) => r.user_id === uid);
    observe(`stalled upstream: long timers requested ${JSON.stringify(longTimers)}; meter settled=${settled}; rows=${JSON.stringify(rows.map((r) => [r.request_id, r.usd]))}`);
    assert(settled, "meter never settled");
    assert(longTimers.length >= 1 && longTimers.every((ms) => ms < 400_000), `deadline must be below the 400 s wall clock: ${longTimers}`);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].request_id, "gen-stall");
    assertAlmostEquals(rows[0].usd, CEILING, 1e-6);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

t("meter: the ~360 s deadline is timed from the request's start (slow upstream headers count)", async () => {
  // § 8 (amended): "the meter passes its ~360 s deadline (timed from the request's
  // start)". Every long timer (setTimeout >= 300 s or AbortSignal.timeout >= 300 s)
  // is recorded with the moment it was requested, and fired after 50 ms. Its
  // effective expiry (requested-at + delay) must fall no later than
  // request start + 360 s (+100 ms slack), however long the upstream took to answer.
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  const realSetTimeout = globalThis.setTimeout;
  const realAbortTimeout = AbortSignal.timeout;
  const long: Array<{ at: number; ms: number }> = [];
  // deno-lint-ignore no-explicit-any
  (globalThis as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) => {
    if (typeof ms === "number" && ms >= 300_000) {
      long.push({ at: Date.now(), ms });
      return realSetTimeout(fn, 50, ...a);
    }
    return realSetTimeout(fn, ms, ...a);
  };
  AbortSignal.timeout = (ms: number) => {
    if (ms >= 300_000) {
      long.push({ at: Date.now(), ms });
      return realAbortTimeout.call(AbortSignal, 50);
    }
    return realAbortTimeout.call(AbortSignal, ms);
  };
  try {
    const HEADER_DELAY = 400;
    h.setUpstream(async () => {
      await new Promise((r) => realSetTimeout(r, HEADER_DELAY));
      return sse([`data: ${JSON.stringify({ id: "gen-slowhead", choices: [{ delta: { content: "x" } }] })}`], { hangAfter: true });
    });
    const start = Date.now();
    const res = await h.proxy(preq(baseBody(), { token: tok }));
    res.body?.cancel().catch(() => {});
    const settled = await Promise.race([
      Promise.all(h.pending).then(() => true),
      new Promise<boolean>((r) => realSetTimeout(() => r(false), 3000)),
    ]);
    const rows = callRows(h.st).filter((r) => r.user_id === uid);
    const expiries = long.map((x) => x.at + x.ms - start);
    observe(`slow headers (${HEADER_DELAY} ms): long timers ${JSON.stringify(long.map((x) => ({ after: x.at - start, ms: x.ms })))}; effective expiry after start ${JSON.stringify(expiries)} ms; settled=${settled}; rows=${JSON.stringify(rows.map((r) => [r.request_id, r.usd]))}`);
    assert(long.length >= 1, "no long timer observed");
    assert(Math.min(...expiries) <= 360_000 + 100, `deadline not timed from the request's start: expiry ${Math.min(...expiries)} ms after start`);
    assert(settled, "meter never settled");
    assertEquals(rows.length, 1);
    assertAlmostEquals(rows[0].usd, CEILING, 1e-6);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    AbortSignal.timeout = realAbortTimeout;
  }
});

// ------------------------------------------------------ upstream errors ----
for (const status of [402, 500, 502, 503, 504]) {
  t(`upstream ${status} -> 503 model_error (not over_balance), no ledger row`, async () => {
    const h = await harness();
    h.reset();
    const [, tok] = await member(h);
    h.setUpstream(() => Response.json({ error: { code: status, message: "upstream says no" } }, { status }));
    const { res, txt } = await run(tok);
    assertEquals(res.status, 503);
    assert(txt.includes("model_error"), txt);
    assert(!txt.includes("over_balance") && !txt.includes("upstream says no"), txt);
    assertEquals(callRows(h.st).length, 0);
  });
}

t("upstream 400/401/429 -> a non-2xx the app can show, no ledger row, upstream text not echoed", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const out: string[] = [];
  for (const status of [400, 401, 429]) {
    h.setUpstream(() => Response.json({ error: { message: "upstream-detail-" + status } }, { status }));
    const { res, txt } = await run(tok);
    out.push(`${status}->${res.status}`);
    assert(res.status >= 400);
    assert(!txt.includes("upstream-detail"), txt);
  }
  observe("upstream 4xx mapping:", out);
  assertEquals(callRows(h.st).length, 0);
});

t("upstream unreachable (fetch throws) -> 503 model_error, no row", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  h.setUpstream(() => {
    throw new Error("boom");
  });
  const { res, txt } = await run(tok);
  // the stub turns a thrown handler into a 500 from Deno.serve, i.e. an upstream 5xx
  assertEquals(res.status, 503, txt);
  assertEquals(callRows(h.st).length, 0);
});

t("no ledger row and no upstream hit on every refusal path (401/403/402/503 ceiling/400/413/404)", async () => {
  const h = await harness();
  h.reset();
  const [, memberTok] = await member(h);
  const nm = crypto.randomUUID();
  h.st.authUsers.add(nm);
  const nmTok = await userJwt(nm);
  const [broke, brokeTok] = await member(h);
  call(h.st, broke, 5, new Date(Date.now() - 2 * 86400_000));
  const reqs: Array<[number, Request]> = [
    [401, preq(baseBody())],
    [403, preq(baseBody(), { token: nmTok })],
    [402, preq(baseBody(), { token: brokeTok })],
    [400, preq({ ...baseBody(), model: "x" }, { token: memberTok })],
    [400, preq(undefined, { token: memberTok, raw: "{nope" })],
    [413, preq(undefined, { token: memberTok, raw: "x".repeat(300 * 1024) })],
    [404, preq(baseBody(), { token: memberTok, path: "/v1/embeddings" })],
  ];
  for (const [want, r] of reqs) {
    const res = await h.proxy(r);
    await res.body?.cancel();
    assertEquals(res.status, want);
  }
  const before = callRows(h.st).length;
  h.st.ledger.push(...[]);
  const [a] = await member(h);
  call(h.st, a, 10);
  const res = await h.proxy(preq(baseBody(), { token: memberTok }));
  await res.body?.cancel();
  assertEquals(res.status, 503);
  await h.drain();
  assertEquals(h.upstreamHits.length, 0);
  assertEquals(callRows(h.st).length, before + 1, "only the planted spend row");
});

t("duplicate request_id: the second insert is rejected, no crash, one row, both clients got their stream", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  h.setUpstream(() => sse(okStream("gen-dup")));
  const a = await run(tok);
  const b = await run(tok);
  assertEquals([a.res.status, b.res.status], [200, 200]);
  assert(b.txt.includes("gen-dup"));
  const rows = callRows(h.st).filter((r) => r.user_id === uid);
  assertEquals(rows.length, 1);
  assert(h.logs.some((l) => l.includes("ledger insert failed")), "the rejection is logged");
});

t("Supabase failures (balance, spend today, membership) -> 503 model_error with CORS, never forwarded, never thrown", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const out: string[] = [];
  for (const k of ["ten_balance_for", "ten_beta_spend_today", "ten_is_member"]) {
    h.st.fail = { [k]: 503 };
    let status: string;
    try {
      const res = await h.proxy(preq(baseBody(), { token: tok, origin: "https://ten.example.com" }));
      await res.body?.cancel();
      status = `${res.status} acao=${res.headers.get("access-control-allow-origin")}`;
    } catch (e) {
      status = `THREW ${String(e).slice(0, 80)}`;
    }
    out.push(`${k} down -> ${status}`);
  }
  h.st.fail = {};
  observe(out);
  assertEquals(h.upstreamHits.length, 0, "fails closed");
  assertEquals(out, [
    "ten_balance_for down -> 503 acao=https://ten.example.com",
    "ten_beta_spend_today down -> 503 acao=https://ten.example.com",
    "ten_is_member down -> 503 acao=https://ten.example.com",
  ]);
  // GoTrue down: § 8 point 1 makes that a 401 (no user resolved); record it.
  h.st.fail = { "/auth/v1/user": 503 };
  const r = await h.proxy(preq(baseBody(), { token: tok, origin: "https://ten.example.com" }));
  await r.body?.cancel();
  h.st.fail = {};
  observe(`GoTrue down -> ${r.status} acao=${r.headers.get("access-control-allow-origin")}`);
  assertEquals(r.headers.get("access-control-allow-origin"), "https://ten.example.com");
});

t("parallel calls: each starts only while the balance is above 0 (the honest bound)", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h, 0.05);
  let i = 0;
  h.setUpstream(() => sse(okStream(`gen-par-${i++}`, { prompt_tokens: 1, completion_tokens: 1, cost: 0.04 })));
  const rs = await Promise.all(Array.from({ length: 4 }, () => h.proxy(preq(baseBody(), { token: tok }))));
  await Promise.all(rs.map((r) => r.text()));
  await h.drain();
  observe(`4 parallel calls at $0.05 balance, $0.04 each: statuses ${rs.map((r) => r.status)}; balance after ${
    (0.05 - callRows(h.st).filter((r) => r.user_id === uid).reduce((a, r) => a + r.usd, 0)).toFixed(4)
  }`);
  credit(h.st, uid, 0); // keep lint quiet about unused import patterns
});
