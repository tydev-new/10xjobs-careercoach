// The browser entry's `model` (docs/design-web-agent.md § 1, § 8, amended
// by § 13 "the site's model is a setting"): the OpenRouter provider
// (@openrouter/ai-sdk-provider, pinned as in spikes/1-browser-loop)
// pointed at `ten-model-proxy` instead of openrouter.ai directly,
// authenticated with the user's own Supabase session JWT — never an
// OpenRouter key (there is none in the browser).
//
// Browser-safe: only `fetch`/`Headers`/`URL`. No window/document/
// localStorage/node:* — this file runs in the browser tab and (headless)
// on a server, same posture as packages/agent (design-web-agent.md § 1).
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { boundFetch } from "./bound-fetch.ts";
import { CLAUDE_COACH_MODEL } from "./coach-model.ts";

/** The no-data-kept provider filter (design-web-agent.md § 8's "provider:
 *  { data_collection: 'deny', zdr: true }" — the proxy also FORCES this
 *  server-side; setting it here too keeps the client-built request body
 *  honest even before it reaches the proxy, and matches spike 1's proven
 *  field names). § 13.1 adds `require_parameters: true` for DeepSeek only
 *  — proxy-side, never here: the proxy drops the client's `provider`
 *  entirely and sets its own per model (§ 13.2), so this filter is the
 *  same for every model the client itself might name. */
export const NO_DATA_KEPT_PROVIDER_FILTER = { data_collection: "deny" as const, zdr: true };

export interface CoachModelOptions {
  /** § 13.2: the active model's id (`apps/web/src/backend/coach-model.ts`
   *  — `readEnv().coachModel.id`). Sent verbatim as the request's `model`;
   *  the proxy's own allowlist is the gate (a wrong id here 400s there,
   *  never silently falls back). Optional, defaulting to Claude's id —
   *  the same "unset never changes the model" rule § 13.2 gives
   *  VITE_COACH_MODEL — so callers written before § 13 (this package's
   *  own harnesses) keep working unchanged; `real/deps.ts` always passes
   *  it explicitly. */
  modelId?: string;
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
export function authedFetch(getAccessToken: () => Promise<string>, base: typeof fetch = boundFetch()): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = await getAccessToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return base(input, { ...init, headers });
  }) as typeof fetch;
}

/** Builds the AI SDK `LanguageModel` the browser entry passes as
 *  `Deps.model` (§ 1) — routed through `ten-model-proxy`, never
 *  `openrouter.ai` directly, and authenticated with the live session JWT.
 *  § 13.2: "The client stops setting cache_control" — the proxy drops the
 *  client's copy and sets its own (Claude only, § 13.1), so it was a
 *  second place for one fact (rule 12), and wrong for DeepSeek; not set
 *  here at all anymore. */
export function createCoachModel(opts: CoachModelOptions): LanguageModel {
  const base = opts.fetchImpl ?? boundFetch();
  const openrouter = createOpenRouter({
    // Never read for auth (authedFetch below always overwrites the
    // Authorization header) — a non-empty placeholder only satisfies the
    // provider's own loadApiKey() call, which throws on an empty string
    // and there is no OPENROUTER_API_KEY in the browser to fall back to.
    apiKey: "unused-browser-session-see-authedFetch",
    baseURL: opts.proxyUrl.replace(/\/+$/, ""),
    fetch: authedFetch(opts.getAccessToken, base),
  });
  return openrouter.chat(opts.modelId ?? CLAUDE_COACH_MODEL.id, {
    provider: NO_DATA_KEPT_PROVIDER_FILTER,
  });
}
