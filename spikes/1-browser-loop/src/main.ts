// Spike 1 — the Vercel AI SDK + @openrouter/ai-sdk-provider running IN THE
// BROWSER (bundled by Vite, executed as a page script, no Node APIs).
//
// Rework 2026-09-22 after docs/reviews/step1-review.md B11: the plan's own
// criterion (docs/plan-portable-skills-and-web-agent.md:83-85) is "it
// STREAMS, calls tools in a loop, and a CACHE READ shows up on turn 2".
// This file now proves streaming (B) and an actually-issued HTTP request
// (D) in addition to the original mock tool-loop (A) and provider
// construction (C) checks, and reads all keys at RUNTIME (E) — see
// src/runtime-key.ts.
import {
  generateText,
  streamText,
  tool,
  jsonSchema,
  stepCountIs,
  simulateReadableStream,
  toUIMessageStream,
  createUIMessageStream,
  readUIMessageStream,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getRuntimeInterceptKey, getRuntimeRealKey } from "./runtime-key";
import { cannedResponse } from "./canned-sse";

// Real skill prose (no personal/candidate data — these are repo source
// files) loaded at BUILD time via Vite's `?raw` import, concatenated into
// a realistic ~4,000-5,000 token system prompt for the live cache test
// (item 1 of the 2026-09-23 rework). Sized against Anthropic's ~1,024-token
// minimum for a cacheable block — the earlier live run's whole prompt was
// only ~989 tokens, under that floor, which is one of the two reasons the
// first attempt showed no cache read (see docs/spikes/spike-1-browser-loop.md
// "Live cache rework").
import coachSkillMd from "../../../skills/coach/SKILL.md?raw";
import workspaceClaudeMd from "../../../skills/profile/templates/workspace-CLAUDE.md?raw";
import gateGrammarMd from "../../../skills/coach/references/gate-grammar.md?raw";
import evalMd from "../../../skills/coach/references/eval.md?raw";

// MVP default model (plan decision #3: "Models through OpenRouter, default
// a Claude model"). Verified 2026-09-22 via openrouter.ai/anthropic/claude-sonnet-5
// ("The exact model slug/id string is `anthropic/claude-sonnet-5`") — see
// docs/spikes/spike-1-browser-loop.md for the second corroborating fetch.
const MODEL_ID = "anthropic/claude-sonnet-5";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
function write(id: string, text: string) {
  $(id).textContent = text;
}

// Real skill text — coach's own SKILL.md, its gate-grammar and eval
// references, and the workspace CLAUDE.md template the web app writes at
// sign-up (design-web-agent.md § 7). All four are genuine repo prose, not
// a synthetic filler string, and none of it is candidate data.
const SYSTEM_PROMPT = [
  "# skills/coach/SKILL.md\n\n" + coachSkillMd,
  "# skills/coach/references/gate-grammar.md\n\n" + gateGrammarMd,
  "# skills/coach/references/eval.md\n\n" + evalMd,
  "# skills/profile/templates/workspace-CLAUDE.md\n\n" + workspaceClaudeMd,
].join("\n\n---\n\n");

// No tokenizer bundled for this spike — chars/4 is a standard rough
// estimate for English prose and is only used to size the prompt against
// Anthropic's ~1,024-token cache minimum before spending a live call.
const ESTIMATED_TOKENS = Math.round(SYSTEM_PROMPT.length / 4);

// Zero-cost sanity check (no network): confirms the system prompt actually
// loaded and is sized in the target range BEFORE any live call is made.
function runSystemPromptSizeCheck() {
  const inRange = ESTIMATED_TOKENS >= 3500 && ESTIMATED_TOKENS <= 6000;
  write(
    "result-prompt-size",
    `${inRange ? "PASS" : "FAIL"} chars=${SYSTEM_PROMPT.length} estimatedTokens=${ESTIMATED_TOKENS} (target ~4000-5000, chars/4 estimate)`
  );
  return inRange;
}

