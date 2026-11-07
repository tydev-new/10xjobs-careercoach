"""One shared scoring prompt; code-only check d (every must-have proven or listed in gaps)."""

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

import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "evals"))
import fitcheck as FC
import run as EV

BASE = {"want": "pass", "want_reasons": ["ok"], "win": "medium", "reason": "a reason long enough"}

def test_one_prompt_file_shared_by_live_and_evals():
    assert os.path.basename(FC.PROMPT_PATH) == "scoring-prompt.md" and os.path.exists(FC.PROMPT_PATH)
    assert not os.path.exists(os.path.join(os.path.dirname(EV.HERE), "evals", "prompt.md"))
    case = {"posting": {"company": "Acme", "title": "TPM", "location": "Remote", "pay": "$1", "jd_text": "JD BODY"}}
    out = EV.build_prompt(case, {"criteria": "CRIT", "resume": "RES"})
    assert out == FC.render_prompt("CRIT", "RES", case["posting"])
    assert "CRIT" in out and "RES" in out and "JD BODY" in out and "{criteria}" not in out

def test_unproven_must_have_needs_a_gap():
    r, _ = FC.check({**BASE, "must_haves": [{"need": "Rust in production", "proof": None}, {"need": "led teams", "proof": "synthetic leader proof"}], "gaps": []})
    assert FC.unaccounted_must_haves(r) == ["Rust in production"]
    r, _ = FC.check({**BASE, "must_haves": [{"need": "Rust in production", "proof": ""}], "gaps": ["Rust in production (none on resume)"]})
    assert FC.unaccounted_must_haves(r) == []
    r, _ = FC.check({**BASE, "must_haves": [{"need": "Active licence", "proof": None}], "blockers": ["active licence"]})
    assert FC.unaccounted_must_haves(r) == []
