// deno-lint-ignore-file no-explicit-any
// § 8 point 4 (the allowlist) and point 2 (413 over 256 KB). The outgoing body is
// captured at the stub upstream; it must contain ONLY messages/tools/tool_choice/
// temperature plus the forced model, max_tokens, stream, provider, cache_control
// and (if asked) the rewritten web plugin.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { baseBody, callRows, harness, member, MODEL, observe, preq, t } from "./_harness.ts";

const ALLOWED = new Set([
  "messages",
  "tools",
  "tool_choice",
  "temperature",
  "model",
  "max_tokens",
  "stream",
  "provider",
  "cache_control",
  "plugins",
]);

async function send(body: unknown, raw?: BodyInit, headers?: Record<string, string>) {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const res = await h.proxy(preq(body, { token: tok, raw, headers }));
  const txt = await res.text();
  await h.drain();
  return { h, res, txt, up: h.upstreamHits[0]?.body as Record<string, any> | undefined, hits: h.upstreamHits.length };
}

function assertForced(up: Record<string, any>) {
  assertEquals(up.model, MODEL);
  assertEquals(up.stream, true);
  assertEquals(up.provider, { data_collection: "deny", zdr: true });
  assertEquals(up.cache_control, { type: "ephemeral" });
  assert(typeof up.max_tokens === "number" && up.max_tokens <= 8192 && up.max_tokens >= 1, `max_tokens ${up.max_tokens}`);
  const extra = Object.keys(up).filter((k) => !ALLOWED.has(k));
  assertEquals(extra, [], "fields outside the allowlist reached upstream");
}

t("allowlist: a body stuffed with every smuggling field -> only the allowlist reaches upstream", async () => {
  const evil = {
    model: MODEL,
    models: ["openai/gpt-5-pro", "anthropic/claude-opus-5"],
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "f", parameters: { type: "object" } } }],
    tool_choice: "auto",
    temperature: 0.3,
    max_tokens: 100000,
    max_completion_tokens: 100000,
    reasoning: { effort: "high", max_tokens: 64000 },
    include_reasoning: true,
    stream: false,
    stream_options: { include_usage: false },
    provider: { order: ["Anthropic"], allow_fallbacks: true, data_collection: "allow", zdr: false, max_price: { prompt: 1000 } },
    transforms: ["middle-out"],
    route: "fallback",
    user: "someone-else",
    usage: { include: false },
    web_search_options: { search_context_size: "high" },
    plugins: [{ id: "web", engine: "native", max_results: 50, search_prompt: "x" }, { id: "file-parser", pdf: { engine: "mistral-ocr" } }, { id: "response-healing" }],
    preset: "@preset/expensive",
    seed: 1,
    n: 8,
    logprobs: true,
    top_logprobs: 20,
    logit_bias: { "1": 100 },
    response_format: { type: "json_object" },
    prediction: { type: "content", content: "x".repeat(100) },
    verbosity: "high",
    modalities: ["image", "text"],
    debug: { echo_upstream_body: true },
    cache_control: { type: "ephemeral", ttl: "1h" },
    extra_body: { models: ["x"] },
    nested: { a: { b: { models: ["x"] } } },
  };
  const { res, up, hits } = await send(evil);
  assertEquals(res.status, 200);
  assertEquals(hits, 1);
  assertForced(up!);
  assertEquals(up!.max_tokens, 8192);
  assertEquals(up!.plugins, [{ id: "web", engine: "exa", max_results: 5 }]);
  assertEquals(up!.messages, evil.messages);
  assertEquals(up!.tools, evil.tools);
  assertEquals(up!.tool_choice, "auto");
  assertEquals(up!.temperature, 0.3);
});

t("allowlist: model must be exactly anthropic/claude-sonnet-5 (suffixes, case, spaces, other models -> 400 model_not_allowed, not forwarded)", async () => {
  for (const m of [
    `${MODEL}:online`,
    `${MODEL}:nitro`,
    `${MODEL}:floor`,
    `${MODEL}:thinking`,
    "Anthropic/Claude-Sonnet-5",
    ` ${MODEL}`,
    `${MODEL} `,
    `${MODEL}​`,
    "openrouter/auto",
    "anthropic/claude-opus-5",
    "",
    ["anthropic/claude-sonnet-5"],
    { id: MODEL },
    null,
  ]) {
    const { res, txt, hits } = await send({ ...baseBody(), model: m });
    assertEquals(res.status, 400, `model=${JSON.stringify(m)} -> ${res.status} ${txt}`);
    assert(txt.includes("model_not_allowed"), `model=${JSON.stringify(m)}: ${txt}`);
    assertEquals(hits, 0, `model=${JSON.stringify(m)} reached upstream`);
  }
});

