#!/usr/bin/env python3
"""Word-count report for skill prose — goal 4's "soft budget, measured".

Prints counts for every SKILL.md and reference; flags (never fails) files
over the soft targets: SKILL.md ~700 words, a reference ~1,200. Exceeding
a target triggers a review, not a build failure — but a target nobody
measures is how a skill quietly reached 3,290 words.
"""
import glob, os, sys

SKILL_SOFT, REF_SOFT = 700, 1200
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skills")
rows, total = [], 0
for path in sorted(glob.glob(os.path.join(root, "*", "**", "*.md"), recursive=True)):
    rel = os.path.relpath(path, os.path.dirname(root))
    words = len(open(path, encoding="utf-8").read().split())
    total += words
    soft = SKILL_SOFT if rel.endswith("SKILL.md") else REF_SOFT
    rows.append((words, rel, "  ⚠ over soft target" if words > soft else ""))
for words, rel, flag in sorted(rows, reverse=True):
    print(f"{words:6}  {rel}{flag}")
print(f"\n{total} words across {len(rows)} files "
      f"({sum(1 for w,r,f in rows if f)} over their soft target)")
