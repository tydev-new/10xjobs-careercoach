// Tester-owned acceptance tests for docs/design-web-agent.md § 13.1 (the
// proxy allows exactly two models; approved, § 13.6), § 13.5 items (i)–(vi)
// and (x)'s proxy half. Written from the spec, not core.ts. Every case runs
// the DEPLOYED entry (index.ts) through the harness: the upstream body is the
// exact bytes sent, and ledger rows are what the mock PostgREST stored.
// Run: deno test --allow-net=127.0.0.1 tests/functions/proxy_models.test.ts
import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { baseBody, callRows, harness, member, preq, sse, t } from "./_harness.ts";

const CLAUDE = "anthropic/claude-sonnet-5";
const DEEPSEEK = "deepseek/deepseek-v4.1-flash";
// § 13.1's table, by § 8's formula (64,000 in × dearest input + 8,192 out × dearest output + one $0.007 search)
const CEILING: Record<string, number> = {
  [CLAUDE]: 64_000 * 2.75e-6 + 8_192 * 11e-6 + 0.007, // 0.273112
  [DEEPSEEK]: 64_000 * 0.375e-6 + 8_192 * 1.5e-6 + 0.007, // 0.043288
};
// a static JSON import needs no --allow-read (run.py grants only --allow-net=127.0.0.1)
import GOLDEN from "./fixtures/claude-golden-body.json" with { type: "json" };

async function call(body: unknown, opts: { raw?: string; chunks?: string[]; hang?: boolean } = {}) {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  const id = `gen-s13-${Math.random().toString(36).slice(2)}`;
  h.setUpstream(() =>
    sse(opts.chunks ?? [`data: ${JSON.stringify({ id, model: "x", choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] })}`, `data: ${JSON.stringify({ id, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } })}`, "data: [DONE]"], { hangAfter: opts.hang })
  );
  const res = await h.proxy(preq(body, { token: tok, raw: opts.raw }));
  const txt = await res.text();
  await h.drain();
  const up = h.upstreamHits[0];
  return { h, uid, res, txt, hits: h.upstreamHits.length, up: up?.body, upText: up?.bodyText, rows: callRows(h.st).filter((r) => r.user_id === uid), logs: h.logs };
}

// ------------------------------------------------------------------ (i) allowlist

t("§ 13.5 (i): each allowed id -> 200, and the outgoing model equals it", async () => {
  for (const m of [CLAUDE, DEEPSEEK]) {
    const r = await call({ ...baseBody(), model: m });
    assertEquals(r.res.status, 200, `${m}: ${r.txt}`);
    assertEquals(r.up?.model, m);
  }
});

t("§ 13.5 (i): missing, null, a number, suffixes, another case, another DeepSeek -> 400 model_not_allowed, no upstream, no row", async () => {
  const bad: unknown[] = [undefined, null, 42, "anthropic/claude-sonnet-5:online", "deepseek/deepseek-v4.1-flash:free", "DeepSeek/deepseek-v4.1-flash", "deepseek/deepseek-v4-pro", "anthropic/claude-sonnet-5-20260901", "deepseek/deepseek-v4.1-flash-20260910", " anthropic/claude-sonnet-5", "Anthropic/Claude-Sonnet-5", ""];
  for (const m of bad) {
    const body: Record<string, unknown> = { ...baseBody() };
    if (m === undefined) delete body.model;
    else body.model = m;
    const r = await call(body);
    assertEquals(r.res.status, 400, `${JSON.stringify(m)}: ${r.txt}`);
    const j = JSON.parse(r.txt);
    assertEquals(j.error, { code: "model_not_allowed", message: "This model is not allowed." }, JSON.stringify(m));
    assertEquals(r.hits, 0, `${JSON.stringify(m)} reached upstream`);
    assertEquals(r.rows.length, 0, `${JSON.stringify(m)} wrote a ledger row`);
  }
});

// ------------------------------------------------------------------ (ii) Claude body unchanged

t("§ 13.5 (ii): Claude's upstream body is byte-identical to the pre-§ 13 proxy's (golden, captured from b36ef30)", async () => {
  const r = await call(GOLDEN.input);
  assertEquals(r.res.status, 200, r.txt);
  assertEquals(r.upText, GOLDEN.bodyText);
  assertEquals(r.up?.cache_control, { type: "ephemeral" }, "cache_control included");
  assertEquals(r.up?.provider, { data_collection: "deny", zdr: true });
});

