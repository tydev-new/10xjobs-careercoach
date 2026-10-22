#!/usr/bin/env python3
"""agent_config.py: read the candidate-specific settings the generic job-search skills use.

  jobsearch.py config                  print agent-config.yaml (paths, preferences)
  jobsearch.py config path <key>       one resolved path, e.g. `path jobs_db` (keys: pipeline/home.py DEFAULTS)
  jobsearch.py config outreach-proof   proof lines for cold notes: claim text from claims.yaml plus its rule
  jobsearch.py config candidate        identity and contact lines from candidate.yaml (never the street address)
"""
import sys
from pathlib import Path

import yaml

from pipeline import home as H
from apply.lib import claims as CL

PRIVATE_FIELDS = ("address", "street", "date_of_birth", "ssn")


def load():
    return H.agent_config()


def candidate():
    """candidate.yaml with private fields removed (what tools may print or render)."""
    p = H.path("candidate_file")
    c = (yaml.safe_load(p.read_text()) or {}) if p.exists() else {}
    for k in PRIVATE_FIELDS:
        c.pop(k, None)
    return c


def outreach_proof(cfg=None):
    cfg = cfg or load(); ids = {c["id"]: c for c in CL.load()["claims"]}; out = []
    for p in (cfg.get("outreach") or {}).get("proof_defaults") or []:
        c = ids.get(p["claim"])
        if not c or c.get("status") != "approved": raise SystemExit(f"proof default {p['claim']} is not an approved claim")
        out.append({"claim": p["claim"], "text": c["text"], "lead": p.get("lead"), "rule": p.get("rule")})
    return out


def main():
    cfg = load(); a = sys.argv[1:]
    if not a: print(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True))
    elif a[0] == "path": print(H.path(a[1]))
    elif a[0] == "outreach-proof":
        for p in outreach_proof(cfg):
            print(f"- [{p['claim']}] " + (f"{p['lead']}: " if p["lead"] else "") + p["text"] + (f"  (rule: {p['rule']})" if p["rule"] else ""))
    elif a[0] == "candidate":
        print(yaml.safe_dump(candidate(), sort_keys=False, allow_unicode=True))
    else: sys.exit(__doc__)


if __name__ == "__main__":
    main()
