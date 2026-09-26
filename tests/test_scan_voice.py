#!/usr/bin/env python3
"""Regression tests for tests/always-on/scan_voice.py.

docs/design-plain-replies.md § 3, "Proved by": every line of before.txt
(today's voice) gets at least one HARD hit, every line of after.txt (the
plain target copy) gets none, English that shares a word with a label
gets no HARD hit, and a candidate's own tokens get no HARD hit — proving
the --candidate input actually matters.

    python3 tests/test_scan_voice.py
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tests", "always-on"))
import scan_voice as sv  # noqa: E402

FIXTURES = os.path.join(ROOT, "tests", "fixtures", "voice")


def _lines(path):
    with open(path, encoding="utf-8") as f:
        return [line.rstrip("\n") for line in f if line.strip()]


def _hard(hits):
    return [h for h in hits if h.cls == sv.HARD]


def test_every_before_line_gets_a_hard_hit():
    for line in _lines(os.path.join(FIXTURES, "before.txt")):
        hits = sv.scan_text(line, set(), "reply")
        assert _hard(hits), f"expected a HARD hit, got none: {line!r}"


def test_every_after_line_gets_no_hard_hit():
    for line in _lines(os.path.join(FIXTURES, "after.txt")):
        hits = sv.scan_text(line, set(), "reply")
        assert not _hard(hits), f"unexpected HARD hit(s) {[ (h.cls, h.match) for h in hits ]} in {line!r}"


def test_shared_vocabulary_is_not_a_hard_hit():
    # English that shares a word with a label must not fire — the patterns
    # target the label's own shape (a capitalised Track letter, the exact
    # coined phrase, digits/digits held), not any sentence using the word.
    negatives = [
        "on track",
        "a strong fit for this team",
        "at this stage",
        "the decision to migrate",
        "Golden Gate",
    ]
    for line in negatives:
        hits = sv.scan_text(line, set(), "reply")
        assert not _hard(hits), f"false positive on {line!r}: {[(h.cls, h.match) for h in hits]}"


def test_a_file_name_is_review_not_hard():
    line = "I saved it as jordan_resume.pdf in your documents folder."
    hits = sv.scan_text(line, set(), "reply")
    assert not _hard(hits), f"a file name must not be HARD: {[(h.cls, h.match) for h in hits]}"
    review = [h for h in hits if h.cls == sv.REVIEW and h.match == "jordan_resume.pdf"]
    assert review, "expected jordan_resume.pdf to be flagged REVIEW"


def test_candidate_token_downgrades_to_review():
    line = "Reach out to @acme_eng on the platform."
    # With no --candidate input, the token is unrecognised — HARD.
    hits_no_candidate = sv.scan_text(line, set(), "reply")
    hard = [h for h in hits_no_candidate if h.cls == sv.HARD and h.match == "acme_eng"]
    assert hard, "expected acme_eng to be HARD with no candidate context"

    # The same token, once the candidate's own text is known to contain
    # it, is downgraded to REVIEW — proving the --candidate input matters.
    hits_with_candidate = sv.scan_text(line, {"acme_eng"}, "reply")
    still_hard = [h for h in hits_with_candidate if h.cls == sv.HARD and h.match == "acme_eng"]
    review = [h for h in hits_with_candidate if h.cls == sv.REVIEW and h.match == "acme_eng"]
    assert not still_hard, "candidate's own token must not stay HARD"
    assert review, "candidate's own token should be flagged REVIEW"


def test_collect_candidate_tokens_reads_files_and_directories():
    import tempfile
    d = tempfile.mkdtemp()
    with open(os.path.join(d, "prompt.md"), "w") as f:
        f.write("My handle is @acme_eng, ask about it.\n")
    tokens = sv.collect_candidate_tokens([d])
    assert "acme_eng" in tokens


def test_url_and_email_exempt_snake_case_entirely():
    line = "See https://example.com/acme_eng/path for details, or mail acme_eng@example.com."
    hits = sv.scan_text(line, set(), "reply")
    assert not hits, f"a token inside a URL/email must not be scanned at all: {[(h.cls, h.match) for h in hits]}"


def test_any_py_file_is_hard_even_with_candidate_context():
    # *.py is unconditionally HARD (design § 3, bullet 2) — even a
    # candidate who happens to mention the same script name doesn't
    # make a script name safe to say to them.
    line = "Open estimate_cost.py to see the math."
    hits = sv.scan_text(line, {"estimate_cost"}, "reply")
    hard = [h for h in hits if h.cls == sv.HARD and h.match == "estimate_cost.py"]
    assert hard, "a *.py mention must stay HARD regardless of candidate context"


def test_plan_added_source_is_scanned_the_same_way():
    hits = sv.scan_text("more Track A roles", set(), "plan-added")
    assert any(h.cls == sv.HARD and h.source == "plan-added" for h in hits)
