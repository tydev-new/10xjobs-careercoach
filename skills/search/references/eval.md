# Search — how to judge the work

`SKILL.md` names the destination; this file is how to tell it is
reached, and who checks.

## Who checks what

- **Structure and counts → the scripts.** Every record search owns is
  script-written and script-validated: `search_ats.py` validates the
  rows it writes, `criteria.json` hard-rejects unknown keys and bad
  types and warns loudly when stale, `update_job.py` loud-fails on
  ambiguous matches, and `../../profile/scripts/check_files.py` checks
  the manifest at session close.
- **Language against written rules → no checker-subagent.** Search
  writes no candidate-voiced text; there is nothing for it to check.
  Stated so nobody wires one for the sake of it.
- **Everything semantic → you, at the moment**: whether a role is
  on-thesis, whether an archetype-research proposal carries a real
  signal, whether a thin result is query design or a dead channel.

## The destination, judged

- **Roles landed** — every new on-thesis role sits in `jobs.md` at "To
  Review" with its JD saved in `jd-inbox/` and the employer's own URL
  (a hiring-manager post: the post URL).
- **The report is honest** — counts, rejection reasons, yield per
  source, the effective settings. "Nothing new matched this week" is a
  real answer. **A fabricated role is the worst failure available
  here** — a single invented posting fails the run outright.
- **The plan is confirmed before anything runs** — `criteria.md
  § Search plan` exists and was written on the candidate's yes; no sweep
  predates it. (t5-plan-attended measures this.)
- **A scheduled run changed nothing about the plan** — executed
  verbatim, no widening, no new sources, no research.
  (t5-plan-scheduled measures this.)

## Plan quality

A good plan names, for *this* target: which instruments, with which
queries, and why each fits — addressing and authority stated per the
catalog. It is composed from `criteria.md` read in full, not from the
last conversation's memory.

## Revision discipline, judged

Judge against `../SKILL.md § The sweep`: was every change quoted before
it was written, confirmed before it stood, one per pass, no more than
two passes — and did the evidence (rejection counts, per-source yield)
name it, or did a guess? A widening the candidate never said yes to
fails the run.

## The prune report, judged (t14-measured)

Judge against the three exits in `../SKILL.md § The sweep`. The
failures t14 caught, in order of how often they recur: an engaged row
listed at all (even as "keep") · a second number minted for an
already-scored row · a candidate's own pick proposed as outranked · a
dismissal executed without the batch confirm · a row called dead on
uncertainty.
