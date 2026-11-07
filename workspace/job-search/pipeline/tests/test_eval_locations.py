"""Regression coverage for unknown vs known geography in the offline eval kit."""

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

import importlib.util
from pathlib import Path


def load(name):
    path = Path(__file__).resolve().parents[1] / "evals" / (name + ".py")
    spec = importlib.util.spec_from_file_location("eval_" + name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_blank_location_keeps_call_and_marks_unverified():
    run = load("run")
    profile = {"resume": "python", "rules": {"locations_ok": ["example city"], "remote_us_ok": True, "skills": ["python"]}}
    case = {"posting": {"title": "Engineer", "location": "  ", "jd_text": "- python"}}
    output = run.rules_score(case, profile)
    assert output["want"] == "pass"
    assert output["remote_check"] == "unverified"
    assert "geo" not in output["dealbreakers"]
    assert "location unverified" in output["want_reasons"]
    result, error = run.FC.check(output)
    assert error is None
    assert result.call == "Strong"
    case["posting"]["location"] = "Distant Fictional Town (on-site)"
    output = run.rules_score(case, profile)
    assert output["want"] == "fail"
    assert output["dealbreakers"] == ["geo"]


def test_location_extraction_preserves_evidence_and_avoids_hq_guess(monkeypatch):
    builder = load("build_private")
    monkeypatch.setitem(builder._JOBBI_POLICY,"local_onsite_extract_regex",r"Example City hybrid")
    assert builder.extract_location("- **Location:** Example City (hybrid)")[0] == "Example City (hybrid)"
    assert builder.extract_location("**Geo:** Remote US")[0] == "Remote US"
    assert builder.extract_location("Company headquartered in Seattle; Python engineer.") == ("", "")
    assert builder.extract_location("No saved location") == ("", "")
    assert builder.extract_location("Strong; Example City hybrid; cash posted")[0] == "Example City hybrid"


def test_no_saved_requirements_are_accounted_as_gap():
    run = load("run")
    output = run.rules_score({"posting": {"title": "Engineer", "jd_text": ""}}, {"resume": "python"})
    result, error = run.FC.check(output)
    assert error is None
    assert run.FC.unaccounted_must_haves(result) == []


def test_country_only_location_is_not_verified_out_of_area():
    run = load("run")
    output = run.rules_score({"posting": {"title": "Engineer", "location": "United States", "jd_text": "- python"}}, {"resume": "python"})
    assert output["remote_check"] == "unverified"
    assert "geo" not in output["dealbreakers"]
