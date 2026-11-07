#!/usr/bin/env python3
"""Change a role's status (the only supported way; never hand-edit jobs.md or the DB).

  update_status.py --company "<company>" --title "<role>" --status Applied --note "<current user-confirmed event>"
  update_status.py --url https://jobs.ashbyhq.com/... --status Rejected --note "email 10-21" --replied
  update_status.py --id 123 --status Skipped --skip-reason geo --by user --note "too far"
Statuses: To Review, Interested, Packaged, Applied, Interviewing, Offer, Rejected, Withdrawn, Held, Blocked, Closed, Skipped
Re-renders jobs.md + active.md afterwards.
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

import argparse, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jobsdb as J

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--id", type=int); ap.add_argument("--company"); ap.add_argument("--title"); ap.add_argument("--url"); ap.add_argument("--req")
    ap.add_argument("--status", required=True, choices=J.STATUSES)
    ap.add_argument("--note"); ap.add_argument("--fit", choices=J.FITS); ap.add_argument("--package")
    ap.add_argument("--skip-reason", choices=[n for n, _ in J.SKIP_REASONS] + ["other"])
    ap.add_argument("--by", default="agent", help="who decided: user | agent | <agent name>")
    ap.add_argument("--replied", action="store_true", help="employer replied (screen, recruiter email, interview)")
    a = ap.parse_args()
    with J.locked():
        c, rec = J.open_for_write()
        r = c.execute("SELECT * FROM jobs WHERE id=?", (a.id,)).fetchone() if a.id else J.find(c, a.company, a.title, a.url, a.req)
        if not r:
            sys.exit("no matching role (use find.py, or upsert.py to add it)")
        J.set_status(c, r["id"], a.status, by=a.by, note=a.note, fit=a.fit, package=a.package)
        if a.status == "Skipped":
            c.execute("UPDATE jobs SET skip_reason=?, skipped_by=? WHERE id=?",
                      (a.skip_reason or J.skip_reason_of(a.note or r["notes"]), "user" if a.by == "user" else "agent", r["id"]))
        if a.replied or a.status in ("Interviewing", "Offer"):
            c.execute("UPDATE jobs SET replied=1 WHERE id=?", (r["id"],))
            J.record_outcome(c, r["id"], "replied", J.now_iso(), a.by, a.note)   # links the reply to the package run
        c.commit()
        J.write_views(c)
        print(f"#{r['id']} {r['company']} | {r['title']}: {r['status']} -> {a.status}")

if __name__ == "__main__":
    main()
