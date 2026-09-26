"""Tester-owned acceptance tests for design-web-search.md S1 (§ 4.3, § 7.1,
§ 4.10's host-note split sentence), written from the design, not the code.

Every behavioral check runs BOTH runtimes on the same input and compares
bytes: jobs_md.py / record_verdict.py (Python) and packages/checkers'
jobs-md.mjs / bin/record_verdict.mjs (Node). The design's exit is "parity
100% with the new cases", and § 4.4 names one written-out whitespace class,
"the same in both languages". Skips loudly when `node` is not on PATH.

    python3 tests/run.py            # runs these with everything else
"""
import json, os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "search", "scripts"))
import jobs_md as jm  # noqa: E402

PY_RV = os.path.join(ROOT, "skills", "evaluate", "scripts", "record_verdict.py")
JS_RV = os.path.join(ROOT, "packages", "checkers", "bin", "record_verdict.mjs")
JS_JM = os.path.join(ROOT, "tests", "checkers-parity", "s1_jm_js.mjs")
NODE = shutil.which("node")
FROZEN = "2026-09-23T12:34:56+00:00"

# § 4.3: "space, tab, \n, \r, form feed, vertical tab, U+0085, U+00A0,
# U+2028, U+2029" — the whole class, and nothing else.
CLASS = [" ", "\t", "\n", "\r", "\f", "\v", "\x85", "\xa0", "\u2028", "\u2029"]
# Characters Python's `\s` or JavaScript's `\s` count that the class does
# NOT (§ 4.4 names both gaps), plus a zero-width space. save() must keep them.
OUTSIDE = ["\x1c", "\x1d", "\x1e", "\x1f", "\u1680", "\u2000", "\u200a", "\u202f",
           "\u205f", "\u3000", "\ufeff", "\u200b"]

_BOOT = """
import sys, runpy, os, datetime as D
base = D.datetime.fromisoformat(%r)
class FD(D.datetime):
    @classmethod
    def now(cls, tz=None):
        return base if tz is None else base.astimezone(tz)
D.datetime = FD
script = sys.argv[1]
sys.argv = sys.argv[1:]
sys.path[0] = os.path.dirname(os.path.abspath(script))
runpy.run_path(script, run_name="__main__")
""" % FROZEN


def _skip():
    if NODE:
        return False
    print("SKIPPED test_search_s1_tester: no `node` on PATH (both-runtime checks need it)")
    return True


def _frozen_py_save(ws, rows, notes=None):
    real = jm.now_iso
    jm.now_iso = lambda: FROZEN
    try:
        jm.save(ws, [dict(r) for r in rows], notes=notes)
    finally:
        jm.now_iso = real


def _frozen_py_roundtrip(ws):
    real = jm.now_iso
    jm.now_iso = lambda: FROZEN
    try:
        rows = jm.load(ws)
        shown = [dict(r) for r in rows]
        jm.save(ws, rows)
    finally:
        jm.now_iso = real
    return shown


def _js(req):
    r = subprocess.run([NODE, JS_JM], input=json.dumps(req), capture_output=True, text=True)
    assert r.returncode == 0, f"JS helper failed: {r.stderr}"
    return r.stdout


def _read(ws):
    p = jm.path(ws)
    return open(p, "rb").read() if os.path.exists(p) else None


def _both_save(rows, notes=None):
    """save() the same rows in both runtimes; return (python bytes, js bytes)."""
    dp, dj = tempfile.mkdtemp(), tempfile.mkdtemp()
    _frozen_py_save(dp, rows, notes)
    req = {"op": "save", "ws": dj, "rows": rows}
    if notes is not None:
        req["notes"] = notes
    _js(req)
    return _read(dp), _read(dj)


def _both_roundtrip(seed_bytes):
    """load() then save() a seeded jobs.md in both runtimes."""
    dp, dj = tempfile.mkdtemp(), tempfile.mkdtemp()
    for d in (dp, dj):
        open(jm.path(d), "wb").write(seed_bytes)
    py_rows = _frozen_py_roundtrip(dp)
    js_rows = json.loads(_js({"op": "roundtrip", "ws": dj}))
    return _read(dp), _read(dj), py_rows, js_rows


