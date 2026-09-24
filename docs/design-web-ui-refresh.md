# Web UI refresh — visual and interaction proposal

Owner: De. A refresh of the EXISTING surfaces `docs/design-web-ui.md`
already specifies — no new features, no agent/proxy change, no gate
semantics change. Every behavior rule in that doc (typed-yes gate, one
coach/one conversation, cards, pinned side panel, 375px) stands; this
doc only picks type, tokens, and per-surface craft, each with a reason
from `docs/design-references.md` or `PRINCIPLES.md`. Screenshots live
outside the repo at
`10xjobs-design-refs/_proposals/2026-09-24-refresh/{before,after}-…png`.

## Token table

One light and one dark value for everything; nothing in `styles.css`
uses a raw hex/px outside the `:root` block.

**Color** (contrast-checked, WCAG AA ≥ 4.5:1 for every text/background
pair below):

| token | light | dark |
|---|---|---|
| `--bg` | `#faf9f6` | `#161616` |
| `--bg-panel` | `#ffffff` | `#1e1e1f` |
| `--bg-sunken` | `#f1efe9` | `#29292b` |
| `--fg` | `#1b1b1d` | `#ececea` |
| `--fg-muted` | `#6a6a6f` | `#a3a2a0` |
| `--border` | `#e5e2dc` | `#302f2d` |
| `--accent` / `--on-accent` | `#2f5fcb` / white | `#8fafef` / `#12141a` |
| `--accent-soft` | `#e8eefc` | `#22314f` |
| `--amber` / `--amber-soft` | `#8a5a0a` / `#fbefdb` | `#e3ae5c` / `#3a2c12` |
| `--green` / `--green-soft` | `#1e7e34` / `#e6f4ea` | `#7ed18f` / `#173420` |
| `--red` / `--red-soft` | `#a5372d` / `#fbe9e7` | `#e2897c` / `#3b1d19` |
| `--code-bg` | `#f1f0ec` | `#232324` |

One accent, used once per screen (Grok/Claude/Linear all keep marketing
color to a single accent on an otherwise near-monochrome page —
"Patterns across the set"). Category marks (Things 3: a leading dot
names *which list*, never urgency) stay amber/green/muted; a checker
`FAIL` is amber, never red, because it's the agent's own next turn to
fix, not the candidate's problem (`design-web-ui.md` § 2.4).

**Type** — three openly licensed (SIL OFL) families, bundled via
`@fontsource`, no external font CDN:

- `--font-sans`: **Inter Variable** (`@fontsource-variable/inter`) —
  UI text. Fallback: `-apple-system, BlinkMacSystemFont, "Segoe UI",
  Helvetica, Arial, sans-serif`.
- `--font-serif`: **Source Serif 4 Variable**
  (`@fontsource-variable/source-serif-4`) — résumé/cover-letter
  preview only. Fallback: `Georgia, "Times New Roman", serif`.
- `--font-mono`: **JetBrains Mono** 400/500
  (`@fontsource/jetbrains-mono`) — file paths, tool input/output,
  inline code. Fallback: `ui-monospace, SFMono-Regular, Menlo,
  Consolas, monospace`.

Why this pairing: two of the eight references (Claude, Granola) pair a
serif with sans UI type for a calm, "written by a person" read
(`design-references.md`, Patterns) — Source Serif 4 gets that without
copying Claude's own custom serif logotype. Scale: `--text-2xs` 11px
through `--text-2xl` 27px (8 steps); `--leading-tight/snug/normal` 1.2 /
1.4 / 1.6; weights 400/500/600/700.

**Space** (4px base): `--space-1` 4px … `--space-10` 40px.
**Radius**: `--radius-sm` 6px (chips, code), `--radius-md` 10px (cards,
inputs), `--radius-lg` 16px (side panel corners, modal), `--radius-full`
(pills, the composer, the avatar ring).
**Motion**: `--duration-fast` 120ms, `--duration-base` 220ms,
`--duration-slow` 2400ms (the idle/thinking pulse), `--ease-standard`
`cubic-bezier(0.2,0,0,1)`. Every animated state has a
`prefers-reduced-motion: reduce` fallback that swaps motion for a still
state (ring/opacity), never removes the signal.

