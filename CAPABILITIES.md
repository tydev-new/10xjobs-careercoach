# Retained source and explicit omissions

## Retained implementations, not replacements
- Nine skills: sourcing, evaluate, apply, evidence summary, coach, outreach,
  hiring-manager idea email, storybank and interview. Original generic steps and
  section structure are preserved; personal references/config values are scrubbed.
- pipeline/sweep.py: original Ashby, Greenhouse, Lever, SmartRecruiters, LinkedIn
  guest, public-sector, Getro, a16z, HN and Workday integration; source validation,
  health, retries, watermark/window, deduplication and record ingestion.
- workday_sweep.py: original query/detail/facet/paging/retry/location/pay algorithms;
  user-selected terms, lanes, country/geography, clearance and pay rules now config.
- Original schema.py, jobsdb.py, fitcheck.py, score/find/upsert/update_status/render/
  export/weekly_report, migration, backfill and rescore algorithms. No database data.
- Original routing.py, theme_scan.py, six libraries and all nineteen application
  tool modules: native PDF formatting, package.yaml edits, claims, form extraction,
  blockers, precheck, ATS/gaps, wording-only checks, review queue, finalize, stamping,
  reconcile, builder feedback and submit_gate. Browser-only explicit-go policy remains.
- Original sourcing eval runner, fit checker and explicitly synthetic starter cases;
  private-set builder algorithm, application eval runner and calibration comparator.
- Original attributed cold-outreach playbook: generic approach, format, contact
  verification and draft/send guardrails retained; candidate examples are placeholders
  and personal cadence/word preferences are unconfigured.
- Original current test source with newly invented package/HTTP/claim fixtures.
  The full application and sourcing suites pass on these synthetic contracts;
  historical coverage breadth and live integrations are not claimed.

## Privacy-only compatibility edits
The former candidate's name in identifiers/flags/JSON keys is replaced with `user`:
for example `--user-ok`, `question_for_user`, `user_applies_anyway` and
`flagged_to_user`. Update callers consistently. Home-location enum labels are now
`home-area`, `remote-region`, `excluded-area` rather than a former user’s region.
These are explicit privacy migrations, not silently removed approval checks.
A small runtime_config.py adapter resolves paths and candidate/policy configuration;
there is no alternate sourcing or application pipeline.

## Omitted paths / coverage gaps (no private instance names)
- All original profile datasets, base resume contents, publications, stories,
  contacts, plans, criteria, target/exclusion lists, tracker exports, JD analyses,
  applications/outcomes/interviews, PDFs/DOCs, caches/logs, backups and git history:
  omitted. New synthetic templates and empty state replace data, not algorithms.
- `workspace/job-search/pipeline/tests/fixtures/*`: original recorded job-board data
  omitted. 10 newly invented HTTP payloads now exercise the retained adapter
  replay tests; these are not recordings or a live API certification.
- `workspace/job-apps/daily-*/**`, `evals/cases/**`, `evals/calibration/cases/**`,
  calibration labels/keys, historical outputs and baselines: omitted. Corresponding
  test fixture providers now use freshly generated invented packages/reviews.
  setup/prepare_synthetic_tests.py regenerates them privately through original
  tools, including a tiny invented apply/calibration corpus. Historical labels,
  actual reviewer quality and corpus breadth are not reconstructed.
- `workspace/job-apps/base-resumes/build_bases.py`: deprecated --legacy builder,
  mostly embedded personal bullet datasets; current build_package.py/render path is
  retained. `write_notes.py`: personal base-specific notes generator, omitted.
- `workspace/job-apps/evals/build_cases.py`, `evals/calibration/build_set.py` and
  `plant_writing.py`: personal package selectors/planted career statements, omitted.
  Current eval grading/model backends and calibration comparison remain. Supply new
  synthetic scenario builders rather than porting personal fixtures by renaming.
- Archived historical test versions and migration reports: omitted; current tests
  and migration algorithms remain. `routines/*`: personal schedule/permission briefs
  omitted; skills retain their workflow but no routine is installed or authorized.

Cloud implementation should refactor these actual originals, complete configuration
onboarding, configure the aggregate sourcing suite/quality baseline, validate stable
APIs on broader synthetic cases and preserve
existing license notices. Do not retrieve personal data to make a test pass.
