"""Review: assertions grouped by protected rule, not change date."""

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

import json, os, re, sqlite3, sys
import pytest, yaml
import package_fixtures as F
TOOLS = F.TOOLS
import wording_check as WC
import finalize_review as FR, reconcile_reviews as RR
import builder_feedback as BF, ats_check
from _cases import *

def test_legacy_stamp_schema_contract(tmp_path):
    """stamp refuse old lens name; stamp refuse missing lens; stamp refuse missing cover lens."""
    case_tmp = tmp_path / '0-stamp_refuse_old_lens_name'
    case_tmp.mkdir()
    stamp_refuse(case_tmp, lambda x: stamp_lens(x, 'age_signal_claims').update(lens='Claim accuracy'), 'SCHEMA')
    case_tmp = tmp_path / '1-stamp_refuse_missing_lens'
    case_tmp.mkdir()
    stamp_refuse(case_tmp, lambda x: x.update(lenses=[l for l in x['lenses'] if l['lens'] != 'recruiter']), 'SCHEMA')

    def dup(x):
        x['lenses'] = [l for l in x['lenses'] if l['lens'] != 'recruiter'] + [dict(stamp_lens(x, 'hiring_manager'))]
    stamp_refuse(case_tmp / 'b', dup, 'LENS recruiter')
    case_tmp = tmp_path / '2-stamp_refuse_missing_cover_lens'
    case_tmp.mkdir()
    stamp_refuse(case_tmp, lambda x: x.update(lenses=[l for l in x['lenses'] if not (l['lens'] == 'ats' and l['doc'] == 'cover')]), 'LENS ats on cover', src=stamp_SRC_C)

def test_legacy_stamp_version_and_round_contract(tmp_path):
    """stamp refuse round3; stamp refuse stale lint; stamp refuse stale claims."""
    case_tmp = tmp_path / '0-stamp_refuse_round3'
    case_tmp.mkdir()
    stamp_refuse(case_tmp, lambda x: x.update(round=3), 'ROUND 3')
    case_tmp = tmp_path / '1-stamp_refuse_stale_lint'
    case_tmp.mkdir()
    stamp_refuse(case_tmp, lambda x: x.update(lint_version='format-lint 2099-01-01b'), 'LINT')
    case_tmp = tmp_path / '2-stamp_refuse_stale_claims'
    case_tmp.mkdir()
    stamp_refuse(case_tmp, lambda x: x.update(claims_version='claims-2099-01-01'), 'CLAIMS')

def test_legacy_stamp_ats_integrity_contract(tmp_path):
    """stamp refuse misreported hit; stamp refuse low coverage; stamp refuse too few keywords."""
    case_tmp = tmp_path / '0-stamp_refuse_misreported_hit'
    case_tmp.mkdir()

    def m(x):
        a = stamp_lens(x, 'ats')
        a['keywords'][0]['hit'] = not a['keywords'][0]['hit']
    stamp_refuse(case_tmp, m, 'ATS keyword')
    case_tmp = tmp_path / '1-stamp_refuse_low_coverage'
    case_tmp.mkdir()

    def m(x):
        a = stamp_lens(x, 'ats')
        for k in a['keywords'][3:7]:
            k.update(term=f"zzqx{k['term'][:3]}", aliases=[], hit=False)
        a['coverage'] = 0.5
    stamp_refuse(case_tmp, m, 'ATS coverage 50% < 85%')
    case_tmp = tmp_path / '2-stamp_refuse_too_few_keywords'
    case_tmp.mkdir()

    def m(x):
        a = stamp_lens(x, 'ats')
        a['keywords'] = a['keywords'][:5]
    stamp_refuse(case_tmp, m, '8-12')

def test_legacy_stamp_rechecks_content_contract(tmp_path):
    """stamp refuse claims fail now."""
    case_tmp = tmp_path / '0-stamp_refuse_claims_fail_now'
    case_tmp.mkdir()
    d = F.clone_stamp(case_tmp)
    p = d / 'resume-native.md'
    p.write_text(p.read_text().replace('17 sample cards', '53 sample cards', 1))
    rc, out = F.run(TOOLS / 'stamp_review.py', d, '--verify')
    assert rc == 1 and 'CLAIMS check_claims FAILS' in out, out