t("allowlist (§ 13.1): model omitted -> 400 model_not_allowed, never forwarded, no row (the proxy no longer fills one in)", async () => {
  const b: Record<string, unknown> = baseBody();
  delete b.model;
  const { res, txt, hits, h } = await send(b);
  assertEquals(res.status, 400, txt);
  assert(txt.includes("model_not_allowed") && txt.includes("This model is not allowed."), txt);
  assertEquals(hits, 0);
  assertEquals(callRows(h.st).length, 0);
});

t("allowlist: max_tokens = min(client, 8192); absent/garbage -> 8192; max_completion_tokens ignored", async () => {
  const cases: Array<[unknown, number]> = [
    [1, 1],
    [8192, 8192],
    [8193, 8192],
    [1e12, 8192],
    [Infinity, 8192], // JSON can't carry it; serialises as null
    ["100000", 8192],
    [null, 8192],
    [{ "$gt": 1 }, 8192],
  ];
  for (const [v, want] of cases) {
    const { up } = await send({ ...baseBody(), max_tokens: v, max_completion_tokens: 99999 });
    assertEquals(up!.max_tokens, want, `max_tokens=${JSON.stringify(v)}`);
    assertEquals("max_completion_tokens" in up!, false);
  }
  const b: Record<string, unknown> = baseBody();
  delete b.max_tokens;
  const { up } = await send({ ...b, max_completion_tokens: 50000 });
  assertEquals(up!.max_tokens, 8192);
});

t("allowlist: max_tokens is clamped to a positive integer ≤ 8192 (fractional, zero, negative)", async () => {
  const out: Record<string, unknown> = {};
  for (const v of [1.5, 0, -10, 8191.9, 0.2]) {
    const { up } = await send({ ...baseBody(), max_tokens: v });
    out[String(v)] = up!.max_tokens;
  }
  observe("max_tokens client->upstream", out);
  assertEquals(out, { "1.5": 1, "0": 1, "-10": 1, "8191.9": 8191, "0.2": 1 });
});

t("allowlist: plugins — only an id:'web' request yields exactly [{id:'web',engine:'exa',max_results:min(n,5)}]", async () => {
  const cases: Array<[unknown, unknown]> = [
    [[{ id: "web" }], [{ id: "web", engine: "exa", max_results: 5 }]],
    [[{ id: "web", max_results: 3 }], [{ id: "web", engine: "exa", max_results: 3 }]],
    [[{ id: "web", max_results: 500, engine: "native", include_domains: ["x"] }], [{ id: "web", engine: "exa", max_results: 5 }]],
    [[{ id: "web", max_results: "50" }], [{ id: "web", engine: "exa", max_results: 5 }]],
    [[{ id: "web" }, { id: "web", max_results: 5 }], [{ id: "web", engine: "exa", max_results: 5 }]],
    [[{ id: "file-parser" }], undefined],
    [[{ id: "response-healing" }, { id: "moderation" }], undefined],
    [{ id: "web" }, undefined],
    ["web", undefined],
    [[{ id: "WEB" }], undefined],
    [[{ id: ["web"] }], undefined],
  ];
  for (const [p, want] of cases) {
    const { up } = await send({ ...baseBody(), plugins: p });
    assertEquals(up!.plugins, want, `plugins=${JSON.stringify(p)}`);
  }
});

t("allowlist: web max_results is clamped to a positive integer ≤ 5 (0, negative, fractional)", async () => {
  const out: Record<string, unknown> = {};
  for (const n of [0, -3, 2.5, 4.99]) {
    const { up } = await send({ ...baseBody(), plugins: [{ id: "web", max_results: n }] });
    out[String(n)] = (up!.plugins as any)[0].max_results;
  }
  observe("web max_results client->upstream", out);
  assertEquals(out, { "0": 1, "-3": 1, "2.5": 2, "4.99": 4 });
});

