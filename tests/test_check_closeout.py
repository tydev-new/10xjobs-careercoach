"""coach/scripts/check_closeout.py — the three close-out duties, checked."""
import os, subprocess, sys, tempfile, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.path.join(ROOT, "skills", "coach", "scripts", "check_closeout.py")
sys.path.insert(0, os.path.join(ROOT, "skills", "coach", "scripts"))
from check_closeout import waiting_rows
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

def test_stage_auto_inferred():
    code, out = run(PLAN, "--asked", "which mutual to Flo", "--asked", "your comp floor")
    assert code == 0 and "clean" in out and "stage groundwork" in out

def test_waiting_on_you_stops_at_trailing_optional_sections():
    # Bug repro (independent reviewer, 2026-09-26): `\b` between `#` and a
    # space is never a word boundary, so the old regex's `##\b` alternative
    # never matched a real "## Heading" line — a Queue row after Waiting on
    # you could satisfy the --asked keyword check. schema.md (§ plan.md)
    # allows exactly this shape: Board, then optional ## Standing floor /
    # ## Queue sections.
    plan = (
        "Goal: x by 2026-10-01\nBudget: 60 min/day\n\n## Board\nWaiting on you\n"
        "- the comp floor — criteria.md\n\n"
        "## Standing floor\n- 1 practice rep a day\n\n"
        "## Queue\n- timer: follow up Acme 10-02\n"
    )
    assert waiting_rows(plan) == ["the comp floor — criteria.md"]
    # The verdict: a --asked question whose only keyword overlap is with the
    # Queue/Standing-floor text (not a real Waiting-on-you row) must FAIL,
    # not be falsely satisfied.
    code, out = run(plan, "--stage", "applying", "--asked", "follow up on the timer")
    assert code == 1 and "no Waiting-on-you row" in out
    # A question that DOES match the real row still passes.
    code, out = run(plan, "--stage", "applying", "--asked", "the comp floor")
    assert code == 0 and "clean" in out
