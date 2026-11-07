#!/usr/bin/env python3
'finalize_review.py: the ONE review step (2026-10-21 simplification, the user approval policy).\nCombined-review workflow: ONE combined reviewer writes reviews/combined.json\n(combined-review-v1, tools/combined_review_schema.json, rework/reviewer-brief.md) with one verdict per angle\n(hiring_manager, recruiter, ats, age_signal_claims). The old 4 lens files are still accepted when there is no combined.json.\nMerges the review (combined file, or the 4 independent lens files) and records the verdict (README stamp, review-3lens.md block, review.json,\njobs.db package_runs) in one go. Replaces reconcile_reviews.py + stamp_review.py on the required path.\n\n  python3 finalize_review.py <pkg>             merge + record.  exit 0 = PASS recorded, 2 = REVISE/FAIL recorded, 1 = refused\n  python3 finalize_review.py <pkg> --dry-run   print the merged review and stamp, write nothing\n  python3 finalize_review.py <pkg> --user-ok "<genuine user approval reference>"   record an escalated round beyond the configured free-round policy\n  python3 finalize_review.py <pkg> --hold-ok "<genuine user approval reference>"   apply despite cant_fix rejection reasons\n  2026-11-05: combined reviews need rejection_reasons; an unapplied \'fixed\' line makes the final REVISE (builder round,\n  tools/builder_feedback.py); \'cant_fix\' items hold the package (--verify fails) until --hold-ok.\n  python3 finalize_review.py <pkg> --verify    submit time (submit_gate.py): exit 0 only if review.json is a finalize_review.py\n                                               PASS, the lens files and resume/cover are unchanged since, and the kept\n                                               code gates still pass\n\nRounds within max_review_rounds are recorded as usual. The next round is recorded without new user approval only when wording_check.py says\nthe fix since the last finalized round is wording-only (no new claim, number, term or bullet; precheck clean); otherwise\na non-wording next round, and every later round, needs --user-ok "<ref>" (or user_ok in combined.json) and is refused without it.\nEvery recorded finalize snapshots resume-native.md / cover.txt / package.yaml to reviews/round<N>/ for that comparison.\nRefuses (exit 1, writes nothing) when the review is not usable:\n  - any of reviews/{hiring_manager,age_signal_claims,recruiter,ats}.json missing or not lens-review-v1\n  - a lens file names another lens or package\n  - (4-lens mode) reviewer_run_id values not distinct; (both modes) the reviewer is a builder run (package.yaml builder_runs; build_package.py --write)\n  - resume-native.md / cover.txt changed since a lens reviewed it (sha mismatch), or a lens skipped a shipped doc\nOtherwise it ALWAYS records the verdict: worst lens verdict wins (FAIL > REVISE > PASS); all findings kept.\nThe kept code gates are re-run once and folded in: a claims, JD-copy (8+ words) or format failure makes the final FAIL.\nNothing else is re-run (no lint length/style rules, no gap_check, no ATS 85% threshold: the lenses judge those).\nATS hits / coverage / longest JD copy run are computed by ats_check.py and reported for the ats lens; they never block.\n'

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

import argparse, datetime as dt, json, re, subprocess, sys
from pathlib import Path
import jsonschema
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(_JOBBI_APPS / 'lib'))
import ats_check, format_check, reconcile_reviews as RR
import claims as CL

VERSION = "finalize-2026-11-05"
COMBINED = "reviews/combined.json"
import wording_check as WC
LENSES, GOAL, RANK, CASE = RR.LENSES, RR.GOAL, RR.RANK, RR.CASE
LABEL = {"hiring_manager": "Hiring manager", "age_signal_claims": "Age signal and claims", "recruiter": "Recruiter", "ats": "ATS"}

