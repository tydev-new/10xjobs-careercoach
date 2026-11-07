#!/usr/bin/env python3
"""RETIRED from the required path 2026-10-21 (simplification): finalize_review.py merges and records in one step. Its helpers (lens loading, hashes, builder runs) are still used by finalize_review.py / review_queue.py.
reconcile_reviews.py: merge 4 independent lens reviews into review.json (2026-10-21, the user approval policy).

  python3 reconcile_reviews.py <pkg> [--cover attached|none] [--round N] [--dry-run]
  python3 reconcile_reviews.py <pkg> --check      re-derive review.json from the lens files and compare (no writes)

Inputs: <pkg>/reviews/{hiring_manager,age_signal_claims,recruiter,ats}.json (schema tools/lens_review_schema.json),
written by 4 separate reviewers who each saw only the package files, apply-rubric.md, the step-6 record,
claims.yaml and the tool outputs (rework/reviewer-brief.md), never another lens's verdict.

Refuses (exit 1, nothing written) unless:
  - all 4 lens files exist, validate, name their own lens and this package
  - the 4 reviewer_run_id values are distinct, and none is a run that built the package
    (package.yaml builder_runs, written by build_package.py --write)
  - all 4 use the same rubric_version, and it is the live apply-rubric.md version
  - each lens reviewed the current files (reviewed_files_sha256 matches resume-native.md and cover.txt now)
  - each lens covers the shipped docs: resume, plus cover when the cover is attached
Merge: worst verdict wins (FAIL > REVISE > PASS) per lens/doc and for the final verdict; every finding is kept.
ATS hits, coverage, top 3 and the longest JD copy run are computed by ats_check.py, never copied from a reviewer.
gap_handling comes from the age_signal_claims lens (it owns blockers). Exit 0 = review.json written and well-formed.
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

import argparse, datetime as dt, hashlib, json, re, sqlite3, sys
from pathlib import Path
import jsonschema, yaml
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(_JOBBI_APPS / 'lib'))
import ats_check
import claims as CL

VERSION = "reconcile-2026-10-21"
LENSES = ["hiring_manager", "age_signal_claims", "recruiter", "ats"]
GOAL = {"hiring_manager": "fit", "age_signal_claims": "blockers", "recruiter": "messaging", "ats": "messaging"}
RANK = {"PASS": 0, "REVISE": 1, "FAIL": 2}
CASE = {"PASS": "Pass", "REVISE": "Revise", "FAIL": "Fail"}
HASHED = ("resume-native.md", "cover.txt")
JS = Path(str(_JOBBI_SEARCH)); DB = JS / "pipeline" / "jobs.db"
RUBRIC = Path(str(_JOBBI_APPS / 'rework/apply-rubric.md'))

def live_rubric():
    return re.search(r"^Version:\s*`?(apply-rubric-[\w.-]+)`?", RUBRIC.read_text(), re.M).group(1)

def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def file_hashes(pkg):
    pkg = Path(pkg); return {f: sha(pkg / f) for f in HASHED if (pkg / f).exists()}

def lens_schema():
    s = json.loads((HERE / "lens_review_schema.json").read_text())
    s["properties"]["gap_handling"] = json.loads((HERE / "review_schema.json").read_text())["properties"]["gap_handling"]
    return s

def spec_of(pkg):
    p = Path(pkg) / "package.yaml"
    return yaml.safe_load(p.read_text()) if p.exists() else {}

def builder_runs(pkg):
    return [str(x) for x in (spec_of(pkg).get("builder_runs") or [])]

def cover_mode(pkg, override=None):
    if override: return override
    spec = spec_of(pkg)
    if "cover_attached" in spec: return "attached" if spec["cover_attached"] else "none"
    if "cover_required" in spec or (Path(pkg) / "form.json").exists():      # 2026-11-04: cover only when the form requires one
        import fetch_form
        return "attached" if fetch_form.cover_required(pkg)[0] and (Path(pkg) / "cover.txt").exists() else "none"
    rd = Path(pkg) / "README.md"
    if not (Path(pkg) / "cover.txt").exists(): return "none"
    if rd.exists() and re.search(r"NOT ATTACH", rd.read_text(), re.I): return "none"
    return "attached"

def job_of(pkg):
    """(job_id, step6 path) from the DB row whose package_path is this package, else the URL in package.yaml."""
    if not DB.exists(): return None, None
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    row = c.execute("select id, analysis_path from jobs where rtrim(package_path,'/')=?", (str(Path(pkg).resolve()),)).fetchone()
    if not row:
        m = re.search(r"\*\*URL:\*\*\s*(\S+)", (spec_of(pkg).get("resume") or {}).get("head", ""))
        if m: row = c.execute("select id, analysis_path from jobs where url=?", (m.group(1),)).fetchone()
    if not row:      # 2026-11-04b: also package.yaml job_id, every package URL (incl. the LinkedIn URL) and jd-analysis URLs
        try:
            import precheck as _PC
            r, _ = _PC.find_job(Path(pkg).resolve())
            if r: row = (r["id"], r["analysis_path"])
        except Exception: pass
    if not row: return None, None
    s6 = (JS / Path(row[1]).with_suffix(".json")) if row[1] else None
    return row[0], (str(s6) if s6 and s6.exists() else None)

def load_lenses(pkg):
    pkg = Path(pkg); errs, out = [], {}
    sch = lens_schema()
    for lens in LENSES:
        f = pkg / "reviews" / f"{lens}.json"
        if not f.exists(): errs.append(f"MISSING reviews/{lens}.json"); continue
        try: d = json.loads(f.read_text())
        except json.JSONDecodeError as e: errs.append(f"JSON reviews/{lens}.json: {e}"); continue
        try: jsonschema.validate(d, sch)
        except jsonschema.ValidationError as e:
            errs.append(f"SCHEMA reviews/{lens}.json {'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message[:200]}"); continue
        if d["lens"] != lens: errs.append(f"LENS reviews/{lens}.json says lens {d['lens']!r}")
        if d["package"] != pkg.name: errs.append(f"PACKAGE reviews/{lens}.json is for {d['package']!r}, not {pkg.name!r}")
        d["_file"], d["_sha"] = str(f.relative_to(pkg)), sha(f)
        out[lens] = d
    return out, errs

def independence(pkg, L, cover):
    errs = []
    ids = {l: d["reviewer_run_id"] for l, d in L.items()}
    if len(set(ids.values())) != len(ids): errs.append(f"RUN-ID lens reviewer_run_id values are not distinct: {ids}")
    built = set(builder_runs(pkg))
    if not built: errs.append("BUILDER package.yaml has no builder_runs (rebuild with build_package.py --write so the builder run is recorded)")
    for l, r in ids.items():
        if r in built: errs.append(f"RUN-ID {l} was reviewed by builder run {r!r}: a package is never reviewed by the run that built it")
    rvs = {d["rubric_version"] for d in L.values()}
    if len(rvs) > 1: errs.append(f"RUBRIC lenses used different rubric versions: {sorted(rvs)}")
    live = live_rubric()
    if rvs and rvs != {live}: errs.append(f"RUBRIC lenses used {sorted(rvs)}, live is {live!r}")
    now = file_hashes(pkg)
    for l, d in L.items():
        for f, h in now.items():
            if f == "cover.txt" and cover == "none": continue
            if d["reviewed_files_sha256"].get(f) != h:
                errs.append(f"STALE {l} reviewed an older {f} (sha mismatch): re-review the current files")
        docs = {x["doc"] for x in d["docs"]}
        need = {"resume"} | ({"cover"} if cover == "attached" else set())
        if docs != need: errs.append(f"DOCS {l} reviewed {sorted(docs)}, shipped docs are {sorted(need)} (cover={cover})")
        worst = max((RANK[x["verdict"]] for x in d["docs"]), default=0)
        if RANK[d["verdict"]] != worst: errs.append(f"VERDICT {l}: lens verdict {d['verdict']} is not the worst of its docs")
        if l == "hiring_manager" and ("top_rejection_reason" not in d or "answered" not in d):
            errs.append("HM lens must give top_rejection_reason and answered")
        if l == "ats" and not 8 <= len(d.get("keywords") or []) <= 12:
            errs.append(f"ATS lens needs 8-12 keywords, got {len(d.get('keywords') or [])}")
        if l == "age_signal_claims" and "gap_handling" not in d:
            errs.append("age_signal_claims lens must give gap_handling (every step-6 gap and blocker; [] when none)")
    return errs

def merge(pkg, L, cover, round_=None):
    pkg = Path(pkg); spec = spec_of(pkg); job_id, s6 = job_of(pkg)
    lenses = []
    for l in LENSES:
        d = L[l]
        for doc in d["docs"]:
            fs = [f for f in d["findings"] if f["doc"] == doc["doc"]]
            reasons = [doc["summary"]] + [f"[{f['severity']}] {f['finding']} (evidence: {f['evidence']})" for f in fs]
            e = {"lens": l, "goal": GOAL[l], "doc": doc["doc"], "verdict": CASE[doc["verdict"]], "round_checked": d.get("round", round_ or 1), "reasons": reasons}
            if l == "hiring_manager" and doc["doc"] == "resume":
                e["top_rejection_reason"], e["answered"] = d["top_rejection_reason"], d["answered"]
            if l == "ats" and doc["doc"] == "resume":
                kws = [{"term": k["term"], "aliases": list(k.get("aliases") or [])} for k in d["keywords"]]
                calc = ats_check.compute(pkg, kws)
                e.update({"keywords": [{"term": k["term"], "aliases": k["aliases"], "hit": c["hit"]} for k, c in zip(kws, calc["keywords"])],
                          "coverage": calc["coverage"], "top3_hit": calc["top3_hit"], "max_jd_copy_run": calc["max_jd_copy_run"]})
            lenses.append(e)
    final = max((d["verdict"] for d in L.values()), key=RANK.get)
    lint_src = (HERE / "lint_3lens_package.py").read_text()
    rv = {"schema": "review-v1", "package": pkg.name, "job_id": job_id, "base": spec.get("base"),
          "rubric_version": L["ats"]["rubric_version"],
          "lint_version": re.search(r'^LINT_VERSION\s*=\s*"([^"]+)"', lint_src, re.M).group(1),
          "claims_version": CL.load()["version"], "round": round_ or max(d.get("round", 1) for d in L.values()),
          "cover": cover, "lenses": lenses,
          "edits": [f"built by {', '.join(builder_runs(pkg))}; reconciled from 4 independent lens reviews ({', '.join(l + '=' + str(L[l]['reviewer_run_id']) for l in LENSES)})"],  # backport 2026-10-21: 3.11-safe
          "residual_gaps": list(dict.fromkeys(g for l in LENSES for g in (L[l].get("residual_gaps") or []))),
          "final": final, "reviewed_at": max(d["reviewed_at"] for d in L.values()),
          "reviewer": "4 independent lens reviewers: " + ", ".join(f"{l}={L[l]['reviewer_run_id']}" for l in LENSES),
          "gap_source": "step6", "gap_handling": L["age_signal_claims"]["gap_handling"],
          "reconciled": {"tool": "reconcile_reviews.py", "version": VERSION, "at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
                         "builder_run_ids": builder_runs(pkg), "cover": cover,
                         "lenses": {l: {"reviewer_run_id": L[l]["reviewer_run_id"], "file": L[l]["_file"], "sha256": L[l]["_sha"], "verdict": L[l]["verdict"]} for l in LENSES},
                         "reviewed_files_sha256": file_hashes(pkg)}}
    if s6: rv["step6_record"] = s6
    if job_id is None: rv.pop("job_id")
    return rv

def reconcile(pkg, cover=None, round_=None):
    """(review dict or None, errors)."""
    pkg = Path(pkg).resolve(); cover = cover_mode(pkg, cover)
    L, errs = load_lenses(pkg)
    if errs: return None, errs
    errs = independence(pkg, L, cover)
    if errs: return None, errs
    rv = merge(pkg, L, cover, round_)
    try: jsonschema.validate(rv, json.loads((HERE / "review_schema.json").read_text()))
    except jsonschema.ValidationError as e: return None, [f"SCHEMA merged review.json {'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message[:200]}"]
    return rv, []

COMPARE = ("lenses", "final", "gap_handling", "cover", "rubric_version")
def verify(pkg, rv):
    """problems with a reconciled review.json: provenance, independence, lens files unchanged, merge reproducible."""
    pkg = Path(pkg).resolve(); rc = rv.get("reconciled")
    if not rc or rc.get("tool") != "reconcile_reviews.py":
        return ["INDEPENDENT review.json was not written by reconcile_reviews.py from 4 independent lens reviews"]
    errs = []
    for l in LENSES:
        meta = rc["lenses"].get(l) or {}
        f = pkg / meta.get("file", f"reviews/{l}.json")
        if not f.exists(): errs.append(f"INDEPENDENT lens file {f.name} is missing"); continue
        if sha(f) != meta.get("sha256"): errs.append(f"INDEPENDENT reviews/{l}.json changed after reconcile: re-run reconcile_reviews.py")
    if errs: return errs
    again, e2 = reconcile(pkg, rc.get("cover"), rv.get("round"))
    if e2: return ["INDEPENDENT " + e for e in e2]
    for k in COMPARE:
        if again.get(k) != rv.get(k): errs.append(f"INDEPENDENT review.json {k} differs from the merge of the lens files (hand-edited?): re-run reconcile_reviews.py")
    return errs

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pkg"); ap.add_argument("--cover", choices=["attached", "none"]); ap.add_argument("--round", type=int)
    ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--check", action="store_true")
    a = ap.parse_args(); pkg = Path(a.pkg).resolve()
    if a.check:
        rj = pkg / "review.json"
        errs = verify(pkg, json.loads(rj.read_text())) if rj.exists() else ["review.json missing"]
        print(("OK " if not errs else "MISMATCH ") + pkg.name); [print("  -", e) for e in errs]; sys.exit(1 if errs else 0)
    rv, errs = reconcile(pkg, a.cover, a.round)
    if errs:
        print(f"REFUSE {pkg.name}: {len(errs)} problem(s)"); [print("  -", e) for e in errs]; sys.exit(1)
    if a.dry_run: print(json.dumps(rv, indent=1)); sys.exit(0)
    rj = pkg / "review.json"
    if rj.exists(): rj.with_name("review.json.bak-reconcile").write_text(rj.read_text())
    rj.write_text(json.dumps(rv, indent=1) + "\n")
    print(f"RECONCILED {pkg.name}: final {rv['final']} ({', '.join(l + ' ' + str(rv['reconciled']['lenses'][l]['verdict']) for l in LENSES)}); cover={rv['cover']}")
    print(f"  next: python3 <apps-workspace>/tools/stamp_review.py {pkg}   (re-runs lint, claims, ATS and gap checks)")
    sys.exit(0)

if __name__ == "__main__":
    main()