// ---------------------------------------------------------------------
// A. A multi-step tool loop against the AI SDK's mock/test language
//    model (generateText), entirely in the page, with a step-cap stop
//    condition.
// ---------------------------------------------------------------------
async function runMockLoop() {
  const calls: string[] = [];

  const lookupOrder = tool({
    description: "Look up an order by id",
    inputSchema: jsonSchema<{ orderId: string }>({
      type: "object",
      properties: { orderId: { type: "string" } },
      required: ["orderId"],
    }),
    execute: async ({ orderId }) => {
      calls.push(`lookupOrder(${orderId})`);
      return { orderId, status: "shipped", eta: "2026-09-25" };
    },
  });

  const notifyCustomer = tool({
    description: "Notify the customer of the order status",
    inputSchema: jsonSchema<{ message: string }>({
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    }),
    execute: async ({ message }) => {
      calls.push(`notifyCustomer(${message})`);
      return { sent: true };
    },
  });

  // NOTE (spike finding): in ai@7.0.111, LanguageModelV4's finishReason is
  // an object `{ unified, raw }`, not the bare string it was pre-v7 — a
  // plain "tool-calls" string is silently treated as falsy/unrecognized
  // and the loop stops after step 1 with the tool never executed. See
  // docs/spikes/spike-1-browser-loop.md "Surprises".
  const model = new MockLanguageModelV4({
    doGenerate: [
      {
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        content: [
          { type: "tool-call", toolCallId: "call-1", toolName: "lookupOrder", input: JSON.stringify({ orderId: "A100" }) },
        ],
        warnings: [],
      },
      {
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
        usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 },
        content: [
          {
            type: "tool-call",
            toolCallId: "call-2",
            toolName: "notifyCustomer",
            input: JSON.stringify({ message: "Your order A100 shipped, ETA 2026-09-25" }),
          },
        ],
        warnings: [],
      },
      {
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
        content: [{ type: "text", text: "Done — order A100 is shipped and the customer was notified." }],
        warnings: [],
      },
    ],
  });

  const result = await generateText({
    model,
    prompt: "Look up order A100 and notify the customer of its status.",
    tools: { lookupOrder, notifyCustomer },
    stopWhen: stepCountIs(5),
  });

  const summary = { steps: result.steps.length, toolCallsExecuted: calls, finalText: result.text };
  write("result-mock", "PASS " + JSON.stringify(summary));
  return summary.steps === 3 && calls.length === 2 && summary.finalText.includes("Done");
}

// ---------------------------------------------------------------------
// B. STREAMING (rework item 1): streamText against a STREAMING mock
//    model built with ai/test's MockLanguageModelV4.doStream +
//    simulateReadableStream (the "stream simulation helper for tests"
//    the ai v7 docs name), and assert the chunks arrived IN ORDER.
// ---------------------------------------------------------------------
async function runStreamingLoop() {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Order A100 " },
          { type: "text-delta", id: "t1", delta: "is shipped, " },
          { type: "text-delta", id: "t1", delta: "ETA 2026-09-25." },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: 9, outputTokens: 7, totalTokens: 16 } },
        ],
      }),
    }),
  });

  const result = streamText({ model, prompt: "status of order A100" });
  const order: string[] = [];
  for await (const part of result.fullStream) {
    order.push(part.type === "text-delta" ? `text-delta:${(part as any).text}` : part.type);
  }
  const finalText = await result.text;

  // in-order assertion: every text-delta must appear before "finish", and
  // "finish" must be the LAST part — the DOM carries the exact sequence so
  // Playwright verifies it out-of-process, not just this in-page check.
  const finishIdx = order.indexOf("finish");
  const deltaIdxs = order.reduce<number[]>((acc, t, i) => (t.startsWith("text-delta:") ? [...acc, i] : acc), []);
  const inOrder = finishIdx === order.length - 1 && deltaIdxs.every((i) => i < finishIdx) && deltaIdxs.every((i, k) => k === 0 || i > deltaIdxs[k - 1]);

  write("result-stream", "PASS " + JSON.stringify({ order, finalText }));
  return inOrder && finalText === "Order A100 is shipped, ETA 2026-09-25.";
}

// ---------------------------------------------------------------------
// C. The OpenRouter provider constructs a model object in the browser
//    bundle, no Node-only APIs, no key call yet.
// ---------------------------------------------------------------------
function runProviderConstruction() {
  try {
    const openrouter = createOpenRouter({ apiKey: "sk-or-v1-DUMMY-NOT-REAL" });
    const model = openrouter.chat(MODEL_ID);
    const ok = typeof model === "object" && model !== null && "modelId" in model;
    write("result-provider", `PASS provider+model constructed, modelId=${(model as any).modelId}`);
    return ok;
  } catch (err) {
    write("result-provider", "FAIL " + String(err));
    return false;
  }
}

