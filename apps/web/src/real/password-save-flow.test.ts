// Unit tests for the password-save orchestration (design-web-agent.md
// § 16.1, design-web-ui.md § 1.10) against a fake AuthClientLike — no
// network, no window/document/localStorage.
import assert from "node:assert/strict";
import test from "node:test";
import type { AuthClientLike } from "../backend/auth.ts";
import { resendReauthenticationCode, savePassword } from "./password-save-flow.ts";

function fakeClient(overrides: Partial<AuthClientLike["auth"]> = {}): AuthClientLike {
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
    rpc: async () => ({ data: null, error: null }),
  };
}

// ---------------------------------------------------------------------
// § 1.10's two checked-before-any-call lines — no call made.
// ---------------------------------------------------------------------

test("savePassword: a 7-character password makes NO call, gives the length line", async () => {
  let called = false;
  const client = fakeClient({ updateUser: async () => ((called = true), { error: null }) });
  const outcome = await savePassword(client, { password: "short12", confirm: "short12", phase: "form", code: "" });
  assert.deepEqual(outcome, { kind: "invalid", error: "Use at least 8 characters." });
  assert.equal(called, false);
});

test("savePassword: a mismatch (both 8+ chars) makes NO call, gives the mismatch line", async () => {
  let called = false;
  const client = fakeClient({ updateUser: async () => ((called = true), { error: null }) });
  const outcome = await savePassword(client, { password: "longenough1", confirm: "longenough2", phase: "form", code: "" });
  assert.deepEqual(outcome, { kind: "invalid", error: "The two passwords don't match." });
  assert.equal(called, false);
});

test("savePassword: a mismatch AND a 7-character password still makes no call (§ 16.4 test plan 1)", async () => {
  let called = false;
  const client = fakeClient({ updateUser: async () => ((called = true), { error: null }) });
  const outcome = await savePassword(client, { password: "short", confirm: "different", phase: "form", code: "" });
  assert.equal(outcome.kind, "invalid");
  assert.equal(called, false);
});

// ---------------------------------------------------------------------
// Reauth mode 1: secure change OFF, or a fresh session — updateUser saves
// directly, called with EXACTLY { password } (no nonce field at all).
// ---------------------------------------------------------------------

test("savePassword: secure change off (or a fresh session) — updateUser called once with exactly { password }", async () => {
  let calls = 0;
  let seen: unknown;
  const client = fakeClient({
    updateUser: async (a) => {
      calls++;
      seen = a;
      return { error: null };
    },
  });
  const outcome = await savePassword(client, { password: "hunter222", confirm: "hunter222", phase: "form", code: "" });
  assert.deepEqual(outcome, { kind: "saved" });
  assert.equal(calls, 1);
  assert.deepEqual(seen, { password: "hunter222" });
});

// ---------------------------------------------------------------------
// Reauth mode 2: secure change ON, an older session — updateUser answers
// reauthentication_needed, then reauthenticate() sends the code, then a
// retry with the nonce.
// ---------------------------------------------------------------------

test("savePassword: reauthentication_needed calls reauthenticate() once and moves to the code step", async () => {
  let reauthCalls = 0;
  const client = fakeClient({
    updateUser: async () => ({ error: { message: "raw", code: "reauthentication_needed" } }),
    reauthenticate: async () => {
      reauthCalls++;
      return { error: null };
    },
  });
  const outcome = await savePassword(client, { password: "hunter222", confirm: "hunter222", phase: "form", code: "" });
  assert.deepEqual(outcome, { kind: "needs-code", sent: true });
  assert.equal(reauthCalls, 1);
});

test("savePassword: reauthenticate() itself failing surfaces its own mapped line, stays needs-code/sent:false", async () => {
  const client = fakeClient({
    updateUser: async () => ({ error: { message: "raw", code: "reauthentication_needed" } }),
    reauthenticate: async () => ({ error: { message: "raw", status: 429 } }),
  });
  const outcome = await savePassword(client, { password: "hunter222", confirm: "hunter222", phase: "form", code: "" });
  assert.deepEqual(outcome, { kind: "needs-code", sent: false, error: "Too many tries. Wait a minute, then try again." });
});

test("savePassword: the code step retries with EXACTLY { password, nonce }; a wrong code gives its own line and never reaches 'saved'", async () => {
  let seen: unknown;
  const client = fakeClient({
    updateUser: async (a) => {
      seen = a;
      return "nonce" in a
        ? { error: { message: "raw", code: "reauthentication_not_valid" } }
        : { error: { message: "raw", code: "reauthentication_needed" } };
    },
  });
  const outcome = await savePassword(client, { password: "hunter222", confirm: "hunter222", phase: "code", code: "000000" });
  assert.deepEqual(seen, { password: "hunter222", nonce: "000000" });
  assert.deepEqual(outcome, {
    kind: "error",
    error: "That code didn't work. It may be mistyped or expired: check the newest email, or send a new code.",
  });
});

test("savePassword: the code step with the right code saves — { password, nonce }", async () => {
  const client = fakeClient({ updateUser: async () => ({ error: null }) });
  const outcome = await savePassword(client, { password: "hunter222", confirm: "hunter222", phase: "code", code: "123456" });
  assert.deepEqual(outcome, { kind: "saved" });
});

// ---------------------------------------------------------------------
// Every other error code gives its § 1.10 line — never a fake's own
// error.message.
// ---------------------------------------------------------------------

test("savePassword: same_password gives its § 1.10 line, never the raw message", async () => {
  const client = fakeClient({ updateUser: async () => ({ error: { message: "never shown on screen", code: "same_password" } }) });
  const outcome = await savePassword(client, { password: "hunter222", confirm: "hunter222", phase: "form", code: "" });
  assert.deepEqual(outcome, { kind: "error", error: "That's already your password. Choose a different one." });
});

test("savePassword: an unrecognized failure falls back to the catch-all line", async () => {
  const client = fakeClient({ updateUser: async () => ({ error: { message: "some vendor text" } }) });
  const outcome = await savePassword(client, { password: "hunter222", confirm: "hunter222", phase: "form", code: "" });
  assert.deepEqual(outcome, { kind: "error", error: "Couldn't save your password. Try again in a moment." });
});

// ---------------------------------------------------------------------
// Send a new code
// ---------------------------------------------------------------------

test("resendReauthenticationCode: ok on success", async () => {
  const client = fakeClient({ reauthenticate: async () => ({ error: null }) });
  assert.deepEqual(await resendReauthenticationCode(client), { ok: true });
});

test("resendReauthenticationCode: maps a failure to its § 1.10 line", async () => {
  const client = fakeClient({ reauthenticate: async () => ({ error: { message: "raw", status: 429 } }) });
  assert.deepEqual(await resendReauthenticationCode(client), { ok: false, error: "Too many tries. Wait a minute, then try again." });
});
