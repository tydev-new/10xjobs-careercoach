#!/usr/bin/env python3
"""finalize_review.py: the ONE review step. Merges the 4 independent lens files and records the verdict
(README stamp, review-3lens.md block, review.json, jobs DB package_runs) in one go.

  jobsearch.py finalize-review <pkg>             merge + record.  exit 0 = PASS recorded, 2 = REVISE/FAIL recorded, 1 = refused
  jobsearch.py finalize-review <pkg> --dry-run   print the merged review and stamp, write nothing
  jobsearch.py finalize-review <pkg> --verify    submit time (submit_gate): exit 0 only if review.json is a finalize_review
                                                 PASS, the lens files and resume/cover are unchanged since, and the kept
                                                 code gates still pass

Refuses (exit 1, writes nothing) only when the lens set is not usable:
  - any of reviews/{hiring_manager,age_signal_claims,recruiter,ats}.json missing or not lens-review-v1
  - a lens file names another lens or package
  - reviewer_run_id values not distinct, or one is a builder run (package.yaml builder_runs; build_package --write)
  - resume-native.md / cover.txt changed since a lens reviewed it (sha mismatch), or a lens skipped a shipped doc
Otherwise it ALWAYS records the verdict: worst lens verdict wins (FAIL > REVISE > PASS); all findings kept.
The kept code gates are re-run once and folded in: a claims, JD-copy (8+ words) or format failure makes the final FAIL.
ATS hits / coverage / longest JD copy run are computed by ats_check and reported for the ats lens; they never block.
"""
import argparse, datetime as dt, json, re, sys
from pathlib import Path
import jsonschema

from apply.lib import claims as CL
from apply.lib import reviews as RR
from apply.tools import ats_check, check_claims as CC, format_check

HERE = Path(__file__).resolve().parent

VERSION = "finalize-2026-10-21"
LENSES, GOAL, RANK, CASE = RR.LENSES, RR.GOAL, RR.RANK, RR.CASE
LABEL = RR.LENS_LABEL

def usable(pkg, L, cover):
    errs = []
    ids = {l: d["reviewer_run_id"] for l, d in L.items()}
    if len(set(ids.values())) != len(ids): errs.append(f"RUN-ID reviewer_run_id values are not distinct: {ids}")
    built = set(RR.builder_runs(pkg))
    if not built: errs.append("BUILDER package.yaml has no builder_runs: rebuild with build_package --write --run-id <run> so the builder is known")
    for l, r in ids.items():
        if r in built: errs.append(f"RUN-ID {l} was reviewed by builder run {r!r}: a package is never reviewed by the run that built it")
    now = RR.file_hashes(pkg)
    need = {"resume"} | ({"cover"} if cover == "attached" else set())
    for l, d in L.items():
        for f, h in now.items():
            if f == "cover.txt" and cover == "none": continue
            if d["reviewed_files_sha256"].get(f) != h: errs.append(f"STALE {l} reviewed an older {f}: re-run that lens on the current files")
        docs = {x["doc"] for x in d["docs"]}
        if not need <= docs: errs.append(f"DOCS {l} did not review {sorted(need - docs)} (cover={cover})")
    return errs

def gates(pkg):
    """the kept code gates, run once on the package as it is now."""
    pkg = Path(pkg); out = {}
    r = CC.check_package(pkg)
    out["claims"] = {"ok": r["result"] == "PASS", "fails": [f"FAIL {f['check']} [{f['where']}] {f['token']!r} | {f['sentence'][:170]} | {f['why']}" for f in r["fails"]][:20]}
    a = ats_check.compute(pkg, []) if (pkg / "jd.md").exists() else {"max_jd_copy_run": 0, "max_jd_copy_text": ""}
    out["jd_copy"] = {"ok": a["max_jd_copy_run"] < 8, "max_run": a["max_jd_copy_run"], "text": a["max_jd_copy_text"]}
    f, w = format_check.check(pkg)
    out["format"] = {"ok": not f, "fails": f, "warns": len(w), "version": format_check.FORMAT_VERSION}
    return out

