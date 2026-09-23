# Learn — the file shapes

Two files. `scripts/check_knowledge.py` is the authority on
`knowledge.md`'s grammar — it FAILs a malformed scope or a status that
isn't one of the four, bare (moved to code 2026-08-15 after em-dash keys
and prose-in-status cells reached the first live map). Courses are
read by practice (scored reps) and prep (concern counters read the
Map); no script parses them.

## `knowledge.md` — the knowledge map

- `## Map` — one row per topic per lane: `Topic · Scope · Source ·
  Depth needed · Assessed · Status · Course`. Scope is `track-<lane>` or
  `role: <company_key>-<title_key>` (plain hyphens — an em dash breaks
  the join to `jd-analysis/` and `jobs.md`); a topic two lanes demand
  gets one row per lane. Source: which JDs (with the sighting count),
  or `[inferred]` from the lane definition. Assessed: dated, from the
  log. Status: `gap` / `studying` / `credible` / `retired`. Course:
  `courses/<slug>.md` or `—`.
- `## Assessment log` — append-only: `date · topic · what was asked ·
  the honest result`. Every quiz and every training rep lands here;
  the Map row's Assessed cell is stamped the same turn.
- `## Other notes` — optional.

Created when the map is first derived; prep's concern counters and coach's groundwork sensing read the Map. The Assessment log is read by the loop before every assessment (the last result is where the next quiz starts) and never pruned.

### Status lifecycle

`gap` — demanded, not yet assessed or assessed below the depth · `studying` — a course exists or training has begun · `credible` — passed the course checklist at the needed depth on a dated rep; not mastery, not a certification; the honesty header travels with the word · `retired` — the source role was dismissed or the lane retired; the row and any half-built course persist for a sibling role. A `role:` row is auto-promoted to `track-` when a second JD in the lane shows it, and the promotion survives its source roles' dismissal (the jd-analyses persist, so the 2+ count stands); a lane retired in `criteria.md` retires its `track-` rows. Depth comes from the band — a Head-of needs architecture-conversation depth, not implementation depth; `role:` rows train to conversational credibility, never mastery.

## `courses/<slug>.md` — one researched course per topic

1. **The honesty header** — what this course can grade (coverage,
   communication, framework recall), what it can't (deep correctness),
   its research date, its band and depth.
2. **The canonical framework** — the dimension checklist the topic is
   actually graded on (system design: requirements → capacity → API/data
   model → high-level design → deep-dive → scaling/tradeoffs → failure
   modes). **This checklist IS the rubric.**
3. **A worked example**, annotated with what interviewers listen for at
   each step.
4. **Practice problems (5–10)**, banded, each with its coverage
   checklist.
5. **Band-calibrated expectations** at the candidate's seniority.
6. **Resources** — the 3–5 best sources found, cited, tiered.
7. **What the candidate fills** — present when research came back
   thin: the topic-specific unknowns, asked of them.

## What learn reads and never writes

`jd-analysis/` (the demand side — evaluate's competency extractions,
read by track) · `criteria.md § Targets` (the lanes and the band) ·
`profile.md` (what the candidate claims — assessed, never assumed) ·
`practice-log.md` (where practice's scored reps on a course land).
