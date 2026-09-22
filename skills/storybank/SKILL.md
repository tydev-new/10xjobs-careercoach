---
name: storybank
description: Use this skill when the candidate wants to build, review, improve, or practice their interview stories — e.g. "help me build my story bank", "capture this story", "interview me for stories", "mine my old résumé/reviews for stories", "find gaps in my stories", "drill me on story retrieval", or when another skill (positioning, prep, apply) needs grounded stories and none exist.
---

# Storybank — the evidence base

Interview stories are the candidate's evidence base — every strong pitch, résumé bullet, and behavioral answer is mined from them. This skill asks the questions and owns the record.

## Goal and measures

**A bank that covers the map, with complete stories, strong enough to use.**

| Measure | Target |
|---|---|
| **Complete** | Every story complete (STAR narrative, earned secret, metrics, questions answered) |
| **Strong** | Score **4 or 5** before consumers cite it. 3 or below goes to the improve loop |
| **Covering** | Covers every competency in `## Coverage` + 3 must-cover gaps (feedback, conflict, real failure) |

## Prerequisites

- **Required:** Workspace `CLAUDE.md` (none → profile's Setup); coverage map in `storybank.md` (from `jd-analysis/` or inferred from `criteria.md` targets); `base-resume.md § Claim rules`.
- **Optional:** `profile.md` story seeds; `voice.md`.

## The loops and sequences

Extended craft, elicitation questions, and diagnostic score ladders live in `references/patterns.md`.

### Capture (a sequence)

**Runs when** the candidate talks about experience, answers an interview question, or volunteers a story.

1. **Aim & Listen:** Select the highest-priority uncovered competency. Walk through STAR, drilling for specifics (follow-up on vague answers; never guess).
2. **Write on disk:** Create story file `stories/S###-<slug>.md` and index row in `storybank.md`. Status is `confirmed` (told directly).
3. **Earned secret:** Extract counterintuitive insight (file carries `TODO: earned secret` until extracted).
4. **Propose résumé additions:** If the story surfaces a new fact not in `base-resume.md`, propose it in chat (see § A story is not a résumé line).

**Exits** when the story is Complete and grounded in candidate facts.

### Mining (a sequence)

**Runs when** a document is dropped, pasted, or offered for story extraction.

- Create story files and index rows with Status `draft [source: <file>]`.
- **Exits** when draft is confirmed via at least one clarifying question with the candidate.

### Improve (the loop)

**Runs when** a story scores ≤3, candidate asks to improve one, or a critical competency is weakly covered.

- **Standard:** The target competency plus *specific, owned, and defensible*.
- **Budget:** 2–3 rounds. Read `## Rounds` (or `storybank-history.md`) first.
- **Each round:** Apply minimum score-moving changes (`references/patterns.md § Improving by score band`). Show before/after, re-score, and update index row. Append row to `## Rounds` in `storybank.md` (or `storybank-history.md`).
- **Exits:** Story scores 4–5; budget expires; or **the ceiling: two rounds in a row with no movement** → stop and present tradeoff as a **DECISION**. Never relax the standard.

### Asking the bank

- **Find gaps:** Rank uncovered competencies and name the next action.
- **Drill:** Retrieval practice (threshold: **8+ confirmed stories**). Answering on a drilled draft confirms it.
- **Narrative identity:** Synthesizes thesis across stories (threshold: **5+ confirmed stories**).

## State

Owned: `storybank.md` and `stories/S###-<slug>.md` (shapes in `references/schema.md`).

- **Hands back:** When records are written and proposals delivered.
- **Session close:** Run `scripts/check_stories.py --workspace .` and `../profile/scripts/check_files.py --workspace .`. Run independent language checker-subagent (`../profile/references/language-check.md`) on edited stories. Report outcomes, never narration (clean is 1 line; fix FAILs before reply ends).

## A story is not a résumé line

**No claim from a story enters `base-resume.md` unless the candidate explicitly approves the exact wording.**

- Propose the résumé line in chat with its source story.
- Write to `base-resume.md` only on explicit yes. Declined proposals are logged in `base-resume.md § Claim rules` as declined rulings.

## Guardrails

- **Never fabricate:** No invented metrics, timelines, or secrets.
- Scope and numbers trace to `base-resume.md`.
- Earned secrets must reflect firsthand experience, not generic platitudes.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
