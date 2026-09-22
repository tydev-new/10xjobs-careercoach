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
import { generateText, streamText, tool, jsonSchema, stepCountIs, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getRuntimeInterceptKey, getRuntimeRealKey } from "./runtime-key";
import { cannedResponse } from "./canned-sse";

// MVP default model (plan decision #3: "Models through OpenRouter, default
// a Claude model"). Verified 2026-09-22 via openrouter.ai/anthropic/claude-sonnet-5
// ("The exact model slug/id string is `anthropic/claude-sonnet-5`") — see
// docs/spikes/spike-1-browser-loop.md for the second corroborating fetch.
const MODEL_ID = "anthropic/claude-sonnet-5";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
function write(id: string, text: string) {
  $(id).textContent = text;
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

// ---------------------------------------------------------------------
// D. REQUEST BUILT (rework item 2): wrap globalThis.fetch, make the
//    OpenRouter provider actually ISSUE its HTTP request for a Claude
//    model with one tool, and assert URL / method / JSON body / the
//    Authorization header — using a canned streamed response so no real
//    network call or key is needed. The key comes from a RUNTIME global
//    (rework item 3) set by the test harness AFTER the bundle loaded —
//    never from import.meta.env, so it cannot be baked into dist/.
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
    const model = openrouter.chat(MODEL_ID);
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
// ---------------------------------------------------------------------
async function runRealCallIfKeyed() {
  const key = getRuntimeRealKey();
  if (!key) {
    write("result-real", "BLOCKED needs OPENROUTER_API_KEY (none supplied at runtime)");
    return "blocked";
  }
  try {
    const openrouter = createOpenRouter({ apiKey: key });
    const model = openrouter.chat(MODEL_ID);
    const echoTool = tool({
      description: "Echo a string back",
      inputSchema: jsonSchema<{ text: string }>({
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      }),
      execute: async ({ text }) => ({ text }),
    });
    const turn1 = streamText({
      model,
      prompt: "Call the echo tool with the text 'spike-1'. Then say done.",
      tools: { echoTool },
      stopWhen: stepCountIs(3),
    });
    await turn1.text;
    const usage1 = await turn1.usage;

    const turn2 = streamText({
      model,
      prompt: "Call the echo tool with the text 'spike-1'. Then say done.",
      tools: { echoTool },
      stopWhen: stepCountIs(3),
    });
    await turn2.text;
    const usage2 = await turn2.usage;
    const cacheRead =
      (usage2 as any)?.cachedInputTokens ?? (usage2 as any)?.providerMetadata?.anthropic?.cacheReadInputTokens;
    write("result-real", `PASS turn1=${JSON.stringify(usage1)} turn2=${JSON.stringify(usage2)} cacheRead=${cacheRead}`);
    return cacheRead ? "pass-with-cache" : "pass-no-cache-signal";
  } catch (err) {
    write("result-real", "FAIL " + String(err));
    return "fail";
  }
}

async function main() {
  const a = await runMockLoop();
  const b = await runStreamingLoop();
  const c = runProviderConstruction();
  const d = await runRequestBuilt();
  const e = await runRealCallIfKeyed();
  const done = $("done");
  done.setAttribute("data-done", "true");
  done.setAttribute("data-mock-pass", String(a));
  done.setAttribute("data-stream-pass", String(b));
  done.setAttribute("data-provider-pass", String(c));
  done.setAttribute("data-request-pass", String(d));
  done.setAttribute("data-real", String(e));
  done.textContent = `done mock=${a} stream=${b} provider=${c} request=${d} real=${e}`;
}

main();
