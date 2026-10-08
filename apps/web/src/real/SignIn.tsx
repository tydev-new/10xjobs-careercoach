// design-web-ui.md § 1.4 — sign-in: one way, email and password (the owner's
// ruling of 2026-10-07, C29; calls in design-web-agent.md § 16.5). One card,
// two views and no toggle: Sign in (the view the page opens on) and Create an
// account. One line under the logo (PRINCIPLES.md rule 1), a "prefer local"
// line (rule 9). Sign-in is shared with the older CareerCoach app — it proves
// who someone is, not that they're in the beta (that's § 1.6, checked by the
// caller after this resolves).
//
// The card makes three calls and no others: signInWithPassword, signUp and
// resetPasswordForEmail. The words are sign-in-copy.ts's (§ 5.3.1 rows).
//
// § 1.10 additions: on the Sign in view, a "Forgot or never set a password?"
// link opens a reset card ON THE SAME CARD (never a route). An expired/used
// link's line (design-web-agent.md § 16.1's "link error") shows above the
// Sign in view only — not on Create an account, not on the reset card.
import { useState, type FormEvent, type ReactElement } from "react";
import { Wordmark } from "../components/BrandMark";
import { SIGN_IN_INVITATION } from "./welcome-copy.ts";
import {
  BACK_TO_SIGN_IN,
  CREATE_ACCOUNT_BUTTON,
  EMAIL_LABEL,
  EXPIRED_LINK_LINE,
  FORGOT_LINK,
  PASSWORD_LABEL,
  SIGN_IN_BUTTON,
  SWITCH_TO_CREATE,
  SWITCH_TO_SIGN_IN,
  signUpSentLine,
} from "./sign-in-copy.ts";
import type { AuthClientLike } from "../backend/auth.ts";
import {
  MIN_PASSWORD_LENGTH,
  requestPasswordReset,
  resetPasswordEnumerationSafeLine,
  signInWithPassword,
  signUpWithPassword,
} from "../backend/auth.ts";

export interface SignInProps {
  client: AuthClientLike;
  redirectTo: string;
  /** design-web-agent.md § 16.1: an `error_code` was found on the page's
   *  own URL (a reset, a confirmation or an old sign-in link alike) — RealApp
   *  reads this once, before the client is created, and clears the URL itself. */
  expiredLink?: boolean;
  /** design-web-ui.md § 1.4 (2026-10-08): open on the Create an account view, the one Y8 opens.
   *  Read at mount only; RealApp passes it to the first signed-out page load and no later one. */
  startOnCreate?: boolean;
}

type View = "sign-in" | "create";

