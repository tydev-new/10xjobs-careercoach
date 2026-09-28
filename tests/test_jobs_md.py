"""jobs.md record: roundtrip, loud-fail dup, find, stage moves, verdicts."""
import glob, json, os, re, shutil, subprocess, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "skills", "search", "scripts"))
import jobs_md as jm

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def rows2():
    return [
        {"company": "Cursor", "title": "Regional Director, Forward Deployed Engineering",
         "stage": "To Review", "dismissed": False, "url": "https://x/1", "location": "SF",
         "posted_at": "2026-08-01", "seen_at": "2026-08-14", "updated_at": "2026-08-14"},
        {"company": "Anthropic", "title": "Manager of Applied AI Architecture, Startups",
         "stage": "Applied", "dismissed": False, "url": "https://x/2",
         "fit_verdict": "strong", "fit_score": 88, "fit_reason": "exact function match"},
        {"company": "OpenAI", "title": "AI Deployment Manager",
         "stage": "To Review", "dismissed": True, "dismiss_reason": "delisted (gone 2026-08-10)"},
    ]

def test_roundtrip_preserves_everything():
    d = tempfile.mkdtemp()
    jm.save(d, rows2())
    back = jm.load(d)
    assert len(back) == 3
    c = next(r for r in back if r["company"] == "Cursor")
    assert c["stage"] == "To Review" and c["url"] == "https://x/1" and not c["dismissed"]
    a = next(r for r in back if r["company"] == "Anthropic")
    assert a["fit_score"] == 88 and a["fit_verdict"] == "strong" and a["stage"] == "Applied"
    o = next(r for r in back if r["company"] == "OpenAI")
    assert o["dismissed"] and "delisted" in o["dismiss_reason" if "dismiss_reason" in o else "dismiss_note"] or "delisted" in (o.get("dismiss_note") or "")

def test_duplicate_key_is_a_hard_error():
    d = tempfile.mkdtemp()
    rows = rows2() + [{"company": "Cursor, Inc", "title": "Regional Director, Forward Deployed Engineering",
                       "stage": "To Review", "dismissed": False}]
    try:
        jm.save(d, rows)
        assert False, "should have raised on canonical collision"
    except SystemExit as e:
        assert "duplicate role" in str(e)

def test_find_exact_beats_substring():
    rows = [{"company": "A", "title": "Manager, FDE", "stage": "To Review", "dismissed": False},
            {"company": "A", "title": "Platform Engineering Manager, FDE", "stage": "To Review", "dismissed": False}]
    hits = jm.find(rows, "A", "Manager, FDE")
    assert len(hits) == 1 and hits[0]["title"] == "Manager, FDE"

def test_find_ambiguous_returns_all():
    rows = [{"company": "A", "title": "Director One", "stage": "To Review", "dismissed": False},
            {"company": "A", "title": "Director Two", "stage": "To Review", "dismissed": False}]
    assert len(jm.find(rows, "A", "Director")) == 2

def test_stage_sections_render_in_board_order():
    d = tempfile.mkdtemp()
    jm.save(d, rows2())
    text = open(jm.path(d)).read()
    assert text.index("## To Review") < text.index("## Applied") < text.index("## Dismissed")
    assert "**Active: 2**" in text


def test_notes_survive_saves_and_never_parse_as_roles():
    d = tempfile.mkdtemp()
    jm.save(d, rows2())
    jm.append_note(d, "**Fractional (lane C):** Go Fractional, Bolster — attended channels.")
    jm.save(d, jm.load(d))          # a plain re-save must preserve the notes
    assert "Go Fractional" in jm.load_notes(d)
    assert len(jm.load(d)) == 3     # the note's headers did not become roles
    text = open(jm.path(d)).read()
    assert text.index("## Dismissed") < text.index("## Search notes")


# ---- B2: sanitising (design-web-search.md § 4.3/§ 4.4) -----------------

