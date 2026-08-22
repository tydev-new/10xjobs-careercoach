---
name: learn
description: Use this skill when the candidate wants to build domain or technical knowledge for their target roles — e.g. "what should I study for FDE roles?", "do I know enough about payments to interview at Mesh?", "teach me system design interviews", "build me a course on X", "quiz me on Y", "where are my knowledge gaps?". Identifies the knowledge the target roles demand, assesses the candidate's level honestly, and builds researched courses to close the gaps.
---

# Learn — know what the target roles demand

## Goal

Stories cover the candidate's experiences; knowledge covers their
domains. This skill owns the map of what the target roles demand, the
honest assessment of where the candidate stands, and the researched
courses that close the gaps. **Learn makes you know things; practice
makes you perform under interview pressure.** Scored by
`references/eval.md`.

| Must be true | Where |
|---|---|
| Every demanded topic has a Map row with a script-valid scope, its source and sighting count, its depth from the band | `knowledge.md § Map` |
| Every assessment is logged and stamped on its row, same turn | `§ Assessment log` + the row |
| A live gap has a researched, cited course with its honesty header — even when research was thin | `courses/<slug>.md` |
| Status moved only on logged evidence, and every change was named in the reply | the row · the reply |
| No credential was issued; the candidate knows what they CAN say | the reply |

## Prerequisites

- **Required:** a workspace `CLAUDE.md` (none → profile's Setup first)
  · `criteria.md § Targets` — the lanes and the band; depth has no
  meaning without a band.
- **Optional:** `jd-analysis/` (the demand side; none → the map is
  `[inferred]` from the lane definitions and upgrades as decodes land)
  · `profile.md` (what the candidate claims — assessed, never assumed).

## The loop

**One loop, per topic.** Each Map row moves `gap → studying →
credible` on evidence the log holds; a row is scored against its
course's checklist at its depth. The craft: `references/patterns.md`.
File shapes, and the script that owns the Map's grammar:
`references/schema.md`.

### A topic (the loop)

**Runs when** the candidate asks what to study, whether they know
enough, for a course, a quiz, or their gaps; when a role goes live
(application committed or interview scheduled) and its row is still
`gap`; when prep's concern counter or a prep brief's format discovery
names a topic; when practice finds a format with no course. Coach's
groundwork sensing counts the track rows.

- **Standard:** the course's checklist at the row's depth (`references/eval.md § Quiz scoring`); `credible` is its exact meaning, nothing more. **Budget:** one quiz round per assessment; the reps this session, said up front.
- **Each pass, in order** (`references/patterns.md` for the craft):
  1. Read `knowledge.md` first — the row's scope, status, last assessment; a fresh session remembers none of it. Then the row's course file if the cell names one: its checklist is the standard, its honesty header is the exit's caveat.
  2. Map — write or refresh the row.
  3. Assess — track rows first; a `role:` row only once its role is live. A short quiz at the depth, named, plus their self-rating; log + stamp, same turn.
  4. Course — research, tier, write the file and fill the row's cell, same turn.
  5. Train — reps against the checklist; each rep logged.
- **Four things bind at their moment:**
  1. **Two sightings or the lane definition — nothing else makes a row
     track-scoped.** One JD's demand stays `role:` however exciting;
     the second JD promotes it, and the promotion is said in the reply.
  2. **Never certify; pair the no with the yes.** "6/10 at Head-of
     depth, 2026-08-15" is honest; "you now know payments at a senior
     level" is fabrication wearing a rubric. Every withheld credential
     comes with what they CAN honestly say.
  3. **Thin research still builds.** Cite the canon that exists, put
     the unknowns in the section the candidate fills, ask them.
     Refusing to build is gating, which this system never does.  4. **Both writes, same turn — and the move said in the reply.** An assessment appends to the log AND stamps the row; a course writes the file AND fills the cell; any status or scope change is named.

**Exits** when the row reads `credible` on a dated rep — *say so, with the honesty header's caveat*; or the budget is spent with the log and the row in step; or **the ceiling** — two reps at the same coverage count: change the approach (a different section, a lower-band problem) or name the gap frameable and stop. Never relax the checklist. The row is `retired` only with its role. A gap never gates an
application — it is named where it weakens something, with the
just-in-time plan attached.

## State

Owned: `knowledge.md`, `courses/` — shapes in `references/schema.md`.
Read by prep (concern counters), practice (format courses drilled for
scored reps), coach (track rows in groundwork sensing).

**Hands back:** a format course → `practice` for scored reps; a
frameable gap in an interview → `prep`'s counter.

**Session close:** run `../profile/scripts/check_files.py --workspace .`
AND `scripts/check_knowledge.py --workspace .` — the Map's grammar is
code's job. No checker-subagent is spawned — courses and assessments
are the coach's voice. **Outcomes, never narration**: clean is one line;
a FAIL is fixed, then named. Say what the map now holds — rows moved,
courses built.

## Guardrails

- A curriculum is researched, never generated and presented as canon;
  every course cites tiered sources (verified / general knowledge /
  unknown) and its research date.

*Every reply ends with ONE contextual next step — a sentence with its
why, not a menu.*
