import datetime as dt, sqlite3
import pytest, yaml

from pipeline import jobsdb as J, schema as SC
from tests import helpers as T


def base_cfg():
    return {"version": 1, "window": {"default_hours": 2}, "lanes": {"IC builder": ["platform engineer"]},
            "geo": {"include": ["springfield"], "exclude": [], "remote_us": ["remote"], "non_us": ["london"]},
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
    c = base_cfg(); c["lanes"]["IC builder"] = ["(unclosed"]
    with pytest.raises(ValueError, match="regex"):
        SC.validate_sources(c)


def test_model_added_source_uses_same_check():
    assert SC.check_board({"company": "Acme", "slug": "acme"}, "lever") is None
    assert "company" in SC.check_board({"slug": "acme"}, "lever")
    assert "does not match" in SC.check_board({"company": "A", "slug": "a", "ats_type": "ashby"}, "lever")


def test_example_sources_yaml_validates():
    cfg = yaml.safe_load((T.EXAMPLE / "sources.example.yaml").read_text())
    clean, errs = SC.validate_sources(cfg)
    assert errs == [], errs


def test_job_record_required_and_rejects():
    ok = SC.record_from_posting({"company": "Acme", "title": "Staff Engineer", "url": "https://x.y/1", "source": "ats:ashby"})
    assert ok.ats_type == "ashby" and ok.found_date == dt.date.today()
    for bad in ({"company": "", "title": "T", "url": "https://x", "source": "web"},
                {"company": "A", "title": "T", "url": "", "source": "web"},
                {"company": "A", "title": "<b>T</b>", "url": "https://x", "source": "web"},
                {"company": "A", "title": "TT", "url": "ftp://x", "source": "web"}):
        with pytest.raises(Exception):
            SC.record_from_posting(bad)


def test_db_enforces_types_and_unique(tmp_path):
    c = J.connect(str(tmp_path / "t.db"))
    J.insert_job(c, company="Acme", title="Staff Engineer", source="web", url="https://acme.example/j/1")
    with pytest.raises(sqlite3.IntegrityError):
        J.insert_job(c, company="Acme", title="Staff Engineer", source="web")
    with pytest.raises(sqlite3.IntegrityError):
        J.insert_job(c, company="Other", title="X Y", source="web", url="https://acme.example/j/1")
    with pytest.raises(sqlite3.IntegrityError):
        J.insert_job(c, company="B", title="Z Z", source="web", url="notaurl")
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("INSERT INTO source_health VALUES ('r','s','weird',1,1,0,1.0,1,NULL,'t')")
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("UPDATE jobs SET remote_check='bay'")


def test_dedupe_ignores_parenthetical_qualifiers(tmp_path):
    c = J.connect(str(tmp_path / "d.db"))
    J.insert_job(c, company="Northwind Traders", title="Senior / Staff Platform Software Engineer (developer platform)", source="web", url="https://a.example/1")
    assert J.find(c, "Northwind Traders", "Senior / Staff Platform Software Engineer", "https://www.linkedin.com/jobs/view/9")
    assert J.find(c, "Northwind Traders", "Staff Platform Software Engineer") is None