def _rv(engine, ws, args):
    if engine == "py":
        cmd, env = [sys.executable, "-c", _BOOT, PY_RV, "--workspace", ws, *args], dict(os.environ)
    else:
        cmd = [NODE, JS_RV, "--workspace", ws, *args]
        env = dict(os.environ, CHECKER_NOW_ISO="2026-09-23T12:34:56Z")
    r = subprocess.run(cmd, capture_output=True, env=env)
    return r.returncode, r.stdout.decode("utf-8"), r.stderr.decode("utf-8")


def _both_rv(calls, seed=None):
    """Run the same record_verdict calls in both runtimes on a fresh temp
    workspace each; assert identical exit/stdout/stderr per call and
    identical final jobs.md bytes. Returns (python results, final bytes, ws)."""
    out = {}
    for engine in ("py", "js"):
        ws = tempfile.mkdtemp()
        if seed is not None:
            open(jm.path(ws), "wb").write(seed if isinstance(seed, bytes) else seed.encode("utf-8"))
        res = [_rv(engine, ws, a) for a in calls]
        out[engine] = (res, _read(ws), ws)
    assert out["py"][0] == out["js"][0], f"CLI results differ:\npy={out['py'][0]!r}\njs={out['js'][0]!r}"
    assert out["py"][1] == out["js"][1], f"jobs.md differs:\npy={out['py'][1]!r}\njs={out['js'][1]!r}"
    return out["py"]


def _row(company="Acme", title="Staff Engineer", **kw):
    r = {"company": company, "title": title, "stage": "To Review", "dismissed": False}
    r.update(kw)
    return r


def _lines(b):
    return b.decode("utf-8").split("\n")


def _script_written(rows, notes=None):
    """A jobs.md exactly as save() writes it (Python, frozen clock)."""
    d = tempfile.mkdtemp()
    _frozen_py_save(d, rows, notes)
    return _read(d)


ALL_FIELDS_ROW = dict(
    url="https://boards.greenhouse.io/acme/jobs/1", location="Remote", posted_at="2026-01-02",
    seen_at="2026-01-01T00:00:00+00:00", updated_at="2026-01-01T00:00:00+00:00",
    fit_verdict="weak", fit_score=10, fit_reason="old reason", dealbreakers="old db",
    track="B", flags="f1", jd_sim="0.5", jd_file="jd-inbox/acme.md",
    analysis_file="jd-analysis/acme-old.md", company_file="company/acme.md",
    evaluated_at="2026-01-01T00:00:00+00:00",
)


# ------------------------------------------------------------ the Analysis field (§ 4.3, § 7.1)

def test_s1_analysis_sits_right_after_jd_in_fields_both_runtimes():
    labels = [l for l, _ in jm.FIELDS]
    i = labels.index("JD")
    assert jm.FIELDS[i] == ("JD", "jd_file")
    assert jm.FIELDS[i + 1] == ("Analysis", "analysis_file"), jm.FIELDS
    if _skip():
        return
    # the JS FIELDS order, observed from what save() writes for a row with every field set
    row = _row(**{k: v for k, v in ALL_FIELDS_ROW.items()})
    for k in [k for _, k in jm.FIELDS if k not in row and k not in ("was_stage", "dismiss_note", "fit_score")]:
        row[k] = "v-" + k
    py, js = _both_save([row])
    assert py == js, f"field order/values differ:\npy={py!r}\njs={js!r}"
    labels_written = [l[2:].split(":")[0] for l in _lines(py) if l.startswith("- ")]
    assert labels_written[labels_written.index("JD") + 1] == "Analysis", labels_written


def test_s1_analysis_latest_wins_jd_keeps_first_both_runtimes():
    if _skip():
        return
    rv = lambda *x: ["--company", "Acme", "--title", "Staff Engineer", "--verdict", "strong", *x]
    res, final, ws = _both_rv([
        rv("--jd-file", "jd-inbox/1.md", "--analysis-file", "jd-analysis/1.md"),
        rv("--jd-file", "jd-inbox/2.md", "--analysis-file", "jd-analysis/2.md"),
        rv("--analysis-file", "jd-analysis/3.md"),
        rv(),                                   # no --analysis-file: the last one stays
    ])
    assert all(c == 0 for c, _, _ in res), res
    rows = jm.load(ws)
    assert len(rows) == 1
    assert rows[0]["jd_file"] == "jd-inbox/1.md"            # keeps the first
    assert rows[0]["analysis_file"] == "jd-analysis/3.md"   # the latest wins


