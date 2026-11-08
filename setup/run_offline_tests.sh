#!/usr/bin/env bash
# Essential deterministic checks for a public checkout.
# Does not submit, send, save a sourcing baseline, or treat eval agreement as certified.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONDONTWRITEBYTECODE=1
python3 setup/privacy_scan.py --self-test
python3 setup/privacy_scan.py --public
python3 setup/check_bootstrap_boundary.py
DEST="$(mktemp -d)"
cleanup() { rm -rf "$DEST"; }
trap cleanup EXIT
python3 setup/prepare_synthetic_tests.py --fixtures-only "$DEST/kit"
export JOBBI_ROOT="$DEST/kit"
export JOBSEARCH_WORKSPACE="$JOBBI_ROOT/workspace/job-search"
cd "$JOBBI_ROOT/workspace/job-apps"
python3 -m pytest -q -p no:cacheprovider -m 'not extended' tools/tests
cd "$JOBSEARCH_WORKSPACE/pipeline"
python3 -m pytest -q -p no:cacheprovider tests
echo "OFFLINE TESTS: PASS"
echo "Sourcing rules agreement and the missing examples baseline are not part of this command. See TESTING.md and setup/run_extended_checks.sh."
