# The web UI — screens, cards, fixtures

Owner: De. Feeds step 5a (UI on a mock agent). Precedence:
`PRINCIPLES.md` → `docs/design-cowork-coaching-goals.md` →
`docs/design-cowork-coaching.md` → `docs/skill-shape.md`. Grok Bot is
inspiration only (plan § "The UI"): few core objects, avatar motion as
the single status signal, structured cards over prose, a pinned side
panel, a transcript that shows what ran. We take those; we do **not**
take a bot roster — one coach, one conversation (rule 12).

This doc owns the UI and the card catalog (props). It does **not** own
the stream envelope, the gate protocol, or the transport — those are
`docs/design-web-agent.md` (Ar), specifically **§ 6 Chat transport**
and **§ 3 Gate protocol**. Every part shape below is the contract's,
verbatim; this doc only fills in `CardType` props (which § 6 explicitly
assigns to this file) and the screens that render them.

**Revision note:** this version aligns to `design-web-agent.md` now
that it exists. Changed from the first draft: part names and shapes
now match the AI SDK UI message parts (`text`, `tool-<name>`,
`data-card`, `data-gate`, `data-error`) instead of an invented
`tool-activity`/`card`/`gate`/`error` envelope; there is no `status`
part — the five avatar states are derived by `statusOf` (§ 6); the
gate card carries the contract's `GateRequest` shape, not a bespoke
one; the error card carries exactly `{ code, message, retryable }`.
Fixtures are now arrays of `UIMessage`-shaped objects.

**Revision history, folded together now that everything is settled:**
this doc went through review (`docs/reviews/step1-review.md`) and three
follow-up passes as `design-web-agent.md` itself was still being
written. In order: (1) fixtures moved from invented tool-output strings
to real stdout captured by running the actual scripts (B8), invented
numbers were removed (B9), the `plan` card moved to 2–4 items per
`PRINCIPLES.md` rule 6, the web MVP was settled to have no send/submit
gate (only spend, with send/submit as `plan` to-dos), and every card
gained a "**Built from:**" line (B1); (2) once `gate-grammar.md` got
its spend line and `design-web-agent.md` § 3 named the gate mechanism
(`request_gate`, `data-gate`, the separate `data-gate-status` part) and
§ 4 named `estimate_cost`'s real shape, § 2.5 and § 2.6 were rewritten
to match, word for word; (3) **this pass** brings the rest of § 2 —
`verdict`, `plan`, `document`, `checker` — into the same alignment,
field for field, against § 6.2's card-build table, which is the
authoritative source for every card's props from here on. Where the
table doesn't fully specify something rule 7/8/11 needs, it's called
out as **still open for the architect** in that card's own subsection,
not guessed at.

## 1. The one screen

