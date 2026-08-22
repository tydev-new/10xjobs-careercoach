# Eval — t4: what does the skill actually add?

**Date:** 2026-08-13 · **Issue:** #13 · **Harness:** `tests/always-on/run_t4.sh`

## The question

A live intake with the founder went well. How much of that was the skill,
how much the always-on guardrails, and how much the model? The live run
could not answer it: the coach had written the skill an hour earlier and
carried ~40k words of coaching prior art in context. This isolates it.

## Design

Synthetic candidate (Priya Raghavan, platform engineering — deliberately
not the founder's domain, to test generalization rather than recall) with
structural complexity matched to the real case: founder re-entering
employment, two distinct targets, long career, thin spots. **Seven
enumerated hazards planted in the résumé.** Two turns: "get me set up"
with the résumé in the folder, then the complexity reveal (two targets,
5 interviews / 2 final-round losses, 6-week wish).

Three conditions × 2 trials, Sonnet under test, Opus judging:

| | |
|---|---|
| **bare** | model alone |
| **guardrails** | + workspace `CLAUDE.md` |
| **full** | + the `profile` skill |

All conditions run `--setting-sources project` to exclude
`~/.claude/skills`. **This flag is load-bearing** — its absence
confounded the first Phase A run, where the user's installed
`interview-coach` fired in 4 of 9 treatment runs.

## Results

| | hazards caught | files written | criteria failed | hard fabrications |
|---|---|---|---|---|
| bare | 0/7 · 0/7 | 0 · 0 | 7 · 7 | 0 |
| guardrails | 0/7 · 0/7 | 2 · 4 | 6 · 7 | 0 |
| full | 1/7 · 1/7 | 4 · 6 | **3 · 2** | 0 |

Diagnosis (two final-round losses → differentiation/credibility, not
résumé or volume): **correct in 6 of 6**, every condition.

## What each layer actually contributes

**The model** brings the analysis. It read the funnel correctly with no
skill and no guardrails, every time. It also wrote **nothing to disk**,
twice — the capability that does not arrive with model strength.

**`CLAUDE.md`** buys persistence and brevity, not quality. Files appear
(it names `profile.md` and `criteria.md` in one line, and that is enough
to make them exist), but the judge's read of their contents is the
finding: *"`profile.md` is a reformatted transcription of the résumé —
section-for-section, bullet-for-bullet — with the only added content
being four logistical TODOs; it produces no positioning read."*
Guardrails **file** the résumé. That is the exact failure the skill's own
closing line names.

**The skill** more than halves the failure count (≈7 → ≈2.5) and is what
turns filing into analysis: the four findings, the fact layer
(`base-resume.md`), and the plan. It also suppresses hazard *repetition*
— conditions without it restated planted claims as established fact
("$40M saved", "reduced incidents 70%") in 3 of 4 runs; the full
condition, 0 of 2.

## Two prior claims this falsifies

1. **"Claim-rules seeding is the skill's contribution."** Stated
   confidently during the live-run attribution. A fresh session with the
   skill catches **1 of 7** planted hazards. The instruction was one
   table row with a two-item parenthetical pointing at `facts-ssot.md`,
   a reference the model does not load. The catch during the live run was
   contamination.
2. **"The transition enumeration should be deleted because the model
   derives it."** The reverse: fresh runs missed **founder→employee in 5
   of 6**. The list should be *extended*. The original reasoning
   generalized from a contaminated sample of one.

Both errors share a shape: **the coach's own competence read as the
artifact's competence.** That is what an isolated harness is for.

## Fixes applied

1. **Hazard taxonomy inlined and enumerated** (8 rows) in `intake.md`,
   replacing the parenthetical-plus-pointer. A general instruction to
   check ambiguous claims does not work; the list is the mechanism.
2. **Founder/co-founder re-entry added** to transition detection, with
   its specific question.
3. **Timeline reality check added** — the check previously fired only on
   role mismatch. An offer target inside ~8 weeks at Head-of level was
   missed in 5 of 6 runs.

## Open

- **The diagnosis map: deleted 2026-08-13.** t4 evidenced the
  final-round branch (6/6 unaided); the founder's live intake evidenced
  the no-callbacks branch (derived unaided, with the separating fact).
  The first-round branch is untested — P2.11's default applies (no
  receipt → delete), and live use is the standing test.
