"""Temporary-package fixtures; never modify a live package or database.

Current fixtures exercise the combined reviewer; legacy fixtures retain coverage
of the supported four-lens/reconcile/stamp compatibility path.
"""

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

import json, os, re, shutil, subprocess, sys
from pathlib import Path
TOOLS = Path(str(_JOBBI_APPS / 'tools'))
APPS = TOOLS.parent
PIPE = Path(str(_JOBBI_SEARCH / 'pipeline'))
for p in (TOOLS, APPS/'lib', APPS/'evals', APPS/'evals/calibration', PIPE, PIPE/'tests'):
    sys.path.insert(0, str(p))
import reconcile_reviews as RR, build_package as BP
os.environ.setdefault('PRECHECK_NO_LINK', '1')

FIXES = _JOBBI_POLICY.get("synthetic_fixture_replacements", [])

def modernize(d, pdfs=True):
    d = Path(d)
    changed = False
    for name in ('resume-native.md', 'cover.txt', 'package.yaml', 'README.md', 'review.json', 'review-3lens.md'):
        p = d / name
        if not p.exists():
            continue
        t = p.read_text()
        n = t
        for a, b in FIXES:
            n = n.replace(a, b)
        if n != t:
            p.write_text(n)
            changed = True
    rj = d / 'review.json'
    if rj.exists():
        import json
        sys.path.insert(0, str(TOOLS))
        import reconcile_reviews as RR
        rv = json.loads(rj.read_text())
        if rv.get('rubric_version') != RR.live_rubric():
            rv['rubric_version'] = RR.live_rubric()
            rj.write_text(json.dumps(rv, indent=1))
    if pdfs and changed:
        if (d / 'resume-native.md').exists() and (d / 'resume.pdf').exists():
            subprocess.run([sys.executable, str(TOOLS / 'rebuild_resume_from_native.py'), str(d), str(d / 'resume.pdf')], check=True, capture_output=True)
        if (d / 'cover.txt').exists() and (d / 'cover.pdf').exists():
            subprocess.run([sys.executable, str(TOOLS / 'rebuild_cover_from_txt.py'), str(d), str(d / 'cover.pdf')], check=True, capture_output=True)
    return d
UP = {'Pass': 'PASS', 'Revise': 'REVISE', 'Fail': 'FAIL'}

def lensify(d, ids=None, builder='build-test-run-1', rubric=None):
    d = Path(d)
    rv = json.loads((d / 'review.json').read_text())
    if builder:
        BP.record_builder(d, builder)
    ids = ids or {l: f'{l}-test-run-{i}' for i, l in enumerate(RR.LENSES)}
    cover = rv['cover']
    hashes = {k: v for k, v in RR.file_hashes(d).items() if not (k == 'cover.txt' and cover == 'none')}
    (d / 'reviews').mkdir(exist_ok=True)
    for lens in RR.LENSES:
        ents = [e for e in rv['lenses'] if e['lens'] == lens]
        docs = [{'doc': e['doc'], 'verdict': UP[e['verdict']], 'summary': (e.get('reasons') or ['checked'])[0][:300] or 'checked'} for e in ents]
        f = {'schema': 'lens-review-v1', 'lens': lens, 'package': d.name, 'reviewer_run_id': ids[lens], 'rubric_version': rubric or RR.live_rubric(), 'reviewed_at': '2099-01-01', 'reviewed_files_sha256': hashes, 'round': rv.get('round', 1), 'verdict': max((x['verdict'] for x in docs), key=RR.RANK.get), 'docs': docs, 'findings': [{'doc': e['doc'], 'severity': 'note', 'finding': r[:300], 'evidence': 'fixture from single-pass review'} for e in ents for r in e.get('reasons') or ['checked lens']][:6] or [{'doc': 'resume', 'severity': 'note', 'finding': 'checked lens', 'evidence': 'fixture'}]}
        if lens == 'hiring_manager':
            hm = next((e for e in ents if e['doc'] == 'resume'))
            f['top_rejection_reason'] = hm['top_rejection_reason']
            f['answered'] = hm['answered']
        if lens == 'ats':
            a = next((e for e in ents if e['doc'] == 'resume'))
            f['keywords'] = [{'term': k['term'], 'aliases': k.get('aliases', [])} for k in a['keywords']]
        if lens == 'age_signal_claims':
            f['gap_handling'] = rv['gap_handling']
        if rv.get('residual_gaps') and lens == 'hiring_manager':
            f['residual_gaps'] = rv['residual_gaps']
        (d / 'reviews' / f'{lens}.json').write_text(json.dumps(f, indent=1))
    return d

def read_lens(d, lens):
    return json.loads((Path(d) / 'reviews' / f'{lens}.json').read_text())

def write_lens(d, lens, x):
    (Path(d) / 'reviews' / f'{lens}.json').write_text(json.dumps(x, indent=1))
NOCOVER = Path(str(_JOBBI_APPS / 'tests/synthetic-fixtures/fixture-nocover-a'))

COVER = Path(str(_JOBBI_APPS / 'tests/synthetic-fixtures/fixture-cover-a'))

def copy_current(src, dst_root):
    d = Path(dst_root) / Path(src).name
    shutil.copytree(src, d, ignore=shutil.ignore_patterns('*.bak*'))
    r = d / 'README.md'
    if r.exists():
        r.write_text(r.read_text().replace('[USER]', '(answered in test fixture)'))
    return d

