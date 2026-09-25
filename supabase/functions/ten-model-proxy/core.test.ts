// Unit tests for the pure helpers in core.ts — no network, no mocks.
// docs/design-web-agent.md § 8/§ 14 (single-model baseline) and § 13 (the
// two-model amendment: the allowlist, per-model ceiling, cache_control
// only for Claude, require_parameters only for DeepSeek, the ledger's
// model column, the golden Claude body).
import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import {
  CEILING_USD,
  CEILING_USD_BY_MODEL,
  CLAUDE_MODEL_ID,
  DEEPSEEK_MODEL_ID,
  MODEL,
  MODEL_IDS,
  buildUpstreamBody,
  ceilingUsdFor,
  parseUsageFromSSE,
  pathTail,
  sanitizeUsageForLedger,
} from "./core.ts";

Deno.test("buildUpstreamBody: copies the allowlist and forces the rest (Claude)", () => {
  const r = buildUpstreamBody({
    model: CLAUDE_MODEL_ID,
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "x" } }],
    tool_choice: "auto",
    temperature: 0.7,
  });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.body.model, CLAUDE_MODEL_ID);
  assertEquals(r.body.stream, true);
  assertEquals(r.body.max_tokens, 8192);
  assertEquals(r.body.provider, { data_collection: "deny", zdr: true });
  assertEquals(r.body.cache_control, { type: "ephemeral" });
  assertEquals(r.body.temperature, 0.7);
  assertEquals(r.body.tool_choice, "auto");
});

Deno.test("buildUpstreamBody: max_tokens is capped at 8192, never raised (§ 9.5, amended 2026-09-24) — both models", () => {
  for (const model of MODEL_IDS) {
    const low = buildUpstreamBody({ model, max_tokens: 100 });
    assert(low.ok);
    if (low.ok) assertEquals(low.body.max_tokens, 100, model);

    const high = buildUpstreamBody({ model, max_tokens: 999999 });
    assert(high.ok);
    if (high.ok) assertEquals(high.body.max_tokens, 8192, model);
  }
});

Deno.test("buildUpstreamBody: drops fields outside the allowlist", () => {
  const r = buildUpstreamBody({
    model: CLAUDE_MODEL_ID,
    models: ["a", "b"],
    max_completion_tokens: 10,
    reasoning: { effort: "high" },
    web_search_options: {},
    stream: false,
    random_field: 1,
  });
  assert(r.ok);
  if (!r.ok) return;
  for (const k of ["models", "max_completion_tokens", "reasoning", "web_search_options", "random_field"]) {
    assert(!(k in r.body), `expected ${k} to be dropped`);
  }
  assertEquals(r.body.stream, true); // forced, not the client's false
});

// -------------------------------------------------- § 13.1: the allowlist ----

Deno.test("buildUpstreamBody: model_not_allowed for any other model string", () => {
  const r = buildUpstreamBody({ model: "openai/gpt-4o" });
  assert(!r.ok);
  if (r.ok) return;
  assertEquals(r.status, 400);
  assertEquals(r.code, "model_not_allowed");
  assertEquals(r.message, "This model is not allowed.");
});

Deno.test("buildUpstreamBody: model_not_allowed for a suffixed variant of either allowed model", () => {
  for (const suffix of [":online", ":free", ":nitro"]) {
    for (const model of MODEL_IDS) {
      const r = buildUpstreamBody({ model: `${model}${suffix}` });
      assert(!r.ok, `${model}${suffix}`);
      if (r.ok) continue;
      assertEquals(r.code, "model_not_allowed", `${model}${suffix}`);
    }
  }
});

Deno.test("buildUpstreamBody: model_not_allowed for a missing model — § 13.1: 'the proxy no longer fills in a model'", () => {
  const r = buildUpstreamBody({ messages: [] });
  assert(!r.ok);
  if (r.ok) return;
  assertEquals(r.status, 400);
  assertEquals(r.code, "model_not_allowed");
});

Deno.test("buildUpstreamBody: model_not_allowed for null, a number, wrong case, other model ids", () => {
  for (const bad of [null, 5, "Anthropic/Claude-Sonnet-5", "deepseek/deepseek-v4-pro", "DeepSeek/deepseek-v4.1-flash", " " + CLAUDE_MODEL_ID, CLAUDE_MODEL_ID + " "]) {
    const r = buildUpstreamBody({ model: bad });
    assert(!r.ok, JSON.stringify(bad));
    if (r.ok) continue;
    assertEquals(r.code, "model_not_allowed", JSON.stringify(bad));
  }
});

