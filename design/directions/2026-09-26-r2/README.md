# Three UI directions, round 2 (2026-09-26)

Task `ui-directions-2026-09-26-r2`. Round 1 (`design/directions/2026-09-26/`)
drew one layout three times in different colors. It also kept prototype tells:
status words in the header, raw file paths as titles, monospace tool logs, and
engineering words in the coach's replies. The owner's bar for this round: someone
who uses Claude.ai, ChatGPT, Linear, Notion and Teal every day looks at a screen
for three seconds and believes a funded company made it.

**The owner picked C on 2026-09-26.** Every C screen is built at full quality. A was
fully built before the pick and is kept as it was. B stops at Conversation and Phone,
as the owner asked.

| File | Direction | Screens (tabs in the file) |
|---|---|---|
| [direction-c-home.html](direction-c-home.html) | **C: search home + conversation (picked)** | Landing/sign-in · First run · Home · Talk to Ten · Talk (fixture verbatim) · Jobs · Applications · Documents · Document open · Gate · Buy credit · Error · Phone 375px · States. Jobs, Applications and Documents each have an empty state (`&empty`). Talk has mid-reply (`&stream`) and panel-open (`&doc=resume`) states. Buy credit has a credited + toast state. |
| [direction-a-conversation.html](direction-a-conversation.html) | A: conversation-first | Landing/sign-in · First run · Conversation (+ mid-reply) · Conversation (fixture verbatim) · Document open · Gate (+ approved) · Buy credit (+ credited, toast) · Error · Phone 375px · States |
| [direction-b-workspace.html](direction-b-workspace.html) | B: document-first workspace | Conversation (target voice, + mid-reply) · Phone 375px |
| [index.html](index.html) | Comparison | Thesis, one-sentence structure and a screenshot for each direction (inline PNGs), plus the token table |

Each file stands alone: CSS, JS and SVG are inline, and the only thing it loads from
outside is Google Fonts. The tab strip sits at the top of each file; add `&clean` to
the URL to hide it, and `&dark` to switch to the dark tokens. **Light is the
production default** (owner ruling, 2026-09-24). Dark values exist for every token,
but the dark screens are reference only.

## The three theses

- **C — a search you return to.** A left rail holds Home · Talk to Ten · Jobs ·
  Applications · Documents. Below it sit the application in progress and your
  account. Home shows the pipeline counts (Found → Decided → Applying →
  Interviewing → Offers), this week's plan, the active application with its stage,
  and Ten's last reply with **Continue with Ten**. Talk to Ten is the one
  conversation, with the document pinned on its right. Jobs, Applications and
  Documents are read-only views of the same workspace files. Every action in them
  sends you to the conversation, often with the message typed in the box and not yet sent. On a phone the rail becomes a five-tab bar with
  Ten in the middle, and the account menu opens from an avatar in the top bar.
- **A — the conversation is the product.** One centered column of about 720 px.
  Ten's turns have no box and your turns are soft bubbles. The composer floats.
  Each turn has one status line with an icon and a verb, and you can expand it to
  see the steps. Documents slide in as a panel on the right.
- **B — your materials are the hero.** The tailored résumé is drawn as a real
  page, with a band above it showing the verdict and tabs for Résumé · Cover letter
  · Answers. The cuts Ten made are marked on the page, with notes in the margin.
  Ten is a 420 px column on the right. On a phone the page fills the screen and Ten
  is a sheet you pull up.

All three keep one coach and one conversation (rule 12). In all three the gate
shows the complete thing and the gate line word for word, and only a typed `yes`
approves it: no button, ever (rule 7).

## C needs a doc amendment before it is built

`docs/design-web-ui.md` § 1 says: "No other screens in the MVP — no settings page,
no jobs table, no interview view". C adds Home, Jobs, Applications and Documents.
This task does not edit the doc. The architect has to write the amendment. Here is
what it has to say:

- **The Part 1 reason is rule 2:** "Keeping the pipeline moving … The sign it's
  working: the numbers change every week." In the MVP the only way to see those
  numbers is to ask the coach. C's Home shows them all the time, and it shows the
  two to four plan items rule 6 promises.
