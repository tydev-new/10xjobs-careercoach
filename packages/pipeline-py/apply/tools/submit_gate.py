#!/usr/bin/env python3
"""submit_gate.py: the last check before a human submits an application.

  jobsearch.py submit-gate <pkg>                     run every check; exit 0 = OK to submit, 1 = BLOCK
  jobsearch.py submit-gate <pkg> --verified-live "candidate checked 10:05, Apply button open"   accept an unverifiable posting
  jobsearch.py submit-gate --job-id 97               same, package from jobs.package_path
  jobsearch.py submit-gate <pkg> --no-record --json  no DB row; machine output

It never submits, sends or contacts anyone. Network use is read-only GETs of the public posting
(Ashby posting-api, Greenhouse boards-api, Lever postings API, Workday cxs, LinkedIn guest page).

BLOCK when any of these fail:
  - posting is closed (removed from the board, 404/410, or LinkedIn "No longer accepting applications")
  - posting could not be verified (rate-limited, unknown host) and no --verified-live note was given
  - jobs.db status is not Packaged (Skipped, Closed, Applied, Held, Blocked, Rejected ... all block)
  - finalize_review --verify fails: review.json is not a finalize_review PASS, lens files or resume/cover changed
    since, or a kept code gate (claims, JD copy, format) fails now.
  - build_package --check differs from the files on disk, or its gates fail (for packages that have package.yaml)
Every run is written to jobs.db submit_checks (unless --no-record).
"""
import argparse, json, os, re, sys, urllib.parse
from pathlib import Path

from pipeline import home as H
from pipeline import jobsdb as J
from pipeline.sweep import http, jget
from apply.tools import build_package as BP, finalize_review as FR

CLOSED_TEXT = re.compile(r"No longer accepting applications|This job is no longer available|job (?:posting )?(?:has been|is) closed|position has been filled", re.I)

