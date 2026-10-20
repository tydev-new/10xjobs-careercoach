#!/usr/bin/env python3
"""The step counter's scorer (docs/design-fewer-steps.md § 1.3).

    python3 score_step_trace.py results/st-<tag> [> results/st-<tag>/tables.txt]

Reads each trial's `stderr.txt` (`results/st-<tag>/<trial>/`): only the
`[trace]` and `[cost]` lines. It prints, per trial and turn, one row per tool
call and per reply-only step with a CLASS, then the class counts, then the
totals, then the ok/MISS checks. The tables carry paths, lengths and costs,
never reply text or file contents, so they are what the owner sends back.
(One bit comes from `replies.md` when it is present: whether turn 4's reply
holds a question mark, for the turn-4 check. Its text is never printed.)

Classes, first match wins. The scorer guesses; a person can change any row by
hand before sending the table on:
  1 retry    the same tool with the same input as an earlier call in the turn,
             or the same tool on the same path or script after that call failed
  2 check    bash running check_closeout / check_files / check_materials /
             proposal_block, or check_language
  3 setup    anything that touches CLAUDE.md or templates/, or runs mkdir
  4 explore  bash whose first word is not `node`; list_files / read_file on
             skills/ other than a SKILL.md or skills/<s>/references/*.md path
  5 write    write_file; bash running update_job / record_verdict /
             render_resume; fetch_job with saveTo
  6 read     list_files, read_file, load_skill, fetch_job, web_search, list_board
  7 other    estimate_cost, add_roles (and any tool not named above)
  8 reply    a step with no tool call

The class counts add up to the number of rows (every call, plus every
reply-only step) — printed as "= N rows". Steps are counted separately: calls
made together in one step share a step number, so rows can exceed steps.

A turn whose step count did not match (a `[trace] WARN steps` line before its
`[cost] turn=` line) is marked NOT A MEASUREMENT and left out of the medians.
Exit code 0 unless there is nothing to score (1). Nothing here blocks.
"""
import json
import os
import re
import statistics
import sys

CLASSES = ["setup", "check", "write", "read", "explore", "retry", "other", "reply"]
CHECK_SCRIPTS = ("check_closeout", "check_files", "check_materials", "proposal_block")
WRITE_SCRIPTS = ("update_job", "record_verdict", "render_resume")
TRACE = re.compile(r"^\[trace\] turn=(\d+) step=(\d+) tool=(\S+) in=(.*)$")
REPLY = re.compile(r"^\[trace\] turn=(\d+) step=(\d+) reply \((\d+) chars\)$")
WARN = re.compile(r"^\[trace\] WARN steps ui=(\d+) cost=(\d+)$")
COST_TURN = re.compile(r"^\[cost\] turn=(\d+) (?:usd=([0-9.]+) steps=(\d+)|unknown steps=(\d+) reported=(\d+) usd=([0-9.]+))$")
COST_TOTAL = re.compile(r"^\[cost\] (?:usd=([0-9.]+) steps=(\d+)|unknown steps=(\d+) reported=(\d+) usd=([0-9.]+))$")


def parse_stderr(text):
    """-> {turn: {"rows": [...], "usd": float|None, "unknown": bool, "steps": int|None, "warn": (ui, cost)|None}}, total"""
    turns = {}
    pending_warn = None
    total = None

    def turn(t):
        return turns.setdefault(t, {"rows": [], "usd": None, "unknown": False, "steps": None, "warn": None})

    for line in text.splitlines():
        m = TRACE.match(line)
        if m:
            t, step, tool, rest = int(m.group(1)), int(m.group(2)), m.group(3), m.group(4)
            i = rest.rfind(" out=")
            inp, out = (rest[:i], rest[i + 5:]) if i >= 0 else (rest, "")
            turn(t)["rows"].append({"step": step, "tool": tool, "in": inp, "out": out})
            continue
        m = REPLY.match(line)
        if m:
            t, step, n = int(m.group(1)), int(m.group(2)), int(m.group(3))
            turn(t)["rows"].append({"step": step, "tool": "reply", "in": "", "out": f"{n} chars"})
            continue
        m = WARN.match(line)
        if m:
            pending_warn = (int(m.group(1)), int(m.group(2)))
            continue
        m = COST_TURN.match(line)
        if m:
            t = int(m.group(1))
            d = turn(t)
            if m.group(2) is not None:
                d["usd"], d["steps"] = float(m.group(2)), int(m.group(3))
            else:
                d["unknown"], d["steps"], d["usd"] = True, int(m.group(4)), float(m.group(6))
            d["warn"], pending_warn = pending_warn, None
            continue
        m = COST_TOTAL.match(line)
        if m:
            total = float(m.group(1)) if m.group(1) is not None else float(m.group(5))
    return turns, total


