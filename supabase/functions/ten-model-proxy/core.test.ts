// Unit tests for the pure helpers in core.ts — no network, no mocks.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { MODEL, buildUpstreamBody, parseUsageFromSSE, pathTail } from "./core.ts";

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
