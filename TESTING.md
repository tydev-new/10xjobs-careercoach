# Validation and explicit coverage limits

## Executed on the sanitized originals, with network connections denied
- **109 application tests passed, zero skipped**: all 105 original current tests,
  with purely invented/configured fixtures, plus four scrub regressions.
- **44 sourcing/ledger tests passed, zero skipped**, including all ten source-adapter
  replay fixtures. Each HTTP fixture is newly invented, not a captured vacancy.
- All 88 failures reproduced in the initial complete application run are accounted
  for and now PASS. Missing fixtures, placeholder assertions and unconfigured
  policies were not confused with production regressions.
- Real production scrub regressions repaired: character iteration in plan_terms /
  default_plan / normal precheck-with-gap, and a null cover-init date. Direct API,
  complete rendered-package gap and cover-init date regressions are included.
- Original init, scoring, native Markdown/PDF build, claims and precheck, combined
  review, four-lens compatibility, reconcile/stamp, finalize snapshots/freshness,
  holds, builder independence, round escalation and readiness gates are exercised.
  A MOCK live posting can pass readiness; a stale edit is blocked. Nothing submits.
- Four base format checks PASS. Apply frozen/file eval contracts and two-axis
  calibration checks PASS on a tiny invented corpus (one good card exercise and
  one deliberately false card metric), not an actual model-quality calibration.
- Pristine allowlist bootstrap succeeds with every original data/state table empty.
  Extra .env/contact files, changed templates and symlinks are refused before copy.
- All outgoing Python parses; YAML/JSON/JSONL and schemas validate. Original source
  definitions and all nine skills' sections/steps are accounted for privately.
  Structural counts do not prove semantic equivalence or anonymization.

## Reproduce offline tests, in a NEW disposable private root
Install setup/requirements.txt and pytest in a separate private environment, with
Poppler available. Keep the pristine distribution free of environments/caches.
Enforce outbound-network denial in your test harness. From the pristine kit:

```sh
python3 setup/prepare_synthetic_tests.py /absolute/path/to/new-disposable-kit
export JOBBI_ROOT=/absolute/path/to/new-disposable-kit
export JOBSEARCH_WORKSPACE="$JOBBI_ROOT/workspace/job-search"
export PYTHONDONTWRITEBYTECODE=1
cd "$JOBBI_ROOT/workspace/job-apps"
python3 -m pytest -q -p no:cacheprovider tools/tests
cd "$JOBSEARCH_WORKSPACE/pipeline"
python3 -m pytest -q -p no:cacheprovider tests
```

From the public kit root, `bash setup/run_offline_tests.sh` runs that disposable
flow after a heuristic privacy scan, an empty-schema bootstrap, a contaminated-copy
refusal, and the public-tree format check. It does not save a sourcing baseline.
`tools/run_all_checks.sh` on the public tree is still expected to fail; the script
checks that failure mode and leaves the gate in place.

The fixture generator calls the retained real builders/scorer/review tools. It
configures invented test-only limits, terms, claims and answers in the NEW copy,
then generates private runtime-only PDFs, databases, reviews and baselines. They
are contract fixtures, NOT independent candidacy reviews, user consent, recommended
personal defaults, or permission to apply. Do not publish any generated root.
The general test helper bypasses unrelated DB-link checks for temporary packages;
dedicated link tests exercise the real DB linkage contract separately.

## Aggregate command is NOT certified green
The unchanged tools/run_all_checks.sh returns FAIL: it still requests the excluded
personal/private sourcing case set by default. The source example check also lacks
an accepted baseline. Its component run recorded 109 + 44 passing tests, four base
PASSes and both apply/calibration CHECK: PASS results. Do not silently remove that
gate or save a low-quality source baseline to make the aggregate green.

The retained source runner on 15 explicitly synthetic starter cases, rules backend:
valid_rate 1.0; agreement 0.733; dealbreaker_recall 1.0; injection_stable true;
four disagreements and two missed applies remain. Explicit examples --check fails
without an approved baseline. This is a disclosed quality/coverage limitation,
not a successful regression-quality or model-quality claim. Maintainers must choose
new case-set configuration and an independently accepted quality baseline.

## Not asserted
Historical personal package/HTTP/calibration corpora remain excluded. Newly invented
fixtures restore original contract coverage, not the former corpus' breadth or
real-world reviewer quality. The two invented eval cases are intentionally small.
No live ATS/model/mailbox/browser-submit integration, fresh-host dependency install,
or real onboarding was tested. Installed Python dependencies were used; this is
not certification of a newly resolved environment. Missing-vs-disabled config is
not machine-validated; see CONFIGURATION.md. Submission remains explicit-user-go,
browser-only, using only current approved answers and gate-selected files.
