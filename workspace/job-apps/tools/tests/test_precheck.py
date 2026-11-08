"""Precheck: assertions grouped by protected rule, not change date."""

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

import json, re, sys
from pathlib import Path
import pytest, yaml
import package_fixtures as F
TOOLS = F.TOOLS
import precheck
import reconcile_reviews as RR
import ats_check
from _cases import *

@pytest.mark.parametrize("text,scope,code", [('Sorted 17 sample cards by fictional tag.', 'eng', 'PASS'), ('Built a synthetic intake demonstration.', 'sol', 'PASS'), ('Used Python in a fictional card-sorting exercise.', 'sol', 'PASS'), ('Sorted 53 sample cards.', 'eng', 'CLAIM'), ('Sorted 17 sample cards with impossible certification.', 'eng', 'FORBID'), ('Claimed pretend omniscience.', 'sol', 'BANNED'), ('Claimed pretend omniscience.', 'ic', 'BANNED'), ('In 2043, sorted the cards.', 'eng', 'YEAR'), ('Performed a pretend orchard audit.', 'eng', 'SCOPE'), ('Performed a pretend orchard audit.', 'health', 'PASS'), ('A clearly fictional exercise.', 'eng', 'PASS')])
def test_stamp_check_claims_text(text, scope, code):
    rc, out = F.run(TOOLS / 'check_claims.py', '--text', text, '--scope', scope)
    if code == 'PASS':
        assert rc == 0, out
    else:
        assert rc == 1 and code in out, out

def test_stamp_bases_pass():
    bases = Path(str(_JOBBI_APPS / 'base-resumes'))
    names = ['tpm', 'eng-manager', 'solutions-fde-delivery', 'ic-builder']
    bodies = [(bases / b / 'resume-native.md').read_bytes() for b in names]
    assert all(body == bodies[0] for body in bodies), 'bundled bases diverged; check claims on each'
    rc, out = F.run(TOOLS / 'check_claims.py', bases / names[0])
    assert rc == 0, out

def test_stamp_gap_keyword_stuffing_is_overclaim(tmp_path):
    rc, out = stamp_gap(tmp_path, [dict(stamp_RUST, handling='omitted', reason='no Rust claim; left out')], edit=stamp_add_to_skills('Rust'), step6={'gaps': ['Rust systems programming'], 'blockers': []})
    assert rc == 1 and 'OVERCLAIM resume' in out, out

def test_stamp_blocker_must_be_flagged(tmp_path):
    b = {'item': 'Active TS/SCI clearance', 'kind': 'blocker', 'terms': ['TS/SCI'], 'reason': 'the user does not hold a clearance'}
    rc, out = stamp_gap(tmp_path, [dict(b, handling='omitted')], step6={'gaps': [], 'blockers': ['Active TS/SCI clearance']})
    assert rc == 1 and 'G-TAG' in out, out
    rc, out = stamp_gap(tmp_path / 'b', [dict(b, handling='blocker_flagged', decision='flagged_to_user')], final='PASS', step6={'gaps': [], 'blockers': ['Active TS/SCI clearance']})
    assert rc == 1 and 'cannot be stamped PASS' in out, out
    rc, out = stamp_gap(tmp_path / 'c', [dict(b, handling='blocker_flagged', decision='user_applies_anyway')], step6={'gaps': [], 'blockers': ['Active TS/SCI clearance']})
    assert rc == 1 and 'decision_ref' in out, out
    rc, out = stamp_gap(tmp_path / 'd', [dict(b, handling='blocker_flagged', decision='user_applies_anyway', decision_ref='SYNTHETIC APPROVAL REFERENCE; NOT REAL CONSENT')], step6={'gaps': [], 'blockers': ['Active TS/SCI clearance']})
    assert rc == 0, out

def test_stamp_cover_plan_sentence_allowed_only_with_cover_plan(tmp_path):

    def cov(d):
        p = d / 'cover.txt'
        p.write_text(p.read_text() + 'I would learn Rust for this fictional assignment.')
    e = dict(stamp_RUST, handling='omitted', reason='central to the JD; named only as a plan')
    rc, out = stamp_gap(tmp_path, [e], src=stamp_SRC_C, edit=cov)
    assert rc == 1 and 'OVERCLAIM cover' in out, out
    rc, out = stamp_gap(tmp_path / 'b', [dict(e, cover_plan=True)], src=stamp_SRC_C, edit=cov)
    assert rc == 0, out

