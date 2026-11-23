---
name: Job search source
description: >-
  Use when finding new openings: a scheduled scout run, or the user asking
  what is new or to search a new field or company. Daily apply prep does not
  search. It reads Strong and Solid candidates from jobs.db. This skill is not
  for judging one posting or for applying.
---
# Job search source

Inputs are the user's profile (`python3 "$JOBBI_ROOT/workspace/job-apps/lib/profile.py"`: roles, location, work mode, pay, dealbreakers, lanes, and the criteria note, including how many strong sources they want) and sources.yaml. Tools live in the workspace pipeline folder: sweep.py, upsert.py, update_status.py, find.py, score.py, and weekly_report.py. sweep.py reads roles, places, and named boards from the profile. The eval check ships with this skill in evals/.

## Sequence
1. Read profile.yaml. Do not copy its rules into this skill.
2. Build or extend sources.yaml for the user's field.
   - Find companies from venture-capital portfolios, funding news, top-company lists, and peers of strong past matches.
   - Detect each company's applicant-tracking system from its careers links (jobs.ashbyhq.com/<slug>, boards.greenhouse.io/<slug>, jobs.lever.co/<slug>, jobs.smartrecruiters.com/<slug>, myworkdayjobs.com).
   - Add boards that belong to the field (government job sites, industry boards).
3. Run sweep.py for the time window (the default is since the last sweep). It checks sources.yaml and every job record against a schema, retries a failing source twice, records health per source, drops duplicates against the jobs database, and saves new roles as To Review. Write new code only for a system it does not support. The steps are under New system below. Test one company first (`sweep.py --test-one <type>:<slug>`).
4. Use the signed-in browser only for what scripts cannot reach (LinkedIn network and recruiter signals). Save each find with `upsert.py --source <source> --run-id <run>`, which records a sighting for that source. upsert.py checks the new row against the same job-record schema before insert. manual and referral may omit the link. Every other source needs an http or https link. A bad row is not saved.
5. Everything goes into the jobs database through these tools. Duplicates match on company plus title, the requisition id, and the link. Do not hand-edit jobs.md or the database. jobs.md and active.md are generated views.
6. Score fit with evals/scoring-prompt.md in this skill. That is the one scoring prompt. The pipeline's scoring-prompt.md points at it. Do not repeat its rules here. Fill it for a role with `score.py --id <id> --prompt`, then save with `score.py --id <id> --want … --win … --must "need :: proof" --gap … --blocker … --remote … --reason …`. The script checks the structured result before saving and writes jd-analysis/<job id>.md. Use `update_status.py` for status changes, with `--by user` when the user made the call.
7. The tools rebuild active.md after every write. Message the user only about new strong matches they have not been told about, and mark those told (`upsert.py --told`).

## New system
The sweep already fetches ashby, greenhouse, lever, smartrecruiters, workday, linkedin_guest, gov, hn_whos_hiring, getro, and a16z. For another system, add `pipeline/adapters/<type>.py`. Do not edit sweep.py.
1. Copy the closest `fetch_*` in sweep.py for the request and the parsing. Use `adapters/example_board.py` for the file shape: `TYPE = "<type>"` and `fetch(cfg, since, ctx)` returning `(postings, stats)`. Stats use the same keys as the other fetchers: requests, ok, failed, fetched, gap, errors.
2. Each posting needs company, title, an http or https url, source `ats:<type>`, and extra set to a dict. It must pass schema.JobRecord. Loading the file adds TYPE to the allowed list. `--test-one <type>:<slug>` and `--test-source <type>:<slug>` pass that slug on cfg["slug"] and ctx["only"].
3. Add an invented fixture at `pipeline/tests/fixtures/<type>.json` and a test in `pipeline/tests/test_sources.py` like the other source tests. The test must not use the network.
4. From pipeline/, run `python3 -m pytest -q tests`. Then try one live company: `sweep.py --test-one <type>:<slug>`. `--add` still only writes sources.yaml for ashby, greenhouse, lever, and smartrecruiters. For a new type, add the source to sources.yaml yourself after that check looks right.

## Learn
Each week, rank sources by the user's picks, applications, and interviews first, and by model fit scores second (`weekly_report.py`). Cut sources that produce nothing. Expand strong ones with similar companies. Never cut a source the user chose to keep (`protected_sources` in sources.yaml).
If fewer strong sources than the target in the profile criteria note produced strong matches in the last 2 weeks, find more (peers of the best sources, venture-capital portfolios, field boards). Test each with one sweep (`sweep.py --test-source <type>:<slug> --add`), keep the ones that produce, and repeat until the target is met or nothing new turns up.
Record why roles are skipped. When the same reasons pile up, suggest tighter rules in the profile criteria note or in a lane's competitiveness field. Do not apply those rules yourself.

## Evals
The eval check ships in evals/. It holds the runner (run.py), the fit checks (fitcheck.py), the one scoring prompt (scoring-prompt.md, which the live score.py also uses), and 15 made-up starter cases with no personal info (examples/). Before any change to this skill, profile.yaml, scoring-prompt.md, or the model, run `python3 evals/run.py --backend <backend> --check`. It scores the starter cases and the user's own set, grades every result in code, and exits nonzero if agreement drops or misses rise. Block the change when it fails.
The user's own set is built from past applications and skips by the pipeline's `evals/build_private.py`. It lives outside this skill, at <search-workspace>/pipeline/evals/private by default (set another folder with `--private DIR` or JOB_SEARCH_EVAL_PRIVATE). It never goes in this folder or in any repo. If it is missing, the runner says so and checks only the starter cases. Use `--save-baseline` only when the user accepts the new results. Add disagreements to the user's set weekly (weekly_report.py does this).

## Guardrails
A search run may fetch, read, and write the jobs database and notes. Nothing else. No email. No applying. The signed-in browser is only for the LinkedIn pass. Fit scores are structured (want, win, gaps, reason) and checked in code before saving.
sources.yaml and every job record are checked against the schema. A failing source is retried twice, then flagged broken in the digest.
This skill finds and records roles. It does not build a package, apply, or contact anyone. A quiet run stays quiet. Skip a lane or location filter you do not have yet.
