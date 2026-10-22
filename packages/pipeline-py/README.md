# pipeline-py: an optional local job-search pipeline (Python)

A command-line toolkit that keeps a job search in one SQLite database and builds application packages
(tailored resume + cover letter, as Markdown and PDF) that are checked by code before anyone sends them.
It runs on your own machine, next to an agent host such as **Claude Code** or **Codex**; the agent runs the
commands, reads their output, and asks you before anything leaves your machine.

It is **optional**. The skills in [`skills/`](../../skills/) work without it. Use it if you want a local job
database, a repeatable sweep of public job boards, and code gates on every resume and cover letter.

What it never does: submit an application, send a message, sign in anywhere, or post. `submit-gate` only
*checks* that a package is ready; you (or your agent, with your go-ahead) submit by hand.

## Install

You need Python 3.10+ and poppler (`pdftotext`, `pdfinfo`):

```bash
cd packages/pipeline-py
python3 -m pip install -r requirements.txt        # PyYAML, reportlab, jsonschema, pydantic, pytest
sudo apt install poppler-utils                    # macOS: brew install poppler
python3 -m pytest -q                              # offline; must end "passed"
```

## Quickstart with the example persona

`config.example/` is a complete data folder for **Alex Example**, a made-up person. Copy it and try the
tools before you put in anything of your own:

```bash
cp -r config.example jobsearch-data
cp jobsearch-data/sources.example.yaml jobsearch-data/sources.yaml
python3 jobsearch.py --config jobsearch-data paths        # where every file is read from
python3 jobsearch.py --config jobsearch-data claims ic    # the facts an "ic" package may use

# add a job by hand (the sweep does this from job boards; it needs the network)
python3 jobsearch.py --config jobsearch-data upsert --company "Acme Robotics" \
  --title "Senior Platform Engineer" --source web --url https://jobs.example.com/acme/1 --lane "IC builder"

# build a package: a skeleton spec, your edits, then the gated build
P=jobsearch-data/packages/2026-01-05/ic-acme-robotics
python3 jobsearch.py --config jobsearch-data build-package $P --init ic-builder \
  --company "Acme Robotics" --title "Senior Platform Engineer" --url https://jobs.example.com/acme/1
#   edit $P/package.yaml: resume edits and cover bullets, each citing claim ids from claims.yaml
python3 jobsearch.py --config jobsearch-data build-package $P --check
python3 jobsearch.py --config jobsearch-data build-package $P --write --run-id my-build-1
```

`--config DIR` and `$JOBSEARCH_HOME` do the same thing; with neither, the tools use `./jobsearch-data`.
`python3 jobsearch.py tools` lists every tool; each takes `--help`.

## Your own data

Everything personal lives in your data folder, never in this code: `profile/candidate.yaml` (name and contact
lines), `profile/claims.yaml` (the **only** source of facts a resume may state), `profile/criteria.md` (what you
want), `profile/agent-config.yaml` (lanes and settings), `sources.yaml`, your base resumes and the jobs
database. [`config.example/README.md`](config.example/README.md) explains each file. `jobsearch-data/` is
git-ignored; keep your copy out of every repository.

## The tools, step by step

| Step | Command | What it does |
|---|---|---|
| Find | `sweep` | reads public boards (Ashby, Greenhouse, Lever, SmartRecruiters, NEOGOV, HN "Who is hiring", some VC boards; LinkedIn's public guest search if you turn it on) into the jobs DB. Read-only on every site |
| Score | `score --id N --prompt`, then `score --id N --want ... --win ... --must ...` | renders the scoring prompt for your agent, then validates and stores its two-way (want / win) verdict as a step-6 record |
| Track | `find`, `update-status`, `render`, `export-csv`, `weekly-report` | the job list, its statuses and a weekly summary |
| Build | `build-package --init / --check / --write --run-id` | resume and cover from a base resume plus edits that cite claim ids; the claims, JD-copy and format gates run on every build |
| Review | `review-queue`, then 4 lens reviews, then `finalize-review` | four independent reviewers (hiring manager, age-signal and claims, recruiter, ATS), never the run that built the package; `finalize-review` records one verdict, worst lens wins, code gates folded in |
| Gate | `submit-gate` | last check: job is Packaged, the review is a current PASS, files match the spec, the posting is still open |

The full review flow, step by step, is in [`apply/rubric/apply-rubric.md`](apply/rubric/apply-rubric.md);
what a reviewer may read is in [`apply/rubric/reviewer-brief.md`](apply/rubric/reviewer-brief.md).

## Claude Code and Codex

Nothing here is tied to one agent host. Give the agent a shell in this folder and point it at your data
folder (`export JOBSEARCH_HOME=~/jobsearch-data`). The lens reviews should run as separate subagents or
sessions, each with its own `reviewer_run_id`; `finalize-review` refuses a review by the build's own run.

## Not included

- **Workday.** Tenants differ too much for one public reader. `sweep` calls your own script if you set
  `sources.workday.script`; see the comment on `fetch_workday` in `pipeline/sweep.py`.
- **Signed-in sites and form filling.** Out of scope on purpose.
- **CalCareers.** The reader is kept but off; the site needs a browser for search.

## License

MIT, the repository's [`LICENSE`](../../LICENSE).
