---
name: storybank
description: Use this skill when the candidate wants to build, review, improve, or practice their interview stories — e.g. "help me build my story bank", "capture this story", "interview me for stories", "mine my old résumé/reviews for stories", "find gaps in my stories", "drill me on story retrieval", or when another skill (positioning, prep, apply) needs grounded stories and none exist.
---

# Storybank — the evidence base

## Goal

A bank of **memorable, owned stories** that covers the competency map —
evidence for pitches, résumé bullets, and interviews. The product is
the **tell** (what sticks after 24 hours), not a filled-in template.
Native judgment leads the tell (scar → owned turn → one proof number →
disagreeable lesson; spine vs depth; altitude); this skill owns the
coverage map, `stories/` + `storybank.md`, confirm-only, the improve
loop, drill retrieval, and the no-invent guardrails. STAR is optional
translation only.

## Coverage map (minimum)

Leadership/org scale · conflict · real failure · delivery/metrics
turnaround · customer/enterprise · cross-functional influence ·
technical depth · feedback given/received.

## Capture

1. Pick the highest-priority uncovered competency.
2. Elicit one question at a time, aiming for scar / owned turn / one
   proof number / disagreeable lesson. Never guess past what they said —
   a vague answer stays vague until they add detail.
3. Write `stories/S###-<slug>.md` and index it in `storybank.md`. Status
   `confirmed` only if told directly.
4. Extract the earned secret (the counterintuitive insight) — the file
   carries `TODO: earned secret` until it's actually extracted.

## Mining

Create story files and index rows with Status `draft [source: <file>]`.
Exits when the draft is confirmed via at least one clarifying question
with the candidate — a source is not the truth.

## Level check

After a solid draft, sanity-check altitude against the candidate's
stated band (`profile.md`). Elevate only with real facts.

## Improve

Score 1–5 on: specific scar, owned turn, defensible metrics, sticky
lesson, right altitude. 3 or below goes to the improve loop, 2–3 rounds
max; two rounds with no movement → the ceiling, present the tradeoff as
a **DECISION**.

## Drill retrieval

With 6+ confirmed stories: rapid-fire "which story answers this
question?" Log to `practice-log.md`.

## A story is not a résumé line

No claim from a story enters `base-resume.md` unless the candidate
explicitly approves the exact wording — propose the résumé line in chat
with its source story, never auto-write. Declined proposals are logged
in `base-resume.md § Claim rules` as declined rulings.

## Session close

Run `scripts/check_stories.py --workspace .` and
`../profile/scripts/check_files.py --workspace .`; run the independent
language checker-subagent
(`../profile/references/language-check.md`) on edited stories; fix a
FAIL before the reply ends. Report outcomes, never narration.

## Guardrails

- **Never fabricate:** no invented metrics, timelines, titles, or
  stakeholders.
- Scope and numbers trace to `base-resume.md`.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
