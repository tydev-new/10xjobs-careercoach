# The web UI — screens, cards, fixtures

Owner: De. Feeds step 5a (UI on a mock agent). Precedence:
`PRINCIPLES.md` → `docs/design-cowork-coaching-goals.md` →
`docs/design-cowork-coaching.md` → `docs/skill-shape.md`. Grok Bot is
inspiration only: few core objects, avatar motion as the single status
signal, structured cards over prose, a pinned side panel, a transcript
that shows what ran — but one coach, one conversation, no bot roster
(rule 12). Since 2026-09-26 (owner ruling, § 5) that one conversation
sits inside a workspace: a left rail with Home, Talk to Ten, Jobs,
Applications and Documents, where every page but Talk to Ten is a
read-only view of the candidate's own files.

This doc owns the UI: screens, layout, and each card's rendering and
copy rules. It does **not** own the envelope, the gate protocol, the
transport, or any type — those are `docs/design-web-agent.md` ("C"),
and this doc references C's sections rather than copying their
contents (rule 12 — a copy drifts). Where C doesn't fully specify
something rule 7/8/11 needs, that's named as **open for the
architect** in place, not guessed at.

**Amendment, 2026-09-24 (owner decision):** the real (deployed) app
always renders the v2 LIGHT palette — every screen, including sign-in,
not-a-member, and the setup/error screens — regardless of the OS's
`prefers-color-scheme` or any host `data-theme`. `design-web-ui-refresh.md`'s
v2 § "dark is the primary/richer identity" is superseded for the real
app by this ruling; the v2 dark tokens stay in `styles.css`
(`[data-theme="dark"]`), dormant, for a possible future light/dark
switch, and the dev/build:preview mock still renders both for design
review.

## 1. The one screen (now Talk to Ten, § 5)

Two panes: transcript (left) + pinned side panel (right), composer
pinned to the bottom of the transcript. No other screens in the MVP —
no settings page, no jobs table, no interview view (`apps/workspace-ui`'s
job, post-MVP only if dogfooding shows chat + cards isn't enough).

**Amended 2026-09-26 (owner ruling, § 5).** The "no other screens" line
above is superseded. This screen is now **Talk to Ten**, one of five
places in the workspace (§ 5). Everything in § 1.1–§ 1.11 still holds for
it; § 5 says what moves to the workspace frame (the header) and what the
four new pages are. Still no settings page and no interview view.

### 1.1 Desktop wireframe

```
┌────────────────────────────────────────────────┬───────────────────────────┐
│ ◉ Ten · working              $4.20  ⋯          │ résumé — Acme, Staff PM   │
├────────────────────────────────────────────────┤ ─────────────────────────│
│                                                  │ # Jordan Alvarez         │
│  you: here's the Acme posting                    │ ## Summary               │
│       https://boards.greenhouse.io/acme/…        │ 8 years of product...    │
│                                                  │                           │
│  ▸ Read its instructions · Searched the web ×3   │ ## Selected Experience   │
│                                                  │ - Led...                 │
│  ┌ Verdict ─────────────────────────────────┐   │                           │
│  │ Acme — Staff PM: Strong Fit               │   │                           │
│  │ 8 years of B2B SaaS PM experience...      │   │                           │
│  │ [ See full analysis → ]                   │   │                           │
│  └────────────────────────────────────────────┘  │                           │
│                                                  │                           │
│  Ten: want me to tailor a résumé and letter?     │                           │
│  you: yes                                        │                           │
│                                                  │                           │
│  ▸ Ran the automatic checks · Saved a file ×2    │                           │
│  ┌ Résumé — 109 words · automatic checks ✓ ─┐   │  [ Print / Save as PDF ]  │
│  └────────────────────────────────────────────┘  │  [ Export workspace ]    │
├────────────────────────────────────────────────┤                           │
│ [ + ]  Message Ten…                             │                           │
└────────────────────────────────────────────────┴───────────────────────────┘
```

- **Header:** avatar with its five states (§ 1.2), a balance chip
  (reads `deps.balance()` — C § 8, not the envelope; rounded **down**
  to the cent, and a balance at or below zero still reads `$0.00`,
  never a negative number), a `⋯` menu (export workspace, "Import
  workspace" — C § 2, lead ruling 2026-09-28, delete my
  beta data — § 1.7, set a new password — § 1.10, sign out). There is no per-candidate key to
  manage — one shared app key sits behind the model proxy (C § 8) — so
  "manage your usage key" is gone from the product, menu included.
- **Transcript:** prose interleaved with collapsed activity lines
  (§ 3) and cards (§ 2), oldest first, autoscroll.
- **Composer:** attach and free text, with no skill picker (plain
  language always works, rule 18; § 5.3.1, C22); a pasted link is
  offered as "Evaluate this?" rather than parsed silently.
- **Side panel:** shows whichever workspace file the last-opened card
  points at (its `ref`), with a print button, "Print / Save as PDF", when a `document`
  card's `htmlPath` is set. Empty: "Nothing open yet."

### 1.2 Phone wireframe (375px)

The side panel becomes a full-screen sheet, opened from a card's "Open in panel →"
affordance, closed by a back arrow. Everything above must
render and be usable at exactly 375px — no horizontal scroll, tap
targets ≥ 44px.

### 1.3 Avatar states

Five states, derived by C's `statusOf(messages, chatStatus)` (§ 6.1) —
there is no status part in the envelope, so the header never sends
one, only reads the pure function's result: `idle` (no turn yet in
this chat) · `thinking` (text streaming) · `working` (a tool part not
yet done — hover text is that tool's one-line label, a small UI-owned
lookup by tool name) · `needs-you` (an open `data-gate`, per the
`data-gate-status` stream C § 3 defines) · `done`. Motion: still/glow
for idle, slow pulse for thinking, a spinner ring for working, an
amber attention pulse for needs-you (never blinking/urgent-red — rule
8), fading to still for done. `needs-you`'s hover text is the pending
gate's `label` (C § 3 — the model's own ≤6-word tag).

### 1.4 Sign-in

Minimal: email/password or magic link, one line under the logo from
`PRINCIPLES.md` rule 1 ("Help you get a job offer you actually want."),
and a line "Prefer local? Run it from your terminal." (rule 9 —
local-first stays a supported exit). Sign-in is **shared with the
older CareerCoach app** (C § 8) — the same credentials sign a
candidate into both, and anyone can complete it; it proves who someone
is, not that they're in the beta. **After sign-in, one membership
check** (a credit row, C § 8) decides what comes next, before the chat
ever mounts: a member goes straight to § 1.5, anyone else sees § 1.6.
No separate route or spinner screen — the check happens once, on the
same shell. A recovery link shows § 1.10's "Choose a new password"
before this check; forgot password and the expired-link line are
§ 1.10 too.

**Amended 2026-09-26 (owner ruling, the restore ruling in § 5).** "Minimal"
above now means one sign-in form, not a bare page. Beside the form the
page adds a lead paragraph, three proof points and a product preview.
Nothing else changes: the rule 1 line, the local link, the shared
sign-in and the membership check stay as written above.

- **The lead paragraph**, word for word: "Ten runs your search with
  you: it scores the roles you bring it, tailors your résumé from your
  own facts, and keeps a short plan of the few things only you can do."
  The mockup said "it finds and scores roles". "Finds" is cut: the web
  app loads only profile, evaluate, apply and coach (C § 4, `load_skill`),
  so no skill in it finds roles yet. "Finds" returns to this paragraph
  only when a role-finding capability ships in the web app, through its
  own design (owner, 2026-09-26, in chat: add on-demand web job search
  before the beta).
