// design-web-ui.md § 1.9 — "The saved conversation." Four of its five
// lines (the fifth, "load failed", is the setup error screen RealApp.tsx
// already renders for every other setup step — § 11.6). Every line here is
// neutral (rule 8) and blocks nothing on its own (the caller decides
// whether a send was actually blocked; this component only ever shows
// text). Word for word from § 1.9.
import type { ReactElement } from "react";

export type ConversationNoticeKind = "older-dropped" | "save-failed" | "stale-blocked" | "save-conflict";

const COPY: Record<ConversationNoticeKind, string> = {
  "older-dropped": "Older messages from this conversation weren't kept. Everything Ten saved is in your files.",
  "save-failed": "The latest reply couldn't be saved. Your files are saved. The app tries again after your next message.",
  "stale-blocked": "Not sent: this conversation continued in another tab or device. Reload to see it, then send again.",
  "save-conflict": "This reply wasn't saved: the conversation continued in another tab or device. Your files are saved. Reload to see the latest.",
};

export function ConversationNotice({ kind }: { kind: ConversationNoticeKind }): ReactElement {
  return (
    <div className={`conversation-notice conversation-notice--${kind}`} role="status">
      <p className="conversation-notice-text">{COPY[kind]}</p>
    </div>
  );
}
