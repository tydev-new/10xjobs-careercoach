// Auth — sign-in and membership detection (docs/design-web-agent.md § 8).
//
// Uses @supabase/supabase-js (pinned 2.58.0) for session management: it
// handles the magic-link / password flows, token refresh, and storing the
// session (in the browser, via its own localStorage adapter — this file
// itself touches no window/document/localStorage directly, so it stays
// importable and testable under plain Node; only createTenAuthClient()'s
// OWN internals reach into browser storage, and only when actually run in
// a browser).
//
// "The production URL comes later from env; use VITE_SITE_URL" (lead's
// instruction) — read once in siteRedirectUrl(), so the whole app has one
// source of truth for the `redirectTo` § 8 requires on every auth link.
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

export interface AuthOptions {
  url: string;
  anonKey: string;
}

/** The real client for the app to use. Session persistence + auto refresh
 *  on (the normal browser posture); `detectSessionInUrl` picks up the
 *  magic-link / OAuth-style redirect's token from the URL on load. */
export function createTenAuthClient(opts: AuthOptions): SupabaseClient {
  return createClient(opts.url, opts.anonKey, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
  });
}

/**
 * § 8: "every auth link passes redirectTo," and "the production URL...
 * goes in Auth's Redirect URLs" (an allowlist the owner maintains
 * separately, in the Supabase dashboard — not in code). `VITE_SITE_URL` is
 * the one env var this reads (set per Vercel environment); with no
 * `origin` fallback given and no env var set, this throws rather than
 * silently sending an auth link to the wrong place.
 */
// L4 (fix round 1, lead's ruling): siteRedirectUrl NEVER falls back to a
// passed origin — VITE_SITE_URL only, or throw. A page origin (e.g. a
// Vercel preview URL) is not necessarily in Supabase Auth's Redirect URLs
// allowlist, and falling back to it would send a real auth link somewhere
// the owner never approved. The parameter is kept (ignored) only so an
// existing call site isn't forced to change shape; nothing reads it.
export function siteRedirectUrl(_ignoredOrigin?: string): string {
  // Optional chaining on `import.meta.env` itself, not just the property:
  // under plain Node (this file's own unit tests), `import.meta.env` is
  // undefined — only Vite injects it. Reading `.VITE_SITE_URL` straight
  // off `undefined` would throw before the check below ever ran.
  const configured = (import.meta.env?.VITE_SITE_URL as string | undefined)?.trim();
  if (configured) return configured;
  throw new Error("siteRedirectUrl: VITE_SITE_URL is not set — refusing to guess redirectTo (§ 8).");
}

// A minimal structural subset of SupabaseClient's auth surface — lets the
// sign-in/membership functions below be unit-tested against a small fake,
// with no real network and no localStorage, while the real SupabaseClient
// (a strict superset) satisfies it unchanged.
export interface AuthClientLike {
  auth: {
    signInWithOtp(args: { email: string; options?: { emailRedirectTo?: string } }): Promise<{ error: { message: string } | null }>;
    signInWithPassword(args: { email: string; password: string }): Promise<{ error: { message: string } | null; data: { session: Session | null } }>;
    signUp(args: {
      email: string;
      password: string;
      options?: { emailRedirectTo?: string };
    }): Promise<{ error: { message: string } | null }>;
    signOut(): Promise<{ error: { message: string } | null }>;
    getSession(): Promise<{ data: { session: Session | null }; error: { message: string } | null }>;
  };
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
}

/** Magic-link sign-in (§ 8: "magic-link or email+password"). No password;
 *  the candidate clicks the emailed link, which lands back on `redirectTo`
 *  with a session. */
export async function signInWithMagicLink(client: AuthClientLike, email: string, redirectTo: string): Promise<AuthResult> {
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Password sign-in for an existing account. */
export async function signInWithPassword(client: AuthClientLike, email: string, password: string): Promise<AuthResult> {
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Password sign-up for a new account. Public sign-up is open (§ 8: "anyone
 *  on the internet can hold a signed-in session"); membership (a credit
 *  row) is the actual barrier, checked separately by `checkMembership`. */
export async function signUpWithPassword(
  client: AuthClientLike,
  email: string,
  password: string,
  redirectTo: string,
): Promise<AuthResult> {
  const { error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signOut(client: AuthClientLike): Promise<AuthResult> {
  const { error } = await client.auth.signOut();
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** The current session's access token, for `SupabaseWorkspaceStoreOptions.accessToken`
 *  (re-read per call so a refreshed token is always used). Throws if not signed in. */
export function accessTokenFrom(client: AuthClientLike): () => Promise<string> {
  return async () => {
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error(`getSession failed: ${error.message}`);
    if (!data.session) throw new Error("not signed in");
    return data.session.access_token;
  };
}

/** design-web-ui § 1.6 (canonical; contract § 8 quotes it) — word for word. */
export const NON_MEMBER_MESSAGE = "You're signed in, but this beta is invite-only. Ask the person who invited you to add you.";

/** Membership = has a credit row, per `ten_is_member()` (the migration's
 *  one definition — § 8, § 2). Throws on any RPC error (network, 401 for a
 *  stale/absent session, etc.) rather than treating an error as "not a
 *  member," so callers don't show the non-member message on, say, an
 *  offline blip. */
export async function checkMembership(client: AuthClientLike): Promise<boolean> {
  const { data, error } = await client.rpc("ten_is_member");
  if (error) throw new Error(`ten_is_member() failed: ${error.message}`);
  return data === true;
}
