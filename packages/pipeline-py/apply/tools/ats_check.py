#!/usr/bin/env python3
"""ATS lens helper (deterministic). Given must-have terms with aliases, compute hits and coverage against
the resume text, and the longest word run shared with jd.md (resume + cover). The reviewer picks the terms;
code computes the numbers, and finalize_review recomputes them so a review can't misreport.

  jobsearch.py ats-check <pkg> --terms "SRE|site reliability" "Kubernetes|k8s" ...
  jobsearch.py ats-check <pkg> --json-keywords keywords.json
      keywords.json may be any of:
        [{"term": "...", "aliases": ["..."]}, ...]      the lens format
        ["term", "term|alias", ...]                      plain strings ("|" separates aliases)
        {"keywords": [...]}                              an ats lens file (reviews/ats.json) or any wrapper
        a step-6 record (schema step6-v1)                its must_haves[].need become the terms
"""
import argparse, json, re, sys
from pathlib import Path

from apply.lib.textscan import md_candidate_text, clean

def resume_text(pkg):
    md = Path(pkg) / "resume-native.md"
    return clean(md_candidate_text(md.read_text())) if md.exists() else ""

def cover_text(pkg):
    c = Path(pkg) / "cover.txt"
    return clean(c.read_text()) if c.exists() else ""

def _rx(term):
    t = re.escape(term.strip()).replace(r"\ ", r"[\s-]+")
    return re.compile(rf"(?<![\w]){t}(?![\w])", re.I)

def hit(text, term, aliases):
    return any(_rx(x).search(text) for x in [term] + list(aliases or []) if x.strip())

def words(text):
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?", text.lower())

def max_shared_run(a, b):
    """Longest contiguous run of words shared by texts a and b (n-gram set intersection, binary-free scan)."""
    wa, wb = words(a), words(b)
    if not wa or not wb:
        return 0, ""
    best, best_s = 0, ""
    for n in range(4, 41):
        gb = {tuple(wb[i:i + n]) for i in range(len(wb) - n + 1)}
        found = next((wa[i:i + n] for i in range(len(wa) - n + 1) if tuple(wa[i:i + n]) in gb), None)
        if not found:
            break
        best, best_s = n, " ".join(found)
    return best, best_s

def normalize_keywords(data):
    """accept every keyword shape the tools produce and return [{"term", "aliases"}]."""
    if isinstance(data, dict):
        if data.get("schema") == "step6-v1" or "must_haves" in data:
            data = [m.get("need", "") for m in data.get("must_haves") or []]
        elif "keywords" in data:
            data = data["keywords"]
        else:
            raise ValueError("keywords JSON: expected a list, {\"keywords\": [...]}, or a step6-v1 record")
    if not isinstance(data, list):
        raise ValueError("keywords JSON: expected a list of terms")
    out = []
    for k in data:
        if isinstance(k, str):
            parts = [x.strip() for x in k.split("|") if x.strip()]
            if parts: out.append({"term": parts[0], "aliases": parts[1:]})
        elif isinstance(k, dict) and (k.get("term") or k.get("need")):
            out.append({"term": str(k.get("term") or k.get("need")).strip(), "aliases": list(k.get("aliases") or [])})
        else:
            raise ValueError(f"keywords JSON: unusable entry {k!r}")
    return out


def compute(pkg, keywords):
    keywords = normalize_keywords(keywords)
    rt = resume_text(pkg)
    jd = (Path(pkg) / "jd.md").read_text() if (Path(pkg) / "jd.md").exists() else ""
    rows = [{"term": k["term"], "aliases": k.get("aliases", []), "hit": hit(rt, k["term"], k.get("aliases"))} for k in keywords]
    cov = round(sum(r["hit"] for r in rows) / len(rows), 3) if rows else 0.0
    run_r, s_r = max_shared_run(rt, jd)
    run_c, s_c = max_shared_run(cover_text(pkg), jd)
    run, s = (run_r, s_r) if run_r >= run_c else (run_c, s_c)
    return {"keywords": rows, "coverage": cov, "top3_hit": all(r["hit"] for r in rows[:3]),
            "max_jd_copy_run": run, "max_jd_copy_text": s}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("pkg")
    ap.add_argument("--terms", nargs="*"); ap.add_argument("--json-keywords")
    a = ap.parse_args()
    if a.json_keywords:
        try:
            kws = normalize_keywords(json.loads(Path(a.json_keywords).read_text()))
        except ValueError as e:
            sys.exit(f"ats_check: {e}")
    else:
        kws = [{"term": t.split("|")[0], "aliases": t.split("|")[1:]} for t in (a.terms or [])]
    print(json.dumps(compute(a.pkg, kws), indent=1))

if __name__ == "__main__":
    main()
