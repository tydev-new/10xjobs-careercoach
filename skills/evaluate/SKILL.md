---
name: evaluate
description: Use this skill when the candidate wants to evaluate a role, a job description, or a company — e.g. "should I apply to this?", "evaluate this role at Writer", "decode this JD", "research this company", "compare these three roles". Produces one combined verdict from JD decoding + company research, persists the analyses, and records the verdict in the pipeline record (jobs.md).
---

# Evaluate — role + company, one verdict

## Goal

One decision-ready verdict per role — what the JD actually says
(decode) and what the company actually is (research), combined into a
tier the candidate can act on. **The candidate decides whether to
apply; you provide the odds.** The full analyses persist as files the
candidate and every later skill can drill into. Scored by
`references/eval.md`.

| Must be true | Where |
|---|---|
| The verdict is recorded, one row, by the script, with the row's exact existing company + title | `jobs.md` |
| The track is assigned first and named in the verdict, the row, and the analysis header (when `criteria.md` defines tracks) | all three |
| A hard dealbreaker is dismissed with its quoted reason BEFORE any research is spent | `jobs.md` row, reason `dq:` |
| The decode is on file: six lenses with confidence labels, competencies, five-dimension fit | `jd-analysis/<company_key>-<title_key>.md` |
| The company brief is on file: tiered claims, dated, with what could NOT be found | `company/<slug>.md` |
| Every LOW and UNKNOWN finding ships with a recruiter question | the analysis and the card |
| The cheap tier is stamped `quick-scan:` and a graduation names the prior score | `jobs.md` reason · the reply |
| The reply is the summary card; the files carry the depth | the reply |

## Prerequisites

- **Required:**
  - a workspace `CLAUDE.md`. None → the workspace isn't set up; run
    profile's Setup before writing any file. (Every skill is a door a
    NEW candidate can walk through first — goal 2's blocking gap.)
  - a JD in any form (full posting, paste, rough description) or a
    company name. No JD → research-only mode: assess the three
    company-side fit dimensions and say explicitly that requirement
    coverage and competency overlap need the JD.
- **Optional:**
  - `profile.md` + `criteria.md` — they ground every fit assessment.
    Absent → decode language only and say fit can't be assessed.
  - `storybank.md` + `stories/` — competency matches cite story
    evidence, the highest-confidence fit.
  - an existing `company/<slug>.md` — reused across roles; staleness
    decides a refresh (step 4).
  - a `jobs.md` row from a sweep — its `jd_file` points at the saved JD
    in `jd-inbox/`; check it before asking the candidate for the JD.

## Sequences

**Evaluate has no loop.** A verdict is rendered once per role and a
re-evaluation replaces it (the script upserts); the quick-scan tier and
batch mode are depths of the same sequence, not rounds of convergence.
Craft — the lenses, the research sources, the fit dimensions:
`references/patterns.md`. File shapes and the card:
`references/schema.md`.

### Full evaluation (the sequence)

**Runs when** the candidate asks about a role or company. Callers:
coach ("should I apply to this?" → here, then apply on a strong
verdict; "get me ready for the interview" → here first when no analysis
is on file; "evaluate the top picks" after a sweep); apply and prep
send a role here when it has no `jd-analysis/` file.

**The order** — intake → dealbreakers → track → company research →
decode → verdict → record → the card — and its moves: **read
`references/patterns.md § Full evaluation — getting there`**, then
`§ Company research` and the lenses before decoding, and
`references/eval.md § The verdict tiers` before the verdict.

Six things bind at their moment:

1. **A near-match IS the row.** The candidate's words nearly matching
   one `jobs.md` row (same title, same JD — "Quorvex AI" for a swept
   "Quorvex Systems") resolve to that row: say which, proceed. Ask only
   when two rows could match; a name mismatch is never a reason to
   deliver nothing (t6).
2. **Dealbreakers before ANY research spend.** A hard hit against
   `criteria.md § Dealbreakers` / `§ Compensation` / `§ Geo` is a DQ:
   record the dismissal NOW (`../search/scripts/update_job.py dismiss`,
   reason `dq: <the quoted dealbreaker>`; a row-less paste first gets a
   `weak`/0 row via `scripts/record_verdict.py`, same reason), then
   **stop** — and the reply names the dealbreaker and stops there: no
   consolation about comp or location, no "softer than it reads"; the
   candidate wrote the criterion (t14, both). Ambiguous (comp unstated,
   location unclear) is NOT a DQ — a verification question, and proceed.
