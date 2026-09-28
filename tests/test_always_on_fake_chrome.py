"""No real browser in the always-on harness (owner ruling 2026-09-26,
replacing an earlier plan to isolate the whole harness under a separate
macOS user `tentest`): a runner's PDF step must never launch a real Chrome
— that is what hung during the 2026-09-26 incident (see
skills/apply/scripts/render_resume.py's to_pdf() docstring and
tests/always-on/guard-bin/pkill for the incident it caused). Every
run_*.sh sources lib_env.sh, which — since the fix round below — stages a
comment-free copy of tests/always-on/fixtures/fake-chrome inside the
trial's own sandbox HOME (sandbox_home_setup, never at source time) and
points RENDER_RESUME_CHROME at THAT; render_resume.py's to_pdf() reads
that var only when its own caller passes no explicit `chrome=`.

Fix round (arm-A t10 measured misses, 2026-09-27), two independent bugs:
  (a) an agent under test read RENDER_RESUME_CHROME, then `cat` the file
      BY PATH — the fixture's own docstring says "harness-owned stand-in
      for headless Chrome", so it told the "candidate" it was in a
      sandbox. Fixed: RENDER_RESUME_CHROME now points at a per-trial COPY,
      staged inside the sandbox HOME with every comment and the module
      docstring stripped (tests/always-on/stage_fake_chrome.py) — logic
      untouched, byte for byte (see test_staged_copy_is_logic_identical...
      below), nothing left worth reading.
  (b) the page model was a guess, not a measurement, and too strict — a
      330-word, 8-heading/15-bullet résumé (fixtures/resume-330w.md, an
      arm-A t10 trial's own delivered file) rendered 2 pages though
      apply's own patterns.md puts a page at ~520-560 words; the agent
      under test, told wrongly its résumé was 2 pages, cut it further
      to 278 words chasing a page count nothing real would report. Fixed:
      the fixture's WRAP_WIDTH/LINES_PER_PAGE/HEADING_EXTRA_LINES
      constants are now DERIVED from render_resume.py's own CSS, every
      step shown in the fixture's own docstring —
      test_derived_constants_match_render_resume_css below recomputes
      that same arithmetic fresh from the live CSS so a future CSS edit
      cannot silently make the fixture's constants stale.

    python3 tests/test_always_on_fake_chrome.py
"""
import atexit
import os
import py_compile
import re
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
STAGE_SCRIPT = os.path.join(AO, "stage_fake_chrome.py")
RESUME_330W = os.path.join(AO, "fixtures", "resume-330w.md")
RESUME_600W = os.path.join(AO, "fixtures", "resume-600w.md")

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


def test_lib_env_points_every_runner_at_a_staged_copy_inside_the_sandbox():
    """The wiring every run_*.sh gets for free by sourcing lib_env.sh and
    calling sandbox_home_setup — the same shell setup
    tests/test_always_on_guards_review.py uses. RENDER_RESUME_CHROME is no
    longer set at source time (fix round, 2026-09-27): it is set inside
    sandbox_home_setup, pointing at a copy staged into THAT CALL's own
    $FAKEHOME — never $FAKEHOME itself directly, and never the documented
    repo fixture."""
    prologue = f'set -u\nROOT="{AO}"\nREPO="{REPO}"\nsource "{LIB_ENV}"\nsandbox_home_setup\n'
    env = dict(os.environ, REALJS="/nonexistent-fakechrome-review-vault")
    r = subprocess.run(
        ["bash", "-c", prologue + 'echo "$FAKEHOME"; echo "$RENDER_RESUME_CHROME"'],
        capture_output=True, text=True, env=env, timeout=30)
    assert r.returncode == 0, (r.stdout, r.stderr)
    fakehome, chrome = r.stdout.splitlines()
    assert fakehome and chrome, (r.stdout, r.stderr)
    assert chrome.startswith(fakehome + os.sep), (fakehome, chrome)
    assert chrome != FAKE_CHROME, "still pointing at the documented repo fixture, not a staged copy"
    assert os.path.basename(chrome) == "chrome-headless"
    import shutil
    shutil.rmtree(fakehome, ignore_errors=True)


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
    had, old = _pop_env("PDF_PAD_BYTES")
    os.environ["PDF_PAD_BYTES"] = "150000"
    try:
        ok, err = rr.to_pdf(html, pdf, chrome=FAKE_CHROME)
    finally:
        os.environ.pop("PDF_PAD_BYTES", None)
        _restore_env("PDF_PAD_BYTES", had, old)
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


