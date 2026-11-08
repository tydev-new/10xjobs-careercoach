#!/usr/bin/env bash
# Optional eval and quality-gap report. Not the default CI command.
# Prints the rules-backend agreement and asserts examples --check still has no
# accepted baseline. It does not save a baseline and does not certify quality.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONDONTWRITEBYTECODE=1
python3 setup/onboarding_status.py
python3 setup/check_public_gates.py
DEST="$(mktemp -d)"
cleanup() { rm -rf "$DEST"; }
trap cleanup EXIT
python3 setup/prepare_synthetic_tests.py "$DEST/kit"
export JOBBI_ROOT="$DEST/kit"
export JOBSEARCH_WORKSPACE="$JOBBI_ROOT/workspace/job-search"
cd "$JOBBI_ROOT/workspace/job-apps"
python3 -m pytest -q -p no:cacheprovider -m extended tools/tests
echo "EXTENDED CHECKS: PASS"
echo "The rules agreement printed above is not an accepted quality baseline."
