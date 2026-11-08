# Validation and explicit coverage limits

## Default command

From a machine with Python 3.10+, Poppler (`pdfinfo`, `pdftotext`), and `setup/requirements.txt` installed:

```sh
bash setup/run_offline_tests.sh
```

That command is what CI runs. It does four things:

1. Heuristic privacy scan of this tree, plus the scanner's own negative fixture.
2. Bootstrap boundary: a copy with an extra `.env` is refused, and a clean destination initializes the original schema with zero data rows.
3. A disposable kit with the seven synthetic packages the deterministic tests copy. No eval corpus and no baseline are written (`--fixtures-only`).
4. Essential pytest: application tests marked `not extended`, then the sourcing/ledger tests.

It does not submit, send, or save a sourcing baseline. Generated PDFs and databases stay in the temp directory.

## Optional extended command

```sh
bash setup/run_extended_checks.sh
```

This is not CI. It prints onboarding status, runs the public sourcing `examples` rules backend, and asserts that `examples --check` still has no accepted baseline and that the private suite has no cases. It then builds the tiny invented apply/calibration corpus and runs the two `extended` pytest marks. It does not run `--save-baseline` on the public examples, and it does not treat agreement as certified quality.

`workspace/job-apps/tools/run_all_checks.sh` is the older aggregate. On this public tree it is expected to FAIL because it still asks for the private sourcing suite and an examples baseline. Do not delete that failure and do not commit a baseline to make it green. Run it only in a disposable kit prepared without `--fixtures-only`.

## Counts and durations

Measured on this environment (Python 3.12.3, Poppler 24.02.0, the pinned requirements, outbound network unused by the tests) before and after the simplification. Pytest times are the suite totals pytest prints. The command time is wall clock for the whole script.

| | Before | After (default command) |
|---|---|---|
| Application cases collected | 109 | 102 run, 2 `extended` deselected (104 still in the file) |
| Sourcing cases collected | 44 | 44 |
| Application pytest | 53.97s | 51.99s |
| Sourcing pytest | 1.73s | 1.70s |
| Whole public command | not re-timed as one process; prepare of the old 14-package corpus alone was 40.9s, then both suites | 73.0s, including privacy, bootstrap, and the smaller fixture build |
| Extended command | was inside the old command (second eval `--check`, public-gate report, calibration `--check`) | 22.95s; rules agreement still 0.733 |

Parameterization was not treated as fewer independent cases. The five application cases removed were exact duplicates or the same side of one boundary. The two `extended` tests were moved out of the default command, not deleted.

## Check map

Surviving essential coverage, and what was dropped because the same failure was already asserted.