def load_combined(pkg):
    """reviews/combined.json -> the same per-lens dict the 4-lens path uses (every lens points at combined.json)."""
    pkg = Path(pkg); f = pkg / COMBINED
    try: d = json.loads(f.read_text())
    except json.JSONDecodeError as e: return None, [f"JSON {COMBINED}: {e}"]
    sch = json.loads((HERE / "combined_review_schema.json").read_text())
    sch["properties"]["gap_handling"] = json.loads((HERE / "review_schema.json").read_text())["properties"]["gap_handling"]
    try: jsonschema.validate(d, sch)
    except jsonschema.ValidationError as e:
        return None, [f"SCHEMA {COMBINED} {'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message[:200]}"]
    errs = []
    if d["package"] != pkg.name: errs.append(f"PACKAGE {COMBINED} is for {d['package']!r}, not {pkg.name!r}")
    worst = max([a["verdict"] for a in d["angles"].values()] + [x["verdict"] for x in d["docs"]], key=RANK.get)
    if d["verdict"] != worst: errs.append(f"VERDICT {COMBINED} verdict {d['verdict']} is not the worst angle/doc verdict ({worst})")
    if errs: return None, errs
    L, h = {}, RR.sha(f)
    for l in LENSES:
        a = d["angles"][l]
        x = {"schema": "lens-review-v1", "lens": l, "package": d["package"], "reviewer_run_id": d["reviewer_run_id"],
             "rubric_version": d["rubric_version"], "reviewed_at": d["reviewed_at"], "reviewed_files_sha256": d["reviewed_files_sha256"],
             "round": d["round"], "verdict": a["verdict"],
             "docs": [{"doc": x["doc"], "verdict": max(a["verdict"], x["verdict"], key=RANK.get) if l == "hiring_manager" else a["verdict"],
                       "summary": a["summary"]} for x in d["docs"]],
             "findings": a["findings"] or [{"doc": "resume", "severity": "note", "finding": "no findings for this angle", "evidence": a["summary"]}],
             "residual_gaps": d.get("residual_gaps") or [], "_file": COMBINED, "_sha": h, "_combined": d}
        if l == "hiring_manager": x.update(top_rejection_reason=d["top_rejection_reason"], answered=d["answered"])
        if l == "ats": x["keywords"] = d["keywords"]
        if l == "age_signal_claims": x["gap_handling"] = d.get("gap_handling") or []
        L[l] = x
    return L, []

def load_review(pkg):
    """(L, errs, mode): reviews/combined.json when present, else the 4 lens files."""
    if (Path(pkg) / COMBINED).exists():
        L, errs = load_combined(pkg); return L, errs, "combined"
    L, errs = RR.load_lenses(pkg); return L, errs, "4-lens"

def round_rule(pkg, rnd, user_ok=None):
    """(ok, note). Configured initial rounds; next round only if wording-only; later rounds require recorded user OK."""
    if rnd <= (_JOBBI_POLICY.get("max_review_rounds") or 0): return True, None
    if user_ok: return True, f"round {rnd} approved by the user: {user_ok}"
    if rnd == (_JOBBI_POLICY.get("max_review_rounds") or 0) + 1:
        w = WC.check(pkg, before_round=rnd)
        if w["wording_only"]:
            return True, f"round {rnd} recorded without the user: wording-only fix vs {w['baseline']} ({w['changed_sentences']} sentence(s) changed; wording_check.py)"
        return False, f"ROUND round {rnd} is not wording-only (" + "; ".join(w["reasons"])[:300] + "): escalate to the user, then rerun with --user-ok \"<ref>\""
    return False, f"ROUND round {rnd} always needs the user: escalate with the review file, then rerun with --user-ok \"<ref>\""

def warn_coverage(pkg, L, mode):
    """2026-11-04b: every current precheck WARN needs a combined.json precheck_warns entry (accepted + reason, or fixed).
    A 'fixed' entry whose WARN still fires is refused too. Combined mode only (the old 4-lens files predate WARN ids)."""
    if mode != "combined": return []
    import precheck as PC
    r = PC.run(pkg); cur = {PC.warn_id(w): w for w in r["warn"]}
    got = {x["id"]: x for x in (L["ats"]["_combined"].get("precheck_warns") or [])}
    errs = [f"WARN {i} not addressed in combined.json precheck_warns (accept with a reason or fix): {w[:120]}" for i, w in cur.items() if i not in got]
    errs += [f"WARN {i} marked fixed but precheck still reports it: {cur[i][:120]}" for i, x in got.items() if x["action"] == "fixed" and i in cur]
    return errs

