"""Blockers: assertions grouped by protected rule, not change date."""

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

import sys
import pytest
import package_fixtures as F
import blockers
from _cases import *

def test_combined_blockers_synthetic_jd():
    out = blockers.check(combined_JD, location='Excluded Example City', pay='$90,000 - $100,000')
    rules = ' | '.join((o['rule'] for o in out if o['level'] == 'BLOCKER'))
    for k in ('ExampleLang', 'example-train', 'clearance', 'travel', 'pay'):
        assert k.lower() in rules.lower(), rules
    assert sum((o['level'] == 'BLOCKER' for o in out)) >= 5

def test_combined_blockers_preferred_only_is_warn():
    out = blockers.check('Nice to have: knowledge of ExampleLang and ExampleRuntime.\nRemote US.', location='Remote, US', pay='$250,000 - $300,000')
    assert not [o for o in out if o['level'] == 'BLOCKER'], out
    assert any((o['level'] == 'WARN' and 'ExampleLang' in o['rule'] for o in out)), out

@pytest.mark.parametrize('pay,blocked', [('$100,000 - $109,999', True), ('$100,000 - $110,000', False), ('$110,000 - $150,000', False)])
def test_pay_floor_is_configured_inclusive(pay, blocked):
    assert blockers.PAY_FLOOR == 110000
    assert pay_pay_blocked(pay) is blocked

def test_unknown_pay_does_not_invent_a_blocker():
    assert not pay_pay_blocked('')
