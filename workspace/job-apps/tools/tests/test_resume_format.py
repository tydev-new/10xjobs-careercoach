
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

import re as _re
'Resume Format: assertions grouped by protected rule, not change date.'
import json, os, re, shutil, sqlite3, subprocess, sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import pytest, yaml
import package_fixtures as F
TOOLS = F.TOOLS
import precheck, fetch_form, lint_3lens_package as LINT
import jobsdb as J, reconcile_reviews as RR, format_check as FC
import agent_config as AC
PY = sys.executable
from _cases import *

def test_independent_build_write_records_builder_run(tmp_path):
    d = F.clone(tmp_path)
    prior = RR.builder_runs(d)
    rc, out = F.run(TOOLS / 'build_package.py', d, '--write', '--run-id', 'routine-run-abc', '--accept-diff', 'Explicit synthetic fixture content edit.', env=F.tenv(tmp_path))
    assert rc == 0, out
    assert RR.builder_runs(d) == prior + ['routine-run-abc']
    F.run(TOOLS / 'build_package.py', d, '--write', '--run-id', 'routine-run-def', env=F.tenv(tmp_path))
    assert RR.builder_runs(d) == prior + ['routine-run-abc', 'routine-run-def']
    rc, out = F.run(TOOLS / 'build_package.py', d, '--check')
    assert rc == 0 and out.startswith('SAME'), out

def test_build_live_package_rebuilds_byte_identical():
    r = build_bp('--check', build_LIVE)
    assert r.returncode == 0 and r.stdout.startswith('SAME'), r.stdout + r.stderr

def test_build_gate_refuses_unknown_claim_and_banned_paraphrase(tmp_path):
    p = tmp_path / 'eng-x'
    shutil.copytree(build_SAMPLE, p)
    s = yaml.safe_load((p / 'package.yaml').read_text())
    s['resume']['edits'][0]['new'] = ['- Claims. I claimed pretend omniscience.']
    s['resume']['edits'][0]['claims'] = ['example.nope']
    (p / 'package.yaml').write_text(yaml.safe_dump(s, sort_keys=False))
    before = (p / 'resume-native.md').read_text()
    r = build_bp('--write', p, '--accept-diff', 'test', env={'STAMP_REVIEW_DB': str(tmp_path / 't.db')})
    assert r.returncode == 1 and 'unknown claim id example.nope' in r.stdout and ('BANNED' in r.stdout)
    assert (p / 'resume-native.md').read_text() == before

def test_build_content_diff_needs_accept(tmp_path):
    p = tmp_path / 'eng-x'
    shutil.copytree(build_SAMPLE, p)
    s = yaml.safe_load((p / 'package.yaml').read_text())
    s['cover']['closing'] = ["I'd welcome a conversation about the role."]
    (p / 'package.yaml').write_text(yaml.safe_dump(s, sort_keys=False))
    r = build_bp('--write', p, env={'STAMP_REVIEW_DB': str(tmp_path / 't.db')})
    assert r.returncode == 1 and 'accept-diff' in r.stdout

def test_build_init_and_write_records_prep_run(tmp_path):
    p = tmp_path / 'eng-new'
    assert build_bp(p, '--init', 'eng-manager', '--company', 'TestCo', '--title', 'Engineering Manager', '--url', 'https://example.com/j', '--cover').returncode == 0
    s = yaml.safe_load((p / 'package.yaml').read_text())
    s['scope'] = ['eng']
    s['cover']['date'] = 'January 1, 2099'
    s['cover']['opening'] = ['I build engineering teams that ship on a steady rhythm.']
    s['cover']['bullets'] = [{'text': 'Cards. Sorted 17 sample cards by fictional tag.', 'claims': ['example.cards']}]
    (p / 'package.yaml').write_text(yaml.safe_dump(s, sort_keys=False))
    (p / 'README.md').write_text('Claims scope: eng\n')
    r = build_bp('--write', p, env={'STAMP_REVIEW_DB': str(tmp_path / 't.db')})
    assert r.returncode == 0, r.stdout + r.stderr
    assert (p / 'resume.pdf').exists() and (p / 'cover.pdf').exists()
    row = sqlite3.connect(tmp_path / 't.db').execute('select verdict, source, base from package_runs').fetchone()
    assert row == ('BUILT', 'build_package', 'eng-manager')

def test_build_migration_keeps_rows_and_widens_checks(tmp_path):
    db = tmp_path / 'old.db'
    J.connect(str(db)).close()
    c = sqlite3.connect(db)
    old = J.SCHEMA[J.SCHEMA.index('CREATE TABLE IF NOT EXISTS package_runs'):J.SCHEMA.index('CREATE INDEX IF NOT EXISTS ix_runs_job')].replace(",'BUILT'", '').replace(",'build_package'", '')
    c.executescript('DROP VIEW package_results; DROP TABLE package_runs; ' + old)
    c.execute("insert into package_runs(package_path,package,verdict,stamped_at,source) values ('/x/p','p','PASS','t1','stamp_review')")
    c.commit()
    c.close()
    c = J.connect(str(db))
    assert c.execute('select count(*) from package_runs').fetchone()[0] == 1
    assert c.execute("select v from meta where k='schema_package_runs'").fetchone()[0] == J.PACKAGE_RUNS_SCHEMA
    J.record_package_run(c, package_path='/x/p', verdict='BUILT', stamped_at='t2', source='build_package')
    with pytest.raises(ValueError):
        J.record_package_run(c, package_path='/x/p', verdict='NOPE', stamped_at='t3')