Deno.test("buildUpstreamBody: the exact allowed model string passes, for each of the two ids", () => {
  for (const model of MODEL_IDS) {
    const r = buildUpstreamBody({ model });
    assert(r.ok, model);
    if (r.ok) assertEquals(r.body.model, model);
  }
});

Deno.test("buildUpstreamBody: a missing/invalid model never reaches upstream — no ok:true, no model field to send", () => {
  const r = buildUpstreamBody({ model: "not-a-real-model" });
  assertEquals(r.ok, false);
});

// -------------------------------------------------- § 13.1: cache_control / provider per model ----

Deno.test("buildUpstreamBody: Claude gets cache_control; DeepSeek does not", () => {
  const claude = buildUpstreamBody({ model: CLAUDE_MODEL_ID });
  assert(claude.ok);
  if (claude.ok) assertEquals(claude.body.cache_control, { type: "ephemeral" });

  const deepseek = buildUpstreamBody({ model: DEEPSEEK_MODEL_ID });
  assert(deepseek.ok);
  if (deepseek.ok) assert(!("cache_control" in deepseek.body), "DeepSeek must not get cache_control");
});

Deno.test("buildUpstreamBody: DeepSeek gets require_parameters: true; Claude does not", () => {
  const deepseek = buildUpstreamBody({ model: DEEPSEEK_MODEL_ID });
  assert(deepseek.ok);
  if (deepseek.ok) {
    assertEquals(deepseek.body.provider, { data_collection: "deny", zdr: true, require_parameters: true });
  }

  const claude = buildUpstreamBody({ model: CLAUDE_MODEL_ID });
  assert(claude.ok);
  if (claude.ok) {
    assertEquals(claude.body.provider, { data_collection: "deny", zdr: true });
    assert(!("require_parameters" in (claude.body.provider as object)), "Claude must not get require_parameters");
  }
});

Deno.test("buildUpstreamBody: a client-supplied cache_control/provider can never override the forced ones, for either model", () => {
  for (const model of MODEL_IDS) {
    const r = buildUpstreamBody({
      model,
      cache_control: { type: "ephemeral", ttl: "1h" },
      provider: { data_collection: "allow", zdr: false, require_parameters: false },
    });
    assert(r.ok, model);
    if (!r.ok) continue;
    if (model === CLAUDE_MODEL_ID) assertEquals(r.body.cache_control, { type: "ephemeral" });
    else assert(!("cache_control" in r.body));
    const wantProvider =
      model === DEEPSEEK_MODEL_ID
        ? { data_collection: "deny", zdr: true, require_parameters: true }
        : { data_collection: "deny", zdr: true };
    assertEquals(r.body.provider, wantProvider, model);
  }
});

// -------------------------------------------------- § 13.5 (ii): Claude's body is byte-identical ----

/** The golden body: exactly what the single-model (pre-§ 13) proxy sent
 * upstream for Claude, key order included — `messages` (verbatim), `tools`
 * (function-only), `tool_choice`, `temperature`, then the forced `model`,
 * `max_tokens`, `stream`, `provider`, `cache_control`. buildUpstreamBody's
 * insertion order for the Claude branch must never change, or this test
 * (comparing JSON.stringify output, so key order counts) fails. */
function goldenClaudeBody(): string {
  const messages = [{ role: "user", content: "hi" }];
  const tools = [{ type: "function", function: { name: "x", parameters: { type: "object" } } }];
  return JSON.stringify({
    messages,
    tools,
    tool_choice: "auto",
    temperature: 0.5,
    model: CLAUDE_MODEL_ID,
    max_tokens: 8192,
    stream: true,
    provider: { data_collection: "deny", zdr: true },
    cache_control: { type: "ephemeral" },
  });
}

Deno.test("§ 13.5 (ii): Claude's outgoing body is byte-identical to today's (golden body)", () => {
  const messages = [{ role: "user", content: "hi" }];
  const tools = [{ type: "function", function: { name: "x", parameters: { type: "object" } } }];
  const r = buildUpstreamBody({
    model: CLAUDE_MODEL_ID,
    messages,
    tools,
    tool_choice: "auto",
    temperature: 0.5,
  });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(JSON.stringify(r.body), goldenClaudeBody());
});

