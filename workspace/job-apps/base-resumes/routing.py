#!/usr/bin/env python3
'Which base resume a package uses (source workflow revision 2026-10-19).\n\n- ic-builder: individual-contributor FDE, Solutions Architect, Applied AI roles (plus the existing IC builder lane).\n- solutions-fde-delivery: Manager / Sr Manager / Director / Head of / VP / Field CTO roles in FDE, Solutions,\n  Field or Customer Engineering, and Delivery. Also IC Solutions/Sales Engineer roles (not covered by the\n  2026-10-19 decision; ask the user before moving them).\n- tpm and eng-manager: unchanged.\n\nUsage in a roles_*.py file:  from routing import base_for;  base=base_for(title)\nAlways sanity-check the result against the JD: a "Lead FDE" who manages people is a manager role.\n'

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

import re

MANAGER_RE = re.compile(r"\b(manager|mgr|director|head of|head,|vp\b|vice president|field cto|chief|lead,? (?:fde|forward deployed) team)\b", re.I)
TPM_RE = re.compile(r"\b(technical program|tpm|program manager)\b", re.I)
EM_RE = re.compile(r"\b(engineering manager|manager,? (?:software )?engineering|\bem\b)\b", re.I)
IC_BUILDER_RE = re.compile(r"\b(forward[- ]deployed|fde|solutions? architect|applied ai|ai architect|agent deployment|"
                           r"ai engineer|agent engineer|software engineer|swe)\b", re.I)


def base_for(title: str) -> str:
    t = title or ""
    if TPM_RE.search(t):
        return "tpm"
    if EM_RE.search(t) and not re.search(r"forward[- ]deployed|fde|solutions", t, re.I):
        return "eng-manager"
    if MANAGER_RE.search(t):
        return "solutions-fde-delivery"
    if IC_BUILDER_RE.search(t):
        return "ic-builder"
    return "solutions-fde-delivery"


if __name__ == "__main__":
    for t in ["Forward Deployed Engineer, Infrastructure", "Staff Forward Deployed Engineer", "Solutions Architect",
              "Applied AI Architect", "Agent Deployment Engineer", "Manager, Forward Deployed Services",
              "Head of Solutions", "Field CTO", "Senior Manager, Solutions Architecture", "Lead Forward Deployed Engineer",
              "Senior Technical Program Manager", "Engineering Manager, API Platform", "Senior Solutions Engineer"]:
        print(f"{base_for(t):24s} {t}")
