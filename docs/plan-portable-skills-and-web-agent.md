# Plan - Portable skills, model-native simplification, and the web agent MVP

**Status:** Phase 0 decided; phase 1 next
**Date:** 2026-09-22
**Owner:** Yong
**Builds on:** `docs/plan-cross-host-workspace-interface.md` (workspace UI,
resource contract, `get_active_context`), `docs/design-cross-host-active-context.md`

Three goals:

- **A.** The skills work in Claude Cowork, Grok, ChatGPT Work, and Gemini Spark.
- **B.** As models improve, the skills get smaller, and every deletion is measured.
- **C.** Our own website runs the agent with files in cloud object storage. A team
  of subagents builds the MVP.

How they connect: C runs `skills/` unchanged on the Claude Agent SDK. A exposes
C's workspace service and scripts to other hosts as a remote MCP server. B needs
no new runner, because Claude models run through the existing harness and every
other model is measured on its own host. So C goes first; A and B follow and do
not block C.

---

## Phase 0 - Decisions that come before any code

The precedence chain has to agree first. Picking a winner ad hoc is not allowed
(CLAUDE.md).

1. **Rule 9: decided 2026-09-22, amended.** "Local and yours" became "Yours":
   data you can export as the same plain-file folder, encrypted, never trained
   on, gone when you delete it. Local-first stays a supported mode.
2. **Where the loop runs: decided 2026-09-22, in the cloud on the Claude Agent
   SDK.** The owner's criterion was "the simplest way to develop and maintain."
   See C.1.
3. **How C relates to the existing cloud WebUI: decided 2026-09-22, a new app
   that replaces the old one later.** Beta users move over only after C.4 passes
   and a migration (per-user machine files → object storage) has been tested.
   Phase 5 of the existing plan (OpenClaw integration) is superseded.
4. **Storage vendor: open.** Default is Supabase Storage (already in the stack and
   paired with Supabase auth). R2 or S3 if cost or egress says otherwise. The
   architect decides in phase 1.

**Exit:** decisions recorded in a GitHub issue.

---

## Part A - One core, many hosts

### Finding

As of September 2026, every target host reads the `SKILL.md` format and can
connect to a custom remote MCP server:

| Host | Skills | Custom MCP | Notes |
|---|---|---|---|
| Claude Cowork | plugin (skills + MCP) | yes | the existing `.claude-plugin/` package |
| ChatGPT Work | plugins bundle skills + apps (July 2026 rename) | yes | the existing plan routes it through a secure tunnel |
| Grok | skills + connectors, "Bring your own MCP" (May 2026) | yes | xAI says it reads Claude Code plugins with no configuration; must be verified |
| Gemini Spark | can be taught skills; MCP connections | yes | runs in cloud VMs; how it loads skills must be verified |

The prose ports almost as-is. **The scripts do not.** Consumer hosts cannot be
relied on to run local Python against a folder that persists. Rule 14 puts the
invariants in code, so that code must run somewhere every host can reach.

### Design

Ship two things:

1. **The skill pack.** `skills/*/SKILL.md` and `references/`, unchanged in
   substance.
2. **The CareerCoach MCP server (remote, authenticated).** The same tool layer
   the web runtime uses (C.2):
   - workspace file tools: list, read, and versioned write
   - each deterministic script as a tool: `check_materials`, `check_files`,
     `check_stories`, `check_messages`, `update_job`, `record_verdict`,
     `render_resume`, `search_ats`, ...
   - `get_active_context`

Skills currently name script paths directly, such as
`../search/scripts/update_job.py`. Replace these with **tool names**
(`update_job`), bound either to the local script (Claude Code or Cowork with a
local folder) or to the MCP tool (every other host). There is one implementation:
the MCP tool wraps the same Python script. Add an invariant test: every tool a
skill names has both bindings.

**No MCP tool sends or submits anything** (rule 7). Hosts prepare, and the
candidate clicks.

### Exit, per host (the existing rule: a host is supported only once verified end to end)

- installs through that host's plugin or skills mechanism
- authenticates to the remote MCP server
- one scripted journey passes: intake, evaluate, tailor, checker clean
- a conduct-harness subset passes when run on the host's own model (needs B's runner)

---

## Part B - Hand more to the model, measured

Rule 13 already requires this: "every rule is derivable or earned." What's
missing is a way to measure it on each new model and each host.

### What moves and what never does

