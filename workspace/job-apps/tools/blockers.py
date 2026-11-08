#!/usr/bin/env python3
"blockers.py: pre-build check (2026-11-04, source workflow revision simplification). Run it BEFORE building a package.\n\n  python3 blockers.py <job_id>            read jobs.db (read-only) + the package jd.md or the step-6 analysis\n  python3 blockers.py <jd-file> [--location L] [--pay P] [--url U]\n  add --json for machine output\n\nPrints one line per hit: BLOCKER (stop; build only after the user says yes) or WARN (plan for it). Exit 1 if any BLOCKER.\nRules are read from policy.yaml, not inherited from a former candidate:\n  BLOCKER: configured required skills/domain gaps, clearance constraints, location,\n           travel and pay limits, plus recorded step-6 blockers/dealbreakers.\n  WARN: preferred-only gaps, citizenship requirements needing the user's answer,\n        account-based ATSs, missing pay or unverified location.\nRegex only: it shows the evidence line so the call stays the user's. Never contacts the employer or submits anything."

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

import argparse, json, re, sqlite3, sys
from pathlib import Path
DB = Path(str(_JOBBI_SEARCH / 'pipeline/jobs.db'))
JS = Path(str(_JOBBI_SEARCH))
PAY_FLOOR = _JOBBI_POLICY.get("pay_floor")   # Candidate-specific annotation removed.
TRAVEL_MAX = _JOBBI_POLICY.get("travel_max")
HOME_AREA_RX = _JOBBI_POLICY.get("home_area_regex", r"(?!)")
SOFT = re.compile(r"(?i)prefer|nice[- ]to[- ]have|bonus|\bplus\b|a plus|ideally|familiarity|exposure to|knowledge of|understanding of|trade-?offs")
TECH = _JOBBI_POLICY.get("hard_gap_terms", [])
CLEAR = _JOBBI_POLICY.get("clearance_block_regex", r"(?!)")
CITIZEN = r"(?i)\b(?:U\.?S\.? citizen(?:ship)?|citizenship (?:is )?required|must be a (?:U\.?S\.? )?citizen)\b"
ACCOUNT_ATS = {"workday": r"myworkdayjobs|workday", "icims": r"icims", "successfactors": r"successfactors|sapsf|jobs\.sap\.com", "taleo": r"taleo"}

def lines(text): return [l.strip(" -*•\t") for l in re.split(r"\n|(?<=[.;])\s+", text) if l.strip()]

def pay_top(text):
    tops = []
    for m in re.finditer(r"\$\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d)?\s?[kK])\s*(?:[-–—]|to)\s*\$?\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d)?\s?[kK])", text or ""):
        def val(s):
            s = s.replace(",", "").replace(" ", "")
            return int(float(s[:-1]) * 1000) if s[-1] in "kK" else int(s)
        a, b = val(m.group(1)), val(m.group(2))
        if 50000 <= a <= b <= 2000000: tops.append(b)
    return max(tops) if tops else None