// The no-data-kept provider filter (plan risk section, C:48/496,
// "Step-1 spikes": "the `provider` filter in the intercepted request").
// Field names are the installed @openrouter/ai-sdk-provider's own types
// (node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts): the `provider`
// settings on OpenRouterChatSettings carry `data_collection?: DataCollection`
// ('deny' | 'allow') and `zdr?: boolean` ("restrict routing to only ZDR
// (Zero Data Retention) endpoints"). Confirmed these serialize verbatim
// into the request body's top-level `provider` object (see
// docs/spikes/spike-1-browser-loop.md "Surprises" for the direct probe).
const NO_DATA_KEPT_PROVIDER_FILTER = { data_collection: "deny" as const, zdr: true };

// ---------------------------------------------------------------------
// D. REQUEST BUILT (rework item 2): wrap globalThis.fetch, make the
//    OpenRouter provider actually ISSUE its HTTP request for a Claude
//    model with one tool, and assert URL / method / JSON body / the
//    Authorization header AND the provider routing filter — using a
//    canned streamed response so no real network call or key is needed.
//    The key comes from a RUNTIME global (rework item 3) set by the test
//    harness AFTER the bundle loaded — never from import.meta.env, so it
//    cannot be baked into dist/.
// ---------------------------------------------------------------------
async function runRequestBuilt() {
  const runtimeKey = getRuntimeInterceptKey();
  if (!runtimeKey) {
    write("result-request", "BLOCKED no runtime intercept key was set on window before load");
    return false;
  }

  let captured: { url: string; method?: string; headers: Record<string, string>; bodyText: string } | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    }
    captured = { url, method: init?.method, headers, bodyText: typeof init?.body === "string" ? init.body : "" };
    return cannedResponse("Order A100 is shipped.");
  }) as typeof fetch;

  try {
    const openrouter = createOpenRouter({ apiKey: runtimeKey });
    // Provider settings, per OpenRouterChatSettings — this is the "spike-4
    // provider filter" the contract (C:48, C § 8) says the entry point
    // builds the model with, proved here without needing spike 4's live
    // account/key infrastructure.
    const model = openrouter.chat(MODEL_ID, { provider: NO_DATA_KEPT_PROVIDER_FILTER });
    const echoTool = tool({
      description: "Echo a string back",
      inputSchema: jsonSchema<{ text: string }>({
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      }),
      execute: async ({ text }) => ({ text }),
    });
    const result = streamText({ model, prompt: "call the echo tool with 'A100'", tools: { echoTool } });
    await result.text;

    if (!captured) throw new Error("fetch was never called");
    const body = JSON.parse((captured as any).bodyText);
    const checks = {
      url: (captured as any).url === "https://openrouter.ai/api/v1/chat/completions",
      method: (captured as any).method === "POST",
      model: body.model === MODEL_ID,
      messages: Array.isArray(body.messages) && body.messages.length >= 1,
      hasTool: Array.isArray(body.tools) && body.tools.some((t: any) => t.function?.name === "echoTool"),
      stream: body.stream === true,
      authFromRuntime: (captured as any).headers["authorization"] === `Bearer ${runtimeKey}`,
      providerDataCollectionDeny: body.provider?.data_collection === NO_DATA_KEPT_PROVIDER_FILTER.data_collection,
      providerZdr: body.provider?.zdr === NO_DATA_KEPT_PROVIDER_FILTER.zdr,
    };
    const allPass = Object.values(checks).every(Boolean);
    write(
      "result-request",
      (allPass ? "PASS " : "FAIL ") +
        JSON.stringify({ checks, url: (captured as any).url, method: (captured as any).method, body })
    );
    return allPass;
  } catch (err) {
    write("result-request", "FAIL " + String(err));
    return false;
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------------------------------------------------------------------
// E. If a REAL key is available at runtime (never at build time — see
//    src/runtime-key.ts), make one real streamed call with a Claude
//    model and a tool, and check a cache read on turn 2. Otherwise:
//    BLOCKED (needs key), not a pass.
//
// Live cache rework (2026-09-23): the first live run showed
// cacheReadTokens 0 on both turns at 989 input tokens — under Anthropic's
// ~1,024-token cache minimum, AND the code was reading the wrong usage
// field (`usage.cachedInputTokens`, which doesn't exist on the AI SDK's
// `LanguageModelUsage` type — the real field is
// `usage.inputTokenDetails.cacheReadTokens`, confirmed against
// node_modules/ai/dist/index.d.ts). Fixed both: SYSTEM_PROMPT above is
// ~4,000-5,000 real tokens, and a `cache_control: { type: "ephemeral" }`
// breakpoint (node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts:
// "Enable Anthropic automatic prompt caching by setting a top-level
// cache_control directive") is set on both turns.
//
// `noZdr`: the provider's no-data-kept filter (`zdr: true`) restricts
// routing to Zero-Data-Retention endpoints, which is a real candidate
// reason Anthropic prompt caching might not apply (a ZDR endpoint may not
// persist the cache at all). Passing `noZdr: true` drops `zdr` (keeps
// `data_collection: "deny"`) so the two configurations can be compared —
// used only as a diagnostic within the live-call budget, never by default.
async function runRealCallIfKeyed(noZdr = false) {
  // Zero-cost (no network): always run, key or not, so the prompt's size
  // is visible even when the live call itself is BLOCKED.
  const sizeOk = runSystemPromptSizeCheck();
  const key = getRuntimeRealKey();
  if (!key) {
    write("result-real", "BLOCKED needs OPENROUTER_API_KEY (none supplied at runtime)");
    return { status: "blocked" as const, sizeOk };
  }
  try {
    const openrouter = createOpenRouter({ apiKey: key });
    const providerFilter: Record<string, unknown> = noZdr ? { data_collection: "deny" } : NO_DATA_KEPT_PROVIDER_FILTER;
    const model = openrouter.chat(MODEL_ID, {
      provider: providerFilter as any,
      cache_control: { type: "ephemeral" },
    });
    const echoTool = tool({
      description: "Echo a string back",
      inputSchema: jsonSchema<{ text: string }>({
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      }),
      execute: async ({ text }) => ({ text }),
    });

    const turn1UserText =
      "Please call the echo tool with the text 'order-A100-status-check', then confirm in one sentence that you did.";
    const turn1 = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: turn1UserText }],
      tools: { echoTool },
      stopWhen: stepCountIs(3),
    });
    await turn1.text;
    const usage1 = await turn1.usage;
    const turn1ResponseMessages = await turn1.responseMessages;

    // Turn 2 is a REAL second turn: the identical system prompt (required
    // for the cache prefix to match), the full turn-1 exchange, and one
    // NEW user message — not a repeat of turn 1.
    const turn2UserText =
      "Thanks. Now do the same check again, but this time with the text 'order-B200-status-check' instead.";
    const turn2 = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: turn1UserText }, ...turn1ResponseMessages, { role: "user", content: turn2UserText }],
      tools: { echoTool },
      stopWhen: stepCountIs(3),
    });
    await turn2.text;
    const usage2 = await turn2.usage;

    const cacheReadTurn1 = usage1.inputTokenDetails?.cacheReadTokens ?? 0;
    const cacheWriteTurn1 = usage1.inputTokenDetails?.cacheWriteTokens ?? 0;
    const cacheReadTurn2 = usage2.inputTokenDetails?.cacheReadTokens ?? 0;
    const cacheWriteTurn2 = usage2.inputTokenDetails?.cacheWriteTokens ?? 0;

    // providerMetadata is a raw pass-through — OpenRouter's own usage
    // accounting (cost, in USD) rides here if the provider returned it.
    const providerMetadata1 = await turn1.providerMetadata;
    const providerMetadata2 = await turn2.providerMetadata;
    const cost1 = (providerMetadata1 as any)?.openrouter?.usage?.cost;
    const cost2 = (providerMetadata2 as any)?.openrouter?.usage?.cost;

    const summary = {
      providerFilter,
      systemPromptEstimatedTokens: ESTIMATED_TOKENS,
      turn1: { inputTokens: usage1.inputTokens, outputTokens: usage1.outputTokens, cacheReadTokens: cacheReadTurn1, cacheWriteTokens: cacheWriteTurn1, costUsd: cost1 },
      turn2: { inputTokens: usage2.inputTokens, outputTokens: usage2.outputTokens, cacheReadTokens: cacheReadTurn2, cacheWriteTokens: cacheWriteTurn2, costUsd: cost2 },
    };
    const pass = cacheReadTurn2 > 0;
    write("result-real", `${pass ? "PASS" : "FAIL"} ${JSON.stringify(summary)}`);
    return { status: (pass ? "pass-with-cache" : "fail-no-cache-read") as const, cacheReadTurn2, summary, sizeOk };
  } catch (err) {
    write("result-real", "FAIL " + String(err));
    return { status: "fail" as const, error: String(err) };
  }
}

