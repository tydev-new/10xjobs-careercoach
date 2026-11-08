"""Calibration: assertions grouped by protected rule, not change date."""

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

import json, subprocess, sys
import pytest
import package_fixtures as F
import run as R
from _cases import *

def test_calibration_compare_parse_pending():
    import compare as C
    got, missing = C.parse('1P 2F 4P', 4, allow_missing={3})
    assert got == {1: 'P', 2: 'F', 4: 'P'} and missing == []

@pytest.mark.extended
def test_saved_frozen_and_calibration_baselines():
    """Contract: saved frozen and calibration baselines."""
    rc, out = eval_ev('--check')
    assert rc == 0 and 'CHECK: PASS' in out, out
    r = subprocess.run([sys.executable, str(calibration_EV / 'run.py'), '--set', 'calibration', '--check'], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout[-1500:]

@pytest.mark.extended
def test_reviewer_catch_rate_distinguishes_good_from_missed_findings(tmp_path):
    """Contract: reviewer catch rate distinguishes good from missed findings."""
    case_tmp = tmp_path / '0'
    case_tmp.mkdir()
    rc, out = eval_ev('--backend', 'file', '--outputs', str(eval_outputs(case_tmp, good=False)), '--json')
    m = json.loads(out)['metrics']
    assert m['false_pass'] == 0 and m['reviewer_catch_rate'] == 0.0
    rc, out = eval_ev('--backend', 'file', '--outputs', str(case_tmp), '--check')
    assert rc == 1
    case_tmp = tmp_path / '1'
    case_tmp.mkdir()
    rc, out = eval_ev('--backend', 'file', '--outputs', str(eval_outputs(case_tmp, good=True)), '--json')
    m = json.loads(out)['metrics']
    assert m['agreement'] == 1.0 and m['false_pass'] == 0 and (m['reviewer_catch_rate'] == 1.0), m

def test_writing_and_fit_axes_do_not_conflate_blockers():
    """Contract: writing and fit axes do not conflate blockers."""
    assert R.classify("ATS copied JD run of 11 words: 'x'") == 'writing'
    assert R.classify('ATS coverage 70% < 85%') == 'fit'
    assert R.classify("GAP G-TAG blocker 'x' tagged omitted") == 'fit'
    assert R.classify('GAP OVERCLAIM resume implies gap') == 'writing'
    assert R.classify('CLAIMS check_claims FAILS now:') == 'writing'
    assert R.classify('ATS coverage: review says 0.8, recomputed 0.7') == 'integrity'
    rv = {'lenses': [{'lens': 'recruiter', 'verdict': 'Pass'}, {'lens': 'age_signal_claims', 'verdict': 'Pass'}, {'lens': 'hiring_manager', 'verdict': 'Pass'}, {'lens': 'ats', 'verdict': 'Pass'}], 'gap_handling': [{'handling': 'blocker_flagged', 'decision': 'flagged_to_user'}]}
    assert R.reviewer_axes(rv) == {'writing': 'PASS', 'fit': 'FAIL'}
    rv['gap_handling'][0]['decision'] = 'user_applies_anyway'
    assert R.reviewer_axes(rv)['fit'] == 'PASS'
    assert R.axes(rv, ['SCHEMA bad']) == {'writing': 'FAIL', 'fit': 'FAIL'}
