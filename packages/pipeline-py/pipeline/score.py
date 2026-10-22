#!/usr/bin/env python3
"""Two-way fit for one role: WANT (meets criteria.md: pass/fail, hard filter) x WIN (JD vs the lane's base resume: high/medium/low).

  score.py --id 42 --prompt [--jd-file jd.txt]
      prints the filled step-6 scoring prompt (pipeline/scoring-prompt.md: the one prompt the live flow and the evals share)
      with criteria.md, the lane's base resume and the posting; score the role with it, then save the result as below
  score.py --id 42 --show
      prints the role, the base resume to compare against, and the analysis path to write
  score.py --id 42 --want pass --want-why "remote US, $150-170K, IC lane" --win high \
      --must "Kubernetes in production :: ran the Kubernetes platform for 30 services" \
      --must "on-call leadership :: led the on-call rotation for 6 engineers" --gap "Rust" --blocker "..." [--note "..."]
      writes <analysis_dir>/job-<id>-<slug>.md and .json (the step-6 record), sets want/win/fit/base_resume/scored_with=two-way-v1,
      re-renders views

fit = combined_fit(want, win, blockers): Strong only when want=pass AND win=high AND no blockers;
pass+high-with-blocker or pass+medium -> Solid; pass+low -> Stretch (Weak if it has blockers);
want=fail -> fit Skip AND status Skipped (want is a hard filter; pass --skip-reason).
--remote (local | remote-us | out-of-area | unverified) is required for roles outside the sources.yaml geo include list and
for job-board remote-filter cards: verify from the JD text or the ATS location field, never from the board's filter.
out-of-area must be want=fail with skip reason geo; unverified keeps the role and marks it "remote unverified".
"""
import json, argparse, importlib.util, os, re, sys
import yaml
from pipeline import home as H
from pipeline import jobsdb as J
from pipeline import fitcheck as FC

def cfg():
    """scoring.yaml in the data folder: lane_to_base, optional routing module, resume file name."""
    p = H.path("scoring_file")
    sc = (yaml.safe_load(p.read_text()) or {}) if p.exists() else {}
    sc.setdefault("resume_file", "resume-native.md")
    base_dir = sc.get("base_resumes_dir")
    sc["base_resumes_dir"] = str(H.home() / base_dir) if base_dir and not os.path.isabs(base_dir) else (base_dir or str(H.path("base_resumes")))
    rm = sc.get("routing_module", "routing.py")
    sc["routing_module"] = rm if os.path.isabs(rm) else os.path.join(sc["base_resumes_dir"], rm)
    return sc

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
    """a role outside the geo include list (or a job-board remote-filter card) must carry a verified --remote value."""
    loc = row["location"] or ""
    if "(Remote filter)" in loc:
        return True
    sp = H.path("sources_file")
    g = ((yaml.safe_load(sp.read_text()) or {}) if sp.exists() else {}).get("geo", {})
    local = any(re.search(r, loc, re.I) for r in g.get("include", [])) and not any(re.search(r, loc, re.I) for r in g.get("exclude", []))
    return not local

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
    ap.add_argument("--remote", choices=["local", "remote-us", "out-of-area", "unverified"],
                    help="where the role can be worked from, verified from the JD text or ATS location (not a job board's filter): "
                         "local (the seeker's area) | remote-us (truly remote in the US) | out-of-area (on-site/hybrid elsewhere -> want fail, geo) | "
                         "unverified (can't tell; role is kept and marked 'remote unverified'). Required when the role is outside the geo include list.")
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
    apath = os.path.join(os.path.relpath(H.path("analysis_dir"), H.home()), f"job-{r['id']}-{slug(r['company'])}-{slug(r['title'])[:40]}.md")
    if a.prompt:
        crit = str(H.path("criteria_file"))
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
        sys.exit(f"location '{r['location']}' is outside the geo include list or a remote-filter card: pass --remote "
                 "local|remote-us|out-of-area|unverified, verified from the JD text or the ATS location field")
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
         f"- Where it can be worked from (verified from JD / ATS, not a job-board filter): **{result.remote_check or 'n/a'}**"
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
        # step-6 record for the apply review: the same validated FitResult as JSON; the lens reviewers check the
        # package's gap and blocker handling against it (apply/rubric/reviewer-brief.md).
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
