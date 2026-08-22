"""jobs.md record: roundtrip, loud-fail dup, find, stage moves, verdicts."""
import os, sys, tempfile
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
