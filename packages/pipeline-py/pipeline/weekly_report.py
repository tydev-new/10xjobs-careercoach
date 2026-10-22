#!/usr/bin/env python3
"""Weekly per-source report -> <home>/reports/source-yield-YYYY-Www.md

Ranks sources by the USER's own signals first, model fit second:
  user score = +1 Interested, +2 applied (Applied/Rejected/Withdrawn after applying), +3 employer replied or Interviewing, +4 Offer,
               -1 per role the user skipped (skipped_by='user').  Model fit (Strong/Solid counts) is the tiebreaker.
Also: skip reasons per source (+ suggested criteria/sources tightening, NOT applied), the hiring.cafe overlap trial,
dead / failing sources, and the strong-source target gap with candidate sources to --test-source.

  weekly_report.py [--days 7] [--target-window 14]
"""
import argparse, collections, datetime as dt, json, os, re, sys
from pipeline import jobsdb as J
from pipeline import home as H
import yaml

APPLIED = ("Applied", "Rejected", "Withdrawn", "Interviewing", "Offer")
SCRIPT_SOURCES = re.compile(r"^(ats:|workday|li:guest|gov:|vc:|hn)")

def target_from_criteria():
    try:
        t = open(H.path("criteria_file")).read()
    except Exception:
        return None, None
    m = re.search(r"Target number of strong sources[^:]*:\s*\**\s*(\d+)", t, re.I)
    rule = re.search(r"strong source\*{0,2}\s*=\s*([^\n]+)", t, re.I)
    return (int(m.group(1)) if m else None), (rule.group(1).strip() if rule else None)

def score_row(r):
    s = 0
    if r["status"] == "Interested": s += 1
    if r["status"] in APPLIED or r["applied_at"]: s += 2
    if r["replied"] or r["status"] in ("Interviewing", "Offer"): s += 3
    if r["status"] == "Offer": s += 4
    if r["status"] == "Skipped" and r["skipped_by"] == "user": s -= 1
    return s

def credit_map(c, since):
    """job -> set of sources that saw it (first finder + every sighting)"""
    m = collections.defaultdict(set)
    for r in c.execute("SELECT id, source FROM jobs WHERE date >= ?", (since,)):
        m[r["id"]].add(r["source"])
    for r in c.execute("SELECT s.job_id, s.source FROM sightings s JOIN jobs j ON j.id=s.job_id WHERE j.date >= ?", (since,)):
        m[r["job_id"]].add(r["source"])
    return m

def table(c, since):
    jobs = {r["id"]: r for r in c.execute("SELECT * FROM jobs WHERE date >= ?", (since,))}
    cm = credit_map(c, since)
    agg = collections.defaultdict(lambda: collections.Counter())
    reasons = collections.defaultdict(collections.Counter)
    user_reasons = collections.Counter()
    for jid, srcs in cm.items():
        r = jobs[jid]
        for s in srcs:
            a = agg[s]
            a["rows"] += 1
            a["first"] += 1 if r["source"] == s else 0
            a["user_score"] += score_row(r)
            a["interested"] += r["status"] == "Interested"
            a["applied"] += (r["status"] in APPLIED) or bool(r["applied_at"])
            a["replied"] += bool(r["replied"]) or r["status"] in ("Interviewing", "Offer")
            a["user_skips"] += r["status"] == "Skipped" and r["skipped_by"] == "user"
            a["agent_skips"] += r["status"] == "Skipped" and r["skipped_by"] != "user"
            two = (r["scored_with"] or "").startswith("two-way")
            a["strong"] += two and r["fit"] == "Strong"
            a["solid"] += two and r["fit"] == "Solid"
            a["legacy_ss"] += (not two) and r["fit"] in ("Strong", "Solid")
            a["unscored"] += (not two) and r["scored_with"] != "legacy"
            if r["status"] == "Skipped":
                reasons[s][r["skip_reason"] or "other"] += 1
        if r["status"] == "Skipped" and r["skipped_by"] == "user":
            user_reasons[r["skip_reason"] or "other"] += 1
    return agg, reasons, user_reasons, jobs, cm

