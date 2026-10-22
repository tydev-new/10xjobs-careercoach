"""One shared scoring prompt; code-only check d (every must-have proven or listed in gaps); the eval gate runs offline."""
import os

from pipeline import fitcheck as FC
from pipeline.evals import run as EV
from tests import helpers as T

BASE = {"want": "pass", "want_reasons": ["ok"], "win": "medium", "reason": "a reason long enough"}


def test_one_prompt_file_shared_by_live_and_evals():
    assert os.path.basename(FC.PROMPT_PATH) == "scoring-prompt.md" and os.path.isfile(FC.PROMPT_PATH)
    assert not os.path.islink(FC.PROMPT_PATH), "the prompt ships as a real file"
    case = {"posting": {"company": "Acme", "title": "Engineer", "location": "Remote", "pay": "$1", "jd_text": "JD BODY"}}
    out = EV.build_prompt(case, {"criteria": "CRIT", "resume": "RES"})
    assert out == FC.render_prompt("CRIT", "RES", case["posting"])
    assert "CRIT" in out and "RES" in out and "JD BODY" in out and "{criteria}" not in out


def test_unproven_must_have_needs_a_gap():
    r, _ = FC.check({**BASE, "must_haves": [{"need": "Rust in production", "proof": None}, {"need": "led teams", "proof": "led a team of 8"}], "gaps": []})
    assert FC.unaccounted_must_haves(r) == ["Rust in production"]
    r, _ = FC.check({**BASE, "must_haves": [{"need": "Rust in production", "proof": ""}], "gaps": ["Rust in production (none on resume)"]})
    assert FC.unaccounted_must_haves(r) == []
    r, _ = FC.check({**BASE, "must_haves": [{"need": "Active licence", "proof": None}], "blockers": ["active licence"]})
    assert FC.unaccounted_must_haves(r) == []


def test_eval_gate_examples_rules_and_file_backends(home):
    r = T.cli(home, "evals", "--suite", "examples", "--backend", "rules", "--check")
    assert r.returncode == 0, r.stdout + r.stderr
    out = T.ROOT / "pipeline" / "evals" / "agent-runs" / "examples-agent-outputs.jsonl"
    r = T.cli(home, "evals", "--suite", "examples", "--backend", "file", "--outputs", out, "--check")
    assert r.returncode == 0, r.stdout + r.stderr
    assert (home / "evals" / "results").is_dir(), "results go to the data folder, not the code folder"
    assert not (T.ROOT / "pipeline" / "evals" / "results").exists()


def test_private_suite_skipped_when_missing(home):
    r = T.cli(home, "evals", "--backend", "rules")
    assert r.returncode == 0 and "private" in (r.stdout + r.stderr).lower()


def test_score_prompt_uses_criteria_and_base(home):
    from pipeline import jobsdb as J
    c = J.connect()
    jid = J.insert_job(c, company="Acme", title="Senior Platform Engineer", source="test", lane="IC builder",
                       url="https://x.test/p", location="Remote, US"); c.commit(); c.close()
    jd = home / "jd.txt"; jd.write_text("We need Kubernetes in production.")
    r = T.cli(home, "score", "--id", jid, "--prompt", "--jd-file", jd, check=True)
    assert "Base pay floor: $150,000" in r.stdout and "Kubernetes platform that runs 30 production services" in r.stdout
    assert "Kubernetes in production" in r.stdout
