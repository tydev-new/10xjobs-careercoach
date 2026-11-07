#!/usr/bin/env python3
'Workday enterprise sweep for the user\'s job scout (source 7).\n\nReads tenants from workday-tenants.md (markdown table: Company | Host | Tenant | Site | Status | Notes),\nqueries each tenant\'s public CXS search endpoint for lane terms, keeps in-lane titles located in the\nthe configured home area or remote region, fetches each kept posting\'s detail to confirm location,\nflag clearance, and read pay, then writes JSON + markdown.\n\nTransport: plain HTTPS from the box works (python requests / curl both return 200 as of 2026-10-19).\nNo auth, no cookies. Read-only. Does NOT touch jobs.md and sends nothing.\n\nUsage:\n  python3 workday_sweep.py                      # all tenants with status OK\n  python3 workday_sweep.py --max-age 7          # only postings <= 7 days old (Workday "Posted N Days Ago")\n[Candidate-specific example/rule removed; read approved configuration.]\n  python3 workday_sweep.py --out-dir DIR        # default: <search-workspace>/workday/runs/<timestamp>\n  python3 workday_sweep.py --verify             # just test each tenant (1 query) and print status'

# Portable path/config adapter; pipeline implementation below is retained.
from pathlib import Path as _JobbiPath
import os as _jobbi_os, sys as _jobbi_sys
_JOBBI_ROOT = _JobbiPath(_jobbi_os.environ.get("JOBBI_ROOT", str(_JobbiPath(__file__).resolve().parents[2])))
_jobbi_sys.path.insert(0, str(_JOBBI_ROOT))
from runtime_config import policy as _jobbi_policy, candidate as _jobbi_candidate
_JOBBI_SEARCH = _JOBBI_ROOT / "workspace" / "job-search"
_JOBBI_APPS = _JOBBI_ROOT / "workspace" / "job-apps"
_JOBBI_POLICY = _jobbi_policy(_JOBBI_ROOT)
_JOBBI_CAND = _jobbi_candidate(_JOBBI_ROOT)

import argparse, concurrent.futures as cf, datetime as dt, html, json, os, re, sys, time
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
TENANTS_MD = os.path.join(HERE, "workday-tenants.md")
UA = {"Accept": "application/json", "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) job-scout/1.0"}

SEARCH_TERMS = _JOBBI_POLICY.get("workday_search_terms", [])

# Lane classification on title (case-insensitive). Order matters: first match wins.
LANES = _JOBBI_POLICY.get("workday_lanes", [])
# Big-company seniority filter: Director-level is out at enterprises (rules v6.2), and junior titles are out.
TITLE_EXCLUDE = re.compile(_JOBBI_POLICY.get("title_exclude_regex", r"(?!)"), re.I)

HOME_LOCATIONS = _JOBBI_POLICY.get("home_locations", [])
EXCLUDED_LOCATIONS = _JOBBI_POLICY.get("excluded_locations", [])
REMOTE_RE = re.compile(r"\b(remote|virtual|work from home|work at home|wfh|telecommut\w*|anywhere|field-[a-z]{2})\b", re.I)
US_STATES = "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming"
US_RE = re.compile(_JOBBI_POLICY.get("remote_region_regex", r"(?!)"), re.I)
NON_US_RE = re.compile(_JOBBI_POLICY.get("outside_region_regex", r"(?!)"), re.I)
CLEARANCE_RE = re.compile(r"(security clearance|clearance required|clearance is required|ts/sci|top secret|secret clearance|active (secret|ts|clearance)|"
                          r"dod clearance|polygraph|ability to obtain (and maintain )?(a |an )?(us |u\.s\. )?(government |dod )?(security )?clearance|"
                          r"clearance required for start:\s*yes|must (hold|possess|have) (an? )?(active )?(secret|ts|clearance))", re.I)
NO_CLEARANCE_RE = re.compile(r"clearance required for start:\s*no|no (security )?clearance (is )?required|clearance type:\s*none", re.I)
PAY_RE = re.compile(r"\$\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d+)?\s?[kK])(?:\.\d{2})?\s*(?:-|–|—|to|and)\s*\$?\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d+)?\s?[kK])")

PAY_USD_RE = re.compile(r"(\d{2,3},\d{3}(?:\.\d{2})?)\s*(?:USD)?\s*(?:-|–|—|to)\s*(\d{2,3},\d{3}(?:\.\d{2})?)\s*USD", re.I)

