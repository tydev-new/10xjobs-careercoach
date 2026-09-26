#!/usr/bin/env python3
"""Regression test for tests/always-on/extract_text.py (independent
review, M5): a Task/Agent subagent's own text is a sidechain event
(`parent_tool_use_id` set) and must never join the top-level reply text.

UNVERIFIED against a real live capture: only synthetic stream-json
events are exercised here (the same hand-built schema
tests/test_plain_replies_review.py uses) — a real Claude Code capture
may shape `parent_tool_use_id` differently in ways this hasn't seen.

    python3 tests/test_extract_text.py
"""
import json, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
AO = os.path.join(REPO, "tests", "always-on")
KIT = os.path.join(REPO, "kit", "harness")


def _asst(text, parent=None):
    return {"type": "assistant", "message": {"role": "assistant",
            "content": [{"type": "text", "text": text}]}, "parent_tool_use_id": parent}


def _capture():
    d = tempfile.mkdtemp()
    path = os.path.join(d, "x.stream.json")
    events = [
        _asst("Top-level reply, part one."),
        _asst("Subagent internal chatter — never the reply.", parent="toolu_T"),
        _asst("Top-level reply, part two."),
    ]
    with open(path, "w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")
    return path, d


def _run(script):
    path, d = _capture()
    try:
        r = subprocess.run([sys.executable, script, path], capture_output=True, text=True)
        return r.stdout
    finally:
        import shutil
        shutil.rmtree(d)


def test_sidechain_text_excluded_both_copies():
    for script in (os.path.join(AO, "extract_text.py"), os.path.join(KIT, "extract_text.py")):
        out = _run(script)
        assert "Top-level reply, part one." in out
        assert "Top-level reply, part two." in out
        assert "Subagent internal chatter" not in out, (script, out)


def test_both_copies_byte_identical():
    with open(os.path.join(AO, "extract_text.py")) as f:
        a = f.read()
    with open(os.path.join(KIT, "extract_text.py")) as f:
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