Two panes: transcript (left, primary) + pinned side panel (right).
Composer pinned to the bottom of the transcript pane. No other screens
in the MVP — no settings page, no jobs table, no interview view (those
are `apps/workspace-ui`'s job, post-MVP, only if dogfooding shows chat
+ cards isn't enough).

### 1.1 Desktop wireframe

```
┌────────────────────────────────────────────────┬───────────────────────────┐
│ ◉ Ten · working              $4.20  ⋯          │ résumé — Acme, Staff PM   │
├────────────────────────────────────────────────┤ ─────────────────────────│
│                                                  │ # Jordan Alvarez         │
│  you: here's the Acme posting                    │ ## Summary               │
│       https://acme.example.com/careers/1234      │ 8 years of product...    │
│                                                  │                           │
│  ▸ ran evaluate · read jobs.md · web search ×3   │ ## Selected Experience   │
│                                                  │ - Led...                 │
│  ┌ Verdict ─────────────────────────────────┐   │                           │
│  │ Acme — Staff PM: Strong Fit (Track A)     │   │                           │
│  │ 3 reasons why · 1 flag                    │   │                           │
│  │ [ See full analysis → ]                   │   │                           │
│  └────────────────────────────────────────────┘  │                           │
│                                                  │                           │
│  Ten: want me to tailor a résumé and letter?     │                           │
│                                                  │                           │
│  you: yes                                        │                           │
│                                                  │                           │
│  ▸ ran apply · 2 self-passes · checker           │                           │
│                                                  │                           │
│  ┌ Document: Acme résumé ──────────────────┐    │                           │
│  │ checker ✓ clean · 2 pages · 640 words     │   │  [ Download PDF ]         │
│  │ [ Open in panel → ]                       │   │  [ Export workspace ]    │
│  └────────────────────────────────────────────┘  │                           │
│                                                  │                           │
│  ┌ Needs your word ─────────────────────────┐   │                           │
│  │ cover letter, final draft (shown in full) │   │                           │
│  │ ⚠ This sends as YOU. I never send — copy  │   │                           │
│  │ it, send it yourself, then tell me so I   │   │                           │
│  │ log it.                                    │   │                           │
│  │ (type "yes" in the composer — no button)   │   │                           │
│  └────────────────────────────────────────────┘  │                           │
├────────────────────────────────────────────────┤                           │
│ [ + ]  Message Ten…            /skills   🔗link  │                           │
└────────────────────────────────────────────────┴───────────────────────────┘
```

- **Header** — avatar (left) with the five states below; `Ten ·
  <state>` label beside it; balance chip; `⋯` menu (Export workspace,
  Sign out, OpenRouter key).
- **Transcript** — user turns right-ish/plain, agent turns plain prose
  interleaved with collapsed "ran …" lines and cards, top to bottom,
  oldest first, autoscroll to newest.
- **Composer** — attach (`+`), free text, `/` opens a skill picker
  (optional — plain language always works per rule 18), a link paste
  is detected and offered as "evaluate this?" rather than parsed
  silently.
- **Side panel** — shows whichever workspace file the last-opened card
  points at; a download button when the file has a rendered form
  (résumé/letter PDF); an export-workspace shortcut always available.
  Empty state (nothing opened yet): "Nothing open yet — cards will
  show their file here."

### 1.2 Phone wireframe (375px)

Side panel becomes a full-screen sheet, triggered by tapping a card's
"Open in panel" affordance; a back arrow returns to the transcript. No
independent navigation — the sheet always answers "what did the last
opened card point at."

```
┌─────────────────────────────┐   ┌─────────────────────────────┐
│ ◉ Ten·working   $4.20   ⋯   │   │ ← résumé — Acme, Staff PM    │
├─────────────────────────────┤   ├─────────────────────────────┤
│ you: here's the Acme         │   │ # Jordan Alvarez             │
│ posting (URL)                │   │ ## Summary                   │
│                               │   │ 8 years of product...        │
│ ▸ ran evaluate · web search  │   │                               │
│                               │   │ ## Selected Experience       │
│ ┌ Verdict ──────────────┐    │   │ - Led...                     │
│ │ Acme — Staff PM        │   │   │                               │
│ │ Strong Fit (Track A)   │   │   │                               │
│ │ [ See full analysis →]│    │   │                               │
│ └─────────────────────────┘  │   │                               │
│                               │   │                               │
│ ┌ Document: résumé ──────┐   │   │                               │
│ │ checker ✓ clean         │  │   │                               │
│ │ [ Open →]               │  │   │                               │
│ └─────────────────────────┘  │   ├─────────────────────────────┤
├─────────────────────────────┤   │ [ Download PDF ]              │
│ [+] Message Ten… /  🔗       │   └─────────────────────────────┘
└─────────────────────────────┘
```

Everything above must render and be usable at exactly 375px — no
horizontal scroll, tap targets ≥ 44px.

### 1.3 Avatar states — derived, never sent

There is **no status part in the envelope** (`design-web-agent.md`
§ 6: "Status is derived, not sent" — a separate status part would be a
second copy of what the stream already says, and the two could
disagree, rule 12). The header reads the exported pure function:

```ts
statusOf(messages: UIMessage[], chatStatus: "submitted" | "streaming" | "ready" | "error")
  : { state: "idle" | "thinking" | "working" | "needs-you" | "done"; action?: string }
```

| State | `statusOf` rule (§ 6, verbatim) | Motion | Hover text |
|---|---|---|---|
| `idle` | nothing has run yet this session | still, soft glow | "Waiting for you" |
| `thinking` | `chatStatus === "submitted"`, or `"streaming"` and the latest part is `text` | slow pulse | "Thinking…" |
| `working` | `"streaming"` and the latest part is a `tool-<name>` part not yet `output-available`/`output-error` | faster pulse / spinner ring | `result.action` — see the hover-label table below |
| `needs-you` | `"ready"` and any `gateId`'s **latest `data-gate-status` part in the chat** has `status: "pending"` — not only a gate in the latest message (round-3 fix: `design-web-agent.md` § 3 moved gate status out of `data-gate` entirely; the chat's status parts are the one owner, so `statusOf` scans all of them, not just the last message) | amber ring, gentle attention pulse (never blinking/urgent-red — rule 8, no manufactured urgency) | "Needs your yes — <gate label>" |
| `done` | `"ready"` or `"error"` after a turn this session, with no open gate | ring fades to still | "Done — ready when you are" |

