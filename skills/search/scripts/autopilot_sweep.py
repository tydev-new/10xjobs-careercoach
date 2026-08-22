#!/usr/bin/env python3
"""One-command autopilot sweep: search -> append run log.

Exists so a SCHEDULED run needs exactly ONE Bash invocation (= one permission
rule) instead of three. Wraps search_ats.py. The pipeline is jobs.md — readable directly, nothing to render.

  python3 autopilot_sweep.py --workspace /path/to/workspace [--max-per-company 3]
"""
import argparse, os, re, subprocess, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SEARCH = os.path.join(HERE, "search_ats.py")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", required=True)
    p.add_argument("--max-per-company", type=int, default=3)
    a = p.parse_args()
    ws = os.path.abspath(a.workspace)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    r = subprocess.run([sys.executable, SEARCH, "--workspace", ws,
                        "--max-per-company", str(a.max_per_company)],
                       capture_output=True, text=True)
    summary = (r.stdout or "").strip().splitlines()
    head = summary[0] if summary else f"search failed: {(r.stderr or '').strip()[:200]}"

    board = ""

    m = re.search(r"inserted (\d+) new, (\d+) already known", head)
    line = (f"- {now} — {head}{board}" if r.returncode == 0
            else f"- {now} — ERROR: {head}")
    log = os.path.join(ws, "autopilot-log.md")
    if not os.path.exists(log):
        with open(log, "w") as f:
            f.write("# Autopilot run log\n\n")
    with open(log, "a") as f:
        f.write(line + "\n")

    print(line)
    for extra in summary[1:]:
        print(extra)
    return 0 if r.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
