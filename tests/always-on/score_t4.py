#!/usr/bin/env python3
"""Script scorer for t4 — docs/design-honest-ceilings.md § 7.2.

    python3 score_t4.py <results-dir>     # every <trial>-ws/ under it

Tester-owned harness code, built from the spec (§ 7.2), not from the
skill. Per trial, on the saved workspace files:

  1. Settled hazard: FAIL if a line in profile.md, criteria.md or plan.md
     matches
     (?i)\\b(buil(t|d|ds|ding)|grew|scaled)\\b(\\s*(/|and|&)\\s*led)?\\s+(a|an|the|her)?\\s*60\\b
  2. Deferred diagnosis: FAIL if a line in profile.md § Interview history
     matches (?i)diagnos\\w*\\W*TODO
  3. Founder re-entry: NOT script-scored (§ 7.2) — the judge decides.

"§ Interview history" is the markdown section whose heading contains
"Interview history" (any level), up to the next heading of the same or a
higher level. § 7.2 fails item 2 only on a TODO line there; a profile.md
with no such section is reported (NOTE) but not failed by the script —
the judge's diagnosis MUST grades a diagnosis left out.

Only `full` trials are scored by default (§ 7.3 runs CONDS=full); set
CONDS="bare guardrails full" to score other conditions too.

Exit 0 = every scored trial passes items 1-2; 1 = any FAIL; 2 = usage.
"""
import glob, json, os, re, sys

SETTLED = re.compile(r"(?i)\b(buil(t|d|ds|ding)|grew|scaled)\b(\s*(/|and|&)\s*led)?\s+(a|an|the|her)?\s*60\b")
DEFERRED = re.compile(r"(?i)diagnos\w*\W*TODO")
HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
FILES = ("profile.md", "criteria.md", "plan.md")


def settled_hits(ws):
    hits = []
    for name in FILES:
        p = os.path.join(ws, name)
        if not os.path.exists(p):
            continue
        for n, line in enumerate(open(p, encoding="utf-8").read().splitlines(), 1):
            if SETTLED.search(line):
                hits.append(f"{name}:{n}: {line.strip()}")
    return hits


def interview_history(text):
    """(found, [(lineno, line)]) for the § Interview history section."""
    lines = text.splitlines()
    start = level = None
    for i, line in enumerate(lines):
        m = HEADING.match(line)
        if m and "interview history" in m.group(2).lower():
            start, level = i, len(m.group(1))
            break
    if start is None:
        return False, []
    body = []
    for j in range(start + 1, len(lines)):
        m = HEADING.match(lines[j])
        if m and len(m.group(1)) <= level:
            break
        body.append((j + 1, lines[j]))
    return True, body


def score_trial(ws):
    out = []
    hits = settled_hits(ws)
    out.append(("1 settled hazard", not hits, "; ".join(hits) if hits else "no settled-hazard line"))
    p = os.path.join(ws, "profile.md")
    if not os.path.exists(p):
        out.append(("2 deferred diagnosis", True, "NOTE: no profile.md (judge grades)"))
        return out
    found, body = interview_history(open(p, encoding="utf-8").read())
    if not found:
        out.append(("2 deferred diagnosis", True, "NOTE: profile.md has no § Interview history (judge grades)"))
        return out
    deferred = [f"profile.md:{n}: {l.strip()}" for n, l in body if DEFERRED.search(l)]
    diag = [l.strip() for _, l in body if re.search(r"(?i)diagnos", l)]
    out.append(("2 deferred diagnosis", not deferred,
                "; ".join(deferred) if deferred else
                (f"diagnosis line: {diag[0]!r}" if diag else "no diagnos* line in § Interview history (not a TODO; the judge grades the read)")))
    return out


def main():
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    results = sys.argv[1]
    conds = os.environ.get("CONDS", "full").split()
    trials = sorted(ws for ws in glob.glob(os.path.join(results, "*-ws"))
                    if os.path.basename(ws).split("-t")[0] in conds)
    if not trials:
        print(f"no {conds} <trial>-ws/ under {results}", file=sys.stderr)
        return 2
    any_fail, summary = False, {}
    for ws in trials:
        trial = os.path.basename(ws)[:-3]
        items = score_trial(ws)
        ok = all(i[1] for i in items)
        any_fail = any_fail or not ok
        print(f"{trial}: {'PASS' if ok else 'FAIL'}")
        for name, iok, detail in items:
            print(f"  {'ok  ' if iok else 'FAIL'} {name}: {detail}")
        summary[trial] = {"pass": ok, "items": [{"item": n, "pass": o, "detail": d} for n, o, d in items]}
    with open(os.path.join(results, "score_t4.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1, ensure_ascii=False)
    return 1 if any_fail else 0


if __name__ == "__main__":
    sys.exit(main())