# ------------------------------------------------------------ B2: the whitespace class (§ 4.3, § 4.4)

def test_s1_every_class_character_collapses_and_trims_everywhere_both_runtimes():
    """Each class character, as a run inside and at both ends of the
    company, the title and every field value, collapses to one space and
    is trimmed — the same bytes in both runtimes."""
    if _skip():
        return
    for ch in CLASS:
        row = _row(company=f"{ch}Acme{ch}{ch}Co{ch}", title=f"{ch}{ch}Staff{ch}{ch}Engineer{ch}")
        for _, k in jm.FIELDS:
            if k not in ("was_stage", "dismiss_note", "fit_score"):   # fit_score is an int (save sorts on it)
                row[k] = f"{ch}a{ch}{ch}b{ch}"
        py, js = _both_save([row])
        assert py == js, f"{ch!r}: runtimes differ\npy={py!r}\njs={js!r}"
        lines = _lines(py)
        assert "### Acme Co — Staff Engineer" in lines, (ch, lines)
        fields = [l for l in lines if l.startswith("- ")]
        assert len(fields) == len(jm.FIELDS) - 3, (ch, fields)          # all but Score, Was, Dismissed
        assert all(l.endswith(": a b") for l in fields), (ch, fields)


def test_s1_characters_outside_the_class_are_kept_both_runtimes():
    """§ 4.4: the class is written out, never `\\s` — so a character only
    Python's or only JavaScript's `\\s` counts is written as it came."""
    if _skip():
        return
    for ch in OUTSIDE:
        py, js = _both_save([_row(title=f"Staff{ch}Engineer", location=f"San{ch}{ch}Francisco")])
        assert py == js, f"{ch!r}: runtimes differ\npy={py!r}\njs={js!r}"
        text = py.decode("utf-8")
        assert f"### Acme — Staff{ch}Engineer" in text, repr(ch)
        assert f"- Location: San{ch}{ch}Francisco" in text, repr(ch)


def test_s1_private_use_sentinel_code_points_are_not_whitespace_both_runtimes():
    """U+E000/U+E001 are ordinary characters (not in § 4.3's class). The JS
    port uses them internally as stand-ins for U+2028/U+2029, so a posting
    title that really carries one must still be written as it came, the
    same as Python writes it (§ 4.4, one class in both languages)."""
    if _skip():
        return
    for ch in ("\ue000", "\ue001"):
        py, js = _both_save([_row(title=f"Staff{ch}Engineer")])
        assert f"### Acme — Staff{ch}Engineer".encode("utf-8") in py, repr(ch)
        assert py == js, f"{ch!r}: runtimes differ\npy={py[-80:]!r}\njs={js[-80:]!r}"


def test_s1_line_separators_after_a_load_round_trip_both_runtimes():
    """A jobs.md already holding U+2028/U+2029/NEL/VT/FF inside a value (a
    hand edit, or a file written before S1): load() then save() collapses
    them the same way a fresh value is collapsed, in both runtimes."""
    if _skip():
        return
    seed = _script_written([_row(url="https://x/1")]).decode("utf-8")
    seed = seed.replace("### Acme — Staff Engineer", "### Acme\u2029Co — Staff\u2028Engineer\x85Lead")
    seed = seed.replace("- URL: https://x/1", "- URL: https://x/1\n- Location: San\u2028\u2029Francisco\x0bCA\x0cUS")
    py, js, py_rows, js_rows = _both_roundtrip(seed.encode("utf-8"))
    assert py == js, f"runtimes differ\npy={py!r}\njs={js!r}"
    text = py.decode("utf-8")
    assert "### Acme Co — Staff Engineer Lead" in text, text
    assert "- Location: San Francisco CA US" in text, text
    assert not any(c in text for c in ("\u2028", "\u2029", "\x85", "\x0b", "\x0c"))
    # the same through the real CLI (a re-verdict re-saves every row)
    res, final, _ = _both_rv([["--company", "Acme Co", "--title", "Staff Engineer Lead", "--verdict", "weak"]],
                             seed=seed)
    assert res[0][0] == 0 and b"San Francisco CA US" in final


