#!/usr/bin/env python3
"""Config-driven job sweep: one function per source type, all settings in sources.yaml.

  sweep.py                              # all enabled sources, window since the last sweep (or default_hours)
  sweep.py --hours 3 --sources ashby,greenhouse
  sweep.py --since 2026-01-05T18:00:00-08:00 --dry-run      # report only, DB untouched
  sweep.py --test-one ashby:acme        # one company / board, lane+geo matches over --hours (default 14 days), no DB writes
  sweep.py --test-source greenhouse:acme [--add]   # candidate source: 14-day lookback; --add appends it to sources.yaml if it produced lane matches

Pipeline per posting: window -> lane (title) -> exclude -> geo -> dedupe in jobs.db (URL, company+req, company+title)
-> new rows inserted as To Review (fit NULL; the evaluate step scores them) + a sighting for every match.
Writes runs/<run-id>/{report.json, candidates.md, raw/}. Re-renders jobs.md + active.md.
Network + stdlib + PyYAML only. Never sends anything; no auth except an optional USAJOBS_API_KEY.
"""
import argparse, concurrent.futures as cf, datetime as dt, html, json, os, re, subprocess, sys, time
import urllib.error, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pydantic import ValidationError
import yaml
from pipeline import home as H
from pipeline import jobsdb as J
from pipeline import schema as SC

HERE = J.HERE
CFG_PATH = str(H.path("sources_file"))
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
UTC = dt.timezone.utc

# ------------------------------------------------------------------ http
def http(url, data=None, headers=None, timeout=30):
    h = {"User-Agent": UA, "Accept": "application/json, text/html;q=0.9, */*;q=0.8"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            out = r.status, r.read()
    except urllib.error.HTTPError as e:
        try: out = e.code, e.read()
        except Exception: out = e.code, b""
    except Exception as e:
        out = -1, str(e).encode()[:300]
    if RECORD is not None:   # fixture capture for offline tests (SWEEP_RECORD=<file>)
        with RECORD_LOCK:
            RECORD.append({"url": url, "status": out[0], "body": out[1].decode("utf-8", "replace")})
    return out

RECORD = [] if os.environ.get("SWEEP_RECORD") else None
RECORD_LOCK = __import__("threading").Lock()

def jget(url, **kw):
    code, body = http(url, **kw)
    if code != 200:
        return code, None
    try:
        return code, json.loads(body)
    except Exception:
        return code, None

def parse_dt(v):
    if v in (None, ""): return None
    if isinstance(v, (int, float)):
        v = v / 1000 if v > 1e12 else v
        return dt.datetime.fromtimestamp(v, tz=UTC)
    s = str(v).strip()
    s = re.sub(r":\d$", "", s) if re.search(r"\d\d:\d\d:\d\d:\d$", s) else s   # NeoGov "00:00:00:0"
    try:
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=UTC)
    except Exception:
        pass
    try:
        return parsedate_to_datetime(s).astimezone(UTC)
    except Exception:
        pass
    m = re.match(r"(\d{4}-\d{2}-\d{2})", s)
    if m: return dt.datetime.fromisoformat(m.group(1)).replace(tzinfo=UTC)
    return None

