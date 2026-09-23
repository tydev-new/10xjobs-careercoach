// Unit tests for the pure helpers in core.ts — no network, no mocks.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { CEILING_USD, MODEL, buildUpstreamBody, parseUsageFromSSE, pathTail, sanitizeUsageForLedger } from "./core.ts";

Deno.test("buildUpstreamBody: copies the allowlist and forces the rest", () => {
  const r = buildUpstreamBody({
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "x" } }],
    tool_choice: "auto",
    temperature: 0.7,
  });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.body.model, MODEL);
  assertEquals(r.body.stream, true);
  assertEquals(r.body.max_tokens, 4096);
  assertEquals(r.body.provider, { data_collection: "deny", zdr: true });
  assertEquals(r.body.cache_control, { type: "ephemeral" });
  assertEquals(r.body.temperature, 0.7);
  assertEquals(r.body.tool_choice, "auto");
});

Deno.test("buildUpstreamBody: max_tokens is capped at 4096, never raised", () => {
  const low = buildUpstreamBody({ max_tokens: 100 });
  assert(low.ok);
  if (low.ok) assertEquals(low.body.max_tokens, 100);

  const high = buildUpstreamBody({ max_tokens: 999999 });
  assert(high.ok);
  if (high.ok) assertEquals(high.body.max_tokens, 4096);
});

Deno.test("buildUpstreamBody: drops fields outside the allowlist", () => {
  const r = buildUpstreamBody({
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

Deno.test("buildUpstreamBody: model_not_allowed for any other model string", () => {
  const r = buildUpstreamBody({ model: "openai/gpt-4o" });
  assert(!r.ok);
  if (r.ok) return;
  assertEquals(r.status, 400);
  assertEquals(r.code, "model_not_allowed");
});

Deno.test("buildUpstreamBody: model_not_allowed for a suffixed variant of the allowed model", () => {
  const r = buildUpstreamBody({ model: `${MODEL}:online` });
  assert(!r.ok);
  if (r.ok) return;
  assertEquals(r.code, "model_not_allowed");
});

Deno.test("buildUpstreamBody: the exact allowed model string passes", () => {
  const r = buildUpstreamBody({ model: MODEL });
  assert(r.ok);
});

Deno.test("buildUpstreamBody: web plugin rewritten to fixed engine, results capped at 5", () => {
  const r = buildUpstreamBody({ plugins: [{ id: "web", max_results: 50 }] });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.body.plugins, [{ id: "web", engine: "exa", max_results: 5 }]);
});

Deno.test("buildUpstreamBody: web plugin with no max_results defaults to 5", () => {
  const r = buildUpstreamBody({ plugins: [{ id: "web" }] });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.body.plugins, [{ id: "web", engine: "exa", max_results: 5 }]);
});

Deno.test("buildUpstreamBody: web plugin honors a smaller client max_results", () => {
  const r = buildUpstreamBody({ plugins: [{ id: "web", max_results: 2 }] });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.body.plugins, [{ id: "web", engine: "exa", max_results: 2 }]);
});

Deno.test("buildUpstreamBody: a non-web plugin is dropped entirely", () => {
  const r = buildUpstreamBody({ plugins: [{ id: "some-other-plugin" }] });
  assert(r.ok);
  if (!r.ok) return;
  assert(!("plugins" in r.body));
});

Deno.test("buildUpstreamBody: no plugins in, no plugins out", () => {
  const r = buildUpstreamBody({});
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