def combine(d, run_id='combined-test-run-1', rnd=None, verdict=None, drop_lenses=True):
    d = Path(d)
    L = {l: json.loads((d / 'reviews' / f'{l}.json').read_text()) for l in RR.LENSES}
    cover = RR.cover_mode(d)
    hashes = {k: v for k, v in RR.file_hashes(d).items() if not (k == 'cover.txt' and cover == 'none')}
    docs = [{'doc': 'resume', 'verdict': 'PASS', 'summary': 'resume checked on all four angles'}]
    if cover == 'attached':
        docs.append({'doc': 'cover', 'verdict': 'PASS', 'summary': 'cover checked on all four angles'})
    angles = {l: {'verdict': verdict or L[l]['verdict'], 'summary': L[l]['docs'][0]['summary'], 'findings': [f for f in L[l]['findings'] if f['doc'] in {x['doc'] for x in docs}][:4]} for l in RR.LENSES}
    for x in docs:
        x['verdict'] = max((a['verdict'] for a in angles.values()), key=RR.RANK.get)
    c = {'schema': 'combined-review-v1', 'package': d.name, 'reviewer_run_id': run_id, 'rubric_version': RR.live_rubric(), 'reviewed_at': '2099-01-01', 'reviewed_files_sha256': hashes, 'round': rnd or L['ats'].get('round', 1), 'verdict': max((a['verdict'] for a in angles.values()), key=RR.RANK.get), 'docs': docs, 'angles': angles, 'top_rejection_reason': L['hiring_manager']['top_rejection_reason'], 'answered': L['hiring_manager']['answered'], 'keywords': L['ats'].get('keywords') or [], 'gap_handling': L['age_signal_claims'].get('gap_handling') or []}
    import precheck as PC
    c['precheck_warns'] = [{'id': PC.warn_id(w), 'action': 'accepted', 'reason': 'test fixture: accepted as written'} for w in PC.run(d)['warn']]
    c['best_candidate'] = [{'ask': f'JD top ask {i}', 'proof_claim_ids': ['example.stack'], 'on_resume': 'yes', 'suggested_line': None} for i in (1, 2, 3)]
    c['rejection_reasons'] = [{'reason': 'test fixture: no obvious screen-out', 'outcome': 'not_a_risk', 'reason_not_risk': 'test fixture: the top asks are all covered'}]
    (d / 'reviews' / 'combined.json').write_text(json.dumps(c, indent=1))
    if drop_lenses:
        for l in RR.LENSES:
            (d / 'reviews' / f'{l}.json').unlink()
    return c

def write_combined(d, c):
    (Path(d) / 'reviews' / 'combined.json').write_text(json.dumps(c, indent=1))

LEGACY_DAY = APPS / 'tests/synthetic-fixtures'
LEGACY_NONE = LEGACY_DAY / 'fixture-nocover-a'
LEGACY_COVER = LEGACY_DAY / 'fixture-cover-a'
STAMP_COVER = COVER
SAMPLE_PACKAGE = COVER
def clone(tmp, src=LEGACY_NONE, reviews=False):
    d = Path(tmp) / Path(src).name
    d.parent.mkdir(parents=True, exist_ok=True)
    ignore = ['*.bak-*'] + ([] if reviews else ['reviews'])
    shutil.copytree(src, d, ignore=shutil.ignore_patterns(*ignore))
    modernize(d)
    if not reviews:
        # Deliberately emulate the legacy single-pass fixture, not a current finalization.
        rv = json.loads((d / 'review.json').read_text())
        rv.pop('reconciled', None)
        (d / 'review.json').write_text(json.dumps(rv))
    return d
def run(*a, env=None):
    r = subprocess.run([sys.executable, *map(str, a)], capture_output=True, text=True, env=env)
    return r.returncode, r.stdout + r.stderr
def tenv(tmp): return dict(os.environ, STAMP_REVIEW_DB=str(Path(tmp)/'t.db'))
def finalize(d, tmp, *extra): return run(TOOLS/'finalize_review.py', d, *extra, env=tenv(tmp))
def force_pass(c):
    for a in c['angles'].values(): a['verdict']='PASS'
    for x in c['docs']: x['verdict']='PASS'
    c['verdict']='PASS'
def combined(tmp, src=None, rr=None):
    d = copy_current(src or NOCOVER, tmp)
    c = combine(d); force_pass(c); c['round']=1
    if rr is not None: c['rejection_reasons']=rr
    write_combined(d,c)
    return d,c
def edit(d, old, new, f='resume-native.md'):
    p=d/f; text=p.read_text(); assert old in text, old
    p.write_text(text.replace(old,new,1))
def first_bullet_line(md):
    return next(i for i,l in enumerate(md.splitlines()) if re.match(r'\s*[-*]\s+\S',l) and ' the ' in l)
def edit_resume(d, fn):
    p=d/'resume-native.md'; lines=p.read_text().splitlines(); i=first_bullet_line(p.read_text()); lines[i]=fn(lines[i]); p.write_text('\n'.join(lines)+'\n')
def load(d):
    import finalize_review as FR
    L,errs,mode=FR.load_review(d); assert not errs, errs
    return L,mode

def clone_stamp(tmp, src=LEGACY_NONE):
    return clone(tmp, src, reviews=True)