def test_reconcile_independence_contract(tmp_path):
    """independent duplicate run ids; independent builder run cannot review; independent builder run must be recorded."""
    case_tmp = tmp_path / '0-independent_duplicate_run_ids'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp), ids={l: 'same-run-123' if l in ('ats', 'recruiter') else f'{l}-x1' for l in RR.LENSES})
    independent_refuse(d, 'not distinct')
    case_tmp = tmp_path / '1-independent_builder_run_cannot_review'
    case_tmp.mkdir()
    ids = {l: f'{l}-r1' for l in RR.LENSES}
    ids['hiring_manager'] = 'build-test-run-1'
    independent_refuse(F.lensify(F.clone(case_tmp), ids=ids), 'reviewed by builder run')
    case_tmp = tmp_path / '2-independent_builder_run_must_be_recorded'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp), builder=None)
    spec = yaml.safe_load((d / 'package.yaml').read_text())
    spec['builder_runs'] = []  # explicitly remove generated build history for this negative case
    (d / 'package.yaml').write_text(yaml.safe_dump(spec, sort_keys=False))
    independent_refuse(d, 'BUILDER')

def test_reconcile_review_identity_contract(tmp_path):
    """independent rubric versions must match; independent lens must name its own lens and package; independent findings need evidence; independent cover lens required when attached."""
    case_tmp = tmp_path / '0-independent_rubric_versions_must_match'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp))
    x = F.read_lens(d, 'ats')
    x['rubric_version'] = 'apply-rubric-2099-01-01'
    F.write_lens(d, 'ats', x)
    independent_refuse(d, 'different rubric versions')
    case_tmp = tmp_path / '1-independent_lens_must_name_its_own_lens_and_package'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp))
    x = F.read_lens(d, 'ats')
    x['package'] = 'some-other-pkg'
    F.write_lens(d, 'ats', x)
    independent_refuse(d, 'PACKAGE')
    case_tmp = tmp_path / '2-independent_findings_need_evidence'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp))
    x = F.read_lens(d, 'recruiter')
    del x['findings'][0]['evidence']
    F.write_lens(d, 'recruiter', x)
    independent_refuse(d, 'SCHEMA')
    case_tmp = tmp_path / '3-independent_cover_lens_required_when_attached'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp, independent_COVER))
    x = F.read_lens(d, 'recruiter')
    x['docs'] = [y for y in x['docs'] if y['doc'] == 'resume']
    F.write_lens(d, 'recruiter', x)
    independent_refuse(d, 'DOCS recruiter')

def test_legacy_stamp_verdict_and_compatibility_contract(tmp_path):
    """stamp good review verifies; independent stamp refuses single pass pass; independent legacy verify still passes with warning; independent single pass revise still stamps; stamp revise is stamped not pass; stamp refuse lens not pass; stamp refuse missing review."""
    case_tmp = tmp_path / '0-stamp_good_review_verifies'
    case_tmp.mkdir()
    d = F.clone_stamp(case_tmp)
    rc, out = F.run(TOOLS / 'stamp_review.py', d, '--verify')
    assert rc == 0 and 'VERIFIED' in out, out
    case_tmp = tmp_path / '1-independent_stamp_refuses_single_pass_pass'
    case_tmp.mkdir()
    d = F.clone(case_tmp)
    before = (d / 'README.md').read_text()
    rc, out = F.run(TOOLS / 'stamp_review.py', d, env=F.tenv(case_tmp))
    assert rc == 1 and 'INDEPENDENT' in out and ('single-pass' in out), out
    assert (d / 'README.md').read_text() == before
    case_tmp = tmp_path / '2-independent_legacy_verify_still_passes_with_warning'
    case_tmp.mkdir()
    rc, out = F.run(TOOLS / 'stamp_review.py', F.clone(case_tmp), '--verify')
    assert rc == 0 and 'VERIFIED' in out and ('LEGACY single-pass' in out), out
    case_tmp = tmp_path / '3-independent_single_pass_revise_still_stamps'
    case_tmp.mkdir()
    d = F.clone(case_tmp)
    rv = json.loads((d / 'review.json').read_text())
    rv['final'] = 'REVISE'
    rv['lenses'][0]['verdict'] = 'Revise'
    (d / 'review.json').write_text(json.dumps(rv))
    rc, out = F.run(TOOLS / 'stamp_review.py', d, env=F.tenv(case_tmp))
    assert rc == 2, out
    case_tmp = tmp_path / '4-stamp_revise_is_stamped_not_pass'
    case_tmp.mkdir()
    d = F.clone_stamp(case_tmp)
    x = F.read_lens(d, 'hiring_manager')
    x['verdict'] = 'REVISE'
    x['docs'][0]['verdict'] = 'REVISE'
    F.write_lens(d, 'hiring_manager', x)
    rc, out = F.run(TOOLS / 'reconcile_reviews.py', d)
    assert rc == 0, out
    rc, out = F.run(TOOLS / 'stamp_review.py', d)
    assert rc == 2 and '4-lens: REVISE' in (d / 'README.md').read_text()
    case_tmp = tmp_path / '5-stamp_refuse_lens_not_pass'
    case_tmp.mkdir()
    stamp_refuse(case_tmp, lambda x: stamp_lens(x, 'hiring_manager').update(verdict='Revise'), 'VERDICT')
    case_tmp = tmp_path / '6-stamp_refuse_missing_review'
    case_tmp.mkdir()
    d = F.clone_stamp(case_tmp)
    (d / 'review.json').unlink()
    rc, out = F.run(TOOLS / 'stamp_review.py', d)
    assert rc == 1 and 'missing' in out

