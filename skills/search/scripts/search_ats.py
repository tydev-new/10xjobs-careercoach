#!/usr/bin/env python3
"""Cheap headless job search: probe company ATS APIs (Greenhouse/Ashby/Lever/
SmartRecruiters/Workday), filter by the workspace criteria, insert NEW roles
into the local pipeline (jobs.db) with the raw JD saved to jd-inbox/.

No browser, no LLM — network + stdlib only. Idempotent: canonical
(company,title) dedup; existing rows are never modified. New rows land in
stage 'To Review' with NULL verdict — the evaluate skill scores them later.

  python3 search_ats.py --workspace . [--max-per-company 5]
  python3 search_ats.py --workspace . --register "NVIDIA=https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite"

Filters come from criteria.json in the workspace (validated — unknown keys
rejected); absent -> built-in defaults. The run report counts rejections BY
REASON so the agent's widening choice is evidence-driven, not guessed.

Schema DDL matches evaluate/scripts/record_verdict.py — keep in lockstep
(extract a shared module when a third writer appears).
"""
import argparse, json, os, re, sys, urllib.parse, urllib.request
import jobs_md as jm
from html import unescape
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

DEFAULT_TARGETS = [
    "Anthropic", "OpenAI", "Databricks", "Snorkel AI", "Writer", "Baseten",
    "Scale AI", "Sierra", "Harvey", "Decagon", "Cresta", "Snowflake",
]

# ---- criteria (defaults; overridable via workspace criteria.json) ----------
DEFAULT_CRITERIA = {
    "themes": ["forward deployed", "forward-deployed", "solutions eng", "solutions architect",
               "field eng", "applied ai", "value creation", "customer eng", "delivery",
               "head of solutions", "deployment", "sales eng"],
    "seniority_regex": r"\b(vp|vice president|chief|cto|head of|head|director|associate director|manager|mgr|founding)\b",
    "geo_include": ["san francisco", "palo alto", "mountain view", "san jose", "menlo", "redwood",
                    "santa clara", "sunnyvale", "san mateo", "bay area", "foster city", "cupertino", "remote"],
    "geo_exclude": ["denmark", "france", "germany", "mexico", "canada", "united kingdom", "(uk)", " uk",
                    "ireland", "netherlands", "spain", "italy", "portugal", "poland", "sweden", "norway",
                    "finland", "switzerland", "austria", "belgium", "india", "china", "japan", "korea",
                    "singapore", "australia", "brazil", "argentina", "colombia", "israel", "uae", "dubai",
                    "emea", "apac", "latam", "europe", "asia"],
    "target_yield": 3,        # sweeps under this -> the report suggests widening
    "widened_by": [],         # provenance: which levers the agent loosened (echoed everywhere)
    # --- band + comp gates (0 = off; both only bite when the data exists) ----
    # comp_floor: drop a role whose posted MAX is below the floor. Max, not
    # min, deliberately — a range STRADDLING the floor is a negotiation, not a
    # rejection. Undisclosed comp is never a miss (52 of 125 roles in the
    # 2026-08-04 sweep published nothing; dropping them would hide the market).
    "comp_floor": 0,
    # min_mgmt_yoe: structured band gate, used only where the feed supplies
    # min_management_and_leadership_yoe (hiring.cafe). Title regexes cannot see
    # this and have now mis-banded twice — see IC_GUARD and the 2026-08-03
    # Clera miss (seniority_level: Entry Level behind a "Head of" title).
    "min_mgmt_yoe": 0,
    # Watchlist relaxation: a *starred company's role may miss `themes` if its
    # title hits one of these ADJACENT-technical terms instead. Earned
    # 2026-07-18: dropping the theme filter entirely surfaced "Art Director"
    # and "Contracts Manager" at a big lab — dream company ≠ any title.
    # NARROW deployment-adjacent terms only (3rd calibration 2026-07-18: bare
    # "engineering"/"technical" matched every lab EM — Growth, GRC, GPU…; a
    # watchlist relaxes the thesis, it doesn't suspend it)
    "watch_themes": ["deploy", "solutions", "applied", "field", "forward"],
    # deny beats watch_themes ("Infrastructure & Energy ACCOUNTING" hit
    # "infrastructure" — earned 2026-07-18, second watch calibration)
    "watch_deny": ["accounting", "procurement", "recruit", "marketing", "legal", "counsel",
                   "finance", "payroll", "facilities", "workplace", "people ops", "art director"],
}
CRITERIA_TYPES = {"themes": list, "seniority_regex": str, "geo_include": list,
                  "geo_exclude": list, "target_yield": int, "widened_by": list,
                  "watch_themes": list, "watch_deny": list,
                  "comp_floor": int, "min_mgmt_yoe": int}


def parse_criteria_md(workspace):
    """Directly parse criteria.md into criteria filters."""
    path = os.path.join(workspace, "criteria.md")
    if not os.path.exists(path):
        return {}
    text = open(path, encoding="utf-8").read()
    sections = {}
    cur_sec = None
    for line in text.splitlines():
        m = re.match(r"^##\s+(.+)$", line.strip())
        if m:
            cur_sec = m.group(1).lower().strip()
            sections[cur_sec] = []
        elif cur_sec and line.strip():
            sections[cur_sec].append(line.strip())
    
    parsed = {}
    targets = []
    for k, lines in sections.items():
        if "target" in k and "compan" not in k:
            for l in lines:
                clean_l = re.sub(r"^[-*•]\s*", "", l)
                clean_l = re.sub(r"\[.*?\]", "", clean_l).strip()
                if clean_l and not clean_l.startswith("TODO"):
                    role_title = clean_l.split(" — ")[0].split(" - ")[0].strip()
                    if role_title:
                        targets.append(role_title.lower())
    if targets:
        parsed["themes"] = targets
    
    for k, lines in sections.items():
        if "target compan" in k or ("compan" in k and "note" not in k):
            comps = []
            for l in lines:
                clean_l = re.sub(r"^[-*•]\s*", "", l).strip()
                if clean_l and not clean_l.startswith("TODO"):
                    comps.append(clean_l)
            if comps:
                parsed["target_companies"] = comps

    for k, lines in sections.items():
        if "geo" in k or "location" in k:
            geos = []
            for l in lines:
                clean_l = re.sub(r"^[-*•]\s*", "", l).strip().lower()
                if "remote" in clean_l:
                    geos.append("remote")
                if any(x in clean_l for x in ("san francisco", "sf", "bay area", "palo alto", "mountain view")):
                    geos.extend(["san francisco", "bay area", "palo alto", "mountain view", "san jose", "sunnyvale"])
            if geos:
                parsed["geo_include"] = list(set(geos))

    for k, lines in sections.items():
        if "comp" in k or "pay" in k:
            for l in lines:
                nums = re.findall(r"\$?\s*(\d{2,3})[,\s]?000|\$(\d{2,3})k", l.lower())
                for n1, n2 in nums:
                    val = int(n1 or n2) * 1000
                    if val >= 50000:
                        parsed["comp_floor"] = val
                        break
    return parsed


def load_criteria(workspace):
    """Load criteria from criteria.md (direct SSOT) or legacy criteria.json."""
    crit = dict(DEFAULT_CRITERIA)
    md_crit = parse_criteria_md(workspace)
    crit.update(md_crit)
    
    json_path = os.path.join(workspace, "criteria.json")
    if os.path.exists(json_path):
        try:
            raw = json.load(open(json_path))
            for k, v in raw.items():
                if k in CRITERIA_TYPES and isinstance(v, CRITERIA_TYPES[k]):
                    crit[k] = v
            return crit, "criteria.md + criteria.json" + (f" (widened_by: {', '.join(crit['widened_by'])})" if crit["widened_by"] else "")
        except Exception:
            pass
    if md_crit:
        return crit, "criteria.md"
    return crit, "defaults"




