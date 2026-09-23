// Unit/integration tests for ten-model-proxy, run with `deno test`.
// Uses a local stub OpenRouter server and a local stub Supabase server
// (supabase/functions/_shared/test-support.ts) — no real network, no
// TEN_OPENROUTER_API_KEY, no live Supabase project. Covers the spike-4
// pass criteria (docs/design-web-agent.md § 8 and Step-1 spikes) that are
// checkable without a live upstream.

import { assert, assertAlmostEquals, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { CEILING_USD, MODEL } from "./core.ts";
import { handleRequest, type ProxyDeps } from "./handler.ts";
import {
  balanceFor,
  betaSpendToday,
  insertLedgerCall,
  isMember,
  verifyUser,
  type SupabaseEnv,
} from "../_shared/supabase.ts";
import {
  freshState,
  startMockOpenRouter,
  startMockSupabase,
  type MockOpenRouterOptions,
  type MockServer,
  type MockSupabaseState,
} from "../_shared/test-support.ts";

// Streaming + tee()'d bodies are read across two independent branches (the
// client's and the meter's), sometimes only partially before a test cancels
// one on purpose (simulating a client disconnect). Deno's default resource
// sanitizer flags that as a leak even though both branches are always
// explicitly cancelled/drained by the end of each test — so it's off here.
function dt(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeResources: false, sanitizeOps: false });
}

const PROD_ORIGIN = "https://ten.example.com";
const BASE_ENV = { TEN_APP_ORIGIN: PROD_ORIGIN } satisfies Record<string, string>;

function req(
  body: unknown,
  opts: { token?: string; origin?: string; method?: string; rawBody?: string; path?: string } = {},
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opts.token !== undefined) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.origin !== undefined) headers.set("origin", opts.origin);
  const path = opts.path ?? "/chat/completions";
  return new Request(`http://localhost${path}`, {
    method: opts.method ?? "POST",
    headers,
    body: opts.rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

interface Harness {
  supabase: MockServer;
  openrouter: MockServer;
  state: MockSupabaseState;
  orOptions: MockOpenRouterOptions;
  lastUpstreamBody: unknown;
  lastUpstreamHeaders: Headers | undefined;
  deps: ProxyDeps;
  metering: Promise<unknown>[];
  drain(): Promise<void>;
  stop(): Promise<void>;
}

async function harness(): Promise<Harness> {
  const state = freshState();
  const supabase = await startMockSupabase(state);
  const orOptions: MockOpenRouterOptions = { chunks: [] };
  let lastUpstreamBody: unknown;
  let lastUpstreamHeaders: Headers | undefined;
  const openrouter = await startMockOpenRouter(
    () => orOptions,
    (body, headers) => {
      lastUpstreamBody = body;
      lastUpstreamHeaders = headers;
    },
  );

  const env: SupabaseEnv = { url: supabase.url, anonKey: state.anonKey, serviceRoleKey: state.serviceRoleKey };
  const metering: Promise<unknown>[] = [];
  const deps: ProxyDeps = {
    verifyUser: (token) => verifyUser(env, token),
    isMember: (token) => isMember(env, token),
    balanceFor: (uid) => balanceFor(env, uid),
    betaSpendToday: () => betaSpendToday(env),
    insertLedgerCall: (row) => insertLedgerCall(env, row),
    fetchUpstream: (body) =>
      fetch(openrouter.url, {
        method: "POST",
        headers: { Authorization: "Bearer test-openrouter-key", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    waitUntil: (p) => {
      metering.push(p);
    },
    randomId: () => "generated-id",
    log: { warn: () => {} },
  };

  return {
    supabase,
    openrouter,
    state,
    orOptions,
    get lastUpstreamBody() {
      return lastUpstreamBody;
    },
    get lastUpstreamHeaders() {
      return lastUpstreamHeaders;
    },
    deps,
    metering,
    async drain() {
      await Promise.all(metering.splice(0, metering.length));
    },
    async stop() {
      await supabase.stop();
      await openrouter.stop();
    },
  } as Harness;
}

function sseChunks(opts: { id?: string; cost?: number; tokensIn?: number; tokensOut?: number }): string[] {
  const id = opts.id ?? "gen-123";
  return [
    `data: ${JSON.stringify({ id, choices: [{ delta: { content: "Hi" } }] })}`,
    `data: ${JSON.stringify({
      id,
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: {
        cost: opts.cost,
        prompt_tokens: opts.tokensIn ?? 10,
        completion_tokens: opts.tokensOut ?? 5,
      },
    })}`,
    "data: [DONE]",
  ];
}

dt("401 without a JWT", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(req({ messages: [] }, {}), h.deps, BASE_ENV);
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error.code, "not_signed_in");
  } finally {
    await h.stop();
  }
});

dt("401 when the bearer token is the anon key itself", async () => {
  const h = await harness();
  try {
    // The mock's /auth/v1/user only recognizes tokens registered in
    // state.users; the anon key was never registered as a user, exactly
    // like real Supabase Auth refusing it as a user access token.
    const res = await handleRequest(req({ messages: [] }, { token: h.state.anonKey }), h.deps, BASE_ENV);
    assertEquals(res.status, 401);
  } finally {
    await h.stop();
  }
});

dt("403 for a signed-in non-member", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    // Not added to h.state.members.
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.error.code, "not_a_member");
    assert(body.error.message.includes("private beta"));
  } finally {
    await h.stop();
  }
});

