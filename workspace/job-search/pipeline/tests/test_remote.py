"""criteria.md v6.2 item 6: remote roles outside the configured home area are kept; on-site/hybrid elsewhere fails; LinkedIn filter is not proof."""

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

import os, sys, yaml
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import fitcheck as FC, sweep

BASE = {"want_reasons": ["x"], "reason": "a reason long enough", "must_haves": [{"need": "abc", "proof": "p"}]}

def test_out_of_area_must_fail_geo():
    assert FC.check({**BASE, "want": "pass", "win": "high", "remote_check": "out-of-area"})[1]
    r, err = FC.check({**BASE, "want": "fail", "dealbreakers": ["geo"], "remote_check": "out-of-area", "must_haves": []})
    assert not err and r.call == "Skip"

def test_unverified_and_remote_us_keep_the_call():
    for rc in ("unverified", "remote-region", "home-area"):
        r, err = FC.check({**BASE, "want": "pass", "win": "high", "remote_check": rc})
        assert not err and r.call == "Strong"

def test_linkedin_remote_filter_card_kept_not_dropped_for_city():
    cfg = yaml.safe_load(open(os.path.join(sweep.HERE, "sources.yaml")))
    cfg["geo"]["remote_us"] = [r"remote.*exampleland"]
    f = sweep.Filters(cfg)
    assert f.geo("Distant Example City (Remote filter)")[0] == "remote-unverified"
    assert f.geo("Distant Example City")[0] is None          # plain non-local city with no remote signal
    assert f.geo("Remote - Exampleland")[0] == "remote-region"
    cfg["geo"]["remote_filter_cards"] = "drop"
    assert sweep.Filters(cfg).geo("Distant Example City (Remote filter)")[0] is None
