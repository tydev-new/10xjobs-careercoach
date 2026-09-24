// The real (production-build) app: sign-in -> one membership check ->
// not-a-member OR first-run/chat (design-web-ui.md § 1.4-1.6). No
// separate route or spinner screen for the membership check — it happens
// once, on this same shell, before the chat ever mounts.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import type { Coach } from "../../../../packages/agent/src/types.ts";
import { accessTokenFrom, checkMembership, createTenAuthClient, siteRedirectUrl, signOut } from "../backend/auth.ts";
import { toAuthClientLike } from "../backend/auth-client-adapter.ts";
import type { TenEnv } from "../backend/env.ts";
import { createRootClaudeMd } from "../backend/supabase-workspace-store.ts";
import { buildSkillBundle } from "../backend/skills-bundle.ts";
import { TIER0_PATH } from "../../../../packages/agent/src/skills/system-prompt.ts";
import { buildRealCoach, buildRealDeps } from "./deps.ts";
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
  | { kind: "member"; userId: string };

export function RealApp({ env, theme, onThemeToggle }: RealAppProps): ReactElement {
  const client = useMemo(() => createTenAuthClient({ url: env.supabaseUrl, anonKey: env.supabaseAnonKey }), [env]);
  // auth.ts's functions are written against AuthClientLike (a structural
  // subset, deliberately, so that file stays unit-testable with a small
  // fake) — the real SupabaseClient satisfies it at runtime but not
  // structurally (`rpc()` returns a thenable, not a real Promise; see
  // auth-client-adapter.ts). `client` itself stays around for
  // `.auth.getSession()`/`.auth.onAuthStateChange()`, which aren't part
  // of AuthClientLike at all.
  const authClient = useMemo(() => toAuthClientLike(client), [client]);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  // A reload starts a new chat (design-web-agent.md § 3, § 7) — a fresh id
  // per mount of the member screen is exactly that.
  const [chatId] = useState(() => `chat-${crypto.randomUUID()}`);
  const [coach, setCoach] = useState<Coach | undefined>(undefined);
  const [workspace, setWorkspace] = useState<ReturnType<typeof buildRealDeps>["workspace"] | undefined>(undefined);
  const [balanceFn, setBalanceFn] = useState<(() => Promise<number>) | undefined>(undefined);

  const accessToken = useMemo(() => accessTokenFrom(authClient), [authClient]);

  const checkAndAdvance = useCallback(
    async (userId: string) => {
      setScreen({ kind: "checking-membership" });
      const isMember = await checkMembership(authClient);
      if (!isMember) {
        setScreen({ kind: "not-a-member" });
        return;
      }
      // § 7: "The app creates the workspace CLAUDE.md (create-only) at
      // first run or import" — from the bundled Tier 0 template, once,
      // idempotent (createRootClaudeMd resolves `created: false` if a row
      // already exists, e.g. a reload or a prior import).
      const skills = buildSkillBundle();
      const tier0 = skills[TIER0_PATH] ?? "";
      await createRootClaudeMd({ url: env.supabaseUrl, anonKey: env.supabaseAnonKey, userId, accessToken }, tier0);

      const deps = buildRealDeps({ env, userId, accessToken });
      setWorkspace(deps.workspace);
      setBalanceFn(() => deps.balance);
      setCoach(buildRealCoach({ env, userId, accessToken }));
      setScreen({ kind: "member", userId });
    },
    [authClient, env, accessToken],
  );

  useEffect(() => {
    let cancelled = false;
    client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session?.user.id) void checkAndAdvance(data.session.user.id);
      else setScreen({ kind: "signed-out" });
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id) void checkAndAdvance(session.user.id);
      else setScreen({ kind: "signed-out" });
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const handleSignOut = useCallback(() => {
    void signOut(authClient).then(() => setScreen({ kind: "signed-out" }));
  }, [authClient]);

  if (screen.kind === "loading" || screen.kind === "checking-membership") {
    return <div className="app-shell app-shell--loading" />;
  }
  if (screen.kind === "signed-out") {
    return <SignIn client={authClient} redirectTo={siteRedirectUrl()} />;
  }
  if (screen.kind === "not-a-member") {
    return <NotAMember onSignOut={handleSignOut} />;
  }
  if (!coach || !workspace || !balanceFn) {
    return <div className="app-shell app-shell--loading" />;
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
        onDeleted={handleSignOut}
        theme={theme}
        onThemeToggle={onThemeToggle}
      />
    </div>
  );
}
