#!/usr/bin/env python3
"""Build the user's PRIVATE eval set from jobs.db + jd-analysis + package jd.md files -> evals/private/ (gitignored; never commit).
  build_private.py                 (re)build ~40-60 cases: applied/interviewed, user skips with reasons, dealbreaker skips,
                                   borderline, and edge cases (public sector, under the pay floor, Director at a late-stage company)
  build_private.py --append-disagreements [--days 7]   weekly hook: append roles where the user's action disagreed with the call
Profiles point to criteria.md and the lane base resumes (paths from scoring.yaml)."""

# Portable path/config adapter; pipeline implementation below is retained.
from pathlib import Path as _JobbiPath
import os as _jobbi_os, sys as _jobbi_sys
_JOBBI_ROOT = _JobbiPath(_jobbi_os.environ.get("JOBBI_ROOT", str(_JobbiPath(__file__).resolve().parents[4])))
_jobbi_sys.path.insert(0, str(_JOBBI_ROOT))
from runtime_config import policy as _jobbi_policy, candidate as _jobbi_candidate
_JOBBI_SEARCH = _JOBBI_ROOT / "workspace" / "job-search"
_JOBBI_APPS = _JOBBI_ROOT / "workspace" / "job-apps"
_JOBBI_POLICY = _jobbi_policy(_JOBBI_ROOT)
_JOBBI_CAND = _jobbi_candidate(_JOBBI_ROOT)

import argparse, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PIPE = os.path.dirname(HERE)
sys.path.insert(0, PIPE)
import jobsdb as J, yaml   # noqa: E402

PRIV = os.path.join(HERE, "private")
DB_TO_CODE = {"geo": "geo", "pay": "pay", "clearance/sponsorship": "clearance", "stage/size": "stage", "seniority": "seniority",
              "off-lane": "off-lane", "domain/specialty": "off-lane", "one-role-per-company": "company-in-play", "brand/hot rule": "other"}
LANE_BASE = {"TPM": "tpm", "FDE/Solutions": "solutions-fde-delivery", "FDE": "solutions-fde-delivery", "Solutions": "solutions-fde-delivery",
             "Eng Manager": "eng-manager", "Eng": "eng-manager", "IC builder": "ic-builder"}

def profiles():
    sc = yaml.safe_load(open(os.path.join(PIPE, "scoring.yaml")).read().replace("${JOBBI_ROOT}", str(_JOBBI_ROOT)))
    src = yaml.safe_load(open(os.path.join(PIPE, "sources.yaml")))
    rules = _JOBBI_POLICY.get("eval_rules", {})
    out = {}
    for base in ("tpm", "solutions-fde-delivery", "eng-manager", "ic-builder"):
        out[f"user-{base}"] = {"label": "PRIVATE: the user's own profile (do not commit)", "criteria_path": os.path.join(J.WS, "criteria.md"),
                               "resume_path": os.path.join(sc["base_resumes_dir"], base, sc.get("resume_file", "resume-native.md")), "rules": rules}
    return out

def saved_texts(r):
    """Ordered saved evidence; never infer a location from company HQ or a URL."""
    package = (r["package_path"] or "").rstrip(".")
    paths = ([os.path.join(package, "jd.md")] if package else []) + ([os.path.join(J.WS, r["analysis_path"])] if r["analysis_path"] else [])
    for p in paths:
        if p and os.path.isfile(p):
            yield open(p).read(), os.path.relpath(p, J.WS) if p.startswith(J.WS + os.sep) else p
    yield r["notes"] or "", "notes"


def jd_text(r):
    for text, source in saved_texts(r):
        if source != "notes":
            return text[:12000], source
        return "(JD text not saved; tracker notes) " + text[:3000], source