// ------------------------------------------------------------------ (iii) DeepSeek body

t("§ 13.5 (iii): DeepSeek's body differs from Claude's in exactly two fields: no cache_control, provider adds require_parameters", async () => {
  const claude = await call({ ...GOLDEN.input, model: CLAUDE });
  const ds = await call({ ...GOLDEN.input, model: DEEPSEEK });
  assertEquals(ds.res.status, 200, ds.txt);
  assert(!("cache_control" in ds.up), `no cache_control: ${ds.upText}`);
  assertEquals(ds.up.provider, { data_collection: "deny", zdr: true, require_parameters: true });
  const strip = (b: Record<string, unknown>) => {
    const { model: _m, cache_control: _c, provider: _p, ...rest } = b;
    return rest;
  };
  assertEquals(strip(ds.up), strip(claude.up), "every other field is the same, incl. the web plugin rewrite");
  assertEquals(ds.up.stream, true);
  assertEquals(ds.up.plugins, [{ id: "web", engine: "exa", max_results: 5 }]);
});

t("§ 13.5 (iii): max_tokens = min(client, 8,192) for DeepSeek too (20,000 -> 8,192; 100 -> 100)", async () => {
  for (const [client, want] of [[20000, 8192], [100, 100]]) {
    const r = await call({ ...baseBody(), model: DEEPSEEK, max_tokens: client });
    assertEquals(r.up?.max_tokens, want, String(client));
  }
});

// ------------------------------------------------------------------ (iv) ceiling per model

const noCost = (id: string, streamModel = "x") => [
  `data: ${JSON.stringify({ id, model: streamModel, choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] })}`,
  `data: ${JSON.stringify({ id, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })}`,
  "data: [DONE]",
];
const withCost = (id: string, cost: number) => [
  `data: ${JSON.stringify({ id, choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] })}`,
  `data: ${JSON.stringify({ id, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cost } })}`,
  "data: [DONE]",
];

t("§ 13.5 (iv): the table's ceilings are 0.273112 and 0.043288 (1e-9)", async () => {
  const core = await import("../../supabase/functions/ten-model-proxy/core.ts");
  const table = (core as any).CEILING_USD_BY_MODEL ?? {};
  assertAlmostEquals(table[CLAUDE], 0.273112, 1e-9);
  assertAlmostEquals(table[DEEPSEEK], 0.043288, 1e-9);
  assertAlmostEquals(CEILING[CLAUDE], 0.273112, 1e-12);
  assertAlmostEquals(CEILING[DEEPSEEK], 0.043288, 1e-12);
});

t("§ 13.5 (iv): a call with no usage.cost records ITS model's ceiling", async () => {
  for (const m of [CLAUDE, DEEPSEEK]) {
    const r = await call({ ...baseBody(), model: m }, { chunks: noCost(`gen-nc-${m.length}`) });
    assertEquals(r.rows.length, 1);
    assertAlmostEquals(r.rows[0].usd, CEILING[m], 1e-6, m);
  }
});

t("§ 13.5 (iv): a DeepSeek call that passes the meter deadline records $0.043288", async () => {
  const h = await harness();
  h.reset();
  const { handleRequest } = await import("../../supabase/functions/ten-model-proxy/handler.ts");
  const sb = await import("../../supabase/functions/_shared/supabase.ts");
  const [uid, tok] = await member(h);
  const env = sb.envFromDeno((k: string) => ({ SUPABASE_URL: h.sbUrl, SUPABASE_ANON_KEY: h.anonKey, SUPABASE_SERVICE_ROLE_KEY: h.serviceKey } as Record<string, string>)[k]);
  const pending: Promise<unknown>[] = [];
  const res = await handleRequest(preq({ ...baseBody(), model: DEEPSEEK }, { token: tok }), {
    verifyUser: (x: string) => sb.verifyUser(env, x),
    isMember: (x: string) => sb.isMember(env, x),
    balanceFor: (u: string) => sb.balanceFor(env, u),
    betaSpendToday: () => sb.betaSpendToday(env),
    insertLedgerCall: (row: any) => sb.insertLedgerCall(env, row),
    fetchUpstream: async () => sse([`data: ${JSON.stringify({ id: "gen-dl-ds", choices: [{ delta: { content: "x" } }] })}`], { hangAfter: true }),
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    randomId: () => crypto.randomUUID(),
    log: { warn: () => {}, error: () => {} },
    meterDeadlineMs: 200,
  } as any, { TEN_APP_ORIGIN: "https://ten.example.com" });
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel().catch(() => {});
  for (const p of pending) await p.catch(() => {});
  const rows = callRows(h.st).filter((r) => r.user_id === uid);
  assertEquals(rows.length, 1);
  assertAlmostEquals(rows[0].usd, CEILING[DEEPSEEK], 1e-6);
  assertEquals(rows[0].model, DEEPSEEK);
});

