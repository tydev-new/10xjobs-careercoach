---
name: search
description: Use this skill when the candidate wants to find new roles or run their job search — e.g. "run my job search", "find new roles", "any new openings at my target companies?", "plan my search", "set up a daily search". Composes a search plan over the source catalog, probes employers' hiring systems headlessly, adds new on-thesis roles to the pipeline, and reports honestly on what it found.
---

# Search — a plan over instruments

## Goal

Identify new on-thesis roles, save JDs to `jd-inbox/`, and add them to `jobs.md` at "To Review". Search discovers; `evaluate` assesses.

| Must be true | Where |
|---|---|
| Confirmed search plan before running sweeps | `criteria.md § Search plan` |
| New on-thesis roles at To Review with saved JDs and direct employer URLs | `jobs.md` + `jd-inbox/` |
| Honest reporting (yield per source, counts, settings) | reply |
| Market insights recorded and dated | `jobs.md § Search notes` |
| Prune report proposes; engaged rows never touched | reply $\rightarrow$ `jobs.md` on confirmation |

## Prerequisites

- **Required:** Workspace `CLAUDE.md` (none → profile's Setup); `criteria.md` (targets, titles, geo, watchlist).
- **Optional:** `companies.md`, `criteria.md § Search settings`.

## Loops and sequences

Instrument catalog and discovery tactics in `references/patterns.md`.

### Plan composition (a sequence)

**Runs when** `criteria.md` lacks a `## Search plan` or candidate requests a plan change.

1. Read `criteria.md` in full.
2. Compose tailored queries and instrument choices (`references/patterns.md § The catalog`).
3. Propose the plan in chat and stop. Candidate approval writes `## Search plan` into `criteria.md` before execution.

**Exits** when the confirmed plan is written to disk.

### The sweep (the loop)

**Runs when** candidate asks to search or runs a manual sweep.

- **Standard:** The confirmed plan in `criteria.md`.
- **Budget:** At most 2 revision passes for thin results.
- **Each pass:** Execute plan instruments $\rightarrow$ parse results $\rightarrow$ diagnose thin yield (`references/patterns.md § Reading a thin result`) $\rightarrow$ propose prune batch (To Review rows only; never propose engaged rows).
- **Obligations:**
  1. *Single revision:* One evidence-backed revision pass at a time.
  2. *To-Review ranking only:* Active pipeline rows (Interested, Applied, Interviewing) are strictly excluded from prune proposals.
  3. *Batch confirm:* Proposed dismissals require explicit single batch approval.
- **Exits:** Sweep reported and prune actions confirmed; or **the ceiling: two passes with the same yield** → stop and present parameter adjustment as a **DECISION**. Standard does not bend to thin weeks.

### Scheduled run (a sequence, unattended)

**Runs when** a recurring search schedule triggers (`scripts/autopilot_sweep.py`).

1. Execute standing `criteria.md § Search plan` verbatim without logged-in scraping or unauthorized widening.
2. Add on-thesis hits at To Review; summarize results and list prune candidates without auto-dismissing.

**Exits** with summary delivered and prune candidates held for next attended session.

## State

Owned: `jobs.md`, `companies.md`, `leads.md`, `criteria.json`, `jd-inbox/`, `autopilot-log.md` (shapes in `references/schema.md`).

- **Hands back:** New To-Review rows → `evaluate`; radar hits → `outreach`.
- **Session close:** Run `../profile/scripts/check_files.py --workspace .`. No checker-subagent is spawned (search writes no candidate-voiced text). Report outcomes, never narration (clean is 1 line; fix FAILs before reply ends).

## Guardrails

- Never fabricate a listing, company, or metric. Every entry requires a verifiable citation.
- Direct employer URLs only; no third-party spam aggregators.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
