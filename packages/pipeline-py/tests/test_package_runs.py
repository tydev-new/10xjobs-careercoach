"""package_runs / package_outcomes traceability and reply-rate reporting."""
from pipeline import jobsdb as J, weekly_report as W


def db(tmp_path, n=1, lane="Eng Manager"):
    c = J.connect(str(tmp_path / "p.db"))
    ids = [J.insert_job(c, company=f"Co{i}", title="Engineering Manager", source="test", lane=lane, url=f"https://x.test/{i}") for i in range(n)]
    return c, ids


def run(c, tmp_path, jid, base="eng-manager", cover="bullets", verdict="PASS", at="2026-01-05T08:00:00-08:00", lane=None):
    return J.record_package_run(c, package_path=str(tmp_path / "packages" / "2026-01-05" / f"eng-co{jid}"), job_id=jid, base=base,
                                cover_format=cover, lint_version="format-check 1", claims_version="claims-example-1",
                                rubric_version="apply-rubric-1.0", verdict=verdict, round=1, stamped_at=at, lane=lane)


def test_migration_creates_tables(tmp_path):
    c, _ = db(tmp_path)
    names = {r[0] for r in c.execute("select name from sqlite_master")}
    assert {"package_runs", "package_outcomes", "package_results", "submit_checks"} <= names
    assert c.execute("select v from meta where k='schema_package_runs'").fetchone()[0] == J.PACKAGE_RUNS_SCHEMA


def test_status_changes_link_to_latest_run(tmp_path):
    c, (j,) = db(tmp_path)
    r1 = run(c, tmp_path, j, at="2026-01-04T08:00:00-08:00"); r2 = run(c, tmp_path, j, at="2026-01-05T08:00:00-08:00")
    J.set_status(c, j, "Applied", by="user", when="2026-01-05T09:00:00-08:00")
    J.set_status(c, j, "Interviewing", by="user", when="2026-01-07T09:00:00-08:00")
    got = {(o["run_id"], o["outcome"]) for o in c.execute("select * from package_outcomes")}
    assert got == {(r2, "applied"), (r2, "interviewing"), (r2, "replied")} and r1 != r2
    row = c.execute("select applied, replied, interviewed, rejected from package_results where id=?", (r2,)).fetchone()
    assert tuple(row) == (1, 1, 1, 0)


def test_no_run_no_outcome(tmp_path):
    c, (j,) = db(tmp_path)
    J.set_status(c, j, "Rejected", by="agent")
    assert c.execute("select count(*) from package_outcomes").fetchone()[0] == 0


def test_lane_filled_from_job(tmp_path):
    c, (j,) = db(tmp_path, lane="IC builder")
    rid = run(c, tmp_path, j)
    assert c.execute("select lane from package_runs where id=?", (rid,)).fetchone()[0] == "IC builder"


def test_rates_hidden_below_5(tmp_path):
    c, ids = db(tmp_path, n=7)
    for i, j in enumerate(ids):
        run(c, tmp_path, j, base="eng-manager" if i < 5 else "ic-builder", cover="none" if i >= 5 else "bullets")
        J.set_status(c, j, "Applied", by="user")
    J.set_status(c, ids[0], "Interviewing", by="user")
    J.set_status(c, ids[1], "Rejected", by="user")
    rows = {k: (n, pos, resp, pr, rr) for k, n, pos, resp, pr, rr in W.reply_rates(c, "base")}
    assert rows["eng-manager"] == (5, 1, 2, "20%", "40%")
    assert rows["ic-builder"][3] == "n<5" and rows["ic-builder"][4] == "n<5"
    assert "n<5" in "\n".join(W.reply_rate_section(c))


def test_unique_run_per_stamp(tmp_path):
    c, (j,) = db(tmp_path)
    assert run(c, tmp_path, j) == run(c, tmp_path, j)
    assert c.execute("select count(*) from package_runs").fetchone()[0] == 1


def test_skipped_by_is_generic():
    assert J.skipped_by_of("Skipped (user, too far)", "") == "user"
    assert J.skipped_by_of("Skipped", "candidate pass: not interested") == "user"
    assert J.skipped_by_of("Skipped", "agent: geo") == "agent"


def test_build_and_review_in_the_same_second_both_recorded(tmp_path):
    from pipeline import jobsdb as J
    c = J.connect(str(tmp_path / "s.db"))
    ts = "2026-01-05T10:00:00-08:00"
    a = J.record_package_run(c, package_path="/data/packages/2026-01-05/ic-acme", verdict="BUILT", source="build_package", stamped_at=ts)
    b = J.record_package_run(c, package_path="/data/packages/2026-01-05/ic-acme", verdict="PASS", source="stamp_review", stamped_at=ts)
    assert a != b
    assert [r[0] for r in c.execute("SELECT verdict FROM package_runs ORDER BY id")] == ["BUILT", "PASS"]
    assert J.record_package_run(c, package_path="/data/packages/2026-01-05/ic-acme", verdict="PASS", source="stamp_review", stamped_at=ts) == b
