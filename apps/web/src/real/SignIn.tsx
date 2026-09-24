// design-web-ui.md § 1.4 — sign-in: magic link or email+password, one line
// under the logo (PRINCIPLES.md rule 1), a "prefer local" link (rule 9).
// Sign-in is shared with the older CareerCoach app — it proves who someone
// is, not that they're in the beta (that's § 1.6, checked by the caller
// after this resolves).
import { useState, type FormEvent, type ReactElement } from "react";
import type { AuthClientLike } from "../backend/auth.ts";
import { signInWithMagicLink, signInWithPassword, signUpWithPassword } from "../backend/auth.ts";

export interface SignInProps {
  client: AuthClientLike;
  redirectTo: string;
}

type Mode = "magic-link" | "password";

export function SignIn({ client, redirectTo }: SignInProps): ReactElement {
  const [mode, setMode] = useState<Mode>("magic-link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | undefined>(undefined);

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

  return (
    <div className="sign-in-screen">
      <div className="sign-in-card">
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
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                />
              </label>
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