def money(s):
    s = s.replace(",", "").replace(" ", "")
    if "." in s and s[-1] not in "kK": s = s.split(".")[0]
    return float(s[:-1]) * 1000 if s[-1] in "kK" else float(s)

def load_tenants(path=TENANTS_MD):
    rows, header = [], None
    for line in open(path):
        if not line.startswith("|"): continue
        cells = [c.strip().strip("`") for c in line.strip().strip("|").split("|")]
        if header is None:
            header = [c.lower() for c in cells]; continue
        if set("".join(cells)) <= set("-: "): continue
        r = dict(zip(header, cells))
        if r.get("host") and r.get("tenant") and r.get("site"):
            rows.append(r)
    return rows

def post(sess, t, body, timeout=20):
    url = f"https://{t['host']}/wday/cxs/{t['tenant']}/{t['site']}/jobs"
    err = None
    for attempt in range(4):
        try:
            r = sess.post(url, json=body, headers=UA, timeout=timeout)
            if r.status_code == 200: return r.json()
            err = f"HTTP {r.status_code}"
            if r.status_code in (429, 500, 502, 503):
                time.sleep((6 if r.status_code == 429 else 2) * (2 ** attempt)); continue
            raise RuntimeError(err)
        except requests.RequestException as e:
            err = f"{type(e).__name__}: {e}"; time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed after retries ({err})")

def detail(sess, t, path):
    url = f"https://{t['host']}/wday/cxs/{t['tenant']}/{t['site']}{path}"
    r = sess.get(url, headers=UA, timeout=20)
    r.raise_for_status()
    return r.json().get("jobPostingInfo", {})

def loc_class(text):
    """Return 'home-area', 'remote-region', 'excluded-area', 'other' for one location string."""
    l = (text or "").lower()
    m = re.match(r"\s*field-([a-z]{2})\b", l)   # Territory-style seats: allowed region codes come from current policy
    if m: return "remote-region" if m.group(1) in _JOBBI_POLICY.get("field_region_codes", []) else "other"
    if any(e in l for e in EXCLUDED_LOCATIONS) and not any(b in l for b in HOME_LOCATIONS): return "excluded-area"
    if any(b in l for b in HOME_LOCATIONS): return "home-area"
    if REMOTE_RE.search(l) and not NON_US_RE.search(l) and (US_RE.search(text or "") or l.strip() in ("remote", "virtual", "work from home")): return "remote-region"
    return "other"

def walk_facets(facets):
    """Yield (param, descriptor, id) for leaf facet values."""
    for f in facets or []:
        param = f.get("facetParameter")
        for v in f.get("values", []):
            if "values" in v: yield from walk_facets([v])
            elif v.get("id"): yield param, v.get("descriptor", ""), v["id"]

def location_facet(facets):
    """Pick ONE location facet param + ids covering configured home area / remote region values."""
    best = {}
    for param, desc, vid in walk_facets(facets):
        if not param or "loc" not in param.lower() and "remote" not in param.lower(): continue
        c = loc_class(desc)
        if c in ("home-area", "remote-region"):
            best.setdefault(param, []).append(vid)
    if not best: return None
    param = max(best, key=lambda p: len(best[p]))
    return {param: best[param]}

def lane_of(title):
    if TITLE_EXCLUDE.search(title): return None
    for name, rx in LANES:
        if re.search(rx, title, re.I): return name
    return None

def age_days(posted):
    p = (posted or "").lower()
    if "today" in p: return 0
    if "yesterday" in p: return 1
    m = re.search(r"(\d+)\+?\s*days", p)
    return int(m.group(1)) if m else None

