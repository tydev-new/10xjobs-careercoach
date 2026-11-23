---
name: Job search apply
description: >-
  Use when preparing an application package for a role the user picked: daily
  apply prep, or the user asking to tailor a resume, cover, or answers.
  Submitting is a later step, after the user names the roles.
---
# Job search apply

`python3 <apps-workspace>/lib/agent_config.py` prints every path and preference (`profile/agent-config.yaml`). Identity is in `candidate.yaml`. Facts are in `claims.yaml`. Lanes and dealbreakers are in `criteria.md`. `<apps>` is `paths.apps_workspace` (run tools from there). `<pipeline>` is `paths.pipeline`. The command list that wins is `<apps>/rework/PIPELINE.md`. Read it if anything below looks out of date.

Scripts check anything with one right answer, and they FAIL only on hard facts. Style is WARN only. The reviewer judges meaning and context from a short question list, and must accept or fix every WARN with a reason.

## Prep
1. **Load and screen.** `python3 <pipeline>/find.py --id <id> --json` (daily: `--status "To Review" --fit Strong,Solid --since <last run>`). One role per company. Then `python3 tools/blockers.py <id>`. Exit 1 is a BLOCKER (hard gap, pay under the floor, place, onsite setup, or travel outside the approved criteria, or clearance). Stop and tell the user before you build. WARNs (account-based systems such as Workday or iCIMS, preferred-only gaps) go in the digest.
2. **Form.** `python3 tools/fetch_form.py <pkg>` (or `--url U`) writes `form.json` from the public Ashby or Greenhouse API: questions, required flags, cover required yes or no. Other systems exit 3: read the form at submit time. Draft free-text answers from claims and flag new ones for the user's OK.
3. **Build.** Pick the base with `base-resumes/routing.py` `base_for(title)`, and check it against the job text. Use the folder `daily-YYYY-MM-DD/<lane>-<slug>/` with `jd.md` (link and capture date on top), a one-page sourced `company-research.md`, and `README.md`. Copy `rework/builder-brief.md`. Do not copy an older daily brief.
   - `python3 tools/build_package.py <pkg> --init <base> --company C --title T --url U` and add `--cover` **only** if form.json says a cover is required. Default is no cover.
   - Fill `package.yaml` edits (`ctx_before`, `old`, `new`, `claims: [ids]`; `wording_only: true` with a `basis` for a label or a skills-word change). Use only facts from `python3 lib/claims.py <scope>`. Do not paraphrase a claim into a stronger technology. For each gap use `adjacent_shown`, `omitted`, or `blocker_flagged`.
   - Write every form answer in README as `- **REQUIRED <label>:** <answer>`. An answer the user has not approved keeps `[USER]`. Remove that tag only after they approve it, and record where they did.
   - Link the package to its job: `python3 <pipeline>/update_status.py --id <id> --status "<current status>" --package <pkg>`.
   - Run `--check`, then `--write --run-id $APPLY_RUN_ID`. It will not overwrite a changed live package without `--accept-diff "<reason>"`.
4. **Precheck.** `python3 tools/precheck.py <pkg>`. FAILs (banned or age terms, fixed facts such as titles, dates, contact block, and selected-work order, form completeness and standing answers, the cover rule, files and format, copied job text, claims, the job link, and builder versus reviewer run) block the package. Fix them and rebuild. A LINK FAIL prints its `update_status.py` fix. Run that fix. Do not skip it. WARNs (word counts, keyword coverage, repeats, and fuzzy form matches) each have a `W-` id for the reviewer.
5. **One combined review.** A separate run from the builder. Brief: `rework/reviewer-brief.md` (does this resume show why they are the best candidate, and why a recruiter or hiring manager would screen them out; then truth, the first three summary lines, readability, hidden age signals, written answers), plus `rework/known-mistakes.md` and `rework/apply-rubric.md`. Inputs: `python3 tools/review_queue.py --inputs <pkg>` pinned to `--hashes <pkg>`. It writes `reviews/combined.json` with verdicts for hiring_manager, recruiter, ats, and age_signal_claims; a `precheck_warns` entry (accepted or fixed, with a reason) for every current WARN id; `best_candidate` (top 3 to 5 asks, strongest approved proof, and whether it is high and plain); and `rejection_reasons` (1 to 5 screen-out reasons, each ending `fixed`, `cant_fix`, or `not_a_risk`).
6. **Finalize.** `python3 tools/finalize_review.py <pkg>`. It refuses while any precheck FAIL is still firing, any WARN has no answer, or `best_candidate` or `rejection_reasons` is missing. Rounds inside the configured free limit are normal. The next round runs on its own only if `tools/wording_check.py <pkg>` says the edit is wording only. Otherwise, and for any later round, ask the user and pass `--user-ok "<where they approved>"`. Any edit to the package makes the review stale.
   - If finalize records REVISE with a builder round, run `python3 tools/builder_feedback.py <pkg>`. Add each listed line to package.yaml, citing only its approved claim ids. Rebuild, rerun precheck, and review again.
   - A `cant_fix` reason holds the package. Show the user the question or the screen-out note. Run finalize again with `--hold-ok "<where they approved>"` only after they say go. Do not invent a fact to turn `cant_fix` into `fixed`.
7. **Record.** `python3 <pipeline>/update_status.py --id <id> --status Packaged --package <pkg> --by <agent> --note "<base>; <verdict>"`, then `render.py` and `export_csv.py`. Do not hand-edit the jobs database. A package that misses a hard requirement is reported, not submitted.

## Submit (only after the user names the roles)
1. `python3 tools/submit_gate.py <pkg>` must print OK. It checks again that the posting is live, precheck has no FAIL, the review verifies with no open holds, files match the spec, the database status is Packaged, and the cover rule. It prints `upload: ...` and the exact files to upload. If the posting cannot be checked, look it up by hand and rerun with `--verified-live "<who, when, what>"`. Do not submit around a BLOCK.
2. Submit in the browser only, never through an ATS API. Upload only what the gate printed. Passwords: from a vault or the user, never typed from chat or guessed. Do not guess a screening answer. Use standing answers or ask. Do not change approved wording.
3. `update_status.py --id <id> --status Applied --by <agent> --note "<confirmation>"` only after confirmation on screen or by email.

## Learn
On the user's weekly cadence, `<pipeline>/weekly_report.py` ranks reply rates by base, lane, and cover format, and hides a rate with fewer than 5 replies. Propose changes for the user to approve. If they reject a phrase, or a review misses something, add it to `rework/known-mistakes.md`. Before changing this skill, the rubric, the reviewer brief, or gate code, run `python3 -m pytest -q tools/tests` and `bash tools/run_all_checks.sh`, and block a regression against the last baseline in `rework/CHANGES.md`.

## Guardrails
Write a new claim with intake (`python3 "$JOBBI_ROOT/setup/intake.py" set` when they said it, `confirm` after they accept an extract). Do not approve a claim by editing `claims.yaml`. Craft rules live in apply-rubric.md.
