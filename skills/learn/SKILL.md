---
name: learn
description: Use this skill when the candidate wants to build domain or technical knowledge for their target roles — e.g. "what should I study for FDE roles?", "do I know enough about payments to interview at Mesh?", "teach me system design interviews", "build me a course on X", "quiz me on Y", "where are my knowledge gaps?". Identifies the knowledge the target roles demand, assesses the candidate's level honestly, and builds researched courses to close the gaps.
---

# Learn — know what the target roles demand

## Goal

Map the domain and technical knowledge demanded by target roles, assess candidate proficiency honestly, and build researched courses to bridge critical gaps. Scored by `references/eval.md`.

| Must be true | Where |
|---|---|
| Every topic has Map row with valid scope, source, sighting count, and depth | `knowledge.md § Map` |
| Assessments logged and stamped on Map row in same turn | `§ Assessment log` + Map row |
| Live gaps have researched, cited course files (`courses/<slug>.md`) | `courses/` |
| Status advances (`gap → studying → credible`) only on logged assessment evidence | `knowledge.md` |
| Never certify unearned credentials (clarify what candidate can honestly claim) | reply |

## Prerequisites

- **Required:** Workspace `CLAUDE.md` (none → profile's Setup); `criteria.md § Targets` (target roles and seniority band).
- **Optional:** `jd-analysis/` (demand-side competency sightings), `profile.md`.

## The loop

Curriculum research, quiz formats, and topic depth standards live in `references/patterns.md`.

### A topic (the loop)

**Runs when** candidate asks what to study, requests a quiz/course, or prep/practice identifies an unaddressed domain gap.

- **Standard:** The course checklist at the row's seniority depth (`references/eval.md § Quiz scoring`).
- **Budget:** 1 quiz round per assessment; reps stated up front. Read `knowledge.md` before starting.
- **Each pass:** Map $\rightarrow$ Assess (short quiz + candidate self-rating $\rightarrow$ log + stamp row) $\rightarrow$ Course (research tiered sources, create `courses/<slug>.md`) $\rightarrow$ Train (reps against checklist).
- **Obligations:**
  1. *Track vs Role scope:* Two independent JD sightings required to promote a topic to track scope (otherwise `role:` scoped).
  2. *Honest calibration:* State exact score and depth; never claim generic mastery.
  3. *Dual write:* Update `§ Assessment log` and stamp the row in `knowledge.md` in the same turn.
- **Exits:** Row reaches `credible` on a dated rep; budget expires; or **the ceiling: two reps with the same coverage count** → stop and adjust approach. Never relax the checklist.

## State

Owned: `knowledge.md` and `courses/` (shapes in `references/schema.md`).

- **Hands back:** Format courses and frameable gaps → `interview` (scored reps & concern counters).
- **Session close:** Run `../profile/scripts/check_files.py --workspace .` and `scripts/check_knowledge.py --workspace .`. No checker-subagent is spawned (coach voice). Report outcomes, never narration (clean is 1 line; fix FAILs before reply ends).

## Guardrails

- Curricula must be researched with tiered sources (verified, general knowledge, unknown) and research dates, never hallucinated.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
