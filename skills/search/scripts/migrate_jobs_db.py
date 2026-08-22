#!/usr/bin/env python3
"""One-shot: convert a legacy jobs.db into the jobs.md record (2026-08-14).

Backs the database up to jobs.db.bak and deletes the original — SQLite is no
longer a persistent store. Safe to re-run (no-op once jobs.db is gone).

  python3 migrate_jobs_db.py --workspace .
"""
import argparse, os, sqlite3, sys
import jobs_md as jm


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", required=True)
    a = p.parse_args()
    db = os.path.join(a.workspace, "jobs.db")
    if not os.path.exists(db):
        print("no jobs.db — nothing to migrate")
        return 0
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    rows = []
    for r in con.execute("SELECT * FROM jobs"):
        d = dict(r)
        rows.append({
            "company": d["company"], "title": d["title"],
            "stage": d.get("stage") or "To Review",
            "dismissed": bool(d.get("dismissed")),
            "url": d.get("url"), "location": d.get("location"),
            "fit_verdict": d.get("fit_verdict"), "fit_score": d.get("fit_score"),
            "fit_reason": d.get("fit_reason"), "dealbreakers": d.get("dealbreakers"),
            "dismiss_reason": d.get("dismiss_reason"),
            "jd_file": d.get("jd_file"), "company_file": d.get("company_file"),
            "evaluated_at": d.get("evaluated_at"),
            "updated_at": d.get("updated_at"), "posted_at": d.get("posted_at"),
            "seen_at": d.get("updated_at"), "track": d.get("track"),
            "jd_sim": d.get("jd_sim"), "flags": d.get("flags"),
        })
    con.close()
    existing = jm.load(a.workspace)
    have = {jm.key(r) for r in existing}
    merged = existing + [r for r in rows if jm.key(r) not in have]
    jm.save(a.workspace, merged)
    os.replace(db, db + ".bak")
    print(f"migrated {len(rows)} roles ({len(merged)} total) -> jobs.md; jobs.db -> jobs.db.bak")
    return 0


if __name__ == "__main__":
    sys.exit(main())