def test_stamp_refuses_on_gap_overclaim(tmp_path):
    d = F.clone_stamp(tmp_path)
    x = stamp_rv(d)
    x['gap_handling'] = [dict(stamp_RUST, handling='omitted', reason='no Rust claim; left out')]
    stamp_put(d, x)
    stamp_add_to_skills('Rust')(d)
    rc, out = F.run(TOOLS / 'stamp_review.py', d, '--verify')
    assert rc == 1 and 'GAP OVERCLAIM' in out, out

def test_independent_precheck_catches_jd_copy(tmp_path):
    d = F.clone(tmp_path)
    line = next((l for l in (d / 'resume-native.md').read_text().splitlines() if l.startswith('- ') and len(l.split()) > 14))
    words = re.findall("[A-Za-z0-9']+", line)[2:12]
    (d / 'jd.md').write_text((d / 'jd.md').read_text() + '\n\nYou have ' + ' '.join(words) + '.\n')
    rc, out = F.run(TOOLS / 'precheck_spec.py', d)
    assert rc == 1 and 'JD-COPY' in out, out

def test_combined_precheck_live_copy_has_no_fail(tmp_path):
    d = F.copy_current(F.NOCOVER, tmp_path)
    r = precheck.run(d)
    assert r['schema'] == 'precheck-v1' and r['result'] in ('PASS', 'WARN') and (not r['fail']), r['fail']

@pytest.mark.parametrize('inject,needle', [('decades of platform work', 'decade'), ('built services in ExampleLang', 'ExampleLang')])
def test_combined_precheck_catches_banned_terms(tmp_path, inject, needle):
    d = F.copy_current(F.NOCOVER, tmp_path)
    F.edit_resume(d, lambda l: l.rstrip('.') + f', {inject}.')
    r = precheck.run(d)
    assert r['result'] == 'FAIL' and any((needle.lower() in f.lower() for f in r['fail'])), r['fail']

def test_combined_precheck_required_cover_missing_fails_and_unneeded_cover_warns(tmp_path):
    d = F.copy_current(F.NOCOVER, tmp_path)
    (d / 'form.json').write_text(json.dumps({'ats': 'ashby', 'cover_required': True}))
    for f in ('cover.txt', 'cover.pdf'):
        (d / f).unlink(missing_ok=True)
    r = precheck.run(d)
    assert r['result'] == 'FAIL' and any(('cover' in f.lower() for f in r['fail'])), r['fail']
    c = F.copy_current(F.COVER, tmp_path / 'c')
    (c / 'form.json').write_text(json.dumps({'ats': 'greenhouse', 'cover_required': False}))
    s = yaml.safe_load((c / 'package.yaml').read_text())
    s.pop('cover_required', None)
    (c / 'package.yaml').write_text(yaml.safe_dump(s, sort_keys=False))
    r = precheck.run(c)
    assert any(('do not upload' in w for w in r['warn'])), r['warn']

def test_precheck_fixed_title_and_dates_fail(tmp_path):
    d = F.copy_current(F.NOCOVER, tmp_path)
    p = d / 'resume-native.md'
    p.write_text(p.read_text().replace('Example Workshop, Project Contributor', 'Example Workshop, Unapproved Role').replace('*2097 – 2099', '*2043 – 2099'))
    r = precheck.run(d)
    assert any(('header' in f.lower() for f in r['fail'])) and any(('dates' in f.lower() for f in r['fail'])), r['fail']

def test_precheck_configured_selected_work_must_lead(tmp_path):
    d = F.copy_current(F.NOCOVER, tmp_path)
    p = d / 'resume-native.md'
    md = p.read_text()
    m = re.search('(?m)^## SELECTED WORK[^\\n]*\\n', md)
    assert m
    p.write_text(md[:m.end()] + '**Other project (2024).** Something.\n\n' + md[m.end():])
    assert any(('configured selected-work' in f for f in precheck.run(d)['fail']))

def test_precheck_form_placeholder_required_fail_optional_warn(tmp_path):
    d = F.copy_current(F.NOCOVER, tmp_path)
    r0 = d / 'README.md'
    r0.write_text(r0.read_text() + '\n- **REQUIRED Why us?:** [USER] approve the draft\n- **Optional Website:** [USER]\n- **REQUIRED Will you require sponsorship?:** Yes\n')
    r = precheck.run(d)
    assert any(("placeholder: 'Why us?" in f for f in r['fail'])) and any(('sponsorship' in f for f in r['fail']))
    assert any(('optional field' in w for w in r['warn'])) and (not any(('optional' in f for f in r['fail'])))

