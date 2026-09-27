"""The renderer owns the markup — both bugs that shipped to the founder."""
import os, stat, sys, tempfile, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "skills", "apply", "scripts"))
import render_resume as rr


def _fake_chrome(script_body):
    """Writes an executable shell script standing in for Chrome and
    returns its path — never shells out to a real browser in a test."""
    d = tempfile.mkdtemp(prefix="fake-chrome-")
    p = os.path.join(d, "chrome")
    with open(p, "w", encoding="utf-8") as f:
        f.write("#!/bin/bash\n" + script_body)
    os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return p

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


# --- 2026-09-26 Chrome-hang incident: to_pdf() -----------------------------

def test_to_pdf_gives_chrome_its_own_temporary_profile_dir():
    """A real Chrome window holding the DEFAULT profile's lock is what made
    headless Chrome hang in the incident — to_pdf must never reach for the
    caller's own profile."""
    seen = tempfile.mktemp(prefix="seen-argv-")
    html = tempfile.mktemp(suffix=".html")
    open(html, "w").write("<html></html>")
    pdf = tempfile.mktemp(suffix=".pdf")
    # a fake "chrome" that records its own argv, then writes the PDF path
    # (its last argv element) so to_pdf's success check passes
    chrome_argv_writer = _fake_chrome(
        'for a in "$@"; do echo "$a" >> ' + seen + '; done\n'
        f'echo ok > "{pdf}"\n'
    )
    ok, err = rr.to_pdf(html, pdf, chrome=chrome_argv_writer)
    assert ok, err
    argv_text = open(seen, encoding="utf-8").read()
    assert "--user-data-dir=" in argv_text, argv_text
    # the profile dir must be a FRESH path, never the shared default one a
    # real Chrome window would also be using (no fixed, well-known path)
    for line in argv_text.splitlines():
        if line.startswith("--user-data-dir="):
            profile_dir = line.split("=", 1)[1]
            assert "render-resume-chrome-profile-" in profile_dir, profile_dir
            # cleaned up afterward — never left behind
            assert not os.path.isdir(profile_dir), "profile dir must be removed after the call"


def test_to_pdf_timeout_kills_only_its_own_child_and_reports_plainly():
    """The incident: an uncaught subprocess.TimeoutExpired crashed the
    script with a traceback, and the agent under test improvised its own
    fix (pkill'd every Chrome on the machine). Now a timeout is caught,
    reported as plain text, and only THIS call's own Chrome PID is ever
    targeted (Popen.kill() on our own handle — never a name-based kill)."""
    chrome = _fake_chrome("sleep 30\n")
    html = tempfile.mktemp(suffix=".html")
    open(html, "w").write("<html></html>")
    pdf = tempfile.mktemp(suffix=".pdf")
    start = time.time()
    ok, err = rr.to_pdf(html, pdf, chrome=chrome, timeout=1)
    elapsed = time.time() - start
    assert ok is False
    assert "did not finish within 1s" in err, err
    assert "stopped" in err
    assert elapsed < 15, f"took {elapsed}s — the timeout did not actually cut the wait short"
    assert not os.path.exists(pdf), "no PDF should exist after a timeout"


def test_to_pdf_no_chrome_found_is_unchanged():
    # Force the "no chrome" branch deterministically by monkeypatching
    # find_chrome() — a dev laptop with a real Chrome installed must not
    # have this test silently launch it against tmp paths that don't
    # exist (that produced a stray real PDF in the repo worktree once;
    # never again — chrome=None alone isn't enough, since to_pdf falls
    # back to the real find_chrome() when no explicit chrome is given).
    html = tempfile.mktemp(suffix=".html")
    pdf = tempfile.mktemp(suffix=".pdf")
    real_find_chrome = rr.find_chrome
    rr.find_chrome = lambda: None
    try:
        ok, err = rr.to_pdf(html, pdf, chrome=None)
    finally:
        rr.find_chrome = real_find_chrome
    assert ok is False
    assert "no Chrome/Chromium found" in err
    assert not os.path.exists(pdf)
