"""Offline tests: every source function runs against a synthetic sample of its board's output
(tests/source_fixtures.py). No network: sweep.http is replaced by the fixture."""
import datetime as dt, json, os, re, types

import pytest

from pipeline import schema as SC, sweep as W
from tests import source_fixtures as F

SINCE = dt.datetime(2025, 12, 1, tzinfo=dt.timezone.utc)


@pytest.fixture
def offline(monkeypatch):
    def use(name):
        monkeypatch.setattr(W, "http", F.fake_http(name))
        monkeypatch.setattr(W.time, "sleep", lambda *_: None)
    return use


def check_posts(posts, source_prefix, min_n=1):
    assert len(posts) >= min_n, "no postings parsed from the fixture"
    for p in posts:
        SC.record_from_posting(p)
    assert all(p["source"].startswith(source_prefix) for p in posts)
    assert all(p["title"] and p["company"] for p in posts)


def test_ashby(offline):
    offline("ashby")
    posts, st = W.fetch_ashby([{"company": "Acme Robotics", "slug": "acme-robotics"}], SINCE, {})
    assert st["ok"] == 1 and st["failed"] == 0
    check_posts(posts, "ats:ashby", 3)
    assert "Unlisted Role" not in {p["title"] for p in posts}
    assert all(p["url"].startswith("https://jobs.ashbyhq.com/") for p in posts)
    assert posts[0]["pay"] == "$160K – $190K"


def test_greenhouse(offline):
    offline("greenhouse")
    posts, st = W.fetch_greenhouse([{"company": "Contoso Labs", "slug": "contoso-labs"}], SINCE, {})
    assert st["ok"] == 1
    check_posts(posts, "ats:greenhouse", 2)


def test_lever(offline):
    offline("lever")
    posts, st = W.fetch_lever([{"company": "Fabrikam", "slug": "fabrikam"}], SINCE, {})
    assert st["ok"] == 1
    check_posts(posts, "ats:lever", 2)
    assert "Remote" in posts[0]["location"]


def test_smartrecruiters(offline):
    offline("smartrecruiters")
    posts, st = W.fetch_smartrecruiters([{"company": "Woodgrove", "slug": "woodgrove"}], SINCE, {})
    assert st["ok"] >= 1
    check_posts(posts, "ats:smartrecruiters", 2)


def test_linkedin_guest(offline):
    offline("linkedin_guest")
    cfg = {"pages": 2, "pace_seconds": 0, "queries": [{"id": "t", "q": "engineering manager", "geo_id": "1", "remote": True}]}
    posts, st = W.fetch_linkedin_guest(cfg, dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=3), {})
    assert st["ok"] >= 1
    check_posts(posts, "li:guest", 2)
    assert all(re.match(r"https://www\.linkedin\.com/jobs/view/\d+$", p["url"]) for p in posts)
    assert any(p["location"].endswith("(Remote filter)") for p in posts)


def test_gov_neogov_and_usajobs_gap(offline, monkeypatch):
    offline("gov")
    monkeypatch.delenv("USAJOBS_API_KEY", raising=False)
    cfg = {"usajobs": {"enabled": True}, "neogov": {"enabled": True, "agencies": [{"slug": "springfield", "name": "Springfield", "state": "IL"}]},
           "smartrecruiters_gov": {"enabled": False}}
    posts, st = W.fetch_gov(cfg, SINCE, {})
    assert "USAJOBS_API_KEY" in (st["gap"] or ""), "missing key must be a logged Gap, not a crash"
    check_posts([p for p in posts if p["source"] == "gov:neogov"], "gov:neogov")
    assert all(p["extra"].get("public_sector") for p in posts)
    assert posts[0]["location"] == "Springfield, IL", "the state comes from the agency entry, never a hardcoded one"


def test_hn(offline):
    offline("hn_whos_hiring")
    ctx = {}
    posts, st = W.fetch_hn({"months": 1}, dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc), ctx)
    assert posts == [] and st["ok"] == 1          # HN yields leads, never rows
    assert [l["company"] for l in ctx["hn_leads"]] == ["Acme Robotics"]
    assert ctx["hn_leads"][0]["boards"] == ["jobs.ashbyhq.com/acme-robotics"]