- **How it stays inside rule 12:** there is still one conversation and one place to
  type. The rail pages draw the same files the conversation writes (`jobs.md`,
  `plan.md`, `criteria.md`, `applications/*`). They keep no copy of their own and
  save nothing themselves. The plan rings on Home are decoration. "Done one? Tell
  Ten" types the message into the conversation for you; a UI checkbox never edits
  `plan.md`. The rail replaces the avatar's five states (§ 1.3): **Talk to Ten**
  shows a "Needs you" pill while a gate is open, or a spinner while a turn is
  running. Nothing in the header says idle or done.
- **Where the fixtures had no data, the screen shows its empty state instead.**
  `empty-first-run` has no files, so first run shows every rail page empty, each
  with one next step. No fixture has a submitted, interviewing or closed role, so
  those counts read 0. `gate-moment` (Priya) has no files, so her rail shows no
  counts and her Home isn't drawn. Sam's `jobs.md` supplies only his rail's "Jobs
  2". The Jobs, Applications and Documents pages use Jordan's `mvp-journey` files
  only.

## Numbers and where each one comes from (rule 8)

- **$4.20** on every Jordan screen is borrowed from `gate-moment`
  (`estimate_cost.balanceUsd`). `mvp-journey` carries no balance. Showing $5.00 there
  would claim he spent nothing, and round 1's $3.94 was made up. This is open
  question 3.
- **$5.00** on first run comes from `empty-first-run` `meta.startingBalanceUsd`.
- On the error screen the balance reads **$1.00** in the cost card and **$0.00** in
  the chip, from `over-limit-error`. The chip turns amber: it's a fact, not an alarm.
- **$13.36** after buying credit is $4.20 plus the $9.16 in the approved § 1.11
  credited line ("Added $9.16 of credit. PayPal charged $10.00; its fee was
  $0.84.").
- **"17 of your 45 min a day"** adds up the 5, 10 and 2 minutes in `plan.md` and
  compares them to its `Budget: 45 min/day`.
- **82 /100, 64 /100, 31 /100** are scores from `record_verdict.py`, which rejects
  anything outside 0–100. **Sep 22** is the date in `jobs.md`. **109 words** is
  `render_resume.py`'s own output.
- **No page count appears anywhere.** The lead's example meta was "1 page · checks
  passed", but § 2.3 says the page count in the browser print layout is
  UNVERIFIED. So documents read "109 words · Format checks passed". Every document
  also says **"Wording check not run"**, because § 2.4 leaves that question open and
  the fixture says so.

## Target-voice copy proposal (needs a coach-skill change)

The mockups show the same facts in the words a candidate uses. **This is a
proposal.** The coach's replies come from the skills, not from the UI. To ship this
copy, the coach, apply and evaluate skills (their `references/patterns.md`) have to
change and be re-measured, as `docs/PROCESS.md` requires. Every direction has one
screen with the fixture's verbatim text for comparison: C's "Talk (fixture
verbatim)" and A's "Conversation (fixture verbatim)".

