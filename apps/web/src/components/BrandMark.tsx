import type { ReactElement } from "react";
// The brand mark (design-web-ui.md § 5.6, "The brand mark"): a rounded
// tile holding a "1" bar and an oval "0" — Ten, read as the numeral. The
// fills are tokens, so the dark theme (dormant) follows. Sizes: 28px in
// the header/rail/conversation, 30px on sign-in (§ 5.6).

export function BrandMark({ size = 28 }: { size?: number }): ReactElement {
  return (
    <svg
      className="mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Ten"
    >
      <rect width="32" height="32" rx="9" fill="var(--hero)" />
      <rect x="7" y="8.5" width="3.6" height="15" rx="1.8" fill="var(--on-hero)" />
      <ellipse cx="19.4" cy="16" rx="4.6" ry="5.7" fill="none" stroke="var(--lime)" strokeWidth={3.6} />
    </svg>
  );
}

/** The mark, a 9px gap, then live text "Ten" — text, not outlined, so it
 *  takes the self-hosted display font (design-web-ui.md § 5.6). */
export function Wordmark({ size = 28 }: { size?: number }): ReactElement {
  return (
    <span className="wordmark">
      <BrandMark size={size} />
      <span className="wordmark-text">Ten</span>
    </span>
  );
}
