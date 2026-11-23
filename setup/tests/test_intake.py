"""Offline tests for the intake missing-field report and the backfill writer."""
from pathlib import Path
import json, re, subprocess, sys

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "setup"))
import intake  # noqa: E402

FILES = (
    "workspace/job-search/profile/profile.yaml",
    "workspace/job-search/profile/claims.yaml",
    "workspace/job-search/profile/policy.yaml",
    "workspace/job-search/profile/agent-config.yaml",
    "workspace/job-search/pipeline/sources.yaml",
    "workspace/job-search/pipeline/scoring.yaml",
)


def scaffold(tmp_path):
    for rel in FILES:
        src = ROOT / rel
        dest = tmp_path / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(src.read_bytes())
    return tmp_path


def load(path):
    return yaml.safe_load(path.read_text())


def snapshot(root):
    search = root / "workspace/job-search"
    profile = load(search / "profile/profile.yaml")
    return {
        "profile": profile,
        "identity": profile.get("identity"),
        "claims": load(search / "profile/claims.yaml"),
        "policy": load(search / "profile/policy.yaml"),
        "sources": load(search / "pipeline/sources.yaml"),
        "scoring": load(search / "pipeline/scoring.yaml"),
        "agent": load(search / "profile/agent-config.yaml"),
        "criteria": profile.get("criteria") or "",
        "bytes": {rel: (root / rel).read_bytes() for rel in FILES},
    }


def norm(value):
    if isinstance(value, dict):
        return {key: norm(item) for key, item in value.items()}
    if isinstance(value, list):
        return [norm(item) for item in value]
    if hasattr(value, "isoformat") and not isinstance(value, str):
        return value.isoformat()
    return value


def test_report_lists_missing_fields_and_blocks(tmp_path):
    root = scaffold(tmp_path)
    report = intake.build_report(root)
    assert report["submit_authorized"] is False
    assert report["send_authorized"] is False
    assert report["synthetic"] is True
    text = intake.render_report(report)
    assert "SUBMIT_AUTHORIZED: no" in text
    assert "SEND_AUTHORIZED: no" in text
    for name in intake.FIELDS:
        assert report["fields"][name]["state"] == "missing"
        assert f"FIELD {name}: missing" in text
    roles = report["fields"]["target_roles"]
    assert roles["ask"] == "value"
    assert roles["blocks"]["source"]
    assert roles["blocks"]["evaluate"]
    assert "apply" not in roles["blocks"]
    assert report["fields"]["pay_floor"]["blocks"]["evaluate"]
    assert report["fields"]["pay_floor"]["blocks"]["apply"]
    assert report["fields"]["claims"]["blocks"]["apply"]
    assert report["fields"]["claims"]["blocks"]["outreach"]
    assert report["fields"]["preferred_sources"]["ask"] == "no"
    assert report["fields"]["preferred_sources"]["blocks"] == {}
    evaluate = intake.render_report(report, "evaluate")
    assert "FIELD pay_floor: missing" in evaluate
    assert "FIELD preferred_sources: missing" not in evaluate
    coach = intake.render_report(report, "coach")
    assert "TASK coach: no intake field is required" in coach
    assert "FIELD target_roles" not in coach


def test_set_merges_pay_without_clobber(tmp_path):
    root = scaffold(tmp_path)
    before = snapshot(root)
    intake.set_field(root, "pay_floor", "180k", "user-stated", "2026-11-22")
    after = snapshot(root)
    assert after["policy"] == before["policy"]
    assert after["identity"] == before["identity"]
    assert after["criteria"] == before["criteria"]
    assert after["profile"]["lanes"] == before["profile"]["lanes"]
    assert norm(after["claims"]) == norm(before["claims"])
    assert after["sources"] == before["sources"]
    assert after["bytes"]["workspace/job-search/pipeline/scoring.yaml"] == before["bytes"]["workspace/job-search/pipeline/scoring.yaml"]
    assert after["bytes"]["workspace/job-search/profile/agent-config.yaml"] == before["bytes"]["workspace/job-search/profile/agent-config.yaml"]
    assert after["bytes"]["workspace/job-search/profile/claims.yaml"] == before["bytes"]["workspace/job-search/profile/claims.yaml"]
    assert after["bytes"]["workspace/job-search/pipeline/sources.yaml"] == before["bytes"]["workspace/job-search/pipeline/sources.yaml"]
    profile = after["profile"]
    assert profile["submit_authorized"] is False
    assert profile["send_authorized"] is False
    assert profile["synthetic"] is True
    pay = profile["fields"]["pay_floor"]
    assert pay["value"] == 180000
    assert pay["source"] == "user-stated"
    assert pay["date"] == "2026-11-22"
    assert pay["explicit"] is True
    assert after["criteria"].startswith("# New user onboarding\n")
    assert "Bundled examples are synthetic" in after["criteria"]
    assert "## Pay floor" not in after["criteria"]
    report = intake.build_report(root)
    assert report["fields"]["pay_floor"]["state"] == "set"
    assert report["fields"]["pay_floor"]["ask"] == "no"
    assert report["fields"]["pay_floor"]["blocks"] == {}
    assert report["fields"]["target_roles"]["state"] == "missing"


