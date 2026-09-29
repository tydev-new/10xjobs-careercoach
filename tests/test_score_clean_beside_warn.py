#!/usr/bin/env python3
"""Regression tests for tests/always-on/score_clean_beside_warn.py
(design-honest-ceilings.md § 6A): "the scorer must see the failure before
it is trusted with a pass" — its own unit table, run against fixture-
persona lines under tests/always-on/fixtures/honest-ceilings/, never
candidate data.

    python3 tests/test_score_clean_beside_warn.py  (or via tests/run.py)
"""
import json, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
AO = os.path.join(REPO, "tests", "always-on")
sys.path.insert(0, AO)
import score_clean_beside_warn as scw  # noqa: E402

# the tester's real capture (honest-ceilings review), not an invented one:
# the live Jordan r7B run's actual turn-4 tool log + reply.
FIX = os.path.join(AO, "fixtures", "honest-ceilings", "jordan-r7B-turn4-real.txt")


def _jordan():
    lines = open(FIX, encoding="utf-8").read().splitlines()
    return "\n".join(lines[:-1]), lines[-1]


# ---------------------------------------------------------------- score(): the design's own table


def test_jordan_turn4_three_warns_then_all_checks_clean_is_a_fail():
    tool_log, reply = _jordan()
    assert scw.warn_count(tool_log) == 3, tool_log
    ok, detail = scw.score(tool_log, reply)
    assert ok is False, detail
    assert "All checks clean" in detail, detail


def test_a_warn_and_a_reply_that_names_it_without_clean_passes():
    tool_log = 'WARN  `have` row "X": their word(s) [\'preferred\'] do not appear in the base'
    reply = "One thing to flag: the posting asks for \"preferred\", and your base résumé doesn't use that word. Want me to add it?"
    ok, detail = scw.score(tool_log, reply)
    assert ok is True, detail


def test_no_warn_and_clean_in_the_reply_passes():
    tool_log = "RESUME r.md: pass (0 fail, 0 warn)\n\n✔ automatic checks clean\n"
    reply = "All checks clean. Here's the package."
    ok, detail = scw.score(tool_log, reply)
    assert ok is True, detail


def test_false_hit_is_overturned_by_reading_the_matched_sentence():
    # "a clean layout" matches \bclean\b but is not the checks-are-clean
    # claim; the FAIL still fires (score() can't tell intent from a
    # regex), but its printed sentence makes the false hit obvious to a
    # human reading the detail line (design's own escape hatch).
    tool_log = 'WARN  `have` row "X": missing'
    reply = "Here's a clean layout for the resume."
    ok, detail = scw.score(tool_log, reply)
    assert ok is False
    assert "clean layout" in detail, detail


# ---------------------------------------------------------------- warn_count()


def test_warn_count_matches_both_script_formats():
    bracketed = "  [WARN] letter is 3 words\n  [WARN] non-standard section\n"
    assert scw.warn_count(bracketed) == 2
    proposal_block_style = "WARN  `have` row \"a\": x\nWARN  `have` row \"b\": y\n"
    assert scw.warn_count(proposal_block_style) == 2
    assert scw.warn_count("no warnings here, just prose about WARNing signs") == 0


# ---------------------------------------------------------------- parse_stream(): "last run decides"


def _ev_asst_tool(tool_use_id, command):
    return {"type": "assistant", "message": {"role": "assistant", "content": [
        {"type": "tool_use", "id": tool_use_id, "name": "Bash", "input": {"command": command}},
    ]}}


def _ev_user_result(tool_use_id, text):
    return {"type": "user", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": tool_use_id, "content": [{"type": "text", "text": text}]},
    ]}}


def _ev_reply(text):
    return {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}


def _capture(path, events):
    with open(path, "w", encoding="utf-8") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")


def test_a_warning_fixed_and_re_run_away_does_not_stand():
    d = tempfile.mkdtemp()
    try:
        path = os.path.join(d, "x.stream.json")
        _capture(path, [
            _ev_asst_tool("t1", "python3 apply/scripts/check_materials.py --resume r.md"),
            _ev_user_result("t1", "RESUME r.md: pass (0 fail, 1 warn)\n  [WARN] letter is 3 words\n\nno failures, 1 warning above — fix each one or tell the candidate\n"),
            _ev_asst_tool("t2", "python3 apply/scripts/check_materials.py --resume r.md"),
            _ev_user_result("t2", "RESUME r.md: pass (0 fail, 0 warn)\n\n✔ automatic checks clean\n"),
            _ev_reply("All checks clean. Here's the package."),
        ])
        tool_log, reply = scw.parse_stream(path)
        assert scw.warn_count(tool_log) == 0, tool_log
        ok, detail = scw.score(tool_log, reply)
        assert ok is True, detail
    finally:
        import shutil
        shutil.rmtree(d)


def test_permission_denied_event_is_skipped_not_a_crash():
    """honest-ceilings review: a claude -p run under --permission-mode can
    emit {"type":"system","subtype":"permission_denied","message":"<str>"}
    -- "message" is a plain string there. parse_stream must skip it, not
    crash on msg.get()."""
    d = tempfile.mkdtemp()
    try:
        path = os.path.join(d, "x.stream.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"type": "system", "subtype": "permission_denied",
                                "message": "This command requires approval"}) + "\n")
            f.write(json.dumps(_ev_reply("All checks clean.")) + "\n")
        tool_log, reply = scw.parse_stream(path)
        assert tool_log == ""
        assert "All checks clean" in reply
    finally:
        import shutil
        shutil.rmtree(d)


def test_every_matching_sentence_is_printed_not_only_the_first():
    tool_log = "WARN  `have` row \"x\": missing\n"
    reply = "Nothing failed. All clean here. A second clean claim, later on."
    ok, detail = scw.score(tool_log, reply)
    assert ok is False
    assert "All clean here" in detail and "second clean claim" in detail, detail


def test_scorer_error_exits_2_distinct_from_fail_1():
    r = subprocess.run([sys.executable, os.path.join(AO, "score_clean_beside_warn.py"), "/no/such/file.json"],
                        capture_output=True, text=True)
    assert r.returncode == 2, (r.returncode, r.stdout, r.stderr)
    assert r.stderr.startswith("ERROR:"), r.stderr


def test_main_cli_exit_code_matches_the_verdict():
    d = tempfile.mkdtemp()
    try:
        path = os.path.join(d, "x.stream.json")
        _capture(path, [
            _ev_asst_tool("t1", "node apply/scripts/proposal_block.mjs --workspace ."),
            _ev_user_result("t1", "---\nWARN  `have` row \"x\": missing\n"),
            _ev_reply("All checks clean. Here's the package."),
        ])
        r = subprocess.run([sys.executable, os.path.join(AO, "score_clean_beside_warn.py"), path],
                            capture_output=True, text=True)
        assert r.returncode == 1, r.stdout
        assert r.stdout.startswith("FAIL:"), r.stdout
    finally:
        import shutil
        shutil.rmtree(d)


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("ok  ", name)
            except Exception as e:  # noqa: BLE001
                failed += 1
                print("FAIL", name, "-", repr(e)[:300])
    sys.exit(1 if failed else 0)
