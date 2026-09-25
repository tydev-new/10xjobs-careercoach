// deps.webSearch (docs/design-web-agent.md § 4): "makes one proxy call
// with plugins: [{ id: 'web' }]" — a raw call to `ten-model-proxy`
// (not through the AI SDK's own tool loop; this is a one-shot side
// request), reading the forced-`stream: true` SSE response and returning
// the `url_citation` annotations. **UNVERIFIED** how the provider exposes
// them (§ 4's own flag) — the proxy spike (with a live key) settles the
// exact shape; this parser accepts the documented OpenRouter/Exa
// `url_citation` annotation shape and degrades to an empty result list
// (never a thrown error) if a response carries none, so an unverified
// wire-format surprise fails soft, not by breaking the turn.
//
// Browser-safe: only `fetch`/`TextDecoder`. No window/document/
// localStorage/node:*.
import type { WebSearchInput, WebSearchOutput, WebSearchResult } from "../../../../packages/agent/src/types.ts";
import { boundFetch } from "./bound-fetch.ts";

export interface WebSearchOptions {
  /** The `ten-model-proxy` base URL (same as model.ts's `proxyUrl`). */
  proxyUrl: string;
  /** Returns the current session's access token; called per request. */
  getAccessToken: () => Promise<string>;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** § 14's last-resort dated fallback (estimate-cost.ts's own
   *  DEFAULT_WEB_SEARCH_COST_MAX_USD) — used only when a response carries no
   *  `usage.cost` at all. Passed in rather than imported so this module
   *  doesn't have to agree with estimate-cost.ts's own constant twice. */
  defaultUsd: number;
}

interface RawAnnotation {
  type?: string;
  url_citation?: { url?: string; title?: string; content?: string };
}

interface RawSSEChunk {
  choices?: Array<{
    delta?: { content?: string; annotations?: RawAnnotation[] };
    message?: { content?: string; annotations?: RawAnnotation[] };
  }>;
  usage?: { cost?: number };
}

function parseSSE(text: string): { annotations: RawAnnotation[]; usd?: number } {
  const annotations: RawAnnotation[] = [];
  let usd: number | undefined;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (payload === "[DONE]" || payload === "") continue;
    let chunk: RawSSEChunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue; // a malformed line is skipped, not fatal (fail soft)
    }
    for (const choice of chunk.choices ?? []) {
      const anns = choice.delta?.annotations ?? choice.message?.annotations ?? [];
      annotations.push(...anns);
    }
    if (typeof chunk.usage?.cost === "number" && Number.isFinite(chunk.usage.cost)) {
      usd = chunk.usage.cost;
    }
  }
  return { annotations, usd };
}

function toResult(a: RawAnnotation): WebSearchResult | null {
  const url = a.url_citation?.url;
  if (!url) return null;
  return {
    url,
    title: a.url_citation?.title ?? url,
    excerpt: a.url_citation?.content ?? a.url_citation?.title ?? "",
  };
}

export function createWebSearch(opts: WebSearchOptions): (input: WebSearchInput) => Promise<WebSearchOutput> {
  const url = `${opts.proxyUrl.replace(/\/+$/, "")}/chat/completions`;
  const fetchImpl = opts.fetchImpl ?? boundFetch();

  return async (input: WebSearchInput): Promise<WebSearchOutput> => {
    const token = await opts.getAccessToken();
    const maxResults = Math.max(1, Math.min(input.maxResults ?? 5, 5));
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: input.query }],
        plugins: [{ id: "web", max_results: maxResults }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`web_search proxy call failed: HTTP ${res.status} ${body}`);
    }
    const text = await res.text();
    const { annotations, usd } = parseSSE(text);
    const results = annotations
      .map(toResult)
      .filter((r): r is WebSearchResult => r !== null)
      .slice(0, maxResults);
    return { results, usd: usd ?? opts.defaultUsd };
  };
}