Deno.test("buildUpstreamBody: web plugin rewritten to fixed engine, results capped at 5 — both models", () => {
  for (const model of MODEL_IDS) {
    const r = buildUpstreamBody({ model, plugins: [{ id: "web", max_results: 50 }] });
    assert(r.ok, model);
    if (!r.ok) continue;
    assertEquals(r.body.plugins, [{ id: "web", engine: "exa", max_results: 5 }], model);
  }
});

Deno.test("buildUpstreamBody: web plugin with no max_results defaults to 5", () => {
  const r = buildUpstreamBody({ model: CLAUDE_MODEL_ID, plugins: [{ id: "web" }] });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.body.plugins, [{ id: "web", engine: "exa", max_results: 5 }]);
});

Deno.test("buildUpstreamBody: web plugin honors a smaller client max_results", () => {
  const r = buildUpstreamBody({ model: CLAUDE_MODEL_ID, plugins: [{ id: "web", max_results: 2 }] });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.body.plugins, [{ id: "web", engine: "exa", max_results: 2 }]);
});

Deno.test("buildUpstreamBody: a non-web plugin is dropped entirely", () => {
  const r = buildUpstreamBody({ model: CLAUDE_MODEL_ID, plugins: [{ id: "some-other-plugin" }] });
  assert(r.ok);
  if (!r.ok) return;
  assert(!("plugins" in r.body));
});

Deno.test("buildUpstreamBody: no plugins in, no plugins out", () => {
  const r = buildUpstreamBody({ model: CLAUDE_MODEL_ID });
  assert(r.ok);
  if (!r.ok) return;
  assert(!("plugins" in r.body));
});

