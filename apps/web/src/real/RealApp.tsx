// The real (production-build) app: sign-in -> one membership check ->
// not-a-member OR first-run/chat (design-web-ui.md § 1.4-1.6). No
// separate route or spinner screen for the membership check — it happens
// once, on this same shell, before the chat ever mounts.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { validateUIMessages } from "ai";
import { createCoach, type Coach } from "../../../../packages/agent/src/index.ts";
import type { AppMessage } from "../../../../packages/agent/src/types.ts";
import {
  accessTokenFrom,
  authRedirectFromUrl,
  checkMembership,
  createTenAuthClient,
  siteRedirectUrl,
  signOut,
} from "../backend/auth.ts";
import { toAuthClientLike } from "../backend/auth-client-adapter.ts";
import type { TenEnv } from "../backend/env.ts";
import { createRootClaudeMd } from "../backend/supabase-workspace-store.ts";
import { buildSkillBundle } from "../backend/skills-bundle.ts";
import { TIER0_PATH } from "../../../../packages/agent/src/skills/system-prompt.ts";
import { createConversationStore, type ConversationStore } from "../backend/conversation-store.ts";
import { readGateStatus } from "../backend/gate.ts";
import { buildRealDeps } from "./deps.ts";
import { reconcileGateStatuses } from "./reconcile-gates.ts";
import { SignIn } from "./SignIn";
import { NotAMember } from "./NotAMember";
import { RealChatShell } from "./RealChatShell";
import { RecoveryScreen } from "./RecoveryScreen";
import { nextAuthScreen } from "./recovery-auth-event.ts";

