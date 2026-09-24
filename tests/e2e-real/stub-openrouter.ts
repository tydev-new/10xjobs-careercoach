// Tester-owned stub OpenRouter for the step 5b real-app e2e. It sits where
// https://openrouter.ai/api/v1/chat/completions would (functions-host.ts
// rewrites that one URL to here), so every request it sees has ALREADY
// gone through the real ten-model-proxy (auth, membership, balance, the
// ceiling, the allowlisted body). It answers with OpenRouter-shaped SSE:
// the same chunk shape as supabase/functions/_shared/test-support.ts's stub
// and apps/web's canned-sse.ts (id, choices[].delta, a final chunk with
// finish_reason + usage.cost), which @openrouter/ai-sdk-provider parses in
// the browser.
//
// The "model" is a script: a scenario is picked by the text of the LAST
// user message in the request, and its step index is the number of
// assistant messages after that user message (one step per model call in
// the coach's tool loop). A web_search seam call (the proxy rewrites
// plugins: [{ id: "web" }]) gets url_citation annotations instead.
import http from "node:http";

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}
export interface Step {
  tools?: ToolCall[];
  text?: string;
  /** usage.cost reported on the final chunk (default 0.01) */
  cost?: number;
  /** runs before the response is streamed (e.g. drain the balance mid-run) */
  before?: () => Promise<void>;
}
export interface Scenario {
  name: string;
  match: RegExp;
  steps: Step[];
}

export interface Hit {
  at: number;
  auth: string;
  body: any;
  scenario?: string;
  step?: number;
  kind: "chat" | "web_search";
}

export interface StubOpenRouter {
  url: string;
  hits: Hit[];
  setScenarios(s: Scenario[]): void;
  close(): Promise<void>;
}

export function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
  return "";
}

let genCounter = 0;

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function stepChunks(step: Step): string[] {
  const id = `gen-e2e-${Date.now()}-${++genCounter}`;
  const base = { id, provider: "Anthropic", model: "anthropic/claude-sonnet-5", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000) };
  const out: string[] = [sse({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })];
  if (step.text) {
    // two deltas, so the browser sees a real stream, not one blob
    const mid = Math.floor(step.text.length / 2);
    for (const piece of [step.text.slice(0, mid), step.text.slice(mid)]) {
      if (piece) out.push(sse({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] }));
    }
  }
  (step.tools ?? []).forEach((t, i) => {
    const callId = `call_${genCounter}_${i}`;
    out.push(
      sse({
        ...base,
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: i, id: callId, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } }] },
            finish_reason: null,
          },
        ],
      }),
    );
  });
  out.push(
    sse({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: step.tools?.length ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280, cost: step.cost ?? 0.01, prompt_tokens_details: { cached_tokens: 0 } },
    }),
  );
  out.push("data: [DONE]\n\n");
  return out;
}

export async function startStubOpenRouter(): Promise<StubOpenRouter> {
  let scenarios: Scenario[] = [];
  const hits: Hit[] = [];

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: any = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      /* leave {} */
    }
    const hit: Hit = { at: Date.now(), auth: String(req.headers["authorization"] ?? ""), body, kind: "chat" };
    hits.push(hit);

    let out: string[];
    if (Array.isArray(body.plugins) && body.plugins.some((p: any) => p?.id === "web")) {
      hit.kind = "web_search";
      const q = textOfContent(body.messages?.[body.messages.length - 1]?.content);
      const base = { id: `gen-e2e-web-${++genCounter}`, model: "anthropic/claude-sonnet-5" };
      out = [
        sse({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                content: `Results for ${q}.`,
                annotations: [
                  { type: "url_citation", url_citation: { url: "https://news.example.com/acme-series-c", title: "Acme raises Series C", content: "Acme announced a Series C round in 2026." } },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70, cost: 0.02 } }),
        "data: [DONE]\n\n",
      ];
    } else {
      const msgs: any[] = Array.isArray(body.messages) ? body.messages : [];
      let lastUser = -1;
      for (let i = msgs.length - 1; i >= 0; i--)
        if (msgs[i].role === "user") {
          lastUser = i;
          break;
        }
      const userText = lastUser >= 0 ? textOfContent(msgs[lastUser].content) : "";
      const stepIndex = msgs.slice(lastUser + 1).filter((m) => m.role === "assistant").length;
      const scenario = scenarios.find((s) => s.match.test(userText));
      hit.scenario = scenario?.name ?? "(none)";
      hit.step = stepIndex;
      const step: Step = scenario?.steps[stepIndex] ?? { text: "(stub: nothing scripted for this step)" };
      if (step.before) await step.before();
      out = stepChunks(step);
    }

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    for (const c of out) {
      res.write(c);
      await new Promise((r) => setTimeout(r, 15));
    }
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return {
    url: `http://127.0.0.1:${(server.address() as any).port}`,
    hits,
    setScenarios(s) {
      scenarios = s;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