t("allowlist: stream:false, provider overrides, route, transforms, user, usage, models are dropped/overridden", async () => {
  const { up } = await send({
    ...baseBody(),
    stream: false,
    provider: { data_collection: "allow", zdr: false, order: ["x"], only: ["x"], ignore: ["Anthropic"], sort: "price" },
    route: "fallback",
    transforms: ["middle-out"],
    user: "u",
    usage: { include: false },
    models: ["openai/gpt-5"],
  });
  assertForced(up!);
  for (const k of ["route", "transforms", "user", "usage", "models"]) assertEquals(k in up!, false, k);
});

t("allowlist: duplicate JSON keys cannot smuggle a second model", async () => {
  const raw1 = `{"model":"${MODEL}","model":"openai/gpt-5","messages":[{"role":"user","content":"x"}]}`;
  const a = await send(undefined, raw1);
  assertEquals(a.res.status, 400);
  assertEquals(a.hits, 0);
  const raw2 = `{"model":"openai/gpt-5","model":"${MODEL}","messages":[],"stream":false,"stream":true,"max_tokens":1,"max_tokens":99999}`;
  const b = await send(undefined, raw2);
  assertEquals(b.res.status, 200);
  assertForced(b.up!);
  assertEquals(b.up!.max_tokens, 8192);
  assert(!b.hits || !b.h.upstreamHits[0].bodyText.includes("gpt-5"), "raw upstream text must be re-serialised");
});

t("allowlist: __proto__ / constructor keys don't smuggle fields", async () => {
  // § 13.1: a request must name its model now, so the smuggling probe names Claude
  const raw = `{"model":"${MODEL}","__proto__":{"models":["x"],"reasoning":{"effort":"high"}},"constructor":{"prototype":{"route":"fallback"}},"messages":[]}`;
  const { res, up } = await send(undefined, raw);
  assertEquals(res.status, 200);
  assertForced(up!);
});

t("allowlist: non-JSON, JSON array/scalar bodies -> 400, never forwarded, no row", async () => {
  for (const raw of ["not json", "{", "[]", "[{\"messages\":[]}]", "42", "\"x\"", "null", "true"]) {
    const { res, hits, h } = await send(undefined, raw);
    assertEquals(res.status, 400, raw);
    assertEquals(hits, 0, raw);
    assertEquals(callRows(h.st).length, 0);
  }
});

t("allowlist: an EMPTY body -> 400, never forwarded", async () => {
  const { res, hits, h } = await send(undefined, "");
  assertEquals(res.status, 400);
  assertEquals(hits, 0);
  assertEquals(callRows(h.st).length, 0);
});

t("body: gzip Content-Encoding is not decompressed into a bypass (400, not forwarded)", async () => {
  const json = JSON.stringify({ ...baseBody(), models: ["x"] });
  const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const { res, hits } = await send(undefined, new Uint8Array(gz), { "content-encoding": "gzip" });
  assertEquals(res.status, 400);
  assertEquals(hits, 0);
});

t("body: a gzip bomb (small on the wire, >256 KB inflated) is not inflated", async () => {
  const json = JSON.stringify({ ...baseBody(), pad: "a".repeat(5 * 1024 * 1024) });
  const gz = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  assert(gz.length < 256 * 1024);
  const { res, hits } = await send(undefined, gz, { "content-encoding": "gzip" });
  assertEquals(res.status, 400);
  assertEquals(hits, 0);
});

// ---------------------------------------------------------------- size ----
function bodyOfBytes(n: number): string {
  const skeleton = JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "" }] });
  const pad = n - new TextEncoder().encode(skeleton).length;
  return JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "a".repeat(pad) }] });
}

t("size: exactly 256 KB forwards; 256 KB + 1 byte -> 413, never forwarded, no row", async () => {
  const ok = bodyOfBytes(256 * 1024);
  assertEquals(new TextEncoder().encode(ok).length, 256 * 1024);
  const a = await send(undefined, ok);
  assertEquals(a.res.status, 200);
  const big = bodyOfBytes(256 * 1024 + 1);
  const b = await send(undefined, big);
  assertEquals(b.res.status, 413);
  assertEquals(b.hits, 0);
  assertEquals(callRows(b.h.st).length, 0);
});

t("size: multibyte content counted in bytes, not chars (100k × 3-byte chars -> 413)", async () => {
  const raw = JSON.stringify({ messages: [{ role: "user", content: "€".repeat(100_000) }] });
  const { res, hits } = await send(undefined, raw);
  assertEquals(res.status, 413);
  assertEquals(hits, 0);
});