dt("402 over_balance at a zero balance", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 0;
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 402);
    const body = await res.json();
    assertEquals(body.error.code, "over_balance");
    assertEquals(body.error.message, "Your beta credit is used up. Ask the person who invited you for more.");
  } finally {
    await h.stop();
  }
});

dt("402 over_balance at a negative balance too", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = -0.5;
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 402);
  } finally {
    await h.stop();
  }
});

dt("503 model_error at the $5/day beta-wide ceiling, not over_balance", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.state.betaSpendToday = 5; // at the ceiling
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.error.code, "model_error");
    assertEquals(body.error.message, "The beta has reached today's limit. Try again tomorrow.");
  } finally {
    await h.stop();
  }
});

dt("503 ceiling fires above $5 too", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.state.betaSpendToday = 5.42;
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 503);
  } finally {
    await h.stop();
  }
});

dt("under the ceiling and with balance, the call proceeds", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.state.betaSpendToday = 4.99;
    h.orOptions.chunks = sseChunks({ cost: 0.02 });
    const res = await handleRequest(req({ messages: [{ role: "user", content: "hi" }] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    await res.body?.cancel();
    await h.drain();
  } finally {
    await h.stop();
  }
});

dt("413 over the 256 KB body cap", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    const big = "x".repeat(256 * 1024 + 1);
    const res = await handleRequest(
      req(undefined, { token: "tok-1", rawBody: JSON.stringify({ messages: [{ role: "user", content: big }] }) }),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 413);
  } finally {
    await h.stop();
  }
});

dt("the allowlist drops fields and forces the rest", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = sseChunks({ cost: 0.01 });
    const res = await handleRequest(
      req(
        {
          messages: [{ role: "user", content: "hi" }],
          tools: [{ type: "function", function: { name: "x" } }],
          tool_choice: "auto",
          temperature: 0.4,
          max_tokens: 100000,
          models: ["some/other-model"], // dropped
          max_completion_tokens: 999, // dropped
          reasoning: { effort: "high" }, // dropped
          web_search_options: { foo: true }, // dropped
          stream: false, // forced to true
          plugins: [{ id: "not-web" }], // dropped (not the web plugin)
        },
        { token: "tok-1" },
      ),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 200);
    await res.body?.cancel();
    await h.drain();

    const sent = h.lastUpstreamBody as Record<string, unknown>;
    assertEquals(sent.model, MODEL);
    assertEquals(sent.stream, true);
    assertEquals(sent.max_tokens, 4096); // capped from 100000
    assertEquals(sent.temperature, 0.4);
    assertEquals(sent.tool_choice, "auto");
    assert(Array.isArray(sent.tools));
    assertFalse("models" in sent);
    assertFalse("max_completion_tokens" in sent);
    assertFalse("reasoning" in sent);
    assertFalse("web_search_options" in sent);
    assertFalse("plugins" in sent); // "not-web" plugin dropped entirely
  } finally {
    await h.stop();
  }
});

dt("the forced provider filter and cache_control are set even when the client omits them", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = sseChunks({ cost: 0.01 });
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    await res.body?.cancel();
    await h.drain();
    const sent = h.lastUpstreamBody as Record<string, unknown>;
    assertEquals(sent.provider, { data_collection: "deny", zdr: true });
    assertEquals(sent.cache_control, { type: "ephemeral" });
  } finally {
    await h.stop();
  }
});

