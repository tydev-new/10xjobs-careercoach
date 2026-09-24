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

export type DevPreviewKind = "sign-in" | "not-a-member";

export function devPreviewKind(search: string): DevPreviewKind | null {
  const value = new URLSearchParams(search).get("preview");
  return value === "sign-in" || value === "not-a-member" ? value : null;
}

const NEVER_CALLED = "dev-preview: unreachable without a real session";

const stubClient: AuthClientLike = {
  auth: {
    signInWithOtp: () => Promise.reject(new Error(NEVER_CALLED)),
    signInWithPassword: () => Promise.reject(new Error(NEVER_CALLED)),
    signUp: () => Promise.reject(new Error(NEVER_CALLED)),
    signOut: () => Promise.reject(new Error(NEVER_CALLED)),
    getSession: () => Promise.reject(new Error(NEVER_CALLED)),
  },
  rpc: () => Promise.reject(new Error(NEVER_CALLED)),
};

export function DevScreenPreview({ kind }: { kind: DevPreviewKind }): ReactElement {
  const [theme] = useState<"light" | "dark">(() => {
    return new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";
  });

  return (
    <div className="app-root" data-theme={theme}>
      {kind === "sign-in" ? (
        <SignIn client={stubClient} redirectTo="https://ten.example.com/" />
      ) : (
        <NotAMember onSignOut={() => {}} />
      )}
    </div>
  );
}
