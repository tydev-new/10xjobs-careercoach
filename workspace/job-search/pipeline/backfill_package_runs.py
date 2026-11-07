#!/usr/bin/env python3
"""Backfill package_runs + package_outcomes from existing packages (phase 2, 2026-10-20). Idempotent.

  python3 backfill_package_runs.py [--dry-run]

For every job with a package_path folder: one 'backfill' run with base, lane, cover format, lint/claims/rubric
versions and verdict (review.json when present, else the README stamp line; no stamp = LEGACY).
stamped_at = the package folder's day (daily-YYYY-MM-DD) at 00:00 local, else the job's applied_at, else README mtime.
Skipped when the job already has a stamp_review run. Outcomes come from status_history (Applied, Rejected, Interviewing,
Offer, Withdrawn, Closed at or after stamped_at) and jobs.replied (at told_at/updated_at; 'replied' also implied by
Interviewing/Offer). Nothing is inferred beyond those records.
"""

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

import argparse, datetime as dt, os, re, sys
from pathlib import Path
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, str(_JOBBI_APPS / 'lib'))
import jobsdb as J
import pkgmeta as PM

def stamped_at_of(pkg, row):
    m = re.search(r"daily-(\d{4}-\d\d-\d\d)", str(pkg))
    tz = dt.datetime.now().astimezone().tzinfo
    if m:
        return dt.datetime.fromisoformat(m.group(1)).replace(tzinfo=tz).isoformat(timespec="seconds")
    if row["applied_at"]:
        return dt.datetime.fromisoformat(row["applied_at"][:10]).replace(tzinfo=tz).isoformat(timespec="seconds")
    rd = Path(pkg) / "README.md"
    return dt.datetime.fromtimestamp((rd if rd.exists() else Path(pkg)).stat().st_mtime, tz).isoformat(timespec="seconds")

def main(argv=None, db=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    with J.locked():
        c = J.connect(db) if db else J.connect()
        runs = outs = skipped = missing = 0
        for row in c.execute("SELECT * FROM jobs WHERE package_path IS NOT NULL AND package_path!=''").fetchall():
            pkg = Path(row["package_path"].rstrip("/"))
            if not pkg.is_dir() or re.fullmatch(r"daily-\d{4}-\d\d-\d\d", pkg.name):
                missing += 1; continue
            if c.execute("SELECT 1 FROM package_runs WHERE job_id=? AND source='stamp_review'", (row["id"],)).fetchone():
                skipped += 1; continue
            verdict, lint, claims, rubric, rnd = PM.stamp_of(pkg)
            at = stamped_at_of(pkg, row)
            if a.dry_run:
                print(f"#{row['id']} {pkg.name}: {verdict} base={PM.base_of(pkg)} cover={PM.cover_format(pkg)} at={at}"); runs += 1; continue
            rid = J.record_package_run(c, package_path=str(pkg), job_id=row["id"], base=PM.base_of(pkg) or row["base_resume"] or "unknown",
                                       lane=row["lane"], cover_format=PM.cover_format(pkg), lint_version=lint, claims_version=claims,
                                       rubric_version=rubric, verdict=verdict or "LEGACY", round=rnd, stamped_at=at, source="backfill")
            runs += 1
            for h in c.execute("SELECT * FROM status_history WHERE job_id=? AND at>=? ORDER BY at", (row["id"], at[:10])).fetchall():
                o = J.OUTCOME_OF.get(h["new"])
                if o:
                    c.execute("INSERT OR IGNORE INTO package_outcomes VALUES (?,?,?,?,?,?)", (rid, row["id"], o, h["at"], h["by"], h["note"])); outs += 1
                if h["new"] in ("Interviewing", "Offer"):
                    c.execute("INSERT OR IGNORE INTO package_outcomes VALUES (?,?,?,?,?,?)", (rid, row["id"], "replied", h["at"], h["by"], h["note"]))
            if row["status"] == "Applied" or row["applied_at"]:
                c.execute("INSERT OR IGNORE INTO package_outcomes VALUES (?,?,?,?,?,?)", (rid, row["id"], "applied", row["applied_at"] or at, "backfill", "jobs.applied_at"))
            if row["replied"]:
                c.execute("INSERT OR IGNORE INTO package_outcomes VALUES (?,?,?,?,?,?)", (rid, row["id"], "replied", row["told_at"] or row["updated_at"], "backfill", "jobs.replied"))
        if not a.dry_run:
            c.commit()
        print(f"package_runs backfilled: {runs} · outcome rows (insert-or-ignore) attempted: {outs} · skipped (already stamped): {skipped} · no package folder: {missing}")

if __name__ == "__main__":
    main()
