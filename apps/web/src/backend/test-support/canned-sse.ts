// A canned OpenAI/OpenRouter-shaped SSE streaming response body, for
// backend/*.test.ts to let the real OpenRouter provider's streaming parser
// run end to end with no live network call or key — same wire shape as
// spikes/1-browser-loop/src/canned-sse.ts (verified there against
// @openrouter/ai-sdk-provider's own zod schema).
function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export function cannedOpenRouterStreamBody(text: string): ReadableStream<Uint8Array> {
  const id = "gen-test-canned";
  const chunks = [
    sse({ id, model: "anthropic/claude-sonnet-5", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }),
    sse({ id, model: "anthropic/claude-sonnet-5", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }),
    sse({
      id,
      model: "anthropic/claude-sonnet-5",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    }),
    "data: [DONE]\n\n",
  ];
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

export function cannedResponse(text: string): Response {
  return new Response(cannedOpenRouterStreamBody(text), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