def check(text, location="", pay="", urls=(), ats_type="", remote_check="", rec=None, notes=""):
    out = []
    def add(level, rule, ev=""): out.append({"level": level, "rule": rule, "evidence": ev.strip()[:160]})
    L = lines(text)
    for rule, rx in TECH:
        hits = [l for l in L if re.search(rx, l, 0 if rule.startswith("C#") else re.I)]
        hard = [l for l in hits if not SOFT.search(l)]
        if hard: add("BLOCKER", rule, hard[0])
        elif hits: add("WARN", rule + " (preferred only)", hits[0])
    for l in L:
        if re.search(CLEAR, l): add("BLOCKER", "security clearance / ITAR / export control", l); break
    for l in L:
        if re.search(CITIZEN, l): add("WARN", "citizenship requirement: ask the user; never infer eligibility", l); break
    for l in L:
        for m in re.finditer(r"(?i)(?:travel[^.%]{0,60}?(\d{1,3})\s*%|(\d{1,3})\s*%[^.]{0,30}?travel)", l):
            n = int(m.group(1) or m.group(2))
            if TRAVEL_MAX is not None and n > TRAVEL_MAX: add("BLOCKER", f"travel {n}% (> {TRAVEL_MAX}%)", l)
            break
        if re.search(r"(?i)\b(?:extensive|frequent|heavy) travel\b", l): add("WARN", "travel: extensive / frequent", l)
        elif re.search(r"(?i)\btravel to\b|\btravel (?:quarterly|monthly|as needed)\b", l): add("WARN", "travel required (check how often and where)", l)
        if (m := re.search(r"(?i)(?:client|customer)[^.%]{0,40}?(\d{1,3})\s*%|(\d{1,3})\s*%[^.]{0,40}?(?:client|customer)", l)) and TRAVEL_MAX is not None and int(m.group(1) or m.group(2)) > TRAVEL_MAX:
            add("WARN", f"in person at client sites up to {m.group(1) or m.group(2)}% (counts toward the {TRAVEL_MAX}% travel limit if not local)", l)
    loc = f"{location or ''}".lower()
    body = text.lower()
    in_home_area = bool(re.search(HOME_AREA_RX, loc)) or bool(re.search(HOME_AREA_RX, body[:3000]))
    remote = remote_check == "remote-region" or bool(re.search(r"\bremote\b", loc)) or bool(re.search(r"(?i)\b(?:fully remote|remote[- ](?:first|friendly|us|in the us)|remote within the (?:u\.?s|united states)|work from anywhere in the us)\b", text))
    if remote_check == "out-of-area": add("BLOCKER", "onsite / hybrid outside the configured home area (remote_check out-of-area)", location or "")
    elif re.search(_JOBBI_POLICY.get("excluded_area_regex", r"(?!)"), loc) and not in_home_area and not remote:
        add("BLOCKER", "role in an excluded location: user decision required", location)
    elif _JOBBI_POLICY.get("restrict_onsite_to_home", False) and loc and not in_home_area and not remote and not re.search(r"(?i)^(united states|us|usa)$", loc.strip()) and \
            re.search(r"(?i)\bon[- ]?site\b|in[- ]office|\bhybrid\b|\d days? (?:a|per) week|relocat", text):
        add("BLOCKER", "onsite / hybrid outside the configured home area", f"{location} | " + next((l for l in L if re.search(r'(?i)on[- ]?site|in[- ]office|hybrid|days? (?:a|per) week|relocat', l)), ""))
    elif remote_check == "unverified" or (not loc and not in_home_area and not remote):
        add("WARN", "location unverified: confirm the configured home/remote region before building", location or "")
    top = pay_top(pay) or pay_top(text)
    if top is None: add("WARN", "pay not posted (verify compensation before deciding)")
    elif PAY_FLOOR is not None and top < PAY_FLOOR: add("BLOCKER", f"pay top ${top:,} is under the ${PAY_FLOOR:,} floor: needs the user's OK", pay or "")
    for name, rx in ACCOUNT_ATS.items():
        src = " ".join([*(u or "" for u in urls), ats_type or ""])
        if re.search(rx, src, re.I) or re.search(rx, notes or "", re.I):
            add("WARN", f"{name}: the ATS needs an account (password from the vault or a box handoff; never typed in chat)", src[:160]); break
    if rec:
        for b in rec.get("blockers") or []: add("BLOCKER", "step-6 blocker", str(b))
        if "geo" in (rec.get("dealbreakers") or []): add("BLOCKER", "step-6 dealbreaker geo")
        for d in [x for x in rec.get("dealbreakers") or [] if x != "geo"]: add("BLOCKER", f"step-6 dealbreaker {d}")
    seen, uniq = set(), []
    for o in out:
        k = (o["level"], o["rule"])
        if k not in seen: seen.add(k); uniq.append(o)
    return uniq

def from_job(job_id):
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True); c.row_factory = sqlite3.Row
    r = c.execute("select * from jobs where id=?", (job_id,)).fetchone()
    if not r: sys.exit(f"no job {job_id} in jobs.db")
    parts, urls, rec = [r["title"] or ""], [r["url"]], None
    pkg = Path(r["package_path"]) if r["package_path"] else None
    if pkg and (pkg / "jd.md").exists(): parts.append((pkg / "jd.md").read_text(errors="replace"))
    elif r["analysis_path"] and (JS / r["analysis_path"]).exists(): parts.append((JS / r["analysis_path"]).read_text(errors="replace"))
    if pkg and pkg.exists():
        try:
            sys.path.insert(0, str(Path(__file__).resolve().parent)); import fetch_form
            urls.append(fetch_form.pkg_url(pkg)[0])
        except Exception: pass
    notes = (pkg / "README.md").read_text(errors="replace") if pkg and (pkg / "README.md").exists() else ""
    s6 = sorted(JS.glob(f"jd-analysis/job-{job_id}-*.json"))
    if s6: rec = json.loads(s6[-1].read_text())
    src = "jd.md" if pkg and (pkg / "jd.md").exists() else (r["analysis_path"] or "title only")
    return dict(text="\n".join(parts), location=r["location"] or "", pay=r["pay_text"] or "", urls=urls, ats_type=r["ats_type"] or "",
                remote_check=r["remote_check"] or "", rec=rec, notes=notes), f"#{job_id} {r['company']} | {r['title']} (text from {src})"

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", help="job id or JD file"); ap.add_argument("--location", default=""); ap.add_argument("--pay", default="")
    ap.add_argument("--url", default=""); ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if a.target.isdigit():
        kw, label = from_job(int(a.target))
        if a.location: kw["location"] = a.location
        if a.pay: kw["pay"] = a.pay
        if a.url: kw["urls"].append(a.url)
    else:
        p = Path(a.target)
        if not p.exists(): sys.exit(f"no such file {p}")
        kw, label = dict(text=p.read_text(errors="replace"), location=a.location, pay=a.pay, urls=[a.url]), str(p)
    hits = check(**kw)
    nb = sum(h["level"] == "BLOCKER" for h in hits)
    if a.json: print(json.dumps({"target": label, "blockers": nb, "hits": hits}, indent=1))
    else:
        print(f"{'BLOCKED' if nb else 'CLEAR'}  {label}  ({nb} blocker(s), {len(hits) - nb} warning(s))")
        for h in hits: print(f"  {h['level']:7s} {h['rule']}" + (f"  <- {h['evidence']!r}" if h["evidence"] else ""))
    return 1 if nb else 0

if __name__ == "__main__":
    sys.exit(main())
