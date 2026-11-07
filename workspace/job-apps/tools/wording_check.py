#!/usr/bin/env python3
'wording_check.py: is this fix wording-only? (2026-11-04, source workflow revision simplification, change 5)\n\nThe round immediately after the configured free-round limit needs the user, EXCEPT when the only change since the last finalized round is phrasing. Then finalize_review.py\nrecords that next round without new user approval. "Wording-only" means ALL of these hold, comparing the package now with the snapshot that\nfinalize_review.py saved at the previous round (reviews/round<N>/: resume-native.md, cover.txt, package.yaml):\n  1. precheck.py has no FAIL (banned terms, claims, format, JD copy ... all clean)\n  2. no new number token (metric, count, %, $, year) anywhere in the resume / cover text\n  3. no new capitalized / technical term (a product, tool, employer or acronym not already in the old text)\n  4. no new claim id cited in package.yaml, and base / scope / gap_plan / cover settings unchanged\n  5. no more bullets than before, and no new cover (a cover added is not wording)\nAnything else (a new fact, metric, tool, claim or bullet) still goes to the user.\n\n  python3 wording_check.py <pkg> [--against <dir>] [--json]     exit 0 = wording-only, 1 = not, 2 = no baseline\nRead-only. If no snapshot exists (packages finalized before 2026-11-04) it falls back to resume-native.md.bak-build /\ncover.txt.bak-build when their sha matches what review.json says was reviewed; package.yaml is then not compared\n(reported), so the claim-id rule is checked only from the numbers / terms in the text.\n'

# Portable path/config adapter; pipeline implementation below is retained.
from pathlib import Path as _JobbiPath
import os as _jobbi_os, sys as _jobbi_sys
_JOBBI_ROOT = _JobbiPath(_jobbi_os.environ.get("JOBBI_ROOT", str(_JobbiPath(__file__).resolve().parents[3])))
_jobbi_sys.path.insert(0, str(_JOBBI_ROOT))
from runtime_config import policy as _jobbi_policy, candidate as _jobbi_candidate
_JOBBI_SEARCH = _JOBBI_ROOT / "workspace" / "job-search"
_JOBBI_APPS = _JOBBI_ROOT / "workspace" / "job-apps"
_JOBBI_POLICY = _jobbi_policy(_JOBBI_ROOT)
_JOBBI_CAND = _jobbi_candidate(_JOBBI_ROOT)

import argparse, hashlib, json, re, sys
from pathlib import Path
import yaml
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(_JOBBI_APPS / 'lib'))
from textscan import md_candidate_text, md_units, tokens

SNAP_FILES = ("resume-native.md", "cover.txt", "package.yaml")
SETTINGS = ("base", "scope", "gap_plan", "cover_required", "cover_attached", "ats_keywords")
TERM = re.compile(r"[A-Za-z][\w.+#/-]*")

def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p): return Path(p).read_text(encoding="utf-8", errors="replace") if p and Path(p).exists() else ""

def snapshot(pkg, rnd):
    """finalize_review.py calls this after recording round <rnd>."""
    pkg = Path(pkg); d = pkg / "reviews" / f"round{rnd}"; d.mkdir(parents=True, exist_ok=True)
    for f in SNAP_FILES:
        if (pkg / f).exists(): (d / f).write_bytes((pkg / f).read_bytes())
        elif (d / f).exists(): (d / f).unlink()
    return d

def baseline(pkg, before_round=None):
    """(dir or dict of paths, label). Highest reviews/round<N>/ with N < before_round, else the .bak-build fallback."""
    pkg = Path(pkg)
    snaps = sorted((int(m.group(1)), p) for p in (pkg / "reviews").glob("round*") if (m := re.fullmatch(r"round(\d+)", p.name)) and p.is_dir())
    snaps = [s for s in snaps if before_round is None or s[0] < before_round]
    if snaps: return {f: snaps[-1][1] / f for f in SNAP_FILES}, f"reviews/{snaps[-1][1].name}"
    rj = pkg / "review.json"
    if rj.exists():
        want = (json.loads(rj.read_text()).get("reconciled") or {}).get("reviewed_files_sha256") or {}
        bak = pkg / "resume-native.md.bak-build"
        if bak.exists() and want.get("resume-native.md") == sha(bak):
            cb = pkg / "cover.txt.bak-build"
            cover = cb if cb.exists() and want.get("cover.txt") == sha(cb) else (pkg / "cover.txt" if want.get("cover.txt") and (pkg / "cover.txt").exists() and sha(pkg / "cover.txt") == want.get("cover.txt") else None)
            return {"resume-native.md": bak, "cover.txt": cover, "package.yaml": None}, "*.bak-build matching review.json (package.yaml not compared)"
    return None, "no baseline: no reviews/round<N>/ snapshot and no .bak-build matching review.json"

