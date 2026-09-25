// Tester-owned: docs/design-web-agent.md § 14 (web search is billed per
// request, amendment 2026-09-24, b4332f9), test plan § 14.4 (v), plus the
// premise § 14 rests on. Written from the spec, not from core.ts.
//
// § 14's reading of OpenRouter's web-search docs: Exa's default mode, Auto,
// is $0.007 per request including up to 10 results. That price holds only
// while the proxy (a) forces the Exa engine (unset, Anthropic models get
// native search, priced differently), (b) never sets a mode, and (c) never
// asks for more than 10 results. The ceiling's search term is therefore one
// request, $0.007:
//   CEILING_USD = 64,000 × 2e-6 + 8,192 × 1e-5 + 0.007 = 0.21692 (§ 14.2).
// It is the meter's fallback charge and the 10× bound (§ 8 point 5), so the
// bound moves to 2.1692.
//
// When § 13 (approved 2026-09-24, not yet built) lands, Claude's ceiling
// becomes 0.273112 (§ 13.1, § 13.5 (iv)); the 0.21692 figures here are
// § 14.4 (v)'s single-model values and move with it.
//
// Every meter case runs the DEPLOYED entry (index.ts) through the harness.
//
// Run: deno test --allow-net=127.0.0.1 tests/functions/proxy_search_billing.test.ts
import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { CEILING_USD } from "../../supabase/functions/ten-model-proxy/core.ts";
import { baseBody, callRows, harness, member, preq, sse, t } from "./_harness.ts";

// § 14.2's arithmetic, term by term.
// § 13.1 (approved; § 13.6 (1)) moved Claude to the dearest no-data-kept host
// with the cache-write price; § 14's search term is unchanged.
const INPUT_TERM = 64_000 * 2.75e-6; // 0.176
const OUTPUT_TERM = 8_192 * 11e-6; // 0.090112
const SEARCH_TERM = 0.007; // one Exa Auto request, ≤ 10 results
const SPEC_CEILING = 0.273112;
const EXA_INCLUDED_RESULTS = 10;

async function meterWithUsage(usage: unknown, label: string) {
  const h = await harness();
  h.reset();
  const [uid, tok] = await member(h);
  const id = `gen-s14-${label}`;
  h.setUpstream(() =>
    sse([
      `data: ${JSON.stringify({ id, choices: [{ delta: { content: "x" }, finish_reason: "stop" }] })}`,
      ...(usage === undefined ? [] : [`data: ${JSON.stringify({ id, choices: [], usage })}`]),
      "data: [DONE]",
    ])
  );
  const res = await h.proxy(preq(baseBody(), { token: tok }));
  await res.text();
  await h.drain();
  const rows = callRows(h.st).filter((r) => r.user_id === uid);
  const anomalies = h.logs.filter((l) => /anomal/i.test(l));
  return { res, rows, anomalies };
}

// ------------------------------------------------------------ (v) the constant

t("§ 14.4 (v) as amended by § 13.1: Claude's CEILING_USD = 64,000 × 2.75e-6 + 8,192 × 11e-6 + 0.007 = 0.273112 (1e-9)", async () => {
  await Promise.resolve();
  assertAlmostEquals(INPUT_TERM + OUTPUT_TERM + SEARCH_TERM, SPEC_CEILING, 1e-12, "the spec's own arithmetic");
  assertAlmostEquals(CEILING_USD, SPEC_CEILING, 1e-9);
});

t("§ 13.1: Claude's ceiling rose from § 14's $0.21692 by exactly the price change (64,000 × $0.75/M + 8,192 × $1/M = $0.056192)", async () => {
  await Promise.resolve();
  assertAlmostEquals(CEILING_USD - 0.21692, 64_000 * 0.75e-6 + 8_192 * 1e-6, 1e-9);
});

// ------------------------------------------------------------ (v) the meter

t("§ 14.4 (v): a meter with no usage chunk at all records Claude's ceiling, 0.273112", async () => {
  const { res, rows } = await meterWithUsage(undefined, "nousage");
  assertEquals(res.status, 200);
  assertEquals(rows.length, 1);
  assertAlmostEquals(rows[0].usd, SPEC_CEILING, 1e-6);
});

t("§ 14.4 (v): a meter whose cost is unreadable (string / null / missing) records 0.273112", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["string", { prompt_tokens: 10, completion_tokens: 5, cost: "0.035" }],
    ["null", { prompt_tokens: 10, completion_tokens: 5, cost: null }],
    ["missing", { prompt_tokens: 10, completion_tokens: 5 }],
  ];
  const got: Record<string, number> = {};
  for (const [label, usage] of cases) {
    const { rows } = await meterWithUsage(usage, `unreadable-${label}`);
    assertEquals(rows.length, 1, label);
    got[label] = Math.round(rows[0].usd * 1e6) / 1e6;
  }
  assertEquals(got, { string: SPEC_CEILING, null: SPEC_CEILING, missing: SPEC_CEILING });
});

