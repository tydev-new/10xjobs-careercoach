#!/usr/bin/env python3
"""Regression tests for outreach/scripts/check_messages.py.

Each fixture reproduces a defect that actually occurred: the live Lindy
drafts' "20 years" age tag and arrow glyph (2026-08-16), and the four
reviewer-demonstrated bugs from the #26 independent review — never-say
false-FAIL on a third-party quote, PROPOSED-below-the-table escaping the
pin check, multi-row WATCH tiers losing rows, and paragraph-separated
drafts fragmenting.

    python3 tests/test_check_messages.py  (or via tests/run.py)
"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "skills", "outreach", "scripts"))
import check_messages as cmsg  # noqa: E402

PITCH_TWO_WATCH_ROWS = '''# Pitch

## Messages rubric

| Tier | Claims |
|---|---|
| PRIMARY | good claim |
| ⚠ WATCH | "$500M projected" — projected travels with it |
| ⚠ WATCH | "193K lines" — qualified or unused |

Status: PROPOSED 2026-08-15 — pin pending.
'''


def test_rubric_pinned_probe():
    """#29: WATCH forms moved to the language checker; the state probe
    (is the rubric pinned?) stays code."""
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        assert cmsg.rubric_pinned(d) is False  # no pitch.md
        open(os.path.join(d, "pitch.md"), "w").write(
            "# P\n\n## Messages rubric\n\nPROPOSED — confirm with the candidate\n| tier | claim |\n")
        assert cmsg.rubric_pinned(d) is False
        open(os.path.join(d, "pitch.md"), "w").write(
            "# P\n\n## Messages rubric\n\nPINNED 2026-08-17\n| tier | claim |\n")
        assert cmsg.rubric_pinned(d) is True


def test_never_say_scopes_to_drafts_not_third_party_quotes():
    text = (
        "Enrichment hook — their own post: \"we need more synergy here\"\n\n"
        "> Hi — saw your eval write-up. Would love to connect.\n"
    )
    ds = cmsg.drafts(text)
    joined = " ".join(ds).lower()
    assert "synergy" not in joined, "third-party quote leaked into draft scope"
    assert "eval write-up" in joined


def test_multiparagraph_draft_is_one_draft():
    text = (
        "**To the HM:**\n\n"
        "> First paragraph of the message, quite long indeed.\n\n"
        "> Second paragraph continues the same single message.\n\n"
        "Some prose after.\n\n"
        "> A second, separate draft.\n"
    )
    ds = cmsg.drafts(text)
    assert len(ds) == 2, ds
    assert "Second paragraph" in ds[0]


def test_year_count_fails_unquoted_but_quoted_jd_bar_exempt():
    import re
    d_bad = "I've spent 20 years making products reliable."
    d_ok = 'Your posting asks for "10+ years in ML infra" — here is my answer.'
    unq_bad = re.sub(r'["“][^"”]*["”]', "", d_bad)
    unq_ok = re.sub(r'["“][^"”]*["”]', "", d_ok)
    assert cmsg.YEAR_COUNT.search(unq_bad), "the live Lindy age tag must be caught"
    assert not cmsg.YEAR_COUNT.search(unq_ok), "a double-quoted JD bar is exempt"


def test_arrow_glyph_matches_the_live_defect():
    assert cmsg.ARROW_GLYPHS.search("batch failures 80%→<1%")
    assert not cmsg.ARROW_GLYPHS.search("batch failures from 80% to under 1%")


def test_ascii_arrow_in_draft_fails_and_in_url_is_exempt():
    """Owner ruling 6 (2026-09-25): the same failure class as the Unicode
    glyph, extended to ASCII arrow chains, scoped to the drafts."""
    text = "> Grew signal 80%->90% this quarter, consistently, across every team we support.\n"
    ds = cmsg.drafts(text)
    assert ds
    assert cmsg.ASCII_ARROWS.search(cmsg.EXEMPT_SPANS.sub(" ", ds[0])), ds

    text_url = "> See https://example.com/a->b for the writeup, thanks for reading it all today.\n"
    ds_url = cmsg.drafts(text_url)
    assert ds_url
    assert not cmsg.ASCII_ARROWS.search(cmsg.EXEMPT_SPANS.sub(" ", ds_url[0])), ds_url


if __name__ == "__main__":
    for name in sorted(list(globals())):
        if name.startswith("test_"):
            globals()[name]()
            print(f"ok {name}")
