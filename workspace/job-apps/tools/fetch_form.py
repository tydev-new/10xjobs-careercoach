#!/usr/bin/env python3
"""fetch_form.py: pull an application form's questions at build time and write <pkg>/form.json (2026-11-04).

  python3 fetch_form.py <pkg> [--url URL] [--print]      fetch + write form.json (and the raw reply beside it)
  python3 fetch_form.py --url URL --print                fetch and print only, write nothing
  python3 fetch_form.py <pkg> --cover                    print the cover decision for a package (no network)

Supported (read-only, public, no login): Ashby (POST jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting, the
read-only query the public job page itself runs; raw -> form-ashby.json) and Greenhouse
(GET boards-api.greenhouse.io/v1/boards/<board>/jobs/<id>?questions=true; raw -> form-greenhouse.json).
Other hosts (Lever, Workday, iCIMS, ...) print UNSUPPORTED and write nothing: read the form in the browser.
Never submits, never sends answers, never logs in.

form.json (schema form-v1): ats, url, fetched_at, endpoint, title, cover_required (bool), cover_field
(present/required), questions [{id, label, type, required, options, description}], raw_file.
Cover rule (the user 2026-11-03): build and upload a cover only when the form REQUIRES one. cover_required() below is
what build_package.py, lint_3lens_package.py, precheck.py and submit_gate.py read:
package.yaml `cover_required: true|false` wins, else form.json `cover_required`, else False (no cover).
Exit 0 = written / printed, 1 = fetch failed, 3 = unsupported host.
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

import argparse, datetime as dt, json, re, sys, urllib.parse
from pathlib import Path
import yaml
sys.path.insert(0, str(_JOBBI_SEARCH / 'pipeline'))

ASHBY_Q = ("query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { jobPosting("
           "organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) { id title isListed "
           "locationName workplaceType compensationTierSummary applicationForm { sections { title fieldEntries { ... on "
           "FormFieldEntry { id isRequired descriptionHtml field } } } } } }")
COVER_RX = re.compile(r"cover[\s_-]*letter", re.I)
DB = Path(str(_JOBBI_SEARCH / 'pipeline/jobs.db'))

def _http(url, data=None, headers=None):
    from sweep import http          # pipeline helper: UA, timeout, fixture capture
    return http(url, data=data, headers=headers)

def strip_html(s): return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()

def parse_url(url):
    """('ashby', org, id) | ('greenhouse', board, id) | ('greenhouse-embed', host, id) | (None, host, None)."""
    u = urllib.parse.urlparse(url or ""); host, path = u.netloc.lower(), u.path; q = urllib.parse.parse_qs(u.query)
    m = re.match(r"/([\w.-]+)/([0-9a-f-]{36})", path)
    if host == "jobs.ashbyhq.com" and m: return "ashby", m.group(1), m.group(2)
    m = re.match(r"/([\w.-]+)/jobs/(\d+)", path)
    if host in ("job-boards.greenhouse.io", "boards.greenhouse.io", "job-boards.eu.greenhouse.io") and m: return "greenhouse", m.group(1), m.group(2)
    if host.endswith("greenhouse.io") and "for" in q and "token" in q: return "greenhouse", q["for"][0], q["token"][0]
    if "gh_jid" in q: return "greenhouse-embed", host, q["gh_jid"][0]
    return None, host, None

def ashby(org, jid, get=None):
    get = get or _http
    body = json.dumps({"operationName": "ApiJobPosting", "variables": {"organizationHostedJobsPageName": org, "jobPostingId": jid},
                       "query": ASHBY_Q}).encode()
    code, raw = get("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", data=body, headers={"Content-Type": "application/json"})
    if code != 200: return None, None, f"ashby HTTP {code}"
    d = json.loads(raw); jp = (d.get("data") or {}).get("jobPosting")
    if not jp: return None, d, "ashby: posting not found (closed or wrong id)"
    qs = []
    for s in (jp.get("applicationForm") or {}).get("sections") or []:
        for f in s.get("fieldEntries") or []:
            fl = f.get("field") or {}
            qs.append({"id": fl.get("path") or fl.get("id"), "label": fl.get("title") or fl.get("humanReadablePath"), "type": fl.get("type"),
                       "required": bool(f.get("isRequired")), "options": [o.get("label") for o in fl.get("selectableValues") or []],
                       "description": strip_html(f.get("descriptionHtml"))[:400]})
    meta = {"title": jp.get("title"), "listed": jp.get("isListed"), "location": jp.get("locationName"),
            "workplace": jp.get("workplaceType"), "pay": jp.get("compensationTierSummary")}
    return {"ats": "ashby", "endpoint": "jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", **meta, "questions": qs}, d, None

def greenhouse(board, jid, get=None):
    get = get or _http
    url = f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{jid}?questions=true"
    code, raw = get(url)
    if code != 200: return None, None, f"greenhouse {board}/{jid}: HTTP {code}"
    d = json.loads(raw); qs = []
    for grp in ("questions", "location_questions", "compliance", "demographic_questions"):
        items = d.get(grp) or []
        if isinstance(items, dict): items = items.get("questions") or []
        for q in items:
            fields = q.get("fields") or [{}]
            qs.append({"id": fields[0].get("name") or q.get("id"), "label": q.get("label") or q.get("description") or "", "type": fields[0].get("type"),
                       "required": bool(q.get("required")), "options": [v.get("label") for f in fields for v in f.get("values") or []],
                       "description": strip_html(q.get("description"))[:400], "group": grp})
    return {"ats": "greenhouse", "endpoint": url, "title": d.get("title"), "location": (d.get("location") or {}).get("name"),
            "questions": qs}, d, None

def board_guesses(host, company=None):
    h = host.removeprefix("www.").split(".")[0]
    return list(dict.fromkeys(x for x in [re.sub(r"[^a-z0-9]", "", (company or "").lower().split("(")[0]), h.removesuffix("careers"), h] if x))

def fetch(url, company=None, get=None):
    """(form dict | None, raw | None, error | None, kind)."""
    kind, a, b = parse_url(url)
    if kind == "ashby": f, raw, e = ashby(a, b, get)
    elif kind == "greenhouse": f, raw, e = greenhouse(a, b, get)
    elif kind == "greenhouse-embed":
        f = raw = None; e = f"greenhouse embed on {a}: no board slug matched"
        for slug in board_guesses(a, company):
            f, raw, e = greenhouse(slug, b, get)
            if f: kind = "greenhouse"; break
    else: return None, None, f"UNSUPPORTED host {a!r}: read the form in the browser", None
    if f:
        cov = [q for q in f["questions"] if COVER_RX.search(f"{q.get('id')} {q.get('label')}")]
        f["cover_field"] = {"present": bool(cov), "required": any(q["required"] for q in cov)}
        f["cover_required"] = f["cover_field"]["required"]
        f["required_count"] = sum(q["required"] for q in f["questions"])
    return f, raw, e, kind

def pkg_url(pkg):
    pkg = Path(pkg); rd = (pkg / "README.md").read_text() if (pkg / "README.md").exists() else ""
    for k in ("Apply URL", "Posting", "URL"):
        m = re.search(rf"\*\*{k}:\*\*\s*(\S+)", rd)
        if m: return m.group(1).rstrip(").,"), None
    spec = yaml.safe_load((pkg / "package.yaml").read_text()) if (pkg / "package.yaml").exists() else {}
    m = re.search(r"\*\*URL:\*\*\s*(\S+)", (spec.get("resume") or {}).get("head", ""))
    if m: return m.group(1), None
    if DB.exists():
        import sqlite3
        r = sqlite3.connect(f"file:{DB}?mode=ro", uri=True).execute("select url, company from jobs where rtrim(package_path,'/')=?", (str(pkg.resolve()),)).fetchone()
        if r: return r[0], r[1]
    return None, None

def cover_required(pkg):
    """the one cover decision: package.yaml cover_required wins, else form.json, else False (no cover by default)."""
    pkg = Path(pkg)
    spec = yaml.safe_load((pkg / "package.yaml").read_text()) if (pkg / "package.yaml").exists() else {}
    if isinstance(spec, dict) and isinstance(spec.get("cover_required"), bool): return spec["cover_required"], "package.yaml cover_required"
    if (pkg / "form.json").exists():
        f = json.loads((pkg / "form.json").read_text())
        return bool(f.get("cover_required")), f"form.json ({f.get('ats')}: cover field {'required' if f.get('cover_required') else 'optional or absent'})"
    return False, "default (no form.json and no package.yaml cover_required): no cover"

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pkg", nargs="?"); ap.add_argument("--url"); ap.add_argument("--print", action="store_true", dest="show")
    ap.add_argument("--cover", action="store_true")
    a = ap.parse_args()
    if a.cover:
        if not a.pkg: ap.error("--cover needs a package")
        req, why = cover_required(a.pkg); print(f"cover_required={str(req).lower()}  ({why})"); return 0
    company = None
    url = a.url
    if not url and a.pkg: url, company = pkg_url(a.pkg)
    if not url: ap.error("no URL: pass --url or a package with a README Apply URL / package.yaml URL")
    f, raw, err, kind = fetch(url, company)
    if err and not f:
        print(err if kind is None else "FAIL " + err); return 3 if kind is None else 1
    f.update({"schema": "form-v1", "url": url, "fetched_at": dt.datetime.now().astimezone().isoformat(timespec="seconds")})
    if a.pkg and not (a.show and not a.pkg):
        pkg = Path(a.pkg); pkg.mkdir(parents=True, exist_ok=True); rawf = f"form-{f['ats']}.json"
        (pkg / rawf).write_text(json.dumps(raw)); f["raw_file"] = rawf
        (pkg / "form.json").write_text(json.dumps(f, indent=1) + "\n")
    print(f"{f['ats']}: {f.get('title')}  {len(f['questions'])} question(s), {f['required_count']} required; "
          f"cover letter field: {'REQUIRED' if f['cover_required'] else ('optional' if f['cover_field']['present'] else 'none')}"
          + (f"  -> {Path(a.pkg) / 'form.json'}" if a.pkg else ""))
    if a.show:
        for q in f["questions"]:
            print(f"  {'REQ' if q['required'] else 'opt'} {q.get('type') or '?':14s} {q['label'][:90]}" + (f"  {q['options'][:6]}" if q.get("options") else ""))
    return 0

if __name__ == "__main__":
    sys.exit(main())