def _render_md_through_real_renderer(md_path):
    """The exact path an agent takes: render_resume.py's own to_html() on
    a REAL .md fixture, then to_pdf() through the harness fake — never a
    hand-built HTML string, so this exercises the actual block shapes
    (h1/h2/h3/p/li) render_resume.py emits, not an approximation of them."""
    md_text = open(md_path, encoding="utf-8").read()
    html = _tmp(".html")
    open(html, "w", encoding="utf-8").write(rr.to_html(md_text))
    pdf = _tmp(".pdf")
    ok, err = rr.to_pdf(html, pdf, chrome=FAKE_CHROME)
    assert ok, err
    return pdf


def test_calibration_t10_over_budget_base_renders_two_pages():
    """BLOCKING finding #2 (independent review, 2026-09-27): the fake used
    to join all visible text into one stream before wrapping, so headings
    and bullet breaks added no lines — this exact fixture (480 words,
    ~50 headings/bullets across three roles, expected.md: "measured at 2
    rendered pages") rendered as 1 page, meaning the case could never
    express the failure it exists to bait. Now block-aware and
    calibrated against this fixture directly."""
    base = os.path.join(AO, "cases", "t10-over-budget", "base-resume.md")
    pdf = _render_md_through_real_renderer(base)
    assert rr.pdf_pages(pdf) >= 2, rr.pdf_pages(pdf)
    if _HAS_PDFTOTEXT:
        r = subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True, timeout=10)
        assert r.returncode == 0, r.stderr
        assert len(r.stdout.split()) > 100, "the text layer looks empty/truncated"
    if _HAS_PYPDF:
        assert len(_pypdf.PdfReader(pdf).pages) >= 2
    os.remove(pdf)


def test_calibration_clean_one_page_resume_renders_one_page():
    """The other half of the calibration: a short, already-tailored,
    genuinely one-page résumé must NOT be inflated to 2+ pages by the
    same heading-weighting that fixed the case above."""
    tailored = os.path.join(AO, "cases", "t21-plain-report", "applications",
                            "acme-senior-data-analyst-resume.md")
    pdf = _render_md_through_real_renderer(tailored)
    assert rr.pdf_pages(pdf) == 1, rr.pdf_pages(pdf)
    if _HAS_PDFTOTEXT:
        r = subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True, timeout=10)
        assert r.returncode == 0, r.stderr
        assert "Alex Chen" in r.stdout or "ALEX CHEN" in r.stdout.upper()
    if _HAS_PYPDF:
        assert len(_pypdf.PdfReader(pdf).pages) == 1
    os.remove(pdf)


def test_fake_chrome_over_limit_pdf_still_parses_with_correct_page_count():
    """PDF_PAD_BYTES pads via a PDF comment appended AFTER every
    object's offset is already computed — the padded file must still be a
    valid, correctly-paginated PDF, not just a bigger one."""
    html = _tmp(".html")
    open(html, "w", encoding="utf-8").write(RESUME_HTML.format(bullets=""))
    pdf = _tmp(".pdf")
    had, old = _pop_env("PDF_PAD_BYTES")
    os.environ["PDF_PAD_BYTES"] = "150000"
    try:
        ok, err = rr.to_pdf(html, pdf, chrome=FAKE_CHROME)
    finally:
        os.environ.pop("PDF_PAD_BYTES", None)
        _restore_env("PDF_PAD_BYTES", had, old)
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


# --- Fix round, 2026-09-27 (arm-A t10 measured misses) -------------------
# (a) hide it: RENDER_RESUME_CHROME must point at a comment-free, per-trial
#     copy (tests/always-on/stage_fake_chrome.py), not the documented repo
#     fixture. (b) calibrate it: WRAP_WIDTH/LINES_PER_PAGE/
#     HEADING_EXTRA_LINES are now derived from render_resume.py's own CSS,
#     not guessed.

import importlib.machinery  # noqa: E402
import importlib.util  # noqa: E402


