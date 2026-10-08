// design-web-ui.md § 5.3.1 rows Y4-Y9, Y11, Y20, Y24, Y27, word for word (§ 1.4's
// 2026-10-07 amendment, C29: one way to sign in, email and password). Plain
// strings, no JSX, so a unit test can import them under Node and compare each
// with its row (sign-in-copy.test.ts reads the rows out of the doc). Each
// constant is one whole literal, so the bundle holds the line unbroken.
// Y12 and Y13 (the two sign-in errors) live beside the error map in
// backend/auth.ts. Browser-safe: no window/document/localStorage/node:*.

/** Y4: field label (the sign-in and reset forms). */
export const EMAIL_LABEL = "Email";
/** Y5: field label, both views. */
export const PASSWORD_LABEL = "Password";
/** Y6: Sign in view's submit button. */
export const SIGN_IN_BUTTON = "Sign in";
/** Y7: Create an account view's submit button. */
export const CREATE_ACCOUNT_BUTTON = "Create account";
/** Y8: Sign in view, under the button: switch to Create an account. */
export const SWITCH_TO_CREATE = "New here? Create an account";
/** Y9: Create an account view, under the button: switch back. */
export const SWITCH_TO_SIGN_IN = "Already have an account? Sign in";
/** Y20: Sign in view only, under the password field. */
export const FORGOT_LINK = "Forgot or never set a password?";
/** Y24: the reset card's link, and under the confirmation line (Y11). */
export const BACK_TO_SIGN_IN = "Back to sign in";
/** Y27: Sign in view only, above the form: a link came back with an error. */
export const EXPIRED_LINK_LINE =
  "That link has expired or was already used. Sign in below, or choose a new password with the link under the password field.";

/** Y11: after `Create account`, in place of the form. The same words whether
 *  or not the address already has an account (C § 16.5). */
export function signUpSentLine(email: string): string {
  return `Check ${email} for a link to confirm your account. Check spam too. If nothing comes, you may already have an account: go back to sign in, where you can also choose a new password.`;
}