def best_candidate(L, mode):
    """Workflow rule: combined.json must carry best_candidate (3-5 JD asks). A 'missing' or 'buried' top
    reason fails hiring_manager, so it can't be PASS; every non-'yes' entry needs a suggested_line or a question_for_user;
    proof ids must be confirmed claims.yaml ids. Combined mode only (4-lens files predate it)."""
    if mode != "combined": return []
    c = L["ats"]["_combined"]; bc = c.get("best_candidate")
    if not bc: return ["BEST-CANDIDATE combined.json has no best_candidate list (question #1 in reviewer-brief.md): re-review"]
    errs = []
    try: ok_ids = {x["id"] for x in CL.load()["claims"] if x.get("status") == "approved"}
    except Exception: ok_ids = None
    hm = c["angles"]["hiring_manager"]["verdict"]
    for i, b in enumerate(bc, 1):
        if b["on_resume"] in ("missing", "buried") and hm == "PASS":
            errs.append(f"BEST-CANDIDATE ask {i} {b['ask'][:60]!r} is {b['on_resume']}: hiring_manager cannot be PASS")
        if b["on_resume"] != "yes" and not (b.get("suggested_line") or b.get("question_for_user")):
            errs.append(f"BEST-CANDIDATE ask {i} {b['ask'][:60]!r} is {b['on_resume']} with no suggested_line or question_for_user")
        if ok_ids is not None:
            bad = [x for x in b["proof_claim_ids"] if x not in ok_ids]
            if bad: errs.append(f"BEST-CANDIDATE ask {i} cites unconfirmed or unknown claim id(s) {bad}: confirmed facts only (ask the user instead)")
    return errs

def _norm(t): return " ".join(re.findall(r"[a-z0-9$%+]+", t.lower()))

def approved_ids():
    try: return {x["id"] for x in CL.load()["claims"] if x.get("status") == "approved"}
    except Exception: return None

def rejection_reasons(pkg, L, mode):
    """Workflow rule. Returns (errs, holds, pending). errs refuse finalize; holds = cant_fix items (package held
    for the user; submit_gate blocks until holds_ack); pending = fixed items whose suggested line is not on the resume yet
    (final becomes REVISE: one more builder round)."""
    if mode != "combined": return [], [], []
    c = L["ats"]["_combined"]; rr = c.get("rejection_reasons")
    if not rr: return ["REJECTION combined.json has no rejection_reasons (1-5 items; reviewer-brief.md): re-review"], [], []
    errs, holds, pending = [], [], []
    ok = approved_ids(); md = _norm((Path(pkg) / "resume-native.md").read_text()) if (Path(pkg) / "resume-native.md").exists() else ""
    for i, r in enumerate(rr, 1):
        tag = f"REJECTION {i} {r['reason'][:60]!r}"
        o = r["outcome"]
        if o == "fixed":
            ids = r.get("proof_claim_ids") or []
            if not ids: errs.append(f"{tag} fixed needs proof_claim_ids (approved claims only)")
            elif ok is not None and (bad := [x for x in ids if x not in ok]): errs.append(f"{tag} fixed cites unapproved or unknown claim id(s) {bad}: use cant_fix + question_for_user")
            if not r.get("suggested_line"): errs.append(f"{tag} fixed needs the suggested_line")
            elif _norm(r["suggested_line"]) not in md: pending.append({"source": "rejection_reasons", "reason": r["reason"], "line": r["suggested_line"], "claim_ids": ids})
        elif o == "cant_fix":
            if not (r.get("question_for_user") or r.get("screen_out_note")): errs.append(f"{tag} cant_fix needs question_for_user or screen_out_note")
            else: holds.append({"reason": r["reason"], "question_for_user": r.get("question_for_user"), "screen_out_note": r.get("screen_out_note")})
        elif o == "not_a_risk" and not r.get("reason_not_risk"): errs.append(f"{tag} not_a_risk needs reason_not_risk")
    return errs, holds, pending

def builder_lines(L, pending):
    """lines for the next builder round: pending fixed rejection reasons + best_candidate suggested lines not on the resume."""
    out = list(pending)
    for b in (L["ats"].get("_combined") or {}).get("best_candidate") or []:
        if b["on_resume"] != "yes" and b.get("suggested_line"):
            out.append({"source": "best_candidate", "reason": b["ask"], "line": b["suggested_line"], "claim_ids": b["proof_claim_ids"]})
    return out

