#!/usr/bin/env python3
'Two-way fit for one role: WANT (meets criteria.md: pass/fail, hard filter) x WIN (JD vs the lane\'s base resume: high/medium/low).\n\n  score.py --id <job_id> --prompt [--jd-file jd.txt]\n      prints the filled step-6 scoring prompt (pipeline/scoring-prompt.md: the one prompt the live flow and the evals share)\n      with criteria.md, the lane\'s base resume and the posting; score the role with it, then save the result as below\n  score.py --id <job_id> --show\n      prints the role, the base resume to compare against, and the analysis path to write\n[Candidate-specific example/rule removed; read approved configuration.]\n      writes jd-analysis/job-<id>-<slug>.md, sets want/win/fit/base_resume/scored_with=two-way-v1, re-renders views\n\nfit = combined_fit(want, win, blockers): Strong only when want=pass AND win=high AND no blockers;\npass+high-with-blocker or pass+medium -> Solid; pass+low -> Stretch (Weak if it has blockers);\nwant=fail -> fit Skip AND status Skipped (want is a hard filter; pass --skip-reason).\n--remote (home-area | remote-region | out-of-area | unverified) is required for roles outside the configured home-area list and for LinkedIn\nremote-filter cards: verify from the JD text or the ATS location field, never from the LinkedIn filter. out-of-area must be\nwant=fail with skip reason geo; unverified keeps the role and marks it "remote unverified" (current criteria).\nMigrated rows marked scored_with=\'legacy\' retain their prior fit until explicitly re-scored.'

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

import json, argparse, importlib.util, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jobsdb as J
import yaml
import fitcheck as FC

def cfg():
    return yaml.safe_load(open(os.path.join(J.HERE, "scoring.yaml")).read().replace("${JOBBI_ROOT}", str(_JOBBI_ROOT)))

def base_for(row, sc):
    base = None
    rm = sc.get("routing_module")
    if rm and os.path.exists(rm):
        try:
            spec = importlib.util.spec_from_file_location("routing", rm)
            mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
            base = mod.base_for(row["title"])
        except Exception:
            base = None
    if not base:
        base = (sc.get("lane_to_base") or {}).get(row["lane"] or "")
    path = os.path.join(sc["base_resumes_dir"], base, sc.get("resume_file", "resume-native.md")) if base else None
    return base, path

