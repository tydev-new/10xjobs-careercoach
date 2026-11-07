#!/usr/bin/env python3
"""Backfill derived signal columns on existing rows (idempotent):
source (explicit src tags win over URL inference), skip_reason + skipped_by for Skipped rows,
replied flag (interviews / recruiter replies / screens mentioned in notes)."""

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

import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jobsdb as J

REPLY_RX = re.compile(r"recruiter (?:reply|replied|reached|email)|replied|phone screen|screen (?:scheduled|booked|with)|hm screen|interview (?:scheduled|invite|request)|invited to interview|recruiter screen|was screened|assessment request|intro call|hm round|post-screen", re.I)

def main():
    with J.locked():
        c, rec = J.open_for_write()
        n = {"source": 0, "skip": 0, "replied": 0}
        for r in c.execute("SELECT * FROM jobs").fetchall():
            f = {}
            if r["source_detail"] in ("inferred", None) and r["source"] in ("legacy:unknown",) or r["source_detail"] == "inferred":
                src, det = J.infer_source(r["notes"])
                if src != r["source"] and (det == "tagged" or r["source"] == "legacy:unknown"):
                    f["source"], f["source_detail"] = src, det
            if r["status"] == "Skipped" and not r["skip_reason"]:
                f["skip_reason"] = J.skip_reason_of((r["legacy_status"] or "") + " " + r["notes"])
                f["skipped_by"] = J.skipped_by_of(r["legacy_status"], r["notes"])
            rep = 1 if (r["status"] in ("Interviewing", "Offer") or REPLY_RX.search(r["notes"] or "")) and r["status"] not in ("To Review", "Skipped", "Interested", "Packaged") else 0
            if rep != (r["replied"] or 0):
                f["replied"] = rep
            if f:
                c.execute("UPDATE jobs SET " + ",".join(f"{k}=?" for k in f) + " WHERE id=?", (*f.values(), r["id"]))
                for k in n:
                    if any(x.startswith(k[:4]) for x in f): n[k] += 1
        c.commit()
        J.write_views(c)
        print(n)

if __name__ == "__main__":
    main()
