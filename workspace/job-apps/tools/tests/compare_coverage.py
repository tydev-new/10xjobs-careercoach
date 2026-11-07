"""Reject any lost covered line or branch, not merely a lower percentage.

Usage: python3 tools/tests/compare_coverage.py BEFORE.json AFTER.json
Both JSON files must be emitted by coverage.py from the same source tree/cwd.
"""

# Portable path/config adapter; pipeline implementation below is retained.
from pathlib import Path as _JobbiPath
import os as _jobbi_os, sys as _jobbi_sys
_JOBBI_ROOT = _JobbiPath(_jobbi_os.environ.get("JOBBI_ROOT", str(_JobbiPath(__file__).resolve().parents[4])))
_jobbi_sys.path.insert(0, str(_JOBBI_ROOT))
from runtime_config import policy as _jobbi_policy, candidate as _jobbi_candidate
_JOBBI_SEARCH = _JOBBI_ROOT / "workspace" / "job-search"
_JOBBI_APPS = _JOBBI_ROOT / "workspace" / "job-apps"
_JOBBI_POLICY = _jobbi_policy(_JOBBI_ROOT)
_JOBBI_CAND = _jobbi_candidate(_JOBBI_ROOT)

import json
import sys
from pathlib import Path


def compare(before, after):
    missing = {}
    for path, old in before['files'].items():
        new = after['files'].get(path, {})
        lines = sorted(set(old['executed_lines']) - set(new.get('executed_lines', [])))
        branches = sorted(set(map(tuple, old.get('executed_branches', []))) -
                          set(map(tuple, new.get('executed_branches', []))))
        if lines or branches:
            missing[path] = {'lines': lines, 'branches': branches}
    return missing


if __name__ == '__main__':
    old, new = (json.loads(Path(p).read_text()) for p in sys.argv[1:])
    lost = compare(old, new)
    print(json.dumps({'pass': not lost, 'lost_coverage': lost}, indent=2))
    raise SystemExit(bool(lost))
