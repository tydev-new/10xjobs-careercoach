---
name: search
description: Use this skill when the candidate wants to find new roles or run their job search — e.g. "run my job search", "find new roles", "any new openings at my target companies?", "plan my search", "set up a daily search". Composes a search plan over the source catalog, probes employers' hiring systems headlessly, adds new on-thesis roles to the pipeline, and reports honestly on what it found.
---

# Search — a plan over instruments

## Goal

New on-thesis roles in the pipeline at "To Review" with their JDs
saved, and an honest report. **"Nothing new matched this week" is a real
answer; a fabricated role is the worst failure available here.** Search
finds; the `evaluate` skill judges. Scored by `references/eval.md`.

| Must be true | Where |
|---|---|
| A confirmed plan exists before anything runs | `criteria.md § Search plan` |
| Every new on-thesis role sits at To Review, JD saved, with the employer's own URL (a hiring-manager post: the post URL) | `jobs.md` + `jd-inbox/` |
| The report is honest: counts, rejection reasons, yield per source, effective settings | the reply |
| Market findings the candidate should see are written down, dated | `jobs.md § Search notes` |
| The prune report proposes, never executes; engaged rows appear nowhere in it | the reply, then `jobs.md` on confirm |
| `criteria.json` is no older than `criteria.md` | `criteria.json` |

## Prerequisites

- **Required:**
  - a workspace `CLAUDE.md`. None → the workspace isn't set up; run
    profile's Setup before writing any file. (Every skill is a door a
    NEW candidate can walk through first — goal 2's blocking gap.)
  - `criteria.md` with the target written down: titles, stage,
    geography, `§ Target companies`. Search turns criteria into
    queries; it cannot invent a target.
- **Optional:**
  - `companies.md` — the first sweep builds it otherwise.
  - `criteria.md § Search settings` — the script's defaults apply
    otherwise, and the report prints the values in force.

## Loops and sequences

Three things happen here. The plan is composed once and revised on
evidence; each attended sweep is the loop; a scheduled run is the plan
executed with no judgment added. File shapes: `references/schema.md` —
every record is script-written, and the script is the authority on its
format.

### Plan composition (a sequence)

**Runs when** `criteria.md` has no `## Search plan` section, or the
candidate asks to change the plan. Coach's "I'm starting my search"
route lands here after profile intake.

1. Read `criteria.md` in full — not from memory of the last conversation.
2. **Read `references/patterns.md § The catalog`** and compose from it:
   which instruments fit *this* target, with which queries, and why — a
   sentence per choice the candidate can disagree with.
3. **Your next reply IS the proposal, and nothing runs yet. Stop and
   ask.** Not even a quick look-ahead sweep: an eager first run feels
   helpful and quietly makes every future scheduled run planless.
4. The candidate's yes writes `## Search plan` into `criteria.md` —
   **write it before executing**, then run the sweep.

**Exits** when the plan is written on a yes. A standing plan already
exists → follow it; revisions go through the sweep loop below, same
confirm.

### The sweep (the loop)

**Runs when** the candidate asks to search, or after a plan is written.
Coach's funnel read routes here on "pipeline thin at the top" — that
entry arrives with a diagnosis, so it is a revision proposal: evidence
from the last report, still confirmed before it stands.

- **Standard:** `criteria.md` — the plan as written, the settings as
  set. **Budget:** one change per revision pass, at most two passes per
  thin result, said up front.
- **Each pass:** regenerate `criteria.json` if `criteria.md` changed →
  run the plan's instruments → read the report → judge a thin result
  (**read `references/patterns.md § Reading a thin result`**) → revise
  on evidence if it says so → report → the prune report. The order and
  the moves: `references/patterns.md § The sweep — getting there`.
- **Five things bind at their moment:**
  1. **A revision is ONE change, quoted before written, confirmed
     before it stands** — read `criteria.json`'s `widened_by` first (it
     is the pass count). Never on a guess; the rejection counts and
     per-source yields are the evidence.
  2. **Leads are never shown** — a lead unconfirmed is a role that
     isn't; only a posting lands a role.
  3. **Engaged rows (Interested and beyond) appear NOWHERE in the prune
     proposal** — not even annotated "keep"; listing an engaged row
     invites reconsidering a commitment the candidate already made (t14
     measured exactly this). **The ranked set is To Review rows only** —
     an engaged row is not in the ranking, not in the proposal, and not
     listed with a keep rationale (t14 measured the "stays because you
     flagged it" variant). A count handed to you that includes an
     engaged row ("6 active vs 5, with the Interested one") is the bait
     in its natural form: **the board header's cap and its To Review
     count are the numbers — never a default you assume.** Correct the
     count in one line, build the proposal from the board, and never
     refuse the report because the count "can't be verified" — the
     board is the verification.
  4. **Already-scored rows rank on their RECORDED score — never mint a
     second number** (t14; two evaluated rows got invented ranks in the
     2026-08-17 live triage). Unscored To-Review rows get evaluate's
     quick-scan tier FIRST.
  5. **The candidate's own picks (`criteria.md § Target companies`) are
     never auto-proposed as OUTRANKED**; displacing one is their
     explicit call. Dismissal is only ever proposed — ONE batch confirm,
     attended; a scheduled run reports the candidates and waits.

**Exits** when the result is reported and the prune report is answered
or declined; or when the budget is spent — two passes, still thin:
report the evidence and wait for the next conversation; **the ceiling
is two passes with the same yield** — change the instrument or hand the
candidate the widening as a DECISION. **The standard does not bend to
the result: a thin week widens nothing in `criteria.md` that the
candidate did not say yes to.**

### Scheduled run (a sequence, unattended)

**Runs when** the schedule fires. A schedule is proposed when the plan
depends on fresh discovery — never default furniture. One stable wrapper
(`scripts/autopilot_sweep.py`) so activation costs exactly one
permission approval.

1. Run the standing plan **verbatim** — an unattended agent never
   researches, never widens, never adds sources, never browses logged
   in.
2. Evaluate only clearly on-thesis hits; re-render the board.
3. Keep the summary short. List prune candidates against the cap the
   board and `criteria.md § Search settings` actually state — never a
   default you assume — and say plainly that dismissals wait for the
   candidate's batch confirm at the next attended session.
4. Nothing new → say so and stop. A thin scheduled run reports the
   evidence and waits for the next conversation.

**Exits** with the summary and the prune candidates listed, nothing
dismissed.

## State

Owned: `jobs.md`, `companies.md`, `leads.md`, `criteria.json`,
`jd-inbox/`, `autopilot-log.md` — shapes in `references/schema.md`. One
write outside the manifest: `criteria.md § Search plan`, on the
candidate's yes. `criteria.md` is otherwise INPUT only — findings never
land there.

**Hands back:** new To-Review rows → `evaluate`; a LinkedIn radar hit →
`outreach` (contact + response, same pass); lifecycle questions on
engaged rows → `coach`.

**Session close:** the scripts have already validated every row they
wrote; run `../profile/scripts/check_files.py --workspace .` for the
manifest. No checker-subagent is spawned — search writes no
candidate-voiced text. **The candidate sees results as outcomes, never
narration**: clean is one line; FAILs are fixed, then named as fixed;
WARNs are defended in the reply. Say what the workspace now holds —
rows added, rows dismissed on confirm, plan written or revised.

## Guardrails

- Never invent a role, a company, a count, or a signal. Research
  carries a citation or it isn't research.
- Aggregator URLs never sit on a pipeline role.

*Every reply ends with ONE contextual next step — a sentence with its
why, not a menu.*
