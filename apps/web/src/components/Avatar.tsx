// The five avatar states (design-web-ui.md § 1.3), driven purely by
// statusOf's return value. Motion is CSS only (styles.css .avatar--*).
//
// § 5.6 "Ten's avatar (Stage 2)": the 28px brand mark, its state carried
// by a ring (a `::after` 3px outside the tile) — not the Stage 1 dot.
// Hover and the accessible name stay § 1.3's text; no visible state word
// sits beside it (that text lives only in `title`/`aria-label`).
import type { ReactElement } from "react";
import { BrandMark } from "./BrandMark";
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
      {/* The ring (§ 5.6) hugs the 28px mark itself, not the outer
          `.avatar` box — which grows to a 44px hit area at ≤760px
          (§ 5.5) without dragging the ring away from the glyph. */}
      <span className="avatar-mark">
        <BrandMark size={28} />
      </span>
    </span>
  );
}
