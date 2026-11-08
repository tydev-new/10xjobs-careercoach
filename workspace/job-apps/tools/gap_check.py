#!/usr/bin/env python3
"""OPTIONAL since 2026-10-21 simplification: not a gate; the age_signal_claims (claims) lens owns gap overclaims.
gap_check.py: code check of how a package handled the step-6 gaps and blockers (phase 1, 2026-10-20).

  python3 gap_check.py <pkg>            check review.json gap_handling against the step-6 record; exit 1 on any FAIL
  python3 gap_check.py <pkg> --json

Step-6 record: jd-analysis/job-<id>-*.json written by pipeline/score.py (schema step6-v1). Found from
review.json `step6_record`, else from the DB row of review.json `job_id` (analysis_path with .json).
Packages scored before two-way-v1 have no record: review.json sets gap_source "legacy" and lists the
gaps from its own review; the same rules then apply to that list.

Each gap / blocker gets one tag (apply-rubric.md, "Gap handling"):
  blocker_flagged  a hard requirement the user can't meet. decision = user_applies_anyway (with decision_ref:
                   where the user's choice is recorded) or flagged_to_user (then the package cannot be PASS).
  adjacent_shown   the closest real claim is shown plainly. claim_id must be an approved, in-scope claims.yaml id,
                   and shown_as must quote the resume or cover line that shows it.
  omitted          no evidence, so the gap is left out. The cover may name it only as a plan to close the gap,
                   and only when the JD makes it central (cover_plan: true).
Fails (exit 1):
  G-RECORD   step-6 record named but missing or not step6-v1
  G-MISSING  a step-6 gap or blocker with no gap_handling entry
  G-TAG      a blocker not tagged blocker_flagged
  G-DECISION blocker_flagged without a valid decision / decision_ref
  G-CLAIM    adjacent_shown with no claim_id, an unknown id, or a claim not approved or out of scope
  G-SHOWN    adjacent_shown whose shown_as text is not in the resume or cover
  OVERCLAIM  a gap or blocker term appears in the resume (or the cover outside a plan sentence) and no cited
             claim backs that term: the package implies the gap is met
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

import argparse, json, re, sqlite3, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_JOBBI_APPS / 'lib')); sys.path.insert(0, str(HERE))
import claims as CL
from textscan import md_candidate_text, md_units
from check_claims import scope_for

JS = Path(str(_JOBBI_SEARCH))
DB = JS / "pipeline" / "jobs.db"
HANDLINGS = {"blocker_flagged", "adjacent_shown", "omitted"}
DECISIONS = {"user_applies_anyway", "flagged_to_user"}
PLAN_RX = re.compile(r"\b(plan to|would (ramp|learn|close|get up to speed)|ramp(ing)? up|first \d+ (days|weeks)|get up to speed|learning|close the gap|have not yet|haven't yet|not yet)\b", re.I)
STOP = set("a an the and or of in on for with to at by from as is are be experience experienced years year yrs plus required preferred nice must strong deep hands-on proven work working knowledge familiarity expertise production scale large".split())

def norm(s): return re.sub(r"\s+", " ", (s or "").strip().lower())

def term_rx(t):
    t = t.strip()
    flags = 0 if len(t) <= 3 else re.I          # short terms (Go, Rust? no: Go, C#, R) match case-sensitively
    return re.compile(r"(?<![\w-])" + re.escape(t) + r"(?![\w-])", flags)

IMPLIED_FILE = Path(__file__).resolve().parent / "implied_terms.yaml"

def implied():
    """gap term -> paraphrases that imply it (tools/implied_terms.yaml, apply-rubric-2026-10-21)."""
    try:
        import yaml
        d = yaml.safe_load(IMPLIED_FILE.read_text()) or {}
        return {str(k).lower(): [str(x) for x in v] for k, v in d.items()}
    except FileNotFoundError:
        return {}

def default_terms(item):
    words = [w for w in re.findall(r"[A-Za-z][\w+#./-]*", item) if w.lower() not in STOP and len(w) > 1]
    return words[:4]

def find_record(pkg, rv):
    p = rv.get("step6_record")
    if p:
        p = Path(p) if Path(p).is_absolute() else JS / p
        return p, (json.loads(p.read_text()) if p.exists() else None)
    jid = rv.get("job_id")
    if jid is None or not DB.exists():
        return None, None
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    row = c.execute("select analysis_path, scored_with from jobs where id=?", (jid,)).fetchone()
    if not row or not row[0] or row[1] != "two-way-v1":
        return None, None
    p = JS / (str(Path(row[0]).with_suffix(".json")))
    return p, (json.loads(p.read_text()) if p.exists() else None)

def texts(pkg, cover_attached):
    r = md_units(md_candidate_text((pkg / "resume-native.md").read_text())) if (pkg / "resume-native.md").exists() else []
    c = md_units((pkg / "cover.txt").read_text()) if cover_attached and (pkg / "cover.txt").exists() else []
    return r, c

def check(pkg, rv):
    pkg = Path(pkg); fails = []
    gh = rv.get("gap_handling")
    if gh is None:
        return ["G-MISSING review.json has no gap_handling (list every step-6 gap and blocker; [] only when there are none)"], None
    path, rec = find_record(pkg, rv)
    src = rv.get("gap_source", "step6")
    if rv.get("step6_record") and rec is None:
        fails.append(f"G-RECORD step-6 record {path} not found")
    if rec is not None and rec.get("schema") != "step6-v1":
        fails.append(f"G-RECORD {path} is not schema step6-v1")
    if rec is None and src != "legacy" and not fails:
        fails.append("G-RECORD no step-6 record for this job (score it with pipeline/score.py, or set gap_source 'legacy' for a pre-two-way package)")
    if rec is not None:
        have = {(norm(g["item"]), g["kind"]) for g in gh}
        for kind, items in (("gap", rec.get("gaps", [])), ("blocker", rec.get("blockers", []))):
            for it in items:
                if (norm(it), kind) not in have:
                    fails.append(f"G-MISSING step-6 {kind} {it!r} has no gap_handling entry")
    scope = set(scope_for(pkg)) | {"all"}
    by_id = {c["id"]: c for c in CL.load()["claims"]}
    rs, cs = texts(pkg, rv.get("cover") == "attached")
    blob = " ".join(rs + cs).lower()
    for g in gh:
        it, kind, h = g.get("item", "?"), g.get("kind"), g.get("handling")
        if h not in HANDLINGS:
            fails.append(f"G-TAG {it!r}: handling {h!r} is not one of {sorted(HANDLINGS)}"); continue
        if kind == "blocker" and h != "blocker_flagged":
            fails.append(f"G-TAG blocker {it!r} tagged {h}: a blocker is never hidden or written around; tag blocker_flagged")
        if h == "blocker_flagged":
            d = g.get("decision")
            if d not in DECISIONS:
                fails.append(f"G-DECISION {it!r}: decision must be one of {sorted(DECISIONS)}")
            elif d == "user_applies_anyway" and len(g.get("decision_ref") or "") < 8:
                fails.append(f"G-DECISION {it!r}: user_applies_anyway needs decision_ref (where the user's choice is recorded)")
            elif d == "flagged_to_user" and rv.get("final") == "PASS":
                fails.append(f"G-DECISION {it!r}: flagged_to_user, so the package cannot be stamped PASS until the user decides")
        backing = None
        if h == "adjacent_shown":
            cid = g.get("claim_id")
            c = by_id.get(cid)
            if not cid or c is None:
                fails.append(f"G-CLAIM {it!r}: adjacent_shown must cite an existing claims.yaml id (got {cid!r})")
            elif c.get("status") != "approved" or not (set(c.get("scope") or []) & scope):
                fails.append(f"G-CLAIM {it!r}: claim {cid} is not approved for scope {sorted(scope)}")
            else:
                backing = c
            sa = norm(g.get("shown_as"))
            if not sa or sa not in re.sub(r"\s+", " ", blob):
                fails.append(f"G-SHOWN {it!r}: shown_as must quote the resume/cover text that shows the adjacent claim")
        terms = g.get("terms") or default_terms(it)
        back_txt = (" ".join([backing.get("text", "")] + list(backing.get("anchors") or [])) if backing else "")
        imp = implied()
        for t in list(terms) + [p for t0 in terms for p in imp.get(t0.lower(), [])]:
            rx = term_rx(t)
            if backing and rx.search(back_txt):
                continue                         # the cited claim itself backs this term
            for s in rs:
                if rx.search(s):
                    fails.append(f"OVERCLAIM resume implies {kind} {it!r} is met ({t!r} with no backing claim): {s[:140]!r}")
                    break
            for s in cs:
                if rx.search(s):
                    if h == "omitted" and g.get("cover_plan") and PLAN_RX.search(s):
                        continue
                    fails.append(f"OVERCLAIM cover names {kind} {it!r} ({t!r}) outside a plan-to-close sentence"
                                 + ("" if g.get("cover_plan") else " (cover_plan not set: the JD must make it central)") + f": {s[:140]!r}")
                    break
    return fails, (str(path) if path else None)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pkg"); ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    pkg = Path(a.pkg).resolve()
    rv = json.loads((pkg / "review.json").read_text())
    fails, rec = check(pkg, rv)
    if a.json:
        print(json.dumps({"package": pkg.name, "step6_record": rec, "gap_source": rv.get("gap_source", "step6"),
                          "result": "FAIL" if fails else "PASS", "fails": fails}, indent=1))
    else:
        for f in fails: print("  FAIL", f)
        print(f"  Gap check: {'FAIL' if fails else 'PASS'} ({len(rv.get('gap_handling') or [])} item(s); record: {rec or rv.get('gap_source', 'none')})")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
