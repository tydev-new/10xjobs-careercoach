import assert from "node:assert/strict";
import { test } from "node:test";
import { streamText } from "ai";
import { authedFetch, createCoachModel, NO_DATA_KEPT_PROVIDER_FILTER } from "./model.ts";
import { CLAUDE_COACH_MODEL, DEEPSEEK_COACH_MODEL } from "./coach-model.ts";
import { cannedResponse } from "./test-support/canned-sse.ts";

interface Captured {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function makeStubFetch(): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const headers: Record<string, string> = {};
    if (init?.headers) new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    calls.push({ url, method: init?.method, headers, body });
    return cannedResponse("hello from the proxy");
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test("createCoachModel: requests go to <proxyUrl>/chat/completions, not openrouter.ai directly", async () => {
  const { fetchImpl, calls } = makeStubFetch();
  const model = createCoachModel({
    modelId: CLAUDE_COACH_MODEL.id,
    proxyUrl: "https://proj.supabase.co/functions/v1/ten-model-proxy",
    getAccessToken: async () => "jwt-1",
    fetchImpl,
  });
  const result = streamText({ model, prompt: "hi" });
  await result.text;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://proj.supabase.co/functions/v1/ten-model-proxy/chat/completions");
});

test("createCoachModel: the Authorization header carries the CURRENT Supabase JWT, not an OpenRouter key", async () => {
  const { fetchImpl, calls } = makeStubFetch();
  let token = "jwt-first";
  const model = createCoachModel({
    modelId: CLAUDE_COACH_MODEL.id,
    proxyUrl: "https://proj.supabase.co/functions/v1/ten-model-proxy",
    getAccessToken: async () => token,
    fetchImpl,
  });
  await streamText({ model, prompt: "turn 1" }).text;
  assert.equal(calls[0].headers["authorization"], "Bearer jwt-first");

  // A refreshed token (getAccessToken re-read, not cached from turn 1) is
  // used on the very next call — § 8's "on each call".
  token = "jwt-refreshed";
  await streamText({ model, prompt: "turn 2" }).text;
  assert.equal(calls[1].headers["authorization"], "Bearer jwt-refreshed");
});

test("createCoachModel: the Claude model id and the no-data-kept provider filter are on the request body; no cache_control (§ 13.2 — the proxy sets its own)", async () => {
  const { fetchImpl, calls } = makeStubFetch();
  const model = createCoachModel({
    modelId: CLAUDE_COACH_MODEL.id,
    proxyUrl: "https://proj.supabase.co/functions/v1/ten-model-proxy",
    getAccessToken: async () => "jwt",
    fetchImpl,
  });
  await streamText({ model, prompt: "hi" }).text;
  const body = calls[0].body;
  assert.equal(body.model, CLAUDE_COACH_MODEL.id);
  assert.deepEqual(body.provider, NO_DATA_KEPT_PROVIDER_FILTER);
  assert.equal("cache_control" in body, false, "the client must not set cache_control itself");
  assert.equal(body.stream, true);
});

test("createCoachModel: the DeepSeek model id is sent exactly when that's the active model", async () => {
  const { fetchImpl, calls } = makeStubFetch();
  const model = createCoachModel({
    modelId: DEEPSEEK_COACH_MODEL.id,
    proxyUrl: "https://proj.supabase.co/functions/v1/ten-model-proxy",
    getAccessToken: async () => "jwt",
    fetchImpl,
  });
  await streamText({ model, prompt: "hi" }).text;
  assert.equal(calls[0].body.model, DEEPSEEK_COACH_MODEL.id);
  assert.equal("cache_control" in calls[0].body, false);
});

test("createCoachModel: a trailing slash on proxyUrl doesn't produce a double slash", async () => {
  const { fetchImpl, calls } = makeStubFetch();
  const model = createCoachModel({
    modelId: CLAUDE_COACH_MODEL.id,
    proxyUrl: "https://proj.supabase.co/functions/v1/ten-model-proxy/",
    getAccessToken: async () => "jwt",
    fetchImpl,
  });
  await streamText({ model, prompt: "hi" }).text;
  assert.equal(calls[0].url, "https://proj.supabase.co/functions/v1/ten-model-proxy/chat/completions");
});

test("authedFetch: overrides any Authorization header the caller already set", async () => {
  const { fetchImpl, calls } = makeStubFetch();
  const wrapped = authedFetch(async () => "jwt-fresh", fetchImpl);
  await wrapped("https://example.test/x", { headers: { Authorization: "Bearer stale-baked-in-key" } });
  assert.equal(calls[0].headers["authorization"], "Bearer jwt-fresh");
});
