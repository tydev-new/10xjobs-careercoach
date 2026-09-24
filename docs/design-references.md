# Design references — what other products taught us

Idea of a curated, analysed reference set adapted (not copied) from
mindstudio-ai/remy @9cbc761 (archived, unlicensed).

Screenshots live outside this repo, at `10xjobs-design-refs/<product>/`
(private; each folder's `sources.txt` records the URL behind every
image). Every entry describes only what a named screenshot actually
shows; anything unconfirmed is marked unverified. Where noted, "What
users say" summarizes public review themes (Trustpilot only — Product
Hunt, G2, and Capterra blocked every attempt) in my own words, no quotes,
no reviewer names.

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
object. **What users say**
(trustpilot.com/review/x.ai): free-tier limits arrive unwarned; filtering
is inconsistent day to day; support ignores billing disputes. **What we take:** one composer pill (attach +
text + send) as our own bottom bar; the emptiness of the pre-chat screen
matches our § 1.5 empty state. **What we don't take:** Grok's
"Imagine"/image tools and model-picker — we have one coach, not a picker
(rule 12).

## Claude (Claude.ai / Anthropic)

**Context:** claude.ai itself blocked automated loads (Cloudflare); used
instead: `10xjobs-design-refs/claude/anthropic-claude-hero.png` and
`anthropic-claude-workwith.png` (anthropic.com/claude, 1440w) and
`appstore-desktop.png` (App Store listing). **Colors:** cream page
`#FAF9F5`, Claude's terracotta mark `#D97757` (confirmed on both the
wordmark and a UI accent), a near-black button `#141413`, a lavender-gray
card `#E6E6EE` behind a task mockup. **Type:** a serif wordmark ("Claude")
over sans-serif body and UI text — the only serif logotype in this set. **Non-obvious techniques:**
`anthropic-claude-workwith.png` shows a task card beside a running list
of steps ("Read 128 messages in #feedback", "Write the digest,
what-to-watch first") with a small icon per row and a source chip ("From
Slack") — tool-activity rows next to the thing being built, our § 3
collapsed "ran …" pattern in the wild. **What users say**
(trustpilot.com/review/claude.ai): paid-plan limits run out faster than
expected; a spend setting defaulting to "on" surprises people with
overage charges; the model sometimes drops an earlier instruction
mid-conversation. **What we take:** one
step-per-row activity list with a small leading icon, muted color, no
color-coding by tool. **What we don't take:** the floating "Latest news"
promo card, the decorative diagonal background — a working app doesn't
run ads on itself.

## ChatGPT

**Context:** openai.com and help.openai.com both bot-checked every
attempt (skipped); used instead:
`10xjobs-design-refs/chatgpt/appstore-desktop.png`, OpenAI's own App
Store screenshots. **Colors:** screenshots use soft pastel gradient
frames (pink, blue) behind phone mockups; the ChatGPT mark itself is
monochrome black-on-white, no brand color. **Type:** system-style sans in
the phone mockups, small dense chat bubbles. **Non-obvious techniques:**
the mockups show a persistent bottom bar with a `+` (attach), the text
field, and a small waveform/mic icon — attachment sits at the same level
as typing, not a separate step. **What users say**
(trustpilot.com/review/openai.com): people can't tell what's drawing
down usage; a task can hit its cap mid-way, unwarned; the model sometimes
ignores an explicit instruction. **What we take:** attach-as-a-composer-icon
(already our own § 1.1 composer). **What we don't take:** the gradient
marketing frames — never in the product itself; we could not verify
ChatGPT's real streaming or Canvas UI from a public page, so nothing
further is claimed here.

## Perplexity

**Context:** perplexity.ai (home, help center, blog) bot-checked every
attempt (skipped); used instead:
`10xjobs-design-refs/perplexity/appstore-desktop.png` and
`playstore-desktop.png`, Perplexity's own app-store screenshots.
**Colors:** a dark teal-black hero panel (sampled `#10393D`) behind white
display type; other panels are near-white with a pale blue chip
`#BCD6F4`. **Type:** a bold serif-leaning display face for marketing
headlines ("Hard questions. Clear answers."), plain sans in the phone
mockup's chat UI. **Non-obvious techniques:** one mockup's headline implies citations, but
at this resolution no citation chip or footnote marker is readable —
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
`issue-list-zoom-desktop.png` shows a real issue with a left-hand nav, a
comment/activity thread in the middle, and a floating "Linear · Opus 5"
agent panel on the right with a "Thinking…" state and a composer
("Skills" dropdown, attach, send) — Linear's own agent panel is shaped
almost exactly like our side panel + composer. **What we take:** the pinned side panel as a narrow floating card over the
transcript, not a full second column; tight line-height for the plan/
pipeline lists (Part 1, rule 2). **What we don't take:** Linear's near-
black-only palette — our product needs to support light and dark (§ 1.1).

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
sample checkout card shows itemized costs and a dark "Subscribe" button
with the amount inside it, not a generic "Continue." **What we take:**
show the number in the button's own label where we can, and treat the
cost line as ordinary content — matches our `cost` card (§ 2.6) and the
gate's plain sentence (§ 2.5, rule 7). **What we don't take:** the
gradient band, and any button at all — our gate is approved only by a
typed `yes` (rule 7), never by clicking "Pay."

## Granola

**Context:** `10xjobs-design-refs/granola/home-desktop.png`
(granola.ai, 1440w, full page). **Colors:** off-white/cream background,
one lime-olive accent band (`#C3CF49` background, `#5B6F00` text) used for
a single callout, otherwise no color. **Type:** a large serif display
headline over plain sans body and UI copy — the second serif logotype
pairing in this set, after Claude. **Non-obvious techniques:** the product
screenshots show a plain human-editable document (a meeting-notes page
titled "Northwind Sync") with a small floating strip beside or under it —
short AI-written bullets and a draft-email chip — never inline in the
document itself; the human's text and the AI's output are visually two
different objects even when adjacent. **What users say:** granola.ai
carries zero Trustpilot reviews as of this writing — nothing to
summarize. **What we take:** this is our résumé/profile-in-the-side-panel
relationship exactly — the workspace file is the document of record,
cards are receipts beside it, never rewritten into it silently (rule 11).
**What we don't take:** Granola's transcript-style running log — our
transcript is the coach's own turns, not a raw recording.

## Huntr (job-search tracker)

**Context:** `10xjobs-design-refs/teal-huntr/huntr-home-desktop.png`
(huntr.co, 1440w, full page) — Teal (tealhq.com) blocked every
screenshot attempt; "Teal or Huntr" is covered by Huntr's screenshot plus
review reading for both. **Colors:** a violet brand pair (`#8069EE`,
`#694EEB`), a mint accent `#3DFFB3`, near-white page. **Type:** a rounded sans, bold numerals
for stage counts. **Non-obvious techniques:** the pipeline is a Kanban
board — Wishlist / Applied / Interview / Offer columns, each card a
company + role + a couple of tag chips, a count in each column header.
Elsewhere on the page, an "AI Powered ✨" badge with gradient text sits
over several feature blocks — the exact cliché we're told to avoid.
**What users say** (trustpilot.com/review/huntr.co,
trustpilot.com/review/tealhq.com): both are praised as clean and easy to
learn — Huntr for its job-specific resume tailoring, Teal for replacing
spreadsheets; the complaints are that Huntr's tools work best only on a
resume built inside Huntr, its auto-fill is inconsistent, and Teal has
thin customization and still needs manual data entry.
**What we take:** the column-with-count convention as prior art for how a
pipeline *could* read, though our own plan is a short list, not a board
(rule 6, "2–4 things," not a Kanban). **What we don't take:** the
sparkle/gradient "AI Powered" badge, the dense marketing stats ("1000+
companies") — we show only real, honest numbers (rule 8), never a
claimed scale; nor Huntr's own-format lock-in or its inconsistent
auto-fill, both named in its reviews.

## Patterns across the set

- Every product we could load keeps marketing color to one accent, used
  once per screen, on an otherwise near-monochrome page.
- Two of eight (Claude, Granola) pair a serif display face with sans UI
  text — a calm, "written by a person" register worth naming, not
  copying.
- Status/activity rows (Claude, Linear) stay small, muted, icon-led —
  never colored backgrounds, never bold red.
- Where money appears before consent (Stripe), it's typeset like any
  other fact, not flagged as a warning.
- A document-plus-AI layout (Granola) keeps the human's file and the
  AI's output as two distinct objects, never merged silently.
- List color (Things 3) marks *category*, never urgency.
- Half the "official" domains, plus Product Hunt, G2, and Capterra, block
  headless browsers outright; App Store/Play Store listings and
  Trustpilot were the reliable fallbacks.
- Job-tracker prior art (Huntr) leans on Kanban columns and AI-badge
  marketing we've already ruled out for ourselves (rule 6, rule 8).
- The one complaint shared by all four chat products' reviews (Grok,
  ChatGPT, Claude, Perplexity): a limit, model swap, or charge nobody saw
  coming — evidence our balance chip, `cost` card, and typed-`yes` gate
  solve a real problem, not a reason to add more.

## Banned defaults for our UI

- No purple-gradient "AI" look, no sparkle emoji or icon standing in for
  status (rule 8, rule 18).
- No layout shift while a reply streams in; no button that resizes,
  spins, or relabels while loading.
- No colored row background for urgency — color marks category only
  (Things 3 pattern), never severity.
- No "Pay"/"Send"/"Submit" button anywhere near the gate — only the
  candidate's own typed `yes` closes it (rule 7).
- No decorative marketing band, testimonial, or stat inside the product
  itself — the app is not its own ad.
- No claimed capability or number the product can't back up in that
  moment (rule 8) — matches the fixture rule already in
  `docs/design-web-ui.md`.
- No usage limit or charge that surfaces only after it's hit — every
  chat product's reviews named this; ours shows the range and balance
  before the gate, every time (§ 2.5, § 2.6).
- No tool feature that only works on our own file format (Huntr's
  complaint) — a candidate's files are theirs regardless of origin
  (rule 9).
