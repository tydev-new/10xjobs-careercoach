# Evals for step 6 (two-way fit)

Run this gate before any change to the skill text, criteria.md, the scoring prompt (`pipeline/scoring-prompt.md`)
or the model. The change is blocked if it fails:

    python3 jobsearch.py evals --backend <backend> --check     # both suites; exit 1 on any regression

## What is in this folder

- `run.py` runs the cases and grades them with code.
- `../fitcheck.py` is the fit schema and the code checks (want, win, must-haves, gaps, blockers, reason; the call is worked out by code).
- `../scoring-prompt.md` is the one step-6 scoring prompt. The live scorer (`jobsearch.py score --id <id> --prompt`) fills this same
  file through `fitcheck.render_prompt`, so an edit to it is tested here before it reaches live scoring.
- `examples/` holds 15 made-up cases for 3 made-up profiles. No personal data.
- `agent-runs/examples-agent-outputs.jsonl` holds scored outputs for the examples, for the `file` backend.
- `baseline.json` holds the saved baseline for the examples suite, one entry per backend.
- `build_private.py` builds the private suite from the user's own jobs DB.

## The private suite

The user's own past postings (applies, skips, interviews) are the real answer key. They never live in this folder.
The runner looks for them in `--private DIR`, then `$JOB_SEARCH_EVAL_PRIVATE`, then `<home>/evals/private` (the data
folder from `pipeline/home.py`). That folder holds its own `cases.jsonl`, `profiles/`, `baseline.json` and `results/`,
plus a `.gitignore` that ignores everything. If it is missing, the runner says so, skips it and checks only the examples.
Build or refresh it with `jobsearch.py build-private-evals`; `jobsearch.py weekly-report` adds each week's disagreements.
The offline `rules` backend reads its location list, pay floor and skill words from `evals.rules` in agent-config.yaml.

## How grading works

Every check is code, with no AI judge:
- a. the output passes the `fitcheck.py` schema: `valid_rate`
- b. the call matches the expected call: `agreement`, `strong_user_skips`, `missed_applies` (a missed apply counts 3 times in `weighted_error`)
- c. dealbreakers are caught: `dealbreaker_recall`
- d. every must-have has proof or is listed in gaps or blockers: `musthave_accounted`
- e. planted prompt-injection cases keep their twin's call: `injection_stable`

Also reported: cost and seconds per posting.

## Backends

- `rules`: offline scorer with no model. A smoke check, cost 0.
- `file --outputs x.jsonl`: grades outputs an agent session already wrote.
- `recorded`: replays what the live scorer saved for each private case (skipped for the examples, which have none).
- `command --cmd "<cli>"` and `openai` (EVAL_BASE_URL, EVAL_API_KEY, EVAL_MODEL, EVAL_PRICE_IN, EVAL_PRICE_OUT) call a real model with the filled prompt.
  Any CLI that reads a prompt on stdin and prints JSON works, e.g. `--cmd "claude -p"`.

`--save-baseline` writes the current metrics as the new baseline for that backend (`baseline.json` here for the
examples, `baseline.json` in the private folder for the private suite). Examples results go to `--results DIR`,
`$JOB_SEARCH_EVAL_RESULTS`, or `<home>/evals/results`. Private results stay in the private folder.