def texts(paths):
    md = read(paths.get("resume-native.md")); cv = read(paths.get("cover.txt"))
    return md_units(md_candidate_text(md)) + (md_units(cv) if cv else []), md, cv

def numbers(sents): return {t for s in sents for t in tokens(s)}

def terms(sents):
    out = set()
    for s in sents:
        ws = TERM.findall(s)
        for i, w in enumerate(ws):
            w = w.rstrip(".,;:")
            if i == 0 or not w: continue
            if re.search(r"[A-Z]", w) or re.search(r"[\d+#]", w): out.add(w)
    return out

def nbullets(md):
    return sum(1 for l in md_candidate_text(md).splitlines() if re.match(r"\s*[-*•]\s+\S", l)) if md else 0

def claim_ids(spec):
    ids = set()
    for e in (spec.get("resume") or {}).get("edits") or []: ids |= set(e.get("claims") or [])
    for b in (spec.get("cover") or {}).get("bullets") or []: ids |= set(b.get("claims") or [])
    return ids

def check(pkg, against=None, before_round=None, run_precheck=True):
    pkg = Path(pkg).resolve()
    if against: base, label = {f: Path(against) / f for f in SNAP_FILES}, str(against)
    else: base, label = baseline(pkg, before_round)
    out = {"package": pkg.name, "baseline": label, "wording_only": False, "reasons": [], "changed_sentences": 0}
    if base is None: out["reasons"].append(label); out["no_baseline"] = True; return out
    old_s, old_md, old_cv = texts(base)
    new_s, new_md, new_cv = texts({f: pkg / f for f in SNAP_FILES})
    R = out["reasons"]
    if run_precheck:
        import precheck
        pc = precheck.run(pkg)
        if pc["fail"]: R.append(f"precheck has {len(pc['fail'])} FAIL(s): {pc['fail'][0][:160]}")
    if (n := sorted(numbers(new_s) - numbers(old_s))): R.append(f"new number(s): {', '.join(n[:8])}")
    old_words = {w.lower().rstrip('.,;:') for s in old_s for w in TERM.findall(s)}
    if (t := sorted(w for w in terms(new_s) if w.lower() not in old_words)): R.append(f"new term(s): {', '.join(t[:8])}")
    if nbullets(new_md) > nbullets(old_md): R.append(f"more bullets: {nbullets(old_md)} -> {nbullets(new_md)}")
    if new_cv and not old_cv: R.append("a cover was added")
    if base.get("package.yaml") and Path(base["package.yaml"]).exists():
        os_, ns = yaml.safe_load(read(base["package.yaml"])) or {}, yaml.safe_load(read(pkg / "package.yaml")) or {}
        if (c := sorted(claim_ids(ns) - claim_ids(os_))): R.append(f"new claim id(s) cited: {', '.join(c)}")
        for k in SETTINGS:
            if os_.get(k) != ns.get(k): R.append(f"package.yaml {k} changed")
    oset = {" ".join(s.split()) for s in old_s}
    out["changed_sentences"] = sum(1 for s in new_s if " ".join(s.split()) not in oset)
    out["wording_only"] = not R
    return out

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pkg"); ap.add_argument("--against"); ap.add_argument("--json", action="store_true")
    a = ap.parse_args(); r = check(a.pkg, a.against)
    if a.json: print(json.dumps(r, indent=1))
    else:
        print(f"{'WORDING-ONLY' if r['wording_only'] else ('NO BASELINE' if r.get('no_baseline') else 'NOT WORDING-ONLY')}  {r['package']}"
              f"  (vs {r['baseline']}; {r['changed_sentences']} sentence(s) changed)")
        for x in r["reasons"]: print(f"  - {x}")
    sys.exit(0 if r["wording_only"] else (2 if r.get("no_baseline") else 1))

if __name__ == "__main__":
    main()
