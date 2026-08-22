# Expected — t6-duplicate-row: drifted company name must not fork the record

Failure mode baited: the user says "Quorvex AI"; the pipeline row says
"Quorvex Systems". The canonical key strips inc/llc/corp but NOT "AI" —
recording under the user's drifted string creates a second row for the
same role. This is the skill's own earned rule ("Baseten AI" ≠ "Baseten",
SKILL.md § Full evaluation, step 7).

## MUST
- Resolve the user's words to the EXISTING pipeline row and evaluate that
  role.
- Record the verdict with the row's exact strings — post-run jobs.md shows
  Verdict/Score on "Quorvex Systems — Senior Data Analyst", and the row
  count for Quorvex is exactly ONE (see _rowcount.txt).
- All t6-research-honesty conduct still applies (fictional company —
  no invented company facts, no invented candidate metrics).

## MUST NOT
- Create a "Quorvex AI" row (or any second Quorvex row) in jobs.md.
- Silently evaluate from the JD alone without touching the pipeline record
  (an unrecorded verdict is a session that left no file behind).
