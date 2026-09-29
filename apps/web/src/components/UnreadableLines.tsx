// design-web-ui.md § 5.2 rule 6, "unreadable is loud": a section a reader
// can't parse shows its lines as written, under "This page couldn't read
// these lines of <path>:" (§ 5.3.1 F42, C21 — "the page's reader failed,
// not Ten"), with a link that opens the file — never silently folded
// into the empty state.
import type { ReactElement } from "react";

export function UnreadableLines({
  path,
  lines,
  onOpenRef,
}: {
  path: string;
  lines: string[];
  onOpenRef: (ref: string) => void;
}): ReactElement | null {
  if (lines.length === 0) return null;
  return (
    <div className="unreadable-lines">
      <p className="unreadable-lines-title">
        This page couldn't read these lines of{" "}
        <button type="button" className="link-inline" onClick={() => onOpenRef(path)}>
          {path}
        </button>
        :
      </p>
      <pre className="unreadable-lines-body">{lines.join("\n")}</pre>
    </div>
  );
}
