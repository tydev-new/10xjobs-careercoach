"""One resolver for where the user's job-search data lives.

The data folder ("home") holds everything personal: the profile (candidate.yaml, claims.yaml, criteria.md,
agent-config.yaml), sources.yaml, the jobs database, base resumes, packages and the private eval set.
The code in this package holds nothing personal.

Resolution order:
  1. $JOBSEARCH_HOME (jobsearch.py --config DIR sets it)
  2. ./jobsearch-data, relative to the current directory

Inside the home, every path has a default (DEFAULTS below). profile/agent-config.yaml may override any of them
under `paths:`; relative values are relative to the home.
"""
import os
from pathlib import Path

import yaml

PKG_ROOT = Path(__file__).resolve().parent.parent          # the pipeline-py folder (code only)
DEFAULT_HOME = "jobsearch-data"
AGENT_CONFIG = "profile/agent-config.yaml"

DEFAULTS = {
    "candidate_file": "profile/candidate.yaml",   # name, contact lines, cover signature, form answers
    "claims_file": "profile/claims.yaml",         # the only source of facts
    "criteria_file": "profile/criteria.md",       # lanes, location, pay floor, dealbreakers
    "sources_file": "sources.yaml",               # boards and searches the sweep reads
    "scoring_file": "scoring.yaml",               # which base resume each lane scores against
    "jobs_db": "jobs.db",
    "state_dir": "state",                         # lock, logs, last-rendered jobs.md
    "views_dir": ".",                             # generated jobs.md and active.md
    "analysis_dir": "jd-analysis",                # step-6 records (score.py)
    "base_resumes": "base-resumes",               # <base>/resume-native.md, _shared/*.md, optional routing.py
    "package_root": "packages",                   # packages go in <package_root>/<batch>/<lane>-<slug>/
    "contacts": "contacts",
    "runs_dir": "runs",
    "reports_dir": "reports",
    "snapshots_dir": "snapshots",
    "private_evals": "evals/private",             # the user's own eval cases; never committed anywhere
}
PACKAGE_DEFAULTS = {                              # shipped with the code; override in agent-config to customize
    "rubric": PKG_ROOT / "apply" / "rubric" / "apply-rubric.md",
    "reviewer_brief": PKG_ROOT / "apply" / "rubric" / "reviewer-brief.md",
}


def home() -> Path:
    return Path(os.environ.get("JOBSEARCH_HOME") or DEFAULT_HOME).expanduser().resolve()


def agent_config() -> dict:
    p = home() / AGENT_CONFIG
    return (yaml.safe_load(p.read_text()) or {}) if p.exists() else {}


def path(key: str) -> Path:
    """absolute path for one setting (see DEFAULTS / PACKAGE_DEFAULTS)."""
    override = (agent_config().get("paths") or {}).get(key)
    if override:
        p = Path(override).expanduser()
        return p if p.is_absolute() else home() / p
    if key in PACKAGE_DEFAULTS:
        return PACKAGE_DEFAULTS[key]
    if key not in DEFAULTS:
        raise KeyError(f"unknown path setting {key!r}; known: {sorted(DEFAULTS) + sorted(PACKAGE_DEFAULTS)}")
    return home() / DEFAULTS[key]


def setting(section: str, key: str, default=None):
    """a preference from agent-config.yaml, e.g. setting('apply', 'max_review_rounds', 3)."""
    return (agent_config().get(section) or {}).get(key, default)


def all_paths() -> dict:
    return {k: str(path(k)) for k in list(DEFAULTS) + list(PACKAGE_DEFAULTS)}
