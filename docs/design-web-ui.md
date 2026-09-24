# The web UI — screens, cards, fixtures

Owner: De. Feeds step 5a (UI on a mock agent). Precedence:
`PRINCIPLES.md` → `docs/design-cowork-coaching-goals.md` →
`docs/design-cowork-coaching.md` → `docs/skill-shape.md`. Grok Bot is
inspiration only: few core objects, avatar motion as the single status
signal, structured cards over prose, a pinned side panel, a transcript
that shows what ran — but one coach, one conversation, no bot roster
(rule 12).

This doc owns the UI: screens, layout, and each card's rendering and
copy rules. It does **not** own the envelope, the gate protocol, the
transport, or any type — those are `docs/design-web-agent.md` ("C"),
and this doc references C's sections rather than copying their
contents (rule 12 — a copy drifts). Where C doesn't fully specify
something rule 7/8/11 needs, that's named as **open for the
architect** in place, not guessed at.

## 1. The one screen

Two panes: transcript (left) + pinned side panel (right), composer
pinned to the bottom of the transcript. No other screens in the MVP —
no settings page, no jobs table, no interview view (`apps/workspace-ui`'s
job, post-MVP only if dogfooding shows chat + cards isn't enough).

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
  beta data — § 1.7, sign out). There is no per-candidate key to
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
same shell.

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
identity-bearing or irreversible, and this one forfeits money and
erases records — so it renders in the same shape, the candidate's
typed `yes` standing in for a button the same way it does at a spend
gate (§ 2.5):

1. **The complete thing** — named, not summarized: "your workspace
   files, your conversation, your gate log, and your credit" (C § 8:
   `ten_ws_files` and the Storage bucket, `ten_conversations` (C § 11.7,
   amended 2026-09-24), `ten_gate_log`, the `credit` ledger rows; the
   `call` rows are kept).
2. **The one plain sentence** — C § 8's own wording, word for word:
   "This deletes your Ten beta data. Your sign-in stays because it's
   shared with the older app. Unused credit is forfeited. Your usage
   records, which show only amounts spent and no content, are kept."
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
composer. It blocks nothing, uses neutral styling (never error or alarm,
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
