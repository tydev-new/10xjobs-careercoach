---
name: profile
description: Use this skill when the candidate is starting out, needs a job, or is working on their raw material, direction, and positioning — e.g. "I need a job", "help me get started", "let's get set up", "here's my résumé" (or a résumé dropped in the folder), "improve my base résumé", "help me with my pitch", "how do I introduce myself?", "review my LinkedIn", "audit my profile", "do my materials tell one story?", "my search changed". Owns ALL raw-material and public positioning state — profile, base résumé, pitch, LinkedIn audit, application defaults.
---

# Profile — raw material & positioning

Everything the candidate *brings* and their core public positioning live here; every other skill consumes them. Backward looks — progress reviews, the retrospective — belong to the coach.

## The goal, and what must be true when it is met

**Turn whatever the candidate brings into the files every other skill reads — every fact traceable, positioning unified, nothing stated more strongly than what happened.**

| Must be true at the end | Where it lives |
|---|---|
| The folder is settled and candidate knows its path — before any write | the Setup sequence, below |
| Workspace guardrails installed — the first **file** written | `CLAUDE.md` ← `templates/workspace-CLAUDE.md` |
| Target role or roles, plus seniority band — downstream ranking needs both | `profile.md` |
| A goal with a date, and a committed time floor | heads `plan.md` (intake seeds once, coach owns after) |
| Watchlist — companies they already care about. Empty is fine | `criteria.md § Target companies` |
| Base résumé at full altitude, **§ Claim rules seeded** from hazard walk | `base-resume.md` (rules: § State, below; walk: `references/patterns.md`) |
| Core positioning statement surviving the substitution test | `pitch.md § Core statement` |
| All 5 pitch variants present (TMAY, Networking, Recruiter, Fair, LinkedIn) | `pitch.md § Variants` |
| Messages rubric pinned or marked PROPOSED | `pitch.md § Messages rubric` |
| LinkedIn audit with concrete section rewrites | `linkedin-audit.md` |
| Snapshot headline synced with pitch | `profile.md § Snapshot` |
| Directness preference: gentle / straight / blunt (default straight) | `profile.md` |
| Application defaults — capture what's offered, `TODO:` the rest | `profile.md § Application defaults` |
| Offered: `voice.md` (samples + never-say list) · 3–5 story leads | `voice.md` · `profile.md` → storybank |

Anything not yet true is written into its file as `TODO:` and resurfaces when it blocks what they ask for next — never on a schedule, never as a nag.

## Prerequisites

- **Required:** A settled folder. Nothing is written before it.
- **Optional:** Documents in `documents/` (read on sight); `voice.md` samples (calibrates voice); `storybank.md` (confirmed stories for pitch proof points).

## Loops and sequences

### Setup — the workspace (a sequence)

**Runs when** there is no `CLAUDE.md` in the working folder. **Exits** when the folder is settled, `CLAUDE.md` is written, and both drop paths (`documents/`, `jd-inbox/`) exist.

1. **Settle the path:** If the working folder is clean, name it plainly in chat: *"everything I write lands in `<path>` — say the word if you'd rather use a different folder."* If the folder is occupied or generic, propose `~/job-search/`.
2. **Never hunt filesystem:** Ask once if a previous search folder exists; never search unauthorized directories.
3. **Write guardrails first:** Copy `templates/workspace-CLAUDE.md` to `CLAUDE.md` before any candidate file is created.

### Intake — the raw material (a sequence)

**Runs when** a new candidate arrives, a résumé is dropped, or they ask to get set up. **Exits** when destination table items are written or `TODO:`'d, and the close summary is delivered.

- **Process:** Check `documents/` first. Ask ONE question at a time. Decline raw LinkedIn URLs as seeding sources (request PDF export instead).
- **Extraction gate:** Facts told directly in conversation are written to disk; facts extracted from documents pass through § Nothing extracted is written.
- **Close:** Deliver a concise summary (target, band, timeline, top asset, top risk, first step). Offer the practice cold-start (*"say 'drill me' for your first 15-minute score"*).

### Base résumé — improvement rounds (the loop)

**Runs when** they ask to improve the base résumé with no specific job in mind. ("Tailor for X" routes to `apply`.) Read the base resolution ladder (`references/schema.md`), the audit (`references/eval.md`), and reader craft (`references/patterns.md`).