def test_list_merge_replace_and_sources_keep_other_keys(tmp_path):
    root = scaffold(tmp_path)
    before = snapshot(root)
    intake.set_field(root, "target_roles", ["Backend Engineer"], "extracted-from-resume", "2026-11-22")
    intake.set_field(root, "target_roles", ["Product Manager"], "user-stated", "2026-11-22")
    profile = load(root / "workspace/job-search/profile/profile.yaml")
    assert profile["fields"]["target_roles"]["value"] == ["Backend Engineer", "Product Manager"]
    assert profile["lanes"] == []
    sources = load(root / "workspace/job-search/pipeline/sources.yaml")
    assert sources == before["sources"]
    intake.set_field(root, "target_roles", ["Staff Engineer"], "user-stated", "2026-11-22", replace=True)
    profile = load(root / "workspace/job-search/profile/profile.yaml")
    assert profile["fields"]["target_roles"]["value"] == ["Staff Engineer"]
    assert load(root / "workspace/job-search/pipeline/sources.yaml") == before["sources"]
    policy = load(root / "workspace/job-search/profile/policy.yaml")
    assert policy["pay_floor"] is None
    assert policy["home_locations"] == []


def test_location_and_named_source_turns_on_without_wiping_geo(tmp_path):
    root = scaffold(tmp_path)
    before = snapshot(root)
    sys.path.insert(0, str(ROOT))
    from runtime_config import profile_module
    intake.set_field(root, "location", "Austin", "user-stated", "2026-11-22")
    intake.set_field(root, "location", ["Dallas"], "user-stated", "2026-11-22")
    policy = load(root / "workspace/job-search/profile/policy.yaml")
    assert policy == before["policy"]
    sources = load(root / "workspace/job-search/pipeline/sources.yaml")
    assert sources == before["sources"]
    intake.set_field(root, "preferred_sources", "Example Co", "user-stated", "2026-11-22")
    intake.set_field(
        root,
        "preferred_sources",
        [{"company": "Example Workshop", "ats_type": "ashby", "slug": "example-workshop"}],
        "user-stated",
        "2026-11-22",
    )
    assert load(root / "workspace/job-search/pipeline/sources.yaml") == before["sources"]
    saved = load(root / "workspace/job-search/profile/profile.yaml")["fields"]["preferred_sources"]["value"]
    assert {"company": "Example Co", "enabled": True} in saved
    assert {"company": "Example Workshop", "ats_type": "ashby", "slug": "example-workshop", "enabled": True} in saved
    overlaid = profile_module().overlay_sources(sources, root)
    assert overlaid["sources"]["ashby"]["enabled"] is True
    assert overlaid["sources"]["ashby"]["boards"] == [
        {"company": "Example Workshop", "ats_type": "ashby", "slug": "example-workshop"}
    ]
    assert any("Austin" in item for item in overlaid["geo"]["include"])
    assert any("Dallas" in item for item in overlaid["geo"]["include"])
    assert overlaid["geo"]["exclude"] == []
    assert sources["protected_sources"] == []
    intake.set_field(root, "work_mode", "Remote", "user-stated", "2026-11-22")
    assert load(root / "workspace/job-search/profile/policy.yaml")["home_locations"] == []
    report = intake.build_report(root)
    assert report["fields"]["work_mode"]["value"] == "remote"
    assert report["fields"]["work_mode"]["source"] == "user-stated"
    assert report["fields"]["location"]["value"] == ["Austin", "Dallas"]


def test_validation_refuses_without_writing(tmp_path):
    root = scaffold(tmp_path)
    before = snapshot(root)
    cases = (
        ("pay_floor", "about 100k", "user-stated"),
        ("work_mode", "sometimes", "user-stated"),
        ("target_roles", [""], "user-stated"),
        ("claims", {"text": "Shipped it", "status": "approved"}, "extracted-from-resume"),
        ("claims", {"text": "Shipped it", "id": "example.nope"}, "user-stated"),
        ("nope", "x", "user-stated"),
        ("pay_floor", 100, "guessed"),
        ("preferred_sources", [{"company": "Acme", "ats_type": "ashby", "slug": "has space"}], "user-stated"),
    )
    for field, value, source in cases:
        with pytest.raises(intake.IntakeError):
            intake.set_field(root, field, value, source, "2026-11-22")
    after = snapshot(root)
    assert after["bytes"] == before["bytes"]


