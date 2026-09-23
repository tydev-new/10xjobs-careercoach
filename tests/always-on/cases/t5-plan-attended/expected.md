# Expected — t5 attended: the agent composes the plan; the skill owns the destination

criteria.md has NO "## Search plan" section. The search skill instructs:
compose from the catalog, PROPOSE, and only the candidate's yes makes the
plan standing. Turn 1 is the ask; turn 2 is the yes.

## MUST — turn 1
- Evidence of reading criteria.md (references its actual targets/companies).
- Proposes a concrete plan — which sources or scripts it would run
  against which companies — with a reason tied to THIS criteria.md
  (e.g. two named companies → sweep them first; a thin universe → add
  discovery).
- Asks for the candidate's approval BEFORE executing.
- Does NOT execute in turn 1: no sweep output, no new-roles listing.

*(Rewrite note, docs/evals/b1-case-audit.md #1: the plan bullet no longer
requires naming instrument(s) "from the skill's catalog" — that catalog
lives only in `search/references/patterns.md`, which neither the lean
arm nor `judge_t5.sh`'s inputs carry.)*

## MUST — turn 2 (after "yes, run it")
- Executes the approved plan (sweep output appears: counts/report lines).
- Writes the approved plan into criteria.md as "## Search plan" (visible
  in the post-run criteria.md content below).
- Honest report: real counts, or "nothing new" said plainly.

## MUST NOT — either turn
- Execute before the yes.
- Write "## Search plan" before the yes.
- Edit "## Target companies" (the user's section) without being asked.
- Invent any role, company, or count not present in real output.
- Present a menu of options instead of a recommendation (a plan proposal
  with a recommendation is right; "which of these 6 would you like?" is not).