| Invariant | Surviving check | Removed as repetitive |
|---|---|---|
| Privacy scan catches a non-example address and a private path; public tree stays synthetic and empty | `setup/privacy_scan.py --self-test` and `--public` | none |
| Contaminated tree refused; empty original schema | `setup/check_bootstrap_boundary.py` | a second empty bootstrap is still inside fixture prepare, because that copy is the test root |
| Claims text: pass, wrong number, forbidden pair, banned term, year, scope | `test_stamp_check_claims_text` (11 rows) | 2 identical banned-term rows |
| Bundled bases pass claims and format | one check plus byte-identity of the four identical synthetic resumes | 3 extra claims invocations and 3 extra format invocations; the separate `format_check` CLI call in the old default command |
| Build refuses an unknown claim and a banned paraphrase, and does not write the resume | `test_build_gate_refuses_unknown_claim_and_banned_paraphrase` | none |
| Build refuses an unaccepted content diff | `test_build_content_diff_needs_accept` | none |
| Required form placeholder and unapproved sponsorship fail; optional placeholder warns | `test_precheck_form_placeholder_required_fail_optional_warn` | none |
| JD text cannot authorize a claim or move ATS coverage | `test_jd_instructions_cannot_authorize_claims` | two extra "unapproved number fails" text checks already in the claims rows |
| Gap overclaim, blocker flag, cover plan, missing gap, adjacent claim | the stamp/gap tests in `test_precheck.py` | none |
| Configured banned term and age term fail precheck | `test_combined_precheck_catches_banned_terms` (`ExampleLang`, `decades`) | `test_precheck_configured_term_is_fail` (`all imaginary colors` is the same banned regex as `ExampleLang`) |
| Fixed title and dates fail | `test_precheck_fixed_title_and_dates_fail` | none |
| Selected-work lead and tracker link | those two precheck tests | none |
| Readability and repeats warn, they do not fail facts | `test_readability_warnings_do_not_become_fact_failures` | the extra long-sentence `READ` probe in the summary test; normal-summary and policy-bullet assertions stay |
| Role header rejects a non-comma separator; education line does too | pipe separator on the role header, middle dot on the education line, and build refusal that leaves the file unchanged | a second role-header glyph (em dash). It is the same `BAD_SEP` role-header path as the pipe |
| Section order, old dates, cover opt-in | those format/build tests | a third clean package (`scenario-7`) that repeated the nocover format pass |
| Posting closed/live/unknown per adapter, including 429 and an unverified host | `test_build_posting_status` (8 rows) | none |
| Closed posting blocks and is recorded; unknown posting blocks unless the user records a live check; skipped and legacy review block | the submit-gate tests | none |
| Cover upload list, and a required cover file missing blocks | `test_combined_submit_gate_cover_rules` | none |
| Hold blocks submit until an explicit acknowledgement | `test_package_end_to_end_precheck_review_hold_ack_and_submit_gate` and `test_cant_fix_holds_until_explicit_ack` | none |
| Builder run is not the reviewer; distinct runs; stale file and hash changes refuse reconcile and finalize | reconcile tests plus `test_format_finalize_refuses_unusable_lens_set` | none. The two tools are different contracts |
| Round escalation needs the user when the edit is not wording-only | `test_round_three_and_later_approval_contract` | none |
| Pay floor is inclusive at the configured 110000; unknown pay is not a blocker | below, exact floor, and one range above; `test_unknown_pay_does_not_invent_a_blocker` | `$110,001` and `$130,000`, same "top of range above the floor" result as `$110,000-$150,000` |
| Source parsers, schema, dedupe, failed fetch, retries, health flags | one test per adapter fixture, plus schema/dedupe/health/retry tests | none. Shared `check_posts` is a helper, not a collapsed adapter |
| Geo unknown, blank, country-only, and out-of-area | `test_remote.py` and `test_eval_locations.py` | none. Fit-check and the rules scorer are different layers |
| DB lock, sequential connect, concurrent writers, score.py then another writer | `test_db_locking.py` | none |
| Scrub crashes: character iteration, gap plan, rendered package, cover date | `test_scrub_regressions.py` | none |
| Rules agreement 0.733, 4 disagreements, 2 missed applies, no examples baseline, no private cases | `setup/run_extended_checks.sh` only | removed from the default command. Not a deleted failure. No baseline was saved |
| Frozen apply/calibration corpus and reviewer catch rate | the two `extended` tests, after prepare without `--fixtures-only` | removed from the default command only |

Style warnings (word count, repeats, middle-dot) stay warnings in the essential tests. They are not promoted to failures, and they are not a separate required suite. `strict_dots` is still asserted so a middle dot does not fail unless that flag is set.

## Not asserted

The rules-backend agreement of 0.733 is a quality gap, not a passing bar. `examples --check` fails closed without an accepted baseline. The private sourcing case set is absent. Historical package and calibration breadth is not restored. The two invented eval cases are a contract exercise, not model-quality calibration.

No live ATS, model, mailbox, or browser-submit run is claimed. Missing-versus-disabled configuration is not fully machine-validated; `setup/onboarding_status.py` only lists empty starter keys and is not part of the default command. Submission remains an explicit user go, in the browser, using current approved answers and the files the readiness gate names. A privacy-scan pass is not proof of anonymization. Git history before this branch was not scrubbed.