def test_save_collapses_whitespace_and_trims_every_field_and_heading():
    d = tempfile.mkdtemp()
    row = {
        "company": "  Acme\tCorp  ", "title": " Staff\n\nEngineer ",
        "stage": "To Review", "dismissed": False,
        "location": "  San Francisco,  CA  ",
        "url": "\thttps://x/1\r\n",
    }
    jm.save(d, [row])
    text = open(jm.path(d), encoding="utf-8").read()
    assert "### Acme Corp — Staff Engineer" in text
    assert "- Location: San Francisco, CA" in text
    assert "- URL: https://x/1" in text
    back = jm.load(d)[0]
    assert back["company"] == "Acme Corp" and back["title"] == "Staff Engineer"


def test_save_rewrites_em_dash_in_company_to_hyphen():
    d = tempfile.mkdtemp()
    jm.save(d, [{"company": "A — B", "title": "Role", "stage": "To Review", "dismissed": False}])
    text = open(jm.path(d), encoding="utf-8").read()
    assert "### A - B — Role" in text
    back = jm.load(d)[0]
    assert back["company"] == "A - B" and back["title"] == "Role"


def test_save_never_cleans_the_search_notes_block():
    d = tempfile.mkdtemp()
    notes = "line one\n\n  line two, indented\n### 2026-01-01\nmulti\nline block  "
    jm.save(d, rows2(), notes=notes)
    assert jm.load_notes(d) == notes.strip()  # load_notes only strips the whole block's ends
    before = open(jm.path(d), encoding="utf-8").read()
    jm.save(d, jm.load(d))  # a plain re-save must byte-for-byte preserve the notes block
    after = open(jm.path(d), encoding="utf-8").read()
    assert before == after


def test_injection_title_with_newline_and_fake_offer_heading_stays_one_line():
    # B1, kept, run against the new (sanitising) path: a posting title
    # carrying a newline and a forged heading/field must never become a
    # stage heading or a field of another row.
    d = tempfile.mkdtemp()
    evil_title = "Engineer\n## Offer\n### Evil Co — Row\n- URL: https://evil.example"
    jm.save(d, [{"company": "RealCo", "title": evil_title, "stage": "To Review", "dismissed": False}])
    rows = jm.load(d)
    assert len(rows) == 1
    r = rows[0]
    assert r["company"] == "RealCo"
    assert "\n" not in r["title"]
    assert r.get("fit_verdict") is None  # no forged Verdict field
    text = open(jm.path(d), encoding="utf-8").read()
    # "## Offer" now sits mid-line (harmless text inside the one heading
    # line), never at the START of a line — so it never parses as a
    # section heading. That's the invariant, not the raw substring's
    # absence (the merged single line legitimately still contains it).
    assert re.search(r"(?m)^## Offer", text) is None
    assert len(re.findall(r"(?m)^### ", text)) == 1  # exactly one real row heading (line-start), never the embedded "### Evil Co" text


def test_save_rewrites_a_trailing_em_dash_in_company_to_hyphen():
    # S1 review, finding 8 (LEAD spec amendment): a company ENDING in
    # ` —` (no character after the dash) would otherwise make the heading
    # read `### Acme — — Role` — two ` — ` runs, so the FIRST one (the
    # company's own trailing dash) is what load() would split on.
    d = tempfile.mkdtemp()
    jm.save(d, [{"company": "Acme —", "title": "Role", "stage": "To Review", "dismissed": False}])
    text = open(jm.path(d), encoding="utf-8").read()
    assert "### Acme - — Role" in text
    assert len(re.findall(r"(?m)^### ", text)) == 1
    back = jm.load(d)[0]
    assert back["company"] == "Acme -" and back["title"] == "Role"


def test_save_refuses_an_empty_company_or_title_after_cleaning():
    # S1 review, finding 6 (LEAD spec amendment): save() refuses loudly;
    # the writer exits 2 and jobs.md is unchanged.
    d = tempfile.mkdtemp()
    for row in (
        {"company": "   ", "title": "Role", "stage": "To Review", "dismissed": False},
        {"company": "Acme", "title": "\t\n", "stage": "To Review", "dismissed": False},
    ):
        try:
            jm.save(d, [row])
            assert False, f"should have refused: {row}"
        except SystemExit as e:
            assert e.code == 2
    assert not os.path.exists(jm.path(d))  # jobs.md unchanged (never existed)
    # unchanged when a PRIOR jobs.md already exists, too
    jm.save(d, rows2())
    before = open(jm.path(d), "rb").read()
    try:
        jm.save(d, rows2() + [{"company": "", "title": "Role", "stage": "To Review", "dismissed": False}])
        assert False, "should have refused"
    except SystemExit as e:
        assert e.code == 2
    after = open(jm.path(d), "rb").read()
    assert before == after


