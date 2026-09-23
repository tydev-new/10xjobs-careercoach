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
      "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    };
  }
  return {};
}
