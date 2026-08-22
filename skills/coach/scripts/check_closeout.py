#!/usr/bin/env python3
"""The coach's close-out, in code — the three duties every version of the
skill dropped about half the time (t8, every round 2026-08-15 → 08-21):
the stage named, every question asked turned into a Waiting-on-you row,
the plan written this turn. Prose could not hold them; apply's proposal
problem had the same shape and a script fixed it.

The agent DECLARES what its reply does, and the script checks the disk:

    python3 check_closeout.py --workspace . --stage applying \\
        --asked "which of the three mutuals" --asked "the comp floor"

FAIL: the stage is not one of the five · plan.md was not modified in the
last --minutes (default 30) · an --asked question has no Waiting-on-you
row that shares a keyword with it · the Board is empty. Exit 1 on any
FAIL. The declaration is the forcing function: a question you did not
declare is a question you forgot to write down.
"""
import argparse
import os
import re
import sys
import time

STAGES = ("groundwork", "searching", "applying", "interviewing", "deciding")
STOP = set("the a an of to in on for and or is are be with at by from your my their it this that which what".split())


def waiting_rows(text):
    m = re.search(r"^Waiting on you\s*\n(.*?)(?=^(?:To do|Doing|Done|##)\b|\Z)", text, re.S | re.M)
    if not m:
        return []
    rows, cur = [], None
    for ln in m.group(1).splitlines():
        if re.match(r"^\s*[-*•]\s+", ln):
            if cur:
                rows.append(cur)
            cur = re.sub(r"^\s*[-*•]\s+", "", ln)
        elif cur is not None and ln.strip():
            cur += " " + ln.strip()
    if cur:
        rows.append(cur)
    return rows


def keywords(s):
    return {w for w in re.findall(r"[a-z0-9][a-z0-9\-]+", s.lower()) if w not in STOP and len(w) > 2}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workspace", required=True)
    ap.add_argument("--stage", required=True, help="one of: " + " / ".join(STAGES))
    ap.add_argument("--asked", action="append", default=[], help="a question this reply asks the candidate (repeatable)")
    ap.add_argument("--minutes", type=int, default=30, help="plan.md must have been written within this many minutes")
    a = ap.parse_args()
    findings = []
    if a.stage.lower() not in STAGES:
        findings.append(("FAIL", f'stage "{a.stage}" is not one of {", ".join(STAGES)} — name the stage the search is in'))
    p = os.path.join(a.workspace, "plan.md")
    if not os.path.exists(p):
        findings.append(("FAIL", "plan.md does not exist — the plan is written in the same reply"))
        text = ""
    else:
        age = (time.time() - os.path.getmtime(p)) / 60
        if age > a.minutes:
            findings.append(("FAIL", f"plan.md was last written {age:.0f} min ago — every plan change the reply claims is WRITTEN before the reply ends"))
        text = open(p, encoding="utf-8").read()
        if "## Board" not in text:
            findings.append(("FAIL", "plan.md has no ## Board"))
        rows = waiting_rows(text)
        for q in a.asked:
            kq = keywords(q)
            if not any(kq & keywords(r) for r in rows):
                findings.append(("FAIL", f'asked "{q[:60]}" — no Waiting-on-you row shares a word with it; write the row this turn'))
        if a.asked and not rows:
            findings.append(("FAIL", f"{len(a.asked)} question(s) asked, Waiting on you is empty"))
        todo = re.search(r"^To do\s*\n\s*[-*•]", text, re.M)
        if not todo and not rows:
            findings.append(("WARN", "the Board has no To do and no Waiting-on-you rows — a plan with nothing on it is rarely the plan"))
    for level, msg in findings:
        print(f"{level}  {msg}")
    if not findings:
        print(f"close-out clean: stage {a.stage}; plan.md written; {len(a.asked)} question(s) each have a row")
    sys.exit(1 if any(l == "FAIL" for l, _ in findings) else 0)


if __name__ == "__main__":
    main()
