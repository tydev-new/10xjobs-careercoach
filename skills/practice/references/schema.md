# Practice — the file shapes

What the files must hold. No script parses them; the shapes are
declared so their readers — coach's sense step and progress review
(the top of the log), prep's sourcing ladder (the bank) and freshness
checks (story use counts), positioning (TMAY landing) — find things
where they expect them. `../../profile/scripts/check_files.py` checks
the manifest.

## `practice-log.md` — the Scoreboard, latest row FIRST

A table front-loaded at the top of the file, newest row on top, because
consumers read the top. Columns, as the live file has them: `Date · Mode · Target · Score (per dimension + band used) · Delta (self-assessment) · Root cause · One change · Transcript · Outcome`. A session that ends after a feedback-carrying warmup with no scored round STILL writes both the row and the session file — the row marked "warmup — unscored", carrying the assigned one-change (assignments must survive the session; scores never attach to warmups). A real interview
gets a **round record** row (company + round; result `pending` until
the outcome lands) — continuation prep reads it here.

## `question-bank.md` — real questions only

`| date | company | round | question | competency | read | notes |` —
ONLY questions actually asked of THIS candidate in a real interview;
researched or generated questions are never banked (that exclusivity is
why a banked question outranks everything in prep's ladder). `read` =
the debrief's `strong` / `okay` / `rough`, upgraded to a scored status
after transcript analysis. Approximate wording is marked so.

## `practice/<date>-<mode>-<slug>.md` — the session record

`mode` is `drill` / `mock` / `real` (a debrief: `<date>-real-<company>.md`) / `transcript`. Every session that carried feedback, scored or a warmup: the questions, the candidate's answers verbatim, scores + feedback (a warmup's row says unscored). A
candidate-supplied real-interview transcript is saved here verbatim
BEFORE any scoring. A real interview with no transcript still gets its
file — the debrief's own Q&A capture (questions, reads, the candidate's
account). Never the `prep/` brief,
which is overwritten on re-prep and would lose real-interview data.

## `composite-target.md` — the waiting mode's target

Synthesized from the top jd-analyses: frequency-weighted competencies,
the union of predicted-question themes, the likely interview formats
across those roles, any format two-plus targets imply that has no
`courses/<slug>.md` (a course gap). **A stamp line**: synthesis date +
source roles; a declined refresh is noted on the stamp line with its
trigger.

## `negotiation/<company>.md` — a stated number's record

A comp number STATED in a round: the number, the date, who heard it. STATED numbers only — prep's day-of sheet reads it so the candidate stays consistent across rounds. Practice is its only writer since negotiate was removed (2026-08-19).

## Writes into files practice does not own — direction rules

- `storybank.md` — ONLY the Use Count / Last Used / Notes columns after
  a real interview; a new story told live is captured in storybank's
  record format, status `confirmed`; answering on a drilled `draft`
  confirms it — Status updated same turn.
- `base-resume.md § Claim rules` — a claim the candidate conceded under
  pushback is struck NOW: a ⚠ never line, the struck form in double
  quotes + what to say instead. Anything they ruled on is written; a new fact or an unruled conflict is PROPOSED, never written (`../../profile/SKILL.md § State`).
- `company/<slug>.md` and `jd-analysis/` — a fact this round
  contradicted or confirmed, corrected at its source, dated; a dated
  interviewer-conduct culture note.
