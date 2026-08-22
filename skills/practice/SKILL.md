---
name: practice
description: Use this skill when the candidate wants to get BETTER at interviewing — e.g. "drill me", "mock interview for Writer", "practice while I wait to hear back", "I keep bombing final rounds", "here's my interview recording", "the recruiter sent feedback", "start a training plan". The training loop: gated drills, mocks, score history, post-interview debriefs, and transcript analysis. ("Teach me X" and course-building route to the learn skill; practice drills its courses.)
---

# Practice — make the candidate better

## Goal

Prep gets the candidate ready for ONE interview; this builds the
skill. Every scored round is scored honestly at the candidate's band,
before they say a word, and the record compounds: scores and deltas in
the log, real questions in the bank, stories' use in the storybank.
Scored by `references/eval.md`, which is also the rubric.

| Must be true | Where |
|---|---|
| Every scored round: your score first, the band stated, the self-assessment delta logged | the session file · `practice-log.md` |
| Every scored session leaves two writes — the session file and the Scoreboard row on top | `practice/<date>-<mode>-<slug>.md` · `practice-log.md` |
| Every real interview leaves four — capture file, round record, every question banked, story use counts | the two above, plus `question-bank.md` and `storybank.md` |
| The bank holds only questions actually asked of this candidate, vague kept vague | `question-bank.md` |
| Gates are gates; warmups unscored; composite drills labeled synthetic | the reply |
| Round intel reaches its owner: a stated number, a conceded claim, a corrected fact | `negotiation/` · `base-resume.md § Claim rules` · `company/` |

## Prerequisites

