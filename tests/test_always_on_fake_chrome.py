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
import atexit
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


def _tmp(suffix=""):
    """A tempfile.mktemp()-shaped path, removed at process exit whether or
    not a test's own explicit os.remove() already ran (idempotent) —
    leaves no temp files. The plain html/pdf paths below used to leak: an
    input .html was never cleaned up by any test, only its .pdf output."""
    p = tempfile.mktemp(suffix=suffix)
    atexit.register(lambda: os.path.exists(p) and os.remove(p))
    return p


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
    html = _tmp(".html")
    open(html, "w", encoding="utf-8").write("<html><body>hi</body></html>")
    pdf = _tmp(".pdf")
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
    """BLOCKING fix (independent review, 2026-09-27): size is now DERIVED
    FROM CONTENT, not a fixed 45KB stub — an empty page is a few hundred
    bytes, and a realistic one-page résumé lands comfortably under the
    ~100KB upload limit render_resume.py warns about."""
    html = _tmp(".html")
    open(html, "w", encoding="utf-8").write(
        "<html><body><h1>Alex Chen</h1><p>Senior data analyst building "
        "reliable analytics pipelines in healthcare and logistics.</p>"
        "<h2>Experience</h2><ul>"
        "<li>Built a patient no-show dashboard in Tableau, used by 3 "
        "clinic managers for daily scheduling decisions.</li>"
        "<li>Wrote and maintained SQL pipelines in Postgres over claims "
        "data, feeding the finance team's monthly close.</li>"
        "</ul></body></html>"
    )
    pdf = _tmp(".pdf")
    ok, err = rr.to_pdf(html, pdf, chrome=FAKE_CHROME)
    assert ok, err
    size = os.path.getsize(pdf)
    assert 0 < size < 100_000, size
    os.remove(pdf)


def test_fake_chrome_size_is_overridable_for_the_over_limit_case():
    html = _tmp(".html")
    open(html, "w", encoding="utf-8").write("<html></html>")
    pdf = _tmp(".pdf")
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
    html = _tmp(".html")
    open(html, "w", encoding="utf-8").write("<html></html>")
    pdf = _tmp(".pdf")
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
    html = _tmp(".html")
    open(html, "w", encoding="utf-8").write("<html></html>")
    pdf = _tmp(".pdf")
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
        ok, err = rr.to_pdf(_tmp(".html"),
                             _tmp(".pdf"), chrome=None)
    finally:
        rr.find_chrome = real_find_chrome
        _restore_env("RENDER_RESUME_CHROME", had, old)
    assert ok is False
    assert "no Chrome/Chromium found" in err


def test_check_env_verifies_the_fake_chrome_is_wired_in():
    src = open(os.path.join(AO, "check_env.sh"), encoding="utf-8").read()
    assert "RENDER_RESUME_CHROME=" in src
    assert "fixtures/fake-chrome" in src


# --- BLOCKING fix, independent review 2026-09-27: a REAL, valid PDF ------
# The first fixture wrote three objects and a trailer with no xref table
# and no startxref — not a valid PDF. pdftotext failed ("No valid XRef
# size in trailer"), pypdf failed ("startxref not found"), and apply's
# patterns.md sends a verification failure down the conversion ladder to
# running headless Chrome DIRECTLY — the original incident's trigger,
# reintroduced by the very fixture meant to remove it. These tests prove,
# with the REAL extractors (never stream-grep, patterns.md's own rule),
# that the fixture now produces something they can actually open.

import shutil as _shutil  # noqa: E402

_HAS_PDFTOTEXT = _shutil.which("pdftotext") is not None
try:
    import pypdf as _pypdf  # noqa: E402
    _HAS_PYPDF = True
except ImportError:
    _HAS_PYPDF = False

RESUME_HTML = (
    "<html><head><title>Resume</title><style>body{{font-family:sans-serif}}"
    "</style></head><body><h1>Alex Chen</h1>"
    "<p>Senior data analyst building reliable analytics pipelines.</p>"
    "{bullets}</body></html>"
)


def _render(html_text):
    html = _tmp(".html")
    open(html, "w", encoding="utf-8").write(html_text)
    pdf = _tmp(".pdf")
    ok, err = rr.to_pdf(html, pdf, chrome=FAKE_CHROME)
    assert ok, err
    return pdf


def _pdftotext(pdf_path):
    return subprocess.run(["pdftotext", pdf_path, "-"], capture_output=True,
                           text=True, timeout=10).stdout