- **The three proof points**, each checked against the skills. The
  mockup's text is kept where it is true; two phrases are changed. The
  owner approved the changed wording and the lead paragraph on
  2026-09-26 (§ 5.10, owner question 1).
  1. **"A verdict on every role, with the reasons."** "Paste a posting.
     Ten researches the company, scores the fit out of 100, and says why
     in plain words." True in the web app: a role enters `jobs.md` there
     only through `record_verdict`, whose `--verdict` is required
     (`skills/evaluate/scripts/lib/record-verdict.mjs:30`); a pasted posting gets the full evaluation,
     which writes the company brief (evaluate's schema); the score is
     bounded 0–100 (`skills/evaluate/scripts/lib/record-verdict.mjs:53-54`). One caveat stays with it:
     `--score` is optional (`skills/evaluate/scripts/lib/record-verdict.mjs:31`), so a row can carry a verdict with no score
     (Jobs shows no number then, § 5.3).
  2. **"Tailored from your facts, never inflated."** "Ten picks from what
     you gave it, never states a claim stronger than that, and shows you
     what it cut." True: a tailored bullet must be the base résumé's own
     sentence unless it is a declared, approved rewording, and
     `check_materials` FAILs any other (apply's schema, `## Reworded`);
     the cut list is `proposal_block`'s output, shown in the reply.
  3. **Changed: "No big run without your yes."** The mockup's "Nothing
     spent without your yes" overclaims: every turn spends credit, and a
     turn may spend up to `spendGateUsd` with no yes (C § 4,
     "Allowance"; promise 5 says the cost is shown "before any big
     run"). Body: "Bigger jobs show a cost range first, and only your
     typed yes starts them. In this app, you send and submit, not Ten."
     The mockup's "Ten never sends or submits as you" is changed too:
     it is true of this app (no send or submit tool, C § 4) and of
     outreach ("The candidate sends everything", outreach `SKILL.md:10`),
     but local apply submits a filled form on the candidate's explicit
     word (apply `SKILL.md:57`), so "never" is not a product-wide truth.
- **The product preview** is a static picture of Home built from
  invented sample data: the Home page's own view component (§ 5.3),
  rendered from its own props file, `apps/web/fixtures/signin-preview.json`,
  never on anyone's files. That file is not `workspace-pages.json` (§ 5.7),
  whose job is edge cases; it holds one ordinary, invented search: the
  props Home's view takes, plus the invented `files` and `messages` they
  come from (§ 4's shape). A test runs Home's real readers over those
  files and messages and checks the result equals the props, so the
  preview can't show what the readers wouldn't. Its text goes through
  Stage 4's string review and `design-plain-replies.md` § 3's fixture
  scan, like every fixture. It is marked `inert`, hidden from
  assistive tech with one text alternative ("A preview of Ten's Home
  page, with sample data"), and carries a visible caption "Sample
  data". Because it is Home's own view, it can't show a feature Home
  doesn't have. The designer places it (§ 5.6); on the phone the sign-in
  form comes first in reading order.
  *Prevents:* a signed-out page reading a store or showing a real
  person's data; a preview that advertises what the product doesn't do
  (rule 8). *Proved by:* an e2e run of the sign-in page on a spy store
  and a spy transport (zero calls); the preview's text equals Home's
  view rendered on `signin-preview.json`'s props, and those props equal
  Home's readers run over its files; a bundle test finds the three proof
  points and the lead paragraph word for word (stage 4).

### 1.5 Empty / first-run state

Static UI copy, not a `UIMessage` sent to or from the model (nothing
has run, so `Coach.stream` produced nothing): avatar `idle`, one line
naming the honest next step — no manufactured welcome enthusiasm (rule
8). **Members start at $5** (C § 8, owner 2026-09-23: an admin-inserted
credit row of $5.00), so the chip reads `$5.00`, not `$0.00`:

```
◉ Ten · idle                                  $5.00  ⋯
Ten: I don't have anything of yours yet. Drop in a résumé,
     or tell me the job you're going for, and that starts
     your workspace.
```

Side panel: "Nothing open yet."

### 1.6 Not a member

Sign-in is open to anyone (§ 1.4); only a member — a credit row an
admin inserts — can use Ten (C § 8). A signed-in non-member never
reaches the chat: same shell, no avatar, no cards, no composer, one
plain line and nothing else to do (rule 18, honest — there is nothing
this screen can offer them but the fact):

```
You're signed in, but this beta is invite-only. Ask the
person who invited you to add you.
```

No balance chip (there is nothing to spend yet), no fixture/preview
controls, no retry button — the only way forward is someone else
adding the credit row; signing out and back in re-checks membership.
The `⋯` menu keeps only sign out. This is C § 8's own wording for the
app to say; this section fixes only where and how it's shown.

### 1.7 Delete my beta data

The `⋯` menu's one irreversible action. C § 3 keeps the term "gate"
for the spend gate alone, but rule 7 names *any* action that's
identity-bearing or irreversible, and this one erases records — so it renders in the same shape, the candidate's
typed `yes` standing in for a button the same way it does at a spend
gate (§ 2.5):

1. **The complete thing** — named, not summarized: "your workspace
   files, your conversation, and your record of spending requests"
   (§ 5.3.1, C15; C § 8:
   `ten_ws_files` and the Storage bucket, `ten_conversations` (C § 11.7,
   amended 2026-09-24), `ten_gate_log`; every ledger row is kept,
   C § 17.4, amended 2026-09-25).
2. **The one plain sentence**, word for word (C § 17.4 amends C § 8's):
   "This deletes your Ten beta data. Your sign-in stays because it's
   shared with the older app. Your credit stays, and so do your payment
   and usage records, which show only amounts and no content." It ships
   only after `ten-delete-account` keeps every ledger row.
3. **The candidate's typed yes** — the same composer, the same rule as
   the spend gate: no button fires it, only an exact typed `yes`.
4. **The report-back** — once `ten-delete-account` returns, one line
   confirms what happened: "Deleted. You're signed out of Ten — your
   sign-in for the older app is untouched."

This is a menu-triggered confirmation, not a `data-gate` part (C § 3's
`GateRequest.kind` is `"spend"` only): it carries no `gateId` and never
touches `ten_gate_log`. **Open for the architect:** whether this
confirmation reuses the gate card's rendering (a `kind` value C § 3
doesn't have yet) or is its own component that happens to follow the
same four steps — either way, no button, ever.

### 1.8 A newer version is live

Mechanism: C § 10. On the member chat screen, one line above the
composer (since 2026-09-26, on every member page too: § 5.1). It
blocks nothing, uses neutral styling (never error or alarm,
rule 8), and can't be dismissed. It shows only when no turn is running:
the agent runs in this tab, so a reload mid-turn would stop the run.

**What a reload keeps and loses** (amended 2026-09-24 for C § 11). Kept:
workspace files (C § 2), the balance (C § 8), the sign-in (`auth.ts`),
and the conversation up to its last saved turn (C § 11), including a
spend gate waiting for a yes (C § 11.6). Lost: unsent composer text, a
turn still running (so the notice waits until none is), and any turn
whose save failed. *(Before C § 11, read in the code at `cbc9142`: the
whole conversation was lost — `RealChatShell.tsx:61` starts from
`messages: []`, `RealApp.tsx:63-65` makes a fresh chat id per load.)*

**Copy, word for word** (what happened and what the candidate can do,
never what the agent will do: the L2 rule, § 2.7). Amended 2026-09-24:
the earlier ending, "Your files are saved; this conversation will clear
from the screen.", is false once C § 11 ships. **This copy ships in the
same site release as C § 11's save, never apart** (C § 11.8).

- Notice, with a `Reload` button: "Ten has been updated. Reload to use
  the new version. Your files and this conversation are saved."
- After a blocked send (C § 10.3): "Not sent: Ten has been updated since
  this page opened. Copy your message if you want to keep it, then reload
  and send it again. Your files and this conversation are saved."
- When this tab's latest save failed (C § 11.4), both lines end instead
  with: "Your files are saved; your latest messages weren't saved and
  will clear from the screen."

**The Reload button is allowed.** Rule 7 covers what is sent as the
candidate, submitted for them, or costs money (plus § 1.7's delete). A
reload does none of these; it does what the browser's reload does, and
the notice names what it loses.

### 1.9 The saved conversation

Mechanism: C § 11 (amended 2026-09-24). Each line is neutral, one line
above the composer unless noted, and blocks nothing unless noted.

- **Older turns not kept** (C § 11.4), at the top of the restored
  transcript: "Older messages from this conversation weren't kept.
  Everything Ten saved is in your files."
- **A save failed** (C § 11.4): "The latest reply couldn't be saved. Your
  files are saved. The app tries again after your next message."
- **Stale tab, before a send** (C § 11.5; the message is not sent and its
  text stays in the composer): "Not sent: this conversation continued in
  another tab or device. Reload to see it, then send again."
- **Save conflict** (C § 11.5): "This reply wasn't saved: the conversation
  continued in another tab or device. Your files are saved. Reload to see
  the latest."
- **Load failed** (C § 11.6): the setup error screen with Retry and Sign
  out, "Couldn't load your conversation. Try again in a moment."

### 1.10 Passwords (amendment, 2026-09-25; draft for owner approval)

Owner-reported gap: an account made from an email link has no password,
and nobody can reset a forgotten one. Mechanism, security and the owner's
checklist: C § 16. All three screens below render in the v2 light palette
(the 2026-09-24 amendment above), use only `styles.css` custom properties,
and work at 375px (§ 1.2). They use ordinary buttons: rule 7 covers what
is sent as the candidate, submitted for them or paid for, and here the
candidate types their own password twice.

**One menu item, "Set a new password"** (member `⋯` menu, above Sign out).
The app can't tell whether an account already has a password (C § 16.1),
so "Set a password" or "Change password" would each be false for someone.
"Set a new password" is true either way. § 1.6's menu is unchanged.

**The form** (the menu dialog and the recovery screen share it): "New
password" and "Type it again", both hidden, one `Show`/`Hide` button for
both. Checked before any call: "Use at least 8 characters." · "The two
passwords don't match."

- **Dialog.** Title "Set a new password". Line: "This password also works
  for the older app, which shares your sign-in." Buttons: `Save password`,
  `Cancel`. Success: "Password saved. Use it next time you sign in, here
  or in the older app." and `Done`.
- **Code step** (only when Supabase asks, C § 16.1): "For your security,
  we emailed a 6-digit code to {email}. Enter it to save your new
  password." A `Code` field; `Save password`, `Send a new code`, `Cancel`.
  After a resend: "A new code is on its way to {email}. Use the newest
  one."
- **Errors**, one line each, never Supabase's own text (§ 2.7's rule):

| Supabase says | The line |
|---|---|
| `reauthentication_not_valid` | "That code didn't work. It may be mistyped or expired: check the newest email, or send a new code." |
| `weak_password`, reason `length` | "That password is too short for the sign-in rules. Try a longer one." |
| `weak_password`, reason `characters` | "That password needs more kinds of characters, such as capitals, digits or symbols." |
| `weak_password`, reason `pwned` | "That password has appeared in a known data leak. Choose a different one." |
| `same_password` | "That's already your password. Choose a different one." |
| HTTP 429 | "Too many tries. Wait a minute, then try again." |
| anything else | "Couldn't save your password. Try again in a moment." |

**Sign-in screen additions** (§ 1.4). In "Email + password" mode, under
the password field, a link button: "Forgot or never set a password?" It
opens, on the same card:

- Title "Reset your password". Line: "Enter the email you sign in with to
  get a link for choosing a new password." Button `Send reset link`; link
  `Back to sign in`.
- After a success **or** a 429, the same text, character for character:
  "If an account exists for {email}, a link to choose a new password
  should arrive within a few minutes. Check spam too. Only a few emails
  can be sent each hour, so if nothing comes, try again later." No other
  line may depend on whether the account exists.
- Any other failure: "Couldn't send the request. Try again in a moment."
- A link that came back with an error (C § 16.1), above the form: "That
  email link has expired or was already used. Ask for a new one below."

**"Choose a new password"** — the first screen after a recovery link,
before the membership check and before the chat (C § 16.1). Line:
"You're signed in from your reset link. This password also works for the
older app, which shares your sign-in." The form; buttons `Save password`
and `Sign out`. Success: "Password saved. Use it next time you sign in,
here or in the older app." and `Continue`, which runs the normal
membership check (§ 1.4). Errors: the table above.

### 1.11 Buy credit (amendment, 2026-09-25; approved by the owner, 2026-09-25)

Mechanism: C § 17. Members only (§ 1.6 has none). Opened from the balance
chip or "Buy credit" in the `⋯` menu, never from a card or the chat. A
dialog; Close or Esc shuts it. The refund contact is
`support@10xjobs.co` (owner, 2026-09-25). Copy, word for word:

- "Buy credit". "Credit pays for Ten's work. You pay in PayPal's window;
  Ten adds what arrives after PayPal's fee, a few percent plus a fixed
  amount. This is a one-time payment: nothing renews, and Ten never
  charges you on its own." Then `$10`, `$20`, `$40` and PayPal's buttons.
- Under them: "Paid credit stays if you delete your beta data. The beta
  has a shared daily limit, so on a busy day Ten can pause until tomorrow
  even with credit. For a refund, email support@10xjobs.co."
- Credited (numbers from the reply): "Added $9.16 of credit. PayPal
  charged $10.00; its fee was $0.84." The chip refreshes.
- Pending: "PayPal is still clearing this payment. The credit is added
  when it clears."
- Declined: "PayPal declined this payment. No money moved."
- Window closed: "No payment was made."
- Create-order failed: "Couldn't start a payment. No money moved."
- `paid_not_credited`, `unconfirmed`, or no answer (C § 17.10): "Ten
  couldn't confirm the credit
  yet. If PayPal took your payment, it's added automatically, usually
  within minutes. If not by tomorrow, email support@10xjobs.co with PayPal's
  receipt."

Replaced, after the function change (C § 17.4): `over_balance` reads "Your
credit is used up. You can buy more from your balance at the top." The
delete copy is in § 1.7 (amended 2026-09-25).

## 2. The card catalog

Every card is a `data-card` part — `{ card: CardType, props, ref? }`
(C § 6.1 owns the wrapper and `CardType`; **C § 6.2's build table is
the one source of truth for every card's props** — code builds every
card from a tool result, the model never writes one (rule 11; C § 6.2:
"the model never writes a card"). This doc adds only what C's table
doesn't cover: side-panel behavior and display copy.

No card self-fires an action (rule 7) — the only confirm anywhere is
the gate's typed `yes` (§ 2.5).

### 2.1 `verdict`

Receipt of the `jobs.md` row `record_verdict.mjs` wrote (C § 6.2, row
2) — not the prose summary card evaluate's `SKILL.md` still writes in
the reply; the two intentionally show the same tier twice, once from
the file and once from the model (C § 6.2, "S8"). `ref` = the row's
`analysis_file` (C § 6.2). **Side panel:** opens `ref`. **Copy:** the `verdict` enum
maps to a display label by a static UI table (`strong` → "Strong Fit",
etc. — `eval.md`'s four tier names). No `dealbreakers` → the section
reads "none", never omitted (rule 8). A `reason` beginning
`quick-scan:` gets a quick-scan badge, read off that same word-for-word
field rather than a second prop.

### 2.2 `plan`

Receipt of `plan.md § Board → To do`, via `parsePlanTodo` (C § 6.2:
lines under "To do", `1. `/`- `/`* ` bullets accepted, `text` = the
line minus its bullet **word for word**, `ref` = the first backticked
workspace path in the line, else absent). `PlanCardProps = { stage,
items: { text, ref? }[] }`. **No parsed title/why/minutes** — coach's
own schema already puts the why and the minutes inside each line
(`schema.md`), so splitting them with a regex would risk showing a
wrong number; showing the line word for word is the rule 11 receipt.
`ref` (card-level) = `plan.md`. **Side panel:** the card opens
`plan.md` by default; an item with its own `ref` opens that file
instead. **Copy:** render each `text` as written, in file order, never
reordered or summarized. The 2–4 count (`PRINCIPLES.md` rule 6) is
coach's own rule to hold when it writes `plan.md`, not something this
card enforces or checks.
*Restore ruling (2026-09-26, § 5):* this card is unchanged. The pages
(not the card) show a minutes pill, using one strict form read by C
§ 18.1; only the two separators are replaced, and nothing else in the
line is lost. The "wrong
number" risk above is why that form is strict and a line in any other
form shows as written (§ 5.3, "The plan item").

### 2.3 `document`

Receipt of a successfully rendered résumé only (C § 6.2, row 4) — **a
cover letter never gets a `document` card**, only a `checker` card,
because it isn't rendered. `props = { words, htmlPath?, checker }`,
`ref` = the `.md` path. `checker` is `clean`, `warn` or `fail` from the
latest check of this `.md`, or `not-run`; `warn` shows "no failures, 1
warning" or "no failures, N warnings" (`design-honest-ceilings.md`
§ 6A). **Side panel:** opens `ref`; `Print / Save as PDF`
(§ 5.3.1, C6)
appears when `htmlPath` is set and prints that sandboxed iframe (the
browser's own print-to-PDF — `render_resume`'s `--pdf` is ignored, and
page count in the browser print layout is **UNVERIFIED**, so no page
count is ever shown). **Copy:** `checker: "fail"` shouldn't coexist
with a rendered `document` card at all under C's own build rule (a
card only exists after `render_resume` actually ran, exit 0) — if it
does, that's an upstream bug, not a UI state to design copy for.

### 2.4 `checker`

Receipt of `check_materials.mjs`'s own stdout, **one card per checked
file** (C § 6.2, row 3) — a combined `--resume … --letter …` call
yields two cards. `props = { label, name, status, failCount, warnCount,
findings }`, parsed from the script's own `LABEL name: pass|FAIL (n
fail, m warn)` / `  [LEVEL] msg` lines, word for word — the same parse
feeds the `document` card's badge, one parse not two. `ref` = the
checked file. **Copy:** zero findings renders as "clean"; a pass with
warnings never renders as "clean", on this card or the `document`
badge (`design-honest-ceilings.md` § 6A). A `FAIL` is
styled distinct, not alarm-red, since it means the agent's own next
turn must fix it before delivery, not that the candidate must act.
**Open for the architect:** neither this card nor any reply currently
says whether the language check (`check_language`, C § 4, PENDING
OWNER) ran — until O decides, a delivered document's reply must say
plainly that the language check did not run (rule 8; the fixtures do
this now).

### 2.5 The `spend` gate

The only gated kind on the web is `spend` (C § 3 — no MVP tool sends
or submits; a send/submit is a `plan` to-do the candidate does
themselves, § 2.2). **There is no separate gate-opening tool call**:
when `estimate_cost` returns `needsGate: true`, code opens the gate
itself in the same step — `label` = the tool's own `action` input,
`text` = `action` plus the cost line, `amountUsd` = `highUsd`, and
`gateLine` is copied word for word from `gate-grammar.md`'s spend line
with `$<amount>` filled in (C § 3). The model never composes the gate
line and supplies nothing beyond `action` (already an ordinary tool
input). Status lives only in `gate_log`, streamed as a separate
`data-gate-status` part (`{ gateId, status }`, C § 3) — the `data-gate`
part itself never changes once emitted. **The composer is the only way
a gate closes**: the candidate types `yes`, and `matchGateReply(text,
origin)` (C § 3) — trimmed, lowercased, at most one trailing `.`/`!`,
exactly `yes`, and `metadata.origin === "typed"` — decides before the
model ever sees the reply. No button, ever. Code opens a gate whenever
`needsGate` is true, regardless of balance — the model cannot hold it
back, and the `cost` card (§ 2.6) always shows `balanceUsd` beside the
range so the candidate can judge it themselves. The only
`data-error over_balance` comes from the model proxy's own balance
check, which runs **before** it forwards anything upstream (C § 8: "if
the user's balance is not above 0, 402") — not from OpenRouter
rejecting a call mid-run. So a run that hits it stops with **no model
reply for that step**: whatever finished earlier in the turn (the
roles already recorded, the files already written) is what's on
screen, and the next word from the model comes only once the candidate
sends a new message, once there's credit again. See
`over-limit-error.json`.

### 2.6 `cost`

`props = { action, lowUsd, highUsd, balanceUsd }`, straight off
`estimate_cost`'s own return (C § 6.2, row 1) — no field the tool
didn't return, no widening or rounding by the UI. `ref` unset.
**Copy:** always the range, never a single number (rule 8). This card
is informational only — the one confirm for a spend is the gate
itself (§ 2.5); there's no second "say go" reply.

### 2.7 `data-error`

Rendered exactly as the envelope carries it — `{ code, message,
retryable }` (C § 6.1 names the `code` values). `message` is
never a UI invention: it's the literal sentence the server sent, and
under `model_error` that sentence differs by cause even though the
`code` doesn't — the beta-wide ceiling ("The beta has reached today's
limit. Try again tomorrow.") and an upstream failure are both
`model_error`, told apart only by their own `message` text (C § 8),
never by a separate code. A reply cut off at the output limit is its
own code, `cut_off` (C § 9.3, amended 2026-09-24): a fixed message
that already says what to do, so it has no `nextStep` line. `over_balance`'s own message is now § 1.11's "Your credit is used up.
You can buy more from your balance at the top." (C § 17.4; § 5.3.1,
C16), so the old `nextStep` lookup entry for it is gone: the message
already says what to do, and repeating it would be the kind of
boilerplate rule 8 rules out. `model_error` carries no `nextStep` line
either, for the same reason — one static line can't fit both "try
again in a moment" and "try again tomorrow" without contradicting
whichever one is actually true. The remaining `nextStep` entries
(`tool_error`, `offline`) are unchanged. The UI never
computes a number into `message` that the part didn't carry (e.g. "2
of 8 roles") — that belongs in the model's own next plain-text turn.

**Amended 2026-09-24** (closing drift review of issue #2, follow-up A;
lead ruling): `step_cap`'s `nextStep` line used to read "This opened a
gate — type yes to continue the run.", but that's untrue — the
step-cap stop (`coach.ts`'s combined stop condition, its hard-cap
check) writes the `step_cap` error and ends the turn; it opens no
gate. Only the *separate* mid-run allowance stop (§ 2.5, C § 4) opens
a "Continue this run" gate, and that path never writes `step_cap`. The
line says only what's true and what the candidate can do next, with no
gate promise.

**Amended again 2026-09-24** (issue #2, round 2; lead ruling). The line
that replaced it, "Send another message to pick up where it left off.",
was still wrong on two counts:

- **Untrue after a long turn.** The window can drop the whole capped turn,
  and nothing told the model the turn had stopped.
- **It promised what the agent would do** (the L2 rule).

The agent now adds a next-turn note after a `step_cap` (C § 9.4). The
copy is:

- message, fixed (C § 6.1): "This turn ran out of steps before
  finishing."
- `nextStep` line: "Say continue to carry on from what's already saved."

The `nextStep` line mirrors `cut_off`'s "say continue" and says only
what the candidate can do. "Already saved" is true because the note
sends the model to the files.

**Amended 2026-09-24 (C § 12).** A request the proxy refuses as too large
is its own code, `too_large`, no longer a `model_error` showing the
proxy's "Request too large.":

- message, fixed (C § 12.2):
  "This turn got too big to send, so it stopped partway."
- `nextStep` line: "Say continue to carry on from what's already saved."

It is true for the same reason as `step_cap`'s: the next turn starts
small, and C § 9.4's note sends the model to the files.

### 2.8 search

`props = { boardsRead, boardsNotRead: { company, reason }[],
postingsLookedAt, matching, alreadyOnList, added, quickPassed,
webSearches, droppedOffBoard }`, all counts from the turn's tool
results (C § 6.2). `ref` unset. **Copy:** counts and names only, no
adjectives; a board read in part says "read 300 of N"; zero is shown
as 0, never hidden (rule 8). Words go through § 5.9 stage 4.

## 3. The collapsed activity line

Built by grouping consecutive `tool-<name>` parts in a message (AI
SDK's own states: `input-streaming` → `input-available` →
`output-available` | `output-error`, C § 6.1) — not a separate
envelope kind. Collapsed: `▸ Read its instructions · Searched the web ×3`
(repeats of one step collapse to a count). Expanded: one row per part,
its literal input and output or error, word for word (rule 11 — never a
restated description of what the model believes it did). Its words
(2026-09-28): § 5.3.1 rows L1–L26 and W1–W19, C24.

## 4. Fixture conversations

Location: `apps/web/fixtures/*.json`. Each file is `{ meta, files,
messages }`:

- `meta` — `{ persona, description }`, ignored by the mock transport.
- `files` — the seed workspace, `path → content`, as of the end of the
  conversation (the panel only needs current files). Every path a
  `data-card.ref` or an item `ref` points at, and every path a
  `read_file`/`write_file` part reads, must exist here. **One exception**
  (lead ruling, 2026-09-29): a `ref` may name a missing file when the
  fixture's `jobs.md` row names that same missing file as its
  `Analysis`. The verdict card carries the row's link as written (C
  § 6.2), and opening it shows the viewer's missing line (§ 5.2 rule 6).
  *Prevents:* a fixture rule that forbids the broken link § 5.7 needs.
  *Proved by:* `tests/web/fixtures-cards.test.ts:42-47` allows exactly
  this case (a tester-owned change in Stage 4) and still fails any other
  missing `ref`.
- `messages` — a `UIMessage[]` exactly as the mock transport replays
  (one chunk per part, in order); `metadata: { origin: "typed" | "ui"
  }` is set on every user message (only `"typed"` can approve a gate).

All personas are invented — `@example.com` emails, `555-01xx` phone
numbers only. Every `tool-bash` behind a checker or pipeline script
(`check_files`, `check_materials`, `record_verdict`, `check_closeout`,
`render_resume`, `proposal_block`) carries **real stdout and exit
code**, captured by running the actual script against a `mktemp -d`
workspace seeded with that fixture's own persona — never
`~/job-search`, and never hand-typed, including the WARNs the scripts
actually print (e.g. a stray uploaded file at the workspace root).
`record_verdict` calls pass `--jd-file` so a verdict card's `ref` is
real. Every line the agent's `text` states is something a tool result
in the same fixture actually shows — no letter word count (none is
ever printed), no "checker-clean" claim while the language check
hasn't run, no capability the agent doesn't have (it cannot browse
pages), no send/submit-gate language (the web MVP has neither).

Files:

- `mvp-journey.json` — sign-up → upload résumé → profile intake →
  paste a job URL → verdict → tailored résumé + letter → "what's
  next" plan (send the letter, submit the application, keep
  searching — all candidate to-dos; no gate fires in this fixture).
- `gate-moment.json` — a `spend` gate opened directly from
  `estimate_cost` (no `request_gate` call), a non-`yes` reply that
  leaves it pending, and the `yes` that approves it.
- `over-limit-error.json` — a run that stops on a real
  `data-error over_balance`: the proxy refuses the **next** call before
  it ever reaches the model (C § 8), so the turn ends right after the
  cards for the roles already finished, with no further model text —
  never a reply composed after the refusal.
- `checker-failure.json` — a `checker` card `FAIL`, then the agent
  fixing it on its own next turn (rule 3 — no candidate action
  needed); no `document` card exists until the fix renders cleanly.
- `empty-first-run.json` — the first-run state (§ 1.5): one static
  agent line, no cards.

## 5. The workspace (amendment, 2026-09-26; owner ruling)

**The ruling.** On 2026-09-26 the owner found the live app "too basic,
like a school project", was shown three layout sketches, chose C ("I
like C better"), was told C changes the product shape and that the
chain must be amended first, and answered: "approved changing product
shape". C turns the one screen into a **workspace**: a left rail with
five places, **Home, Talk to Ten, Jobs, Applications, Documents**.

**The Part 1 reason.** Promise 2: "the sign it's working: the numbers
change every week." Until now the only way to see those numbers was to
ask Ten, which is work the candidate shouldn't have to do (promise 3).
The pages keep the search's state in view. **The caveat that travels
with it** (rule 17): the trigger was one person's reaction to the live
app, not usage data. A5 in § 5.10 names what would show the pages
aren't earning their place.

**What stays the same.** One coach, one conversation (rule 12). The
conversation doesn't split into threads or per-page chats; the
cross-host contract already says "changing workspace sections or
selected files does not create another CareerCoach conversation"
(`design-cross-host-active-context.md`, Chat boundary). The gate stays
typed-yes only (rule 7, § 2.5). Every card, copy line and screen in
§ 1–§ 4 still holds for Talk to Ten.

**What's new.** Four read-only pages of the candidate's own files.
`design-cowork-coaching.md` § 8 already held this rule for Cowork:
deliverables are read-only pages, and data changes go through chat so
the record and its view can't disagree. `PRINCIPLES.md` rule 12's
2026-09-26 note says what makes a page safe under "one of everything":
it reads the file each time it shows it and keeps no copy.

**The restore ruling (owner, 2026-09-26, in chat: "approved
recommendation for 1").** The first cut of this section dropped much of
direction C's mockup. The owner asked for the workspace to look like the
mockup they picked, and approved the lead's list of what comes back:
Ten's last reply on Home, an Active application card, time pills and a
minutes sum on plan lines, detail views on Jobs and Applications, counts
on the rail, "Verified / Unknown" tags on company facts, and a fuller
sign-in page. Every restored piece is tied to the file it reads; pages
still never write or send; the gate is still typed-yes only; nothing is
invented (rule 8). **The one agreed exception to the mockup:** Home has
no reply field. "Continue with Ten" opens Talk to Ten, where the
composer is. Where a restored piece had no file behind it, or would
say more than its file, it is cut or changed, and the place says why:

- "Verified / Unknown" tags: **not shown as tags.** Evaluate tiers every
  company claim (Verified / General knowledge / Unknown; evaluate
  `references/patterns.md:179-182`, `references/eval.md:35-37`). The Jobs
  detail shows those words wherever the brief wrote them, because each
  section is shown word for word. Evaluate's schema gives a tier no
  written form a page can read, so a tag would be the page guessing which
  words are a tier (rule 8). The owner approved adopting a written form,
  with a fourth tier, Reported, for facts read outside the company's own
  pages and the posting (2026-09-26, § 5.10, owner question 4 and its
  follow-up ruling). Tags come back once evaluate's
  schema declares it, through `docs/design-page-forms.md`; until then
  this bullet holds.
- The Found → Decided → Applying → Interview → Offer step names:
  **the steps use `jobs.md`'s own stage words.** "Applying" would call a
  submitted application unfinished, because a row moves to Applied only
  after a confirmed submit (apply's schema, `jobs.md` bullet; apply
  `SKILL.md:58`) (§ 5.3, "The stage steps").
- "Format checks passed" and word counts on documents: **not shown on
  pages.** They come from script output in the conversation, and no
  file holds them (§ 5.3, Applications).
- Two sign-in proof-point phrases: **changed** (§ 1.4).

### 5.1 The frame

- **The rail** holds the five places, in the order above, plus the
  brand mark. It shows only to a signed-in member after setup (C § 11.6).
  Sign-in, not-a-member (§ 1.6), recovery (§ 1.10) and the setup error
  screen have no rail.
- **Rail counts** (restore ruling). Three rail items carry a plain
  number; Home and Talk to Ten carry none. Each is a count that code
  reads, the same number the page itself shows:
  - **Jobs:** the rows `load()` returns that are not dismissed, which is
    the sum of Home's five stage counts. Never `jobs.md`'s own bold
    `Active:` line (a second source for one number, § 5.3 Home).
  - **Applications:** the entries `groupApplications` returns for
    `store.list("applications")`, unlinked entries included, which is
    the number of entries the Applications page lists.
  - **Documents:** the files the Documents page lists: `store.list()`
    minus `leads.md`.

  A count shows only when it is above 0. The rail reads when the frame
  first shows after setup and again when a turn ends, under § 5.2 rules
  1 and 4. A failed read shows no number on that item, never a 0 or an
  old number; the page itself shows the loud error (§ 5.2 rule 6). The
  number is plain text, never a badge, and never amber or red (rule 8;
  amber means needs-you only, § 5.6). Still no "In progress" entry and no
  summary line (§ 5.6). The phone's tab bar carries no counts (§ 5.5).
  *Prevents:* a rail number that disagrees with its page (rule 12).
  *Proved by:* on the § 5.7 fixture, each rail number equals the count
  its page shows; a table test for 0 (no number) and for a failing
  `read` (no number, and the page shows its error).
- **The header** moves from Talk to Ten to the frame, so it shows on
  every page: the avatar and its five states (§ 1.3), the balance chip
  (§ 1.1, § 1.11), the `⋯` menu (§ 1.7, § 1.10, § 1.11). Its behaviour
  doesn't change.
- **The conversation stays mounted.** `useChat` and the coach live in
  the frame, not in the Talk to Ten page. Changing pages hides the
  transcript; it never unmounts it. A turn that is running keeps running
  and is saved at its end (C § 11.4) whichever page is open.
  *Prevents:* a page change silently killing a running turn, or losing
  its save. *Proved by:* an e2e test that starts a mock turn, opens Jobs
  mid-stream, returns, and finds the finished reply; and the save count
  below.
- **One frame for both builds.** One `Frame` component wraps both
  `ChatShell` (mock) and `RealChatShell` (real). The save count and the
  restored-gate landing case are proved in a `tests/web/*.test.ts` run of
  `RealChatShell` with a spy conversation store: exactly one save per
  ended turn, whichever page is open. § 5.2 rule 4's rewrite is the test
  writing `plan.md` into the in-memory store during a mock turn; the mock
  transport is unchanged. (Lead ruling, 2026-09-26, fix round 1.)
- **The new-version check** (C § 10.2, amended 2026-09-26) runs in the
  frame, so its notice shows on every page, not only above the
  composer.
- **A gate while you're elsewhere.** When a gate is pending, the header
  avatar shows `needs-you` (as today), and the rail's Talk to Ten item
  carries a plain marker with the words "Needs your yes". Neither is
  alarm-styled (rule 8). The app doesn't switch pages on its own: a
  page changing under the candidate's hand is its own harm, and the
  header already shows on every page. The yes can only be typed in
  Talk to Ten's composer, beside the complete thing (rule 7).
  *Prevents:* a spend waiting unseen behind another page. *Proved by:*
  an e2e test that opens a gate from the mock while Jobs is showing and
  finds `needs-you` on the avatar and the rail marker; the gate approves
  only from Talk to Ten's composer with a typed exact `yes`.
- **Where the app opens** after setup: Talk to Ten when the restored
  conversation has a pending gate (rule 7 beats everything) or when no
  conversation is saved yet (first run, § 1.5: the only next step is to
  talk). Otherwise Home. *Proved by:* one case per branch: no saved
  conversation and a saved one in e2e on the mock, the restored pending
  gate in the `RealChatShell` run below.
- **Moving between pages is app state, not the address bar.** No URL
  changes and no router package. Why: the sign-in flows read the
  address bar's `#` and `?` parts (`apps/web/src/backend/auth.ts`,
  `authRedirectFromUrl`; `RealApp.tsx` clears them after an expired or
  used link, `RealApp.tsx:100`), and path-style routes would need a hosting rewrite, which is a
  production change only the owner makes (C § 15). A reload opens where
  the rule above says. The browser's Back button leaves the app, as it
  does today. Revisit on evidence (§ 5.8).

### 5.2 Rules every page follows

Each rule names what it prevents and the test that proves it.
"Pages" means Home, Jobs, Applications, Documents.

1. **Pages never write.** They call only `list()` and `read()` on the
   same `WorkspaceStore` instance the agent uses (C § 2: "The UI gets
   the same instance and never calls agent tools"). No page uploads,
   edits, moves a stage or deletes. *Prevents:* a record changed
   outside the conversation, where the duplicate-key and schema checks
   can't protect it (`jobs.md`'s own header says "change it via chat").
   *Proved by:* an e2e run through every page and every control on a
   spy store whose `write` and `upload` throw; zero calls.
   *Restore ruling:* Home also reads the conversation, for Ten's last
   reply (§ 5.3). Pages and the rail receive only `messages` and
   `status` as props, never the `useChat` object. The rail's counts
   (§ 5.1) follow this rule too. The same e2e run spies on every
   function `useChat` returns; zero calls from any page or from the
   rail.
2. **Pages never send.** No page control sends a message or starts a
   turn. A turn spends the candidate's credit (promise 5), so only
   their own send in the composer starts one. A page may only open Talk
   to Ten, and "Ask Ten about this" may also put a draft in the
   composer (§ 5.4). *Prevents:* a click that spends money or starts
   work the candidate didn't word. *Proved by:* the same e2e run on a
   spy transport; zero `sendMessages` calls.
3. **Word for word, never restated.** Every line a page shows from a
   file is that file's own text, or a count or date that code reads
   from it. No page summarizes, ranks, re-sorts, or computes a due
   date, a priority or a "next step" (rules 8 and 11). Within a file,
   file order is page order. A list of files is sorted by the one fixed
   key § 5.3 names for that page (path, newest change first, or an
   application's fixed file order), never by a judgment. *Prevents:* a page saying more than its file.
   *Proved by:* table tests that render each fixture page and compare
   its text with the reader's output, string for string.
   *Restore ruling:* besides counts and dates, exactly these computed
   things are allowed, each with its own test in § 5.3 or C § 18.1:
   splitting a plan line at its minutes into action, minutes and why
   (the two separators become the pill's layout; nothing else in the
   line is lost, C § 18.1); the To do minutes sum; the
   280-character cut of Ten's last reply, marked with "…"; and static
   label tables keyed by a file's exact words (§ 2.1's tier names, and
   § 5.3's coverage-status, decision and section labels). Choosing the plan lines
   whose path matches an application's file ("Next, from you", § 5.3)
   is selection by an exact match, not a computed next step.
4. **Fresh reads, no copy.** A page reads its files when it's shown and
   again when a turn ends while it's showing. Nothing is kept in
   `localStorage`, `sessionStorage` or IndexedDB. While a turn is
   running, the page shows one neutral line: "Ten is working. This page
   updates when it finishes." *Prevents:* a page disagreeing with the
   file (rule 12). *Proved by:* an e2e test where a mock turn rewrites
   `plan.md` while Home is showing: Home shows the new lines at turn
   end, with no reload; a grep finds no browser storage call in the
   page code.
   *Restore ruling:* this covers a detail view's files too (a Jobs row's
   analysis and company files, an application's notes file): read when
   the row or entry is chosen and again when a turn ends while it shows.
   Ten's last reply is derived from the frame's `messages` each time
   Home renders; nothing is kept.
5. **A card is a receipt; a page is now.** A card in the conversation
   shows its file as it was when the card was built (C § 6.2). A page
   shows the file as it is. They may differ, and neither is wrong.
   *Prevents:* anyone "fixing" a card to follow its file, which would
   rewrite history. *Proved by:* the same e2e test: after the rewrite,
   the old plan card is unchanged and Home shows the new lines.
6. **Missing is empty; unreadable is loud.** A file that doesn't exist
   (`resource_missing`) shows the page's empty state. Any other read
   failure shows "Couldn't read <path>. Try again in a moment." with a
   Retry button, never the empty state. A section a reader can't parse
   shows its lines as written under "This page couldn't read these lines of
   <path>:" (§ 5.3.1, C21) and a link that opens the file (`design-cowork-coaching.md`
   § 1, principle 8, "degrade loudly"). *Prevents:* "No roles yet" or
   "Nothing here right now" shown over a file that has them (rule 8).
   *Proved by:* a store whose `read` throws a non-missing error; a
   `plan.md` with a prose line before a section's first item.
   **The viewer's missing state** (lead ruling, 2026-09-29; a Stage 4
   build item). When the viewer opens a path whose `read()` answers
   `resource_missing` (a card's `ref`, a chip, a page's file), it shows
   § 5.3's line "<path> isn't in your workspace." (J13) where the file
   would be, never "Nothing open yet.": a link that points nowhere is
   said, not hidden, and a verdict card may carry one (C § 6.2). Today
   the viewer shows its empty state (`ChatShell.tsx:175`,
   `RealChatShell.tsx:331`), and `tests/web/stage3a-review.test.ts:804`
   (tester-owned) pins that; the Stage 4 tester changes it to expect the
   line. *Prevents:* a card's link that opens onto "Nothing open yet.",
   which reads as if nothing was clicked. *Proved by:* a verdict card
   whose `ref` names a missing file: opening it shows the line with that
   path, and no Retry.
   **How code tells "missing"** (lead ruling, 2026-09-29): by the store
   error's `code === "resource_missing"`, never by the error's class. Two
   `WorkspaceError` classes exist (`apps/web/src/types.ts:190` and
   `packages/agent/src/types.ts:165`), and the real store throws the
   second (`apps/web/src/backend/supabase-workspace-store.ts:20-26`), so
   an `instanceof` test against the first misreads a missing file there
   as a failure. One shared helper, `isMissingError(e)` in
   `apps/web/src/workspace/store-io.ts`, is the test every page, the
   viewer and the store adapter's `exists` use. *Prevents:* a missing
   file that is empty on one build and loud on the other. *Proved by:* a
   table test of `isMissingError` over each class's `resource_missing`
   error, each class's other codes, and a plain `Error`; a grep finds no
   `instanceof WorkspaceError` in page, viewer or adapter code.
7. **Links out are only web links.** A URL from a file (a posting's
   `URL:` field) becomes a link only when it starts with `https://` or
   `http://`. It opens in a new tab with `rel="noopener noreferrer"`.
   Anything else shows as plain text. *Prevents:* a `javascript:` or
   `data:` URL, planted by a job posting (the plan's named prompt-
   injection risk), running when clicked. *Proved by:* a table test
   over `javascript:alert(1)`, `data:text/html,…`, ` https://x` (a
   leading space), and a normal https URL.
8. **One viewer.** Every page opens files in the same viewer component
   Talk to Ten's side panel uses (`SidePanel`: `.md` through
   `MarkdownView`, `.html` in the sandboxed iframe with its CSP and the
   print button, § 2.3 and C § 6.1; a binary file shows "This file can't be
   previewed here.", § 5.3.1 C5).
   *Prevents:* a second renderer that forgets the sandbox.
   *Proved by:* `verify:screens`' injected-script check, run from a
   page as well as from the conversation.

### 5.3 The pages

Readers named here run in the browser on the same store. None needs a
store change. § 5.9 flags the stages that add or change a reader.

#### Home: the state of the search

**Shows**, top to bottom (restore ruling: the order follows the mockup;
the designer sets the columns, § 5.6):

- **The goal.** The `Goal:` line and the `Budget:` line from the head
  of `plan.md`, each as written, when present.
- **The pipeline in numbers.** One count per active stage in the
  order `jobs.md` uses (To Review, Interested, Applied, Interviewing,
  Offer), then the dismissed count. A stage with no roles shows 0.
  These are the numbers promise 2 says change week to week. The page
  shows only today's numbers: no arrows, deltas, percentages or praise
  (rule 8). Each count above 0 opens Jobs at that stage. A 0 is plain
  text, not a link: Jobs shows no group for a stage with no roles (§ 5.3
  Jobs), so there is nothing for it to open (lead ruling, 2026-09-29;
  Stage 3e builds it).
- **Ten's last reply** (restore ruling), with **Continue with Ten**,
  which opens Talk to Ten with no draft. There is no reply field on
  Home: the composer exists only in Talk to Ten (the owner's one
  agreed exception to the mockup).
  - *Where it comes from:* the frame's `messages`, the one conversation
    `useChat` holds. That array is what C § 11 saves and restores (C
    § 11.3, § 11.6), so it is "the saved conversation" without a second
    read. Home never reads `ten_conversations` itself: a second read
    would be a copy that lags by a turn (rule 12).
  - *Which reply:* the latest `assistant` message that has at least one
    text part holding more than whitespace, when no `user` message comes
    after it. An assistant message with no text part is skipped: C
    § 11.6's `gate-reconcile-…` message, which a load places last, is
    data parts only.
  - *When it is not shown:* no message qualifies; a `user` message comes
    after the latest reply (the candidate's last message has no answer,
    so an older reply would read as current); the message holds a
    `data-error` part (§ 2.7), because its text can stop mid-work and
    the error shows in Talk to Ten; the chat status is `error` (the
    turn ended in a failure Talk to Ten shows); or a turn is running
    (chat status `submitted` or `streaming`), when § 5.2 rule 4's working
    line shows in its place. Continue with Ten shows in every case.
  - *The quote:* that message's last text part holding more than
    whitespace, with leading and trailing whitespace removed. If it is
    longer than 280 code points, it is cut at the last whitespace at or
    before the 280th code point; if there is no whitespace in the first
    280, it is cut at the 280th code point. Either way "…" is added.
    Nothing else changes: it is shown as Talk to Ten shows a text part
    (plain text, `Transcript.tsx`), under the label "Ten · last reply".
  - *Accepted risk:* a cut can drop a caveat that comes later in a long
    reply (such as "the wording check hasn't run"). Accepted because
    the "…" marks the cut and Continue with Ten shows the whole reply one
    click away; the alternative, choosing which sentences to keep, would
    be the page summarizing (§ 5.2 rule 3).
  - *The activity line:* Home uses one exported function that returns
    the whole collapsed line Talk to Ten shows, in § 5.3.1's words (L1–L20), over
    `groupParts`' groups (`Transcript.tsx:35`, exported): one line per
    tool group in the message, in order. Home adds no words of its own.
    No tool parts, no line. When the § 3 amendment that
    `design-plain-replies.md` § 5 names lands (the one label table
    becomes `TOOL_LABELS` in `packages/agent/src/helpers.ts`;
    `ToolRun.tsx:20` `displayName` folds into it), both places change
    together.
  - *Prevents:* a quote Ten never said; an old reply shown as the answer
    to a newer message; a second copy of the conversation. *Proved by:*
    a table test over message arrays: a plain reply; a reply over 280
    code points (the shown text minus "…" is a prefix of the part and
    ends before whitespace); 300 code points with no whitespace (the
    first 280 and "…"); a last text part that is only whitespace (the
    one before it is quoted); the reconcile message last; a `user`
    message last; a `data-error` part; no text part; status `error`;
    each running status. An e2e case: a mock turn ends while Home shows, and the
    quote becomes the new reply with no reload.
- **Waiting on you**, then **To do**, from `plan.md § Board`: each
  line in file order, each with a chip for its first backticked path
  (it opens the viewer), each shown through **the plan item** (below):
  word for word, with a minutes pill when the line carries minutes in
  C § 18.1's form. Waiting on you comes first because coach's schema
  makes it the attention index (open questions and gated decisions).
  If a section is absent, or has no items and no unreadable lines, it
  reads "Nothing here right now." The 2–4 count is coach's rule to
  hold when it writes the file; this page never enforces or checks it
  (as § 2.2).
  - **The minutes sum** (restore ruling) sits in To do's header and
    reads "<N> of your <M> min a day". It shows only when all of these
    hold: To do has at least one item and no unreadable lines; every To
    do item carries minutes (C § 18.1); and `budgetLine` gives minutes
    per day (C § 18.1). N is the sum of the To do items' minutes; M is
    the budget's. In any other case nothing shows there: no partial
    sum, no "about", no estimate. Waiting on you's minutes are never
    summed: coach's schema sizes only To do to the budget ("each with
    its why + minutes, fitting the budget").
  - *Prevents:* a sum that quietly leaves out an item with no minutes,
    and so reads smaller than the real work; a per-session budget shown
    as "a day". *Proved by:* table tests: every item with minutes; one
    item without (no sum); a `Budget:` line per session (no sum);
    `Budget: 60 min/day floor.` (sums); N greater than M (shown as is,
    no warning style).
- **Active application** (restore ruling), when there is one.
  - *Which one:* among the Applications page's entries (below) that link
    to a `jobs.md` row that is not dismissed, the first in that page's
    order (newest change first). This is the page's fixed sort key, not
    a judgment. None: the card isn't shown. More than one: the card
    shows the first, and its header adds "The most recently changed of
    N active applications" with a link to Applications.
  - *Shows:* `Company — Title` and Location from the row, as written;
    the tier label (§ 2.1's table) and the score when the row has one;
    **the stage steps** (below) from the row; the row's Seen and Updated
    dates, date part as written, each with its own label ("Added",
    "Updated"; § 5.3.1, C3);
    the entry's files as chips that open the viewer; and
    **Next, from you**, described under Applications. An "Open" link
    opens Applications with this entry chosen.
  - *Prevents:* the mockup's summary "send the cover letter, then
    submit", which is a computed next step (rule 8). *Proved by:* on the
    fixture, the card's role is the first linked live entry, its lines
    equal the plan lines whose `ref` matches, and a fixture with two
    live entries shows "The most recently changed of 2 active applications".

**Reads:** `plan.md`, `jobs.md`, `store.list("applications")`, and the
frame's `messages` and chat status.
**Parsed by:** `readPlanBoard` (a new export of `packages/agent`, C
§ 18: the one reader behind both this page and `parsePlanTodo`; its
Waiting on you items are check_closeout's own `waitingRows`, reused);
`splitPlanMinutes` and `budgetMinutesPerDay` (**new**, C § 18.1); the
`jobs_md` port's `load()` (`skills/search/scripts/lib/jobs-md.mjs`,
held to the expected-output cases in `tests/checkers/cases/jobs_md/`),
through the read-only store
adapter described under Jobs; and `groupApplications` (Applications).
Counts are rows by stage, counted by code (rule 14). The page never
reads `jobs.md`'s own bold `Active:` line, which would be a second
source for one number. The last reply needs no parser.
**Empty** (the two files have no items and no unreadable lines between
them, which includes neither file existing): "Nothing here yet. Talk to Ten to start your plan and your
job list; they show here." (§ 5.3.1, C2 and C11) and Continue with Ten,
or "Talk to Ten" when no conversation is saved yet. Ten's last
reply still shows above it when one qualifies. **Home's view is a pure
component** that takes what the readers return as props, so sign-in's
preview (§ 1.4) renders the same view on the fixture.

#### Talk to Ten: the conversation

§ 1 unchanged: transcript, composer, side panel, every card, gate, error
and notice line (§ 1.8, § 1.9). The only change is that the header now
belongs to the frame (§ 5.1). The composer exists only here.

#### Jobs: the pipeline record

**Shows** every role in `jobs.md`, grouped by stage in the port's own
order (`STAGES`: To Review, Interested, Applied, Interviewing, Offer).
Each group heading has its count. A stage with no roles gets no heading,
so Jobs never shows an empty group; Home's pipeline numbers still show 0
for it (lead ruling, 2026-09-29). Within a group, rows are in file
order: the script already sorts them, so the page never re-sorts. Then
a **Dismissed** group, closed by default, with its count. With no
dismissed row it gets no heading either, as an empty stage doesn't
(lead ruling, 2026-09-29).

Each row shows, as written: `Company — Title`; Verdict through § 2.1's
static label table (an unknown value is shown as written; no verdict
shows "Not evaluated yet"); Score as `load()` reads it (a whole number;
the scripts only write whole numbers, `skills/evaluate/scripts/lib/record-verdict.mjs:31`);
Location; the date part of Posted; Reason word for
word, with § 2.1's quick-scan badge when it begins `quick-scan:`;
Dealbreakers, only on a row with a Verdict, reading "none" when absent
(§ 2.1); the date part of Seen and Updated; URL under § 5.2 rule 7.
No Track field: a bare letter is a schema label (§ 5.3.1, C4).
A dismissed row adds its Dismissed note word for word and the stage it
was in (`Was`).

Row controls: **Open analysis** opens the row's analysis file in the
viewer; with none, the row reads "No analysis file linked" (C § 6.2's own
wording). **Ask Ten about this** (§ 5.4). The row's analysis file is
`rowAnalysisFile(row)` (C § 6.2, lead ruling 2026-09-30, issue #32): its
`Analysis` field, else a legacy `JD:` that names a path under
`jd-analysis/`. Every place on this page, the detail and Applications'
row join reads it through that one function, never `analysis_file`
directly.

**The role's detail** (restore ruling). Choosing a row shows its detail
beside the list (the designer places it, § 5.6; on the phone the detail
replaces the list, with a back control). When Jobs opens, the first row
in page order is chosen, or the first row of the stage a Home count
opened; with no rows there is no detail. On the phone the page opens as
its list, and only a link that picks one row opens its detail (§ 5.4,
§ 5.5). The detail shows, top to
bottom, only the parts whose source exists:

1. **The header:** `Company — Title` and Location, then the date part of
   Seen, Updated and Evaluated, each as written with its own label
   ("Added", "Updated", "Evaluated"; § 5.3.1, C3).
2. **The verdict:** the tier label (§ 2.1's table), the Score as
   "<n>/100" when the row has one (no Score, no number: `--score` is
   optional, `skills/evaluate/scripts/lib/record-verdict.mjs:31`), Reason word for word with the
   quick-scan badge, and Dealbreakers ("none" when absent, § 2.1); no
   Track (§ 5.3.1, C4).
   All from the `jobs.md` row, never from the analysis file's own
   `## Verdict:` heading: the row is the script-written record and a
   re-verdict replaces it, while the file's heading can be older (one
   place per fact, rule 12).
3. **The posting link:** the row's URL under § 5.2 rule 7. The posting's
   text (`jd-inbox/`) is not shown; the ruling names the link only.
4. **From the analysis file** (the row's `Analysis` field, as an exact path):
   - **"What the posting asks for"** (§ 5.3.1, C17): the section whose heading starts
     `Competency extraction` (evaluate's schema: the top competencies,
     in priority order).
   - **"How you fit"**: the section whose heading starts
     `Fit assessment`. The rest of the heading, such as `(Track A
     lens)`, is not shown (§ 5.3.1, C4); the body is.
5. **From the company file** (the row's `Company file` field, as an
   exact path, never guessed from the company name):
   - **"About <Company>"**: the section whose heading starts `Snapshot`
     (stage, size, funding, dated signals, the sources consulted).
   - **"Culture and hiring signals"**: the section whose heading starts
     `Culture & hiring signals`. It holds the schema's "what I could NOT
     find" line, so the candidate sees what research didn't cover next
     to what it did.

   **"Verified / Unknown" are not shown as tags.** Evaluate tiers every
   company claim (Verified / General knowledge / Unknown; evaluate
   `references/patterns.md:179-182`, `references/eval.md:35-37`), and
   these sections show those words wherever the brief wrote them,
   because each section is shown word for word. Evaluate's schema gives
   a tier no written form a page can read, so a tag would be the page
   guessing which words are a tier (rule 8). The owner approved adopting
   a written form, with a fourth tier, Reported (2026-09-26, § 5.10,
   owner question 4 and its follow-up ruling). Tags come back
   once evaluate's schema declares it, through `docs/design-page-forms.md`;
   until then this paragraph holds.
6. **Controls:** Open analysis (as on the row); **Open company notes**
   when the row has a `Company file`; **Open application** when an
   Applications entry links to this row (it opens Applications with that
   entry chosen); **Ask Ten about this** (§ 5.4).

Each section body goes through `MarkdownView`, word for word (§ 5.2
rule 8). Evaluate's quick-scan tier writes neither file (evaluate
`SKILL.md:49`), so a row with no `Analysis` or no `Company file` is normal:
those parts are left out, and the row's own "No analysis file linked"
line stays. A field that names a file which doesn't exist shows one
line in that part's place, "<path> isn't in your workspace.", because a
link that points nowhere is said, not hidden. A file that exists but has
none of the named headings shows none of them; its Open control is
still there. Any other read failure shows § 5.2 rule 6's error, with
Retry, in that file's place only.
*Prevents:* a page that restates the analysis; a company link guessed
from a name; a tag that claims verification no file records. *Proved
by:* on the fixture, each shown section's text equals that section in
the file, string for string; a quick-scan row shows no analysis or
company parts; a table test for a missing file, a failing read and a
file with none of the headings.

**Reads:** `jobs.md`; for the chosen row, its `Analysis` file and `Company
file`.
**Parsed by:** `load(io, "")` from `skills/search/scripts/lib/jobs-md.mjs`,
unchanged, and, for the detail, `splitSections` (**new**, "Pieces the
pages share", below).
The store adapter is the only other new code: a read-only `io` adapter
over the store
(`apps/web/src/workspace/store-io.ts`): `exists(p)` is true when
`read(p)` succeeds and false on `resource_missing`, told by
`isMissingError` (§ 5.2 rule 6; any other error is thrown, so rule 6 can
show it); `readFile(p)` returns the text;
`writeFile` throws. *Not* reused: `apps/workspace-ui`'s `parseJobs`,
which invents a "next move", a due date and a warm/cool signal
(`apps/workspace-ui/server/workspace-core.mjs:37-68`), all against
rule 8.
**Empty** (no file, or no rows): "No roles yet. Paste a job link or a
posting's text into the conversation." The web app can't find roles
yet, so the line names only pasting (§ 1.4 cut "finds" for the same
reason; § 5.3.1, C1). In the release that loads search in the web app
(`design-web-search.md` § 9, S5), and not before, it becomes "No roles yet.
Ask Ten to look for roles, or paste a job link or a posting's text into
the conversation."

#### Applications: the materials per role

**Shows** one entry per role that has files in `applications/`. Each
entry has:

- **The role**: `Company — Title` from the linked `jobs.md` row, else
  the path of the entry's notes file, or of its first file when it has
  none (for example `applications/acme-staff-pm.md`; § 5.3.1, C20).
- **Its stage** from that row. A dismissed row reads "Dismissed: <note>",
  its Dismissed note word for word, or "Dismissed" alone when the row
  has none (§ 5.3.1, AP21 and P16). With no
  linked row: "Not linked to a role on your job list." The page never
  guesses a link from a company name.
- **Its files**, each opening the viewer, in this order: the application
  notes (both, by path, when there are two), the résumé (`-resume.md`),
  the résumé ready to print (`-resume.html`, which the viewer prints to
  PDF, § 2.3), the cover letter (`-cover-letter.md`), then any other
  file of the entry, such as `-resume.pdf`, by path. The order is fixed
  by kind, never by date or judgment (§ 5.2 rule 3; lead ruling,
  2026-09-29). A file that doesn't exist isn't listed; nothing is
  flagged as missing.

Entries are ordered newest change first, by the latest `updatedAt` among
the entry's files (`FileInfo`, C § 2). **Ask Ten about this** (§ 5.4).

**The application's detail** (restore ruling). Choosing an entry shows
its detail, placed as Jobs' is. When Applications opens, the first entry
in page order is chosen, or the entry that Home's card or a Jobs detail
opened. On the phone the page opens as its list, and only a link that
picks one entry opens its detail (§ 5.4, § 5.5). The detail shows only the parts whose source exists:

1. **The header:** the role label; from a linked row, the tier label and
   the score when it has one, and **Role details**, which opens Jobs with
   that row chosen. An unlinked entry shows "Not linked to a role on
   your job list." and then only its files (part 3).
2. **Where it stands:** **the stage steps** (below) from the linked row.
   A dismissed row shows "Dismissed: <note>", as the entry does.
3. **Its files**, as on the entry, each opening the viewer. **No "Format
   checks passed" badge and no word count:** both come from script
   output in the conversation (`check_materials` and `render_resume`
   stdout, C § 6.2), and no file holds them. The conversation's cards
   already show them, dated by their turn (§ 5.2 rule 5).
4. **Next, from you:** the plan items, Waiting on you and then To do,
   in file order, whose `ref` (C § 18: the first backticked path) is one
   of this entry's file paths or the linked row's `Analysis` path. Each is
   shown through the plan item (below). No match: the part is left
   out. These are `plan.md`'s own lines, chosen by an exact path match;
   the page never writes a next step of its own (§ 5.2 rule 3).
5. **"What the posting asks for, and your evidence":** the notes file's
   `## Coverage` rows, from `proposalRows` (C § 19). Each row shows its
   requirement and evidence word for word and its status through a
   static label table: `have` → "Covered", `shown-but-unnamed` →
   "Shown, not in their words", `gap` → "Gap"; any other value as written
   (§ 5.3.1, C17). The table is keyed by `proposalRows`' own normalised
   status (`statuses`, C § 19), the value `proposal_block`'s reply
   matches, never by the raw cell: `**gap**` and `Gap` read "Gap", and
   `Have` reads "Covered", as the reply counts them. So the page and the
   reply never disagree about a row (lead ruling, 2026-09-29). The decision column goes through a second static
   table: `open` → "Not answered yet", `answered` → "Answered",
   `skipped` → "Skipped"; any other value as written. It stays because the plan holds only one "gap interview
   open" line for the whole application while any row is `open` (apply
   `references/schema.md:111-114`), and hiding the column would hide
   which gaps were `skipped`.
6. **"What Ten cut, weakest fit first":** the Selection table's `out`
   rows, from `proposalRows` (C § 19), in file order (apply's schema:
   written weakest-first for this posting). Each shows its role, the
   whole bullet and its why, word for word. These are the same rows
   `proposal_block` printed in the reply.

The **notes file** is the entry's `<key>.md` or `<key>-application.md`
(see "Parsed by"). An entry with both shows neither's tables and says
so in one line: "This role has two notes files, <a> and <b>, so this
page shows neither's tables. Ask Ten which one to keep." Choosing one would be a guess. A table
whose header is absent, or that has no rows, is left out. Rows under
either header with the wrong cell count (`proposalRows`' `unreadable`)
show under § 5.2 rule 6's "This page couldn't read these lines of <path>:",
cells joined by ` | `, never dropped. A read failure shows § 5.2 rule
6's error in parts 5 and 6 only.
*Prevents:* checker results shown with no file behind them; a
coverage or cut list that differs from what `proposal_block` printed; a
computed next step (rule 8). *Proved by:* on the fixture, the coverage
rows and cut rows equal `proposalRows`' output field by field, and
"Next, from you" equals the plan items whose `ref` matches; a table test
for an entry with both notes files, a notes file with no `## Coverage`,
a row with the wrong cell count (shown as unreadable), an unlinked
entry, status cells `**gap**`, `` `gap` `` and `Have` (shown "Gap",
"Gap", "Covered"), and an entry whose files are given in reverse path
order (listed in the order above).

**Reads:** `store.list("applications")`, and `jobs.md` through the same
`load()`; for the chosen entry, its notes file and `plan.md`.
**Parsed by:** a new pure function, `groupApplications(paths)`
(`apps/web/src/workspace/applications.ts`). It reads **file names
only**, never file contents. The key is the name with the first
matching suffix removed, tried in this order: `-resume.html`,
`-resume.pdf`, `-resume.md`, `-cover-letter.md`, `-application.md`,
`.md`. A name that matches none of them (a `.txt`, a `.docx`) is its
own entry, keyed by its full name, and reads "Not linked to a role on
your job list." Nothing is dropped. There are
two suffixes for the application notes because the chain disagrees
today: `skills/apply/references/schema.md` names the file `<key>.md`,
while `skills/apply/SKILL.md:16` and `fixtures/mvp-journey.json` use
`<key>-application.md` (reported to the lead to fix the chain; this
page reads either). The **link** to `jobs.md` is exact: the row whose
`Analysis` field is `jd-analysis/<key>.md`. Apply names its files with
the same slug evaluate used for the analysis (apply and evaluate
schemas).
For the detail, `readPlanBoard` and `splitPlanMinutes` (C § 18, § 18.1)
and `proposalRows` (C § 19, a **changed** reader: one new export of the
parity-tested `proposal_block` port).
**Empty:** "No applications yet. Ask Ten to draft a résumé and letter
for a role, and they show here." (§ 5.3.1, C11)

#### Documents: every file

**Shows** every file `store.list()` returns (C § 2: recursive, depth ≤
3), except `leads.md`: search's schema says a lead is unvalidated and
"the candidate never sees one". The export still includes it (rule 9).
Files at the top level come first, under "Your records". Then one group
per top-level folder, labelled from a static UI table keyed by the
folder names `check_files.mjs` lists in `MANIFEST_DIRS`
(`skills/profile/scripts/lib/check-files.mjs:104`; `documents`:
"Your uploads", `applications`, `jd-analysis`, `jd-inbox`, `company`,
`contacts`, `prep`, `practice`, `stories`, `courses`, `negotiation`).
The words for each label are § 5.3.1's rows D1–D13 (written
2026-09-28, Stage 4); the coder copies them word for word.
An unknown folder shows under its own name. After the
first turn "Your records" always holds the workspace `CLAUDE.md` (the
app writes it before the first agent turn, C § 2). That is intended: the
file is the candidate's (`design-cowork-coaching.md` § 7). The empty
state below is tested on a workspace with no turn yet. Within a group, files are sorted by path, each with the
date part of its `updatedAt`. A file opens in the viewer. **Ask Ten
about this** (§ 5.4).

**Reads:** `store.list()`; `read()` for the file being viewed.
When `list()` itself fails, the page shows "Couldn't read your files.
Try again in a moment." (§ 5.3.1, D16) with Retry, never the empty
state: a failed list has no path to name. A single file's read failure
uses F40, with its path, in the viewer.
**Parsed by:** nothing. It uses the list and a static label table.
**Empty** (the list is empty): "No files yet. Drop your résumé into the
conversation to start."

#### Pieces the pages share (restore ruling)

**The plan item.** One component shows a plan item wherever a page
shows one (Home's two lists, "Next, from you" on Home's card and on an
application). It takes the item's `text` and `ref` from `readPlanBoard`
and runs `splitPlanMinutes` (C § 18.1) on the text:

- **The line carries minutes:** it shows the action, a pill "<n> min",
  and the why under it, when there is one. The action and the why are
  the line's own text and the pill holds its own minutes; the two ` — `
  separators are replaced by the layout, and nothing else in the line
  is lost (C § 18.1's round-trip test).
  Backticked paths inside the action stay as written.
- **No minutes, or not in C § 18.1's form:** the line as written, with
  no pill. A line is never given minutes it doesn't carry, and a pill
  is never estimated.
- The chip for `ref` opens the viewer, as before.

The conversation's plan card (§ 2.2) is **unchanged**: it is a receipt
built from `parsePlanTodo` and still shows each line word for word with
no split (C § 6.2). Pages and the card may look different for the same
line; § 5.2 rule 5 already allows that.

**The stage steps.** Five steps in `STAGES` order
(`skills/search/scripts/lib/jobs-md.mjs:27`), each labelled with
`jobs.md`'s own stage words: **To Review, Interested, Applied,
Interviewing, Offer**. These are the same words the Jobs groups and
Home's counts use, so one stage has one name everywhere (rule 18).

- The row's stage is the current step (`aria-current="step"`). Only
  the current step is marked; every other step is drawn the same,
  before or after it.
- **No check marks and no dates on steps.** `jobs.md` records a row's
  current stage, not the stages it passed through or when: a row can
  enter at Interviewing directly (coach `patterns.md:71`), and `Updated`
  changes on any edit, a re-verdict included (`skills/evaluate/scripts/lib/record-verdict.mjs:86`,
  `skills/search/scripts/lib/update-job.mjs:38`). So a step never claims "done on <date>". The
  row's Seen and Updated dates show beside the steps with their own
  labels (Home's card; the Jobs detail's header).
- A dismissed row gets no steps.
- **Not taken from the mockup:** the names Found, Decided, Applying and
  Interview. "Applying" would call a submitted application unfinished:
  a row moves to Applied only after a confirmed submit (apply's schema,
  the `jobs.md` bullet; apply `SKILL.md:58`). A role whose materials are
  ready but not sent still sits at To Review or Interested, and the
  steps say so. The other three renames would give one stage two names.
  The owner kept `jobs.md`'s words on 2026-09-26 (§ 5.10, owner
  question 3).
*Prevents:* a step that says more than the row records (rule 8).
*Proved by:* a table test over each stage and a dismissed row: exactly
one current step, every other step drawn alike, no check mark, no date
inside the steps.

**`splitSections(md)`** (**new**, `apps/web/src/workspace/sections.ts`).
The Jobs detail uses it to show named parts of evaluate's two prose
files. Evaluate's schema says "no script parses this file — every
consumer reads it as prose"; this function doesn't parse the prose
either. It only finds where each `## ` section starts and ends, and
each body is still shown whole, through `MarkdownView`.

```ts
export function splitSections(md: string): { heading: string; body: string }[];
export function pickSection(
  sections: { heading: string; body: string }[],
  prefix: string,
): { heading: string; body: string } | undefined;
```

- Line endings go through `universalNewlines` first and every returned
  string through `restoreLineSeparators` (`skills/profile/scripts/lib/py-text.mjs`),
  as `readPlanBoard` does (C § 18).
- A section starts at a line that begins `## ` (two `#` and a space).
  Its `heading` is the rest of that line, trimmed. Its `body` is every
  line after it, word for word, up to the next line that begins `## `
  or `# `, or the end of the file. `### ` lines stay inside the body.
  Lines before the first `## ` belong to no section.
- `pickSection` returns the first section whose heading starts with
  `prefix`, case-sensitive, or nothing.
- **Known limit:** a `## ` line inside a fenced code block still starts
  a section. Evaluate's schema puts no fenced blocks in either file.
- **Not reused, and why:** `headings()` in
  `skills/profile/scripts/lib/shapecheck.mjs:302` (re-exported by
  `check-files.mjs:60`) returns heading names only,
  never bodies; `MarkdownView` renders blocks but exposes no sections.
  Neither can be reused without changing it.
*Prevents:* a second markdown renderer; a page that rewords an
analysis. *Proved by:* a table test: a file with all of evaluate's
headings; a `### ` inside a section; `## Fit assessment (Track A
lens)` found by the prefix `Fit assessment`; a heading that's absent;
CRLF; a file with no `## ` line; a `# ` line ending a section.

#### 5.3.1 Every string the workspace shows (Stage 4)

Written 2026-09-28 by the architect as Stage 4's first step (§ 5.9),
then corrected the same day after the lead's rulings and an independent
string review ("Lead rulings", "Conflicts" and "Removed from the screen"
follow the table). A second review found two blockers, fixed here with
its follow-ups (listed after the table); the lead verifies this last
commit. The coder copies each string word for word.

- **What the table covers.** Every candidate-visible string in
  `apps/web/src` at `c8d6898`, visible text and accessible names alike;
  every string the pages still to be built will show; and the sign-in
  strings of § 1.4. **What has no row:** text shown from a file, a
  tool's own input and output, or the model's reply (the file's, tool's
  or model's own words, § 5.2 rule 3 and rule 11); dev-only controls
  (the fixture picker, Autoplay, the theme switch, and the mock app's
  own screens); PayPal's own buttons; and fixed text sent from outside
  `apps/web/src`: `packages/agent`'s error messages
  (`packages/agent/src/coach.ts:42-60`) and decline line
  ("Declined — nothing started.", `:537`), and the proxy's messages
  (C § 8). The messages this doc quotes have rows (E12–E15); the rest
  are a named follow-up for the lead, against the same rules.
- **How to read a row.** Placeholders are in angle brackets (`<N>`,
  `<path>`); everything else is literal, the final period included.
  **Source** is the section and line where this doc (or the named doc)
  gives the words. **Kind:** *Given*, the doc had the words and the row
  copies them; *Kept*, the code's words, which no doc gave, kept as
  they are; *NEW*, written here; *Changed*, the old words broke a rule
  below or two places disagreed, so the row carries new words, the
  source line changed in the same commit, and "Conflicts" says why.
- **Each string was checked** against rule 8 (true; no praise, no
  urgency), rule 18 (plain; no word a candidate would need defined),
  § 2.7's rule (what's true and what the candidate can do, never what
  the agent will do), and the plain-voice ruling
  (`design-plain-replies.md` § 1–§ 3: no file name except a path the
  candidate can open, no script name, no schema label, no "JD", no
  "gate", no § sign). A `<path>` appears only in a line about that very
  file.
- *Prevents:* a string the coder words on the spot; a string that says
  more than is true; one thing shown under two names (rule 12); an old
  string surviving next to its replacement. *Proved by:*
  1. a doc test: every row with a source line finds its string at that
     line, whitespace collapsed (a row with a placeholder finds the
     words around it), so the table and its sources can't drift apart;
  2. the bundle test: every string with no placeholder and at least 12
     characters is in the built bundle, except J19, T7 and K6 (not
     shown yet). The builder writes each composed string as one whole
     literal ("Ten is reading a file", "no failures, 1 warning", "1
     line"), never glued from parts, so this test can find it;
  3. the page test: shorter strings ("Ten", "Open", "—", "…", "none")
     and strings with a placeholder are found filled in on the rendered
     page, over the § 5.7 fixture and the conversation fixtures (§ 4);
  4. the negative tests: until `design-web-search.md` § 9 S5, J19's
     words ("Ask Ten to look for roles") are absent from the bundle and
     J18's are present, and from S5 the reverse; no rendered page, over
     every fixture, shows any string in "Removed from the screen"; and
     the built bundle holds none of that list's literal strings ("Import
     refused", "Ten isn't configured", "A tool call failed." and the
     rest), which reaches the ones no fixture renders;
  5. `tests/always-on/scan_voice.py --reply` over the String column
     finds no HARD hit. Until the plain-replies follow-up moves "To
     Review" to REVIEW in the scanner (C8), that one HARD hit is
     expected.

| # | Page | Where it shows | String (placeholders in `<>`) | Source | Kind |
|---|---|---|---|---|---|
| F1 | Rail | place 1 of 5 | `Home` | § 5 ruling :684 | Given |
| F2 | Rail | place 2 of 5 | `Talk to Ten` | § 5 ruling :684 | Given |
| F3 | Rail | place 3 of 5 | `Jobs` | § 5 ruling :684 | Given |
| F4 | Rail | place 4 of 5 | `Applications` | § 5 ruling :684 | Given |
| F5 | Rail | place 5 of 5 | `Documents` | § 5 ruling :684 | Given |
| F6 | Rail | beside Jobs, Applications, Documents, when above 0 | `<N>` | § 5.1 Rail counts :751 | Given |
| F7 | Rail | on Talk to Ten while a spend waits for a yes | `Needs your yes` | § 5.1 :798 | Given |
| F8 | Rail | the wordmark, and the mark's accessible name | `Ten` | § 5.6 The brand mark :2647 | Given |
| F9 | Rail, tab bar | accessible name of the navigation | `Workspace` | this table | Kept |
| F10 | Tab bar (phone) | tab 1 of 5 | `Home` | § 5.5 :2206 | Given |
| F11 | Tab bar (phone) | tab 2 of 5 | `Jobs` | § 5.5 :2206 | Given |
| F12 | Tab bar (phone) | tab 3 of 5 | `Ten` | § 5.5 :2206 | Given |
| F13 | Tab bar (phone) | tab 4 of 5 | `Applications` | § 5.5 :2206 | Given |
| F14 | Tab bar (phone) | tab 5 of 5 | `Documents` | § 5.5 :2206 | Given |
| F15 | Tab bar (phone) | added to the Ten tab's accessible name while a spend waits (today's code: "Ten. Needs your yes.") | `Needs your yes` | § 5.5 :2218 | Given |
| F16 | Header | left: the page title (the words of F1–F5) | `<place name>` | § 5.5 header :2225 | Given |
| F17 | Header | avatar hover text and accessible name: idle | `Ten` | this table; § 1.3 gives no words | NEW |
| F18 | Header | avatar: thinking | `Ten is writing` | this table; § 1.3 gives no words | NEW |
| F19 | Header | avatar: working; `<working words>` is one of W1–W19 | `Ten is <working words>` | this table; § 1.3 gives the tool label only | NEW |
| F20 | Header | avatar: needs-you; `<request label>` is the pending spend's own label (C § 3) | `Needs your yes: <request label>` | this table; prefix is F7's words | NEW |
| F21 | Header | avatar: done | `Ten has finished` | this table; § 1.3 gives no words | NEW |
| F22 | Header | balance chip, rounded down to the cent, `$0.00` at or below zero | `$<amount>` | § 1.1 :76 | Given |
| F23 | Header | balance chip, balance not known (shown) | `—` | this table; never an invented number (rule 8) | Kept |
| F24 | Header | balance chip, balance not known (visually hidden, read aloud) | `Balance not known` | this table | NEW |
| F25 | Header | button inside the balance chip (desktop) | `Buy credit` | § 5.6 Balance chip :2747 | Given |
| F26 | Header | accessible name of the `⋯` button | `Menu` | this table | Kept |
| F27 | Header | `⋯` menu item | `Export workspace` | § 1.1 wireframe :68 | Given |
| F28 | Header | `⋯` menu item | `Import workspace` | § 1.1 :77; named in § 1.1 (lead ruling 3) | Kept |
| F29 | Header | `⋯` menu item | `Buy credit` | § 1.11 :389 | Given |
| F30 | Header | `⋯` menu item, after a divider | `Delete my beta data` | § 5.6 The `⋯` menu :2758 | Given |
| F31 | Header | `⋯` menu item | `Set a new password` | § 1.10 :331 | Given |
| F32 | Header | `⋯` menu item; also the setup error screen and not-a-member | `Sign out` | § 1.10 :331 | Given |
| F33 | Header | `⋯` menu link, above the model line | `Privacy` | `design-web-agent.md` § 13.6 :1825 | Given |
| F34 | Header | `⋯` menu, last line, plain text (real app only) | `Model: <model name>` | `design-web-agent.md` § 13.3 :1708; e.g. `Model: DeepSeek V4.1 Flash (testing)` | Given |
| F35 | Home, Jobs, Applications, Documents | one neutral line above the page while a turn runs | `Ten is working. This page updates when it finishes.` | § 5.2 rule 4 :870 | Given |
| F36 | Every member page | new-version notice | `Ten has been updated. Reload to use the new version. Your files and this conversation are saved.` | § 1.8 :288 | Given |
| F37 | Every member page | the notice after a blocked send | `Not sent: Ten has been updated since this page opened. Copy your message if you want to keep it, then reload and send it again. Your files and this conversation are saved.` | § 1.8 :290 | Given |
| F38 | Every member page | the notice's button | `Reload` | § 1.8 :288 | Given |
| F39 | Every member page | the notice's ending when this tab's latest save failed | `Your files are saved; your latest messages weren't saved and will clear from the screen.` | § 1.8 :294 | Given |
| F40 | Home, Jobs, Applications, Documents | a file that can't be read (not a missing one) | `Couldn't read <path>. Try again in a moment.` | § 5.2 rule 6 :889 | Given |
| F41 | Home, Jobs, Applications, Documents | the button beside F40 | `Retry` | § 5.2 rule 6 :890 | Given |
| F42 | Home, Jobs, Applications, Documents | above lines a reader can't parse, with a link to the file | `This page couldn't read these lines of <path>:` | § 5.2 rule 6 :891 | Changed (C21) |
| F43 | Viewer (Talk to Ten, Jobs, Applications, Documents; Home while a file is open) | nothing open (not on Home, where the viewer shows only with a file) | `Nothing open yet.` | § 1.1 :89 | Given |
| F44 | Viewer (Talk to Ten, Jobs, Applications, Documents; Home while a file is open) | a file it can't show | `This file can't be previewed here.` | § 5.2 rule 8 :934 | Changed (C5) |
| F45 | Viewer (Talk to Ten, Jobs, Applications, Documents; Home while a file is open); the document card | print button on an `.html` file | `Print / Save as PDF` | § 2.3 :470 | Changed (C6) |
| F46 | Viewer (Talk to Ten, Jobs, Applications, Documents; Home while a file is open) | accessible name of the ✕ (Home) and the phone's back arrow | `Close` | this table | Kept |
| F47 | Viewer (Talk to Ten, Jobs, Applications, Documents; Home while a file is open) | the viewer's accessible name | `File preview` | this table | Kept |
| P1 | Jobs, Applications, Documents | a row, entry, detail or file control | `Ask Ten about this` | § 5.3 Jobs :1113 | Given |
| P2 | Jobs, Applications, Documents | the draft P1 puts in an empty composer; `<label>` is P4 or the path | `About <label>: ` | § 5.4 :2171 | Given |
| P3 | Jobs, Applications, Documents; Home when no conversation is saved | empty state's button | `Talk to Ten` | § 5.6 Empty state :2934 | Given |
| P4 | Home, Jobs, Applications | a role's label, from its row as written | `<Company> — <Title>` | § 5.3 Jobs :1099 | Given |
| P5 | Home, Jobs, Applications; the verdict card | tier label (§ 2.1's table) | `Strong Fit` | § 5.6 tier pills :2840 | Given |
| P6 | Home, Jobs, Applications; the verdict card | tier label (§ 2.1's table) | `Investable Stretch` | § 5.6 tier pills :2841 | Given |
| P7 | Home, Jobs, Applications; the verdict card | tier label (§ 2.1's table) | `Long-Shot Stretch` | § 5.6 tier pills :2842 | Given |
| P8 | Home, Jobs, Applications; the verdict card | tier label (§ 2.1's table) | `Weak Fit` | § 5.6 tier pills :2843 | Given |
| P9 | Jobs; the verdict card | badge on a Reason that begins `quick-scan:` | `Quick scan` | § 5.6 tier pills :2844; the card said `quick-scan` | Changed (C18) |
| P10 | Home, Jobs, Applications | the score, when the row has one | `<n>/100` | § 5.3 Jobs detail :1128; one form on every page (N1) | Given |
| P11 | Home, Jobs, Applications | stage: Home count cell, Jobs group, stage steps, stage pill | `To Review` | § 5.3 stage steps :1378; C8 | Given |
| P12 | Home, Jobs, Applications | stage: Home count cell, Jobs group, stage steps, stage pill | `Interested` | § 5.3 stage steps :1378 | Given |
| P13 | Home, Jobs, Applications | stage: Home count cell, Jobs group, stage steps, stage pill | `Applied` | § 5.3 stage steps :1378 | Given |
| P14 | Home, Jobs, Applications | stage: Home count cell, Jobs group, stage steps, stage pill | `Interviewing` | § 5.3 stage steps :1379 | Given |
| P15 | Home, Jobs, Applications | stage: Home count cell, Jobs group, stage steps, stage pill | `Offer` | § 5.3 stage steps :1379 | Given |
| P16 | Home, Jobs, Applications | Home count cell, Jobs group (closed), a dismissed entry | `Dismissed` | § 5.3 Jobs :1095 | Given |
| P17 | Home, Jobs, Documents | a count beside a label (0 shows as 0 on Home) | `<n>` | § 5.3 Home :954 | Given |
| P18 | Home, Applications | the minutes pill on a plan line in C § 18.1's form | `<n> min` | § 5.3 The plan item :1360 | Given |
| H1 | Home | label over Ten's last reply | `Ten · last reply` | § 5.3 Home :989 | Given |
| H2 | Home | added where the quote is cut at 280 code points | `…` | § 5.3 Home :987 | Given |
| H3 | Home | the band's button; the empty state's button once a conversation is saved | `Continue with Ten` | § 5.3 Home :961 | Given |
| H4 | Home | the band's label when no reply shows (H1 when one does) | `Talk to Ten` | § 5.6 Home layout :2981; C10 | Given |
| H5 | Home | plan section heading | `Waiting on you` | § 5.3 Home :1014 | Given |
| H6 | Home | plan section heading | `To do` | § 5.3 Home :1014 | Given |
| H7 | Home | a plan section with no items | `Nothing here right now.` | § 5.3 Home :1021 | Given |
| H8 | Home | To do's header, only when every item has minutes and the budget is per day | `<N> of your <M> min a day` | § 5.3 Home :1025 | Given |
| H9 | Home | card title | `Active application` | § 5.3 Home :1039 | Given |
| H10 | Home | card header, when more than one live entry | `The most recently changed of <N> active applications` | § 5.3 Home :1044 | Changed (C26) |
| H11 | Home | the link beside H10, to Applications | `See all in Applications` | this table; § 5.3 gives no words | NEW |
| H12 | Home, Jobs | date label for the row's `Seen` date | `Added` | § 5.3 Home :1049 | Changed (C3) |
| H13 | Home, Jobs | date label for the row's `Updated` date | `Updated` | § 5.3 Home :1050 | Given |
| H14 | Jobs | date label for the row's `Evaluated` date, detail header | `Evaluated` | § 5.3 Jobs detail :1126 | NEW |
| H15 | Home, Applications | heading over the matching plan lines | `Next, from you` | § 5.3 Home :1052 | Given |
| H16 | Home | card link to the entry in Applications | `Open` | § 5.3 Home :1052 | Given |
| H17 | Home | empty state, first sentence | `Nothing here yet.` | § 5.3 Home :1074 | Given |
| H18 | Home | empty state, rest | `Talk to Ten to start your plan and your job list; they show here.` | § 5.3 Home :1074 | Changed (C2, C11) |
| J1 | Jobs | a row with no verdict | `Not evaluated yet` | § 5.3 Jobs :1101 | Given |
| J2 | Jobs | label on a row with a verdict, and in the detail | `Dealbreakers` | § 5.3 Jobs :1105 | Given |
| J3 | Jobs; the verdict card | Dealbreakers, when the row has none | `none` | § 5.3 Jobs :1105 | Given |
| J4 | Jobs | label before the date part of Posted | `Posted` | this table; § 5.3 names the field only | NEW |
| J5 | Jobs | a dismissed row, from its `Was` field | `Dismissed from <stage>` | this table; § 5.3 gives no words | NEW |
| J6 | Jobs | row and detail control | `Open analysis` | § 5.3 Jobs :1111 | Given |
| J7 | Jobs; the verdict card | a row or card with no analysis file | `No analysis file linked` | § 5.3 Jobs :1112; C § 6.2's words; the card said it in lower case (C18) | Given |
| J8 | Jobs | detail: label before the posting's link | `Posting` | this table; § 5.3 names the link only | NEW |
| J9 | Jobs | detail section label | `What the posting asks for` | § 5.3 Jobs detail :1139 | Changed (C17) |
| J10 | Jobs | detail section label (the heading's rest isn't shown, C4) | `How you fit` | § 5.3 Jobs detail :1142 | Given |
| J11 | Jobs | detail section label | `About <Company>` | § 5.3 Jobs detail :1147 | Given |
| J12 | Jobs | detail section label | `Culture and hiring signals` | § 5.3 Jobs detail :1149 | Given |
| J13 | Jobs; Viewer (Talk to Ten, Jobs, Applications, Documents; Home while a file is open) | detail: a field names a file that isn't there; viewer: the path it opens isn't there (Stage 4 build) | `<path> isn't in your workspace.` | § 5.3 Jobs detail :1175; § 5.2 rule 6 :900 | Given |
| J14 | Jobs | detail control | `Open company notes` | § 5.3 Jobs detail :1165 | Given |
| J15 | Jobs | detail control | `Open application` | § 5.3 Jobs detail :1166 | Given |
| J16 | Jobs | phone: back from the detail to the list | `Back to Jobs` | this table | NEW |
| J17 | Jobs | empty state, first sentence | `No roles yet.` | § 5.3 Jobs :1202 | Given |
| J18 | Jobs | empty state, rest (until the web app loads search) | `Paste a job link or a posting's text into the conversation.` | § 5.3 Jobs :1202 | Changed (C1) |
| J19 | Jobs | empty state, rest (from `design-web-search.md` § 9 S5, never before; not in the bundle until then) | `Ask Ten to look for roles, or paste a job link or a posting's text into the conversation.` | § 5.3 Jobs :1207; C1 | Given |
| AP1 | Applications | entry and detail, no linked row | `Not linked to a role on your job list.` | § 5.3 Applications :1221 | Changed (C2) |
| AP2 | Applications | the role label when no row links: the notes file's path, else the first file's | `<path>` | § 5.3 Applications :1216; was the file key, e.g. `acme-staff-pm` | Changed (C20) |
| AP3 | Applications | detail control, opens Jobs at the row | `Role details` | § 5.3 Applications detail :1242 | Given |
| AP4 | Applications | detail section label | `What the posting asks for, and your evidence` | § 5.3 Applications detail :1258 | Given |
| AP5 | Applications | coverage column: the requirement | `Asked for` | this table; C17 | NEW |
| AP6 | Applications | coverage column: the evidence | `Your evidence` | this table; the mockup's words | NEW |
| AP7 | Applications | coverage column: the status (AP9–AP11) | `Status` | this table; the mockup's words | NEW |
| AP8 | Applications | coverage column: the decision (AP18–AP20) | `Question to you` | this table | NEW |
| AP9 | Applications | coverage status `have` | `Covered` | § 5.3 Applications detail :1261 | Given |
| AP10 | Applications | coverage status `shown-but-unnamed` | `Shown, not in their words` | § 5.3 Applications detail :1262 | Changed (C17) |
| AP11 | Applications | coverage status `gap` (any other value: as written) | `Gap` | § 5.3 Applications detail :1262 | Given |
| AP18 | Applications | coverage decision `open` | `Not answered yet` | § 5.3 Applications detail :1268; was the raw `open` | Changed (C17) |
| AP19 | Applications | coverage decision `answered` | `Answered` | § 5.3 Applications detail :1268 | Changed (C17) |
| AP20 | Applications | coverage decision `skipped` (any other value: as written) | `Skipped` | § 5.3 Applications detail :1269 | Changed (C17) |
| AP12 | Applications | detail section label | `What Ten cut, weakest fit first` | § 5.3 Applications detail :1273 | Given |
| AP13 | Applications | each cut bullet: which past role it came from | `From <role>` | this table | NEW |
| AP14 | Applications | detail, an entry with both notes files | `This role has two notes files, <a> and <b>, so this page shows neither's tables. Ask Ten which one to keep.` | § 5.3 Applications detail :1281 | Changed (C11) |
| AP15 | Applications | phone: back from the detail to the list | `Back to Applications` | this table | NEW |
| AP16 | Applications | empty state, first sentence | `No applications yet.` | § 5.3 Applications :1320 | Given |
| AP17 | Applications | empty state, rest | `Ask Ten to draft a résumé and letter for a role, and they show here.` | § 5.3 Applications :1320 | Changed (C11) |
| AP21 | Applications | entry and detail, a dismissed linked row, its Dismissed note word for word (no note: P16) | `Dismissed: <note>` | § 5.3 Applications :1218; lead ruling 2026-09-29 | NEW |
| D1 | Documents | group: files at the top level | `Your records` | § 5.3 Documents :1328 | Given |
| D2 | Documents | group: folder `documents` | `Your uploads` | § 5.3 Documents :1332 | Given |
| D3 | Documents | group: folder `applications` | `Applications` | this table | NEW |
| D4 | Documents | group: folder `jd-analysis` | `Role analyses` | this table | NEW |
| D5 | Documents | group: folder `jd-inbox` | `Saved postings` | this table | NEW |
| D6 | Documents | group: folder `company` | `Company notes` | this table | NEW |
| D7 | Documents | group: folder `contacts` | `Contacts` | this table | NEW |
| D8 | Documents | group: folder `prep` | `Interview prep` | this table | NEW |
| D9 | Documents | group: folder `practice` | `Interview practice` | this table | NEW |
| D10 | Documents | group: folder `stories` | `Your stories` | this table | NEW |
| D11 | Documents | group: folder `courses` | `Courses` | this table | NEW |
| D12 | Documents | group: folder `negotiation` | `Pay notes` | this table | NEW |
| D13 | Documents | group: any other folder, as written | `<folder name>` | § 5.3 Documents :1336 | Given |
| D14 | Documents | empty state, first sentence | `No files yet.` | § 5.3 Documents :1350 | Given |
| D15 | Documents | empty state, rest | `Drop your résumé into the conversation to start.` | § 5.3 Documents :1350 | Given |
| D16 | Documents | the file list itself can't be read (`list()` failed, so there is no path; one file's failure is F40) | `Couldn't read your files. Try again in a moment.` | § 5.3 Documents :1345; lead ruling 2026-09-29 | NEW |
| K1 | Talk to Ten | composer placeholder | `Message Ten…` | § 1.1 wireframe :70 | Given |
| K2 | Talk to Ten | composer: attach button's accessible name | `Attach` | this table | Kept |
| K3 | Talk to Ten | composer: send button's accessible name (an icon button, § 5.6) | `Send` | this table | Kept |
| K4 | Talk to Ten | composer: the send button while a turn runs | `Stop` | § 5.6 Composer :2769 | Given |
| K6 | Talk to Ten | offer shown for a pasted link (not built yet) | `Evaluate this?` | § 1.1 :86; follow-up 3 | Changed (C22) |
| K7 | Talk to Ten | name above your turns | `You` | § 5.6 Messages :2885 | Given |
| K8 | Talk to Ten | name above Ten's turns | `Ten` | § 5.6 Messages :2884 | Given |
| K9 | Talk to Ten | an attached file with no name | `attachment` | this table | Kept |
| K10 | Talk to Ten | first run, before anything has run (§ 1.5) | `I don't have anything of yours yet. Drop in a résumé, or tell me the job you're going for, and that starts your workspace.` | § 1.5 :207 | Changed (C11) |
| K11 | Talk to Ten | older turns not kept | `Older messages from this conversation weren't kept. Everything Ten saved is in your files.` | § 1.9 :308 | Given |
| K12 | Talk to Ten | a save failed | `The latest reply couldn't be saved. Your files are saved. The app tries again after your next message.` | § 1.9 :310 | Given |
| K13 | Talk to Ten | stale tab, before a send | `Not sent: this conversation continued in another tab or device. Reload to see it, then send again.` | § 1.9 :313 | Given |
| K14 | Talk to Ten | save conflict | `This reply wasn't saved: the conversation continued in another tab or device. Your files are saved. Reload to see the latest.` | § 1.9 :315 | Given |
| W1 | Header | avatar working words for `load_skill` | `Ten is reading its instructions` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W2 | Header | avatar working words for `read_file` | `Ten is reading a file` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W3 | Header | avatar working words for `write_file` | `Ten is saving to your files` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W4 | Header | avatar working words for `list_files` | `Ten is looking through your files` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W5 | Header | avatar working words for `web_search` | `Ten is searching the web` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W6 | Header | avatar working words for `fetch_job` | `Ten is opening the posting` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W7 | Header | avatar working words for `estimate_cost` | `Ten is estimating the cost` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W8 | Header | avatar working words for `check_language` | `Ten is running the wording check` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W9 | Header | avatar working words for `bash: check_materials` | `Ten is running the automatic checks` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W10 | Header | avatar working words for `bash: render_resume` | `Ten is laying out your résumé` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W11 | Header | avatar working words for `bash: record_verdict` | `Ten is adding the verdict to your job list` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W12 | Header | avatar working words for `bash: proposal_block` | `Ten is listing the résumé changes` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W13 | Header | avatar working words for `bash: check_files` | `Ten is checking that your files are in order` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W14 | Header | avatar working words for `bash: check_closeout` | `Ten is checking your plan` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W15 | Header | avatar working words for `bash: update_job` | `Ten is updating your job list` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W16 | Header | avatar working words for `bash: check_knowledge` | `Ten is checking your learning notes` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W17 | Header | avatar working words for `bash: check_messages` | `Ten is checking your outreach drafts` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W18 | Header | avatar working words for `bash: check_stories` | `Ten is checking your stories` | this table; C24; `TOOL_LABELS` matches in the Stage 4 build | NEW |
| W19 | Header | avatar working words for any other tool or script | `Ten is working` | this table; C24 | NEW |
| L1 | Talk to Ten; Home's activity line | a finished step, `load_skill` | `Read its instructions` | this table; C24 | NEW |
| L2 | Talk to Ten; Home's activity line | a finished step, `read_file` | `Read a file` | this table; C24 | NEW |
| L3 | Talk to Ten; Home's activity line | a finished step, `write_file` | `Saved a file` | this table; C24 | NEW |
| L4 | Talk to Ten; Home's activity line | a finished step, `list_files` | `Looked through your files` | this table; C24 | NEW |
| L5 | Talk to Ten; Home's activity line | a finished step, `web_search` | `Searched the web` | this table; C24 | NEW |
| L6 | Talk to Ten; Home's activity line | a finished step, `fetch_job` | `Opened the posting` | this table; C24 | NEW |
| L7 | Talk to Ten; Home's activity line | a finished step, `estimate_cost` | `Estimated the cost` | this table; C24 | NEW |
| L8 | Talk to Ten; Home's activity line | a finished step, `check_language` | `Ran the wording check` | this table; C24 | NEW |
| L9 | Talk to Ten; Home's activity line | a finished step, `bash: check_materials` | `Ran the automatic checks` | this table; C24 | NEW |
| L10 | Talk to Ten; Home's activity line | a finished step, `bash: render_resume` | `Laid out your résumé` | this table; C24 | NEW |
| L11 | Talk to Ten; Home's activity line | a finished step, `bash: record_verdict` | `Added the verdict to your job list` | this table; C24 | NEW |
| L12 | Talk to Ten; Home's activity line | a finished step, `bash: proposal_block` | `Listed the résumé changes` | this table; C24 | NEW |
| L13 | Talk to Ten; Home's activity line | a finished step, `bash: check_files` | `Checked that your files are in order` | this table; C24 | NEW |
| L14 | Talk to Ten; Home's activity line | a finished step, `bash: check_closeout` | `Checked your plan` | this table; C24 | NEW |
| L15 | Talk to Ten; Home's activity line | a finished step, `bash: update_job` | `Updated your job list` | this table; C24 | NEW |
| L16 | Talk to Ten; Home's activity line | a finished step, `bash: check_knowledge` | `Checked your learning notes` | this table; C24 | NEW |
| L17 | Talk to Ten; Home's activity line | a finished step, `bash: check_messages` | `Checked your outreach drafts` | this table; C24 | NEW |
| L18 | Talk to Ten; Home's activity line | a finished step, `bash: check_stories` | `Checked your stories` | this table; C24 | NEW |
| L19 | Talk to Ten; Home's activity line | a finished step, any other tool or script | `Worked on a step` | this table; C24 | NEW |
| L20 | Talk to Ten; Home's activity line | after a step that repeats, its count | `×<n>` | § 3 :614; steps joined by ` · ` | Given |
| L21 | Talk to Ten | expanded: a saved file | `Saved <path>` | this table; was `wrote <path>` | Changed (C24) |
| L22 | Talk to Ten | expanded: after L21, one line | `1 line` | this table; was `1 lines` | Changed (C24) |
| L23 | Talk to Ten | expanded: after L21 | `<N> lines` | this table | Kept |
| L24 | Talk to Ten | expanded: label over the step's literal input | `What Ten sent` | this table; was `input` | Changed (C24) |
| L25 | Talk to Ten | expanded: label over the step's literal output | `What came back` | this table; was `output` | Changed (C24) |
| L26 | Talk to Ten | expanded: label over the step's literal error | `What went wrong` | this table; was `error` | Changed (C24) |
| R1 | Talk to Ten | a card's link to its file | `Open in panel →` | § 1.2 :93 | Given |
| R2 | Talk to Ten | verdict card kicker | `Verdict · <Company> — <Title>` | this table | Kept |
| R3 | Talk to Ten | verdict card, after the score | `/100` | § 5.6 Cards :2830 | Given |
| R4 | Talk to Ten | verdict card dealbreakers line (J3 when none) | `Dealbreakers: <dealbreakers>.` | this table | Kept |
| R5 | Talk to Ten | plan card kicker | `Plan` | this table | Kept |
| R6 | Talk to Ten | plan card: an item's link to its file | `Open` | this table; was `open` | Changed (C18) |
| R7 | Talk to Ten | document card kicker, and its title when it has no file | `Document` | this table | Kept |
| T2 | Talk to Ten | document card's meta line | `<W> words · automatic checks: <badge>` | this table; was `<W> words · checker <badge>` | Changed (C7) |
| T3 | Talk to Ten | badge, and the checker card's body, with no findings | `clean` | § 2.4 :488 | Given |
| T4 | Talk to Ten | badge: a pass with one warning | `no failures, 1 warning` | `design-honest-ceilings.md` § 6A :594 | Changed (C19) |
| T8 | Talk to Ten | badge: a pass with 2 or more warnings | `no failures, <N> warnings` | `design-honest-ceilings.md` § 6A :594 | Changed (C19) |
| T5 | Talk to Ten | badge: a FAIL | `fail` | `design-honest-ceilings.md` § 6A :588 | Given |
| T6 | Talk to Ten | badge: the automatic checks haven't run on this file | `not run` | this table; was `not-run` | Changed (C7) |
| T7 | Talk to Ten | a document row, when the wording check hasn't run | `Wording check not run` | § 5.6 Document row :2811; deferred (lead ruling 4): not shown in this step, not in the bundle test | Given |
| R8 | Talk to Ten | checker card kicker; `<kind>` is R21 or R22, any other label as written | `Automatic checks · <kind>` | this table; was `Checker · <label>` | Changed (C18) |
| R21 | Talk to Ten | R8's `<kind>` for the script label `RESUME` | `Résumé` | this table; follow-up 4 | NEW |
| R22 | Talk to Ten | R8's `<kind>` for the script label `LETTER` | `Cover letter` | this table; follow-up 4 | NEW |
| R9 | Talk to Ten | checker card status: pass | `passed` | this table; was `pass` | Changed (C18) |
| R10 | Talk to Ten | checker card status: FAIL | `failed` | this table; was `FAIL` | Changed (C18) |
| R11 | Talk to Ten | checker card counts, after R9/R10 | `(<failures>, <warnings>)` | this table; was `(<n> fail, <m> warn)`; `<warnings>` is R14 or R15 | Changed (C18) |
| R12 | Talk to Ten | checker card count, one | `1 failure` | this table | Changed (C18) |
| R13 | Talk to Ten | checker card count, 0 or 2+ | `<N> failures` | this table | Changed (C18) |
| R14 | Talk to Ten | checker card count, one | `1 warning` | this table | Changed (C18, C19) |
| R15 | Talk to Ten | checker card count, 0 or 2+ | `<N> warnings` | this table | Changed (C18, C19) |
| R16 | Talk to Ten | cost card kicker | `Cost estimate` | this table | Kept |
| R17 | Talk to Ten | cost card: label of the range | `Estimated range` | this table | Kept |
| R18 | Talk to Ten | cost card: the range, never one number (§ 2.6) | `$<low>–$<high>` | this table | Kept |
| R19 | Talk to Ten | cost card: label of the balance | `Your balance` | this table | Kept |
| R20 | Talk to Ten | a card of a type the app doesn't know | `This item can't be shown here.` | this table; was `Unknown card` | Changed (C18) |
| G1 | Talk to Ten | spend card band, waiting (F7's words) | `Needs your yes` | this table; was `Needs your word` | Changed (C13) |
| G2 | Talk to Ten | spend card band, approved | `You said yes` | this table; C13 | NEW |
| G3 | Talk to Ten | spend card band, declined | `You said no` | this table; C13 | NEW |
| G4 | Talk to Ten | spend card band, closed by a newer request | `Closed without a yes. Nothing started.` | this table; C13 | NEW |
| G5 | Talk to Ten | spend card instruction, while waiting | `Type yes below to go ahead. There is no button.` | this table | Kept |
| E1 | Talk to Ten | error card title, `over_balance` | `Credit used up` | this table; C12; never the code itself | NEW |
| E2 | Talk to Ten | error card title, `model_error` | `Ten couldn't reply` | this table; C12; never the code itself | NEW |
| E3 | Talk to Ten | error card title, `tool_error` | `A step didn't finish` | this table; C12; never the code itself | NEW |
| E4 | Talk to Ten | error card title, `offline` | `No connection` | this table; C12; never the code itself | NEW |
| E5 | Talk to Ten | error card title, `step_cap` | `Stopped before finishing` | this table; C12; never the code itself | NEW |
| E6 | Talk to Ten | error card title, `cut_off` | `Reply cut off` | this table; C12; never the code itself | NEW |
| E7 | Talk to Ten | error card title, `too_large` | `Too big to send` | this table; C12; never the code itself | NEW |
| E8 | Talk to Ten | error card title, `any other code` | `Something went wrong` | this table; C12; never the code itself | NEW |
| E9 | Talk to Ten | error card next step, `offline` | `Check your connection and try again.` | this table | Kept |
| E10 | Talk to Ten | error card next step, `step_cap` and `too_large` | `Say continue to carry on from what's already saved.` | § 2.7 :583 | Given |
| E11 | Talk to Ten | error card, when the error can be retried | `Send your message again to retry.` | this table; follow-up 7; was `This can be retried.` | Changed (C25) |
| E12 | Talk to Ten | error card message, `step_cap` | `This turn ran out of steps before finishing.` | § 2.7 :581 | Given |
| E13 | Talk to Ten | error card message, `too_large` | `This turn got too big to send, so it stopped partway.` | § 2.7 :594 | Given |
| E14 | Talk to Ten | error card message, the beta's daily limit (`model_error`) | `The beta has reached today's limit. Try again tomorrow.` | § 2.7 :543 | Given |
| E15 | Talk to Ten | error card message, `over_balance` | `Your credit is used up. You can buy more from your balance at the top.` | § 1.11 :413; C16 | Given |
| U1 | Talk to Ten, under the composer | an upload that failed | `<name> isn't a file type Ten can use yet — only .pdf and .docx.` | this table | Kept |
| U2 | Talk to Ten, under the composer | an upload that failed | `<name> is over the 10 MB upload limit.` | this table | Kept |
| U3 | Talk to Ten, under the composer | an upload that failed | `<name> is over the size limit.` | this table | Kept |
| U4 | Talk to Ten, under the composer | an upload that failed | `That name is reserved and can't be uploaded to.` | this table | Kept |
| U5 | Talk to Ten, under the composer | an upload that failed | `<name> clashes with an existing file or folder (a name that only differs by capitalization counts as a clash).` | this table | Kept |
| U6 | Talk to Ten, under the composer | an upload that failed | `Your workspace is at its file limit, so this upload can't be added.` | this table; was "… Remove something before uploading more." | Changed (C25) |
| U7 | Talk to Ten, under the composer | an upload that failed | `<name> already exists.` | this table | Kept |
| U8 | Talk to Ten, under the composer | an upload that failed | `<name> isn't a valid file name.` | this table | Kept |
| U9 | Talk to Ten, under the composer | an upload that failed | `That upload would land outside your workspace.` | this table | Kept |
| U10 | Talk to Ten, under the composer | an upload that failed | `<name> could not be found.` | this table | Kept |
| U11 | Talk to Ten, under the composer | an upload that failed | `<name> changed since you last saw it.` | this table | Kept |
| U12 | Talk to Ten, under the composer | an upload that failed | `<name> couldn't be uploaded. Check the name (a matching file may already exist, even with different capitalization) and try again.` | this table | Kept |
| U13 | Talk to Ten, under the composer | an upload that failed | `Couldn't upload <name>. Try again.` | this table | Kept |
| U14 | Talk to Ten, under the composer | an upload that failed | `Couldn't upload that file. Try again.` | this table | Kept |
| I1 | Talk to Ten, after Import workspace | the workspace isn't empty | `Nothing was imported: import works only into an empty workspace.` | this table; was the raw error text | Changed (C25) |
| I2 | Talk to Ten, after Import workspace | one entry refused; `<entry>` is its path, or "that file" for the zip itself; `<reason>` is I3–I11 | `Nothing was imported: <entry> <reason>.` | this table; was `Import refused: <path> — <reason>` | Changed (C25) |
| I3 | Talk to Ten, after Import workspace | `<reason>` for `path_conflict` | `clashes with another file in the import` | this table; C25 | NEW |
| I4 | Talk to Ten, after Import workspace | `<reason>` for `workspace_full` | `would put more in your workspace than it can hold` | this table; C25 | NEW |
| I5 | Talk to Ten, after Import workspace | `<reason>` for `content_too_large` | `is over the size limit` | this table; C25 | NEW |
| I6 | Talk to Ten, after Import workspace | `<reason>` for `upload_too_large` | `is over the 10 MB upload limit` | this table; C25 | NEW |
| I7 | Talk to Ten, after Import workspace | `<reason>` for `unsupported_type` | `isn't a file type Ten can use` | this table; C25 | NEW |
| I8 | Talk to Ten, after Import workspace | `<reason>` for `not_editable` | `has a name Ten keeps for itself` | this table; C25 | NEW |
| I9 | Talk to Ten, after Import workspace | `<reason>` for `not a valid zip` | `isn't a zip file Ten can read` | this table; C25 | NEW |
| I10 | Talk to Ten, after Import workspace | `<reason>` for `CRC32 mismatch` | `is damaged` | this table; C25 | NEW |
| I11 | Talk to Ten, after Import workspace | `<reason>` for `any other reason` | `couldn't be read` | this table; C25 | NEW |
| I12 | Talk to Ten, after Import workspace | stopped after one file | `Import stopped partway, after 1 file. Your Documents page shows what arrived. A second import works only into an empty workspace.` | this table; was `Import stopped partway (<n> file(s) written): …` | Changed (C25) |
| I13 | Talk to Ten, after Import workspace | stopped after 2 or more files | `Import stopped partway, after <N> files. Your Documents page shows what arrived. A second import works only into an empty workspace.` | this table | Changed (C25) |
| I15 | Talk to Ten, after Import workspace | more than one entry refused: only the first is shown, and the line says how many | `Nothing was imported: <entry> <reason>, the first of <N> problems.` | this table; follow-up 8 | NEW |
| I14 | Talk to Ten, after Import workspace | any other failure | `Couldn't import that file. Try again in a moment.` | this table; was `Import failed.` | Changed (C25) |
| Q1 | Setup error screen | membership check failed | `Couldn't check your membership. Try again in a moment.` | this table | Kept |
| Q2 | Setup error screen | workspace setup failed | `Couldn't set up your workspace. Try again in a moment.` | this table | Kept |
| Q3 | Setup error screen | balance check failed | `Couldn't check your balance. Try again in a moment.` | this table | Kept |
| Q4 | Setup error screen | conversation load failed | `Couldn't load your conversation. Try again in a moment.` | § 1.9 :319 | Given |
| Q5 | Setup error screen | button (with F32 Sign out) | `Retry` | § 1.9 :318 | Given |
| Q6 | Site not set up | the site is missing its settings | `This copy of Ten isn't set up yet, so it can't start.` | this table; was `Ten isn't configured: <setting names> missing.` | Changed (C25) |
| Q7 | Not a member (§ 1.6) | the one line | `You're signed in, but this beta is invite-only. Ask the person who invited you to add you.` | § 1.6 :223 | Given |
| Q8 | After delete (§ 1.7) | the report-back | `Deleted. You're signed out of Ten — your sign-in for the older app is untouched.` | § 1.7 :255 | Given |
| Q9 | After delete (§ 1.7) | its button | `OK` | this table | Kept |
| X1 | Delete dialog (⋯ menu) | title | `Delete my beta data` | § 1.7 :233 | Given |
| X2 | Delete dialog (⋯ menu) | the complete thing; `<list>` is X3 | `This deletes <list>.` | this table | Kept |
| X3 | Delete dialog (⋯ menu) | the list | `your workspace files, your conversation, and your record of spending requests` | § 1.7 :241; was `… and your gate log` | Changed (C15) |
| X4 | Delete dialog (⋯ menu) | the one plain sentence | `This deletes your Ten beta data. Your sign-in stays because it's shared with the older app. Your credit stays, and so do your payment and usage records, which show only amounts and no content.` | § 1.7 :248 | Given |
| X5 | Delete dialog (⋯ menu) | instruction | `Type yes, then press Enter or Submit.` | this table | Kept |
| X6 | Delete dialog (⋯ menu) | button (sends only what was typed) | `Submit` | this table | Kept |
| X7 | Delete dialog (⋯ menu); password dialog | button | `Cancel` | § 1.10 :343 | Given |
| X8 | Delete dialog (⋯ menu) | the delete call failed | `Couldn't finish deleting your data. Nothing outside the list above was touched. Try again.` | this table; was `Something went wrong deleting your data. Nothing more was deleted than the summary above — try again.` | Changed (C25) |
| X9 | Delete dialog (⋯ menu) | anything but yes | `You said no, so nothing was deleted.` | this table; was `Declined — nothing was deleted.` | Changed (C13) |
| X10 | Delete dialog (⋯ menu); Buy credit | button | `Close` | this table | Kept |
| B1 | Buy credit dialog | title and accessible name | `Buy credit` | § 1.11 :393 | Given |
| B2 | Buy credit dialog | the terms | `Credit pays for Ten's work. You pay in PayPal's window; Ten adds what arrives after PayPal's fee, a few percent plus a fixed amount. This is a one-time payment: nothing renews, and Ten never charges you on its own.` | § 1.11 :393 | Given |
| B3 | Buy credit dialog | a credit pack | `$10` | § 1.11 :396 | Given |
| B4 | Buy credit dialog | a credit pack | `$20` | § 1.11 :396 | Given |
| B5 | Buy credit dialog | a credit pack | `$40` | § 1.11 :396 | Given |
| B6 | Buy credit dialog | accessible name of the packs | `Choose a credit pack` | this table | Kept |
| B7 | Buy credit dialog | under the packs | `Paid credit stays if you delete your beta data. The beta has a shared daily limit, so on a busy day Ten can pause until tomorrow even with credit. For a refund, email support@10xjobs.co.` | § 1.11 :397 | Given |
| B8 | Buy credit dialog | while PayPal confirms | `Confirming your payment…` | this table | Kept |
| B9 | Buy credit dialog; the toast | credited | `Added $<credited> of credit. PayPal charged $<charged>; its fee was $<fee>.` | § 1.11 :400 | Given |
| B10 | Buy credit dialog | pending | `PayPal is still clearing this payment. The credit is added when it clears.` | § 1.11 :402 | Given |
| B11 | Buy credit dialog | declined | `PayPal declined this payment. No money moved.` | § 1.11 :404 | Given |
| B12 | Buy credit dialog | window closed | `No payment was made.` | § 1.11 :405 | Given |
| B13 | Buy credit dialog | create-order failed | `Couldn't start a payment. No money moved.` | § 1.11 :406 | Given |
| B14 | Buy credit dialog | not confirmed yet | `Ten couldn't confirm the credit yet. If PayPal took your payment, it's added automatically, usually within minutes. If not by tomorrow, email support@10xjobs.co with PayPal's receipt.` | § 1.11 :407 | Given |
| B15 | Buy credit dialog | button after declined, window closed or failed | `Try again` | this table | Kept |
| S1 | Sign-in | the headline (lime underline on "actually want.") | `Help you get a job offer you actually want.` | § 1.4 :115 | Changed (C9) |
| S2 | Sign-in | the lead paragraph | `Ten runs your search with you: it scores the roles you bring it, tailors your résumé from your own facts, and keeps a short plan of the few things only you can do.` | § 1.4 :134; owner-approved 2026-09-26 | Given |
| S3 | Sign-in | proof point 1, title | `A verdict on every role, with the reasons.` | § 1.4 :147 | Given |
| S4 | Sign-in | proof point 1, body | `Paste a posting. Ten researches the company, scores the fit out of 100, and says why in plain words.` | § 1.4 :147 | Given |
| S5 | Sign-in | proof point 2, title | `Tailored from your facts, never inflated.` | § 1.4 :156 | Given |
| S6 | Sign-in | proof point 2, body | `Ten picks from what you gave it, never states a claim stronger than that, and shows you what it cut.` | § 1.4 :156 | Given |
| S7 | Sign-in | proof point 3, title | `No big run without your yes.` | § 1.4 :162; owner-approved 2026-09-26 | Given |
| S8 | Sign-in | proof point 3, body | `Bigger jobs show a cost range first, and only your typed yes starts them. In this app, you send and submit, not Ten.` | § 1.4 :166; owner-approved 2026-09-26 | Given |
| S9 | Sign-in | a line under the form (plain text; no address is named) | `Prefer local? Run it from your terminal.` | § 1.4 :116; was called a link, with no period | Changed (C23) |
| S10 | Sign-in | the preview's one text alternative | `A preview of Ten's Home page, with sample data` | § 1.4 :184 | Given |
| S11 | Sign-in | the preview's visible caption | `Sample data` | § 1.4 :185 | Given |
| S12 | Sign-in | trust line, first item (after the `lock` icon) | `Your files stay yours` | this table; lead ruling 2 | NEW |
| S13 | Sign-in | trust line, second item (after a dot) | `Export anytime` | this table; lead ruling 2; "Delete anytime" dropped | NEW |
| Y1 | Sign-in | email-link mode: the submit button | `Email me a sign-in link` | § 5.6 Sign-in :3054; C14; the code says `Send me a link` | Given |
| Y2 | Sign-in | email-link mode: switches to password mode | `Use a password instead` | § 5.6 Sign-in :3055; C14; replaces the `Email link` / `Email + password` toggle | Given |
| Y3 | Sign-in | password mode: switches back | `Use an email link instead` | this table; C14 | NEW |
| Y4 | Sign-in; Reset your password | field label | `Email` | this table | Kept |
| Y5 | Sign-in | field label, password mode | `Password` | this table | Kept |
| Y6 | Sign-in | password mode: the submit button | `Sign in` | this table | Kept |
| Y7 | Sign-in | password mode, new account: the submit button | `Create account` | this table | Kept |
| Y8 | Sign-in | password mode: switch to a new account | `New here? Create an account` | this table | Kept |
| Y9 | Sign-in | new-account mode: switch back | `Already have an account? Sign in` | this table | Kept |
| Y10 | Sign-in | after a sign-in link is sent | `Check <email> for a link to sign in.` | this table | Kept |
| Y11 | Sign-in | after a new account is made | `Check <email> for a link to confirm your account.` | this table | Kept |
| Y12 | Sign-in | error `invalid_credentials` | `That email and password don't match. Try again, or use an email link instead.` | this table; C14; never Supabase's own text | NEW |
| Y13 | Sign-in | error `email_not_confirmed` | `Confirm your email first: open the link we sent, then sign in.` | this table; C14 | NEW |
| Y14 | Sign-in | error `email_address_invalid` | `That email address can't be used here. Try a different one.` | this table; C14 | NEW |
| Y15 | Sign-in | error: signing in, anything else | `Couldn't sign you in. Try again in a moment.` | this table; C14 | NEW |
| Y16 | Sign-in | error: making an account, anything else (never `weak_password`, which gets Y44–Y46) | `Couldn't create the account. If you already have one, sign in instead.` | this table; C14; true whether or not the account exists | NEW |
| Y17 | Sign-in | error: sending a link, anything else | `Couldn't send the link. Try again in a moment.` | this table; C14 | NEW |
| Y20 | Sign-in | under the password field | `Forgot or never set a password?` | § 1.10 :363 | Given |
| Y21 | Passwords (§ 1.10) | reset: title | `Reset your password` | § 1.10 :366 | Given |
| Y22 | Passwords (§ 1.10) | reset: line | `Enter the email you sign in with to get a link for choosing a new password.` | § 1.10 :366 | Given |
| Y23 | Passwords (§ 1.10) | reset: button | `Send reset link` | § 1.10 :367 | Given |
| Y24 | Passwords (§ 1.10) | reset: link | `Back to sign in` | § 1.10 :368 | Given |
| Y25 | Passwords (§ 1.10) | reset: after a success or a 429 | `If an account exists for <email>, a link to choose a new password should arrive within a few minutes. Check spam too. Only a few emails can be sent each hour, so if nothing comes, try again later.` | § 1.10 :370 | Given |
| Y26 | Passwords (§ 1.10) | reset: any other failure | `Couldn't send the request. Try again in a moment.` | § 1.10 :374 | Given |
| Y27 | Sign-in | an email link that came back with an error | `That email link has expired or was already used. Ask for a new one below.` | § 1.10 :375 | Given |
| Y28 | Passwords (§ 1.10) | dialog title (F31's words) | `Set a new password` | § 1.10 :341 | Given |
| Y29 | Passwords (§ 1.10) | dialog line | `This password also works for the older app, which shares your sign-in.` | § 1.10 :341 | Given |
| Y30 | Passwords (§ 1.10) | field label | `New password` | § 1.10 :336 | Given |
| Y31 | Passwords (§ 1.10) | field label | `Type it again` | § 1.10 :337 | Given |
| Y32 | Passwords (§ 1.10) | show both fields | `Show` | § 1.10 :337 | Given |
| Y33 | Passwords (§ 1.10) | hide both fields | `Hide` | § 1.10 :337 | Given |
| Y34 | Passwords (§ 1.10) | check before any call | `Use at least 8 characters.` | § 1.10 :338 | Given |
| Y35 | Passwords (§ 1.10) | check before any call | `The two passwords don't match.` | § 1.10 :338 | Given |
| Y36 | Passwords (§ 1.10) | button | `Save password` | § 1.10 :342 | Given |
| Y37 | Passwords (§ 1.10) | success | `Password saved. Use it next time you sign in, here or in the older app.` | § 1.10 :343 | Given |
| Y38 | Passwords (§ 1.10) | button after success (dialog) | `Done` | § 1.10 :344 | Given |
| Y39 | Passwords (§ 1.10) | code step | `For your security, we emailed a 6-digit code to <email>. Enter it to save your new password.` | § 1.10 :345 | Given |
| Y40 | Passwords (§ 1.10) | code field label | `Code` | § 1.10 :347 | Given |
| Y41 | Passwords (§ 1.10) | code step button | `Send a new code` | § 1.10 :347 | Given |
| Y42 | Passwords (§ 1.10) | after a resend | `A new code is on its way to <email>. Use the newest one.` | § 1.10 :348 | Given |
| Y43 | Passwords (§ 1.10) | error `reauthentication_not_valid` | `That code didn't work. It may be mistyped or expired: check the newest email, or send a new code.` | § 1.10 :354 | Given |
| Y44 | Passwords (§ 1.10); sign-up (follow-up 5) | error `weak_password`, length | `That password is too short for the sign-in rules. Try a longer one.` | § 1.10 :355 | Given |
| Y45 | Passwords (§ 1.10); sign-up (follow-up 5) | error `weak_password`, characters | `That password needs more kinds of characters, such as capitals, digits or symbols.` | § 1.10 :356 | Given |
| Y46 | Passwords (§ 1.10); sign-up (follow-up 5) | error `weak_password`, pwned | `That password has appeared in a known data leak. Choose a different one.` | § 1.10 :357 | Given |
| Y47 | Passwords (§ 1.10) | error `same_password` | `That's already your password. Choose a different one.` | § 1.10 :358 | Given |
| Y48 | Passwords (§ 1.10); sign-in (rate limits) | error HTTP 429, `over_email_send_rate_limit`, `over_request_rate_limit` | `Too many tries. Wait a minute, then try again.` | § 1.10 :359 | Given |
| Y49 | Passwords (§ 1.10) | error, anything else | `Couldn't save your password. Try again in a moment.` | § 1.10 :360 | Given |
| Y50 | Passwords (§ 1.10) | recovery screen title | `Choose a new password` | § 1.10 :378 | Given |
| Y51 | Passwords (§ 1.10) | recovery screen line | `You're signed in from your reset link. This password also works for the older app, which shares your sign-in.` | § 1.10 :380 | Given |
| Y52 | Passwords (§ 1.10) | recovery screen button after success | `Continue` | § 1.10 :383 | Given |

**Conflicts, and the pick.** Each names the two sides, the pick and
why. Where the pick changed words, the source line changed in the same
commit, so the doc says one thing. **The lead accepted every pick, C1–C7,
C9 and C10, as made (2026-09-28), and ruled on C8 (below).** C11–C26
answer the independent string review of the same day, as the lead ruled
on it.

- **C1. The Jobs empty state asked for search the web app doesn't
  have.** § 5.3 said "Ask Ten to look for roles, or paste …" (the words
  `design-web-search.md` § 7.4 targets). § 1.4 cut "finds" from the
  sign-in page because the web app loads only profile, evaluate, apply
  and coach, and the code agrees (`packages/agent/src/tools/index.ts:530`).
  **Pick:** J18 until the release that loads search in the web app,
  then J19 in that same release and never before, the way § 1.8's copy
  ships with C § 11. **The trigger** is `design-web-search.md` § 9,
  stage S5 ("Search in the web app"); J19 returns with it (lead
  ruling). **Why:** rule 8; one
  product can't call "finds" false on one page and ask for it on
  another. `apps/web/src/components/Frame.tsx:149` already ships J19's
  words.
- **C2. "your pipeline" or "your job list".** § 5.3 said "your
  pipeline" (H18, AP1); `design-plain-replies.md` § 1–§ 2 calls the same
  file "your job list" in every reply. **Pick:** "your job list".
  **Why:** the candidate reads the page and Ten's reply side by side:
  one thing, one name (rules 12 and 18). "Pipeline" stays in this doc's
  own prose, which no candidate sees.
- **C3. "Seen" is a schema label.** § 5.3 labelled the row's `Seen`
  date "Seen" (Home's card, the Jobs detail). It is `jobs.md`'s field
  name, and it doesn't say seen by whom. **Pick:** "Added". The field is
  the date the role went on the job list: `skills/evaluate/scripts/lib/record-verdict.mjs:73` and
  `search_ats.py:853` and `:1291` set it only when they add the row.
  **Caveat (rule 8):** on a row carried over by `migrate_jobs_db.py:37`
  (deleted in `ed7c4e8`; the rows it carried over remain),
  `Seen` is the old database's last-updated date, so "Added" can be
  later than the day the role really arrived. Accepted: it is never
  earlier, and those rows are one-time. "Updated" and "Evaluated" are
  plain words and stay.
- **C4. Track as a bare letter.** § 5.3 and § 5.6 showed Track on each
  Jobs row and in the detail. `design-plain-replies.md` § 5 removed the
  same field from the verdict card (" (Track A)"): the letter means
  something only to someone who has read `criteria.md` in its lettered
  form, and a name needs a structured source first. **Pick:** no Track
  field on any page. **Why:** the plain-voice ruling (no schema
  labels), and the card and the page must agree (rule 12). The "How you
  fit" heading's rest, such as "(Track A lens)", is not shown either:
  the label and the body carry the section, and the rest would put the
  same bare letter back (rule 18).
- **C5. "Binary file — no preview."** (§ 5.2 rule 8,
  `SidePanel.tsx:72`). "Binary" is a word a candidate would need
  defined (rule 18), and a PDF résumé is the file most likely to show
  it. **Pick:** "This file can't be previewed here." It says what's
  true and claims nothing else.
- **C6. "Download PDF" or "Print / Save as PDF".** § 1.1's wireframe
  and § 2.3 said `[Download PDF]`; the code and both e2e suites say
  "Print / Save as PDF" (`Cards.tsx:157`, `tests/web/e2e.mjs:128`).
  **Pick:** "Print / Save as PDF". **Why:** the button opens the
  browser's print dialog, where saving is the candidate's choice;
  "Download" names a download that never happens (rule 8).
- **C7. The document badge.** `design-honest-ceilings.md` § 6A adds "no
  failures, N warning(s)" and says `clean`, `fail` and `not-run` "read
  as today", which is `<W> words · checker <badge>` (`Cards.tsx:147`).
  "checker" and "not-run" are a component name and a schema value, and
  § 5.6 says check names follow `design-plain-replies.md` ("the
  automatic checks"). **Pick:** T2's line, with "automatic checks" for
  "checker" and "not run" for `not-run`; T4 and T8 as § 6A now gives
  them (C19); "clean" and "fail" unchanged. **Why:** the plain-voice ruling; § 6A's
  point, never "clean" beside a warning, is kept whole.
  `design-honest-ceilings.md` § 6A now says its badge words come from
  this table (same commit, lead ruling), so the two docs agree.
- **C8. "To Review" is a page word and a reply leak.** The owner kept
  `jobs.md`'s stage words for the pages (§ 5.10, owner question 3);
  `design-plain-replies.md` § 3 lists "To Review" as a HARD leak in
  Ten's replies. **Lead ruling (2026-09-28):** the owner approved
  `jobs.md`'s stage words for the pages (§ 5.10, owner question 3). A stage name the
  candidate sees on their own Jobs page is their vocabulary, not
  jargon. So the pages keep "To Review", replies may say it too, and
  `scan_voice.py` moves "To Review" from HARD to REVIEW. The chain is
  fixed in this commit: `design-plain-replies.md` § 1's "Words that
  stay" adds the job list's stage words, and its § 3 moves "To Review"
  to REVIEW. The scanner and its tests change in the plain-replies
  follow-up build, not here. The owner may reverse this ruling.
- **C9. The headline's period.** § 1.4 quotes rule 1's line with no
  period; § 5.6 underlines "actually want." with one, as the code does
  (`SignIn.tsx:144`). **Pick:** with the period, and § 1.4 now quotes
  it so. No meaning changes.
- **C10. The band's label.** § 5.6's Home layout labels the band "Talk
  to Ten"; the restore ruling puts Ten's last reply there, under "Ten ·
  last reply". **Pick:** H1 when a reply shows, H4 when none does. Each
  is true in its case.

- **C11. Lines that said what Ten will do.** § 2.7's rule is what's
  true and what the candidate can do, never what the agent will do.
  Four lines broke it: Applications' empty state ("Ten drafts the
  materials"), Home's ("Ten writes your plan …"), § 1.5's first-run
  line ("and I'll start your workspace") and the two-notes line, which
  said what's wrong but not what to do. **Pick:** AP17 "Ask Ten to draft
  a résumé and letter for a role, and they show here."; H18 "Talk to
  Ten to start your plan and your job list; they show here."; K10 "…,
  and that starts your workspace."; AP14 adds "Ask Ten which one to
  keep." (lead ruling on the review). Each source line is edited.
- **C12. The error card showed the raw code.** `ErrorPart.tsx:58`
  renders "Error — <code>", so a candidate reads "Error — model_error"
  (plain-voice ruling; rule 18). **Pick:** a plain title per code,
  E1–E8, never the code. The message under it stays the sender's (§ 2.7).
- **C13. One pending spend, two names.** The rail says "Needs your yes"
  (F7) while the card's band said "Needs your word" (`GateCard.tsx:20`),
  and the card showed the raw "Status: pending" (`:26`) (rule 12;
  plain voice). **Pick:** the band carries the state in plain words
  (G1–G4); the status line is dropped. The delete dialog's "Declined —"
  line reads as G3 does (X9).
- **C14. The sign-in form.** § 5.6 (the owner-reviewed direction) gives
  "Email me a sign-in link" as the main button and "Use a password
  instead" as a text link; the code has a two-button toggle ("Email
  link" / "Email + password") and "Send me a link" (`SignIn.tsx:151-156`,
  `:204`). **Pick:** § 5.6, which breaks no rule; the rest of the
  password mode keeps the code's words (Y4–Y11), with Y3 to switch back.
  The form showed Supabase's own error text (`auth.ts:102-126` passes
  `error.message` through), which § 1.10 already rules out; Y12–Y17
  give plain lines per Supabase error code (codes checked against
  Supabase's error-code list, 2026-09-28).
- **C15. "your gate log"** in § 1.7's list of what a delete removes:
  "gate" is on the plain-voice ruling's list. **Pick:** "your record of
  spending requests" (X3), which also covers declined and closed
  requests (follow-up 7); § 1.7 is edited.
- **C16. Two `over_balance` messages.** § 2.7 quoted "Your beta credit
  is used up. Ask the person who invited you for more."; § 1.11's later
  amendment replaces it with "Your credit is used up. You can buy more
  from your balance at the top." **Pick:** § 1.11's (E15), the newer
  ruling; § 2.7 now says so.
- **C17. Three ways to say one thing, and raw decision values.** "What
  they're asking for" (Jobs), "What the posting asks for" (Applications)
  and "They ask for" (the mockup's column); the coverage decision showed
  `open`, `answered`, `skipped` raw beside a status column that has a
  label table; "Shown, not named" needs defining (rules 12 and 18).
  **Pick:** "What the posting asks for" (J9), "Asked for" (AP5); a second
  static table for the decision (AP18–AP20), which § 5.2 rule 3's list now
  names; "Shown, not in their words" (AP10).
- **C18. Card words that differ from the pages'.** The verdict card says
  "quick-scan" and "no analysis file linked"; the checker card's kicker
  says "Checker", its status shows the raw `pass`/`FAIL` and "(1 fail,
  0 warn)"; the plan card's link says "open"; an unknown card says
  "Unknown card". **Pick:** the pages' words (P9, J7) and plain forms
  (R6, R8–R15, R20).
- **C19. "warning(s)".** `design-honest-ceilings.md` § 6A's badge and
  script line said "N warning(s)", which reads as code (rule 18).
  **Pick:** "1 warning" and "<N> warnings" (T4, T8, R14, R15); § 6A's
  badge, render test and script line change to the same forms in this
  commit (the script line: "no failures, 1 warning above …" / "no
  failures, N warnings above …").
- **C20. A slug as a role's name.** An unlinked entry was labelled by
  its file key (`acme-staff-pm`), a piece of a file name the candidate
  can't open. **Pick:** the path of its notes file, or of its first file
  when it has none (AP2), which they can open.
- **C21. "Ten couldn't read these lines."** The page's reader failed,
  not Ten, and Ten can read the file as prose (rule 8). **Pick:** "This
  page couldn't read these lines of <path>:" (F42); § 5.2 rule 6 and
  § 5.3 are edited.
- **C22. The composer's "/skills", "/" picker and "link" pill.** The
  code shows a disabled "/skills" button, and no picker is built; § 5.6's
  "link" pill has no defined action anywhere: controls that do nothing
  (rule 8). **Pick (lead ruling, follow-up 3):** no "/skills", no "/"
  picker and no pill; § 1.1, § 5.6 and the § 1.1 wireframe are edited.
  K6 is capitalised, "Evaluate this?".
- **C23. S9 is a line, not a link.** § 1.4 called it a link, but no
  address is named anywhere and the code renders plain text with a
  period (`SignIn.tsx:218`). **Pick:** a line, with the period; § 1.4
  and § 5.6 are edited.
- **C24. The activity line and the working words used tool names.**
  The collapsed line reads "ran bash" or "ran write file ×2"
  (`ToolRun.tsx:102`), the expanded rows say "wrote", "input", "output",
  "error" and "1 lines", and the avatar said "Ten is running a checker"
  while a résumé rendered (`helpers.ts:37-49`). **Pick:** one plain
  present form (W1–W19) and past form (L1–L19) per tool and per script,
  a plain fallback for anything else, and plain labels over the literal
  input and output (L21–L26), which stay word for word (rule 11). This
  is the words of the § 3 amendment `design-plain-replies.md` § 5
  names; § 3 now points here.
- **C25. Raw error text on screen.** Import errors showed the store's
  codes and byte counts ("Import refused: … workspace_full: …",
  `RealChatShell.tsx:454-458`); the site-not-set-up screen listed
  setting names (`main.tsx:40`); one upload line told the candidate to
  "Remove something", which no page or tool lets them do; the delete
  error was hard to parse. **Pick:** I1–I14, Q6, U6, X8.
- **C26. "The most recently changed of N"** had no noun (rule 18).
  **Pick:** "… of <N> active applications" (H10); § 5.3, § 5.7 and
  § 5.9 are edited.

**Decisions where the doc had a slot but no words** (the NEW rows):

- **N1. One score form,** "<n>/100", wherever a score shows (the Jobs
  detail's form and the verdict card's). § 5.3 left the row's and Home
  card's form open, and a bare "82" doesn't say out of what.
- **N2. An application's files show by their own name** (§ 5.6's
  document row). § 5.3 lists them by kind ("the application notes, the
  résumé …"), but a label per file suffix would be a new computed table
  outside § 5.2 rule 3's list; the name is a path the candidate can
  open.
- **N3. The avatar's words** (F17–F21, W1–W19) put § 1.3's labels in a
  short sentence. Today's code shows the state's code name ("needs-you
  — …", `Avatar.tsx:13`), which the plain-voice ruling rules out.
- **N4. The Documents labels** (D3–D12) say what each folder holds,
  from its owning skill's schema: evaluate's analyses and company
  briefs, search's saved postings, interview's prep, practice and pay
  record (`negotiation/`, "stated comp record"), storybank's stories,
  learn's courses, outreach's contacts. "Company notes" matches Jobs'
  "Open company notes"; "Role analyses" matches "Open analysis".
- **N5. Counts read as English:** "1 line", "1 file", "1 failure", "1
  warning"; "<N> lines", "<N> files" and so on for 0 or 2 and more.
  Never "(s)" (C19).

**Lead rulings on the open questions (2026-09-28):**

1. **"To Review" in replies:** allowed (C8). The owner may reverse it.
2. **The sign-in trust line** is "Your files stay yours · Export
   anytime" (S12, S13). The mockup's "Delete anytime" is dropped: it
   would need § 1.7's caveat (the sign-in and paid credit stay) to be
   true.
3. **"Import workspace"** stays, with today's label (F28), and § 1.1's
   menu list now names it.
4. **"Wording check not run"** (T7) is deferred: not shown in this
   step. It waits for § 2.4's rule on when it shows.
5. **The avatar's working words** use the plain forms now: "Ten is
   running the automatic checks" (W9) and "Ten is running the wording
   check" (W8), and every other tool and script has its row (W1–W19,
   C24). `TOOL_LABELS` (today "running a checker", "checking language",
   "loading a skill" …) changes to match in the Stage 4 build; for
   `bash` it is keyed by the script's name, as
   `design-plain-replies.md` § 5 says.

**Removed from the screen** (proof 4 checks none of these shows):
"Error — <code>"; "Needs your word"; "Status: <status>";
"warning(s)"; "Binary file — no preview."; "Download PDF"; "/skills";
"Checker · "; "Unknown card"; "Import refused"; "Ten isn't configured";
"your gate log"; "Declined — nothing was deleted."; "Send me a link";
the "Email link" / "Email + password" toggle; "Ask Ten to look for
roles" until S5; the "ran" prefix and raw tool names on the activity
line; "loading a skill"; "Remove something before uploading more.";
"A tool call failed."; "This can be retried."; the "link" pill; a
file key as a role's name; the Track field on a Jobs row or detail
(the words inside a file's own section body are the file's).

**What the Stage 4 build changes in code** (each with the tests that pin
today's words, which change with it): `Frame.tsx` (H18, AP17, J18/J19,
Home's empty button); `SidePanel.tsx` (F44); `Header.tsx` and
`Avatar.tsx` (F17–F24); `helpers.ts` `TOOL_LABELS` and `ToolRun.tsx`
(W, L; `tests/web/e2e.mjs:86-91`); `Composer.tsx` (K3; drop "/skills");
`Transcript.tsx` (unchanged words); `GateCard.tsx` (G1–G5);
`ErrorPart.tsx` (E1–E11; drop `tool_error`'s "A tool call failed.",
`ErrorPart.tsx:28`); `Cards.tsx` (P9, J7, R6–R22, T2–T8);
`RealChatShell.tsx` (I1–I15, K10; `tests/e2e-real/e2e.ts:545`);
`upload-errors.ts` (U6); `main.tsx` (Q6); `DeleteBetaDataConfirm.tsx`
(X3, X8, X9; `tests/e2e-real/e2e.ts:957`, `:1006`); `SignIn.tsx` and
`auth.ts` (S1, S9, S12–S13, Y1–Y17); `SidePanel.tsx`, `ChatShell.tsx`
and `RealChatShell.tsx` (J13 in the viewer, § 5.2 rule 6;
`tests/web/stage3a-review.test.ts:804`, and § 4's fixture exception in
`tests/web/fixtures-cards.test.ts:42-47`).

**Follow-ups (after Stage 4 review, 2026-09-28).** The second review's
list, with the lead's rulings; "done" means done in this doc, and the
rest is the Stage 4 builder's.

1. § 2.7's `over_balance` sentence contradicted C16: rewritten (done).
2. The old "ran" prefix and script names in § 1.1's wireframe, § 3's example and § 5.3/§ 5.9's "prefix included": replaced with L-row words (done).
3. The "Job link" pill had no defined action: dropped with K5; K6 capitalised; the "/" picker removed from § 1.1 and § 5.6 (done; the builder drops the "/skills" button).
4. R8's `<label>` rendered the script's "RESUME" / "LETTER": static table R21–R22 (done; the builder adds the table).
5. On sign-up, `weak_password` maps to Y44–Y46, not Y16 (builder).
6. The builder writes composed strings as whole literals; proof 4 adds a bundle-absence check for the literal Removed strings (done in the proofs; builder).
7. Wording nits, all accepted: E11, I12–I13, X3 "record of spending requests", W13/L13 (done).
8. More than one refused import entry: only the first is shown, and I15 says how many (builder).

### 5.4 How the conversation and the pages link

- **Into the viewer.** A chip or card `ref` in the conversation opens
  the side panel, as today (§ 1.1). A file on any page opens the same
  viewer (§ 5.2 rule 8).
- **Continue with Ten** (Home, beside Ten's last reply) opens Talk to
  Ten, composer focused, no draft. Home has no reply field (restore
  ruling). At a frame width of 760px or less it opens Talk to Ten
  **without** focusing the composer; the candidate's own tap on the
  composer focuses it. Only this button focuses the composer: rail and
  tab-bar navigation, and the first load, never do.
  *Prevents:* on the phone, a focused composer hides the tab bar (§ 5.5,
  "Keyboard up"), and iOS Safari doesn't raise the keyboard for a
  focus the script sets after a page change. The candidate would see
  no keyboard and no tab bar, with no visible way off the page.
  *Proved by:* at 1440px the button leaves the composer focused; at
  375px it leaves the composer unfocused with the tab bar showing.
- **Ask Ten about this** (a Jobs row or its detail, an Applications
  entry or its detail, a Documents file) opens Talk to Ten and puts a draft in the composer: `About
  <label>: `, where `<label>` is `Company — Title` for a role, or the
  path for a file. The draft is one line, capped at 120 characters (a
  longer label is cut to fit). The draft goes in **only when the composer is
  empty**; unsent text is never overwritten (§ 1.8 counts unsent text
  as something a candidate can lose). The draft is never sent for them
  (§ 5.2 rule 2). Once they edit and send it, it's their own typed
  message.
  *Prevents:* a draft that could pass the gate. The gate approves only
  a whole message that is exactly `yes` (C § 3), and every draft starts
  with `About `. *Proved by:* `matchGateReply(draft, "typed") ===
  "none"` for every draft form, including a role whose company is
  literally "yes".
- **Pages to pages.** A Home count above 0 opens Jobs at that stage.
  Wider than 760px, its first row is chosen. At 760px or less (§ 5.5)
  Jobs opens as its list, scrolled to that stage's heading, with no
  detail: a count is about the stage, not one role (lead ruling,
  2026-09-29). A count of 0 is not a link (§ 5.3 Home). Restore ruling:
  Home's Active application "Open" opens Applications with that entry
  chosen; a Jobs detail's "Open application" opens Applications with
  the linked entry chosen; an application's "Role details" opens Jobs
  with the linked row chosen. Each of these three picks one entry, so
  on the phone it opens that entry's detail (lead ruling, 2026-09-29).
  Every one of these follows an exact link (the `Analysis` join, § 5.3),
  changes only which page and item show (app state, § 5.1), and never
  sends or writes (§ 5.2 rules 1 and 2). Nothing else links page to
  page in this step. *Proved by:* one e2e case per link on the fixture,
  on the spy store and spy transport.

### 5.5 Phone (filled 2026-09-26 from direction C)

The pattern, at a frame width of 760px or less (the container query in
§ 5.6, "Breakpoint"). The tester checks it at exactly 375px.

- **The rail becomes a five-tab bar** at the bottom of the frame. Order,
  left to right: **Home · Jobs · Ten · Applications · Documents**. Ten
  (Talk to Ten) sits in the centre, because the composer is the one
  place to type. This reorders § 5.1's rail order for the phone only;
  the rail keeps § 5.1's order. Each place is **one tap** from any page.
  - Tab: a column 48px high with the icon (20px, margin 5px 0) over the
    label (`--type-tab`, 11px/1, weight 500). Rest: `--fg-subtle`.
    Current: `--fg`, with `aria-current="page"`.
  - The Ten tab replaces its icon with a tile 44×30px, radius 10px:
    `--hero` fill with a `--lime` icon at rest; `--lime` fill with an
    `--on-lime` icon when current. Its label reads "Ten".
  - The needs-your-yes marker on the phone is an 8px `--amber` dot at
    the Ten tile's top-right corner (`top: 4px; right: calc(50% - 26px)`),
    with a 2px `--bg` ring and visually hidden text "Needs your yes".
    No count and no alert styling (§ 5.6, chain rules).
  - The bar is `display: grid; grid-template-columns: repeat(5, 1fr)`,
    padding `6px 4px calc(8px + env(safe-area-inset-bottom))`, `--bg`
    fill, and a 1px `--border` top rule. It is a row of the frame's
    grid, **never `position: fixed`**, so it can't cover anything.
- **The header shows on every page**, 54px high:
  - the page title (`--type-header` at 16px) on the left;
  - on the right, Ten's avatar (§ 1.3) and the balance chip. The chip
    shows the amount only, and a tap opens Buy credit (§ 1.11). The
    `⋯` menu button sits last. Each has a 44×44px hit area.
  - No wordmark on the phone.
- **The viewer is a full-screen sheet** (§ 1.2). It covers the page and
  header area below the status bar, `z-index: 30`, with a back arrow
  (44×44px, `arrow-left`) at the top left. It enters with a 320ms
  `translateY(24px)` plus fade under `prefers-reduced-motion:
  no-preference`; otherwise it appears at once. Back, or the Escape
  key, closes it and returns focus to the row or chip that opened it.
- **Keyboard up.**
  - `index.html`'s viewport meta becomes `width=device-width,
    initial-scale=1, viewport-fit=cover,
    interactive-widget=resizes-content`.
  - The frame sizes to `height: 100vh; height: 100dvh;` (fallback line
    first, as `.app-shell` does today).
  - The composer stays in normal flow at the foot of Talk to Ten's page,
    never fixed.
  - While the composer has focus at 760px or less, the tab bar is
    hidden: `.frame:has(.composer:focus-within) .tabbar { display: none; }`.
    Nothing then sits between the composer and the keyboard. The bar
    returns on blur.
  - iOS Safari ignores `interactive-widget`. There the browser scrolls
    the focused composer into view, and with the bar hidden nothing
    covers it.
- **No horizontal scroll.** Home's pipeline counts become a 3 × 2 grid
  on the phone (see Home in § 5.6). Every list is one column. A long
  path or URL wraps with `overflow-wrap: anywhere`.
- **Tap targets ≥ 44px.** At 760px or less:
  - every button, icon button, menu item, rail tab and row control gets
    `min-height: 44px`;
  - icon buttons are 44×44px.
- **The rest of the phone layout.**
  - Home's two plan cards stack.
  - Jobs, Applications and Documents open as the list alone. On Jobs
    and Applications, choosing an entry replaces the list with its
    detail, with a back control at its top, "Back to Jobs" (J16) or
    "Back to Applications" (AP15), that shows the list again (the
    restore ruling; lead ruling, 2026-09-29). A link from another page
    that picks one entry (Home's "Open", "Role details", "Open
    application", § 5.4) opens that entry's detail: the link chose it.
    A Home count opens the Jobs list scrolled to that stage's heading,
    with no detail: a count is about the stage, not one role (lead
    ruling, 2026-09-29). A file opens the sheet above. *Proved by:* at
    375px, each page opens showing its list and no detail; choosing an
    entry shows its detail and no list; the back control shows the list
    again; each of the three entry links opens its entry's detail; a
    Home count opens the Jobs list with that stage's heading in view and
    no detail.
  - The account menu (`⋯`) opens under the header, spanning the width
    with 8px side margins.

### 5.6 Visual spec: direction C (filled 2026-09-26)

**Source.** Direction C, round 2:
`design/directions/2026-09-26-r2/direction-c-home.html`, on branch
`worktree-agent-a7b2db3c5da9cc5ae` at commit `99c4ef9`. The owner
picked it on 2026-09-26. **Where the mockup and § 1–§ 5 disagree, this
subsection follows § 1–§ 5.** "Where this differs from the mockup" at
the end lists each case.

**Stages.** Stage 1 (§ 5.9) takes the tokens, fonts, icons, brand mark
and component states below and applies them to today's screens. Items
marked **(Stage 2)** are layout: the rail, the frame header, the tab
bar, the page layouts and the conversation's message layout. They land
with the frame, not in Stage 1.

#### Chain rules this spec keeps

These must agree with the chain, or the spec goes back to the owner:

- **Light only.** The 2026-09-24 ruling at the top of this doc stands.
  The owner confirmed on 2026-09-26 that light is the production default
  and dark is optional later (§ 5.10, Q1). The dark values below stay
  dormant under `[data-theme="dark"]`, as today.
- **One accent: lime `#C8F03C`.** Every other hue is a status color.
  - Lime is a fill only, never text on a light ground (it is 1.4:1
    against white). Its whole use list is:
    1. the brand mark's "0";
    2. the Continue with Ten button;
    3. the phone's Ten tab;
    4. the selected amount in Buy credit (`--lime-soft`);
    5. the toast's check icon;
    6. the sign-in headline's underline. This is the owner's "one bold
       touch" (2026-09-26).
  - Amber is only for needs-you (§ 1.3). No alert-styled count badges
    (`design-references.md`, Huntr and Teal; rule 8).
- **No rail summary line.** The rail shows the five places and nothing
  else: no counts, no "In progress", no to-do line. Home carries the
  numbers. Deletion is the default (rule 18). If a summary is ever
  added, it says "3 to-dos", never "this week".
  **To restore (restore ruling, § 5):** the counts come back on Jobs,
  Applications and Documents, defined in § 5.1 ("Rail counts"). "No
  'In progress'" and "no to-do line" still hold. The designer specs the
  count's style: plain text, never a badge, never amber or red.
- **Tokens are CSS custom properties** in `apps/web/src/styles.css`'s
  token block. No UI framework, no CSS build step. Stage 1's exit grep
  finds no hex, `rgb(` or `rgba(` outside that block. The favicon file
  is an asset, not a stylesheet.

#### Fonts

All four are self-hosted through `@fontsource` and imported in
`apps/web/src/main.tsx`, as today. They are never loaded from Google or
any font CDN at runtime.

| Token | Family (weights) | Package | Fallback stack (in the token) |
|---|---|---|---|
| `--font-display` | Bricolage Grotesque Variable (500–700) | `@fontsource-variable/bricolage-grotesque` **5.3.0**, new, OFL-1.1 | `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif` |
| `--font-sans` | Inter Variable (400–700) | `@fontsource-variable/inter`, kept | `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif` |
| `--font-serif` | Source Serif 4 Variable (400–600) | `@fontsource-variable/source-serif-4`, kept | `Georgia, "Times New Roman", serif` |
| `--font-mono` | JetBrains Mono (400, 500) | `@fontsource/jetbrains-mono`, kept (400.css, 500.css) | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

- **Removed:** `@fontsource-variable/fraunces`, from `package.json` and
  from `main.tsx`. Bricolage takes every job Fraunces did.
- **Bricolage** is for:
  - the wordmark;
  - Home's goal line and pipeline counts;
  - a verdict's score;
  - dialog titles;
  - the gate card's action title;
  - empty-state first sentences;
  - the sign-in headline.

  Nowhere else.
- **Inter** is for all other UI and prose.
- **Source Serif 4** is only for résumé and cover-letter `.md` in the
  viewer (`.side-panel-body--document`, as today).
- **JetBrains Mono** is only for:
  - file paths in the viewer's meta row;
  - the literal tool input and output in an expanded activity row;
  - the `yes` key cap in the gate card.

#### The token block

Stage 1 pastes this block over today's token block in `styles.css`.

Old names that go:

- `--accent`, `--accent-soft`, `--on-accent` map to `--primary` for
  buttons, links, selected states and the old sign-in logo color. A use
  that meant "the brand color" becomes `--lime` only if it is on the use
  list above.
- `--code-bg` becomes `--bg-sunken`.
- `--text-*`, `--leading-*` and `--weight-*` become the `--type-*`
  shorthands.
- `--duration-enter` becomes `--duration-base`.
- `--duration-slow` is re-used: it is now the 320ms slide duration.
- `--radius` stays as an alias of `--radius-md`.

Values are the same in both themes where only one is given.

```css
:root {
  color-scheme: light;
  /* ground and surfaces */
  --bg: #FFFFFF;            /* header, lists, conversation */
  --bg-canvas: #F7F8FA;     /* Home, the viewer's canvas */
  --bg-rail: #F4F5F7;
  --bg-panel: #FFFFFF;      /* cards, composer, dialog, menu, current rail item */
  --bg-sunken: #F7F8FA;     /* activity pill, gate line, raw tool output, code */
  --bg-muted: #EEF0F3;      /* segmented track, skeleton, disabled button */
  --bg-hover: #EEF0F3;
  --bg-press: #E4E7EB;
  --paper: #FFFFFF;         /* the document page; stays white in dark, it is what prints */
  --ink: #16181D;           /* text on --paper */
  --border: #E4E6EB;
  --border-strong: #D0D4DB;
  --border-input: #8A9099;  /* text-field edge, 3.2:1 on white (WCAG 1.4.11) */
  /* text */
  --fg: #0A0A0B;
  --fg-muted: #4A4F57;
  --fg-subtle: #656A73;     /* 5.4:1 on white, 4.8:1 on --bg-muted */
  /* actions */
  --primary: #0A0A0B;
  --primary-hover: #25272B;
  --primary-press: #000000;
  --on-primary: #FFFFFF;
  --lime: #C8F03C;
  --lime-hover: #B9E22A;
  --lime-press: #A9D11C;
  --on-lime: #0A0A0B;
  --lime-soft: #F1FAD3;
  --lime-ink: #3D5700;
  --hero: #0B0C0E;          /* the Continue with Ten band, the mark's tile, the toast */
  --on-hero: #F4F5F7;
  --on-hero-muted: #A3A8B0;
  --focus: #0A0A0B;
  --focus-halo: rgba(10, 10, 11, 0.12);
  /* status (a category, never urgency) */
  --green: #157F3C;  --green-soft: #E9F6EE;  --green-border: #BFE3CB;
  --amber: #9A5B07;  --amber-soft: #FFF6E6;  --amber-border: #F0D29C;  /* needs-you only */
  --red: #B42318;    --red-soft: #FEF3F2;    --red-border: #F5C7C1;
  --scrim: rgba(10, 10, 11, 0.34);
  /* type families: the table above */
  --font-display: "Bricolage Grotesque Variable", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  --font-sans: "Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --font-serif: "Source Serif 4 Variable", Georgia, "Times New Roman", serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  /* type scale: font shorthand, then tracking */
  --type-display: 600 60px/62px var(--font-display);   --track-display: -0.035em;
  --type-page: 600 28px/34px var(--font-display);      --track-page: -0.025em;
  --type-number: 600 30px/32px var(--font-display);    --track-number: -0.03em;
  --type-dialog: 600 22px/28px var(--font-display);    --track-dialog: -0.02em;
  --type-empty: 600 20px/26px var(--font-display);     --track-empty: -0.02em;
  --type-gate: 600 17px/24px var(--font-display);      --track-gate: -0.015em;
  --type-wordmark: 700 21px/1 var(--font-display);     --track-wordmark: -0.03em;
  --type-header: 600 17px/24px var(--font-sans);       --track-header: -0.01em;
  --type-card-title: 600 15px/22px var(--font-sans);
  --type-body: 400 15.5px/26px var(--font-sans);       /* Ten's prose, your turns */
  --type-body-sm: 400 14.5px/22px var(--font-sans);    /* card bodies, rows, dialog text */
  --type-ui: 500 14px/20px var(--font-sans);           /* rail items, menu items, row titles */
  --type-button: 600 14px/1 var(--font-sans);
  --type-meta: 400 13px/18px var(--font-sans);
  --type-small: 500 12.5px/17px var(--font-sans);      /* pills, chips, activity line */
  --type-tab: 500 11px/1 var(--font-sans);
  --type-mono: 400 12px/17px var(--font-mono);
  --type-doc: 400 16px/1.55 var(--font-serif);
  /* space (4px base) */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 20px;
  --space-6: 24px; --space-8: 32px; --space-10: 40px; --space-12: 48px; --space-16: 64px;
  /* layout */
  --rail-w: 248px; --header-h: 60px; --panel-w: 460px; --thread-max: 760px; --page-max: 1040px;
  /* radius */
  --radius-xs: 6px; --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-xl: 20px;
  --radius-full: 999px; --radius: var(--radius-md);
  /* elevation: e0 is a 1px --border hairline, no token */
  --shadow-1: 0 1px 2px rgba(16, 18, 22, 0.05), 0 0 0 1px rgba(16, 18, 22, 0.07);
  --shadow-2: 0 2px 4px -1px rgba(16, 18, 22, 0.06), 0 10px 24px -8px rgba(16, 18, 22, 0.12), 0 0 0 1px rgba(16, 18, 22, 0.07);
  --shadow-3: 0 28px 64px -16px rgba(16, 18, 22, 0.26), 0 8px 20px -8px rgba(16, 18, 22, 0.12), 0 0 0 1px rgba(16, 18, 22, 0.08);
  /* motion */
  --duration-fast: 120ms;   /* hover, press */
  --duration-base: 200ms;   /* chevrons, dialog pop, card entrance */
  --duration-slow: 320ms;   /* viewer slide, toast rise */
  --duration-spin: 900ms;
  --duration-pulse: 1600ms;
  --duration-shimmer: 1800ms;
  --duration-done: 2000ms;  /* the avatar's done ring fading out */
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
}
[data-theme="dark"] {       /* dormant: never reached by the real app */
  color-scheme: dark;
  --bg: #0E0F11; --bg-canvas: #111215; --bg-rail: #131417; --bg-panel: #17181B;
  --bg-sunken: #1C1D21; --bg-muted: #23252A; --bg-hover: #1F2125; --bg-press: #26282D;
  --border: #26282D; --border-strong: #353840; --border-input: #6E737C;
  --fg: #F2F3F5; --fg-muted: #A3A8B0; --fg-subtle: #8A9099;
  --primary: #F2F3F5; --primary-hover: #D9DBDF; --primary-press: #FFFFFF; --on-primary: #0A0A0B;
  --lime-hover: #D4F65C; --lime-press: #B9E22A; --lime-soft: #222A0C; --lime-ink: #D7F57A;
  --hero: #1A1C20;
  --focus: #F2F3F5; --focus-halo: rgba(242, 243, 245, 0.18);
  --green: #4ADE80;  --green-soft: #12301C;  --green-border: #1F5131;
  --amber: #F5B454;  --amber-soft: #33260F;  --amber-border: #664A18;
  --red: #F97066;    --red-soft: #3A1714;    --red-border: #6E2A24;
  --scrim: rgba(0, 0, 0, 0.6);
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.07);
  --shadow-2: 0 10px 24px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08);
  --shadow-3: 0 28px 64px -16px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.1);
}
```

**Contrast.** Computed, not eyeballed. Every text/ground pair used
below is at least 4.5:1:

| Pair | Ratio |
|---|---|
| `--fg-subtle` on `--bg-muted` (the weakest) | 4.76 |
| `--green` on `--green-soft` | 4.57 |
| `--amber` on `--amber-soft` | 5.05 |
| `--red` on `--red-soft` | 6.05 |
| `--lime-ink` on `--lime-soft` | 7.56 |
| `--on-hero-muted` on `--hero` | 8.19 |
| `--on-lime` on `--lime` | 15.1 |

Stage 1's tester recomputes all of them.

**Type on the phone** (760px or less):

- `--type-display` becomes `600 42px/44px`;
- `--type-page` becomes `600 22px/28px`;
- `--type-number` becomes `600 24px/26px`;
- `--type-header` becomes `600 16px/22px`.

**Numbers** (scores, counts, money) use `font-variant-numeric:
tabular-nums`.

#### Focus, motion, breakpoint, stacking

- **Focus ring**, on every control:
  - `outline: 2px solid var(--focus); outline-offset: 2px;` on
    `:focus-visible` only, with the element's own radius.
  - On the `--hero` band the ring is `--on-hero`.
  - Text fields: `border-color: var(--fg); box-shadow: 0 0 0 3px
    var(--focus-halo);`.
  - The ring is ink, not a second hue, because of the one accent.
- **Motion.**
  - Color, background and shadow transitions on hover and press run
    `--duration-fast var(--ease-standard)` always, since nothing moves.
  - Every `transform`, every keyframe animation and every size change
    sits inside `@media (prefers-reduced-motion: no-preference)`:
    spinner, shimmer, streaming caret, pulses, viewer slide, dialog pop,
    toast rise, card entrance and skeleton pulse.
  - Outside that query each element shows its still end state:
    - the spinner becomes a static `loader-circle`;
    - the shimmer becomes plain `--fg-muted` text;
    - the caret becomes a solid block;
    - the rings described under "Ten's avatar" hold still.
  - Card entrance: opacity 0 → 1 with `translateY(4px)` → 0, over
    `--duration-base var(--ease-out)`. The card is already complete
    when it enters (§ 1.1).
- **Breakpoint.** The frame root is a size container: `.frame {
  container: frame / inline-size; }`. The phone pattern (§ 5.5) is
  `@container frame (max-width: 760px)`. Between 761px and 1100px the
  pinned viewer turns into a drawer, `@container frame (max-width:
  1100px)`: it overlays from the right at `min(var(--panel-w), 100%)`,
  with `--shadow-3`, a close ✕ and `z-index: 30`. Media queries are for
  the sign-in screen only, which has no frame.
- **Stacking**, the only `z-index` values:
  - 30: viewer drawer and phone sheet;
  - 40: `⋯` menu;
  - 50: dialog scrim (Buy credit, delete confirmation, set password);
  - 60: toast.

  The rail, header and tab bar are grid rows and columns with no
  `z-index`. Escape closes the top-most first: dialog, then menu, then
  sheet.

#### Icons

Lucide, version **1.48.0**, ISC license.

- **How they ship.** The path data is copied once from the
  `lucide-static@1.48.0` package into one local module,
  `apps/web/src/icons.tsx`, with Lucide's ISC notice at the top. No
  icon package is added as a dependency, and no icon is fetched from a
  CDN.
- **How each icon renders.** `<Icon name size />` returns
  `<svg viewBox="0 0 24 24" width={size} height={size} fill="none"
  stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true">`. Sizes are 13, 14, 15,
  16, 17, 18 or 20px, as each component names. A control whose only
  content is an icon carries an `aria-label`.
- **One icon per meaning:**

| Icon | Meaning |
|---|---|
| `house` | Home |
| `message-square` | Talk to Ten |
| `briefcase` | Jobs, a role |
| `layers` | Applications |
| `files` | Documents |
| `wallet` | credit, a cost |
| `ellipsis` | the `⋯` menu |
| `file-text` | a file or document |
| `panel-right` | opens in the viewer |
| `x` | close |
| `arrow-left` | back |
| `arrow-right` | continue |
| `chevron-right` | expand, or a row that opens |
| `chevron-down` | a closed group |
| `circle-check` | done or passed |
| `circle-dot` | not run |
| `loader-circle` | working |
| `hourglass` | needs your yes |
| `circle-alert` | error |
| `list-todo` | To do, plan |
| `user` | Waiting on you |
| `paperclip` | attach |
| `link` | a job link |
| `arrow-up` | send |
| `square` | stop |
| `printer` | print |
| `copy` | copy text |
| `external-link` | a web link (§ 5.2 rule 7) |
| `corner-down-left` | type `yes` |
| `wallet` in the menu | Buy credit |
| `folder-down` | export workspace |
| `key-round` | set a new password |
| `trash-2` | delete my beta data |
| `log-out` | sign out |
| `mail` | email link |
| `lock` | the sign-in trust line |
| `check` | inline pass |

- **Activity rows** (the future § 3 table, `design-plain-replies.md`
  § 5) use:

| Icon | Step |
|---|---|
| `book-open` | read |
| `pencil-line` | write |
| `file-pen` | wrote a document |
| `globe` | opened a posting |
| `search` | web search |
| `file-search` | fit analysis |
| `building-2` | company notes |
| `scissors` | what was cut |
| `target` | targets |

No emoji. No sparkle icon.

#### The brand mark

A rounded tile holding a "1" bar and an oval "0": Ten, read as the
numeral.

- **The mark (inline in the app).** The fills are tokens, so the dark
  theme follows:

```html
<svg class="mark" width="28" height="28" viewBox="0 0 32 32" role="img" aria-label="Ten">
  <rect width="32" height="32" rx="9" fill="var(--hero)"/>
  <rect x="7" y="8.5" width="3.6" height="15" rx="1.8" fill="var(--on-hero)"/>
  <ellipse cx="19.4" cy="16" rx="4.6" ry="5.7" fill="none" stroke="var(--lime)" stroke-width="3.6"/>
</svg>
```

- **Sizes.** 28px in the rail, the header avatar and the conversation.
  30px on sign-in. 24px on the Continue with Ten band. On the `--hero`
  band the tile inverts: fill `var(--on-hero)`, "1" `var(--hero)`, "0"
  `var(--hero)`.
- **The wordmark.** The mark, a 9px gap, then live text "Ten" in
  `--type-wordmark` with `--track-wordmark`, color `--fg`. It is text,
  not outlined, so it takes the self-hosted font.
- **The favicon.** A new file, `apps/web/public/favicon.svg`, linked
  from `index.html` as `<link rel="icon" type="image/svg+xml"
  href="/favicon.svg">`. It uses heavier strokes so it reads at 16px:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0A0A0B"/><rect x="6.5" y="8" width="4.4" height="16" rx="2.2" fill="#FFFFFF"/><ellipse cx="19.6" cy="16" rx="4.4" ry="5.8" fill="none" stroke="#C8F03C" stroke-width="4.4"/></svg>
```

#### Component states

Every control has these five states:

- **rest**;
- **hover**;
- **pressed** (`:active`);
- **focus-visible**: the ring above;
- **disabled**: `--bg-muted` fill, `--fg-subtle` text, no shadow,
  `cursor: not-allowed`.

The sections below name only what differs.

**Buttons.** Base style for all variants:

- radius `--radius-sm`, `--type-button`, icon 16px with an 8px gap;
- sizes: sm 32px high with 0 11px padding at 13px; md 38px high with
  0 14px padding; lg 46px high with 0 18px padding at 15px and radius
  10px.

| Variant | Rest | Hover | Pressed |
|---|---|---|---|
| **pri** | `--primary` fill, `--on-primary` text | `--primary-hover` | `--primary-press` |
| **lime** (Continue with Ten only) | `--lime` fill, `--on-lime` text | `--lime-hover` | `--lime-press` |
| **sec** | `--bg-panel` fill, `--fg` text, `inset 0 0 0 1px var(--border-strong)` | `--bg-hover` | `--bg-press` |
| **ghost** | transparent, `--fg-muted` text | `--bg-hover`, `--fg` | `--bg-press` |

- **Loading** holds the width (min-width set to the rendered width)
  and keeps the label. A 16px spinning `loader-circle` takes the icon
  slot, with `aria-busy="true"`. A button never changes size or label
  while loading.
- **Icon button:** 34×34px, radius `--radius-sm`, `--fg-muted`. Hover:
  `--bg-hover` and `--fg`. Pressed: `--bg-press`.

**Rail item (Stage 2).**

- Rail: `--rail-w` wide, `--bg-rail` fill, a 1px `--border` right
  rule, padding 14px 10px 10px. The wordmark row has padding 4px 8px
  16px. Items stack with a 2px gap.
- Item: 36px high, padding 0 10px, radius `--radius-sm`, icon 18px with
  a 10px gap, `--type-ui`, `white-space: nowrap`.

| State | Look |
|---|---|
| Rest | `--fg-muted` text, `--fg-subtle` icon |
| Hover | `--bg-hover`, `--fg` text |
| Pressed | `--bg-press` |
| Current | `--bg-panel`, `--fg` text and icon, `--shadow-1`, `aria-current="page"` |

- **The needs-your-yes marker** (§ 5.1) sits on Talk to Ten with
  `margin-left: auto`:
  - a pill 20px high, padding 0 7px, radius full, `--amber-soft` fill,
    `--amber` text, `0 0 0 1px var(--amber-border)`;
  - text 11px/1 at weight 600: the words "Needs your yes" after a 6px
    `--amber` dot;
  - the dot pulses (opacity 1 → 0.5, `--duration-pulse`) under
    `no-preference`.

**Frame header (Stage 2).**

- `--header-h` high, `--bg` fill, a 1px `--border` bottom rule, padding
  0 20px 0 28px.
- The page title in `--type-header` on the left. On the right, with
  12px gaps: Ten's avatar, the balance chip, and the `⋯` icon button.

**Ten's avatar** (§ 1.3, in the header):

- The 28px mark. A ring drawn as a `::after` 3px outside the tile,
  radius 11px, 2px wide, carries the state.
- Rings by state:

| State | Ring | Motion (`no-preference` only) | Reduced motion |
|---|---|---|---|
| **idle** | none | none | none |
| **thinking** | `--border-strong` | opacity pulse, `--duration-pulse` | static |
| **working** | a `--fg` arc (conic) | rotates in `--duration-spin`, linear | a static `--fg-muted` ring, dashed |
| **needs-you** | `--amber` | opacity pulse, `--duration-pulse` | static |
| **done** | `--green` | fades to none over `--duration-done` | none |

- Hover and the accessible name stay § 1.3's text.
- No visible state word sits beside the avatar.

**Balance chip.**

- 34px high, radius full, padding 0 4px 0 12px, `--bg-panel` fill,
  `0 0 0 1px var(--border)`, `--type-ui` in `--fg-muted`.
- `wallet` icon (16px), then the amount in `--fg` at weight 600,
  tabular.
- Inside it, a nested pri button, 26px high, radius full, padding 0
  11px, 12.5px at weight 600, labelled "Buy credit" (§ 1.11).
- At `$0.00` (§ 1.1) the chip takes `--amber-soft`, `--amber` and
  `--amber-border`: a fact, not an alarm. It is never red.

**The `⋯` menu.**

- 260px wide, radius 14px, padding 6px, `--bg-panel`, `--shadow-3`.
  Anchored right under its button, 6px below.
- Items: 36px high, padding 0 10px, radius `--radius-sm`, `--type-ui`,
  16px `--fg-muted` icons. Hover: `--bg-hover`.
- Items are § 1's, in § 1's order. A 1px `--border` divider sits before
  "Delete my beta data", which is `--red` text and icon.

**Composer** (Talk to Ten only).

- `--bg-panel` fill, radius `--radius-lg`, `--shadow-2`, padding 12px
  12px 10px 16px.
- The input is `--type-body` at 15.5px/24px, with the placeholder in
  `--fg-subtle`.
- The row below holds the attach icon button, then the send button at
  the far right. No pill (§ 5.3.1, C22).
- **Send:** 34×34px, radius 10px, pri colors. Empty input: disabled.
  While a turn runs it becomes **Stop** (`square` icon, 13px), same
  size and place.
- **Focus-within:** `0 0 0 1.5px var(--fg)` plus `--shadow-2`.
- **Gate pending:** `0 0 0 2px var(--amber-border)` plus `--shadow-2`.
  This is the only amber on the composer.
- There is no skill picker and no "/skills" label (§ 1.1; § 5.3.1, C22).

**Activity line** (the collapsed line, § 3). This is its look only.
Its words are § 5.3.1's rows L1–L26 (C24).

- **Collapsed:**
  - a pill 30px high, padding 0 10px 0 8px, radius full, `--bg-sunken`
    fill, `0 0 0 1px var(--border)`, `--type-small` in `--fg-muted`;
  - a 15px leading icon: `circle-check` in `--green` when done, then
    `chevron-right`, which turns 90° over `--duration-base` when open,
    then the label and the step count in `--fg-subtle`. (Amended
    2026-09-26 from the Stage 1 review: a chevron after the label shifted
    the streaming line at 375px, measured CLS 0.0026; before the label it
    doesn't.)
- **Hover:** `--bg-hover`, `--fg`.
- **Live** (a tool part not yet done):
  - `--bg-panel` fill, `0 0 0 1px var(--border-strong)`, `--fg` text;
  - a spinning `loader-circle`;
  - the label shimmers, a gradient clip over `--duration-shimmer`,
    under `no-preference`;
  - it lists only finished steps and the running one.
- **Expanded:**
  - rows sit under a 1.5px `--border` left rule, indented 14px;
  - each row is 13.5px/19px with a 16px `--fg-subtle` icon;
  - the literal input and output use `--type-mono` at 11.5px, on
    `--bg-sunken`, radius `--radius-xs`, padding 6px 8px,
    `overflow-wrap: anywhere` (rule 11).

**Document row and chip** (a card's `ref`, and every file row on a
page):

- Padding 10px 12px, radius `--radius-md`, `--bg-panel`, `--shadow-1`.
- A 34×40px icon tile (radius 6px, `--bg-sunken`, `inset 0 0 0 1px
  var(--border)`, `file-text` 17px in `--fg-muted`).
- The name in `--type-ui` at weight 600, one line with an ellipsis.
- The meta line in `--type-small` at weight 400, `--fg-muted`. The
  automatic-checks result shows as `check` 13px plus the words in
  `--green`. "Wording check not run" stays `--fg-muted` (§ 2.4); it is deferred and
  not shown in this step (§ 5.3.1, T7).
- A trailing `panel-right` 16px in `--fg-subtle`.

| State | Look |
|---|---|
| Hover | `--shadow-2` |
| Pressed | `scale(0.995)`, under `no-preference` |
| Open in the viewer | `0 0 0 2px var(--fg)` plus `--shadow-1` |

**Cards** (§ 2):

- **Base:** `--bg-panel`, radius `--radius-lg`, `--shadow-1`, padding
  16px 18px, max-width 600px in the thread. Title in
  `--type-card-title`, body in `--type-body-sm` and `--fg-muted`.
- **Verdict:**
  - a 36px initial tile (radius 10px, `--hero` fill, `--on-hero` text,
    Bricolage 700 at 15px) holding the first letter of `company`;
  - the title and a `company · location` meta line;
  - the score in `--type-number` with "/100" in `--type-meta` and
    `--fg-subtle`, right-aligned (the scripts write 0–100,
    `skills/evaluate/scripts/lib/record-verdict.mjs:53-54`);
  - the tier pill, then the reason.
- **Tier pills:** 24px high, radius full, padding 0 9px 0 8px, 12.5px/1
  at weight 600. The words carry the meaning; color only marks the
  category.

| Tier | Fill | Text | Extra |
|---|---|---|---|
| Strong Fit | `--green-soft` | `--green` | `check` 13px |
| Investable Stretch | `--bg-panel` | `--fg` | `0 0 0 1px var(--border-strong)` |
| Long-Shot Stretch | `--bg-sunken` | `--fg-muted` | `0 0 0 1px var(--border)` |
| Weak Fit | `--bg-muted` | `--fg-muted` | — |
| Quick scan (badge) | `--bg-muted` | `--fg-muted` | — |

- **Plan lines** (the § 2.2 card and Home's lists):
  - each row is padding 12px 18px with a 1px `--border` top rule;
  - an 18px decorative ring (1.5px `--border-strong`, `aria-hidden`);
  - the line as written in `--type-body-sm` at weight 500;
  - under it, the path chip, 28px high, radius `--radius-sm`, `0 0 0
    1px var(--border)`, `--type-small`, with `file-text` 14px.
- **Checker:** pass shows `circle-check` in `--green`. FAIL is "styled
  distinct, not alarm-red" (§ 2.4): `--bg-sunken`, `0 0 0 1px
  var(--border-strong)`, `circle-dot` in `--fg`.
- **Cost:** a 34px `wallet` tile, the action in `--type-ui`, the
  balance in `--type-meta`, and the range right-aligned at 15px/20px,
  weight 600, tabular.
- **Gate** (§ 2.5):
  - `0 0 0 1px var(--amber-border)` plus `--shadow-2`;
  - a header band in `--amber-soft` and `--amber` with `hourglass`;
  - the action title in `--type-gate`;
  - the gate text as its lines;
  - the gate line in a block of `--bg-sunken`, `0 0 0 1px
    var(--border)`, 14.5px/21px at weight 600;
  - the instruction row with `corner-down-left` and a `yes` key cap:
    22px high, `--type-mono` at weight 600, `inset 0 0 0 1px
    var(--border-strong), inset 0 -2px 0 var(--border-strong)`.
  - Approved: the band turns `--green-soft` / `--green` with
    `circle-check`, and the shadow drops to `--shadow-1`. There is no
    button, ever.
- **Error** (§ 2.7):
  - `--red-soft` fill, `0 0 0 1px var(--red-border)`, radius
    `--radius-md`, padding 14px 16px;
  - `circle-alert` 18px in `--red`;
  - `message` as sent, in `--type-body-sm` and `--fg`;
  - no button (§ 1.11).

**Messages (Stage 2).**

- The thread is `--thread-max` wide, centred.
- Each turn is a 32px avatar column plus the content, with 26px
  between turns.
- Ten's avatar is the 28px mark. Yours is a 28px circle, `--bg-muted`,
  holding `user` 15px in `--fg-muted`. Above each turn, the name ("Ten"
  or "You") in `--type-ui` at weight 600.
- Prose is `--type-body`.

**Toast.**

- Bottom centre, 28px from the bottom (84px on the phone, above the
  tab bar). `--hero` fill, `--on-hero` text, radius 12px, padding 10px
  12px 10px 14px, `--type-ui`, `--shadow-3`.
- `circle-check` 18px in `--lime`, then an `x` dismiss.
- `role="status"`. It rises over `--duration-slow` and leaves after 4 s.
- Its only use: the credited line of § 1.11.

**Dialog** (Buy credit, § 1.11; delete, § 1.7; password, § 1.10):

- `--scrim` over the frame. The box is `min(460px, 100% - 32px)` wide,
  radius 18px, padding 22px 24px 20px, `--bg-panel`, `--shadow-3`.
- Title in `--type-dialog`, a ✕ icon button, body in `--type-body-sm`
  and `--fg-muted`.
- It enters with a pop, `translateY(8px) scale(0.98)` → none over
  `--duration-base`.
- Focus is trapped while open and returns to the opener.
- **Buy credit's amounts:** three 54px buttons, radius 12px, 20px
  Bricolage at weight 600.

| State | Look |
|---|---|
| Rest | `inset 0 0 0 1px var(--border-strong)` |
| Hover | `--bg-hover` |
| Selected | `inset 0 0 0 2px var(--fg)`, `--lime-soft` fill |

- PayPal's buttons render as PayPal's SDK draws them.

**Skeleton.**

- `--bg-muted` blocks, radius 6px, sized to the final content so
  nothing shifts.
- They pulse in opacity 1 → 0.55 over 1400ms under `no-preference`.
- A page list loading shows three 64px row skeletons. The viewer
  loading shows a paper with five text-line blocks.

**Empty state** (every "Empty" in § 5.3).

- It sits centred in its pane:
  - a 56px tile (radius 16px, `--bg-panel`, `--shadow-1`) holding the
    page's rail icon at 26px, stroke 1.5, in `--fg-muted`;
  - then the first sentence of § 5.3's empty text in `--type-empty`,
    with the rest in `--type-body-sm` and `--fg-muted`, max 380px wide.
    Same words; only the type differs.
  - then one button: Home's "Continue with Ten" (lime lg). The other
    pages get a sec md "Talk to Ten", which only opens Talk to Ten
    (§ 5.2 rule 2).
- **Unreadable file** (§ 5.2 rule 6) uses the error card's shape in
  neutral colors: `--bg-panel`, `0 0 0 1px var(--border-strong)`, and
  `circle-alert` in `--red`, followed by a Retry sec sm button.
- **The working line** (§ 5.2 rule 4): a pill with `--bg-sunken`,
  `--type-small`, `--fg-muted`, and a spinning `loader-circle`, above
  the page content.

#### Page layouts (Stage 2)

- **Frame.**
  - Desktop: `grid-template-columns: var(--rail-w) minmax(0, 1fr)`.
    The page area is `grid-template-rows: var(--header-h) minmax(0, 1fr)`.
  - Phone: § 5.5.
  - Every grid child that holds text gets `min-width: 0`.
- **The viewer**, on Talk to Ten, Jobs, Applications and Documents:
  - a pinned right column, `--panel-w` wide, as § 1.1's side panel is
    today, with "Nothing open yet." when empty;
  - on Home it appears only while a file is open, with a ✕;
  - it follows § 5.2 rule 8.
  - The panel: `--bg-canvas`, a 1px `--border` left rule, and a header
    in `--bg` holding the file name in `--type-ui` at weight 600 and the
    path in `--type-mono` at 11.5px in `--fg-subtle`.
  - Résumé and letter `.md` render on a paper: `--paper` fill,
    `--ink` text, radius 4px, `--shadow-2`, padding 30px 32px 36px, max
    640px, in `--type-doc`. Other `.md` files sit on a `--bg-panel`
    card (radius `--radius-md`, `--shadow-1`, padding 20px 24px) in
    `--type-body-sm`. The `.html` iframe sits on the paper.
- **Home.** `--bg-canvas`, with a content column `--page-max` wide,
  padding 28px 36px 56px (16px on the phone). Top to bottom, per
  § 5.3:
  1. The `Goal:` line as written, in `--type-page`. Under it the
     `Budget:` line as written, in `--type-body-sm` and `--fg-muted`.
  2. **Waiting on you** (`user` icon) and **To do** (`list-todo`), side
     by side in a two-column grid with a 16px gap, stacked on the
     phone. Each is a card with plan lines.
  3. **The pipeline:** one card holding six cells: To Review,
     Interested, Applied, Interviewing, Offer, Dismissed.
     - Each cell is a button, padding 14px 18px 16px, divided by 1px
       `--border`, with a 2px divider before Dismissed.
     - The label is in `--type-small` and `--fg-muted`, the count in
       `--type-number`. A 0 is `--fg-subtle`.
     - Hover: `--bg-hover`. On the phone the cells form a 3 × 2 grid.
  4. **Continue with Ten:**
     - a band in `--hero`, radius `--radius-lg`, `--shadow-2`, padding
       20px 22px;
     - on the left, the inverted 24px mark and "Talk to Ten" in
       `--type-card-title` and `--on-hero`;
     - on the right, the lime lg button with `arrow-right`. On the
       phone the button runs full width under the label.
- **Jobs.** The list pane is `--bg-canvas`, with its inner column max
  760px and padding 24px 28px.
  - Stage groups: a heading in `--type-small` at weight 600,
    `--fg-muted`, plus the count in `--fg-subtle`, with 24px above
    each group.
  - Dismissed is a closed `<details>` with a `chevron-down`.
  - A row is a card (padding 14px 16px, 10px apart) holding:
    - the 36px initial tile;
    - `Company — Title` in `--type-card-title`;
    - a meta line in `--type-meta`: Location · the date part of Seen
      and Updated, as written (`2026-09-22`, not reformatted);
    - the tier pill and the score in `--type-number` at 20px,
      right-aligned;
    - Reason and Dealbreakers in `--type-body-sm`;
    - the URL, under rule 7, with `external-link` 13px;
    - the controls "Open analysis" (sec sm) and "Ask Ten about this"
      (ghost sm).
- **Applications.** The same list pane.
  - An entry is a card holding the initial tile, the role label in
    `--type-card-title`, and the stage pill: 24px, radius full,
    `--bg-sunken`, `0 0 0 1px var(--border)`, `--type-small` in
    `--fg-muted`, holding `jobs.md`'s stage words.
  - With no linked row, the entry shows "Not linked to a role on your
    job list." in `--type-meta`.
  - Then its files as document rows, then "Ask Ten about this" (ghost
    sm).
- **Documents.** The same list pane.
  - Group headings in `--type-card-title` with the count in
    `--fg-subtle`.
  - Rows are 44px minimum: `file-text` 16px, the path in `--type-ui`
    with the folder prefix in `--fg-subtle`, and the date part at the
    right in `--type-meta`, tabular.
  - Rows are divided by 1px `--border` inside one card per group.
- **To restore (restore ruling, § 5): the designer specs these from
  the mockup, against § 5.3 as amended.** The text above stays until
  then.
  - **Home:** the mockup's order (goal, pipeline strip, then two
    columns). The left column holds Ten's last reply in the `--hero`
    band (the quote, the activity line, Continue with Ten; **no reply
    field**), then Waiting on you and To do with minutes pills and the
    "<N> of your <M> min a day" aside on To do. The right column holds
    the Active application card: tier pill, the stage steps, file chips
    and "Next, from you". The pipeline cells stay `jobs.md`'s six, with
    no "now" highlight.
  - **Jobs and Applications:** the mockup's list-plus-detail layout
    (`.md` split, detail with `.dhead`, `.verdict-band` and `.sect`
    cards), holding only § 5.3's parts. The one viewer (§ 5.2 rule 8)
    opens from a detail's controls; the designer says where it sits
    beside list and detail on desktop, and on the phone (a sheet, § 5.5).
  - **The stage steps:** the mockup's `.stepper` shape with `jobs.md`'s
    stage words, a current step, every other step drawn alike, and no
    check marks or dates (§ 5.3,
    "Pieces the pages share").
  - **The plan item:** the mockup's `.pt` / `.pw` / `.mins` shape, used
    only when C § 18.1 splits the line; otherwise one line as written.
  - **Coverage table and cut list:** the mockup's `table.cover` and
    `ol.cuts`, with the status words from § 5.3.
  - **Not restored:** Verified / Unknown tags, "Format checks passed"
    badges, word counts, and paper thumbnails on pages.

#### Sign-in (§ 1.4)

- **Layout** (no rail): the wordmark at the top left. The rule 1 line
  as the headline in `--type-display`, with the lime underline on
  "actually want." drawn as `background: linear-gradient(transparent
  62%, var(--lime) 62%, var(--lime) 92%, transparent 92%)`.
- **Sign-in card:** 420px, radius 18px, padding 24px, `--shadow-3`.
  - Fields are 44px high, radius 10px, with a 1px `--border-input`
    edge.
  - "Email me a sign-in link" is pri lg, full width.
  - "Use a password instead" is a text link.
  - Then the trust line in `--type-small` with `lock`; its words are
    § 5.3.1's rows S12–S13.
  - Then the line "Prefer local? Run it from your terminal." (§ 1.4).
- **Not in § 1.4.** The mockup also has a lead paragraph, three proof
  points and a product preview. None of these is in § 1.4. They wait
  for an owner-approved § 1.4 amendment and are not built from this
  spec.
  **To restore (restore ruling, § 5):** § 1.4 is now amended. The
  designer specs the lead paragraph, the three proof points (§ 1.4's
  wording, not the mockup's where they differ) and the preview
  (Home's own view on `signin-preview.json`'s props, `inert`,
  captioned "Sample data";
  on the phone the form comes first).

#### Where this differs from the mockup (§ 1–§ 5 win)

*(Rewritten for the restore ruling, § 5, fix round 1.)*

- **Home follows § 5.3.** It keeps the mockup's last reply, Active
  application card, time pills and minutes sum. It drops the reply field
  on the hero: the composer exists only in Talk to Ten (the owner's one
  agreed exception). The pipeline cells are `jobs.md`'s stages (To
  Review … Offer, Dismissed), not the mockup's Found / Decided /
  Applying, and no cell is highlighted as "now". Home's plan cards are
  titled **Waiting on you** and **To do** (§ 5.3), not "This week's
  plan".
- **Plan lines** show as written, except a line in C § 18.1's strict
  minutes form, which shows as action, pill and why (§ 5.3, "The plan
  item"). The conversation's plan card never splits (§ 2.2).
- **The header is § 5.1's**, with Ten's state avatar, the balance chip
  and `⋯`. The mockup's initials avatar and the account block at the
  foot of the rail are gone, because the `⋯` menu is the account menu.
  The rail marker reads **"Needs your yes"** (§ 5.1), not the mockup's
  "Needs you".
- **The rail** has counts on Jobs, Applications and Documents (§ 5.1),
  but no "In progress" entry and no summary line.
- **Jobs and Applications** have the mockup's list-plus-detail, holding
  only § 5.3's parts. Gone:
  - "Verified" / "Unknown" tags: the tier words show only where the
    company brief wrote them, word for word (§ 5.3, Jobs);
  - "Format checks passed" badges and word counts on pages (§ 5.3,
    Applications);
  - the step names Found, Decided, Applying and Interview: the steps
    use `jobs.md`'s words, with no check marks or dates (§ 5.3, "The
    stage steps").
- **Documents** is a list plus the one viewer. Its paper thumbnails are
  gone: they would need a read per file just to draw.

  Dates show as written (`2026-09-22`), not reformatted to "Sep 22".
- **Talk to Ten** has no "Acme · Staff PM" context chip. It would be a
  UI claim about what the conversation is about. The side panel stays
  pinned, as § 1.1 has it, rather than opening only on demand.
- **Check names follow `design-plain-replies.md`:** "the automatic
  checks" and "the wording check", not the mockup's "format checks".
  The verdict card shows no "Your target" line; that suffix is removed
  in the plain-replies change.
- **Tier colors.** Investable Stretch loses the mockup's blue, and the
  focus ring loses its blue. Both would be a second accent.
- **The phone** keeps the mockup's tab bar, but the pipeline strip is a
  3 × 2 grid instead of a sideways scroll (§ 5.5, no horizontal
  scroll). The tab bar also hides while typing.

### 5.7 Fixtures for the pages

One new fixture, `apps/web/fixtures/workspace-pages.json`, under § 4's
rules (invented persona; every script-written file produced by running
the real scripts in a `mktemp -d` workspace, never `~/job-search`). Its
`files` must include: a `jobs.md` with at least one role in each of the
five stages plus a dismissed role, one row without an `Analysis` field, and one
quick-scan row; a `plan.md` with Goal, Budget, and lines under both
Waiting on you and To do; an `applications/` folder with one role using
`<key>.md` and one using `<key>-application.md`, one with a rendered
`.html`, and one whose key matches no `jobs.md` row; an upload under
`documents/`; and a `leads.md`, to prove Documents hides it. The unsafe-
URL and unreadable-section cases are unit-test inputs, not fixture
files, so no fixture holds a hand-edited script-written file.
`empty-first-run.json` proves every empty state.

**Added by the restore ruling (§ 5).** The same fixture also holds:
`jobs.md` rows whose `Analysis` and `Company file` fields point at a
`jd-analysis/<key>.md` and a `company/<slug>.md` written in evaluate's
schema shapes (these two are model-written prose, so they are written
by hand), plus one row whose `Analysis` names a file that isn't there; an
application notes file with `## Coverage` (all three statuses) and
`## Selection` (at least two `out` rows), whose output
`proposal_block` produces cleanly when run in the `mktemp -d`
workspace; a second live application, so Home's card says "The most
recently changed of 2 active applications"; `plan.md` To do lines in C § 18.1's minutes
form, one line without minutes, a `Budget: <N> min/day` line, and a
Waiting on you or To do line whose backticked path is an application
file; and a `messages` array (§ 4's shape: the conversation, invented)
whose last assistant message has a text part over 280 characters and
tool parts. Every name, company and fact is invented. Sign-in's preview
does **not** use this fixture: it has its own, `signin-preview.json`
(§ 1.4), one ordinary invented search rather than edge cases.

### 5.8 Out of scope for this step

- Editing, uploading, renaming or deleting from a page; moving a stage
  by drag or button. Every change goes through the conversation.
- A profile page, an interview or practice page, a contacts or outreach
  page, a knowledge or skills page (`apps/workspace-ui` has views for
  these; they come back only on evidence).
- Trends, charts, week-over-week deltas, "new this week" counts.
- Search, filter or sort controls beyond the file's own order.
- Running a checker, re-rendering a résumé, or any agent work from a
  page.
- URL routes, deep links and Back-button navigation between pages
  (§ 5.1).
- More than one conversation, threads, or a conversation list (C § 11.1).
- "Ask in Claude/ChatGPT" cross-host launch (`apps/workspace-ui`'s job).
- A UI framework migration (Tailwind, shadcn/ui, Radix).
- Dark mode in production.

### 5.9 Build stages

Each stage is one PR, built by a coder in its own worktree and tested by
a tester who didn't build it, from this section. Every stage must also
keep `python3 tests/run.py`, `tests/web/*.test.ts`, `tests/web/e2e.mjs`
and `npm run verify:screens` green. **No stage changes the store.**
Stages that add or change a reader are marked **READER**.

**Stage 1: Foundation.** Tokens, fonts, icon set, brand mark and
component states from the filled § 5.6, applied to the screens that
exist today. No layout change, no new screen.
*Exit:* every existing screen renders in the new tokens (owner reviews
screenshots at 1440 and 375 px); no color, font or radius literal
outside the token block in `styles.css`; no new runtime dependency
except the fonts and icon package § 5.6 names.
*Tester checks:* the existing e2e and `verify:screens` pass unchanged;
a grep for hex or `rgb(` literals outside the token block; text
contrast at WCAG AA for every text/background token pair (computed,
not eyeballed); no horizontal scroll at 375px; `:focus-visible` on
every control.

**Stage 2: The frame.** Rail, header in the frame, page switching as app
state, the landing rule, the conversation kept mounted, the needs-you
marker, each new page showing only its empty state, and the message
layout (§ 5.6, "Messages (Stage 2)").
*Exit:* § 5.1's three proofs pass (a turn survives a page change, a gate
seen from another page, the three landing cases); § 5.2 rules 1 and 2
pass on the frame; § 5.5's phone rules hold with the designer's pattern.
*Tester checks:* those e2e cases on the mock; the `RealChatShell` run
with a spy conversation store for the save count and the restored-gate
landing (§ 5.1, "One frame for both builds"); an e2e check that the
new-version notice shows on a page other than Talk to Ten; a spy store
and a spy transport; the 375px checks on every page.

**Stage 3: The pages, one PR each, in this order** (least new code
first):

- **3a Documents.** No reader. *Exit:* every fixture file listed once
  in its group, `leads.md` absent, sorted by path, the viewer opens
  `.md`, `.html` (sandboxed, print works) and binary; § 5.2 rules 1, 2,
  6 and 8.
- **3b Jobs. READER (reuse):** **Waits for** `design-web-search.md` S1
  (the `Analysis` field). 3b also moves the verdict card's `ref` to the
  row's `analysis_file` (C § 6.2): `packages/agent/src/cards.ts:124`,
  `tests/agent/cards.test.ts:109-116` (tester-owned), and
  `apps/web/fixtures/mvp-journey.json:89`'s `--jd-file jd-analysis/…` →
  `--analysis-file`. The `jobs_md` port unchanged, plus the
  small read-only `store-io.ts` adapter, with `isMissingError` (§ 5.2
  rule 6). **Not 3b's:** deleting the stub `packages/agent/src/jobs-md.ts`
  (`cards.ts:6` moving to the port, the public re-export of
  `parseJobsMdRows` and `findJobsMdRow` at `packages/agent/src/index.ts:19`
  removed, the verdict card's builder tests passing unchanged). Web
  search S2 owns that deletion (`design-web-search.md` § 9, S2, and its
  build; lead ruling, 2026-09-29). Each `.mjs` import from
  `skills/*/scripts/lib/` carries
  `// @ts-expect-error - plain .mjs, no type declarations` (the posture of
  `apps/web/src/backend/script-runner.ts:19-21`). The tester updates
  `mutantCopy` (`tests/agent/browser-safety.test.ts:126-134`) so the copy
  sits at `<tmp>/packages/agent` beside a copy of `<tmp>/skills`: a named,
  allowed change to a tester-owned test, with no assertion changed. *Exit:* every `### ` role under
  a stage heading in the fixture's `jobs.md` shows once, in its stage,
  in file order, with fields word for word; Dismissed closed with its
  count, and no Dismissed heading on a `jobs.md` with no dismissed row;
  § 5.2 rule 7's URL table. *Tester checks:* compare the page
  with `load()` over the fixture, field by field; the adapter's
  `exists` on a missing read and on a failing read.
  *Restore ruling adds the detail:* **READER (new): `splitSections`**
  (§ 5.3, "Pieces the pages share"), web-only, reading only where `## `
  sections start and end. *Exit adds:* `splitSections`' table test; the
  detail's sections equal the fixture files' sections string for
  string; a quick-scan row shows no analysis or company parts; the
  missing-file line and a failing read; no tag element for a claim
  tier anywhere in Jobs (tier words appear only inside a section's
  text, as written).
- **3c Home. READER (change):** `readPlanBoard` in `packages/agent`
  (C § 18), with `parsePlanTodo` re-expressed through it. *Exit:*
  the four existing tables C § 18 names pass **unchanged** (a failing
  old case goes back to the architect; it is never edited to pass); C
  § 18's `waitingRows` parity test and its new table; Home's
  counts equal `load()`'s rows by stage; § 5.2 rules 4, 5 and 6.
  *Restore ruling adds* Ten's last reply and the minutes: **READER
  (new): `splitPlanMinutes` and `budgetMinutesPerDay`** (C § 18.1, in
  `packages/agent` beside `readPlanBoard`, which itself stays
  unchanged); the plan item component; one exported function that
  returns Talk to Ten's whole collapsed tool line, in § 5.3.1's words, with
  `groupParts` (`Transcript.tsx:35`) exported, and no copy; Home's view
  made a pure component (§ 5.3), which 3f's preview needs. The last
  reply needs no parser. *Exit adds:* C § 18.1's table and round-trip
  tests; § 5.3's last-reply table test and its e2e case; the
  minutes-sum table; § 5.2 rule 1's check that pages and the rail
  receive only `messages` and `status`, with a spy on every function
  `useChat` returns.
- **3d Applications. READER (new):** **Waits for** `design-web-search.md`
  S1 (the `Analysis` field). `groupApplications` and the exact
  `Analysis` join. *Exit:* a table test over both name forms, the `.html`,
  an unknown suffix and an unmatched key; the page's roles, stages and
  "Not linked" line match the fixture.
  *Restore ruling adds the detail:* **READER (change): `proposalRows`**,
  one new export of the parity-tested `proposal_block` port, with the
  port's `run()` re-expressed through it (C § 19); plus the stage-steps
  component (§ 5.3) and "Next, from you" (the exact `ref` match over
  `readPlanBoard`'s items). *Exit adds:* the `proposal_block` cases
  (`tests/checkers/cases/proposal_block/`) pass **unchanged** (a failing
  case goes back to the architect); C § 19's table test; the coverage and cut rows equal
  `proposalRows`' output on the fixture; the two-notes-files line; the
  stage-steps table (no check marks, no dates).
- **3e Home's Active application card and the rail counts** (after
  3a–3d). No new
  reader: it combines `load()`, `groupApplications`, `readPlanBoard`
  and 3d's stage steps and "Next, from you". *Exit:* § 5.3's Active
  application tests (the first linked live entry, "The most recently
  changed of 2 active applications"); § 5.1's rail counts equal their pages' counts on the
  fixture, no number at 0, no number on a failing read; § 5.4's
  page-to-page links, one e2e case each, on the spy store and spy
  transport, a Home count of 0 that is not a link, and at 375px § 5.5's
  entry-link and count cases.
- **3f Sign-in.** No reader. The lead paragraph, the three proof
  points and the preview (§ 1.4, amended). **Unblocked:** the owner
  approved § 1.4's two changed phrases and its lead paragraph on
  2026-09-26 (§ 5.10, owner question 1).
  *Exit:* § 1.4's proofs: zero store and transport calls on the sign-in
  page; the preview's props equal Home's readers run over
  `signin-preview.json`'s files and messages; the preview's fixture text
  passes Stage 4's review; no capability the web app lacks; the preview
  is `inert` and captioned; at 375px the form comes before the preview
  in reading order.

**Stage 4: Copy and voice.** It starts with the architect writing the
Documents label table into § 5.3; the coder copies it word for word.
**Written 2026-09-28:** § 5.3.1 holds every string, the Documents
labels included, with its source line and the conflicts found.
The restore ruling's new strings are in it too: § 1.4's lead paragraph
and proof points, and § 5.1 and § 5.3's new labels and lines ("Ten ·
last reply", "<N> of your <M> min a day", "Active application",
"The most recently changed of N active applications", "Next, from you", the detail
section labels, the coverage-status table, "<path> isn't in your
workspace.", the two-notes-files line, "Sample data").
Every page line, label and empty state
written in § 5.3.1's table, word for word in the code.
*Exit:* an independent reviewer (not the author) checks every string
against rules 8 and 18 and § 2.7's rule (say what's true and what the
candidate can do, never what the agent will do); a test greps each
string from § 5.3.1 in the built bundle (§ 5.3.1's proofs).

**Follow-ups from the Stage 3a–3d reviews** (lead, 2026-09-29; not
built yet, each lands in the stage the lead names):

1. `verify:screens` runs its injected-script check from the conversation
   only. § 5.2 rule 8's proof needs it run from a page as well (a file
   opened from Documents), so a page's viewer can't lose the sandbox
   unseen.
2. At a frame width of 761–1100px, the closed viewer drawer (§ 5.6,
   "Breakpoint") shows a stray arrow in the header. A closed drawer
   shows nothing.

**Stage 5: Acceptance.** The owner's live run on their own account
(PROCESS step 6), reported back as numbers only: the counts § 5.10's
falsifiers need. Then the architect's closing review, and
`ARCHITECTURE.md` (its "Chat screen" box) and `apps/web/README.md`
brought up to date.

### 5.10 Assumptions, and what would prove them wrong

| # | Assumption | How we'd know it's wrong |
|---|---|---|
| A1 | Reading a page's files on every show is fast enough | a page taking over 1 s to show on the owner's live run |
| A2 | The port reads the real `jobs.md` fully | Jobs shows fewer roles than there are `### ` headings under stage sections in the owner's file (a count, reported as numbers only) |
| A3 | Markdown stays the right record at this size | `jobs.md` past a few hundred rows (goals doc, goal 3's named escape hatch) |
| A4 | Nobody needs to edit from a page | two independent asks to edit a file from a page (rule 17) |
| A5 | The pages carry the state, so the candidate stops asking for it | in two weeks of the owner's use, asks like "what's in my pipeline" or "what's on my list" still happen |
| A6 | Coach writes To do lines in C § 18.1's minutes form often enough for the pills and the sum to show. On the web, other skills write To do lines too, through the host note (`skills/profile/templates/web-host-note.md:5`), and are counted the same way | on the owner's live run, among plan versions written after the change lands, fewer than half the To do lines carry a pill (a count, numbers only), or, when the owner's `Budget:` line is per day (C § 18.1; a per-session budget never shows a sum, by design), the minutes sum shows on none of those plan versions. Then the chain fix below hasn't taken hold; the answer is coach's writing, never a looser parse |
| A7 | Evaluate writes the claim-tier form (`docs/design-page-forms.md` § 3) on company briefs often enough for the tags to show, and a written "verified" tag stays honest | on the owner's live run, among company briefs written after the change lands, fewer than half the bullets in `## Snapshot` and `## Culture & hiring signals` carry a tag, a missing or bullet-less section counting as untagged (a count, numbers only); or any `(verified: …)` tag whose source doesn't say what the line claims, or isn't the company's own pages or the posting (the owner's spot check, a count). The first is answered by evaluate's writing, never a looser parse; the second means the tag is doing harm, and the answer is showing the tier words as written again |

**Resolved (owner, 2026-09-26, in chat; relayed by the lead):**

- **Q1.** Direction C's round-1 sketch was dark-first, while the
  2026-09-24 ruling says the real app is always light. **Answer: light
  is the production default; dark is optional later.** The 2026-09-24
  ruling stands.
- **Q2.** Do the workspace stages come before or after the private-beta
  goal post (`plan-portable-skills-and-web-agent.md`, "Goal post - Beta
  on Vercel")? **Answer: before.**

**Resolved: the restore ruling's owner questions** (owner, 2026-09-26,
in chat: "the four workspace decisions … approved"; relayed by the
lead). The numbers are the ones this section's other paragraphs cite as
"owner question N".

1. **Two sign-in phrases changed** (§ 1.4): "Nothing spent without your
   yes" → "No big run without your yes", and "Ten never sends or
   submits as you" → "In this app, you send and submit, not Ten". The
   lead paragraph drops "finds". **Answer: approved.** Stage 3f is
   unblocked (§ 5.9).
2. **The coach minutes-form chain fix** (below, "Chain fixes"): coach's
   schema adopts `<action> — <n> min — <why>` for To do lines, checked
   at WARN. **Answer: approved.** Its design gate is
   `docs/design-page-forms.md` § 2. Until it lands, a live plan line may
   carry minutes in another form and show no pill: safe, but possibly
   sparse (A6).
3. **The stage steps use `jobs.md`'s words**, not the mockup's Found,
   Decided, Applying, Interview (§ 5.3, "The stage steps"). **Answer:
   approved: keep `jobs.md`'s words.** None of the mockup's four names
   is taken.
4. **Claim tiers on company facts.** Evaluate tiers every company claim
   (Verified / General knowledge / Unknown; evaluate
   `references/patterns.md:179-184`, `references/eval.md:35-37`), but its
   schema gave a tier no written form a page can read. **Answer:
   approved: adopt a written form** in evaluate's schema, and show tags
   through a strict reader like C § 18.1's, only where the form matches.
   Its design gate is `docs/design-page-forms.md` § 3. Until it lands,
   the Jobs detail shows the tier words as the brief wrote them (§ 5.3).
   **Follow-up ruling** (owner, 2026-09-26, in chat, on the gate's
   independent review, option (b)): a fourth ending, `(reported:
   <where>)`, for facts read anywhere other than the company's own site,
   careers page or blog, or the posting (news, Glassdoor or Blind,
   employee posts); the pages show it as its own tag, "Reported".
   `verified` stays strictly the company's own pages or the posting.

**Chain fixes** (found in review; separate from the stages, each
through its own review; skill changes go through PROCESS). Status as of
2026-09-26:

- apply's application-file name: `skills/apply/SKILL.md:16` says
  `<key>-application.md`, `skills/apply/references/schema.md` says
  `<key>.md`, and `fixtures/mvp-journey.json` uses the first.
  **Status: open.**
- The comments at `packages/agent/src/helpers.ts:154-155` and
  `tests/web/helpers.test.ts:110-111` (tester-owned: the tester edits
  it) repeat the false claim that `apps/workspace-ui`'s `parsePlan` maps
  from `parsePlanTodo` (corrected in C § 6.2). **Status: open.**
- **Coach's minutes form** (restore ruling; approved, owner question 2).
  Coach's schema says only
  "each with its why + minutes" (`skills/coach/references/schema.md`,
  To do), which names the minutes in no form a page can read. The one
  form C § 18.1 reads is `<action> — <n> min — <why>`. Coach's schema
  adopts that form for To do lines, with a check in `check_closeout` at
  WARN: the rule is born of a spec, not an incident, so it stays a WARN
  until an incident promotes it, as apply's table checks do (apply
  `references/schema.md`, "WARN until an incident promotes it"). This is a skill
  change and goes through `docs/PROCESS.md`'s ritual. It lands before
  Stage 5's acceptance run, so A6 measures the real writer.
  **Status: design gate revised after its first independent review
  (`docs/design-page-forms.md` § 2); waiting for the second; not
  built.**
- **Evaluate's claim-tier form** (restore ruling; approved, owner
  question 4). Evaluate's schema declares one written form per tier, at
  the end of each company claim's line: `(verified: <where>)`,
  `(reported: <where>)`, `(general knowledge)` or `(unknown)` (the
  fourth by the follow-up ruling under owner question 4). The Jobs
  detail shows a tag only where a line ends exactly so.
  `record_verdict.mjs` WARNs on the brief it is given, at WARN because
  the rule is born of a spec, and the checker and the page share one
  reader (`docs/design-page-forms.md` § 3). It lands before Stage 5's
  acceptance run, so A7 measures the real writer. **Status: design gate
  revised after its first independent review (FAIL, 3 blocking, all
  applied); waiting for the second; not built.**
