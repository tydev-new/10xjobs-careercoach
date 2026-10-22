#!/usr/bin/env python3
"""Eval gate for step 6 of the search skill (two-way fit: want x win -> call).

Run on every change to the skill, criteria.md, the scoring prompt (pipeline/scoring-prompt.md) or the model:
    python3 jobsearch.py evals --backend <backend> --check
--check exits 1 when any metric gets worse than the saved baseline for that backend.

The gate uses the fit schema and code checks (pipeline/fitcheck.py), the one shared scoring prompt
(pipeline/scoring-prompt.md) and a synthetic starter suite (examples/). The live scorer fills the same scoring-prompt.md through
fitcheck.render_prompt, so an edit to it goes through this gate before it reaches live scoring.

Suites
  examples  bundled here: 15 made-up cases, 3 made-up profiles. Baseline: evals/baseline.json
  private   the user's own past postings. NEVER bundled. Location: --private DIR, else $JOB_SEARCH_EVAL_PRIVATE,
            else <home>/evals/private (pipeline/home.py). Baseline and results stay inside that folder.
            Skipped with a message when the folder has no cases.jsonl.

Grading is code only:
  a. the output passes the fitcheck schema            (valid_rate)
  b. the call matches the expected call               (agreement, strong_user_skips, missed_applies)
  c. dealbreakers are caught                          (dealbreaker_recall)
  d. every must-have has non-empty proof or is listed in gaps   (musthave_accounted)
  e. planted prompt-injection cases keep their twin's call      (injection_stable)
Also reported: cost per posting.

Backends (scorer):
  command   --cmd "claude -p"   prompt on stdin, JSON on stdout (any CLI model)
  openai    OpenAI-compatible HTTP: EVAL_BASE_URL, EVAL_API_KEY, EVAL_MODEL, EVAL_PRICE_IN/EVAL_PRICE_OUT ($ per 1M tokens)
  file      --outputs results.jsonl  (outputs written by an agent session: {"id":..., "output": {...}, "tokens_in":..,"tokens_out":..})
            the examples suite ships one: evals/agent-runs/examples-agent-outputs.jsonl
  recorded  the call stored with each private case (what the live scorer said at the time); suites without
            recorded calls are skipped
  rules     deterministic offline scorer (no model) - a smoke baseline, cost 0
"""
import argparse, datetime as dt, json, os, re, subprocess, sys, time, urllib.request
from pipeline import fitcheck as FC
from pipeline import home as H

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PRIVATE = str(H.path("private_evals"))
DEFAULT_RESULTS = str(H.home() / "evals" / "results")
SUITE_NAMES = ["examples", "private"]
SUITES = {"examples": os.path.join(HERE, "examples"),
          "private": os.environ.get("JOB_SEARCH_EVAL_PRIVATE") or DEFAULT_PRIVATE}
WEIGHTS = {"missed_apply": 3, "strong_user_skip": 2, "other": 1}
TOL = {"agreement": 0.02, "dealbreaker_recall": 0.0, "musthave_accounted": 0.0, "valid_rate": 0.0, "cost_ratio": 1.25}

def norm_call(c):
    return "Skip" if c in ("Skip", "Weak") else c

def load_suite(name):
    d = SUITES[name]
    path = os.path.join(d, "cases.jsonl")
    if not os.path.exists(path):
        return [], {}
    cases = [json.loads(l) for l in open(path) if l.strip()]
    profiles = {}
    for c in cases:
        p = c["profile"]
        if isinstance(p, str) and p not in profiles:
            profiles[p] = json.load(open(os.path.join(d, "profiles", f"{p}.json")))
    return cases, profiles

def profile_of(case, profiles):
    p = case["profile"] if isinstance(case["profile"], dict) else profiles[case["profile"]]
    out = dict(p)
    for k in ("criteria", "resume"):
        if out.get(k + "_path") and not out.get(k):
            out[k] = open(out[k + "_path"]).read()
    return out

def build_prompt(case, prof):
    return FC.render_prompt(prof["criteria"], prof["resume"], case["posting"])   # the one shared scoring prompt

def parse_json(text):
    m = re.search(r"\{.*\}", text or "", re.S)
    return json.loads(m.group(0)) if m else None

# ---------------------------------------------------------------- scorer backends
def pay_top(pay):
    nums = []
    for n, k in re.findall(r"\$\s?(\d[\d,]*(?:\.\d+)?)\s*([kK])?", pay or ""):
        v = float(n.replace(",", "")) * (1000 if k else 1)
        nums.append(v * 2080 if v < 1000 else v)   # hourly -> yearly
    return max(nums) if nums else None

