// Owner ruling (2026-09-24, docs/design-web-ui.md's dated amendment):
// the real (production) app always renders the v2 LIGHT palette —
// never the host's `data-theme` on <html>, never
// `prefers-color-scheme`. This is the ONE place that decision lives;
// `main.tsx`'s `RealRoot` is the only caller, so every real screen
// (loading, sign-in, not-a-member, error, member) inherits it through
// the `theme` prop it already threads down to `RealApp`/`RealChatShell`/
// `Header`.
//
// The v2 dark tokens stay in `styles.css` (`[data-theme="dark"]`),
// dormant, for a possible future light/dark switch — this helper is
// the one line that would change if that ships. Until then, the mock
// preview build (`App.tsx`, `dev-preview.tsx` — dev/build:preview only,
// gated by `SHOW_MOCK_CONTROLS`) is left free to keep following the
// OS/explicit `data-theme` choice and its own "Switch to dark" toggle,
// since design review still needs to render both palettes; only the
// real, deployed app is pinned to light.
export function realTheme(): "light" {
  return "light";
}
