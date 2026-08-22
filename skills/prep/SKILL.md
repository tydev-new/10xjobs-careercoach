---
name: prep
description: Use this skill when the candidate has an interview coming and wants to get ready for it — e.g. "prep me for the Anthropic interview", "I have a phone screen Thursday", "what will they ask?", "what questions should I ask them?", "they'll probably worry about my short tenure", "hype me up, it's in an hour", "help me structure my presentation round". Produces a role-specific prep brief; also handles the final mile (questions to ask, concern counters, day-of confidence).
---

# Prep — get ready for THIS interview

## Goal

The candidate walks in ready. The centerpiece is the **prep brief** —
one file per role — and everything else (questions to ask, concern
counters, presentation coaching, the day-of session) reads and extends
that brief rather than regenerating. Always role-specific: "make me
better at interviewing in general" is `practice` — name it, and after
any brief, because practice beats study. Scored by `references/eval.md`.

| Must be true | Where |
|---|---|
| The brief is on file, every section present, header line current | `prep/<company_key>-<title_key>.md` |
| Every predicted question carries its tier — banked first, researched with its cite, generated `[inferred]` | `## Predicted questions` |
| Every company and interviewer claim is sourced or marked unknown; nothing external asserted without a this-session source | the brief |
| Story mapping fabricated nothing — gaps have a named pattern, drafts are labeled, reused stories flagged | `## Story mapping` |
| Five questions to ask, each with its purpose and its reversal | `## Questions to ask` |
| The day-of sheet closes the file, and a stated comp number stays consistent | `## Day-of cheat sheet` |

## Prerequisites

- **Required:**
  - a workspace `CLAUDE.md`. None → the workspace isn't set up; run
    profile's Setup before writing any file.
  - `jd-analysis/<key>.md` for this role. None → ask for the JD and
    suggest `evaluate` first (minutes, and the brief builds on its
    verdict). Never fabricate what's missing — a brief grounded in less
    data says so.
- **Optional** (each degrades, named): `company/<slug>.md` ·
  `storybank.md` + `stories/` (without it, questions map to
  competencies and each gets a gap pattern) · `contacts/<company>.md`
  · `knowledge.md` · `question-bank.md` + `practice-log.md` ·
  `negotiation/<company>.md` · prior briefs in `prep/` · the cover
  letter for this job.

## Sequences

**Prep has no loop.** A brief is built once per role and overwritten
on re-prep; a later round at the same company is continuation, not a
fresh start. The craft — construction order, formats, question
patterns, the portfolio protocol, the final mile — is
`references/patterns.md`; the file shape is `references/schema.md`.

### The brief (a sequence)

**Runs when** an interview is coming — the candidate asks; coach's "get me ready for the [company] interview" lands here (after evaluate when no analysis is on file); coach's inbox sweep arrives with a date and round, which go straight into the header line; outreach hands an interview booked here. **Read `references/patterns.md § The brief — getting there`** and build in its order. Write the whole brief to the file; in chat, the day-of sheet and the highlights.

Four things bind while you build, whatever the order:

1. **Banked beats generated, and the ladder is labeled.** A real
   question asked of THIS candidate (`question-bank.md`) leads and
   outranks anything researched or generated; `rough` is the top prep
   priority with a full counter. Every other question carries its cite
   or `[inferred]`. An empty bank is stated, never padded.
2. **Never sharpen.** A vague signal stays vague in the brief; a
   specific question built from it is `[inferred]`, never dressed as
   sourced.
3. **Fetch and cite before asserting.** Every company and interviewer claim carries its tier — verified / general knowledge / unknown; an external fact gets a source fetched this session, cited inline, or is not asserted (decided "no refresh needed"? then assert nothing new — the worst failure this skill can have). Interviewer research is public professional information only, from a URL, never a bare name, never personal life.
4. **The mapping never invents a story, and never deploys a struck claim.** Read `base-resume.md § Claim rules` before the positioning line and the counters: a ⚠ never-form stays out of anything the candidate will say aloud. A gap gets its pattern by name; a `draft` story is labeled, never counted toward the bar, and confirmed before the interview if it maps as a top pick; a story used in a prior round here is downgraded and flagged.

**Exits** with the brief on file and the day-of sheet in the reply.

### The satellites

Each reads the existing brief first and extends it; no brief → offer
to build one. Procedure in `references/patterns.md § The final mile`
and `§ Presentation rounds`.

| Ask | Runs when | Threshold | Exits with |
|---|---|---|---|
| Questions to ask | "what should I ask them?" | 5, each serving a purpose | the questions in the brief, with purpose, round, reversal |
| Concern anticipation | "they'll worry about X" / "how do I handle the gap question?" | every Significant+ concern has three framings and exact words | ranked concerns in the brief; a 3-round mini-drill offered |
| Day-of confidence | "it's in an hour — hype me up" | 10 minutes, from the brief — never regenerated | reel, 3×3, focus cue, warm-up — their state read first, never generic cheerleading |
| Presentation coaching | "help me with my presentation" | the 10-question Q&A table; the boundary stated up front (communication, never slides, correctness, or delivery) | arc, structure, timing, Q&A table in the brief |

## State

Owned: `prep/` — shape in `references/schema.md`, which also lists what
prep reads and never writes.

**Hands back:** drills and mocks on the brief → `practice`; a thin or
draft-heavy storybank → `storybank`; a knowledge gap in a counter →
`learn`; a thank-you after the round → the candidate, with outreach's
framework.

**Session close:** run `../profile/scripts/check_files.py --workspace .`
for the manifest. No checker-subagent is spawned — the brief is the
coach's voice, not the candidate's. **The candidate sees results as
outcomes, never narration**: clean is one line. Say what the workspace
now holds — the brief, its round and date.

## Guardrails

- Never invent interview-process details — round counts, panels,
  culture claims. "I don't have specific knowledge of X's interview
  culture" plus how to find out beats a plausible guess. Hedging 3+
  times in one output → stop and ask for the missing data.
- **Numbers and names are checkable — check them.** Any figure or name that exists in a workspace file must match it exactly (re-read before citing). Never state a statistic or named fact you cannot point to.
- Technical formats and presentations: coach communication, never correctness or delivery — name the boundary at the trigger (`references/patterns.md § The technical-format boundary`).

*Every reply ends with ONE contextual next step — a sentence with its
why, not a menu.*