- **No condition passed overall.** The bar is deliberately strict; the
  useful signal is the gradient, not the pass/fail.
- Only the `profile` skill was loaded in the full condition, so this
  measures intake in isolation, not the 12-skill system.

---

## Re-run 2026-08-19 — tag `intakecut` (TRIALS=2, all three conditions)

Run to satisfy PRINCIPLES 11 after #34 cut 77 words from `intake.md`
(the header's pre-statement of the extraction gate, one motivation
sentence, and `§ Mid-search update` inlined into SKILL.md mode 3).
The revert condition was stated before the run: a drop in hazard
catches reverts the header cut.

| | hazards caught | criteria | overall | hard fabrications |
|---|---|---|---|---|
| bare | 0/7 · 0/7 | 7/16 · 8/16 | fail · fail | 0 |
| guardrails | 0/7 · 0/7 | 10/16 · 11/16 | fail · fail | 0 |
| **full** | **7/7 · 6/7** | **16/16 · 16/16** | **pass · pass** | 0 |

**No regression — the cut holds.** Also the first time any condition has
passed overall; the original run recorded "No condition passed overall."

**Attribution, stated honestly: this gain is not the cut's.** The move
from 1/7 to 6–7 of 7 belongs to the 2026-08-13 fix that inlined and
enumerated the hazard taxonomy, plus everything since. What this run
establishes is narrower and is exactly what it was run to establish:
removing 77 words did not cost hazard-catching. Reading it as evidence
that the cut *improved* anything would be the same error the record
already names — the coach's competence read as the artifact's.

Two things worth keeping:

- The gradient is now stark. Bare and guardrails catch **zero** hazards
  across four trials; the skill catches 6–7. The enumerated list remains
  the mechanism, and nothing about a general instruction has changed.
- `full-t1` flagged "serving 12M monthly active users" as a platform
  number in its hazard table and then used "12M MAU" inside a story
  seed. The judge scored the MUST NOT — "no hazard repeated as
  established fact without qualification" — as **pass** in both trials.
  Recorded because it was noticed and called ambiguous before the judge
  ruled, and the ruling is the record, not the noticing.

**What this does NOT decide.** It says nothing about whether splitting
`intake.md` would preserve hazard-catching, because nothing was split —
the hazard table sat in the same file throughout. The split question
(#34) needs its own arm: the same case against a tree where the table
lives behind a pointer. Until that exists, the "1 of 7" measurement
still speaks only to enumerated-list-vs-general-instruction.

---

## Re-run 2026-08-20 — tag `shapev1` (TRIALS=2, all three conditions)

Run to satisfy PRINCIPLES 11 after the #36 shape conversion: profile
rebuilt as a loop orchestrator (goal table, sequences/loop with triggers
and exits, eval/schema/patterns references, intake.md dissolved), plus
the trim, the table merge, the schema split, and the spec alignment —
five structural rounds since `intakecut`.

| | hazards caught | criteria | overall | hard fabrications |
|---|---|---|---|---|
| bare | 0/7 · 0/7 | 10/16 · 8/16 | fail · fail | 0 |
| guardrails | 0/7 · 0/7 | 8/16 · 10/16 | fail/none | 1 (t1) |
| **full** | **7/7 · 6/7** | **16/16 · 16/16** | **pass · pass** | **0** |

**Identical to the `intakecut` baseline on every full-condition number.**
Five structural rounds of the shape conversion cost zero measured
behaviour — which is the claim the token-preservation checks made and
this run corroborates. One new behaviour: both full runs wrote `plan.md`
(the goal + time-floor row), which no baseline run did — the goal table
doing its job.

Scope note: t19-intake / t19-folder-repo remain unmeasured post-
conversion — the tag `t19-shapev1` is VOID (the runner's HOME sandbox
cannot reach Keychain-held auth; see its VOID.md). The conversion's
conversational conduct is therefore vouched for by t4's two-turn flow
only until the sandbox auth is fixed.

