// design-web-ui.md § 1.10 — "the form" the menu dialog and the recovery
// screen share: "New password" and "Type it again", both hidden, one
// Show/Hide button for both. § 16.2: `type="password"` until Show,
// `autocomplete="new-password"`.
import type { ReactElement } from "react";
import type { PasswordSaveApi } from "./use-password-save.ts";

export function PasswordFields({ form }: { form: PasswordSaveApi }): ReactElement {
  const fieldType = form.showPassword ? "text" : "password";
  return (
    <>
      <label>
        New password
        <input
          type={fieldType}
          value={form.password}
          onChange={(e) => form.setPassword(e.target.value)}
          autoComplete="new-password"
          disabled={form.saving}
        />
      </label>
      <label>
        Type it again
        <input
          type={fieldType}
          value={form.confirm}
          onChange={(e) => form.setConfirm(e.target.value)}
          autoComplete="new-password"
          disabled={form.saving}
        />
      </label>
      <button type="button" className="sign-in-link-button" onClick={form.toggleShow}>
        {form.showPassword ? "Hide" : "Show"}
      </button>
    </>
  );
}
