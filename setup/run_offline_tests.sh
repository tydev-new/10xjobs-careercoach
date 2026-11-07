#!/usr/bin/env bash
# Offline public-tree checks plus the disposable application and sourcing suites.
# Does not submit, send, save a sourcing baseline, or make tools/run_all_checks.sh pass.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 setup/privacy_scan.py --self-test
python3 setup/privacy_scan.py --public
python3 setup/onboarding_status.py
python3 setup/check_public_gates.py
python3 setup/check_bootstrap_boundary.py
cd "$ROOT/workspace/job-apps"
python3 tools/format_check.py base-resumes/tpm base-resumes/eng-manager base-resumes/solutions-fde-delivery base-resumes/ic-builder
cd "$ROOT"
DEST="$(mktemp -d)"
cleanup() { rm -rf "$DEST"; }
trap cleanup EXIT
python3 setup/prepare_synthetic_tests.py "$DEST/kit"
export JOBBI_ROOT="$DEST/kit"
export JOBSEARCH_WORKSPACE="$JOBBI_ROOT/workspace/job-search"
export PYTHONDONTWRITEBYTECODE=1
cd "$JOBBI_ROOT/workspace/job-apps"
python3 -m pytest -q -p no:cacheprovider tools/tests
python3 evals/run.py --check
python3 evals/run.py --set calibration --check
cd "$JOBSEARCH_WORKSPACE/pipeline"
python3 -m pytest -q -p no:cacheprovider tests
echo "OFFLINE TESTS: PASS"
echo "tools/run_all_checks.sh on the public tree stays FAIL until a private sourcing suite and an accepted examples baseline exist. See TESTING.md."
