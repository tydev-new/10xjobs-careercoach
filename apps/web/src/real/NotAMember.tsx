// design-web-ui.md § 1.6 — a signed-in non-member never reaches the chat:
// same shell, no avatar, no cards, no composer, one plain line and
// nothing else to do. No balance chip, no fixture controls, no retry
// button — the `⋯` menu keeps only sign out.
import type { ReactElement } from "react";
import { NON_MEMBER_MESSAGE } from "../backend/auth.ts";

export function NotAMember({ onSignOut }: { onSignOut: () => void }): ReactElement {
  return (
    <div className="not-a-member-screen">
      <p className="not-a-member-message">{NON_MEMBER_MESSAGE}</p>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}
