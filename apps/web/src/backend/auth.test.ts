// Unit tests for auth.ts (docs/design-web-agent.md § 8) against a fake
// AuthClientLike — no network, no real Supabase project, no
// window/document/localStorage.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_PASSWORD_LENGTH,
  NON_MEMBER_MESSAGE,
  type AuthClientLike,
  accessTokenFrom,
  authRedirectFromUrl,
  checkMembership,
  createTenAuthClient,
  passwordErrorMessage,
  requestPasswordReset,
  resetPasswordEnumerationSafeLine,
  sendReauthenticationCode,
  setNewPassword,
  signInWithMagicLink,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  siteRedirectUrl,
} from "./auth.ts";

function fakeClient(overrides: Partial<AuthClientLike["auth"]> = {}, rpcImpl?: AuthClientLike["rpc"]): AuthClientLike {
  return {
    auth: {
      signInWithOtp: async () => ({ error: null }),
      signInWithPassword: async () => ({ error: null, data: { session: null } }),
      signUp: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
      reauthenticate: async () => ({ error: null }),
      ...overrides,
    },
    rpc: rpcImpl ?? (async () => ({ data: null, error: null })),
  };
}

// ---------------------------------------------------------------------
// siteRedirectUrl — § 8's "every auth link passes redirectTo"
// ---------------------------------------------------------------------

test("siteRedirectUrl: with no VITE_SITE_URL set, throws (never silently guesses)", () => {
  assert.throws(() => siteRedirectUrl(), /VITE_SITE_URL/);
});

// L4 (fix round 1): never falls back to a passed origin, even when
// VITE_SITE_URL is unset — a page origin isn't necessarily in Supabase
// Auth's Redirect URLs allowlist.
test("siteRedirectUrl: an origin argument is ignored entirely — still throws with VITE_SITE_URL unset", () => {
  assert.throws(() => siteRedirectUrl("http://localhost:5173"), /VITE_SITE_URL/);
});

// ---------------------------------------------------------------------
// Sign-in flows
// ---------------------------------------------------------------------

test("signInWithMagicLink: passes email + emailRedirectTo, returns ok on success", async () => {
  let seenArgs: unknown;
  const client = fakeClient({
    signInWithOtp: async (args) => {
      seenArgs = args;
      return { error: null };
    },
  });
  const result = await signInWithMagicLink(client, "alex@example.com", "https://ten.example/auth");
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(seenArgs, { email: "alex@example.com", options: { emailRedirectTo: "https://ten.example/auth" } });
});

test("signInWithMagicLink: surfaces the error message on failure", async () => {
  const client = fakeClient({ signInWithOtp: async () => ({ error: { message: "rate limited" } }) });
  const result = await signInWithMagicLink(client, "alex@example.com", "https://ten.example/auth");
  assert.deepEqual(result, { ok: false, error: "rate limited" });
});

test("signInWithPassword: ok on success, error surfaced on failure", async () => {
  const ok = fakeClient({ signInWithPassword: async () => ({ error: null, data: { session: null } }) });
  assert.deepEqual(await signInWithPassword(ok, "a@example.com", "hunter2"), { ok: true });

  const bad = fakeClient({ signInWithPassword: async () => ({ error: { message: "invalid credentials" }, data: { session: null } }) });
  assert.deepEqual(await signInWithPassword(bad, "a@example.com", "wrong"), { ok: false, error: "invalid credentials" });
});

test("signUpWithPassword: passes emailRedirectTo too (§ 8: every auth link)", async () => {
  let seenArgs: unknown;
  const client = fakeClient({
    signUp: async (args) => {
      seenArgs = args;
      return { error: null };
    },
  });
  await signUpWithPassword(client, "new@example.com", "hunter2", "https://ten.example/auth");
  assert.deepEqual(seenArgs, { email: "new@example.com", password: "hunter2", options: { emailRedirectTo: "https://ten.example/auth" } });
});

test("signOut: ok on success, error surfaced on failure", async () => {
  const ok = fakeClient({ signOut: async () => ({ error: null }) });
  assert.deepEqual(await signOut(ok), { ok: true });
  const bad = fakeClient({ signOut: async () => ({ error: { message: "network" } }) });
  assert.deepEqual(await signOut(bad), { ok: false, error: "network" });
});

// ---------------------------------------------------------------------
// accessTokenFrom — feeds SupabaseWorkspaceStoreOptions.accessToken
// ---------------------------------------------------------------------

