#!/usr/bin/env python3
"""Knowledge-map mechanical checks — the one-right-answer tier, in code.

    python3 check_knowledge.py --workspace ~/job-search

FAIL: malformed scope (must be `track-<lane>` or `role: <company_key>-<title_key>`,
plain hyphens only — an em dash breaks the join to jd-analysis/jobs.md);
invalid status (gap / studying / credible / retired, bare). Moved to code
2026-08-15 after the stage review found em-dash keys and prose-in-status
cells in the first live map.
"""
import argparse, os, re, sys

SCOPE_RE = re.compile(r"^(track-[A-Za-z0-9]+|role: [a-z0-9][a-z0-9./-]*)$")
STATUS_RE = re.compile(r"^(gap|studying|credible|retired)$")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", required=True)
    args = ap.parse_args()
    path = os.path.join(os.path.expanduser(args.workspace), "knowledge.md")
    if not os.path.exists(path):
        print("no knowledge.md — nothing to check")
        return 0
    problems, rows, in_map, header = [], 0, False, None
    for line in open(path, encoding="utf-8"):
        if line.startswith("## "):
            in_map = line[3:].strip().lower().startswith("map")
            header = None
            continue
        if not in_map or not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if header is None:
            header = [c.lower() for c in cells]
            continue
        if set("".join(cells)) <= {"-", ":", " "}:
            continue
        row = dict(zip(header, cells))
        rows += 1
        topic = row.get("topic", "?")[:40]
        if not SCOPE_RE.match(row.get("scope", "")):
            problems.append(f"{topic}: bad scope {row.get('scope','')!r} — "
                            f"`track-<lane>` or `role: <key>` (plain hyphens)")
        if not STATUS_RE.match(row.get("status", "")):
            problems.append(f"{topic}: bad status {row.get('status','')!r} — "
                            f"gap/studying/credible/retired, bare (notes go in source)")
    for x in problems:
        print(f"FAIL  {x}")
    print(f"\n{rows} map row(s); {len(problems)} failure(s).")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
