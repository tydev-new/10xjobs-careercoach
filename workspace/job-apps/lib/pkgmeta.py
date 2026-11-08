"""Package metadata for outcome traceability (phase 2, 2026-10-20): base, cover format, versions, verdict."""

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

import json, re
from pathlib import Path

BASES = ("tpm", "eng-manager", "solutions-fde-delivery", "ic-builder")
PREFIX_BASE = {"eng": "eng-manager", "tpm": "tpm", "ic": "ic-builder", "sol": "solutions-fde-delivery", "fde": "solutions-fde-delivery"}
STAMP_RX = re.compile(r"(?m)^.*\b[34]-lens:\s*\**\s*(PASS|REVISE|FAIL)\b(.*)$")

def cover_format(pkg):
    """bullets = approved NEW format (greeting, fit line, bold-label proof bullets); paragraphs = older 3-paragraph letter;
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
    m = re.search(r"\bbase[^\n`]{0,20}`?(tpm|eng-manager|solutions-fde-delivery|ic-builder)`?", readme, re.I)
    if m: return m.group(1)
    return PREFIX_BASE.get(pkg.name.split("-", 1)[0]) if infer else None

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
