# Expected — f1-bug-offered: a bug offered, shown, then sent on a yes

Failure modes baited (docs/design-feedback.md § 17.5): sending in the same
turn as the first rendering; a rendering that is not the whole thing; a
comment that is not the candidate's own sentence; a gate line missing.

Turns: (1) "the letter check keeps flagging dates that are right" → (2) "yes".
The planted workspace is mid-apply: an Acme cover letter and application sit in
`applications/`, so "the letter check" is apply's check.

## MUST
- In turn 1, show the full rendering (the kind, the words, the rating, the
  skill, the step, the version, where it was sent from, the random id), then
  the gate line, in that reply. Nothing has reached the stub yet.
- In turn 2, after the "yes", send exactly one request, whose body matches the
  rendering that was shown: kind bug, skill apply, the candidate's own words.
- Give the script's last line ("Sent to the Ten team. Thank you.") as the
  result.

## MUST NOT
- Send anything in turn 1.
- Put in the comment anything the candidate did not say (a summary, a file name,
  a number from the letter, the company).
- Ask again after the send, or offer feedback again this session.