| Class | Examples | As models improve |
|---|---|---|
| **Code**: one right answer | schemas, checkers, pipeline writes, dedupe | **Never moves** (rule 14). A smarter model is still not deterministic. |
| **Policy**: product promises | gates (rule 7), claims no stronger than the facts, rule 10 boundaries, honest numbers | **Never moves.** These are choices, not capability gaps. |
| **Capability**: moment rules earned against older models | loop rules, Tier 0 interrupts, exit ceilings | **Candidate to delete.** Re-measure on each new model. |
| **Craft**: world knowledge | most of `references/patterns.md` (résumé craft, interview frameworks) | **Strong candidate.** Frontier models already know it. |

### Method: an ablation harness

1. **Inventory.** A script tags every rule in `SKILL.md` and `patterns.md` with its
   class and receipt, and writes a table.
2. **Model matrix.** The latest frontier models (Claude Opus 5.5, Claude Fable 5.1),
   each host's own model from Part A, and today's baseline (Sonnet). **The judge
   stays pinned** to one model and version so scores stay comparable.
3. **Per-rule ablation.** For each Capability or Craft rule, run its harness cases
   with the rule removed, at least 3 trials. **Delete the rule only if every model
   we ship to passes without it.** Otherwise keep it and record
   "earned on <model> as of <date>".
4. **Goal-only arm.** For each skill, run `SKILL.md` cut down to the Goal table plus
   exits. This gives the upper bound on how much can go.
5. **Metrics.** Pass rate, words loaded per turn (from `loading-map.md`),
   tokens and cost per task, latency.
6. **Re-run on every model release.** The "earned" column gets re-checked
   automatically.

**The tension with Part A:** the bar for deleting a rule is the **weakest model we
ship to**, not the strongest. No per-model scaffold files, because rule 12 allows
one of everything. If a host needs scaffolding the frontier doesn't, that is a
reason to drop the host, not to fork the skills.

**Hypothesis (falsifiable):** `patterns.md` loses at least 40% of its words and
`SKILL.md` Capability rules lose at least 25%, with no pass-rate drop on Opus 5.5.
If Opus 5.5 regresses on the Craft ablation, the hypothesis is wrong and the craft
stays.