def _target(row):
    """The path or script a call is about (for the retry rule)."""
    tool, inp = row["tool"], row["in"]
    if tool == "bash":
        m = re.search(r"([\w./-]+\.(?:mjs|py))\b", inp)
        return m.group(1).split("/")[-1] if m else inp
    if tool == "write_file":
        return re.sub(r" \(\d+ chars\)$", "", inp)
    return inp


def _failed(row):
    out = row["out"]
    if row["tool"] == "bash":
        m = re.match(r"exit=(\d+|\?)", out)
        return bool(m) and m.group(1) != "0"
    if row["tool"] == "reply":
        return False
    return not re.match(r"^(ok|written|\d+ (chars|files|results)|needsGate=\w+)$", out)


def _is_skills_exploration(row):
    tool, inp = row["tool"], row["in"]
    if tool not in ("list_files", "read_file") or not (inp == "skills" or inp.startswith("skills/")):
        return False
    if tool == "read_file" and (re.fullmatch(r"skills/[^/]+/SKILL\.md", inp) or re.fullmatch(r"skills/[^/]+/references/[^/]+\.md", inp)):
        return False
    return True


def classify(rows):
    """Adds row["class"] to each row, in order, first match wins."""
    seen = []
    for row in rows:
        tool, inp = row["tool"], row["in"]
        key = (tool, inp)
        target = _target(row)
        earlier_same = any((r["tool"], r["in"]) == key for r in seen)
        failed_before = any(r["tool"] == tool and _target(r) == target and _failed(r) for r in seen)
        if tool == "reply":
            cls = "reply"
        elif earlier_same or failed_before:
            cls = "retry"
        elif tool == "check_language" or (tool == "bash" and any(s in inp for s in CHECK_SCRIPTS)):
            cls = "check"
        elif "CLAUDE.md" in inp or "templates/" in inp or (tool == "bash" and re.search(r"\bmkdir\b", inp)):
            cls = "setup"
        elif (tool == "bash" and (inp.split() or [""])[0] != "node") or _is_skills_exploration(row):
            cls = "explore"
        elif tool == "write_file" or (tool == "bash" and any(s in inp for s in WRITE_SCRIPTS)) or (tool == "fetch_job" and "saveTo=" in inp):
            cls = "write"
        elif tool in ("list_files", "read_file", "load_skill", "fetch_job", "web_search", "list_board"):
            cls = "read"
        else:
            cls = "other"
        row["class"] = cls
        seen.append(row)
    return rows


def count_classes(rows):
    counts = {c: 0 for c in CLASSES}
    for r in rows:
        counts[r["class"]] += 1
    return counts


def _clip(s, n):
    return s if len(s) <= n else s[: n - 1] + "…"


def turn_steps(d):
    if d["steps"] is not None:
        return d["steps"]
    return len({r["step"] for r in d["rows"]})


def render_turn(t, d):
    classify(d["rows"])
    cost = "unknown" if d["usd"] is None or d["unknown"] else f"{d['usd']:.4f}"
    head = f"turn {t}  steps={turn_steps(d)}  usd={cost}"
    if d["warn"]:
        head += f"  NOT A MEASUREMENT (step count mismatch: ui={d['warn'][0]} cost={d['warn'][1]})"
    lines = [head, " step  tool          in                                       out              class"]
    for r in d["rows"]:
        lines.append(f" {r['step']:<5} {r['tool']:<13} {_clip(r['in'], 40):<40} {_clip(r['out'], 16):<16} {r['class']}")
    counts = count_classes(d["rows"])
    lines.append(" by class: " + " · ".join(f"{c} {counts[c]}" for c in CLASSES) + f"  (= {sum(counts.values())} rows)")
    return lines