def merge(pkg, L, cover, G):
    pkg = Path(pkg); spec = RR.spec_of(pkg); job_id, s6 = RR.job_of(pkg)
    lenses = []
    for l in LENSES:
        d = L[l]
        for doc in sorted({x["doc"] for x in d["docs"]} & ({"resume", "cover"} if cover == "attached" else {"resume"}), key=["resume", "cover"].index):
            dv = next(x for x in d["docs"] if x["doc"] == doc)
            fs = [f for f in d["findings"] if f["doc"] == doc]
            e = {"lens": l, "goal": GOAL[l], "doc": doc, "verdict": CASE[dv["verdict"]], "round_checked": d.get("round", 1),
                 "reasons": [dv["summary"]] + [f"[{f['severity']}] {f['finding']} (evidence: {f['evidence']})" for f in fs]}
            if l == "hiring_manager" and doc == "resume":
                if d.get("top_rejection_reason"): e["top_rejection_reason"] = d["top_rejection_reason"]
                if "answered" in d: e["answered"] = d["answered"]
            if l == "ats" and doc == "resume" and d.get("keywords"):
                kws = [{"term": k["term"], "aliases": list(k.get("aliases") or [])} for k in d["keywords"]]
                calc = ats_check.compute(pkg, kws)
                e.update({"keywords": [{**k, "hit": c["hit"]} for k, c in zip(kws, calc["keywords"])], "coverage": calc["coverage"],
                          "top3_hit": calc["top3_hit"], "max_jd_copy_run": calc["max_jd_copy_run"]})
            lenses.append(e)
    worst = max((max((x["verdict"] for x in L[l]["docs"]), key=RANK.get) for l in LENSES), key=RANK.get)
    gate_fails = [f"{k}: {'; '.join(v.get('fails') or [v.get('text', '')])}" for k, v in G.items() if not v["ok"]]
    final = "FAIL" if gate_fails else worst
    who = ", ".join(f"{l}={L[l]['reviewer_run_id']}" for l in LENSES)
    edits = [f"built by {', '.join(RR.builder_runs(pkg))}; finalized from 4 independent lens reviews ({who})"]
    edits += [f"CODE GATE FAIL {g}"[:600] for g in gate_fails]
    rv = {"schema": "review-v1", "package": pkg.name, "job_id": job_id, "base": spec.get("base") or "unknown",
          "rubric_version": L["ats"]["rubric_version"], "lint_version": format_check.FORMAT_VERSION,
          "claims_version": CL.load()["version"], "round": max(d.get("round", 1) for d in L.values()), "cover": cover,
          "lenses": lenses, "edits": edits,
          "residual_gaps": list(dict.fromkeys(g for l in LENSES for g in (L[l].get("residual_gaps") or []))),
          "final": final, "reviewed_at": max(d["reviewed_at"] for d in L.values()),
          "reviewer": "4 independent lens reviewers: " + who,
          "gap_source": "step6" if s6 else "legacy", "gap_handling": L["age_signal_claims"].get("gap_handling") or [],
          "gates": G,
          "reconciled": {"tool": "finalize_review.py", "version": VERSION, "at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
                         "builder_run_ids": RR.builder_runs(pkg), "cover": cover,
                         "lenses": {l: {"reviewer_run_id": L[l]["reviewer_run_id"], "file": L[l]["_file"], "sha256": L[l]["_sha"],
                                        "verdict": max((x["verdict"] for x in L[l]["docs"]), key=RANK.get)} for l in LENSES},
                         "reviewed_files_sha256": RR.file_hashes(pkg)}}
    if s6: rv["step6_record"] = s6
    if job_id is None: rv.pop("job_id")
    return rv

