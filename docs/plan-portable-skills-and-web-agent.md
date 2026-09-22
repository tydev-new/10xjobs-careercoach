# Plan - Portable skills, model-native simplification, and the web agent MVP

**Status:** Phase 0 decided; phase 1 next
**Date:** 2026-09-22 (revised the same day: loop moved to the browser)
**Owner:** Yong
**Builds on:** `docs/plan-cross-host-workspace-interface.md` (workspace UI,
resource contract, `get_active_context`), `docs/design-cross-host-active-context.md`

Three goals:

- **A.** The skills work in Claude Cowork, Grok, ChatGPT Work, and Gemini Spark.
- **B.** As models improve, the skills get smaller, and every deletion is measured.
- **C.** Our own website runs the agent loop in the browser, keeps state in
  Supabase, and can add a server loop later (scheduled search) with minimal
  change. A team of subagents builds the MVP.

**How they connect:** C's shared **agent package** is the foundation for all
three:

- in C, it runs in the browser tab
- in A, its tools are exposed as the remote MCP server
- in B, it runs headless in Node against any model OpenRouter serves
- later, it runs on a server for scheduled search

---

## Phase 0 - Decisions (done 2026-09-22)

| # | Decision | Why |
|---|---|---|
| 1 | Rule 9 amended from "Local and yours" to **"Yours"**: exportable as the same plain-file folder, encrypted, never trained on, deletable; local-first still supported | cloud storage needed the precedence chain fixed first |
| 2 | **Loop runs in the browser** on the Vercel AI SDK. The server loop comes later, reusing the same package | the owner accepts no background search in the MVP; the job-board APIs (Greenhouse, Lever, Ashby, SmartRecruiters) allow browser requests (tested 2026-09-22); the AI SDK runs in browsers, Node, and Deno |
| 3 | **Models through OpenRouter**, default a Claude model | one API for all models (it also serves B); per-user provisioned keys with spending limits give prepaid billing without a proxy; web search runs on OpenRouter's servers |
| 4 | **State in Supabase**: auth, Storage for the workspace files, rows only for accounts, balances, and the gate log | already in the stack; per-user access rules; no DB copies of career facts (rule 12) |
| 5 | **New app, replaces the existing WebUI later**; beta users migrate after phase 6 | owner's call; Phase 5 of the earlier plan (OpenClaw integration) is superseded |
| 6 | Checkers: **ported to JavaScript**, with a parity test against Python until the local plugin switches over. Pyodide is the fallback | one runtime for the browser, a later server, and the MCP server. A temporary duplicate is allowed only with a loud-fail parity test (PROCESS step 4) |

---

## Architecture (Part C)

```
Browser tab
 ├─ web app ── apps/workspace-ui components + chat pane
 └─ packages/agent  (no window/DOM/localStorage imports; everything injected)
      ├─ AI SDK loop ── OpenRouter model (per-user key, spending limit = balance)
      ├─ skills/ bundled read-only at build time; loaded in stages:
      │    descriptions always → SKILL.md when a skill is activated → references on demand
      ├─ just-bash: in-memory workspace + custom commands
      │    `python3 …/check_materials.py` → the JS port (so skill prose is unchanged)
      ├─ tools: file read/write · checkers · web search (OpenRouter) ·
      │    ATS fetch (a Greenhouse/Lever/Ashby job URL → that board's public API)
      └─ gate: send/submit/spend → "needs your word" → the typed yes in chat gets logged
          │
Supabase ─┼─ Auth
          ├─ Storage: users/{uid}/ws/{path}, versioned writes, per-user access rules
          ├─ Rows: account, balance, gate log
          └─ Edge Function: mint/raise the user's OpenRouter key (the only server code in the MVP)

Later, the server loop: same packages/agent + a server entry + deferGate
(refuses every side effect and leaves it in plan.md) + pg_cron/queue.
```

**Page fetching:** OpenRouter documents no equivalent of Anthropic's
`webFetch`. A job URL on a supported board goes through that board's public
API; for anything else, the candidate pastes the text. That is what the skills
already assume.

---

## The steps (each with exit criteria)

Owners: **L** lead (main session) · **Ar** architect · **De** designer ·
**Co** coder · **Te** tester · **O** owner (Yong). Every step also has to pass
the standing checks: `python3 tests/run.py` green, no fixtures made from real
candidate data, and the tester is never the author.

