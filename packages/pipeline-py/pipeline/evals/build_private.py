#!/usr/bin/env python3
"""Build the user's PRIVATE eval set from jobs.db + jd-analysis + package jd.md files -> evals/private/ (gitignored; never commit).
  build_private.py                 (re)build ~40-60 cases: applied/interviewed, user skips with reasons, dealbreaker skips,
                                   borderline, and edge cases (public sector, under the pay floor, Director at a late-stage company)
  build_private.py --append-disagreements [--days 7]   weekly hook: append roles where the user's action disagreed with the call
Profiles point to criteria.md and the lane base resumes (paths from scoring.yaml)."""
import argparse, json, os, re
import yaml
from pipeline import home as H
from pipeline import jobsdb as J
from pipeline.score import cfg as scoring_cfg

PRIV = str(H.path("private_evals"))
DB_TO_CODE = {"geo": "geo", "pay": "pay", "clearance/sponsorship": "clearance", "stage/size": "stage", "seniority": "seniority",
              "off-lane": "off-lane", "domain/specialty": "off-lane", "one-role-per-company": "company-in-play", "brand/hot rule": "other"}

def lane_base():
    """lane -> base resume, from scoring.yaml lane_to_base."""
    return scoring_cfg().get("lane_to_base") or {}

def profiles():
    """one private profile per base resume. The rules backend reads `evals.rules` from agent-config.yaml
    (locations_ok, remote_us_ok, pay_floor, no_clearance, employee_only, skills); lanes and title excludes come from sources.yaml."""
    sc = scoring_cfg()
    sp = H.path("sources_file")
    src = (yaml.safe_load(sp.read_text()) or {}) if sp.exists() else {}
    rules = {"locations_ok": [], "remote_us_ok": True, "pay_floor": 0, "no_clearance": True, "employee_only": True, "skills": []}
    rules.update(H.setting("evals", "rules", {}) or {})
    rules["lanes"] = [p for v in (src.get("lanes") or {}).values() for p in v]
    rules["exclude"] = src.get("exclude_title", [])
    out = {}
    for base in sorted(set(lane_base().values())):
        out[f"user-{base}"] = {"label": "PRIVATE: the user's own profile (do not commit)", "criteria_path": str(H.path("criteria_file")),
                               "resume_path": os.path.join(sc["base_resumes_dir"], base, sc.get("resume_file", "resume-native.md")), "rules": rules}
    return out

def jd_text(r):
    for p in ([os.path.join(J.WS, r["package_path"], "jd.md")] if r["package_path"] else []) + ([os.path.join(J.WS, r["analysis_path"])] if r["analysis_path"] else []):
        if p and os.path.exists(p):
            return open(p).read()[:12000], os.path.relpath(p, J.WS) if p.startswith(J.WS) else p
    return "(JD text not saved; tracker notes) " + (r["notes"] or "")[:3000], "notes"

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
    lb = lane_base()
    base = lb.get(r["lane"] or "") or (sorted(set(lb.values())) or ["default"])[0]
    return {"id": f"job-{r['id']}", "suite": "private", "label": "PRIVATE (user data; never commit)", "job_id": r["id"], "profile": f"user-{base}",
            "posting": {"company": r["company"], "title": r["title"], "location": r["location"] or "", "pay": r["pay_text"] or "",
                        "jd_text": jd, "url": r["url"]},
            "jd_source": jd_src, "expected": {"call": expected, "dealbreakers": list(dealbreakers)}, "outcome": outcome,
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
    for r in q("SELECT * FROM jobs WHERE status='Skipped' AND skip_reason='stage/size' ORDER BY date DESC LIMIT 4"):
        picks.append(to_case(r, "agent_skip", ["Skip"], ["stage"], why="company stage or size outside criteria.md", tags=["edge", "stage"]))
    for r in q("SELECT * FROM jobs WHERE source LIKE 'gov:%' AND status!='Skipped' ORDER BY date DESC LIMIT 5"):
        picks.append(to_case(r, "rule", ["Stretch", "Solid"], why="public sector role kept in lane (see criteria.md for the pay-floor exception, if any)", tags=["edge", "public-sector"]))
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
    ap.add_argument("--append-disagreements", action="store_true"); ap.add_argument("--days", type=int, default=7)
    a = ap.parse_args()
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