def needs_remote_check(row):
    """a role outside the configured home-area include list (or a LinkedIn remote-filter card) must carry a verified --remote value."""
    loc = row["location"] or ""
    if "(Remote filter)" in loc:
        return True
    g = (yaml.safe_load(open(os.path.join(J.HERE, "sources.yaml"))) or {}).get("geo", {})
    home_area = any(re.search(r, loc, re.I) for r in g.get("include", [])) and not any(re.search(r, loc, re.I) for r in g.get("exclude", []))
    return not home_area

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:60]

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--id", type=int, required=True); ap.add_argument("--show", action="store_true")
    ap.add_argument("--prompt", action="store_true", help="print the filled scoring-prompt.md for this role")
    ap.add_argument("--jd-file", help="with --prompt: file holding the JD text (default: none; fetch it from the URL)")
    ap.add_argument("--want", choices=["pass", "fail"]); ap.add_argument("--want-why", default="")
    ap.add_argument("--win", choices=["high", "medium", "low"]); ap.add_argument("--base")
    ap.add_argument("--must", action="append", default=[], help='"must-have :: proof from the resume" (proof may be empty)')
    ap.add_argument("--gap", action="append", default=[]); ap.add_argument("--blocker", action="append", default=[])
    ap.add_argument("--note", default="")
    ap.add_argument("--remote", choices=["home-area", "remote-region", "out-of-area", "unverified"],
                    help="where the role can be worked from, verified from the JD text or ATS location (not the LinkedIn filter): "
                         "home-area | remote-region (truly remote in the US) | out-of-area (on-site/hybrid elsewhere -> want fail, geo) | "
                         "unverified (can't tell; role is kept and marked 'remote unverified'). Required when the role is not in the configured home-area list.")
    ap.add_argument("--reason", help="one-line reason for the call (default: built from want/win notes)")
    ap.add_argument("--dealbreaker", action="append", default=[], choices=FC.DEALBREAKERS, help="with --want fail (default: from --skip-reason)")
    ap.add_argument("--skip-reason", choices=[n for n, _ in J.SKIP_REASONS] + ["other"], help="with --want fail")
    a = ap.parse_args()
    sc = cfg()
    c = J.connect()   # read-only use: load the row, then close before the write connection opens
    try:
        r = c.execute("SELECT * FROM jobs WHERE id=?", (a.id,)).fetchone()
    finally:
        c.close()
    if not r: sys.exit("no such job id")
    base, bpath = base_for(r, sc)
    if a.base:
        base = a.base; bpath = os.path.join(sc["base_resumes_dir"], base, sc.get("resume_file", "resume-native.md"))
    apath = os.path.join(sc.get("analysis_dir", "jd-analysis"), f"job-{r['id']}-{slug(r['company'])}-{slug(r['title'])[:40]}.md")
    if a.prompt:
        crit = os.path.join(J.WS, "criteria.md")
        jd = open(a.jd_file).read() if a.jd_file else f"(JD text not stored: read it at {r['url'] or 'the posting URL'})"
        print(FC.render_prompt(open(crit).read() if os.path.exists(crit) else "",
                               open(bpath).read() if bpath and os.path.exists(bpath) else f"(base resume not found: {bpath})",
                               {"company": r["company"], "title": r["title"], "location": r["location"], "pay": r["pay_text"], "jd_text": jd}))
        return
    if a.show:
        print(f"Scoring prompt: {FC.PROMPT_PATH} (score.py --id {r['id']} --prompt)")
        print(f"#{r['id']} {r['company']} | {r['title']} | lane {r['lane']} | {r['location'] or ''} | {r['pay_text'] or ''}\nURL: {r['url']}\n"
              f"Base for WIN: {base} -> {bpath}\nWrite analysis to: {apath}\nCurrent: want={r['want']} win={r['win']} fit={r['fit']} scored_with={r['scored_with']}")
        return
    if not a.want or (a.want == "pass" and not a.win):
        sys.exit("need --want, and --win when want=pass")
    if not a.remote and needs_remote_check(r) and not (a.want == "fail" and (a.skip_reason == "geo" or "geo" in a.dealbreaker)):
        sys.exit(f"location '{r['location']}' is outside the configured home-area list or a LinkedIn remote-filter card: pass --remote "
                 "home-area|remote-region|out-of-area|unverified, verified from the JD text or the ATS location field")
    musts = [m.split("::", 1) for m in a.must]
    db_map = {"geo": "geo", "pay": "pay", "clearance/sponsorship": "clearance", "stage/size": "stage", "seniority": "seniority",
              "off-lane": "off-lane", "domain/specialty": "off-lane", "one-role-per-company": "company-in-play"}
    result, err = FC.check({   # code check of the structured fit output before anything is saved
        "want": a.want, "want_reasons": [a.want_why or "(no note)"],
        "dealbreakers": (a.dealbreaker or [db_map.get(a.skip_reason or "", "other")]) if a.want == "fail" else [],
        "win": a.win if a.want == "pass" else None,
        "must_haves": [{"need": m[0].strip(), "proof": (m[1].strip() if len(m) > 1 and m[1].strip() else None)} for m in musts],
        "gaps": a.gap, "blockers": a.blocker, "remote_check": a.remote,
        "reason": a.reason or (f"want {a.want}: {a.want_why}" + (f"; win {a.win}" if a.win else ""))[:800]})
    if err:
        sys.exit(f"fit output rejected by fitcheck, nothing saved: {err}")
    fit = result.call
    loose = FC.unaccounted_must_haves(result)
    if loose:
        print("warning: must-haves with no proof that are not listed as --gap/--blocker: " + "; ".join(loose), file=sys.stderr)
    L = [f"# {r['company']}: {r['title']} (job {r['id']})", "",
         f"- URL: {r['url'] or 'n/a'}", f"- Lane: {r['lane']} · Location: {r['location'] or 'n/a'} · Pay: {r['pay_text'] or 'not posted'} · Source: {r['source']}",
         f"- Scored {J.now_iso()} with two-way-v1 against base `{base}`",
         f"- Where it can be worked from (verified from JD / ATS, not the LinkedIn filter): **{result.remote_check or 'n/a'}**"
         + (" — remote unverified, confirm before packaging" if result.remote_check == "unverified" else ""), "",
         f"## Want (criteria.md): **{a.want.upper()}**", "", a.want_why or "_no note_", "",
         f"## Win (JD vs {base} base resume): **{(a.win or 'n/a').upper()}**", "",
         "| Must-have (from the JD) | Proof on the resume |", "|---|---|"]
    L += [f"| {J.esc(m[0].strip())} | {J.esc(m[1].strip()) if len(m) > 1 and m[1].strip() else '**none: gap**'} |" for m in musts]
    L += ["", "### Gaps", ""] + ([f"- {g}" for g in a.gap] or ["- none noted"])
    L += ["", "### Blockers", ""] + ([f"- {b}" for b in a.blocker] or ["- none"])
    L += ["", f"## Result: **{fit}**  (Strong only when want=pass and win=high with no blockers)"]
    if a.note: L += ["", a.note]
    with J.locked():
        c, rec = J.open_for_write()
        full = os.path.join(J.WS, apath)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        open(full, "w").write("\n".join(L) + "\n")
        # step-6 record for Apply review (phase 1, 2026-10-20): the same validated FitResult as JSON, read by
        # <apps-workspace>/tools/gap_check.py and stamp_review.py so reviewers check gaps/blockers against it.
        rec6 = {"schema": "step6-v1", "job_id": r["id"], "company": r["company"], "title": r["title"], "url": r["url"],
                "scored_at": J.now_iso(), "scored_with": "two-way-v1", "base": base, "analysis_md": apath,
                **result.model_dump()}
        open(os.path.splitext(full)[0] + ".json", "w").write(json.dumps(rec6, indent=2) + "\n")
        note = f"[{J.today()} two-way] want {a.want}, win {a.win or '-'} → {fit}" + (f"; gaps: {'; '.join(a.gap)}" if a.gap else "") + (f"; blockers: {'; '.join(a.blocker)}" if a.blocker else "") \
            + (f"; where: {result.remote_check}" + (" (remote unverified)" if result.remote_check == "unverified" else "") if result.remote_check else "")
        c.execute("UPDATE jobs SET want=?, win=?, fit=?, base_resume=?, scored_with='two-way-v1', analysis_path=?, remote_check=?, notes=notes || ' · ' || ?, updated_at=? WHERE id=?",
                  (a.want, a.win, fit, base, apath, result.remote_check, note, J.now_iso(), r["id"]))
        if a.want == "fail":
            J.set_status(c, r["id"], "Skipped", by="agent", note=f"want fail: {a.want_why}")
            c.execute("UPDATE jobs SET skip_reason=?, skipped_by='agent' WHERE id=?", (a.skip_reason or J.skip_reason_of(a.want_why), r["id"]))
        c.commit(); J.write_views(c)
        c.close()
    print(f"#{r['id']} {r['company']} | {r['title']}: want {a.want}, win {a.win} -> {fit} · {apath}")

if __name__ == "__main__":
    main()
