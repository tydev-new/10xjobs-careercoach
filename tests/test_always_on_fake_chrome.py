"""No real browser in the always-on harness (owner ruling 2026-09-26,
replacing an earlier plan to isolate the whole harness under a separate
macOS user `tentest`): a runner's PDF step must never launch a real Chrome
— that is what hung during the 2026-09-26 incident (see
skills/apply/scripts/render_resume.py's to_pdf() docstring and
tests/always-on/guard-bin/pkill for the incident it caused). Every
run_*.sh sources lib_env.sh, which points RENDER_RESUME_CHROME at
tests/always-on/fixtures/fake-chrome; render_resume.py's to_pdf() reads
that var only when its own caller passes no explicit `chrome=`.

    python3 tests/test_always_on_fake_chrome.py
"""
import os
import stat
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
AO = os.path.join(REPO, "tests", "always-on")
LIB_ENV = os.path.join(AO, "lib_env.sh")
FAKE_CHROME = os.path.join(AO, "fixtures", "fake-chrome")

sys.path.insert(0, os.path.join(REPO, "skills", "apply", "scripts"))
import render_resume as rr  # noqa: E402


def _pop_env(name):
    """(had_it, old_value) — restore with _restore_env."""
    had = name in os.environ
    old = os.environ.pop(name, None)
    return had, old


def _restore_env(name, had, old):
    if had:
        os.environ[name] = old


def test_fake_chrome_is_present_and_executable():
    assert os.path.isfile(FAKE_CHROME), FAKE_CHROME
    assert os.access(FAKE_CHROME, os.X_OK), "fake-chrome must be executable"


def test_lib_env_points_every_runner_at_the_fake_chrome():
    """The wiring every run_*.sh gets for free by sourcing lib_env.sh —
    the same shell setup tests/test_always_on_guards_review.py uses."""
    prologue = f'set -u\nROOT="{AO}"\nREPO="{REPO}"\nsource "{LIB_ENV}"\n'
    env = dict(os.environ, REALJS="/nonexistent-fakechrome-review-vault")
    r = subprocess.run(["bash", "-c", prologue + 'echo "$RENDER_RESUME_CHROME"'],
                        capture_output=True, text=True, env=env, timeout=30)
    assert r.stdout.strip() == FAKE_CHROME, (r.stdout, r.stderr)


def test_to_pdf_uses_the_fake_when_only_the_env_var_is_set():
    """The path a real harness runner takes: RENDER_RESUME_CHROME is set in
    the environment (never passed as an explicit argument), and to_pdf()
    is called exactly the way render_resume.py's own main() calls it."""
    html = tempfile.mktemp(suffix=".html")
    open(html, "w", encoding="utf-8").write("<html><body>hi</body></html>")
    pdf = tempfile.mktemp(suffix=".pdf")
    had, old = _pop_env("RENDER_RESUME_CHROME")
    os.environ["RENDER_RESUME_CHROME"] = FAKE_CHROME
    try:
        ok, err = rr.to_pdf(html, pdf)
    finally:
        os.environ.pop("RENDER_RESUME_CHROME", None)
        _restore_env("RENDER_RESUME_CHROME", had, old)
    assert ok, err
    assert os.path.exists(pdf)
    assert rr.pdf_pages(pdf) == 1
    os.remove(pdf)


def test_fake_chrome_writes_a_realistic_size_by_default():
    html = tempfile.mktemp(suffix=".html")
    open(html, "w", encoding="utf-8").write("<html></html>")
    pdf = tempfile.mktemp(suffix=".pdf")
    ok, err = rr.to_pdf(html, pdf, chrome=FAKE_CHROME)
    assert ok, err
    size = os.path.getsize(pdf)
    # realistic for a résumé PDF — comfortably under the ~100KB upload
    # limit render_resume.py warns about, and not a suspicious few-byte stub
    assert 10_000 < size < 100_000, size
    os.remove(pdf)


