// Preview-only screenshot harness for the two static real-mode screens
// (design-web-ui.md § 1.4/§ 1.6) that normally only render behind a real
// Supabase session. Used solely by scripts/capture-design-refresh.mjs at
// `?preview=sign-in` / `?preview=not-a-member` — gated by the caller on
// SHOW_MOCK_CONTROLS (main.tsx), so it never ships in the production
// build, and it never touches a network: the stub client's methods are
// never called by a static render, only wired for the type checker.
import { useState, type ReactElement } from "react";
import type { AuthClientLike } from "./backend/auth.ts";
import { SignIn } from "./real/SignIn";
import { NotAMember } from "./real/NotAMember";
import { Composer } from "./components/Composer";

export type DevPreviewKind = "sign-in" | "not-a-member" | "update-notice";

export function devPreviewKind(search: string): DevPreviewKind | null {
  const value = new URLSearchParams(search).get("preview");
  return value === "sign-in" || value === "not-a-member" || value === "update-notice"
    ? value
    : null;
}

// design-web-ui.md § 1.8, copy word for word. STYLE ONLY: no reload
// mechanism, no "blocked send" detection — that's C § 10's own agent
// slice. The button below does nothing; a real one would call the
// browser's own reload, never a send/submit/spend (rule 7 doesn't cover
// it).
const UPDATE_NOTICE_TEXT =
  "Ten has been updated. Reload to use the new version. Your files are saved; this conversation will clear from the screen.";

const NEVER_CALLED = "dev-preview: unreachable without a real session";

const stubClient: AuthClientLike = {
  auth: {
    signInWithOtp: () => Promise.reject(new Error(NEVER_CALLED)),
    signInWithPassword: () => Promise.reject(new Error(NEVER_CALLED)),
    signUp: () => Promise.reject(new Error(NEVER_CALLED)),
    signOut: () => Promise.reject(new Error(NEVER_CALLED)),
    getSession: () => Promise.reject(new Error(NEVER_CALLED)),
    resetPasswordForEmail: () => Promise.reject(new Error(NEVER_CALLED)),
    updateUser: () => Promise.reject(new Error(NEVER_CALLED)),
    reauthenticate: () => Promise.reject(new Error(NEVER_CALLED)),
  },
  rpc: () => Promise.reject(new Error(NEVER_CALLED)),
};

function UpdateNoticePreview(): ReactElement {
  const [value, setValue] = useState("");
  return (
    <div className="app-shell">
      <div className="main-pane">
        <header className="app-header">
          <div className="app-header-left">
            <span className="avatar avatar--done" role="img" aria-label="done">
              <span className="avatar-dot" />
            </span>
            <span className="app-header-title">
              Ten <span className="app-header-status">· done</span>
            </span>
          </div>
        </header>
        <div className="transcript">
          <div className="bubble bubble--assistant">
            <div className="bubble-role">Ten</div>
            <p>Strong Fit, recorded in jobs.md. Want me to tailor a résumé and cover letter for this one?</p>
          </div>
        </div>
        <div className="update-notice">
          <span className="update-notice-text">{UPDATE_NOTICE_TEXT}</span>
          <button type="button" className="update-notice-reload">
            Reload
          </button>
        </div>
        <Composer value={value} onChange={setValue} onSend={() => {}} disabled={false} />
      </div>
    </div>
  );
}

export function DevScreenPreview({ kind }: { kind: DevPreviewKind }): ReactElement {
  const [theme] = useState<"light" | "dark">(() => {
    return new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";
  });

  return (
    <div className="app-root" data-theme={theme}>
      {kind === "sign-in" ? (
        <SignIn client={stubClient} redirectTo="https://ten.example.com/" />
      ) : kind === "not-a-member" ? (
        <NotAMember onSignOut={() => {}} />
      ) : (
        <UpdateNoticePreview />
      )}
    </div>
  );
}
