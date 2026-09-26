---
name: apply
description: Use this skill when the candidate wants to apply to a role or produce application materials — e.g. "tailor my resume for Writer", "write the cover letter", "answer these application questions", "open the application and fill it in", "apply to this one", "prepare applications for my top 3". Produces JD-tailored résumés, cover letters, and application answers; can read, fill, and (with the candidate's go) submit the live application form in the browser.
---

# Apply — job-scoped application materials, end to end

## Goal

A submitted application the candidate is proud of. **An application ships THREE artifacts**: tailored résumé (+ ATS PDF), cover letter, and outreach plan (`contacts/<company>.md` with recruiter/HM message drafts). A cold submit without outreach is half an application.

| Must be true | Where |
|---|---|
| Tailored résumé is reshape-only from base, with ATS PDF measured against page target | `applications/<key>-resume.md` + PDF |
| Cover letter argues one clear thesis in candidate's voice | `applications/<key>-cover-letter.md` |
| Decisions disclosed beside delivered doc (cuts, placed words, gaps) | `applications/<key>-application.md` · chat |
| Deterministic checks pass, and all three panel lenses Pass or are waived in chat, before the package is called ready | reply outcomes, never narration |
| Nothing submitted without explicit candidate go and captured confirmation | `## Submission` · `jobs.md` at Applied |
| Outreach plan exists with findable leads or honest "none findable" | `## Outreach plan` · `contacts/<company>.md` |

## Prerequisites

- **Required:** Workspace `CLAUDE.md` (none: route to profile's Setup); `base-resume.md` (SSOT: body + § Claim rules — hard stop if absent, never fabricate); `jd-analysis/` for the role (suggest `evaluate` first if absent).
- **Optional:** `profile.md` (+ `§ Application defaults`), `storybank.md`, `pitch.md`, `voice.md`.

## Loops and sequences

Extended craft and form automation in `references/patterns.md`. File shapes in `references/schema.md`.

### Tailoring (the loop)

**Runs when** the candidate asks to tailor a résumé, letter, or "materials" for a specific role.

- **Standard:** The `## Standard` bullets in the application file (`references/schema.md`).
- **Budget:** Two self-passes; one review incorporation round, which re-checks only the lenses short of Pass, once. Said up front.
- **Each round:** Read `## Standard` and earlier `## Rounds` rows first. Reshape-only from `base-resume.md` (selection, order, depth — never invented facts). Run the checks and the three-lens panel (`references/eval.md § The panel — three lenses`). Score round as `N/M held` count and append row to `## Rounds`.
- **Obligations:**
  1. *Facts need a yes:* Voluntarily surfaced facts go to `storybank.md`, not directly into a résumé without an explicit yes.
  2. *Deliver & Disclose:* Present the deliverable beside the proposal block (`scripts/proposal_block.py` list of cuts and placed words with easy reversal).
  3. *Exact edits:* Apply candidate edits directly in place and re-render.
- **Exits:** When the round scores M/M held with every lens at Pass and the candidate accepts; at the budget; or at the ceiling: two `## Rounds` rows with the same count and lens verdicts. At the budget or the ceiling, stop and present a DECISION showing each lens still at Revise or Fail with its `## Panel` rows; the package is not ready until every lens passes or the candidate waives it in chat. Never relax the standard — **cutting a claim's supporting evidence to fit a limit IS relaxing it: a claim-name without its number is not the claim.**

### Answers (the loop)

**Runs when** application questions or form fields need drafting. Follow `references/patterns.md § Application answers` and `voice.md`.

- **Standard:** Answer addresses the exact prompt within word limits; CONFIRMED stories only.
- **Budget:** 2 rounds; ceiling applies.
- **Exits:** All answers in `## Answers` with gaps flagged; or at the ceiling with tradeoff surfaced. Never relax the standard — **cutting a claim's supporting evidence to fit a limit IS relaxing it: a claim-name without its number is not the claim.**

### Full application (a sequence)

**Runs when** candidate says "apply to this one".

1. **Extract & Draft:** Extract all form fields/pages into the application file before drafting essays. Screening answers pull from `profile.md § Application defaults`.
2. **Review Gate:** Complete application (fields, essays, chosen résumé) approved in chat before touching the live form, with any LinkedIn drift named.
3. **Submit Gate (Rule 7):** Form filled in the browser, then a screenshot and a plain summary, then the candidate's explicit word fires submit.
4. **Third Artifact:** Capture submission confirmation into `## Submission`, set `jobs.md` row to Applied, and draft the outreach plan in `contacts/<company>.md` (`## Outreach plan`).

**Exits** with all three artifacts delivered or at the gate candidate declined.

### Batch prep (a sequence)

**Runs when** "prepare top N" (default N ≤ 5). User-armed, never scheduled.

- Ensure each job has an `evaluate` decode; run the tailoring loop for résumé/letter; draft form questions; build outreach plans. Never auto-submit in batch.

**Exits** with one status line per job.

## State

Owned: `applications/` (shapes in `references/schema.md`).

- **Hands back:** Outreach sends go to `outreach`; interview prep goes to `interview`; confirmed story leads go to `storybank`; base updates go to `profile`.
- **Session close:** Run `python3 scripts/check_materials.py`, `python3 scripts/proposal_block.py`, and `python3 ../profile/scripts/check_files.py --workspace .`. Language checker-subagent runs on every delivered document. Report outcomes, never narration (clean is 1 line; fix FAILs before reply ends).

## Guardrails

- **Reshape-only, never invent:** No claim the base doesn't support. Unsupported sections are omitted, never filled with filler.
- **Never:** Create accounts, handle passwords, bypass CAPTCHAs, guess screening answers, or claim "submitted" without captured confirmation.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
