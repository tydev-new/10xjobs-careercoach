"""upsert.py must use the same JobRecord gate as sweep.py before inserting a new row."""

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

import os, sys
import pytest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import jobsdb as J          # noqa: E402
import upsert               # noqa: E402

def isolate(monkeypatch, tmp_path):
    state = tmp_path / "state"
    state.mkdir()
    monkeypatch.setattr(J, "DB_PATH", str(tmp_path / "jobs.db"))
    monkeypatch.setattr(J, "STATE", str(state))
    monkeypatch.setattr(J, "LOCK", str(state / ".lock"))
    monkeypatch.setattr(J, "LOG", str(state / "pipeline.log"))
    monkeypatch.setattr(J, "LAST_RENDER", str(state / "last.md"))
    monkeypatch.setattr(J, "JOBS_MD", str(tmp_path / "jobs.md"))
    monkeypatch.setattr(J, "ACTIVE_MD", str(tmp_path / "active.md"))
    monkeypatch.setattr(J, "WS", str(tmp_path))

def test_browser_manual_and_referral_insert(monkeypatch, tmp_path, capsys):
    isolate(monkeypatch, tmp_path)
    upsert.main(["--company", "Acme", "--title", "Staff TPM", "--source", "li:signed-in",
                 "--url", "https://www.linkedin.com/jobs/view/1234567890", "--lane", "TPM", "--fit", "Solid",
                 "--note", "browser", "--location", "Remote", "--pay", "100k to 140k", "--posted", "2026-11-01",
                 "--run-id", "run-1", "--told", "--remote", "remote-region", "--req", "REQ-1000", "--no-render"])
    upsert.main(["--company", "Beta", "--title", "Staff TPM", "--source", "referral", "--note", "from a colleague", "--no-render"])
    upsert.main(["--company", "Gamma", "--title", "Staff TPM", "--source", "manual", "--no-render"])
    upsert.main(["--company", "Delta", "--title", "Staff TPM", "--source", "hiring.cafe",
                 "--url", "https://hiring.cafe/j/1", "--no-render"])
    upsert.main(["--company", "Echo", "--title", "Staff TPM", "--source", "web",
                 "--url", "https://example.com/jobs/1", "--no-render"])
    out = capsys.readouterr().out
    assert out.count("NEW") == 5
    c = J.connect(str(tmp_path / "jobs.db"))
    rows = {r["company"]: r for r in c.execute("SELECT * FROM jobs")}
    assert rows["Acme"]["fit"] == "Solid" and rows["Acme"]["told_at"] and rows["Acme"]["remote_check"] == "remote-region"
    assert rows["Acme"]["ats_type"] == "linkedin" and rows["Beta"]["url"] is None and rows["Gamma"]["url"] is None
    assert c.execute("SELECT count(*) FROM sightings").fetchone()[0] == 1
    upsert.main(["--company", "Beta", "--title", "Staff TPM", "--source", "referral", "--note", "second pass", "--no-render"])
    assert "existing" in capsys.readouterr().out

def test_bad_new_row_is_rejected_and_exits(monkeypatch, tmp_path, capsys):
    isolate(monkeypatch, tmp_path)
    with pytest.raises(SystemExit) as ei:
        upsert.main(["--company", "Acme", "--title", "Staff TPM", "--source", "web", "--run-id", "run-9", "--no-render"])
    assert ei.value.code == 1
    err = capsys.readouterr().err
    assert err.startswith("rejected, not saved") and "url" in err and "Allowed:" in err and "manual" in err
    c = J.connect(str(tmp_path / "jobs.db"))
    assert c.execute("SELECT count(*) FROM jobs").fetchone()[0] == 0
    row = c.execute("SELECT run_id, source, reason FROM rejected").fetchone()
    assert row["run_id"] == "run-9" and row["source"] == "web" and "url" in row["reason"]
    with pytest.raises(SystemExit) as ei2:
        upsert.main(["--company", "Acme", "--title", "Staff TPM", "--source", "LinkedIn",
                     "--url", "https://example.com/j/1", "--no-render"])
    assert ei2.value.code == 1
    err2 = capsys.readouterr().err
    assert "source" in err2 and "lowercase" in err2
    with pytest.raises(SystemExit) as ei3:
        upsert.main(["--company", "Acme", "--title", "<b>Staff TPM</b>", "--source", "web",
                     "--url", "https://example.com/j/1", "--no-render"])
    err3 = capsys.readouterr().err
    assert ei3.value.code == 1 and "title" in err3 and "HTML" in err3
    assert c.execute("SELECT count(*) FROM jobs").fetchone()[0] == 0
    assert c.execute("SELECT count(*) FROM rejected").fetchone()[0] == 3
