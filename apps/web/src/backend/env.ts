// Reads and validates the production env vars (docs/plan-portable-skills-and-web-agent.md
// step 5b, item 5): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (publishable),
// VITE_SITE_URL, VITE_MODEL_PROXY_URL (default derived from the Supabase
// URL + /functions/v1/ten-model-proxy). Nothing here is a secret: the anon
// key is meant to ship in the client bundle (it's what RLS is for).
//
// § 13.2 (amended 2026-09-24): VITE_COACH_MODEL, a Vercel Production
// build-time setting — unset/blank -> Claude (the measured model, the
// fallback: "a missing setting never changes the model"); exactly one of
// the two ids (trimmed) -> that id; anything else -> readEnv fails the
// same way a missing required var does (never a silent fallback, so a
// typo can't make the owner think DeepSeek is running when it isn't).
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
import { CLAUDE_COACH_MODEL, coachModelFor, type CoachModel } from "./coach-model.ts";

export interface TenEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** `ten-model-proxy`'s base URL — the provider appends `/chat/completions`. */
  modelProxyUrl: string;
  /** Read here only to VALIDATE it's present up front; auth.ts's own
   *  siteRedirectUrl() is still what actually builds `redirectTo`. */
  siteUrl: string;
  /** § 13.2 — the build-time model setting. Always resolved: unset/blank
   *  input becomes CLAUDE_COACH_MODEL (§ 13.2's "a missing setting never
   *  changes the model"); an unrecognized value fails readEnv entirely
   *  (below), so this field is never itself invalid. */
  coachModel: CoachModel;
  /** § 17.1: the PUBLIC PayPal JS SDK client id (`VITE_PAYPAL_CLIENT_ID`).
   *  Deliberately NOT in the required-vars list below — unlike Supabase's
   *  own vars, buying credit is a member-only ADDITION (§ 17.2), never
   *  load-bearing for the chat itself, so a blank value never fails the
   *  whole app's boot. The Buy-credit dialog itself refuses to open (or
   *  load the SDK) when this is empty, showing a plain "can't start a
   *  payment right now" line instead. */
  paypalClientId: string;
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
 *  absent means "derive it". § 13.2: `VITE_COACH_MODEL` is resolved here
 *  too — unset/blank resolves to Claude (never treated as "missing"; the
 *  var itself stays optional), but an UNRECOGNIZED value is pushed onto
 *  the same `missing` list under the var's own name, so it fails exactly
 *  like a missing required var (the existing config-error screen already
 *  names whatever's in `missing`) rather than a special-cased message. */
export function readEnv(source: Record<string, string | undefined>): TenEnv {
  const supabaseUrl = source.VITE_SUPABASE_URL?.trim();
  const supabaseAnonKey = source.VITE_SUPABASE_ANON_KEY?.trim();
  const siteUrl = source.VITE_SITE_URL?.trim();
  const coachModelRaw = source.VITE_COACH_MODEL?.trim();
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!supabaseAnonKey) missing.push("VITE_SUPABASE_ANON_KEY");
  if (!siteUrl) missing.push("VITE_SITE_URL");

  let coachModel: CoachModel = CLAUDE_COACH_MODEL;
  if (coachModelRaw) {
    const found = coachModelFor(coachModelRaw);
    if (found) coachModel = found;
    else missing.push("VITE_COACH_MODEL");
  }
  if (missing.length > 0) throw new MissingEnvError(missing);

  const modelProxyUrl = source.VITE_MODEL_PROXY_URL?.trim() || defaultModelProxyUrl(supabaseUrl!);
  const paypalClientId = source.VITE_PAYPAL_CLIENT_ID?.trim() ?? "";
  return {
    supabaseUrl: supabaseUrl!.replace(/\/+$/, ""),
    supabaseAnonKey: supabaseAnonKey!,
    modelProxyUrl,
    siteUrl: siteUrl!,
    coachModel,
    paypalClientId,
  };
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
