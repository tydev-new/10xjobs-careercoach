// Tester-owned: the REAL @openrouter/ai-sdk-provider (3.1.0, the version
// apps/web ships) driven by a stubbed `fetch` that streams OpenRouter-shaped
// SSE. This is the actual root-cause path of docs/design-web-agent.md § 9
// ("Why it was silent"): the provider's own flush() decides what a
// `finish_reason: "length"` stream turns into — a mocked LanguageModelV4
// would only replay what the test author believes the provider does.
//
// No network: every request is answered from the script; running past the
// script throws (a stray extra request is a test failure, not a hang).
import { createOpenRouter } from "../../packages/agent/node_modules/@openrouter/ai-sdk-provider/dist/index.js";

export type Sse = Record<string, unknown>;

let seq = 0;
const ID = () => `gen-stub-${++seq}`;

/** One OpenRouter streaming response, built chunk by chunk. */
export class SseScript {
  readonly id = ID();
  readonly events: Sse[] = [];
  private base() {
    return { id: this.id, model: "anthropic/claude-sonnet-5", object: "chat.completion.chunk", created: 1_790_000_000 };
  }
  text(content: string): this {
    this.events.push({ ...this.base(), choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] });
    return this;
  }
  /** Opens tool call `index` with `args` as its first argument fragment. */
  toolStart(index: number, callId: string, name: string, args: string): this {
    this.events.push({
      ...this.base(),
      choices: [{ index: 0, delta: { tool_calls: [{ index, id: callId, type: "function", function: { name, arguments: args } }] }, finish_reason: null }],
    });
    return this;
  }
  toolDelta(index: number, args: string): this {
    this.events.push({ ...this.base(), choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: args } }] }, finish_reason: null }] });
    return this;
  }
  /** A whole tool call the way a real stream writes one: the opening chunk
   *  names the function with empty arguments, then argument fragments (the
   *  last one completes the JSON). */
  toolCall(index: number, callId: string, name: string, input: unknown): this {
    const json = JSON.stringify(input);
    const cut = Math.max(1, Math.floor(json.length / 2));
    return this.toolStart(index, callId, name, "").toolDelta(index, json.slice(0, cut)).toolDelta(index, json.slice(cut));
  }
  /** A tool call cut off mid-arguments: opened, then fragments that never
   *  complete the JSON (the § 9.8(i) "arguments stop mid-string"). */
  toolCallCutOff(index: number, callId: string, name: string, partialArgs: string): this {
    const cut = Math.max(1, Math.floor(partialArgs.length / 2));
    return this.toolStart(index, callId, name, "").toolDelta(index, partialArgs.slice(0, cut)).toolDelta(index, partialArgs.slice(cut));
  }
  finish(reason: string): this {
    this.events.push({ ...this.base(), choices: [{ index: 0, delta: {}, finish_reason: reason, native_finish_reason: reason === "length" ? "max_tokens" : reason }] });
    return this;
  }
  /** OpenRouter's trailing usage chunk: often an EMPTY `choices` (§ 9.6). */
  usage(cost: number, completionTokens = 50): this {
    this.events.push({
      ...this.base(),
      choices: [],
      usage: { prompt_tokens: 1000, completion_tokens: completionTokens, total_tokens: 1000 + completionTokens, cost, prompt_tokens_details: { cached_tokens: 0 } },
    });
    return this;
  }
  body(): string {
    return this.events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  }
}

export const sse = () => new SseScript();

/** A text-only step that ends `stop`. */
export const textReply = (text: string, cost = 0.01) => sse().text(text).finish("stop").usage(cost);
/** One finished tool call, ending `tool_calls` (OpenRouter's raw value). */
export const toolReply = (name: string, input: unknown, cost = 0.01, callId = `call_${Math.random().toString(36).slice(2, 10)}`) =>
  sse().toolCall(0, callId, name, input).finish("tool_calls").usage(cost);

export interface StubbedModel {
  model: any;
  /** Every request body the provider sent, parsed. */
  requests: any[];
  get used(): number;
}

/** The real provider, same construction as apps/web/src/backend/model.ts
 *  (baseURL = the proxy, placeholder apiKey, custom fetch). */
export function stubbedOpenRouter(script: SseScript[]): StubbedModel {
  const requests: any[] = [];
  let i = 0;
  const fetchStub = async (_url: any, init?: any) => {
    requests.push(JSON.parse(String(init?.body ?? "{}")));
    const s = script[i++];
    if (!s) throw new Error(`stubbed fetch: request #${i} has no scripted response (script has ${script.length})`);
    return new Response(s.body(), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const openrouter = createOpenRouter({ apiKey: "unused-stub", baseURL: "http://127.0.0.1:9/ten-model-proxy", fetch: fetchStub as any });
  const model = openrouter.chat("anthropic/claude-sonnet-5", { provider: { data_collection: "deny", zdr: true }, cache_control: { type: "ephemeral" } } as any);
  return { model, requests, get used() { return i; } };
}

// ---------------------------------------------------------------- request views

export function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join("");
  return "";
}

/** The system prompt of an OpenRouter chat request (messages[0], role system). */
export function systemOf(req: any): string {
  const sys = (req.messages ?? []).filter((m: any) => m.role === "system");
  return sys.map((m: any) => contentText(m.content)).join("\n");
}

export const lastMessage = (req: any) => req.messages[req.messages.length - 1];

/** OpenAI-format validity the upstream (Anthropic via OpenRouter) enforces:
 *  every assistant tool_call id is answered by a `tool` message before the
 *  next non-tool message. Returns the violations, [] when valid. */
export function danglingToolCalls(req: any): string[] {
  const out: string[] = [];
  const msgs: any[] = req.messages ?? [];
  msgs.forEach((m, i) => {
    for (const tc of m.role === "assistant" ? (m.tool_calls ?? []) : []) {
      let j = i + 1;
      let answered = false;
      while (j < msgs.length && msgs[j].role === "tool") {
        if (msgs[j].tool_call_id === tc.id) answered = true;
        j++;
      }
      if (!answered) out.push(`${tc.function?.name}:${tc.id} at message ${i}`);
    }
  });
  return out;
}