def extract_location(text):
    """Conservative literal extraction, preserving an auditable quote.

    Prefer labelled metadata. Fallbacks require work-location language, not a
    bare city mention (which might just describe HQ, travel, or compensation).
    """
    clean = re.sub(r"[*`_]", "", text)
    m = re.search(r"(?im)^\s*(?:[-•]\s*)?(?:work\s+)?(?:location|loc|geo)\s*:\s*([^\n|]+)", clean)
    if m and m.group(1).strip():
        return m.group(1).strip()[:250], m.group(0).strip()[:300]
    # Explicit US remote statements, including tracker-note fragments.
    patterns = [
        r"\bRemote\s*[-–,]?\s*(?:US(?:A)?|United States)\b[^;\n.]{0,60}",
        r"\b(?:fully\s+remote|100%\s+remote|remote[- ]first)\b[^;\n.]{0,100}",
        _JOBBI_POLICY.get("local_remote_extract_regex", r"(?!)"),
        _JOBBI_POLICY.get("local_onsite_extract_regex", r"(?!)"),
    ]
    for pat in patterns:
        m = re.search(pat, clean, re.I)
        if m:
            return m.group(0).strip()[:250], m.group(0).strip()[:300]
    return "", ""


def location_of(r):
    if (r["location"] or "").strip():
        return r["location"], {"source": "jobs.db.location", "quote": r["location"]}
    for text, source in saved_texts(r):
        loc, quote = extract_location(text)
        if loc:
            return loc, {"source": source, "quote": quote}
    return "", {"source": "unverified", "quote": ""}


def recorded(r):
    """what the live scorer said at the time (two-way rows) or the legacy single-score fit."""
    n = r["notes"] or ""
    gaps = [g.strip(" .;") for g in re.findall(r"Gaps?:\s*([^·|]{4,160})", n)][:4]
    if r["status"] == "Skipped" and r["skipped_by"] == "agent" and r["skip_reason"] in DB_TO_CODE:
        return {"want": "fail", "want_reasons": [f"agent skip: {r['skip_reason']}"], "dealbreakers": [DB_TO_CODE[r["skip_reason"]]],
                "win": None, "must_haves": [], "gaps": [], "blockers": [], "reason": (r["legacy_status"] or "Skipped") + ": " + n[:300]}
    fit = r["fit"]
    if (r["scored_with"] or "").startswith("two-way") and r["want"]:
        if r["want"] == "fail":
            return {"want": "fail", "want_reasons": ["two-way want fail"], "dealbreakers": [DB_TO_CODE.get(r["skip_reason"] or "", "other")],
                    "win": None, "must_haves": [], "gaps": [], "blockers": [], "reason": n[-300:] or "want fail"}
        return {"want": "pass", "want_reasons": ["two-way want pass"], "dealbreakers": [], "win": r["win"],
                "must_haves": [{"need": "see jd-analysis", "proof": r["analysis_path"]}], "gaps": gaps,
                "blockers": ["recorded blocker"] if fit == "Weak" else [], "reason": f"two-way record: fit {fit}"}
    if fit in ("Strong", "Solid", "Stretch"):
        return {"want": "pass", "want_reasons": ["legacy single-score fit (pre two-way)"], "dealbreakers": [],
                "win": {"Strong": "high", "Solid": "medium", "Stretch": "low"}[fit],
                "must_haves": [{"need": "legacy record (no must-have list)", "proof": None}], "gaps": gaps, "blockers": [],
                "reason": f"legacy fit {fit}: " + n[:250]}
    if fit in ("Skip", "Weak"):
        return {"want": "fail", "want_reasons": ["legacy fit " + fit], "dealbreakers": ["other"], "win": None, "must_haves": [], "gaps": [], "blockers": [],
                "reason": f"legacy fit {fit}"}
    return None   # no recorded call (counts as invalid output for the recorded backend)

