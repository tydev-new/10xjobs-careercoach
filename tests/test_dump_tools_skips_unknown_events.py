#!/usr/bin/env python3
"""Regression test: tests/always-on/dump_tools.py (and its byte-identical
kit/harness/dump_tools.py copy) must not crash on a stream event whose
"message" field is a plain string, not a dict.

honest-ceilings review: a `claude -p` run under --permission-mode can
emit {"type":"system","subtype":"permission_denied","message":"<str>"}.
Both collect_results() and walk() called msg.get() on that string.

    python3 tests/test_dump_tools_skips_unknown_events.py  (or via tests/run.py)
"""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
AO = os.path.join(REPO, "tests", "always-on")
KIT = os.path.join(REPO, "kit", "harness")


def _capture():
    d = tempfile.mkdtemp()
    path = os.path.join(d, "x.stream.json")
    events = [
        {"type": "system", "subtype": "permission_denied", "message": "This command requires approval"},
        {"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "tool_use", "id": "toolu_A", "name": "Bash", "input": {"command": "echo hi"}},
        ]}},
        {"type": "user", "message": {"role": "user", "content": [
            {"tool_use_id": "toolu_A", "type": "tool_result", "content": [{"type": "text", "text": "hi"}]},
        ]}},
    ]
    with open(path, "w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")
    return path, d


def test_dump_tools_does_not_crash_on_a_permission_denied_event_both_copies():
    for script in (os.path.join(AO, "dump_tools.py"), os.path.join(KIT, "dump_tools.py")):
        path, d = _capture()
        try:
            r = subprocess.run([sys.executable, script, "--results", path], capture_output=True, text=True)
            assert r.returncode == 0, (script, r.stderr)
            assert "TOOL Bash: 'echo hi'" in r.stdout, (script, r.stdout)
            assert "RESULT: 'hi'" in r.stdout, (script, r.stdout)
        finally:
            import shutil
            shutil.rmtree(d)


def test_both_copies_stay_byte_identical():
    with open(os.path.join(AO, "dump_tools.py")) as f:
        a = f.read()
    with open(os.path.join(KIT, "dump_tools.py")) as f:
        b = f.read()
    assert a == b


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
