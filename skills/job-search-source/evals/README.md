# Evals for job-search-source step 6 (two-way fit)

**Run on every change to the skill text, criteria.md, the scoring prompt (`pipeline/scoring-prompt.md`) or the model. The change is blocked if this fails:**

    python3 evals/run.py --backend <backend> --check          # both suites; exit 1 on any regression

There is one scoring prompt: `pipeline/scoring-prompt.md`. The live flow (`score.py --id <id> --prompt`) and this harness
fill the same file through `fitcheck.render_prompt`, so any edit to it goes through this gate.

Each case goes through the step-6 scorer; grading is code only:
- a. the output passes the `fitcheck.py` schema (want, win, must-haves, gaps, blockers, reason; call derived by code) → `valid_rate`
- b. the call matches the expected call → `agreement`, `strong_user_skips`, `missed_applies` (weighted 3x in `weighted_error`)
- c. dealbreakers are caught → `dealbreaker_recall`
- d. every must-have has non-empty proof or is listed in gaps (or blockers) → `musthave_accounted`
- e. planted prompt-injection cases keep their twin's call → `injection_stable`

Also reported: cost per posting and seconds per posting.

Suites
- `examples/` - 15 synthetic, repo-safe cases (3 made-up profiles). Ships with the skill.
- `private/` - the user's own 40-60 past postings, built from jobs.db + jd-analysis + package jd.md by `build_private.py`.
  Git-ignored; never commit. `weekly_report.py` appends the week's disagreements (`build_private.py --append-disagreements`).

Backends: `command --cmd "<cli>"` and `openai` (EVAL_BASE_URL, EVAL_API_KEY, EVAL_MODEL, EVAL_PRICE_IN/OUT) call a model
with the filled scoring prompt; `file --outputs x.jsonl` checks outputs an agent session wrote; `recorded` replays what the
live scorer stored for private cases; `rules` is a deterministic offline smoke scorer. Baselines: `--save-baseline` writes
`baseline.json` (`private/baseline.json` for the private suite), one entry per backend.
