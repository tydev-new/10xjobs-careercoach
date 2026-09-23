// Final-pass checks for fix round 2 (§ 8 as amended in main eb523bf): the cost
// anomaly log line carries no key or content; the meter deadline cannot be
// lengthened by anything a client sends; only the final usage line is used
// (replaced, never merged); a 409 on the retry is "not lost" while a real
// double failure still alerts at error level.

import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { baseBody, callRows, FN, harness, member, OPENROUTER_KEY, observe, preq, sse, t } from "./_harness.ts";

const CEILING = 64_000 * 2e-6 + 4_096 * 1e-5 + 5 * 0.004;
const MODEL_TEXT = "MODEL-OUTPUT-CANARY-cover-letter-for-Acme";
const CLIENT_TEXT = "CLIENT-CV-CANARY-jane-doe-salary-history";

async function oneCall(h: Awaited<ReturnType<typeof harness>>, tok: string, chunks: string[], extra: Record<string, unknown> = {}) {
  h.setUpstream(() => sse(chunks));
  const res = await h.proxy(
    preq({ ...baseBody(), messages: [{ role: "user", content: CLIENT_TEXT }], ...extra }, { token: tok }),
  );
  const txt = await res.text();
  await h.drain();
  return { res, txt };
}

const chunk = (id: string, o: Record<string, unknown>) => `data: ${JSON.stringify({ id, ...o })}`;

t("anomaly: a cost above the ceiling is recorded as reported and logs one anomaly line — no key, no content, no JWT", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  await oneCall(h, tok, [
    chunk("gen-anom", { choices: [{ delta: { content: MODEL_TEXT } }] }),
    chunk("gen-anom", { choices: [], usage: { prompt_tokens: 60000, completion_tokens: 4000, cost: 0.95 } }),
    "data: [DONE]",
  ]);
  const rows = callRows(h.st).filter((r) => r.user_id === uid);
  assertEquals(rows.length, 1);
  assertAlmostEquals(rows[0].usd, 0.95, 1e-9);
  const lines = h.logs.filter((l) => /anomal/i.test(l));
  observe("anomaly log:", lines);
  assertEquals(lines.length, 1);
  const line = lines[0];
  assert(line.includes("gen-anom") && line.includes("0.95"), "names the call and the amount");
  for (const bad of [OPENROUTER_KEY, OPENROUTER_KEY.slice(10, 40), MODEL_TEXT, CLIENT_TEXT, tok, h.serviceKey]) {
    assertEquals(line.includes(bad), false, `anomaly line leaks ${bad.slice(0, 16)}…`);
  }
  // and no log line at all carries content or the key on this path
  const all = h.logs.join("\n");
  for (const bad of [OPENROUTER_KEY, MODEL_TEXT, CLIENT_TEXT]) assertEquals(all.includes(bad), false);
});

t("deadline: no client input (header, query, body field) lengthens the meter deadline past request start + 360 s", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const realSetTimeout = globalThis.setTimeout;
  const realAbortTimeout = AbortSignal.timeout;
  const long: Array<{ at: number; ms: number }> = [];
  // deno-lint-ignore no-explicit-any
  (globalThis as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) => {
    if (typeof ms === "number" && ms >= 1_000) {
      long.push({ at: Date.now(), ms });
      return realSetTimeout(fn, 50, ...a);
    }
    return realSetTimeout(fn, ms, ...a);
  };
  AbortSignal.timeout = (ms: number) => {
    if (ms >= 1_000) long.push({ at: Date.now(), ms });
    return realAbortTimeout.call(AbortSignal, Math.min(ms, 50));
  };
  const results: string[] = [];
  try {
    h.setUpstream(() => sse([chunk("gen-dl", { choices: [{ delta: { content: "x" } }] })], { hangAfter: true }));
    const attempts: Array<[string, Request]> = [
      ["header", preq(baseBody(), { token: tok, headers: { "x-meter-deadline-ms": "999999999", "x-deadline": "999999999", "meterDeadlineMs": "999999999" } })],
      ["query", preq(baseBody(), { token: tok, url: `${FN}/chat/completions?meterDeadlineMs=999999999&deadline=999999999` })],
      ["body", preq({ ...baseBody(), meterDeadlineMs: 999999999, deadline: 999999999, timeout: 999999999, meter: { deadlineMs: 999999999 } }, { token: tok })],
      ["prototype", preq(undefined, { token: tok, raw: `{"messages":[],"__proto__":{"meterDeadlineMs":999999999}}` })],
    ];
    for (const [label, r] of attempts) {
      long.length = 0;
      h.pending.length = 0;
      const start = Date.now();
      const res = await h.proxy(r);
      res.body?.cancel().catch(() => {});
      await Promise.race([Promise.all(h.pending), new Promise((ok) => realSetTimeout(ok, 3000))]);
      const expiries = long.map((x) => x.at + x.ms - start);
      results.push(`${label}: ${res.status} expiries=${JSON.stringify(expiries)}`);
      assertEquals(res.status, 200, label);
      assert(long.length >= 1, `${label}: no deadline timer observed`);
      assert(Math.max(...expiries) <= 360_000 + 100, `${label}: deadline extended to ${Math.max(...expiries)} ms`);
    }
  } finally {
    globalThis.setTimeout = realSetTimeout;
    AbortSignal.timeout = realAbortTimeout;
    observe("deadline vs client input:", results);
  }
  assertEquals(({} as Record<string, unknown>).meterDeadlineMs, undefined, "Object.prototype not polluted");
});

