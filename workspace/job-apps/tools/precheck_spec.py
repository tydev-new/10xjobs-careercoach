#!/usr/bin/env python3
"""OPTIONAL since 2026-10-21 simplification: not a gate; build_package.py --write runs the kept gates (claims, JD copy, format).
precheck_spec.py: check a package.yaml's TEXT before build_package.py --write, so each package builds once (2026-10-21).

  python3 precheck_spec.py <pkg> [--strict] [--json] [--gap-handling FILE]

Renders resume-native.md and cover.txt from <pkg>/package.yaml in memory (no PDFs) into a temp copy of the package
(README.md and jd.md copied for the claims scope and the JD), then runs:
  1. claims  : the spec's claim citations (build_package.check_spec_claims) and check_claims.py on the rendered text
  2. jd copy : ats_check longest word run shared with jd.md (resume + cover). 8+ = FAIL (rubric Lens D), 6-7 = WARN
  3. gaps    : gap_check.py against the job's step-6 record, with gap_handling taken from (first found)
               --gap-handling FILE (a lens file or a bare list), package.yaml `gap_plan`, or a default plan
               (every gap `omitted` with the named technologies in its wording as terms, every blocker `blocker_flagged`/flagged_to_user).
               With an explicit plan every gap_check failure is a FAIL. With the default plan OVERCLAIM hits are
               WARN (default terms are guesses from the gap wording) unless --strict; missing step-6 record = WARN.
Exit 0 = no FAIL (WARNs listed), 1 = at least one FAIL. Writes nothing in the package. build_package.py --write
still re-runs the claims gate, and stamp_review.py still re-runs everything; this only saves rebuilds.
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

import argparse, json, re, shutil, subprocess, sys, tempfile
from pathlib import Path
import yaml
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(_JOBBI_APPS / 'lib'))
import ats_check, gap_check, reconcile_reviews as RR
import build_package as BP

COPY_FAIL, COPY_WARN = 8, 6

COMMON = {"AI", "IC", "VP", "JD", "SF", "US", "UK", "NYC", "LA"}
def plan_terms(item):
    """terms for the default plan: named technologies / standards only (2+ capitals, letters+digits, or an
    implied_terms.yaml key), so plain words like 'cloud' or 'program' in a gap sentence don't flag real claims."""
    keys = set(gap_check.implied())
    item = re.sub(r"(?i)[(;,]?\s*closest:[^)]*\)?", " ", item)   # Candidate-specific annotation removed.
    toks = re.findall(r"[A-Za-z][\w+#./-]*", item)
    out = [t.rstrip(".,") for t in toks if t.lower() in keys
           or ((sum(ch.isupper() for ch in t) >= 2 or (re.search(r"\d", t) and re.search(r"[A-Za-z]{2}", t))) and t.rstrip(".,") not in COMMON)]
    return list(dict.fromkeys(out))

OC_RX = re.compile(r"^OVERCLAIM (?:resume implies|cover names) (?:gap|blocker) ('(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\") (?:is met )?\(('(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\")")
def keep_default(f):
    """default plan: keep an OVERCLAIM only when its term is a named technology from the gap (or a paraphrase of one).
    gap_check falls back to every word of the gap when terms is empty; those hits are noise here."""
    m = OC_RX.match(f)
    if not m: return True
    import ast
    item, term = ast.literal_eval(m.group(1)), ast.literal_eval(m.group(2))
    pt = plan_terms(item); imp = gap_check.implied()
    ok = {t.lower() for t in pt} | {x.lower() for t in pt for x in imp.get(t.lower(), [])}
    return term.lower() in ok

def default_plan(rec):
    gh = [{"item": g, "kind": "gap", "handling": "omitted", "terms": plan_terms(g), "reason": "precheck default plan: no evidence, left out"}
          for g in rec.get("gaps", [])]
    gh += [{"item": b, "kind": "blocker", "handling": "blocker_flagged", "decision": "flagged_to_user", "terms": plan_terms(b),
            "reason": "precheck default plan: blocker flagged to the user"} for b in rec.get("blockers", [])]
    return gh