def approved_ids(root):
    lib = str(ROOT / "workspace/job-apps/lib")
    if lib not in sys.path:
        sys.path.insert(0, lib)
    import claims as claimlib
    claimlib.load.cache_clear()
    path = str(root / "workspace/job-search/profile/claims.yaml")
    return [row["id"] for row in claimlib.approved(path=path)]


def test_user_stated_claim_is_approved_and_extracted_waits_for_confirm(tmp_path):
    root = scaffold(tmp_path)
    before = snapshot(root)
    intake.set_field(
        root,
        "claims",
        {"text": "Built 1 small billing API.", "numbers": ["1"]},
        "user-stated",
        "2026-11-22",
    )
    claims = load(root / "workspace/job-search/profile/claims.yaml")
    old = before["claims"]["claims"]
    assert norm(claims["claims"][: len(old)]) == norm(old)
    stated = claims["claims"][-1]
    assert stated["status"] == "approved"
    assert stated["source"] == "user-stated"
    assert norm(stated["approved"]) == "2026-11-22"
    assert stated["scope"] == ["all"]
    assert stated["intake"]["user_confirmed"] is True
    assert stated["intake"]["date"] == "2026-11-22"
    report = intake.build_report(root)
    assert report["fields"]["claims"]["state"] == "set"
    assert report["fields"]["claims"]["ask"] == "no"
    assert stated["id"] in report["fields"]["claims"]["approved"]
    assert report["fields"]["claims"]["blocks"] == {}
    assert report["submit_authorized"] is False
    assert report["send_authorized"] is False
    assert stated["id"] in approved_ids(root)
    with pytest.raises(intake.IntakeError):
        intake.set_field(
            root, "claims",
            {"id": stated["id"], "text": "Built 1 small billing API.", "numbers": ["1"]},
            "user-stated", "2026-11-22",
        )
    with pytest.raises(intake.IntakeError):
        intake.set_field(root, "claims", {"text": "Sorted 2 sample cards.", "numbers": ["9"]}, "extracted-from-resume", "2026-11-22")
    intake.set_field(
        root,
        "claims",
        {"text": "Sorted 2 sample cards.", "numbers": ["2"]},
        "extracted-from-resume",
        "2026-11-22",
    )
    claims = load(root / "workspace/job-search/profile/claims.yaml")
    extracted = claims["claims"][-1]
    assert extracted["status"] == "unconfirmed"
    assert extracted["source"] == "extracted-from-resume"
    assert extracted["intake"]["user_confirmed"] is False
    assert "approved" not in extracted
    assert extracted["id"] not in approved_ids(root)
    report = intake.build_report(root)
    assert report["fields"]["claims"]["state"] == "pending"
    assert report["fields"]["claims"]["ask"] == "confirm"
    assert extracted["id"] in report["fields"]["claims"]["confirm"]
    result = intake.confirm_claim(root, extracted["id"], "user-stated", "2026-11-23")
    assert result == {"id": extracted["id"], "status": "approved", "changed": True}
    claims = load(root / "workspace/job-search/profile/claims.yaml")
    confirmed = claims["claims"][-1]
    assert confirmed["status"] == "approved"
    assert norm(confirmed["approved"]) == "2026-11-23"
    assert confirmed["scope"] == ["all"]
    assert confirmed["source"] == "extracted-from-resume"
    assert confirmed["intake"]["confirmed_source"] == "user-stated"
    assert confirmed["text"] == extracted["text"]
    assert norm(claims["claims"][: len(old)]) == norm(old)
    assert extracted["id"] in approved_ids(root)
    report = intake.build_report(root)
    assert report["fields"]["claims"]["state"] == "set"
    assert report["fields"]["claims"]["ask"] == "no"
    assert report["fields"]["claims"]["waiting_approval"] == []
    again = intake.confirm_claim(root, extracted["id"], "user-stated", "2026-11-23")
    assert again["changed"] is False
    with pytest.raises(intake.IntakeError):
        intake.confirm_claim(root, extracted["id"], "extracted-from-resume", "2026-11-23")
    with pytest.raises(intake.IntakeError):
        intake.confirm_claim(root, "example.delivery", "user-stated", "2026-11-23")