def test_build_outcomes_link_to_review_not_build(tmp_path):
    c = J.connect(str(tmp_path / 't.db'))
    jid = J.insert_job(c, company='Co', title='EM', source='test', status='Packaged', url='https://x.test/1')
    r1 = J.record_package_run(c, package_path='/x/p', job_id=jid, verdict='PASS', stamped_at='2099-01-01')
    J.record_package_run(c, package_path='/x/p', job_id=jid, verdict='BUILT', stamped_at='2099-01-01', source='build_package')
    assert J.record_outcome(c, jid, 'applied', '2099-01-01') == r1

def test_format_old_dates(tmp_path):
    d = F.clone(tmp_path)
    F.edit(d, '**Earlier career:**', '**Earlier career:** (2004 to 2010)')
    f, _ = FC.check(d)
    assert any((x.startswith('DATES') and '2004' in x for x in f)), f

def test_format_build_write_runs_format_gate(tmp_path):
    import yaml
    d = F.clone(tmp_path)
    p = d / 'package.yaml'
    spec = yaml.safe_load(p.read_text())
    spec['resume']['edits'].append({'old': ['**Example Workshop, Project Contributor**'], 'new': ['**Example Workshop | Project Contributor**'], 'claims': [], 'wording_only': True, 'basis': 'Synthetic invalid separator test'})
    p.write_text(yaml.safe_dump(spec, sort_keys=False, allow_unicode=True, width=200))
    before = (d / 'resume-native.md').read_text()
    rc, out = F.run(TOOLS / 'build_package.py', d, '--write', '--accept-diff', 'test', '--run-id', 't-1', env=F.tenv(tmp_path))
    assert rc != 0 or 'not written' in out, out
    assert 'HEADER role header' in out and (d / 'resume-native.md').read_text() == before, out

def test_parallel_five_builds_at_once(tmp_path):
    env = dict(os.environ, STAMP_REVIEW_DB=str(tmp_path / 't.db'))
    J.connect(str(tmp_path / 't.db')).close()
    ser = parallel_copies(tmp_path / 'serial')
    par = parallel_copies(tmp_path / 'parallel')
    for i, p in enumerate(ser):
        r = parallel_build(p, env, f'serial-{i}')
        assert r.returncode == 0, r.stdout + r.stderr
    c = J.connect(str(tmp_path / 't.db'))
    jid = J.insert_job(c, company='Acme', title='Engineering Manager', source='test', url='https://x.test/acme', location='Example City')
    c.commit()
    c.close()
    from test_db_locking import DRIVER
    drv = tmp_path / 'drive_score.py'
    drv.write_text(DRIVER % {'pipe': parallel_PIPE, 'tmp': str(tmp_path)})

    def score(i):
        return subprocess.run([PY, str(drv), '--id', str(jid), '--want', 'pass', '--win', 'high', '--remote', 'home-area', '--must', 'fictional role :: approved toy evidence', '--want-why', f'lane fit {i}'], capture_output=True, text=True, timeout=300)
    with ThreadPoolExecutor(8) as ex:
        bf = [ex.submit(parallel_build, p, env, f'parallel-{i}') for i, p in enumerate(par)]
        sf = [ex.submit(score, i) for i in range(3)]
        rs = [f.result() for f in bf]
        ss = [f.result() for f in sf]
    for r in rs:
        assert r.returncode == 0 and 'written; builder run parallel-' in r.stdout, r.stdout + r.stderr
    for r in ss:
        assert r.returncode == 0 and 'locked' not in r.stderr, r.stdout + r.stderr
    rows = sqlite3.connect(tmp_path / 't.db').execute('select package, verdict, source from package_runs order by id').fetchall()
    assert len(rows) == 10 and all((v == 'BUILT' and s == 'build_package' for _, v, s in rows))
    assert sorted((n for n, _, _ in rows)) == sorted(parallel_PKGS * 2)
    for i, (a, b) in enumerate(zip(ser, par)):
        assert RR.builder_runs(b)[-1] == f'parallel-{i}' and RR.builder_runs(a)[-1] == f'serial-{i}'
        for f in parallel_OUT:
            assert parallel_sha(a / f) == parallel_sha(b / f), f'{b.name}/{f}: parallel build differs from serial'
        assert not list(b.glob('*.tmp')), 'no temp files left behind'

