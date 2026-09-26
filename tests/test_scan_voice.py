#!/usr/bin/env python3
"""Regression tests for tests/always-on/scan_voice.py.

docs/design-plain-replies.md § 3, "Proved by": every line of before.txt
(today's voice, § 1's five quotes verbatim) matches its own tagged
class — HARD where the leak is mechanically obvious, REVIEW where §3
itself says a file name or "gate" needs a judge's reading, never
neither. hard-coverage.txt separately proves every listed HARD pattern
fires at least once. Every line of after.txt (the plain target copy)
gets no HARD hit. English that shares a word with a label gets no HARD
hit, and a candidate's own tokens get no HARD hit — proving the
--candidate input actually matters.

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


def _tagged_lines(path):
    """(expected_class, text) pairs from a "CLASS\\ttext" tagged fixture."""
    out = []
    for line in _lines(path):
        cls, text = line.split("\t", 1)
        out.append((cls, text))
    return out


def _hard(hits):
    return [h for h in hits if h.cls == sv.HARD]


def test_before_lines_match_their_tagged_class():
    # The five design § 1 quotes, verbatim, each tagged with the class
    # scan_voice.py's own ruleset assigns it. Two are REVIEW, not HARD:
    # a workspace file name (jobs.md, plan.md) used as the subject of a
    # sentence, and "gate", are both mechanically indistinguishable from
    # a legitimate pointer/plain word — design § 3 leaves those to the
    # judge, so a HARD assertion on them would be a false claim about
    # the spec, not a stricter test.
    for expected_cls, line in _tagged_lines(os.path.join(FIXTURES, "before.txt")):
        hits = sv.scan_text(line, set(), "reply")
        classes = {h.cls for h in hits}
        if expected_cls == "HARD":
            assert "HARD" in classes, f"expected a HARD hit: {line!r}"
        else:
            assert expected_cls == "REVIEW", expected_cls
            assert "HARD" not in classes, (
                f"unexpected HARD hit(s) {[(h.cls, h.match) for h in hits]} in {line!r}")
            assert "REVIEW" in classes, f"expected a REVIEW hit: {line!r}"


def test_every_hard_coverage_line_gets_a_hard_hit():
    # One line per HARD pattern not already exercised by before.txt's two
    # HARD quotes (mechanical checks/language check, Track A): *.py,
    # shown-but-unnamed, §, To Review, N/M held, DECISION in capitals.
    for line in _lines(os.path.join(FIXTURES, "hard-coverage.txt")):
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