| Fixture says (verbatim) | Target voice | Changed by |
|---|---|---|
| "I pulled your experience into base-resume.md … your target roles, a budget, and a goal date." | "I've read your résumé and saved your experience as your base résumé … the roles you're aiming for, how much time you can give this each day, and when you'd like an offer by." | coach skill |
| "Saved. Goal: offer by Nov 30, budget: 45 min/day." | "Saved. Goal: an offer by Nov 30, with 45 minutes a day." | coach skill |
| "Strong Fit, recorded in jobs.md." | "It's a Strong Fit, and it's on your job list now." | evaluate skill |
| "Résumé is 109 words (render_resume). Both files pass check_materials's mechanical checks, 0 fail and 0 warn each — the language check hasn't run yet …" | "The résumé is 109 words, and both documents pass the format checks — nothing failed, nothing flagged. The wording check hasn't run yet, so I can vouch for the structure but not the phrasing." | apply skill |
| "This app doesn't produce an outreach plan or a PDF — only the .md files and the printable HTML; print to PDF yourself …" | "I can't make a PDF here: open the résumé and use Print to save one. I don't write outreach plans in this app either." | apply skill |
| "weakest fit for this JD; page budget cut here first" | "Weakest fit for this posting — cut first to save space" | apply skill (`proposal_block.py` output) |
| "Say "keep <bullet>" and it comes back." | "Say "keep" and the bullet's number to bring one back." | apply skill |
| "That's what's queued in plan.md — …" | "That's your plan: …" | coach skill |
| plan line "… mechanical checks are clean; the language check has not run" | "Format checks are clean; the wording check hasn't run" | coach skill (`plan.md` lines) |
| plan line "… I have no submit tool yet" | "I can't submit applications for you yet" | coach skill |
| plan line "… more Track A roles … one search pass takes about that long" | "… more roles like this one … One search takes about that long" | coach + evaluate ("Track A" means the first entry under `criteria.md` § Targets; the verdict card says "Your target: Senior/Staff PM, B2B SaaS") |
| "That wasn't a yes, so the gate above is still pending …" / "under the threshold, so that one needs no gate at all" | "… the request above is still waiting and nothing has started." / "That's under the amount that needs your yes …" | coach skill (a candidate never needs the word "gate") |

These are UI changes rather than skill changes. The architect has to rule on them:

