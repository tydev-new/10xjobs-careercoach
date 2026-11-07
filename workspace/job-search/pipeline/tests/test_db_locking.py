"""Regression (2026-10-21 lockfix): jobsdb.connect() must not return holding a write transaction.
Before the fix the meta INSERT in connect() was never committed, so score.py's second connect()
(open_for_write) failed with 'database is locked'. These tests prove sequential and concurrent
connections, and score.py followed by another tool, run without a lock and without the shim."""

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

import os, sqlite3, subprocess, sys, textwrap, threading, time
HERE = os.path.dirname(os.path.abspath(__file__))
PIPE = os.path.dirname(HERE)
sys.path.insert(0, PIPE)
import jobsdb as J   # noqa: E402

def fast_writer_ok(db, timeout=0.2):
    """a raw connection that waits only `timeout` s can take the write lock: nobody else holds it."""
    x = sqlite3.connect(db, timeout=timeout)
    try:
        x.execute("BEGIN IMMEDIATE"); x.rollback(); return True
    except sqlite3.OperationalError:
        return False
    finally:
        x.close()

def test_connect_leaves_no_open_transaction(tmp_path):
    db = str(tmp_path / "t.db")
    c = J.connect(db)
    assert not c.in_transaction
    assert fast_writer_ok(db), "connect() returned holding the write lock"
    assert c.execute("select v from meta where k='schema_package_runs'").fetchone()[0] == J.PACKAGE_RUNS_SCHEMA
    c.close()

def test_two_connections_in_sequence_score_pattern(tmp_path):
    db = str(tmp_path / "t.db")
    c1 = J.connect(db)                       # score.py: read the row
    jid = J.insert_job(c1, company="Co", title="EM", source="test", url="https://x.test/1"); c1.commit()
    c1.execute("select * from jobs where id=?", (jid,)).fetchone()
    c2 = J.connect(db)                       # score.py: open_for_write while c1 is still open (the old deadlock)
    c2.execute("update jobs set notes='ok' where id=?", (jid,)); c2.commit()
    c3 = J.connect(db)                       # another tool right after
    assert c3.execute("select notes from jobs where id=?", (jid,)).fetchone()[0] == "ok"
    for c in (c1, c2, c3): c.close()

def test_concurrent_connections(tmp_path):
    db = str(tmp_path / "t.db"); J.connect(db).close()
    errors, held = [], threading.Event()
    def idle_reader():
        c = J.connect(db); c.execute("select count(*) from jobs").fetchone(); held.set(); time.sleep(1.0); c.close()
    def writer(i):
        try:
            c = J.connect(db); J.insert_job(c, company=f"Co{i}", title="EM", source="test", url=f"https://x.test/{i}"); c.commit(); c.close()
        except Exception as e:
            errors.append(repr(e))
    t = threading.Thread(target=idle_reader); t.start(); held.wait(5)
    ws = [threading.Thread(target=writer, args=(i,)) for i in range(6)]
    [w.start() for w in ws]; [w.join(20) for w in ws]; t.join(5)
    assert not errors, errors
    c = J.connect(db); assert c.execute("select count(*) from jobs").fetchone()[0] == 6; c.close()

DRIVER = textwrap.dedent("""
    import os, sys, runpy
    sys.path.insert(0, %(pipe)r)
    import jobsdb as J
    tmp = %(tmp)r
    J.DB_PATH = os.path.join(tmp, "t.db"); J.WS = tmp
    J.JOBS_MD = os.path.join(tmp, "jobs.md"); J.LAST_RENDER = os.path.join(tmp, "jobs.md.last-render")
    J.STATE = os.path.join(tmp, "state"); J.LOCK = os.path.join(J.STATE, ".lock"); J.LOG = os.path.join(J.STATE, "pipeline.log")
    sys.argv = [os.path.join(%(pipe)r, "score.py")] + sys.argv[1:]
    runpy.run_path(sys.argv[0], run_name="__main__")
""")

def test_score_then_another_tool_without_shim(tmp_path):
    db = str(tmp_path / "t.db"); c = J.connect(db)
    jid = J.insert_job(c, company="Acme", title="Engineering Manager", source="test", url="https://x.test/acme", location="Example City")
    c.commit(); c.close()
    drv = tmp_path / "drive_score.py"; drv.write_text(DRIVER % {"pipe": PIPE, "tmp": str(tmp_path)})
    holder = J.connect(db)                   # another tool has the DB open (idle) while score runs
    r = subprocess.run([sys.executable, str(drv), "--id", str(jid), "--want", "pass", "--win", "high", "--remote", "home-area",
                        "--must", "people leadership :: led teams", "--want-why", "lane fit"],
                       capture_output=True, text=True, timeout=120)
    holder.close()
    assert r.returncode == 0 and "locked" not in r.stderr, r.stdout + r.stderr
    recs = [f for f in os.listdir(tmp_path / "jd-analysis") if f.endswith(".json")]
    assert len(recs) == 1, "score.py must write the step-6 JSON record"
    assert fast_writer_ok(db)                # score.py left no lock behind
    c = J.connect(db)                        # the next tool (update_status-style write) works at once
    J.set_status(c, jid, "Skipped", by="test", note="lock regression"); c.commit()
    assert c.execute("select status, fit from jobs where id=?", (jid,)).fetchone()["status"] == "Skipped"
    c.close()
