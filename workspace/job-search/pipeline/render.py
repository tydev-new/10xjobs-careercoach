#!/usr/bin/env python3
"""Import any hand edits to jobs.md (reconcile), then regenerate jobs.md + active.md from jobs.db."""

# Portable path/config adapter; pipeline implementation below is retained.
from pathlib import Path as _JobbiPath
import os as _jobbi_os, sys as _jobbi_sys
_JOBBI_ROOT = _JobbiPath(_jobbi_os.environ.get("JOBBI_ROOT", str(_JobbiPath(__file__).resolve().parents[3])))
_jobbi_sys.path.insert(0, str(_JOBBI_ROOT))
from runtime_config import policy as _jobbi_policy, candidate as _jobbi_candidate
_JOBBI_SEARCH = _JOBBI_ROOT / "workspace" / "job-search"
_JOBBI_APPS = _JOBBI_ROOT / "workspace" / "job-apps"
_JOBBI_POLICY = _jobbi_policy(_JOBBI_ROOT)
_JOBBI_CAND = _jobbi_candidate(_JOBBI_ROOT)

import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jobsdb as J
with J.locked():
    c, rec = J.open_for_write()
    J.write_views(c)
    print("reconcile:", json.dumps(rec))
    print("rendered", J.JOBS_MD, "and", J.ACTIVE_MD)
