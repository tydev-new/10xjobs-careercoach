# Design references — what other products taught us

Idea of a curated, analysed reference set adapted (not copied) from
mindstudio-ai/remy @9cbc761 (archived, unlicensed).

Screenshots live outside this repo, at `10xjobs-design-refs/<product>/`
(private; each folder's `sources.txt` records the URL behind every
image). Every entry describes only what a named screenshot shows;
unconfirmed details are marked unverified. "What users say" summarizes
public review themes (Trustpilot only — Product Hunt, G2, and Capterra
blocked every attempt) in my own words, no quotes, no reviewer names.
Three entries also draw on owner-provided, logged-in screenshots in
`10xjobs-design-refs/_from-owner/`, which carry the owner's own real data
(names, an email, addresses, a project name) — none of it repeated here;
only layout and technique are described.

## Grok

**Context:** `10xjobs-design-refs/grok/landing-desktop.png` (1440w) and
`landing-mobile.png` (390w) — grok.com's logged-out composer, our stated
shell inspiration. **Colors:** warm off-white page `#F9F8F7`, white
composer `#FFFFFF`, a pale-blue send button `#EDF6FE`, near-black text.
**Type:** a plain geometric sans, one size for the prompt ("What should
we explore?"), gray placeholder text. **Non-obvious techniques:** the
composer is the entire page — no history, no sidebar, until a first
message exists; a `+` (attach) and a model-speed dropdown sit inside the
same pill as the input, so the whole "start a turn" surface is one
object. An owner-provided screenshot
(`_from-owner/grok-agent-jobby-screen-routines.webp`) shows a different
Grok surface: a sidebar of several named agents; the open agent's pane
pairs chat bubbles with a live mirror of its own browser tab, captioned
"<agent>'s screen," plus a short "Routines" list — named scheduled jobs,
each with one plain-language cadence line. **What users
say** (trustpilot.com/review/x.ai): free-tier limits arrive unwarned;
filtering is inconsistent day to day; support ignores billing disputes.
**What we take:** one composer pill as our own bottom bar; the empty
pre-chat screen matches § 1.5; and, as prior art for a future
scheduled-search feature (not MVP), one plain cadence sentence per
routine is rule 18 applied to scheduling. **What we don't take:** Grok's
image tools, and the multi-agent sidebar — we keep one coach (rule 12),
so it's prior art for a feature we don't have, not a shape to copy now.

## Claude (Claude.ai / Anthropic)

**Context:** claude.ai itself blocked automated loads (Cloudflare); used
instead: `10xjobs-design-refs/claude/anthropic-claude-hero.png` and
`anthropic-claude-workwith.png` (anthropic.com/claude, 1440w) and
`appstore-desktop.png` (App Store listing). **Colors:** cream page
`#FAF9F5`, Claude's terracotta mark `#D97757`, a near-black button
`#141413`, a lavender-gray card `#E6E6EE` behind a task mockup. **Type:** a serif wordmark ("Claude")
over sans-serif body and UI text — the only serif logotype in this set.
**Non-obvious techniques:** `anthropic-claude-workwith.png` shows a task
card beside a running list of steps, each with a small icon and a source
chip ("From Slack") — tool-activity rows next to the thing being built,
our § 3 collapsed "ran …" pattern in the wild. **What users say**
(trustpilot.com/review/claude.ai): paid-plan limits run out faster than
expected; a spend setting defaulting "on" surprises people with overage
charges; the model sometimes drops an earlier instruction mid-
conversation. **What we take:** one step-per-row activity list with a
small leading icon, muted color, no color-coding by tool. **What we
don't take:** the floating "Latest news" promo card, the decorative
background — a working app doesn't run ads on itself.

## ChatGPT

**Context:** openai.com and help.openai.com both bot-checked every
attempt (skipped); used instead:
`10xjobs-design-refs/chatgpt/appstore-desktop.png`, OpenAI's own App
Store screenshots. **Colors:** soft pastel gradient frames (pink, blue) behind phone
mockups; the ChatGPT mark itself is monochrome black-on-white, no brand
color. **Type:** system-style sans, small dense chat bubbles.
**Non-obvious techniques:** a persistent bottom bar holds a `+` (attach),
the text field, and a waveform/mic icon — attachment sits at the same
level as typing, not a separate step. An owner-provided desktop-app screenshot
(`_from-owner/chatgpt-desktop-browser-panel.webp`) adds a split view: an
in-app browser panel beside the chat, a card naming an open project, and
— most relevant to us — a file-edit card: an icon, the filename, a
green/red line-count delta, and two actions, Undo and Review; the
composer also carries a small removable chip pinning context for the
next turn. **What users say** (trustpilot.com/review/openai.com): people
can't tell what's drawing down usage; a task can hit its cap mid-way,
unwarned; the model sometimes ignores an explicit instruction. **What we
take:** attach-as-a-composer-icon (already § 1.1); the line-count delta
as a compact, honest receipt for what a file-writing step changed — real
numbers (rule 11), worth weighing for our own `checker`/`document` cards.
**What we don't take:** the gradient marketing frames; the Undo button on
the file-edit card — a card that reverses a write is a card firing an
action, and ours never do that (rule 7; § 2, `docs/design-web-ui.md`) —
a correction is the coach's next turn, not a button.

## Perplexity

**Context:** perplexity.ai (home, help center, blog) bot-checked every
attempt (skipped); used instead:
`10xjobs-design-refs/perplexity/appstore-desktop.png` and
`playstore-desktop.png`, Perplexity's own app-store screenshots.
**Colors:** a dark teal-black hero panel (sampled `#10393D`) behind white
display type; other panels are near-white with a pale blue chip
`#BCD6F4`. **Type:** a bold serif-leaning display face for marketing
headlines ("Hard questions. Clear answers."), plain sans in the phone
mockup's chat UI. **Non-obvious techniques:** one mockup's headline
implies citations, but no citation chip is readable at this resolution —
**unverified**. **What users say** (trustpilot.com/review/perplexity.ai):
credit runs out with no visible meter; the model in use can change
mid-session unannounced; a confident tone sometimes covers an answer
that's wrong. **What we take:** nothing concrete beyond the general idea
(an answer names its sources), already in our own plan. **What we don't
take:** the dark, editorial marketing tone, or confident phrasing not
backed by a file (rule 8, rule 11) — our copy is plain, never a pitch.

## Linear

**Context:** `10xjobs-design-refs/linear/hero-zoom-desktop.png` and
`issue-list-zoom-desktop.png` (linear.app, 1440w, viewport captures).
**Colors:** near-black background (`#080809` hero, `#131416` sidebar,
`#141516` a floating panel), off-white text `#F5F6F6`, a light pill button
`#E5E5E6` — one of the only dark-mode-first products in this set.
**Type:** a small, tight geometric sans, dense line-height, 12–13px body
text in the issue view. **Non-obvious techniques:**
`issue-list-zoom-desktop.png` shows an issue with a left nav, a comment
thread, and a floating agent panel on the right with a "Thinking…" state
and a composer — shaped almost exactly like our side panel + composer.
**What we take:** the pinned side panel as a narrow floating card, not a
full second column; tight line-height for plan/pipeline lists (Part 1,
rule 2). **What we don't take:** the near-black-only palette — ours
needs to support light and dark (§ 1.1).

## Things 3

**Context:** `10xjobs-design-refs/things3/home-desktop.png`
(culturedcode.com, 1440w, full page). **Colors:** a very pale blue-gray
background `#F2F5F7`, a saturated blue app icon (`#337EF1` core, darker
`#0D3E87`–`#134A9A` shading for its 3D bevel). **Type:** a rounded, warm
sans for headings, plenty of whitespace around every screenshot.
**Non-obvious techniques:** the checklist screenshots use one colored dot
per list (Inbox, Today, Upcoming, Anytime), not colored rows — color
marks *which list*, never priority. **What we take:** that convention for
our plan panel — item text stays neutral; only a small leading mark
carries category, never a colored row (keeps FAIL/pending states from
reading as "urgent" red, § 2.4). **What we don't take:** the isometric 3D
icon illustration style — decoration we don't need.

## Stripe Checkout

**Context:** `10xjobs-design-refs/stripe/checkout-desktop.png`
(stripe.com/payments/checkout, 1440w, full page). **Colors:** pale blue
page `#F6F9FC`, a purple-to-cyan diagonal gradient band (`#4436FF` →
`#11EFE3`) used once as a hero banner, plain white checkout cards.
**Type:** plain sans throughout, small caps-free labels on form fields.
**Non-obvious techniques:** a "Know what you'll pay" section lists the
per-transaction fee as a plain percentage *before* any action, same
visual weight as the rest of the page — money as a fact, not a warning. A
sample checkout card shows a dark "Subscribe" button with the amount
inside it, not a generic "Continue." **What we take:** show the number in
the button's own label where we can; treat the cost line as ordinary
content — matches our `cost` card (§ 2.6) and the gate's plain sentence
(§ 2.5, rule 7). **What we don't take:** the gradient band, and any
button at all — our gate is approved only by a typed `yes` (rule 7).

## Granola

**Context:** `10xjobs-design-refs/granola/home-desktop.png`
(granola.ai, 1440w, full page). **Colors:** off-white/cream background,
one lime-olive accent band (`#C3CF49` background, `#5B6F00` text) used for
a single callout, otherwise no color. **Type:** a large serif display
headline over plain sans body and UI copy — the second serif logotype
pairing in this set, after Claude. **Non-obvious techniques:** the
screenshots show a plain human-editable meeting-notes document with a
small floating strip beside it — short AI-written bullets, a draft-email
chip — never inline in the document; the human's text and the AI's
output stay two visually distinct objects even when adjacent. **What
users say:** granola.ai carries zero Trustpilot reviews as of this
writing — nothing to summarize. **What we take:** this is our
résumé/profile-in-the-side-panel relationship exactly — the workspace
file is the document of record, cards are receipts beside it, never
rewritten into it silently (rule 11). **What we don't take:** Granola's
transcript-style running log — ours is the coach's own turns, not a raw
recording.

## Huntr and Teal (job-search trackers)

**Context:** `10xjobs-design-refs/teal-huntr/huntr-home-desktop.png`
(huntr.co, 1440w, full page) — tealhq.com blocked every open-web
attempt, but an owner-provided, logged-in screenshot
(`_from-owner/teal-resume-builder.webp`) shows Teal's résumé builder.
**Colors:** Huntr's violet pair (`#8069EE`, `#694EEB`) and mint accent
`#3DFFB3`; Teal's builder is plain teal-on-white, no gradient. **Type:**
rounded sans on both, bold numerals for Huntr's stage counts.
**Non-obvious techniques:** Huntr's pipeline is a Kanban board — Wishlist
/ Applied / Interview / Offer, a count per header — beside an "AI
Powered ✨" gradient badge, the cliché we're told to avoid. Teal's builder
pairs a left accordion editor (one résumé section per collapsible row)
against a live preview mirroring its content in the résumé's own type; a
tab row above it carries small numeral/alert badges; an empty section
shows one centered sentence and one primary button, never blank space.
**What users say** (trustpilot.com/review/huntr.co,
trustpilot.com/review/tealhq.com): both are praised as clean and easy to
learn — Huntr for résumé tailoring, Teal for replacing spreadsheets; the
complaints are that Huntr's tools work best only on a résumé built inside
Huntr with inconsistent auto-fill, and Teal has thin customization and
manual data entry. **What we take:** the column-with-count convention as
prior art for a pipeline, though ours is a short list, not a board
(rule 6); Teal's empty-section pattern; its editor-beside-live-preview
relationship, strengthening the Granola case for our résumé side panel —
a rendered preview beside the editable source, not instead of it. **What
we don't take:** the sparkle/gradient badge, dense marketing stats — only
real numbers (rule 8); Huntr's format lock-in; alert-styled numeral
badges — a count is fine, a warning-styled badge is the urgency Things
3's plain dots avoid.

## Patterns across the set

- Every product we could load keeps marketing color to one accent, used
  once per screen, on an otherwise near-monochrome page; two of eight
  (Claude, Granola) pair a serif display face with sans UI text — calm,
  "written by a person," worth naming, not copying.
- Status/activity rows (Claude, Linear) stay small, muted, icon-led;
  list color (Things 3) marks *category*, never urgency or severity.
- Where money appears before consent (Stripe), it's typeset like any
  other fact, not flagged as a warning.
- A document-plus-AI layout (Granola, Teal) keeps the human's file and
  the AI's output, or an editor and its live preview, as two visually
  distinct objects, never merged silently.
- Half the "official" domains, plus Product Hunt, G2, and Capterra,
  block headless browsers outright; App Store/Play Store listings and
  Trustpilot were the reliable fallbacks.
- Job-tracker prior art (Huntr, Teal) leans on Kanban columns, alert
  badges, and AI-badge marketing already ruled out for ourselves
  (rule 6, rule 8).
- The one complaint shared by all four chat products' reviews: a limit,
  model swap, or charge nobody saw coming — evidence our balance chip,
  `cost` card, and typed-`yes` gate solve a real problem, not a reason
  to add more.
- Two real, working patterns elsewhere — a card that can undo/reverse
  its own action (ChatGPT), a multi-agent sidebar (Grok) — each conflict
  with a named rule of ours (rule 7, rule 12) and stay unadopted.

## Banned defaults for our UI

- No purple-gradient "AI" look, no sparkle emoji or icon standing in for
  status (rule 8, rule 18).
- No layout shift while streaming; no button that resizes, spins, or
  relabels while loading.
- No colored row background for urgency — color marks category only
  (Things 3), never severity; no alert-styled count badge either (Teal).
- No "Pay"/"Send"/"Submit" button anywhere near the gate, and no card
  that can itself fire, undo, or reverse an action (ChatGPT) — only the
  candidate's own typed `yes` closes anything (rule 7).
- No decorative marketing band, testimonial, or stat inside the product
  — the app is not its own ad.
- No claimed capability or number the product can't back up in that
  moment (rule 8) — matches the fixture rule in `docs/design-web-ui.md`.
- No usage limit or charge that surfaces only after it's hit (every chat
  product's reviews named this) — ours shows the range and balance
  before the gate, every time (§ 2.5, § 2.6).
- No tool feature that only works on our own file format (Huntr) — a
  candidate's files are theirs regardless of origin (rule 9).
