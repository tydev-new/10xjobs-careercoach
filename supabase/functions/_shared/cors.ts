// CORS helper shared by both Ten Edge Functions.
// Contract: docs/design-web-agent.md § 8 — "the proxy allows only the
// production Vercel origin and http://localhost:5173". Applies to every
// response (preflight and real), so an unlisted origin gets no allow header
// on either.

export const LOCAL_DEV_ORIGIN = "http://localhost:5173";

/** Builds the allowlist from env: the production Vercel origin (required,
 * `TEN_APP_ORIGIN`) plus the fixed local dev origin. */
export function allowedOrigins(env: Record<string, string | undefined>): string[] {
  const prod = env.TEN_APP_ORIGIN?.trim();
  const list = [LOCAL_DEV_ORIGIN];
  if (prod) list.push(prod);
  return list;
}

/** CORS headers for a given request Origin header; {} (no allow header) when
 * the origin is missing or not in the allowlist — the browser then blocks
 * the response itself. */
export function corsHeaders(origin: string | null, allowed: string[]): HeadersInit {
  if (origin && allowed.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      // Fix round 1, item 2 (BLOCKER): the browser's own OpenRouter
      // provider (@openrouter/ai-sdk-provider) always sets a `user-agent`
      // header on every chat-completions request (see
      // withUserAgentSuffix in the installed package) — a real header on
      // the wire, not silently dropped, confirmed empirically by
      // intercepting an actual streamText() call through this exact
      // provider/proxy path (no x-stainless-* or other custom header is
      // sent; the full set is authorization, content-type, user-agent).
      // Without it listed here, the real request is refused in Firefox
      // and WebKit; fix round 1's original note that "Chrome tolerates
      // it" was never actually verified there and shouldn't be trusted —
      // list it for every browser, not just the two the first e2e run
      // happened to fail in.
      "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, user-agent",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    };
  }
  return {};
}