def posting_status(url, get=http, jget=jget, company=None):
    """('live'|'closed'|'unknown', detail). Pure read-only GETs."""
    if not url: return "unknown", "no url in jobs.db"
    u = urllib.parse.urlparse(url); host, path = u.netloc.lower(), u.path
    q = urllib.parse.parse_qs(u.query)
    m = re.match(r"/([\w.-]+)/([0-9a-f-]{36})", path)
    if host == "jobs.ashbyhq.com" and m:
        slug, jid = m.groups()
        code, d = jget(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
        if code != 200 or d is None: return "unknown", f"ashby board {slug}: HTTP {code}"
        ids = {j.get("id") for j in d.get("jobs", [])}
        return ("live", f"ashby {slug}: listed") if jid in ids else ("closed", f"ashby {slug}: {jid} not on the board ({len(ids)} open jobs)")
    m = re.match(r"/([\w.-]+)/jobs/(\d+)", path)
    if host in ("job-boards.greenhouse.io", "boards.greenhouse.io") and m:
        slug, jid = m.groups()
        code, _ = jget(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{jid}")
        if code == 200: return "live", f"greenhouse {slug}/{jid}: 200"
        if code == 404: return "closed", f"greenhouse {slug}/{jid}: 404"
        return "unknown", f"greenhouse {slug}/{jid}: HTTP {code}"
    m = re.match(r"/([\w.-]+)/([0-9a-f-]{36})", path)
    if host == "jobs.lever.co" and m:
        slug, jid = m.groups()
        code, _ = jget(f"https://api.lever.co/v0/postings/{slug}/{jid}")
        if code == 200: return "live", f"lever {slug}/{jid}: 200"
        if code == 404: return "closed", f"lever {slug}/{jid}: 404"
        return "unknown", f"lever {slug}/{jid}: HTTP {code}"
    m = re.match(r"([\w-]+)\.wd\d+\.myworkdayjobs\.com", host)
    if m and "/job/" in path:
        tenant = m.group(1); parts = path.strip("/").split("/")
        parts = parts[1:] if re.match(r"^[a-z]{2}-[A-Z]{2}$", parts[0]) else parts   # optional locale
        site, rest = parts[0], "/".join(parts[parts.index("job") + 1:])
        code, d = jget(f"https://{host}/wday/cxs/{tenant}/{site}/job/{rest}")
        if code == 200 and d and d.get("jobPostingInfo"):
            info = d["jobPostingInfo"]
            if info.get("canApply") is False: return "closed", f"workday {tenant}: canApply false"
            return "live", f"workday {tenant}: posted {info.get('postedOn', '?')}"
        if code in (404, 410): return "closed", f"workday {tenant}: HTTP {code}"
        return "unknown", f"workday {tenant}: HTTP {code}"
    m = re.search(r"/jobs/view/(?:[\w-]*-)?(\d{6,})", path)
    if host.endswith("linkedin.com") and m:
        jid = m.group(1)
        code, body = get(f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{jid}")
        text = body.decode("utf-8", "replace") if isinstance(body, bytes) else str(body)
        if code == 200 and CLOSED_TEXT.search(text): return "closed", f"linkedin {jid}: no longer accepting applications"
        if code == 200 and re.search(r"top-card-layout__title|topcard__title", text): return "live", f"linkedin {jid}: open"
        if code in (404, 410): return "closed", f"linkedin {jid}: HTTP {code}"
        return "unknown", f"linkedin {jid}: HTTP {code} (guest page unclear or rate-limited)"
    if "gh_jid" in q:   # Greenhouse embedded on the company site: try board slugs from the company name and host
        jid = q["gh_jid"][0]
        guesses = dict.fromkeys(x for x in [re.sub(r"[^a-z0-9]", "", (company or "").lower().split("(")[0]),
                                            host.removeprefix("www.").split(".")[0].removesuffix("careers"), host.removeprefix("www.").split(".")[0]] if x)
        for slug in guesses:
            if jget(f"https://boards-api.greenhouse.io/v1/boards/{slug}")[0] != 200: continue
            code, _ = jget(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{jid}")
            if code == 200: return "live", f"greenhouse {slug}/{jid} (gh_jid): 200"
            if code == 404: return "closed", f"greenhouse {slug}/{jid} (gh_jid): 404"
    code, body = get(url)
    text = body.decode("utf-8", "replace") if isinstance(body, bytes) else str(body)
    if code in (404, 410): return "closed", f"{host}: HTTP {code}"
    if code == 200 and CLOSED_TEXT.search(text): return "closed", f"{host}: page says closed"
    return "unknown", f"{host}: HTTP {code}; no ATS API for this host, verify by hand"

def pkg_path(p):
    p = Path(p)
    return (p if p.is_absolute() else H.home() / p).resolve()

def gate(pkg=None, job_id=None, verified_live=None, record=True, posting_fn=posting_status, db=None):
    c = J.connect(db) if db else J.connect()
    if job_id is not None:
        row = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if row is None: raise SystemExit(f"no job {job_id}")
        pkg = pkg or row["package_path"]
        if not pkg: raise SystemExit(f"job {job_id} has no package_path")
    pkg = pkg_path(pkg)
    rv = json.loads((pkg / "review.json").read_text()) if (pkg / "review.json").exists() else {}
    if job_id is None:
        jid = rv.get("job_id")
        row = (c.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone() if jid else None) or \
              c.execute("SELECT * FROM jobs WHERE rtrim(package_path,'/')=?", (str(pkg),)).fetchone()
    reasons, checks = [], {}
    # 1. DB status
    status = row["status"] if row else None
    checks["db_status"] = status
    if row is None: reasons.append("package is not linked to a jobs.db row")
    elif status != "Packaged": reasons.append(f"jobs.db status is {status!r}, not 'Packaged'" + (f" (skip reason: {row['skip_reason']})" if row["skip_reason"] else ""))
    # 2. the single review step recorded a current PASS (finalize_review only)
    verrs = FR.verify(pkg)
    checks["stamp"] = {"exit": 1 if verrs else 0, "tail": verrs[:4]}
    if verrs: reasons.append("finalize_review --verify failed: no current finalize_review PASS (" + "; ".join(verrs[:2]) + ")")
    # 3. files match the spec
    if (pkg / "package.yaml").exists():
        berrs, diffs = BP.check_one(pkg)
        checks["build"] = {"gate_errors": berrs[:5], "diffs": sorted(diffs)}
        if berrs: reasons.append(f"build_package --check: gate errors: {'; '.join(berrs[:3])}")
        elif diffs: reasons.append(f"build_package --check: files on disk differ from package.yaml ({', '.join(sorted(diffs))})")
    # 4. posting is live
    url = row["url"] if row else None
    posting, detail = posting_fn(url, company=row["company"] if row else None)
    checks["posting"] = {"url": url, "state": posting, "detail": detail}
    if posting == "closed": reasons.append(f"posting closed: {detail}")
    elif posting == "unknown":
        if verified_live: checks["posting"]["verified_live"] = verified_live
        else: reasons.append(f"posting not verified ({detail}); check the Apply page by hand and rerun with --verified-live \"<who/when/what you saw>\"")
    result = "BLOCK" if reasons else "OK"
    run_row = J.latest_run(c, row["id"]) if row else None
    if record:
        with J.locked():
            c.execute("""INSERT INTO submit_checks(job_id,package_path,run_id,checked_at,url,posting,posting_detail,db_status,stamp_verdict,
                         stamp_current,result,reasons) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                      (row["id"] if row else None, str(pkg), run_row["id"] if run_row else None, J.now_iso(), url, posting,
                       detail + (f" | verified_live: {verified_live}" if verified_live and posting == "unknown" else ""), status,
                       rv.get("final"), int(checks["stamp"]["exit"] == 0), result, json.dumps(reasons)))
            c.commit()
    c.commit(); c.close()
    return {"package": pkg.name, "job_id": row["id"] if row else None, "result": result, "reasons": reasons, "checks": checks}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pkg", nargs="?"); ap.add_argument("--job-id", type=int); ap.add_argument("--verified-live")
    ap.add_argument("--no-record", action="store_true"); ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if not a.pkg and a.job_id is None: ap.error("give a package path or --job-id")
    r = gate(a.pkg, a.job_id, a.verified_live, record=not a.no_record)
    if a.json: print(json.dumps(r, indent=1))
    else:
        print(f"{r['result']}  {r['package']} (job {r['job_id']})  posting: {r['checks']['posting']['state']} — {r['checks']['posting']['detail']}")
        for x in r["reasons"]: print(f"  - {x}")
    sys.exit(0 if r["result"] == "OK" else 1)

if __name__ == "__main__":
    main()
