// Unit tests for auth.ts (docs/design-web-agent.md § 8) against a fake
// AuthClientLike — no network, no real Supabase project, no
// window/document/localStorage.
import assert from "node:assert/strict";
import test from "node:test";
import {
  NON_MEMBER_MESSAGE,
  type AuthClientLike,
  accessTokenFrom,
  checkMembership,
  createTenAuthClient,
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
      ...overrides,
    },
    rpc: rpcImpl ?? (async () => ({ data: null, error: null })),
  };
}

// ---------------------------------------------------------------------
// siteRedirectUrl — § 8's "every auth link passes redirectTo"
// ---------------------------------------------------------------------

test("siteRedirectUrl: with no VITE_SITE_URL and no origin given, throws (never silently guesses)", () => {
  assert.throws(() => siteRedirectUrl(), /VITE_SITE_URL/);
});

test("siteRedirectUrl: falls back to the given origin when VITE_SITE_URL is unset", () => {
  assert.equal(siteRedirectUrl("http://localhost:5173"), "http://localhost:5173");
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
  assert.equal(NON_MEMBER_MESSAGE, "Ten is in a private beta. Ask the person who invited you for access.");
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
