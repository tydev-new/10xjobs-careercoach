"""pipeline/adapters is discovered without editing sweep.FETCHERS."""

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

import argparse, os, sys, textwrap
import pytest
HERE = os.path.dirname(os.path.abspath(__file__))
PIPE = os.path.dirname(HERE)
sys.path.insert(0, PIPE)
import adapters           # noqa: E402
import jobsdb as J        # noqa: E402
import schema as SC       # noqa: E402
import sweep as W         # noqa: E402

SHIPPED = {"ashby", "greenhouse", "lever", "smartrecruiters", "workday", "linkedin_guest",
           "gov", "hn_whos_hiring", "getro", "a16z"}

def test_discovery_keeps_shipped_fetchers():
    assert set(W.FETCHERS) == SHIPPED
    found, errors = adapters.load()
    assert errors == [] and "example_board" in found and "ashby" not in found
    merged, more = adapters.merge(W.FETCHERS, found)
    assert more == []
    assert merged["ashby"] is W.FETCHERS["ashby"]
    assert "example_board" in merged and "example_board" not in W.FETCHERS
    assert "example_board" in SC.ATS_TYPES

def test_plugin_cannot_replace_a_shipped_fetcher(tmp_path):
    (tmp_path / "ashby.py").write_text("TYPE = 'ashby'\ndef fetch(cfg, since, ctx):\n    return [], {}\n")
    found, errors = adapters.load(str(tmp_path))
    assert errors == [] and "ashby" in found
    merged, more = adapters.merge(W.FETCHERS, found)
    assert merged["ashby"] is W.FETCHERS["ashby"]
    assert more and "ignored" in more[0]

def test_new_file_registers_its_type(tmp_path):
    (tmp_path / "toy_board.py").write_text(textwrap.dedent("""
        TYPE = "toy_board"
        def fetch(cfg, since, ctx):
            post = {"source": "ats:toy_board", "company": "Example Workshop", "title": "Example Role",
                    "location": "", "url": "https://jobs.example.invalid/toy/1", "posted_at": None,
                    "pay": None, "req": None, "tag": None, "extra": {}}
            return [post], {"requests": 1, "ok": 1, "failed": 0, "fetched": 1, "gap": None, "errors": []}
    """))
    found, errors = adapters.load(str(tmp_path))
    assert errors == [] and set(found) == {"toy_board"}
    posts, st = found["toy_board"]({}, None, {})
    assert st["ok"] == 1
    rec = SC.record_from_posting(posts[0])
    assert rec.ats_type == "toy_board" and rec.url.startswith("https://")

def test_broken_adapter_is_an_error_not_a_crash(tmp_path):
    (tmp_path / "bad.py").write_text("TYPE = 'bad'\ndef fetch(\n")
    found, errors = adapters.load(str(tmp_path))
    assert found == {} and errors and errors[0].startswith("bad.py failed to load")

def _stamp(path):
    if not os.path.exists(path):
        return None
    st = os.stat(path)
    return (st.st_mtime_ns, st.st_size)

def _isolated_run(monkeypatch, tmp_path, **flags):
    state = tmp_path / "state"
    state.mkdir()
    monkeypatch.setattr(J, "DB_PATH", str(tmp_path / "jobs.db"))
    monkeypatch.setattr(J, "WS", str(tmp_path))
    monkeypatch.setattr(J, "STATE", str(state))
    monkeypatch.setattr(W, "NAMES_PATH", str(tmp_path / "names.json"))
    monkeypatch.setattr(W.time, "sleep", lambda *_: None)
    real_db = os.path.join(PIPE, "jobs.db")
    before = _stamp(real_db)
    ns = dict(hours=None, since="2099-01-01T00:00:00+00:00", until=None, sources=None, only=None,
              dry_run=False, run_id="plugintest", test_one=None, test_source=None, add=False, tag=None)
    ns.update(flags)
    report = W.run(argparse.Namespace(**ns))
    assert _stamp(real_db) == before, "plugin test wrote the workspace jobs.db"
    return report

def test_test_one_and_test_source_run_a_plugin(monkeypatch, tmp_path):
    one = _isolated_run(monkeypatch, tmp_path, test_one="example_board:demo")
    st = one["sources"]["example_board"]
    assert st["fetched"] >= 1 and st["failed"] == 0 and st["ok"] == 1
    assert one["dry_run"] is True and one["new"] == []
    two = tmp_path / "second"
    two.mkdir()
    verdict_report = _isolated_run(monkeypatch, two, test_source="example_board:demo", run_id="plugintest-2")
    assert verdict_report["test_source"]["source"] == "example_board:demo"
    assert verdict_report["test_source"]["reachable"] is True
    assert verdict_report["test_source"]["added"] is False

def test_unknown_type_still_exits(monkeypatch, tmp_path):
    with pytest.raises(SystemExit) as ei:
        _isolated_run(monkeypatch, tmp_path, test_one="not-a-real-type:x")
    assert "unknown source type" in str(ei.value)
