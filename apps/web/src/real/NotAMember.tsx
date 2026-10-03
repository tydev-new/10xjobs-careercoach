// design-web-ui.md § 1.6 (amended 2026-10-02, C § 20): an account the welcome
// claim refused never reaches the chat: same shell, no avatar, no cards, no
// composer, one plain line for the reason, and Sign out. No balance chip, no
// fixture controls, no retry button: each line says what the person can do,
// and opening Ten again runs the check again (C § 20.4). The `⋯` menu keeps
// only Sign out. The three lines are § 5.3.1 O2, O3 and O4 (welcome-copy.ts).
import type { ReactElement } from "react";
import { NOT_A_MEMBER_LINES, type NotAMemberReason } from "./welcome-copy.ts";

export type { NotAMemberReason };

export function NotAMember({ reason, onSignOut }: { reason: NotAMemberReason; onSignOut: () => void }): ReactElement {
  return (
    <div className="not-a-member-screen">
      <p className="not-a-member-message">{NOT_A_MEMBER_LINES[reason]}</p>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}
