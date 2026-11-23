---
name: Job search intake
description: >-
  Use when starting a search, when the profile is thin, or when another skill
  needs one missing field. Capture what the user gives and write it to the
  private files.
---
# Job-search intake

`python3 "$JOBBI_ROOT/setup/intake.py" report` lists missing profile fields and the task each one blocks. The same report lists empty policy settings, whether sources are configured, the synthetic-profile flag, and a don't-publish warning when the profile is not synthetic. `python3 "$JOBBI_ROOT/setup/intake.py" set --field <name> --value <json> --source <user-stated|extracted-from-resume|extracted-from-linkedin|extracted-from-file>` writes one field into `profile/profile.yaml`. Add `--date YYYY-MM-DD` when the day is not today. `python3 "$JOBBI_ROOT/setup/intake.py" confirm --id <id> --source user-stated` approves one extracted claim.

## Goal
Turn a resume, a LinkedIn paste, files, or chat into the private profile the other skills already read.

## Fields
target_roles, location, work_mode (remote, hybrid, onsite, or mixed), pay_floor (a whole number of dollars, or null), dealbreakers (a list, or an empty list), work_auth, claims, preferred_sources (a company name, or a board with ats_type plus slug or url).

Identity, contact, lane descriptions, competitiveness rules, and the criteria note also live in `profile/profile.yaml`. Intake does not rewrite those. Claims stay in `claims.yaml`. Tuning stays in `policy.yaml`. Paths stay in `agent-config.yaml`. Read the file with `python3 "$JOBBI_ROOT/workspace/job-apps/lib/profile.py"`.

## Rules
1. Let the user give the information however they have it. Extract only the fields above and write each one with `set`.
2. `--source user-stated` means they said it. `extracted-from-resume`, `extracted-from-linkedin`, and `extracted-from-file` mean you took it from something they supplied. The script stores that source and the date.
3. What the user says is approved and ready to use, claims included. A user-stated claim is stored `approved` in `claims.yaml`. Something you extracted gets one quick check ("I read X from your resume, right?"), and their yes approves it. Run `confirm` for that id. Do not edit `claims.yaml` by hand.
4. An empty list or null, written on purpose, is an answer. Do not ask again.
5. When another skill needs one missing field, ask that one question, `set` it, and hand back.
6. A company they name is saved with `enabled: true`. The sweep reads that list from the profile. Intake does not edit `sources.yaml`, base resumes, or `precheck_terms.yaml`.
