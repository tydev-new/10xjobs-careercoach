"""Submit Gate: assertions grouped by protected rule, not change date."""

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

import sqlite3, sys
import pytest, yaml
import package_fixtures as F
import precheck
import submit_gate as SG, jobsdb as J
from _cases import *

@pytest.mark.parametrize('url,j,g,want', [('https://jobs.ashbyhq.com/acme/' + 'a' * 8 + '-1111-2222-3333-' + 'b' * 12, {'job-board/acme': (200, {'jobs': [{'id': 'x'}]})}, {}, 'closed'), ('https://jobs.ashbyhq.com/acme/' + 'a' * 8 + '-1111-2222-3333-' + 'b' * 12, {'job-board/acme': (200, {'jobs': [{'id': 'a' * 8 + '-1111-2222-3333-' + 'b' * 12}]})}, {}, 'live'), ('https://job-boards.greenhouse.io/acme/jobs/123', {'boards/acme/jobs/123': (404, None)}, {}, 'closed'), ('https://www.linkedin.com/jobs/view/900000000000000000001/', {}, {'jobPosting/900000000000000000001': (200, b"<h2 class='top-card-layout__title'>EM</h2> No longer accepting applications")}, 'closed'), ('https://www.linkedin.com/jobs/view/900000000000000000001/', {}, {'jobPosting/900000000000000000001': (200, b"<h2 class='top-card-layout__title'>EM</h2>")}, 'live'), ('https://www.linkedin.com/jobs/view/900000000000000000001/', {}, {'jobPosting/900000000000000000001': (429, b'')}, 'unknown'), ('https://acme.wd5.myworkdayjobs.com/Careers/job/Remote/EM_JR1', {'wday/cxs/acme/Careers/job/Remote/EM_JR1': (200, {'jobPostingInfo': {'canApply': False}})}, {}, 'closed'), ('https://careers.acme.com/jobs/1', {}, {'careers.acme.com': (200, b'<html>apply</html>')}, 'unknown')])
def test_build_posting_status(url, j, g, want):
    assert SG.posting_status(url, get=Fake(g), jget=Fake(j))[0] == want

def test_build_gate_blocks_closed_and_records(tmp_path):
    p, db = build_gate_db(tmp_path)
    r = SG.gate(p, posting_fn=lambda u, **k: ('closed', 'fake: gone'), db=db)
    assert r['result'] == 'BLOCK' and any(('posting closed' in x for x in r['reasons']))
    assert sqlite3.connect(db).execute('select result, posting from submit_checks').fetchone() == ('BLOCK', 'closed')

def test_combined_submit_gate_cover_rules(tmp_path):
    d = F.copy_current(F.COVER, tmp_path)
    # Existing cover file is optional: the spec must not override the form in this case.
    spec = yaml.safe_load((d / 'package.yaml').read_text())
    spec.pop('cover_required', None)
    (d / 'package.yaml').write_text(yaml.safe_dump(spec, sort_keys=False))
    form = json.loads((d / 'form.json').read_text())
    form['cover_required'] = False
    (d / 'form.json').write_text(json.dumps(form))
    F.combine(d)
    rc, out = F.finalize(d, tmp_path)
    assert rc == 0, out
    db = combined_gate_db(tmp_path, d)
    live = lambda u, **k: ('live', 'fake')
    r = SG.gate(d, posting_fn=live, db=db, record=False)
    cv = r['checks']['cover']
    assert cv['required'] is False and cv['upload'] == ['resume.pdf'] and ('do not upload' in cv['note']), cv
    s = yaml.safe_load((d / 'package.yaml').read_text())
    s['cover_required'] = True
    (d / 'package.yaml').write_text(yaml.safe_dump(s, sort_keys=False, allow_unicode=True))
    (d / 'cover.pdf').rename(d / 'cover.pdf.moved')
    r = SG.gate(d, posting_fn=live, db=db, record=False)
    assert r['result'] == 'BLOCK' and any(('cover' in x.lower() for x in r['reasons'])), r['reasons']