def test_explicit_empty_is_not_asked_again(tmp_path):
    root = scaffold(tmp_path)
    intake.set_field(root, "dealbreakers", [], "user-stated", "2026-11-22")
    intake.set_field(root, "pay_floor", None, "user-stated", "2026-11-22")
    report = intake.build_report(root)
    assert report["fields"]["dealbreakers"]["state"] == "set"
    assert report["fields"]["dealbreakers"]["ask"] == "no"
    assert report["fields"]["dealbreakers"]["value"] == []
    assert report["fields"]["pay_floor"]["state"] == "set"
    assert report["fields"]["pay_floor"]["value"] is None
    assert report["fields"]["pay_floor"]["ask"] == "no"
    policy = load(root / "workspace/job-search/profile/policy.yaml")
    assert policy["pay_floor"] is None
    profile = load(root / "workspace/job-search/profile/profile.yaml")
    assert "## Dealbreakers" not in (profile.get("criteria") or "")
    assert profile["fields"]["dealbreakers"]["value"] == []


def test_scalar_update_keeps_previous_and_ignores_policy(tmp_path):
    root = scaffold(tmp_path)
    intake.set_field(root, "pay_floor", 100000, "user-stated", "2026-11-01")
    intake.set_field(root, "pay_floor", 120000, "user-stated", "2026-11-22")
    profile = load(root / "workspace/job-search/profile/profile.yaml")
    pay = profile["fields"]["pay_floor"]
    assert pay["value"] == 120000
    assert pay["previous"]["value"] == 100000
    assert pay["previous"]["date"] == "2026-11-01"
    policy = load(root / "workspace/job-search/profile/policy.yaml")
    policy["pay_floor"] = 250000
    (root / "workspace/job-search/profile/policy.yaml").write_text(
        yaml.dump(policy, Dumper=intake.Dumper, sort_keys=False, allow_unicode=True, width=4096)
    )
    report = intake.build_report(root)
    assert report["fields"]["pay_floor"]["state"] == "set"
    assert report["fields"]["pay_floor"]["value"] == 120000
    assert report["fields"]["pay_floor"]["ask"] == "no"
    assert "canonical" not in report["fields"]["pay_floor"]
    intake.set_field(root, "work_auth", "authorized to work, no sponsorship", "user-stated", "2026-11-22")
    profile = load(root / "workspace/job-search/profile/profile.yaml")
    identity = profile["identity"]
    assert identity["name"] == "Alex Example"
    assert identity["email"] == "alex@example.invalid"
    assert identity["phone"] is None
    assert identity["synthetic"] is True
    assert identity["sponsorship_needed"] is None
    assert "work_auth" not in identity
    assert profile["fields"]["work_auth"]["value"] == "authorized to work, no sponsorship"


def test_cli_report_set_and_onboarding_hook(tmp_path):
    root = scaffold(tmp_path)
    report = subprocess.run(
        [sys.executable, str(ROOT / "setup/intake.py"), "--root", str(root), "report", "--json", "--task", "apply"],
        check=True, text=True, capture_output=True,
    )
    payload = json.loads(report.stdout)
    assert payload["submit_authorized"] is False
    assert payload["send_authorized"] is False
    assert "pay_floor" in payload["fields"]
    assert "preferred_sources" not in payload["fields"]
    bad = subprocess.run(
        [sys.executable, str(ROOT / "setup/intake.py"), "--root", str(root), "set",
         "--field", "claims", "--value", json.dumps({"text": "Nope", "status": "approved"}),
         "--source", "extracted-from-resume", "--date", "2026-11-22"],
        text=True, capture_output=True,
    )
    assert bad.returncode == 2
    assert "INTAKE_ERROR" in bad.stderr
    assert "approved" in bad.stderr
    good = subprocess.run(
        [sys.executable, str(ROOT / "setup/intake.py"), "--root", str(root), "set",
         "--field", "pay_floor", "--value", "150000", "--source", "user-stated", "--date", "2026-11-22"],
        check=True, text=True, capture_output=True,
    )
    assert "SET pay_floor" in good.stdout
    assert "SUBMIT_AUTHORIZED: no" in good.stdout
    assert "SEND_AUTHORIZED: no" in good.stdout
    status = subprocess.run(
        [sys.executable, str(ROOT / "setup/intake.py"), "--root", str(root), "report"],
        check=True, text=True, capture_output=True,
    )
    assert "SYNTHETIC_PROFILE: yes" in status.stdout
    assert "SUBMIT_AUTHORIZED: no" in status.stdout
    assert "SOURCES_CONFIGURED: no" in status.stdout
    assert "UNCONFIGURED:" in status.stdout
    missing = next(line for line in status.stdout.splitlines() if line.startswith("INTAKE_MISSING:"))
    assert "target_roles" in missing
    assert "pay_floor" not in missing
