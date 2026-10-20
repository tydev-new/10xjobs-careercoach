"""The step counter's scorer (docs/design-fewer-steps.md § 1.3), on canned
`stderr.txt` text: no model, no run. One call of each class plus a retry pair;
the class counts and the ok/MISS lines are exact, and the counts add up.

    python3 tests/test_step_trace_scorer.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ALWAYS_ON = os.path.join(HERE, "always-on")
sys.path.insert(0, ALWAYS_ON)
import score_step_trace as S  # noqa: E402

CHECK_CMD = "node scripts/check_closeout.mjs --workspace . --stage groundwork ; node ../profile/scripts/check_files.mjs --workspace ."

# (trace line, expected class) — turn 1, in order. First match wins.
TURN1 = [
    ("[trace] turn=1 step=1 tool=list_files in=documents out=0 files", "read"),
    ("[trace] turn=1 step=1 tool=list_files in=jd-inbox out=0 files", "read"),
    ("[trace] turn=1 step=2 tool=load_skill in=profile out=ok", "read"),
    ("[trace] turn=1 step=3 tool=bash in=mkdir -p documents jd-inbox out=exit=0 clean", "setup"),
    ("[trace] turn=1 step=4 tool=bash in=ls -la skills/ out=exit=0 clean", "explore"),
    ("[trace] turn=1 step=5 tool=write_file in=plan.md (120 chars) out=written", "write"),
    (f"[trace] turn=1 step=6 tool=bash in={CHECK_CMD} out=exit=1 FAIL: plan.md has no Board", "check"),
    (f"[trace] turn=1 step=7 tool=bash in={CHECK_CMD} out=exit=0 clean", "retry"),          # same tool, same input
    ("[trace] turn=1 step=8 tool=read_file in=skills/profile/references/patterns.md out=resource_missing", "read"),  # a reference is not exploring
    ("[trace] turn=1 step=9 tool=read_file in=skills/profile/references/patterns.md out=4000 chars", "retry"),       # same path after it failed
    ("[trace] turn=1 step=10 tool=estimate_cost in=tailor the resume out=needsGate=false", "other"),
    ("[trace] turn=1 step=11 tool=read_file in=skills/profile/scripts/lib/check-files.mjs out=900 chars", "explore"),
    ("[trace] turn=1 step=12 tool=read_file in=CLAUDE.md out=2000 chars", "setup"),
    ("[trace] turn=1 step=13 tool=bash in=node scripts/update_job.mjs --company Acme out=exit=0 clean", "write"),
    ("[trace] turn=1 step=14 tool=fetch_job in=boards.greenhouse.io/acme/jobs/1 saveTo=jd-inbox/a.md out=ok", "write"),
    ("[trace] turn=1 step=15 tool=fetch_job in=boards.greenhouse.io/acme/jobs/2 out=ok", "read"),
    ("[trace] turn=1 step=16 tool=web_search in=fde jobs bay area out=3 results", "read"),
    ("[trace] turn=1 step=17 tool=check_language in=a.md out=ok", "check"),
    ("[trace] turn=1 step=18 tool=list_files in=skills out=12 files", "explore"),
    ("[trace] turn=1 step=19 tool=add_roles in=2 companies out=ok", "other"),
    ("[trace] turn=1 step=20 reply (240 chars)", "reply"),
]
T1_COUNTS = {"setup": 2, "check": 2, "write": 3, "read": 6, "explore": 3, "retry": 2, "other": 2, "reply": 1}


def _canned_run(extra=""):
    lines = [l for l, _ in TURN1]
    lines += ["[cost] turn=1 usd=0.091200 steps=20"]
    # turn 2: a clean close-out; turn 3: none at all; turn 4: nothing
    lines += [
        "[trace] turn=2 step=1 tool=write_file in=profile.md (800 chars) out=written",
        f"[trace] turn=2 step=2 tool=bash in={CHECK_CMD} out=exit=0 clean",
        "[trace] turn=2 step=3 reply (300 chars)",
        "[cost] turn=2 usd=0.030000 steps=3",
        "[trace] turn=3 step=1 tool=list_files in=(all) out=4 files",
        "[trace] turn=3 step=2 reply (500 chars)",
        "[cost] turn=3 usd=0.020000 steps=2",
        "[trace] turn=4 step=1 reply (30 chars)",
        "[cost] turn=4 usd=0.005000 steps=1",
        "[cost] usd=0.146200 steps=26",
    ]
    return "\n".join(lines) + "\n" + extra


def test_every_class_is_assigned_as_the_design_says():
    turns, total = S.parse_stderr(_canned_run())
    assert total == 0.1462
    rows = S.classify(turns[1]["rows"])
    assert len(rows) == len(TURN1)
    for row, (line, want) in zip(rows, TURN1):
        assert row["class"] == want, (line, row["class"], want)


def test_class_counts_are_exact_and_add_up_to_the_rows():
    turns, _ = S.parse_stderr(_canned_run())
    S.classify(turns[1]["rows"])
    counts = S.count_classes(turns[1]["rows"])
    assert counts == T1_COUNTS, counts
    assert sum(counts.values()) == len(TURN1) == len(turns[1]["rows"])
    assert list(counts) == ["setup", "check", "write", "read", "explore", "retry", "other", "reply"]
    # the printed line says the same, and says what it adds up to
    lines = S.render_turn(1, turns[1])
    by = [l for l in lines if l.startswith(" by class:")][0]
    assert by == " by class: setup 2 · check 2 · write 3 · read 6 · explore 3 · retry 2 · other 2 · reply 1  (= 21 rows)", by
    assert lines[0] == "turn 1  steps=20  usd=0.0912", lines[0]
    # one printed row per call, plus the header, the column line and the by-class line
    assert len(lines) == len(TURN1) + 3


def test_steps_and_rows_are_different_numbers_when_calls_share_a_step():
    turns, _ = S.parse_stderr("\n".join([
        "[trace] turn=1 step=1 tool=list_files in=documents out=0 files",
        "[trace] turn=1 step=1 tool=list_files in=jd-inbox out=0 files",
        "[trace] turn=1 step=2 reply (10 chars)",
        "[cost] turn=1 usd=0.002000 steps=2",
    ]))
    lines = S.render_turn(1, turns[1])
    assert lines[0] == "turn 1  steps=2  usd=0.0020"
    assert "(= 3 rows)" in lines[-1]


def test_the_ok_and_miss_lines_are_exact():
    turns, _ = S.parse_stderr(_canned_run())
    got = S.checks(turns, {4: "Glad to help."})
    assert len(got) == 5, got
    # turn 1: two runs; the last (the retry) was clean -> ok
    assert got[0] == (True, "turn 1: the close-out ran 2x; its last run was clean")
    assert got[1] == (True, "turn 2: the close-out ran 1x; its last run was clean")
    assert got[2] == (False, "turn 3: the close-out check did not run")
    assert got[3] == (True, "turn 4: ran no check and wrote nothing")
    assert got[4] == (True, "every step count matched")
    # a last run with a FAIL is a MISS and names it
    bad = _canned_run().replace(f"in={CHECK_CMD} out=exit=0 clean\n[trace] turn=1 step=8", f"in={CHECK_CMD} out=exit=1 FAIL: x\n[trace] turn=1 step=8")
    t2, _ = S.parse_stderr(bad)
    assert S.checks(t2, {})[0] == (False, "turn 1: the close-out ran 2x; its last run was not clean (exit=1 FAIL: x)")


def test_turn_four_questions_and_writes():
    base = _canned_run()
    turns, _ = S.parse_stderr(base)
    # a question in turn 4 with no close-out is a MISS
    got = S.checks(turns, {4: "Anything else you want to cover?"})
    assert got[3] == (False, "turn 4: the reply asks a question, so the close-out did NOT run")
    # a question with the close-out run is ok
    ran = base.replace("[trace] turn=4 step=1 reply (30 chars)",
                       f"[trace] turn=4 step=1 tool=bash in={CHECK_CMD} out=exit=0 clean\n[trace] turn=4 step=2 reply (30 chars)").replace("turn=4 usd=0.005000 steps=1", "turn=4 usd=0.005000 steps=2")
    t2, _ = S.parse_stderr(ran)
    assert S.checks(t2, {4: "Anything else?"})[3] == (True, "turn 4: the reply asks a question, so the close-out ran")
    # no question but a check ran and a file was written -> MISS, with the counts
    wrote = base.replace("[trace] turn=4 step=1 reply (30 chars)",
                         f"[trace] turn=4 step=1 tool=write_file in=plan.md (10 chars) out=written\n[trace] turn=4 step=2 tool=bash in={CHECK_CMD} out=exit=0 clean\n[trace] turn=4 step=3 reply (30 chars)").replace("turn=4 usd=0.005000 steps=1", "turn=4 usd=0.005000 steps=3")
    t3, _ = S.parse_stderr(wrote)
    assert S.checks(t3, {4: "Bye."})[3] == (False, "turn 4: ran 1 check(s) and 1 write(s); expected none")


def test_a_step_count_mismatch_marks_the_turn_and_is_left_out_of_the_medians():
    text = _canned_run().replace("[cost] turn=3 usd=0.020000 steps=2", "[trace] WARN steps ui=3 cost=2\n[cost] turn=3 usd=0.020000 steps=2")
    turns, _ = S.parse_stderr(text)
    assert turns[3]["warn"] == (3, 2) and not turns[2]["warn"]
    head = S.render_turn(3, turns[3])[0]
    assert head == "turn 3  steps=2  usd=0.0200  NOT A MEASUREMENT (step count mismatch: ui=3 cost=2)", head
    assert S.checks(turns, {})[-1] == (False, "step count mismatch in turn(s) 3")


def test_a_cost_the_provider_did_not_report_is_unknown_not_zero():
    turns, _ = S.parse_stderr("[trace] turn=1 step=1 reply (5 chars)\n[cost] turn=1 unknown steps=1 reported=0 usd=0.000000\n[cost] unknown steps=1 reported=0 usd=0.000000\n")
    assert S.render_turn(1, turns[1])[0] == "turn 1  steps=1  usd=unknown"


def test_the_command_prints_per_trial_tables_and_medians_and_never_reply_text():
    d = tempfile.mkdtemp(prefix="st-score-")
    try:
        for trial, extra in (("1", ""), ("2", ""), ("3", "")):
            os.makedirs(os.path.join(d, trial))
            with open(os.path.join(d, trial, "stderr.txt"), "w") as f:
                f.write(_canned_run(extra))
            with open(os.path.join(d, trial, "replies.md"), "w") as f:
                f.write("=== turn 1 ===\nREPLY-TEXT-SECRET\n=== turn 4 ===\nGlad to help.\n")
        r = subprocess.run([sys.executable, os.path.join(ALWAYS_ON, "score_step_trace.py"), d], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        out = r.stdout
        assert out.count("== trial ") == 3
        assert "turn 1  median 20  of [20, 20, 20]" in out and "turn 4  median 1  of [1, 1, 1]" in out, out
        assert "REPLY-TEXT-SECRET" not in out and "Glad to help" not in out
        assert "run total: 26 steps, $0.1462" in out
        # nothing to score is an error, not a blank table
        e = tempfile.mkdtemp(prefix="st-score-empty-")
        try:
            assert subprocess.run([sys.executable, os.path.join(ALWAYS_ON, "score_step_trace.py"), e], capture_output=True, text=True).returncode == 1
        finally:
            shutil.rmtree(e, ignore_errors=True)
    finally:
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