def test_recorded_reviews_are_immutable(tmp_path):
    """independent hand edited reconciled review refused; independent lens file changed after reconcile refused; independent resume changed after reconcile refused; format verify rejects changes after finalize; format verify rejects old reconcile and single pass."""
    case_tmp = tmp_path / '0-independent_hand_edited_reconciled_review_refused'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp))
    x = F.read_lens(d, 'ats')
    x['verdict'] = 'REVISE'
    x['docs'][0]['verdict'] = 'REVISE'
    F.write_lens(d, 'ats', x)
    F.run(TOOLS / 'reconcile_reviews.py', d)
    rv = json.loads((d / 'review.json').read_text())
    rv['final'] = 'PASS'
    for e in rv['lenses']:
        e['verdict'] = 'Pass'
    (d / 'review.json').write_text(json.dumps(rv))
    rc, out = F.run(TOOLS / 'stamp_review.py', d, env=F.tenv(case_tmp))
    assert rc == 1 and 'INDEPENDENT' in out and ('differs' in out), out
    case_tmp = tmp_path / '1-independent_lens_file_changed_after_reconcile_refused'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp))
    F.run(TOOLS / 'reconcile_reviews.py', d)
    x = F.read_lens(d, 'recruiter')
    x['reviewer_run_id'] = 'recruiter-swapped-9'
    F.write_lens(d, 'recruiter', x)
    rc, out = F.run(TOOLS / 'stamp_review.py', d, '--verify')
    assert rc == 1 and 'changed after reconcile' in out, out
    case_tmp = tmp_path / '2-independent_resume_changed_after_reconcile_refused'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp))
    F.run(TOOLS / 'reconcile_reviews.py', d)
    p = d / 'resume-native.md'
    p.write_text(p.read_text() + '\n')
    rc, out = F.run(TOOLS / 'stamp_review.py', d, '--verify')
    assert rc == 1 and 'STALE' in out, out
    case_tmp = tmp_path / '3-format_verify_rejects_changes_after_finalize'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp))
    F.run(TOOLS / 'finalize_review.py', d, env=F.tenv(case_tmp))
    x = F.read_lens(d, 'recruiter')
    x['reviewer_run_id'] = 'recruiter-swapped-9'
    F.write_lens(d, 'recruiter', x)
    rc, out = F.run(TOOLS / 'finalize_review.py', d, '--verify')
    assert rc == 1 and 'changed' in out, out
    case_tmp = tmp_path / '4-format_verify_rejects_old_reconcile_and_single_pass'
    case_tmp.mkdir()
    rc, out = F.run(TOOLS / 'finalize_review.py', F.clone(case_tmp), '--verify')
    assert rc == 1 and 'not recorded by finalize_review.py' in out, out
    d = F.lensify(F.clone(case_tmp / 'r'))
    F.run(TOOLS / 'reconcile_reviews.py', d)
    rc, out = F.run(TOOLS / 'finalize_review.py', d, '--verify')
    assert rc == 1 and 'not recorded by finalize_review.py' in out, out

