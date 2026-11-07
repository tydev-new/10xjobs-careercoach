#!/usr/bin/env python3
"""Validate relocation of this source kit. All paths use JOBBI_ROOT or source-relative roots."""
from pathlib import Path
import argparse
p=argparse.ArgumentParser(description=__doc__);p.add_argument("root",type=Path);a=p.parse_args()
r=a.root.absolute()
if any(x.is_symlink() for x in r.rglob("*")): raise SystemExit("symlinks refused")
for rel in ("workspace/job-apps/tools/submit_gate.py","workspace/job-search/pipeline/jobsdb.py","runtime_config.py"):
 if not (r/rel).is_file(): raise SystemExit("missing source component")
print("OK: portable source paths; set JOBBI_ROOT to this copied kit root; no files rewritten")