t("size: a chunked body (no Content-Length) over 256 KB -> 413 over real HTTP", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const srv = h.serveReal(h.proxy);
  try {
    const chunk = new TextEncoder().encode("a".repeat(64 * 1024));
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i === 0) c.enqueue(new TextEncoder().encode('{"messages":[{"role":"user","content":"'));
        if (i < 6) c.enqueue(chunk);
        else {
          c.enqueue(new TextEncoder().encode('"}]}'));
          c.close();
        }
        i++;
      },
    });
    const res = await fetch(`${srv.url}/ten-model-proxy/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: stream,
      // @ts-ignore deno
      duplex: "half",
    });
    await res.text();
    assertEquals(res.status, 413);
    assertEquals(h.upstreamHits.length, 0);
  } finally {
    await srv.stop();
  }
});

t("size: a lying Content-Length (declares 10 bytes, sends 300 KB) over raw TCP is not a bypass", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const srv = h.serveReal(h.proxy);
  try {
    const port = Number(new URL(srv.url).port);
    const conn = await Deno.connect({ hostname: "127.0.0.1", port });
    const body = bodyOfBytes(300 * 1024);
    const head =
      `POST /ten-model-proxy/chat/completions HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${tok}\r\n` +
      `Content-Type: application/json\r\nContent-Length: 10\r\nConnection: close\r\n\r\n`;
    await conn.write(new TextEncoder().encode(head + body));
    const buf = new Uint8Array(4096);
    const n = await conn.read(buf);
    const first = new TextDecoder().decode(buf.subarray(0, n ?? 0)).split("\r\n")[0];
    try {
      conn.close();
    } catch { /* closed */ }
    observe(`Content-Length:10 + 300KB actual -> ${first}; upstream hits ${h.upstreamHits.length}`);
    // Whatever the server did, nothing larger than 10 bytes can have been forwarded.
    for (const hit of h.upstreamHits) assert(hit.bodyText.length < 256 * 1024);
  } finally {
    await srv.stop();
  }
});

t("size: the 256 KB cap is enforced while streaming — a 64 MB body from a signed-in NON-member stops early", async () => {
  // Spec: "a body over 256 KB gets 413". Open sign-up means anyone can be signed in.
  // Measures whether the handler reads everything first (memory) rather than
  // stopping at 256 KB + 1.
  const h = await harness();
  h.reset();
  const uid = crypto.randomUUID();
  h.st.authUsers.add(uid);
  const { userJwt } = await import("./_harness.ts");
  const tok = await userJwt(uid);
  let pulled = 0;
  const total = 64 * 1024 * 1024;
  const chunk = new Uint8Array(16 * 1024).fill(97);
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulled >= total) return c.close();
      pulled += chunk.length;
      c.enqueue(chunk);
    },
  });
  const res = await h.proxy(preq(undefined, { token: tok, raw: stream }));
  await res.text();
  observe(`64 MB body -> ${res.status}; bytes pulled from the client before answering: ${pulled}`);
  assertEquals(res.status, 413);
  assert(pulled <= 256 * 1024 + 4 * chunk.length, `read ${pulled} bytes before refusing a >256 KB body`);
});

t("tools: only type:'function' tools are forwarded; server tools are dropped", async () => {
  // § 8 'Prevents': any client field reaching around the model, output, SEARCH
  // or path limits. `tools` is copied verbatim, so provider server-tools ride along.
  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 50 },
    { type: "openrouter:web_search", parameters: { max_results: 50 } },
    { type: "function", function: { name: "ok", parameters: { type: "object" } } },
  ];
  const { up } = await send({ ...baseBody(), tools });
  const types = (up!.tools as any[]).map((x) => x.type);
  observe("tool types forwarded upstream:", types);
  assertEquals(types, ["function"], "non-function tools reached upstream");
  for (const bad of [{ type: "web_search_20250305" }, "tools", 7, null]) {
    const r = await send({ ...baseBody(), tools: bad });
    const fwd = r.up!.tools as unknown[] | undefined;
    assert(fwd === undefined || (Array.isArray(fwd) && fwd.length === 0), `tools=${JSON.stringify(bad)} -> ${JSON.stringify(fwd)}`);
  }
  const mixed = await send({ ...baseBody(), tools: [{ type: "FUNCTION", function: {} }, { function: { name: "x" } }, [{ type: "function" }]] });
  assertEquals(mixed.up!.tools, [], "case variants, untyped and nested-array tools dropped");
});
