from pipeline import jobsdb as J, sweep as W


def db(tmp_path, history):
    c = J.connect(str(tmp_path / "h.db"))
    for i, (status, jobs) in enumerate(history):   # oldest first
        J.add_health(c, f"r{i}", "ashby", status, jobs, 0, 0, 1.0, 1, None)
        c.execute("UPDATE source_health SET at=? WHERE run_id=?", (f"2026-01-01T0{i}:00", f"r{i}"))
    return c


def st(status, fetched, **kw):
    return {"health_status": status, "fetched": fetched, "matched": 0, "seconds": 1, "attempts": 1, **kw}


def test_drop_to_half_flagged(tmp_path):
    c = db(tmp_path, [("ok", 100), ("ok", 110), ("ok", 90)])
    h = W.health_flags(c, "ashby", st("ok", 40), 0, {})
    assert any(f.startswith("DROP") for f in h["flags"]) and h["usual"] == 100


def test_zero_streak_flagged_as_broken(tmp_path):
    c = db(tmp_path, [("ok", 100), ("empty", 0), ("empty", 0)])
    h = W.health_flags(c, "ashby", st("empty", 0), 0, {"empty_streak": 3})
    assert any("3 run(s) in a row" in f and "broken" in f for f in h["flags"])


def test_failed_flagged(tmp_path):
    c = db(tmp_path, [("ok", 10)])
    h = W.health_flags(c, "ashby", st("broken", 0, gap="HTTP 503", attempts=3), 0, {})
    assert h["flags"][0].startswith("BROKEN")


def test_retry_twice_then_broken(monkeypatch):
    calls = []
    def bad(cfg, since, ctx):
        calls.append(1); return [], {**W._stats(), "failed": 1, "errors": ["x:503"]}
    monkeypatch.setattr(W.time, "sleep", lambda *_: None)
    posts, s = W.fetch_with_retry("ashby", bad, {}, None, {}, {"retries": 2})
    assert len(calls) == 3 and s["attempts"] == 3 and W.source_failed(s)


def test_retry_recovers(monkeypatch):
    seq = iter([{**W._stats(), "failed": 1}, {**W._stats(), "ok": 1, "fetched": 5}])
    monkeypatch.setattr(W.time, "sleep", lambda *_: None)
    posts, s = W.fetch_with_retry("ashby", lambda *a: ([], next(seq)), {}, None, {}, {"retries": 2})
    assert s["attempts"] == 2 and not W.source_failed(s)