def test_submit_requires_live_posting_or_human_verification(tmp_path):
    """Contract: submit requires live posting or human verification."""
    case_tmp = tmp_path / '0'
    case_tmp.mkdir()
    p, db = build_gate_db(case_tmp)
    r = SG.gate(p, posting_fn=lambda u, **k: ('live', 'fake'), db=db)
    assert r['result'] == 'OK', r['reasons']
    case_tmp = tmp_path / '1'
    case_tmp.mkdir()
    p, db = build_gate_db(case_tmp)
    assert SG.gate(p, posting_fn=lambda u, **k: ('unknown', '403'), db=db, record=False)['result'] == 'BLOCK'
    assert SG.gate(p, posting_fn=lambda u, **k: ('unknown', '403'), db=db, verified_live='the user checked', record=False)['result'] == 'OK'

def test_submit_blocks_legacy_review_and_skipped_job(tmp_path):
    """Contract: submit blocks legacy review and skipped job."""
    case_tmp = tmp_path / '0'
    case_tmp.mkdir()
    p, db = build_gate_db(case_tmp, finalized=False)
    r = SG.gate(p, posting_fn=lambda u, **k: ('live', 'fake'), db=db, record=False)
    assert r['result'] == 'BLOCK' and any(('finalize_review.py --verify' in x for x in r['reasons'])), r['reasons']
    case_tmp = tmp_path / '1'
    case_tmp.mkdir()
    p, db = build_gate_db(case_tmp, status='Skipped')
    r = SG.gate(p, posting_fn=lambda u, **k: ('live', 'fake'), db=db, record=False)
    assert r['result'] == 'BLOCK' and any(('Skipped' in x for x in r['reasons']))

def test_package_end_to_end_precheck_review_hold_ack_and_submit_gate(tmp_path):
    """Only an acknowledged hold may pass the final upload gate; no ATS network."""
    d = F.copy_current(F.NOCOVER, tmp_path)
    db = str(tmp_path / 'end-to-end.db')
    conn = J.connect(db)
    jid = J.insert_job(conn, company='Sample', title='Engineer', source='test', status='Packaged', url='https://jobs.ashbyhq.com/test/sample')
    conn.execute('update jobs set package_path=? where id=?', (str(d), jid))
    conn.commit()
    conn.close()
    spec = yaml.safe_load((d / 'package.yaml').read_text())
    spec['job_id'] = jid
    (d / 'package.yaml').write_text(yaml.safe_dump(spec, sort_keys=False))
    checked = precheck.run(d)
    assert not checked['fail'], checked['fail']
    review = F.combine(d)
    F.force_pass(review)
    review['round'] = 1
    review['rejection_reasons'] = [{'reason': 'Domain proof not confirmed', 'outcome': 'cant_fix', 'question_for_user': 'Proceed despite the unconfirmed domain experience?'}]
    F.write_combined(d, review)
    rc, out = F.finalize(d, tmp_path)
    assert rc == 0 and 'HOLD for the user' in out, out
    live = lambda url, **kw: ('live', 'offline fixture')
    blocked = SG.gate(d, posting_fn=live, db=db, record=False)
    assert blocked['result'] == 'BLOCK' and any(('HOLD' in x for x in blocked['reasons'])), blocked
    rc, out = F.finalize(d, tmp_path, '--hold-ok', 'Test fixture approval reference; never a real authorization')
    assert rc == 0, out
    rc, out = F.finalize(d, tmp_path, '--verify')
    assert rc == 0 and 'VERIFIED' in out, out
    result = SG.gate(d, posting_fn=live, db=db)
    assert result['result'] == 'OK', result['reasons']
    assert result['checks']['cover']['upload'] == ['resume.pdf']
    assert sqlite3.connect(db).execute('select result from submit_checks').fetchone() == ('OK',)