### Step 1 - Spikes, contracts, and design · Ar ∥ De, Co for spikes · ~1 week

The four spikes, each written up as a one-page pass/fail note in `docs/spikes/`:

1. The AI SDK plus `@openrouter/ai-sdk-provider` runs **in the browser**: it
   streams, calls tools in a loop, and a cache read shows up on turn 2 with a
   Claude model.
2. just-bash custom commands: running `python3 skills/apply/scripts/check_materials.py <file>`
   inside just-bash reaches a JS function, and its output and exit code match the
   Python script's.
3. Supabase Storage isolation: user A's token cannot list, read, or write
   `users/B/…`.
4. OpenRouter: a provisioned key with a credit limit is rejected once over the
   limit, and a provider filter restricts calls to providers that keep no data.

The contracts, written by Ar in `docs/design-web-agent.md`:

- the `packages/agent` interface (`createCoach(deps)`, with `Deps` covering
  model, workspace, gate, and fetch)
- the workspace store interface (the existing versioned-write contract)
- the gate protocol and gate-log row
- the MVP tool list
- the list of checkers to port

The design, by De: a wireframe of *The UI* (below), plus the **chat transport
interface** and card fixture shapes, agreed with Ar, so 5a can start the moment
this step exits.

**Exit:**

- [ ] all 4 spike notes say pass. A fail changes the design before step 2 (a
      fail on spike 2 triggers the Pyodide fallback)
- [ ] **O approves** the contracts and the fixture screens
- [ ] a GitHub issue opened with the steps as checkboxes

### Step 2 - Workspace and auth on Supabase · Co, Te

The Supabase project, auth, the Storage bucket with per-user access rules, the
versioned write (a stale version is rejected), **export as a zip** of the same
folder shape, and import.

**Exit:**

- [ ] isolation tests pass (spike 3 turned into CI)
- [ ] a stale write is rejected; a concurrent-write test passes
- [ ] a round trip (import a fixture workspace → export) is byte-identical
- [ ] an exported fixture workspace works in local Claude Code with the local
      skills, unchanged (the rule 9 portability proof)

### Step 3 - Port the MVP checkers to JavaScript · Co, Te

The scripts the MVP journey uses: `check_materials`, `check_files`,
`proposal_block`, `record_verdict`, `jobs_md`/`update_job`, `check_closeout`.
`render_resume` becomes HTML plus the browser's print-to-PDF.

**Exit:**

- [ ] a parity test runs every existing Python test fixture through both
      versions: **100% identical** output and exit codes
- [ ] the parity test is wired into `tests/run.py`, so drift fails loudly
- [ ] the ports have no Node-only or browser-only imports (they run in both)

### Step 4 - The agent package, headless first · Co ×2 (loader+tools ∥ just-bash+commands), Te

`createCoach`, the staged skill loader, just-bash with the checker commands, the
tools (files, checkers, OpenRouter web search, ATS fetch), the gate interface, a
step cap, and the cost estimate. It is built and tested **in Node first** against
an in-memory workspace. That proves it doesn't depend on the browser, and the
same runner is what B needs.

**Exit:**

- [ ] package tests pass in Node with no DOM available
- [ ] a lint rule or test fails on any `window`/`document`/`localStorage` use in
      `packages/agent`
- [ ] conduct cases **t4, t6, t10, t15, t8** run through the headless runner on
      the default Claude model and do **at least as well as the `claude -p`
      baseline** (majority of 3 trials), recorded in `docs/evals/`
- [ ] a gate test: no send, submit, or spend happens without a logged typed yes
- [ ] a turn loads roughly the same words as `loading-map.md`'s ~3,000 (no
      bloat from the new loader)

### Step 5a - The UI on a mock agent · De, Co, Te · starts once step 1's contracts are approved, runs in parallel with 2, 3, and 4

The simplest functional UI (see *The UI* below), built against a **mock chat
transport**. The mock replays scripted fixture conversations as the same AI SDK
UI message stream the real agent emits: text, tool-call lines, cards, and a gate.
The mock and the real transport implement one interface, so swapping them in 5b
is a one-line change.

**Exit:**

- [ ] the whole MVP journey can be clicked through on the mock, on desktop and a
      375px phone
- [ ] every card type renders from fixtures: verdict, plan, document, checker
      result, gate, cost estimate, error