def rules_score(case, prof):
    """offline deterministic scorer; no model. Profile 'rules' block drives it."""
    R, po = prof.get("rules", {}), case["posting"]
    jd = (po.get("jd_text") or "")
    jd_req = re.split(r"\n\s*(?:NOTE|\[system\]|SYSTEM)", jd, maxsplit=1, flags=re.I)[0]   # embedded instructions are data, ignored
    title, loc = po["title"].lower(), (po.get("location") or "").lower()
    text = (po["title"] + "\n" + jd_req).lower()
    deal, why = [], []
    remote = re.search(r"\bremote\b", loc) and not re.search(r"on-?site|relocat", loc)
    if not (remote and R.get("remote_us_ok")) and not any(x in loc for x in R.get("locations_ok", [])):
        deal.append("geo"); why.append(f"location {po.get('location')}")
    top = pay_top(po.get("pay"))
    if R.get("pay_floor") and top is not None and top < R["pay_floor"]:
        deal.append("pay"); why.append(f"pay top {top:,.0f} < floor {R['pay_floor']:,}")
    if R.get("no_clearance") and re.search(r"clearance|ts/sci|secret\b", text):
        deal.append("clearance"); why.append("clearance required")
    if R.get("employee_only") and re.search(r"\bcontract\b|1099|/hour|per hour", text + " " + (po.get("pay") or "").lower()):
        deal.append("contract"); why.append("contract role")
    if any(re.search(x, title) for x in R.get("exclude", [])):
        deal.append("seniority" if re.search(r"senior|lead|principal|manager|director|head", title) else "off-lane"); why.append("excluded title")
    elif R.get("lanes") and not any(re.search(x, title) for x in R["lanes"]):
        deal.append("off-lane"); why.append("title outside the lanes")
    if deal:
        return {"want": "fail", "want_reasons": why, "dealbreakers": sorted(set(deal)), "win": None, "must_haves": [], "gaps": [], "blockers": [],
                "reason": "want fails: " + "; ".join(why)}
    reqs = [l.strip("-• ").strip() for l in jd_req.splitlines() if l.strip().startswith(("-", "•"))] or [l for l in jd_req.splitlines() if l.strip()][:4]
    resume = prof["resume"].lower()
    skills = [s for s in R.get("skills", [])]
    musts, gaps, blockers = [], [], []
    for r in reqs:
        rl = r.lower()
        hits = [s for s in skills if s in rl and s in resume]
        ok = bool(hits) and not re.search(r"product management|prd|rust|embedded|rtos|iso 26262|phd|terraform|insurance|claims", rl)
        musts.append({"need": r[:300], "proof": ("resume: " + ", ".join(hits))[:400] if ok else None})
        if not ok:
            (blockers if re.search(r"licen[cs]e|certification|clearance|phd|\d+\+ years of (?:rust|product)|rust in production|rtos", rl) and "nice" not in rl and "preferred" not in rl else gaps).append(r[:200])
    share = sum(1 for m in musts if m["proof"]) / max(1, len(musts))
    core_missing = bool(musts) and not musts[0]["proof"]
    win = "high" if share >= 0.75 and not blockers else "medium" if share >= 0.5 and not core_missing else "low"
    return {"want": "pass", "want_reasons": ["location, pay, level and lane meet the criteria"], "dealbreakers": [], "win": win,
            "must_haves": musts or [{"need": "(no explicit requirements)", "proof": None}], "gaps": gaps, "blockers": blockers,
            "reason": f"want pass; {sum(1 for m in musts if m['proof'])}/{len(musts)} must-haves proven"}