def usable(pkg, L, cover, mode="4-lens"):
    errs = warn_coverage(pkg, L, mode) + best_candidate(L, mode) + rejection_reasons(pkg, L, mode)[0]
    ids = {l: d["reviewer_run_id"] for l, d in L.items()}
    if mode == "4-lens" and len(set(ids.values())) != len(ids): errs.append(f"RUN-ID reviewer_run_id values are not distinct: {ids}")
    built = set(RR.builder_runs(pkg))
    if not built: errs.append("BUILDER package.yaml has no builder_runs: rebuild with build_package.py --write --run-id <run> so the builder is known")
    for l, r in ids.items():
        if r in built: errs.append(f"RUN-ID {l} was reviewed by builder run {r!r}: a package is never reviewed by the run that built it")
        if mode == "combined": break
    now = RR.file_hashes(pkg)
    need = {"resume"} | ({"cover"} if cover == "attached" else set())
    for l, d in L.items():
        for f, h in now.items():
            if f == "cover.txt" and cover == "none": continue
            if d["reviewed_files_sha256"].get(f) != h: errs.append(f"STALE {l if mode == '4-lens' else 'combined review'} reviewed an older {f}: re-run the review on the current files")
        docs = {x["doc"] for x in d["docs"]}
        if not need <= docs: errs.append(f"DOCS {l if mode == '4-lens' else 'combined review'} did not review {sorted(need - docs)} (cover={cover})")
        if mode == "combined": break
    return errs

def gates(pkg):
    """the kept code gates, run once on the package as it is now."""
    pkg = Path(pkg); out = {}
    r = subprocess.run([sys.executable, str(HERE / "check_claims.py"), str(pkg)], capture_output=True, text=True)
    out["claims"] = {"ok": r.returncode == 0, "fails": [l.strip() for l in r.stdout.splitlines() if "FAIL" in l and not l.strip().startswith(("Claims check", "Result"))][:20]}
    a = ats_check.compute(pkg, []) if (pkg / "jd.md").exists() else {"max_jd_copy_run": 0, "max_jd_copy_text": ""}
    out["jd_copy"] = {"ok": a["max_jd_copy_run"] < 8, "max_run": a["max_jd_copy_run"], "text": a["max_jd_copy_text"]}
    f, w = format_check.check(pkg)
    out["format"] = {"ok": not f, "fails": f, "warns": len(w), "version": format_check.FORMAT_VERSION}
    import precheck as PC                                  # 2026-11-04b: every hard-fact FAIL also gates finalize / verify
    pr = PC.run(pkg)
    out["precheck"] = {"ok": not pr["fail"], "fails": pr["fail"][:20], "warns": len(pr["warn"]), "version": PC.VERSION}
    return out