dt("a client-supplied provider field cannot override the forced filter", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = sseChunks({ cost: 0.01 });
    const res = await handleRequest(
      req({ messages: [], provider: { data_collection: "allow", zdr: false } }, { token: "tok-1" }),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 200);
    await res.body?.cancel();
    await h.drain();
    const sent = h.lastUpstreamBody as Record<string, unknown>;
    assertEquals(sent.provider, { data_collection: "deny", zdr: true });
  } finally {
    await h.stop();
  }
});

dt("web plugin is rewritten to the fixed engine and capped results", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = sseChunks({ cost: 0.01 });
    const res = await handleRequest(
      req({ messages: [], plugins: [{ id: "web", max_results: 50 }] }, { token: "tok-1" }),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 200);
    await res.body?.cancel();
    await h.drain();
    const sent = h.lastUpstreamBody as Record<string, unknown>;
    assertEquals(sent.plugins, [{ id: "web", engine: "exa", max_results: 5 }]);
  } finally {
    await h.stop();
  }
});

dt("S2: tools are forwarded only for type:'function'; server-tool types are dropped", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = sseChunks({ cost: 0.01 });
    const fnTool = { type: "function", function: { name: "ok", parameters: { type: "object" } } };
    const res = await handleRequest(
      req(
        {
          messages: [],
          tools: [
            { type: "web_search_20250305", name: "web_search", max_uses: 50 },
            { type: "openrouter:web_search", parameters: { max_results: 50 } },
            fnTool,
          ],
        },
        { token: "tok-1" },
      ),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 200);
    await res.body?.cancel();
    await h.drain();
    const sent = h.lastUpstreamBody as Record<string, unknown>;
    assertEquals(sent.tools, [fnTool]);
  } finally {
    await h.stop();
  }
});

dt("N4: max_tokens and web max_results are clamped to positive integers, never rejected", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = sseChunks({ cost: 0.01 });
    const res = await handleRequest(
      req(
        { messages: [], max_tokens: -10, plugins: [{ id: "web", max_results: -3 }] },
        { token: "tok-1" },
      ),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 200);
    await res.body?.cancel();
    await h.drain();
    const sent = h.lastUpstreamBody as Record<string, unknown>;
    assertEquals(sent.max_tokens, 1);
    assertEquals(sent.plugins, [{ id: "web", engine: "exa", max_results: 1 }]);
  } finally {
    await h.stop();
  }
});

dt("N5: an empty body is 400, not treated as {}", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    const res = await handleRequest(req(undefined, { token: "tok-1", rawBody: "" }), h.deps, BASE_ENV);
    assertEquals(res.status, 400);
    await h.drain();
    assertEquals(h.lastUpstreamBody, undefined, "an empty body must never reach upstream");
  } finally {
    await h.stop();
  }
});

dt("N1: a down ten_is_member fails closed with 503 model_error and CORS headers, never throws", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.deps.isMember = () => Promise.reject(new Error("ten_is_member: 503"));
    const res = await handleRequest(
      req({ messages: [] }, { token: "tok-1", origin: PROD_ORIGIN }),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 503);
    assertEquals(res.headers.get("access-control-allow-origin"), PROD_ORIGIN);
    const body = await res.json();
    assertEquals(body.error.code, "model_error");
  } finally {
    await h.stop();
  }
});

dt("N1: a down ten_balance_for fails closed with 503 model_error, never throws", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.deps.balanceFor = () => Promise.reject(new Error("ten_balance_for: 503"));
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 503);
  } finally {
    await h.stop();
  }
});

dt("N3: the ceiling is computed from § 8's own formula (64k in + 4,096 out + one search)", async () => {
  await Promise.resolve(); // pure check; dt() expects an async fn
  const formula = (64_000 * 2) / 1e6 + (4_096 * 10) / 1e6 + 5 * 0.004;
  assertAlmostEquals(CEILING_USD, formula, 1e-9);
  assert(CEILING_USD >= 0.18 && CEILING_USD < 0.2, `CEILING_USD ${CEILING_USD} should read "about $0.18"`);
});