SUGGEST = {
    "geo": "Geo skips dominate: add the recurring non-target cities to sources.yaml geo.exclude, and narrow LinkedIn geo_id/remote filters for this source.",
    "pay": "Pay skips dominate: add a posted-max floor check before insert for this source (criteria floor), or tag 'pay under floor' at sweep time so evaluate skips faster.",
    "one-role-per-company": "Many repeats at companies already in play: have the sweep auto-flag (not insert) roles at companies with Applied/Packaged/Interviewing rows.",
    "stage/size": "Stage/size skips: for Director titles from this source, require a stage check before insert (criteria Director gate).",
    "seniority": "Seniority skips: tighten the lane title regexes (require Senior/Staff/Principal/Manager/Director) for this source.",
    "off-lane": "Off-lane skips: add the recurring off-lane title words to sources.yaml exclude_title.",
    "domain/specialty": "Specialty skips: consider a criteria.md line listing specialties to skip (e.g. security/networking/storage IC) and mirror it in exclude_title.",
    "brand/hot rule": "Brand/hot skips: these follow a brand rule; confirm in criteria.md that it still applies.",
    "clearance/sponsorship": "Clearance skips: add 'clearance|TS/SCI|public trust' to exclude_title for this source.",
    "closed/stale": "Stale skips: shorten this source's window or drop reposts older than N days.",
    "duplicate": "Duplicate skips: dedupe keys are missing these; check company-name normalization for this source.",
}

def candidates(c, cfg, strong, since):
    """candidate sources to --test-source: ATS boards of companies that produced Strong/Solid via aggregators but aren't swept directly"""
    have = {(k, b["slug"].lower()) for k in ("ashby", "greenhouse", "lever", "smartrecruiters") for b in (cfg["sources"].get(k, {}).get("boards") or [])}
    out = collections.OrderedDict()
    for r in c.execute("SELECT company, notes, url, fit, source FROM jobs WHERE fit IN ('Strong','Solid') AND date >= ? ORDER BY (scored_with LIKE 'two-way%') DESC, date DESC", (since,)):
        text = (r["url"] or "") + " " + (r["notes"] or "")
        for vendor, rx in (("ashby", r"jobs\.ashbyhq\.com/([\w.%-]+)"), ("greenhouse", r"(?:job-boards|boards)\.greenhouse\.io/([\w.-]+)"),
                           ("lever", r"jobs\.lever\.co/([\w.-]+)"), ("smartrecruiters", r"jobs\.smartrecruiters\.com/([\w.-]+)")):
            for slug in re.findall(rx, text):
                slug = slug.lower()
                if slug in ("embed", "job_app") or (vendor, slug) in have: continue
                out.setdefault(f"{vendor}:{slug}", f"{r['company']} produced a {r['fit']} via {r['source']}")
    # HN-proposed boards from recent runs
    runs = str(H.path("runs_dir"))
    for d in sorted(os.listdir(runs))[-60:] if os.path.isdir(runs) else []:
        f = os.path.join(runs, d, "report.json")
        try: rep = json.load(open(f))
        except Exception: continue
        for b in (rep.get("hn_leads") or {}).get("proposed_boards", []):
            m = re.match(r"(jobs\.ashbyhq\.com|boards\.greenhouse\.io|job-boards\.greenhouse\.io|jobs\.lever\.co)/([\w.-]+)", b)
            if m:
                v = {"jobs.ashbyhq.com": "ashby", "jobs.lever.co": "lever"}.get(m.group(1), "greenhouse")
                if (v, m.group(2).lower()) not in have: out.setdefault(f"{v}:{m.group(2).lower()}", "HN Who's Hiring lead")
    return out

MIN_N = 5   # never show a rate on fewer than 5 applications

