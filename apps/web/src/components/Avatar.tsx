// The five avatar states (design-web-ui.md § 1.3), driven purely by
// statusOf's return value. Motion is CSS only (styles.css .avatar--*).
import type { ReactElement } from "react";
import type { Status } from "../types";

export function Avatar({ status }: { status: Status }): ReactElement {
  const title = status.action ? `${status.state} — ${status.action}` : status.state;
  return (
    <span
      className={`avatar avatar--${status.state}`}
      title={title}
      aria-label={title}
      role="img"
    >
      <span className="avatar-dot" />
    </span>
  );
}