def _load_fake_chrome_module():
    """Import fixtures/fake-chrome (no .py suffix, so plain `import` can't
    find it) as a real module — used to read its WRAP_WIDTH/LINES_PER_PAGE/
    HEADING_EXTRA_LINES constants directly, never re-typed by hand here (a
    copy-pasted expected value could silently drift from the fixture)."""
    loader = importlib.machinery.SourceFileLoader("fake_chrome_fixture", FAKE_CHROME)
    spec = importlib.util.spec_from_loader("fake_chrome_fixture", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def test_staged_copy_is_logic_identical_and_carries_no_disclosure_word():
    """stage_fake_chrome.py's own contract: byte-for-byte identical PDF
    output for the same input (the docstring/comment strip touches no
    logic), and NO 'harness'/'stand-in'/'fake'/'test' word survives —
    ZERO exceptions (2026-09-27, second fix round): the env var that used
    to be the one exempted exception, FAKE_CHROME_PDF_BYTES, was itself a
    leak — a live run sets it in the agent's own environment, so a plain
    `env` printed "FAKE_CHROME". Renamed to PDF_PAD_BYTES (see
    test_fake_chrome_size_is_overridable_for_the_over_limit_case and
    test_fake_chrome_over_limit_pdf_still_parses_with_correct_page_count
    above, both of which exercise it under the new name) so this check can
    be a real, absolute ban with nothing scrubbed out first."""
    d = tempfile.mkdtemp(prefix="staged-fake-chrome-")
    try:
        copy_path = os.path.join(d, "chrome-headless")
        r = subprocess.run([sys.executable, STAGE_SCRIPT, FAKE_CHROME, copy_path],
                            capture_output=True, text=True, timeout=30)
        assert r.returncode == 0, (r.stdout, r.stderr)
        assert os.access(copy_path, os.X_OK)

        py_compile.compile(copy_path, doraise=True)  # must still be valid Python

        copy_text = open(copy_path, encoding="utf-8").read()
        hit = re.search(r"\b(harness|stand-in|fake|test)\b", copy_text, re.I)
        assert hit is None, f"disclosure word survived stripping: {hit.group(0)!r}"
        assert "PDF_PAD_BYTES" in copy_text, "the pad-size env var must still be readable by its own name"

        html = _tmp(".html")
        open(html, "w", encoding="utf-8").write(RESUME_HTML.format(bullets=""))
        orig_pdf = _tmp(".pdf")
        copy_pdf = _tmp(".pdf")
        ok1, err1 = rr.to_pdf(html, orig_pdf, chrome=FAKE_CHROME)
        ok2, err2 = rr.to_pdf(html, copy_pdf, chrome=copy_path)
        assert ok1, err1
        assert ok2, err2
        assert open(orig_pdf, "rb").read() == open(copy_pdf, "rb").read(), \
            "stripping changed the LOGIC (output bytes differ) — it must only remove comments/docstring"
        os.remove(orig_pdf)
        os.remove(copy_pdf)
    finally:
        import shutil
        shutil.rmtree(d, ignore_errors=True)


def test_calibration_330_word_resume_renders_one_page():
    """The exact arm-A t10 over-cut trigger (finding (b)): 330 words, 8
    headings, 15 bullets — the tester's own delivered file from that
    trial, copied in as fixtures/resume-330w.md. Rendered 2 pages under
    the OLD guessed constants; must render 1 now."""
    assert os.path.isfile(RESUME_330W), RESUME_330W
    pdf = _render_md_through_real_renderer(RESUME_330W)
    assert rr.pdf_pages(pdf) == 1, rr.pdf_pages(pdf)
    if _HAS_PDFTOTEXT:
        r = subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True, timeout=10)
        assert r.returncode == 0, r.stderr
        assert len(r.stdout.split()) > 50
    if _HAS_PYPDF:
        assert len(_pypdf.PdfReader(pdf).pages) == 1
    os.remove(pdf)


def test_calibration_600_word_resume_renders_two_pages():
    """The other calibration bound: apply's patterns.md puts a page at
    ~520-560 words, so a résumé of ABOUT 600 words is just past a single
    page and must render 2, not the 1 an under-strict fix could also have
    produced."""
    assert os.path.isfile(RESUME_600W), RESUME_600W
    pdf = _render_md_through_real_renderer(RESUME_600W)
    assert rr.pdf_pages(pdf) == 2, rr.pdf_pages(pdf)
    if _HAS_PDFTOTEXT:
        r = subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True, timeout=10)
        assert r.returncode == 0, r.stderr
        assert len(r.stdout.split()) > 100
    if _HAS_PYPDF:
        assert len(_pypdf.PdfReader(pdf).pages) == 2
    os.remove(pdf)