def reply_rates(c, dim):
    """apply outcome traceability: per value of `dim` (base | lane | cover_format) for every applied package run:
    applied n, any employer response (reply, interview, offer or rejection) and positive reply (reply/interview/offer)."""
    q = f"""SELECT coalesce(r.{dim}, 'unknown') AS k, count(DISTINCT a.job_id) AS n,
              count(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM package_outcomes o WHERE o.job_id=a.job_id
                   AND o.outcome IN ('replied','interviewing','offer')) THEN a.job_id END) AS pos,
              count(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM package_outcomes o WHERE o.job_id=a.job_id
                   AND o.outcome IN ('replied','interviewing','offer','rejected')) THEN a.job_id END) AS resp
            FROM package_outcomes a JOIN package_runs r ON r.id=a.run_id WHERE a.outcome='applied' GROUP BY k"""
    rows = [dict(r) for r in c.execute(q)]
    def rate(x, n): return f"{x / n:.0%}" if n >= MIN_N else f"n<{MIN_N}"
    rows.sort(key=lambda r: (r["n"] < MIN_N, -(r["pos"] / r["n"] if r["n"] else 0), -(r["resp"] / r["n"] if r["n"] else 0), -r["n"]))
    return [(r["k"], r["n"], r["pos"], r["resp"], rate(r["pos"], r["n"]), rate(r["resp"], r["n"])) for r in rows]

