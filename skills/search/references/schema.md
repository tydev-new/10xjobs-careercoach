# Search — the file shapes

What the scripts verify, plus what the files must hold. **Every record
here is script-written, and the script that writes a file is the
authority on its row format** — this file describes the shapes so you
can read them; it never becomes a second rulebook. Read it before
touching any of these files by hand (which should be nearly never).

## `jobs.md` — the pipeline record, readable as the board

One labeled block per role, organized by stage sections, dismissed roles
last with their reasons. Script-written: sweeps append · `update_job.py`
moves stages, dismisses, restores (loud-fail on ambiguous matches) ·
evaluate's `record_verdict.py` judges. Read it anywhere.

- **A role's URL is the employer's own posting — it is the application
  link.** Aggregator URLs never sit on a pipeline role. The one other
  URL a row may carry: a hiring-manager's LinkedIn post
  (`source=linkedin_post`), because some of those roles never reach a
  board.
- Every candidate pick from `criteria.md § Target companies` gets the
  relaxed theme filter — a borderline role at a company they named still
  surfaces; seniority and geo still apply.
- Near-identical JDs under different companies are flagged as
  cross-listed (employer + agency double-post).
- The optional `## Search notes` tail carries search OUTPUT the candidate
  should see — market signals, lane findings, dated.
- **Dismissal reasons carry groupable prefixes.** Agent-written:
  `stale:` · `outranked:` · `dq:` · `duplicate:`. Script-owned (already
  consistent): `delisted (` · `closed (`. Dismissed is never deleted —
  every dismissal carries its reason and is revivable, and the reason
  distribution is the plan-revision evidence.

## `companies.md` — the working set

Script-written every sweep; humans read it, they don't edit it. The
candidate's own picks live in `criteria.md § Target companies` — rows
sourced from there regenerate each run (their deletions propagate);
discovered and cloud rows persist with provenance.

- `## Companies` — one table; `search_ats.py` owns its columns and
  status values and prints them. The Board column is the resolved ATS
  path — the resolution cache lives here, readable.

## `jd-inbox/<company>-<title>.md` — the raw JD, as swept

Free-form body. The header carries the source URL and criteria
provenance. Linked from the pipeline row; `evaluate` reads it instead of
re-fetching.

## `criteria.json` — a generated projection of `criteria.md`

Never edited directly; the script hard-rejects unknown keys and bad
types. Regenerated at the sweep's first step when `criteria.md`
changed (`../SKILL.md § The sweep`); the script prints a loud staleness
warning when the projection is older than its source, so a forgotten
regeneration cannot pass silently. Regeneration
preserves `widened_by` unless `criteria.md` itself changed.

## `leads.md` — INTERNAL: the lead tier's working file

Not the candidate's reading. A lead is unvalidated by definition, so the
candidate never sees one — validation is a pipeline step: a sweep that
lands the role in `jobs.md` promotes the lead; an unconfirmed lead older
than the stale window expires ("never confirmed → never real → never
shown"). The one manual rung is the sweep's high-signal check
(`../SKILL.md § The sweep`). The file persists as the record the lead
statistics are computed from. Never deleted.

## What search writes in a file it does NOT own

`criteria.md` belongs to profile and the candidate. Search's single
write to it is **`§ Search plan`, on the candidate's explicit yes** — the
standing plan: instruments + queries + why. Scheduled runs execute it
verbatim. `§ Search settings` is theirs to edit — four bullets, and
`search_ats.py` matches them by the exact label prefixes it defines
(`SETTINGS_KEYS`); a bullet under any other label is silently skipped, so
copy the labels from the script's report, which prints the values in
force every run.

## `autopilot-log.md` — the scheduled-run log

Appended by `scripts/autopilot_sweep.py`, one entry per run. Read it
for the pass history; never edited by hand.
