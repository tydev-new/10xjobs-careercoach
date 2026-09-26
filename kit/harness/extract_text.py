#!/usr/bin/env python3
"""Concatenate every TOP-LEVEL assistant text block from a claude
stream-json capture.

Excludes sidechain events (`parent_tool_use_id` set) — a Task/Agent
subagent's own text is its internal work, never the reply the candidate
sees (independent review, M5). UNVERIFIED against a real live capture at
the time of this fix: tested only against synthetic stream-json events
built by hand (the schema `tests/test_plain_replies_review.py` uses) —
a real Claude Code capture may shape `parent_tool_use_id` or nest
sidechain events differently in ways this hasn't seen.
"""
import json, sys
out = []
for line in open(sys.argv[1]):
    line = line.strip()
    if not line:
        continue
    try:
        ev = json.loads(line)
    except json.JSONDecodeError:
        continue
    if ev.get("type") == "assistant" and not ev.get("parent_tool_use_id"):
        for block in ev.get("message", {}).get("content", []):
            if block.get("type") == "text" and block.get("text"):
                out.append(block["text"])
print("\n\n".join(out))
