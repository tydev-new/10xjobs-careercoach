// Auth — sign-in and membership detection (docs/design-web-agent.md § 8),
// plus setting and resetting a password (§ 16).
//
// One way to sign in (§ 16.5, 2026-10-07): email and password. The sign-in
// card makes three calls and no others: signInWithPassword, signUp and
// resetPasswordForEmail. A still-valid emailed sign-in link that someone
// opens lands as an ordinary session; nothing here blocks it.
//
// Uses @supabase/supabase-js (pinned 2.58.0) for session management: it
// handles the password flow, token refresh, and storing the
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
 *  emailed-link redirect's token from the URL on load (a reset, a sign-up
 *  confirmation, or an old sign-in link). */
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

// § 16.1: the shape of a real Supabase AuthError as it reaches this file —
// `.code` (e.g. "reauthentication_needed", "weak_password", "same_password")
// and `.status` (e.g. 429) come straight off `@supabase/auth-js`'s own
// `AuthError`; `.reasons` only ever appears on a `weak_password` error
// (`AuthWeakPasswordError`). Never read `.message` on these screens (§
// 16.2 — "Shown errors come from § 1.10's table, never error.message").
export interface AuthErrorLike {
  message: string;
  code?: string;
  /** the legacy spelling of `code`, if a response carries it (read by the sign-in error map only) */
  error_code?: string;
  status?: number;
  reasons?: string[];
}

// A minimal structural subset of SupabaseClient's auth surface — lets the
// sign-in/membership functions below be unit-tested against a small fake,
// with no real network and no localStorage, while the real SupabaseClient
// (a strict superset) satisfies it unchanged.
export interface AuthClientLike {
  auth: {
    signInWithPassword(args: { email: string; password: string }): Promise<{ error: AuthErrorLike | null; data: { session: Session | null } }>;
    signUp(args: {
      email: string;
      password: string;
      options?: { emailRedirectTo?: string };
    }): Promise<{ error: { message: string } | null }>;
    signOut(): Promise<{ error: { message: string } | null }>;
    getSession(): Promise<{ data: { session: Session | null }; error: { message: string } | null }>;
    // § 16.1's three additions — the real client already has them; only
    // the (structural) shape used here is declared.
    resetPasswordForEmail(email: string, options: { redirectTo: string }): Promise<{ error: AuthErrorLike | null }>;
    updateUser(attributes: { password: string; nonce?: string }): Promise<{ error: AuthErrorLike | null }>;
    reauthenticate(): Promise<{ error: AuthErrorLike | null }>;
  };
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
}

/** design-web-ui.md § 5.3.1 Y12, word for word: the email and password don't
 *  match (Supabase's `invalid_credentials`). Never Supabase's own text. */
export const SIGN_IN_INVALID_CREDENTIALS_LINE =
  "That email and password don't match. Try again, or choose a new password with the link under the password field.";

/** § 5.3.1 Y13, word for word: the email isn't confirmed yet
 *  (`email_not_confirmed`). The reset link confirms the address too (C § 16.5). */
export const SIGN_IN_UNCONFIRMED_LINE =
  "Confirm your email first: open the link we sent, then sign in. If you can't find it, choose a new password with the link under the password field: that confirms your email too.";

/** The sign-in card's error map, MINIMUM scope of § 1.4's 2026-10-07 list: Y12
 *  and Y13 only, so a person locked out is told the way in. Every other error
 *  still shows Supabase's own message, as before (Y14-Y16, Y44-Y46 and Y48 are
 *  the Stage 4 build's). */
function signInErrorText(error: AuthErrorLike): string {
  // The same refusal can arrive in more than one shape: the code on `.code` (the API-version-2024 shape),
  // the same value on `.error_code` (the legacy shape), or with no code at all and only Supabase's own
  // message. All three give Y12 / Y13, so Supabase's words never show for these two cases.
  const code = error.code ?? error.error_code;
  const message = (error.message ?? "").trim().toLowerCase();
  if (code === "invalid_credentials" || message === "invalid login credentials") return SIGN_IN_INVALID_CREDENTIALS_LINE;
  if (code === "email_not_confirmed" || message === "email not confirmed") return SIGN_IN_UNCONFIRMED_LINE;
  return error.message;
}

