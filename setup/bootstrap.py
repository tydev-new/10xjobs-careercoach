#!/usr/bin/env python3
"""Copy only a pristine allowlisted distribution to a NEW private root, then initialize the original empty schema.
This verifies known distribution bytes; it is NOT a private-data scrubber or an onboarding approval.
"""
from pathlib import Path
import argparse,hashlib,json,os,shutil,subprocess,sys,yaml
p=argparse.ArgumentParser(description=__doc__);p.add_argument("root",type=Path);a=p.parse_args()
source=Path(__file__).resolve().parents[1];target=a.root.absolute()
if target.exists() or target.is_symlink():raise SystemExit("destination must be NEW")
if target.is_relative_to(source):raise SystemExit("destination must be outside source tree")
manifest=json.loads((source/"DISTRIBUTION.json").read_text());entries=manifest["files"]
expected=set(entries)|{"DISTRIBUTION.json"};actual=set()
for p in source.rglob("*"):
 rel=p.relative_to(source)
 if rel.parts[0]==".git":continue
 if p.is_symlink():raise SystemExit("source symlinks refused")
 if p.is_file():actual.add(rel.as_posix())
if actual!=expected:raise SystemExit("not a pristine distribution: missing or unexpected files; do not use bootstrap as a scrubber")
for rel,hash in entries.items():
 q=Path(rel)
 if q.is_absolute() or ".." in q.parts or hashlib.sha256((source/q).read_bytes()).hexdigest()!=hash:
  raise SystemExit("distribution bytes changed: use a new audited distribution, not an onboarded root")
for rel in ("candidate.yaml","claims.yaml"):
 if yaml.safe_load((source/"workspace/job-search/profile"/rel).read_text()).get("synthetic") is not True:raise SystemExit("only synthetic source templates may be bootstrapped")
target.mkdir(parents=True)
for rel in sorted(expected):
 out=target/rel;out.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/rel,out)
script="import sys; sys.path.insert(0,sys.argv[1]); import jobsdb; c=jobsdb.connect(); tables=c.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name!='meta'\").fetchall(); assert all(c.execute('SELECT count(*) FROM '+r[0]).fetchone()[0]==0 for r in tables); c.close(); print('OK original schema: zero data/state rows')"
env={**os.environ,"JOBBI_ROOT":str(target),"JOBSEARCH_WORKSPACE":str(target/"workspace/job-search"),"PYTHONDONTWRITEBYTECODE":"1"}
subprocess.run([sys.executable,"-c",script,str(target/"workspace/job-search/pipeline")],env=env,check=True)
print("Synthetic profile only. Complete private onboarding; no permission to submit/send is imported.")