// ---------------------------------------------------------------------
// F. THE UI MESSAGE STREAM (rework item 2, second half): run the loop's
//    result through the AI SDK's own UI-message-stream conversion
//    (`toUIMessageStream`, merged via `createUIMessageStream`, exactly
//    the functions the installed ai@7 package exports) in the page, and
//    assert the reconstructed message's parts are the contract's § 6.1
//    kinds: `text`, `tool-<name>`, and one `data-card` part WRITTEN BY
//    CODE (never by the model — § 6.2's "the model never writes a card").
// ---------------------------------------------------------------------
async function runUiMessageStream() {
  const echoTool = tool({
    description: "Echo a string back",
    inputSchema: jsonSchema<{ text: string }>({
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    }),
    execute: async ({ text }) => ({ text }),
  });

  // The chunks the MOCK MODEL emits — no "data-card" anywhere in them.
  // The data-card that ends up in the final message comes ONLY from the
  // writer.write() call below (code), which is the assertion that matters
  // for § 6.2's "the model never writes a card".
  const modelChunks = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Checking order A100." },
    { type: "text-end", id: "t1" },
    { type: "tool-input-start", id: "c1", toolName: "echoTool" },
    { type: "tool-input-delta", id: "c1", delta: JSON.stringify({ text: "A100" }) },
    { type: "tool-input-end", id: "c1" },
    { type: "tool-call", toolCallId: "c1", toolName: "echoTool", input: JSON.stringify({ text: "A100" }) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage: { inputTokens: 6, outputTokens: 4, totalTokens: 10 } },
  ] as const;
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: simulateReadableStream({ chunks: modelChunks as any }) }),
  });

  const result = streamText({ model, prompt: "check order A100", tools: { echoTool } });

  // The model's own stream is converted with the SDK's OWN function
  // (`toUIMessageStream`) — nothing hand-rolled. The `data-card` part is
  // written separately by `writer.write(...)`, i.e. by CODE, after the
  // model's stream is merged — never something the model itself emitted,
  // matching § 6.2's card-source rule.
  const uiStream = createUIMessageStream({
    execute: async ({ writer }) => {
      await writer.merge(toUIMessageStream({ stream: result.fullStream, tools: { echoTool } }));
      writer.write({
        type: "data-card",
        data: { card: "checker", props: { ok: true }, ref: "resume.md" },
      } as any);
    },
  });

  const messages: any[] = [];
  for await (const msg of readUIMessageStream({ stream: uiStream })) {
    messages.push(msg);
  }
  const last = messages[messages.length - 1];
  const partTypes: string[] = last.parts.map((p: any) => p.type);
  const dataCardPart = last.parts.find((p: any) => p.type === "data-card");

  const checks = {
    hasText: partTypes.includes("text"),
    hasToolPart: partTypes.some((t) => t === "tool-echoTool" || t.startsWith("tool-")),
    hasDataCard: partTypes.includes("data-card"),
    dataCardFromCode: dataCardPart?.data?.card === "checker" && dataCardPart?.data?.ref === "resume.md",
    // the model's own chunk script (what the "model" actually emitted)
    // contains no data-card of any kind — the one in the final message
    // came only from the writer.write() call above.
    modelNeverEmittedCard: !modelChunks.some((c: any) => c.type === "data-card"),
  };
  const allPass = Object.values(checks).every(Boolean);
  write("result-ui-stream", (allPass ? "PASS " : "FAIL ") + JSON.stringify({ checks, partTypes }));
  return allPass;
}