def test_legacy_reconcile_missing_or_stale_input(tmp_path):
    """independent missing lens; independent stale review after edit."""
    case_tmp = tmp_path / '0-independent_missing_lens'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp))
    (d / 'reviews' / 'recruiter.json').unlink()
    independent_refuse(d, 'MISSING reviews/recruiter.json')
    case_tmp = tmp_path / '1-independent_stale_review_after_edit'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp))
    p = d / 'resume-native.md'
    p.write_text(p.read_text() + '\n')
    independent_refuse(d, 'STALE')

def test_combined_review_identity_and_freshness(tmp_path):
    """combined combined verdict must be worst; combined combined builder run refused; combined combined stale refused."""
    case_tmp = tmp_path / '0-combined_combined_verdict_must_be_worst'
    case_tmp.mkdir()
    d = F.copy_current(F.COVER, case_tmp)
    c = F.combine(d)
    c['angles']['recruiter']['verdict'] = 'REVISE'
    F.write_combined(d, c)
    rc, out = F.finalize(d, case_tmp)
    assert rc != 0 and 'VERDICT' in out, out
    assert not (d / 'review.json').read_text().count('"mode": "combined"')
    case_tmp = tmp_path / '1-combined_combined_builder_run_refused'
    case_tmp.mkdir()
    d = F.copy_current(F.COVER, case_tmp)
    built = yaml.safe_load((d / 'package.yaml').read_text())['builder_runs'][0]
    F.combine(d, run_id=built)
    rc, out = F.finalize(d, case_tmp)
    assert rc != 0 and 'builder run' in out, out
    case_tmp = tmp_path / '2-combined_combined_stale_refused'
    case_tmp.mkdir()
    d = F.copy_current(F.COVER, case_tmp)
    F.combine(d)
    F.edit_resume(d, lambda l: l.replace(' the ', ' this ', 1))
    rc, out = F.finalize(d, case_tmp)
    assert rc != 0 and 'STALE' in out, out

def test_required_combined_review_fields(tmp_path):
    """Required semantic fields and their schema enums cannot be omitted/faked."""
    from copy import deepcopy
    d, base = F.combined(tmp_path)
    for field, replacement, expected in [('best_candidate', None, 'no best_candidate'), ('rejection_reasons', None, 'no rejection_reasons'), ('best_candidate', 'invalid_enum', 'best_candidate'), ('rejection_reasons', [], 'SCHEMA'), ('rejection_reasons', [{'reason': 'x' * 10, 'outcome': 'maybe'}], 'SCHEMA')]:
        c = deepcopy(base)
        if replacement is None:
            c.pop(field)
        elif replacement == 'invalid_enum':
            c[field][0]['on_resume'] = 'maybe'
        else:
            c[field] = replacement
        F.write_combined(d, c)
        rv, errors = FR.finalize(d)
        assert rv is None and any((expected in e for e in errors)), (field, errors)

def test_best_candidate_truth_and_visibility(tmp_path):
    """Top proof must be visible, repairable, and backed by approved claims."""
    from copy import deepcopy
    d, base = F.combined(tmp_path)
    L, mode = F.load(d)
    assert not FR.best_candidate(L, mode)
    cases = [(0, {'on_resume': 'missing', 'suggested_line': 'Built the synthetic intake helper.'}, 'cannot be PASS', False), (1, {'on_resume': 'buried', 'suggested_line': None}, 'no suggested_line', True), (2, {'proof_claim_ids': ['example.unapproved']}, 'unconfirmed', False)]
    for index, change, expected, revise in cases:
        c = deepcopy(base)
        c['best_candidate'][index].update(change)
        if revise:
            c['angles']['hiring_manager']['verdict'] = 'REVISE'
            c['docs'][0]['verdict'] = 'REVISE'
            c['verdict'] = 'REVISE'
        F.write_combined(d, c)
        L, mode = F.load(d)
        errors = FR.best_candidate(L, mode)
        assert any((expected in e for e in errors)), errors
        if revise:
            assert not any(('cannot be PASS' in e for e in errors))
        if change.get('on_resume') == 'missing':
            assert c['angles']['hiring_manager']['verdict'] == 'PASS'
            rv, errors = FR.finalize(d)
            assert rv is None and any(('cannot be PASS' in e for e in errors))

