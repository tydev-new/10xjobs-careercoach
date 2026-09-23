---
name: apply
description: Use this skill when the candidate wants to apply to a role or produce application materials — e.g. "tailor my resume for Writer", "write the cover letter", "answer these application questions", "open the application and fill it in", "apply to this one", "prepare applications for my top 3". Produces JD-tailored résumés, cover letters, and application answers; can read, fill, and (with the candidate's go) submit the live application form in the browser.
---

# Apply — job-scoped application materials, end to end

## Goal

An application the candidate is proud of. An application ships **three
artifacts**: tailored résumé (+ ATS PDF), cover letter (when the form
takes one), and an outreach plan (`contacts/<company>.md`, via
`outreach`) — or an honest "no findable contacts" in its place.

## Prerequisites

- Prefer an `evaluate` verdict on file (`jd-analysis/` + `jobs.md`) —
  see `../evaluate/SKILL.md § Apply queue` for the default — run evaluate
  first, or get the candidate's explicit skip.
- `base-resume.md` is the claims SSOT — hard stop if absent, never
  fabricate around it.
- Never invent metrics, titles, or employers.

## Tailoring

1. **Native judgment:** one story spine for this JD; reshape summary
   and bullets for readability, matching the density of the
   candidate's own best past packages (see `documents/` or
   `profile.md`) — a thin template is a bug, not a starting point;
   ~2 pages.
2. **Guardrails:** claims only from `base-resume.md` or confirmed
   storybank stories — reshape selection/order/emphasis, never invent a
   metric, title, or employer. A fact the candidate volunteers this turn
   goes to `storybank`, not straight into a résumé line — no résumé line
   without the candidate's explicit yes on that line.
3. **Cover letter — three paragraphs:** paragraph 1 soft-orients
   (the mandate/problem + who you are) without restating the full job
   title; paragraph 2 is proof; paragraph 3 is logistics + the ask.
   Never put internal pipeline notes in a candidate-facing letter.
4. **Disclose:** cuts, placed words, and gaps beside the delivered
   document (`scripts/proposal_block.py` prints the list) — never
   silent.
5. Two rounds max without score movement → present the tradeoff as a
   **DECISION**.

## Before delivery — the claim checks

Every delivered document runs, in this order, before the candidate sees
it:

1. `scripts/check_materials.py --workspace . --resume <path> --letter
   <path>` — the structure tier (verbatim bullets, one opening section,
   banned filler, length bounds).
2. The independent language checker-subagent
   (`../profile/references/language-check.md`) — wording, never-say
   list, tone.

Report outcomes, never narration; fix a FAIL before it reaches the
candidate.

## Submit gate

Filling a live form, and firing submit, each follow the human gate in
your workspace `CLAUDE.md` (wording in
`../coach/references/gate-grammar.md`) — **one role at a time, never a
batch**. The confirmation is captured and logged (`jobs.md` → Applied
via `../search/scripts/update_job.py`). See § Guardrails for what
never happens at this gate.

- EEO defaults come from `profile.md § Application defaults` unless the
  candidate says otherwise.
- Salary free-text: match the posting's stated band when the form
  requires one; otherwise ask if the form forces a single number.

## Screening answers

CONFIRMED stories only — storybank first, then `base-resume.md`. Flag a
gap; never fabricate one closed.

## Batch prep

"Prepare top N" (default N ≤ 5), **candidate-armed, never scheduled**.
Run `evaluate` + the tailoring loop + an outreach plan per role. Never
auto-submit — the submit gate still fires one role at a time.

## Owns

`applications/`. Hands back: outreach sends → `outreach`; interview prep
→ `interview`; confirmed story leads → `storybank`; base updates →
`profile`.

## Session close

Run `scripts/proposal_block.py --workspace . --application <path>` and
`../profile/scripts/check_files.py --workspace .`; fix a FAIL before
the reply ends. Report outcomes, never narration.

## Guardrails

- **Reshape-only, never invent:** no claim the base doesn't support.
  Omit an unsupported section rather than fill it with filler.
- Never create accounts, handle passwords, bypass CAPTCHAs, guess
  screening answers, or claim "submitted" without captured confirmation.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
