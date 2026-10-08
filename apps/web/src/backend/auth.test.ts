// Unit tests for auth.ts (docs/design-web-agent.md § 8) against a fake
// AuthClientLike — no network, no real Supabase project, no
// window/document/localStorage.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_PASSWORD_LENGTH,
  NOT_SET_UP_MESSAGE,
  SIGN_IN_INVALID_CREDENTIALS_LINE,
  SIGN_IN_UNCONFIRMED_LINE,
  type AuthClientLike,
  accessTokenFrom,
  authRedirectFromUrl,
  checkMembership,
  claimWelcome,
  cleanPath,
  createAccountLinkFromUrl,
  createTenAuthClient,
  passwordErrorMessage,
  requestPasswordReset,
  resetPasswordEnumerationSafeLine,
  sendReauthenticationCode,
  setNewPassword,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  siteRedirectUrl,
} from "./auth.ts";

function fakeClient(overrides: Partial<AuthClientLike["auth"]> = {}, rpcImpl?: AuthClientLike["rpc"]): AuthClientLike {
  return {
    auth: {
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

test("signInWithPassword: ok on success, error surfaced on failure", async () => {
  const ok = fakeClient({ signInWithPassword: async () => ({ error: null, data: { session: null } }) });
  assert.deepEqual(await signInWithPassword(ok, "a@example.com", "hunter2"), { ok: true });

  // Any error but the two mapped ones still shows its own message, as before.
  const bad = fakeClient({ signInWithPassword: async () => ({ error: { message: "network down" }, data: { session: null } }) });
  assert.deepEqual(await signInWithPassword(bad, "a@example.com", "wrong"), { ok: false, error: "network down" });
});

test("signInWithPassword: invalid_credentials is Y12 and email_not_confirmed is Y13, never Supabase's own message", async () => {
  const fake = (code: string) =>
    fakeClient({ signInWithPassword: async () => ({ error: { message: `RAW-SUPABASE-${code}`, code, status: 400 }, data: { session: null } }) });
  const y12 = await signInWithPassword(fake("invalid_credentials"), "a@example.com", "wrong");
  assert.deepEqual(y12, { ok: false, error: SIGN_IN_INVALID_CREDENTIALS_LINE });
  const y13 = await signInWithPassword(fake("email_not_confirmed"), "a@example.com", "wrong");
  assert.deepEqual(y13, { ok: false, error: SIGN_IN_UNCONFIRMED_LINE });
  for (const r of [y12, y13]) assert.doesNotMatch(r.error ?? "", /RAW-SUPABASE/);
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

test("signInWithPassword: Y12 and Y13 also arrive as error_code, and as Supabase's own known message with no code (case-insensitive, trimmed)", async () => {
  const fake = (error: { message: string; code?: string; error_code?: string }) =>
    fakeClient({ signInWithPassword: async () => ({ error, data: { session: null } }) });
  const shapes: [string, { message: string; code?: string; error_code?: string }, string][] = [
    ["error_code, invalid", { message: "x", error_code: "invalid_credentials" }, SIGN_IN_INVALID_CREDENTIALS_LINE],
    ["error_code, unconfirmed", { message: "x", error_code: "email_not_confirmed" }, SIGN_IN_UNCONFIRMED_LINE],
    ["message only, invalid", { message: "Invalid login credentials" }, SIGN_IN_INVALID_CREDENTIALS_LINE],
    ["message only, shouting and padded", { message: "  INVALID LOGIN CREDENTIALS " }, SIGN_IN_INVALID_CREDENTIALS_LINE],
    ["message only, unconfirmed", { message: "Email not confirmed" }, SIGN_IN_UNCONFIRMED_LINE],
    ["message only, lower case and padded", { message: " email not confirmed\n" }, SIGN_IN_UNCONFIRMED_LINE],
  ];
  for (const [name, error, line] of shapes) assert.deepEqual(await signInWithPassword(fake(error), "a@example.com", "x"), { ok: false, error: line }, name);
  // every other error is left as it is: its own message, even next to a similar-looking one
  for (const message of ["Invalid login credentials for this project", "Email not confirmed yet", "network down"])
    assert.deepEqual(await signInWithPassword(fake({ message }), "a@example.com", "x"), { ok: false, error: message }, message);
  assert.deepEqual(await signInWithPassword(fake({ message: "over limit", code: "over_request_rate_limit" }), "a@example.com", "x"), { ok: false, error: "over limit" });
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
// checkMembership / NOT_SET_UP_MESSAGE — § 8, C § 20.4
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

// design-web-ui.md § 5.3.1 O6, word for word (C § 20.4); the old "invite-only"
// line is retired and must not come back.
test("NOT_SET_UP_MESSAGE is O6, word for word, and says nothing of invitations", () => {
  assert.equal(NOT_SET_UP_MESSAGE, "This account isn't set up to use Ten yet. Sign out, then sign in again to check.");
  assert.doesNotMatch(NOT_SET_UP_MESSAGE, /invite/i);
});

// ---------------------------------------------------------------------
// claimWelcome — C § 20.4: one rpc("ten_claim_welcome"), each status mapped
// ---------------------------------------------------------------------

test("claimWelcome: calls rpc('ten_claim_welcome') with no argument; granted carries the amount", async () => {
  const calls: Array<[string, unknown]> = [];
  const client = fakeClient({}, async (fn, args) => {
    calls.push([fn, args]);
    return { data: { status: "granted", usd: 1 }, error: null };
  });
  assert.deepEqual(await claimWelcome(client), { status: "granted", usd: 1 });
  assert.deepEqual(calls, [["ten_claim_welcome", undefined]]);
});

test("claimWelcome: the amount is the reply's own (2.5 stays 2.5; a numeric string is read as a number)", async () => {
  assert.deepEqual(await claimWelcome(fakeClient({}, async () => ({ data: { status: "granted", usd: 2.5 }, error: null }))), { status: "granted", usd: 2.5 });
  assert.deepEqual(await claimWelcome(fakeClient({}, async () => ({ data: { status: "granted", usd: "2.50" }, error: null }))), { status: "granted", usd: 2.5 });
});

test("claimWelcome: already_member, paused, unconfirmed and already_claimed come back as themselves", async () => {
  for (const status of ["already_member", "paused", "unconfirmed", "already_claimed"] as const) {
    const client = fakeClient({}, async () => ({ data: { status }, error: null }));
    assert.deepEqual(await claimWelcome(client), { status });
  }
});

test("claimWelcome: an RPC error throws (the caller shows Q1 and Retry), never a refusal", async () => {
  const client = fakeClient({}, async () => ({ data: null, error: { message: "network down" } }));
  await assert.rejects(claimWelcome(client), /network down/);
});

test("claimWelcome: a status not on the list, no reply, or a non-object reply throws (Q1), never guesses a screen", async () => {
  for (const data of [{ status: "banana" }, { status: 7 }, {}, null, "granted", true, [], { status: "granted" }, { status: "granted", usd: 0 }, { status: "granted", usd: -1 }, { status: "granted", usd: "abc" }, { status: "granted", usd: null }]) {
    const client = fakeClient({}, async () => ({ data, error: null }));
    await assert.rejects(claimWelcome(client), /ten_claim_welcome/, JSON.stringify(data));
  }
});

test("claimWelcome: makes exactly one call per invocation (a retry runs the whole check again, so the caller repeats it)", async () => {
  let n = 0;
  const client = fakeClient({}, async () => {
    n++;
    return { data: { status: "paused" }, error: null };
  });
  await claimWelcome(client);
  assert.equal(n, 1);
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

// ---------------------------------------------------------------------
// createAccountLinkFromUrl — design-web-ui.md § 1.4 (2026-10-08), proof item 3
// ---------------------------------------------------------------------

const SITE = "https://ten-coach.vercel.app";

test("createAccountLinkFromUrl: yes for a query key spelled exactly `signup`, whatever its value or position", () => {
  for (const q of ["/?signup", "/?signup=", "/?signup=1", "/?signup=0", "/?utm_source=x&signup&ref=y", "/?a=1&signup=zzz&b=2", "/index.html?signup"])
    assert.equal(createAccountLinkFromUrl(SITE + q), true, q);
  assert.equal(createAccountLinkFromUrl("http://127.0.0.1:5173/?signup"), true);
  // an empty hash is not "anything after #"
  assert.equal(createAccountLinkFromUrl(SITE + "/?signup#"), true);
});

test("createAccountLinkFromUrl: no for another spelling or case, the word as a value, #signup and the path /signup", () => {
  for (const q of ["/", "", "/?Signup", "/?SIGNUP", "/?sign-up", "/?signup2", "/?asignup", "/?create", "/?view=signup", "/#signup", "/signup", "/signup/", "/?utm_source=x"])
    assert.equal(createAccountLinkFromUrl(SITE + q), false, q);
});

test("createAccountLinkFromUrl: no whenever the address also carries a Supabase redirect", () => {
  for (const q of [
    "/?signup#access_token=a&type=signup",
    "/?signup#error_code=otp_expired",
    "/?signup#anything",
    "/?signup&code=a",
    "/?signup&type=recovery",
    "/?signup&type=signup",
    "/?signup&error=access_denied",
    "/?signup&error_code=otp_expired",
    "/?signup&error_description=x",
    "/?signup&access_token=a",
    "/?code=a&signup",
  ])
    assert.equal(createAccountLinkFromUrl(SITE + q), false, q);
});

test("createAccountLinkFromUrl: an address that is not a URL answers no, and the function reads no tag", () => {
  assert.equal(createAccountLinkFromUrl("not a url"), false);
  assert.equal(createAccountLinkFromUrl(""), false);
  // the tags only ride along: the answer is the same with or without them
  assert.equal(createAccountLinkFromUrl(SITE + "/?signup&utm_source=A&utm_campaign=B&ref=C"), createAccountLinkFromUrl(SITE + "/?signup"));
});

test("cleanPath: a run of leading slashes becomes one; a normal path is untouched", () => {
  assert.equal(cleanPath("/"), "/");
  assert.equal(cleanPath("//"), "/");
  assert.equal(cleanPath("///x"), "/x");
  assert.equal(cleanPath("//index.html"), "/index.html");
  assert.equal(cleanPath("/index.html"), "/index.html");
  assert.equal(cleanPath("/a//b"), "/a//b");
  assert.equal(cleanPath(""), "/");
});
