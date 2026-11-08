#!/usr/bin/env python3
"""builder_feedback.py (2026-11-05, the user <current-user-approval-reference>): the builder's to-do list for the next round, from the review.
Reads <pkg>/review.json `builder_round` (written by finalize_review.py) or, before finalize, reviews/combined.json:
  - rejection_reasons with outcome `fixed` whose suggested_line is not on the resume yet
  - best_candidate entries that are buried / understated / missing with a suggested_line
and lists the cant_fix holds for the user. Writes <pkg>/reviews/builder-round.json (unless --no-write) and prints it.
The builder puts each line into package.yaml (only from the cited approved claim ids; never new facts), runs
build_package.py --check / --write, precheck.py, then a new combined review (wording_check.py checks the configured next-round exception).
Read-only on everything else; never submits or contacts anyone.

  python3 builder_feedback.py <pkg> [--json] [--no-write]
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

import argparse, json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(_JOBBI_APPS / 'lib'))

def collect(pkg):
    pkg = Path(pkg).resolve()
    import finalize_review as FR
    L, errs, mode = FR.load_review(pkg)
    if errs: return {"package": pkg.name, "errors": errs, "lines": [], "holds": []}
    e, holds, pending = FR.rejection_reasons(pkg, L, mode)
    return {"package": pkg.name, "errors": e, "lines": FR.builder_lines(L, pending), "holds": holds}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pkg"); ap.add_argument("--json", action="store_true"); ap.add_argument("--no-write", action="store_true")
    a = ap.parse_args(); out = collect(a.pkg)
    if not a.no_write and not out["errors"]:
        (Path(a.pkg) / "reviews" / "builder-round.json").write_text(json.dumps(out, indent=1) + "\n")
    if a.json: print(json.dumps(out, indent=1))
    else:
        print(f"{out['package']}: {len(out['lines'])} line(s) for the builder, {len(out['holds'])} hold(s) for the user")
        for x in out["errors"]: print(f"  ERROR {x}")
        for x in out["lines"]: print(f"  ADD [{x['source']}] {x['reason']}: {x['line']}  (claims: {', '.join(x['claim_ids'])})")
        for h in out["holds"]: print(f"  HOLD {h['reason']}: {h.get('question_for_user') or h.get('screen_out_note')}")
    sys.exit(1 if out["errors"] else 0)

if __name__ == "__main__":
    main()