def test_s1_crlf_file_round_trips_the_same_both_runtimes():
    if _skip():
        return
    seed = _script_written([_row(location="Remote", url="https://x/1"), _row("Beta", "PM", stage="Applied")],
                           notes="line one\nline two").replace(b"\n", b"\r\n")
    py, js, py_rows, js_rows = _both_roundtrip(seed)
    assert py == js
    assert b"\r" not in py
    assert [(r["company"], r["title"], r["stage"]) for r in py_rows] == \
        [("Acme", "Staff Engineer", "To Review"), ("Beta", "PM", "Applied")]


def test_s1_bom_in_a_value_is_kept_and_a_bom_file_still_loads_both_runtimes():
    """U+FEFF is not in the class (JavaScript's `\\s` counts it, § 4.4)."""
    if _skip():
        return
    py, js = _both_save([_row(title="\ufeffStaff Engineer")])
    assert py == js and "### Acme — \ufeffStaff Engineer".encode("utf-8") in py
    seed = b"\xef\xbb\xbf" + _script_written([_row(url="https://x/1")])
    py, js, py_rows, _ = _both_roundtrip(seed)
    assert py == js
    assert len(py_rows) == 1 and py_rows[0]["url"] == "https://x/1"


def test_s1_very_long_values_stay_one_line_both_runtimes():
    if _skip():
        return
    long_title = "Principal \n\t Engineer " * 3000          # ~60k chars, whitespace runs throughout
    py, js = _both_save([_row(title=long_title, fit_reason="r\n" * 20000)])
    assert py == js
    heads = [l for l in _lines(py) if l.startswith("### ")]
    assert heads == ["### Acme — " + " ".join(["Principal Engineer"] * 3000)]
    assert "- Reason: " + " ".join(["r"] * 20000) in _lines(py)


# ------------------------------------------------------------ the company's em dash (§ 4.3)

def test_s1_company_em_dash_round_trips_as_hyphen_title_keeps_its_own_both_runtimes():
    if _skip():
        return
    cases = [
        ("A — B", "Role", "A - B", "Role"),
        ("A \t—\n B", "Role", "A - B", "Role"),            # a whitespace run around it collapses first
        ("A\xa0—\xa0B", "Role", "A - B", "Role"),
        ("A — B — C", "Role", "A - B - C", "Role"),
        ("A—B", "Role", "A—B", "Role"),                    # no spaces: not the separator, kept
        ("Acme", "Director — Platform", "Acme", "Director — Platform"),   # titles keep theirs
    ]
    for company, title, want_c, want_t in cases:
        py, js = _both_save([_row(company, title)])
        assert py == js, (company, py, js)
        assert f"### {want_c} — {want_t}" in py.decode("utf-8"), (company, py)
        py2, js2, py_rows, js_rows = _both_roundtrip(py)
        assert py2 == js2 == py, (company, "not stable through load/save")
        assert (py_rows[0]["company"], py_rows[0]["title"]) == (want_c, want_t), (company, py_rows[0])
        assert (js_rows[0]["company"], js_rows[0]["title"]) == (want_c, want_t), (company, js_rows[0])
        assert jm.key(py_rows[0]) == jm.key({"company": company, "title": title})


# ------------------------------------------------------------ ## Search notes (§ 4.3)

NOTES = ("### 2026-01-01\n\nline one  \n\ttabbed line\n\n\n  indented\n"
         "- a bullet: with a colon\n### Evil Co \u2014 Row\n"
         "sep\u2028inside\u2029here \x85nel \x0b\x0c\n\n### 2026-02-02\n\nlast line")
# The same, plus a line that is a stage heading: a note quoting a posting
# (or a model told to by one) can hold `## Offer`. § 4.3's threat model:
# posting text must never become "a stage heading or a field of another row".
NOTES_WITH_STAGE = NOTES + "\n## Offer\n### Evil Co \u2014 Row\n- URL: https://evil.example\n- Verdict: strong"


