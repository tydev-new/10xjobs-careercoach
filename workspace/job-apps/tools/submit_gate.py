#!/usr/bin/env python3
"""submit_gate.py: the last check before a human submits an application (phase 3 item 8, 2026-10-21).

  python3 submit_gate.py <pkg>                       run every check; exit 0 = OK to submit, 1 = BLOCK
  python3 submit_gate.py <pkg> --verified-live "the user checked 10:05, Apply button open"   accept an unverifiable posting
  python3 submit_gate.py --job-id 97                 same, package from jobs.package_path
  python3 submit_gate.py <pkg> --no-record --json    no DB row; machine output

It never submits, sends or contacts anyone. Network use is read-only GETs of the public posting
(Ashby posting-api, Greenhouse boards-api, Lever postings API, Workday cxs, LinkedIn guest page).

BLOCK when any of these fail:
  - posting is closed (removed from the board, 404/410, or LinkedIn "No longer accepting applications")
  - posting could not be verified (rate-limited, unknown host) and no --verified-live note was given
  - jobs.db status is not Packaged (Skipped, Closed, Applied, Held, Blocked, Rejected ... all block)
  - finalize_review.py --verify fails: review.json is not a finalize_review.py PASS, lens files or resume/cover changed
    since, or a kept code gate (claims, JD copy, format) fails now. Single-pass / stamp_review.py PASSes are not accepted.
  - build_package.py --check differs from the files on disk (for packages that have package.yaml)
  - the form requires a cover letter (fetch_form.py form.json or package.yaml cover_required: true) and cover.pdf
    is missing. A review may be one combined reviews/combined.json or the older 4 lens files (finalize_review.py --verify).
Prints what to upload: resume.pdf, plus cover.pdf only when a cover is required (default: no cover uploaded).
Every run is written to jobs.db submit_checks (unless --no-record).
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

import argparse, json, os, re, subprocess, sys, urllib.parse
from pathlib import Path
HERE = Path(__file__).resolve().parent
PIPE = str(_JOBBI_SEARCH / 'pipeline')
sys.path.insert(0, PIPE)
import jobsdb as J
from sweep import http, jget

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

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()

def gate(pkg=None, job_id=None, verified_live=None, record=True, posting_fn=posting_status, db=None):
    c = J.connect(db) if db else J.connect()
    if job_id is not None:
        row = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if row is None: raise SystemExit(f"no job {job_id}")
        pkg = pkg or row["package_path"]
    pkg = Path(pkg).resolve()
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
    # 2. the single review step recorded a current PASS (2026-10-21 simple: finalize_review.py only)
    code, out = run([sys.executable, str(HERE / "finalize_review.py"), str(pkg), "--verify"])
    checks["stamp"] = {"exit": code, "tail": out.splitlines()[-4:]}
    if code != 0: reasons.append("finalize_review.py --verify failed: no current finalize_review PASS (" + "; ".join(l.strip("- ").strip() for l in out.splitlines()[1:3]) + ")")
    # 3. files match the spec
    if (pkg / "package.yaml").exists():
        code, out = run([sys.executable, str(HERE / "build_package.py"), "--check", str(pkg)])
        checks["build"] = out.splitlines()[:1]
        if code != 0: reasons.append(f"build_package.py --check: {out.splitlines()[0] if out else 'failed'}")
    # Candidate-specific annotation removed.
    sys.path.insert(0, str(HERE)); import fetch_form
    need, why = fetch_form.cover_required(pkg)
    has = (pkg / "cover.pdf").exists()
    checks["cover"] = {"required": need, "rule": why, "upload": ["resume.pdf"] + (["cover.pdf"] if need and has else [])}
    if need and not has: reasons.append(f"the form requires a cover letter ({why}) and cover.pdf is missing")
    elif has and not need: checks["cover"]["note"] = "cover.pdf exists but no cover is required: do not upload it"
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
        cv = r["checks"].get("cover") or {}
        print(f"  upload: {', '.join(cv.get('upload') or ['resume.pdf'])}" + (f"  ({cv['note']})" if cv.get("note") else ""))
    sys.exit(0 if r["result"] == "OK" else 1)

if __name__ == "__main__":
    main()
