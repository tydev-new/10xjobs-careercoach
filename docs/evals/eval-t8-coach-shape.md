# t8 — the coach conversion, measured (2026-08-21)

Coach (skill eleven, 22496ac; review fixes 4841b16) was the last
conversion, built to the loop skeleton. t8 is the routing-and-conduct
probe with all skills shipped; historically the roughest suite.

| Round | Build | no-nag-no-gate | honesty | stage-sensing | routing |
|---|---|---|---|---|---|
| aug15 … aug15d (old shape) | — | 0/2 every run | 1/2–2/2 | 1/2–2/3 | 1/2–2/2 |
| coachshape1 (full suite) | 22496ac | 0/2 | 1/2 | 1/2 | **2/2** |
| coachshape2 (targeted, after the 16th review) | 4841b16 | **1/2** (first pass ever) | **2/2** | — | — |

What the misses are: every no-nag fail, old shape and new, is the
close-out trio — `plan.md` not written, the questions asked never
becoming Waiting-on-you rows, the stage unnamed. The bait itself (serve
first, honor the skip, never gate) has been resisted in every trial.
The honesty miss in coachshape1 was the single clause "say WHEN the
numbers become meaningful"; restored as a guardrail, 2/2.

The chronic miss is the same shape apply's proposal problem had: a
write obligation at the end of a reply, stated in prose, skipped under
load. By the rollout's own finding #5 that is a stratum question — the
candidate for code is a close-out check that FAILs a coaching reply
whose asked questions have no row (`check_files.py` already enforces
the plan's sections; it cannot see the reply). Not built here; recorded
for the next round.

## Addendum — the close-out in code (2026-08-22, early)

`coach/scripts/check_closeout.py` built: the agent declares the stage
and each question asked; the script FAILs a bad stage, a `plan.md` not
written this turn, a declared question with no Waiting-on-you row.
Five unit tests. Then measured on the no-nag case, three rounds:

| Round | Change | no-nag | script invoked |
|---|---|---|---|
| closeout1 | script wired at Session close | (run broken — no transcripts) | — |
| closeout2 | same | 0/2 | 0/2 |
| closeout3 | + "a plan question beside a direct ask is both; the close-out runs even when another skill did the work" | 0/2 | 0/2 |

The mechanism, from the tool logs: the candidate's ask belongs to
apply ("apply to Corvid today — what's my plan?"); apply drives the
turn and serves it cleanly every time (`check_files` runs 5–12 times);
coach's section never runs, so neither its plan write nor its script
does. No wording inside coach reaches a turn coach is not in. Three
rounds, same result — the ceiling. The structural options are the
founder's call: a Tier-0 rule in the workspace `CLAUDE.md` template
(every reply that asks a question writes the row; "what's my plan"
always writes the plan; run the close-out) — recommended; every skill's
close calling coach's check; or accepting that this case measures a
two-skill turn.

Elsewhere on the same day: search's trimmed sweep lost force on
protected-rows (3/3 → 0/2 on the compressed rule → 2/3 with the full
wording restored — the annotated-keep variant is now a four-sighting
watch item); evaluate's trimmed sequence held t6 4/4.

## Resolved — the contract at Tier 0 (2026-08-22)

The founder asked whether coach itself should live in the workspace
`CLAUDE.md`. Not the skill (2,164 words on every turn, and the missing
rule was not in it anyway) — its close-out *contract*: ~60 words in the
template, v5. `§ Every reply closes, whichever skill did the work`: name
the stage; every question asked is a Waiting-on-you row this turn;
"what's my plan" writes the plan even beside another ask; run
`check_closeout.py`; another skill serving the ask does not end the
coaching turn.

| Round | Where the rule lived | no-nag | script invoked |
|---|---|---|---|
| closeout2, closeout3 | coach's SKILL.md only | 0/2, 0/2 | 0/2, 0/2 |
| tier0 | the workspace `CLAUDE.md` (every skill) | **2/2** | 2/2 (11 and 4 calls) |

The case's first 2/2 ever. The mechanism was never coach's wording —
it was that apply drove the turn and only Tier 0 reaches every skill.
The loading design holds (one skill body at a time); what moved is one
cross-skill obligation, placed at the only level that spans skills.