export interface RealAppProps {
  env: TenEnv;
  theme: "light" | "dark";
  /** Owner ruling (2026-09-24): main.tsx's RealRoot never passes this —
   *  threaded through unchanged to RealChatShell/Header, which only
   *  render "Switch to dark"/"Switch to light" when it's given. */
  onThemeToggle?: () => void;
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
  | { kind: "member"; userId: string; email: string }
  // design-web-agent.md § 16.1 — a recovery link (the URL, read once
  // before the client exists, or a PASSWORD_RECOVERY event, whichever
  // comes first): "Choose a new password" in place of every other screen,
  // before the membership check and before the chat.
  | { kind: "recovery" }
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
  // design-web-agent.md § 16.1: read BEFORE the client is created — the
  // client's own `detectSessionInUrl` clears the hash once it runs, and
  // the two auth events (INITIAL_SESSION, PASSWORD_RECOVERY) have no
  // guaranteed order, so the URL itself (read exactly once, here) is the
  // one thing both orders can agree on. `authRedirectFromUrl` is pure —
  // this file supplies the one window read it needs.
  const [initialRedirect] = useState(() => authRedirectFromUrl(window.location.href));
  const client = useMemo(() => createTenAuthClient({ url: env.supabaseUrl, anonKey: env.supabaseAnonKey }), [env]);
  // auth.ts's functions are written against AuthClientLike (a structural
  // subset, deliberately, so that file stays unit-testable with a small
  // fake) — the real SupabaseClient satisfies it at runtime but not
  // structurally (`rpc()` returns a thenable, not a real Promise; see
  // auth-client-adapter.ts). `client` itself stays around for
  // `.auth.onAuthStateChange()`, which isn't part of AuthClientLike.
  const authClient = useMemo(() => toAuthClientLike(client), [client]);
  const [screen, setScreen] = useState<Screen>(() => (initialRedirect === "recovery" ? { kind: "recovery" } : { kind: "loading" }));
  // § 16.1: "a link error... the sign-in screen shows the expired line,
  // then history.replaceState removes the parameters so a reload doesn't
  // repeat it." Read once, like `initialRedirect` itself; the owner's
  // 2026-09-25 approval extends this same line to an expired magic link,
  // not only an expired recovery link — `authRedirectFromUrl` doesn't
  // distinguish the two, by design (any `error_code` on the URL).
  const [expiredLink, setExpiredLink] = useState(() => initialRedirect === "link-error");
  useEffect(() => {
    if (expiredLink) window.history.replaceState(null, "", window.location.pathname);
    // Runs once, at mount, regardless of `client` — stripping the URL
    // doesn't depend on the auth client existing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // § 16.1's recovery screen "shows... in place of every other screen;
  // while it shows, the listener acts only on sign-out." A ref (not
  // state) because the onAuthStateChange callback below must see the
  // CURRENT value synchronously, including on the very first event it
  // ever receives (a `useState` setter's update wouldn't be visible yet
  // to a callback identity captured at the same render).
  const isRecoveryRef = useRef(initialRedirect === "recovery");
  // The signed-in member's own email (§ 1.10's "{email}" in the code-step
  // and resend lines) — captured off whatever session the listener last
  // saw, real or recovery. Fix round 2, item 4 (tester finding, P3b): this
  // MUST be state, not a ref — an "ignore" action (e.g. INITIAL_SESSION
  // arriving while already on the recovery screen, with no further
  // PASSWORD_RECOVERY event) never calls setScreen, so a ref's new value
  // would sit unread until some UNRELATED re-render happened to occur.
  // RecoveryScreen needs the email the very first time it has one.
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
  // § 11 (amended 2026-09-24): the conversation is restored under the SAME
  // chat id it was saved under (§ 11.6) — a reload no longer starts a new
  // chat (that replaces § 7's old rule; see design-web-agent.md § 11's own
  // header note). `chatId` is resolved once checkAndAdvance's conversation-
  // load step finishes: the restored row's own chat_id, or a fresh
  // `chat-<uuid>` when no row exists yet (a brand-new member, or one who
  // has never sent a turn).
  const [chatId, setChatId] = useState<string | undefined>(undefined);
  const [initialMessages, setInitialMessages] = useState<AppMessage[] | undefined>(undefined);
  const [initialVersion, setInitialVersion] = useState<string | null>(null);
  const [initialOlderDropped, setInitialOlderDropped] = useState(false);
  const [conversationStore, setConversationStore] = useState<ConversationStore | undefined>(undefined);
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

  // Fix round 2, item 6 (tester finding, P6b): "in place of every other
  // screen" (§ 16.1) has to hold even against a check that was ALREADY
  // running when the recovery screen appeared — checkAndAdvance has no
  // way to cancel `checkMembership`'s in-flight request, so every one of
  // its own setScreen calls goes through this guard instead, and a
  // recovery that starts mid-check simply wins the race for the screen
  // (checkedUserIdRef is still updated normally either way — Continue,
  // from the recovery screen, re-reads the session and re-runs this
  // whole function itself, so nothing is lost by discarding this run's
  // own screen update).
  const setScreenUnlessRecovering = useCallback((next: Screen) => {
    if (isRecoveryRef.current) return;
    setScreen(next);
  }, []);

  const checkAndAdvance = useCallback(
    async (userId: string, email: string) => {
      setScreenUnlessRecovering({ kind: "checking-membership" });

      let isMember: boolean;
      try {
        isMember = await checkMembership(authClient);
      } catch (err) {
        logSetupError("checking membership", err);
        checkedUserIdRef.current = undefined;
        setScreenUnlessRecovering({ kind: "error", message: "Couldn't check your membership. Try again in a moment." });
        return;
      }
      if (!isMember) {
        setScreenUnlessRecovering({ kind: "not-a-member" });
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
        setScreenUnlessRecovering({ kind: "error", message: "Couldn't set up your workspace. Try again in a moment." });
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
        setScreenUnlessRecovering({ kind: "error", message: "Couldn't check your balance. Try again in a moment." });
        return;
      }

      // § 11.6 — "before mounting", restore the saved conversation (if
      // any) under its OWN chat id, checked with validateUIMessages, then
      // reconcile any gate whose latest restored status is pending against
      // its ten_gate_log row's real truth (a turn that decided it may
      // never have been saved). A failed read/check/reconcile is a setup
      // failure like every other step here — never a silent empty mount
      // over a saved conversation (§ 11.6's own rule).
      const conversation = createConversationStore({ url: env.supabaseUrl, anonKey: env.supabaseAnonKey, accessToken });
      let resolvedChatId: string;
      let resolvedMessages: AppMessage[] = [];
      let resolvedVersion: string | null = null;
      let resolvedOlderDropped = false;
      try {
        const loaded = await conversation.load();
        if (loaded) {
          const validated = await validateUIMessages<AppMessage>({ messages: loaded.messages });
          resolvedMessages = await reconcileGateStatuses(validated, loaded.chatId, {
            pending: (cid) => deps.gate.pending(cid),
            decide: (gid, status) => deps.gate.decide(gid, status),
            readStatus: (gid) => readGateStatus({ url: env.supabaseUrl, anonKey: env.supabaseAnonKey, accessToken }, gid),
          });
          resolvedChatId = loaded.chatId;
          resolvedVersion = loaded.version;
          resolvedOlderDropped = loaded.olderDropped;
        } else {
          resolvedChatId = `chat-${crypto.randomUUID()}`;
        }
      } catch (err) {
        logSetupError("loading your conversation", err);
        checkedUserIdRef.current = undefined;
        setScreenUnlessRecovering({ kind: "error", message: "Couldn't load your conversation. Try again in a moment." });
        return;
      }

      setWorkspace(deps.workspace);
      setBalanceFn(() => deps.balance);
      setCoach(createCoach(deps));
      setConversationStore(conversation);
      setChatId(resolvedChatId);
      setInitialMessages(resolvedMessages);
      setInitialVersion(resolvedVersion);
      setInitialOlderDropped(resolvedOlderDropped);
      setScreenUnlessRecovering({ kind: "member", userId, email });
    },
    [authClient, env, accessToken, setScreenUnlessRecovering],
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
      if (session?.user.email) setUserEmail(session.user.email);
      // Fix round 2, item 5 (tester finding, P6e): the expired line
      // belongs to the LINK that came back, not to this tab forever — the
      // moment any session starts (member or not), it's stale and must
      // not reappear after a later sign-out in the same tab.
      if (session) setExpiredLink(false);
      // § 16.1: either order (INITIAL_SESSION then PASSWORD_RECOVERY, or
      // the reverse) must end up showing the recovery screen with
      // ten_is_member never called. `nextAuthScreen` is the order-
      // independent decision (unit-tested on its own, recovery-auth-
      // event.test.ts) — `isRecoveryRef` is already true before this
      // listener's very first event whenever the URL said so.
      const result = nextAuthScreen({
        event,
        session: session ? { user: { id: session.user.id, email: session.user.email } } : null,
        isRecovery: isRecoveryRef.current,
        alreadyCheckedUid: checkedUserIdRef.current,
      });
      isRecoveryRef.current = result.isRecovery;
      switch (result.action.kind) {
        case "recovery":
          setScreen({ kind: "recovery" });
          return;
        case "signed-out":
          checkedUserIdRef.current = undefined;
          setScreen({ kind: "signed-out" });
          return;
        case "ignore":
          return;
        case "advance":
          checkedUserIdRef.current = result.action.uid;
          void checkAndAdvance(result.action.uid, result.action.email);
          return;
      }
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
    isRecoveryRef.current = false;
    checkedUserIdRef.current = undefined;
    setScreen({ kind: "signed-out" });
  }, [authClient]);

  // design-web-ui.md § 1.10 — "Continue, which runs the normal membership
  // check": the recovery link already signed the candidate in, so this
  // reads that session directly rather than waiting on another auth event.
  const handleRecoveryContinue = useCallback(() => {
    isRecoveryRef.current = false;
    void client.auth.getSession().then(({ data }) => {
      const session = data.session;
      if (!session) {
        setScreen({ kind: "signed-out" });
        return;
      }
      if (session.user.email) setUserEmail(session.user.email);
      checkedUserIdRef.current = session.user.id;
      void checkAndAdvance(session.user.id, session.user.email ?? "");
    });
  }, [client, checkAndAdvance]);

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
  // Every screen — pre-auth included — lives under the same theme root
  // (.app-root[data-theme]), so styling stays consistent whatever
  // `theme` is. Owner ruling (2026-09-24): in the real app `theme` is
  // ALWAYS "light" (main.tsx's RealRoot passes theme.ts's realTheme()),
  // so every branch below always renders the light palette — the
  // `[data-theme="dark"]` overrides in styles.css stay dormant here,
  // never reached in production.
  if (screen.kind === "recovery") {
    return (
      <div className="app-root" data-theme={theme}>
        <RecoveryScreen
          client={authClient}
          email={userEmail ?? ""}
          onSignOut={handleSignOut}
          onContinue={handleRecoveryContinue}
        />
      </div>
    );
  }
  if (screen.kind === "signed-out") {
    return (
      <div className="app-root" data-theme={theme}>
        <SignIn client={authClient} redirectTo={siteRedirectUrl()} expiredLink={expiredLink} />
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
                    void checkAndAdvance(uid, data.session?.user.email ?? "");
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
  if (!coach || !workspace || !balanceFn || !chatId || !initialMessages || !conversationStore) {
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
        initialMessages={initialMessages}
        initialVersion={initialVersion}
        initialOlderDropped={initialOlderDropped}
        conversationStore={conversationStore}
        supabaseUrl={env.supabaseUrl}
        accessToken={accessToken}
        paypalClientId={env.paypalClientId}
        authClient={authClient}
        userEmail={screen.email}
        onSignOut={handleSignOut}
        onDeleted={handleDeleted}
        theme={theme}
        onThemeToggle={onThemeToggle}
        coachModel={env.coachModel}
      />
    </div>
  );
}