def openai_call(prompt):
    base, key, model = os.environ["EVAL_BASE_URL"].rstrip("/"), os.environ["EVAL_API_KEY"], os.environ["EVAL_MODEL"]
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0}).encode()
    req = urllib.request.Request(base + "/chat/completions", data=body, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    d = json.load(urllib.request.urlopen(req, timeout=120))
    u = d.get("usage", {})
    return d["choices"][0]["message"]["content"], u.get("prompt_tokens", 0), u.get("completion_tokens", 0)

def cost(tin, tout):
    return tin / 1e6 * float(os.environ.get("EVAL_PRICE_IN", 0)) + tout / 1e6 * float(os.environ.get("EVAL_PRICE_OUT", 0))

def score_case(case, prof, a, outputs):
    t0 = time.time()
    if a.backend == "rules":
        return rules_score(case, prof), 0.0, time.time() - t0
    if a.backend == "recorded":
        return case.get("recorded"), 0.0, 0.0
    if a.backend == "file":
        o = outputs.get(case["id"]) or {}
        return o.get("output"), cost(o.get("tokens_in", 0), o.get("tokens_out", 0)) if o else 0.0, 0.0
    prompt = build_prompt(case, prof)
    if a.backend == "command":
        r = subprocess.run(a.cmd, shell=True, input=prompt, capture_output=True, text=True, timeout=300)
        tin, tout = len(prompt) // 4, len(r.stdout) // 4   # estimate when the CLI does not report usage
        return parse_json(r.stdout), cost(tin, tout), time.time() - t0
    text, tin, tout = openai_call(prompt)
    return parse_json(text), cost(tin, tout), time.time() - t0

# ---------------------------------------------------------------- run + metrics
def run_suite(name, a, outputs):
    cases, profiles = load_suite(name)
    rows = []
    for c in cases:
        prof = profile_of(c, profiles)
        raw, usd, secs = score_case(c, prof, a, outputs)
        res, err = FC.check(raw) if raw is not None else (None, "no output")
        call = norm_call(res.call) if res else None
        exp = c["expected"]["call"]
        exp_set = {norm_call(x) for x in (exp if isinstance(exp, list) else [exp])}
        db_exp = set(c["expected"].get("dealbreakers") or [])
        rows.append({"id": c["id"], "valid": res is not None, "error": err, "call": call, "expected": sorted(exp_set),
                     "agree": call in exp_set, "dealbreakers_expected": sorted(db_exp),
                     "dealbreakers_caught": bool(res) and res.want == "fail" and db_exp <= set(res.dealbreakers),
                     "outcome": c.get("outcome"), "injection": c.get("injection"), "twin_of": c.get("twin_of"),
                     "cost": usd, "seconds": round(secs, 2),
                     "unaccounted_must_haves": FC.unaccounted_must_haves(res) if res else None,
                     "output": res.model_dump() if res else raw})
    return rows

def metrics(rows):
    n = len(rows) or 1
    scored = [r for r in rows if r["valid"]]
    by = {r["id"]: r for r in rows}
    applied = [r for r in rows if r["outcome"] in ("applied", "interviewed") or (r["outcome"] is None and set(r["expected"]) <= {"Strong", "Solid"})]
    user_skip = [r for r in rows if r["outcome"] == "user_skip" or (r["outcome"] is None and r["expected"] == ["Skip"])]
    missed = [r for r in applied if r["call"] not in ("Strong", "Solid")]
    strong_skip = [r for r in user_skip if r["call"] == "Strong"]
    other = [r for r in rows if not r["agree"] and r not in missed and r not in strong_skip]
    dbe = [r for r in rows if r["dealbreakers_expected"]]
    inj = [r for r in rows if r["injection"] and r["twin_of"] in by]
    mh = [r for r in rows if r["unaccounted_must_haves"] is not None]
    return {
        "cases": len(rows), "valid_rate": round(len(scored) / n, 3),
        "agreement": round(sum(r["agree"] for r in rows) / n, 3),
        "strong_user_skips": len(strong_skip), "user_skip_cases": len(user_skip),
        "missed_applies": len(missed), "apply_cases": len(applied),
        "weighted_error": round((WEIGHTS["missed_apply"] * len(missed) + WEIGHTS["strong_user_skip"] * len(strong_skip) + WEIGHTS["other"] * len(other)) / n, 3),
        "dealbreaker_recall": round(sum(r["dealbreakers_caught"] for r in dbe) / len(dbe), 3) if dbe else None,
        "injection_stable": all(r["call"] == by[r["twin_of"]]["call"] for r in inj) if inj else None,
        "musthave_accounted": round(sum(not r["unaccounted_must_haves"] for r in mh) / len(mh), 3) if mh else None,
        "cost_per_posting_usd": round(sum(r["cost"] for r in rows) / n, 5),
        "seconds_per_posting": round(sum(r["seconds"] for r in rows) / n, 2),
        "disagreements": [r["id"] for r in rows if not r["agree"]],
    }

def baseline_path(suite):
    return os.path.join(SUITES["private"] if suite == "private" else HERE, "baseline.json")

def results_dir(suite):
    """private results stay with the private data; examples results go to --results / $JOB_SEARCH_EVAL_RESULTS,
    else <home>/evals/results (never into the code folder)."""
    if suite == "private":
        return os.path.join(SUITES["private"], "results")
    env = os.environ.get("JOB_SEARCH_EVAL_RESULTS")
    if env:
        return env
    return DEFAULT_RESULTS

def regressions(m, b):
    out = []
    if b.get("agreement") is not None and m["agreement"] < b["agreement"] - TOL["agreement"]: out.append(f"agreement {b['agreement']} -> {m['agreement']}")
    if m["missed_applies"] > b.get("missed_applies", 0): out.append(f"missed applies {b.get('missed_applies')} -> {m['missed_applies']}")
    if m["strong_user_skips"] > b.get("strong_user_skips", 0): out.append(f"Strong picks the user would skip {b.get('strong_user_skips')} -> {m['strong_user_skips']}")
    if b.get("dealbreaker_recall") is not None and (m["dealbreaker_recall"] or 0) < b["dealbreaker_recall"] - TOL["dealbreaker_recall"]: out.append(f"dealbreaker recall {b['dealbreaker_recall']} -> {m['dealbreaker_recall']}")
    if m["valid_rate"] < b.get("valid_rate", 1.0) - TOL["valid_rate"]: out.append(f"valid output rate {b.get('valid_rate')} -> {m['valid_rate']}")
    if b.get("injection_stable") and m["injection_stable"] is False: out.append("prompt-injection case moved the score")
    if b.get("musthave_accounted") is not None and (m["musthave_accounted"] or 0) < b["musthave_accounted"] - TOL["musthave_accounted"]: out.append(f"must-haves accounted for {b['musthave_accounted']} -> {m['musthave_accounted']}")
    if b.get("cost_per_posting_usd") and m["cost_per_posting_usd"] > b["cost_per_posting_usd"] * TOL["cost_ratio"]: out.append(f"cost per posting {b['cost_per_posting_usd']} -> {m['cost_per_posting_usd']}")
    return out

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--suite", action="append", choices=SUITE_NAMES, help="examples, private (default: both)")
    ap.add_argument("--private", metavar="DIR", help="private suite folder (default: $JOB_SEARCH_EVAL_PRIVATE or " + DEFAULT_PRIVATE + ")")
    ap.add_argument("--results", metavar="DIR", help="where examples results go (private results stay in the private folder)")
    ap.add_argument("--backend", default="rules", choices=["rules", "recorded", "file", "command", "openai"])
    ap.add_argument("--cmd"); ap.add_argument("--outputs", help="file backend: outputs jsonl")
    ap.add_argument("--save-baseline", action="store_true"); ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.private:
        SUITES["private"] = os.path.abspath(a.private)
    if a.results:
        os.environ["JOB_SEARCH_EVAL_RESULTS"] = os.path.abspath(a.results)
    outputs = {json.loads(l)["id"]: json.loads(l) for l in open(a.outputs) if l.strip()} if a.outputs else {}
    print(f"scoring prompt: {FC.PROMPT_PATH}")
    failed = False
    for s in a.suite or SUITE_NAMES:
        if s == "private" and not os.path.exists(os.path.join(SUITES["private"], "cases.jsonl")):
            print(f"[private] SKIP: no private suite at {SUITES['private']} (set --private DIR or $JOB_SEARCH_EVAL_PRIVATE). "
                  "Only the bundled examples were checked."); continue
        cases, _ = load_suite(s)
        if a.backend == "recorded" and not any(c.get("recorded") is not None for c in cases):
            print(f"[{s}] SKIP: no recorded calls in this suite (recorded only replays the private suite)"); continue
        if a.backend == "file" and not any(c["id"] in outputs for c in cases):
            print(f"[{s}] SKIP: --outputs has no rows for this suite"); continue
        rows = run_suite(s, a, outputs)
        if not rows:
            print(f"[{s}] no cases"); continue
        m = metrics(rows)
        stamp = dt.datetime.now().strftime("%Y-%m-%d-%H%M%S")
        res_dir = results_dir(s)
        os.makedirs(res_dir, exist_ok=True)
        out = os.path.join(res_dir, f"{s}-{a.backend}-{stamp}.json")
        json.dump({"suite": s, "backend": a.backend, "prompt": FC.PROMPT_PATH, "at": stamp, "metrics": m, "rows": rows}, open(out, "w"), indent=1, default=str)
        print(f"[{s}] backend={a.backend} " + json.dumps({k: v for k, v in m.items() if k != "disagreements"}))
        print(f"[{s}] disagreements: {', '.join(m['disagreements']) or 'none'} -> {out}")
        bp = baseline_path(s)
        base = json.load(open(bp)) if os.path.exists(bp) else {}
        key = a.backend
        if a.save_baseline:
            base[key] = {**{k: v for k, v in m.items() if k != "disagreements"}, "saved": stamp, "results": os.path.basename(out)}
            json.dump(base, open(bp, "w"), indent=1)
            print(f"[{s}] baseline saved -> {bp} [{key}]")
        if a.check:
            if key not in base:
                print(f"[{s}] CHECK: no baseline for backend {key} (run with --save-baseline first)"); failed = True
            else:
                reg = regressions(m, base[key])
                print(f"[{s}] CHECK {'FAIL: ' + '; '.join(reg) if reg else 'pass'}")
                failed |= bool(reg)
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
