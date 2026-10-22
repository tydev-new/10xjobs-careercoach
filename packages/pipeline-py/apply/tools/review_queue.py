#!/usr/bin/env python3
"""review_queue.py: which packages await independent lens reviews.

  jobsearch.py review-queue --batch 2026-01-05 [--json] [--all]
      packages under <package_root>/<batch>*/ that have a package.yaml, with per-lens status
      (missing | VERDICT by <run id> | STALE | INVALID) and finalize state. Default: only packages that still
      need something (a lens review or finalize_review); --all lists every package.
      (--date is an alias of --batch: batches are usually named by date.)
  jobsearch.py review-queue --hashes <pkg>
      the sha256 values a reviewer puts in reviewed_files_sha256, plus the builder runs it must not reuse.
  jobsearch.py review-queue --inputs <pkg>
      the exact files a lens reviewer may read (apply/rubric/reviewer-brief.md "Inputs") and the tool commands it may run.
Read-only: never writes, never contacts anyone.
"""
import argparse, json, re, sys
from pathlib import Path

from pipeline import home as H
from apply.lib import reviews as RR

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

def row(pkg):
    cover = RR.cover_mode(pkg)
    st = lens_status(pkg, cover)
    rj = pkg / "review.json"; rv = json.loads(rj.read_text()) if rj.exists() else {}
    tool = (rv.get("reconciled") or {}).get("tool")
    rec = "finalized" if tool == "finalize_review.py" else ("not finalized by finalize_review" if rv else "none")
    if tool == "finalize_review.py":
        lens_changed = any(not (pkg / m["file"]).exists() or RR.sha(pkg / m["file"]) != m["sha256"] for m in rv["reconciled"]["lenses"].values())
        files_changed = any(rv["reconciled"]["reviewed_files_sha256"].get(k) != v for k, v in RR.file_hashes(pkg).items())
        if lens_changed or files_changed: rec = "finalized but OUT OF DATE (re-review / re-finalize)"
    readme = (pkg / "README.md").read_text() if (pkg / "README.md").exists() else ""
    m = re.search(r"4-lens: (PASS|REVISE|FAIL) \(([^)]*)\)", readme)
    stamp = f"{m.group(1)} ({m.group(2).split(';')[0]})" if m else "unstamped"
    ids = [v.split(" by ")[-1].split()[0] for v in st.values() if " by " in v]
    ready = all(v.split()[0] in ("PASS", "REVISE", "FAIL") and "BUILDER-RUN" not in v for v in st.values()) and len(set(ids)) == 4
    need = "lens reviews" if not ready else ("finalize" if rec != "finalized" else "-")
    return {"package": str(pkg), "name": pkg.name, "cover": cover, "builder_runs": RR.builder_runs(pkg), "lenses": st,
            "review": rec, "stamp": stamp, "next": need}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--batch", "--date", dest="batch"); g.add_argument("--hashes"); g.add_argument("--inputs")
    ap.add_argument("--json", action="store_true"); ap.add_argument("--all", action="store_true")
    a = ap.parse_args()
    if a.hashes:
        p = Path(a.hashes).resolve()
        out = {"package": p.name, "reviewed_files_sha256": {k: v for k, v in RR.file_hashes(p).items() if not (k == "cover.txt" and RR.cover_mode(p) == "none")},
               "cover": RR.cover_mode(p), "rubric_version": RR.live_rubric(), "builder_runs": RR.builder_runs(p)}
        print(json.dumps(out, indent=1)); return
    if a.inputs:
        p = Path(a.inputs).resolve(); job_id, s6 = RR.job_of(p)
        files = [str(p / f) for f in ("resume.pdf", "resume-native.md", "cover.txt", "jd.md", "company-research.md", "README.md", "package.yaml") if (p / f).exists()]
        from apply.tools.check_claims import scope_for
        files += [s6 or f"(no step-6 JSON for job {job_id}: stop and report; the package cannot be reviewed)",
                  str(RR.rubric_path()), str(H.path("reviewer_brief")), str(H.path("claims_file"))]
        cli = f"python3 {H.PKG_ROOT / 'jobsearch.py'}"
        print(json.dumps({"package": p.name, "job_id": job_id, "files": files, "tool_outputs": [
            f"{cli} check-claims {p}", f"{cli} format-check {p}",
            f"{cli} ats-check {p} --json-keywords <your keywords file>",
            f"{cli} claims {','.join(sorted(scope_for(p)))}"]}, indent=1)); return
    root = H.path("package_root")
    pkgs = sorted(p.parent for p in root.glob(f"{a.batch}*/*/package.yaml"))
    rows = [row(p) for p in pkgs]
    if not a.all: rows = [r for r in rows if r["next"] != "-"]
    if a.json: print(json.dumps(rows, indent=1)); return
    print(f"{len(rows)} package(s) for {a.batch}{'' if a.all else ' needing lens reviews or finalize'}")
    for r in rows:
        print(f"\n{r['name']}  cover={r['cover']}  builder={','.join(r['builder_runs']) or 'NOT RECORDED (rebuild with --write)'}")
        for l, s in r["lenses"].items(): print(f"  {l:18s} {s}")
        print(f"  review.json: {r['review']}; stamp: {r['stamp']}; next: {r['next']}")

if __name__ == "__main__":
    main()
