"""Phase 2 (2026-10-20): package_runs / package_outcomes traceability and reply-rate reporting."""

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
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import jobsdb as J, weekly_report as W   # noqa: E402

def db(tmp_path, n=1, lane="Eng"):
    c = J.connect(str(tmp_path / "p.db"))
    ids = [J.insert_job(c, company=f"Co{i}", title="Engineering Manager", source="test", lane=lane, url=f"https://x.test/{i}") for i in range(n)]
    return c, ids

def run(c, jid, base="eng-manager", cover="bullets", verdict="PASS", at="2099-01-02T08:00:00+00:00", lane=None):
    return J.record_package_run(c, package_path=f"{_JOBBI_APPS}/tests/synthetic-fixtures/test-{jid}", job_id=jid, base=base,
                                cover_format=cover, lint_version="format-lint 2026-10-20c", claims_version="claims-2026-10-20",
                                rubric_version="apply-rubric-2026-10-20p1", verdict=verdict, round=1, stamped_at=at, lane=lane)

def test_migration_creates_tables(tmp_path):
    c, _ = db(tmp_path)
    names = {r[0] for r in c.execute("select name from sqlite_master")}
    assert {"package_runs", "package_outcomes", "package_results"} <= names
    assert c.execute("select v from meta where k='schema_package_runs'").fetchone()[0] == J.PACKAGE_RUNS_SCHEMA

def test_status_changes_link_to_latest_run(tmp_path):
    c, (j,) = db(tmp_path)
    r1 = run(c, j, at="2099-01-01T08:00:00+00:00"); r2 = run(c, j, verdict="PASS", at="2099-01-02T08:00:00+00:00")
    J.set_status(c, j, "Applied", by="user", when="2026-10-20T09:00:00-07:00")
    J.set_status(c, j, "Interviewing", by="user", when="2026-10-22T09:00:00-07:00")
    got = {(o["run_id"], o["outcome"]) for o in c.execute("select * from package_outcomes")}
    assert got == {(r2, "applied"), (r2, "interviewing"), (r2, "replied")} and r1 != r2
    row = c.execute("select applied, replied, interviewed, rejected from package_results where id=?", (r2,)).fetchone()
    assert tuple(row) == (1, 1, 1, 0)

def test_no_run_no_outcome(tmp_path):
    c, (j,) = db(tmp_path)
    J.set_status(c, j, "Rejected", by="agent")
    assert c.execute("select count(*) from package_outcomes").fetchone()[0] == 0

def test_lane_filled_from_job(tmp_path):
    c, (j,) = db(tmp_path, lane="TPM")
    rid = run(c, j)
    assert c.execute("select lane from package_runs where id=?", (rid,)).fetchone()[0] == "TPM"

def test_rates_hidden_below_5(tmp_path):
    c, ids = db(tmp_path, n=7)
    for i, j in enumerate(ids):
        run(c, j, base="tpm" if i < 5 else "ic-builder", cover="none" if i >= 5 else "bullets")
        J.set_status(c, j, "Applied", by="user")
    J.set_status(c, ids[0], "Interviewing", by="user")
    J.set_status(c, ids[1], "Rejected", by="user")
    rows = {k: (n, pos, resp, pr, rr) for k, n, pos, resp, pr, rr in W.reply_rates(c, "base")}
    assert rows["tpm"] == (5, 1, 2, "20%", "40%")
    assert rows["ic-builder"][3] == "n<5" and rows["ic-builder"][4] == "n<5"
    assert "n<5" in "\n".join(W.reply_rate_section(c))

def test_unique_run_per_stamp(tmp_path):
    c, (j,) = db(tmp_path)
    assert run(c, j) == run(c, j)
    assert c.execute("select count(*) from package_runs").fetchone()[0] == 1