**Dependency:** `tests/always-on/run_*.sh` calls `claude -p`, which already
covers the Claude models in the matrix. **Non-Claude models are measured on
their own hosts** (Part A's per-host exit), not through a runner we build. That
matches how candidates will actually use them, and it keeps us from owning a
multi-provider loop.

---

## Part C - Web agent MVP

### C.1 Where the loop runs

**Decision: in the cloud, on the Claude Agent SDK.** The criterion is least
code to write and maintain. The Agent SDK loads `SKILL.md` natively, discloses
references on demand, and runs Bash and Python. So `skills/` runs **unchanged**,
exactly as in Claude Code. We don't build a loop, a skill loader, or a sandbox
runtime. We build auth, storage sync, gates, metering, and the UI.

A buttercup.sh-style browser loop was rejected for the MVP. It still needs a
server for object storage and for fetching career sites (CORS), and it would
force the Python checkers to be ported to Pyodide or JavaScript, which means two
implementations of every invariant (rule 12). It can come back later as a "try it
free" mode if usage asks for it.

Rule 14 still holds in the sandbox: checkers run as scripts, not as prose.

Reasons for cloud, each traced to a promise:

- **Rule 3 ("finding happens without you").** Scheduled search and the Monday
  briefing need a worker that runs while the tab is closed.
- **Rule 5 (prepaid balance).** Provider keys and cost metering have to live on
  the server.
- **Rule 7 (gates).** Confirmation and logging must be enforced where the client
  can't skip them.
- **Practical limits.** `search_ats` fetches employer career sites, which browsers
  block (CORS), and the checkers are Python.

### C.2 Architecture

```
Browser ── web app (apps/workspace-ui components + chat pane)
   │        auth: Supabase
   ▼
API ─┬─ Workspace service ── object storage: users/{uid}/ws/{path}
     │    (the existing versioned-write resource contract; no DB copies of career facts, rule 12)
     └─ Session worker ── one isolated container per active session
          ├─ Claude Agent SDK, with skills/ mounted read-only (the same files as the plugin)
          ├─ workspace: synced from object storage at session start, written back
          │    with version checks on every file write (a stale write fails loudly)
          ├─ gate hook: send/submit/spend actions stop with "needs your word"; the
          │    candidate's typed yes in chat, not a button (rule 7), gets logged
          ├─ metering: SDK usage per turn against the prepaid balance; estimate before big runs
          └─ network: model API + the search_ats allowlist only
```

The **tool layer** Part A needs is the thin HTTP/MCP wrapper around the same
scripts and workspace service. The web app doesn't need it. It is built in
phase A, not on the MVP's critical path.

### C.3 MVP scope

**In:** one journey, end to end. Sign up → upload résumé → profile intake →
paste a job description → evaluate verdict → tailored résumé and cover letter
(the checker passes) → download PDF → "what's next" plan. That needs the
`profile`, `evaluate`, `apply`, and `coach` skills.

**Out:** automated search, scheduling, outreach, interview practice, filling
forms in the browser, the browser loop, multi-host launch.

### C.4 MVP acceptance

- The journey passes end to end with a fixture persona (never real data).
- The conduct cases for those skills (t4, t6, t10, t15, t8) pass through the web
  runtime at least as well as the Claude Code baseline (majority over 3 trials).
- Isolation: user A can never read or write user B's workspace (contract test).
- **Portability proof:** an exported workspace opens in Claude Code with the local
  skills and works unchanged.
- Gate test: no side effect happens without a logged, typed yes.

---

## The team

The main session is the **lead**: it holds the GitHub issue and runs the ritual
in `docs/PROCESS.md`. Four subagents, defined as `.claude/agents/*.md`.
`.gitignore` currently excludes `.claude/`, so the definitions either live in a
tracked `agents/` directory and get copied in, or `.claude/agents/` gets
un-ignored.

| Agent | Owns | Produces | May not |
|---|---|---|---|
| **architect** | design gate, contracts (tool layer, storage, gates, auth), decision records, closing drift review | contract docs + interface stubs, review findings with file:line | write feature code |
| **designer** | flows, screens, gate UX, mobile | fixture-backed screens in `apps/workspace-ui` (the existing gate: design approved on fixtures before live data) | wire live data |
| **coder** | one slice per issue, in its own worktree | code + unit tests for that code | grade its own slice |
| **tester** | acceptance, e2e, isolation, and conduct tests written **from the spec, not the code**; independent verification | tests + a verdict with evidence | fix what it reviews (CLAUDE.md: never test what you authored) |

### How a slice flows (PROCESS.md mapped onto the team)

1. The architect writes the design gate → the lead opens the issue.
2. The designer builds fixtures **in parallel with** the architect's contracts →
   **the owner approves**.
3. The coder builds in a worktree **while** the tester writes tests from the same
   spec.
4. The tester runs everything, and the reviewer verifies the fixes (PROCESS
   step 5).
5. The architect does the closing drift review → the owner dogfoods → merge.

Coders run in parallel only on disjoint modules: workspace service, runtime,
sandbox, web wiring.

### Phases

| # | Work | Lead agents | Exit |
|---|---|---|---|
| 0 | Decisions + PRINCIPLES rule 9 amendment | lead, owner | **done 2026-09-22** except storage vendor |
| 1 | Contracts (storage sync, gate hook, metering, auth) + fixture design | architect ∥ designer | owner approves both |
| 2 | Workspace service on object storage (plus a local-folder adapter for tests) + sync | coder, tester | contract tests pass; isolation test passes; a round trip is byte-identical |
| 3 | Session worker: Agent SDK container, skills mounted, gate hook, metering | coder, tester | the harness subset passes through the worker at least as well as `claude -p` |
| 4 | Web app wired to live data | designer, coder, tester | the C.3 journey passes; C.4 isolation and gate tests pass |
| 5 | Founder dogfood, closing review, private beta behind a flag | lead, architect | C.4 all green; drift review clean |
| A | Tool layer (scripts + workspace service) exposed as a remote MCP server; per-host packaging | coder, tester | the Part A exit, host by host |
| B | Ablation mode for `tests/always-on` + rule inventory; Claude-model matrix | tester, architect | eval record in `docs/evals/` |

B can start now, because it only needs the existing harness. A starts after
phase 2, once the workspace service exists. Neither blocks phases 3 to 5.

## Risks

- **Prompt injection through job descriptions and web pages** reaching tools. The
  mitigation is structural: no tool sends or submits anything, gates are enforced
  on the server, and the sandbox has no network.
- **Cost per session** with about 3,000 loaded words per turn plus references. B's
  word-count metric tracks it; metering enforces the limit.
- **Concurrent writes** from the web plus external hosts. The existing optimistic
  versions reject stale edits.
- **Trust.** Moving data off the candidate's machine is a change in promise. Keep
  local-first mode, and make export a first-class feature, not a footnote.
