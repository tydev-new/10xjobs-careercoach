#!/usr/bin/env python3
'Compatibility shim: role headers and Earlier-career lines come from the current approved claims.yaml. Deprecated embedded bullet libraries are retired; use the current native builder and claims API. No former employer aliases or datasets are supplied.'

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

import sys
sys.path.insert(0, str(_JOBBI_APPS / 'lib'))
import claims as _C

for _r in _C.load()["roles"]:
    globals()[_r["key"]] = _r["header"]
    if _r.get("meta"):
        globals()[_r["key"] + "_META"] = _r["meta"]

EARLIER = {k: v["text"] for k, v in _C.load()["earlier_career"].items()}

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    raise ImportError(f"_native_claims.{name} is retired. Facts live in {_JOBBI_SEARCH / 'profile/claims.yaml'}; use approved facts there.")
