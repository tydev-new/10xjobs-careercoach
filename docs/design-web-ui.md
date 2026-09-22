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
  (reads the candidate's own key limit directly — C § 8, not the
  envelope), a `⋯` menu (export workspace, sign out, manage your usage
  key — C § 8's own user-facing term, never "OpenRouter key").
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
local-first stays a supported exit).

### 1.5 Empty / first-run state

Static UI copy, not a `UIMessage` sent to or from the model (nothing
has run, so `Coach.stream` produced nothing): avatar `idle`, one line
naming the $0 starting balance and the honest next step — no
manufactured welcome enthusiasm (rule 8):

```
◉ Ten · idle                                  $0.00  ⋯
Ten: I don't have anything of yours yet. Drop in a résumé,
     or tell me the job you're going for, and I'll start
     your workspace.
```

Side panel: "Nothing open yet."

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
`data-error over_balance` comes from the loop after OpenRouter
actually rejects a call mid-run (C § 8) — see `over-limit-error.json`.

### 2.6 `cost`

`props = { action, lowUsd, highUsd, balanceUsd }`, straight off
`estimate_cost`'s own return (C § 6.2, row 1) — no field the tool
didn't return, no widening or rounding by the UI. `ref` unset.
**Copy:** always the range, never a single number (rule 8). This card
is informational only — the one confirm for a spend is the gate
itself (§ 2.5); there's no second "say go" reply.

### 2.7 `data-error`

Rendered exactly as the envelope carries it — `{ code, message,
retryable }` (C § 6.1 names the five `code` values). `nextStep` copy
is a small UI-owned lookup keyed by `code` (e.g. `over_balance` → "Add
funds to keep going."), since the part carries no such field and the
codes are a closed set. The UI never computes a number into `message`
that the part didn't carry (e.g. "2 of 8 roles") — that belongs in the
model's own next plain-text turn.

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
  `data-error over_balance` after OpenRouter rejects a call mid-run.
- `checker-failure.json` — a `checker` card `FAIL`, then the agent
  fixing it on its own next turn (rule 3 — no candidate action
  needed); no `document` card exists until the fix renders cleanly.
- `empty-first-run.json` — the first-run state (§ 1.5): one static
  agent line, no cards.
