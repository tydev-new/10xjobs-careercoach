// The browser entry's `model` (docs/design-web-agent.md § 1, § 8): the
// OpenRouter provider (@openrouter/ai-sdk-provider, pinned as in
// spikes/1-browser-loop) pointed at `ten-model-proxy` instead of
// openrouter.ai directly, authenticated with the user's own Supabase
// session JWT — never an OpenRouter key (there is none in the browser).
//
// Browser-safe: only `fetch`/`Headers`/`URL`. No window/document/
// localStorage/node:* — this file runs in the browser tab and (headless)
// on a server, same posture as packages/agent (design-web-agent.md § 1).
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

/** MVP default model (plan decision #3; spike 1, 2026-09-22/23). */
export const COACH_MODEL_ID = "anthropic/claude-sonnet-5";

/** The no-data-kept provider filter (design-web-agent.md § 8's "provider:
 *  { data_collection: 'deny', zdr: true }" — the proxy also FORCES this
 *  server-side; setting it here too keeps the client-built request body
 *  honest even before it reaches the proxy, and matches spike 1's proven
 *  field names). */
export const NO_DATA_KEPT_PROVIDER_FILTER = { data_collection: "deny" as const, zdr: true };

export interface CoachModelOptions {
  /** The `ten-model-proxy` base URL, e.g.
   *  `https://<project>.supabase.co/functions/v1/ten-model-proxy` — the
   *  provider appends `/chat/completions` itself. */
  proxyUrl: string;
  /** Returns the CURRENT session's access token; called fresh on every
   *  request (§ 1: "auth = the user's Supabase session JWT (refresh it)";
   *  § 8: "a custom fetch sets Authorization: Bearer <current JWT> on each
   *  call") — never cached here, so a refreshed token is always used. */
  getAccessToken: () => Promise<string>;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Wraps `base` so every outgoing request's `Authorization` header is the
 *  CURRENT Supabase JWT, read fresh (not cached) on each call — overriding
 *  whatever the OpenRouter provider itself set from its own (unused,
 *  placeholder) `apiKey` option. This is the ONLY place a bearer token is
 *  attached to a model call; the browser never holds an OpenRouter key. */
export function authedFetch(getAccessToken: () => Promise<string>, base: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = await getAccessToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return base(input, { ...init, headers });
  }) as typeof fetch;
}

/** Builds the AI SDK `LanguageModel` the browser entry passes as
 *  `Deps.model` (§ 1) — routed through `ten-model-proxy`, never
 *  `openrouter.ai` directly, and authenticated with the live session JWT. */
export function createCoachModel(opts: CoachModelOptions): LanguageModel {
  const base = opts.fetchImpl ?? fetch;
  const openrouter = createOpenRouter({
    // Never read for auth (authedFetch below always overwrites the
    // Authorization header) — a non-empty placeholder only satisfies the
    // provider's own loadApiKey() call, which throws on an empty string
    // and there is no OPENROUTER_API_KEY in the browser to fall back to.
    apiKey: "unused-browser-session-see-authedFetch",
    baseURL: opts.proxyUrl.replace(/\/+$/, ""),
    fetch: authedFetch(opts.getAccessToken, base),
  });
  return openrouter.chat(COACH_MODEL_ID, {
    provider: NO_DATA_KEPT_PROVIDER_FILTER,
    cache_control: { type: "ephemeral" },
  });
}