t("§ 13.5 (iv): a $0.60 cost is DeepSeek's ceiling on DeepSeek (beyond 10×), but recorded as reported with the anomaly log on Claude", async () => {
  const ds = await call({ ...baseBody(), model: DEEPSEEK }, { chunks: withCost("gen-60-ds", 0.6) });
  assertAlmostEquals(ds.rows[0].usd, CEILING[DEEPSEEK], 1e-6);
  const cl = await call({ ...baseBody(), model: CLAUDE }, { chunks: withCost("gen-60-cl", 0.6) });
  assertAlmostEquals(cl.rows[0].usd, 0.6, 1e-6);
  assert(cl.logs.some((l) => /anomal/i.test(l)), "Claude: 0.60 > 0.273112 logs an anomaly");
});

t("§ 13.1: DeepSeek's 10× bound is 0.43288 — a cost just under it is recorded as reported (anomaly), just over it records the ceiling", async () => {
  const under = await call({ ...baseBody(), model: DEEPSEEK }, { chunks: withCost("gen-u10", 0.4328) });
  assertAlmostEquals(under.rows[0].usd, 0.4328, 1e-6);
  assert(under.logs.some((l) => /anomal/i.test(l)));
  const over = await call({ ...baseBody(), model: DEEPSEEK }, { chunks: withCost("gen-o10", 0.4329) });
  assertAlmostEquals(over.rows[0].usd, CEILING[DEEPSEEK], 1e-6);
});

// ------------------------------------------------------------------ (v) ledger model

t("§ 13.5 (v): the ledger row's model is the id the proxy SENT, even when the stream names a dated suffix", async () => {
  const r = await call({ ...baseBody(), model: DEEPSEEK }, { chunks: noCost("gen-suffix", "deepseek/deepseek-v4.1-flash-20260910") });
  assertEquals(r.rows[0].model, DEEPSEEK);
  const c = await call({ ...baseBody(), model: CLAUDE }, { chunks: noCost("gen-suffix-c", "anthropic/claude-4.5-sonnet-20260101") });
  assertEquals(c.rows[0].model, CLAUDE);
});

// ------------------------------------------------------------------ (vi) daily ceiling

t("§ 13.5 (vi): $4.99 of Claude rows plus $0.02 of DeepSeek rows -> 503, the same message (the $5/day ceiling sums every model)", async () => {
  const h = await harness();
  h.reset();
  const [a] = await member(h);
  const [, tok] = await member(h);
  const now = h.st.now();
  h.st.ledger.push({ id: crypto.randomUUID(), user_id: a, kind: "call", request_id: "c1", model: CLAUDE, tokens_in: 0, tokens_out: 0, tokens_cached: 0, usd: 4.99, finish_reason: null, created_at: now });
  h.st.ledger.push({ id: crypto.randomUUID(), user_id: a, kind: "call", request_id: "d1", model: DEEPSEEK, tokens_in: 0, tokens_out: 0, tokens_cached: 0, usd: 0.02, finish_reason: null, created_at: now });
  const res = await h.proxy(preq({ ...baseBody(), model: DEEPSEEK }, { token: tok }));
  const txt = await res.text();
  assertEquals(res.status, 503, txt);
  assert(txt.includes("The beta has reached today's limit. Try again tomorrow."), txt);
  assertEquals(h.upstreamHits.length, 0);
});

// ------------------------------------------------------------------ (x) agreement (proxy half)

t("§ 13.5 (x): the proxy's allowed ids are exactly apps/web's coach-model.ts ids", async () => {
  const core = await import("../../supabase/functions/ten-model-proxy/core.ts");
  const site = await import("../../apps/web/src/backend/coach-model.ts");
  const proxyIds = [...((core as any).MODEL_IDS ?? [])].sort();
  const siteIds = (site as any).COACH_MODELS.map((m: { id: string }) => m.id).sort();
  assertEquals(proxyIds, [CLAUDE, DEEPSEEK].sort());
  assertEquals(siteIds, proxyIds);
});
