# Coach — how to judge the work

`SKILL.md` names the destination; this file is how to tell it is
reached, and who checks.

## Who checks what

- **Structure and counts → two scripts.** `scripts/check_closeout.py` — the stage named, `plan.md` written this turn, a Waiting-on-you row for every question the reply declares it asked (the agent declares; the script checks the disk). `../../profile/scripts/check_files.py` — `plan.md`'s sections and the manifest. Pipeline writes go through `update_job.py`, which fails loudly on an ambiguous match.
- **Language against written rules → no checker-subagent.** Briefings
  and prescriptions are the coach's voice; the tone contract
  (`patterns.md § Tone`) is judged, not parsed.
- **Everything semantic → you, at the moment**: which stage is stuck,
  whether a number is meaningful yet, whether an item is avoided or
  forgotten.

## The destination, judged

- **Every reply is one of four kinds** — DECISION, ARTIFACT, TO-DO,
  STATUS — and names the stage the search is in. Anything else is the
  design drifting.
- **Every write the reply claims exists on disk before the reply ends**;
  every question asked became a Waiting-on-you row the same turn
  (saying "logged" without the write is fabrication — it happened
  twice in testing).
- **The numbers are honest** (t8-honesty-thresholds): no rate below
  five real outcomes — the count instead; no trend language under
  three time-separated points; only `dismissed=0` rows count; and the
  reply says WHEN the numbers become meaningful.
- **Nothing nagged, nothing gated** (t8-no-nag-no-gate): a skipped
  groundwork piece is named where it weakens something and comes back
  only when it blocks what they asked for; an item that survived two
  prescriptions got the conversation on its third appearance, not the
  item again.
- **The stage was sensed from the files, not asked** (t8-stage-sensing):
  what exists, what's missing, what it weakens.
- **A direct ask went to its skill, served first** (t8-routing); a
  chain was said in one line and its first step done; a prescription's
  blockers were checked before it was issued.
- **The prescription was prepared down to the candidate's minutes**: the
  only part left is theirs; it fits the budget; 1–3 items, ranked, each
  with its why.

## The mirror — the round, scored

The weekly review scores the week **planned-vs-actual**: of the
commitments written last mirror, which happened; the funnel read sized
to the thresholds; one pattern promoted to the focus. The standard is
the goal math (`patterns.md § The goal and the math`) and the budget
floor. **The ceiling**: a plan that hasn't happened two weeks running
is data about the plan or the person — the third mirror asks the real
question instead of repeating the plan, or raises the DECISION (more
minutes, a later date, a narrower aim).

## The progress review — graduation and change-approach

**Interview-ready**: 3+ sessions scoring 4+ across dimensions, none
consistently <3; 8+ stories with 5+ at 4+; competency gaps covered;
handles gap questions; self-assessment within 0.5. **Competitive bar**:
all dimensions 4+, 3+ earned secrets deployed fluently, 60%+
advancement. When met, say so: "you need the real thing, not more
practice." Flat 5+ sessions on one dimension → a different drill, not
repetition. Sustained 2–3 scores against a 4+ bar, or clustered
rejections → the retargeting conversation ("close the gap, or target
where your strengths fit — both valid"), routed to profile's direction
change.
