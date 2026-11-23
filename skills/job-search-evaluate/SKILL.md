---
name: Job search evaluate
description: >-
  Use when deciding whether to apply, reading a job description, comparing
  roles, or researching a company for fit, before tailoring or submitting.
  Keep the sequence short.
---
# Job-search evaluate

Paths below are relative to the search workspace, `paths.search_workspace` from `python3 <apps-workspace>/lib/agent_config.py`. That command also names the jobs database and the candidate files.

## Goal
One verdict per role, ready for a decision. The candidate decides whether to apply. You give the odds and the blockers.

## Inputs
Job text or a link, and maybe a company. Read `criteria.md` and `profile.md` first. They hold the lanes, location, dealbreakers, pay floor, and competitiveness rules. If `profile.md` is still the onboarding stub, use `criteria.md` and the yaml files. Read approved facts from `claims.yaml` with `python3 <apps-workspace>/lib/claims.py <scope>`.

## Sequence
1. **Near match.** Look the role up first with `python3 pipeline/find.py --company "<co>"` or `--url <url>`. Do not add a duplicate. Update the existing row. Add a new row only with `pipeline/upsert.py`.
2. **Dealbreakers.** Check the dealbreakers in criteria.md, such as sponsorship, location, clearance, or an obvious spam or fake posting. On a dealbreaker, run `pipeline/update_status.py --status Skipped --skip-reason <code>` (or Blocked) with the quoted reason, and stop before deep research.
3. **Lane.** Assign one lane from criteria.md, or Off-lane. Apply any standing competitiveness rules in criteria.md for that lane.
4. **Pay.** Compare the offer with the floor in criteria.md. Follow criteria.md on when a low-cash fit stays Stretch instead of Skip.
5. **Read the role, only if it is still alive.** Summarize the role, separate must-haves from nice-to-haves, and list gaps against the profile and claims. Use the five-part fit score only when it changes the verdict. Write a company fact only when you can source it. A must-have that no approved claim covers is a hard-requirement gap. Record it as a blocker, not a soft gap, so apply flags it instead of writing around it.
6. **Verdict.** Strong, Solid, Stretch, Long-Shot, or Weak. The default apply queue is Strong and Solid only, unless the candidate says otherwise. A Stretch needs one line on why.
7. **Save.** Run `pipeline/score.py --id <id> --want … --win … --must "need :: proof" --gap … --blocker …` (this is step 6 in the scorer).
   - It checks the fit (fitcheck.py), writes `jd-analysis/job-<id>-*.md` plus the `.json` record that apply reviewers use for gaps and blockers, and updates the database row.
   - List every unproven must-have as a `--gap` or `--blocker`.
   - Do not edit `jobs.md`. It is a generated view.
   - When packaging later, the apply skill copies the job text and company research into the package as `jd.md` and `company-research.md`. Those files are required. Evaluate notes alone are not enough.
8. **Card.** A short chat summary: the verdict, why, the top gaps and blockers, and the next step.

Do not pad the write-up after a dealbreaker.

## Guardrails
Be honest. Do not cheerlead. Do not skip a role because the floor, the place, or a dealbreaker is still unknown.
