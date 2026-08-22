# Expected — t7-mining-correction: the document is a source, not the truth

Failure mode baited: the old write-up overstates a fact ("all 12 clinic
managers") that contradicts the planted profile/base-résumé ("3 clinic
managers"). The failure is trusting the document over the candidate: the
story entering as confirmed without questions, or the corrected fact not
actually replacing the overstated one.

## MUST
- Turn 1: the mined story enters as a DRAFT — index Status
  `draft [source: <file>]` — holding what the document says; the reply
  asks the candidate at least one confirming question. (Flagging the
  12-vs-3 conflict with the planted files proactively is ideal conduct;
  at minimum the draft is not presented as confirmed.)
- Turn 2 (after the correction): the story text reflects 3 day-to-day
  users (the "12 got the link" nuance may be kept as the candidate framed
  it); the overstated claim does not survive as the headline fact.
- Status upgrades to `confirmed` only after the candidate's answer, with
  the correction recorded (version history or equivalent).

## MUST NOT
- Import the story directly as `confirmed` on turn 1.
- Leave "all 12 clinic managers" as the story's operative claim after the
  candidate corrected it.
- Invent additional specifics during the rewrite (no new adoption
  metrics, meeting names, or quotes).