def test_jd_instructions_cannot_authorize_claims(tmp_path):
    """Contract: jd instructions cannot authorize claims."""
    case_tmp = tmp_path / '0'
    case_tmp.mkdir()
    d = F.clone_stamp(case_tmp)
    _, base_cc = F.run(TOOLS / 'check_claims.py', d, '--json')
    _, base_v = F.run(TOOLS / 'stamp_review.py', d, '--verify')
    (d / 'jd.md').write_text((d / 'jd.md').read_text() + stamp_INJ)
    rc_cc, cc = F.run(TOOLS / 'check_claims.py', d, '--json')
    rc_v, v = F.run(TOOLS / 'stamp_review.py', d, '--verify')
    assert rc_cc == 0 and json.loads(cc)['fails'] == json.loads(base_cc)['fails'] == []
    assert rc_v == 0 and 'VERIFIED' in v
    sys.path.insert(0, str(TOOLS))
    import ats_check
    k = stamp_lens(stamp_rv(d), 'ats')['keywords']
    assert ats_check.compute(d, k)['coverage'] == stamp_lens(stamp_rv(d), 'ats')['coverage']

def test_gap_inventory_must_be_complete(tmp_path):
    """Contract: gap inventory must be complete."""
    case_tmp = tmp_path / '0'
    case_tmp.mkdir()
    rc, out = stamp_gap(case_tmp, [dict(stamp_RUST, handling='omitted', reason='no Rust claim; left out')], step6={'gaps': ['Rust systems programming'], 'blockers': []})
    assert rc == 0, out
    case_tmp = tmp_path / '1'
    case_tmp.mkdir()
    rc, out = stamp_gap(case_tmp, [], step6={'gaps': ['Rust systems programming'], 'blockers': []})
    assert rc == 1 and 'G-MISSING' in out, out

def test_adjacent_evidence_cannot_license_missing_skills(tmp_path):
    """Contract: adjacent evidence cannot license missing skills."""
    case_tmp = tmp_path / '0'
    case_tmp.mkdir()
    rc, out = stamp_gap(case_tmp, [dict(stamp_RUST, handling='adjacent_shown', claim_id='example.rust_expert', shown_as='fictional intake helper', reason='systems work')])
    assert rc == 1 and 'G-CLAIM' in out, out
    case_tmp = tmp_path / '1'
    case_tmp.mkdir()
    rc, out = stamp_gap(case_tmp, [dict(stamp_RUST, handling='adjacent_shown', claim_id='example.intake', shown_as='fictional intake-label matching', reason='closest approved synthetic exercise: the fictional intake-label matching; Rust not demonstrated')], step6={'gaps': ['Rust systems programming'], 'blockers': []})
    assert rc == 0, out
    case_tmp = tmp_path / '2'
    case_tmp.mkdir()
    rc, out = stamp_gap(case_tmp, [dict(stamp_RUST, handling='adjacent_shown', claim_id='example.intake', shown_as='fictional intake-label matching', reason='closest approved synthetic exercise')], edit=stamp_add_to_skills('Rust'))
    assert rc == 1 and 'OVERCLAIM' in out, out

def test_spec_precheck_is_nonwriting_and_claims_gated(tmp_path):
    """Contract: spec precheck is nonwriting and claims gated."""
    case_tmp = tmp_path / '0'
    case_tmp.mkdir()
    rc, out = F.run(TOOLS / 'precheck_spec.py', F.clone(case_tmp))
    assert rc == 0 and 'CLAIMS' not in out and ('JD-COPY' not in out), out
    case_tmp = tmp_path / '1'
    case_tmp.mkdir()
    d = F.clone(case_tmp)
    p = d / 'package.yaml'
    t = p.read_text()
    assert '17 sample cards' in t
    p.write_text(t.replace('17 sample cards', '53 sample cards', 1))
    before = (d / 'resume-native.md').read_text()
    rc, out = F.run(TOOLS / 'precheck_spec.py', d)
    assert rc == 1 and 'CLAIMS' in out, out
    assert (d / 'resume-native.md').read_text() == before, 'precheck writes nothing'