def test_fake_chrome_pdf_parses_with_pdftotext_and_pypdf():
    """The BLOCKING finding itself: both real extractors must open the
    file without error — a fixture that only render_resume.py's own
    (lenient) pdf_pages() can read is not a fix."""
    pdf = _render(RESUME_HTML.format(bullets=""))
    if _HAS_PDFTOTEXT:
        r = subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True, timeout=10)
        assert r.returncode == 0, r.stderr
        assert "Alex Chen" in r.stdout
    else:
        print("SKIPPED: no pdftotext on PATH")
    if _HAS_PYPDF:
        reader = _pypdf.PdfReader(pdf)  # raises on an invalid trailer/xref
        assert "Alex Chen" in reader.pages[0].extract_text()
    else:
        print("SKIPPED: pypdf not installed")
    os.remove(pdf)


def test_fake_chrome_text_layer_is_the_html_visible_text_head_excluded():
    """<title>/<style> (never shown on screen) must not leak into the
    text layer; ordinary body text and HTML entities must."""
    pdf = _render(
        "<html><head><title>SHOULD-NOT-APPEAR</title>"
        "<style>body{{SHOULD-NOT-APPEAR-EITHER:1}}</style></head>"
        "<body><p>Caf&eacute; &amp; visible text</p></body></html>"
    )
    if not _HAS_PDFTOTEXT:
        print("SKIPPED: no pdftotext on PATH")
        os.remove(pdf)
        return
    text = _pdftotext(pdf)
    assert "SHOULD-NOT-APPEAR" not in text
    assert "Café" in text and "visible text" in text
    os.remove(pdf)


def test_fake_chrome_one_page_for_short_content():
    pdf = _render(RESUME_HTML.format(bullets=""))
    assert rr.pdf_pages(pdf) == 1
    if _HAS_PDFTOTEXT:
        assert subprocess.run(["pdftotext", pdf, "-"], capture_output=True, timeout=10).returncode == 0
    if _HAS_PYPDF:
        assert len(_pypdf.PdfReader(pdf).pages) == 1
    os.remove(pdf)


def test_fake_chrome_two_pages_for_long_content():
    """A long enough base résumé must render 2 pages, not 1 — the fixture
    paginates from the input instead of always claiming a single page."""
    bullets = "<ul>" + "".join(
        f"<li>Bullet {i}: a reasonably long line describing an accomplishment "
        "at a fictional company, long enough to wrap across several lines "
        "of the fixed-width stand-in layout this fixture documents.</li>"
        for i in range(40)
    ) + "</ul>"
    pdf = _render(RESUME_HTML.format(bullets=bullets))
    assert rr.pdf_pages(pdf) == 2, rr.pdf_pages(pdf)
    if _HAS_PDFTOTEXT:
        r = subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True, timeout=10)
        assert r.returncode == 0, r.stderr
        assert "Bullet 0" in r.stdout and "Bullet 39" in r.stdout
    if _HAS_PYPDF:
        assert len(_pypdf.PdfReader(pdf).pages) == 2
    os.remove(pdf)


def test_fake_chrome_over_limit_pdf_still_parses_with_correct_page_count():
    """FAKE_CHROME_PDF_BYTES pads via a PDF comment appended AFTER every
    object's offset is already computed — the padded file must still be a
    valid, correctly-paginated PDF, not just a bigger one."""
    html = _tmp(".html")
    open(html, "w", encoding="utf-8").write(RESUME_HTML.format(bullets=""))
    pdf = _tmp(".pdf")
    had, old = _pop_env("FAKE_CHROME_PDF_BYTES")
    os.environ["FAKE_CHROME_PDF_BYTES"] = "150000"
    try:
        ok, err = rr.to_pdf(html, pdf, chrome=FAKE_CHROME)
    finally:
        os.environ.pop("FAKE_CHROME_PDF_BYTES", None)
        _restore_env("FAKE_CHROME_PDF_BYTES", had, old)
    assert ok, err
    assert os.path.getsize(pdf) >= 150_000
    assert rr.pdf_pages(pdf) == 1
    if _HAS_PDFTOTEXT:
        r = subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True, timeout=10)
        assert r.returncode == 0, r.stderr
        assert "Alex Chen" in r.stdout
    if _HAS_PYPDF:
        reader = _pypdf.PdfReader(pdf)
        assert len(reader.pages) == 1
        assert "Alex Chen" in reader.pages[0].extract_text()
    os.remove(pdf)


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
