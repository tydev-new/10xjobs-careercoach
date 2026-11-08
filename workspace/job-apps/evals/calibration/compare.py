#!/usr/bin/env python3
'Compare the user\'s blind grades with the reviewers on a calibration set, on two axes (2026-10-21).\n\n  writing  honest and well written. the user\'s grade is the label (their P = honest + well written).\n  fit      hard requirements, blockers, coverage. Labelled by the reviewer and code checks (planted cards: by how they\n           were built); the user\'s apply / don\'t-apply calls are not writing grades. Override with --fit "1F 5F ...".\n\n  python3 compare.py "<synthetic grades>" --pending 1:"needs approved evidence"\n  python3 compare.py "..." --pending 3 --save-baseline     # freeze the agreed set as the reviewer baseline\n\nNumbers per axis: fail_catch = of the label\'s F cards, how many the reviewers also failed; pass_match = of the label\'s P\ncards, how many the reviewers also passed. Reviewer verdicts come from key-<date>.json reviewer_axes (evals/run.py axes()).\n--save-baseline writes evals/calibration/cases/: every agreed, non-pending card (both axes agree; a planted card must\nalso match how it was built) plus the planted writing must-fail cases in planted/, then runs\n`evals/run.py --set calibration --backend frozen --save-baseline --check` (baseline key "reviewer" in evals/baseline.json).\nAnswers are saved to answers-<date>.json. Prep only: reads packages, writes only under evals/.\n'

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

import argparse, json, re, shutil, subprocess, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
EVALS = HERE.parent
AX = ("writing", "fit")

def parse(ans, n, allow_missing=()):
    got = {}
    for num, g in re.findall(r"(\d+)\s*[:=.\-]?\s*([PpFf])\b", ans or ""):
        i = int(num)
        if not 1 <= i <= n: sys.exit(f"card {i} is out of range 1..{n}")
        if i in got and got[i] != g.upper(): sys.exit(f"card {i} graded twice ({got[i]} and {g.upper()})")
        got[i] = g.upper()
    missing = [i for i in range(1, n + 1) if i not in got and i not in allow_missing]
    return got, missing

def ratio(a, b): return f"{a}/{b}" + (f" ({round(100 * a / b)}%)" if b else "")

def labels(key, user, fit_override, pending):
    """per card: {'writing': P/F/None, 'fit': P/F} labels."""
    out = {}
    for r in key["cases"]:
        n = r["n"]
        if n in pending: out[n] = {"writing": None, "fit": None}; continue
        built = r.get("built_axes") or {}
        fit = fit_override.get(n) or built.get("fit") or r["reviewer_axes"]["fit"]
        out[n] = {"writing": user.get(n), "fit": fit}
    return out

def compare(key, lab, pending):
    res = {"pending": sorted(pending)}
    agreed = []
    for k in AX:
        rows = [(r, lab[r["n"]][k]) for r in key["cases"] if lab[r["n"]][k]]
        f = [r for r, l in rows if l == "F"]; p = [r for r, l in rows if l == "P"]
        res[k] = {"fail_catch": [sum(r["reviewer_axes"][k] == "F" for r in f), len(f)],
                  "pass_match": [sum(r["reviewer_axes"][k] == "P" for r in p), len(p)],
                  "disagreements": [{"n": r["n"], "id": r["id"], "label": l, "reviewer": r["reviewer_axes"][k], "planted": r["planted"]}
                                    for r, l in rows if l != r["reviewer_axes"][k]]}
    planted_bad = []
    for r in key["cases"]:
        n = r["n"]
        if n in pending: continue
        ok = all(lab[n][k] == r["reviewer_axes"][k] for k in AX)
        if r["planted"]:
            built = r.get("built_axes") or {}
            if any(built.get(k) and lab[n][k] != built[k] for k in AX):
                ok = False; planted_bad.append(n)
        if ok: agreed.append(r)
    res["planted_label_mismatch"] = planted_bad
    res["agreed"] = [r["n"] for r in agreed]
    # reviewer misses: the label says F on an axis and the reviewers (and code) said P. They join the baseline as
    # must-fail, model-only cases (code_detectable false): the frozen reviewer misses them by definition, and a
    # reviewer-model change must catch them (reviewer_catch_rate on --backend file|command).
    misses = []
    for r in key["cases"]:
        n = r["n"]
        if n in pending or r in agreed or n in planted_bad: continue
        diff = [k for k in AX if lab[n][k] and lab[n][k] != r["reviewer_axes"][k]]
        if diff and all(lab[n][k] == "F" for k in diff): misses.append((r, diff))
    res["reviewer_misses"] = [{"n": r["n"], "id": r["id"], "axes": d} for r, d in misses]
    return res, agreed, misses

