---
name: Job search intake
description: >-
  Use when starting a search, when the profile is thin, or when another skill
  needs one missing field. Capture what the user gives and write it to the
  private files.
---
# Job-search intake

`python3 "$JOBBI_ROOT/setup/intake.py" report` lists missing fields and the task each one blocks. `python3 "$JOBBI_ROOT/setup/intake.py" set --field <name> --value <json> --source <user-stated|extracted-from-resume|extracted-from-linkedin|extracted-from-file>` writes one field. Add `--date YYYY-MM-DD` when the day is not today. `python3 "$JOBBI_ROOT/setup/intake.py" confirm --id <id> --source user-stated` approves one extracted claim.

## Goal
Turn a resume, a LinkedIn paste, files, or chat into the private profile the other skills already read.

## Fields
target_roles, location, work_mode (remote, hybrid, onsite, or mixed), pay_floor (a whole number of dollars, or null), dealbreakers (a list, or an empty list), work_auth, claims, preferred_sources (a company name, or a board with ats_type plus slug or url).

## Rules
1. Let the user give the information however they have it. Extract only the fields above and write each one with `set`.
2. `--source user-stated` means they said it. `extracted-from-resume`, `extracted-from-linkedin`, and `extracted-from-file` mean you took it from something they supplied. The script stores that source and the date.
3. What the user says is approved and ready to use, claims included. Something you extracted gets one quick check ("I read X from your resume, right?"), and their yes approves it. Run `confirm` for that id. Do not edit `claims.yaml` by hand.
4. If `report` says drift, the saved answer and the file disagree. Ask which value to keep and `set` that one.
5. When another skill needs one missing field, ask that one question, `set` it, and hand back.
6. A job board or company they name is turned on right away. Intake does not edit base resumes or `precheck_terms.yaml`.
