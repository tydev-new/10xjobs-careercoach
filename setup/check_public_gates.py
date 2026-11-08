#!/usr/bin/env python3
"""Confirm the public tree still fails the aggregate sourcing and apply checks for the known gaps.

This does not weaken those gates and does not write a baseline. The sourcing
runner prints a results file under pipeline/evals/results/; that directory is
removed before exit. A future accepted baseline has to be an explicit change
to this check, not a silent --save-baseline.
"""
from pathlib import Path
import shutil, subprocess, sys

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "workspace/job-search/pipeline/evals/results"

def run(args):
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True)

def main():
    if RESULTS.exists():
        shutil.rmtree(RESULTS)
    try:
        sourcing = run([sys.executable, "workspace/job-search/pipeline/evals/run.py", "--backend", "rules", "--check"])
        text = sourcing.stdout + sourcing.stderr
        problems = []
        if sourcing.returncode == 0:
            problems.append("sourcing --check passed; public tree has no accepted baseline and must not go green this way")
        if "[private] no cases" not in text:
            problems.append("private suite did not report that it has no cases")
        if "[examples] CHECK: no baseline" not in text:
            problems.append("examples --check did not report a missing baseline")
        if "baseline saved" in text:
            problems.append("a baseline was saved")
        apply = run([sys.executable, "workspace/job-apps/evals/run.py", "--check"])
        apply_text = apply.stdout + apply.stderr
        if apply.returncode == 0 or "no cases" not in apply_text:
            problems.append("apply --check did not refuse the missing public case set: " + apply_text.strip())
        cal = run([sys.executable, "workspace/job-apps/evals/run.py", "--set", "calibration", "--check"])
        cal_text = cal.stdout + cal.stderr
        if cal.returncode == 0 or "no cases" not in cal_text:
            problems.append("calibration --check did not refuse the missing public case set: " + cal_text.strip())
        if problems:
            print(text)
            raise SystemExit("public gate check FAIL: " + " | ".join(problems))
        print(text.strip())
        print("public gate check: PASS (aggregate remains red for the documented gaps)")
    finally:
        if RESULTS.exists():
            shutil.rmtree(RESULTS)

if __name__ == "__main__":
    main()
