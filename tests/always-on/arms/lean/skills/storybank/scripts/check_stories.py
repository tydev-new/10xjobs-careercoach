#!/usr/bin/env python3
"""Storybank mechanical checks — the one-right-answer tier, in code.

    python3 check_stories.py --workspace ~/job-search

Exit 0 = clean, 1 = at least one FAIL. Checks (all mechanical; judgment
stays with the model):

  FAIL  duplicate or malformed story ID in the index
  FAIL  invalid Status (must be `confirmed`, or `draft [source: <file>]`;
        RETIRED lives in Notes, not Status)
  FAIL  index row with no stories/S###-*.md file
  FAIL  stories/ file with no index row
  WARN  a gap in the ID sequence (legal — IDs are never reused — but worth
        a look: it usually means a hand-deleted row)

Moved to code 2026-08-14 (goal 2's table: one right answer -> code), which
let the prose warning about index<->file drift in SKILL.md be
deleted per the deletion valve.
"""
import argparse, glob, os, re, sys

ID_RE = re.compile(r"^S(\d{3,})$")
STATUS_RE = re.compile(r"^(confirmed|draft \[source: [^\]]+\])$")


def index_rows(path):
    """Rows of the `## Stories` table: (id, status), by header position."""
    rows, in_stories, header = [], False, None
    for line in open(path, encoding="utf-8"):
        if line.startswith("## "):
            in_stories = line[3:].strip().lower().startswith("stories")
            header = None
            continue
        if not in_stories or not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if header is None:
            header = [c.lower().strip("* ") for c in cells]
            continue
        if set("".join(cells)) <= {"-", ":", " "}:
            continue  # the separator row
        row = dict(zip(header, cells))
        rows.append((row.get("id", ""), row.get("status", "")))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", required=True)
    args = ap.parse_args()
    ws = os.path.expanduser(args.workspace)
    index = os.path.join(ws, "storybank.md")
    if not os.path.exists(index):
        print("no storybank.md — nothing to check")
        return 0

    problems, warns = [], []
    rows = index_rows(index)
    seen = {}
    numbers = []
    for sid, status in rows:
        m = ID_RE.match(sid)
        if not m:
            problems.append(f"malformed story ID {sid!r} — IDs are S### ")
            continue
        if sid in seen:
            problems.append(f"duplicate story ID {sid}")
        seen[sid] = True
        numbers.append(int(m.group(1)))
        if not STATUS_RE.match(status):
            problems.append(f"{sid}: invalid Status {status!r} — "
                            f"`confirmed` or `draft [source: <file>]`")

    files = {}
    for p in glob.glob(os.path.join(ws, "stories", "S*.md")):
        m = re.match(r"^(S\d{3,})-", os.path.basename(p))
        if m:
            files[m.group(1)] = p
    for sid in seen:
        if sid not in files:
            problems.append(f"{sid}: index row has no stories/{sid}-*.md file")
    for sid in files:
        if sid not in seen:
            problems.append(f"stories/{os.path.basename(files[sid])}: no index row")

    if numbers:
        expected = set(range(1, max(numbers) + 1))
        for gap in sorted(expected - set(numbers)):
            warns.append(f"ID sequence gap at S{gap:03d} — legal, but usually a hand-deleted row")

    for w in warns:
        print(f"WARN  {w}")
    for p in problems:
        print(f"FAIL  {p}")
    print(f"\n{len(rows)} index row(s), {len(files)} story file(s); {len(problems)} failure(s).")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