3. **The track is assigned before judging**, when `criteria.md §
   Targets` defines more than one — named in the verdict, recorded in
   the row, stamped on the analysis header (t6).
4. **Close the decode by showing your read of the bar** and ask once —
   *"anything you know that the posting doesn't say?"* — answerable by
   silence, never pressed; an answer is a dated line in the analysis.
5. **The want side never moves the tier.** The tier answers "would they
   hire you?"; company-side findings may move it, wanting it never
   does. Caveats that aren't disqualifying go in the card's Flags.
6. **Record on the row's EXACT existing strings** — the canonical key
   strips inc/llc/corp but not "AI"/"Senior", so "Baseten AI" creates a
   duplicate against a swept "Baseten". The script says whether it
   created or updated; an unexpected "created" means the strings
   drifted — fix and re-run (t6).

**Exits** when the row is recorded and the card
(`references/schema.md § The summary card`) is the reply. **The tier
does not bend to the want: a role the candidate loves is scored exactly
as one they don't.**

| Procedure (in `references/patterns.md`) | Runs when | Exits with |
|---|---|---|
| Deep-decode extras | a high-priority target, a seniority mismatch, an unusual JD | seniority calibration, structural read, challenge pass in the analysis |
| Batch triage | 2–5 roles arrive together ("compare these three") — after each role's own verdict | ranking, the market-validated sweet spot, an honest allocation |
| Teaching layer | every standard evaluation | Pattern spotted · Trap · Next time, try — in the analysis |
| Positioning, not role fit | broad targeting with no thesis shows through | a routed flag to `positioning` or `profile`; the score unmoved |

### The quick-scan tier ("triage these" / batch / the pipeline is over cap)

**Runs when** volume calls for the cheap verdict — the candidate asks
to triage, a batch arrives, or search's prune report needs unscored
To-Review rows ranked.

1. The DQ gate (step 2 above) — always.
2. Decode against `criteria.md` + `profile.md` ONLY — **no company
   research, no company file, no jd-analysis file.** (Cheaper than even
   the research depths in `references/patterns.md`; their "Quick scan"
   is a RESEARCH depth, not this tier.)
3. Record the verdict with **`quick-scan:` prefixed in the row's Reason
   field** — the durable stamp, so it is never mistaken for the full
   treatment.
4. An already-scored row keeps its recorded score — never mint a
   second number for ranking (t14 measured two).
5. Survivors graduate to the full sequence before the candidate spends
   real time. The graduation NAMES the prior tier and score ("was
   quick-scan 72 → full evaluation: 68") — the cheap verdict's existence
   is part of the honest read, never hidden (t14 measured the omission).
6. Borderline scores — within ~5 of the batch fit floor of 70 (the
   number's one home is `../apply/SKILL.md § Batch prep`) — are shown as
   one-liners; full evaluation only on the candidate's pick.

**Exits** when every row in the batch carries a stamped verdict and the
candidate has picked, or declined to pick, the ones to graduate.

## State

Owned: `jd-analysis/`, `company/` — shapes in `references/schema.md`.
One structured write outside them: the verdict row in `jobs.md`, by
`scripts/record_verdict.py` only.

**Hands back:** a strong verdict → `apply`; an interview on the
calendar → `prep` (it reuses the analysis, never re-derives); a broad-
targeting finding → `positioning` or `profile`, never the fit score;
competency extractions → `storybank` (rung 1 of its coverage map) and
`learn` (sightings by track).

**Session close:** run `../profile/scripts/check_files.py --workspace .`
for the manifest; the verdict script has already validated its row. No
checker-subagent is spawned — the analyses are the analyst's voice, not
the candidate's. **The candidate sees results as outcomes, never
narration**: clean is one line; FAILs are fixed, then named as fixed;
WARNs are defended in the reply. Say what the workspace now holds — the
verdict, the two files, a dismissal if one happened.

## Guardrails

- **Honest verdicts, no gatekeeping.** A stretch is not "impossible";
  fit is evidence, never vibes. For Weak/Long-Shot verdicts, name the
  specific gaps and suggest what a better-fit version of the role looks
  like. Respect their agency if they proceed anyway.
- **Never synthesize uncertain sources into a confident claim.**
  Conflicting sources → present both. Older than 12 months → flag it
  ("from [date] — verify it's still current").

*Every reply ends with ONE contextual next step — a sentence with its
why, not a menu.*
