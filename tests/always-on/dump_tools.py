#!/usr/bin/env python3
"""Dump the tool-call sequence from a claude stream-json transcript.

The judge needs to see BEHAVIOR the reply text can't show: what prompts
the persona subagents (Task calls) actually received, and whether the
mechanical checker ran (Bash calls). Prints one line per tool call; Task
and Bash inputs are included (truncated) because t10's baits live there.

Pass --results to also print each Bash call's paired tool_result — the
script's own stdout/stderr, matched by tool_use_id. The voice judge
(judge_voice.sh) needs this: a fact is "carried" only when the reply
matches what the script itself printed, not what the model claims it
printed. Calls-only output (no --results) is unchanged, so every
existing caller keeps working.
"""
import json, sys

LIMIT = 2000
RESULT_LIMIT = 4000

def collect_results(path):
    """tool_use_id -> the paired tool_result's own text, concatenated."""
    results = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = ev.get("message") or {}
            for block in msg.get("content") or []:
                if not (isinstance(block, dict) and block.get("type") == "tool_result"):
                    continue
                tool_use_id = block.get("tool_use_id")
                if not tool_use_id:
                    continue
                content = block.get("content")
                parts = []
                if isinstance(content, str):
                    parts.append(content)
                elif isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "text" and c.get("text"):
                            parts.append(c["text"])
                if parts:
                    results[tool_use_id] = "\n".join(parts)
    return results

def walk(path, show_results):
    results = collect_results(path) if show_results else {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = ev.get("message") or {}
            for block in msg.get("content") or []:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    name = block.get("name", "?")
                    inp = block.get("input") or {}
                    # The subagent tool is named "Task" or "Agent" depending on
                    # harness version — missing one poisoned the judge inputs
                    # once (t10 v1, 2026-08-16). Match both.
                    if name in ("Task", "Agent"):
                        text = (inp.get("prompt") or "")[:LIMIT]
                        print(f"TOOL {name}(subagent) type={inp.get('subagent_type','?')} "
                              f"desc={inp.get('description','')!r}")
                        print(f"  PROMPT: {text!r}")
                    elif name == "Bash":
                        print(f"TOOL Bash: {(inp.get('command') or '')[:400]!r}")
                        if show_results:
                            out = results.get(block.get("id"))
                            if out is not None:
                                print(f"  RESULT: {out[:RESULT_LIMIT]!r}")
                    else:
                        keys = ",".join(sorted(inp)) if isinstance(inp, dict) else ""
                        print(f"TOOL {name} ({keys})")

args = sys.argv[1:]
show_results = "--results" in args
paths = [a for a in args if a != "--results"]
for p in paths:
    print(f"===== {p} =====")
    walk(p, show_results)