def strip_html(s):
    s = re.sub(r"(?is)<(script|style).*?</\1>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()

PAY_RE = re.compile(r"\$\s?\d{2,3}(?:,\d{3})+(?:\.\d+)?\s*(?:-|–|—|to)\s*\$?\s?\d{2,3}(?:,\d{3})+|\$\s?\d{2,3}(?:\.\d)?\s?[kK]\s*(?:-|–|—|to)\s*\$?\s?\d{2,3}(?:\.\d)?\s?[kK]")
def pay_from(text):
    m = PAY_RE.search(text or "")
    return m.group(0).replace("  ", " ") if m else None

def P(source, company, title, location, url, posted, pay=None, req=None, tag=None, extra=None):
    return {"source": source, "company": (company or "").strip(), "title": (title or "").strip(), "location": (location or "").strip(),
            "url": url, "posted_at": posted.isoformat() if isinstance(posted, dt.datetime) else posted, "pay": pay, "req": req,
            "tag": tag, "extra": extra or {}}

# ------------------------------------------------------------------ board name cache (Ashby/GH APIs don't always give the company name)
NAMES_PATH = os.path.join(J.STATE, "board-names.json")
def load_names():
    try: return json.load(open(NAMES_PATH))
    except Exception: return {}
NAMES = load_names()

def board_name(vendor, slug, given=None):
    if given: return given
    k = f"{vendor}:{slug}"
    if k in NAMES: return NAMES[k]
    name = None
    if vendor == "greenhouse":
        _, d = jget(f"https://boards-api.greenhouse.io/v1/boards/{slug}")
        name = (d or {}).get("name")
    elif vendor == "ashby":
        code, b = http(f"https://jobs.ashbyhq.com/{slug}")
        m = re.search(rb"<title>([^<]+?) Jobs?\s*</title>", b or b"")
        name = m.group(1).decode("utf-8", "replace").strip() if m else None
    elif vendor == "lever":
        code, b = http(f"https://jobs.lever.co/{slug}")
        m = re.search(rb"<title>([^<]+?)</title>", b or b"")
        name = m.group(1).decode("utf-8", "replace").strip() if m else None
    name = name or slug.replace("-", " ").title()
    NAMES[k] = name
    return name

# ------------------------------------------------------------------ fetchers: each returns (postings, stats)
def _stats(): return {"requests": 0, "ok": 0, "failed": 0, "fetched": 0, "gap": None, "errors": []}

def fetch_ashby(boards, since, ctx):
    st, out = _stats(), []
    def one(b):
        code, d = jget(f"https://api.ashbyhq.com/posting-api/job-board/{b['slug']}?includeCompensation=true", timeout=40)
        return b, code, d
    with cf.ThreadPoolExecutor(8) as ex:
        for b, code, d in ex.map(one, boards):
            st["requests"] += 1
            if code != 200 or d is None:
                st["failed"] += 1; st["errors"].append(f"{b['slug']}:{code}"); continue
            st["ok"] += 1
            for j in d.get("jobs", []):
                st["fetched"] += 1
                if j.get("isListed") is False: continue
                locs = [j.get("location") or ""] + [x.get("location", "") for x in (j.get("secondaryLocations") or []) if isinstance(x, dict)]
                if j.get("isRemote") and "remote" not in " ".join(locs).lower(): locs.append("Remote")
                comp = (j.get("compensation") or {}).get("compensationTierSummary")
                out.append(P("ats:ashby", (b.get("company") or b.get("name") or b["slug"]), j.get("title"), "; ".join(x for x in locs if x), j.get("jobUrl"),
                             parse_dt(j.get("publishedAt")), pay=comp or pay_from(j.get("descriptionPlain")), tag=b.get("tag"),
                             extra={"vendor": "ashby", "slug": b["slug"]}))
    return out, st

def fetch_greenhouse(boards, since, ctx):
    st, out = _stats(), []
    def one(b):
        code, d = jget(f"https://boards-api.greenhouse.io/v1/boards/{b['slug']}/jobs", timeout=40)
        return b, code, d
    with cf.ThreadPoolExecutor(8) as ex:
        for b, code, d in ex.map(one, boards):
            st["requests"] += 1
            if code != 200 or d is None:
                st["failed"] += 1; st["errors"].append(f"{b['slug']}:{code}"); continue
            st["ok"] += 1
            for j in d.get("jobs", []):
                st["fetched"] += 1
                out.append(P("ats:greenhouse", (b.get("company") or b.get("name") or b["slug"]), j.get("title"), (j.get("location") or {}).get("name"),
                             j.get("absolute_url"), parse_dt(j.get("first_published") or j.get("updated_at")), req=str(j.get("requisition_id") or "") or None,
                             tag=b.get("tag"), extra={"vendor": "greenhouse", "slug": b["slug"], "id": j.get("id")}))
    return out, st

def enrich_greenhouse(p):
    """detail call for matched GH postings only: pay text"""
    _, d = jget(f"https://boards-api.greenhouse.io/v1/boards/{p['extra']['slug']}/jobs/{p['extra']['id']}?pay_transparency=true")
    if d:
        txt = strip_html(html.unescape(d.get("content") or ""))
        pr = d.get("pay_input_ranges") or []
        if pr:
            p["pay"] = "; ".join(f"${int(r.get('min_cents',0))//100:,}–${int(r.get('max_cents',0))//100:,} {r.get('title','')}".strip() for r in pr)
        else:
            p["pay"] = pay_from(txt)

def fetch_lever(boards, since, ctx):
    st, out = _stats(), []
    def one(b):
        code, d = jget(f"https://api.lever.co/v0/postings/{b['slug']}?mode=json", timeout=40)
        return b, code, d
    with cf.ThreadPoolExecutor(8) as ex:
        for b, code, d in ex.map(one, boards):
            st["requests"] += 1
            if code != 200 or not isinstance(d, list):
                st["failed"] += 1; st["errors"].append(f"{b['slug']}:{code}"); continue
            st["ok"] += 1
            for j in d:
                st["fetched"] += 1
                cat = j.get("categories") or {}
                locs = [cat.get("location") or ""] + list(cat.get("allLocations") or [])
                if (j.get("workplaceType") or "") == "remote": locs.append("Remote")
                sr = j.get("salaryRange") or {}
                pay = f"${sr.get('min'):,}–${sr.get('max'):,}" if sr.get("min") and sr.get("max") else pay_from(j.get("descriptionPlain"))
                out.append(P("ats:lever", (b.get("company") or b.get("name") or b["slug"]), j.get("text"), "; ".join(dict.fromkeys(x for x in locs if x)), j.get("hostedUrl"),
                             parse_dt(j.get("createdAt")), pay=pay, tag=b.get("tag"), extra={"vendor": "lever", "slug": b["slug"]}))
    return out, st

def fetch_smartrecruiters(boards, since, ctx, source="ats:smartrecruiters"):
    st, out = _stats(), []
    for b in boards:
        offset = 0
        while True:
            st["requests"] += 1
            code, d = jget(f"https://api.smartrecruiters.com/v1/companies/{b['slug']}/postings?limit=100&offset={offset}", timeout=40)
            if code != 200 or d is None:
                st["failed"] += 1; st["errors"].append(f"{b['slug']}:{code}"); break
            st["ok"] += 1
            content = d.get("content", [])
            stop = False
            for j in content:
                st["fetched"] += 1
                posted = parse_dt(j.get("releasedDate"))
                loc = j.get("location") or {}
                ctry = (loc.get("country") or "").lower()
                locs = ", ".join(x for x in [loc.get("city"), loc.get("region"), "US" if ctry == "us" else (f"{ctry.upper()} (non-US)" if ctry else "")] if x)
                if loc.get("remote"): locs += "; Remote"
                out.append(P(source, (j.get("company") or {}).get("name") or (b.get("company") or b.get("name") or b["slug"]), j.get("name"), locs,
                             f"https://jobs.smartrecruiters.com/{b['slug']}/{j.get('id')}", posted, req=j.get("refNumber"),
                             tag=b.get("tag"), extra={"vendor": "smartrecruiters", "slug": b["slug"]}))
                if posted and posted < since - dt.timedelta(days=30): stop = True
            offset += 100
            if stop or offset >= d.get("totalFound", 0) or offset >= 1000: break
            time.sleep(0.3)
    return out, st

def fetch_workday(cfg, since, ctx):
    st = _stats()
    # Workday has no public JSON board API that works the same on every tenant; the sweep calls a separate script you
    # provide (sources.yaml sources.workday.script, relative to the data folder). It must accept
    # --max-age N --out-dir DIR [--only TENANT] and write DIR/workday-sweep.json ({"summary": {...}, "hits": [...]}).
    if not cfg.get("script"):
        st["gap"] = "workday: no script configured (sources.yaml sources.workday.script); skipped"
        return [], st
    script = cfg["script"] if os.path.isabs(cfg["script"]) else str(H.home() / cfg["script"])
    if not os.path.exists(script):
        st["failed"] = 1; st["gap"] = f"workday script not found: {script}"; return [], st
    monday_am = dt.datetime.now().weekday() == 0 and dt.datetime.now().hour < 10
    age = cfg.get("max_age_days_monday", 3) if monday_am else cfg.get("max_age_days", 1)
    age = max(age, (dt.datetime.now(UTC) - since).days + 1)
    out_dir = os.path.join(ctx["run_dir"], "raw", "workday")
    cmd = [sys.executable, script, "--max-age", str(age), "--out-dir", out_dir]
    if ctx.get("only"): cmd += ["--only", ctx["only"]]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    st["requests"] = 1
    try:
        d = json.load(open(os.path.join(out_dir, "workday-sweep.json")))
    except Exception:
        st["failed"] = 1; st["gap"] = f"workday script failed: {r.stderr[-300:]}"; return [], st
    s = d.get("summary", {})
    st.update(ok=s.get("tenantsOk", 0), failed=len(s.get("failures", [])), fetched=s.get("hits", 0) + s.get("dropped", 0),
              requests=s.get("queries", 0))
    out = []
    for h in d.get("hits", []):
        posted = parse_dt(h.get("startDate")) if h.get("startDate") else dt.datetime.now(UTC) - dt.timedelta(days=h.get("ageDays") or 0)
        out.append(P("workday", h.get("company"), h.get("title"), "; ".join(h.get("locations") or []) + (f" ({h['remoteType']})" if h.get("remoteType") else ""),
                     h.get("url"), posted, pay=h.get("pay"), req=h.get("reqId"),
                     extra={"vendor": "workday", "age_days": h.get("ageDays"), "posted_on": h.get("postedOn"), "prefiltered": True}))
    return out, st

def fetch_linkedin_guest(cfg, since, ctx):
    st, out, seen = _stats(), [], {}
    base = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
    secs = int((dt.datetime.now(UTC) - since).total_seconds()) + 600
    card_re = re.compile(r"<li>(.*?)</li>", re.S)
    txt = lambda s: html.unescape(re.sub(r"<[^>]+>", " ", s or "")).strip()
    for q in cfg.get("queries", []):
        for start in range(0, 10 * cfg.get("pages", 10), 10):
            params = {"keywords": q["q"], "geoId": q["geo_id"], "f_TPR": f"r{secs}", "sortBy": "DD", "start": str(start)}
            if q.get("remote"): params["f_WT"] = "2"
            code, body = http(base + "?" + urllib.parse.urlencode(params), headers={"Accept": "text/html"})
            st["requests"] += 1
            if code == 429:
                st["failed"] += 1; st["errors"].append(f"{q['id']}@{start}:429"); time.sleep(8); break
            if code != 200:
                st["failed"] += 1; st["errors"].append(f"{q['id']}@{start}:{code}"); break
            st["ok"] += 1
            b = body.decode("utf-8", "replace")
            n = 0
            for li in card_re.findall(b):
                m = re.search(r"urn:li:jobPosting:(\d+)", li)
                if not m: continue
                n += 1; st["fetched"] += 1
                jid = m.group(1)
                if jid in seen: continue
                t = re.search(r"base-search-card__title[^>]*>(.*?)</h3>", li, re.S)
                c = re.search(r"base-search-card__subtitle[^>]*>(.*?)</h4>", li, re.S)
                l = re.search(r"job-search-card__location[^>]*>(.*?)</span>", li, re.S)
                d = re.search(r'<time[^>]*datetime="([^"]+)"[^>]*>(.*?)</time>', li, re.S)
                sal = re.search(r"job-search-card__salary-info[^>]*>(.*?)</span>", li, re.S)
                loc = txt(l.group(1)) if l else ""
                if q.get("remote") and "remote" not in loc.lower(): loc += " (Remote filter)"
                p = P("li:guest", txt(c.group(1)) if c else "", txt(t.group(1)) if t else "", loc,
                      f"https://www.linkedin.com/jobs/view/{jid}", parse_dt(d.group(1)) if d else None,
                      pay=txt(sal.group(1)) if sal else None, extra={"li_id": jid, "age": txt(d.group(2)) if d else "", "query": q["id"], "date_only": True})
                seen[jid] = p; out.append(p)
            time.sleep(cfg.get("pace_seconds", 1.05))
            if n < 10: break
    return out, st

def fetch_gov(cfg, since, ctx):
    st, out = _stats(), []
    gaps = []
    u = cfg.get("usajobs", {})
    if u.get("enabled"):
        key = os.environ.get(u.get("api_key_env", "USAJOBS_API_KEY"))
        if not key:
            gaps.append("USAJobs: no USAJOBS_API_KEY set -> skipped (Gap)")
        else:
            ua = os.environ.get(u.get("user_agent_env", "USAJOBS_USER_AGENT"), "")
            for kw in u.get("keywords", []):
                for loc in (u.get("location") or "").split(";") or [""]:
                    qs = urllib.parse.urlencode({"Keyword": kw, "LocationName": loc, "DatePosted": u.get("date_posted_days", 2), "ResultsPerPage": 100})
                    code, d = jget("https://data.usajobs.gov/api/search?" + qs, headers={"Authorization-Key": key, "User-Agent": ua, "Host": "data.usajobs.gov"})
                    st["requests"] += 1
                    if code != 200 or not d:
                        st["failed"] += 1; st["errors"].append(f"usajobs:{kw}:{code}"); continue
                    st["ok"] += 1
                    for it in (d.get("SearchResult") or {}).get("SearchResultItems", []):
                        j = it.get("MatchedObjectDescriptor", {}); st["fetched"] += 1
                        rem = (j.get("PositionRemuneration") or [{}])[0]
                        out.append(P("gov:usajobs", j.get("OrganizationName") or j.get("DepartmentName"), j.get("PositionTitle"),
                                     j.get("PositionLocationDisplay"), j.get("PositionURI"), parse_dt(j.get("PublicationStartDate")),
                                     pay=f"${rem.get('MinimumRange')}–${rem.get('MaximumRange')}" if rem else None, req=j.get("PositionID"),
                                     extra={"public_sector": True}))
                    time.sleep(0.5)
    c = cfg.get("calcareers", {})
    if c.get("enabled"):
        code, b = http(c["url"]); st["requests"] += 1
        ids = re.findall(rb"JobControlId=(\d+)", b or b"")
        if code == 200 and ids:
            st["ok"] += 1
            gaps.append(f"CalCareers: page returned {len(set(ids))} job links but no structured search; use browser for keyword search")
        else:
            st["failed"] += 1
            gaps.append(f"CalCareers: HTTP {code}, no job links (ASP.NET postback / JS wall) -> Gap; check in browser if needed")
    n = cfg.get("neogov", {})
    for a in (n.get("agencies") or []) if n.get("enabled") else []:
        code, b = http(f"https://www.governmentjobs.com/SearchEngine/JobsFeed?agency={a['slug']}", headers={"Accept": "application/rss+xml, text/xml"})
        st["requests"] += 1
        if code != 200:
            st["failed"] += 1; st["errors"].append(f"neogov:{a['slug']}:{code}"); continue
        try:
            root = ET.fromstring(b)
        except Exception:
            st["failed"] += 1; st["errors"].append(f"neogov:{a['slug']}:xml"); continue
        st["ok"] += 1
        ns = "{http://www.neogov.com/namespaces/JobListing}"
        agency = (root.findtext("./channel/title") or a.get("name") or a["slug"]).strip()
        for it in root.iter("item"):
            st["fetched"] += 1
            adv = it.findtext(f"{ns}advertiseFromDate")
            lo, hi = it.findtext(f"{ns}minimumSalary"), it.findtext(f"{ns}maximumSalary")
            pay = None
            try:
                if lo and hi: pay = f"${float(lo):,.0f}–${float(hi):,.0f} {it.findtext(f'{ns}salaryInterval') or ''}".strip()
            except Exception: pass
            loc = (it.findtext(f"{ns}location") or a.get("name") or "") + (f", {a['state']}" if a.get("state") else "")
            out.append(P("gov:neogov", agency, it.findtext("title"), loc, it.findtext("link"), parse_dt(adv) or parse_dt(it.findtext("pubDate")),
                         pay=pay, req=it.findtext(f"{ns}jobNumberSingle"), extra={"public_sector": True}))
        time.sleep(0.3)
    srg = cfg.get("smartrecruiters_gov", {})
    if srg.get("enabled"):
        o, s2 = fetch_smartrecruiters(srg.get("boards", []), since, ctx, source="gov:smartrecruiters")
        for p in o: p["extra"]["public_sector"] = True
        out += o
        for k in ("requests", "ok", "failed", "fetched"): st[k] += s2[k]
        st["errors"] += s2["errors"]
    st["gap"] = "; ".join(gaps) or None
    return out, st

def fetch_hn(cfg, since, ctx):
    """HN 'Who is hiring?' -> company LEADS (not rows) + detected ATS boards to propose."""
    st = _stats()
    code, d = jget("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=hiring&hitsPerPage=10")
    st["requests"] += 1
    stories = [h for h in (d or {}).get("hits", []) if "who is hiring" in (h.get("title") or "").lower()]
    if not stories:
        st["failed"] += 1; st["gap"] = f"HN: no Who-is-hiring thread found (HTTP {code})"; return [], st
    st["ok"] += 1
    leads = []
    for s in stories[: cfg.get("months", 1)]:
        page = 0
        while page < 10:
            qs = urllib.parse.urlencode({"tags": f"comment,story_{s['objectID']}", "numericFilters": f"created_at_i>{int(since.timestamp())}", "hitsPerPage": 1000, "page": page})
            code, c = jget("https://hn.algolia.com/api/v1/search_by_date?" + qs)
            st["requests"] += 1
            if not c: st["failed"] += 1; break
            for h in c.get("hits", []):
                if str(h.get("parent_id")) != str(s["objectID"]): continue   # top-level only
                st["fetched"] += 1
                text = strip_html(h.get("comment_text") or "")
                first = text.split("  ")[0][:200]
                boards = sorted(set(re.findall(r"(jobs\.ashbyhq\.com/[\w.-]+|boards\.greenhouse\.io/[\w.-]+|job-boards\.greenhouse\.io/[\w.-]+|jobs\.lever\.co/[\w.-]+|jobs\.smartrecruiters\.com/[\w.-]+|[\w-]+\.wd\d+\.myworkdayjobs\.com/[\w./-]+)", h.get("comment_text") or "")))
                leads.append({"company": first.split("|")[0].strip(), "header": first, "boards": boards,
                              "url": f"https://news.ycombinator.com/item?id={h.get('objectID')}", "posted": h.get("created_at"), "text": text[:1500]})
            if page + 1 >= c.get("nbPages", 1): break
            page += 1
    ctx["hn_leads"] = leads
    return [], st

def _next_data_jobs(h):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
    if not m: return None
    d = json.loads(m.group(1))
    def find(o):
        if isinstance(o, dict):
            if isinstance(o.get("jobs"), dict) and "found" in o["jobs"]: return o["jobs"]
            for v in o.values():
                r = find(v)
                if r: return r
        elif isinstance(o, list):
            for v in o:
                r = find(v)
                if r: return r
    return find(d)

def fetch_getro(cfg, since, ctx):
    st, out = _stats(), []
    for b in cfg.get("boards", []):
        for q in cfg.get("queries", []):
            code, body = http(f"https://{b['host']}/jobs?q={urllib.parse.quote(q)}", headers={"Accept": "text/html"}, timeout=40)
            st["requests"] += 1
            j = _next_data_jobs(body.decode("utf-8", "replace")) if code == 200 else None
            if not j:
                st["failed"] += 1; st["errors"].append(f"{b['firm']}:{q}:{code}"); continue
            st["ok"] += 1
            for x in j.get("found", []):
                st["fetched"] += 1
                org = x.get("organization") or {}
                lo, hi = x.get("compensationAmountMinCents"), x.get("compensationAmountMaxCents")
                out.append(P(f"vc:{b['firm']}", org.get("name"), x.get("title"), "; ".join(x.get("locations") or []) + ("; Remote" if (x.get("workMode") or "") == "remote" else ""),
                             x.get("url"), parse_dt(x.get("createdAt")), pay=f"${lo//100:,}–${hi//100:,}" if lo and hi else None,
                             extra={"stage": org.get("stage"), "headcount": org.get("headCount")}))
            time.sleep(1)
    return out, st

def fetch_a16z(cfg, since, ctx):
    st, out, seen = _stats(), [], set()
    dec = json.JSONDecoder()
    for q in cfg.get("queries", []):
        code, b = http(f"https://jobs.a16z.com/jobs?q={urllib.parse.quote(q)}", headers={"RSC": "1"}, timeout=40)
        st["requests"] += 1
        if code != 200:
            st["failed"] += 1; st["errors"].append(f"{q}:{code}"); continue
        st["ok"] += 1
        t = b.decode("utf-8", "replace")
        for m in re.finditer(r'\{"id":"ats:', t):
            try: o, _ = dec.raw_decode(t, m.start())
            except Exception: continue
            if o["id"] in seen: continue
            seen.add(o["id"]); st["fetched"] += 1
            comp = o.get("company") if isinstance(o.get("company"), dict) else {}
            out.append(P("vc:a16z", o.get("company_name") or comp.get("name"), o.get("title"),
                         str(o.get("location") or "") + ("; Remote" if (o.get("workplace_type") or "").lower() == "remote" else ""),
                         o.get("apply_url") or o.get("url"), parse_dt(o.get("posted_at")),
                         pay=f"${o.get('salary_min')}–${o.get('salary_max')}" if o.get("salary_min") else None,
                         extra={"stage": (o.get("funding_stage") or {}).get("label") if isinstance(o.get("funding_stage"), dict) else None}))
        time.sleep(1)
    return out, st

FETCHERS = {
    "ashby": lambda c, s, x: fetch_ashby(c.get("boards", []), s, x),
    "greenhouse": lambda c, s, x: fetch_greenhouse(c.get("boards", []), s, x),
    "lever": lambda c, s, x: fetch_lever(c.get("boards", []), s, x),
    "smartrecruiters": lambda c, s, x: fetch_smartrecruiters(c.get("boards", []), s, x),
    "workday": fetch_workday,
    "linkedin_guest": fetch_linkedin_guest,
    "gov": fetch_gov,
    "hn_whos_hiring": fetch_hn,
    "getro": fetch_getro,
    "a16z": fetch_a16z,
}
BOARD_SOURCES = {"ashby", "greenhouse", "lever", "smartrecruiters"}

# ------------------------------------------------------------------ filtering
class Filters:
    def __init__(self, cfg):
        self.lanes = {k: [re.compile(r, re.I) for r in v] for k, v in cfg["lanes"].items()}
        self.excl = [re.compile(r, re.I) for r in cfg.get("exclude_title", [])]
        self.excl_co = [re.compile(r, re.I) for r in cfg.get("exclude_company", [])]
        g = cfg["geo"]
        self.g_in = [re.compile(r, re.I) for r in g["include"]]
        self.g_ex = [re.compile(r, re.I) for r in g["exclude"]]
        self.g_rem = [re.compile(r, re.I) for r in g["remote_us"]]
        self.g_non = [re.compile(r, re.I) for r in g["non_us"]]
        self.unknown_keep = g.get("unknown_location", "keep") == "keep"
        self.remote_cards_keep = g.get("remote_filter_cards", "verify") == "verify"

    def company_ok(self, company):
        return not any(r.search(company or "") for r in self.excl_co)

    def lane(self, title):
        t = title or ""
        for name, rxs in self.lanes.items():
            if any(r.search(t) for r in rxs):
                if any(r.search(t) for r in self.excl) and not re.search(r"technical program|forward deployed", t, re.I):
                    return None, "excluded title"
                return name, None
        return None, "no lane keyword"

    def geo(self, loc, p=None):
        l = loc or ""
        parts = [x.strip() for x in re.split(r";|\|", l) if x.strip()] or [""]
        reasons = []
        foreign_any = any(r.search(l) for r in self.g_non)
        us_any = bool(re.search(r"united states|\busa?\b|u\.s\.|, (?:ca|ny|wa|tx|ma|co|il|or|ga|fl|va|nc|az|ut|mn|dc)\b|remote filter", l, re.I))
        for part in parts:
            if not part:
                continue
            if any(r.search(part) for r in self.g_in) and not any(r.search(part) for r in self.g_ex):
                return "local", None
            if any(r.search(part) for r in self.g_rem) and not any(r.search(part) for r in self.g_non):
                if re.fullmatch(r"\s*remote\s*", part, re.I) and foreign_any and not us_any:
                    reasons.append(part); continue
                return "remote-us", None
            if re.fullmatch(r"(?:united states|usa|us|u\.s\.?a?\.?)", part, re.I):
                return "us-unspecified", None
            reasons.append(part)
        if not l.strip():
            return ("unknown", None) if self.unknown_keep else (None, "no location")
        if "(Remote filter)" in l and not any(r.search(l) for r in self.g_non) and self.remote_cards_keep:
            # job-board remote-filter card naming an out-of-area city: never dropped for the city alone; the filter is
            # unreliable, so scoring must verify remote from the JD / ATS location (score.py --remote)
            return "remote-unverified", None
        return None, "geo: " + l[:60]

def in_window(p, since):
    if p["extra"].get("prefiltered"):
        return True
    d = parse_dt(p["posted_at"])
    if d is None:
        return False
    if p["extra"].get("date_only"):
        return True   # LinkedIn cards carry a date only; f_TPR bounds the window server-side
    return d >= since

# ------------------------------------------------------------------ main run
def last_sweep_end(c):
    r = c.execute("SELECT window_end FROM runs WHERE kind='sweep' AND dry_run=0 ORDER BY window_end DESC LIMIT 1").fetchone()
    return parse_dt(r[0]) if r else None

def company_in_play(c, company):
    rows = c.execute("SELECT status, title FROM jobs WHERE company_key=? AND status IN ('Interested','Packaged','Applied','Interviewing','Offer','Held')",
                     (J.company_key(company),)).fetchall()
    return "; ".join(f"{r['status']}: {r['title'][:50]}" for r in rows[:3])

def run(args):
    raw_cfg = yaml.safe_load(open(CFG_PATH))
    cfg, cfg_errors = SC.validate_sources(raw_cfg)   # bad entries are skipped with a clear error; never a crash
    for e in cfg_errors:
        print("sources.yaml: skipped entry ->", e, file=sys.stderr)
    flt = Filters(cfg)
    now = dt.datetime.now(UTC)
    c = J.connect()
    if args.since:
        since = parse_dt(args.since)
    elif args.hours:
        since = now - dt.timedelta(hours=args.hours)
    else:
        le = last_sweep_end(c)
        since = (le - dt.timedelta(minutes=cfg["window"].get("overlap_minutes", 15))) if le else now - dt.timedelta(hours=cfg["window"]["default_hours"])
    until = parse_dt(args.until) if args.until else now
    run_id = args.run_id or ("sweep-" + dt.datetime.now().strftime("%Y-%m-%d-%H%M%S") + ("-dry" if args.dry_run else ""))
    run_dir = os.path.join(str(H.path("runs_dir")), run_id)
    os.makedirs(os.path.join(run_dir, "raw"), exist_ok=True)
    ctx = {"run_dir": run_dir, "only": args.only}

    srcs = cfg["sources"]
    wanted = [s for s in FETCHERS if srcs.get(s, {}).get("enabled")]
    if args.sources:
        wanted = [s for s in args.sources.split(",") if s in FETCHERS]
    single = None
    if args.test_one or args.test_source:
        spec = args.test_one or args.test_source
        vendor, slug = spec.split(":", 1)
        if vendor not in FETCHERS:
            sys.exit(f"unknown source type {vendor}; types: {', '.join(FETCHERS)}")
        single = vendor
        wanted = [vendor]
        if vendor in BOARD_SOURCES:
            srcs = dict(srcs); srcs[vendor] = {"enabled": True, "boards": [{"slug": slug}]}
        elif vendor == "workday":
            ctx["only"] = slug
        elif vendor == "gov":
            g = dict(srcs["gov"]); ag = [a for a in g["neogov"]["agencies"] if a["slug"] == slug] or [{"slug": slug, "name": slug}]
            g["neogov"] = {**g["neogov"], "agencies": ag}; srcs = dict(srcs); srcs["gov"] = g
        elif vendor == "getro":
            g = dict(srcs["getro"]); g["boards"] = [b for b in g["boards"] if b["firm"] == slug or b["host"] == slug] or [{"firm": slug, "host": slug}]
            g["queries"] = g["queries"][:3]; srcs = dict(srcs); srcs["getro"] = g
        elif vendor == "linkedin_guest":
            g = dict(srcs["linkedin_guest"]); g["queries"] = [q for q in g["queries"] if q["id"] == slug][:1] or g["queries"][:1]
            g["pages"] = 2; srcs = dict(srcs); srcs["linkedin_guest"] = g
        elif vendor == "a16z":
            g = dict(srcs["a16z"]); g["queries"] = [slug]; srcs = dict(srcs); srcs["a16z"] = g
        if not (args.since or args.hours):
            since = now - dt.timedelta(days=14)
    dry = args.dry_run or bool(single)

    report = {"run_id": run_id, "started": J.now_iso(), "window_start": since.astimezone().isoformat(timespec="seconds"),
              "window_end": until.astimezone().isoformat(timespec="seconds"), "dry_run": dry, "sources": {}, "new": [], "existing": [], "gaps": [],
              "config_errors": cfg_errors, "rejected": [], "health": {}}
    hcfg = cfg.get("health") or {}
    matched_all = []
    for s in wanted:
        t0 = time.time()
        posts, st = fetch_with_retry(s, FETCHERS[s], srcs.get(s, {}), since, ctx, hcfg)
        attempts = st["attempts"]
        json.dump(posts, open(os.path.join(run_dir, "raw", f"{s}.json"), "w"), indent=0, default=str)
        win = [p for p in posts if in_window(p, since) and (parse_dt(p["posted_at"]) or until) <= until + dt.timedelta(minutes=5)]
        lane_ok, rej = [], {}
        for p in win:
            ln, why = flt.lane(p["title"])
            if ln and not flt.company_ok(p.get("company")):
                ln, why = None, "excluded company"
            if not ln:
                rej[why] = rej.get(why, 0) + 1; continue
            g, why = flt.geo(p["location"], p)
            if not g:
                rej["geo"] = rej.get("geo", 0) + 1; continue
            p["lane"], p["geo"] = ln, g
            lane_ok.append(p)
        for p in lane_ok:
            if p["extra"].get("vendor") == "greenhouse":
                enrich_greenhouse(p)
            if p["extra"].get("vendor") in ("ashby", "greenhouse", "lever") and p["extra"].get("slug"):
                p["company"] = board_name(p["extra"]["vendor"], p["extra"]["slug"], p["company"] if p["company"] != p["extra"]["slug"] else None)
        st.update(in_window=len(win), matched=len(lane_ok), rejected=rej, seconds=round(time.time() - t0, 1))
        st["health_status"] = "broken" if source_failed(st) and attempts > 1 else "failed" if source_failed(st) else \
                              "empty" if not st.get("fetched") and s != "hn_whos_hiring" else "ok"
        if s == "hn_whos_hiring" and not source_failed(st): st["health_status"] = "ok"
        st["errors"] = st["errors"][:15]
        report["sources"][s] = st
        if st.get("gap"): report["gaps"].append(st["gap"])
        if st.get("failed"): report["gaps"].append(f"{s}: {st['failed']} failed requests ({', '.join(st['errors'][:6])})")
        matched_all += lane_ok
    os.makedirs(os.path.dirname(NAMES_PATH), exist_ok=True)
    json.dump(NAMES, open(NAMES_PATH, "w"), indent=1)

    # ---- dedupe + write
    lock = J.locked() if not dry else _null()
    with lock:
        if not dry:
            c, rec = J.open_for_write()
            report["reconcile"] = rec
        seen_run = set()
        for p in matched_all:
            key = (J.company_key(p["company"]), J.title_key(p["title"]))
            ex = J.find(c, p["company"], p["title"], p["url"], p.get("req"))
            item = {"source": p["source"], "company": p["company"], "title": p["title"], "lane": p["lane"], "geo": p["geo"],
                    "location": p["location"], "pay": p["pay"], "posted_at": p["posted_at"], "url": p["url"], "tag": p.get("tag"),
                    "in_play": company_in_play(c, p["company"]), "public_sector": bool(p["extra"].get("public_sector")),
                    "stage": p["extra"].get("stage")}
            if ex:
                item.update(id=ex["id"], status=ex["status"], fit=ex["fit"])
                report["existing"].append(item)
                if not dry: J.add_sighting(c, ex["id"], run_id, p["source"], p["url"])
                continue
            if key in seen_run:
                continue
            try:
                rec_ok = SC.record_from_posting(p)
            except ValidationError as e:
                why = SC.explain(e)
                report["rejected"].append({"source": p["source"], "company": p["company"], "title": p["title"], "url": p["url"], "reason": why})
                if not dry: J.add_rejected(c, run_id, p, why)
                continue
            seen_run.add(key)
            report["new"].append(item)
            if not dry:
                note = f"[sweep {run_id}] {p['location']}" + (f" · {p['pay']}" if p["pay"] else "") + (f" · posted {p['posted_at'][:16]}" if p["posted_at"] else "") + \
                       (f" · {p['tag']}" if p.get("tag") else "") + (" · public sector" if item["public_sector"] else "") + \
                       (f" · company in play ({item['in_play']})" if item["in_play"] else "") + f" · {p['url']} · src {p['source']}"
                try:
                    jid = J.insert_job(c, company=p["company"], title=p["title"], source=p["source"], lane=p["lane"], url=p["url"], req_id=p.get("req"),
                                       location=p["location"], pay_text=p["pay"], posted_at=p["posted_at"], notes=note, by=run_id,
                                       source_detail=p.get("tag"))
                    J.add_sighting(c, jid, run_id, p["source"], p["url"])
                    if p.get("tag") and p["tag"] != p["source"]:
                        J.add_sighting(c, jid, run_id, p["tag"], p["url"])
                    item["id"] = jid
                except Exception as e:
                    report["gaps"].append(f"insert failed {p['company']} | {p['title']}: {e}")
        report["ended"] = J.now_iso()
        if not dry:
            c.execute("INSERT OR REPLACE INTO runs VALUES (?,?,?,?,?,?,?,?)", (run_id, "sweep", report["started"], report["ended"],
                      report["window_start"], until.isoformat(), 0, json.dumps({"new": len(report["new"]), "existing": len(report["existing"])})))
            for s, st in report["sources"].items():
                c.execute("INSERT INTO run_sources VALUES (?,?,?,?,?,?,?,?,?,?)", (run_id, s, st.get("requests"), st.get("ok"), st.get("failed"),
                          st.get("fetched"), st.get("in_window"), st.get("matched"), sum(1 for n in report["new"] if _src_type(n["source"]) == s), st.get("gap")))
            c.commit()
        hc = c if not dry else J.connect()
        for s_, st in report["sources"].items():
            n_rej = sum(1 for x in report["rejected"] if _src_type(x["source"]) == s_)
            report["health"][s_] = health_flags(hc, s_, st, n_rej, hcfg)
            if not dry:
                J.add_health(c, run_id, s_, st["health_status"], st.get("fetched", 0), st.get("matched", 0), n_rej,
                             st.get("seconds"), st.get("attempts", 1), "; ".join(report["health"][s_]["flags"]) or None)
        if not dry:
            c.commit()
            J.write_views(c)
    if ctx.get("hn_leads") is not None:
        flt_leads = [l for l in ctx["hn_leads"] if flt.lane(l["header"] + " " + l["text"][:400])[0] and
                     (flt.geo(l["header"])[0] or re.search(r"\bremote\b", l["header"], re.I))]
        report["hn_leads"] = {"comments": len(ctx["hn_leads"]), "lane_geo_leads": len(flt_leads),
                              "proposed_boards": sorted({b for l in flt_leads for b in l["boards"]})}
        json.dump(flt_leads, open(os.path.join(run_dir, "hn-leads.json"), "w"), indent=1)
    if args.test_source:
        report["test_source"] = test_source_verdict(args, report)
    json.dump(report, open(os.path.join(run_dir, "report.json"), "w"), indent=1, default=str)
    if RECORD is not None:
        json.dump(RECORD, open(os.environ["SWEEP_RECORD"], "w"), indent=0)
    write_candidates_md(report, run_dir)
    return report

def fetch_with_retry(name, fn, cfg, since, ctx, hcfg):
    """run one source; a failed source is retried `retries` times (default 2) with a pause, then reported broken."""
    attempts = 0
    while True:
        attempts += 1
        try:
            posts, st = fn(cfg, since, ctx)
        except Exception as e:
            posts, st = [], {**_stats(), "failed": 1, "gap": f"{name} crashed: {type(e).__name__}: {e}"}
        if not source_failed(st) or attempts > hcfg.get("retries", 2):
            break
        print(f"{name}: failed (attempt {attempts}); retrying in {hcfg.get('retry_pause_seconds', 20)}s", file=sys.stderr)
        time.sleep(hcfg.get("retry_pause_seconds", 20))
    st["attempts"] = attempts
    return posts, st

def source_failed(st):
    """a source failed when nothing came back and at least one request errored (or the fetcher crashed)."""
    return bool(st.get("failed")) and not st.get("ok")

def health_flags(c, source, st, n_rejected, hcfg):
    """compare this run with this source's recent history in source_health."""
    n = hcfg.get("history_runs", 6); streak_n = hcfg.get("empty_streak", 3)
    hist = [dict(r) for r in c.execute("SELECT status, jobs FROM source_health WHERE source=? ORDER BY at DESC LIMIT ?", (source, n))]
    jobs = st.get("fetched", 0) or 0
    flags = []
    status = st["health_status"]
    if status in ("failed", "broken"):
        flags.append(f"{status.upper()}: {st.get('gap') or ', '.join(st.get('errors', [])[:4])} (attempts {st.get('attempts', 1)})")
    prior = [h["jobs"] for h in hist if h["status"] == "ok" and h["jobs"]]
    usual = sorted(prior)[len(prior) // 2] if prior else None
    if status == "empty" and usual:
        run_len = 1
        for h in hist:
            if h["status"] == "empty": run_len += 1
            else: break
        flags.append(f"ZERO results {run_len} run(s) in a row (usual ~{usual})" + (" -> treat as broken" if run_len >= streak_n else ""))
    elif status == "ok" and usual and jobs < usual / 2:
        flags.append(f"DROP: {jobs} jobs vs usual ~{usual} (under half)")
    if st.get("failed") and st.get("ok"):
        flags.append(f"partial: {st['failed']} of {st.get('requests')} requests failed")
    if n_rejected:
        flags.append(f"{n_rejected} record(s) failed the job-record schema (see rejected table)")
    return {"status": status, "jobs": jobs, "matched": st.get("matched", 0), "rejects": n_rejected, "seconds": st.get("seconds"),
            "attempts": st.get("attempts", 1), "usual": usual, "flags": flags}

def _src_type(source):
    return {"ats:ashby": "ashby", "ats:greenhouse": "greenhouse", "ats:lever": "lever", "ats:smartrecruiters": "smartrecruiters",
            "workday": "workday", "li:guest": "linkedin_guest", "gov:usajobs": "gov", "gov:neogov": "gov", "gov:smartrecruiters": "gov"}.get(
            source, "getro" if source in ("vc:accel", "vc:generalcatalyst") else "a16z" if source == "vc:a16z" else source)

class _null:
    def __enter__(self): return self
    def __exit__(self, *a): return False

def test_source_verdict(args, report):
    """candidate source: keep if it produced at least one lane+geo match in the lookback window that we did not already have"""
    vendor, slug = args.test_source.split(":", 1)
    st = report["sources"].get(vendor, {})
    produced = len(report["new"]) + len(report["existing"])
    ok = st.get("ok", 0) > 0
    verdict = {"source": args.test_source, "reachable": ok, "lane_geo_matches": produced, "new_to_tracker": len(report["new"]),
               "keep": ok and produced > 0, "added": False}
    if verdict["keep"] and args.add and vendor in BOARD_SOURCES:
        cfg = yaml.safe_load(open(CFG_PATH))
        boards = cfg["sources"][vendor].setdefault("boards", [])
        if not any(b["slug"] == slug for b in boards):
            entry = {"company": board_name(vendor, slug), "slug": slug, "tag": args.tag or "discovered", "added": J.today(),
                     "why": f"--test-source: {produced} lane+geo matches in 14 days ({len(report['new'])} new)"}
            err = SC.check_board(entry, vendor)   # same schema as sources.yaml, after the test fetch above
            if err:
                verdict["schema_error"] = err
                return verdict
            boards.append(entry)
            yaml.safe_dump(cfg, open(CFG_PATH, "w"), sort_keys=False, allow_unicode=True, width=200)
            verdict["added"] = True
    return verdict

def write_candidates_md(r, run_dir):
    L = [f"# Sweep {r['run_id']}{' (DRY RUN)' if r['dry_run'] else ''}", "",
         f"Window: {r['window_start']} → {r['window_end']} · new {len(r['new'])} · already tracked {len(r['existing'])}", "",
         "## Per source", "", "| Source | Requests ok/fail | Fetched | In window | Lane+geo | Gap |", "|---|---|---|---|---|---|"]
    for s, st in r["sources"].items():
        L.append(f"| {s} | {st.get('ok',0)}/{st.get('failed',0)} | {st.get('fetched',0)} | {st.get('in_window',0)} | {st.get('matched',0)} | {J.esc(st.get('gap') or '')} |")
    broken = [(k, h) for k, h in (r.get("health") or {}).items() if h["status"] in ("failed", "broken") or any(f.startswith(("ZERO", "DROP")) for f in h["flags"])]
    L += ["", "## Source health", "", "| Source | Status | Jobs | Lane+geo | Rejects | Seconds | Attempts | Usual | Flags |", "|---|---|---|---|---|---|---|---|---|"]
    for k, h in (r.get("health") or {}).items():
        L.append(f"| {k} | {h['status']} | {h['jobs']} | {h['matched']} | {h['rejects']} | {h['seconds']} | {h['attempts']} | {h['usual'] or ''} | {J.esc('; '.join(h['flags']))} |")
    if broken:
        L += ["", "**Broken or degraded sources this run (not a quiet day):** " + "; ".join(f"{k} ({h['status']}: {'; '.join(h['flags'])})" for k, h in broken)]
    if r.get("config_errors"):
        L += ["", "## sources.yaml entries skipped (schema)", ""] + [f"- {e}" for e in r["config_errors"]]
    if r.get("rejected"):
        L += ["", "## Records rejected by the job-record schema", ""] + [f"- {x['source']}: {x['company']} | {x['title']}: {x['reason']}" for x in r["rejected"][:30]]
    L += ["", "## New to tracker (unscored: evaluate next)", "", "| Source | Company | Title | Lane | Geo | Pay | Posted | In play | URL |", "|---|---|---|---|---|---|---|---|---|"]
    for n in r["new"]:
        L.append(f"| {n['source']} | {J.esc(n['company'])} | {J.esc(n['title'])} | {n['lane']} | {J.esc(n['location'][:50])} | {J.esc(n['pay'] or '')} | {(n['posted_at'] or '')[:16]} | {J.esc(n['in_play'])} | {n['url']} |")
    L += ["", "## Already tracked (sighting recorded)", ""]
    L += [f"- {e['source']}: {e['company']} | {e['title']} → {e.get('status')} (fit {e.get('fit')})" for e in r["existing"]]
    if r.get("hn_leads"):
        L += ["", "## HN Who's Hiring leads", "", f"{r['hn_leads']['lane_geo_leads']} lane+geo leads from {r['hn_leads']['comments']} new comments; proposed boards: {', '.join(r['hn_leads']['proposed_boards']) or 'none'}"]
    if r.get("test_source"):
        L += ["", "## Test-source verdict", "", "```", json.dumps(r["test_source"], indent=1), "```"]
    L += ["", "## Gaps", ""] + [f"- {g}" for g in r["gaps"]]
    open(os.path.join(run_dir, "candidates.md"), "w").write("\n".join(L) + "\n")

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hours", type=float); ap.add_argument("--since"); ap.add_argument("--until")
    ap.add_argument("--sources", help="comma list of source types: " + ",".join(FETCHERS))
    ap.add_argument("--only", help="workday: tenant subset")
    ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--run-id")
    ap.add_argument("--test-one", help="<type>:<slug> - one company/board, no DB writes")
    ap.add_argument("--test-source", help="<type>:<slug> - candidate source, 14-day lookback, no DB writes")
    ap.add_argument("--add", action="store_true", help="with --test-source: add to sources.yaml if it produced matches")
    ap.add_argument("--tag", help="with --add: tag to store, e.g. peer:<seed> or vc:<firm>")
    a = ap.parse_args()
    r = run(a)
    print(json.dumps({"run_id": r["run_id"], "dry_run": r["dry_run"], "window": [r["window_start"], r["window_end"]],
                      "new": len(r["new"]), "existing": len(r["existing"]),
                      "sources": {s: {k: v for k, v in st.items() if k in ("ok", "failed", "fetched", "in_window", "matched", "gap")} for s, st in r["sources"].items()},
                      "test_source": r.get("test_source"), "hn": r.get("hn_leads")}, indent=1, default=str))
    print("report:", os.path.join(str(H.path("runs_dir")), r["run_id"], "candidates.md"))

if __name__ == "__main__":
    main()
