#!/usr/bin/env python3
"""Load and validate <search-workspace>/profile/claims.yaml (the only source of resume facts)."""

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

import re, datetime
from functools import lru_cache
from pathlib import Path
import yaml

CLAIMS_PATH = Path(str(_JOBBI_SEARCH / 'profile/claims.yaml'))
SCOPES = {"all", "eng", "tpm", "sol", "fde", "ic", "health"}

class ClaimsError(Exception):
    pass

def validate(d):
    errs = []
    for k in ("version", "years", "roles", "earlier_career", "claims", "banned"):
        if k not in d:
            errs.append(f"missing top-level key: {k}")
    ids = set()
    for c in d.get("claims", []):
        cid = c.get("id", "?")
        if cid in ids:
            errs.append(f"{cid}: duplicate id")
        ids.add(cid)
        st = c.get("status")
        if st not in ("approved", "unconfirmed", "banned"):
            errs.append(f"{cid}: bad status {st!r}")
        if not c.get("text"):
            errs.append(f"{cid}: no text")
        if not c.get("source"):
            errs.append(f"{cid}: no source")
        if st == "approved":
            if not isinstance(c.get("approved"), (datetime.date, str)):
                errs.append(f"{cid}: approved claim needs an approval date")
            bad = set(c.get("scope") or []) - SCOPES
            if not c.get("scope") or bad:
                errs.append(f"{cid}: bad scope {c.get('scope')}")
            if c.get("numbers") and not c.get("anchors"):
                errs.append(f"{cid}: numbers need anchors")
            for rx in (c.get("anchors") or []) + (c.get("forbid_with") or []):
                try:
                    re.compile(rx)
                except re.error as e:
                    errs.append(f"{cid}: bad regex {rx!r}: {e}")
    for r in d.get("roles", []):
        for y in re.findall(r"\b(?:19|20)\d\d\b", r.get("meta") or ""):
            if _JOBBI_POLICY.get("age_cutoff_year") is not None and int(y) < _JOBBI_POLICY["age_cutoff_year"]:
                errs.append(f"role {r.get('key')}: year {y} before configured cutoff")
    for k, v in (d.get("earlier_career") or {}).items():
        t = v.get("text", "")
        if _JOBBI_POLICY.get("earlier_career_undated", False) and re.search(r"\b(?:19|20)\d\d\b", t):
            errs.append(f"earlier_career.{k}: dated")
        if re.search(r"—|→|->", t):
            errs.append(f"earlier_career.{k}: em-dash or arrow")
    if errs:
        raise ClaimsError("claims.yaml invalid:\n  " + "\n  ".join(errs))
    return d

@lru_cache(maxsize=4)
def load(path=str(CLAIMS_PATH)):
    return validate(yaml.safe_load(Path(path).read_text()))

def role(key, path=str(CLAIMS_PATH)):
    for r in load(path)["roles"]:
        if r["key"] == key:
            return r
    raise KeyError(key)

def earlier(variant, path=str(CLAIMS_PATH)):
    return load(path)["earlier_career"][variant]["text"]

def approved(scope=None, path=str(CLAIMS_PATH)):
    """Approved claims usable in `scope` (a set of scope names)."""
    sc = set(scope or ["all"]) | {"all"}
    return [c for c in load(path)["claims"]
            if c.get("status") == "approved" and (set(c.get("scope") or []) & sc)]

def reviewer_brief(scope, path=str(CLAIMS_PATH)):
    """Plain-text fact list handed to the reviewers (Lens B) for this package's scope."""
    d = load(path)
    lines = [f"Approved facts ({d['version']}, scope {sorted(scope)}). Anything else is an overclaim:"]
    lines += [f"- [{c['id']}] {c['text']}" + (f" (never paraphrase as: {', '.join(c['never_as'])})" if c.get("never_as") else "")
              for c in approved(scope, path)]
    lines.append("Unconfirmed (never use): " + "; ".join(c["text"] for c in d["claims"] if c.get("status") == "unconfirmed"))
    lines.append("Banned wording: " + "; ".join(f"{b['rx']} ({b['why']})" for b in d["banned"]))
    return "\n".join(lines)

if __name__ == "__main__":
    import sys
    d = load()
    print(f"OK {d['version']}: {len(d['claims'])} claims, {len(d['roles'])} roles, {len(d['earlier_career'])} earlier-career variants")
    if len(sys.argv) > 1:
        print(reviewer_brief(set(sys.argv[1].split(","))))
