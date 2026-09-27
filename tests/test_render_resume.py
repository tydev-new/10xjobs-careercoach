"""The renderer owns the markup — both bugs that shipped to the founder."""
import atexit, os, stat, sys, shutil, tempfile, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "skills", "apply", "scripts"))
import render_resume as rr


def _fake_chrome(script_body):
    """Writes an executable shell script standing in for Chrome and
    returns its path — never shells out to a real browser in a test.
    Its containing tempdir is cleaned up at process exit (leaves no temp
    files, always-on rule) rather than by each caller, since some callers
    (the timeout tests) intentionally leave the fake's own process running
    past the point where a normal try/finally would fire."""
    d = tempfile.mkdtemp(prefix="fake-chrome-")
    atexit.register(shutil.rmtree, d, ignore_errors=True)
    p = os.path.join(d, "chrome")
    with open(p, "w", encoding="utf-8") as f:
        f.write("#!/bin/bash\n" + script_body)
    os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return p


def _tmp_path(suffix=""):
    """A tempfile.mktemp()-shaped path (the file itself is created later,
    by to_pdf() or the test), cleaned up at process exit whether or not
    anything ever got written there — leaves no temp files."""
    p = tempfile.mktemp(suffix=suffix)
    atexit.register(lambda: os.path.exists(p) and os.remove(p))
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
    seen = _tmp_path()
    html = _tmp_path(".html")
    open(html, "w").write("<html></html>")
    pdf = _tmp_path(".pdf")
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
    reported as plain text, and only THIS call's own Chrome process GROUP
    is ever targeted (os.killpg on our own handle's pgid — never a
    name-based kill of anything else on the machine)."""
    chrome = _fake_chrome("sleep 30\n")
    html = _tmp_path(".html")
    open(html, "w").write("<html></html>")
    pdf = _tmp_path(".pdf")
    start = time.time()
    ok, err = rr.to_pdf(html, pdf, chrome=chrome, timeout=1)
    elapsed = time.time() - start
    assert ok is False
    assert "did not finish within 1s" in err, err
    assert "stopped" in err
    assert elapsed < 15, f"took {elapsed}s — the timeout did not actually cut the wait short"
    assert not os.path.exists(pdf), "no PDF should exist after a timeout"


def test_to_pdf_timeout_kills_the_whole_process_group_not_just_chrome():
    """Independent review (2026-09-27): killing only Chrome's own top PID
    on timeout left ITS OWN helper/renderer children orphaned and still
    running. A fake "chrome" that itself spawns a child sleeper — the
    child must be dead too after the timeout, not just the top process."""
    d = tempfile.mkdtemp(prefix="fake-chrome-group-")
    atexit.register(shutil.rmtree, d, ignore_errors=True)
    helper = os.path.join(d, "helper")
    os.symlink("/bin/sleep", helper)
    chrome = _fake_chrome(f'"{helper}" 60 &\nHELPER_PID=$!\necho "$HELPER_PID" > "{d}/helper.pid"\nwait\n')
    html = _tmp_path(".html")
    open(html, "w").write("<html></html>")
    pdf = _tmp_path(".pdf")
    rr.to_pdf(html, pdf, chrome=chrome, timeout=1)
    time.sleep(0.3)
    helper_pid_file = os.path.join(d, "helper.pid")
    assert os.path.exists(helper_pid_file), "the fake chrome never recorded its helper's pid"
    helper_pid = int(open(helper_pid_file).read().strip())
    try:
        os.kill(helper_pid, 0)
        alive = True
    except ProcessLookupError:
        alive = False
    assert not alive, f"helper pid {helper_pid} is still alive — timeout only killed Chrome's own top PID"


def test_to_pdf_default_timeout_is_under_the_agent_bash_tools_120s():
    """Independent review: the old 120s default was NOT under the agent
    Bash tool's own 120s default, so the TOOL could cut this script off
    before its own plain timeout message ever printed."""
    import inspect
    default = inspect.signature(rr.to_pdf).parameters["timeout"].default
    assert default < 120, default


def test_to_pdf_timeout_message_does_not_blame_another_chrome_window():
    """Independent review: this call never shares a profile with anything
    else (its own --user-data-dir), so 'another Chrome window' pointed at
    the wrong culprit — and invited exactly the wrong kind of fix."""
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "skills", "apply", "scripts", "render_resume.py")).read()
    assert "another Chrome window" not in src, src


def test_to_pdf_no_chrome_found_is_unchanged():
    # Force the "no chrome" branch deterministically by monkeypatching
    # find_chrome() — a dev laptop with a real Chrome installed must not
    # have this test silently launch it against tmp paths that don't
    # exist (that produced a stray real PDF in the repo worktree once;
    # never again — chrome=None alone isn't enough, since to_pdf falls
    # back to RENDER_RESUME_CHROME, then the real find_chrome(), when no
    # explicit chrome is given).
    html = _tmp_path(".html")
    pdf = _tmp_path(".pdf")
    real_find_chrome = rr.find_chrome
    rr.find_chrome = lambda: None
    had_env = "RENDER_RESUME_CHROME" in os.environ
    saved_env = os.environ.pop("RENDER_RESUME_CHROME", None)
    try:
        ok, err = rr.to_pdf(html, pdf, chrome=None)
    finally:
        rr.find_chrome = real_find_chrome
        if had_env:
            os.environ["RENDER_RESUME_CHROME"] = saved_env
    assert ok is False
    assert "no Chrome/Chromium found" in err
    assert not os.path.exists(pdf)