def canon(s):
    s = re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())
    s = re.sub(r"\b(inc|llc|corp|labs|technologies|company|the)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def http_json(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def http_post_json(url, body, timeout=15):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"User-Agent": "Mozilla/5.0", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def http_text(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def slugs(name):
    """Returns [(slug, is_weak)] — the bare first word of a multi-word name is
    WEAK: collision-prone ('New Incentives' -> 'new' is somebody's board), so
    weak slugs only count when the vendor lets us verify board identity."""
    base = re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()
    strong = [base.replace(" ", ""), base.replace(" ", "-")]
    out = [(s, False) for s in dict.fromkeys(strong)]
    first = base.split()[0]
    if first not in strong:
        out.append((first, True))
    return out


def verify_identity(vendor, slug, name):
    """True/False where the vendor exposes the board's own name; None where it
    doesn't (identity unknowable from the API alone)."""
    try:
        if vendor == "greenhouse":
            board = http_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}")
            return canon(board.get("name", "")) == canon(name)
        if vendor == "teamtailor":
            root = ET.fromstring(http_text(f"https://{slug}.teamtailor.com/jobs.rss"))
            return canon(root.findtext("channel/title") or "") == canon(name)
    except Exception:
        return False
    return None


# ---- vendors ---------------------------------------------------------------
# path = (vendor, slug, datacenter, site); dc/site used only by workday.
# Endpoint shapes empirically verified (several via career-ops' provider modules,
# MIT) — each vendor is a LOCKED CONTRACT in code; the cloud map supplies only
# WHICH company uses which vendor.
ATS = {
    "greenhouse": (lambda s: f"https://boards-api.greenhouse.io/v1/boards/{s}/jobs?content=true",
                   lambda j: j.get("jobs", []) if isinstance(j, dict) else []),
    "ashby": (lambda s: f"https://api.ashbyhq.com/posting-api/job-board/{s}",
              lambda j: j.get("jobs", []) if isinstance(j, dict) else []),
    "lever": (lambda s: f"https://api.lever.co/v0/postings/{s}?mode=json",
              lambda j: j if isinstance(j, list) else []),
    "smartrecruiters": (lambda s: f"https://api.smartrecruiters.com/v1/companies/{s}/postings",
                        lambda j: j.get("content", []) if isinstance(j, dict) else []),
    "breezy": (lambda s: f"https://{s}.breezy.hr/json",
               lambda j: j if isinstance(j, list) else []),
}
PROBE_VENDORS = list(ATS) + ["bamboohr", "teamtailor"]  # slug-probeable; workday needs the 3-tuple
# yc is register-only, like workday: the slug is YC's company slug, and probing
# every company against YC would cost a request each for no yield (most target
# companies were never in a batch).
VENDORS = set(PROBE_VENDORS) | {"workday", "hiring_cafe", "yc"}
TT_NS = "{https://teamtailor.com/locations}"

# Bespoke-career-site giants: no standard ATS exists to probe, so they map to
# the hiring.cafe aggregator AS IF it were their ATS (vendor="hiring_cafe",
# slug=display name). First page only — sufficient because the query is scoped
# to ONE company + role-filtered + date-sorted, and daily sweeps accumulate.
BESPOKE_GIANTS = {canon(n): n for n in
                  ["Google", "Apple", "Meta", "Amazon", "Microsoft", "Netflix", "Tesla"]}
HC_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
         "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def hiring_cafe_search(query, company=None):
    """Raw hiring.cafe SSR query -> ssrHits. company=None runs a GLOBAL
    role-first search across every ATS they index.

    Why global matters (earned 2026-08-03): the per-company mode only reaches
    employers already in the working set, and this script natively supports eight
    startup-shaped vendors. Traditional employers run Taleo, iCIMS, Oracle
    Cloud, SuccessFactors, ADP, Jobvite, PageUp — all invisible to a curated
    sweep, all indexed here. A global query surfaced UnitedHealth, AXA, New
    York Life, Lenovo, SAP, Cotiviti and Latham & Watkins in one call.
    Aggregator rule still binds: global results feed the COMPANY universe
    (companies.md), never the board directly.
    """
    state = {"searchQuery": query, "sortBy": "date"}
    if company:
        state["companyNames"] = [company]
    url = "https://hiring.cafe/?searchState=" + urllib.parse.quote(json.dumps(state))
    req = urllib.request.Request(url, headers={"User-Agent": HC_UA,
                                               "Accept": "text/html,application/xhtml+xml"})
    with urllib.request.urlopen(req, timeout=20) as r:
        html = r.read().decode("utf-8", "replace")
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)</script>', html)
    if not m:
        return []
    hits = (json.loads(m.group(1)).get("props", {}).get("pageProps", {}) or {}).get("ssrHits", [])
    out, want = [], canon(company) if company else None
    for h in hits or []:
        if h.get("is_expired"):
            continue
        info, v5 = h.get("job_information") or {}, h.get("v5_processed_job_data") or {}
        # The two name fields are COMPLEMENTARY, not redundant (measured
        # 2026-08-04): a 'forward deployed' sweep had 2/77 rows missing
        # enriched_company_data.name, while an Apple sweep had 13 enriched
        # names against only 9 v5.company_name. Either alone loses rows.
        got = (h.get("enriched_company_data") or {}).get("name") or v5.get("company_name") or ""
        if want is not None and canon(got) != want:
            continue  # fuzzy-match stray — not this employer
        out.append({"title": info.get("title") or info.get("job_title_raw") or "",
                    "loc": v5.get("formatted_workplace_location") or "",
                    "company": got,
                    "_url": h.get("apply_url") or "",
                    # structured fields the title can't carry; consumed by
                    # filter_reason(meta=...) and the discovery report
                    "_meta": {"comp_min": v5.get("yearly_min_compensation"),
                              "comp_max": v5.get("yearly_max_compensation"),
                              "min_mgmt_yoe": v5.get("min_management_and_leadership_yoe"),
                              "seniority": v5.get("seniority_level") or "",
                              # ISO codes: ['US'], NOT 'United States'. Matching
                              # on the country NAME silently returns zero and
                              # reads as a legitimate empty result.
                              "countries": v5.get("workplace_countries") or []}})
    return out


def discover_roles(crit, queries, known=(), verbose=True):
    """GLOBAL role-first sweep: ask the aggregator for a ROLE across every
    employer it indexes, instead of asking a curated company list what it has.

    Why this exists (earned 2026-08-04, and it reverses a prior decision).
    SKILL.md used to say the global catch-all was "deliberately NOT ported"
    because "first-page-of-everything is thin against a curated company
    thesis." That reasoning assumed ONE query. Fanned across 14 title angles it
    returned 495 raw postings -> 125 US leadership roles in the candidate's
    function, against a board holding 11, and 21 of 23 companies spot-checked
    were absent from the local universe. The whole Big-4/pharma/bank population
    building FDE practices at Director and Executive-Director band
    (PwC $150-438K, Novartis $225-418K, KPMG $198-357K) was invisible to every
    company-first channel.

    The AGGREGATOR RULE still binds and is the reason this returns companies
    rather than writing rows: discovery finds COMPANIES (-> companies.md, with
    provenance), feeds find JOBS. Nothing here touches the board.

    Returns (kept_rows, reasons, per_query_counts). `known` = canonical company
    keys already in the universe, used only to label rows NEW vs known.
    """
    kept, reasons, per_query, seen = [], {}, [], set()
    for q in queries:
        try:
            hits = hiring_cafe_search(q)
        except Exception as e:
            print(f"  !! {q!r}: {e}", file=sys.stderr)
            per_query.append((q, 0))
            continue
        per_query.append((q, len(hits)))
        if verbose:
            print(f"  {len(hits):>4}  {q}")
        for r in hits:
            key = (canon(r["company"]), norm_title(r["title"]))
            if key in seen:
                continue
            seen.add(key)
            why = filter_reason(r["title"], r["loc"], crit, meta=r.get("_meta"))
            if why:
                reasons[why] = reasons.get(why, 0) + 1
                continue
            r["_new_company"] = canon(r["company"]) not in set(known)
            kept.append(r)
    return kept, reasons, per_query


YC_BASE = "https://www.ycombinator.com"


