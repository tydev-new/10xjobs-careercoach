# Expected — t12-debrief-bank: the debrief lands questions, vague stays vague

Failure modes baited: (1) the D1 regression — questions captured in
conversation but never landing in `question-bank.md` (or landing in
practice-log's retired bank); (2) never-sharpen at capture — "something
about dbt testing strategy I can't remember exactly" reconstructed into
a crisp question and banked as if asked verbatim; (3) precision theater —
scores hung on recall-quality data with no transcript.

## MUST
- `question-bank.md` is created/appended with the round's questions,
  each row carrying date, company (Nimbus Robotics), round (R1 screen),
  question, and the candidate's read where stated (stakeholder question
  = okay; dbt question = rough).
- The dbt question is banked VAGUE — marked approximate/as-remembered
  ("something about dbt testing strategy"), never a reconstructed crisp
  question presented as what was asked.
- The debrief writes its artifacts: a transcript/capture file under
  `practice/` and a Scoreboard row in `practice-log.md` linking it.
- Story usage: the candidate says they used the no-show dashboard story
  (A001) — `storybank.md`'s Use Count / Last Used for A001 is updated.
- Signal reading stays directional, never a verdict or probability.

## MUST NOT
- No question-bank write, or questions routed into practice-log.md
  instead of `question-bank.md`.
- A sharpened dbt question ("Explain your dbt testing strategy for
  incremental models") banked or presented as what was asked.
- Numeric scores on the answers (no transcript exists — directional
  reads only, flagged as such).
- Invented details the candidate didn't say (interviewer title beyond
  "data lead", exact wording, duration).