def test_rejection_reason_evidence_contract(tmp_path):
    """A claimed fix needs approved proof and text; dismissal needs rationale."""
    d, c = F.combined(tmp_path)
    for reason, expected in [({'reason': 'No cost-savings proof', 'outcome': 'fixed', 'proof_claim_ids': ['example.unapproved'], 'suggested_line': 'Sorted 53 sample cards.'}, 'unapproved'), ({'reason': 'No hands-on stack shown', 'outcome': 'fixed', 'proof_claim_ids': ['example.stack']}, 'suggested_line'), ({'reason': 'No fintech production work', 'outcome': 'cant_fix'}, 'question_for_user or screen_out_note'), ({'reason': 'Role asks for a different scope', 'outcome': 'not_a_risk'}, 'reason_not_risk')]:
        c['rejection_reasons'] = [reason]
        F.write_combined(d, c)
        rv, errors = FR.finalize(d)
        assert rv is None and any((expected in e for e in errors)), errors

def test_rejection_builder_round_and_feedback(tmp_path):
    """An unapplied repair becomes REVISE; applied repairs do not loop forever."""
    d, c = F.combined(tmp_path)
    line = 'Used Python in a fictional card-sorting exercise.'
    c['rejection_reasons'] = [{'reason': 'Stack not visible up top', 'outcome': 'fixed', 'proof_claim_ids': ['example.stack'], 'suggested_line': line}]
    F.write_combined(d, c)
    rv, errors = FR.finalize(d)
    assert not errors and rv['final'] == 'REVISE'
    assert rv['builder_round'][0]['line'] == line and any((e.startswith('REJECTION') for e in rv['edits']))
    feedback = BF.collect(d)
    assert feedback['lines'] and feedback['lines'][0]['source'] == 'rejection_reasons'
    existing = next((l[2:] for l in (d / 'resume-native.md').read_text().splitlines() if l.startswith('- ') and len(l) > 60))
    c['rejection_reasons'][0]['suggested_line'] = existing
    F.write_combined(d, c)
    rv, errors = FR.finalize(d)
    assert not errors and rv['final'] == 'PASS' and (not rv.get('builder_round'))
    c['best_candidate'][0].update(on_resume='understated', suggested_line='Used the toy card-sorting helper with Python.')
    F.write_combined(d, c)
    feedback = BF.collect(d)
    assert any((x['source'] == 'best_candidate' and 'toy card-sorting' in x['line'] for x in feedback['lines']))

def test_cant_fix_holds_until_explicit_ack(tmp_path):
    """Both question and screen-out-note forms hold; only --hold-ok clears verify."""
    question = 'Has the user run this in production at a fintech? Confirm before applying.'
    d, c = F.combined(tmp_path, rr=[{'reason': 'No fintech production work', 'outcome': 'cant_fix', 'question_for_user': question}])
    rv, errors = FR.finalize(d)
    assert not errors and rv['holds_for_user'][0]['question_for_user'] == question and ('holds_ack' not in rv)
    rv, errors = FR.finalize(d, hold_ok='Test approval fixture')
    assert not errors and rv['holds_ack'] == 'Test approval fixture'
    c['rejection_reasons'][0].pop('question_for_user')
    c['rejection_reasons'][0]['screen_out_note'] = 'Likely screened on domain; apply anyway?'
    F.write_combined(d, c)
    rc, out = F.finalize(d, tmp_path)
    assert rc == 0 and 'HOLD for the user' in out, out
    rc, out = F.finalize(d, tmp_path, '--verify')
    assert rc == 1 and 'HOLD for the user' in out, out

def test_round_three_and_later_approval_contract(tmp_path):
    """combined round3 wording only recorded without user; combined round3 new number needs user; combined round4 always needs user."""
    case_tmp = tmp_path / '0-combined_round3_wording_only_recorded_without_user'
    case_tmp.mkdir()
    d = combined_round3(case_tmp, lambda l: l.replace(' the ', ' this ', 1))
    assert WC.check(d, before_round=3)['wording_only']
    rc, out = F.finalize(d, case_tmp)
    assert rc == 0 and 'RECORDED' in out, out
    assert any(('wording-only' in e for e in json.loads((d / 'review.json').read_text())['edits']))
    case_tmp = tmp_path / '1-combined_round3_new_number_needs_user'
    case_tmp.mkdir()
    d = combined_round3(case_tmp, lambda l: l.rstrip('.') + ' across 7 teams.')
    rc, out = F.finalize(d, case_tmp)
    assert rc != 0 and 'ROUND' in out and ('new number' in out), out
    rc, out = F.finalize(d, case_tmp, '--user-ok', 'SYNTHETIC APPROVAL REFERENCE; NOT REAL CONSENT')
    assert 'RECORDED' in out and 'approved by the user' in out, out
    rv = json.loads((d / 'review.json').read_text())
    assert rv['final'] == 'FAIL' and (not rv['gates']['claims']['ok'])
    case_tmp = tmp_path / '2-combined_round4_always_needs_user'
    case_tmp.mkdir()
    d = F.copy_current(F.COVER, case_tmp)
    F.combine(d, rnd=4)
    rc, out = F.finalize(d, case_tmp)
    assert rc != 0 and 'ROUND' in out, out