def _closeout_rows(d):
    return [r for r in d["rows"] if r["tool"] == "bash" and "check_closeout" in r["in"]]


def checks(turns, replies_text_by_turn):
    """-> list of (ok: bool, text). Never blocking."""
    out = []
    for t in (1, 2, 3):
        if t not in turns:
            continue
        runs = _closeout_rows(turns[t])
        if not runs:
            out.append((False, f"turn {t}: the close-out check did not run"))
        elif runs[-1]["out"] != "exit=0 clean":
            out.append((False, f"turn {t}: the close-out ran {len(runs)}x; its last run was not clean ({runs[-1]['out']})"))
        else:
            out.append((True, f"turn {t}: the close-out ran {len(runs)}x; its last run was clean"))
    if 4 in turns:
        d = turns[4]
        classify(d["rows"])
        ran = [r for r in d["rows"] if r["class"] == "check"]
        wrote = [r for r in d["rows"] if r["class"] == "write"]
        asked = "?" in (replies_text_by_turn.get(4) or "")
        if asked:
            runs = _closeout_rows(d)
            out.append((bool(runs), f"turn 4: the reply asks a question, so the close-out {'ran' if runs else 'did NOT run'}"))
        else:
            ok = not ran and not wrote
            out.append((ok, f"turn 4: ran {len(ran)} check(s) and {len(wrote)} write(s); expected none" if not ok else "turn 4: ran no check and wrote nothing"))
    bad = [t for t, d in sorted(turns.items()) if d["warn"]]
    out.append((not bad, "every step count matched" if not bad else f"step count mismatch in turn(s) {', '.join(map(str, bad))}"))
    return out


def read_replies(path):
    """-> {turn: text} from replies.md ("=== turn N ===" sections); {} when absent."""
    if not os.path.isfile(path):
        return {}
    text = open(path, encoding="utf-8", errors="replace").read()
    parts = re.split(r"^=== turn (\d+) ===$", text, flags=re.M)
    return {int(parts[i]): parts[i + 1] for i in range(1, len(parts) - 1, 2)}


def score_trial(trial_dir):
    text = open(os.path.join(trial_dir, "stderr.txt"), encoding="utf-8", errors="replace").read()
    turns, total = parse_stderr(text)
    replies = read_replies(os.path.join(trial_dir, "replies.md"))
    lines = []
    for t in sorted(turns):
        lines += render_turn(t, turns[t]) + [""]
    steps_total = sum(turn_steps(d) for d in turns.values())
    lines.append("totals: " + "  ".join(f"turn {t} {turn_steps(d)} steps ${d['usd']:.4f}" if d["usd"] is not None and not d["unknown"] else f"turn {t} {turn_steps(d)} steps unknown cost" for t, d in sorted(turns.items())))
    lines.append(f"run total: {steps_total} steps, " + (f"${total:.4f}" if total is not None else "cost unknown"))
    lines.append("")
    for ok, msg in checks(turns, replies):
        lines.append(f"{'ok  ' if ok else 'MISS'} {msg}")
    return lines, turns


def main(argv):
    if len(argv) != 1 or not os.path.isdir(argv[0]):
        print("usage: score_step_trace.py results/st-<tag>", file=sys.stderr)
        return 2
    root = argv[0]
    trials = sorted((d for d in os.listdir(root) if d.isdigit() and os.path.isfile(os.path.join(root, d, "stderr.txt"))), key=int)
    if not trials:
        print(f"no <trial>/stderr.txt under {root}", file=sys.stderr)
        return 1
    print(f"# step tables for {os.path.basename(root.rstrip('/'))}  ({len(trials)} trial(s))")
    all_turns = {}
    for t in trials:
        print(f"\n== trial {t}")
        lines, turns = score_trial(os.path.join(root, t))
        print("\n".join(lines))
        for n, d in turns.items():
            if not d["warn"]:
                all_turns.setdefault(n, []).append(turn_steps(d))
    if len(trials) > 1:
        print("\n== median steps per turn (turns that were measurements)")
        for n in sorted(all_turns):
            vals = all_turns[n]
            print(f"turn {n}  median {statistics.median(vals):g}  of {sorted(vals)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
