#!/usr/bin/env python3
"""review_queue.py: which packages await a review (2026-10-21; 2026-11-04: one combined reviewer).
A package is reviewed by ONE combined reviewer (reviews/combined.json, rework/reviewer-brief.md); the older 4 lens files
are still shown and accepted when there is no combined.json.

  python3 review_queue.py --date 2026-10-21 [--json] [--all]
      packages under <apps-workspace>/daily-<date>*/ that have a package.yaml, with the review status
      (missing | VERDICT by <run id> | STALE | INVALID), finalize state, round, and whether the next round can be
      recorded without the user (wording-only fix, wording_check.py). Default: only packages that still
      need something (a lens review or finalize_review.py); --all lists every package.
  python3 review_queue.py --hashes <pkg>
      the sha256 values a reviewer puts in reviewed_files_sha256, plus the builder runs it must not reuse.
  python3 review_queue.py --inputs <pkg>
      the exact files the reviewer may read (rework/reviewer-brief.md "Inputs") and the tool outputs it reads
      (precheck.py first: the reviewer judges only what precheck can't).
Read-only: never writes, never contacts anyone.
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

import argparse, json, re, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import reconcile_reviews as RR
JA = Path(str(_JOBBI_APPS))

def lens_status(pkg, cover):
    L, errs = {}, {}
    sch = RR.lens_schema(); now = RR.file_hashes(pkg); built = set(RR.builder_runs(pkg))
    import jsonschema
    out = {}
    for lens in RR.LENSES:
        f = pkg / "reviews" / f"{lens}.json"
        if not f.exists(): out[lens] = "missing"; continue
        try:
            d = json.loads(f.read_text()); jsonschema.validate(d, sch)
        except Exception as e:
            out[lens] = f"INVALID ({str(e).splitlines()[0][:80]})"; continue
        stale = any(d["reviewed_files_sha256"].get(k) != v for k, v in now.items() if not (k == "cover.txt" and cover == "none"))
        bad = " BUILDER-RUN" if d["reviewer_run_id"] in built else ""
        out[lens] = ("STALE " if stale else "") + f"{d['verdict']} by {d['reviewer_run_id']}{bad}"
    return out

def combined_status(pkg, cover):
    f = pkg / "reviews" / "combined.json"
    if not f.exists(): return None
    import finalize_review as FR
    L, errs = FR.load_combined(pkg)
    if errs: return f"INVALID ({errs[0][:90]})"
    d = L["ats"]["_combined"]; now = RR.file_hashes(pkg)
    stale = any(d["reviewed_files_sha256"].get(k) != v for k, v in now.items() if not (k == "cover.txt" and cover == "none"))
    bad = " BUILDER-RUN" if d["reviewer_run_id"] in set(RR.builder_runs(pkg)) else ""
    return ("STALE " if stale else "") + f"{d['verdict']} by {d['reviewer_run_id']}{bad} (round {d['round']})"

def round3(pkg, rv):
    """Next-round note using configured free-round limit; approval rules are not bypassed."""
    rnd = rv.get("round", 0) if rv else 0
    limit = _JOBBI_POLICY.get("max_review_rounds") or 0
    if not rv or rv.get("final") == "PASS" or rnd < limit: return None
    if rnd > limit: return f"round {rnd + 1} needs the user (--user-ok)"
    import wording_check as WC
    w = WC.check(pkg, before_round=limit + 1, run_precheck=False)
    return (f"round {rnd + 1} OK without the user if precheck stays clean (wording-only so far)" if w["wording_only"]
            else f"round {rnd + 1} needs the user: " + ("; ".join(w["reasons"]) or "no baseline")[:160])

def row(pkg):
    cover = RR.cover_mode(pkg)
    comb = combined_status(pkg, cover)
    st = {"combined": comb} if comb else lens_status(pkg, cover)
    rj = pkg / "review.json"; rv = json.loads(rj.read_text()) if rj.exists() else {}
    tool = (rv.get("reconciled") or {}).get("tool")
    rec = {"finalize_review.py": "finalized", "reconcile_reviews.py": "reconciled (old two-step, not finalized)"}.get(tool, "single-pass (legacy)" if rv else "none")
    if tool == "finalize_review.py":
        lens_changed = any(not (pkg / m["file"]).exists() or RR.sha(pkg / m["file"]) != m["sha256"] for m in rv["reconciled"]["lenses"].values())
        files_changed = any(rv["reconciled"]["reviewed_files_sha256"].get(k) != v for k, v in RR.file_hashes(pkg).items())
        if lens_changed or files_changed: rec = "finalized but OUT OF DATE (re-review / re-finalize)"
    readme = (pkg / "README.md").read_text() if (pkg / "README.md").exists() else ""
    m = re.search(r"4-lens: (PASS|REVISE|FAIL) \(([^)]*)\)", readme)
    stamp = f"{m.group(1)} ({m.group(2).split(';')[0]})" if m else "unstamped"
    ids = [v.split(" by ")[-1].split()[0] for v in st.values() if " by " in v]
    ready = all(v.split()[0] in ("PASS", "REVISE", "FAIL") and "BUILDER-RUN" not in v for v in st.values()) and len(set(ids)) == len(st)
    need = "review (one combined reviewer)" if not ready else ("finalize" if rec != "finalized" else "-")
    if rv.get("holds_for_user") and not rv.get("holds_ack"): need = "HOLD for the user: " + "; ".join((h.get("question_for_user") or h.get("screen_out_note") or h["reason"])[:80] for h in rv["holds_for_user"])
    elif rv.get("builder_round") and rv.get("final") == "REVISE": need = f"builder round ({len(rv['builder_round'])} line(s): builder_feedback.py)"
    return {"package": str(pkg), "name": pkg.name, "cover": cover, "builder_runs": RR.builder_runs(pkg), "lenses": st,
            "mode": "combined" if comb else "4-lens", "review": rec, "stamp": stamp, "round": rv.get("round") if rv else None,
            "next_round": round3(pkg, rv), "next": need}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--date"); g.add_argument("--hashes"); g.add_argument("--inputs")
    ap.add_argument("--json", action="store_true"); ap.add_argument("--all", action="store_true")
    a = ap.parse_args()
    if a.hashes:
        p = Path(a.hashes).resolve()
        out = {"package": p.name, "reviewed_files_sha256": {k: v for k, v in RR.file_hashes(p).items() if not (k == "cover.txt" and RR.cover_mode(p) == "none")},
               "cover": RR.cover_mode(p), "rubric_version": RR.live_rubric(), "builder_runs": RR.builder_runs(p)}
        print(json.dumps(out, indent=1)); return
    if a.inputs:
        p = Path(a.inputs).resolve(); job_id, s6 = RR.job_of(p)
        cover = RR.cover_mode(p)
        files = [str(p / f) for f in ("resume.pdf", "resume-native.md", "cover.txt", "jd.md", "company-research.md", "README.md", "package.yaml", "form.json")
                 if (p / f).exists() and not (f == "cover.txt" and cover == "none")]
        files += [s6 or f"(no step-6 JSON for job {job_id}: stop and report; the package cannot be reviewed)", str(_JOBBI_APPS / 'rework/reviewer-brief.md'), str(_JOBBI_APPS / 'rework/known-mistakes.md'),
                  str(_JOBBI_APPS / 'rework/apply-rubric.md'), str(_JOBBI_SEARCH / 'profile/claims.yaml')]
        print(json.dumps({"package": p.name, "job_id": job_id, "cover": cover, "files": files, "tool_outputs": [
            f"python3 <apps-workspace>/tools/precheck.py {p} --no-write   (every deterministic check; do not re-judge what it passed)",
            f"python3 <apps-workspace>/tools/ats_check.py {p} --json-keywords <your keywords file>",
            f"python3 <apps-workspace>/tools/review_queue.py --hashes {p}",
            "python3 <apps-workspace>/lib/claims.py <scope from README 'Claims scope:' or the folder prefix>"]}, indent=1)); return
    pkgs = sorted(p.parent for p in JA.glob(f"daily-{a.date}*/*/package.yaml"))
    rows = [row(p) for p in pkgs]
    if not a.all: rows = [r for r in rows if r["next"] != "-"]
    if a.json: print(json.dumps(rows, indent=1)); return
    print(f"{len(rows)} package(s) for {a.date}{'' if a.all else ' needing a review or finalize'}")
    for r in rows:
        print(f"\n{r['name']}  cover={r['cover']}  builder={','.join(r['builder_runs']) or 'NOT RECORDED (rebuild with --write)'}")
        for l, s in r["lenses"].items(): print(f"  {l:18s} {s}")
        print(f"  review.json: {r['review']}; stamp: {r['stamp']}; next: {r['next']}" + (f"; {r['next_round']}" if r.get("next_round") else ""))

if __name__ == "__main__":
    main()