def _notes_round_trip(notes):
    rows = [_row(url="https://x/1"), _row("Beta", "PM", stage="Interested")]
    seed = _script_written(rows, notes=notes)
    assert notes.encode("utf-8") in seed
    py, js, py_rows, js_rows = _both_roundtrip(seed)
    assert py == js, f"runtimes differ:\npy={py!r}\njs={js!r}"
    assert [(r["company"], r["stage"]) for r in py_rows] == [("Acme", "To Review"), ("Beta", "Interested")], py_rows
    assert [(r["company"], r["stage"]) for r in js_rows] == [("Acme", "To Review"), ("Beta", "Interested")], js_rows
    assert py == seed, f"not byte-identical:\nseed={seed!r}\nafter={py!r}"
    # and through a writer: a re-verdict changes the row, never the notes
    res, final, ws = _both_rv([["--company", "Acme", "--title", "Staff Engineer", "--verdict", "strong"]], seed=seed)
    assert res[0][0] == 0
    tail = lambda b: b[b.index(b"## Search notes"):]
    assert tail(final) == tail(seed)
    assert [r["company"] for r in jm.load(ws)] == ["Acme", "Beta"]


def test_s1_multiline_search_notes_round_trip_byte_identical_both_runtimes():
    if _skip():
        return
    _notes_round_trip(NOTES)


def test_s1_search_notes_with_a_stage_heading_line_never_become_rows_both_runtimes():
    """A `## Offer` line inside `## Search notes` must not switch load() into
    the Offer stage: the note's `### Evil Co \u2014 Row` / `- URL:` /
    `- Verdict:` lines would become a real Offer row on the next save
    (pre-existing in both runtimes; found in the S1 review)."""
    if _skip():
        return
    _notes_round_trip(NOTES_WITH_STAGE)


# ------------------------------------------------------------ B1: the injection proof (§ 4.3)

EVIL = "Engineer\n## Offer\n### Evil Co — Row\n- URL: https://evil.example"


def _no_forgery(final, ws, want_company, want_title_prefix="Engineer"):
    lines = _lines(final)
    assert not any(l.startswith("## Offer") for l in lines), lines
    assert sum(1 for l in lines if l.startswith("### ")) == 1, lines
    assert not any(l.startswith("- URL: https://evil") for l in lines), lines
    rows = jm.load(ws)
    assert len(rows) == 1, rows
    r = rows[0]
    assert r["stage"] == "To Review" and r["company"] == want_company, r
    assert r["title"].startswith(want_title_prefix) and "\n" not in r["title"], r
    assert r.get("url") is None, r                        # no forged URL field
    return r


def test_s1_b1_injection_title_through_record_verdict_both_runtimes():
    if _skip():
        return
    res, final, ws = _both_rv([["--company", "RealCo", "--title", EVIL, "--verdict", "weak"]])
    assert res[0][0] == 0
    r = _no_forgery(final, ws, "RealCo")
    assert r["fit_verdict"] == "weak"


def test_s1_b1_injection_in_company_and_every_free_text_value_both_runtimes():
    """The same forged heading/field text arriving in the company, the
    reason, the dealbreakers and the location (all model-typed on a verdict)
    can't forge a row, a stage or a field either."""
    if _skip():
        return
    forged = "x\n- Verdict: strong\n- Score: 99\n## Offer\n### Evil Co — Row\n- URL: https://evil.example"
    res, final, ws = _both_rv([["--company", "Real\nCo", "--title", "Engineer", "--verdict", "weak",
                                "--score", "5", "--reasons", forged, "--dealbreakers", forged,
                                "--location", forged, "--analysis-file", forged]])
    assert res[0][0] == 0
    r = _no_forgery(final, ws, "Real Co")
    assert r["fit_verdict"] == "weak" and r["fit_score"] == 5, r
    assert sum(1 for l in _lines(final) if l.startswith("- Verdict:")) == 1


# ------------------------------------------------------------ record_verdict --existing (§ 4.3)

def _seed_two_rows():
    rows = [_row(**ALL_FIELDS_ROW), _row("Beta", "PM", stage="Interested", url="https://b/1",
                                         seen_at="2026-01-01T00:00:00+00:00")]
    return _script_written(rows)


def test_s1_existing_on_a_missing_key_exits_2_exact_text_nothing_written_both_runtimes():
    if _skip():
        return
    seed = _seed_two_rows()
    res, final, _ = _both_rv([["--company", "Gamma", "--title", "Data Lead", "--verdict", "weak", "--existing"]],
                             seed=seed)
    assert res[0] == (2, "", "error: no role Gamma — Data Lead in jobs.md; nothing written\n"), res
    assert final == seed                                   # byte-identical
    res, final, _ = _both_rv([["--company", "Gamma", "--title", "Data Lead", "--verdict", "weak", "--existing"]])
    assert res[0][0] == 2 and final is None                # no jobs.md: none created