def merge(pkg, L, cover, G, mode="4-lens", round_note=None):
    pkg = Path(pkg); spec = RR.spec_of(pkg); job_id, s6 = RR.job_of(pkg)
    lenses = []
    for l in LENSES:
        d = L[l]
        for doc in sorted({x["doc"] for x in d["docs"]} & ({"resume", "cover"} if cover == "attached" else {"resume"}), key=["resume", "cover"].index):
            dv = next(x for x in d["docs"] if x["doc"] == doc)
            fs = [f for f in d["findings"] if f["doc"] == doc]
            e = {"lens": l, "goal": GOAL[l], "doc": doc, "verdict": CASE[dv["verdict"]], "round_checked": d.get("round", 1),
                 "reasons": [dv["summary"]] + [f"[{f['severity']}] {f['finding']} (evidence: {f['evidence']})" for f in fs]}
            if l == "hiring_manager" and doc == "resume":
                if d.get("top_rejection_reason"): e["top_rejection_reason"] = d["top_rejection_reason"]
                if "answered" in d: e["answered"] = d["answered"]
            if l == "ats" and doc == "resume" and d.get("keywords"):
                kws = [{"term": k["term"], "aliases": list(k.get("aliases") or [])} for k in d["keywords"]]
                calc = ats_check.compute(pkg, kws)
                e.update({"keywords": [{**k, "hit": c["hit"]} for k, c in zip(kws, calc["keywords"])], "coverage": calc["coverage"],
                          "top3_hit": calc["top3_hit"], "max_jd_copy_run": calc["max_jd_copy_run"]})
            lenses.append(e)
    worst = max((max((x["verdict"] for x in L[l]["docs"]), key=RANK.get) for l in LENSES), key=RANK.get)
    gate_fails = [f"{k}: {'; '.join(v.get('fails') or [v.get('text', '')])}" for k, v in G.items() if not v["ok"]]
    final = "FAIL" if gate_fails else worst
    who = ", ".join(f"{l}={L[l]['reviewer_run_id']}" for l in LENSES)   # backport 2026-10-21: no 3.12-only nested quotes
    if mode == "combined": who = L["ats"]["reviewer_run_id"]
    src = f"1 combined review ({who})" if mode == "combined" else f"4 independent lens reviews ({who})"
    edits = [f"built by {', '.join(RR.builder_runs(pkg))}; finalized from {src}"]
    if round_note: edits.append(round_note)
    edits += [f"CODE GATE FAIL {g}"[:600] for g in gate_fails]
    rv = {"schema": "review-v1", "package": pkg.name, "job_id": job_id, "base": spec.get("base") or "unknown",
          "rubric_version": L["ats"]["rubric_version"], "lint_version": format_check.FORMAT_VERSION,
          "claims_version": CL.load()["version"], "round": max(d.get("round", 1) for d in L.values()), "cover": cover,
          "lenses": lenses, "edits": edits,
          "residual_gaps": list(dict.fromkeys(g for l in LENSES for g in (L[l].get("residual_gaps") or []))),
          "final": final, "reviewed_at": max(d["reviewed_at"] for d in L.values()),
          "reviewer": ("1 combined reviewer: " if mode == "combined" else "4 independent lens reviewers: ") + who,
          "gap_source": "step6" if s6 else "legacy", "gap_handling": L["age_signal_claims"].get("gap_handling") or [],
          "gates": G,
          "reconciled": {"tool": "finalize_review.py", "version": VERSION, "at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
                         "builder_run_ids": RR.builder_runs(pkg), "cover": cover, "mode": mode,
                         "lenses": {l: {"reviewer_run_id": L[l]["reviewer_run_id"], "file": L[l]["_file"], "sha256": L[l]["_sha"],
                                        "verdict": max((x["verdict"] for x in L[l]["docs"]), key=RANK.get)} for l in LENSES},
                         "reviewed_files_sha256": RR.file_hashes(pkg)}}
    if s6: rv["step6_record"] = s6
    if job_id is None: rv.pop("job_id")
    return rv

def finalize(pkg, user_ok=None, hold_ok=None):
    pkg = Path(pkg).resolve(); cover = RR.cover_mode(pkg)
    L, errs, mode = load_review(pkg)
    if errs: return None, errs
    errs = usable(pkg, L, cover, mode)
    if errs: return None, errs
    rnd = max(d.get("round", 1) for d in L.values())
    ok, note = round_rule(pkg, rnd, user_ok or (L["ats"].get("_combined") or {}).get("user_ok"))
    if not ok: return None, [note]
    rv = merge(pkg, L, cover, gates(pkg), mode, note)
    _, holds, pending = rejection_reasons(pkg, L, mode)
    todo = builder_lines(L, pending)
    if todo:
        rv["builder_round"] = todo
        if pending and rv["final"] == "PASS":
            rv["final"] = "REVISE"
            rv["edits"].append(f"REJECTION {len(pending)} fixed rejection reason line(s) not on the resume yet: builder round (tools/builder_feedback.py)")
    if holds:
        rv["holds_for_user"] = holds
        if hold_ok: rv["holds_ack"] = hold_ok
        rv["edits"].append(f"HOLD {len(holds)} cant_fix rejection reason(s) for the user before applying" + (f" (the user OK: {hold_ok})" if hold_ok else ""))
    try: jsonschema.validate(rv, json.loads((HERE / "review_schema.json").read_text()))
    except jsonschema.ValidationError as e: return None, [f"SCHEMA merged review {'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message[:200]}"]
    return rv, []

def stamp_text(rv):
    return (f"4-lens: {rv['final']} ({dt.datetime.now().strftime('%Y-%m-%d')}; {rv['lint_version']}; {rv['claims_version']}; "
            f"{rv['rubric_version']}; finalize_review round {rv['round']})")

import stamp_review as SR
_SR_RENDER = SR.render

def render(rv, stamp):
    block = _SR_RENDER(rv, stamp)
    g = rv["gates"]
    lines = ["", "Code gates (finalize_review.py): " + ", ".join(f"{k} {'ok' if v['ok'] else 'FAIL'}" for k, v in g.items())]
    lines += [f"- {k}: {x}" for k, v in g.items() if not v["ok"] for x in (v.get("fails") or [v.get("text", "")])]
    return block.replace(SR.END, "\n".join(lines) + "\n" + SR.END)

