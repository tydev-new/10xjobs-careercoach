---
name: evaluate
description: Use this skill when the candidate wants to evaluate a role, a job description, or a company — e.g. "should I apply to this?", "evaluate this role at Writer", "decode this JD", "research this company", "compare these three roles". Produces one combined verdict from JD decoding + company research, persists the analyses, and records the verdict in the pipeline record (jobs.md).
---

# Evaluate — role + company, one verdict

## Goal

One decision-ready verdict per role. **The candidate decides whether to
apply; you give the odds and the blockers.** Keep the sequence lean.

## Inputs

JD text/URL and/or company name. Read `criteria.md` and `profile.md`
first (tracks, geo, dealbreakers, comp, and criteria's own
competitiveness filters).

## Sequence (keep lean)

1. **Near-match:** Match against an existing `jobs.md` row before
   creating a duplicate; update the existing row instead of forking one.
2. **Dealbreakers — stop before research spend.** A hard hit
   (sponsorship required, geo mismatch, clearance unless opted in,
   obvious spam/ghost) is recorded immediately, in two steps, the exact
   reason quoted both times:

   ```
   python3 scripts/record_verdict.py --workspace . --company <company> --title <title> --verdict weak --score 0 --reasons "dq: <quote>"
   python3 ../search/scripts/update_job.py --workspace . --company <company> --title <title> --dismiss --reason "dq: <quote>"
   ```

   The first command creates the row if none exists; a role already
   swept skips straight to the second command. Stop here — no deep
   decode, no company research spend.
3. **Track:** Assign the track per `criteria.md § Targets` before
   judging fit; name it in the verdict, the row, and the analysis
   header.
4. **Comp:** Compare against the floor in `criteria.md`. A cash-light
   role can still land Investable Stretch rather than Weak when
   `criteria.md` says so — the file decides, not a hard cash rule.
5. **Decode (only if still alive):** Role summary, must-haves vs
   nice-to-haves, gaps vs `profile.md` (storybank evidence where it
   exists). Go deeper only when it would change the verdict.
6. **Verdict — the repo's four tiers, no others:**
   - **Strong Fit** (`strong`)
   - **Investable Stretch** (`investable_stretch`) — needs a one-line
     why
   - **Long-Shot Stretch** (`long_shot`) — needs a one-line why
   - **Weak Fit** (`weak`)

   Record it: `python3 scripts/record_verdict.py --workspace . --company
   <company> --title <title> --verdict <value> --score <0-100> --reasons
   "..." [--dealbreakers "..."] [--track <A|B|C>]` — on the row's exact
   company/title strings, never a fresh spelling.
7. **Persist:** `jd-analysis/<key>.md` (short), plus the `jobs.md` row
   the script just wrote.
8. **Card:** A short chat summary — verdict, why, top gaps, recommended
   next step.

Do not pad the decode after a dealbreaker fires. An honest "could not
find" beats a fabricated company fact.

## Quick-scan

A lightweight screening pass stamps
the verdict `quick-scan:` in `jobs.md`'s reason field instead of running
the full sequence. Graduating a quick-scanned role to a full evaluation
later always names the prior score — a graduation is a comparison, not
a fresh read.

## Apply queue

The default apply queue is **Strong Fit or Investable Stretch, per
`criteria.md`** — not every role that clears the dealbreaker gate. The
candidate can always override.

## Session close

Run `../profile/scripts/check_files.py --workspace .`; fix a FAIL
before the reply ends. Report outcomes, never narration.

## Guardrails

Honest, not cheerleading. Never synthesize uncertain sources into a
confident claim — say what you could not find.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
