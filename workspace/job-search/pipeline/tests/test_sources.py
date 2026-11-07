"""Offline tests: every source function runs against a newly invented board output (tests/fixtures/<source>.json).
No network: sweep.http is replaced by a replay of the synthetic responses. Run: python3 -m pytest -q tests/"""

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

import datetime as dt, json, os, re, sys, subprocess, types
import pytest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import sweep as W          # noqa: E402
import schema as SC        # noqa: E402

FIX = os.path.join(HERE, "fixtures")
SINCE = dt.datetime(2099, 1, 1, tzinfo=dt.timezone.utc)

def replay(name):
    rec = json.load(open(os.path.join(FIX, f"{name}.json")))
    def fake_http(url, data=None, headers=None, timeout=30):
        for r in rec:
            if r["url"] == url:
                return r["status"], r["body"].encode()
        # same endpoint, different volatile query params (e.g. LinkedIn f_TPR seconds, HN created_at filter)
        base = url.split("?")[0]
        for r in rec:
            if r["url"].split("?")[0] == base:
                return r["status"], r["body"].encode()
        return 404, b""
    return fake_http

@pytest.fixture
def offline(monkeypatch):
    def use(name):
        monkeypatch.setattr(W, "http", replay(name))
        monkeypatch.setattr(W.time, "sleep", lambda *_: None)
    return use

def valid_records(posts):
    ok, bad = [], []
    for p in posts:
        try: ok.append(SC.record_from_posting(p))
        except Exception as e: bad.append((p, e))
    return ok, bad

def check_posts(posts, source_prefix, min_n=1):
    assert len(posts) >= min_n, "no postings parsed from the fixture"
    ok, bad = valid_records(posts)
    assert len(ok) >= 0.95 * len(posts), f"{len(bad)} of {len(posts)} failed the job-record schema: {bad[:2]}"
    assert all(p["source"].startswith(source_prefix) for p in posts)
    assert all(p["title"] and p["company"] for p in posts)

def test_ashby(offline):
    offline("ashby")
    posts, st = W.fetch_ashby([{"company": "fictional-board", "slug": "fictional-board"}], SINCE, {})
    assert st["ok"] == 1 and st["failed"] == 0
    check_posts(posts, "ats:ashby")
    assert all(p["url"].startswith("https://jobs.ashbyhq.com/") for p in posts)

def test_greenhouse(offline):
    offline("greenhouse")
    posts, st = W.fetch_greenhouse([{"company": "fictional-board", "slug": "fictional-board"}], SINCE, {})
    assert st["ok"] == 1
    check_posts(posts, "ats:greenhouse")

def test_lever(offline):
    offline("lever")
    posts, st = W.fetch_lever([{"company": "fictional-board", "slug": "fictional-board"}], SINCE, {})
    assert st["ok"] == 1
    check_posts(posts, "ats:lever")

def test_smartrecruiters(offline):
    offline("smartrecruiters")
    posts, st = W.fetch_smartrecruiters([{"company": "fictional-board", "slug": "fictional-board"}], SINCE, {})
    assert st["ok"] >= 1
    check_posts(posts, "ats:smartrecruiters")

def test_linkedin_guest(offline):
    offline("linkedin_guest")
    cfg = {"pages": 2, "pace_seconds": 0, "queries": [{"id": "t", "q": "engineering manager", "geo_id": "0"}]}
    posts, st = W.fetch_linkedin_guest(cfg, dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=3), {})
    assert st["ok"] >= 1
    check_posts(posts, "li:guest")
    assert all(re.match(r"https://www\.linkedin\.com/jobs/view/\d+$", p["url"]) for p in posts)

def test_gov_neogov_and_usajobs_gap(offline, monkeypatch):
    offline("gov")
    monkeypatch.delenv("USAJOBS_API_KEY", raising=False)
    cfg = {"usajobs": {"enabled": True}, "calcareers": {"enabled": True, "url": "https://www.calcareers.ca.gov/CalHRPublic/Search/JobSearchResults.aspx"},
           "neogov": {"enabled": True, "agencies": [{"slug": "fictional-agency", "name": "Fictional Agency"}]},
           "smartrecruiters_gov": {"enabled": False}}
    posts, st = W.fetch_gov(cfg, SINCE, {})
    assert "USAJOBS_API_KEY" in (st["gap"] or ""), "missing key must be a logged Gap, not a crash"
    check_posts([p for p in posts if p["source"] == "gov:neogov"], "gov:neogov")
    assert all(p["extra"].get("public_sector") for p in posts)

def test_hn(offline):
    offline("hn_whos_hiring")
    ctx = {}
    posts, st = W.fetch_hn({"months": 1}, dt.datetime(2099, 1, 1, 7, tzinfo=dt.timezone.utc), ctx)
    assert posts == [] and st["ok"] == 1          # HN yields leads, never rows
    assert isinstance(ctx.get("hn_leads"), list)

def test_getro(offline):
    offline("getro")
    cfg = {"boards": [{"firm": "fictional-fund", "host": "jobs.example.invalid"}], "queries": ["engineering manager", "technical program manager", "forward deployed"]}
    posts, st = W.fetch_getro(cfg, SINCE, {})
    assert st["ok"] >= 1
    check_posts(posts, "vc:fictional-fund")

def test_a16z(offline):
    offline("a16z")
    posts, st = W.fetch_a16z({"queries": ["technical-program-manager"]}, SINCE, {})
    assert st["ok"] == 1
    check_posts(posts, "vc:a16z")

def test_workday(monkeypatch, tmp_path):
    fixture = json.load(open(os.path.join(FIX, "workday.json")))
    def fake_run(cmd, **kw):
        out = cmd[cmd.index("--out-dir") + 1]
        os.makedirs(out, exist_ok=True)
        json.dump(fixture, open(os.path.join(out, "workday-sweep.json"), "w"))
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")
    monkeypatch.setattr(W.subprocess, "run", fake_run)
    posts, st = W.fetch_workday({"script": "../workday_sweep.py"}, SINCE, {"run_dir": str(tmp_path)})
    check_posts(posts, "workday", min_n=len(fixture["hits"]))

def test_failed_source_is_detected(monkeypatch):
    monkeypatch.setattr(W, "http", lambda *a, **k: (503, b""))
    posts, st = W.fetch_ashby([{"company": "X", "slug": "x"}], SINCE, {})
    assert W.source_failed(st) and posts == []
