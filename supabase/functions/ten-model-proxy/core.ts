// Pure, network-free pieces of ten-model-proxy (docs/design-web-agent.md § 8):
// the request-field allowlist that rebuilds the upstream body, the path
// matcher, and the SSE usage/cost parser used to meter each call. Kept apart
// from handler.ts so they're trivial to unit test without any fetch mocking.

export const MODEL = "anthropic/claude-sonnet-5";
export const MAX_TOKENS_CAP = 4096;
export const MAX_WEB_RESULTS = 5;
export const CEILING_USD = 0.18; // § 8: 64k input @ $2/M + 4,096 output @ $10/M + one search
export const MAX_BODY_BYTES = 256 * 1024;
export const BETA_CEILING_USD = 5;
export const UPSTREAM_URL = "https://openrouter.ai/api/v1/chat/completions";

export type BuildResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

/** Rebuilds the upstream OpenRouter body from an explicit allowlist
 * (docs/design-web-agent.md § 8, point 4). Copies `messages`, `tools`,
 * `tool_choice`, `temperature` verbatim; forces `model`, `max_tokens`
 * (capped), `stream: true`, the provider privacy filter, and
 * `cache_control`; rewrites a `plugins: [{ id: "web" }]` request to the
 * fixed engine and a capped result count. Everything else — `models`,
 * `max_completion_tokens`, `reasoning`, `web_search_options`, other
 * plugins, `stream: false`, … — is silently dropped. */
export function buildUpstreamBody(input: unknown): BuildResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, status: 400, code: "bad_request", message: "Invalid request body." };
  }
  const client = input as Record<string, unknown>;

  if ("model" in client && client.model !== undefined && client.model !== MODEL) {
    return {
      ok: false,
      status: 400,
      code: "model_not_allowed",
      message: `Only ${MODEL} is allowed.`,
    };
  }

  const out: Record<string, unknown> = {};
  if ("messages" in client) out.messages = client.messages;
  if ("tools" in client) out.tools = client.tools;
  if ("tool_choice" in client) out.tool_choice = client.tool_choice;
  if ("temperature" in client) out.temperature = client.temperature;

  out.model = MODEL;
  const clientMax =
    typeof client.max_tokens === "number" && Number.isFinite(client.max_tokens)
      ? client.max_tokens
      : MAX_TOKENS_CAP;
  out.max_tokens = Math.max(1, Math.min(clientMax, MAX_TOKENS_CAP));
  out.stream = true;
  out.provider = { data_collection: "deny", zdr: true };
  out.cache_control = { type: "ephemeral" };

  const plugins = Array.isArray(client.plugins) ? client.plugins : [];
  const webPlugin = plugins.find(
    (p) => p && typeof p === "object" && (p as Record<string, unknown>).id === "web",
  ) as Record<string, unknown> | undefined;
  if (webPlugin) {
    const n =
      typeof webPlugin.max_results === "number" && Number.isFinite(webPlugin.max_results)
        ? webPlugin.max_results
        : MAX_WEB_RESULTS;
    out.plugins = [{ id: "web", engine: "exa", max_results: Math.max(1, Math.min(n, MAX_WEB_RESULTS)) }];
  }

  return { ok: true, body: out };
}

/** The path after the function's own name, so the same check works whether
 * the request arrives as `/functions/v1/ten-model-proxy/chat/completions`
 * (deployed) or `/chat/completions` (invoked directly in tests). */
export function pathTail(url: URL): string {
  const marker = "/ten-model-proxy";
  const idx = url.pathname.indexOf(marker);
  return idx === -1 ? url.pathname : url.pathname.slice(idx + marker.length) || "/";
}

export interface ParsedUsage {
  id?: string;
  cost?: number;
  tokensIn?: number;
  tokensOut?: number;
  tokensCached?: number;
}

/** Parses an OpenRouter SSE stream's text for the last `usage` object seen
 * (only the final chunk carries `usage.cost`, per § 8, point 5) and the
 * response `id` shared by every chunk. Tolerates `[DONE]`, keep-alive
 * comments, and a stream cut off mid-line (a malformed trailing `data:`
 * line is skipped rather than thrown). */
export function parseUsageFromSSE(text: string): ParsedUsage | null {
  let id: string | undefined;
  let usage: Record<string, unknown> | undefined;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") continue;
    let obj: unknown;
    try {
      obj = JSON.parse(payload);
    } catch {
      continue; // a partial/cut-off line: skip, don't throw
    }
    if (obj && typeof obj === "object") {
      const o = obj as Record<string, unknown>;
      if (!id && typeof o.id === "string") id = o.id;
      if (o.usage && typeof o.usage === "object") usage = o.usage as Record<string, unknown>;
    }
  }

  if (!id && !usage) return null;
  const promptDetails =
    usage && typeof usage.prompt_tokens_details === "object" && usage.prompt_tokens_details !== null
      ? (usage.prompt_tokens_details as Record<string, unknown>)
      : undefined;
  return {
    id,
    cost: typeof usage?.cost === "number" ? (usage!.cost as number) : undefined,
    tokensIn: typeof usage?.prompt_tokens === "number" ? (usage!.prompt_tokens as number) : undefined,
    tokensOut: typeof usage?.completion_tokens === "number" ? (usage!.completion_tokens as number) : undefined,
    tokensCached:
      typeof promptDetails?.cached_tokens === "number" ? (promptDetails!.cached_tokens as number) : undefined,
  };
}