def test_review_queue_excludes_other_reviewers_inputs(tmp_path):
    """independent review queue hashes and inputs; combined review queue shows combined; independent review queue lists today."""
    case_tmp = tmp_path / '0-independent_review_queue_hashes_and_inputs'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp, independent_COVER))
    rc, out = F.run(TOOLS / 'review_queue.py', '--hashes', d)
    h = json.loads(out)
    assert h['reviewed_files_sha256'] == RR.file_hashes(d) and h['builder_runs'] == RR.builder_runs(d) and (h['cover'] == 'attached')
    rc, out = F.run(TOOLS / 'review_queue.py', '--inputs', d)
    inp = json.loads(out)
    assert any(Path(f).parent.name == 'jd-analysis' and json.loads(Path(f).read_text()).get('schema') == 'step6-v1' for f in inp['files']), inp
    assert not any(('review.json' in f or '/reviews/' in f for f in inp['files'])), "reviewers never get other lenses' verdicts"
    case_tmp = tmp_path / '1-combined_review_queue_shows_combined'
    case_tmp.mkdir()
    d = F.copy_current(F.COVER, case_tmp)
    F.combine(d)
    import review_queue as RQ
    st = RQ.combined_status(d, FR.RR.cover_mode(d))
    assert st.startswith('PASS by combined-test-run-1'), st
    rc, out = F.run(TOOLS / 'review_queue.py', '--hashes', d)
    assert rc == 0 and 'resume-native.md' in out, out
    rc, out = F.run(TOOLS / 'review_queue.py', '--date', '2099-01-01', '--json', '--all')
    rows = json.loads(out)
    names = {r['name'] for r in rows}
    assert {'fixture-nocover-a', 'fixture-cover-a'} <= names
    assert all((set(r['lenses']) == set(RR.LENSES) for r in rows))

def test_legacy_finalize_uses_kept_not_dropped_gates(tmp_path):
    """format finalize does not rerun dropped checks; format kept gate failure records fail."""
    case_tmp = tmp_path / '0-format_finalize_does_not_rerun_dropped_checks'
    case_tmp.mkdir()
    'coverage under 85% and a gap_check overclaim no longer refuse or change the verdict; the lenses judge them.'
    d = F.lensify(F.clone(case_tmp))
    a = F.read_lens(d, 'ats')
    a['keywords'] = a['keywords'] + [{'term': 'zzz-unmatched-term-1', 'aliases': []}, {'term': 'zzz-unmatched-term-2', 'aliases': []}, {'term': 'zzz-unmatched-term-3', 'aliases': []}]
    a['keywords'] = a['keywords'][:12]
    F.write_lens(d, 'ats', a)
    g = F.read_lens(d, 'age_signal_claims')
    if g.get('gap_handling'):
        g['gap_handling'][0]['terms'] = ['TypeScript']
    F.write_lens(d, 'age_signal_claims', g)
    rc, out = F.run(TOOLS / 'finalize_review.py', d, env=F.tenv(case_tmp))
    assert rc == 0 and '4-lens: PASS' in out, out
    case_tmp = tmp_path / '1-format_kept_gate_failure_records_fail'
    case_tmp.mkdir()
    d = F.lensify(F.clone(case_tmp))
    line = next((l for l in (d / 'resume-native.md').read_text().splitlines() if l.startswith('- ') and len(l.split()) > 14))
    (d / 'jd.md').write_text((d / 'jd.md').read_text() + '\n\nYou have ' + ' '.join(re.findall("[A-Za-z0-9']+", line)[2:12]) + '.\n')
    rc, out = F.run(TOOLS / 'finalize_review.py', d, env=F.tenv(case_tmp))
    assert rc == 2 and 'jd_copy FAIL' in out, out
    rv = json.loads((d / 'review.json').read_text())
    assert rv['final'] == 'FAIL' and (not rv['gates']['jd_copy']['ok'])