t("final usage line: fields are replaced, never merged across chunks", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  // earlier usage is complete and valid; the final usage has a garbled cost and no tokens
  await oneCall(h, tok, [
    chunk("gen-merge", { choices: [], usage: { prompt_tokens: 500, completion_tokens: 40, cost: 0.02, prompt_tokens_details: { cached_tokens: 400 } } }),
    chunk("gen-merge", { choices: [{ delta: { content: "x" } }] }),
    chunk("gen-merge", { choices: [], usage: { cost: "garbled" } }),
    "data: [DONE]",
  ]);
  const r = callRows(h.st).filter((x) => x.user_id === uid);
  assertEquals(r.length, 1);
  assertAlmostEquals(r[0].usd, CEILING, 1e-6, "garbled final cost -> the ceiling, not the earlier 0.02");
  assertEquals([r[0].tokens_in, r[0].tokens_out, r[0].tokens_cached], [0, 0, 0], "no tokens borrowed from an earlier chunk");
});

t("ledger retry: a lost ack (committed, then 503) -> one row, logged as not lost, no ALERT", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  h.st.ledgerPlan = ["commit-then-fail"];
  await oneCall(h, tok, [chunk("gen-ack", { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.01 } }), "data: [DONE]"]);
  assertEquals(callRows(h.st).filter((x) => x.user_id === uid).length, 1);
  observe("lost-ack logs:", h.logs);
  assert(h.logs.some((l) => /not a lost row|not lost/i.test(l)), "logs 'not lost'");
  assertEquals(h.logs.filter((l) => /ALERT/.test(l)), []);
});

t("ledger retry: a transient failure then success -> one row, no ALERT, no 'not lost'", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  h.st.ledgerPlan = ["fail", "ok"];
  await oneCall(h, tok, [chunk("gen-transient", { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.01 } }), "data: [DONE]"]);
  assertEquals(callRows(h.st).filter((x) => x.user_id === uid).length, 1);
  assertEquals(h.logs.filter((l) => /ALERT|not a lost row|not lost|lost response/i.test(l)), []);
});

t("ledger retry: a real double failure -> no row, an ALERT at error level", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  h.st.ledgerPlan = ["fail", "fail"];
  await oneCall(h, tok, [chunk("gen-lost", { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.01 } }), "data: [DONE]"]);
  assertEquals(callRows(h.st).filter((x) => x.user_id === uid).length, 0);
  const alerts = h.logs.filter((l) => /ALERT/.test(l));
  observe("double-failure logs:", alerts);
  assertEquals(alerts.length, 1);
  assert(alerts[0].startsWith("[error]"), "alert is logged at error level");
  assertEquals(h.logs.some((l) => /not a lost row|not lost|lost response/i.test(l)), false);
  assertEquals(h.logs.join("\n").includes(OPENROUTER_KEY), false);
});

t("ledger retry (OBSERVED): a genuine duplicate id from a DIFFERENT call is logged 'not lost' and not charged twice", async () => {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  const c = [chunk("gen-samedup", { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.01 } }), "data: [DONE]"];
  await oneCall(h, tok, c);
  h.logs.length = 0;
  await oneCall(h, tok, c);
  observe(`rows=${callRows(h.st).filter((x) => x.user_id === uid).length}; logs=${JSON.stringify(h.logs.map((l) => l.slice(0, 120)))}`);
  assertEquals(callRows(h.st).filter((x) => x.user_id === uid).length, 1);
});
