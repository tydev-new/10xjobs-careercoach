"""jobs.md record: roundtrip, loud-fail dup, find, stage moves, verdicts."""
import os, re, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "skills", "search", "scripts"))
import jobs_md as jm

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
