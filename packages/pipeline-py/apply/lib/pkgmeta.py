"""Package metadata for outcome traceability (base, cover format, versions, verdict) and the lane map.

Lanes come from agent-config.yaml:
  apply:
    lanes:                 # package folder prefix -> base resume and claim scopes
      eng: {base: eng-manager, scopes: [eng]}
      ic:  {base: ic-builder,  scopes: [ic]}
A package folder is named <prefix>-<company-slug>, e.g. packages/2026-01-05/ic-acme.
"""
import json, re
from pathlib import Path

from pipeline import home as H

STAMP_RX = re.compile(r"(?m)^.*\b[34]-lens:\s*\**\s*(PASS|REVISE|FAIL)\b(.*)$")


def lanes():
    return H.setting("apply", "lanes", {}) or {}


def bases():
    return tuple(sorted({v.get("base") for v in lanes().values() if v.get("base")}))


def prefix_base():
    return {k: v.get("base") for k, v in lanes().items() if v.get("base")}


def prefix_scopes():
    return {k: set(v.get("scopes") or [k]) for k, v in lanes().items()}


def all_scopes():
    return set().union(*prefix_scopes().values()) if lanes() else set()


def cover_format(pkg):
    """bullets = greeting, fit line, bold-label proof bullets; paragraphs = a classic 3-paragraph letter;
    none = no cover ships (missing, or README / cover marked DO NOT ATTACH, or review.json cover=none)."""
    pkg = Path(pkg)
    rj = pkg / "review.json"
    if rj.exists():
        try:
            if json.loads(rj.read_text()).get("cover") == "none":
                return "none"
        except ValueError:
            pass
    cov = pkg / "cover.txt"
    readme = (pkg / "README.md").read_text() if (pkg / "README.md").exists() else ""
    if not cov.exists() or re.search(r"DO NOT ATTACH", readme + cov.read_text()[:300], re.I):
        return "none"
    t = cov.read_text()
    bullets = len(re.findall(r"(?m)^\s*(?:[-•*]|\*\*[^*]{2,40}\*\*)", t)) + len(re.findall(r"(?m)^[A-Z][\w /&-]{2,40}:\s", t))
    return "bullets" if bullets >= 3 else "paragraphs"


def base_of(pkg, readme=None, infer=False):
    """explicit base (review.json, or a README 'base ... <name>' mention); infer=True falls back to the folder prefix."""
    pkg = Path(pkg)
    rj = pkg / "review.json"
    if rj.exists():
        try:
            b = json.loads(rj.read_text()).get("base")
            if b: return b
        except ValueError:
            pass
    readme = readme if readme is not None else ((pkg / "README.md").read_text() if (pkg / "README.md").exists() else "")
    names = bases()
    if names:
        m = re.search(r"\bbase[^\n`]{0,20}`?(" + "|".join(map(re.escape, names)) + r")`?", readme, re.I)
        if m: return m.group(1)
    return prefix_base().get(pkg.name.split("-", 1)[0]) if infer else None


def stamp_of(pkg):
    """(verdict, lint_version, claims_version, rubric_version, round) from review.json, else the README stamp line."""
    pkg = Path(pkg)
    rj = pkg / "review.json"
    if rj.exists():
        try:
            rv = json.loads(rj.read_text())
            return rv.get("final"), rv.get("lint_version"), rv.get("claims_version"), rv.get("rubric_version"), rv.get("round")
        except ValueError:
            pass
    txt = (pkg / "README.md").read_text() if (pkg / "README.md").exists() else ""
    m = STAMP_RX.search(txt)
    lint = re.search(r"format-lint [\w.-]+", txt)
    lint = lint.group(0) if lint else None
    return (m.group(1) if m else "LEGACY"), lint, None, None, None
