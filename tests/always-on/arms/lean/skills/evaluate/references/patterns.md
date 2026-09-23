# Evaluate — the craft that binds

Reading a JD, researching a company, and assessing fit are the model's
own judgment. This file holds only the parts a script enforces or a
promise to the candidate binds. Rules live in `../SKILL.md`; the
scoring standard in `eval.md`.

## Intake

The JD and the company name. A swept role's JD is already in
`jd-inbox/` — read it from the row's `jd_file`, don't re-fetch it.

## Dealbreakers — the two-step

For a pasted role with no row yet:
```
python3 scripts/record_verdict.py --workspace . --company <company> --title <title> --verdict weak --score 0 --reasons "dq: <quote>"
python3 ../../search/scripts/update_job.py --workspace . --company <company> --title <title> --dismiss --reason "dq: <quote>"
```
Same reason, both times. An existing row (already swept) skips straight
to the second command.

## Recording the verdict

`python3 scripts/record_verdict.py --workspace . --company … --title …
--verdict … --score … --reasons … --dealbreakers …` (`--help` for all
flags) — on the row's exact strings; a fresh spelling forks the record.

## Fit assessment

Judgment — the five dimensions, weighed against `profile.md` and
storybank evidence, are the model's own read.

## Company research

Source selection and research depth are judgment calls. Claim tiers are
not: **Tier 1 — Verified** (the company's own site/careers/blog or the
JD; cite the source). **Tier 2 — General knowledge** (widely documented
public facts about well-known companies; label clearly). **Tier 3 —
Unknown** (couldn't verify; say so). Three uncertain sources presenting
a range is honest; three uncertain sources becoming one confident claim
is not.