dt("the model allowlist: a different model is 400 model_not_allowed", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    const res = await handleRequest(
      req({ messages: [], model: "openai/gpt-4o" }, { token: "tok-1" }),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error.code, "model_not_allowed");
  } finally {
    await h.stop();
  }
});

dt("the model allowlist: a suffixed model (':online') is refused too", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    const res = await handleRequest(
      req({ messages: [], model: `${MODEL}:online` }, { token: "tok-1" }),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error.code, "model_not_allowed");
  } finally {
    await h.stop();
  }
});

dt("the exact allowed model string in the body is accepted", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = sseChunks({ cost: 0.01 });
    const res = await handleRequest(req({ messages: [], model: MODEL }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    await res.body?.cancel();
    await h.drain();
  } finally {
    await h.stop();
  }
});

dt("404 on any other path", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    const res = await handleRequest(req({}, { token: "tok-1", path: "/embeddings" }), h.deps, BASE_ENV);
    assertEquals(res.status, 404);
  } finally {
    await h.stop();
  }
});

dt("404 on the deployed function-prefixed path variant too", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    const res = await handleRequest(
      req({}, { token: "tok-1", path: "/functions/v1/ten-model-proxy/embeddings" }),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 404);
  } finally {
    await h.stop();
  }
});

dt("the deployed function-prefixed chat/completions path is accepted", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = sseChunks({ cost: 0.01 });
    const res = await handleRequest(
      req({ messages: [] }, { token: "tok-1", path: "/functions/v1/ten-model-proxy/chat/completions" }),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 200);
    await res.body?.cancel();
    await h.drain();
  } finally {
    await h.stop();
  }
});

dt("CORS: an allowed origin gets the allow header on the real call and preflight", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = sseChunks({ cost: 0.01 });

    const preflight = await handleRequest(req(undefined, { method: "OPTIONS", origin: PROD_ORIGIN }), h.deps, BASE_ENV);
    assertEquals(preflight.status, 204);
    assertEquals(preflight.headers.get("access-control-allow-origin"), PROD_ORIGIN);

    const localPreflight = await handleRequest(
      req(undefined, { method: "OPTIONS", origin: "http://localhost:5173" }),
      h.deps,
      BASE_ENV,
    );
    assertEquals(localPreflight.headers.get("access-control-allow-origin"), "http://localhost:5173");

    const real = await handleRequest(req({ messages: [] }, { token: "tok-1", origin: PROD_ORIGIN }), h.deps, BASE_ENV);
    assertEquals(real.headers.get("access-control-allow-origin"), PROD_ORIGIN);
    await real.body?.cancel();
    await h.drain();
  } finally {
    await h.stop();
  }
});

dt("CORS: an unlisted origin's preflight gets no allow header", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(
      req(undefined, { method: "OPTIONS", origin: "https://evil.example.com" }),
      h.deps,
      BASE_ENV,
    );
    assertEquals(res.status, 204);
    assertFalse(res.headers.has("access-control-allow-origin"));
  } finally {
    await h.stop();
  }
});

dt("one ledger row per call, with the parsed usd cost", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = sseChunks({ id: "gen-abc", cost: 0.0234, tokensIn: 111, tokensOut: 22 });
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    await res.body?.cancel(); // client "reads" nothing more; meter branch is independent
    await h.drain();

    assertEquals(h.state.ledgerInserts.length, 1);
    const row = h.state.ledgerInserts[0];
    assertEquals(row.user_id, "u1");
    assertEquals(row.kind, "call");
    assertEquals(row.request_id, "gen-abc");
    assertEquals(row.model, MODEL);
    assertEquals(row.usd, 0.0234);
    assertEquals(row.tokens_in, 111);
    assertEquals(row.tokens_out, 22);
  } finally {
    await h.stop();
  }
});

dt("the metering ceiling is recorded when no cost can be read", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    // A usage object with no `cost` field at all (id still present).
    h.orOptions.chunks = [
      `data: ${JSON.stringify({ id: "gen-nocost", choices: [{ delta: { content: "hi" } }] })}`,
      `data: ${JSON.stringify({ id: "gen-nocost", usage: { prompt_tokens: 1, completion_tokens: 1 } })}`,
      "data: [DONE]",
    ];
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    await res.body?.cancel();
    await h.drain();

    assertEquals(h.state.ledgerInserts.length, 1);
    assertAlmostEquals(h.state.ledgerInserts[0].usd as number, CEILING_USD, 1e-9);
    assertEquals(h.state.ledgerInserts[0].request_id, "gen-nocost");
  } finally {
    await h.stop();
  }
});