def test_spec_precheck_catches_literal_and_paraphrase_overclaim(tmp_path):
    """Contract: spec precheck catches literal and paraphrase overclaim."""
    case_tmp = tmp_path / '0'
    case_tmp.mkdir()
    d = F.clone(case_tmp)
    import precheck_spec as P
    _, s6 = RR.job_of(d)
    rec = json.loads(Path(s6).read_text())
    gh = P.default_plan(rec)
    gh[0]['terms'] = ['Python']
    f = case_tmp / 'gh.json'
    f.write_text(json.dumps(gh))
    rc, out = F.run(TOOLS / 'precheck_spec.py', d, '--gap-handling', f)
    assert rc == 1 and 'OVERCLAIM' in out, out
    case_tmp = tmp_path / '1'
    case_tmp.mkdir()
    d = F.clone(case_tmp)
    import precheck_spec as P
    _, s6 = RR.job_of(d)
    rec = json.loads(Path(s6).read_text())
    gh = P.default_plan(rec)
    gh[0]['terms'] = ['ExampleStream']
    f = case_tmp / 'gh.json'
    f.write_text(json.dumps(gh))
    p = d / 'package.yaml'
    t = p.read_text()
    p.write_text(t.replace('17 sample cards', 'Invented an ExampleStream demonstration.', 1))
    rc, out = F.run(TOOLS / 'precheck_spec.py', d, '--gap-handling', f)
    assert rc == 1 and ('OVERCLAIM' in out or 'CLAIMS' in out), out

def test_readability_warnings_do_not_become_fact_failures(tmp_path):
    """Contract: readability warnings do not become fact failures."""
    case_tmp = tmp_path / '0'
    case_tmp.mkdir()
    d = F.copy_current(F.NOCOVER, case_tmp)
    p, L = precheck_bullets(d)
    j = precheck_exp_bullet(L)
    L[j] = L[j].rstrip('.') + ', ' + ' '.join(['and it kept working for every user team'] * 6) + '.'
    p.write_text('\n'.join(L) + '\n')
    r = precheck.run(d)
    assert not any(('words' in f for f in r['fail'])), r['fail']
    assert any(('SHAPE experience bullet' in w or 'READ experience bullet' in w for w in r['warn']))
    assert all((re.fullmatch('W-[0-9a-f]{6}', i) for i in r['info']['warn_ids']))
    case_tmp = tmp_path / '1'
    case_tmp.mkdir()
    d = F.copy_current(F.NOCOVER, case_tmp)
    p, L = precheck_bullets(d)
    j = precheck_exp_bullet(L)
    L.insert(j + 1, L[j])
    p.write_text('\n'.join(L) + '\n')
    r = precheck.run(d)
    assert any(('REPEAT duplicate' in w for w in r['warn'])) and (not any(('REPEAT' in f for f in r['fail'])))

def test_tracker_link_required_with_actionable_fix(tmp_path, monkeypatch):
    """Contract: tracker link required with actionable fix."""
    case_tmp = tmp_path / '0'
    case_tmp.mkdir()
    d = F.copy_current(F.NOCOVER, case_tmp)
    s = yaml.safe_load((d / 'package.yaml').read_text())
    s.pop('job_id', None)
    (d / 'package.yaml').write_text(yaml.safe_dump(s, sort_keys=False, allow_unicode=True))
    url = 'https://www.linkedin.com/jobs/view/900000000000000000002'
    r0 = d / 'README.md'
    r0.write_text(f'**URL:** https://jobs.ashbyhq.com/x/abc (LinkedIn {url})\n' + r0.read_text())
    monkeypatch.delenv('PRECHECK_NO_LINK', raising=False)
    monkeypatch.setenv('PRECHECK_DB', str(precheck__db(case_tmp, d, url, None)))
    r = precheck.run(d)
    f = [x for x in r['fail'] if x.startswith('LINK')]
    assert f and '--id 4242' in f[0] and (f'--package {d.resolve()}' in f[0]) and ('update_status.py' in f[0]), r['fail']
    monkeypatch.setenv('PRECHECK_DB', str(precheck__db(precheck__mk(case_tmp / 'linked'), d, url, str(d.resolve()))))
    assert not [x for x in precheck.run(d)['fail'] if x.startswith('LINK')]
    case_tmp = tmp_path / '1'
    case_tmp.mkdir()
    d = F.copy_current(F.NOCOVER, case_tmp)
    s = yaml.safe_load((d / 'package.yaml').read_text())
    s.pop('job_id', None)
    (d / 'package.yaml').write_text(yaml.safe_dump(s, sort_keys=False, allow_unicode=True))
    monkeypatch.delenv('PRECHECK_NO_LINK', raising=False)
    monkeypatch.setenv('PRECHECK_DB', str(precheck__db(case_tmp, d, 'https://nope.example/1', None)))
    assert any((x.startswith('LINK no job record') for x in precheck.run(d)['fail']))
