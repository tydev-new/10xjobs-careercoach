// The real (production-build) app: sign-in -> one membership check ->
// not-a-member OR first-run/chat (design-web-ui.md § 1.4-1.6). No
// separate route or spinner screen for the membership check — it happens
// once, on this same shell, before the chat ever mounts.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createCoach, type Coach } from "../../../../packages/agent/src/index.ts";
import { accessTokenFrom, checkMembership, createTenAuthClient, siteRedirectUrl, signOut } from "../backend/auth.ts";
import { toAuthClientLike } from "../backend/auth-client-adapter.ts";
import type { TenEnv } from "../backend/env.ts";
import { createRootClaudeMd } from "../backend/supabase-workspace-store.ts";
import { buildSkillBundle } from "../backend/skills-bundle.ts";
import { TIER0_PATH } from "../../../../packages/agent/src/skills/system-prompt.ts";
import { buildRealDeps } from "./deps.ts";
import { SignIn } from "./SignIn";
import { NotAMember } from "./NotAMember";
import { RealChatShell } from "./RealChatShell";

export interface RealAppProps {
  env: TenEnv;
  theme: "light" | "dark";
  onThemeToggle: () => void;
}

type Screen =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "checking-membership" }
  | { kind: "not-a-member" }
  // Fix round 1, item 4: every setup failure (membership, the root
  // CLAUDE.md create, the first balance() call) lands here — a plain
  // message, Retry, and Sign out — never a blank page.
  | { kind: "error"; message: string }
  | { kind: "member"; userId: string }
  // Fix round 2, item 3: sign-out has ALREADY happened (awaited) by the
  // time this screen renders — the report-back never claims a sign-out
  // that hasn't happened yet. Rendered as the sign-in screen with the
  // report-back on top (not a separate route), so it survives the
  // member -> signed-out screen change instead of unmounting with
  // DeleteBetaDataConfirm (which lived inside the now-gone member
  // screen).
  | { kind: "deleted"; message: string };

/** Fix round 2, item 2: a plain, candidate-facing message PER FAILING
 *  STEP — never `err.message` (the tester's e2e, "setup" section, checks
 *  the shown text contains none of HTTP/{/failed:/rpc/ten_xxx(, which a
 *  raw RPC failure message like "checkMembership: ten_is_member() failed:
 *  HTTP 500 {...}" would all trip). The raw error is logged to the
 *  console only, for whoever's actually debugging it. */
function logSetupError(step: string, err: unknown): void {
  console.error(`[Ten setup] ${step} failed:`, err);
}

