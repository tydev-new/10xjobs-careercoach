# Font library — the designer's own curated set

A standing pool of openly-licensed typefaces and heading+body pairings the
designer role samples from per task, instead of picking a font from
memory (which tends to converge on the same two or three defaults every
time) or re-researching Google Fonts from scratch on every design task.

## What's here

- `fonts.json` — 30 fonts, spread across four categories: `ui-sans` (9,
  readable at 13–16px), `display` (9, serif/grotesque/humanist faces with
  character, for headings and tier words), `document-serif` (8, for
  résumé/cover-letter reading), `monospace` (4, for file paths and tool
  output). Every entry: name, `fontsource` package id, category, license,
  weights, variable yes/no, a description and an "avoid for" note — both
  in this designer's own words.
- `pairings.json` — 15 heading+body (+ optional mono) pairings, each
  tagged with the use it fits (`chat-ui`, `document-resume`, or
  `marketing-sign-in`) and a one-line rationale. Two are the app's own
  shipped baseline (`chat-fraunces-inter`, `doc-sourceserif-inter`),
  kept so a sampled candidate can be judged against what's actually live,
  not just in isolation.

## How the designer uses it

Per design task, sample a handful of entries relevant to the surface
being worked on (e.g., three `chat-ui` pairings when restyling the
transcript) rather than reading the whole file — that's what
`scripts/design-sample.mjs` (coder-owned, reads this JSON) is for. The
schema is kept flat and simple specifically so that script can filter by
`category`/`use` without any parsing beyond `JSON.parse`.

This library is a pool to choose *from*, not a mandate to use — a task
may still justify a font outside this set, but that needs the same
"decide, don't suggest" exact-value treatment as everything else in
`agents/designer.md`, and should get added here afterward if it's likely
to be reused.

## Licensing

Every font's `license` field was read from `api.fontsource.org/v1/fonts/
<id>` on 2026-09-24 (fontsource mirrors each font's own `OFL.txt` from
the Google Fonts repository). All 30 came back `OFL-1.1` — none needed
the Apache-2.0 fallback the brief allowed for. Bundle via the named
`@fontsource`/`@fontsource-variable` package (matches how the app
already ships Inter, Source Serif 4, Fraunces, and JetBrains Mono in
`apps/web/package.json`) — never a `<link>` to Google's own CSS in
shipped product code; that network call is fine only for this library's
own private specimens (see below), which explicitly aren't the app.

## Render-then-look evidence

Each of the 15 pairings was rendered as a specimen (a Ten-style chat
snippet, a verdict card, a résumé paragraph — same invented persona,
Priya Nakamura, across every specimen, no real candidate data) and
screenshotted with Playwright at 1440 and 375px, light and dark — 60
PNGs total. Specimens and screenshots live outside this repo at
`10xjobs-design-refs/_library/` (HTML in `_library/html/`, PNGs directly
in `_library/`), private like every other design reference. All 15 held
up after being looked at: no fallback-font gaps, no clipping or overflow
at 375px, no dark-mode contrast failure, no obviously clashing x-height.
One pairing (`marketing-youngserif-figtree`) is visually fine but flagged
in its own rationale as the riskiest tonal fit — kept, not dropped, with
the caution written down for whoever samples it next.

## Attribution

Idea of a curated, per-task-sampled library adapted (not copied) from
mindstudio-ai/remy @9cbc761 (archived, unlicensed); every entry here is
our own.
