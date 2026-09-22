# Coach — the file shapes

Coach owns one file and its annex. `plan.md` is declared here and
enforced by `../../profile/scripts/check_files.py` (sections and their
order); `plan-log.md` is append-only history. Two sanctioned outside
writers, stated on both sides: profile's intake seeds the head once
(goal, date, time floor); apply's tailoring adds or removes ONE "gap
interview open" line in § Waiting on you while coverage rows are
`open`. Everyone else reaches state through the owning skills' files
and scripts.

## `plan.md` — the plan

- `## Board` — Waiting on you · To do · Doing · Done, as content exists
- `## Standing floor` — optional
- `## Queue` — optional
- `## Other notes` — optional

An optional H1 title, then two head lines before the sections:

```
Goal: <the offer they want> by <date>   (captured at intake; a goal without a date gets one proposed)
Budget: <N min/day | N min per session, cadence>   (the floor, captured at intake, renegotiated only at the mirror)
```

**The Board:**
- *Waiting on you* — the attention index, not a second copy of content:
  one line per open question or gated decision, with a pointer to the
  file that holds the detail; names who it waits on when not the
  candidate ("waiting on recruiter reply"). Written IN THE SAME TURN as
  the question; never silently dropped by a refresh; persists until
  resolved either way (answered in chat, or the owning file edited).
- *To do* — 2–4 items, ranked, each fully prepared, each with its
  why + minutes, fitting the budget. **Only candidate-only work** —
  reviews, sends, submissions, decisions. Agent work never appears; it
  is done or under Doing.
- *Doing* — actively in motion, agent or candidate.
- *Done* — 3 rows, rolling; the oldest rolls into `plan-log.md` as a dated one-liner in the same turn. A new week's plan carries forward ONLY open Waiting-on-you rows, the Standing floor, and the Queue.

**Standing floor** — the compounding commitments (the practice rep, the
inbox check). **Queue** — agent state: waiting timers with their
triggers · the next-up pool · the last inbox-sweep date; shown on
request.

**The cap: 40 lines.** Over it means something needs retiring, never
scrolling. History and standing decisions are NOT plan sections:
history → `plan-log.md`; standing decisions → the owning file at
decision time (profile.md for rubrics, consents, preferences; the
application or job file for job-scoped calls). A pinned choice lives in
its owning file, so a fresh plan cannot forget it and the never-re-raise
reader looks at the pin, not the plan; a choice scoped to one past
event is spent once the event passes — retire it to the log with a
line.

## `plan-log.md` — the record, never the state

Append-only, created at the first retirement. Two kinds of entry: retired Done rows, dated; and the mirror's weekly entry — `date · planned N · happened K · unmet: <items> · spent choices` — the score is the count, so two entries compare without reading prose (the ceiling: two entries with the same K). **Read by the mirror — its last weekly entry only — before scoring**; never re-read otherwise, and never pruned.

## What coach reads and never writes

Everything: `jobs.md` (stage, staleness, `posted_at`), `contacts/`
(outreach outcomes), `practice-log.md` (the scoreboard, debriefs),
`prep/` (briefs and their header dates), `knowledge.md` (track rows),
`storybank.md` (coverage), `profile.md` (directness, pinned choices,
application defaults), `criteria.md` (targets, target companies), the
workspace `CLAUDE.md` (its version marker vs the shipped template), the
inbox and calendar (read-only, the dedicated job-search account).
Pipeline changes go through `../../search/scripts/update_job.py`.