def test_s1_existing_refuses_url_location_jd_file_both_runtimes():
    if _skip():
        return
    seed = _seed_two_rows()
    base = ["--company", "Acme", "--title", "Staff Engineer", "--verdict", "strong", "--existing"]
    for flag in ("--url", "--location", "--jd-file"):
        for value in ("https://other.example/2", ""):
            res, final, _ = _both_rv([base + [flag, value]], seed=seed)
            code, out, err = res[0]
            assert code == 2 and out == "" and err.startswith("error:"), (flag, value, res)
            assert final == seed, (flag, value)
    # refused on a missing key too (exit 2, nothing written)
    res, final, _ = _both_rv([["--company", "Gamma", "--title", "X", "--verdict", "weak", "--existing", "--url", "u"]],
                             seed=seed)
    assert res[0][0] == 2 and final == seed


def test_s1_existing_on_a_present_key_changes_only_verdict_fields_and_timestamps_both_runtimes():
    if _skip():
        return
    seed = _seed_two_rows()
    # the key as add_roles would report it, and a canonical variant of it
    for company, title in (("Acme", "Staff Engineer"), ("ACME, Inc", "staff  engineer")):
        res, final, ws = _both_rv([["--company", company, "--title", title, "--verdict", "long_shot",
                                    "--score", "40", "--reasons", "quick-scan: fits", "--dealbreakers", "none",
                                    "--existing"]], seed=seed)
        assert res[0][0] == 0, res
        before, after = _lines(seed), _lines(final)
        assert len(before) == len(after), (before, after)
        changed = {(b, a) for b, a in zip(before, after) if b != a}
        allowed = ("- Verdict:", "- Score:", "- Reason:", "- Dealbreakers:", "- Evaluated:", "- Updated:",
                   "**Active:")
        assert all(b.startswith(allowed) and a.startswith(b.split(":")[0] + ":") for b, a in changed), changed
        rows = {(r["company"], r["title"]): r for r in jm.load(ws)}
        assert set(rows) == {("Acme", "Staff Engineer"), ("Beta", "PM")}   # stored names, never the typed variant
        r = rows[("Acme", "Staff Engineer")]
        assert (r["fit_verdict"], r["fit_score"], r["fit_reason"], r["dealbreakers"]) == \
            ("long_shot", 40, "quick-scan: fits", "none")
        for k in ("url", "location", "posted_at", "seen_at", "jd_file", "analysis_file", "company_file",
                  "track", "flags", "jd_sim"):
            assert r.get(k) == ALL_FIELDS_ROW[k], (k, r.get(k))


# ------------------------------------------------------------ the prose that tells the model (§ 7.1, § 4.10)

def _norm(s):
    return re.sub(r"\s+", " ", s).strip()


def test_s1_host_note_and_evaluate_prose_pass_the_analysis_file():
    note = _norm(open(os.path.join(ROOT, "skills", "profile", "templates", "web-host-note.md"), encoding="utf-8").read())
    assert _norm("Pass `--analysis-file` to `record_verdict.py` when you write an analysis, "
                 "and `--jd-file` when a posting file exists.") in note
    assert "Pass `--jd-file` to `record_verdict.py` when a job description file exists." not in note
    patterns = _norm(open(os.path.join(ROOT, "skills", "evaluate", "references", "patterns.md"), encoding="utf-8").read())
    assert "`--analysis-file jd-analysis/<file>.md` (the analysis you just wrote)" in patterns
    schema = _norm(open(os.path.join(ROOT, "skills", "evaluate", "references", "schema.md"), encoding="utf-8").read())
    assert _norm("Filename = a slug of the company and the title (lowercase; every run of other characters "
                 "becomes `-`), written once; the row's `Analysis` field records the exact path, so no reader "
                 "rebuilds the name.") in schema
    search = _norm(open(os.path.join(ROOT, "skills", "search", "references", "schema.md"), encoding="utf-8").read())
    assert _norm("`JD` is the raw posting in `jd-inbox/`; `Analysis` is evaluate's decode in `jd-analysis/`, "
                 "written by `record_verdict.py --analysis-file` (the latest wins).") in search
