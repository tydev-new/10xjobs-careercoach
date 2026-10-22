#!/usr/bin/env python3
"""check_claims.py: every number or metric in a resume or cover must match an approved claim in claims.yaml.
Blocking gate: build_package runs it on every build, finalize_review folds it into the verdict, submit_gate re-runs it.

  jobsearch.py check-claims <package_dir> [--scope eng,ic] [--json]
  jobsearch.py check-claims <batch_dir> --all            # every package folder under a batch dir
  jobsearch.py check-claims --text "..." --scope ic      # ad hoc sentence check

Checks (all hard FAIL, exit 1):
  CLAIM   a metric token with no approved, in-scope claim whose anchor matches the same sentence
  FORBID  a claim's number used next to wording that claim forbids (e.g. "40+" next to "architects")
  YEAR    a year not listed in claims.yaml `years`
  BANNED  banned wording (claims.yaml `banned`)
  COND    conditional wording without its condition (claims.yaml `conditional`)
  SCOPE   scoped wording outside its scope (claims.yaml `scoped_phrases`)
  UNCONF  an unconfirmed claim's wording
  PDFSYNC a number in resume.pdf / cover.pdf that the source text does not have (or the reverse)
Scope: --scope, else a 'Claims scope: a,b' line in README.md, else the folder prefix mapped through agent-config.yaml
apply.lanes (a base resume folder name maps through the lane whose base it is); unknown prefixes get scope "all".
"""
import argparse, json, re, sys
from pathlib import Path

from apply.lib import claims as CL
from apply.lib import pkgmeta as PM
from apply.lib.textscan import md_candidate_text, md_units, units, tokens, pdf_text, norm_num, YEAR_RX, clean


def prefix_scopes():
    """folder prefix (and base folder name) -> claim scopes, from agent-config.yaml apply.lanes."""
    m = dict(PM.prefix_scopes())
    for pre, base in PM.prefix_base().items():
        m.setdefault(base, m.get(pre, {pre}))
    return m

def scope_for(pkg, override=None):
    if override:
        return set(x.strip() for x in override.split(",") if x.strip())
    readme = pkg / "README.md"
    if readme.exists():
        m = re.search(r"(?im)^\W*claims scope\W*[:=]\s*([a-z ,]+)$", readme.read_text())
        if m:
            return set(x.strip() for x in m.group(1).split(",") if x.strip())
    m = prefix_scopes()
    name = pkg.name
    if name in m:
        return set(m[name])
    return set(m.get(name.split("-", 1)[0], {"all"}))

def check_sentences(sents, scope, where, d):
    ign = d.get("ignore_terms", [])
    cl = CL.approved(scope)
    years = {str(y) for y in d["years"]}
    unconf = [c for c in d["claims"] if c.get("status") == "unconfirmed"]
    out = []
    for s in sents:
        for b in d["banned"]:
            if re.search(b["rx"], s, re.I):
                out.append(("BANNED", b["rx"], s, b["why"]))
        for c in d.get("conditional", []):
            if re.search(c["rx"], s, re.I) and not re.search(c["require"], s, re.I):
                out.append(("COND", c["rx"], s, c["why"]))
        for sp in d.get("scoped_phrases", []):
            if re.search(sp["rx"], s, re.I) and not (set(sp["scopes"]) & scope):
                out.append(("SCOPE", sp["rx"], s, f"{sp['why']} (package scope {sorted(scope)})"))
        for u in unconf:
            key = re.sub(r"[^a-z0-9 ]", "", u["text"].lower())
            if len(key) > 12 and key[:-1] in re.sub(r"[^a-z0-9 ]", "", s.lower()):
                out.append(("UNCONF", u["id"], s, "unconfirmed claim"))
        for t in tokens(s, ign):
            n = norm_num(t)
            if YEAR_RX.match(n):
                if n not in years:
                    out.append(("YEAR", t, s, f"year not in claims.yaml years {sorted(years)}"))
                continue
            cands = [c for c in cl if n in {norm_num(x) for x in (c.get("numbers") or [])}]
            ok = [c for c in cands if any(re.search(a, s, re.I) for a in c.get("anchors") or [])]
            if not ok:
                hint = ", ".join(c["id"] for c in cands) or "no claim has this number"
                out.append(("CLAIM", t, s, f"no in-scope claim anchors this number here (candidates: {hint})"))
                continue
            good = [c for c in ok if not any(re.search(f, s, re.I) for f in c.get("forbid_with") or [])]
            if not good:
                bad = [f for c in ok for f in c.get("forbid_with") or [] if re.search(f, s, re.I)]
                out.append(("FORBID", t, s, f"{ok[0]['id']} forbids {bad[0]!r} in the same sentence"))
    return [(k, tok, s, why, where) for k, tok, s, why in out]

