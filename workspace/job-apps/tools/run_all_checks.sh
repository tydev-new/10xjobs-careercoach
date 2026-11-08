#!/usr/bin/env bash
# Historical aggregate. Not the default public command (setup/run_offline_tests.sh).
# On this public tree the sourcing examples --check has no accepted baseline and the
# private suite is absent, so this script is expected to FAIL. Do not save a baseline
# to turn it green. Run it only in a kit prepared without --fixtures-only.
set -u; rc=0
export JOBBI_ROOT="${JOBBI_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$JOBBI_ROOT/workspace/job-apps" && { python3 -m pytest -q tools/tests 2>&1 | tail -1; [ ${PIPESTATUS[0]} -eq 0 ] || rc=1; }
cd "$JOBBI_ROOT/workspace/job-search/pipeline" && { python3 -m pytest -q tests 2>&1 | tail -1; [ ${PIPESTATUS[0]} -eq 0 ] || rc=1; }
cd "$JOBBI_ROOT/workspace/job-apps" && { python3 tools/format_check.py base-resumes/tpm base-resumes/eng-manager base-resumes/solutions-fde-delivery base-resumes/ic-builder | grep -c "^PASS" | sed "s/^/format_check bases PASS: /"; [ ${PIPESTATUS[0]} -eq 0 ] || rc=1; }
cd "$JOBBI_ROOT/workspace/job-apps" && { python3 evals/run.py --check | tail -1; [ ${PIPESTATUS[0]} -eq 0 ] || rc=1; }
cd "$JOBBI_ROOT/workspace/job-apps" && { python3 evals/run.py --set calibration --check | tail -1; [ ${PIPESTATUS[0]} -eq 0 ] || rc=1; }
cd "$JOBBI_ROOT/workspace/job-search/pipeline" && { python3 evals/run.py --backend rules --check 2>&1 | tail -1; [ ${PIPESTATUS[0]} -eq 0 ] || rc=1; }
echo "ALL CHECKS: $([ $rc -eq 0 ] && echo PASS || echo FAIL)"; exit $rc
