// design-web-ui.md § 1.10 — the ⋯ menu's "Set a new password" dialog.
// Renders in the same overlay shape as DeleteBetaDataConfirm (its own
// component, no `data-gate`/`gateId` — rule 7 doesn't apply: the candidate
// types their own password, nothing is sent/submitted/paid for on their
// behalf).
import type { FormEvent, ReactElement } from "react";
import type { AuthClientLike } from "../backend/auth.ts";
import { PasswordFields } from "./PasswordFields";
import { usePasswordSave } from "./use-password-save.ts";

export interface SetPasswordDialogProps {
  client: AuthClientLike;
  email: string;
  onClose: () => void;
}

export function SetPasswordDialog({ client, email, onClose }: SetPasswordDialogProps): ReactElement {
  const form = usePasswordSave(client, email);

  const cancel = () => {
    form.reset();
    onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit();
  };

  if (form.phase === "success") {
    return (
      <div className="delete-confirm-overlay" role="dialog" aria-modal="true">
        <div className="delete-confirm-card">
          <h2>Set a new password</h2>
          <p>Password saved. Use it next time you sign in, here or in the older app.</p>
          <div className="delete-confirm-actions">
            <button type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="delete-confirm-overlay" role="dialog" aria-modal="true">
      <div className="delete-confirm-card">
        <h2>Set a new password</h2>
        {form.phase === "code" ? (
          <p>
            For your security, we emailed a 6-digit code to {email}. Enter it to save your new
            password.
          </p>
        ) : (
          <p>This password also works for the older app, which shares your sign-in.</p>
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
          {form.error ? <p className="delete-confirm-error">{form.error}</p> : null}
          <div className="delete-confirm-actions">
            <button type="submit" disabled={form.saving}>
              {form.saving ? "Saving…" : "Save password"}
            </button>
            {form.phase === "code" ? (
              <button
                type="button"
                disabled={form.resending}
                onClick={() => void form.resend()}
              >
                Send a new code
              </button>
            ) : null}
            <button type="button" onClick={cancel} disabled={form.saving}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
