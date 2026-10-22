#!/usr/bin/env python3
"""Add a role, or update fit/lane/notes/links on an existing one (dedupe: URL, company+req ID, company+title).

  upsert.py --company X --title Y --source li:signed-in --url URL [--lane TPM] [--fit Solid] [--note "..."]
            [--location ..] [--pay ..] [--posted ..] [--analysis jd-analysis/x.md] [--run-id RUN] [--told]
New rows land as To Review (or --status). Every call with --run-id also records a sighting for that source.
Prints the job id and whether it was new.
"""
import argparse, os, sys
from pipeline import jobsdb as J

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--company", required=True); ap.add_argument("--title", required=True)
    ap.add_argument("--source", required=True, help="ats:ashby, li:guest, li:signed-in, hiring.cafe, workday, gov:neogov, peer:<seed>, vc:<firm>, news:<site>, web, referral ...")
    ap.add_argument("--url"); ap.add_argument("--req"); ap.add_argument("--lane"); ap.add_argument("--fit", choices=J.FITS)
    ap.add_argument("--status", choices=J.STATUSES, default="To Review"); ap.add_argument("--note", default="")
    ap.add_argument("--location"); ap.add_argument("--pay"); ap.add_argument("--posted"); ap.add_argument("--analysis")
    ap.add_argument("--run-id"); ap.add_argument("--told", action="store_true", help="the user has now been told about this role")
    ap.add_argument("--remote", choices=["local", "remote-us", "out-of-area", "unverified"],
                    help="where the role can be worked from, verified from the JD / ATS location (unverified = 'remote unverified')")
    ap.add_argument("--no-render", action="store_true")
    a = ap.parse_args()
    with J.locked():
        c, rec = J.open_for_write()
        r = J.find(c, a.company, a.title, a.url, a.req)
        if r:
            jid, new = r["id"], False
            f = {}
            if a.fit and a.fit != r["fit"]: f["fit"] = a.fit
            if a.lane and not r["lane"]: f["lane"] = a.lane
            if a.url and not r["url"]: f["url"], f["url_canon"] = a.url, J.canon_url(a.url)
            if a.analysis: f["analysis_path"] = a.analysis
            if a.location and not r["location"]: f["location"] = a.location
            if a.pay and not r["pay_text"]: f["pay_text"] = a.pay
            if a.note: f["notes"] = (r["notes"] + " · " if r["notes"] else "") + f"[{J.today()}] {a.note}"
            if a.told and not r["told_at"]: f["told_at"] = J.now_iso()
            if a.remote and a.remote != r["remote_check"]: f["remote_check"] = a.remote
            if f:
                f["updated_at"] = J.now_iso()
                c.execute("UPDATE jobs SET " + ",".join(f"{k}=?" for k in f) + " WHERE id=?", (*f.values(), jid))
        else:
            note = a.note + (f" · {a.url}" if a.url and a.url not in a.note else "") + f" · src {a.source}"
            jid = J.insert_job(c, company=a.company, title=a.title, source=a.source, lane=a.lane, status=a.status, fit=a.fit,
                               url=a.url, req_id=a.req, location=a.location, pay_text=a.pay, posted_at=a.posted,
                               notes=note.strip(" ·"), analysis_path=a.analysis, by="upsert")
            if a.told: c.execute("UPDATE jobs SET told_at=? WHERE id=?", (J.now_iso(), jid))
            if a.remote: c.execute("UPDATE jobs SET remote_check=? WHERE id=?", (a.remote, jid))
            new = True
        if a.run_id:
            J.add_sighting(c, jid, a.run_id, a.source, a.url)
        c.commit()
        if not a.no_render:
            J.write_views(c)
        print(f"#{jid} {'NEW' if new else 'existing'} {a.company} | {a.title}")

if __name__ == "__main__":
    main()
