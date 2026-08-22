# Positioning — how to judge the work

`SKILL.md` names the destination; this file is how to tell it is
reached, and who checks.

## Who checks what

- **Structure and counts → `../../profile/scripts/check_files.py`**: the
  `pitch.md` schema, the brief's sections, the history header and cell
  counts. Run at session close.
- **Language against written rules → no checker-subagent is wired for
  the pitch yet** — a known gap, stated rather than papered over: the
  pitch's self-loop is judgment-only, at most two passes. The do/never
  table (workspace `CLAUDE.md`) and the trace rule
  (`../../profile/references/candidate-voice.md`) still bind every
  candidate-voiced line.
- **Everything semantic → you, at the moment**, with the candidate's
  confirmation as backstop: does it sound like them, is the claim
  evidenced, was the mismatch ruled on.

## The core statement

- **The substitution test — mandatory, every core statement.** Swap in
  another same-level candidate's name: if the positioning still works,
  it is not differentiated and it is not done. The single best test in
  the corpus.
- **The anti-pattern check, every draft**: does it OPEN with a problem
  instead of the candidate's value? Problem-first is the "arrogant
  doctor" pattern — caught live 2026-08-15 when a drafted core opened
  "frontier products fail…".

## The diagnostic — scoring an existing pitch

Score 1–5 per dimension, then fix the primary weakness, minimum change
first: **hook strength · differentiation** ("could another candidate say
this?") **· specificity · audience fit · memorability.**

**Deep checks** (high-stakes, or on request):
- **Differentiation audit** — defensible (evidence, not claim)? spiky
  (would some people disagree)? earned vs borrowed?
- **Constraint ladder** — the same positioning at 15/30/60/90 seconds;
  what survives every compression is the irreducible core.
- **Challenge pass** — assumptions, blind spots, devil's advocate, the
  one strengthening move.

## The variants

Judge each against its spec row in `schema.md` — length and shape are
contracts, not suggestions — and against the pinned Messages rubric when
one exists.

## The rubric and the headline

- The Messages rubric is either pinned or explicitly marked PROPOSED —
  never silently treated as authoritative.
- After any pitch change, `profile.md`'s Snapshot headline line matches
  the pitch. One line, checked by reading both.

## The consistency check

Résumé summary ↔ LinkedIn headline/About ↔ pitch must tell ONE story.
The output is the specific rewrite per surface, never just the flag —
"your résumé leads with X but your LinkedIn leads with Y — a recruiter
reading both will notice."

## The LinkedIn audit, judged

- Audited only what was actually SEEN — unseen sections named, never
  guessed. Absence is assertable only from the candidate's word or a
  visible empty-state prompt, never from render evidence. Fail toward
  MISS, never WRONG.
- Every section gets a REWRITE, not a flag.
- The report carries Conflicts and Gaps against the authoritative files.
- The identity gate ran before anything was audited — the opened page's
  title+company matched the candidate's files.
