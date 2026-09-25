import assert from "node:assert/strict";
import { test } from "node:test";
import { createWebSearch } from "./web-search.ts";
import { CLAUDE_COACH_MODEL, DEEPSEEK_COACH_MODEL } from "./coach-model.ts";

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("posts one call with plugins: [{ id: 'web' }] and the live JWT, and parses url_citation annotations", async () => {
  let seenBody: any;
  let seenAuth = "";
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    seenBody = JSON.parse(init!.body as string);
    seenAuth = new Headers(init!.headers).get("authorization") ?? "";
    const body =
      sse({
        choices: [
          {
            delta: {
              content: "Acme is hiring.",
              annotations: [
                { type: "url_citation", url_citation: { url: "https://acme.example/jobs/1", title: "Acme — Staff PM", content: "Acme is hiring a Staff PM." } },
              ],
            },
          },
        ],
      }) + sse({ choices: [{ delta: {} }], usage: { cost: 0.0031 } }) + "data: [DONE]\n\n";
    return sseResponse(body);
  }) as typeof fetch;

  const webSearch = createWebSearch({ modelId: CLAUDE_COACH_MODEL.id, proxyUrl: "https://proj.supabase.co/functions/v1/ten-model-proxy", getAccessToken: async () => "jwt-1", fetchImpl, defaultUsd: 0.047 });
  const out = await webSearch({ query: "Acme Staff PM", maxResults: 5 });

  assert.equal(seenAuth, "Bearer jwt-1");
  // § 13.2: "web search passes the model too."
  assert.equal(seenBody.model, CLAUDE_COACH_MODEL.id);
  assert.deepEqual(seenBody.plugins, [{ id: "web", max_results: 5 }]);
  assert.equal(seenBody.messages[0].content, "Acme Staff PM");
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].url, "https://acme.example/jobs/1");
  assert.equal(out.results[0].title, "Acme — Staff PM");
  assert.equal(out.results[0].excerpt, "Acme is hiring a Staff PM.");
  assert.equal(out.usd, 0.0031);
});

test("§ 13.2: the DeepSeek model id is sent exactly when that's the active model", async () => {
  let seenBody: any;
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    seenBody = JSON.parse(init!.body as string);
    return sseResponse(sse({ choices: [{ delta: {} }], usage: { cost: 0.0004 } }) + "data: [DONE]\n\n");
  }) as typeof fetch;
  const webSearch = createWebSearch({
    modelId: DEEPSEEK_COACH_MODEL.id,
    proxyUrl: "https://proj.supabase.co/functions/v1/ten-model-proxy",
    getAccessToken: async () => "jwt",
    fetchImpl,
    defaultUsd: 0.015,
  });
  await webSearch({ query: "q" });
  assert.equal(seenBody.model, DEEPSEEK_COACH_MODEL.id);
});

test("clamps maxResults to 5 both on the request and the returned results", async () => {
  const manyAnnotations = Array.from({ length: 8 }, (_, i) => ({
    type: "url_citation",
    url_citation: { url: `https://x.example/${i}`, title: `Result ${i}` },
  }));
  const fetchImpl = (async () => sseResponse(sse({ choices: [{ delta: { annotations: manyAnnotations } }] }) + "data: [DONE]\n\n")) as typeof fetch;
  const webSearch = createWebSearch({ modelId: CLAUDE_COACH_MODEL.id, proxyUrl: "https://proj.supabase.co/functions/v1/ten-model-proxy", getAccessToken: async () => "jwt", fetchImpl, defaultUsd: 0.047 });
  const out = await webSearch({ query: "q", maxResults: 20 });
  assert.equal(out.results.length, 5);
});

test("no usage.cost in the stream falls back to the injected default", async () => {
  const fetchImpl = (async () => sseResponse(sse({ choices: [{ delta: { content: "hi" } }] }) + "data: [DONE]\n\n")) as typeof fetch;
  const webSearch = createWebSearch({ modelId: CLAUDE_COACH_MODEL.id, proxyUrl: "https://proj.supabase.co/functions/v1/ten-model-proxy", getAccessToken: async () => "jwt", fetchImpl, defaultUsd: 0.047 });
  const out = await webSearch({ query: "q" });
  assert.equal(out.usd, 0.047);
  assert.deepEqual(out.results, []);
});

test("no annotations at all degrades to an empty result list, not a thrown error (fail soft — UNVERIFIED wire shape)", async () => {
  const fetchImpl = (async () => sseResponse("data: [DONE]\n\n")) as typeof fetch;
  const webSearch = createWebSearch({ modelId: CLAUDE_COACH_MODEL.id, proxyUrl: "https://proj.supabase.co/functions/v1/ten-model-proxy", getAccessToken: async () => "jwt", fetchImpl, defaultUsd: 0.047 });
  const out = await webSearch({ query: "q" });
  assert.deepEqual(out.results, []);
});

test("a non-2xx response is a thrown error (the tool wraps it as tool_error)", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ error: { code: "over_balance", message: "Your beta credit is used up." } }), { status: 402 })) as typeof fetch;
  const webSearch = createWebSearch({ modelId: CLAUDE_COACH_MODEL.id, proxyUrl: "https://proj.supabase.co/functions/v1/ten-model-proxy", getAccessToken: async () => "jwt", fetchImpl, defaultUsd: 0.047 });
  await assert.rejects(() => webSearch({ query: "q" }), /HTTP 402/);
});