def to_case(r, outcome, expected, dealbreakers=(), why="", tags=()):
    jd, jd_src = jd_text(r)
    location, location_evidence = location_of(r)
    base = LANE_BASE.get(r["lane"] or "", "ic-builder" if re.search(r"engineer", r["title"], re.I) else "tpm")
    return {"id": f"job-{r['id']}", "suite": "private", "label": "PRIVATE (user data; never commit)", "job_id": r["id"], "profile": f"user-{base}",
            "posting": {"company": r["company"], "title": r["title"], "location": location, "pay": r["pay_text"] or "",
                        "jd_text": jd, "url": r["url"]},
            "jd_source": jd_src, "location_evidence": location_evidence, "expected": {"call": expected, "dealbreakers": list(dealbreakers)}, "outcome": outcome,
            "reason": why, "tags": list(tags), "status_at_build": r["status"], "recorded": recorded(r)}

def select(c):
    q = lambda sql, *a: c.execute(sql, a).fetchall()
    picks = []
    for r in q("SELECT * FROM jobs WHERE replied=1 OR status IN ('Interviewing','Offer')"):
        picks.append(to_case(r, "interviewed", ["Strong", "Solid"], why=f"user applied and the employer replied ({r['status']})", tags=["applied", "replied"]))
    for r in q("SELECT * FROM jobs WHERE status='Applied' AND package_path IS NOT NULL AND replied=0 ORDER BY applied_at DESC, date DESC LIMIT 14"):
        picks.append(to_case(r, "applied", ["Strong", "Solid"], why="user approved the package and applied", tags=["applied"]))
    for r in q("SELECT * FROM jobs WHERE status='Skipped' AND skipped_by='user' ORDER BY date DESC LIMIT 12"):
        picks.append(to_case(r, "user_skip", ["Skip", "Stretch"], [DB_TO_CODE[r["skip_reason"]]] if r["skip_reason"] in ("geo", "pay") else [],
                             why=f"user skipped ({r['skip_reason']})", tags=["user-skip", r["skip_reason"] or "other"]))
    for reason, n in (("geo", 3), ("pay", 3), ("clearance/sponsorship", 2)):
        for r in q("SELECT * FROM jobs WHERE status='Skipped' AND skipped_by='agent' AND skip_reason=? AND notes NOT LIKE '%cluster%' ORDER BY date DESC LIMIT ?", reason, n):
            picks.append(to_case(r, "agent_skip", ["Skip"], [DB_TO_CODE[reason]], why=f"dealbreaker: {reason}", tags=["dealbreaker", reason]))
    for r in q("SELECT * FROM jobs WHERE status='Skipped' AND (notes LIKE '%v6.1 out%' OR notes LIKE '%Series C+%' OR notes LIKE '%late-stage%') AND (title LIKE '%Director%' OR title LIKE '%Head of%' OR title LIKE '%VP%') ORDER BY date DESC LIMIT 4"):
        picks.append(to_case(r, "agent_skip", ["Skip"], ["stage"], why="Director-level at a Series C+/late-stage company (v6.1 gate)", tags=["edge", "director-late-stage"]))
    for r in q("SELECT * FROM jobs WHERE (company LIKE 'City of %' OR company LIKE 'City and County%' OR company LIKE '%County of%' OR company LIKE 'NASA%' OR company LIKE 'GSA%' OR company LIKE 'CMS /%' OR company LIKE '%Treasury%' OR company LIKE '%Trading Commission%' OR source LIKE 'gov:%') AND status!='Skipped' ORDER BY date DESC LIMIT 5"):
        picks.append(to_case(r, "rule", ["Stretch", "Solid"], why="public sector: in lane, pay under the floor counts as Stretch (criteria v6.2 item 4)", tags=["edge", "public-sector"]))
    for r in q("SELECT * FROM jobs WHERE status IN ('Held','Packaged') AND fit='Stretch' ORDER BY date DESC LIMIT 6"):
        picks.append(to_case(r, "borderline", ["Stretch", "Solid"], why=f"borderline: Stretch, {r['status']} but not applied", tags=["borderline"]))
    seen, out = set(), []
    for p in picks:
        if p["id"] not in seen:
            seen.add(p["id"]); out.append(p)
    return out