/** Password sign-in for an existing account. */
export async function signInWithPassword(client: AuthClientLike, email: string, password: string): Promise<AuthResult> {
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error ? { ok: false, error: signInErrorText(error) } : { ok: true };
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

/** design-web-ui.md § 5.3.1 O6 — word for word: "this account has no credit
 *  row", outside the sign-in flow (an upload refused for membership). The
 *  model proxy's 403 carries the same words (C § 20.4). Replaces
 *  the retired "invite-only" line. */
export const NOT_SET_UP_MESSAGE = "This account isn't set up to use Ten yet. Sign out, then sign in again to check.";

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

/** C § 20.1: what `ten_claim_welcome()` answers. `granted` carries the
 *  amount the settings row set, so the screen never states a number the
 *  server didn't send (O1, rule 12). */
export type ClaimWelcomeResult =
  | { status: "granted"; usd: number }
  | { status: "already_member" | "paused" | "unconfirmed" | "already_claimed" };

/** C § 20.4: a non-member's one claim, `rpc("ten_claim_welcome")`. Throws on
 *  an RPC error, on a reply that isn't an object with a status from the list
 *  above, and on `granted` with no usable amount — never maps an unknown
 *  answer to a screen that says something untrue (the caller shows the setup
 *  error, Q1, with Retry, and the claim is safe to repeat). */
export async function claimWelcome(client: AuthClientLike): Promise<ClaimWelcomeResult> {
  const { data, error } = await client.rpc("ten_claim_welcome");
  if (error) throw new Error(`ten_claim_welcome() failed: ${error.message}`);
  const status = typeof data === "object" && data !== null ? (data as { status?: unknown }).status : undefined;
  switch (status) {
    case "already_member":
    case "paused":
    case "unconfirmed":
    case "already_claimed":
      return { status };
    case "granted": {
      const raw = (data as { usd?: unknown }).usd;
      const usd = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      if (!Number.isFinite(usd) || usd <= 0) throw new Error("ten_claim_welcome() granted with no usable amount");
      return { status: "granted", usd };
    }
    default:
      throw new Error(`ten_claim_welcome() answered an unexpected status: ${String(status)}`);
  }
}

// ---------------------------------------------------------------------
// § 16 — setting and resetting a password. Every call below goes only to
// Supabase Auth (§ 16: "No new table, Edge Function, secret or server
// code"). Nothing here touches window/document/localStorage — this file
// stays importable under plain Node (see the header note above).
// ---------------------------------------------------------------------

/** design-web-ui § 1.10's "at least 8 characters" — one number in code,
 *  used both by SignIn.tsx's sign-up field (`minLength`) and by every
 *  password-save call below (§ 16.1). */
export const MIN_PASSWORD_LENGTH = 8;

/** What `authRedirectFromUrl` found on the page's own URL. */
export type AuthUrlRedirect = "recovery" | "link-error" | "none";

/**
 * Pure (no window/document read — the CALLER passes `href`, e.g.
 * `window.location.href`): § 16.1 — "`recovery` when the hash or query has
 * `type=recovery`, `link-error` when it has `error_code`, else `none`."
 * A link error is checked first: an expired/used link can carry both an
 * `error_code` and other recovery-shaped params, and it's the error that
 * must win (§ 1.10's expired-link line applies to a recovery link too).
 */
export function authRedirectFromUrl(href: string): AuthUrlRedirect {
  let hash = "";
  let search = "";
  try {
    const url = new URL(href);
    hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    search = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  } catch {
    return "none";
  }
  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(search);
  const get = (key: string): string | null => hashParams.get(key) ?? searchParams.get(key);
  if (get("error_code")) return "link-error";
  if (get("type") === "recovery") return "recovery";
  return "none";
}

/** Query keys a Supabase redirect (a session, an error, a code) comes back with. */
const REDIRECT_QUERY_KEYS = ["code", "type", "error", "error_code", "error_description", "access_token"];

/**
 * design-web-ui.md § 1.4 (amended 2026-10-08): does this address ask the sign-in card to open on
 * Create an account? Pure (the caller passes `href`); the caller reads it once, at mount.
 *
 * Yes when the QUERY has a key spelled exactly `signup` (lower case; its value is not read, so
 * `?signup`, `?signup=` and `?signup=1` all count, in any position among other keys). No for another
 * spelling or case, the word as a value, `#signup`, and the path `/signup`. No whenever the address
 * also carries a Supabase redirect (anything after `#`, or a query key in REDIRECT_QUERY_KEYS): then
 * everything happens as it would without `signup`. Every other key on the link is never read.
 */
export function createAccountLinkFromUrl(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.hash.length > 1) return false;
  const query = new URLSearchParams(url.search);
  if (!query.has("signup")) return false;
  return !REDIRECT_QUERY_KEYS.some((k) => query.has(k));
}