## What changed, and why

**Type/tokens** — replaced the system-font stack and one `--radius`
var with the table above (`src/styles.css`). Every existing class kept
its name; only values and a handful of new modifier classes were added,
so the diff is a styling pass, not a rewrite. *docs/design-references.md*
Patterns; PRINCIPLES rule 18 (plain, no jargon) → plain color names, no
"AI" gradient.
**Screens**: `before-*-verdict/gate/error/document` vs. `after-*`.

**Tool activity rows** — kept the existing "ran …" collapse
(`ToolRun.tsx`, unchanged shape) but gave a `write_file` row its own
honest-receipt line instead of a raw JSON dump: `wrote
<path> · <N> lines`, where `<N>` is counted from the tool's own
`input.content` — never a diff the tool didn't report (rule 11, and
explicitly *not* ChatGPT's line-count-delta pattern, which needs a
number no fixture carries). No Undo/Review button anywhere — a card
never fires or reverses an action (rule 7; `design-references.md`,
ChatGPT "what we don't take"). *Screens: `after-900-tool-write-receipt-light.png` (an expanded "ran
read file · write file · bash" group, the `write file` row showing
`wrote base-resume.md · 10 lines`).*

**Streaming** — cards already only rendered once a `data-card` part
existed (unchanged); I found and fixed the transcript never
auto-scrolling (`Transcript.tsx`), which meant a completed card could
sit below the fold, invisible, exactly the render I caught in "render,
then look." A `useEffect` keyed on `messages` now scrolls to bottom on
every update, including mid-stream deltas. *Screens:
`before-1440-verdict-light` (card off-screen) vs. `after-1440-verdict-light`
(card in view); `after-*-midstream-*` shows a turn with tool rows
running and no card yet — no layout shift.*

**Side panel** — `.md` files now get one of two treatments, chosen off
the file's own path (never guessed from content): a résumé/cover
letter (`…-resume.md`, `…-cover-letter.md`) renders in the serif at a
roomier size (Granola/Teal: the document is the document of record,
distinct from app chrome); `plan.md` gets a tight, dot-led checklist
(Linear's line-height, Things 3's neutral-text-plus-mark convention)
instead. Everything else (jd-analysis, criteria, company notes) stays
plain sans. The header path is now monospace. *Screens:
`after-*-document-*` (serif résumé) vs. `after-*-verdict-*` (sans
jd-analysis in the same panel).*

