// Reads and validates the production env vars (docs/plan-portable-skills-and-web-agent.md
// step 5b, item 5): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (publishable),
// VITE_SITE_URL, VITE_MODEL_PROXY_URL (default derived from the Supabase
// URL + /functions/v1/ten-model-proxy). Nothing here is a secret: the anon
// key is meant to ship in the client bundle (it's what RLS is for).
//
// Fix round 1, item 6: VITE_SITE_URL is validated HERE too (not left to
// auth.ts's own siteRedirectUrl() to throw at RENDER time, inside the
// signed-out screen) — main.tsx calls readEnv() up front and shows the
// plain config-error screen on MissingEnvError, so a missing var is never
// a render-time throw / blank page. auth.ts's siteRedirectUrl() still
// reads import.meta.env.VITE_SITE_URL itself (unchanged, "final" code);
// by the time SignIn ever renders, readEnv() having already succeeded on
// the SAME import.meta.env source means that read can't fail in practice.
//
// Reads from a plain `Record<string, string | undefined>` (not
// `import.meta.env` directly) so this module is testable under plain Node
// — `readEnv(import.meta.env as any)` is the one call site that touches
// Vite's build-time env object.
export interface TenEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** `ten-model-proxy`'s base URL — the provider appends `/chat/completions`. */
  modelProxyUrl: string;
  /** Read here only to VALIDATE it's present up front; auth.ts's own
   *  siteRedirectUrl() is still what actually builds `redirectTo`. */
  siteUrl: string;
}

export class MissingEnvError extends Error {
  // A plain field assignment, not a TS constructor parameter property —
  // Node's strip-only TypeScript mode (`node --test`, no build step)
  // doesn't support parameter properties (same constraint noted in
  // mock-transport.ts), and this file has to run there unmodified.
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`Missing required env var(s): ${missing.join(", ")}`);
    this.name = "MissingEnvError";
    this.missing = missing;
  }
}

/** `<supabaseUrl>/functions/v1/ten-model-proxy` — the plan's own stated
 *  default when `VITE_MODEL_PROXY_URL` isn't set. */
export function defaultModelProxyUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/ten-model-proxy`;
}

/** Throws MissingEnvError (never silently guesses) when a required var is
 *  absent or blank. `VITE_MODEL_PROXY_URL` is the one optional var —
 *  absent means "derive it". */
export function readEnv(source: Record<string, string | undefined>): TenEnv {
  const supabaseUrl = source.VITE_SUPABASE_URL?.trim();
  const supabaseAnonKey = source.VITE_SUPABASE_ANON_KEY?.trim();
  const siteUrl = source.VITE_SITE_URL?.trim();
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!supabaseAnonKey) missing.push("VITE_SUPABASE_ANON_KEY");
  if (!siteUrl) missing.push("VITE_SITE_URL");
  if (missing.length > 0) throw new MissingEnvError(missing);

  const modelProxyUrl = source.VITE_MODEL_PROXY_URL?.trim() || defaultModelProxyUrl(supabaseUrl!);
  return { supabaseUrl: supabaseUrl!.replace(/\/+$/, ""), supabaseAnonKey: supabaseAnonKey!, modelProxyUrl, siteUrl: siteUrl! };
}

/** True once the required production vars are present — the app's own
 *  "am I configured for the real backend, or should I fall back to the
 *  mock preview" check (used only alongside `SHOW_MOCK_CONTROLS`; see
 *  src/main.tsx). Never throws. */
export function hasTenEnv(source: Record<string, string | undefined>): boolean {
  try {
    readEnv(source);
    return true;
  } catch {
    return false;
  }
}