/** The result of a password-save attempt (`updateUser`) or a
 *  reauthentication-code send/resend (`reauthenticate`) — never the raw
 *  `AuthError`, so every caller is forced through `passwordErrorMessage`
 *  rather than ever touching `.message` (§ 16.2). */
export interface PasswordCallResult {
  ok: boolean;
  code?: string;
  status?: number;
  reasons?: string[];
}

/** § 16.1 "Set a new password": `updateUser({ password })`, or, once
 *  `reauthenticate()` has emailed a code, `updateUser({ password, nonce })`.
 *  Supabase's User object has no "has a password" field (hence the one
 *  menu label design-web-ui § 1.10 describes) — this function doesn't try
 *  to detect one either. */
export async function setNewPassword(client: AuthClientLike, password: string, nonce?: string): Promise<PasswordCallResult> {
  const { error } = await client.auth.updateUser(nonce === undefined ? { password } : { password, nonce });
  if (!error) return { ok: true };
  return { ok: false, code: error.code, status: error.status, reasons: error.reasons };
}

/** § 16.1 "Secure password change": emails a 6-digit reauthentication code.
 *  Used both for the first send (after `updateUser` answers
 *  `reauthentication_needed`) and for "Send a new code" (design-web-ui §
 *  1.10's code step). */
export async function sendReauthenticationCode(client: AuthClientLike): Promise<PasswordCallResult> {
  const { error } = await client.auth.reauthenticate();
  if (!error) return { ok: true };
  return { ok: false, code: error.code, status: error.status };
}

/** § 16.1 "Forgot": `resetPasswordForEmail(email, { redirectTo })`. Supabase
 *  answers no differently whether or not an account exists (its own
 *  password guide) — the enumeration-safe copy lives in the UI (design-web-
 *  ui § 1.10), keyed off `ok` and `status === 429` both rendering the same
 *  line. */
export async function requestPasswordReset(client: AuthClientLike, email: string, redirectTo: string): Promise<PasswordCallResult> {
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (!error) return { ok: true };
  return { ok: false, code: error.code, status: error.status };
}

/** design-web-ui § 1.10, word for word: "After a success OR a 429, the
 *  same text, character for character... No other line may depend on
 *  whether the account exists." The caller decides WHEN to show this
 *  (`result.ok || result.status === 429`); this only owns the sentence. */
export function resetPasswordEnumerationSafeLine(email: string): string {
  return (
    `If an account exists for ${email}, a link to choose a new password ` +
    "should arrive within a few minutes. Check spam too. Only a few emails " +
    "can be sent each hour, so if nothing comes, try again later."
  );
}

/** design-web-ui § 1.10's error table, word for word — the ONLY place any
 *  of these six lines are spelled out, and the only thing any password
 *  screen may render for a failed call. Never reads `.message` (§ 16.2). */
export function passwordErrorMessage(result: Pick<PasswordCallResult, "code" | "status" | "reasons">): string {
  if (result.code === "reauthentication_not_valid") {
    return "That code didn't work. It may be mistyped or expired: check the newest email, or send a new code.";
  }
  if (result.code === "weak_password") {
    const reasons = result.reasons ?? [];
    if (reasons.includes("length")) return "That password is too short for the sign-in rules. Try a longer one.";
    if (reasons.includes("characters")) return "That password needs more kinds of characters, such as capitals, digits or symbols.";
    if (reasons.includes("pwned")) return "That password has appeared in a known data leak. Choose a different one.";
  }
  if (result.code === "same_password") {
    return "That's already your password. Choose a different one.";
  }
  if (result.status === 429) {
    return "Too many tries. Wait a minute, then try again.";
  }
  return "Couldn't save your password. Try again in a moment.";
}