- [ ] the status indicator shows all five states from the stream (idle,
      thinking, working, needs you, done)
- [ ] the gate card cannot be approved by a button, only by a typed yes (rule 7)
- [ ] **O approves** the look and flow on the mock

### Step 5b - Wire to the real agent · Co, Te · after steps 2, 4, and 5a

Swap the mock transport for the in-tab agent transport; add the Edge Function
that mints and raises keys; the balance chip; the cost estimate before big runs.

**Exit:**

- [ ] the **MVP journey passes end to end in a real browser** with a fixture
      persona: sign up → upload résumé → profile intake → paste a job URL or text
      → evaluate verdict → tailored résumé and cover letter with the checker
      clean → download PDF → "what's next" written to `plan.md`
- [ ] the diff from 5a is the transport swap plus key and balance wiring: no
      screen rework
- [ ] the client bundle holds no secret except the user's own OpenRouter key
- [ ] going over the limit shows a clear message, not a broken loop
- [ ] cost per journey is measured and written down (this sets pricing)

### The UI - simplest functional, inspired by Grok Bot

What to take from Grok Bot's published design: few core objects, one status
indicator on the avatar instead of scattered spinners, structured cards in the
transcript instead of prose-only replies, a pinned side panel that previews the
agent's work without leaving the chat, and a record of what ran.

What not to take: its roster of many bots. We have **one coach and one
conversation** (rule 12).

**One screen, two panes:**

```
┌───────────────────────────────────────────────┬──────────────────────────┐
│ ◉ Ten · working            balance $4.20  ⋯   │  Side panel (pinned)     │
├───────────────────────────────────────────────┤  the file Ten is on:     │
│ you: here's the Acme posting (URL)            │  résumé · letter · plan  │
│ ▸ ran evaluate · read jobs.md · web search ×3 │  · jobs · any workspace  │
│ ┌ Verdict card ───────────────┐                │  file                    │
│ │ Apply · 3 reasons · 1 risk  │                │                          │
│ └─────────────────────────────┘                │  [Download PDF] [Export] │
│ ┌ Document card: Acme résumé ─┐  → opens in side panel                    │
│ │ checker ✓ clean · 2 pages   │                │                          │
│ └─────────────────────────────┘                │                          │
│ ┌ Needs your word ────────────┐                │                          │
│ │ the complete thing + one sentence of what happens; type "yes"         │
│ └─────────────────────────────┘                │                          │
├───────────────────────────────────────────────┤                          │
│ [ + ]  Message Ten…   /skills   paste a link   │                          │
└───────────────────────────────────────────────┴──────────────────────────┘
```

- **Header:** the avatar with its five states (idle, thinking, working, needs
  you, done; hover shows the current action), a balance chip, and a `⋯` menu for
  export, sign out, and key.
- **Transcript:** replies in plain prose, **cards** for structured results, and
  collapsed **"ran …" lines** for tool calls that expand to show what ran and
  what it returned (rule 11: the file, not the narration).
- **Composer:** attach a file, `/` to pick a skill (optional; plain language
  works), paste a link.
- **Side panel:** views whichever workspace file the last card points at, with a
  download button. On a phone it becomes a full-screen sheet.
- **Nothing else in the MVP:** no settings pages, no dashboards, no separate
  jobs or interview screens. The richer `apps/workspace-ui` views (jobs table,
  interview prep) come back after the MVP, and only if dogfooding shows chat plus
  cards isn't enough.

### Step 6 - Dogfood, closing review, private beta · L, Ar, O

**Exit:**

- [ ] **O completes the journey on real data** in their own account, with issues
      logged and fixed or accepted
- [ ] Ar's closing drift review against the precedence chain is clean
- [ ] every exit from steps 2 to 5b is still green
- [ ] the beta runs behind a flag; a migration plan for existing WebUI users is
      written (not run)

### Order

```
1 ──┬── 2 ─────────┐
    ├── 3 ── 4 ────┼── 5b ── 6
    └── 5a ────────┘
```

Steps 2, 3, and 5a run in parallel once step 1 exits. The critical path is
1 → 3 → 4 → 5b → 6.

### Later steps

**Step 7 - Scheduled search (the server loop)** · Co, Te. A server entry for
`packages/agent`, `deferGate`, `pg_cron` plus a queue running one short job per
company batch, and the `search_ats` port.