def pdf_sync(src_sents, pdf, where, d):
    if not pdf.exists():
        return []
    ign = d.get("ignore_terms", [])
    a = {norm_num(t) for s in src_sents for t in tokens(s, ign)}
    b = {norm_num(t) for s in units(pdf_text(pdf)) for t in tokens(s, ign)}
    out = []
    for t in sorted(b - a):
        out.append(("PDFSYNC", t, f"in {pdf.name} but not in the source text", "rebuild the PDF from the source", where))
    for t in sorted(a - b):
        out.append(("PDFSYNC", t, f"in the source text but not in {pdf.name}", "rebuild the PDF from the source", where))
    return out

def check_package(pkg, scope_override=None):
    pkg = Path(pkg)
    d = CL.load()
    scope = scope_for(pkg, scope_override)
    fails, files = [], []
    md = pkg / "resume-native.md"
    if md.exists():
        s = md_units(md_candidate_text(md.read_text()))
        fails += check_sentences(s, scope, "resume", d)
        fails += pdf_sync(s, pkg / "resume.pdf", "resume", d)
        files.append("resume-native.md")
    cov = pkg / "cover.txt"
    if cov.exists():
        s = md_units(cov.read_text())
        fails += check_sentences(s, scope, "cover", d)
        fails += pdf_sync(s, pkg / "cover.pdf", "cover", d)
        files.append("cover.txt")
    for extra in sorted(pkg.glob("answers*.md")):
        fails += check_sentences(md_units(extra.read_text()), scope, extra.name, d)
        files.append(extra.name)
    if not files:
        fails.append(("FILE", "-", "no resume-native.md or cover.txt", "nothing to check", "package"))
    return {"package": str(pkg), "scope": sorted(scope), "claims_version": d["version"], "files": files,
            "result": "FAIL" if fails else "PASS",
            "fails": [dict(zip(("check", "token", "sentence", "why", "where"), f)) for f in fails]}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--scope"); ap.add_argument("--json", action="store_true")
    ap.add_argument("--all", action="store_true", help="check every package folder under each path")
    ap.add_argument("--text", help="check one ad hoc text")
    a = ap.parse_args()
    if a.text:
        d = CL.load(); sc = set((a.scope or "all").split(","))
        f = check_sentences(md_units(a.text), sc, "text", d)
        for x in f: print(f"FAIL {x[0]:7} {x[1]!r:16} | {x[2][:160]} | {x[3]}")
        print("PASS" if not f else "FAIL"); sys.exit(1 if f else 0)
    pkgs = []
    for p in a.paths:
        p = Path(p)
        if a.all:
            pkgs += sorted(q for q in p.iterdir() if q.is_dir() and ((q / "resume-native.md").exists() or (q / "cover.txt").exists()))
        else:
            pkgs.append(p)
    results = [check_package(p, a.scope) for p in pkgs]
    if a.json:
        print(json.dumps(results if len(results) != 1 else results[0], indent=1))
    else:
        for r in results:
            print(f"== {r['package']}  scope={','.join(r['scope'])}  {r['claims_version']}")
            for f in r["fails"]:
                print(f"  FAIL {f['check']:7} [{f['where']}] {f['token']!r:16} | {f['sentence'][:170]} | {f['why']}")
            print(f"  Claims check: {r['result']} ({r['claims_version']}; {len(r['fails'])} issue(s))")
    sys.exit(1 if any(r["result"] == "FAIL" for r in results) else 0)

if __name__ == "__main__":
    main()