def test_save_writes_back_an_untouched_legacy_row_byte_identical():
    # LEAD ruling (S1 review, third pass): the empty-name refusal applies
    # only to the row THIS call writes; a pre-existing row is written
    # back exactly as it was read, even a legacy heading with no ` — `
    # separator at all (so its "title" parses as empty) — an old row
    # must never lock every write.
    d = tempfile.mkdtemp()
    seed = ("# Pipeline\n\n**Active: 1** · dismissed: 0 · updated 2026-01-01\n\n"
            "## To Review\n\n### Acme Staff Engineer\n- Seen: 2026-01-01T00:00:00+00:00\n\n")
    with open(jm.path(d), "w", encoding="utf-8") as f:
        f.write(seed)
    rows = jm.load(d)
    assert len(rows) == 1 and rows[0]["company"] == "Acme Staff Engineer" and rows[0]["title"] == ""
    k = jm.key({"company": "Beta", "title": "PM"})
    rows.append({"company": "Beta", "title": "PM", "stage": "To Review", "dismissed": False,
                 "seen_at": "2026-01-02T00:00:00+00:00"})
    jm.save(d, rows, write_key=k)  # exit 0: the legacy row is never the target
    text = open(jm.path(d), encoding="utf-8").read()
    assert "### Acme Staff Engineer\n- Seen: 2026-01-01T00:00:00+00:00" in text
    assert "### Beta — PM" in text
    back = {(r["company"], r["title"]) for r in jm.load(d)}
    assert back == {("Acme Staff Engineer", ""), ("Beta", "PM")}


def test_analysis_field_is_distinct_from_jd_and_round_trips():
    d = tempfile.mkdtemp()
    row = {"company": "Acme", "title": "PM", "stage": "To Review", "dismissed": False,
           "jd_file": "jd-inbox/acme-pm.md", "analysis_file": "jd-analysis/acme-pm.md"}
    jm.save(d, [row])
    text = open(jm.path(d), encoding="utf-8").read()
    assert "- JD: jd-inbox/acme-pm.md" in text
    assert "- Analysis: jd-analysis/acme-pm.md" in text
    back = jm.load(d)[0]
    assert back["jd_file"] == "jd-inbox/acme-pm.md"
    assert back["analysis_file"] == "jd-analysis/acme-pm.md"


# docs/design-js-only.md § 6 (J2), ruling 5: jobs_md.py stays as
# search_ats.py's library until S4, duplicated by
# skills/search/scripts/lib/jobs-md.mjs. This guards the duplicate —
# jm.save(jm.load(ws)) on the jobs.md in every record_verdict/update_job
# expected-output case's "after" (tests/checkers/cases/) must match that
# recorded jobs.md byte for byte (timestamps masked, the same way
# tests/checkers/run-cases.mjs's TS_MASK does) — a round trip through
# Python's OWN writer must reproduce exactly what both engines already
# agreed the file should look like.
TS_MASK_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00")
DATE_MASK_RE = re.compile(r"updated \d{4}-\d{2}-\d{2}")


def _mask(text):
    return DATE_MASK_RE.sub("updated <D>", TS_MASK_RE.sub("<TS>", text))


def _decode_entry(v):
    if isinstance(v, str):
        return v
    if isinstance(v, dict) and "text" in v:
        return v["text"]
    return None  # base64 (binary) or a deleted/dir marker — never jobs.md


