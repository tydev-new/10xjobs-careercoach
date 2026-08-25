---
name: interview
description: Use this skill when the candidate has an interview coming or wants to get BETTER at interviewing — e.g. "prep me for Anthropic", "I have a phone screen Thursday", "drill me", "mock interview for Writer", "what will they ask?", "what questions should I ask them?", "they'll probably worry about my short tenure", "hype me up, it's in an hour", "I keep bombing final rounds", "here's my interview recording", "the recruiter sent feedback", "start a training plan". Owns role prep briefs, live mock drilling, question banking, post-round debriefs, and transcript analysis.
---

# Interview — prep, live drill & debrief

## Goal

The candidate walks into every interview prepared and continuously builds interview mastery. Scored rounds are evaluated honestly at the candidate's seniority band. Records compound across prep briefs, practice logs, question banks, and story use counts. Scored by `references/eval.md`.

| Must be true | Where |
|---|---|
| Brief on file with current header metadata for scheduled interviews | `prep/<company_key>-<title_key>.md` |
| Predicted questions categorized (banked, researched with cites, generated `[inferred]`) | brief `## Predicted questions` |
| 5 reverse questions to ask with purpose and reversal triggers | brief `## Questions to ask` |
| Day-of cheat sheet closes the brief | brief `## Day-of cheat sheet` |
| Scored rounds logged: coach score first, band stated, self-assessment delta recorded | session file · `practice-log.md` |
| Real interview debrief leaves 4 writes (capture, log row, banked questions, story use counts) | session file · `practice-log.md` · `question-bank.md` · `storybank.md` |
| Question bank holds real questions asked of candidate (vague kept vague) | `question-bank.md` |
| Stated comp numbers and concessions routed to owner files | `negotiation/` · `base-resume.md § Claim rules` |

## Prerequisites

- **Required:** Workspace `CLAUDE.md` (none → profile's Setup); `profile.md` (seniority band); `jd-analysis/<key>.md` for role prep (suggest `evaluate` first if absent).
- **Optional:** `company/<slug>.md`, `storybank.md` (8+ confirmed stories for retrieval drills), `question-bank.md`, `contacts/<company>.md`, `courses/`.

## Loops and sequences

Brief construction, gated ladder, round mechanics, and root-cause diagnostics live in `references/patterns.md`.

### The brief (a sequence)

**Runs when** an interview is coming (candidate request, coach routing, or inbox sweep detection).

1. **Question Hierarchy:** Banked questions from `question-bank.md` outrank generated questions. Researched questions carry inline citations; inferred questions carry `[inferred]`.
2. **Never Sharpen:** Keep vague signals honest; do not fabricate specific questions as verified.
3. **Verified Claims:** Verify company and interviewer intelligence via public professional URLs (never personal data).
4. **Grounded Mapping:** Map questions to confirmed `storybank.md` stories. Never deploy a struck claim from `base-resume.md § Claim rules`.

**Exits** with the brief persisted to `prep/` and day-of sheet highlighted in chat.

### The drill (the loop)

**Runs when** candidate asks to practice, rep is due, or an upcoming interview warrants a live mock.

- **Standard:** 5 dimensions at candidate's seniority band (`references/eval.md`).
- **Budget:** Stated scored rounds per session. Read top of `practice-log.md` before round 1.
- **Each round:** Unscored warmup $\rightarrow$ question $\rightarrow$ answer $\rightarrow$ coach scores first $\rightarrow$ candidate self-scores $\rightarrow$ delta feedback with Interviewer's Read $\rightarrow$ ONE assigned change for next round.
- **Obligations:**
  1. *Score first:* Evaluate before asking candidate's read (calibration gap is core coaching signal).
  2. *State band:* Always evaluate against candidate's stated band.
  3. *Synthetic label:* Mark composite drills synthetic.
- **Exits:** Stage gate met, or session completed with Scoreboard row on top of `practice-log.md`; or **the ceiling: 3+ stagnant sessions on a dimension** → stop volume and diagnose root cause (`references/eval.md § Root-cause taxonomy`).

### The debrief (a sequence)

**Runs when** candidate reports back from a real interview.

- Emotional check-in $\rightarrow$ capture notes.
- **Four writes in same turn:**
  1. Capture file: `practice/<date>-real-<company>.md` (transcript or Q&A capture).
  2. Append round record to `practice-log.md`.
  3. Bank questions to `question-bank.md` (vague recall kept vague).
  4. Update story use counts in `storybank.md`.
- Route stated comp numbers to `negotiation/<company>.md` and conceded claims to `base-resume.md § Claim rules`.

**Exits** with all 4 writes persisted to disk.

### The satellites

| Ask / Scenario | Runs when | Exits with |
|---|---|---|
| Questions to ask | "what should I ask them?" | 5 reverse questions in brief (purpose, round, reversal) |
| Concern counters | "they'll worry about X" | 3-part counter framing for anticipated risks |
| Day-of confidence | "hype me up, it's in an hour" | 10-minute warm-up reel and focus cue (no generic fluff) |
| Mock interview | "mock interview for X" | Banked/predicted questions, curveball, hire signal, top 3 changes, 2 writes |
| Training plan | "start a training plan" | Weakness profile, 10–15 min daily reps |
| Transcript analysis | Recording/transcript provided | Relevance > Substance > Structure > Credibility scores, weakest answer rewritten |
| Presentation coaching | "help me with my presentation" | Communication arc, structure, and 10-question Q&A drill |

## State

Owned: `prep/`, `practice/`, `practice-log.md`, `question-bank.md`, `composite-target.md`, `negotiation/` (shapes in `references/schema.md`).

- **Hands back:** Thin storybank → `storybank`; TMAY re-tuning → `profile`; missing course → `learn`; funnel pattern → `coach`.
- **Session close:** Run `../profile/scripts/check_files.py --workspace .`. No checker-subagent is spawned (coach voice). Report outcomes, never narration (clean is 1 line; fix FAILs before reply ends).

## Guardrails

- Never fabricate interview process details, panel identities, or past questions without verified citations.
- Never deploy struck claims or unconfirmed story details into spoken candidate scripts.
- Fabricated answers in drills are a red flag to address directly, not polish.
- Comp coaching boundaries: record stated figures; never invent counter-offers.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