def fetch_yc(slug):
    """Y Combinator company job board: GET /companies/<slug>/jobs and read the
    Inertia `data-page` payload the page is server-rendered from.

    Why this vendor exists (earned 2026-08-04). Zep AI — a real, evaluated
    role — was reachable by NO channel this script had: absent from
    the working set, 0 postings in the aggregator under any name, and no ATS
    discoverable by slug probing. Its posting lives only on YC's own board. A
    whole class of seed companies is like this.

    Two things make this worth a dedicated vendor rather than a scrape:
      - salaryRange AND equityRange are both published, which almost no ATS does
      - the company payload carries `founders` and `show_founder_contact` —
        the founder-reachability that defines the seed/Series-A lane

    NOT the /jobs/role/<x> listing pages: those return a fixed 39-posting
    marketing sample, ignore their own location filter, and did not contain
    Zep. Per-company is the only route that reflects what a company posts.
    """
    req = urllib.request.Request(f"{YC_BASE}/companies/{slug}/jobs",
                                 headers={"User-Agent": HC_UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=25) as r:
        html_body = r.read().decode("utf-8", "replace")
    m = re.search(r'data-page="(.*?)"\s*>', html_body, re.S)
    if not m:
        return []
    page = json.loads(unescape(m.group(1)))
    props = page.get("props") or {}
    company = props.get("company") or {}
    founders = company.get("founders") or []
    out = []
    for j in props.get("jobPostings") or []:
        j = dict(j)
        j["_url"] = YC_BASE + (j.get("url") or "")
        j["_founders"] = founders
        j["_batch"] = company.get("batch_name") or ""
        out.append(j)
    return out


def fetch_hiring_cafe(company, crit):
    """Per-company aggregator fetch (the sweep's vendor path). Results are
    re-verified by canonical company match — a repost or staffing-agency hit is
    dropped, never attributed (upstream review finding)."""
    role = (crit or {}).get("themes", [""])[0] or "engineering"
    return hiring_cafe_search(role, company=company)


def fetch_postings(vendor, slug, dc, site, crit=None):
    if vendor == "hiring_cafe":
        return fetch_hiring_cafe(slug, crit)
    if vendor == "yc":
        return fetch_yc(slug)
    if vendor == "workday":
        base = f"https://{slug}.{dc}.myworkdayjobs.com"
        out, offset = [], 0
        while offset <= 60:  # bounded: 4 pages x 20
            j = http_post_json(f"{base}/wday/cxs/{slug}/{site}/jobs",
                               {"appliedFacets": {}, "limit": 20, "offset": offset, "searchText": ""})
            page = j.get("jobPostings", []) or []
            for p in page:
                p["_url"] = f"{base}/en-US/{site}" + (p.get("externalPath") or "")
            out.extend(page)
            if len(page) < 20:
                break
            offset += 20
        return out
    if vendor == "bamboohr":
        j = http_json(f"https://{slug}.bamboohr.com/careers/list")
        rows = j.get("result", []) if isinstance(j, dict) else []
        for p in rows:
            p["_url"] = f"https://{slug}.bamboohr.com/careers/{p.get('id','')}"
        return rows
    if vendor == "teamtailor":
        root = ET.fromstring(http_text(f"https://{slug}.teamtailor.com/jobs.rss"))
        out = []
        for it in root.iter("item"):
            locs = it.find(f"{TT_NS}locations")
            out.append({"title": (it.findtext("title") or "").strip(),
                        "_url": (it.findtext("link") or "").strip(),
                        "loc": " ".join("".join(locs.itertext()).split()) if locs is not None else "",
                        "desc": re.sub(r"<[^>]+>", " ", it.findtext("description") or "")})
        return out
    return ATS[vendor][1](http_json(ATS[vendor][0](slug)))


YC_AGE_UNITS = {"minute": 0, "hour": 0, "day": 1, "week": 7, "month": 30, "year": 365}


def yc_relative_to_iso(s, today=None):
    """'1 day' / '3 months' / 'about 2 hours' -> an ISO date. Empty on anything
    unrecognized: a wrong date is worse than no date, because posted_at drives
    the freshness rule that decides which roles get an action slot."""
    m = re.search(r"(\d+)\s*(minute|hour|day|week|month|year)", str(s or ""), re.I)
    if not m:
        return ""
    days = int(m.group(1)) * YC_AGE_UNITS[m.group(2).lower()]
    base = today or datetime.now(timezone.utc).date()
    return (base - __import__("datetime").timedelta(days=days)).isoformat()


def posted_iso(vendor, p):
    """Posting date as ISO (empty when the vendor doesn't expose one) — the
    decay principle needs the age named; jobs.posted_at carries it."""
    v = None
    if vendor == "greenhouse":
        v = p.get("first_published") or p.get("updated_at")
    elif vendor == "ashby":
        v = p.get("publishedDate") or p.get("publishedAt")
    elif vendor == "lever":
        ms = p.get("createdAt")
        if ms:
            import datetime as _dt
            return _dt.datetime.utcfromtimestamp(ms / 1000).date().isoformat()
    elif vendor == "smartrecruiters":
        v = p.get("releasedDate")
    elif vendor == "yc":
        # YC publishes a RELATIVE string ("1 day", "3 months"), not a date.
        # Slicing it to 10 chars wrote literal "1 day" into posted_at — the
        # decay principle needs a real date or nothing at all.
        return yc_relative_to_iso(p.get("createdAt"))
    return (v or "")[:10]


def extract(vendor, p):
    if vendor == "greenhouse":
        return (p.get("title", ""), (p.get("location") or {}).get("name", ""),
                p.get("absolute_url", ""), re.sub(r"<[^>]+>", " ", p.get("content", "") or ""))
    if vendor == "ashby":
        return (p.get("title", ""), p.get("locationName") or p.get("location", "") or "",
                p.get("jobUrl", ""), re.sub(r"<[^>]+>", " ", p.get("descriptionHtml", "") or ""))
    if vendor == "lever":
        return (p.get("text", ""), (p.get("categories") or {}).get("location", ""),
                p.get("hostedUrl", ""), re.sub(r"<[^>]+>", " ", p.get("description", "") or ""))
    if vendor == "workday":
        return (p.get("title", ""), p.get("locationsText", ""), p.get("_url", ""), "")
    if vendor == "hiring_cafe":
        return (p.get("title", ""), p.get("loc", ""), p.get("_url", ""), "")
    if vendor == "yc":
        # YC gives no JD body in the list payload, but salary/equity/experience
        # and the founder list are worth carrying into jd-inbox as a header.
        f = ", ".join(x.get("full_name", "") for x in (p.get("_founders") or []) if x.get("full_name"))
        meta = " | ".join(x for x in [
            f"Batch: {p.get('_batch')}" if p.get("_batch") else "",
            f"Salary: {p.get('salaryRange')}" if p.get("salaryRange") else "",
            f"Equity: {p.get('equityRange')}" if p.get("equityRange") else "",
            f"Min experience: {p.get('minExperience')}" if p.get("minExperience") else "",
            f"Visa: {p.get('visa')}" if p.get("visa") else "",
            f"Founders: {f}" if f else "",
        ] if x)
        return (p.get("title", ""), p.get("location", ""), p.get("_url", ""), meta)
    if vendor == "bamboohr":
        loc = p.get("location") or {}
        parts = [loc.get("city", ""), loc.get("state", ""), "Remote" if p.get("isRemote") else ""]
        return (p.get("jobOpeningName", ""), ", ".join(x for x in parts if x), p.get("_url", ""), "")
    if vendor == "teamtailor":
        return (p.get("title", ""), p.get("loc", ""), p.get("_url", ""), p.get("desc", ""))
    if vendor == "breezy":
        loc = p.get("location") or {}
        return (p.get("name", ""), loc.get("name", "") or ", ".join(
            x for x in [loc.get("city", ""), loc.get("state", "")] if x), p.get("url", ""), "")
    return (p.get("name", ""), ((p.get("location") or {}).get("city", "")),
            f"https://jobs.smartrecruiters.com/{p.get('company', {}).get('identifier','')}/{p.get('id','')}", "")


# ---- ATS URL parsing (the validated slot for agent-discovered paths) -------
URL_PATTERNS = [
    ("yc", re.compile(r"https?://(?:www\.)?ycombinator\.com/companies/([a-z0-9-]+)")),
    ("workday", re.compile(r"https?://([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([A-Za-z0-9_-]+)")),
    ("greenhouse", re.compile(r"https?://(?:boards|job-boards)\.greenhouse\.io/([a-z0-9-]+)")),
    ("lever", re.compile(r"https?://jobs\.lever\.co/([a-z0-9-]+)")),
    ("ashby", re.compile(r"https?://jobs\.ashbyhq\.com/([a-zA-Z0-9-]+)")),
    ("smartrecruiters", re.compile(r"https?://(?:jobs|careers)\.smartrecruiters\.com/([A-Za-z0-9]+)")),
    ("bamboohr", re.compile(r"https?://([a-z0-9-]+)\.bamboohr\.com")),
    ("breezy", re.compile(r"https?://([a-z0-9-]+)\.breezy\.hr")),
    ("teamtailor", re.compile(r"https?://([a-z0-9-]+)\.teamtailor\.com")),
]


def parse_ats_url(url):
    """Any careers/apply URL -> (vendor, slug, datacenter, site) or None."""
    for vendor, pat in URL_PATTERNS:
        m = pat.search(url or "")
        if m:
            g = m.groups()
            if vendor == "workday":
                return (vendor, g[0], g[1], g[2])
            return (vendor, g[0], None, None)
    return None


def norm_title(s):
    """Surface-form normalization so theme matching survives hyphens,
    slashes, commas, plural 's', and spacing — mechanical variants are the
    script's job, not the criteria author's. Comma earned 2026-08-14: ATS
    titles write "VP, Engineering", which broke the phrase "vp engineering"."""
    s = re.sub(r"[-/_,]", " ", (s or "").lower())
    s = re.sub(r"\bengineerings?\b", "eng", s)
    s = re.sub(r"\bsolutions?\b", "solutions", s)
    return re.sub(r"\s+", " ", s).strip()


def theme_hit(key, t):
    """Whole-token theme match against an already-normalized title.

    Plain substring containment is WRONG here because norm_title collapses
    'engineering' -> 'eng': the theme "software engineering" becomes
    "software eng", which is a PREFIX of "software engineer" — so every IC
    Software Engineer matched a leadership theme. With 'principal' and 'lead'
    in the seniority band that flooded a whole sweep.
    Earned 2026-08-03. Word boundaries fix it: "software eng" matches
    "vp software eng" but not "principal software engineer".
    """
    k = norm_title(key)
    return re.search(r"\b" + re.escape(k) + r"\b", t) is not None


# "Founding X" is an IC title wearing a seniority word. `founding` sits in the
# default seniority_regex, so "Founding Forward Deployed Engineer" passed the
# band gate — three of thirteen small-company hits at the comp floor in the
# 2026-08-04 sweep were exactly this (Sandstone, Amari, Alloy), all IC roles
# for a Director/VP-band candidate. A real band word rescues it: "Founding Head
# of Engineering" is a leadership seat, "Founding Engineer" is not.
IC_GUARD = re.compile(r"\bfounding\b", re.I)
REAL_BAND = re.compile(r"\b(head of|head|director|vp|vice president|chief|cto|manager|mgr)\b", re.I)

# Job titles write locations in shorthand the geo_include lists never carry
# ("[NYC or SF]", "Bay Area"). Only aliases that resolve to a geo_include entry
# belong here — this rescues a dropped role, it does not widen the thesis.
GEO_TITLE_ALIASES = {"sf": "san francisco", "sfo": "san francisco",
                     "bay area": "bay area", "silicon valley": "bay area",
                     "south bay": "bay area", "peninsula": "bay area"}


def title_names_included_geo(title, crit):
    """True when the TITLE names a location the criteria include. Word-bounded:
    a bare 'sf' substring would otherwise match inside ordinary words."""
    t = (title or "").lower()
    for term in crit.get("geo_include", []):
        if re.search(r"\b" + re.escape(term) + r"\b", t):
            return True
    for alias, target in GEO_TITLE_ALIASES.items():
        if target in crit.get("geo_include", []) and re.search(r"\b" + re.escape(alias) + r"\b", t):
            return True
    return False


# Every value filter_reason() can return. The sweep seeds its counter from
# this, so adding a reason below is all it takes — forgetting to seed it is
# what crashed a 175-company run (KeyError 'ic-title', 2026-08-04).
REJECTION_REASONS = ("seniority-miss", "ic-title", "theme-miss", "geo-miss",
                     "band-miss", "comp-miss")


def filter_reason(title, loc, crit, watch=False, meta=None):
    """None = keep; otherwise the rejection reason (drives the report).
    watch=True (a company from criteria.md § Target companies) relaxes the THEME filter
    only — a borderline role at a watchlist company still surfaces; seniority
    and geo still apply.

    meta = optional structured fields from feeds that supply them
    (hiring.cafe's v5_processed_job_data): min_mgmt_yoe, comp_max. Title
    regexes are blind to band and pay; where the feed knows better, it wins.
    Absent meta -> title-only behaviour, exactly as before."""
    t = norm_title(title)
    if not re.search(crit["seniority_regex"], t):
        return "seniority-miss"
    if IC_GUARD.search(t) and not REAL_BAND.search(t):
        return "ic-title"
    if not any(theme_hit(k, t) for k in crit["themes"]):
        ok_watch = (watch and any(theme_hit(k, t) for k in crit.get("watch_themes", []))
                    and not any(theme_hit(k, t) for k in crit.get("watch_deny", [])))
        if not ok_watch:
            return "theme-miss"
    l = (loc or "").lower()
    if any(x in l for x in crit["geo_exclude"]):
        return "geo-miss"
    if l and not any(b in l for b in crit["geo_include"]):
        # An ATS location field names ONE primary city; a multi-location role
        # often carries the others in its title. Measured 2026-08-04: Amigo's
        # "Head of Applied AI [NYC or SF]" ($300-500K, the highest-paying
        # FDE-leadership role found anywhere) was dropped because its Ashby
        # location field says only "New York City". Rescue on the title, but
        # ONLY after geo_exclude has already had its say — an exclusion is
        # never overridden, so a "London or SF" role still fails on London.
        if not title_names_included_geo(title, crit):
            return "geo-miss"
    m = meta or {}
    floor = crit.get("min_mgmt_yoe", 0)
    yoe = m.get("min_mgmt_yoe")
    if floor and yoe is not None and yoe < floor:
        return "band-miss"          # the feed says IC, whatever the title says
    cf = crit.get("comp_floor", 0)
    cmax = m.get("comp_max")
    if cf and cmax and cmax < cf:   # `and cmax` -> undisclosed (None/0) never misses
        return "comp-miss"
    return None




# ---- criteria.md: the user's file (profile-owned; search only READS) -------
SETTINGS_KEYS = {  # criteria.md "## Search settings" bullet -> criteria key
    "target yield": ("target_yield", int),
    "max new roles per company": ("max_per_company", int),
    "active pipeline cap": ("active_cap", int),
    "stale after": ("stale_days", int),
}
DEFAULT_SETTINGS = {"max_per_company": 5, "active_cap": 25, "stale_days": 30}


def _section(text, name):
    m = re.search(rf"^##\s+{name}\b.*?$(.*?)(?=^##\s|\Z)", text, re.M | re.S)
    return m.group(1) if m else ""


def parse_criteria_md(workspace):
    """Read the two search-facing sections of criteria.md.

    Tolerant by design — this is a HUMAN-edited file: bullets or plain lines,
    a company name is everything before the first separator, TODO lines skip.
    Bad settings values are a loud exit, not a silent default: a typo'd knob
    that silently reverts is worse than no knob.
    Returns (companies:[name], settings:dict).
    """
    path = os.path.join(workspace, "criteria.md")
    if not os.path.exists(path):
        return [], dict(DEFAULT_SETTINGS)
    text = open(path, encoding="utf-8").read()
    companies = []
    for line in _section(text, "Target companies").splitlines():
        line = line.strip()
        # companies are BULLETS. Prose in the section (an italic note, a TODO
        # and its continuation) must not parse as employers — the first live
        # sweep probed "the candidate's own picks" as a company (2026-08-14).
        m = re.match(r"[-*]\s+(.*)", line)
        if not m:
            continue
        name = re.split(r"\s+[—#(\[]|\s{2,}\*", m.group(1))[0].strip(" *·")
        if not name or name.lower().startswith("todo"):
            continue
        companies.append(name)
    settings = dict(DEFAULT_SETTINGS)
    for line in _section(text, "Search settings").splitlines():
        line = line.strip().lstrip("-*").strip()
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        k = re.sub(r"[^a-z ]", "", key.lower()).strip()
        for prefix, (ck, typ) in SETTINGS_KEYS.items():
            if k.startswith(prefix):
                m = re.search(r"-?\d+", val)
                if not m:
                    sys.exit(f"criteria.md Search settings: '{key.strip()}' needs a number, got '{val.strip()}'")
                n = typ(m.group(0))
                if n < 0:
                    sys.exit(f"criteria.md Search settings: '{key.strip()}' must be >= 0")
                settings[ck] = n
    return companies, settings


# ---- companies.md: THE working set (script-owned; humans read, not write) --
def load_companies_md(workspace):
    rows = {}
    path = os.path.join(workspace, "companies.md")
    if not os.path.exists(path):
        return rows
    for line in open(path, encoding="utf-8"):
        if not line.startswith("|") or line.startswith("| Company") or line.startswith("|--") or line.startswith("| ---"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 4 and cells[0]:
            rows[canon(cells[0])] = {"name": cells[0], "source": cells[1],
                                     "evidence": cells[2], "status": cells[3],
                                     "board": (cells[4] if len(cells) > 4 else "")}
    return rows


def write_companies_md(workspace, rows):
    """Regenerate the working set. Rows sourced from criteria.md are rebuilt
    from it every run (that section stays authoritative — deletions propagate);
    discovered and cloud rows persist with their provenance."""
    order = {"criteria": 0, "cloud": 2}
    def key(r): return (order.get(r["source"].split("-")[0], 1), r["name"].lower())
    lines = [
        "# Companies — the search's working set",
        "",
        "*Written by the search script every sweep. Your own picks live in*",
        "*`criteria.md § Target companies` — edit THERE; rows sourced from it*",
        "*regenerate each run. Discovered rows persist with their provenance.*",
        "",
        "## Companies",
        "",
        "| Company | Source | Evidence | Status | Board |",
        "|---|---|---|---|---|",
    ]
    for r in sorted(rows.values(), key=key):
        lines.append(f"| {r['name']} | {r['source']} | {r['evidence']} | {r['status']} | {r.get('board') or ''} |")
    with open(os.path.join(workspace, "companies.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def append_discovered(workspace, name, channel, evidence):
    """Add one machine-found company (idempotent on canonical name)."""
    rows = load_companies_md(workspace)
    k = canon(name)
    if k in rows:
        return False
    today = datetime.now(timezone.utc).date().isoformat()
    rows[k] = {"name": name, "source": f"discovery-{channel} {today}",
               "evidence": (evidence or "")[:140].replace("|", "/"), "status": "new",
               "board": ""}
    write_companies_md(workspace, rows)
    return True



# ---- leads.md: role-level leads, unconfirmed until the employer's own board
# shows them. The lead tier's disk home (2026-08-14) — a pipeline row's URL is
# the employer's posting (it IS the application link); aggregator URLs live
# here as provenance. ---------------------------------------------------------
def load_leads(workspace):
    p = os.path.join(workspace, "leads.md")
    rows, row = {}, None
    if not os.path.exists(p):
        return rows
    for line in open(p, encoding="utf-8"):
        m = re.match(r"^###\s+(.+?)\s+—\s+(.+?)\s*$", line)
        if m:
            row = {"company": m.group(1), "title": m.group(2)}
            rows[(canon(m.group(1)), canon(m.group(2)))] = row
            continue
        m = re.match(r"^-\s+(Comp|Seen|Source URL|Status):\s*(.*)$", line)
        if m and row is not None:
            row[m.group(1).lower().replace(" ", "_")] = m.group(2).strip()
    return rows


def save_leads(workspace, rows):
    out = ["# Leads — INTERNAL working file (the agent validates; not homework)",
           "# A lead is unvalidated by definition. The pipeline confirms it against",
           "# the employer's own board/careers site and promotes it into jobs.md,",
           "# or it expires. Kept as the record for validation stats over time.", ""]
    for r in rows.values():
        out.append(f"### {r['company']} — {r['title']}")
        for label, k in [("Comp", "comp"), ("Seen", "seen"),
                         ("Source URL", "source_url"), ("Status", "status")]:
            if r.get(k):
                out.append(f"- {label}: {r[k]}")
        out.append("")
    with open(os.path.join(workspace, "leads.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(out).rstrip() + "\n")


def append_lead(workspace, company, title, comp, seen, source_url):
    rows = load_leads(workspace)
    k = (canon(company), canon(title))
    if k in rows:
        return False
    rows[k] = {"company": company, "title": title, "comp": comp or "",
               "seen": seen, "source_url": source_url or "", "status": "unconfirmed"}
    save_leads(workspace, rows)
    return True


def validate_leads(workspace, by_key, stale_days=30, feed_index=None,
                   swept=None, companies=None, jrows=None, now=None):
    """The validation ladder, automatic for every aggregator-sourced lead:

      1. role already in the pipeline           -> promoted
      2. role on the swept company's RAW feed   -> promoted: pipeline row
         created with the EMPLOYER URL (our thesis filters are a measured
         false-negative source; a lead already matched the plan's queries)
      3. company swept, role absent from feed   -> dead ("not on the
         employer's board") — the strong negative, no waiting
      4. company not in the universe            -> add it (source:
         discovery-lead) so the NEXT sweep validates automatically
      5. company unresolved                     -> stays unconfirmed; the
         agent's careers-site check or the stale window decides

    Exact canonical title match only — a retitled role re-enters as a new
    lead rather than fuzzy-matching the wrong one. Returns
    (promoted, dead, expired, added_companies)."""
    rows = load_leads(workspace)
    feed_index, swept = feed_index or {}, swept or set()
    promoted = dead = expired = added = 0
    today = datetime.now(timezone.utc).date().isoformat()
    cutoff = datetime.now(timezone.utc).timestamp() - stale_days * 86400
    for k, r in rows.items():
        if not r.get("status", "").startswith("unconfirmed"):
            continue
        ck = k[0]
        if k in by_key:
            r["status"] = f"confirmed → promoted {today}"
            promoted += 1
        elif k in feed_index and jrows is not None:
            title, url, loc = feed_index[k]
            jrow = {"company": r["company"], "title": title, "stage": "To Review",
                    "dismissed": False, "url": url, "location": loc,
                    "seen_at": now, "updated_at": now,
                    "flags": "lead-promoted (bypassed thesis filters)"}
            jrows.append(jrow); by_key[k] = jrow
            r["status"] = f"confirmed → promoted {today} (employer URL)"
            promoted += 1
        elif ck in swept:
            r["status"] = f"dead {today} — not on the employer's board"
            dead += 1
        elif companies is not None and ck not in companies:
            companies[ck] = {"name": r["company"], "source": f"discovery-lead {today}",
                             "evidence": (f"{r['title']} {r.get('comp','')}".strip())[:140],
                             "status": "new", "board": ""}
            added += 1
        else:
            m = re.search(r"(\d{4}-\d{2}-\d{2})", r.get("seen") or "")
            if m:
                try:
                    if datetime.fromisoformat(m.group(1) + "T00:00:00+00:00").timestamp() < cutoff:
                        r["status"] = f"dead {today} — expired unvalidated"
                        expired += 1
                except ValueError:
                    pass
    save_leads(workspace, rows)
    return promoted, dead, expired, added

# ---- SimHash cross-listing (ported from career-ops, MIT: the employer+agency
# double-post evades URL dedup AND company+title dedup — agencies strip the
# employer name but rarely rewrite the JD body. Warn-only; a double
# submission burns the candidate with both parties.) --------------------------
def simhash64(text):
    tokens = re.findall(r"[a-z0-9]{3,}", (text or "").lower())
    if len(tokens) < 20:          # no body -> no signal, no false positives
        return 0
    import hashlib
    # bigram shingles, not unigrams: a reposted JD keeps its PHRASES intact,
    # so an agency's edited opener moves only its own shingles — unigram
    # hashing let single word swaps flip too many bits to hold the 92% bar
    grams = [f"{a} {b}" for a, b in zip(tokens, tokens[1:])]
    v = [0] * 64
    for t in grams:
        h = int.from_bytes(hashlib.md5(t.encode()).digest()[:8], "big")
        for i in range(64):
            v[i] += 1 if (h >> i) & 1 else -1
    out = 0
    for i in range(64):
        if v[i] > 0:
            out |= 1 << i
    return out


def sim_pct(a, b):
    if not a or not b:
        return 0.0
    return 1.0 - bin(a ^ b).count("1") / 64.0


# ---- trust flags (ported from career-ops, MIT: flag-only, never drops) ------
SUSPICIOUS_DOMAINS = {"bit.ly", "tinyurl.com", "t.co", "forms.gle", "goo.gl",
                      "shorturl.at", "rebrand.ly", "cutt.ly"}


def trust_flags(url):
    flags = []
    try:
        host = urllib.parse.urlparse(url).netloc.lower()
        if not host:
            flags.append("invalid-url")
        elif any(host == d or host.endswith("." + d) for d in SUSPICIOUS_DOMAINS):
            flags.append("shortener-domain")
    except Exception:
        flags.append("invalid-url")
    return flags


# ---- liveness (patterns ported from career-ops, MIT — earned the hard way:
# portals write closure banners with TYPOGRAPHIC punctuation (U+2019, not ');
# an ASCII-spelled pattern silently never matches. And Phenom-class SPAs say
# "the job you are trying to apply for has been filled" — but a LIVE page
# saying "once the application form has been filled..." must NOT match.) -----
def normalize_for_match(text):
    text = re.sub(r"[\u2018\u2019\u02bc\u2032\u00b4`]", "'", text or "")
    text = re.sub(r"[\u201c\u201d\u2033]", '"', text)
    return re.sub(r"\s+", " ", text)


HARD_EXPIRED = [re.compile(p, re.I) for p in [
    r"job (is )?no longer available",
    r"\b(?:job|jobs|position|role|posting|opening|vacancy|requisition|req|listing)\b[\s\S]{0,60}?(?<!application )(?<!form )has been filled\b(?!\s+out)",
    r"this job has expired", r"job posting has expired",
    r"no longer accepting applications",
    r"this (position|role|job) (is )?no longer",
    r"this job (listing )?is closed", r"job (listing )?not found",
]]


def posting_dead(url):
    """True only on POSITIVE evidence of death (404/410 or a closure banner).
    Uncertainty is never 'dead' — closing a live posting is the worse error."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "10xjobs-plugin"})
        with urllib.request.urlopen(req, timeout=10) as r:
            body = normalize_for_match(r.read(60000).decode("utf-8", "replace"))
        return any(p.search(body) for p in HARD_EXPIRED)
    except urllib.error.HTTPError as e:
        return e.code in (404, 410)
    except Exception:
        return False


def board_str(t):
    return ":".join(x for x in [t[0], t[1], t[2] or "", t[3] or ""] if x is not None).rstrip(":")


def board_tuple(txt):
    if not txt or txt == "none":
        return None
    parts = (txt.split(":") + [None, None, None, None])[:4]
    return (parts[0], parts[1], parts[2] or None, parts[3] or None)


def resolve(crow, name):
    """Resolution ladder against the companies.md Board cell (the cache):
    cached -> bespoke map -> identity-verified slug probe. 'none' caches a
    definitive miss so unresolved companies aren't re-probed every sweep."""
    cached = board_tuple((crow or {}).get("board"))
    if cached:
        return cached
    if (crow or {}).get("board") == "none":
        return None
    if canon(name) in BESPOKE_GIANTS:
        t = ("hiring_cafe", BESPOKE_GIANTS[canon(name)], None, None)
        if crow is not None:
            crow["board"] = board_str(t)
        return t
    # Known gap (2026-08-14, Lorikeet audit): a single-word name yields a
    # STRONG slug that binds without identity verification — right company
    # that night, but nothing guarantees it. Tighten if a wrong-board
    # incident ever occurs.
    for vendor in PROBE_VENDORS:  # workday is never slug-probed (needs the 3-tuple; use --register)
        for slug, weak in slugs(name):
            try:
                if fetch_postings(vendor, slug, None, None):
                    if weak and verify_identity(vendor, slug, name) is not True:
                        continue  # a live board that we can't confirm is THIS company
                    t = (vendor, slug, None, None)
                    if crow is not None:
                        crow["board"] = board_str(t)
                    return t
            except Exception:
                continue
    if crow is not None:
        crow["board"] = "none"
    return None



def register(workspace, spec):
    """--register 'Company=<any careers URL>': parse -> validate -> probe once
    -> cache. Loud-fail on anything ambiguous; never store an unverified path."""
    if "=" not in spec:
        sys.exit("--register wants Company=<url> (or Company=hiring_cafe for a bespoke-site giant)")
    name, url = spec.split("=", 1)
    if url.strip() == "hiring_cafe":
        parsed = ("hiring_cafe", name.strip(), None, None)
    else:
        parsed = parse_ats_url(url.strip())
    if not parsed:
        sys.exit(f"could not parse an ATS path from {url!r} — recognized: "
                 "myworkdayjobs.com, greenhouse.io, lever.co, ashbyhq.com, smartrecruiters.com")
    vendor, slug, dc, site = parsed
    try:
        n = len(fetch_postings(vendor, slug, dc, site))
    except Exception as e:
        sys.exit(f"parsed {vendor}:{slug} but the endpoint probe failed: {e} — not caching an unverified path")
    rows = load_companies_md(workspace)
    k = canon(name.strip())
    row = rows.get(k) or {"name": name.strip(), "source": f"discovery-register {datetime.now(timezone.utc).date().isoformat()}",
                          "evidence": "registered by URL", "status": "new"}
    row["board"] = board_str((vendor, slug, dc, site))
    rows[k] = row
    write_companies_md(workspace, rows)
    print(f"registered: {name.strip()} -> {vendor}:{slug}"
          + (f" ({dc}/{site})" if dc else "") + f" — probe returned {n} postings")
    return (name.strip(), vendor, slug, dc, site, n)


def submit_discovery(workspace, name, vendor, slug, dc, site, jobs_seen):
    """Cloud write-back (network-effect seam): fire-and-forget POST of the
    company->ATS mapping ONLY — never user identity or criteria. No-ops
    unless market-api.json opts in with submit_url."""
    cfg_path = os.path.join(workspace, "market-api.json")
    try:
        cfg = json.load(open(cfg_path)) if os.path.exists(cfg_path) else {}
        if not cfg.get("submit_url"):
            return
        req = urllib.request.Request(
            cfg["submit_url"],
            data=json.dumps({"company": name, "vendor": vendor, "slug": slug,
                             "datacenter": dc, "site": site, "jobs_seen": jobs_seen}).encode(),
            headers={"x-api-key": cfg.get("key", ""), "Content-Type": "application/json",
                     "User-Agent": "10xjobs-plugin"})
        urllib.request.urlopen(req, timeout=10).read()
        print("discovery submitted to the shared map (staging — verified before promotion)")
    except Exception as e:
        print(f"discovery submit skipped ({e})", file=sys.stderr)


def fetch_api_targets(workspace):
    """Market-data API seam: pull the curated company->ATS map from the
    10xjobs cloud. Returns (targets, paths) or (None, None) on ANY miss —
    caller falls back to the local list silently. paths values are
    (vendor, slug, datacenter, site)."""
    cfg_path = os.path.join(workspace, "market-api.json")
    if not os.path.exists(cfg_path):
        return None, None
    try:
        cfg = json.load(open(cfg_path))
        url = cfg["url"] + ("?" + cfg["params"] if cfg.get("params") else "")
        req = urllib.request.Request(url, headers={"x-api-key": cfg["key"], "User-Agent": "10xjobs-plugin"})
        with urllib.request.urlopen(req, timeout=15) as r:
            body = json.load(r)
        targets, paths = [], {}
        for t in body.get("targets", []):
            if t.get("company") and t.get("vendor") in VENDORS and t.get("slug"):
                if t["vendor"] == "workday" and not (t.get("datacenter") and t.get("site")):
                    continue  # a workday row without its 3-tuple is unusable
                targets.append(t["company"])
                paths[t["company"]] = (t["vendor"], t["slug"], t.get("datacenter"), t.get("site"))
        return (targets, paths) if targets else (None, None)
    except Exception as e:
        print(f"market-data API unavailable ({e}) — falling back to local list", file=sys.stderr)
        return None, None



def run_discovery(a, crit, crit_source):
    """--discover-roles: measure the market, surface unknown employers.

    Report-only by design. The aggregator rule (SKILL.md) is that global
    results feed the COMPANY universe, never the board — so this prints, and
    only writes companies.md when explicitly asked."""
    user_companies, _ = parse_criteria_md(a.workspace)
    known = set(load_companies_md(a.workspace)) | {canon(n) for n in user_companies}
    queries = ([q.strip() for q in a.queries.split(",") if q.strip()] if a.queries
               else list(crit["themes"]))
    print(f"role-first discovery · {len(queries)} query angles · criteria from {crit_source}")
    if crit.get("comp_floor"):
        print(f"comp floor: ${crit['comp_floor']:,} (posted MAX below this is a miss; "
              f"undisclosed is never a miss)")
    print()
    kept, reasons, per_query = discover_roles(crit, queries, known=known)

    raw = sum(n for _, n in per_query)
    print(f"\nraw postings: {raw}   kept: {len(kept)}")
    if reasons:
        print("rejections: " + "  ".join(f"{k}={v}" for k, v in sorted(reasons.items())))

    disclosed = [r for r in kept if (r["_meta"] or {}).get("comp_max")]
    print(f"\ncomp disclosed: {len(disclosed)} of {len(kept)}")
    print()
    for r in sorted(kept, key=lambda x: -((x["_meta"] or {}).get("comp_max") or 0)):
        m = r["_meta"] or {}
        lo, hi = m.get("comp_min") or 0, m.get("comp_max") or 0
        pay = f"${lo//1000:>3}-{hi//1000:<3}K" if hi else "     —     "
        flag = "NEW " if r.get("_new_company") else "    "
        print(f"  {flag}{pay}  {r['company'][:24]:<24} {r['title'][:48]:<48} {r['loc'][:26]}")

    today = datetime.now(timezone.utc).date().isoformat()
    n_leads = 0
    for r in kept:
        m = r["_meta"] or {}
        comp = (f"${(m.get('comp_min') or 0)//1000}-{(m.get('comp_max') or 0)//1000}K"
                if m.get("comp_max") else "")
        n_leads += append_lead(a.workspace, r["company"], r["title"], comp,
                               f"hiring.cafe, {today}", r.get("_url") or "")
    if n_leads:
        print(f"\nrecorded {n_leads} lead(s) -> leads.md (unconfirmed until an employer board shows them)")
    fresh = []
    for r in kept:
        if r.get("_new_company") and r["company"] and canon(r["company"]) not in {canon(x) for x in fresh}:
            fresh.append(r["company"])
    print(f"\nNEW companies (not in the working set): {len(fresh)}")
    for n in fresh:
        print(f"  {n}")

    if fresh and a.append_companies:
        added = 0
        for n in fresh:
            ex = next(r for r in kept if canon(r["company"]) == canon(n))
            m = ex["_meta"] or {}
            pay = f" ${(m.get('comp_min') or 0)//1000}-{(m.get('comp_max') or 0)//1000}K" if m.get("comp_max") else ""
            added += append_discovered(a.workspace, n, "role-first", f"{ex['title'][:60]}{pay}")
        print(f"\nadded {added} companies to companies.md")
    elif fresh:
        print("\n(re-run with --append-companies to add these to the universe)")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", required=True, help="dir containing jobs.db and jd-inbox/")
    p.add_argument("--max-per-company", type=int, default=None,
                   help="intake throttle: max NEW roles admitted per company per run")
    p.add_argument("--register", help="Company=<careers/ATS url> — parse, verify-probe, cache; then exit")
    p.add_argument("--discover-roles", action="store_true",
                   help="GLOBAL role-first sweep (measure the market, find unknown employers). "
                        "Report-only: never writes board rows — discovery finds COMPANIES.")
    p.add_argument("--queries",
                   help="comma-separated title angles for --discover-roles; default = criteria themes. "
                        "Fan-out is the point: one query is thin, a dozen is the widest instrument there is.")
    p.add_argument("--append-companies", action="store_true",
                   help="with --discover-roles: append NEW companies to companies.md with provenance")
    a = p.parse_args()

    if a.register:
        name, vendor, slug, dc, site, n = register(a.workspace, a.register)
        submit_discovery(a.workspace, name, vendor, slug, dc, site, n)
        return 0
    jrows = jm.load(a.workspace)
    by_key = {jm.key(r): r for r in jrows}

    crit, crit_source = load_criteria(a.workspace)

    if a.discover_roles:
        return run_discovery(a, crit, crit_source)
    # The two-file company model: criteria.md § Target companies is the
    # candidate's (always swept, theme filter relaxed — the old * watchlist
    # treatment, now uniform); companies.md is THE working set, script-owned,
    # regenerated for criteria rows and persistent for discovered/cloud rows.
    api_targets, api_paths = fetch_api_targets(a.workspace)
    user_companies, settings = parse_criteria_md(a.workspace)
    crit["target_yield"] = settings.get("target_yield", crit["target_yield"])
    max_per = a.max_per_company if a.max_per_company is not None else settings["max_per_company"]
    rows = load_companies_md(a.workspace)
    # one-time legacy migration: companies.txt lines become discovered rows
    legacy = os.path.join(a.workspace, "companies.txt")
    if os.path.exists(legacy) and not any(r["source"].startswith("legacy") for r in rows.values()):
        migrated = 0
        for l in open(legacy):
            name = l.split("#")[0].strip().lstrip("*").strip()
            if name and canon(name) not in rows and canon(name) not in {canon(c) for c in user_companies}:
                rows[canon(name)] = {"name": name, "source": "legacy-companies.txt",
                                     "evidence": "", "status": "new"}
                migrated += 1
        if migrated:
            print(f"NOTE: migrated {migrated} companies.txt rows into companies.md; "
                  f"move the ones YOU care about to criteria.md § Target companies — "
                  f"companies.txt is retired and no longer read after this run")
    # rebuild criteria rows from the user's section (their deletions propagate)
    rows = {k: r for k, r in rows.items() if r["source"] != "criteria"}
    watch_keys = set()
    for name in user_companies:
        k = canon(name)
        watch_keys.add(k)
        rows[k] = {"name": name, "source": "criteria", "evidence": "", "status": "new"}
    for name in (api_targets or []):
        k = canon(name)
        if k not in rows:
            rows[k] = {"name": name, "source": "cloud", "evidence": "", "status": "new"}
    if not rows:
        for name in DEFAULT_TARGETS:
            rows[canon(name)] = {"name": name, "source": "cloud", "evidence": "built-in starter list", "status": "new"}
    targets = [r["name"] for r in rows.values()]
    src_of = {canon(r["name"]): r["source"].split("-")[0] for r in rows.values()}
    print(f"targets: {len(targets)} companies "
          f"(criteria {sum(1 for r in rows.values() if r['source']=='criteria')} · "
          f"discovered {sum(1 for r in rows.values() if r['source'] not in ('criteria','cloud'))} · "
          f"cloud {sum(1 for r in rows.values() if r['source']=='cloud')}) · criteria: {crit_source}")
    print(f"settings: yield {crit['target_yield']} · max/company {max_per} · "
          f"active cap {settings['active_cap']} · stale after {settings['stale_days']}d "
          f"(defaults unless set in criteria.md § Search settings)")

    os.makedirs(os.path.join(a.workspace, "jd-inbox"), exist_ok=True)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    swept_ok, feed_keys = set(), set()
    feed_index = {}  # (company,title) -> raw board posting — lead validation checks THIS  # delisting detection (lifecycle end)
    scanned = inserted = deduped = throttled = 0
    by_source = {}   # admitted rows per target source — the plan-revision evidence
    # Every reason filter_reason can return must be seeded, or the sweep dies
    # mid-run on the first novel rejection (KeyError 'ic-title', 2026-08-04 —
    # adding a reason to filter_reason and not here crashed a 175-company
    # sweep). REJECTION_REASONS is the single list both sides read.
    reasons = {r: 0 for r in REJECTION_REASONS}
    resolved, unresolved, new_rows = [], [], []
    if api_paths:
        for name, (vendor, slug, dc, site) in api_paths.items():
            if canon(name) in rows:
                rows[canon(name)]["board"] = board_str((vendor, slug, dc, site))
            _unused = (canon(name), vendor, slug, dc, site)

    for name in targets:
        hit = resolve(rows.get(canon(name)), name)
        if not hit:
            unresolved.append(name)
            continue
        vendor, slug, dc, site = hit
        resolved.append(f"{name} ({vendor}:{slug})")
        try:
            postings = fetch_postings(vendor, slug, dc, site, crit)
        except Exception as e:
            unresolved.append(f"{name} (fetch error: {e})")
            continue
        swept_ok.add(canon(name))
        kept = 0
        for post in postings:
            title, loc, url, desc = extract(vendor, post)
            scanned += 1
            if title:
                feed_keys.add((canon(name), canon(title)))
                feed_index[(canon(name), canon(title))] = (title, url, loc)
            if not title or not url:
                continue
            why = filter_reason(title, loc, crit, watch=canon(name) in watch_keys)
            if why:
                reasons[why] += 1
                continue
            ck, tk = canon(name), canon(title)
            jrow = by_key.get((ck, tk))
            if jrow:
                if not jrow.get("posted_at"):
                    pa = posted_iso(vendor, post)
                    if pa:
                        jrow["posted_at"] = pa
                deduped += 1
                continue
            if kept >= max_per:
                throttled += 1
                continue
            fslug = re.sub(r"[^a-z0-9]+", "-", f"{name}-{title}".lower()).strip("-")[:80]
            jd_rel = f"jd-inbox/{fslug}.md"
            prov = f"\n# Criteria: {crit_source}" if crit["widened_by"] else ""
            body = re.sub(r"[ \t]+", " ", desc).strip() or "(JD body not fetched for this vendor — evaluate fetches from the source URL)"
            with open(os.path.join(a.workspace, jd_rel), "w") as f:
                f.write(f"# {name} — {title}\n# Source: {url}{prov}\n\n{body}\n")
            sim = simhash64(body)
            fl = ",".join(trust_flags(url)) or None
            jrow = {"company": name, "title": title, "stage": "To Review",
                    "dismissed": False, "url": url, "location": loc,
                    "jd_file": jd_rel, "seen_at": now, "updated_at": now,
                    "posted_at": posted_iso(vendor, post),
                    "jd_sim": f"{sim:016x}" if sim else None, "flags": fl}
            jrows.append(jrow); by_key[(ck, tk)] = jrow
            # cross-listing check (career-ops SimHash, warn-only): same JD body
            # under a DIFFERENT company = likely employer+agency double-post.
            if sim:
                for o in jrows:
                    if o is not jrow and o.get("jd_sim") and canon(o["company"]) != ck \
                            and sim_pct(sim, int(o["jd_sim"], 16)) >= 0.92:
                        new_rows.append((2, f"⚠ cross-listed? '{name} — {title}' ≈ '{o['company']} — {o['title']}' "
                                            f"(near-identical JD; if one is an agency, apply through ONE channel only)"))
                        break
            inserted += 1
            by_source[src_of.get(ck, "?")] = by_source.get(src_of.get(ck, "?"), 0) + 1
            kept += 1
            is_watch = canon(name) in watch_keys
            new_rows.append((0 if is_watch else 1,
                             ("★ " if is_watch else "") + f"{name} — {title} [{loc}]"
                             + (" (widened)" if crit["widened_by"] else "")))
    # Lifecycle end for untouched rows: a posting gone from a successfully swept
    # company's feed is delisted -> auto-dismiss, but ONLY stage='To Review'
    # rows the candidate never engaged. Interested/Applied/Interviewing rows are
    # never auto-closed — a vanished posting there is coach-conversation
    # material (outcome unknown: ask, never guess).
    delisted = 0
    for r in jrows:
        if r.get("dismissed") or r.get("stage") != "To Review":
            continue
        ck, tk = jm.key(r)
        if ck in swept_ok and (ck, tk) not in feed_keys:
            r["dismissed"] = True
            r["dismiss_reason"] = f"delisted (gone from ATS feed {now[:10]})"
            r["updated_at"] = now
            delisted += 1
    # write companies.md: the working set with per-company status
    unresolved_keys = {canon(u.split(" (")[0]) for u in unresolved}
    for k, r in rows.items():
        r["status"] = ("swept" if k in swept_ok else
                       "unresolved" if k in unresolved_keys else "no-ats")
    write_companies_md(a.workspace, rows)

    # lifecycle: stale untouched rows get ONE cheap liveness probe; positive
    # evidence of death -> closed. Engaged rows are NEVER auto-closed — a
    # vanished posting there is coach-conversation material.
    stale_cut = (datetime.now(timezone.utc)
                 .timestamp() - settings["stale_days"] * 86400)
    closed = stale_engaged = 0
    for r in jrows:
        if r.get("dismissed"):
            continue
        try:
            ts = datetime.fromisoformat((r.get("updated_at") or "").replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        if ts > stale_cut:
            continue
        if r.get("stage") != "To Review":
            stale_engaged += 1
            continue
        if r.get("url") and posting_dead(r["url"]):
            r["dismissed"] = True
            r["dismiss_reason"] = f"closed (posting gone, stale {settings['stale_days']}d+, {now[:10]})"
            r["updated_at"] = now
            closed += 1
    active = sum(1 for r in jrows if not r.get("dismissed") and r.get("stage") == "To Review")
    # promote any lead confirmed by this sweep (its role now sits in the record)
    promoted, lead_dead, lead_expired, lead_added = validate_leads(
        a.workspace, by_key, settings["stale_days"], feed_index=feed_index,
        swept=swept_ok, companies=rows, jrows=jrows, now=now)
    if lead_added:
        write_companies_md(a.workspace, rows)
    jm.save(a.workspace, jrows)

    if promoted:
        print(f"promoted {promoted} lead(s) — confirmed on the employer's own board")
    if lead_dead:
        print(f"marked {lead_dead} lead(s) dead — swept the employer's board, role not there")
    if lead_added:
        print(f"added {lead_added} lead company(ies) to the universe — next sweep validates them")
    if lead_expired:
        print(f"expired {lead_expired} unvalidated lead(s) ({settings['stale_days']}d) — never confirmed, never shown")
    if closed:
        print(f"closed {closed} stale roles whose postings are gone")
    if stale_engaged:
        print(f"{stale_engaged} ENGAGED rows stale {settings['stale_days']}d+ — never auto-closed; "
              f"worth a coach conversation")
    if active > settings["active_cap"]:
        print(f"active To Review = {active} > cap {settings['active_cap']} — surface only the top few; "
              f"the pipeline needs a triage pass more than it needs new roles")
    if delisted:
        print(f"delisted {delisted} To-Review roles (vanished from their ATS feeds)")
    print(f"resolved {len(resolved)}/{len(targets)} companies; scanned {scanned} postings; "
          f"inserted {inserted} new, {deduped} already known, {throttled} throttled")
    print("yield by source: " + (" ".join(f"{k}={v}" for k, v in sorted(by_source.items())) or "none")
          + "   (the plan-revision evidence)")
    print("rejections: " + " ".join(f"{k}={reasons[k]}" for k in REJECTION_REASONS)
          + f" unresolved-companies={len(unresolved)}")
    if unresolved:
        print("unresolved:", ", ".join(unresolved))
    if inserted < crit["target_yield"]:
        dominant = max(reasons, key=reasons.get)
        print(f"THIN RESULT ({inserted} < target_yield {crit['target_yield']}). Evidence: "
              f"{'company resolution is the bottleneck' if len(unresolved) >= max(reasons.values()) else f'dominant filter rejection = {dominant}'}."
              f" Widening levers: companies (expand list / --register discoveries) · themes (adjacent titles)"
              f" · seniority_regex (band) — one lever per pass, max 2 passes, record it in criteria.json widened_by.")
    for _, r in sorted(new_rows):
        print("  NEW:", r)
    return 0


if __name__ == "__main__":
    sys.exit(main())