test("accessTokenFrom: returns the session's access_token", async () => {
  const client = fakeClient({
    getSession: async () => ({ data: { session: { access_token: "jwt-123" } as any }, error: null }),
  });
  const token = await accessTokenFrom(client)();
  assert.equal(token, "jwt-123");
});

test("accessTokenFrom: throws 'not signed in' with no session", async () => {
  const client = fakeClient({ getSession: async () => ({ data: { session: null }, error: null }) });
  await assert.rejects(accessTokenFrom(client)(), /not signed in/);
});

test("accessTokenFrom: throws on a getSession error", async () => {
  const client = fakeClient({ getSession: async () => ({ data: { session: null }, error: { message: "boom" } }) });
  await assert.rejects(accessTokenFrom(client)(), /boom/);
});

// ---------------------------------------------------------------------
// checkMembership / NON_MEMBER_MESSAGE — § 8
// ---------------------------------------------------------------------

test("checkMembership: true when ten_is_member() returns true", async () => {
  const client = fakeClient({}, async (fn) => {
    assert.equal(fn, "ten_is_member");
    return { data: true, error: null };
  });
  assert.equal(await checkMembership(client), true);
});

test("checkMembership: false when ten_is_member() returns false", async () => {
  const client = fakeClient({}, async () => ({ data: false, error: null }));
  assert.equal(await checkMembership(client), false);
});

test("checkMembership: throws (does not silently say non-member) on an RPC error", async () => {
  const client = fakeClient({}, async () => ({ data: null, error: { message: "network down" } }));
  await assert.rejects(checkMembership(client), /network down/);
});

test("NON_MEMBER_MESSAGE is the exact § 8 wording", () => {
  assert.equal(NON_MEMBER_MESSAGE, "You're signed in, but this beta is invite-only. Ask the person who invited you to add you.");
});

// ---------------------------------------------------------------------
// createTenAuthClient — a smoke test only (no network): must not throw
// under plain Node (no window/localStorage available) when constructed
// with persistSession disabled, matching how the live verify script
// and any server-side use would construct it.
// ---------------------------------------------------------------------

test("createTenAuthClient: constructing the client does not throw under Node", () => {
  assert.doesNotThrow(() => createTenAuthClient({ url: "https://project.supabase.co", anonKey: "anon-key" }));
});

// ---------------------------------------------------------------------
// § 16 — setting and resetting a password
// ---------------------------------------------------------------------

test("MIN_PASSWORD_LENGTH is 8 (§ 16.1's one number in code)", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
});

test("authRedirectFromUrl: type=recovery in the hash is 'recovery'", () => {
  assert.equal(authRedirectFromUrl("https://ten.example/#access_token=abc&type=recovery"), "recovery");
});

test("authRedirectFromUrl: type=recovery in the query is 'recovery'", () => {
  assert.equal(authRedirectFromUrl("https://ten.example/?type=recovery"), "recovery");
});

test("authRedirectFromUrl: error_code in the hash is 'link-error'", () => {
  assert.equal(authRedirectFromUrl("https://ten.example/#error=access_denied&error_code=otp_expired"), "link-error");
});

test("authRedirectFromUrl: error_code in the query is 'link-error'", () => {
  assert.equal(authRedirectFromUrl("https://ten.example/?error_code=otp_expired"), "link-error");
});

test("authRedirectFromUrl: an error_code alongside type=recovery is still 'link-error' (the error wins — an expired recovery link is still an expired link)", () => {
  assert.equal(authRedirectFromUrl("https://ten.example/#type=recovery&error_code=otp_expired"), "link-error");
});

test("authRedirectFromUrl: a plain URL, or an unparseable one, is 'none'", () => {
  assert.equal(authRedirectFromUrl("https://ten.example/"), "none");
  assert.equal(authRedirectFromUrl("not a url"), "none");
});

test("setNewPassword: calls updateUser with EXACTLY { password } when no nonce is given", async () => {
  let seen: unknown;
  const client = fakeClient({ updateUser: async (a) => (seen = a, { error: null }) });
  const result = await setNewPassword(client, "hunter22");
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(seen, { password: "hunter22" });
});

test("setNewPassword: with a nonce, calls updateUser with EXACTLY { password, nonce }", async () => {
  let seen: unknown;
  const client = fakeClient({ updateUser: async (a) => (seen = a, { error: null }) });
  await setNewPassword(client, "hunter22", "123456");
  assert.deepEqual(seen, { password: "hunter22", nonce: "123456" });
});