async function main() {
  const a = await runMockLoop();
  const b = await runStreamingLoop();
  const c = runProviderConstruction();
  const d = await runRequestBuilt();
  const f = await runUiMessageStream();
  // Diagnostic-only toggle (never on by default): set by verify.mjs from
  // SPIKE1_NO_ZDR=1, to compare with/without the ZDR routing restriction
  // when isolating why a cache read might not show up. Spends 2 more live
  // calls, so it is only ever used deliberately, within the live-call
  // budget documented in docs/spikes/spike-1-browser-loop.md.
  const noZdr = Boolean((globalThis as any).__SPIKE1_NO_ZDR__);
  const e = await runRealCallIfKeyed(noZdr);
  const done = $("done");
  done.setAttribute("data-done", "true");
  done.setAttribute("data-mock-pass", String(a));
  done.setAttribute("data-stream-pass", String(b));
  done.setAttribute("data-provider-pass", String(c));
  done.setAttribute("data-request-pass", String(d));
  done.setAttribute("data-ui-stream-pass", String(f));
  done.setAttribute("data-real-status", e.status);
  done.setAttribute("data-real-cache-read-turn2", String((e as any).cacheReadTurn2 ?? ""));
  done.textContent = `done mock=${a} stream=${b} provider=${c} request=${d} uiStream=${f} real=${e.status}`;
}

main();
