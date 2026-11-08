# Apply pipeline (2026-11-04)

Run from <apps-workspace>. `UPD=<search-workspace>/pipeline/update_status.py`. Never hand-edit jobs.db. Nothing is submitted except by a person-approved browser step.

blockers.py -> build (fetch_form.py) -> precheck.py -> one combined review -> finalize_review.py -> update_status Packaged -> submit_gate.py -> browser submit -> update_status Applied

1. **Blockers** (read-only): `python3 tools/blockers.py <job_id>` (or `python3 tools/blockers.py <jd file> --location L --pay P --url U`). Exit 1 = BLOCKER: stop and tell the user, or record their choice to apply anyway. Checks configured requirements, clearance, travel, geography, compensation and step-6 dealbreakers. It warns on account-based ATSs (Workday, iCIMS, SuccessFactors, Taleo).
2. **Form**: `python3 tools/fetch_form.py <pkg>` (or `--url U`) uses the public Ashby or Greenhouse API and writes `<pkg>/form.json`: questions, required fields, and cover required yes/no. Lever and others: exit 3, read the form in the browser. `fetch_form.py <pkg> --cover` prints the cover decision.
3. **Build**:
   - `python3 tools/build_package.py <pkg> --init <base> --company C --title T --url U [--cover]`. Use `--cover` only if the form requires one; the default is `cover: null`.
   - Fill package.yaml, then `python3 tools/build_package.py <pkg> --check`.
   - `python3 tools/build_package.py <pkg> --write --run-id $APPLY_RUN_ID`.
   - Brief: `rework/builder-brief.md`.
4. **Precheck**: `python3 tools/precheck.py <pkg>` (`--json`, `--strict`), writes precheck.json. Code checks anything with one right answer.
   - [Candidate-specific illustration omitted; use the current approved claims and policy.]
   - **Not linked**: `LINK ... Fix: python3 $UPD --id N --status '<current>' --package <pkg>`. Lookup order: package_path, package.yaml job_id, every package URL (incl. the LinkedIn URL), jd-analysis URL lines.
   - **WARN** (style; each has an id `W-xxxxxx`): word counts, SUMMARY shape (configured count; no forced lead-label rule), acronym runs, repeats, keyword coverage, 6-7 word JD copy, configured terminology warnings, cover greeting/length, default-plan gap overclaims, unmatched form questions, optional placeholders.
5. **One combined review**: a separate run, never the builder run. Brief: `rework/reviewer-brief.md` (a checklist: truthfulness, fit, readability, hidden age signals, written answers, WARNs); also reads `rework/known-mistakes.md`; standard: `rework/apply-rubric.md`.
   - Inputs: `python3 tools/review_queue.py --inputs <pkg>`. Hashes: `python3 tools/review_queue.py --hashes <pkg>`.
   - **Question #1 (source workflow rule), the main pass/fail driver: "Does this resume highlight all the reasons the user is the best candidate for this job?"** The reviewer lists the JD's top 3-5 asks, the user's strongest confirmed proof for each (claims.yaml ids), and whether it is on the resume high and plainly (yes / buried / understated / missing), with a suggested line from confirmed claims or a question for the user. Missing or buried fails hiring_manager. Recorded as `best_candidate`; finalize requires it.
   - **Question #2 (source workflow rule): likely rejection reasons** (`rejection_reasons`, 1-5). Each ends `fixed` (approved claim ids + suggested line), `cant_fix` (question_for_user or screen_out_note: holds the package for the user) or `not_a_risk` (reason).
   - It writes `<pkg>/reviews/combined.json` (combined-review-v1): verdicts for hiring_manager, recruiter, ats and age_signal_claims, plus `precheck_warns` (accept with a one-line reason or fix) for every WARN id.
   - The old 4 lens files (`reviews/<lens>.json`) are still accepted when there is no combined.json.
6. **Finalize**: `python3 tools/finalize_review.py <pkg> [--user-ok "<where the user approved>"]`.
   - It merges the review into review.json, recomputes ATS hits, runs the claims, JD-copy, format and precheck (FAIL lines) gates, refuses if a precheck WARN is unanswered, stamps the README, records package_runs, and snapshots `reviews/round<N>/`.
   - Rounds within the configured limit: normal. The next round: automatic only if `tools/wording_check.py <pkg>` says wording-only (no new numbers, terms, bullets, claims, cover or settings); otherwise the user. Every later round: the user.
   - Queue view: `python3 tools/review_queue.py --date <YYYY-MM-DD>`.
   - 2026-11-05: refuses without rejection_reasons or best_candidate. A `fixed` line not yet on the resume records REVISE with `builder_round`; run `python3 tools/builder_feedback.py <pkg>` (writes reviews/builder-round.json: fixed lines + best_candidate suggested lines), put the lines in package.yaml from the cited claims only, rebuild, precheck, re-review (the next round auto only if wording_check says wording-only). `cant_fix` items are `holds_for_user`: review_queue shows HOLD, `--verify`/submit_gate block until `finalize_review.py <pkg> --hold-ok "<the user ref>"`.
7. **Packaged**: `python3 $UPD --url <job url> --status Packaged --package <pkg> --by <agent>` (or `--id <job_id>`).
8. **Gate**: `python3 tools/submit_gate.py <pkg>` (or `--job-id <id>`; `--verified-live "<who checked, when>"` if the posting can't be verified). It runs finalize `--verify`, build `--check`, the posting-live check, the cover rule, and requires DB status Packaged. It prints `upload: ...`, which is exactly the files to upload. Exit 1 = BLOCK.
9. **Browser submit**, only after the user's go: upload only what step 8 printed (resume.pdf; cover.pdf only when required). Password: vault or box handoff only. Years band: use the user’s approved answer; never infer it. Never guess a screening answer; ask the user. Never submit through an ATS API.
10. **Applied**: `python3 $UPD --url <job url> --status Applied --by <agent> --note "<confirmation>"`.

Checks: `python3 -m pytest -q tools/tests` (2026-11-04 baseline: 25 pre-existing failures, all on old fixtures vs newer claims rules) and `bash tools/run_all_checks.sh`.
Historical archive/change-log data is omitted from this distribution. reconcile_reviews.py and stamp_review.py stay because live code imports them.