def finalize(pkg):
    pkg = Path(pkg).resolve(); cover = RR.cover_mode(pkg)
    L, errs = RR.load_lenses(pkg)
    if errs: return None, errs
    errs = usable(pkg, L, cover)
    if errs: return None, errs
    rv = merge(pkg, L, cover, gates(pkg))
    try: jsonschema.validate(rv, json.loads((HERE / "review_schema.json").read_text()))
    except jsonschema.ValidationError as e: return None, [f"SCHEMA merged review {'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message[:200]}"]
    return rv, []

def stamp_text(rv):
    return (f"4-lens: {rv['final']} ({dt.datetime.now().strftime('%Y-%m-%d')}; {rv['lint_version']}; {rv['claims_version']}; "
            f"{rv['rubric_version']}; finalize_review round {rv['round']})")

def render(rv, stamp):
    return RR.render(rv, stamp)

def record(pkg, rv, stamp):
    RR.write_stamp(pkg, rv, stamp)
    rid = RR.record_run(pkg, verdict=rv["final"], source="stamp_review", base=rv["base"], job_id=rv.get("job_id"),
                        lint_version=rv["lint_version"], claims_version=rv["claims_version"],
                        rubric_version=rv["rubric_version"], round=rv["round"])
    if rid: print(f"  package_runs #{rid} recorded in the jobs DB")

def verify(pkg):
    pkg = Path(pkg).resolve(); rj = pkg / "review.json"
    if not rj.exists(): return ["review.json missing: run finalize_review"]
    rv = json.loads(rj.read_text()); rc = rv.get("reconciled") or {}
    if rc.get("tool") != "finalize_review.py":
        return ["review.json was not recorded by finalize_review: re-review with 4 lens files and finalize"]
    errs = []
    if rv.get("final") != "PASS": errs.append(f"recorded verdict is {rv.get('final')}, not PASS")
    for l in LENSES:
        m = rc["lenses"][l]; f = pkg / m["file"]
        if not f.exists() or RR.sha(f) != m["sha256"]: errs.append(f"reviews/{l}.json changed or missing since finalize")
    for f, h in RR.file_hashes(pkg).items():
        if rc["reviewed_files_sha256"].get(f) != h: errs.append(f"{f} changed since finalize")
    G = gates(pkg)
    errs += [f"code gate {k} fails now: {'; '.join(v.get('fails') or [v.get('text', '')])}"[:400] for k, v in G.items() if not v["ok"]]
    return errs

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pkg"); ap.add_argument("--verify", action="store_true"); ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(); pkg = Path(a.pkg).resolve()
    if a.verify:
        errs = verify(pkg)
        print(("VERIFIED " if not errs else "NOT PASS ") + pkg.name); [print("  -", e) for e in errs]; sys.exit(1 if errs else 0)
    rv, errs = finalize(pkg)
    if errs:
        print(f"REFUSE {pkg.name}: lens set not usable ({len(errs)} problem(s)); nothing recorded"); [print("  -", e) for e in errs]; sys.exit(1)
    stamp = stamp_text(rv)
    if a.dry_run: print(stamp); print(render(rv, stamp)); sys.exit(0)
    rj = pkg / "review.json"
    rj.write_text(json.dumps(rv, indent=1) + "\n")
    record(pkg, rv, stamp)
    print(f"RECORDED {pkg.name}: {stamp}")
    print("  lenses: " + ", ".join(f"{l} {rv['reconciled']['lenses'][l]['verdict']}" for l in LENSES)
          + "; gates: " + ", ".join(f"{k} {'ok' if v['ok'] else 'FAIL'}" for k, v in rv["gates"].items()))
    if rv["final"] == "PASS":
        print(f"  next: python3 jobsearch.py update-status --url <job url> --status Packaged --package {pkg} --by <agent>")
    sys.exit(0 if rv["final"] == "PASS" else 2)

if __name__ == "__main__":
    main()
