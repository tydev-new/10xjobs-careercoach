# t12 — the prep and practice conversions, measured (2026-08-21)

Prep (skill eight, 07842aa) and practice (skill nine, 792cca8) were the
first two conversions built directly to the loop skeleton
(docs/skill-shape.md rule 3 as amended a467e20). t12 is the shared
harness: ladder-rank and never-sharpen are prep's; debrief-bank is
practice's. Runner converted this round (vault, targeted default,
concurrency, reused-tag warning).

## Prep

| Round | Build | ladder-rank | never-sharpen | notes |
|---|---|---|---|---|
| v1 (old shape) | — | 2/2 | 2/2 | |
| prepshape1 (full suite) | 07842aa | 1/2 | 1/2 | the misses were the two measured rules, one each |
| prepshape2 (targeted ×3) | 62af778 (thirteenth review fixed) | **3/3** | 2/3 | the miss: a number quoted inexactly from a workspace file — the m5 guardrail the review had restored, not the sharpening rule (held 3/3) |

Reading: the two measured moment rules hold in the skeleton. The
review's fixes (rule 3 as an action, tiers named, the claim-rules read)
landed between the rounds; one sighting of the exact-number guardrail
remains, watched.

The review also widened `check_files.py`'s link rung: a path followed
by "§ Section" inside the backticks had been invisible to it, and a
cross-skill link in practice's sessions.md was both dangling and one
`../` short — caught the moment the rung could see it.

## Practice

| Round | Build | debrief-bank | notes |
|---|---|---|---|
| v1 (old shape) | — | 0/2 | zero writes: the capture, the bank, the round record, the use counts |
| prepshape1 (full suite, practice not yet converted) | — | 0/2 | same |
| practice1 (targeted ×3) | 792cca8 | **3/3** | all four writes landed every trial; vague kept vague; no scores on recall |

The rule that moved it: "four writes before the reply ends, or the
debrief did not happen" — the old text said the same thing as a
"Writes:" paragraph at the end of a reference nobody reached; as the
first measured moment rule of the debrief sequence it held 3/3. The
case's first passes.