@pytest.mark.parametrize('src', [independent_NOCOVER, independent_COVER])
def test_independent_reconcile_then_stamp_pass(tmp_path, src):
    d = F.lensify(F.clone(tmp_path, src))
    rc, out = F.run(TOOLS / 'reconcile_reviews.py', d)
    assert rc == 0 and 'RECONCILED' in out, out
    rv = json.loads((d / 'review.json').read_text())
    assert rv['reconciled']['tool'] == 'reconcile_reviews.py' and set(rv['reconciled']['lenses']) == set(RR.LENSES)
    assert rv['reconciled']['builder_run_ids'] == RR.builder_runs(d) and rv['final'] == 'PASS'
    assert (d / 'review.json.bak-reconcile').exists()
    rc, out = F.run(TOOLS / 'stamp_review.py', d, env=F.tenv(tmp_path))
    assert rc == 0 and 'STAMPED' in out, out
    rc, out = F.run(TOOLS / 'stamp_review.py', d, '--verify')
    assert rc == 0 and 'LEGACY' not in out, out
    rc, out = F.run(TOOLS / 'reconcile_reviews.py', d, '--check')
    assert rc == 0, out
    row = sqlite3.connect(tmp_path / 't.db').execute('select base,cover_format,verdict,rubric_version from package_runs').fetchone()
    import stamp_review as SR
    assert row == ('ic-builder' if src == independent_NOCOVER else 'tpm', 'none' if src == independent_NOCOVER else 'bullets', 'PASS', SR.RUBRIC_VERSION)
    a = next((e for e in rv['lenses'] if e['lens'] == 'ats' and e['doc'] == 'resume'))
    assert a['coverage'] == ats_check.compute(d, a['keywords'])['coverage']
    env = {k: v for k, v in os.environ.items() if k != 'STAMP_REVIEW_DB'}
    rc, out = F.run(TOOLS / 'stamp_review.py', d, env=env)
    assert rc == 0 and 'package_runs: skipped' in out, out

def test_independent_worst_verdict_wins_and_findings_kept(tmp_path):
    d = F.lensify(F.clone(tmp_path))
    x = F.read_lens(d, 'ats')
    x['verdict'] = 'REVISE'
    x['docs'][0]['verdict'] = 'REVISE'
    x['findings'].append({'doc': 'resume', 'severity': 'revise', 'finding': '6-word JD copy run in SUMMARY', 'evidence': 'quoted run'})
    F.write_lens(d, 'ats', x)
    n = sum((len(F.read_lens(d, l)['findings']) for l in RR.LENSES))
    rc, out = F.run(TOOLS / 'reconcile_reviews.py', d)
    assert rc == 0, out
    rv = json.loads((d / 'review.json').read_text())
    assert rv['final'] == 'REVISE' and next((e for e in rv['lenses'] if e['lens'] == 'ats'))['verdict'] == 'Revise'
    kept = sum((len(e['reasons']) - 1 for e in rv['lenses']))
    assert kept == n and any(('6-word JD copy run' in r for e in rv['lenses'] for r in e['reasons']))
    rc, out = F.run(TOOLS / 'stamp_review.py', d, env=F.tenv(tmp_path))
    assert rc == 2 and '4-lens: REVISE' in (d / 'README.md').read_text()

def test_format_finalize_pass_records_and_verifies(tmp_path):
    d = F.lensify(F.clone(tmp_path, format_COVER))
    rc, out = F.run(TOOLS / 'finalize_review.py', d, env=F.tenv(tmp_path))
    assert rc == 0 and 'RECORDED' in out and ('4-lens: PASS' in out), out
    rv = json.loads((d / 'review.json').read_text())
    assert rv['reconciled']['tool'] == 'finalize_review.py' and all((g['ok'] for g in rv['gates'].values()))
    assert '4-lens: PASS' in (d / 'README.md').read_text() and 'Code gates (finalize_review.py)' in (d / 'review-3lens.md').read_text()
    assert sqlite3.connect(tmp_path / 't.db').execute('select verdict from package_runs').fetchone() == ('PASS',)
    rc, out = F.run(TOOLS / 'finalize_review.py', d, '--verify')
    assert rc == 0 and 'VERIFIED' in out, out