- [ ] a nightly run adds on-target roles to `jobs.md` with **zero side effects**
- [ ] a concurrent browser-plus-cron write test passes
- [ ] **the diff to `packages/agent` is empty or trivial.** This is the test of
      "minimal change"

**Step A - Other hosts** (can start after step 4). `packages/agent` tools are
exposed as a remote MCP server (an Edge Function) and packaged per host.

- [ ] for each host: it installs, authenticates, the scripted journey passes, and
      a conduct subset passes on that host's own model

**Step B - Measured simplification.** The rule inventory can start now; the
model matrix starts after step 4.

- [ ] a rule inventory (Code / Policy / Capability / Craft) with receipts
- [ ] per-rule ablation over the OpenRouter model matrix, judge pinned, at least 3
      trials
- [ ] an eval record in `docs/evals/`; rules deleted only where the **weakest
      shipped model** still passes

**Step M - Migrate the existing WebUI users** (after step 6).

- [ ] a dry run on a copy of the data is byte-identical after import
- [ ] O approves before any real user moves

---

## Part A - One core, many hosts (unchanged in substance)

Every target host reads `SKILL.md` and connects to a custom remote MCP server
(September 2026):

| Host | Skills | Custom MCP | Notes |
|---|---|---|---|
| Claude Cowork | plugin (skills + MCP) | yes | the existing `.claude-plugin/` package |
| ChatGPT Work | plugins bundle skills + apps (July 2026 rename) | yes | the earlier plan routes it through a secure tunnel |
| Grok | skills + connectors, "Bring your own MCP" (May 2026) | yes | xAI says it reads Claude Code plugins with no configuration; must be verified |
| Gemini Spark | can be taught skills; MCP connections | yes | how it loads skills must be verified |

The prose ports; the scripts don't, because consumer hosts can't be relied on to
run local Python against a folder that persists. The remote MCP server serves the
same JS tools as the web app: workspace files, checkers, and
`get_active_context`. **No MCP tool sends or submits anything** (rule 7).

## Part B - Hand more to the model, measured (unchanged in substance)

| Class | Examples | As models improve |
|---|---|---|
| **Code** | schemas, checkers, pipeline writes | **never moves** (rule 14) |
| **Policy** | gates, claims no stronger than the facts, rule 10, honest numbers | **never moves**; these are choices |
| **Capability** | moment rules earned against older models | re-measure and delete when earned no longer |
| **Craft** | most of `references/patterns.md` | strong candidate; frontier models already know it |

The bar for deleting a rule is the **weakest model we ship to**. No per-model
scaffold files (rule 12). **Falsifiable hypothesis:** `patterns.md` loses at
least 40% of its words and Capability rules lose at least 25%, with no pass-rate
drop on the default model.

---

## The team

The main session is the **lead**: it holds the issue and runs the ritual in
`docs/PROCESS.md`. The subagents are defined as `.claude/agents/*.md`.
`.claude/` is gitignored, so either un-ignore `.claude/agents/` or keep the
definitions in a tracked `agents/` directory.

| Agent | Owns | May not |
|---|---|---|
| **architect** | contracts, design gates, spike write-ups, closing drift review | write feature code |
| **designer** | fixture screens, gate and balance UX, mobile | wire live data |
| **coder** | one slice per issue, in its own worktree, with unit tests | grade its own slice |
| **tester** | acceptance, parity, isolation, e2e, and conduct tests written **from the spec**; independent verification | fix what it reviews |

**How a slice flows:** Ar gate → L opens the issue → De fixtures ∥ Ar contracts
→ **O approves** → Co builds ∥ Te writes tests from the spec → Te verifies,
including the fixes → Ar closing review → O dogfoods → merge.

## Risks

- **Prompt injection** from job descriptions and web pages. No tool sends or
  submits; the gate runs in the tab, and only the candidate's own typed yes gets
  through.
- **A user-held OpenRouter key** can be used outside the app. It is capped at
  that user's own balance, so the exposure is the user's own money. Rotate it
  on logout.
- **OpenRouter drift** (new provider features arrive late, e.g. provider bug
  #494). Pin the provider version; spike 1 re-runs on each upgrade.
- **Data processors:** OpenRouter plus the model provider. Enforce the
  no-data-kept provider filter (spike 4) and name them in the privacy terms.
- **Cost per session:** measured in step 5; the cost estimate runs before big
  runs.