def step6_from_review(rv):
    gh = rv.get("gap_handling", [])
    return {"schema": "step6-v1", "job_id": rv.get("job_id"), "want": None, "win": None, "must_haves": [], "dealbreakers": [],
            "gaps": [g["item"] for g in gh if g["kind"] == "gap"], "blockers": [g["item"] for g in gh if g["kind"] == "blocker"],
            "note": "synthesized by calibration/compare.py from the legacy review's gap_handling"}

def save_cases(key, agreed, lab, misses=()):
    out = HERE / "cases"
    if out.exists(): shutil.rmtree(out)
    out.mkdir()
    full = lambda x: {"P": "PASS", "F": "FAIL"}[x]
    miss_ids = {r["id"]: d for r, d in misses}
    for r in list(agreed) + [r for r, _ in misses]:
        d = out / r["id"]; pkg = Path(r["package"]); n = r["n"]
        shutil.copytree(pkg, d / "pkg", ignore=shutil.ignore_patterns("*.bak*", "*.pre-*"))
        rv = json.loads((pkg / "review.json").read_text())
        if r["planted"]:
            shutil.copy2(Path(r["case_dir"]) / "step6.json", d / "step6.json")
            src = json.loads((Path(r["case_dir"]) / "expected.json").read_text())["source_package"]
        else:
            (d / "step6.json").write_text(json.dumps(step6_from_review(rv), indent=1) + "\n"); src = str(pkg)
        axes = {k: full(lab[n][k]) for k in AX}
        (d / "expected.json").write_text(json.dumps({
            "verdict": "PASS" if all(v == "PASS" for v in axes.values()) else "FAIL", "axes": axes,
            "axis_labels": {"writing": "user", "fit": "built" if r["planted"] else "reviewer+code"},
            "checks": [], "code_detectable": r["id"] not in miss_ids, "lens_should_fail": None, "source_package": src,
            **({"reviewer_miss": miss_ids[r["id"]], "note": "human label F, reviewers passed it: model-only must-fail"} if r["id"] in miss_ids else {}),
            "calibration_set": key["set"], "card": n, "planted": r["planted"], "planted_what": r.get("planted_what")}, indent=1) + "\n")
    # a reviewer miss is code-detectable when the live code checks now fail the labeled axis (e.g. a gap_check rule
    # added after the miss); otherwise it stays model-only (skipped on the frozen backend).
    if miss_ids:
        sys.path.insert(0, str(EVALS)); import run as R
        R.use_set("calibration")
        for cid, ax_missed in miss_ids.items():
            e = json.loads((out / cid / "expected.json").read_text())
            rv = json.loads((out / cid / "pkg" / "review.json").read_text())
            _, _, errs = R.grade_one(cid, rv)
            got = R.axes(rv, errs)
            e["code_detectable"] = all(got[k] == e["axes"][k] for k in ax_missed)
            (out / cid / "expected.json").write_text(json.dumps(e, indent=1) + "\n")
    planted = sorted(p for p in (HERE / "planted").iterdir() if (p / "expected.json").exists()) if (HERE / "planted").exists() else []
    for p in planted:
        shutil.copytree(p, out / p.name)
        e = json.loads((out / p.name / "expected.json").read_text())
        e.update(axis_labels={"writing": "built (planted must-fail)", "fit": "source package"}, planted=True, calibration_set=key["set"])
        (out / p.name / "expected.json").write_text(json.dumps(e, indent=1) + "\n")
    return out, len(agreed), len(planted)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("answers", help='the user\'s writing grades, e.g. "1P 2F 3P ..."')
    ap.add_argument("--pending", action="append", default=[], help='card left out for now, e.g. 3 or 3:"reason"')
    ap.add_argument("--fit", default="", help='override fit labels, e.g. "1F 5F 9F"')
    ap.add_argument("--key"); ap.add_argument("--save-baseline", action="store_true"); ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    kp = Path(a.key) if a.key else sorted(HERE.glob("key-*.json"))[-1]
    kp = kp if kp.is_absolute() else HERE / kp
    key = json.loads(kp.read_text()); n = len(key["cases"])
    pending = {}
    for p in a.pending:
        num, _, why = p.partition(":"); pending[int(num)] = why.strip() or "pending"
    user, missing = parse(a.answers, n, pending)
    if missing: sys.exit(f"missing grades for card(s) {missing}; grade them or pass --pending N")
    for i in pending: user.pop(i, None)
    fit_override, _ = parse(a.fit, n, range(1, n + 1))
    lab = labels(key, user, fit_override, pending)
    res, agreed, misses = compare(key, lab, pending)
    res["pending_notes"] = {str(k): v for k, v in pending.items()}
    if a.json: print(json.dumps(res, indent=1))
    else:
        print(f"set {key['set']}  (key {kp.name})" + (f"  pending: {', '.join(f'{k} ({v})' for k, v in pending.items())}" if pending else ""))
        for k in AX:
            src = "the user" if k == "writing" else "fit label (reviewer + code; planted: as built)"
            print(f"[{k}] label = {src}")
            print(f"  fail_catch  of the label's fails, reviewers caught: {ratio(*res[k]['fail_catch'])}")
            print(f"  pass_match  of the label's passes, reviewers also passed: {ratio(*res[k]['pass_match'])}")
            print("  disagreements:" + ("" if res[k]["disagreements"] else " none"))
            for d in res[k]["disagreements"]:
                print(f"    card {d['n']} {d['id']}: label {d['label']}, reviewers {d['reviewer']}" + ("  [planted]" if d["planted"] else ""))
        if res["planted_label_mismatch"]: print(f"planted cards whose label differs from how they were built: {res['planted_label_mismatch']}")
        print(f"agreed (baseline-eligible): {res['agreed']}")
        if res["reviewer_misses"]: print("reviewer misses (saved as must-fail; code_detectable set by grading): " + ", ".join(f"card {m['n']} {m['id']} on {'/'.join(m['axes'])}" for m in res["reviewer_misses"]))
    date = key["set"].replace("calibration-", "")
    (HERE / f"answers-{date}.json").write_text(json.dumps({"answers": a.answers, "writing_grades": user, "fit_labels": {str(k): v["fit"] for k, v in lab.items()}, **res}, indent=1) + "\n")
    if a.save_baseline:
        if not agreed: sys.exit("no agreed cards; nothing to save")
        d, na, npl = save_cases(key, agreed, lab, misses)
        print(f"wrote {na} agreed card case(s) + {len(misses)} reviewer-miss case(s) + {npl} planted writing case(s) to {d}")
        r = subprocess.run([sys.executable, str(EVALS / "run.py"), "--set", "calibration", "--backend", "frozen", "--save-baseline", "--check"],
                           capture_output=True, text=True)
        print(r.stdout.strip()[-2500:])
        if r.returncode: print(r.stderr.strip()[-800:]); sys.exit(r.returncode)

if __name__ == "__main__":
    main()
