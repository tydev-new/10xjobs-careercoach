"""coach/scripts/check_closeout.py — the three close-out duties, checked."""
import os, subprocess, sys, tempfile, time
S = os.path.join(os.path.dirname(__file__), "..", "skills", "coach", "scripts", "check_closeout.py")
PLAN = "Goal: x by 2026-10-01\nBudget: 60 min/day\n\n## Board\nWaiting on you\n- the comp floor — criteria.md § Compensation\n- warm-path pick: which of the three mutuals to Flo\nTo do\n- review the Corvid letter (10 min)\n"

def run(plan, *args, old=False):
    ws = tempfile.mkdtemp()
    if plan is not None:
        p = os.path.join(ws, "plan.md"); open(p, "w").write(plan)
        if old: os.utime(p, (time.time() - 3600, time.time() - 3600))
    r = subprocess.run([sys.executable, S, "--workspace", ws, *args], capture_output=True, text=True)
    return r.returncode, r.stdout

def test_clean():
    code, out = run(PLAN, "--stage", "applying", "--asked", "which mutual to Flo", "--asked", "your comp floor")
    assert code == 0 and "clean" in out

def test_bad_stage_fails():
    code, out = run(PLAN, "--stage", "planning")
    assert code == 1 and "stage" in out

def test_question_without_row_fails():
    code, out = run(PLAN, "--stage", "applying", "--asked", "do you want the two-page version")
    assert code == 1 and "no Waiting-on-you row" in out

def test_stale_plan_fails():
    code, out = run(PLAN, "--stage", "applying", old=True)
    assert code == 1 and "last written" in out

def test_missing_plan_fails():
    code, out = run(None, "--stage", "applying")
    assert code == 1 and "does not exist" in out
