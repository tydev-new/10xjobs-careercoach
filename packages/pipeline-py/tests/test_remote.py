"""Remote roles outside the home area are kept; on-site/hybrid elsewhere fails; a job board's remote filter is not proof."""
import yaml

from pipeline import fitcheck as FC, sweep
from tests import helpers as T

BASE = {"want_reasons": ["x"], "reason": "a reason long enough", "must_haves": [{"need": "abc", "proof": "p"}]}


def test_out_of_area_must_fail_geo():
    assert FC.check({**BASE, "want": "pass", "win": "high", "remote_check": "out-of-area"})[1]
    r, err = FC.check({**BASE, "want": "fail", "dealbreakers": ["geo"], "remote_check": "out-of-area", "must_haves": []})
    assert not err and r.call == "Skip"


def test_unverified_local_and_remote_us_keep_the_call():
    for rc in ("unverified", "remote-us", "local"):
        r, err = FC.check({**BASE, "want": "pass", "win": "high", "remote_check": rc})
        assert not err and r.call == "Strong"
    assert FC.check({**BASE, "want": "pass", "win": "high", "remote_check": "bay"})[1], "personal area names are not an enum value"


def test_remote_filter_card_kept_not_dropped_for_city():
    cfg = yaml.safe_load((T.EXAMPLE / "sources.example.yaml").read_text())
    f = sweep.Filters(cfg)
    assert f.geo("Springfield")[0] == "local"
    assert f.geo("Houston, TX (Remote filter)")[0] == "remote-unverified"
    assert f.geo("Houston, TX")[0] is None
    assert f.geo("Remote - United States")[0] == "remote-us"
    assert f.geo("Remote - Canada")[0] is None
    cfg["geo"]["remote_filter_cards"] = "drop"
    assert sweep.Filters(cfg).geo("Houston, TX (Remote filter)")[0] is None
