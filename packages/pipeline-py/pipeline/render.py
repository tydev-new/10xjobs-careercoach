#!/usr/bin/env python3
"""Import any hand edits to jobs.md (reconcile), then regenerate jobs.md + active.md from jobs.db."""
import json, os, sys
from pipeline import jobsdb as J
with J.locked():
    c, rec = J.open_for_write()
    J.write_views(c)
    print("reconcile:", json.dumps(rec))
    print("rendered", J.JOBS_MD, "and", J.ACTIVE_MD)