// ------------------------------------------------------------ the 10× bound, re-derived from 0.273112

t("§ 8: the 10× bound is 10 × 0.273112 = 2.73112 — a cost just under it (2.7311) is recorded as reported, with the anomaly log", async () => {
  const cost = 2.7311;
  const { rows, anomalies } = await meterWithUsage({ prompt_tokens: 10, completion_tokens: 5, cost }, "under-10x");
  assertEquals(rows.length, 1);
  assertAlmostEquals(rows[0].usd, cost, 1e-6);
  assert(anomalies.length >= 1, "a cost above the ceiling logs an anomaly line");
});

t("§ 8: a cost just over 10 × 0.273112 (2.7312) records the ceiling, not the reported cost", async () => {
  const { rows, anomalies } = await meterWithUsage({ prompt_tokens: 10, completion_tokens: 5, cost: 2.7312 }, "over-10x");
  assertEquals(rows.length, 1);
  assertAlmostEquals(rows[0].usd, SPEC_CEILING, 1e-6);
  assertEquals(anomalies, [], "a replaced cost is not an anomaly");
});

t("§ 13.1: a cost between § 14's ceiling and § 13's (0.25) is now within Claude's ceiling: recorded as reported, no anomaly", async () => {
  // 0.21692 < 0.25 < 0.273112: a regional host plus a cache write can cost this,
  // which is why § 13.6 (1) raised the ceiling.
  const { rows, anomalies } = await meterWithUsage({ prompt_tokens: 10, completion_tokens: 5, cost: 0.25 }, "between-ceilings");
  assertEquals(rows.length, 1);
  assertAlmostEquals(rows[0].usd, 0.25, 1e-6);
  assertEquals(anomalies, [], "0.25 < 0.273112 is within the ceiling");
});

t("§ 14 in the ledger: a Claude search call's cost (tokens + the $0.007 fee) is recorded as reported, no anomaly", async () => {
  // § 14's worked row: 1,850 in, 0 cached, 1,477 out, usd 0.026394 — tokens
  // at $2.50/M in and $10/M out leave the $0.007 fee. Below the ceiling.
  const tokens = 1850 * 2.5e-6 + 1477 * 1e-5;
  assertAlmostEquals(0.026394 - tokens, 0.007, 1e-5, "the spec's residual");
  const { rows, anomalies } = await meterWithUsage({ prompt_tokens: 1850, completion_tokens: 1477, cost: 0.026394 }, "search-row");
  assertEquals(rows.length, 1);
  assertAlmostEquals(rows[0].usd, 0.026394, 1e-9);
  assertEquals(anomalies, []);
});

// ------------------------------------------------------------ the premise of the $0.007 search term

t("§ 14 premise: whatever the client asks, the upstream web plugin is Exa, sets no mode, and asks ≤ 10 results", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const asks: Array<Record<string, unknown>> = [
    { id: "web" },
    { id: "web", mode: "deep-reasoning" },
    { id: "web", engine: "native", mode: "deep", max_results: 50 },
    { id: "web", engine: "parallel", mode: "advanced", max_results: 11 },
    { id: "web", engine: "exa", mode: "deep-lite", max_results: 10 },
  ];
  let n = 0;
  for (const plugin of asks) {
    h.upstreamHits.length = 0;
    const id = `gen-plugin-${n++}`;
    h.setUpstream(() => sse([`data: ${JSON.stringify({ id, choices: [], usage: { cost: 0.01 } })}`, "data: [DONE]"]));
    const res = await h.proxy(preq({ ...baseBody(), plugins: [plugin] }, { token: tok }));
    await res.text();
    await h.drain();
    const up = h.upstreamHits[0]?.body as Record<string, any> | undefined;
    assert(up, `forwarded: ${JSON.stringify(plugin)}`);
    const plugins = up.plugins as Array<Record<string, unknown>>;
    assertEquals(plugins.length, 1, JSON.stringify(plugins));
    const p = plugins[0];
    assertEquals(p.id, "web");
    assertEquals(p.engine, "exa", `engine for ${JSON.stringify(plugin)}: unset or native would bill the provider's native search, not Exa's $0.007`);
    assert(!("mode" in p), `no mode reaches upstream (Auto is the default, and the $0.007 one): ${JSON.stringify(p)}`);
    assert(
      typeof p.max_results === "number" && p.max_results >= 1 && p.max_results <= EXA_INCLUDED_RESULTS,
      `max_results ${p.max_results} must stay within the ${EXA_INCLUDED_RESULTS} results the $0.007 includes`,
    );
  }
});