def write(cases, mode="w"):
    os.makedirs(os.path.join(PRIV, "profiles"), exist_ok=True)
    for k, v in profiles().items():
        json.dump(v, open(os.path.join(PRIV, "profiles", f"{k}.json"), "w"), indent=1)
    with open(os.path.join(PRIV, "cases.jsonl"), mode) as f:
        for cse in cases: f.write(json.dumps(cse, default=str) + "\n")
    with open(os.path.join(PRIV, ".gitignore"), "w") as f:
        f.write("# private eval data: never commit\n*\n")

def append_disagreements(c, days):
    path = os.path.join(PRIV, "cases.jsonl")
    have = {json.loads(l)["id"] for l in open(path)} if os.path.exists(path) else set()
    since = (J.dt.date.today() - J.dt.timedelta(days=days)).isoformat()
    new = []
    for r in c.execute("SELECT * FROM jobs WHERE updated_at >= ? AND fit IS NOT NULL", (since,)):
        if f"job-{r['id']}" in have: continue
        if r["status"] == "Skipped" and r["skipped_by"] == "user" and r["fit"] in ("Strong", "Solid"):
            new.append(to_case(r, "user_skip", ["Skip", "Stretch"], why=f"weekly disagreement: called {r['fit']}, user skipped ({r['skip_reason']})", tags=["disagreement"]))
        elif (r["status"] in ("Applied", "Interviewing", "Offer") or (r["status"] == "Interested" and r["skipped_by"] is None)) and r["fit"] in ("Stretch", "Weak", "Skip"):
            new.append(to_case(r, "applied" if r["status"] != "Interested" else "user_pick", ["Strong", "Solid"],
                               why=f"weekly disagreement: called {r['fit']}, user moved it to {r['status']}", tags=["disagreement"]))
    if new:
        write(new, mode="a")
    return len(new)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backfill-locations", action="store_true", help="rebuild location evidence for the existing historical cohort without reselecting or relabelling cases")
    ap.add_argument("--append-disagreements", action="store_true"); ap.add_argument("--days", type=int, default=7)
    a = ap.parse_args()
    if a.backfill_locations:
        import sqlite3
        c = sqlite3.connect("file:" + J.DB_PATH + "?mode=ro", uri=True)
        c.row_factory = sqlite3.Row
        path = os.path.join(PRIV, "cases.jsonl")
        cases = [json.loads(line) for line in open(path) if line.strip()]
        filled = 0
        for case in cases:
            if (case["posting"].get("location") or "").strip():
                continue
            row = c.execute("SELECT * FROM jobs WHERE id=?", (case["job_id"],)).fetchone()
            loc, evidence = location_of(row) if row is not None else ("", {"source": "unverified", "quote": ""})
            # The historical case's saved text may survive even if its file moved.
            if not loc:
                loc, quote = extract_location(case["posting"].get("jd_text") or "")
                if loc:
                    evidence = {"source": case.get("jd_source", "saved case JD"), "quote": quote}
            case["posting"]["location"] = loc
            case["location_evidence"] = evidence
            filled += bool(loc)
        with open(path, "w") as f:
            for case in cases:
                f.write(json.dumps(case, default=str) + "\n")
        c.close()
        print(f"backfilled {filled} locations; retained {len(cases)} historical cases and their original outcomes/recorded calls")
        return
    c = J.connect()
    if a.append_disagreements:
        print(f"appended {append_disagreements(c, a.days)} disagreement case(s) -> {PRIV}/cases.jsonl")
        return
    cases = select(c)
    write(cases)
    from collections import Counter
    print(len(cases), "cases ->", os.path.join(PRIV, "cases.jsonl"))
    print(dict(Counter(x["outcome"] for x in cases)), "| JD from:", dict(Counter("package/analysis" if x["jd_source"] != "notes" else "notes" for x in cases)))

if __name__ == "__main__":
    main()