dt("the metering ceiling is recorded when the stream carries no usage at all (a dropped connection)", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = [`data: ${JSON.stringify({ id: "gen-cutoff", choices: [{ delta: { content: "hi" } }] })}`];
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    await res.body?.cancel();
    await h.drain();

    assertEquals(h.state.ledgerInserts.length, 1);
    assertAlmostEquals(h.state.ledgerInserts[0].usd as number, CEILING_USD, 1e-9);
    assertEquals(h.state.ledgerInserts[0].request_id, "gen-cutoff");
  } finally {
    await h.stop();
  }
});

dt("a client disconnect still meters (the client stream is cancelled, not read)", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = sseChunks({ id: "gen-disc", cost: 0.05 });
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    // Simulate the client going away immediately, before reading any bytes.
    await res.body?.cancel();
    await h.drain();

    assertEquals(h.state.ledgerInserts.length, 1);
    assertEquals(h.state.ledgerInserts[0].usd, 0.05);
    assertEquals(h.state.ledgerInserts[0].request_id, "gen-disc");
  } finally {
    await h.stop();
  }
});

dt("a duplicate request_id at the ledger is retried once (S1), then logged as an alert, never thrown", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.state.ledgerRequestIds.add("gen-dup"); // pre-seed as already recorded
    h.orOptions.chunks = sseChunks({ id: "gen-dup", cost: 0.05 });
    const warnings: unknown[] = [];
    const inserts: unknown[] = [];
    const realInsert = h.deps.insertLedgerCall;
    h.deps.log = { warn: (e) => warnings.push(e) };
    h.deps.insertLedgerCall = (row) => {
      inserts.push(row);
      return realInsert(row);
    };

    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200); // the client response is unaffected by a metering failure
    await res.body?.cancel();
    await h.drain();

    assertEquals(h.state.ledgerInserts.length, 0); // the mock rejected the dup insert, both times
    assertEquals(inserts.length, 2, "exactly one retry (two attempts total)");
    assertEquals(warnings.length, 2, "a retry warning, then an alert (no log.error configured here)");
    assert(JSON.stringify(warnings[1]).includes("ALERT"), "the second failure is logged as an alert: " + JSON.stringify(warnings[1]));
  } finally {
    await h.stop();
  }
});

dt("S1: a ledger insert that fails once then succeeds on retry writes exactly one row, no alert", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = sseChunks({ id: "gen-flaky", cost: 0.02 });
    const warnings: unknown[] = [];
    h.deps.log = { warn: (e) => warnings.push(e) };
    let attempts = 0;
    const realInsert = h.deps.insertLedgerCall;
    h.deps.insertLedgerCall = (row) => {
      attempts++;
      if (attempts === 1) return Promise.reject(new Error("transient network blip"));
      return realInsert(row);
    };

    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    await res.body?.cancel();
    await h.drain();

    assertEquals(attempts, 2);
    assertEquals(h.state.ledgerInserts.length, 1);
    assertEquals(h.state.ledgerInserts[0].usd, 0.02);
    assert(warnings.some((w) => JSON.stringify(w).includes("retrying once")));
    assert(!warnings.some((w) => JSON.stringify(w).includes("ALERT")), "no alert once the retry succeeds");
  } finally {
    await h.stop();
  }
});

dt("upstream 402 (shared key exhausted) maps to 503 model_error, not over_balance", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.status = 402;
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.error.code, "model_error");
  } finally {
    await h.stop();
  }
});

dt("upstream 5xx maps to 503 model_error", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.status = 500;
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 503);
  } finally {
    await h.stop();
  }
});

dt("the OpenRouter key is sent upstream but never appears in the response body", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.balances["u1"] = 5;
    h.orOptions.chunks = sseChunks({ cost: 0.01 });
    const res = await handleRequest(req({ messages: [] }, { token: "tok-1" }), h.deps, BASE_ENV);
    const text = await res.text();
    assertFalse(text.includes("test-openrouter-key"));
    await h.drain();
    assertEquals(h.lastUpstreamHeaders?.get("authorization"), "Bearer test-openrouter-key");
  } finally {
    await h.stop();
  }
});
