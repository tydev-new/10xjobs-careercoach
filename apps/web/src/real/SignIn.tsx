// design-web-ui.md § 1.4 — sign-in: magic link or email+password, one line
// under the logo (PRINCIPLES.md rule 1), a "prefer local" link (rule 9).
// Sign-in is shared with the older CareerCoach app — it proves who someone
// is, not that they're in the beta (that's § 1.6, checked by the caller
// after this resolves).
//
// § 1.10 additions: in "Email + password" mode, a "Forgot or never set a
// password?" link opens a reset card ON THE SAME CARD (never a route), and
// an expired/used link's line (design-web-agent.md § 16.1's "link error")
// renders above whichever form is showing.
import { useState, type FormEvent, type ReactElement } from "react";
import type { AuthClientLike } from "../backend/auth.ts";
import {
  MIN_PASSWORD_LENGTH,
  requestPasswordReset,
  resetPasswordEnumerationSafeLine,
  signInWithMagicLink,
  signInWithPassword,
  signUpWithPassword,
} from "../backend/auth.ts";

export interface SignInProps {
  client: AuthClientLike;
  redirectTo: string;
  /** design-web-agent.md § 16.1: an `error_code` was found on the page's
   *  own URL (recovery or magic-link alike) — RealApp reads this once,
   *  before the client is created, and clears the URL itself. */
  expiredLink?: boolean;
}

type Mode = "magic-link" | "password";

export function SignIn({ client, redirectTo, expiredLink }: SignInProps): ReactElement {
  const [mode, setMode] = useState<Mode>("magic-link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | undefined>(undefined);

  // § 1.10's reset card — shown "on the same card" as sign-in, never a
  // separate route.
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotStatus, setForgotStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [forgotResult, setForgotResult] = useState<string | undefined>(undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError(undefined);
    const result =
      mode === "magic-link"
        ? await signInWithMagicLink(client, email, redirectTo)
        : isSignUp
          ? await signUpWithPassword(client, email, password, redirectTo)
          : await signInWithPassword(client, email, password);
    if (result.ok) {
      setStatus(mode === "magic-link" || isSignUp ? "sent" : "idle");
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
    return (
      <div className="sign-in-screen">
        <div className="sign-in-card">
          {expiredLink ? (
            <p className="sign-in-link-error">
              That email link has expired or was already used. Ask for a new one below.
            </p>
          ) : null}
          <h1 className="sign-in-logo">Reset your password</h1>
          <p className="sign-in-tagline">
            Enter the email you sign in with to get a link for choosing a new password.
          </p>
          {forgotResult ? (
            <p className={forgotStatus === "error" ? "sign-in-error" : "sign-in-sent"}>{forgotResult}</p>
          ) : (
            <form onSubmit={(e) => void submitForgot(e)} method="post" className="sign-in-form">
              <label>
                Email
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
              setForgotStatus("idle");
              setForgotResult(undefined);
              setForgotEmail("");
            }}
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sign-in-screen">
      <div className="sign-in-card">
        {expiredLink ? (
          <p className="sign-in-link-error">
            That email link has expired or was already used. Ask for a new one below.
          </p>
        ) : null}
        <h1 className="sign-in-logo">Ten</h1>
        <p className="sign-in-tagline">Help you get a job offer you actually want.</p>

        <div className="sign-in-mode-toggle">
          <button type="button" disabled={mode === "magic-link"} onClick={() => setMode("magic-link")}>
            Email link
          </button>
          <button type="button" disabled={mode === "password"} onClick={() => setMode("password")}>
            Email + password
          </button>
        </div>

        {status === "sent" ? (
          <p className="sign-in-sent">
            Check {email} for a link{isSignUp ? " to confirm your account" : " to sign in"}.
          </p>
        ) : (
          <form onSubmit={submit} className="sign-in-form">
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            {mode === "password" ? (
              <label>
                Password
                <input
                  type="password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                />
              </label>
            ) : null}
            {/* § 1.10: "under the password field" — a non-member gets only
                this link (owner decision, 2026-09-25); it never renders in
                "Create account" sub-mode. */}
            {mode === "password" && !isSignUp ? (
              <button
                type="button"
                className="sign-in-link-button"
                onClick={() => {
                  setForgotEmail(email);
                  setShowForgot(true);
                }}
              >
                Forgot or never set a password?
              </button>
            ) : null}
            {error ? <p className="sign-in-error">{error}</p> : null}
            <button type="submit" disabled={status === "sending"}>
              {mode === "magic-link" ? "Send me a link" : isSignUp ? "Create account" : "Sign in"}
            </button>
            {mode === "password" ? (
              <button type="button" className="sign-in-link-button" onClick={() => setIsSignUp((v) => !v)}>
                {isSignUp ? "Already have an account? Sign in" : "New here? Create an account"}
              </button>
            ) : null}
          </form>
        )}

        {/* PRINCIPLES.md rule 9: local-first stays a supported exit. No
            specific URL is named by the contract — this repo's own
            skills/ tree is what "running it from your terminal" means,
            so this stays a plain line rather than a guessed link. */}
        <p className="sign-in-local">Prefer local? Run it from your terminal.</p>
      </div>
    </div>
  );
}
