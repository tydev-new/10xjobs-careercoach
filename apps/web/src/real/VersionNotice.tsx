// The § 1.8 "a newer version is live" notice — member chat screen only
// (RealChatShell.tsx). Two copy variants, word for word from
// design-web-ui.md § 1.8: the plain notice once a newer build is known, and
// the more specific one after a blocked send (design-web-agent.md § 10.3).
// Not dismissible (no close button, ever); neutral styling only (rule 8:
// never error/alarm); the Reload button is the one allowed action
// (§ 1.8: "The Reload button is allowed").
//
// Amended 2026-09-24 for C § 11 (keeping the conversation): the old ending
// ("this conversation will clear from the screen") is false now that the
// conversation is saved — EXCEPT when this tab's own latest save actually
// failed (C § 11.4), in which case both lines end with that same warning
// instead, word for word (§ 1.8's third bullet). `saveFailed` is owned by
// RealChatShell.tsx (whatever ConversationStore.save's last attempt did).
import type { ReactElement } from "react";

export type VersionNoticeMode = "newer" | "blocked";

const PREFIX: Record<VersionNoticeMode, string> = {
  newer: "Ten has been updated. Reload to use the new version. ",
  blocked:
    "Not sent: Ten has been updated since this page opened. Copy your message if you want to keep it, then reload and send it again. ",
};

const SUFFIX_SAVED = "Your files and this conversation are saved.";
const SUFFIX_SAVE_FAILED = "Your files are saved; your latest messages weren't saved and will clear from the screen.";

export function VersionNotice({ mode, saveFailed = false }: { mode: VersionNoticeMode; saveFailed?: boolean }): ReactElement {
  const text = PREFIX[mode] + (saveFailed ? SUFFIX_SAVE_FAILED : SUFFIX_SAVED);
  return (
    <div className="version-notice" role="status">
      <p className="version-notice-text">{text}</p>
      <button type="button" className="version-notice-reload" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}
