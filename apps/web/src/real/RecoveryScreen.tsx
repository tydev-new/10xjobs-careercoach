// design-web-ui.md § 1.10 — "Choose a new password": the first screen
// after a recovery link, before the membership check and before the chat
// (design-web-agent.md § 16.1). RealApp shows this in place of every other
// screen the moment either the URL or a PASSWORD_RECOVERY event says so.
import type { FormEvent, ReactElement } from "react";
import type { AuthClientLike } from "../backend/auth.ts";
import { PasswordFields } from "./PasswordFields";
import { usePasswordSave } from "./use-password-save.ts";

export interface RecoveryScreenProps {
  client: AuthClientLike;
  email: string;
  onSignOut: () => void;
  /** Runs the normal membership check (§ 1.4) once the candidate presses
   *  Continue after a successful save. */
  onContinue: () => void;
}

export function RecoveryScreen({ client, email, onSignOut, onContinue }: RecoveryScreenProps): ReactElement {
  const form = usePasswordSave(client, email);

  const signOut = () => {
    form.reset();
    onSignOut();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit();
  };

  if (form.phase === "success") {
    return (
      <div className="sign-in-screen">
        <div className="sign-in-card">
          <h1 className="sign-in-logo">Choose a new password</h1>
          <p className="sign-in-sent">Password saved. Use it next time you sign in, here or in the older app.</p>
          <button type="button" onClick={onContinue}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sign-in-screen">
      <div className="sign-in-card">
        <h1 className="sign-in-logo">Choose a new password</h1>
        {form.phase === "code" ? (
          <p className="sign-in-tagline">
            For your security, we emailed a 6-digit code to {email}. Enter it to save your new
            password.
          </p>
        ) : (
          <p className="sign-in-tagline">
            You're signed in from your reset link. This password also works for the older app,
            which shares your sign-in.
          </p>
        )}
        <form onSubmit={submit} method="post" className="sign-in-form">
          <PasswordFields form={form} />
          {form.phase === "code" ? (
            <label>
              Code
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={form.code}
                onChange={(e) => form.setCode(e.target.value)}
                disabled={form.saving}
              />
            </label>
          ) : null}
          {form.info ? <p className="sign-in-sent">{form.info}</p> : null}
          {form.error ? <p className="sign-in-error">{form.error}</p> : null}
          <button type="submit" disabled={form.saving}>
            {form.saving ? "Saving…" : "Save password"}
          </button>
          {form.phase === "code" ? (
            <button
              type="button"
              className="sign-in-secondary-button"
              disabled={form.resending}
              onClick={() => void form.resend()}
            >
              Send a new code
            </button>
          ) : null}
        </form>
        <button type="button" className="sign-in-link-button" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