- **Hover-label source.** `statusOf`'s `action` is "that tool's
  one-line label" (§ 6), but the contract doesn't say where that label
  text comes from — reading § 4's MVP tool table, it's clearly UI
  copy, not stream data (the tools return structured results, not
  prose labels). This design owns that mapping, since it's exactly the
  kind of UI-only copy this doc is responsible for:

  | tool | hover label |
  |---|---|
  | `load_skill` | "Loading <name>…" |
  | `read_file` | "Reading <path>…" |
  | `write_file` | "Writing <path>…" |
  | `list_files` | "Looking at your workspace…" |
  | `bash` | "Running <script name>…" (parsed from the `command` input) |
  | `web_search` | "Searching: <query>…" |
  | `fetch_job` | "Reading the posting…" |
  | `estimate_cost` | "Estimating the cost…" |

  If a tool call's `input` isn't available yet (`state:
  "input-streaming"`), the label drops the specific value ("Reading a
  file…") until `input-available`.
- **`needs-you`'s hover text** — resolved in round 3: `GateRequest.label`
  (§ 3, "6 words or fewer… used for the card title and the avatar's
  hover text" — the contract now says so directly) is the pending
  gate's short title. The round-2 open question here is closed; no
  more deriving a title from a path.

### 1.4 Sign-in

One screen, minimal: email/password or magic link (auth mechanism is
the architect/coder's call — this screen doesn't presume one), a
one-line product statement under the logo pulled from PRINCIPLES.md
rule 1 ("Help you get a job offer you actually want"), and a link to
"Prefer local? Run it from your terminal" (rule 9 — local-first stays
supported, never hide the exit).

```
┌───────────────────────────────┐
│            ◉ Ten               │
│  Help you get a job offer you  │
│  actually want.                │
│                                 │
│  [ Email                    ]  │
│  [ Password                 ]  │
│  [        Sign in        ]     │
│  or [ Send me a magic link ]   │
│                                 │
│  Prefer local? Run it from     │
│  your terminal →               │
└───────────────────────────────┘
```

### 1.5 Empty / first-run state

After sign-in, before any workspace file exists: the avatar is `idle`
(no turn has run yet this session), transcript shows one agent
message, one `text` part — no fake welcome copy, no manufactured
enthusiasm (rule 8) — just the honest next step:

```
◉ Ten · idle                                  $0.00  ⋯
────────────────────────────────────────────────────────
Ten: I don't have anything of yours yet. Drop in a résumé,
     or tell me the job you're going for, and I'll start
     your workspace.

[ + ]  Message Ten…            /skills   🔗link
```

The side panel is empty ("Nothing open yet"). No card renders here —
first-run is plain prose per coach's own reply types (a STATUS reply,
honestly stated).

## 2. The card catalog

Every card is a `data-card` message part exactly as
`design-web-agent.md` § 6 defines the wrapper:

```ts
// the UIMessageChunk / message part itself
{ type: "data-card"; id?: string; data: { card: CardType; props: object; ref?: string } }

type CardType = "verdict" | "plan" | "document" | "checker" | "cost";
```

`design-web-agent.md` names `CardType` and the wrapper; **this doc
owns every `props` type below** (confirmed by § 6: "Each card's props
are defined in `docs/design-web-ui.md`; this doc [the agent contract]
owns only the wrapper"). `ref`, when present, is a workspace path the
side panel opens on tap — set per card below.

No card ever self-fires an action (rule 7) — the only part with a
confirm affordance is `data-gate` (§ 2.5), and that's a typed-`yes`
chat message, never a button (§ 3 of the agent contract, rule 2: only
a message that is exactly "yes" approves).

### 2.1 `verdict`

**Purpose:** the receipt of what `record_verdict.py` wrote to
`jobs.md` (rule 11 — a card is a receipt of a file or a script's
output, never the model's own reasoning). It is **not** the prose
summary card evaluate's `SKILL.md` still writes in the reply — the two
show the same tier on purpose: one is what the model says, the other
is what the file says (§ 6.2: "Verdict card vs the summary card
(S8)"). The full analysis file is the side-panel view.

```ts
// field for field, design-web-agent.md § 6.2's build table:
// "the jobs.md row … company, title, verdict tier, score, track,
// reason (fit_reason word for word), dealbreakers (word for word)"
type VerdictCardProps = {
  company: string;
  title: string;
  verdict: "strong" | "investable_stretch" | "long_shot" | "weak"; // record_verdict's own enum, straight from the row
  score?: number;          // omitted if the row has none
  track?: "A" | "B" | "C"; // omitted if criteria.md defines no tracks
  reason: string;          // jobs.md's Reason field, word for word — no paraphrase
  dealbreakers?: string;   // jobs.md's Dealbreakers field, word for word, if present
};
```

- **`data-card.ref`** = the row's `jd_file` (§ 6.2). **Side panel:**
  tapping the card opens that file.
- **Copy rules:** `verdict`'s four enum values map to a display label
  by a static UI table (`strong` → "Strong Fit", `investable_stretch`
  → "Investable Stretch", `long_shot` → "Long-Shot Stretch", `weak` →
  "Weak Fit" — `eval.md`'s own four tier names), never a fifth
  invented label. No `dealbreakers` → the section reads "none", never
  omitted (rule 8 — an empty section silently dropped reads as "we
  forgot to check"). **Quick-scan labeling (rule 8, eval.md):** the
  table gives this card no separate quick-scan field — `reason` is
  stored with a `quick-scan:` prefix when it applies (`eval.md`: "The
  cheap tier is stamped `quick-scan:` … in the row's reason"), so the
  UI shows a quick-scan badge when `reason` starts with that literal
  prefix, read off the same word-for-word field rather than a second
  prop the table doesn't have. This satisfies eval.md's "always
  visibly labeled" requirement without diverging from the table.
- **Dropped from round 2, per the table's own "Consequences" list:**
  `whyReasons`/`verifyWithRecruiter` (no source — `reason` is the one
  sourced field), `quickScan` as a boolean prop (see above),
  `companyAnalysisRef` (the table gives one `ref`, not two — a second
  panel view onto `company/<slug>.md` isn't a rule 7/8/11 requirement,
  so this doesn't get flagged as open, just dropped), `role` renamed
  to `title` (jobs.md's own field name).
- **Built from:** every field is the `jobs.md` row `record_verdict.py`
  wrote, read back through the `jobs_md` port (§ 6.2) — not the
  script's own stdout line, and not the model's reply text. No open
  items for this card.

### 2.2 `plan`

**Purpose:** the coach's "To do" (`plan.md § Board`), 2–4
candidate-only items, ranked, each already prepared. **`PRINCIPLES.md`
rule 6, not coach `SKILL.md`'s "at most 3"** — rule 6 says "two to four
things waiting on you", and the precedence chain (this doc's own
header) puts `PRINCIPLES.md` above every skill file, so 2–4 is the
binding range (owner decision).

```ts
type PlanItem = {
  title: string;
  why: string;
  minutes: number;
  filePath?: string;
};

type PlanCardProps = {
  items: PlanItem[];  // 2..4 (PRINCIPLES rule 6) — fewer than 2 is a plain text reply, not a card
  stage: "groundwork" | "searching" | "applying" | "interviewing" | "deciding";
};
```

- **`data-card.ref`** = `plan.md` (§ 6.2 — round-2 draft had no `ref`
  at all; the table gives one). **Side panel:** the card's default tap
  opens `plan.md` itself; an item with its own `filePath` opens that
  file instead (a per-item override the UI resolves, not the stream).
- **Copy rules:** exactly the ranked order from `plan.md`; never
  reorder for emphasis. `why` is one sentence, no bullet sub-lists
  (rule 18). Hard deadlines (an interview <48h, an expiring offer)
  must be item 1 if present, per coach's own prescribe rule. `why`
  states only what `plan.md`'s own text supports — never an
  unsupported claim (rule 8).
- **Built from:** `plan.md § Board → To do`, via `parsePlan` (§ 6.2:
  "the existing `parsePlan` in `workspace-core.mjs`, moved to a shared
  module"); `stage` from the `check_closeout` `bash` call's `--stage`
  argument.
- **Still open for the architect:** § 6.2 names `parsePlan` as the
  source but doesn't publish its return shape. `title`/`why`/`minutes`/
  `filePath` above are what rule 6 needs to render the card honestly
  (a candidate-only action, its reason, its time, and what it's
  prepared in) — coach's own schema already requires a `plan.md`
  bullet to carry a why and minutes in its text (`schema.md`: "each
  fully prepared, each with its why + minutes"), so `parsePlan` almost
  certainly already extracts something equivalent. This is flagged
  rather than assumed: confirm `parsePlan`'s actual field names against
  this `PlanItem` shape (or reconcile the naming) before step 4 wires
  it up.

### 2.3 `document`

**Purpose:** the receipt of a successfully rendered résumé (rule 11).
**Only `render_resume.py` produces a `document` card — a cover letter
never gets one, only a `checker` card, because it is not rendered**
(§ 6.2, stated directly: "A cover letter gets a `checker` card … but
no `document` card, because it is not rendered").

```ts
type CheckerBadge = "clean" | "warn" | "fail" | "not-run";

// field for field, § 6.2: "the path from the --md argument; words from
// the `words: N -> path` line; htmlPath from that path when it is
// inside the workspace; badge = this chat's latest checker result for
// the same .md (not-run if none)"
type DocumentCardProps = {
  words: number;
  htmlPath?: string;   // set once render_resume has written it; unset otherwise
  checker: CheckerBadge;
};
```

- **`data-card.ref`** = the `.md` path from `render_resume.py`'s
  `--md` argument. **Side panel:** opens that file rendered as the
  workspace file; when `htmlPath` is set, `[Download PDF]` prints the
  sandboxed `htmlPath` iframe (the browser's own print-to-PDF) —
  **there is no `pdfPath`**, and no page-count claim (`--pdf` is
  ignored by the port; page count in the browser print layout is
  **UNVERIFIED**, per the contract's checkers-to-port section).
- **Dropped from round 2, per the table:** `title` (the UI derives a
  display title from the `ref` filename — not a rule 7/8/11 need, so
  not flagged open, just UI copy), `kind` (same — resume vs. cover
  letter is now moot anyway, since a letter never gets this card),
  `filePath` (the table says explicitly: read the wrapper's `ref`),
  `checkerSummary` (no source — `checker`'s badge plus the paired
  `checker` card's own findings carry that information without a
  second, possibly-drifted summary string).
- **Copy rules:** `checker: "fail"` must never coexist with a
  `[Download PDF]` affordance as the primary call-to-action — but per
  the table's badge rule this case shouldn't arise for a `document`
  card at all: the badge is "this chat's latest checker result for the
  same `.md`," and the agent's own workflow only renders a résumé
  after its checker result is clean (a `document` card only exists
  once `render_resume.py` has actually run, exit 0). A `fail`/`warn`
  badge showing on an existing `document` card means the file changed
  and was re-rendered without a fresh checker pass — treat that as a
  bug to fix upstream, not a UI state to design pretty copy for.
- **Built from:** exactly § 6.2's row — `render_resume.py`'s `bash`
  call, exit 0, for `words`/`htmlPath`; `checker` from the latest
  `checker` card this chat produced for the same `.md` path (code
  cross-references by path, not re-parsed from this call). No open
  items for this card.

### 2.4 `checker`

**Purpose:** the receipt of `check_materials.py`'s (or
`check_files.py`'s) own output — one card **per checked file** (§ 6.2:
"one per checked file"), so a single `check_materials.py --resume …
--letter …` call that checks two files produces two `checker` cards,
not one.

```ts
type CheckerFinding = {
  level: "FAIL" | "WARN";
  message: string;   // the script's own message, verbatim
};

// field for field, § 6.2: "stdout parsed by the script's own format:
// `LABEL name: pass|FAIL (n fail, m warn)`, then `  [LEVEL] msg` lines,
// word for word"
type CheckerCardProps = {
  label: "RESUME" | "LETTER";
  name: string;             // the checked file's basename, from the LABEL line
  status: "pass" | "FAIL";  // word for word from stdout — not re-cased or renamed
  failCount: number;
  warnCount: number;
  findings: CheckerFinding[]; // empty when failCount + warnCount is 0
};
```

- **`data-card.ref`** = the checked file (the full workspace path for
  `name`, resolved from the `bash` call's own `--resume`/`--letter`
  argument that matches this `name`).
- **Copy rules:** `findings` are never rewritten or summarized —
  verbatim script output, one line each. `status: "pass"` with
  `failCount + warnCount === 0` renders as one line: "clean" (every
  skill's own session-close convention). WARNs render but never block;
  a `FAIL` is styled distinctly (not red-urgent, just visually
  separate) since it means the agent's own next turn must fix it
  before delivery, not that the candidate must act.
- **Built from:** `check_materials.py`'s (or `check_files.py`'s) own
  `bash` call `stdout`, parsed by its fixed format — the same parse
  that feeds the `document` card's `checker` badge (§ 2.3), so both
  read one parse, not two. No open items for this card.

### 2.5 `gate` — the `data-gate` part, not a card type

**Round-3 rewrite:** the architect's contract revision moved the gate
mechanism substantially from round 2 — this section now follows
`design-web-agent.md` § 3 exactly rather than flagging it as open.

The gate is its own top-level part, not one of the five `CardType`
values. There is **one gated kind in the web MVP: `spend`**
(`design-web-agent.md` § 3: "PENDING OWNER, decision 1" — but settled
for the MVP either way, since the package has no send/submit tool at
all). A send or submit is a `plan` card to-do the candidate does
themselves (§ 2.2), never a `data-gate`.

**Opening a gate is one tool call, and code does the rest** (§ 3):

```ts
// the model calls this — it supplies only the label and what's being paid for
request_gate({ kind: "spend", amountUsd: number, label: string, text: string })
// → { gateId: string }, and the turn ends

// from design-web-agent.md § 3, reused verbatim — this is what request_gate
// actually writes and what the data-gate part carries. No status field.
interface GateRequest {
  gateId: string;
  kind: "spend";
  label: string;     // ≤ 6 words, from the model — the card title AND the avatar's hover text
  text: string;       // the complete thing being paid for; code appends one cost line from estimate_cost
  textHash: string;   // sha256 of the exact text shown
  gateLine: string;   // copied word for word from gate-grammar.md's spend line, by code, amount filled in
  amountUsd: number;
}

// the data-gate part itself — carries no status
type DataGatePart = { type: "data-gate"; id?: string; data: GateRequest };

// status is a SEPARATE part, written only after the gate_log row itself changes
type DataGateStatusPart = { type: "data-gate-status"; id?: string;
  data: { gateId: string; status: "pending" | "approved" | "declined" | "expired" } };
```

- **The model never writes `gateLine`, `textHash`, or the cost
  line inside `text`.** It supplies only `amountUsd`, `label` (≤ 6
  words), and the plain-language description of what the run does;
  code reads the gate line from the bundled `gate-grammar.md` word for
  word, appends the `estimate_cost` cost line, and computes the hash
  (§ 3, steps 2–4). This is B1's fix applied: a gate line the model
  could mistype or improvise would break rule 7's "exact wording."
- **Rendering `text`.** It's the complete thing gate-grammar.md rule 1
  requires — what the run will do, plus the code-appended cost line —
  shown in full, inline, never truncated (there's no `ref`/file
  variant anymore; a spend gate is never a file review).
- **The gate line.** `gateLine` is `gate-grammar.md:12`'s spend
  sentence, verbatim, with only `$<amount>` filled in:
  `"This spends $<amount> — confirm before I commit it."` The UI
  renders it exactly as received — it never composes, reformats, or
  paraphrases it, and never re-derives the amount itself (the amount
  in the sentence and `amountUsd` must be the same code-filled value).
- **No confirm-instruction prop.** Same as round 2: identical text on
  every gate is static UI chrome, not a per-gate field.
- **No button, ever.** The composer is the only place a gate closes:
  the candidate types `yes`, and `matchGateReply(text, origin)` — a
  pure function in `packages/agent` — decides approval before the
  model ever sees the reply (§ 3: trimmed, lowercased, at most one
  trailing `.`/`!`, exactly `yes`, **and** `origin === "typed"`). The
  UI never interprets the text itself and must set `metadata: {origin:
  "typed"}` on every message the candidate actually typed and sent, vs.
  `"ui"` for anything the UI built (a chip, an un-edited prefill) —
  only `"typed"` can ever approve.
- **Status lives in `gate_log`, not in the message.** `setGateStatus`
  writes the row, then emits one `data-gate-status` part — on open
  (`pending`), and again whenever the next message approves, declines,
  or leaves the gate open (still `pending`, re-emitted so the stream
  stays a live view of the row). The UI shows each `gateId` by its
  **latest** `data-gate-status` part in the whole chat, not just the
  latest message (this is what § 1.3's `needs-you` derivation reads).
  A `data-gate` part itself never changes once emitted — only a later
  `data-gate-status` part updates what the UI shows for that `gateId`.
- **One gate per confirm.** § 3 rule 1: at most one gate is open per
  chat; a new `request_gate` call expires whichever one was open. The
  UI doesn't need to prevent two open gates — it renders whatever the
  latest status per `gateId` says — but a gate showing `expired` should
  read visibly different from `pending`.
- **Copy rules:** after the candidate's `yes`, the model's next reply
  is plain text (the gate-grammar report-back), not another card or
  gate part.
- **Built from:** the `request_gate` tool's own structured output —
  `gateId` is that call's return value; `label`/`amountUsd` are the
  model's own tool-call arguments (the ONE place the model contributes
  gate content, and both are short/structured enough not to risk rule
  7's exact wording); `text`/`textHash`/`gateLine` are code-built per
  § 3 steps 2–4, never composed by the model in prose. No open items
  for this part.

### 2.6 `cost`

**Round-3 rewrite:** `estimate_cost`'s actual return shape replaces
the round-2 placeholder (`usd` widened to a range "by code, method
open" — the method is no longer open, and there's no widening step).

**Purpose:** rule 5 — tell the candidate the rough cost before any big
run (a batch evaluation, a full application batch, a long research
pass), and back every `spend` gate's amount. Backed by the
`estimate_cost` tool (§ 4 of the contract):
`{ steps, webSearches, action } → { lowUsd, highUsd, balanceUsd, needsGate, method }`.

```ts
type CostCardProps = {
  action: string;    // the tool's own `action` input, verbatim
  lowUsd: number;     // steps × the median cost per step measured so far this chat
  highUsd: number;    // steps × the highest cost per step measured so far this chat
  balanceUsd: number; // deps.balance(), at call time
};
```

- **`data-card.ref`**: unset — this card doesn't point at a file.
- **Copy rules:** render `lowUsd`–`highUsd` as the range (never a
  single false-precision number — rule 8), and `balanceUsd` as the
  candidate's current balance. No prose beyond that — no
  `goAheadInstruction`: § 6.2 states this prop is dropped outright
  ("A prop with no source in [the card-build] table is dropped… that
  covers… `goAheadInstruction`"), since it read as a second approval
  word that looks like a gate but isn't one (round-2 review S1). This
  card is informational only: the one confirm for a spend is the
  `spend` gate itself (§ 2.5), never a "say go" reply to this card.
- **When `highUsd` would exceed the candidate's balance, no `spend`
  gate follows.** A gate the balance can't actually cover would just
  fail mid-run against the per-user OpenRouter key's own credit limit
  regardless of a typed yes, so the agent doesn't open one — it shows
  this `cost` card, then a `data-error` part (`code: "over_balance"`,
  the same shape `over-limit-error.json` uses), then says in plain
  text that the run needs a top-up first. See `gate-moment.json`'s
  second scenario.
- **Built from:** every field is the `estimate_cost` tool's own
  `output`, unmodified — `action`/`lowUsd`/`highUsd`/`balanceUsd`
  straight from the table in § 6.2. No number in this card may ever be
  computed or widened in the UI (rule 8, B9) — if the tool didn't
  return it, the card doesn't show it.

### 2.7 `data-error`

**Purpose:** a clear message when something breaks or the balance runs
out (5b exit: "going over the limit shows a clear message, not a
broken loop"). Shape is exactly `design-web-agent.md` § 6's — this
design adds no fields:

```ts
// from design-web-agent.md § 6, verbatim
type DataErrorPart = { type: "data-error"; id?: string; data: {
  code: "over_balance" | "model_error" | "tool_error" | "offline" | "step_cap";
  message: string;
  retryable: boolean;
} };
```

- **Side panel:** unchanged — an error never clears what was already
  open.
- **`message` copy rules:** written in the candidate's language (rule
  18) — "you're out of balance for now" not "402 Payment Required".
- **`nextStep` is UI-owned, keyed by `code`** (the contract carries no
  such field, and the five codes are a closed, known set, so a static
  lookup is simpler than a stream field — rule 12, no duplicate
  representations of the same five words):
- **Built from:** `code`/`message`/`retryable` are the `data-error`
  part's own fields, straight from the loop (§ 8: an over-limit
  rejection becomes exactly this part) — the UI adds no field of its
  own except the static `nextStep` lookup above, and must never
  compute a number into `message` that the part didn't carry (a NIT
  from the round-2 review: `message` is written by the loop's code,
  which cannot know something like "2 of 8 roles" — that belongs in
  the model's own next plain-text turn, not the error part).

  | `code` | UI's `nextStep` copy |
  |---|---|
  | `over_balance` | "Add funds to keep going." |
  | `model_error` | "Try again." |
  | `tool_error` | "Try again, or tell me what changed." |
  | `offline` | "Check your connection and try again." |
  | `step_cap` | "This turn hit its step limit — tell me how to continue." |

- `over_balance` always renders `retryable: false` from the stream
  (per § 8: the loop turns an over-limit rejection into exactly this
  code and stops the turn) — the UI trusts `retryable` from the part,
  never overrides it. The avatar's `statusOf` result is `done` after
  `"error"` (§ 6), which reads as "turn over" even though the candidate
  still has to act — the header's hover label text softens this
  ("Needs funds to continue") without inventing a sixth avatar state
  not in the contract (see § 5, still open).

## 3. The collapsed "ran …" tool-activity line

Built from consecutive `tool-<name>` message parts — the AI SDK's own
standard tool part, states `input-streaming` → `input-available` →
`output-available` | `output-error` (`design-web-agent.md` § 6). There
is no separate "tool-activity" envelope kind; this is a UI grouping
over ordinary tool parts. Purpose: rule 11 — show what ran, never
narrate it.

**Collapsed (default):** one line per contiguous run of tool parts in
a message, chevron prefix, tool names joined by their call, e.g.:

```
▸ ran evaluate · read jobs.md · web search ×3
```

- "ran evaluate" is the skill name, read from a `load_skill` call if
  one occurred in the run; otherwise the line opens directly with the
  first tool.
- Multiple calls to the same tool name collapse to a count (`web
  search ×3`), not three lines.
- Order matches actual part order in the message.
- While a part's `state` is `input-streaming` or `input-available`
  (not yet `output-*`), its segment shows a small inline spinner glyph
  and the avatar is `working` (§ 1.3); once every part in the run
  reaches an `output-*` state, the line goes static.

**Expanded (tap the chevron):** an ordered list, one row per
`tool-<name>` part:

```
▾ ran evaluate · read jobs.md · web search ×3
  1. bash: python3 evaluate/scripts/record_verdict.py --company Acme --title "Staff PM" → exit 0
  2. read_file: jobs.md
  3. web_search: "Acme Series C funding 2026" → 4 results
  4. web_search: "Acme engineering blog culture" → 6 results
  5. web_search: "Acme Staff PM leveling" → 2 results
```

- Each row shows the tool name, its literal `input`, and its literal
  `output` summary (exit code / file path / result count) straight
  from the part — never a restated description of what the model
  believes it did (rule 11: believe the file, not the narration). A
  script's own printed line (stdout's "created" vs "updated", the
  FAIL/WARN count) is read from the `bash` tool's `output.stdout`
  verbatim when present.
- An `output-error` part renders its `errorText` in place of an
  output summary, styled like the `checker` card's FAIL rows (§ 2.4) —
  distinct, not alarm-red.
- Collapsing back is always available; expand/collapse state doesn't
  persist across reload — it's a reading convenience, not workspace
  state (rule 12, no shadow state).

## 4. Fixture conversations

Location: `apps/web/fixtures/*.json`. Each fixture file is a JSON
object:

```ts
{
  meta: { persona: string; description: string };  // sibling field, ignored by the mock transport
  messages: UIMessage[];                            // exactly what sendMessages() receives (§ 6)
}
```

`messages` is the literal array the contract's `mockTransport(fixture)`
replays (§ 6: "`mockTransport(fixture)` replays a recorded chunk
list" — a fixture's `messages` is the source the mock turns into that
chunk list, one `UIMessageChunk` per part, in order, per message).
Each `UIMessage` is `{ id: string; role: "user" | "assistant"; parts:
Part[]; metadata?: { origin: "typed" | "ui" } }` — `metadata.origin` is
set on every **user** message (§ 3 rule 4: only `"typed"` can approve a
gate); assistant messages carry no `metadata`. `parts` uses exactly
the contract's part shapes from § 6 — `text`, `tool-<name>`,
`data-card`, `data-gate`, `data-gate-status`, `data-error` — nothing
invented. There is
**no `status` part anywhere in a fixture** — status is always derived
by `statusOf` from `messages` plus the mock transport's own
`chatStatus` (`"submitted"`/`"streaming"`/`"ready"`/`"error"`), which
the mock derives from its own replay position, not from fixture data.

User file uploads (the résumé drop in the MVP journey) use the AI SDK's
standard `file` part (`{ type: "file"; mediaType: string; filename?:
string; url: string }`) — this is the SDK's own standard part type,
the same family as `text`, so it's used here even though § 6's part
table doesn't list it (that table covers the *agent's* envelope kinds;
a user-authored upload is a different direction — flagged under § 5
below to confirm with the architect).

All personas are invented. No real names, no real contacts —
`@example.com` emails, `555-0100`–`555-0199` phone numbers only. Every
`tool-bash` part behind a checker or pipeline script (`check_files`,
`check_materials`, `record_verdict`, `update_job`, `check_closeout`,
`proposal_block`, `render_resume`) carries the **real stdout and exit
code**, captured by actually running that script against a
`mktemp -d` workspace seeded with the fixture's own invented persona —
never `~/job-search` (round-2 review, B8). A fixture's `meta` object
may also carry `todo_bN` sibling fields (ignored by the mock, like
`persona`/`description`) naming a review finding the fixture's content
depends on but can't fully resolve until the architect's parallel
contract revision lands — see the revision history above and § 5
below.

Files:

- `apps/web/fixtures/mvp-journey.json` — the full MVP journey: sign up
  → upload résumé → profile intake → paste a job URL → verdict →
  tailored résumé + cover letter with checker clean → "what's next"
  plan (send the letter, submit the application, keep searching — all
  three as candidate to-dos, since the web MVP has no send/submit gate;
  round-2 lead decision, pending owner). No `data-gate` part appears in
  this fixture.
- `apps/web/fixtures/gate-moment.json` — round 3: two scenarios. (1)
  A `spend` gate that fits inside the candidate's balance and is over
  the (placeholder, owner-open) threshold — `gateLine` is
  `gate-grammar.md:12`'s real sentence with `highUsd` filled in, plus
  a non-approving reply that leaves it `pending` and the typed `yes`
  that approves it (§ 3 rule 2), each transition shown as its own
  `data-gate-status` part. (2) A cost that exceeds the balance — shown
  as a `cost` card plus a `data-error` (`over_balance`), never a gate
  nobody could approve.
- `apps/web/fixtures/over-limit-error.json` — a run that stops on a
  `data-error` part with `code: "over_balance"`.
- `apps/web/fixtures/checker-failure.json` — a `document` card with
  `checker: "fail"` and a `checker` card showing the FAIL, then the
  agent fixing it on its own next turn (no candidate action needed —
  rule 3).
- `apps/web/fixtures/empty-first-run.json` — the first-run state: one
  agent message, one `text` part, no cards, per § 1.5.

## 5. Needs from the contract

Five questions were open before `design-web-agent.md` existed. Four
are answered by its text; one narrows and one new question surfaces.

1. **Tool-activity field names — answered.** § 6: tool parts are the
   AI SDK standard `tool-<name>`, states `input-streaming` /
   `input-available` / `output-available` / `output-error`; § 4 names
   the eight tools and their `input`/`output` shapes. Used directly in
   § 3 above.
2. **Where the hover label text comes from — answered, and it's this
   doc's job.** § 6's `statusOf` returns `action` = "that tool's
   one-line label", but the contract has no field carrying that text —
   reading § 4's tool table (structured `input`/`output`, no prose),
   the label is UI copy keyed by tool name. Resolved with the table in
   § 1.3 above; not reopening as a question.
3. **Where typed-yes matching happens — answered.** § 3, "How the
   typed yes is matched": in code, in `packages/agent`, before the
   model sees the new message, keyed on `metadata.origin === "typed"`
   and an exact `"yes"` match. The UI never interprets input itself —
   confirmed in § 2.5 above.
4. **Card-prop type ownership — answered.** § 6: "Each card's props
   are defined in `docs/design-web-ui.md`; this doc owns only the
   wrapper." This doc's types in § 2 are the authoritative shapes.
5. **Balance chip timing — answered, differently than assumed.** § 8:
   the balance is **not** delivered through the chat envelope at all —
   "The balance chip shows the live key's remaining limit," read
   directly from OpenRouter (`GET /api/v1/key`, **UNVERIFIED** per § 8
   whether that endpoint returns `limit_remaining`). So the chip is a
   separate live query, not a stream field. **Still open:** § 8
   doesn't say how often the chip polls or re-fetches after a `spend`
   gate resolves — a poll-on-gate-resolution-and-every-N-seconds
   default is this design's placeholder until Ar/Co confirm the key
   endpoint's shape (the UNVERIFIED item).

New, from writing this revision against the actual contract:

6. **User file-upload part shape.** § 6's envelope table only covers
   assistant-emitted kinds (`text`, `tool-<name>`, `data-card`,
   `data-gate`, `data-error`); it doesn't say what part a user's
   attached file arrives as. This design assumes the AI SDK's own
   standard `file` part (§ 4 above) since it's the SDK's documented
   mechanism for the same job, but it needs Ar's confirmation — in
   particular, whether an uploaded file is expected to land in the
   workspace via `write_file`/`upload` (§ 1–2 of the contract) before
   or after the message with the `file` part streams, since the
   `read_file`/`upload` interfaces in §§ 1–4 don't mention being
   triggered by a chat part.
7. **Answered in round 3.** `GateRequest.label` (§ 3) is exactly the
   dedicated field this item asked for — "6 words or fewer… used for
   the card title and the avatar's hover text," stated directly in the
   contract now. No more deriving a title from a path. See § 1.3 and
   § 2.5 above.
8. **`spendGateUsd`'s actual value.** § 4 states the threshold is "an
   open question for O" — this design's `cost` card copy (§ 2.6) works
   at any threshold, so no design change is blocked on it, but the
   fixtures can't show a realistic "just under vs. just over the gate"
   pair until the number is set.
