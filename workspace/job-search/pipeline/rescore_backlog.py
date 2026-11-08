#!/usr/bin/env python3
"""rescore_backlog.py (2026-10-21 speedup C, the user approval policy): give every Strong/Solid To Review job and
every Packaged job that was scored two-way-v1 but has only the jd-analysis .md (no step-6 JSON) its step-6 JSON
by re-running score.py ONCE with the SAME inputs, parsed from that .md (want, want-why, win, base, must-haves with
proof, gaps, blockers, trailing note) plus the row's remote_check. No new judgment: the fit is whatever the rules
give for the same inputs, and any fit change is reported. Legacy-scored rows (no two-way inputs) are only counted:
they need a fresh model scoring (score.py --prompt), not a re-run.

  python3 rescore_backlog.py            dry run: list rows, parsed args, and what cannot be re-run
  python3 rescore_backlog.py --run      back up each .md (.bak-2026-10-21speed), run score.py, compare fit
  python3 rescore_backlog.py --json
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

import argparse, json, os, re, shutil, sqlite3, subprocess, sys
WS = str(_JOBBI_SEARCH); DB = os.path.join(WS, "pipeline", "jobs.db"); PY = sys.executable
SCORE = os.path.join(WS, "pipeline", "score.py")

def has_json(ap): return bool(ap) and os.path.exists(os.path.join(WS, os.path.splitext(ap)[0] + ".json"))
def has_md(ap): return bool(ap) and os.path.exists(os.path.join(WS, ap))

def rows():
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True); c.row_factory = sqlite3.Row
    return c.execute("select * from jobs where (status='To Review' and fit in ('Strong','Solid')) or status='Packaged' order by id").fetchall()

def unesc(s): return s.replace("\\|", "|").strip()

def parse(md):
    """inputs of a two-way-v1 analysis .md written by score.py -> score.py args (None + reason when it can't)."""
    t = md
    m_want = re.search(r"^## Want \(criteria\.md\): \*\*(PASS|FAIL)\*\*\n\n(.*?)\n\n## ", t, re.S | re.M)
    m_win = re.search(r"^## Win \(JD vs (.+?) base resume\): \*\*(HIGH|MEDIUM|LOW|N/A)\*\*", t, re.M)
    m_base = re.search(r"with two-way-v1 against base `([^`]+)`", t)
    m_res = re.search(r"^## Result: \*\*(\w+)\*\*.*$", t, re.M)
    if not (m_want and m_win and m_base and m_res): return None, "md does not have the two-way-v1 sections"
    args = ["--want", m_want.group(1).lower(), "--base", m_base.group(1)]
    why = m_want.group(2).strip()
    if why != "_no note_": args += ["--want-why", why]
    if m_win.group(2) != "N/A": args += ["--win", m_win.group(2).lower()]
    tbl = re.search(r"^\| Must-have \(from the JD\) \| Proof on the resume \|\n\|---\|---\|\n((?:\|.*\|\n?)*)", t, re.M)
    for line in (tbl.group(1).splitlines() if tbl else []):
        cells = [unesc(x) for x in re.split(r"(?<!\\)\|", line.strip())[1:-1]]
        if len(cells) != 2: return None, f"unparseable must-have row: {line!r}"
        need, proof = cells; proof = "" if proof == "**none: gap**" else proof
        args += ["--must", f"{need} :: {proof}" if proof else f"{need} ::"]
    def items(head):
        m = re.search(rf"^### {head}\n\n((?:- .*\n?)*)", t, re.M)
        return [x[2:].strip() for x in (m.group(1).splitlines() if m else [])]
    gaps = [g for g in items("Gaps") if g != "none noted"]; blk = [b for b in items("Blockers") if b != "none"]
    for g in gaps: args += ["--gap", g]
    for b in blk: args += ["--blocker", b]
    note = t[m_res.end():].strip()
    if note: args += ["--note", note]
    return {"args": args, "old_result": m_res.group(1)}, None

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", action="store_true"); ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    todo, skipped, counts = [], [], {}
    for r in rows():
        if has_json(r["analysis_path"]): continue
        key = f"{r['status']} / {r['scored_with'] or 'unscored'} / {'md only' if has_md(r['analysis_path']) else 'no analysis'}"
        counts[key] = counts.get(key, 0) + 1
        if r["scored_with"] != "two-way-v1" or not has_md(r["analysis_path"]): continue
        p, err = parse(open(os.path.join(WS, r["analysis_path"])).read())
        if err: skipped.append({"id": r["id"], "why": err}); continue
        if r["remote_check"]: p["args"] += ["--remote", r["remote_check"]]
        todo.append({"id": r["id"], "company": r["company"], "title": r["title"], "status": r["status"], "fit_before": r["fit"],
                     "md": r["analysis_path"], **p})
    res = []
    if a.run:
        for t in todo:
            md = os.path.join(WS, t["md"]); shutil.copy2(md, md + ".bak-2026-10-21speed")
            pr = subprocess.run([PY, SCORE, "--id", str(t["id"]), *t["args"]], capture_output=True, text=True, timeout=300)
            c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
            fit, status, sw, apn = c.execute("select fit, status, scored_with, analysis_path from jobs where id=?", (t["id"],)).fetchone()
            res.append({**{k: t[k] for k in ("id", "company", "title", "fit_before", "status")}, "rc": pr.returncode,
                        "fit_after": fit, "status_after": status, "json": has_json(apn), "out": (pr.stdout + pr.stderr).strip()[-400:]})
    out = {"counts_without_step6_json": counts, "rescorable": len(todo), "skipped": skipped, "results": res,
           "plan": [] if a.run else [{"id": t["id"], "fit_before": t["fit_before"], "args": t["args"]} for t in todo]}
    if a.json: print(json.dumps(out, indent=1)); return
    for k, v in sorted(counts.items()): print(f"{v:4d}  {k}")
    print(f"re-scorable with the same inputs: {len(todo)}; unparseable: {len(skipped)}")
    for s in skipped: print("  SKIP", s)
    if not a.run:
        for t in todo: print(f"  #{t['id']} {t['fit_before']}: {' '.join(json.dumps(x) for x in t['args'])[:300]}")
    for r in res:
        flag = "" if r["fit_after"] == r["fit_before"] else "  <-- FIT CHANGED"
        print(f"  #{r['id']} rc={r['rc']} {r['fit_before']} -> {r['fit_after']} status {r['status_after']} json={r['json']}{flag}"
              + ("" if r["rc"] == 0 else f"\n     {r['out']}"))

if __name__ == "__main__":
    main()
