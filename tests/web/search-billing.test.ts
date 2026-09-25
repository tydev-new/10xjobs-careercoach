// Tester-owned: docs/design-web-agent.md § 14.4 (iv), the web-search seam
// (amendment 2026-09-24, b4332f9). Written from the spec:
//   "createWebSearch returns defaultUsd when the stream has no usage.cost,
//    and the real deps pass 0.047."
// § 14.1: the fallback is the highest measured search call, $0.047, "so a
// missing cost never undercounts"; a reported cost is used as reported.
//
// The real deps are exercised, not grepped: buildRealDeps() is loaded under
// Node with one module swapped — backend/skills-bundle.ts, whose Vite-only
// `import.meta.glob` cannot run outside a Vite build (that file says so) —
// and the global fetch stubbed BEFORE the deps are built (bound-fetch binds
// the global at construction). No request leaves the process.
//
// Run: node --test tests/web/search-billing.test.ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import { createWebSearch } from "../../apps/web/src/backend/web-search.ts";

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.endsWith("/backend/skills-bundle.ts")) {
    return { url: "data:text/javascript,export function buildSkillBundle(){return {}}", shortCircuit: true };
  }
  return next(specifier, context);
}`),
);

const SEARCH_MAX = 0.047;
const PROXY = "https://proxy.test/functions/v1/ten-model-proxy";

const sse = (...chunks: unknown[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
const citation = { choices: [{ delta: { annotations: [{ type: "url_citation", url_citation: { url: "https://example.com/a", title: "A", content: "a" } }] } }] };

function stubFetch(body: string) {
  const hits: Array<{ url: string; body: any }> = [];
  const fetchImpl = (async (url: any, init: any) => {
    hits.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  return { fetchImpl, hits };
}

// ------------------------------------------------------------ createWebSearch

test("§ 14.4 (iv): createWebSearch returns defaultUsd when the stream has no usage.cost", async () => {
  for (const [label, body] of [
    ["no usage chunk", sse(citation)],
    ["usage without cost", sse(citation, { choices: [], usage: { prompt_tokens: 3641, completion_tokens: 1811 } })],
  ] as const) {
    const { fetchImpl } = stubFetch(body);
    const ws = createWebSearch({ proxyUrl: PROXY, getAccessToken: async () => "jwt", fetchImpl, defaultUsd: SEARCH_MAX });
    const out = await ws({ query: "acme layoffs" });
    assert.equal(out.usd, SEARCH_MAX, label);
    assert.equal(out.results.length, 1, `${label}: the results still come back`);
  }
});

test("§ 14.4 (iv): createWebSearch returns the stream's usage.cost when there is one (never the default)", async () => {
  for (const cost of [0.0347, 0.0468, 0]) {
    const { fetchImpl } = stubFetch(sse(citation, { choices: [], usage: { cost } }));
    const ws = createWebSearch({ proxyUrl: PROXY, getAccessToken: async () => "jwt", fetchImpl, defaultUsd: SEARCH_MAX });
    assert.equal((await ws({ query: "acme" })).usd, cost);
  }
});

// ------------------------------------------------------------ the real deps

async function realDepsWebSearch(body: string) {
  const { fetchImpl, hits } = stubFetch(body);
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const { buildRealDeps } = await import("../../apps/web/src/real/deps.ts");
    const deps: any = buildRealDeps({
      env: { supabaseUrl: "http://127.0.0.1:9", supabaseAnonKey: "anon", modelProxyUrl: PROXY } as any,
      userId: "00000000-0000-0000-0000-000000000000",
      accessToken: async () => "jwt",
    });
    const out = await deps.webSearch({ query: "acme layoffs" });
    return { out, hits };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("§ 14.4 (iv): the real deps' webSearch falls back to 0.047 when the proxy's stream has no usage.cost", async () => {
  const { out, hits } = await realDepsWebSearch(sse(citation));
  assert.equal(hits.length, 1, "one proxy call");
  assert.equal(hits[0].url, `${PROXY}/chat/completions`);
  assert.equal(hits[0].body.plugins?.[0]?.id, "web");
  assert.equal(out.usd, SEARCH_MAX);
});

test("§ 14.4 (iv): the real deps' webSearch passes a reported usage.cost through unchanged", async () => {
  const { out } = await realDepsWebSearch(sse(citation, { choices: [], usage: { cost: 0.026394 } }));
  assert.equal(out.usd, 0.026394);
});