@pytest.mark.parametrize('verdict', ['FAIL', 'REVISE'])
def test_finalize_records_worst_nonpassing_lens(tmp_path, verdict):
    d = F.lensify(F.clone(tmp_path))
    x = F.read_lens(d, 'age_signal_claims')
    x['verdict'] = verdict
    x['docs'][0]['verdict'] = verdict
    x['findings'].append({'doc': 'resume', 'severity': 'fail', 'finding': 'paraphrase implies an unclaimed gap', 'evidence': 'quoted line'})
    F.write_lens(d, 'age_signal_claims', x)
    rc, out = F.run(TOOLS / 'finalize_review.py', d, env=F.tenv(tmp_path))
    assert rc == 2 and 'RECORDED' in out and ('4-lens: ' + verdict in out), out
    assert '4-lens: ' + verdict in (d / 'README.md').read_text()
    rv = json.loads((d / 'review.json').read_text())
    assert rv['final'] == verdict
    assert any(('paraphrase implies an unclaimed gap' in r for e in rv['lenses'] for r in e['reasons']))
    assert sqlite3.connect(tmp_path / 't.db').execute('select verdict from package_runs').fetchone() == (verdict,)
    rc, out = F.run(TOOLS / 'finalize_review.py', d, '--verify')
    assert rc == 1 and 'not PASS' in out, out

@pytest.mark.parametrize('break_it,expect', [(lambda d: (d / 'reviews' / 'ats.json').unlink(), 'MISSING reviews/ats.json'), (lambda d: F.write_lens(d, 'ats', {**F.read_lens(d, 'ats'), 'reviewer_run_id': F.read_lens(d, 'recruiter')['reviewer_run_id']}), 'not distinct'), (lambda d: F.write_lens(d, 'ats', {**F.read_lens(d, 'ats'), 'reviewer_run_id': 'build-test-run-1'}), 'builder run'), (lambda d: (d / 'resume-native.md').write_text((d / 'resume-native.md').read_text() + '\n'), 'STALE')])
def test_format_finalize_refuses_unusable_lens_set(tmp_path, break_it, expect):
    d = F.lensify(F.clone(tmp_path))
    break_it(d)
    before = (d / 'README.md').read_text()
    rc, out = F.run(TOOLS / 'finalize_review.py', d, env=F.tenv(tmp_path))
    assert rc == 1 and 'REFUSE' in out and (expect in out), out
    assert (d / 'README.md').read_text() == before and (not (tmp_path / 't.db').exists())

def test_combined_pass_records_and_verifies(tmp_path):
    d = F.copy_current(F.COVER, tmp_path)
    F.combine(d)
    rc, out = F.finalize(d, tmp_path)
    assert rc == 0 and 'RECORDED' in out, out
    rv = json.loads((d / 'review.json').read_text())
    assert rv['reconciled']['mode'] == 'combined' and rv['reviewer'].startswith('1 combined reviewer') and (rv['final'] == 'PASS')
    assert (d / 'reviews' / f"round{rv['round']}" / 'resume-native.md').exists()
    rc, out = F.finalize(d, tmp_path, '--verify')
    assert rc == 0 and 'VERIFIED' in out, out
    (d / 'reviews' / 'combined.json').write_text((d / 'reviews' / 'combined.json').read_text() + '\n')
    rc, out = F.finalize(d, tmp_path, '--verify')
    assert rc != 0, out
    assert not rv.get('holds_for_user')

def test_precheck_finalize_refuses_unanswered_warn_then_accepts(tmp_path):
    d = F.copy_current(F.NOCOVER, tmp_path)
    F.combine(d)
    c = json.loads((d / 'reviews/combined.json').read_text())
    assert c['precheck_warns'], 'fixture should carry at least one WARN'
    L, errs, mode = FR.load_review(d)
    assert not errs and (not FR.warn_coverage(d, L, mode))
    c['precheck_warns'] = c['precheck_warns'][1:]
    (d / 'reviews/combined.json').write_text(json.dumps(c))
    L, errs, mode = FR.load_review(d)
    assert any(('not addressed' in e for e in FR.warn_coverage(d, L, mode)))
