---
name: Job search intake
description: >-
  Use when starting a search, when the profile is thin, or when another skill
  needs one missing field. Capture what the user gives and write it to the
  private files. Never approve claims, submit, or send.
---
# Job-search intake

`python3 "$JOBBI_ROOT/setup/intake.py" report` lists missing fields and the task each one blocks. `python3 "$JOBBI_ROOT/setup/intake.py" set --field <name> --value <json> --source <user-stated|extracted-from-resume|extracted-from-linkedin|extracted-from-file>` writes one field. Add `--date YYYY-MM-DD` when the day is not today.

## Goal
Turn a resume, a LinkedIn paste, files, or chat into the private profile the other skills already read. A partial profile is enough. Ask one short question, and only for the field the current task needs.

## Fields
target_roles, location, work_mode (remote, hybrid, onsite, or mixed), pay_floor (a whole number of dollars, or null), dealbreakers (a list, or an empty list), work_auth, claims, preferred_sources (a company name, or a board with ats_type plus slug or url).

## Rules
1. Let the user give the information however they have it. Extract only the fields above and write each one with `set`. Do not paste personal data into the public repo.
2. `--source user-stated` means they said it. `extracted-from-resume`, `extracted-from-linkedin`, and `extracted-from-file` mean you took it from something they supplied. The script stores that source and the date.
3. A claim is stored `unconfirmed`. The script refuses `status: approved`. When they confirm one id, run `python3 "$JOBBI_ROOT/setup/intake.py" confirm --id <id> --source user-stated`. That records the yes and still does not approve the claim. They approve it by editing that claim's status in `claims.yaml`. Until the status is approved, no skill may use it as proof.
4. An empty list or null, written on purpose, is an answer. Do not ask again. If `report` says drift, ask which value to keep and `set` that one.
5. Other skills keep working. Skip the step that needs a missing field, or ask for that one field, `set` it, and continue. Do not walk the whole list unless they asked to onboard.
6. A board saved here stays `enabled: false`. Turning a search on is a later source step. Intake does not edit base resumes or `precheck_terms.yaml`, and it never authorizes submit or send. Bundled examples stay synthetic.