def _jobs_md_afters():
    """Every (case path, jobs.md text) the corpus recorded for
    record_verdict/update_job, from a case's top-level "after" (single-step)
    or any step's own expect[i]["after"] (multi-step)."""
    out = []
    for group in ("record_verdict", "update_job"):
        for path in sorted(glob.glob(os.path.join(ROOT, "tests", "checkers", "cases", group, "*.json"))):
            case = json.load(open(path, encoding="utf-8"))
            trees = []
            if case.get("after"):
                trees.append(case["after"])
            for exp in case.get("expect") or []:
                if exp and exp.get("after"):
                    trees.append(exp["after"])
            for tree in trees:
                if "jobs.md" in tree:
                    text = _decode_entry(tree["jobs.md"])
                    if text is not None:
                        out.append((os.path.relpath(path, ROOT), text))
    return out


def test_jobs_md_round_trip_matches_the_js_ports_round_trip_byte_for_byte():
    """"Match byte for byte" is cross-ENGINE: this guards the duplicate
    (jobs_md.py vs skills/search/scripts/lib/jobs-md.mjs), so what must
    agree is jm.save(jm.load(ws)) in Python against the JS port's own
    save(load(ws)) on the SAME recorded jobs.md — not that either engine's
    round trip is a no-op against a file it did not itself just write
    (jm.save()'s field order is fixed and need not match whatever order a
    field happened to appear in on disk — a legitimate canonicalization,
    not a drift, and true of both engines identically)."""
    node = shutil.which("node")
    if not node:
        print("SKIPPED: no `node` on PATH")
        return
    driver = os.path.join(ROOT, "tests", "checkers", "jobs-md-driver.mjs")
    # A NUL byte can never survive canon()'s cleaning into a real key, so
    # this can never equal a real row's key(row) — every row takes
    # jm._block()'s "echo the cached _raw" path, never the clean-and-
    # validate path a plain write_key=None save() would (which correctly
    # REFUSES a legacy no-em-dash heading present in some real fixtures —
    # not this test's concern; see jobs-md-driver.mjs's own comment).
    SENTINEL = ("\x00__jobs-md-driver-roundtrip-safe-sentinel__\x00",) * 2
    cases = _jobs_md_afters()
    assert len(cases) >= 20, f"expected many record_verdict/update_job after-cases, found {len(cases)}"
    checked = 0
    for rel_path, recorded_text in cases:
        py_ws = tempfile.mkdtemp()
        with open(jm.path(py_ws), "w", encoding="utf-8") as f:
            f.write(recorded_text)
        rows = jm.load(py_ws)
        jm.save(py_ws, rows, write_key=SENTINEL)
        py_written = open(jm.path(py_ws), encoding="utf-8").read()

        js_ws = tempfile.mkdtemp()
        with open(os.path.join(js_ws, "jobs.md"), "w", encoding="utf-8") as f:
            f.write(recorded_text)
        r = subprocess.run([node, driver, "roundtrip-safe", js_ws], capture_output=True, text=True)
        assert r.returncode == 0, f"{rel_path}: js driver failed: {r.stderr}"
        js_written = open(os.path.join(js_ws, "jobs.md"), encoding="utf-8").read()

        assert _mask(py_written) == _mask(js_written), f"{rel_path}: engines' round trips disagree"
        checked += 1
    assert checked == len(cases)


def test_jobs_md_header_text_is_identical_in_both_writers():
    """§ 5.5's one deliberate change landed in both writers in the same
    commit (docs/design-js-only.md § 5.5) — this pins them together so a
    future edit to one writer's header can't silently drift from the
    other's."""
    py_src = open(os.path.join(ROOT, "skills", "search", "scripts", "jobs_md.py"), encoding="utf-8").read()
    js_src = open(os.path.join(ROOT, "skills", "search", "scripts", "lib", "jobs-md.mjs"), encoding="utf-8").read()
    py_m = re.search(r'"\*The record\. Script-written \(search sweeps, ([^"]+)",\s*\n\s*"([^"]+)"', py_src)
    js_m = re.search(r'"\*The record\. Script-written \(search sweeps, ([^"]+)",\s*\n\s*"([^"]+)"', js_src)
    assert py_m and js_m, "header text literal not found in one of the writers"
    assert py_m.groups() == js_m.groups()
    assert "update_job.mjs moves" in py_m.group(1)
    assert "record_verdict.mjs judges" in js_m.group(2)
