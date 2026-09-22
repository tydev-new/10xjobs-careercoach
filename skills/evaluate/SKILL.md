---
name: evaluate
description: Use this skill when the candidate wants to evaluate a role, a job description, or a company — e.g. "should I apply to this?", "evaluate this role at Writer", "decode this JD", "research this company", "compare these three roles". Produces one combined verdict from JD decoding + company research, persists the analyses, and records the verdict in the pipeline record (jobs.md).
---

# Evaluate — role + company, one verdict

## Goal

One decision-ready verdict per role — JD decoding combined with company research into an actionable tier. **The candidate decides whether to apply; you provide the odds.** Scored by `references/eval.md`.

| Must be true | Where |
|---|---|
| Verdict recorded in `jobs.md` via script with exact company + title strings | `jobs.md` |
| Track assigned first and named in verdict, row, and analysis header | all three |
| Hard dealbreakers dismissed immediately with quoted reason before research spend | `jobs.md` (`dq: <reason>`) |
| JD decode on file (lenses, confidence labels, competencies, 5-dim fit) | `jd-analysis/<key>.md` |
| Company brief on file (tiered claims, dated, knowledge gaps noted) | `company/<slug>.md` |
| Cheap tier stamped `quick-scan:` and graduations note prior score | `jobs.md` reason · chat |
| Summary card delivered in reply | reply |

## Prerequisites

- **Required:** Workspace `CLAUDE.md` (none → profile's Setup); JD or company name.
- **Optional:** `profile.md` + `criteria.md` (grounds fit scoring), `storybank.md` (competency evidence), `company/<slug>.md` (cached research).

## Sequences

Decoding lenses, fit algebra, and company research craft live in `references/patterns.md`. Verdict tiers in `references/eval.md`.

### Full evaluation (a sequence)

**Runs when** candidate asks about a role or company, or other skills route for a missing analysis.

1. **Near-match check:** Match against existing `jobs.md` rows before creating duplicates.
2. **Dealbreaker gate:** Evaluate against `criteria.md § Dealbreakers` / `§ Compensation` / `§ Geo`. Hard hit $\rightarrow$ record the DQ immediately (no row yet → create it first; exact commands in `references/patterns.md` step 2, "Dealbreakers") and stop before research spend.
3. **Track assignment:** Assign track from `criteria.md § Targets` before judging.
4. **Company research & Decode:** Research company signals and decode JD across the 6 lenses (`references/patterns.md`).
5. **Verdict & Record:** Combine into final verdict tier — Strong Fit (`strong`) / Investable Stretch (`investable_stretch`) / Long-Shot Stretch (`long_shot`) / Weak Fit (`weak`). Record via `scripts/record_verdict.py --verdict <value>`.
6. **Deliver summary card:** Present the evaluation card in chat (`references/schema.md § The summary card`).

**Exits** with `jobs.md` row updated, analyses persisted to disk, and summary card delivered.

### Quick-scan tier (a sequence)

**Runs when** high volume calls for a lightweight screening pass (batch triage, pipeline over cap).

1. Run Dealbreaker gate.
2. Decode fit against `criteria.md` + `profile.md` only (skip company research file and full jd-analysis file).
3. Record verdict with `quick-scan:` prefix in `jobs.md` Reason field.
4. Graduate selected roles to full evaluation before human investment, noting previous score.

**Exits** when batch is scored and candidate selects roles for full graduation.

## State

Owned: `jd-analysis/` and `company/` (shapes in `references/schema.md`).

- **Hands back:** Strong verdict → `apply`; interview booked → `interview`; competency extractions → `storybank`.
- **Session close:** Run `../profile/scripts/check_files.py --workspace .`. No checker-subagent is spawned (analyst voice). Report outcomes, never narration (clean is 1 line; fix FAILs before reply ends).

## Guardrails

- Honest verdicts based on evidence, never cheerleading or artificial pessimism.
- Never synthesize uncertain sources into confident claims; conflicting data is explicitly presented.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