test("setNewPassword: surfaces code/status/reasons on failure, never the raw message", async () => {
  const client = fakeClient({
    updateUser: async () => ({ error: { message: "raw text never shown", code: "weak_password", status: 422, reasons: ["length"] } }),
  });
  const result = await setNewPassword(client, "short");
  assert.deepEqual(result, { ok: false, code: "weak_password", status: 422, reasons: ["length"] });
});

test("sendReauthenticationCode: calls reauthenticate() with no arguments", async () => {
  let called = 0;
  const client = fakeClient({ reauthenticate: async () => (called++, { error: null }) });
  const result = await sendReauthenticationCode(client);
  assert.deepEqual(result, { ok: true });
  assert.equal(called, 1);
});

test("sendReauthenticationCode: surfaces code/status on failure", async () => {
  const client = fakeClient({ reauthenticate: async () => ({ error: { message: "raw", code: "over_email_send_rate_limit", status: 429 } }) });
  assert.deepEqual(await sendReauthenticationCode(client), { ok: false, code: "over_email_send_rate_limit", status: 429 });
});

test("requestPasswordReset: calls resetPasswordForEmail(email, { redirectTo }) exactly", async () => {
  let seenEmail: unknown;
  let seenOptions: unknown;
  const client = fakeClient({
    resetPasswordForEmail: async (email, options) => ((seenEmail = email), (seenOptions = options), { error: null }),
  });
  const result = await requestPasswordReset(client, "a@example.com", "https://ten.example/auth");
  assert.deepEqual(result, { ok: true });
  assert.equal(seenEmail, "a@example.com");
  assert.deepEqual(seenOptions, { redirectTo: "https://ten.example/auth" });
});

test("requestPasswordReset: surfaces status on failure (a 429 is checked by the caller, never turned into a different line here)", async () => {
  const client = fakeClient({ resetPasswordForEmail: async () => ({ error: { message: "raw", code: "over_email_send_rate_limit", status: 429 } }) });
  assert.deepEqual(await requestPasswordReset(client, "a@example.com", "https://ten.example/auth"), {
    ok: false,
    code: "over_email_send_rate_limit",
    status: 429,
  });
});

// design-web-ui.md § 1.10's error table, one test per row, word for word.
test("passwordErrorMessage: the § 1.10 table, word for word, plus the fallback", () => {
  assert.equal(
    passwordErrorMessage({ code: "reauthentication_not_valid" }),
    "That code didn't work. It may be mistyped or expired: check the newest email, or send a new code.",
  );
  assert.equal(
    passwordErrorMessage({ code: "weak_password", reasons: ["length"] }),
    "That password is too short for the sign-in rules. Try a longer one.",
  );
  assert.equal(
    passwordErrorMessage({ code: "weak_password", reasons: ["characters"] }),
    "That password needs more kinds of characters, such as capitals, digits or symbols.",
  );
  assert.equal(
    passwordErrorMessage({ code: "weak_password", reasons: ["pwned"] }),
    "That password has appeared in a known data leak. Choose a different one.",
  );
  assert.equal(passwordErrorMessage({ code: "same_password" }), "That's already your password. Choose a different one.");
  assert.equal(passwordErrorMessage({ status: 429 }), "Too many tries. Wait a minute, then try again.");
  assert.equal(passwordErrorMessage({}), "Couldn't save your password. Try again in a moment.");
  assert.equal(passwordErrorMessage({ code: "something_else", status: 500 }), "Couldn't save your password. Try again in a moment.");
});

// ---------------------------------------------------------------------
// Enumeration-safe copy (§ 1.10: "After a success OR a 429, the same
// text, character for character" — no other line may depend on whether
// the account exists).
// ---------------------------------------------------------------------

test("resetPasswordEnumerationSafeLine: byte-identical whether or not an account exists — the caller supplies only the email", () => {
  const hasAccount = resetPasswordEnumerationSafeLine("real@example.com");
  const noAccount = resetPasswordEnumerationSafeLine("real@example.com");
  assert.equal(hasAccount, noAccount);
  assert.equal(
    hasAccount,
    "If an account exists for real@example.com, a link to choose a new password should arrive within a few minutes. " +
      "Check spam too. Only a few emails can be sent each hour, so if nothing comes, try again later.",
  );
});
