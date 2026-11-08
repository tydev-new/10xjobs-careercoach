#!/usr/bin/env python3
"""Nightly snapshot: <workspace>/snapshots/jobs-YYYY-MM-DD.csv (all columns of jobs)."""

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

import csv, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jobsdb as J
with J.locked():
    c, rec = J.open_for_write()
    J.write_views(c)
    out = os.path.join(J.WS, "snapshots", f"jobs-{J.today()}.csv")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cur = c.execute("SELECT * FROM jobs ORDER BY date DESC, sort_order")
    with open(out, "w", newline="") as f:
        w = csv.writer(f); w.writerow([d[0] for d in cur.description]); w.writerows(cur.fetchall())
    print(out)
