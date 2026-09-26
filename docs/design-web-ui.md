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
│  ▸ ran evaluate · web search ×3                  │ ## Selected Experience   │
│                                                  │ - Led...                 │
│  ┌ Verdict ─────────────────────────────────┐   │                           │
│  │ Acme — Staff PM: Strong Fit (Track A)     │   │                           │
│  │ 8 years of B2B SaaS PM experience...      │   │                           │
│  │ [ See full analysis → ]                   │   │                           │
│  └────────────────────────────────────────────┘  │                           │
│                                                  │                           │
│  Ten: want me to tailor a résumé and letter?     │                           │
│  you: yes                                        │                           │
│                                                  │                           │
│  ▸ ran apply · check_materials · render_resume   │                           │
│  ┌ Résumé — 109 words · checker ✓ ──────────┐   │  [ Download PDF ]         │
│  └────────────────────────────────────────────┘  │  [ Export workspace ]    │
├────────────────────────────────────────────────┤                           │
│ [ + ]  Message Ten…            /skills   🔗link  │                           │
└────────────────────────────────────────────────┴───────────────────────────┘
```

- **Header:** avatar with its five states (§ 1.2), a balance chip
  (reads `deps.balance()` — C § 8, not the envelope; rounded **down**
  to the cent, and a balance at or below zero still reads `$0.00`,
  never a negative number), a `⋯` menu (export workspace, delete my
  beta data — § 1.7, set a new password — § 1.10, sign out). There is no per-candidate key to
  manage — one shared app key sits behind the model proxy (C § 8) — so
  "manage your usage key" is gone from the product, menu included.
- **Transcript:** prose interleaved with collapsed "ran …" lines
  (§ 3) and cards (§ 2), oldest first, autoscroll.
- **Composer:** attach, free text, `/` opens a skill picker (optional
  — plain language always works, rule 18), a pasted link is offered
  as "evaluate this?" rather than parsed silently.
- **Side panel:** shows whichever workspace file the last-opened card
  points at (its `ref`), with a download button when a `document`
  card's `htmlPath` is set. Empty: "Nothing open yet."

### 1.2 Phone wireframe (375px)

The side panel becomes a full-screen sheet, opened from a card's "Open
in panel" affordance, closed by a back arrow. Everything above must
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
`PRINCIPLES.md` rule 1 ("Help you get a job offer you actually want"),
and a link "Prefer local? Run it from your terminal" (rule 9 —
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

### 1.5 Empty / first-run state

Static UI copy, not a `UIMessage` sent to or from the model (nothing
has run, so `Coach.stream` produced nothing): avatar `idle`, one line
naming the honest next step — no manufactured welcome enthusiasm (rule
8). **Members start at $5** (C § 8, owner 2026-09-23: an admin-inserted
credit row of $5.00), so the chip reads `$5.00`, not `$0.00`:

```
◉ Ten · idle                                  $5.00  ⋯
Ten: I don't have anything of yours yet. Drop in a résumé,
     or tell me the job you're going for, and I'll start
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
   files, your conversation, and your gate log" (C § 8:
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

Receipt of the `jobs.md` row `record_verdict.py` wrote (C § 6.2, row
2) — not the prose summary card evaluate's `SKILL.md` still writes in
the reply; the two intentionally show the same tier twice, once from
the file and once from the model (C § 6.2, "S8"). `ref` = the row's
`jd_file`. **Side panel:** opens `ref`. **Copy:** the `verdict` enum
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

### 2.3 `document`

Receipt of a successfully rendered résumé only (C § 6.2, row 4) — **a
cover letter never gets a `document` card**, only a `checker` card,
because it isn't rendered. `props = { words, htmlPath?, checker }`,
`ref` = the `.md` path. **Side panel:** opens `ref`; `[Download PDF]`
appears when `htmlPath` is set and prints that sandboxed iframe (the
browser's own print-to-PDF — `render_resume`'s `--pdf` is ignored, and
page count in the browser print layout is **UNVERIFIED**, so no page
count is ever shown). **Copy:** `checker: "fail"` shouldn't coexist
with a rendered `document` card at all under C's own build rule (a
card only exists after `render_resume` actually ran, exit 0) — if it
does, that's an upstream bug, not a UI state to design copy for.

### 2.4 `checker`