export function SignIn({ client, redirectTo, expiredLink, startOnCreate }: SignInProps): ReactElement {
  const [view, setView] = useState<View>(() => (startOnCreate ? "create" : "sign-in"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | undefined>(undefined);

  // § 1.10's reset card — shown "on the same card" as sign-in, never a
  // separate route.
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotStatus, setForgotStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [forgotResult, setForgotResult] = useState<string | undefined>(undefined);

  const isCreate = view === "create";

  /** Switch views (Y8, Y9, Y24). The typed email stays; a typed password and
   *  an old error do not follow the person to the other view. */
  const goTo = (next: View) => {
    setView(next);
    setStatus("idle");
    setError(undefined);
    setPassword("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError(undefined);
    const result = isCreate
      ? await signUpWithPassword(client, email, password, redirectTo)
      : await signInWithPassword(client, email, password);
    if (result.ok) {
      setStatus(isCreate ? "sent" : "idle");
      // A password sign-in resolves the session immediately; the caller
      // (RealApp) is listening for the auth state change and moves on
      // itself — nothing else to do here.
    } else {
      setStatus("error");
      setError(result.error);
    }
  };

  const submitForgot = async (e: FormEvent) => {
    e.preventDefault();
    setForgotStatus("sending");
    setForgotResult(undefined);
    const result = await requestPasswordReset(client, forgotEmail, redirectTo);
    // Enumeration-safe (§ 1.10): success and a 429 render byte-identical
    // text; every other failure gets its own, non-revealing line.
    if (result.ok || result.status === 429) {
      setForgotStatus("done");
      setForgotResult(resetPasswordEnumerationSafeLine(forgotEmail));
    } else {
      setForgotStatus("error");
      setForgotResult("Couldn't send the request. Try again in a moment.");
    }
  };

  if (showForgot) {
    // The expired-link line (Y27) is not shown here: it points to the link
    // under the password field, which is not on this card (§ 1.4, 2026-10-07).
    return (
      <div className="sign-in-screen">
        <div className="sign-in-card">
          <h1 className="sign-in-logo">Reset your password</h1>
          <p className="sign-in-tagline">
            Enter the email you sign in with to get a link for choosing a new password.
          </p>
          {forgotResult ? (
            <p className={forgotStatus === "error" ? "sign-in-error" : "sign-in-sent"}>{forgotResult}</p>
          ) : (
            <form onSubmit={(e) => void submitForgot(e)} method="post" className="sign-in-form">
              <label>
                {EMAIL_LABEL}
                <input
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  autoComplete="email"
                />
              </label>
              <button type="submit" disabled={forgotStatus === "sending"}>
                Send reset link
              </button>
            </form>
          )}
          <button
            type="button"
            className="sign-in-link-button"
            onClick={() => {
              setShowForgot(false);
              setError(undefined);
              setStatus("idle");
              setForgotStatus("idle");
              setForgotResult(undefined);
              setForgotEmail("");
            }}
          >
            {BACK_TO_SIGN_IN}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sign-in-screen">
      <div className="sign-in-card">
        {expiredLink && !isCreate ? <p className="sign-in-link-error">{EXPIRED_LINK_LINE}</p> : null}
        <h1 className="sign-in-logo"><Wordmark size={30} /></h1>
        <p className="sign-in-tagline">Help you get a job offer you actually want.</p>

        {status === "sent" ? (
          <>
            <p className="sign-in-sent">{signUpSentLine(email)}</p>
            {/* Y24: the way back. Returns to the Sign in view, email kept. */}
            <button type="button" className="sign-in-link-button" onClick={() => goTo("sign-in")}>
              {BACK_TO_SIGN_IN}
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="sign-in-form">
            <label>
              {EMAIL_LABEL}
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <label>
              {PASSWORD_LABEL}
              <input
                type="password"
                required
                {...(isCreate ? { minLength: MIN_PASSWORD_LENGTH } : {})}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isCreate ? "new-password" : "current-password"}
              />
            </label>
            {/* § 1.10: "under the password field" — a non-member gets only
                this link (owner decision, 2026-09-25); it never renders on the
                Create an account view. */}
            {!isCreate ? (
              <button
                type="button"
                className="sign-in-link-button"
                onClick={() => {
                  setForgotEmail(email);
                  setError(undefined);
                  setStatus("idle");
                  setShowForgot(true);
                }}
              >
                {FORGOT_LINK}
              </button>
            ) : null}
            {error ? <p className="sign-in-error">{error}</p> : null}
            <button type="submit" disabled={status === "sending"}>
              {isCreate ? CREATE_ACCOUNT_BUTTON : SIGN_IN_BUTTON}
            </button>
            <button type="button" className="sign-in-link-button" onClick={() => goTo(isCreate ? "sign-in" : "create")}>
              {isCreate ? SWITCH_TO_SIGN_IN : SWITCH_TO_CREATE}
            </button>
          </form>
        )}

        {/* § 5.3.1 O5 and O7 (C § 20.7): under the form, on both views (the
            confirmation line included, since it is the same card). O7's
            "terms" and "privacy notice" are the two static pages. */}
        <p className="sign-in-invite">{SIGN_IN_INVITATION}</p>
        <p className="sign-in-terms">
          Using Ten means you agree to its{" "}
          <a href="/terms.html" target="_blank" rel="noreferrer">
            terms
          </a>
          . See also the{" "}
          <a href="/privacy.html" target="_blank" rel="noreferrer">
            privacy notice
          </a>
          .
        </p>

        {/* PRINCIPLES.md rule 9: local-first stays a supported exit. No
            specific URL is named by the contract — this repo's own
            skills/ tree is what "running it from your terminal" means,
            so this stays a plain line rather than a guessed link. */}
        <p className="sign-in-local">Prefer local? Run it from your terminal.</p>
      </div>
    </div>
  );
}
