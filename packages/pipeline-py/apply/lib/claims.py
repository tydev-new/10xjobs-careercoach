#!/usr/bin/env python3
"""Load and validate the user's claims.yaml (the only source of resume facts).

Location: <home>/profile/claims.yaml, or paths.claims_file in agent-config.yaml (see pipeline/home.py).

Top-level keys: version, years, roles, earlier_career, claims, banned; optional:
  scopes          list of scope names a claim may use (default: "all" plus every scope named in agent-config apply.lanes)
  earliest_year   no role meta line may carry a year before this one, and earlier_career text carries no years at all
                  (an age-signal rule; omit to turn it off)
"""
import re, datetime
from functools import lru_cache
from pathlib import Path
import yaml

from pipeline import home as H
from apply.lib import pkgmeta


def claims_path():
    return H.path("claims_file")


class ClaimsError(Exception):
    pass


def allowed_scopes(d):
    if d.get("scopes"):
        return set(d["scopes"]) | {"all"}
    return {"all"} | pkgmeta.all_scopes()


def validate(d):
    errs = []
    for k in ("version", "years", "roles", "earlier_career", "claims", "banned"):
        if k not in d:
            errs.append(f"missing top-level key: {k}")
    scopes = allowed_scopes(d)
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
            bad = set(c.get("scope") or []) - scopes
            if not c.get("scope") or bad:
                errs.append(f"{cid}: bad scope {c.get('scope')} (allowed: {sorted(scopes)})")
            if c.get("numbers") and not c.get("anchors"):
                errs.append(f"{cid}: numbers need anchors")
            for rx in (c.get("anchors") or []) + (c.get("forbid_with") or []):
                try:
                    re.compile(rx)
                except re.error as e:
                    errs.append(f"{cid}: bad regex {rx!r}: {e}")
    floor = d.get("earliest_year")
    if floor:
        for r in d.get("roles", []):
            for y in re.findall(r"\b(?:19|20)\d\d\b", r.get("meta") or ""):
                if int(y) < int(floor):
                    errs.append(f"role {r.get('key')}: year {y} before {floor}")
        for k, v in (d.get("earlier_career") or {}).items():
            if re.search(r"\b(?:19|20)\d\d\b", v.get("text", "")):
                errs.append(f"earlier_career.{k}: dated")
    for k, v in (d.get("earlier_career") or {}).items():
        if re.search(r"—|→|->", v.get("text", "")):
            errs.append(f"earlier_career.{k}: em-dash or arrow")
    if errs:
        raise ClaimsError("claims.yaml invalid:\n  " + "\n  ".join(errs))
    return d


@lru_cache(maxsize=8)
def _load(path):
    return validate(yaml.safe_load(Path(path).read_text()))


def load(path=None):
    return _load(str(path or claims_path()))


def role(key, path=None):
    for r in load(path)["roles"]:
        if r["key"] == key:
            return r
    raise KeyError(key)


def earlier(variant, path=None):
    return load(path)["earlier_career"][variant]["text"]


def earliest_year(path=None):
    y = load(path).get("earliest_year")
    return int(y) if y else None


def approved(scope=None, path=None):
    """Approved claims usable in `scope` (a set of scope names)."""
    sc = set(scope or ["all"]) | {"all"}
    return [c for c in load(path)["claims"]
            if c.get("status") == "approved" and (set(c.get("scope") or []) & sc)]


def reviewer_brief(scope, path=None):
    """Plain-text fact list handed to the reviewers (claims lens) for this package's scope."""
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
