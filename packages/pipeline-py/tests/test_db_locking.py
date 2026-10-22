"""jobsdb.connect() must not return holding a write transaction: sequential and concurrent connections work, and
score followed by another tool runs without 'database is locked'."""
import os, sqlite3, subprocess, sys, threading, time

from pipeline import jobsdb as J
from tests import helpers as T


def fast_writer_ok(db, timeout=0.2):
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
    c1 = J.connect(db)
    jid = J.insert_job(c1, company="Co", title="EM", source="test", url="https://x.test/1"); c1.commit()
    c1.execute("select * from jobs where id=?", (jid,)).fetchone()
    c2 = J.connect(db)
    c2.execute("update jobs set notes='ok' where id=?", (jid,)); c2.commit()
    c3 = J.connect(db)
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


def score_args(jid, i=0):
    return ["score", "--id", jid, "--want", "pass", "--win", "high", "--remote", "remote-us",
            "--must", "people leadership :: led the platform team", "--want-why", f"lane fit {i}"]


def test_score_then_another_tool(home):
    c = J.connect()
    jid = J.insert_job(c, company="Acme", title="Engineering Manager", source="test", url="https://x.test/acme", location="Austin, TX")
    c.commit(); c.close()
    holder = J.connect()                     # another tool has the DB open (idle) while score runs
    r = T.cli(home, *score_args(jid))
    holder.close()
    assert r.returncode == 0 and "locked" not in r.stderr, r.stdout + r.stderr
    recs = [f for f in os.listdir(home / "jd-analysis") if f.endswith(".json")]
    assert len(recs) == 1, "score must write the step-6 JSON record"
    assert fast_writer_ok(J.DB_PATH)
    c = J.connect()
    J.set_status(c, jid, "Skipped", by="test", note="lock regression"); c.commit()
    assert c.execute("select status from jobs where id=?", (jid,)).fetchone()["status"] == "Skipped"
    c.close()


def test_score_requires_remote_check_outside_geo(home):
    c = J.connect()
    jid = J.insert_job(c, company="Acme", title="Engineering Manager", source="test", url="https://x.test/acme2", location="Austin, TX")
    c.commit(); c.close()
    r = T.cli(home, "score", "--id", jid, "--want", "pass", "--win", "high", "--must", "x :: y", "--want-why", "w")
    assert r.returncode != 0 and "--remote" in (r.stdout + r.stderr)


def test_find_by_id(home):
    import json
    from tests import helpers as T
    r = T.cli(home, "upsert", "--company", "Acme Robotics", "--title", "Senior Platform Engineer", "--source", "web",
              "--url", "https://jobs.example.com/acme/1", check=True)
    out = T.cli(home, "find", "--id", "1", "--json", check=True).stdout
    assert json.loads(out.splitlines()[0])["company"] == "Acme Robotics"
    assert "no match" in T.cli(home, "find", "--id", "99").stdout