def test_derived_constants_match_render_resume_css():
    """Canary against future drift: recomputes WRAP_WIDTH/LINES_PER_PAGE/
    HEADING_EXTRA_LINES fresh from render_resume.py's LIVE CSS string (page
    size/margins, body font-size/line-height, each heading's font-size and
    margins, h2's border/padding, and ul's own padding-left for the bullet
    indent) using the exact same arithmetic the fixture's own docstring
    shows by hand — average glyph width 0.5em, floor for chars-per-line
    and lines-per-page, round-to-nearest for a heading's extra lines. If a
    future CSS edit changes any of these values, this test fails BEFORE
    the fixture's hard-coded constants go silently stale."""
    css = rr.CSS

    def rule(selector):
        for m in re.finditer(r"([^{}]+)\{([^}]*)\}", css):
            if m.group(1).strip() == selector:
                return m.group(2)
        raise AssertionError(f"selector {selector!r} not found in render_resume.py's CSS")

    def num(decl, prop, unit):
        m = re.search(rf"\b{re.escape(prop)}\s*:\s*([0-9.]+){re.escape(unit)}", decl)
        assert m, (prop, unit, decl)
        return float(m.group(1))

    def margin_parts(decl, unit="pt"):
        # 3-value margin shorthand: top, left+right, bottom. A bare 0 needs
        # no unit in CSS (render_resume.py's CSS uses this for every 0).
        val = rf"([0-9.]+(?:{unit})?|0)"
        m = re.search(rf"\bmargin\s*:\s*{val}\s+{val}\s+{val}\s*;", decl)
        assert m, decl
        top, _lr, bot = m.groups()
        return float(top.rstrip(unit) or 0), float(bot.rstrip(unit) or 0)

    page = rule("@page")
    pm = re.search(r"margin:\s*([0-9.]+)in\s+([0-9.]+)in", page)
    top_bottom_in, left_right_in = float(pm.group(1)), float(pm.group(2))
    content_width_pt = (8.5 - 2 * left_right_in) * 72
    content_height_pt = (11 - 2 * top_bottom_in) * 72

    body = rule("body")
    body_font_pt = num(body, "font-size", "pt")
    body_lh = float(re.search(r"line-height:\s*([0-9.]+)", body).group(1))
    body_line_height_pt = body_font_pt * body_lh

    h1, h2, h3, ul = rule("h1"), rule("h2"), rule("h3"), rule("ul")
    h1_font, (h1_mtop, h1_mbot) = num(h1, "font-size", "pt"), margin_parts(h1)
    h2_font, (h2_mtop, h2_mbot) = num(h2, "font-size", "pt"), margin_parts(h2)
    h2_pad_bot = num(h2, "padding-bottom", "pt")
    h2_border_px = float(re.search(r"border-bottom:\s*([0-9.]+)px", h2).group(1))
    h3_font, (h3_mtop, h3_mbot) = num(h3, "font-size", "pt"), margin_parts(h3)
    bullet_indent_pt = num(ul, "padding-left", "pt")

    GLYPH_EM = 0.5

    def chars_per_line(font_pt, avail_pt):
        return int(avail_pt // (font_pt * GLYPH_EM))

    expected_wrap_width = {
        "h1": chars_per_line(h1_font, content_width_pt),
        "h2": chars_per_line(h2_font, content_width_pt),
        "h3": chars_per_line(h3_font, content_width_pt),
        "p": chars_per_line(body_font_pt, content_width_pt),
        "li": chars_per_line(body_font_pt, content_width_pt - bullet_indent_pt),
    }
    expected_lines_per_page = int(content_height_pt // body_line_height_pt)

    PT_PER_PX = 72 / 96  # CSS px -> pt, 96px/in

    def extra(font_pt, mtop, mbot, border=0, pad=0):
        lh = font_pt * body_lh
        extra_pt = (lh - body_line_height_pt) + mtop + mbot + border + pad
        return round(extra_pt / body_line_height_pt)

    expected_heading_extra = {
        "h1": extra(h1_font, h1_mtop, h1_mbot),
        "h2": extra(h2_font, h2_mtop, h2_mbot, border=h2_border_px * PT_PER_PX, pad=h2_pad_bot),
        "h3": extra(h3_font, h3_mtop, h3_mbot),
    }

    fixture = _load_fake_chrome_module()
    assert fixture.WRAP_WIDTH == expected_wrap_width, (fixture.WRAP_WIDTH, expected_wrap_width)
    assert fixture.LINES_PER_PAGE == expected_lines_per_page, (fixture.LINES_PER_PAGE, expected_lines_per_page)
    assert fixture.HEADING_EXTRA_LINES == expected_heading_extra, (fixture.HEADING_EXTRA_LINES, expected_heading_extra)


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