def strip_html(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()

def sweep_tenant(t, terms, max_age, pages):
    sess = requests.Session()
    out = {"company": t.get("company"), "tenant": t["tenant"], "ok": True, "error": None, "queries": 0,
           "facet": None, "seen": 0, "hits": [], "dropped": []}
    try:
        first = post(sess, t, {"appliedFacets": {}, "limit": 1, "offset": 0, "searchText": ""}); out["queries"] += 1
        facet = location_facet(first.get("facets"))
        out["facet"] = {k: len(v) for k, v in facet.items()} if facet else None
        cands = {}
        for term in terms:
            plans = ([(facet, pages)] if facet else []) + [({}, 1 if facet else pages)]
            for applied, npages in plans:
                for pg in range(npages):
                    try:
                        res = post(sess, t, {"appliedFacets": applied or {}, "limit": 20, "offset": pg * 20, "searchText": term})
                    except Exception as e:
                        out.setdefault("queryErrors", []).append(f"{term!r} p{pg}: {e}"); break
                    out["queries"] += 1
                    jp = res.get("jobPostings", [])
                    for j in jp:
                        if not j.get("externalPath"): continue
                        out["seen"] += 1
                        cands.setdefault(j["externalPath"], j)
                    if len(jp) < 20: break
                    time.sleep(1.5 if "rate-limit" in (t.get("notes") or "").lower() else 0.35)
                if "rate-limit" in (t.get("notes") or "").lower(): time.sleep(1.5)
        for path, j in cands.items():
            title = j.get("title", "")
            lane = lane_of(title)
            if not lane: continue
            a = age_days(j.get("postedOn"))
            if max_age is not None and a is not None and a > max_age: continue
            lt = j.get("locationsText", "")
            lc = loc_class(lt)
            multi = bool(re.match(r"\d+ locations", lt.lower()))
            if lc in ("other", "excluded-area") and not multi and not REMOTE_RE.search(lt) and not re.fullmatch(_JOBBI_POLICY.get("country_card_regex", r"(?!)"), lt.strip(), re.I):
                continue
            # Confirm with detail.
            try:
                d = detail(sess, t, path); out["queries"] += 1
            except Exception as e:
                out["dropped"].append({"title": title, "reason": f"detail error {e}", "path": path}); continue
            locs = [d.get("location", "")] + list(d.get("additionalLocations") or [])
            remote_type = d.get("remoteType") or ""
            classes = [loc_class(x) for x in locs]
            desc = strip_html(d.get("jobDescription", ""))
            body_remote = bool(re.search(r"(remote (role|position|opportunity|work)|(fully|100%) remote|this (role|position) (is|can be) (performed )?remote|work remotely)", desc, re.I))
            keep_loc = None
            if "home-area" in classes: keep_loc = "home-area"
            elif "remote-region" in classes: keep_loc = "remote-region"
            elif re.match(r"(remote|fully remote|virtual|work from home)", remote_type, re.I) and (d.get("country") or {}).get("descriptor", "").startswith(_JOBBI_POLICY.get("remote_country_prefix") or "__UNCONFIGURED__"): keep_loc = "remote-region"
            elif body_remote and all(not NON_US_RE.search(x) for x in locs) and (d.get("country") or {}).get("descriptor", "").startswith(_JOBBI_POLICY.get("remote_country_prefix") or "__UNCONFIGURED__"): keep_loc = "remote-region?"
            ctry = (d.get("country") or {}).get("descriptor", "")
            if keep_loc == "remote-region" and ctry and not ctry.startswith(_JOBBI_POLICY.get("remote_country_prefix") or "__UNCONFIGURED__") and not any(US_RE.search(x or "") for x in locs):
                keep_loc = None  # bare "Remote" on a non-US posting
            url = d.get("externalUrl") or f"https://{t['host']}/{t['site']}{path}"
            rec = {"company": t.get("company"), "tenant": t["tenant"], "title": title, "lane": lane,
                   "locations": locs, "remoteType": remote_type, "postedOn": j.get("postedOn"), "ageDays": a,
                   "startDate": d.get("startDate"), "reqId": d.get("jobReqId"), "url": url, "externalPath": path}
            if not keep_loc:
                rec["reason"] = "location not configured home area / remote region"; out["dropped"].append(rec); continue
            rec["geo"] = keep_loc
            clr = bool(CLEARANCE_RE.search(desc)) and not NO_CLEARANCE_RE.search(desc)
            rec["clearance"] = clr
            pays = [(money(a1), money(b1)) for a1, b1 in PAY_RE.findall(desc) + PAY_USD_RE.findall(desc)]
            pays = [p for p in pays if 40000 <= p[0] <= 1500000 and p[1] >= p[0]]
            rec["pay"] = f"${int(min(p[0] for p in pays)/1000)}K–${int(max(p[1] for p in pays)/1000)}K" if pays else None
            rec["payMax"] = max(p[1] for p in pays) if pays else None
            if clr and _JOBBI_POLICY.get("block_clearance", False):
                rec["reason"] = "clearance required"; out["dropped"].append(rec); continue
            if _JOBBI_POLICY.get("pay_floor") is not None and rec["payMax"] is not None and rec["payMax"] <= _JOBBI_POLICY["pay_floor"]:
                rec["reason"] = f"pay max {rec['pay']} is under the configured pay policy"; out["dropped"].append(rec); continue
            out["hits"].append(rec)
    except Exception as e:
        out["ok"] = False; out["error"] = str(e)
    return out

def verify(tenants):
    def one(t):
        try:
            r = post(requests.Session(), t, {"appliedFacets": {}, "limit": 1, "offset": 0, "searchText": _JOBBI_POLICY.get("verify_search_term", "")}, timeout=15)
            return t, f"OK total={r.get('total')}"
        except Exception as e:
            return t, f"FAIL {e}"
    with cf.ThreadPoolExecutor(16) as ex:
        for t, s in ex.map(one, tenants): print(f"{t.get('company'):<28} {t['host']:<45} {s}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-age", type=int, default=None)
    ap.add_argument("--only", default="")
    ap.add_argument("--pages", type=int, default=2)
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--verify", action="store_true")
    a = ap.parse_args()
    tenants = load_tenants()
    tenants = [t for t in tenants if t.get("status", "OK").upper().startswith("OK")]
    if a.only: tenants = [t for t in tenants if t["tenant"] in a.only.split(",")]
    if a.verify: verify(tenants); return
    started = dt.datetime.now()
    out_dir = a.out_dir or os.path.join(HERE, "workday", "runs", started.strftime("%Y-%m-%d-%H%M"))
    os.makedirs(out_dir, exist_ok=True)
    with cf.ThreadPoolExecutor(a.workers) as ex:
        results = list(ex.map(lambda t: sweep_tenant(t, SEARCH_TERMS, a.max_age, a.pages), tenants))
    hits = sorted([h for r in results for h in r["hits"]], key=lambda h: (h["ageDays"] if h["ageDays"] is not None else 99, h["company"]))
    summary = {"run": started.isoformat(timespec="seconds"), "elapsedSec": round((dt.datetime.now() - started).total_seconds(), 1),
               "tenants": len(tenants), "tenantsOk": sum(r["ok"] for r in results),
               "failures": [{"company": r["company"], "error": r["error"]} for r in results if not r["ok"]],
               "partial": [{"company": r["company"], "errors": len(r.get("queryErrors", []))} for r in results if r.get("queryErrors")],
               "queries": sum(r["queries"] for r in results), "hits": len(hits),
               "dropped": sum(len(r["dropped"]) for r in results)}
    json.dump({"summary": summary, "hits": hits, "perTenant": results}, open(os.path.join(out_dir, "workday-sweep.json"), "w"), indent=1)
    md = [f"# Workday enterprise sweep — {summary['run']} ({(_JOBBI_POLICY.get('timezone') or 'UTC')})", "",
          f"Tenants {summary['tenantsOk']}/{summary['tenants']} OK · {summary['queries']} requests · {summary['hits']} in-lane hits · {summary['dropped']} dropped (geo/clearance/pay) · {summary['elapsedSec']}s", ""]
    if summary["failures"]:
        md += ["## Failures", ""] + [f"- {f['company']}: {f['error']}" for f in summary["failures"]] + [""]
    md += ["## Hits", "", "| Company | Title | Lane | Location | Posted | Pay | Link |", "|---|---|---|---|---|---|---|"]
    for h in hits:
        loc = "; ".join(h["locations"])[:80] + (f" ({h['remoteType']})" if h["remoteType"] else "")
        md.append(f"| {h['company']} | {h['title']} | {h['lane']} | {loc} | {h['postedOn']} | {h['pay'] or '—'} | [link]({h['url']}) |")
    md += ["", "## Dropped after detail check", ""]
    for r in results:
        for d in r["dropped"]:
            md.append(f"- {r['company']}: {d['title']} — {d.get('reason')}")
    open(os.path.join(out_dir, "workday-sweep.md"), "w").write("\n".join(md) + "\n")
    print(json.dumps(summary, indent=1)); print("out:", out_dir)

if __name__ == "__main__":
    main()
