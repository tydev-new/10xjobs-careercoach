// The order-independent part of design-web-agent.md § 16.1: "Each
// listener also gets INITIAL_SESSION... and the two [INITIAL_SESSION,
// PASSWORD_RECOVERY] have no guaranteed order." Pulled out of RealApp.tsx
// so it's unit-testable directly (no renderer needed — same style as
// reconcile-gates.ts): given the CURRENT `isRecovery` flag (seeded from
// the URL, read once before the client existed — RealApp's own job) and
// one auth event, decides the next flag and what RealApp should do.
export type RecoveryAuthAction =
  | { kind: "recovery" }
  | { kind: "signed-out" }
  | { kind: "advance"; uid: string; email: string }
  | { kind: "ignore" };

export interface RecoveryAuthEventInput {
  event: string;
  session: { user: { id: string; email?: string | null } } | null;
  /** Seeded from `authRedirectFromUrl` at mount, or flipped true by an
   *  earlier PASSWORD_RECOVERY event in this same session. */
  isRecovery: boolean;
  /** `checkedUserIdRef.current` — the uid setup has already run for. */
  alreadyCheckedUid: string | undefined;
}

export interface RecoveryAuthEventResult {
  isRecovery: boolean;
  action: RecoveryAuthAction;
}

/** design-web-ui § 1.10: "recovery... shows 'Choose a new password' in
 *  place of every other screen; while it shows, the listener acts only on
 *  sign-out." */
export function nextAuthScreen(input: RecoveryAuthEventInput): RecoveryAuthEventResult {
  const { event, session, isRecovery, alreadyCheckedUid } = input;
  if (event === "PASSWORD_RECOVERY") {
    return { isRecovery: true, action: { kind: "recovery" } };
  }
  if (event === "SIGNED_OUT" || !session) {
    return { isRecovery: false, action: { kind: "signed-out" } };
  }
  if (isRecovery) {
    // Covers BOTH orders: a URL-seeded (or event-seeded) recovery flag is
    // already true by the time INITIAL_SESSION/SIGNED_IN/TOKEN_REFRESHED
    // arrives, so none of them ever reach checkMembership.
    return { isRecovery: true, action: { kind: "ignore" } };
  }
  if (alreadyCheckedUid === session.user.id) {
    // Fix round 1, item 3 (unchanged): a same-user TOKEN_REFRESHED never
    // re-runs setup.
    return { isRecovery: false, action: { kind: "ignore" } };
  }
  return { isRecovery: false, action: { kind: "advance", uid: session.user.id, email: session.user.email ?? "" } };
}
