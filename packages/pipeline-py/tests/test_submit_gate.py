"""submit_gate: the last check before an application goes out. Read-only posting checks use fakes here (no network)."""
import json, sqlite3

import pytest

from tests import helpers as T

UUID = "11111111-2222-3333-4444-555555555555"


def fake_jget(table):
    def jget(url, **kw):
        for prefix, (code, d) in table.items():
            if url.startswith(prefix):
                return code, d
        return 404, None
    return jget


def fake_get(table):
    def get(url, **kw):
        for prefix, (code, body) in table.items():
            if url.startswith(prefix):
                return code, body
        return 404, b""
    return get


@pytest.mark.parametrize("url,jt,gt,state", [
    (f"https://jobs.ashbyhq.com/acme-robotics/{UUID}", {"https://api.ashbyhq.com/posting-api/job-board/acme-robotics": (200, {"jobs": [{"id": UUID}]})}, {}, "live"),
    (f"https://jobs.ashbyhq.com/acme-robotics/{UUID}", {"https://api.ashbyhq.com/posting-api/job-board/acme-robotics": (200, {"jobs": []})}, {}, "closed"),
    (f"https://jobs.ashbyhq.com/acme-robotics/{UUID}", {}, {}, "unknown"),
    ("https://job-boards.greenhouse.io/contoso-labs/jobs/100", {"https://boards-api.greenhouse.io/v1/boards/contoso-labs/jobs/100": (200, {})}, {}, "live"),
    ("https://job-boards.greenhouse.io/contoso-labs/jobs/100", {}, {}, "closed"),
    (f"https://jobs.lever.co/fabrikam/{UUID}", {f"https://api.lever.co/v0/postings/fabrikam/{UUID}": (200, {})}, {}, "live"),
    ("https://proseware.wd5.myworkdayjobs.com/External/job/Remote/Engineer_JR100",
     {"https://proseware.wd5.myworkdayjobs.com/wday/cxs/proseware/External/job/": (200, {"jobPostingInfo": {"canApply": False}})}, {}, "closed"),
    ("https://www.linkedin.com/jobs/view/4000000001", {}, {"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4000000001":
                                                           (200, b"<h2 class='top-card-layout__title'>Engineer</h2>")}, "live"),
    ("https://www.linkedin.com/jobs/view/4000000001", {}, {"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4000000001":
                                                           (200, b"No longer accepting applications")}, "closed"),
    ("https://careers.example.com/jobs/9", {}, {"https://careers.example.com/jobs/9": (200, b"<html>apply</html>")}, "unknown"),
    ("", {}, {}, "unknown"),
])
def test_posting_status(url, jt, gt, state):
    from apply.tools import submit_gate as SG
    assert SG.posting_status(url, get=fake_get(gt), jget=fake_jget(jt))[0] == state


def live(url, company=None): return "live", "fake: listed"
def closed(url, company=None): return "closed", "fake: gone"
def unknown(url, company=None): return "unknown", "fake: no API"


def gate(home, p, fn=live, **kw):
    T.activate(home)
    from apply.tools import submit_gate as SG
    return SG.gate(str(p), posting_fn=fn, **kw)


def test_ok_and_recorded(home):
    p, jid = T.finalized_package(home)
    r = gate(home, p)
    assert r["result"] == "OK" and r["job_id"] == jid, r["reasons"]
    c = sqlite3.connect(home / "jobs.db")
    assert c.execute("SELECT result, posting FROM submit_checks WHERE job_id=?", (jid,)).fetchall() == [("OK", "live")]


def test_relative_package_path_resolves_from_home(home):
    p, _ = T.finalized_package(home)
    assert gate(home, p.relative_to(home))["result"] == "OK"


def test_closed_blocks(home):
    p, _ = T.finalized_package(home)
    r = gate(home, p, closed)
    assert r["result"] == "BLOCK" and any("posting closed" in x for x in r["reasons"])


def test_unknown_needs_a_note(home):
    p, _ = T.finalized_package(home)
    assert gate(home, p, unknown)["result"] == "BLOCK"
    r = gate(home, p, unknown, verified_live="checked the Apply page by hand on 2026-01-05")
    assert r["result"] == "OK"


def test_unfinalized_blocks(home):
    p = T.built_package(home); T.seed_job(home, p)
    r = gate(home, p)
    assert r["result"] == "BLOCK" and any("finalize_review" in x for x in r["reasons"])


def test_skipped_job_blocks(home):
    p, jid = T.finalized_package(home)
    T.cli(home, "update-status", "--id", jid, "--status", "Skipped", "--skip-reason", "other", "--note", "candidate passed", "--by", "test", check=True)
    r = gate(home, p)
    assert r["result"] == "BLOCK" and any("not 'Packaged'" in x for x in r["reasons"])


def test_edit_after_finalize_blocks(home):
    p, _ = T.finalized_package(home)
    (p / "resume-native.md").write_text((p / "resume-native.md").read_text().replace("Observability.", "Observability work."))
    r = gate(home, p)
    assert r["result"] == "BLOCK"