def run(pkg, strict=False, gap_file=None):
    pkg = Path(pkg).resolve(); out = {"package": pkg.name, "fail": [], "warn": [], "ok": []}
    if not (pkg / BP.SPEC).exists():
        out["fail"].append(f"SPEC no {BP.SPEC} in {pkg} (precheck needs the spec; build_package.py --init writes a skeleton)"); out["result"] = "FAIL"; return out
    spec, md, cover, errs = BP.build(pkg)
    out["fail"] += [f"CLAIMS spec: {e}" for e in errs]
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t) / pkg.name; tmp.mkdir()
        for f in ("README.md", "jd.md"):
            if (pkg / f).exists(): shutil.copy2(pkg / f, tmp / f)
        (tmp / "resume-native.md").write_text(md)
        if cover is not None: (tmp / "cover.txt").write_text(cover)
        r = subprocess.run([sys.executable, str(HERE / "check_claims.py"), str(tmp)], capture_output=True, text=True)
        cc = [l.strip() for l in r.stdout.splitlines() if "FAIL" in l and not l.strip().startswith(("Claims check", "Result"))]
        if r.returncode != 0: out["fail"] += [f"CLAIMS {l}" for l in (cc or [r.stdout.strip()[-300:]])]
        else: out["ok"].append("claims: check_claims PASS on the rendered text")
        if not (tmp / "jd.md").exists(): out["warn"].append("JD-COPY no jd.md in the package: copy check skipped")
        else:
            a = ats_check.compute(tmp, [])
            n, s = a["max_jd_copy_run"], a["max_jd_copy_text"]
            if n >= COPY_FAIL: out["fail"].append(f"JD-COPY {n}-word run copied from jd.md (limit {COPY_FAIL - 1}): {s!r}")
            elif n >= COPY_WARN: out["warn"].append(f"JD-COPY {n}-word run copied from jd.md (6-7 = ATS Revise): {s!r}")
            else: out["ok"].append(f"jd copy: longest shared run {n} words")
        cover_mode = "none" if cover is None else RR.cover_mode(pkg)
        job_id, s6 = RR.job_of(pkg)
        rec = json.loads(Path(s6).read_text()) if s6 else None
        if gap_file:
            d = json.loads(Path(gap_file).read_text()); gh, src = (d["gap_handling"] if isinstance(d, dict) else d), f"--gap-handling {gap_file}"
        elif spec.get("gap_plan") is not None:
            gh, src = spec["gap_plan"], "package.yaml gap_plan"
        else:
            gh, src = (default_plan(rec) if rec else []), "default plan"
        out["gap_source"] = src
        if rec is None:
            (out["fail"] if strict else out["warn"]).append(f"GAPS no step-6 JSON for this package (job {job_id}): gap check skipped; score the job first (lens reviewers need it)")
        else:
            rv = {"gap_handling": gh, "step6_record": s6, "cover": cover_mode, "final": "REVISE"}
            fails, _ = gap_check.check(tmp, rv)
            explicit = src != "default plan"
            if not explicit: fails = [f for f in fails if keep_default(f)]
            for f in fails:
                hard = explicit or strict or not f.startswith("OVERCLAIM")
                (out["fail"] if hard else out["warn"]).append(f"GAPS {f}")
            if not fails: out["ok"].append(f"gaps: {len(gh)} step-6 item(s), no overclaim ({src})")
    out["result"] = "FAIL" if out["fail"] else ("WARN" if out["warn"] else "PASS")
    return out

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pkg", nargs="+"); ap.add_argument("--strict", action="store_true"); ap.add_argument("--json", action="store_true")
    ap.add_argument("--gap-handling")
    a = ap.parse_args(); res = [run(p, a.strict, a.gap_handling) for p in a.pkg]
    if a.json: print(json.dumps(res if len(res) > 1 else res[0], indent=1))
    else:
        for o in res:
            print(f"{o['result']:4s} {o['package']}")
            for k in ("fail", "warn", "ok"):
                for x in o[k]: print(f"  {k.upper():4s} {x}")
    sys.exit(1 if any(o["fail"] for o in res) else 0)

if __name__ == "__main__":
    main()