def test_fake_chrome_size_is_overridable_for_the_over_limit_case():
    html = tempfile.mktemp(suffix=".html")
    open(html, "w", encoding="utf-8").write("<html></html>")
    pdf = tempfile.mktemp(suffix=".pdf")
    had, old = _pop_env("FAKE_CHROME_PDF_BYTES")
    os.environ["FAKE_CHROME_PDF_BYTES"] = "150000"
    try:
        ok, err = rr.to_pdf(html, pdf, chrome=FAKE_CHROME)
    finally:
        os.environ.pop("FAKE_CHROME_PDF_BYTES", None)
        _restore_env("FAKE_CHROME_PDF_BYTES", had, old)
    assert ok, err
    assert os.path.getsize(pdf) >= 150_000
    os.remove(pdf)


def test_fake_chrome_never_hangs():
    """The whole point: no real browser, so nothing to wait on — this
    returns near-instantly, well under render_resume.py's own 120s
    default timeout (a generous 5s bound here so the test itself never
    hangs a CI run either)."""
    html = tempfile.mktemp(suffix=".html")
    open(html, "w", encoding="utf-8").write("<html></html>")
    pdf = tempfile.mktemp(suffix=".pdf")
    start = time.time()
    ok, err = rr.to_pdf(html, pdf, chrome=FAKE_CHROME, timeout=5)
    elapsed = time.time() - start
    assert ok, err
    assert elapsed < 5, f"fake-chrome took {elapsed}s — it must return near-instantly"
    os.remove(pdf)


def test_explicit_chrome_argument_overrides_the_env_var():
    """Precedence in to_pdf(): an explicit chrome= argument always wins
    over RENDER_RESUME_CHROME — a caller with its own specific need must
    not be silently redirected to the harness fake."""
    d = tempfile.mkdtemp(prefix="explicit-chrome-")
    marker = os.path.join(d, "used")
    other_chrome = os.path.join(d, "chrome")
    with open(other_chrome, "w", encoding="utf-8") as f:
        f.write(
            "#!/bin/bash\n"
            f'echo used > "{marker}"\n'
            'for a in "$@"; do case "$a" in '
            '--print-to-pdf=*) echo ok > "${a#--print-to-pdf=}";; esac; done\n'
        )
    os.chmod(other_chrome, os.stat(other_chrome).st_mode | stat.S_IEXEC)
    html = tempfile.mktemp(suffix=".html")
    open(html, "w", encoding="utf-8").write("<html></html>")
    pdf = tempfile.mktemp(suffix=".pdf")
    had, old = _pop_env("RENDER_RESUME_CHROME")
    os.environ["RENDER_RESUME_CHROME"] = FAKE_CHROME
    try:
        ok, err = rr.to_pdf(html, pdf, chrome=other_chrome)
    finally:
        os.environ.pop("RENDER_RESUME_CHROME", None)
        _restore_env("RENDER_RESUME_CHROME", had, old)
    assert ok, err
    assert os.path.exists(marker), "explicit chrome= was not the one invoked"


def test_production_behaviour_is_unchanged_when_the_env_var_is_unset():
    """Outside this harness RENDER_RESUME_CHROME is never set — to_pdf()
    must fall back to find_chrome() exactly as before this change."""
    had, old = _pop_env("RENDER_RESUME_CHROME")
    real_find_chrome = rr.find_chrome
    rr.find_chrome = lambda: None
    try:
        ok, err = rr.to_pdf(tempfile.mktemp(suffix=".html"),
                             tempfile.mktemp(suffix=".pdf"), chrome=None)
    finally:
        rr.find_chrome = real_find_chrome
        _restore_env("RENDER_RESUME_CHROME", had, old)
    assert ok is False
    assert "no Chrome/Chromium found" in err


def test_check_env_verifies_the_fake_chrome_is_wired_in():
    src = open(os.path.join(AO, "check_env.sh"), encoding="utf-8").read()
    assert "RENDER_RESUME_CHROME=" in src
    assert "fixtures/fake-chrome" in src


if __name__ == "__main__":
    failed = 0
    for name in sorted(k for k in globals() if k.startswith("test_")):
        try:
            globals()[name]()
            print("ok  ", name)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("FAIL", name, "—", e)
    sys.exit(1 if failed else 0)