export function RealApp({ env, theme, onThemeToggle }: RealAppProps): ReactElement {
  const client = useMemo(() => createTenAuthClient({ url: env.supabaseUrl, anonKey: env.supabaseAnonKey }), [env]);
  // auth.ts's functions are written against AuthClientLike (a structural
  // subset, deliberately, so that file stays unit-testable with a small
  // fake) — the real SupabaseClient satisfies it at runtime but not
  // structurally (`rpc()` returns a thenable, not a real Promise; see
  // auth-client-adapter.ts). `client` itself stays around for
  // `.auth.onAuthStateChange()`, which isn't part of AuthClientLike.
  const authClient = useMemo(() => toAuthClientLike(client), [client]);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  // A reload starts a new chat (design-web-agent.md § 3, § 7) — a fresh id
  // per mount of the member screen is exactly that.
  const [chatId] = useState(() => `chat-${crypto.randomUUID()}`);
  const [coach, setCoach] = useState<Coach | undefined>(undefined);
  const [workspace, setWorkspace] = useState<ReturnType<typeof buildRealDeps>["workspace"] | undefined>(undefined);
  const [balanceFn, setBalanceFn] = useState<(() => Promise<number>) | undefined>(undefined);

  const accessToken = useMemo(() => accessTokenFrom(authClient), [authClient]);

  // Fix round 1, item 3: which user id setup has already run (or is
  // running) for, so a same-user re-fire of onAuthStateChange (most
  // commonly TOKEN_REFRESHED, which Supabase emits on every silent JWT
  // refresh — roughly hourly, and it carries a real session, so it is
  // NOT distinguishable from SIGNED_IN by session shape alone) never
  // re-runs setup, rebuilds the Coach, or touches the mounted chat.
  // Cleared on sign-out and on a setup FAILURE (so Retry can re-run it).
  const checkedUserIdRef = useRef<string | undefined>(undefined);

  const checkAndAdvance = useCallback(
    async (userId: string) => {
      setScreen({ kind: "checking-membership" });

      let isMember: boolean;
      try {
        isMember = await checkMembership(authClient);
      } catch (err) {
        logSetupError("checking membership", err);
        checkedUserIdRef.current = undefined;
        setScreen({ kind: "error", message: "Couldn't check your membership. Try again in a moment." });
        return;
      }
      if (!isMember) {
        setScreen({ kind: "not-a-member" });
        return;
      }

      // § 7: "The app creates the workspace CLAUDE.md (create-only) at
      // first run or import" — from the bundled Tier 0 template, once,
      // idempotent (createRootClaudeMd resolves `created: false` if a
      // row already exists, e.g. a reload or a prior import).
      try {
        const skills = buildSkillBundle();
        const tier0 = skills[TIER0_PATH] ?? "";
        await createRootClaudeMd({ url: env.supabaseUrl, anonKey: env.supabaseAnonKey, userId, accessToken }, tier0);
      } catch (err) {
        logSetupError("setting up your workspace", err);
        checkedUserIdRef.current = undefined;
        setScreen({ kind: "error", message: "Couldn't set up your workspace. Try again in a moment." });
        return;
      }

      const deps = buildRealDeps({ env, userId, accessToken });
      // Proves the balance pipeline actually works BEFORE the chat mounts
      // (item 4: "the balance" is one of the setup steps that must fail
      // into the error screen, not silently once the chat is already up).
      try {
        await deps.balance();
      } catch (err) {
        logSetupError("checking your balance", err);
        checkedUserIdRef.current = undefined;
        setScreen({ kind: "error", message: "Couldn't check your balance. Try again in a moment." });
        return;
      }

      setWorkspace(deps.workspace);
      setBalanceFn(() => deps.balance);
      setCoach(createCoach(deps));
      setScreen({ kind: "member", userId });
    },
    [authClient, env, accessToken],
  );

  useEffect(() => {
    let cancelled = false;
    // ONE listener is the ONE source of the session (removes the
    // "double check at startup": Supabase's own onAuthStateChange fires
    // once immediately with INITIAL_SESSION, carrying exactly what a
    // separate getSession() call would have — a second call was a
    // redundant race, not a second real check).
    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "SIGNED_OUT" || !session) {
        checkedUserIdRef.current = undefined;
        setScreen({ kind: "signed-out" });
        return;
      }
      // Fix round 1, item 3: react to SIGNED_IN/INITIAL_SESSION, or a
      // genuine user change — NEVER a same-user TOKEN_REFRESHED (the
      // common case) or any other same-user event.
      const uid = session.user.id;
      if (checkedUserIdRef.current === uid) return;
      checkedUserIdRef.current = uid;
      void checkAndAdvance(uid);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // Returns a Promise (not fire-and-forget) — every caller (Header's ⋯
  // menu, NotAMember, the error screen) is a plain onClick and ignores
  // the return value, which TS allows (Promise<void> satisfies () => void).
  const handleSignOut = useCallback(async () => {
    await signOut(authClient);
    checkedUserIdRef.current = undefined;
    setScreen({ kind: "signed-out" });
  }, [authClient]);

  // Fix round 2, item 3: sign out FIRST (awaited), THEN show the
  // report-back — never the reverse. Called from DeleteBetaDataConfirm
  // once ten-delete-account itself has already returned; by the time
  // this resolves, the session is genuinely gone (the tester's e2e reads
  // localStorage directly to confirm this before checking the text).
  const handleDeleted = useCallback(async () => {
    await signOut(authClient);
    checkedUserIdRef.current = undefined;
    setScreen({
      kind: "deleted",
      message: "Deleted. You're signed out of Ten — your sign-in for the older app is untouched.",
    });
  }, [authClient]);

  if (screen.kind === "loading" || screen.kind === "checking-membership") {
    return <div className="app-shell app-shell--loading" />;
  }
  // Every screen — pre-auth included — lives under the same theme root:
  // [data-theme="dark"]'s variable overrides only apply to their own
  // descendants (styles.css), so sign-in/not-a-member must sit inside
  // .app-root too, or they'd always render in light-mode tokens
  // regardless of the host's own dark-mode setting.
  if (screen.kind === "signed-out") {
    return (
      <div className="app-root" data-theme={theme}>
        <SignIn client={authClient} redirectTo={siteRedirectUrl()} />
      </div>
    );
  }
  if (screen.kind === "not-a-member") {
    return (
      <div className="app-root" data-theme={theme}>
        <NotAMember onSignOut={handleSignOut} />
      </div>
    );
  }
  if (screen.kind === "deleted") {
    // The sign-in screen underneath (sign-out already happened — § 1.7
    // point 4's report-back is never shown ahead of the real sign-out,
    // fix round 2 item 3), with the report-back on top; OK just closes
    // the overlay onto the now-ordinary sign-in screen.
    return (
      <div className="app-root" data-theme={theme}>
        <SignIn client={authClient} redirectTo={siteRedirectUrl()} />
        <div className="delete-confirm-overlay" role="dialog" aria-modal="true">
          <div className="delete-confirm-card">
            <p>{screen.message}</p>
            <button type="button" onClick={() => setScreen({ kind: "signed-out" })}>
              OK
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (screen.kind === "error") {
    return (
      <div className="app-root" data-theme={theme}>
        <div className="app-shell app-shell--config-error">
          <div>
            <p>{screen.message}</p>
            <button
              type="button"
              onClick={() => {
                void client.auth.getSession().then(({ data }) => {
                  const uid = data.session?.user.id;
                  if (uid) {
                    checkedUserIdRef.current = uid;
                    void checkAndAdvance(uid);
                  } else {
                    setScreen({ kind: "signed-out" });
                  }
                });
              }}
            >
              Retry
            </button>
            <button type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!coach || !workspace || !balanceFn) {
    return (
      <div className="app-root" data-theme={theme}>
        <div className="app-shell app-shell--loading" />
      </div>
    );
  }
  return (
    <div className="app-root" data-theme={theme}>
      <RealChatShell
        coach={coach}
        workspace={workspace}
        balance={balanceFn}
        chatId={chatId}
        supabaseUrl={env.supabaseUrl}
        accessToken={accessToken}
        onSignOut={handleSignOut}
        onDeleted={handleDeleted}
        theme={theme}
        onThemeToggle={onThemeToggle}
      />
    </div>
  );
}