def test_getro(offline):
    offline("getro")
    cfg = {"boards": [{"firm": "examplevc", "host": "jobs.example-vc.com"}], "queries": ["platform engineer"]}
    posts, st = W.fetch_getro(cfg, SINCE, {})
    assert st["ok"] >= 1
    check_posts(posts, "vc:examplevc")


def test_a16z(offline):
    offline("a16z")
    posts, st = W.fetch_a16z({"queries": ["engineering-manager"]}, SINCE, {})
    assert st["ok"] == 1
    check_posts(posts, "vc:a16z")


def test_workday_script(monkeypatch, tmp_path, home):
    out_json = F.workday_script_output()
    script = home / "workday_script.py"; script.write_text("# placeholder: the test replaces subprocess.run\n")
    def fake_run(cmd, **kw):
        out = cmd[cmd.index("--out-dir") + 1]
        os.makedirs(out, exist_ok=True)
        json.dump(out_json, open(os.path.join(out, "workday-sweep.json"), "w"))
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")
    monkeypatch.setattr(W.subprocess, "run", fake_run)
    posts, st = W.fetch_workday({"script": "workday_script.py"}, SINCE, {"run_dir": str(tmp_path)})
    check_posts(posts, "workday", min_n=1)


def test_workday_without_script_is_a_gap(tmp_path, home):
    posts, st = W.fetch_workday({}, SINCE, {"run_dir": str(tmp_path)})
    assert posts == [] and "no script configured" in st["gap"]
    posts, st = W.fetch_workday({"script": "missing.py"}, SINCE, {"run_dir": str(tmp_path)})
    assert posts == [] and "not found" in st["gap"] and W.source_failed(st)


def test_failed_source_is_detected(monkeypatch):
    monkeypatch.setattr(W, "http", lambda *a, **k: (503, b""))
    posts, st = W.fetch_ashby([{"company": "X", "slug": "x"}], SINCE, {})
    assert W.source_failed(st) and posts == []


def test_sweep_dry_run_end_to_end(home):
    """a full sweep over the example config with every network call replaced: report written, DB untouched."""
    from tests import helpers as T
    import yaml
    cfg = yaml.safe_load((home / "sources.yaml").read_text())
    cfg["sources"]["ashby"]["boards"] = [{"company": "Acme Robotics", "slug": "acme-robotics"}]
    cfg["sources"]["greenhouse"]["boards"] = [{"company": "Contoso Labs", "slug": "contoso-labs"}]
    cfg["sources"]["lever"]["boards"] = [{"company": "Fabrikam", "slug": "fabrikam"}]
    (home / "sources.yaml").write_text(yaml.safe_dump(cfg, sort_keys=False))
    drv = home / "drive_sweep.py"
    drv.write_text(
        "import sys, runpy\n"
        "from tests import source_fixtures as F\n"
        "from pipeline import sweep as W\n"
        "tables = {k: F.fake_http(k) for k in ('ashby', 'greenhouse', 'lever')}\n"
        "def http(url, data=None, headers=None, timeout=30):\n"
        "    for h in tables.values():\n"
        "        code, body = h(url)\n"
        "        if code == 200: return code, body\n"
        "    return 404, b''\n"
        "W.http = http\n"
        "W.time.sleep = lambda *_: None\n"
        "sys.argv = ['sweep', '--hours', '9999', '--dry-run', '--sources', 'ashby,greenhouse,lever']\n"
        "W.main() if hasattr(W, 'main') else runpy.run_module('pipeline.sweep', run_name='__main__')\n")
    import subprocess, sys
    r = subprocess.run([sys.executable, str(drv)], capture_output=True, text=True, env=T.env_for(home, PYTHONPATH=T.ROOT), cwd=str(home), timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    runs = list((home / "runs").glob("*/report.json"))
    assert len(runs) == 1
    rep = json.loads(runs[0].read_text())
    assert rep["dry_run"] is True
    titles = {n["title"] for n in rep["new"]}
    assert "Senior Platform Engineer" in titles and "Account Executive" not in titles
    assert all(st.get("failed", 0) == 0 for st in rep["sources"].values()), rep["sources"]
    from pipeline import jobsdb as J
    T.activate(home)
    c = J.connect()
    assert c.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0, "dry run writes no jobs"