**Spend gate and balance** — no behavior change (still code-opened,
still closed only by a typed `yes`, still no button — verified by the
unmodified `verify-screens.mjs`, which still passes). Visually: the
artifact box now sits on `--bg-sunken` (a step off the card, matching
Stripe's "cost as an ordinary fact" typesetting) and the gate line runs
at `--text-base` with `font-weight: 600` so "nothing starts until you
say yes" reads as the one thing to notice. The balance chip and cost
card use `font-variant-numeric: tabular-nums`. *Screens:
`after-*-gate-*`.*

**Errors** — copy is unchanged (`cut_off`/`step_cap`/`over_balance`
are fixed, per the brief); only the card's visual weight moved to the
token `--red`, desaturated rather than alarm-red, on `--bg-panel`.
*Screens: `after-*-error-*`.*

**Empty/first-run** — copy unchanged; centered at `--text-lg` on the
muted color so it reads calm, not a marketing empty-state. *Screens:
`after-*-empty-*`.*

**Sign-in / not-a-member** — real fix, not just restyling: these two
screens were never wrapped in `.app-root[data-theme]`
(`src/real/RealApp.tsx`), so dark mode silently never applied to them.
Now they are. Visually: the wordmark is set in the serif (the one place
a logotype gets it, like Claude's own wordmark), the mode toggle is a
pill pair, and the primary button states its own action ("Send me a
link") rather than a generic "Continue" (Stripe: "show the number/action
in the button's own label"). Rendered via a new dev-only
`?preview=sign-in|not-a-member` harness (`src/dev-preview.tsx`) — gated
behind the same `SHOW_MOCK_CONTROLS` flag that already hides the
fixture picker in production, a stub auth client that never calls out,
never reachable in the deployed build. *Screens:
`after-*-sign-in-*`, `after-*-not-a-member-*` (no `before-*` pair — this
harness didn't exist before this change, so there was no way to render
these two without a live Supabase session).*

**Phone / keyboard-up** — `.app-shell` now sizes to `100dvh` (with a
`100vh` fallback line first) instead of a bare `100vh`, so the visual
viewport shrinking under an open keyboard pulls the composer up with
it instead of pushing it off-screen. **Found and fixed while
rendering**: a pasted long URL (`gate-moment`'s job posting link) could
push a user bubble wider than the 375px viewport and clip off the left
edge (`align-self: flex-end` bubble growing past its container) — fixed
with `max-width: min(720px, 100%)` and `overflow-wrap: anywhere` on
`.bubble`. *Screens: `before-375-verdict-light` doesn't show it (an
earlier turn was in view before autoscroll existed); `after-375-verdict-light`
does, wrapped correctly.*

## What I deliberately did NOT change

The gate's four-step shape and wording (`gate-grammar.md`), the card
catalog's props/build rules (C § 6.2), the avatar's five states and
what drives them, the side panel's pinned-column layout (not a Linear-
style floating overlay — that's a bigger layout change the brief didn't
ask for), any fixture content or copy, any agent/proxy/envelope code,
the `verify-screens.mjs` tester file (untouched — still green), and the
attach `+`/`/skills` glyphs (already plain text, not emoji).

## Implementation notes for the coder

- Fonts: three `@fontsource*` deps added to `apps/web/package.json`;
  imported once in `main.tsx`, nowhere else needed.
- `Transcript.tsx`'s new autoscroll effect assumes `messages` gets a
  new array/object reference on every chunk (true for `ai@7.0.111`'s
  `useChat`) — if that update model ever changes, re-verify this still
  fires mid-stream, not just at turn end.
- `SidePanel.tsx`'s document/plan detection is a path-suffix check
  (`resume|cover-letter` / `plan.md`) — if the agent ever names files
  differently, update `bodyModifier()`, not a hardcoded list elsewhere.
- The `?preview=` harness in `dev-preview.tsx` is dev/build:preview
  only; confirm `SHOW_MOCK_CONTROLS` still gates it after any main.tsx
  refactor (grep the production `dist/` bundle for `"preview="` the way
  the README already greps for the fixture picker).
- Stacking: the phone side-panel sheet (`z-index: 30`) sits above the
  header, so any script driving it (tests, autoplay) must close the
  sheet before touching header controls — the capture script
  (`scripts/capture-design-refresh.mjs`) does this for the theme
  toggle; a future affordance should too.
- `100dvh` fallback: keep the `height: 100vh` line before the `100dvh`
  line in `.app-shell` — it's the fallback for engines without `dvh`.

## Open questions for the owner

1. Composer redesigned as one bordered pill (Grok's "the composer is
   the whole surface" — `design-references.md`) instead of separate
   boxed buttons. Confirm this reads as clearly interactive, especially
   the borderless attach/`/skills` icons.
2. Should the write-receipt's line count ever become a true delta
   (lines changed vs. the previous version)? Today's fixtures don't
   carry a "before" version to diff against — would need a schema
   change to `write_file`'s tool result, out of scope for a styling
   pass.
3. `dev-preview.tsx`'s stub-client harness is new surface area (small,
   dev-only, but new). Fine to keep long-term for design QA, or should
   it be deleted once this proposal is reviewed?

## Render evidence

`apps/web/scripts/capture-design-refresh.mjs` (new, beside the existing
`verify-screens.mjs`, which it doesn't modify) drives `mvp-journey`,
`gate-moment`, `over-limit-error`, and `empty-first-run` at 375px and
1440px, light and dark, plus the two dev-preview auth screens — 52 PNGs
total in `10xjobs-design-refs/_proposals/2026-09-24-refresh/`. The
`before-*` set was rendered from the untouched `codex/workspace-ui-phase1`
tip (commit `cbc9142`) via a throwaway `git worktree`, before any edit
in this proposal.
