#!/usr/bin/env python3
"""agent_config.py: read the candidate-specific settings the generic job-search skills use (phase 3 item 9, 2026-10-21).

  python3 agent_config.py                 print the config (paths, preferences)
  python3 agent_config.py path <key>      one path, e.g. `path jobs_db`
  python3 agent_config.py outreach-proof  proof lines for cold notes: claim text from claims.yaml plus its rule
  python3 agent_config.py candidate       identity and contact lines from candidate.yaml (no address)
"""

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

import sys, yaml
from pathlib import Path
CONFIG = Path(str(_JOBBI_SEARCH / 'profile/agent-config.yaml'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import claims as CL

def load():
    return yaml.safe_load(CONFIG.read_text().replace("${JOBBI_ROOT}", str(_JOBBI_ROOT)))

def outreach_proof(cfg=None):
    cfg = cfg or load(); ids = {c["id"]: c for c in CL.load()["claims"]}; out = []
    for p in cfg["outreach"]["proof_defaults"]:
        c = ids.get(p["claim"])
        if not c or c.get("status") != "approved": raise SystemExit(f"proof default {p['claim']} is not an approved claim")
        out.append({"claim": p["claim"], "text": c["text"], "lead": p.get("lead"), "rule": p.get("rule")})
    return out

def main():
    cfg = load(); a = sys.argv[1:]
    if not a: print(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True))
    elif a[0] == "path": print(cfg["paths"][a[1]])
    elif a[0] == "outreach-proof":
        for p in outreach_proof(cfg):
            print(f"- [{p['claim']}] " + (f"{p['lead']}: " if p["lead"] else "") + p["text"] + (f"  (rule: {p['rule']})" if p["rule"] else ""))
    elif a[0] == "candidate":
        c = yaml.safe_load(Path(cfg["candidate_file"]).read_text()); c.pop("address", None)
        print(yaml.safe_dump(c, sort_keys=False, allow_unicode=True))
    else: sys.exit(__doc__)

if __name__ == "__main__":
    main()
