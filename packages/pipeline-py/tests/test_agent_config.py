import yaml

from tests import helpers as T


def test_candidate_strips_private_fields(home):
    cp = home / "profile" / "candidate.yaml"
    d = yaml.safe_load(cp.read_text()); d["address"] = "1 Fake Street"; d["date_of_birth"] = "2000-01-01"
    cp.write_text(yaml.safe_dump(d))
    r = T.cli(home, "config", "candidate", check=True)
    assert "Fake Street" not in r.stdout and "2000-01-01" not in r.stdout and "Alex Example" in r.stdout


def test_outreach_proof_from_claims(home):
    r = T.cli(home, "config", "outreach-proof", check=True)
    assert "[nw.platform]" in r.stdout and "30 production services" in r.stdout


def test_outreach_proof_rejects_unapproved(home):
    ap = home / "profile" / "agent-config.yaml"
    d = yaml.safe_load(ap.read_text()); d["outreach"]["proof_defaults"].append({"claim": "ct.cost"})
    ap.write_text(yaml.safe_dump(d, sort_keys=False))
    r = T.cli(home, "config", "outreach-proof")
    assert r.returncode != 0 and "ct.cost" in (r.stdout + r.stderr)


def test_config_path(home):
    r = T.cli(home, "config", "path", "jobs_db", check=True)
    assert r.stdout.strip() == str(home / "jobs.db")