def test_format_clean_packages_and_all_base_resumes():
    """Contract: format clean packages and all base resumes."""
    for src in [format_NOCOVER, format_COVER]:
        rc, out = F.run(TOOLS / 'format_check.py', src)
        assert rc == 0 and 'PASS' in out, out
    names = ['tpm', 'eng-manager', 'solutions-fde-delivery', 'ic-builder']
    root = Path(str(_JOBBI_APPS / 'base-resumes'))
    bodies = [(root / b / 'resume-native.md').read_bytes() for b in names]
    assert all(body == bodies[0] for body in bodies), 'bundled bases diverged; check format on each'
    f, _ = FC.check(root / names[0])
    assert not f, (names[0], f)
    f, _ = FC.check(format_NOCOVER)
    assert not any((x.startswith('DATES') for x in f)), f
    f, w = FC.check(format_NOCOVER)
    assert not f and any((x.startswith('DOT') for x in w))
    f2, _ = FC.check(format_NOCOVER, strict_dots=True)
    assert any((x.startswith('DOT') for x in f2))

def test_format_section_layout_contract(tmp_path):
    """Contract: format section layout contract."""
    case_tmp = tmp_path / '0'
    case_tmp.mkdir()
    d = F.clone(case_tmp)
    t = (d / 'resume-native.md').read_text()
    edu = re.search('(?ms)^## EDUCATION\\n.*?(?=^## )', t).group(0)
    (d / 'resume-native.md').write_text(t.replace(edu, '').replace('## SUMMARY\n', edu + '## SUMMARY\n', 1))
    f, _ = FC.check(d)
    assert any((x.startswith('SECT order') for x in f)), f
    case_tmp = tmp_path / '1'
    case_tmp.mkdir()
    d = F.clone(case_tmp)
    F.edit(d, '## EDUCATION', '## MY JOURNEY\n- stuff\n\n## EDUCATION')
    f, _ = FC.check(d)
    assert any(('non-standard section' in x for x in f)), f

def test_format_header_separator_contract(tmp_path):
    """Contract: format header separator contract."""
    case_tmp = tmp_path / '0'
    case_tmp.mkdir()
    d = F.clone(case_tmp)
    F.edit(d, '**Example Workshop, Project Contributor**', '**Example Workshop | Project Contributor**')
    f, _ = FC.check(d)
    assert any((x.startswith('HEADER role header') for x in f)), f
    case_tmp = tmp_path / '1'
    case_tmp.mkdir()
    d = F.clone(case_tmp)
    t = (d / 'resume-native.md').read_text()
    line = next((l for l in re.search('(?ms)^## EDUCATION\\n(.*?)(?=^## |\\Z)', t).group(1).splitlines() if l.startswith('- ')))
    F.edit(d, line, line.replace(', ', ' · ', 1))
    assert any((x.startswith('HEADER education') for x in FC.check(d)[0]))

def test_summary_is_self_contained_sentences_not_lead_labels():
    """Contract: summary is self contained sentences not lead labels."""
    assert not [w for w in precheck.read_checks(summary_MD) if 'lead' in w.lower()]
    assert LINT.SUMMARY_BULLETS == tuple(_JOBBI_POLICY["summary_bullets"])

def test_config_and_generic_drafts_are_portable():
    """Contract: config and generic drafts are portable."""
    cfg = AC.load()
    for k, v in cfg['paths'].items():
        assert Path(v).exists(), k
    assert len(AC.outreach_proof(cfg)) == len(cfg['outreach']['proof_defaults'])
    for skill in ['apply', 'evaluate', 'coach', 'outreach']:
        f = _JOBBI_ROOT / 'skills' / ('job-search-' + skill) / 'SKILL.md'
        assert f.is_file(), f
        assert '---' in f.read_text()

def test_cover_opt_in_contract(tmp_path):
    """Contract: cover opt in contract."""
    case_tmp = tmp_path / '0'
    case_tmp.mkdir()
    d = case_tmp / 'p'
    d.mkdir()
    assert fetch_form.cover_required(d)[0] is False
    (d / 'form.json').write_text(json.dumps({'ats': 'ashby', 'cover_required': True}))
    assert fetch_form.cover_required(d)[0] is True
    (d / 'package.yaml').write_text(yaml.safe_dump({'cover_required': False}))
    assert fetch_form.cover_required(d) == (False, 'package.yaml cover_required')
    case_tmp = tmp_path / '1'
    case_tmp.mkdir()
    d = case_tmp / 'p'
    d.mkdir()
    assert not set(LINT.COVER_FILES) & set(LINT.required_files(d))
    (d / 'form.json').write_text(json.dumps({'ats': 'ashby', 'cover_required': True}))
    assert set(LINT.COVER_FILES) <= set(LINT.required_files(d))
    case_tmp = tmp_path / '2'
    case_tmp.mkdir()
    d = case_tmp / 'ic-x-engineer'
    rc, out = F.run(TOOLS / 'build_package.py', d, '--init', 'ic-builder', '--company', 'X', '--title', 'Engineer', '--url', 'https://example.com/j/1', env=F.tenv(case_tmp))
    assert rc == 0, out
    assert yaml.safe_load((d / 'package.yaml').read_text()).get('cover') is None
