# Application rule contracts

Run from `<apps-workspace>`:

    python3 -m pytest -q tools/tests

The suite is organized by protected rule, not the date a rule was added:

- `test_blockers.py`: deal-breakers; configured inclusive salary floor; former fixture values removed.
- `test_precheck.py`: approved claims, gap handling, immutable facts, forms,
  tracker linkage, style WARN versus factual FAIL, inert JD injection fixtures.
- `test_review.py`: combined-review evidence, WARN responses, verdict recording,
  builder feedback, holds and approval rounds; supported legacy entrypoints.
- `test_submit_gate.py`: posting status, packaged status, immutable final review,
  cover uploads, and an offline end-to-end precheck → review → hold → explicit
  hold acknowledgment → submit-gate test.
- `test_resume_format.py`: layout/summary, nonwriting build refusals, deterministic
  and parallel builds, temporary-DB migration/outcome attribution, portable config.
- `test_calibration.py`: axis classification stays in the default suite. Frozen-baseline
  and reviewer-catch tests are marked `extended` and need the eval corpus from
  `setup/prepare_synthetic_tests.py` without `--fixtures-only`.

`package_fixtures.py` owns common temporary-package setup; `_cases.py` contains
specialized scenario setup. They never modernize live packages. All DB writes
are to temporary databases. Posting checks use supplied fakes, not the network.

A contract can contain several related assertions/scenarios. Invalid claim,
posting-status and pay-boundary data retain parametrized diagnostic cases.
Thus test-function counts and pytest's collected-case counts differ. We retained
extra legacy entrypoint checks rather than drop previously covered branches.
Historical `_archive/` tests and the consolidation map are not in this public tree.
`conftest.py` still ignores `_archive` so a private copy can keep old evidence out
of collection. Active tests do not import an archive.

## Coverage regression guard

`compare_coverage.py` still rejects any lost covered line or branch, irrespective
of aggregate percentages. This public tree has no `coverage.ini`, `before.json`,
or historical coverage report. Do not treat that absence as a pass, and do not
add a private archive or a private baseline to make the guard look green. Run a
new measurement only in a disposable copy, on unchanged production sources, with
before and after databases kept separate.