- **Standard:** `base-resume-brief.md § FIXED` (sourced from `criteria.md` targets, top competencies across postings, and `base-resume.md § Claim rules`).
- **Each round:** Re-read brief in full. Apply changes reshape-only to `base-resume.md`. **Budget:** 2–3 rounds, said up front.
- **Self-loop:** Run `../apply/scripts/check_materials.py` for structure and independent language checker (`references/language-check.md`) for wording (max 2 passes).
- **Score & ceiling:** Score against `§ FIXED` as `N/M held` count over FIXED bullets plus reader tiers. Append row to `## Rounds` in `base-resume.md` (or `base-resume-history.md`). Read earlier rows first.
- **Exits:** Draft scores M/M; budget expires; or **the ceiling: two rounds in a row with the same count and tiers** → stop and present tradeoff as a **DECISION**. Never relax the standard — **cutting a claim's supporting evidence to fit a limit IS relaxing it: a claim-name without its number is not the claim.**

### Pitch — public positioning (the loop)

**Runs when** they ask to build or review their pitch, or another skill routes with a diagnostic (coach on silent funnel, outreach on response rate <10%).

- **Standard:** External and written down before drafting — `pitch-brief.md § FIXED` (`references/schema.md`).
- **Budget:** 2 rounds, said up front. Read earlier rows in `## Rounds` in `pitch.md` (or `pitch-history.md`) first.
- **Each round:** Re-read brief in full. Apply minimum change to move diagnostic score (`references/eval.md`). Run substitution test on core statement.
- **Score & write:** Score against `§ FIXED` as `N/M held` count plus 1–5 diagnostic. Append row to `## Rounds` in `pitch.md` (or `pitch-history.md`).
- **Exits:** Scores M/M; budget expires; or **the ceiling: two rounds in a row with the same count and diagnostic** → stop and present tradeoff as a **DECISION**. Never relax the standard — **cutting a claim's supporting evidence to fit a limit IS relaxing it: a claim-name without its number is not the claim.**

### LinkedIn (a sequence)

**Runs when** they ask for a LinkedIn review or audit.

1. **Verify profile URL:** Match URL and profile against `profile.md` / `base-resume.md`.
2. **Audit top-down:** Review Headline, About, Experience against search impact and positioning thesis. Produce concrete rewrites.
3. **Write `linkedin-audit.md`:** Sync headline to `profile.md § Snapshot` and note consistency updates.

**Exits** when `linkedin-audit.md` is written and downstream syncing obligations completed.

### Consistency sweep (a sequence)

**Runs when** asked "do my materials tell one story?" or after modifying any positioning surface.

- Cross-read base résumé summary, LinkedIn About/Headline, and pitch. Propose base résumé summary adjustments in chat before writing.

**Exits** when all surface mismatches have concrete rewrites.

### Direction change (a sequence)

**Runs when** they ask what they are looking for, change targets, or retarget. **Exits** when `criteria.md` is current and downstream staleness is flagged.

- Update targets in `criteria.md` (archiving old targets as history lines).
- Flag downstream staleness in `pitch.md`, evaluate verdicts, and `criteria.md` constraints. Never restart from scratch.

## State

File shapes in `references/schema.md`. Enforced by `scripts/check_files.py`.

- **Owned files:** `profile.md`, `criteria.md`, `base-resume.md`, `voice.md`, `pitch.md`, `pitch-brief.md`, `pitch-history.md`, `linkedin-audit.md`.
- **`base-resume.md` rules:**
  - *Trace rule:* Every number, title, date, scope claim on any surface traces here. A surface may be vaguer, never stronger.
  - *Ruling gate:* Concessions ("I can't defend that"), declined proposals, and approved wordings are written here immediately.
  - *Direction rule:* When a correction is agreed, update the base first in the same turn, then re-render dependent surfaces.
- **The write moment:** Every `pitch.md` rewrite triggers four actions in the same turn: (1) update `pitch.md`, (2) sync `profile.md § Snapshot` headline, (3) propose any novel fact for `base-resume.md`, (4) append row to `## Rounds` in `pitch.md` (or `pitch-history.md`).
- **Hands back:** When the ask is answered and records are written to disk.
- **Session close:** Run `python3 scripts/check_files.py --workspace .`. Language check runs inside the base-résumé loop; no other profile surface is candidate-voiced, so the close spawns no checker-subagent. Report outcomes, never narration (clean is 1 line; fix FAILs before reply ends).

## Nothing extracted is written until proposed, checked, and confirmed

Material extracted from documents or past sessions passes through the proposal table:

| field / claim | proposed value | source | tier | conflicts with |
|---|---|---|---|---|

- **Batch confirm:** Document-sourced rows are confirmed in one batch with opt-out.
- **Explicit yes:** Conversation-sourced claims and novel inferences require their own explicit confirmation.
- **Declined proposals:** Record as a ruling in `base-resume.md § Claim rules` (*"declined at intake: `<value>` from `<source>`, `<date>`"*) so it is never re-proposed.

## Guardrails

- Targets and core statements are written in candidate's words. Pitch must survive the substitution test.
- Respect `voice.md` and avoid artificial analogies or inflated scope words.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