Deno.test("buildUpstreamBody: rejects a non-object body", () => {
  for (const bad of [null, "x", 1, [], undefined]) {
    const r = buildUpstreamBody(bad);
    assert(!r.ok, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

Deno.test("pathTail: strips the function name prefix when present", () => {
  assertEquals(pathTail(new URL("http://x/functions/v1/ten-model-proxy/chat/completions")), "/chat/completions");
  assertEquals(pathTail(new URL("http://x/chat/completions")), "/chat/completions");
  assertEquals(pathTail(new URL("http://x/functions/v1/ten-model-proxy/embeddings")), "/embeddings");
  assertEquals(pathTail(new URL("http://x/embeddings")), "/embeddings");
});

Deno.test("parseUsageFromSSE: reads the last usage object and the shared id", () => {
  const text = [
    `data: ${JSON.stringify({ id: "gen-1", choices: [{ delta: { content: "hi" } }] })}`,
    `data: ${JSON.stringify({ id: "gen-1", usage: { cost: 0.0123, prompt_tokens: 10, completion_tokens: 3 } })}`,
    "data: [DONE]",
  ].join("\n");
  const parsed = parseUsageFromSSE(text);
  assertEquals(parsed?.id, "gen-1");
  assertEquals(parsed?.cost, 0.0123);
  assertEquals(parsed?.tokensIn, 10);
  assertEquals(parsed?.tokensOut, 3);
});

Deno.test("parseUsageFromSSE (round 2, item 5): only the final usage-bearing line counts, never merged across lines", () => {
  const text = [
    // An earlier, lower/different usage report...
    `data: ${JSON.stringify({ id: "gen-2", usage: { cost: 0.5, prompt_tokens: 1, completion_tokens: 1 } })}`,
    // ...superseded entirely by the truly final one. If fields were merged
    // rather than replaced, tokensCached (absent from the final line) would
    // leak in from here.
    `data: ${JSON.stringify({
      id: "gen-2",
      usage: { cost: 0.02, prompt_tokens: 200, completion_tokens: 50 },
    })}`,
    "data: [DONE]",
  ].join("\n");
  const parsed = parseUsageFromSSE(text);
  assertEquals(parsed?.cost, 0.02);
  assertEquals(parsed?.tokensIn, 200);
  assertEquals(parsed?.tokensOut, 50);
  assertEquals(parsed?.tokensCached, undefined);
});

Deno.test("parseUsageFromSSE: reads cached tokens from prompt_tokens_details", () => {
  const text = `data: ${JSON.stringify({
    id: "gen-2",
    usage: { cost: 0.01, prompt_tokens_details: { cached_tokens: 42 } },
  })}`;
  const parsed = parseUsageFromSSE(text);
  assertEquals(parsed?.tokensCached, 42);
});

Deno.test("parseUsageFromSSE: no usage anywhere in the stream returns null cost, but keeps the id", () => {
  const text = `data: ${JSON.stringify({ id: "gen-3", choices: [{ delta: { content: "hi" } }] })}`;
  const parsed = parseUsageFromSSE(text);
  assertEquals(parsed?.id, "gen-3");
  assertEquals(parsed?.cost, undefined);
});

Deno.test("parseUsageFromSSE: empty/garbage text returns null", () => {
  assertEquals(parseUsageFromSSE(""), null);
  assertEquals(parseUsageFromSSE("not sse at all"), null);
});

Deno.test("parseUsageFromSSE: a truncated final line is skipped, not thrown", () => {
  const text = [
    `data: ${JSON.stringify({ id: "gen-4", usage: { cost: 0.02 } })}`,
    `data: {"id": "gen-4", "usage": {"cost": 0.9`, // cut off mid-object
  ].join("\n");
  const parsed = parseUsageFromSSE(text);
  assertEquals(parsed?.id, "gen-4");
  assertEquals(parsed?.cost, 0.02); // the last *parseable* usage, not the truncated one
});

// --------------------------------------------------------- sanitizeUsageForLedger ----
// Round 2's contract amendment (docs/design-web-agent.md § 8): a finite cost
// from 0 to 10x the ceiling is recorded AS REPORTED (never undercounted); a
// cost above the ceiling is flagged via costAboveCeiling for the caller's
// anomaly log; only missing/non-finite/negative/>10x costs record the ceiling.
// § 13: the ceiling is now per model — sanitizeUsageForLedger's SECOND
// argument. The default (Claude's ceiling) keeps every pre-§ 13 call site
// (below, and tests/functions/*.test.ts) working unchanged.

Deno.test("sanitizeUsageForLedger: a normal in-range cost is recorded as reported, no anomaly", () => {
  const r = sanitizeUsageForLedger({ cost: 0.05, tokensIn: 10, tokensOut: 5, tokensCached: 0 });
  assertEquals(r.usd, 0.05);
  assertEquals(r.costAboveCeiling, false);
});

Deno.test("sanitizeUsageForLedger: a cost just above the ceiling is recorded as reported, flagged as an anomaly", () => {
  const cost = CEILING_USD + 0.5;
  const r = sanitizeUsageForLedger({ cost });
  assertEquals(r.usd, cost, "must not be undercounted to the ceiling");
  assertEquals(r.costAboveCeiling, true);
});

Deno.test("sanitizeUsageForLedger: exactly the ceiling is not flagged as an anomaly", () => {
  const r = sanitizeUsageForLedger({ cost: CEILING_USD });
  assertEquals(r.usd, CEILING_USD);
  assertEquals(r.costAboveCeiling, false);
});

Deno.test("sanitizeUsageForLedger: exactly 10x the ceiling is recorded as reported, flagged", () => {
  const cost = CEILING_USD * 10;
  const r = sanitizeUsageForLedger({ cost });
  assertEquals(r.usd, cost);
  assertEquals(r.costAboveCeiling, true);
});

Deno.test("sanitizeUsageForLedger: beyond 10x the ceiling records the ceiling instead, no anomaly flag", () => {
  const r = sanitizeUsageForLedger({ cost: CEILING_USD * 10 + 0.0001 });
  assertEquals(r.usd, CEILING_USD);
  assertEquals(r.costAboveCeiling, false, "replaced by the ceiling, so it's not a reported-anomaly");
});

Deno.test("sanitizeUsageForLedger: negative, non-finite, or non-numeric cost records the ceiling, no anomaly flag", () => {
  for (const cost of [-0.01, NaN, Infinity, -Infinity, "0.5" as unknown as number, null as unknown as number, undefined]) {
    const r = sanitizeUsageForLedger({ cost });
    assertEquals(r.usd, CEILING_USD, `cost=${String(cost)}`);
    assertEquals(r.costAboveCeiling, false, `cost=${String(cost)}`);
  }
});

Deno.test("sanitizeUsageForLedger: a null parsed usage records the ceiling", () => {
  const r = sanitizeUsageForLedger(null);
  assertEquals(r.usd, CEILING_USD);
  assertEquals(r.costAboveCeiling, false);
  assertEquals([r.tokensIn, r.tokensOut, r.tokensCached], [0, 0, 0]);
});

Deno.test("sanitizeUsageForLedger: token sanitizing is independent of the cost outcome", () => {
  const r = sanitizeUsageForLedger({ cost: CEILING_USD * 20, tokensIn: -5, tokensOut: 3.5, tokensCached: 2 });
  assertEquals(r.usd, CEILING_USD);
  assertEquals([r.tokensIn, r.tokensOut, r.tokensCached], [0, 0, 2]);
});

// -------------------------------------------------- § 13.5 (iv): per-model ceiling ----

Deno.test("§ 13.1: CEILING_USD_BY_MODEL is $0.273112 (Claude) and $0.043288 (DeepSeek), 1e-9", () => {
  assertAlmostEquals(CEILING_USD_BY_MODEL[CLAUDE_MODEL_ID], 0.273112, 1e-9);
  assertAlmostEquals(CEILING_USD_BY_MODEL[DEEPSEEK_MODEL_ID], 0.043288, 1e-9);
});

Deno.test("§ 13.1: the formula per model — 64,000 × input$/M + 8,192 × output$/M + $0.007", () => {
  const claude = (64_000 * 2.75) / 1e6 + (8_192 * 11.0) / 1e6 + 0.007;
  const deepseek = (64_000 * 0.375) / 1e6 + (8_192 * 1.5) / 1e6 + 0.007;
  assertAlmostEquals(CEILING_USD_BY_MODEL[CLAUDE_MODEL_ID], claude, 1e-12);
  assertAlmostEquals(CEILING_USD_BY_MODEL[DEEPSEEK_MODEL_ID], deepseek, 1e-12);
});

Deno.test("ceilingUsdFor: returns each model's own ceiling; an unrecognized/missing id falls back to Claude's (never undercounts)", () => {
  assertAlmostEquals(ceilingUsdFor(CLAUDE_MODEL_ID), CEILING_USD_BY_MODEL[CLAUDE_MODEL_ID], 1e-12);
  assertAlmostEquals(ceilingUsdFor(DEEPSEEK_MODEL_ID), CEILING_USD_BY_MODEL[DEEPSEEK_MODEL_ID], 1e-12);
  assertAlmostEquals(ceilingUsdFor("openai/gpt-4o"), CEILING_USD_BY_MODEL[CLAUDE_MODEL_ID], 1e-12);
  assertAlmostEquals(ceilingUsdFor(undefined), CEILING_USD_BY_MODEL[CLAUDE_MODEL_ID], 1e-12);
});

Deno.test("§ 13: CEILING_USD (the pre-§ 13 single-model export) equals Claude's raised ceiling, not the old § 14 figure", () => {
  assertAlmostEquals(CEILING_USD, 0.273112, 1e-9);
  assertAlmostEquals(CEILING_USD, CEILING_USD_BY_MODEL[CLAUDE_MODEL_ID], 1e-12);
  assert(CEILING_USD !== 0.21692);
});

Deno.test("sanitizeUsageForLedger: a per-model ceiling (DeepSeek) is honored when passed explicitly", () => {
  const deepseekCeiling = CEILING_USD_BY_MODEL[DEEPSEEK_MODEL_ID];
  const r = sanitizeUsageForLedger({ cost: 0.6 }, deepseekCeiling);
  // 0.6 is well beyond 10x DeepSeek's ceiling (~0.43), so it's replaced —
  // exactly § 13.5 (iv)'s "a DeepSeek cost of $0.60 is recorded as
  // $0.043288" case.
  assertAlmostEquals(r.usd, deepseekCeiling, 1e-9);
  assertEquals(r.costAboveCeiling, false);

  const inRange = sanitizeUsageForLedger({ cost: 0.02 }, deepseekCeiling);
  assertAlmostEquals(inRange.usd, 0.02, 1e-9);
});

Deno.test("§ 13.5 (iv): a DeepSeek call with no usage.cost records DeepSeek's ceiling, not Claude's", () => {
  const r = sanitizeUsageForLedger(null, ceilingUsdFor(DEEPSEEK_MODEL_ID));
  assertAlmostEquals(r.usd, CEILING_USD_BY_MODEL[DEEPSEEK_MODEL_ID], 1e-9);
});

Deno.test("§ 13.5 (iv): a Claude $0.60 reported cost is recorded as reported (within 10x its ceiling), with the anomaly flag", () => {
  const claudeCeiling = CEILING_USD_BY_MODEL[CLAUDE_MODEL_ID];
  const r = sanitizeUsageForLedger({ cost: 0.6 }, claudeCeiling);
  assertAlmostEquals(r.usd, 0.6, 1e-9);
  assertEquals(r.costAboveCeiling, true);
});

// -------------------------------------------------- § 9.6: finish_reason parsing ----

Deno.test("§ 9.6: parseUsageFromSSE reads finish_reason off a content chunk, kept through a trailing usage chunk with empty choices", () => {
  const text = [
    `data: ${JSON.stringify({ id: "gen-5", choices: [{ delta: { content: "hi" }, finish_reason: "length" }] })}`,
    // the usage chunk that so often follows has NO choices at all.
    `data: ${JSON.stringify({ id: "gen-5", usage: { cost: 0.01 } })}`,
    "data: [DONE]",
  ].join("\n");
  const parsed = parseUsageFromSSE(text);
  assertEquals(parsed?.finishReason, "length");
});

Deno.test("§ 9.6: parseUsageFromSSE keeps the LAST non-null finish_reason — a later null/empty choices entry never blanks an earlier real one", () => {
  const text = [
    `data: ${JSON.stringify({ id: "gen-6", choices: [{ delta: {}, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ id: "gen-6", choices: [{ delta: {}, finish_reason: "stop" }] })}`,
    `data: ${JSON.stringify({ id: "gen-6", choices: [] })}`,
    `data: ${JSON.stringify({ id: "gen-6", usage: { cost: 0.01 } })}`,
  ].join("\n");
  const parsed = parseUsageFromSSE(text);
  assertEquals(parsed?.finishReason, "stop");
});

Deno.test("§ 9.6: parseUsageFromSSE with no finish_reason anywhere leaves it undefined", () => {
  const text = `data: ${JSON.stringify({ id: "gen-7", usage: { cost: 0.01 } })}`;
  const parsed = parseUsageFromSSE(text);
  assertEquals(parsed?.finishReason, undefined);
});

Deno.test("§ 9.6: parseUsageFromSSE stops at whatever finish_reason it last saw before a mid-line cut-off", () => {
  const text = [
    `data: ${JSON.stringify({ id: "gen-8", choices: [{ delta: {}, finish_reason: "length" }] })}`,
    `data: {"id": "gen-8", "choices": [{"finish_reason"`, // cut off mid-object
  ].join("\n");
  const parsed = parseUsageFromSSE(text);
  assertEquals(parsed?.finishReason, "length");
});

// -------------------------------------------------- § 9.6: finish_reason sanitizing ----

Deno.test("§ 9.6: sanitizeUsageForLedger keeps a 1–32 char finish_reason string", () => {
  assertEquals(sanitizeUsageForLedger({ finishReason: "length" }).finishReason, "length");
  assertEquals(sanitizeUsageForLedger({ finishReason: "s" }).finishReason, "s");
  assertEquals(sanitizeUsageForLedger({ finishReason: "x".repeat(32) }).finishReason, "x".repeat(32));
});

Deno.test("§ 9.6: sanitizeUsageForLedger: none, a number, empty string, or 33 chars -> null", () => {
  assertEquals(sanitizeUsageForLedger(null).finishReason, null);
  assertEquals(sanitizeUsageForLedger({}).finishReason, null);
  assertEquals(sanitizeUsageForLedger({ finishReason: 42 as unknown as string }).finishReason, null);
  assertEquals(sanitizeUsageForLedger({ finishReason: "" }).finishReason, null);
  assertEquals(sanitizeUsageForLedger({ finishReason: "x".repeat(33) }).finishReason, null);
});

Deno.test("§ 9.6: sanitizeUsageForLedger never blocks the insert — finishReason sanitizing is independent of cost/token sanitizing", () => {
  const r = sanitizeUsageForLedger({ cost: -1, tokensIn: -5, finishReason: "stop" });
  assertEquals(r.usd, CEILING_USD, "cost still sanitized independently");
  assertEquals(r.finishReason, "stop", "a valid finish_reason survives a garbled cost");
});

// -------------------------------------------------- MODEL / MODEL_IDS sanity ----

Deno.test("MODEL is Claude's id, MODEL_IDS holds exactly the two § 13 ids in order", () => {
  assertEquals(MODEL, CLAUDE_MODEL_ID);
  assertEquals(MODEL_IDS, [CLAUDE_MODEL_ID, DEEPSEEK_MODEL_ID]);
  assertEquals(CLAUDE_MODEL_ID, "anthropic/claude-sonnet-5");
  assertEquals(DEEPSEEK_MODEL_ID, "deepseek/deepseek-v4.1-flash");
});
