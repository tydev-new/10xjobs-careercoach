// The § 1.8 "a newer version is live" notice — member chat screen only
// (RealChatShell.tsx). Two copy variants, word for word from
// design-web-ui.md § 1.8: the plain notice once a newer build is known, and
// the more specific one after a blocked send (design-web-agent.md § 10.3).
// Not dismissible (no close button, ever); neutral styling only (rule 8:
// never error/alarm); the Reload button is the one allowed action
// (§ 1.8: "The Reload button is allowed").
import type { ReactElement } from "react";

export type VersionNoticeMode = "newer" | "blocked";

const COPY: Record<VersionNoticeMode, string> = {
  newer:
    "Ten has been updated. Reload to use the new version. Your files are saved; this conversation will clear from the screen.",
  blocked:
    "Not sent: Ten has been updated since this page opened. Copy your message if you want to keep it, then reload and send it again. Your files are saved; this conversation will clear from the screen.",
};

export function VersionNotice({ mode }: { mode: VersionNoticeMode }): ReactElement {
  return (
    <div className="version-notice" role="status">
      <p className="version-notice-text">{COPY[mode]}</p>
      <button type="button" className="version-notice-reload" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}