1. **Activity rows in plain words.** A lookup the UI owns turns each tool part
   into a verb ("Read your résumé", "Checked both documents · 0 failed · 0
   flagged"). § 1.3 already has a lookup like this for hover text. Each turn gets
   one line; open it and you see steps; open a step and you see its literal
   input/output. That third level keeps § 3 and rule 11 true. While a turn is
   running, the line shows only finished steps and the current one. It never lists
   steps that haven't run.
2. **Plan items split on the schema's " — " separators** into title, minutes and
   why. **This needs a § 2.2 amendment**, because § 2.2 says not to parse. If the
   split doesn't give exactly three parts, the UI shows the line verbatim.
3. **A backticked path in a plan line becomes a document chip.** The line's words
   stay as written.
4. **The checker cards fold into the document chip's meta**, built from the same
   parse. The cover letter's chip is its checker card drawn as a chip, because
   § 2.3 gives letters no `document` card.
5. **The error card has the heading "The run stopped"** above the server's own
   `message`, which is shown untouched. Drop the heading if § 2.7's "never a UI
   invention" is meant to cover headings too. The error card never has a Buy button:
   § 1.11 says Buy credit opens only from the chip or the menu.

## Sampling, and which references were used

`node scripts/design-sample.mjs --seed ui-directions-2026-09-26-r2 --use chat-ui`

- **Pairings.** `chat-bricolage-inter` is **used, exactly, for C**: Bricolage
  Grotesque 600/700 for headings and big numbers, Inter for everything else,
  JetBrains Mono for paths. `chat-figtree-karla` is **used for B's UI**.
  `chat-newsreader-manrope` was rejected because it was round 1's B.
  `chat-archivo-public` was rejected because it was round 1's A.
  `chat-fraunces-inter` was rejected because it is the look that ships today.
- **Fonts.** **Instrument Serif** is used only for A's hero and first-run line,
  which is where its "a short, quiet phrase" note says to use it. **Inter** is used
  for A's and C's UI and never as a display face. **Source Serif 4** is used for B's
  document page. Newsreader was rejected as round 1's face. Unbounded was rejected
  as too novel for a product people trust with money. Young Serif was rejected
  because its note says to avoid it for verdicts and money. Lora was rejected
  because of its proportional numerals in résumé dates. Fraunces was rejected as the
  shipped look. Every face used is in `design/library/fonts.json`, so none needed a
  new specimen.
- **References in the sample.** **Claude:** one row per step with a small icon,
  muted, and no colors by tool. That became the activity line in A and C. **Stripe
  Checkout:** money set as an ordinary fact. That became the cost card, the gate's
  cost row and the dialog's "Your credit now" row. **Granola:** your file and the
  AI's output stay two visibly separate things. That became B's margin notes, which
  mark the cuts on the page and never rewrite it silently.
- **Other entries used from `docs/design-references.md`.** **Linear:** a dense rail
  and a floating panel beside the thread (C). **Things 3:** color marks category and
  never urgency (the tier colors, neutral plan rings, an amber "needs you" rather
  than red). **Teal:** an empty section gets one sentence and one primary button
  (every empty state in C). **Grok / ChatGPT:** the composer is one object, and
  attaching sits at the same level as typing (all three).
- **Banned defaults we honored:** no purple gradient, no cream or terracotta, no
  emoji or sparkle icons, no three equal icon boxes (A's and C's proof points are a
  vertical list), no colored side stripes, no Kanban or alert-styled badges (counts
  are plain numbers), no button near the gate, no card that fires an action.

## The design system in brief

The full token tables are in `index.html` and in each file's `:root` and
`[data-theme="dark"]` blocks. Each file's States tab draws the brand mark, buttons
in every state, the composer, the activity line, the skeleton and empty states, the
toast, elevation, the type scale and the color swatches.

- **Brand mark.** A rounded tile holding a "1" bar and an oval "0": Ten, read as
  the numeral. C draws it as an ink tile, a white "1" and a lime "0". The favicon
  is a heavier-stroke version (`faviconHref`), and the States tab shows it at 16 and
  32 px.
- **Elevation, three levels plus a hairline.** e1 for cards and rows, e2 for the
  hero, composer and hover, e3 for dialogs, menus, the sign-in card and the panel.
  Each level is a soft shadow plus a 1 px ring, so edges stay crisp on white.
- **Icons.** Lucide 1.48.0 (ISC), inline. One icon per meaning: wallet = credit,
  file-text = document, hourglass = needs your yes, circle-check = done,
  list-todo = plan, briefcase = jobs, layers = applications.
- **Lime is a fill only.** #C8F03C is too light for text on white, so text on a
  lime background is always ink, and lime-tinted text uses `--lime-ink` #3D5700.

## Screens I iterated on, and why

- **C Home:** the "Reply to Ten" field showed a link underline. The stepper
  labels were cut off ("Strong Fit ·…") until I gave the card shorter labels. On a
  phone the pipeline strip overlapped itself, so it now scrolls sideways with snap
  points, and the hero's field and button stack.
- **C error:** the credit chip drew as a huge circle. Its `.empty` modifier clashed
  with the empty-state class, so it was renamed `.zero`.
- **C landing:** the preview's "Home" title inherited the 60 px hero size. Then
  there was a gap under the lead text, and the sign-in form sat below the proof
  points on a phone. All fixed: the proofs are their own grid item, placed with
  `order` on narrow screens.
- **C rail:** "Needs your yes" wrapped. It is now the pill "Needs you", which is
  § 1.3's own state name. It also went stale after approval, and now clears.
- **C Documents:** two cards per row left half the width empty, so the two groups
  now sit side by side. **Documents viewer on a phone:** the checks and the Print
  button were missing and are now in a bar above the page.
- **C Applications and Jobs on a phone:** a one-item list alone looked empty, so
  the phone opens the item's detail, with a back link.
- **A gate:** the "waiting for your yes" pill sat on top of the text behind it. It
  now has its own background and a taller fade. The gate card now scrolls into view.
- **A live activity line:** it showed a result ("clean") for a step that hadn't run
  yet. It now shows only finished steps and the current one, with no result on the
  current one.
- **A landing:** the trust line fell below the fold. The embedded preview was
  stretching the grid row; fixed with `grid-template-rows: 100%`.
- **A and C gate after approval:** the "Started" pill claimed work the fixture
  doesn't show, so I removed it.
- **Fonts.** Every capture allowed only `fonts.googleapis.com` and
  `fonts.gstatic.com` and logged the faces that loaded. Every screen loaded its
  intended faces. The phone document viewers show only Inter by design, because the
  page uses `render_resume.py`'s system stack.

## Self-critique against the 3-second bar

- **C (picked).** It passes. Home looks like a funded product: the ink hero card
  with its one lime action, real counts, a stepper and document rows. The honest
  weak spot is that the data is thin. One role and one application make Jobs and
  Applications look sparse. The "That's every role so far" row and the empty states
  help, but a stranger may read "1" as a demo. The landing page's lime underline is
  the one flourish. If the owner finds it marketing-ish, swap it for plain ink.
- **A.** It passes as a Claude/ChatGPT-grade chat. Its weakness is also its point:
  on a plain white column, a screenshot of a finished turn can look quiet and
  generic, and Ten's identity rests on the mark and the Instrument Serif moments.
- **B.** It is the most distinctive screen, and the page, the margin notes and the
  struck-through cuts make it look expensive. It is also the densest. At 1440 the
  coach column is cramped, and on a phone the verdict band and tabs use a third of
  the screen before the page starts.

## Notes for the coder (gotchas)

- **Stacking:** proto bar 1000 (mockup only) · toast 60 · dialog scrim 50 · menu 40 ·
  phone document panel 30 · B's coach sheet 20. The dialog must stay above the phone
  panel. Esc closes the dialog first, then the menu.
- **Overflow:** every grid child that holds text needs `min-width: 0`. Long paths
  appear only in mono details rows, with `overflow-wrap: anywhere`. The phone layout
  is **container queries** (`container: shell / inline-size`, breakpoint 760 px), not
  viewport queries, which is why the same app renders inside the 375 px phone frames.
- **Focus:** every control has a 2 px `--focus` ring with a 2 px offset.
  Build the dialog with a focus trap, and return focus to the chip or menu item that
  opened it. The composer is the only place to approve a gate: when a gate opens,
  move focus to it, but never prefill "yes". The gate screens show "yes" typed only
  to show the state.
- **Streaming:** a card appears only once it is complete. The live activity line
  changes its verb in place and lists only steps that have finished or started.
  Give the streaming turn `min-height` and the scroller `overflow-anchor: auto` so
  text doesn't jump. Send and Stop are the same 34 px button, so nothing moves.
  Buttons that load keep their width and label, with a spinner in front.
- **Reduced motion:** every animation (spin, shimmer, caret, panel slide, dialog
  pop, toast rise, skeleton pulse, the "Needs you" dot) sits inside
  `prefers-reduced-motion: no-preference`. The reduced version is the still state.
- **Keyboard up on a phone:** the composer and tab bar sit in normal flow at the
  bottom of the page grid, not `position: fixed`. Use `100dvh` with
  `interactive-widget=resizes-content` or `visualViewport` so the composer rides
  above the keyboard. The "Gate, keyboard up" phone frame shows the target.
- **Fonts in the real app:** bundle them with `@fontsource` (Inter, Bricolage
  Grotesque, JetBrains Mono for C). The mockups use Google Fonts only so they can
  stand alone. Use tabular numbers wherever figures line up.

## Not drawn in this round (still owned by `docs/design-web-ui.md`)

- the not-a-member screen (§ 1.6)
- the delete-my-data confirmation (§ 1.7)
- the newer-version and saved-conversation notices (§ 1.8 and § 1.9)
- the password screens (§ 1.10)
- the checker-failure fixture

They should adopt C's tokens without any layout change.

## Open questions for the owner

1. **C's rail:** approve the § 1 amendment described above (the rule 2 reason) so the
   architect can write it. If not, C falls back to Talk to Ten alone, with Home as
   the first-run screen.
2. **The target-voice copy:** approve it as the direction for the coach, apply and
   evaluate skills. It is a skill change with its own measurement.
3. **The balance on `mvp-journey` screens:** add `meta.startingBalanceUsd` to that
   fixture, or accept the $4.20 borrowed from `gate-moment`?
4. **Plan-line parsing (§ 2.2) and error headings (§ 2.7):** allow the " — " split
   and the "The run stopped" heading, or keep lines verbatim and show only the
   server's message?
5. **The landing's lime underline:** keep it as the one bold moment, or use plain
   ink?
