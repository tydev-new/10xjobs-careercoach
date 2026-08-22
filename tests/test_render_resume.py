"""The renderer owns the markup — both bugs that shipped to the founder."""
import os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "skills", "apply", "scripts"))
import render_resume as rr

WRAPPED = """# ALEX CHEN

## Summary

Built the solutions engineering function three times and wrote the standards it
ran on — the hiring bar, the POC playbook, the deployment playbook. Now builds
production agent systems.

- **Deep fluency in the pre-sales craft — discovery, proofs of concept:** ran it
  as Director of Solutions Engineering, then wrote the playbooks the team used.
"""


def test_wrapped_prose_is_one_paragraph():
    """Bug 1 (shipped 2026-08-18): each wrapped source line became its own <p>,
    so the summary rendered as a column of orphan lines."""
    h = rr.to_html(WRAPPED)
    assert h.count("<p>") == 1, h
    assert "wrote the standards it ran on" in h, "the join dropped or mangled text"


def test_bold_spanning_a_line_break_converts():
    """Bug 2 (shipped 2026-08-18): a ** span opening on one line and closing on
    the next printed literal asterisks in the PDF."""
    h = rr.to_html(WRAPPED)
    assert "**" not in h, "literal markdown survived into the HTML"
    assert "<strong>Deep fluency in the pre-sales craft — discovery, proofs of concept:</strong>" in h


def test_html_is_escaped_by_the_builder():
    h = rr.to_html("# A\n\n- Scaled 40+ engineers & <ops> teams\n")
    assert "&amp;" in h and "&lt;ops&gt;" in h, h
    assert "<ops>" not in h


def test_bullets_group_into_one_list():
    h = rr.to_html("# A\n\n- one\n- two\n\n## Next\n\n- three\n")
    assert h.count("<ul>") == 2 and h.count("</ul>") == 2, h
    assert h.count("<li>") == 3


def test_word_count_ignores_markup():
    n = rr.word_count("# Alex Chen\n\n- **Bold lead:** three more words\n")
    assert n == 7, n   # "Alex Chen" (2) + "Bold lead: three more words" (5)


def test_page_target_is_reported_not_enforced_by_default():
    """The candidate decides what gets cut — the renderer measures and says so."""
    import inspect
    src = inspect.getsource(rr.main)
    assert "never trim silently" in src
    assert '"--strict"' in src, "strict must be opt-in, not the default"
