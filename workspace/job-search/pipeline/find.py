#!/usr/bin/env python3
'[Candidate-specific example/rule removed; read approved configuration.]\nAlso answers one-role-per-company: --company X lists every row at that company with its status.\nApply-prep queue (read-only):  find.py --status "To Review" --fit Strong,Solid --since 2026-10-20T07:15 [--json]\n  --fit   comma list of fit values;  --since  first_seen at or after this ISO time (PT, as stored).'

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
    ap = argparse.ArgumentParser()
    ap.add_argument("q", nargs="?"); ap.add_argument("--id", type=int); ap.add_argument("--company"); ap.add_argument("--title"); ap.add_argument("--url")
    ap.add_argument("--status"); ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--fit", help="comma list, e.g. Strong,Solid"); ap.add_argument("--since", help="first_seen >= ISO time")
    ap.add_argument("--json", action="store_true", help="print rows as JSON lines")
    a = ap.parse_args()
    c = J.connect()
    if a.id is not None:
        rows = c.execute("SELECT * FROM jobs WHERE id=?", (a.id,)).fetchall()
    elif a.url or (a.company and a.title):
        r = J.find(c, a.company, a.title, a.url)
        rows = [r] if r else []
    elif a.company:
        rows = c.execute("SELECT * FROM jobs WHERE company_key=? ORDER BY date DESC", (J.company_key(a.company),)).fetchall()
    else:
        q = f"%{(a.q or '').lower()}%"
        sql = "SELECT * FROM jobs WHERE (lower(company) LIKE ? OR lower(title) LIKE ? OR lower(notes) LIKE ?)"
        args = [q, q, q]
        if a.status: sql += " AND status=?"; args.append(a.status)
        if a.fit:
            fits = [x.strip() for x in a.fit.split(",") if x.strip()]
            sql += " AND fit IN (%s)" % ",".join("?" * len(fits)); args += fits
        if a.since: sql += " AND coalesce(first_seen, date) >= ?"; args.append(a.since)
        rows = c.execute(sql + " ORDER BY date DESC LIMIT ?", (*args, a.limit)).fetchall()
    if a.json:
        import json
        for r in rows: print(json.dumps({k: r[k] for k in r.keys()}, default=str))
        if not rows: print("no match", file=sys.stderr)
        return
    for r in rows:
        print(f"#{r['id']} {r['date']} | {r['company']} | {r['title']} | {r['status']} | fit {r['fit']} | {r['source']} | {r['url'] or ''}")
    if not rows: print("no match")

if __name__ == "__main__":
    main()
