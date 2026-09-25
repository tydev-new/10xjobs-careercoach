// The password-save orchestration, pulled out of use-password-save.ts's
// React state so it's unit-testable directly against a fake AuthClientLike
// (no renderer needed — same style as reconcile-gates.ts /
// conversation-stale-check.ts). design-web-agent.md § 16.1: "Off, or on
// with a session under 24 hours old: the call saves. On with an older
// session: error code reauthentication_needed. The app then calls
// reauthenticate(), which emails a 6-digit code, and retries with
// updateUser({ password, nonce: code })." Both modes are exercised here —
// the app never reads the setting itself, only reacts to the answer.
import { MIN_PASSWORD_LENGTH, passwordErrorMessage, sendReauthenticationCode, setNewPassword, type AuthClientLike } from "../backend/auth.ts";

export type PasswordSaveOutcome =
  // § 1.10's two checked-before-any-call lines — no call made.
  | { kind: "invalid"; error: string }
  // updateUser saved directly (secure change off, or a fresh session).
  | { kind: "saved" }
  // updateUser answered reauthentication_needed and reauthenticate() was
  // called — `sent` is false only if THAT call itself failed.
  | { kind: "needs-code"; sent: boolean; error?: string }
  // Any other updateUser (or code-step) failure — § 1.10's table.
  | { kind: "error"; error: string };

/** Validates, then calls `updateUser` — with a `nonce` once `phase` is
 *  "code". On the form phase's `reauthentication_needed`, sends the code
 *  itself (never a separate step the caller has to remember to trigger). */
export async function savePassword(
  client: AuthClientLike,
  args: { password: string; confirm: string; phase: "form" | "code"; code: string },
): Promise<PasswordSaveOutcome> {
  const { password, confirm, phase, code } = args;
  // Fix round 2, item 2 (tester finding, P1b): "checked before any call"
  // means every call, not only the form phase's first one — the code step
  // leaves both password fields editable (the shared form, § 1.10), so a
  // mismatch typed there must still make no call.
  if (password.length < MIN_PASSWORD_LENGTH) return { kind: "invalid", error: "Use at least 8 characters." };
  if (password !== confirm) return { kind: "invalid", error: "The two passwords don't match." };
  const result = await setNewPassword(client, password, phase === "code" ? code : undefined);
  if (result.ok) return { kind: "saved" };
  if (result.code === "reauthentication_needed" && phase === "form") {
    const sent = await sendReauthenticationCode(client);
    return sent.ok ? { kind: "needs-code", sent: true } : { kind: "needs-code", sent: false, error: passwordErrorMessage(sent) };
  }
  return { kind: "error", error: passwordErrorMessage(result) };
}

/** design-web-ui § 1.10's "Send a new code". */
export async function resendReauthenticationCode(client: AuthClientLike): Promise<{ ok: boolean; error?: string }> {
  const sent = await sendReauthenticationCode(client);
  return sent.ok ? { ok: true } : { ok: false, error: passwordErrorMessage(sent) };
}
