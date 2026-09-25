// Unit tests for the order-independent recovery decision (design-web-
// agent.md § 16.1: "the two [INITIAL_SESSION, PASSWORD_RECOVERY] have no
// guaranteed order") — no renderer, no real Supabase client.
import assert from "node:assert/strict";
import test from "node:test";
import { nextAuthScreen } from "./recovery-auth-event.ts";

const SESSION = { user: { id: "u1", email: "a@example.com" } };

// ---------------------------------------------------------------------
// Recovery via the URL alone (isRecovery seeded true, no PASSWORD_
// RECOVERY event ever arrives in this test — the ordinary INITIAL_
// SESSION every sign-in gets).
// ---------------------------------------------------------------------

test("URL alone: isRecovery already true — INITIAL_SESSION is ignored, ten_is_member's caller never runs", () => {
  const result = nextAuthScreen({ event: "INITIAL_SESSION", session: SESSION, isRecovery: true, alreadyCheckedUid: undefined });
  assert.deepEqual(result, { isRecovery: true, action: { kind: "ignore" } });
});

// ---------------------------------------------------------------------
// Recovery via the event, order 1: INITIAL_SESSION then PASSWORD_RECOVERY
// ---------------------------------------------------------------------

test("event order 1 (INITIAL_SESSION then PASSWORD_RECOVERY): the SECOND event still wins — recovery, isRecovery true", () => {
  const first = nextAuthScreen({ event: "INITIAL_SESSION", session: SESSION, isRecovery: false, alreadyCheckedUid: undefined });
  // Note: without a URL hint, the FIRST event alone can't know this is a
  // recovery flow — that's exactly why RealApp seeds `isRecovery` from
  // the URL before either event ever fires (a real recovery redirect
  // always carries `type=recovery` in the URL, so this ordering only
  // matters for the SECOND event's own effect, tested here).
  const second = nextAuthScreen({ event: "PASSWORD_RECOVERY", session: SESSION, isRecovery: first.isRecovery, alreadyCheckedUid: undefined });
  assert.deepEqual(second, { isRecovery: true, action: { kind: "recovery" } });
});

// ---------------------------------------------------------------------
// Recovery via the event, order 2 (the reverse): PASSWORD_RECOVERY then
// INITIAL_SESSION
// ---------------------------------------------------------------------

test("event order 2 (PASSWORD_RECOVERY then INITIAL_SESSION): the recovery flag set by the FIRST event survives the second — ten_is_member never called", () => {
  const first = nextAuthScreen({ event: "PASSWORD_RECOVERY", session: SESSION, isRecovery: false, alreadyCheckedUid: undefined });
  assert.deepEqual(first, { isRecovery: true, action: { kind: "recovery" } });
  const second = nextAuthScreen({ event: "INITIAL_SESSION", session: SESSION, isRecovery: first.isRecovery, alreadyCheckedUid: undefined });
  assert.deepEqual(second, { isRecovery: true, action: { kind: "ignore" } });
});

// ---------------------------------------------------------------------
// Sign-out always wins, even mid-recovery.
// ---------------------------------------------------------------------

test("SIGNED_OUT while isRecovery is true: signed-out, isRecovery clears", () => {
  const result = nextAuthScreen({ event: "SIGNED_OUT", session: null, isRecovery: true, alreadyCheckedUid: "u1" });
  assert.deepEqual(result, { isRecovery: false, action: { kind: "signed-out" } });
});

test("a null session (whatever the event) is treated as signed-out", () => {
  const result = nextAuthScreen({ event: "TOKEN_REFRESHED", session: null, isRecovery: false, alreadyCheckedUid: undefined });
  assert.deepEqual(result, { isRecovery: false, action: { kind: "signed-out" } });
});

// ---------------------------------------------------------------------
// The ordinary (non-recovery) path, unchanged.
// ---------------------------------------------------------------------

test("ordinary sign-in: a new uid advances (checkMembership's caller runs)", () => {
  const result = nextAuthScreen({ event: "SIGNED_IN", session: SESSION, isRecovery: false, alreadyCheckedUid: undefined });
  assert.deepEqual(result, { isRecovery: false, action: { kind: "advance", uid: "u1", email: "a@example.com" } });
});

test("a same-user TOKEN_REFRESHED never re-advances (fix round 1, item 3, unchanged)", () => {
  const result = nextAuthScreen({ event: "TOKEN_REFRESHED", session: SESSION, isRecovery: false, alreadyCheckedUid: "u1" });
  assert.deepEqual(result, { isRecovery: false, action: { kind: "ignore" } });
});

test("a genuine user change still advances", () => {
  const result = nextAuthScreen({ event: "TOKEN_REFRESHED", session: SESSION, isRecovery: false, alreadyCheckedUid: "someone-else" });
  assert.deepEqual(result, { isRecovery: false, action: { kind: "advance", uid: "u1", email: "a@example.com" } });
});

test("advance falls back to '' when the session carries no email", () => {
  const result = nextAuthScreen({
    event: "SIGNED_IN",
    session: { user: { id: "u2" } },
    isRecovery: false,
    alreadyCheckedUid: undefined,
  });
  assert.deepEqual(result, { isRecovery: false, action: { kind: "advance", uid: "u2", email: "" } });
});
