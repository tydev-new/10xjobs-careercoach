#!/usr/bin/env python3
"""Nightly snapshot: <home>/snapshots/jobs-YYYY-MM-DD.csv (all columns of jobs)."""
import csv, os, sys
from pipeline import jobsdb as J
from pipeline import home as H
with J.locked():
    c, rec = J.open_for_write()
    J.write_views(c)
    out = os.path.join(str(H.path("snapshots_dir")), f"jobs-{J.today()}.csv")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cur = c.execute("SELECT * FROM jobs ORDER BY date DESC, sort_order")
    with open(out, "w", newline="") as f:
        w = csv.writer(f); w.writerow([d[0] for d in cur.description]); w.writerows(cur.fetchall())
    print(out)
