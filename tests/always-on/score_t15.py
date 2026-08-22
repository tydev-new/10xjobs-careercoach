#!/usr/bin/env python3
"""Deterministic scorer for t15 — checker head-to-head.

No judge model: each case ships truth.json (the planted violations), and
both conditions' outputs are matched against it mechanically.

  catch       a truth violation matched by a same-rule flag whose quoted
              content contains one of the truth keywords (length: any flag)
  false alarm a flag in one of the four scored rules matching NO truth row
              (both conditions' out-of-scope output is ignored — the py
              checker's structure rungs are not on trial here)
  stability   whether the per-rule verdict set is identical across runs
  holes       (agent only) required per-rule rows missing from the table

Usage: python3 score_t15.py <tag>
"""
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
# the production contract's rule set (letter_length was the v1 harness
# era's; it lives in code now and is scored only where a truth lists it)
RULES = ["struck_form", "never_say", "confirm_qualifier"]
# cases derive from the fixture dir (FIXDIR env overrides) — the fresh
# family (different author, #29 gate) runs through the same scorer


# py output line -> (rule, quoted content) for the four scored rules only
PY_PATTERNS = [
    ("struck_form",       re.compile(r'struck form: "([^"]+)"')),
    ("never_say",         re.compile(r'never-say list: "([^"]+)"')),
    ("confirm_qualifier", re.compile(r'confirm-before-use claim present: "([^"]+)"')),
    ("letter_length",     re.compile(r'letter is (\d+) words')),
]


def py_flags(path):
    flags = []
    for line in open(path, encoding="utf-8"):
        for rule, pat in PY_PATTERNS:
            m = pat.search(line)
            if m:
                flags.append({"rule": rule, "evidence": m.group(1)})
    return flags


def agent_flags(path):
    """Returns (flags, holes, parse_error). Tolerates fenced or prefixed JSON."""
    raw = open(path, encoding="utf-8").read()
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        return [], RULES[:], "no JSON object found"
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError as e:
        return [], RULES[:], f"bad JSON: {e}"
    rows = data.get("rules", [])
    flags = [{"rule": r.get("rule"), "file": r.get("file"),
              "evidence": r.get("evidence", ""), "why": r.get("why", "")}
             for r in rows if r.get("verdict") == "flag"]
    seen = {r.get("rule") for r in rows}
    holes = [r for r in RULES if r not in seen]
    return flags, holes, None


def _norm(t):
    return re.sub(r"\s+", " ", (t or "").lower()).strip()


def score(flags, truth, docs):
    """Hardened per the graduation review (2026-08-18): a catch requires
    the truth's rule AND file to match, the quoted evidence to be a real
    span OF THAT DOCUMENT (rule-text quoting scores nothing), and a
    length flag to report the CORRECT count."""
    caught, used = [], set()
    for i, v in enumerate(truth):
        hit = False
        for j, f in enumerate(flags):
            if j in used or f["rule"] != v["rule"]:
                continue
            if v.get("file") and f.get("file") and f["file"] != v["file"]:
                continue
            ev = _norm(f["evidence"])
            if v["rule"] == "letter_length":
                m = re.search(r"\b(\d{2,4})\b", ev or _norm(f.get("why", "")))
                if not m or int(m.group(1)) != v.get("count", -1):
                    continue
            else:
                doc = _norm(docs.get(v.get("file", ""), ""))
                if not ev or ev not in doc:
                    continue  # evidence must be copied from the document
                if v["keywords"] and not any(k.lower() in ev for k in v["keywords"]):
                    continue
            used.add(j); hit = True; break
        caught.append(hit)
    false_alarms = [f for j, f in enumerate(flags) if j not in used]
    return caught, false_alarms


def main():
    tag = sys.argv[1]
    results = os.path.join(ROOT, "results", f"t15-{tag}")
    grand = {"py": [0, 0, 0], "agent": [0, 0, 0]}  # catches, total, false alarms
    fixdir = os.environ.get("FIXDIR") or os.path.join(ROOT, "fixtures/t15")
    cases = sorted(os.path.basename(d) for d in glob.glob(os.path.join(fixdir, "cases", "*")))
    for case in cases:
        cdir = os.path.join(fixdir, "cases", case)
        if not os.path.isdir(cdir):
            continue
        truth_all = json.load(open(os.path.join(cdir, "truth.json")))["violations"]
        docs = {}
        for f in glob.glob(os.path.join(cdir, "applications", "*.md")):
            docs[os.path.splitext(os.path.basename(f))[0]] = open(f, encoding="utf-8").read()
        for cond, loader in (("py", py_flags), ("agent", None)):
            truth = [v for v in truth_all if v.get("owner", "both") in (cond, "both")]
            if cond == "py":
                print(f"\n=== {case} ({len(truth_all)} planted)")
            runs = sorted(glob.glob(os.path.join(results, f"{case}.{cond}.*.json" if cond == "agent" else f"{case}.{cond}.*.txt")))
            verdict_sets, per_run = [], []
            for r in runs:
                if cond == "py":
                    flags, holes, err = py_flags(r), [], None
                else:
                    flags, holes, err = agent_flags(r)
                caught, fa = score(flags, truth, docs)
                per_run.append((os.path.basename(r), caught, fa, holes, err))
                verdict_sets.append(frozenset((f["rule"], f["evidence"][:40]) for f in flags))
            # two levels: verdicts (what was flagged) vs spans (how it was quoted).
            # v1 measured: agent verdicts identical every case; only span
            # boundaries varied — report both, don't let excerpt wobble
            # masquerade as verdict instability.
            span_stable = len(set(verdict_sets)) <= 1
            vsets = [frozenset(f["rule"] for f in (py_flags(r) if cond == "py" else agent_flags(r)[0])) for r in runs]
            stable = len(set(vsets)) <= 1
            for name, caught, fa, holes, err in per_run:
                bits = f"  {cond:5s} {name}: {sum(caught)}/{len(truth)} caught, {len(fa)} false alarm(s)"
                if holes: bits += f", HOLES: {holes}"
                if err:   bits += f", PARSE ERROR: {err}"
                print(bits)
                for i, v in enumerate(truth):
                    if not caught[i]:
                        print(f"          missed: {v['rule']} ({v['keywords']})")
                for f in fa:
                    print(f"          false alarm: {f['rule']}: \"{f['evidence'][:60]}\"")
            print(f"  {cond:5s} stability across {len(runs)} runs: verdicts {'IDENTICAL' if stable else 'DIVERGENT'}, quoted spans {'identical' if span_stable else 'vary'}")
            if per_run:
                # a condition's case score = its MEDIAN run (fair to both)
                mid = sorted(per_run, key=lambda p: sum(p[1]))[len(per_run) // 2]
                grand[cond][0] += sum(mid[1]); grand[cond][1] += len(truth)
                grand[cond][2] += len(mid[2])
    print("\n=== GRAND (median run per case)")
    for cond in ("py", "agent"):
        c, t, fa = grand[cond]
        print(f"  {cond:5s}: {c}/{t} caught, {fa} false alarms")


if __name__ == "__main__":
    main()