def reply_rate_section(c):
    L = ["", "## Reply rates by base, lane and cover format (package_runs + package_outcomes)", "",
         f"Counts every applied package once (the run it was applied with). Rates are hidden when n < {MIN_N}. "
         "Backfilled runs use the README stamp; base 'unknown' = packaged before the base resumes existed. "
         "Positive = reply, interview or offer; any response also counts rejections.", ""]
    for dim, label in (("base", "Base"), ("lane", "Lane"), ("cover_format", "Cover format")):
        L += [f"| {label} | Applied (n) | Positive | Any response | Positive rate | Response rate |", "|---|---|---|---|---|---|"]
        L += [f"| {k} | {n} | {p} | {r} | {pr} | {rr} |" for k, n, p, r, pr, rr in reply_rates(c, dim)] or ["| none yet | 0 | 0 | 0 | - | - |"]
        L.append("")
    return L

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--days", type=int, default=7); ap.add_argument("--target-window", type=int, default=14); ap.add_argument("--target", type=int, help="override criteria.md target (testing)"); ap.add_argument("--out")
    a = ap.parse_args()
    c = J.connect()
    cfg = yaml.safe_load(open(H.path("sources_file"))) or {}
    today = dt.date.today()
    since = (today - dt.timedelta(days=a.days)).isoformat()
    since_t = (today - dt.timedelta(days=a.target_window)).isoformat()
    agg, reasons, user_reasons, jobs, cm = table(c, since)
    agg14, _, _, _, _ = table(c, since_t)
    yr, wk, _ = today.isocalendar()
    out_path = a.out or os.path.join(str(H.path("reports_dir")), f"source-yield-{yr}-W{wk:02d}.md")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    rank = sorted(agg.items(), key=lambda kv: (-kv[1]["user_score"], -kv[1]["strong"], -kv[1]["solid"], -kv[1]["legacy_ss"], -kv[1]["rows"]))
    L = [f"# Source yield, week of {since} → {today.isoformat()} (generated {J.now_iso()})", "",
         "Ranked by the user's own signals first (Interested +1, applied +2, reply/interview +3, offer +4, user skip −1), model fit second. "
         "A role counts for every source that saw it (first finder + sightings). Legacy rows (imported before two-way scoring) have an inferred first-finder only, and "
         "'Interested' on legacy rows may have been set by an agent.", "",
         "Fit columns: **Strong/Solid (two-way)** = scored with score.py (want=pass AND win high → Strong; medium → Solid). **Legacy S/S** = rows migrated "
         "before two-way scoring was adopted, which keep their old single-score fit and are not re-scored. **Unscored** = new rows not yet evaluated.", "",
         "| # | Source | User score | Interested | Applied | Replied/Interview | User skips | Strong (2-way) | Solid (2-way) | Legacy S/S | Unscored | Rows (first found) | Agent skips |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for i, (s, x) in enumerate(rank, 1):
        L.append(f"| {i} | {s} | {x['user_score']} | {x['interested']} | {x['applied']} | {x['replied']} | {x['user_skips']} | {x['strong']} | {x['solid']} | {x['legacy_ss']} | {x['unscored']} | {x['rows']} ({x['first']}) | {x['agent_skips']} |")

    # ---- strong-source target
    target, rule = target_from_criteria()
    if a.target is not None: target = a.target
    strong_src = sorted(s for s, x in agg14.items() if (x["strong"] + x["solid"] + x["legacy_ss"]) >= 3 and (x["interested"] + x["applied"]) >= 1 and not s.startswith("legacy"))
    L += ["", f"## Strong-source target (last {a.target_window} days)", "",
          f"- Target (criteria.md): **{target if target is not None else 'not set'}**" + (f" · rule: {rule}" if rule else ""),
          f"- Strong sources now ({len(strong_src)}): {', '.join(strong_src) or 'none'}",
          "- Counting: two-way Strong/Solid for roles scored two-way; legacy Strong/Solid for older rows in the window (transition until the 14-day window holds only two-way scores)."]
    if target is not None and len(strong_src) < target:
        gap = target - len(strong_src)
        cand = candidates(c, cfg, strong_src, since_t)
        L += [f"- **Gap: {gap} below target.** Discovery loop: test each candidate with `sweep.py --test-source <type>:<slug> --add --tag <why>`; "
              "boards that produce lane+geo matches are added to sources.yaml. Repeat until the target is met or nothing new turns up. "
              "Also look for peers of the top-ranked sources, VC portfolio boards and field boards (see the skill).", "",
              "Candidate sources (from Strong/Solid roles found through aggregators, and HN leads):", ""]
        L += [f"- `sweep.py --test-source {k}` — {v}" for k, v in list(cand.items())[:25]] or ["- none found in the data; widen discovery (VC portfolios, funding news, field boards)"]
    elif target is not None:
        L += ["- Target met."]

    # ---- skip reasons + suggestions (not applied)
    L += ["", "## Skip reasons by source (suggestions only; nothing applied)", ""]
    for s, cnt in sorted(reasons.items(), key=lambda kv: -sum(kv[1].values())):
        tot = sum(cnt.values())
        if tot < 3: continue
        top = cnt.most_common(3)
        L.append(f"- **{s}** ({tot} skips): " + ", ".join(f"{k} {v}" for k, v in top))
        k, v = top[0]
        if k in SUGGEST and v / tot >= 0.3:
            L.append(f"  - Suggestion: {SUGGEST[k]}")
    if user_reasons:
        L += ["", "Skips the user made personally (strongest signal for criteria.md):", ""]
        for k, v in user_reasons.most_common():
            L.append(f"- {k}: {v}" + (f" → suggest a criteria.md rule: {SUGGEST[k]}" if k in SUGGEST else ""))
    ex = [r for r in jobs.values() if r["status"] == "Skipped" and r["skipped_by"] == "user"][:10]
    L += [f"  - e.g. {r['company']} | {r['title']}: {(r['legacy_status'] or '')[:80]}" for r in ex]

    # ---- hiring.cafe overlap trial
    hc = cfg["sources"].get("hiring_cafe", {})
    ts, te = hc.get("trial_start"), hc.get("trial_until")
    L += ["", f"## hiring.cafe overlap trial ({ts} → {te})", ""]
    if ts:
        cm_t = credit_map(c, str(ts))
        hc_jobs = [jid for jid, s in cm_t.items() if "hiring.cafe" in s]
        only = [jid for jid in hc_jobs if not any(SCRIPT_SOURCES.match(x) for x in cm_t[jid] if x != "hiring.cafe")]
        rows = {r["id"]: r for r in c.execute("SELECT * FROM jobs WHERE date >= ?", (str(ts),))}
        only_good = [jid for jid in only if rows[jid]["fit"] in ("Strong", "Solid") and (rows[jid]["scored_with"] or "").startswith("two-way")]
        L += [f"- Roles hiring.cafe surfaced: {len(hc_jobs)} · also seen by a script source: {len(hc_jobs) - len(only)} · **only hiring.cafe: {len(only)} ({len(only_good)} Strong/Solid)**"]
        L += [f"  - {rows[j]['company']} | {rows[j]['title']} ({rows[j]['fit']}, {rows[j]['status']})" for j in only_good[:15]]
        if te and today.isoformat() >= str(te):
            L.append("- Trial over: " + ("**keep** (finds Strong/Solid roles the scripts miss)" if only_good else "**drop** (nothing unique of value)"))
        else:
            L.append("- Trial running; decide at the end date.")

    # ---- run health / dead sources
    L += ["", "## Run health (sweeps in the period)", "", "| Source | Runs | Requests ok/failed | Lane+geo matches | New rows | Last gap |", "|---|---|---|---|---|---|"]
    for r in c.execute("""SELECT source, COUNT(*) n, SUM(ok) ok, SUM(failed) f, SUM(matched) m, SUM(new_rows) nw, MAX(gap) g
                          FROM run_sources rs JOIN runs r ON r.run_id=rs.run_id WHERE r.started_at >= ? GROUP BY source""", (since,)):
        L.append(f"| {r['source']} | {r['n']} | {r['ok']}/{r['f']} | {r['m']} | {r['nw']} | {J.esc((r['g'] or '')[:100])} |")
    L += ["", "## Source health (source_health table, this period)", "", "| Source | Runs | ok | empty | failed | broken | Avg jobs | Rejects | Last flags |", "|---|---|---|---|---|---|---|---|---|"]
    for r in c.execute("""SELECT source, COUNT(*) n, SUM(status='ok') ok, SUM(status='empty') em, SUM(status='failed') fa, SUM(status='broken') br,
                          ROUND(AVG(jobs)) aj, SUM(rejects) rj, (SELECT flags FROM source_health h2 WHERE h2.source=h.source ORDER BY at DESC LIMIT 1) lf
                          FROM source_health h WHERE at >= ? GROUP BY source""", (since,)):
        L.append(f"| {r['source']} | {r['n']} | {r['ok']} | {r['em']} | {r['fa']} | {r['br']} | {r['aj']} | {r['rj']} | {J.esc((r['lf'] or '')[:120])} |")
    L += reply_rate_section(c)
    # ---- eval hook: weekly disagreements (call vs the user's action) go into the private eval set
    try:
        import subprocess as _sp
        r = _sp.run([sys.executable, "-m", "pipeline.evals.build_private", "--append-disagreements", "--days", "7"],
                    capture_output=True, text=True, timeout=120, cwd=str(H.PKG_ROOT))
        L += ["", "## Eval set", "", "- " + (r.stdout.strip() or r.stderr.strip()[-200:]),
              "- Re-run `python3 jobsearch.py evals --check` after any change to the skill, criteria.md, the scorer prompt or the model."]
    except Exception as e:
        L += ["", f"## Eval set\n\n- disagreement hook failed: {e}"]
    since28 = (today - dt.timedelta(days=28)).isoformat()
    a28, _, _, _, _ = table(c, since28)
    protected = set(cfg.get("protected_sources", []))
    dead = [s for s, x in a28.items() if x["strong"] + x["solid"] + x["legacy_ss"] == 0 and x["interested"] + x["applied"] == 0 and x["rows"] >= 1
            and not any(s == p or s.startswith(p + ":") for p in protected)]
    L += ["", "## Cut candidates (0 Strong/Solid and 0 user picks in 28 days)", ""] + [f"- {s} ({a28[s]['rows']} rows)" for s in sorted(dead)]
    if protected: L += ["", "Protected by user decision (never auto-cut): " + ", ".join(sorted(protected))]
    L += ["", "Disabled in sources.yaml: " + "; ".join(f"{d['name']} ({d['reason']})" for d in cfg.get("disabled", []))]
    open(out_path, "w").write("\n".join(L) + "\n")
    print(out_path)

if __name__ == "__main__":
    main()
