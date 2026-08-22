---
name: apply
description: Use this skill when the candidate wants to apply to a role or produce application materials — e.g. "tailor my resume for Writer", "write the cover letter", "answer these application questions", "open the application and fill it in", "apply to this one", "prepare applications for my top 3". Produces JD-tailored résumés, cover letters, and application answers; can read, fill, and (with the candidate's go) submit the live application form in the browser.
---

# Apply — job-scoped application materials, end to end

## Goal

A submitted application the candidate is proud of. **An application
ships THREE artifacts**: the tailored résumé (+ ATS PDF), the cover
letter, and the outreach plan (recruiter + hiring manager, messages
drafted). A cold submit without its outreach plan is half an
application; the plan is what makes the portal odds move. The candidate
names the endpoint; you run the chain up to it. Scored by
`references/eval.md`.

| Must be true | Where |
|---|---|
| The tailored résumé is reshape-only from the base, with its ATS PDF measured against the page target | `applications/<key>-resume.md` + the PDF |
| The cover letter argues one thesis in the candidate's voice | `applications/<key>-cover-letter.md` |
| The decisions the candidate can reverse — every cut with what it buys, every placed word, every gap — are in the reply beside the delivered document | the application file (the record) · the reply (the short list) |
| Both checks ran and the panel reviewed before anything was delivered | the reply, outcomes not narration |
| Nothing was submitted without the candidate's go and a captured confirmation | `## Submission` in the application file · `jobs.md` row at Applied |
| The outreach plan exists, with leads or the honest "none findable" | `## Outreach plan` · `contacts/<company>.md` |
| Anything the candidate ruled on about a fact reached the base; nothing unruled did | `base-resume.md` |

## Prerequisites

- **Required:**
  - a workspace `CLAUDE.md`. None → the workspace isn't set up; run
    profile's Setup before writing any file. (Every skill is a door a
    NEW candidate can walk through first — goal 2's blocking gap.)
  - `base-resume.md` — the fact SSOT: body + § Claim rules (trace rules
    in `../profile/SKILL.md § State`, the base-resume entry; the
    resolution ladder in `../profile/references/schema.md`). None →
    **hard stop, ask. Never fabricate a base.**
  - a `jd-analysis/` file for the role — its verdict picks which
    strengths lead. None → suggest `evaluate` first.
- **Optional:** `profile.md` (+ `§ Application defaults`) ·
  `storybank.md` + `stories/` · `company/<slug>.md` · `pitch.md` (the
  letter's opening echoes its core statement — one story on every
  surface) · `voice.md` (real writing samples + never-say list govern
  every candidate-voiced text) · `jobs.md` row.

## Loops and sequences

Two loops draft against a fixed standard — tailoring and answers. Two
sequences carry the work to the form and across a batch. The craft:
`references/patterns.md`. File shapes: `references/schema.md`.

**The loop law, both loops.** Write down the standard before you draft.
Say the round count up front. Fix what a checker can catch before you
show anything (at most two self-passes, each with the plain-language
pass against the workspace `CLAUDE.md § Writing in their voice` table).
Three ways out: the draft clears the standard — **say so plainly**;
the budget runs out; or **the ceiling** — two rounds in a row with no
movement, then stop and change strata (prose → checklist → code) or
hand the tradeoff to the candidate as a **DECISION**. Never grind out
more rounds, never relax the standard, and record the honest rate where
the deliverable lives (the rubric line; the application file).

### Tailoring (the loop)

**Runs when** the candidate asks to tailor a résumé, letter, or
"materials" (bare intent → both documents), as the drafting half of a
full application, and per role in a batch. Evaluate hands a strong
verdict here (coach's "should I apply to this?" goes to evaluate
first) — the decode is already on file. Artifacts that already exist
for this job → confirm before regenerating.

- **Standard:** the `## Standard` bullets in the application file,
  written before the draft (`references/schema.md` says which bullets;
  each is one item). **Budget:** two self-passes; the panel's ONE
  incorporation round. Say both up front.
- **Each round:** read `## Standard` and the earlier `## Rounds` rows
  first — the ceiling is a fact about them. Draft reshape-only from the
  base (how: `references/patterns.md § Tailoring — getting there`).
  Run the checks and the panel (`references/eval.md § Who checks what`) — the panel is three SPAWNED subagents fed the source documents, or an honest "could not spawn"; the author playing three lenses is not a panel. Score the round as `N/M held` and append its row. Deliver.
- **Three things bind at their moment, whatever the round:**
  1. **A fact needs a yes.** A fact the candidate volunteers in conversation lands in the storybank, not in a résumé. A new bullet — base or tailored — or a `draft [source: …]` story's claim enters no document until you have shown the exact line and they said yes to it; "use it wherever it helps" is not that yes (t10 measured both). § Claim rules outrank
     a stale body line — correcting the base by the direction rule is
     their earlier ruling, not a new fact.
  2. **Deliver first, disclose beside, silence is a yes.** The
     candidate's decisions — each cut and what it buys, each placed
     word, each gap as a question, the page choice if the render ran
     over — are in the reply beside the delivered document, as the
     short list `scripts/proposal_block.py` prints, with the one
     sentence that makes reversal cheap. The candidate cannot see tool
     output; the decisions exist when they are in the text you write.
     (Founder, 2026-08-21: a wait before delivery was measured dead
     across ~20 trials; the disclosure is the obligation.)
  3. **Their answer is applied exactly.** Plain English is a complete
     answer; edit the `.md` in place, re-render, re-check, append the
     round — nothing else changes. Hand edits are the newest version,
     never regenerated.

**Exits** when the round scores M/M held and the candidate has accepted
the delivered version (by answer or by silence) — *say so plainly*; or
at the budget; or at **the ceiling** — two `## Rounds` rows with the
same count and tiers: stop, change strata or hand the candidate the
tradeoff as a DECISION, with the honest count on the rubric line. Never
relax the standard — **cutting a claim's supporting evidence to fit a
limit IS relaxing it: a claim-name without its number is not the claim.**

### Answers (the loop)

**Runs when** the candidate brings application questions, or a form's
fields are extracted. **Read `references/patterns.md § Application
answers`** and follow its protocol, and read
`../profile/references/candidate-voice.md` with `voice.md` before
drafting — the Never column binds every sentence.

- **Standard:** the question and its word limit, exactly; CONFIRMED
  stories only; the voice rules. **Budget:** two rounds; the ceiling
  rule applies.

**Exits** when every answer is in the application file's `## Answers`
with its Flagged Gaps, ready to paste — or at the ceiling, with the
tradeoff handed to the candidate. A question without honest support is
flagged, never answered with an invented experience. Never relax the
standard to fit the limit — **cutting a claim's supporting evidence to
fit a limit IS relaxing it: a claim-name without its number is not the claim.**

### Full application (a sequence)

**Runs when** the candidate says "apply to this one". Read the form
before drafting any essay, draft (the two loops feed this), get the
answers approved in chat, fill and verify, submit on their go, record,
then the third artifact. The mechanics — field buckets, the attachment
ladder, reading a form the browser can't open, verifying by read-back
— are `references/patterns.md § The live form`.

- **Before any essay:** every field, every page, into the application
  file. A closed posting → say so, dismiss the row ("posting closed"),
  draft nothing. A login wall → the candidate's hands; never accounts
  or passwords. (2026-08-01: a letter was written for a form that never
  collects one.)
- **Screening fields are never guessed** — work auth, comp, start date,
  relocation come from `profile.md § Application defaults` or the
  candidate; offer to save the answer so no form asks twice.
  "Previously employed here?" stays per-company. EEO defaults "Decline
  to self-identify".
- **The review gate:** the complete application rendered in chat —
  fields, essays, which résumé uploads — **approved before the live
  form is filled.**
- **The submit gate — the one human moment**, per
  `../coach/references/gate-grammar.md`: screenshot, one-line summary,
  anything they must do by hand; **their explicit go fires the click.**
  Batch auto-submit only by explicit opt-in; anything with a `NEEDS
  CANDIDATE` field, an unfamiliar question, a login wall, or a
  low-confidence mapping drops back to review; the review gate still
  runs once for the batch's shared answers; every submission is logged
  at submit time; auto mode never creates accounts, touches payment
  fields, or alters stored screening answers.
- **After:** the captured confirmation into `## Submission` — never
  "submitted" without it — and the row to Applied
  (`../search/scripts/update_job.py`). Then **the third artifact, same
  session**: outreach's chain as written in `../outreach/SKILL.md`
  (Find contacts → Enrich → Draft → Plan close-out); leads and drafts in
  `contacts/<company>.md` under outreach's rules, the summary in
  `## Outreach plan`. No findable hiring manager is a finding, not a
  failure — ship the recruiter path; no contacts at all → say so and
  name the warm-path ask. The candidate sends everything.

**Exits** when the packet holds all three artifacts, or at the gate the
candidate declined to pass.

### Batch prep (a sequence)

**Runs when** the candidate asks to prepare several ("prepare my top
3"). **User-armed, never scheduled.** For the top N at or above the fit
floor (default N ≤ 5 — "reviewing five beats spraying fifty"; floor 70,
the number's one home): ensure each has an `evaluate` verdict; run the
tailoring loop for both documents; extract and draft the form questions
(stop before filling); build each role's outreach plan. Name the batch's
rough research cost when arming it — N × contact-finding is a real
spend, bounded by outreach's per-company caps, approved by the
candidate. Nothing submits and nothing is marked Applied in batch —
that is the full application, per role, with its gate. One status line
per job; a failed sub-step makes that packet partial, never aborts the
batch.

**Exits** with one status line per job.

## State

Owned: `applications/` — shapes in `references/schema.md`, which also
lists the four writes outside the manifest (`base-resume.md` rulings
only, `contacts/` via outreach, `plan.md § Waiting-on-you`, the
`jobs.md` row).

**Hands back:** the outreach plan's sends → `outreach`; an interview →
`prep` (it reuses the packet); a gap the candidate answers with a story
→ `storybank`; a better rewording → `profile` (the base, by the
direction rule).

**Session close:** `python3 scripts/check_materials.py`, `python3 scripts/proposal_block.py`, and `python3 ../profile/scripts/check_files.py --workspace .` have run per document (`references/eval.md § Who checks what`); the language checker-subagent IS spawned here, on every delivered document. **The candidate sees results as outcomes, never narration**:
clean is one line; FAILs are fixed, then named as fixed; WARNs are
defended in the reply. Say what the workspace now holds — the packet's
artifacts, the row's stage, any `open` coverage rows (they park a line
on the coach's board).

## Guardrails

- **Reshape-only, never invent**: no claim the base doesn't support, no
  experience the storybank/profile can't evidence; a below-level gap is
  real, not reframable. Unsupported sections are omitted, never filled.
- **Numbers and names are checkable — check them**: figures from
  workspace files match exactly; anything external needs a this-session
  source.
- **Never**: create accounts, handle passwords, bypass CAPTCHAs,
  answer EEO/demographic questions without the candidate's standing
  instruction, guess screening answers, or claim "submitted" without
  captured confirmation. Word limits on forms are respected exactly; the
  why-us paragraph is researched-specific or it doesn't ship.
- *The 2026-08-01 lesson behind the gates: a shipped résumé and letter
  broke four rules already written in the reference — skipped because
  nothing forced the read. Rules bind only when something makes
  skipping them visible.*

*Every reply ends with ONE contextual next step — a sentence with its
why, not a menu.*