def record(pkg, rv, stamp):
    orig = SR.render; SR.render = render            # README line + review-3lens.md block via the existing writer
    try: SR.write_stamp(pkg, rv, stamp)
    finally: SR.render = orig
    SR.record_run(pkg, rv, rv["final"])

def verify(pkg):
    pkg = Path(pkg).resolve(); rj = pkg / "review.json"
    if not rj.exists(): return ["review.json missing: run finalize_review.py"]
    rv = json.loads(rj.read_text()); rc = rv.get("reconciled") or {}
    if rc.get("tool") != "finalize_review.py":
        return ["review.json was not recorded by finalize_review.py (single-pass or reconcile_reviews.py era): re-review (one combined review) and finalize"]
    errs = []
    if rv.get("final") != "PASS": errs.append(f"recorded verdict is {rv.get('final')}, not PASS")
    if rv.get("holds_for_user") and not rv.get("holds_ack"):
        errs.append("HOLD for the user: " + "; ".join((h.get("question_for_user") or h.get("screen_out_note") or h["reason"])[:120] for h in rv["holds_for_user"])
                    + " -> after their answer, re-finalize with --hold-ok \"<ref>\"")
    for l in LENSES:
        m = rc["lenses"][l]; f = pkg / m["file"]
        if not f.exists() or RR.sha(f) != m["sha256"]: errs.append(f"{m['file']} changed or missing since finalize")
    for f, h in RR.file_hashes(pkg).items():
        if rc["reviewed_files_sha256"].get(f) != h: errs.append(f"{f} changed since finalize")
    G = gates(pkg)
    errs += [f"code gate {k} fails now: {'; '.join(v.get('fails') or [v.get('text', '')])}"[:400] for k, v in G.items() if not v["ok"]]
    return errs

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pkg"); ap.add_argument("--verify", action="store_true"); ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--hold-ok", metavar="REF", help="2026-11-05: the user's OK to apply despite cant_fix rejection reasons (who/when/where)")
    ap.add_argument("--user-ok", metavar="REF", help="the user's approval ref for a round requiring escalation under configured policy (who/when/where)")
    a = ap.parse_args(); pkg = Path(a.pkg).resolve()
    if a.verify:
        errs = verify(pkg)
        print(("VERIFIED " if not errs else "NOT PASS ") + pkg.name); [print("  -", e) for e in errs]; sys.exit(1 if errs else 0)
    rv, errs = finalize(pkg, a.user_ok, a.hold_ok)
    if errs:
        print(f"REFUSE {pkg.name}: review not usable ({len(errs)} problem(s)); nothing recorded"); [print("  -", e) for e in errs]; sys.exit(1)
    stamp = stamp_text(rv)
    if a.dry_run: print(stamp); print(render(rv, stamp)); sys.exit(0)
    rj = pkg / "review.json"
    if rj.exists(): rj.with_name("review.json.bak-finalize").write_text(rj.read_text())
    rj.write_text(json.dumps(rv, indent=1) + "\n")
    record(pkg, rv, stamp)
    snap = WC.snapshot(pkg, rv["round"])
    print(f"RECORDED {pkg.name}: {stamp}")
    print(f"  review: {rv['reconciled']['mode']}; snapshot {snap.relative_to(pkg)}" + (f"; {rv['edits'][1]}" if len(rv["edits"]) > 1 and rv["edits"][1].startswith("round") else ""))
    print("  lenses: " + ", ".join(f"{l} {rv['reconciled']['lenses'][l]['verdict']}" for l in LENSES)
          + "; gates: " + ", ".join(f"{k} {'ok' if v['ok'] else 'FAIL'}" for k, v in rv["gates"].items()))
    for h in rv.get("holds_for_user") or []: print(f"  HOLD for the user{' (acknowledged)' if rv.get('holds_ack') else ''}: {h['reason']} -> {h.get('question_for_user') or h.get('screen_out_note')}")
    if rv.get("builder_round"): print(f"  builder round: {len(rv['builder_round'])} line(s); python3 {HERE}/builder_feedback.py {pkg}")
    if rv["final"] == "PASS":
        print(f"  next: python3 <search-workspace>/pipeline/update_status.py --url <job url> --status Packaged --package {pkg} --by <agent>")
    sys.exit(0 if rv["final"] == "PASS" else 2)

if __name__ == "__main__":
    main()
