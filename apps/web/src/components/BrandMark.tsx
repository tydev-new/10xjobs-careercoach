import type { ReactElement } from "react";
// The brand mark (design-web-ui.md § 5.6, "The brand mark", amended 2026-10-09, C30): the
// website's terracotta tile holding a white "10x". The "10x" is drawn paths (the owner's own
// logo converted to outlines), not text: no font to load. The `d` below is the doc's, byte for
// byte; nobody edits it by hand (the test reads the doc and compares). The fills are the two
// brand tokens, used here and nowhere else. Sizes: 28px in the header/rail/conversation, 30px
// on sign-in (§ 5.6). Accessible name "Ten"; never "10x".
const MARK_PATH =
  "M10.1 20.4L3.4 20.4L3.4 19.7C3.6 19.7 3.9 19.7 4.2 19.7C4.6 19.6 4.8 19.6 4.9 19.5C5.1 19.5 5.2 19.4 5.3 19.3C5.4 19.1 5.5 18.9 5.5 18.7L5.5 13.6L3.4 13.6L3.4 12.8L3.9 12.8C4.3 12.8 4.7 12.8 5.1 12.7C5.4 12.6 5.7 12.4 5.9 12.3C6.2 12.1 6.3 12 6.5 11.8C6.6 11.7 6.8 11.5 6.8 11.4L8.3 11.4C8.3 11.7 8.2 12.1 8.2 12.6C8.2 13.1 8.2 13.5 8.2 13.9L8.2 18.6C8.2 18.8 8.2 19 8.3 19.1C8.4 19.3 8.5 19.4 8.7 19.5C8.8 19.5 9.1 19.6 9.4 19.6C9.7 19.7 10 19.7 10.1 19.7ZM19.2 12.8C19.6 13.2 19.9 13.7 20.1 14.3C20.3 14.8 20.4 15.4 20.4 16C20.4 16.7 20.3 17.4 20 17.9C19.8 18.5 19.4 19 19 19.4C18.5 19.8 18 20.1 17.4 20.3C16.8 20.5 16.2 20.6 15.4 20.6C14.6 20.6 13.8 20.5 13.2 20.2C12.6 20 12.1 19.7 11.7 19.2C11.3 18.8 10.9 18.4 10.7 17.8C10.5 17.2 10.4 16.6 10.4 16C10.4 15.4 10.5 14.8 10.7 14.2C10.9 13.7 11.2 13.2 11.6 12.8C12.1 12.4 12.6 12 13.2 11.8C13.8 11.5 14.6 11.4 15.4 11.4C16.2 11.4 17 11.5 17.6 11.8C18.2 12 18.8 12.4 19.2 12.8ZM16.9 18.8C17 18.5 17.1 18.1 17.2 17.6C17.3 17.2 17.3 16.6 17.3 16C17.3 15.4 17.3 14.9 17.2 14.5C17.2 14 17.1 13.6 16.9 13.2C16.8 12.9 16.6 12.6 16.3 12.4C16.1 12.2 15.8 12.1 15.4 12.1C15 12.1 14.7 12.2 14.5 12.4C14.2 12.6 14 12.9 13.9 13.2C13.7 13.5 13.6 13.9 13.6 14.4C13.5 14.9 13.5 15.4 13.5 16C13.5 16.6 13.5 17.1 13.5 17.5C13.6 18 13.7 18.4 13.9 18.7C14 19.1 14.2 19.4 14.4 19.6C14.7 19.8 15 19.9 15.4 19.9C15.7 19.9 16 19.8 16.3 19.6C16.5 19.4 16.7 19.2 16.9 18.8ZM28.6 20.4L24.7 20.4L24.7 19.9C24.9 19.9 25.1 19.9 25.2 19.8C25.3 19.8 25.4 19.8 25.4 19.7C25.4 19.7 25.4 19.6 25.4 19.5C25.3 19.5 25.3 19.4 25.2 19.3C25.1 19.2 25 19 24.8 18.7C24.6 18.4 24.4 18.2 24.3 17.9C24 18.2 23.8 18.4 23.7 18.6C23.5 18.8 23.3 19.1 23.2 19.3C23.1 19.4 23 19.4 23 19.5C23 19.6 23 19.6 23 19.6C23 19.7 23.1 19.8 23.2 19.8C23.3 19.9 23.5 19.9 23.7 19.9L23.7 20.4L21.1 20.4L21.1 19.9C21.5 19.8 21.7 19.7 21.9 19.6C22.2 19.4 22.3 19.3 22.4 19.2C22.7 18.9 22.9 18.6 23.1 18.4C23.3 18.2 23.6 17.9 24 17.5C23.7 17.2 23.4 16.8 23.1 16.3C22.8 15.8 22.5 15.4 22.3 15.1C22.2 15 22 14.9 21.9 14.8C21.7 14.7 21.5 14.7 21.2 14.6L21.2 14.2L25 14.2L25 14.6C24.9 14.6 24.8 14.6 24.6 14.6C24.5 14.7 24.4 14.7 24.4 14.7C24.4 14.8 24.4 14.8 24.5 14.9C24.5 14.9 24.5 15 24.5 15C24.6 15.2 24.8 15.3 24.9 15.6C25.1 15.9 25.3 16.1 25.5 16.4C25.7 16.2 25.8 16 25.9 15.9C26.1 15.7 26.2 15.5 26.4 15.2C26.5 15.1 26.5 15.1 26.6 15C26.6 15 26.6 14.9 26.6 14.9C26.6 14.8 26.5 14.8 26.5 14.7C26.4 14.7 26.2 14.6 25.9 14.6L25.9 14.2L28.4 14.2L28.4 14.6C28.2 14.7 28 14.7 27.8 14.8C27.6 14.9 27.4 15.1 27.2 15.3C26.9 15.7 26.7 15.9 26.5 16.1C26.4 16.2 26.1 16.5 25.8 16.8C26 17.1 26.3 17.5 26.6 18C27 18.5 27.3 19 27.5 19.3C27.7 19.5 27.8 19.6 27.9 19.7C28.1 19.8 28.3 19.9 28.6 19.9Z";

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
      <rect width="32" height="32" rx="8.5" fill="var(--brand)" />
      <path fill="var(--on-brand)" d={MARK_PATH} />
    </svg>
  );
}

/** The mark, a 9px gap, then live text "Ten" — text, not outlined, so it
 *  takes the self-hosted display font (design-web-ui.md § 5.6). The mark
 *  keeps its own role="img" aria-label="Ten" markup unchanged (it's the
 *  same component used alone), but a screen reader must hear "Ten" once,
 *  not "Ten Ten" — so here the mark sits inside an aria-hidden wrapper;
 *  the adjacent text carries the one accessible name. */
export function Wordmark({ size = 28 }: { size?: number }): ReactElement {
  return (
    <span className="wordmark">
      <span aria-hidden="true">
        <BrandMark size={size} />
      </span>
      <span className="wordmark-text">Ten</span>
    </span>
  );
}