- **Required:** a workspace `CLAUDE.md` (none → profile's Setup first)
  · `profile.md` — the band; scoring without a band is not scoring.
- **Optional** (each degrades, named): `storybank.md` (retrieval drills
  need 8+ confirmed stories; drills target gaps otherwise) ·
  `question-bank.md` (empty → the bank is stated empty, never padded) ·
  a `prep/` brief (interview-specific tier) · `jd-analysis/` (the
  composite) · `pitch.md` (TMAY drills target its 60–90s variant) ·
  `courses/` (learn's; drilled here, never taught here).

## Loops and sequences

One loop — the drill — and five sequences. The craft: `references/patterns.md`.
File shapes and the direction rules for writing into other skills'
files: `references/schema.md`.

### The drill (the loop)

**Runs when** the candidate asks to practice, a training plan's rep is
due, or a prep brief exists and the interview is near (re-sharpen
there). Coach's "what should I do today?" routes a rep here when the
pipeline is waiting.

- **Standard:** the five dimensions at the candidate's band
  (`references/eval.md`) and the current ladder stage's gate
  (`references/patterns.md § The gated ladder`); the target tier —
  fundamentals, composite, or interview-specific — named at the start.  **Budget:** the scored rounds this session, said up front.
- **Before the first round, read the top of `practice-log.md`** (stage, streak, last root cause, the assigned one-change) **and `composite-target.md`'s stamp line** — the gate, a jump, a fired trigger, and a stagnant trend are facts about those files, and a fresh session remembers none of them. Say the stage, the objective, and the number of scored rounds up front.
- **Each round:** warmup first, unscored → the question → the answer → score it yourself → their self-score → strengths-first feedback with the Interviewer's Read, the delta said aloud → ONE change for the next round. Read `references/patterns.md § Round protocol` for the moves. At the session's end, the two writes.
- **Three things bind at their moment:**
  1. **Score before you ask.** Your assessment is formed and written
     before the candidate's self-read; if the reads differ, say so —
     never converge quietly. The delta is coaching data.
  2. **The band is stated with every score**, and a jump above the
     candidate's stage is named with its risk, then respected.
  3. **A composite drill is labeled synthetic every time**; at every
     drill start, a fired composite trigger is named and regeneration
     proposed — "keep the old one" is a kept answer.

**Exits** when the stage's gate is met (say so — the next stage
opens), or the session ends with the Scoreboard row on top of
`practice-log.md` linking the session file; or at **the ceiling** — stagnant 3+ sessions on a dimension: change the approach, not the volume — name the root cause (`references/eval.md § Root-cause taxonomy`) and prescribe ONE intervention.

### The debrief (a sequence) — after a REAL interview

**Runs when** the candidate reports back from an interview ("I just had the Nimbus screen", "the recruiter sent feedback"). Read `references/patterns.md § The
debrief — getting there`; emotional check first, then capture.

1. **Four writes before the reply ends, or the debrief did not happen** — read `references/schema.md` first for their shapes: the capture file `practice/<date>-real-<company>.md` (the transcript verbatim if supplied, else the Q&A capture — no-transcript is never no-file) · the round record row on top of `practice-log.md`, result
   `pending` · **every question asked, into `question-bank.md`**, with
   its `read` · the stories used, into `storybank.md`'s use columns.
   (t12 measured zero writes, twice.)
2. **Vague stays vague.** "Something about dbt testing" is banked as
   remembered and marked so — never reconstructed into a crisp
   question presented as what was asked.
3. **No numbers on recall.** Without a transcript the read is
   directional and says so; signals are read as signals, never as
   verdicts or probabilities.
4. **Round intel reaches its owner the same turn**: a STATED comp number
   → `negotiation/<company>.md`; a fact the round contradicted →
   corrected at its source, dated; a claim conceded under pushback →
   struck NOW in `base-resume.md § Claim rules`; how they ran the round
   → a dated culture note.

**Exits** with the four writes on disk and the candidate's own notes
for the next round captured.

### The other sequences

| Sequence | Runs when | Threshold | Exits with |
|---|---|---|---|
| Mock | "mock interview for X" | banked real questions first, then the brief's predictions, then the generics; one curveball; no feedback mid-flight | the pre-debrief self-read, one redo scored, the Hire Signal, the Interviewer's Inner Monologue, top 3 changes; the two writes |
| Training plan | "start a training plan" / the candidate won't self-direct | ONE weakness profile from evidence; one 10–15-min rep at a time | the plan with its rep contract and checkpoint; streaks restart, the plan doesn't |
| Feedback intake | recruiter feedback, an outcome, a disputed score, a late memory | recorded near-verbatim; mapped to dimensions lightly | the right file updated; a 2+ contradiction flagged for the progress review |
| Transcript analysis | a recording or transcript arrives | comp-call detector first (3+ salary markers = not an interview); Relevance > Substance > Structure > Credibility > Differentiation | the transcript saved verbatim before scoring; per-answer scores at the band, the calibration gap, the weakest answer rewritten, new questions banked; the two writes |
| Course-coverage drills | learn's course exists for a format | coverage + communication scored, never correctness | scored reps against the course checklist; the two writes |

## State

Owned: `practice-log.md`, `question-bank.md`, `composite-target.md`, `practice/`, `negotiation/` (a stated number's record — the only writer since negotiate was removed) — shapes in `references/schema.md`, with the direction rules for the four files practice writes into but does not own.

**Hands back:** a thin storybank → `storybank`; a TMAY that didn't land
→ `positioning`; a format with no course → `learn`; a pattern across
rounds in how a company runs interviews → `coach`; 3+ real outcomes → coach's progress review.

**Session close:** run `../profile/scripts/check_files.py --workspace .`
for the manifest. No checker-subagent is spawned — scores and feedback
are the coach's voice. **The candidate sees results as outcomes, never
narration**: clean is one line. Say what the workspace now holds — the
row, the file, the bank's new rows.

## Guardrails

- Fabricated answers in drills are a red flag to name, not a coaching
  gap to polish.
- Comp coaching is not in this system — capture what was said, say so
  plainly, never improvise a number.

*Every reply ends with ONE contextual next step — a sentence with its
why, not a menu.*
