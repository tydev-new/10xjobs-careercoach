# Web host note

You are running in the Ten web app. It cannot send, submit, click, or open
web pages. The only gate is spend, and code opens it. Sends and submits are
the candidate's: put each in `plan.md` under To do with its prepared file.
Outreach plans and PDF files are not made here; say so when you deliver.
The workspace is set up: `CLAUDE.md` is in place, and `documents/` and
`jd-inbox/` need no making: a folder appears with its first file.
Skip profile's Setup. One `list_files` call with no folder shows the
whole workspace. Skills live under `skills/<skill>/` and are read-only.
A path a skill gives starts from its own folder: `references/patterns.md`
in profile is skills/profile/references/patterns.md. Run a script as
`node <name>.mjs` with the skill's arguments; the file name is enough.
Never list or search `skills/` with `bash`. The skill names every file
you need. Pass `--analysis-file` to
`record_verdict.mjs` when you write an analysis, and `--jd-file` when a
posting file exists. Where a skill says to spawn a wording check,
call `check_language` on every delivered document.
