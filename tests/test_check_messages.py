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
import os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CMSG = os.path.join(HERE, "..", "skills", "outreach", "scripts", "check_messages.py")
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


def test_rubric_hedge_mark_is_a_fail():
    """design-honest-ceilings.md § 4.2, table row 1: t13-p1A's exact hedge
    mark, 2026-09-26 — a ⚠ beside "cleared in one pass" was the miss."""
    line = "(rubric: specificity ✓ · brevity ⚠ dense by request · ask ✓ · value ✓ · voice ✓)"
    checks = cmsg.rubric_line_checks(1, line)
    assert any(level == "FAIL" and '"⚠"' in msg for level, msg in checks), checks


def test_rubric_normalized_marks_all_met_is_clean():
    line = "(rubric: specificity ✔ · brevity ✅ · ask ✓ · value ✓ · voice ✓)"
    assert cmsg.rubric_line_checks(1, line) == []


def test_rubric_note_glyph_is_not_a_mark():
    """A ⚠ inside a parenthetical note, not right after a criterion name,
    is not a mark — only what follows the criterion name is checked."""
    line = "brevity ✓ (~280/300 chars) · value ✓ (the ⚠ WATCH claim left out)"
    assert cmsg.rubric_line_checks(1, line) == []


def test_rubric_criterion_name_matches_whole_word_only():
    """honest-ceilings review ruling: 'task', 'asked' and 'values' must
    never trigger the 'ask'/'value' criteria as a bare substring."""
    for note in ("the task she posted about", "what she asked for", "her team values rigor"):
        line = f"(rubric: specificity ✓ ({note}) · brevity ✓ · ask ✓ · value ✓ · voice ✓)"
        assert cmsg.rubric_line_checks(1, line) == [], (note, cmsg.rubric_line_checks(1, line))


def test_rubric_colon_between_name_and_mark_is_allowed():
    """honest-ceilings review ruling: 'brevity: ✓' passes — a colon
    between the criterion name and its mark doesn't itself count as the
    mark."""
    line = "(rubric: specificity: ✓ · brevity: ✓ · ask: ✓ · value: ✓ · voice: ✓)"
    assert cmsg.rubric_line_checks(1, line) == []


def test_rubric_criterion_word_in_a_note_before_the_rubric_label_is_not_a_mark():
    """honest-ceilings review ruling: only the rubric segment (everything
    from the line's own 'rubric:' label onward) is searched — a
    criterion-shaped word in a note BEFORE that label is never a mark."""
    line = "she asked for the numbers (rubric: specificity ✓ · brevity ✓ · ask ✓ · value ✓ · voice ✓)"
    assert cmsg.rubric_line_checks(1, line) == []


def test_rubric_x_with_unmet_is_clean():
    line = "brevity ✗ … UNMET: dbt evidence cut"
    assert cmsg.rubric_line_checks(1, line) == []


def test_rubric_x_without_unmet_is_a_warn():
    line = "specificity ✓ · brevity ✗ · ask ✓ · value ✓ · voice ✓"
    checks = cmsg.rubric_line_checks(1, line)
    assert checks == [("WARN", "draft 1: rubric has ✗ but no UNMET — say the bar wasn't "
                                "met, and what didn't fit")], checks


def test_rubric_unmet_without_x_is_a_warn():
    line = "UNMET — specificity ✓ · brevity ✓ · ask ✓ · value ✓ · voice ✓"
    checks = cmsg.rubric_line_checks(1, line)
    assert checks == [("WARN", "draft 1: rubric says UNMET but marks nothing ✗ — mark the "
                                "criterion that failed")], checks


def test_rubric_line_is_the_first_non_blank_line_after_the_group_only():
    """A draft with no rubric: line right after it gets no rubric check —
    left alone on purpose (design-honest-ceilings.md § 4.2)."""
    text = "> A draft with no rubric line after it, just prose.\n\nSome other prose, no rubric here.\n"
    groups, lines = cmsg._draft_groups(text)
    assert len(groups) == 1
    d, end_idx = groups[0]
    assert cmsg.draft_rubric_line(lines, end_idx) is None


def test_planted_t13_draft_all_check_marks_stays_clean():
    """The real t13-ceiling planted draft (all ✓) must not trip the new
    hedge-mark FAIL or either WARN."""
    text = _read_fixture()
    groups, lines = cmsg._draft_groups(text)
    assert len(groups) == 1
    d, end_idx = groups[0]
    rline = cmsg.draft_rubric_line(lines, end_idx)
    assert rline is not None and "rubric:" in rline.lower()
    assert cmsg.rubric_line_checks(1, rline) == []


def _read_fixture():
    here = os.path.dirname(__file__)
    path = os.path.join(here, "always-on", "cases", "t13-ceiling", "ws-extra", "contacts", "nimbus.md")
    with open(path, encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------- run(), whole-script (design-honest-ceilings.md § 6A)
# design's own "New cases" list: three per script, run through the SCRIPT
# ITSELF (not the pure functions above) — warnings only, no findings, a FAIL.


def _run_whole_script(contacts_text, pinned=True):
    d = tempfile.mkdtemp(prefix="cmsg-wholescript-")
    try:
        os.makedirs(os.path.join(d, "contacts"))
        with open(os.path.join(d, "contacts", "acme.md"), "w", encoding="utf-8") as f:
            f.write(contacts_text)
        pitch = ("# P\n\n## Messages rubric\n\nPINNED 2026-08-17\n| tier | claim |\n" if pinned
                 else "# P\n")
        with open(os.path.join(d, "pitch.md"), "w", encoding="utf-8") as f:
            f.write(pitch)
        r = subprocess.run([sys.executable, CMSG, "--workspace", d, "--contacts",
                             os.path.join(d, "contacts", "acme.md")], capture_output=True, text=True)
        return r.returncode, r.stdout
    finally:
        import shutil
        shutil.rmtree(d)


_DRAFT = "> Your postmortems post matched how I work. Just applied for the Analytics Engineer role.\n"


def test_whole_script_warnings_only_new_line_never_clean():
    code, out = _run_whole_script(_DRAFT + "(rubric: specificity ✓ · brevity ✗ · ask ✓ · value ✓ · voice ✓)\n")
    assert code == 0, out
    assert "no failures, 1 warning above — fix each one or tell the candidate" in out, out
    assert "clean" not in out.lower(), out


def test_whole_script_no_findings_keeps_clean_line_unchanged():
    code, out = _run_whole_script(_DRAFT + "(rubric: specificity ✓ · brevity ✓ · ask ✓ · value ✓ · voice ✓)\n")
    assert code == 0, out
    assert "✔ message floor clean" in out, out
    assert "no failures" not in out, out


def test_whole_script_fail_line_unchanged_even_beside_a_warn():
    code, out = _run_whole_script(_DRAFT + "(rubric: specificity ✓ · brevity ⚠ · ask ✗ · value ✓ · voice ✓)\n")
    assert code == 1, out
    assert "✘ fix the FAILs before finalizing" in out, out
    assert "no failures" not in out, out
    assert "clean" not in out.split("✘")[1].split("\n")[0]


if __name__ == "__main__":
    for name in sorted(list(globals())):
        if name.startswith("test_"):
            globals()[name]()
            print(f"ok {name}")
