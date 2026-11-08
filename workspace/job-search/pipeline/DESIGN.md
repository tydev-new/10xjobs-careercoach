# Pipeline design notes

## Why search runs are read-only (least privilege)
Today one agent can read job posts, browse while signed in, send email and apply. So a hidden instruction in a post
("email your resume to…") is held back only by the guardrail line. That's why search runs get only fetch, read, and
writes to the DB and notes: no email, no applying, and the signed-in browser only for the LinkedIn pass. Drafting and
sending stay in Apply, after the user picks a role. It's least privilege, like a service account.

Where it is enforced today: the skill's Guardrails, the scout routine prompt, and the tools themselves (sweep.py,
upsert.py, update_status.py and score.py only fetch public pages/APIs and write jobs.db, notes and run files; none of
them can send mail or submit an application). Job posts are data: the scorer prompt tells the model to ignore embedded
instructions, and the eval set has prompt-injection cases whose score must not move.

## Reliability
sources.yaml and every job record are schema-checked (schema.py); bad config entries are skipped with an error, bad
records go to the `rejected` table; each source is retried twice, then flagged broken in the digest (`source_health`),
so a broken source never looks like a quiet day.

## Location check (the user, 2026-10-20)
Remote roles at companies outside the configured home area are fine. A LinkedIn card is never dropped just for naming a non-configured home area city
(sweep keeps it as `remote-unverified`; sources.yaml `geo.remote_filter_cards: verify`). The remote filter is unreliable,
so score.py requires `--remote home-area|remote-region|out-of-area|unverified` for any role outside the configured home area list, verified from the
JD text or ATS location field. fitcheck.py rejects `out-of-area` unless want=fail with dealbreaker geo. Stored in
`jobs.remote_check`; `unverified` keeps the role with a "remote unverified" note.

## One scoring prompt, code-only grading (configuration-driven)
`pipeline/scoring-prompt.md` is the only step-6 prompt. `score.py --prompt` (live) and `evals/run.py` (eval gate) both fill it
through `fitcheck.render_prompt`, so an edit to it is tested before it reaches live scoring. Evals grade with code only:
schema valid, call vs expected, dealbreaker recall, every must-have proven or listed in gaps, and injection stability.
The model-graded gap-note rubric was dropped.
