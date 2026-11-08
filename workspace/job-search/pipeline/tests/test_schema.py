
# Portable path/config adapter; pipeline implementation below is retained.
from pathlib import Path as _JobbiPath
import os as _jobbi_os, sys as _jobbi_sys
_JOBBI_ROOT = _JobbiPath(_jobbi_os.environ.get("JOBBI_ROOT", str(_JobbiPath(__file__).resolve().parents[4])))
_jobbi_sys.path.insert(0, str(_JOBBI_ROOT))
from runtime_config import policy as _jobbi_policy, candidate as _jobbi_candidate
_JOBBI_SEARCH = _JOBBI_ROOT / "workspace" / "job-search"
_JOBBI_APPS = _JOBBI_ROOT / "workspace" / "job-apps"
_JOBBI_POLICY = _jobbi_policy(_JOBBI_ROOT)
_JOBBI_CAND = _jobbi_candidate(_JOBBI_ROOT)

import copy, datetime as dt, os, sys, sqlite3
import pytest, yaml
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import schema as SC   # noqa: E402

def base_cfg():
    return {"version": 1, "window": {"default_hours": 2}, "lanes": {"TPM": ["technical program manager"]},
            "geo": {"include": ["example city"], "exclude": [], "remote_us": ["remote"], "non_us": ["london"]},
            "sources": {"ashby": {"enabled": True, "boards": [{"company": "Acme", "slug": "acme"}]}}}

def test_good_config_passes():
    cfg, errs = SC.validate_sources(base_cfg())
    assert errs == [] and len(cfg["sources"]["ashby"]["boards"]) == 1

def test_bad_entry_skipped_not_crash():
    c = base_cfg()
    c["sources"]["ashby"]["boards"] += [{"slug": "nocompany"}, {"company": "Bad", "slug": "has space/../x"}, {"company": "Typo", "slgu": "x"}]
    cfg, errs = SC.validate_sources(c)
    assert len(cfg["sources"]["ashby"]["boards"]) == 1 and len(errs) == 3
    assert any("company" in e for e in errs)

def test_unusable_top_level_raises_clear_error():
    c = base_cfg(); del c["lanes"]
    with pytest.raises(ValueError, match="lanes"):
        SC.validate_sources(c)

def test_bad_regex_in_lanes_is_fatal_but_clear():
    c = base_cfg(); c["lanes"]["TPM"] = ["(unclosed"]
    with pytest.raises(ValueError, match="regex"):
        SC.validate_sources(c)

def test_model_added_source_uses_same_check():
    assert SC.check_board({"company": "Acme", "slug": "acme"}, "lever") is None
    assert "company" in SC.check_board({"slug": "acme"}, "lever")
    assert "does not match" in SC.check_board({"company": "A", "slug": "a", "ats_type": "ashby"}, "lever")

def test_real_sources_yaml_validates():
    cfg = yaml.safe_load(open(os.path.join(os.path.dirname(HERE), "sources.yaml")))
    clean, errs = SC.validate_sources(cfg)
    assert errs == [], errs

def test_job_record_required_and_rejects():
    ok = SC.record_from_posting({"company": "Acme", "title": "Staff TPM", "url": "https://x.y/1", "source": "ats:ashby"})
    assert ok.ats_type == "ashby" and ok.found_date == dt.date.today()
    for bad in ({"company": "", "title": "T", "url": "https://x", "source": "web"},
                {"company": "A", "title": "T", "url": "", "source": "web"},
                {"company": "A", "title": "<b>T</b>", "url": "https://x", "source": "web"},
                {"company": "A", "title": "TT", "url": "ftp://x", "source": "web"}):
        with pytest.raises(Exception):
            SC.record_from_posting(bad)

def test_db_enforces_types_and_unique(tmp_path):
    import jobsdb as J
    c = J.connect(str(tmp_path / "t.db"))
    J.insert_job(c, company="Acme", title="Staff TPM", source="web", url="https://acme.com/j/1")
    with pytest.raises(sqlite3.IntegrityError):
        J.insert_job(c, company="Acme", title="Staff TPM", source="web")          # company+title unique
    with pytest.raises(sqlite3.IntegrityError):
        J.insert_job(c, company="Other", title="X Y", source="web", url="https://acme.com/j/1")  # url unique
    with pytest.raises(sqlite3.IntegrityError):
        J.insert_job(c, company="B", title="Z Z", source="web", url="notaurl")
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("INSERT INTO source_health VALUES ('r','s','weird',1,1,0,1.0,1,NULL,'t')")

def test_dedupe_ignores_parenthetical_qualifiers(tmp_path):
    import jobsdb as J
    c = J.connect(str(tmp_path / "d.db"))
    J.insert_job(c, company="Fictional Catalog", title="Senior / Staff Puzzle Catalog Engineer (toy laboratory)", source="web", url="https://a.b/1")
    assert J.find(c, "Fictional Catalog", "Senior / Staff Puzzle Catalog Engineer", "https://www.linkedin.com/jobs/view/9")
    assert J.find(c, "Fictional Catalog", "Staff Puzzle Catalog Engineer") is None