Receipt of `check_materials.py`'s own stdout, **one card per checked
file** (C § 6.2, row 3) — a combined `--resume … --letter …` call
yields two cards. `props = { label, name, status, failCount, warnCount,
findings }`, parsed from the script's own `LABEL name: pass|FAIL (n
fail, m warn)` / `  [LEVEL] msg` lines, word for word — the same parse
feeds the `document` card's badge, one parse not two. `ref` = the
checked file. **Copy:** zero findings renders as "clean"; a `FAIL` is
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
that already says what to do, so it has no `nextStep` line. `over_balance`'s own message is now "Your beta credit
is used up. Ask the person who invited you for more." — there is no
"add funds" step in the beta (one shared app key, no per-candidate
spend), so the old `nextStep` lookup entry for it is gone; the message
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

## 3. The collapsed "ran …" line

Built by grouping consecutive `tool-<name>` parts in a message (AI
SDK's own states: `input-streaming` → `input-available` →
`output-available` | `output-error`, C § 6.1) — not a separate
envelope kind. Collapsed: `▸ ran evaluate · web search ×3` (repeats of
one tool collapse to a count). Expanded: one row per part, its literal
`input` and `output`/`errorText`, word for word (rule 11 — never a
restated description of what the model believes it did).

## 4. Fixture conversations

Location: `apps/web/fixtures/*.json`. Each file is `{ meta, files,
messages }`:

- `meta` — `{ persona, description }`, ignored by the mock transport.
- `files` — the seed workspace, `path → content`, as of the end of the
  conversation (the panel only needs current files). Every path a
  `data-card.ref` or an item `ref` points at, and every path a
  `read_file`/`write_file` part reads, must exist here.
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

### 5.1 The frame

- **The rail** holds the five places, in the order above, plus the
  brand mark. It shows only to a signed-in member after setup (C § 11.6).
  Sign-in, not-a-member (§ 1.6), recovery (§ 1.10) and the setup error
  screen have no rail.
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
   key § 5.3 names for that page (path, or newest change first), never
   by a judgment. *Prevents:* a page saying more than its file.
   *Proved by:* table tests that render each fixture page and compare
   its text with the reader's output, string for string.
4. **Fresh reads, no copy.** A page reads its files when it's shown and
   again when a turn ends while it's showing. Nothing is kept in
   `localStorage`, `sessionStorage` or IndexedDB. While a turn is
   running, the page shows one neutral line: "Ten is working. This page
   updates when it finishes." *Prevents:* a page disagreeing with the
   file (rule 12). *Proved by:* an e2e test where a mock turn rewrites
   `plan.md` while Home is showing: Home shows the new lines at turn
   end, with no reload; a grep finds no browser storage call in the
   page code.
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
   shows its lines as written under "Ten couldn't read these lines of
   <path>:" and a link that opens the file (`design-cowork-coaching.md`
   § 1, principle 8, "degrade loudly"). *Prevents:* "No roles yet" or
   "Nothing here right now" shown over a file that has them (rule 8).
   *Proved by:* a store whose `read` throws a non-missing error; a
   `plan.md` with a prose line before a section's first item.
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
   print button, § 2.3 and C § 6.1; binary files show "Binary file — no
   preview."). *Prevents:* a second renderer that forgets the sandbox.
   *Proved by:* `verify:screens`' injected-script check, run from a
   page as well as from the conversation.

### 5.3 The pages

Readers named here run in the browser on the same store. None needs a
store change. § 5.9 flags the stages that add or change a reader.

#### Home: the state of the search

**Shows**, top to bottom:

- **The goal.** The `Goal:` line and the `Budget:` line from the head
  of `plan.md`, each as written, when present.
- **Waiting on you**, then **To do**, from `plan.md § Board`: each
  line as written, in file order, each with a chip for its first
  backticked path (it opens the viewer). Waiting on you comes first
  because coach's schema makes it the attention index (open questions
  and gated decisions). If a section is absent, or has no items and no
  unreadable lines, it reads "Nothing here right now." The 2–4 count is coach's rule to hold
  when it writes the file; this page never enforces or checks it (as
  § 2.2).
- **The pipeline in numbers.** One count per active stage in the
  order `jobs.md` uses (To Review, Interested, Applied, Interviewing,
  Offer), then the dismissed count. A stage with no roles shows 0.
  These are the numbers promise 2 says change week to week. The page
  shows only today's numbers: no arrows, deltas, percentages or praise
  (rule 8). Each count opens Jobs at that stage.
- **Continue with Ten**, which opens Talk to Ten with no draft.

**Reads:** `plan.md` and `jobs.md`.
**Parsed by:** `readPlanBoard` (a new export of `packages/agent`, C
§ 18: the one reader behind both this page and `parsePlanTodo`; its
Waiting on you items are check_closeout's own `waitingRows`, reused), and
the `jobs_md` port's `load()` (`packages/checkers/src/jobs-md.mjs`, the
parity-tested port of `jobs_md.py`), through the read-only store
adapter described under Jobs. Counts are rows by stage, counted by code
(rule 14). The page never reads `jobs.md`'s own bold `Active:` line,
which would be a second source for one number.
**Empty** (the two files have no items and no unreadable lines between
them, which includes neither file existing): "Nothing here yet. Ten writes your plan and your
pipeline as you work together." and Continue with Ten.

#### Talk to Ten: the conversation

§ 1 unchanged: transcript, composer, side panel, every card, gate, error
and notice line (§ 1.8, § 1.9). The only change is that the header now
belongs to the frame (§ 5.1). The composer exists only here.

#### Jobs: the pipeline record

**Shows** every role in `jobs.md`, grouped by stage in the port's own
order (`STAGES`: To Review, Interested, Applied, Interviewing, Offer).
Each group heading has its count. Within a group, rows are in file
order: the script already sorts them, so the page never re-sorts. Then
a **Dismissed** group, closed by default, with its count.

Each row shows, as written: `Company — Title`; Verdict through § 2.1's
static label table (an unknown value is shown as written; no verdict
shows "Not evaluated yet"); Score as `load()` reads it (a whole number;
the scripts only write whole numbers, `record_verdict.py:37`); Track; Location; Reason word for
word, with § 2.1's quick-scan badge when it begins `quick-scan:`;
Dealbreakers, only on a row with a Verdict, reading "none" when absent
(§ 2.1); the date part of Seen and Updated; URL under § 5.2 rule 7.
A dismissed row adds its Dismissed note word for word and the stage it
was in (`Was`).

Row controls: **Open analysis** opens the row's `JD` file (`jd_file`)
in the viewer; with none, the row reads "No analysis file linked" (C
§ 6.2's own wording). **Ask Ten about this** (§ 5.4).

**Reads:** `jobs.md`.
**Parsed by:** `load(io, "")` from `packages/checkers/src/jobs-md.mjs`,
unchanged. The only new code is a read-only `io` adapter over the store
(`apps/web/src/workspace/store-io.ts`): `exists(p)` is true when
`read(p)` succeeds and false on `resource_missing` (any other error is
thrown, so § 5.2 rule 6 can show it); `readFile(p)` returns the text;
`writeFile` throws. *Not* reused: `apps/workspace-ui`'s `parseJobs`,
which invents a "next move", a due date and a warm/cool signal
(`apps/workspace-ui/server/workspace-core.mjs:37-68`), all against
rule 8.
**Empty** (no file, or no rows): "No roles yet. Paste a job link or a
posting's text into the conversation and Ten will evaluate it."

#### Applications: the materials per role

**Shows** one entry per role that has files in `applications/`. Each
entry has:

- **The role**: `Company — Title` from the linked `jobs.md` row, else
  the file key as written (for example `acme-staff-pm`).
- **Its stage** from that row, or "Dismissed" plus the note. With no
  linked row: "Not linked to a role in your pipeline." The page never
  guesses a link from a company name.
- **Its files**, each opening the viewer: the application notes, the
  résumé, the résumé ready to print (the `.html`, which the viewer
  prints to PDF, § 2.3), and the cover letter. A file that doesn't
  exist isn't listed; nothing is flagged as missing.

Entries are ordered newest change first, by the latest `updatedAt` among
the entry's files (`FileInfo`, C § 2). **Ask Ten about this** (§ 5.4).

**Reads:** `store.list("applications")`, and `jobs.md` through the same
`load()`.
**Parsed by:** a new pure function, `groupApplications(paths)`
(`apps/web/src/workspace/applications.ts`). It reads **file names
only**, never file contents. The key is the name with the first
matching suffix removed, tried in this order: `-resume.html`,
`-resume.pdf`, `-resume.md`, `-cover-letter.md`, `-application.md`,
`.md`. A name that matches none of them (a `.txt`, a `.docx`) is its
own entry, keyed by its full name, and reads "Not linked to a role in
your pipeline." Nothing is dropped. There are
two suffixes for the application notes because the chain disagrees
today: `skills/apply/references/schema.md` names the file `<key>.md`,
while `skills/apply/SKILL.md:16` and `fixtures/mvp-journey.json` use
`<key>-application.md` (reported to the lead to fix the chain; this
page reads either). The **link** to `jobs.md` is exact: the row whose
`JD` field is `jd-analysis/<key>.md`. Both file names come from the
same `company_key` + `title_key` (apply and evaluate schemas), so an
exact match is the only honest join.
**Empty:** "No applications yet. When you decide to apply for a role,
Ten drafts the materials and they show here."

#### Documents: every file

**Shows** every file `store.list()` returns (C § 2: recursive, depth ≤
3), except `leads.md`: search's schema says a lead is unvalidated and
"the candidate never sees one". The export still includes it (rule 9).
Files at the top level come first, under "Your records". Then one group
per top-level folder, labelled from a static UI table keyed by the
folder names `check_files.py` lists in `MANIFEST_DIRS` (`documents`:
"Your uploads", `applications`, `jd-analysis`, `jd-inbox`, `company`,
`contacts`, `prep`, `practice`, `stories`, `courses`, `negotiation`).
The words for each label are stage 4's: stage 4 starts with the
architect writing this table into this section, and the coder copies it
word for word. An unknown folder shows under its own name. After the
first turn "Your records" always holds the workspace `CLAUDE.md` (the
app writes it before the first agent turn, C § 2). That is intended: the
file is the candidate's (`design-cowork-coaching.md` § 7). The empty
state below is tested on a workspace with no turn yet. Within a group, files are sorted by path, each with the
date part of its `updatedAt`. A file opens in the viewer. **Ask Ten
about this** (§ 5.4).

**Reads:** `store.list()`; `read()` for the file being viewed.
**Parsed by:** nothing. It uses the list and a static label table.
**Empty** (the list is empty): "No files yet. Drop your résumé into the
conversation to start."

### 5.4 How the conversation and the pages link

- **Into the viewer.** A chip or card `ref` in the conversation opens
  the side panel, as today (§ 1.1). A file on any page opens the same
  viewer (§ 5.2 rule 8).
- **Continue with Ten** (Home) opens Talk to Ten, composer focused, no
  draft.
- **Ask Ten about this** (a Jobs row, an Applications entry, a Documents
  file) opens Talk to Ten and puts a draft in the composer: `About
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
- **Pages to pages.** A Home count opens Jobs at that stage. Nothing
  else links page to page in this step.

### 5.5 Phone (placeholder until the designer's pick)

The designer's round-2 direction picks how the rail works at 375px (a
bottom bar, a menu, or something else). Whatever it picks must hold
these, and the tester checks them at exactly 375px:

- every place is reachable from any page in at most two taps;
- the header (avatar, balance chip, `⋯`) shows on every page;
- no horizontal scroll; tap targets ≥ 44px (§ 1.2);
- the composer is never covered by the navigation, including with the
  keyboard up (`design-web-ui-refresh.md`, "Phone / keyboard-up");
- the viewer is a full-screen sheet with a back arrow (§ 1.2).

### 5.6 Visual spec: SLOT for the designer's chosen direction

> **Slot, not yet filled.** The designer is producing direction C
> (round 2) in `design/directions/2026-09-26-r2/` on another branch. On
> the owner's pick, this subsection gets: the token table (color, type,
> space, radius, elevation, motion), the fonts and their fallback
> stacks, the one icon set and its license, the brand mark, the rail's
> look and its item states (rest, hover, current, focus-visible, the
> needs-you marker), the page layouts (list plus viewer), the empty-
> state look, the phone navigation pattern (§ 5.5), and each
> component's states (rest, hover, focus-visible, disabled, loading,
> error).

Whatever fills the slot must already agree with the chain, or it goes
back to the owner:

- **Light only.** The 2026-09-24 ruling at the top of this doc stands;
  the owner confirmed on 2026-09-26 that light is the production
  default and dark is optional later (§ 5.10, Q1). Dark tokens may exist
  dormant, as today.
- One accent. Amber is only for `needs-you` (§ 1.3). No alert-styled
  count badges (`design-references.md`, Huntr and Teal; rule 8).
- A rail summary line, if the design keeps one, uses words the files
  support. Round 1's "3 things queued this week" says more than
  `plan.md` does, since To do items carry no week. Say "3 to-dos".
- Tokens are CSS custom properties in `apps/web/src/styles.css`. No UI
  framework or CSS build step is added; the round-1 README recommends
  the same, and rule 18 makes deletion the default.

### 5.7 Fixtures for the pages

One new fixture, `apps/web/fixtures/workspace-pages.json`, under § 4's
rules (invented persona; every script-written file produced by running
the real scripts in a `mktemp -d` workspace, never `~/job-search`). Its
`files` must include: a `jobs.md` with at least one role in each of the
five stages plus a dismissed role, one row without a `JD` field, and one
quick-scan row; a `plan.md` with Goal, Budget, and lines under both
Waiting on you and To do; an `applications/` folder with one role using
`<key>.md` and one using `<key>-application.md`, one with a rendered
`.html`, and one whose key matches no `jobs.md` row; an upload under
`documents/`; and a `leads.md`, to prove Documents hides it. The unsafe-
URL and unreadable-section cases are unit-test inputs, not fixture
files, so no fixture holds a hand-edited script-written file.
`empty-first-run.json` proves every empty state.

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
marker, and each new page showing only its empty state.
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
- **3b Jobs. READER (reuse):** the `jobs_md` port unchanged, plus the
  small read-only `store-io.ts` adapter. It also deletes the stub
  `packages/agent/src/jobs-md.ts` (its own comment says it waits for the
  port): `cards.ts:6` moves to the port, the public re-export of
  `parseJobsMdRows` and `findJobsMdRow` at `packages/agent/src/index.ts:19`
  is removed, and the verdict card's builder tests pass unchanged. Each
  `.mjs` import from `packages/checkers` carries
  `// @ts-expect-error - plain .mjs, no type declarations` (the posture of
  `apps/web/src/backend/script-runner.ts:17-19`). The tester updates
  `mutantCopy` (`tests/agent/browser-safety.test.ts:128-135`) so the copy
  sits at `<tmp>/packages/agent` beside a copy of
  `<tmp>/packages/checkers/src`: a named, allowed change to a tester-owned
  test, with no assertion changed. *Exit:* every `### ` role under
  a stage heading in the fixture's `jobs.md` shows once, in its stage,
  in file order, with fields word for word; Dismissed closed with its
  count; § 5.2 rule 7's URL table. *Tester checks:* compare the page
  with `load()` over the fixture, field by field; the adapter's
  `exists` on a missing read and on a failing read.
- **3c Home. READER (change):** `readPlanBoard` in `packages/agent`
  (C § 18), with `parsePlanTodo` re-expressed through it. **Waits for**
  check_closeout's section-end fix (C § 18, "Waits for a script fix"),
  built separately. *Exit:*
  the four existing tables C § 18 names pass **unchanged** (a failing
  old case goes back to the architect; it is never edited to pass); C
  § 18's `waitingRows` parity test and its new table; Home's
  counts equal `load()`'s rows by stage; § 5.2 rules 4, 5 and 6.
- **3d Applications. READER (new):** `groupApplications` and the exact
  `JD` join. *Exit:* a table test over both name forms, the `.html`,
  an unknown suffix and an unmatched key; the page's roles, stages and
  "Not linked" line match the fixture.

**Stage 4: Copy and voice.** It starts with the architect writing the
Documents label table into § 5.3; the coder copies it word for word.
Every page line, label and empty state
written here and in § 5.3's label table, word for word in the code.
*Exit:* an independent reviewer (not the author) checks every string
against rules 8 and 18 and § 2.7's rule (say what's true and what the
candidate can do, never what the agent will do); a test greps each
string from this section in the built bundle.

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

**Resolved (owner, 2026-09-26, in chat; relayed by the lead):**

- **Q1.** Direction C's round-1 sketch was dark-first, while the
  2026-09-24 ruling says the real app is always light. **Answer: light
  is the production default; dark is optional later.** The 2026-09-24
  ruling stands.
- **Q2.** Do the workspace stages come before or after the private-beta
  goal post (`plan-portable-skills-and-web-agent.md`, "Goal post - Beta
  on Vercel")? **Answer: before.**

**Chain fixes for the coder** (found in review; separate from the
stages, each through its own review):

- apply's application-file name: `skills/apply/SKILL.md:16` says
  `<key>-application.md`, `skills/apply/references/schema.md` says
  `<key>.md`, and `fixtures/mvp-journey.json` uses the first.
- The comments at `packages/agent/src/helpers.ts:154-155` and
  `tests/web/helpers.test.ts:110-111` (tester-owned: the tester edits
  it) repeat the false claim that `apps/workspace-ui`'s `parsePlan` maps
  from `parsePlanTodo` (corrected in C § 6.2).
- check_closeout's section-end fix (C § 18), which stage 3c waits for.
