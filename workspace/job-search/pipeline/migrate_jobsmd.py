#!/usr/bin/env python3
"""One-time migration: jobs.md (free-text markdown table) -> jobs.db.

  python3 migrate_jobsmd.py --dry-run     # builds state/jobs.dryrun.db + migration-report-dryrun.md, touches nothing else
  python3 migrate_jobsmd.py --apply       # backs up jobs.md, builds jobs.db, renders views, verifies

Mapping: free-text status -> fixed enum (jobsdb.map_status); detail text kept as a
"[status: ...]" prefix in notes and in legacy_status. "Note"/scout-log rows go to
run_notes. Duplicate company+title / URL / req rows merge into the furthest-along row.
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

import argparse, collections, datetime as dt, glob, hashlib, json, os, re, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jobsdb as J

def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")

_EXP = {"em": "engineering manager", "sem": "senior engineering manager", "tpm": "technical program manager",
        "fde": "forward deployed engineer", "sa": "solutions architect", "se": "solutions engineering"}
_DROP = {"recheck", "4pm", "6pm", "2pm", "12pm", "10am", "8am", "am", "pm", "the", "of", "and"}

def title_sim(a, b):
    def toks(t):
        out = []
        for w in J.title_key(t).split():
            out += _EXP.get(w, w).split()
        return {w for w in out if w not in _DROP}
    x, y = toks(a), toks(b)
    return len(x & y) / max(1, len(x | y))

def analysis_index():
    files = [os.path.basename(f) for f in glob.glob(os.path.join(J.WS, "jd-analysis", "*.md"))]
    return files

def match_analysis(files, company, title, notes):
    m = re.search(r"jd-analysis/([\w.\-]+\.md)", notes)
    if m and m.group(1) in files:
        return "jd-analysis/" + m.group(1)
    m = re.search(r"\bjd[: ]+`?([a-z0-9][a-z0-9\-]{6,})`?", notes)
    if m:
        for f in files:
            if f.startswith(m.group(1)):
                return "jd-analysis/" + f
    cs = slugify(J.company_key(company))
    if not cs:
        return None
    tt = set(J.title_key(title).split()) - {"senior", "staff", "of", "and", "the", "manager", "engineer", "engineering"}
    best, score = None, 0
    for f in files:
        if not f.startswith(cs + "-"):
            continue
        ft = set(f[len(cs) + 1:-3].split("-"))
        sc = len(tt & ft) / max(1, len(tt))
        if sc > score:
            best, score = f, sc
    return "jd-analysis/" + best if best and score >= 0.5 else None

def build(db_path, report_path):
    text = open(J.JOBS_MD).read()
    rows, search_notes = J.parse_jobs_md(text)
    files = analysis_index()
    stats = collections.Counter()
    raw_status_map = collections.defaultdict(collections.Counter)
    unmapped, recs, notes_rows = [], [], []
    last = None
    for r in rows:
        stats["table_lines"] += 1
        if r["kind"] == "cont":
            stats["continuation_lines"] += 1
            extra = " ".join(x for x in r["cells"] if x)
            if last is not None and extra:
                if last["_kind"] == "job":
                    last["notes"] += " " + extra
                else:
                    last["cells"][-1] += " " + extra
            continue
        cells = r["cells"]
        if r["kind"] == "note":
            stats["run_note_rows"] += 1
            rec = {"_kind": "note", "cells": cells, "line": r["line"], "date": cells[0]}
            notes_rows.append(rec); last = rec
            continue
        stats["job_rows_in"] += 1
        date, company, title, lane, raw_status, notes = (cells + [""] * 6)[:6]
        status, fit_hint = J.map_status(raw_status)
        detail = re.sub(r"\*+", "", raw_status).strip()
        if status is None:
            # status column holds something else (column shift) - keep row, flag
            unmapped.append((r["line"], company, title, raw_status))
            m = re.search(r"\b(Applied|Rejected|Skipped|To Review|Interested|Packaged|Blocked)\b", notes)
            status = J.map_status(m.group(1))[0] if m else "To Review"
            detail = f"(unmapped status cell '{raw_status}', set {status} from notes)"
        raw_status_map[status][detail if len(detail) < 70 else detail[:67] + "..."] += 1
        n = notes
        if detail not in (status, "To Review Stretch"):
            n = f"[status: {detail}] {notes}"
        url = J.primary_url(notes + " " + title)
        fit = fit_hint or J.fit_from_notes(notes)
        src, det = J.infer_source(notes)
        applied_at = None
        if status in ("Applied", "Rejected", "Interviewing", "Offer"):
            m = re.search(r"Applied\s*\(?(20\d\d-\d\d-\d\d)", raw_status + " " + notes)
            applied_at = m.group(1) if m else (date if status == "Applied" else None)
        closed_at = None
        if status in ("Rejected", "Closed"):
            m = re.search(r"(?:Rejected|closed)[^0-9]{0,20}(20\d\d-\d\d-\d\d)", raw_status + " " + notes, re.I)
            closed_at = m.group(1) if m else None
        told = re.search(r"told to the user (20\d\d-\d\d-\d\d(?: \([^)]*\))?)", notes)
        pkg = re.search(r"(" + re.escape(str(_JOBBI_APPS)) + r"/[^\s`)|,;]+)", notes)
        rec = {"_kind": "job", "line": r["line"], "date": date, "company": company, "title": title, "lane": lane,
               "status": status, "fit": fit, "source": src, "source_detail": det, "url": url,
               "url_canon": J.canon_url(url), "req_id": J.req_from(title, url), "notes": n,
               "legacy_status": raw_status, "applied_at": applied_at, "closed_at": closed_at,
               "told_at": told.group(1) if told else None, "package_path": pkg.group(1) if pkg else None,
               "analysis_path": match_analysis(files, company, title, notes),
               "ck": J.company_key(company), "tk": J.title_key(title), "merged": []}
        recs.append(rec); last = rec

    # ---- merge duplicates
    by_ct, by_url, by_req = {}, {}, {}
    survivors, merges, url_conflicts = [], [], []
    def better(a, b):
        return (J.RANK[a["status"]], -a["line"]) >= (J.RANK[b["status"]], -b["line"])
    def merge(keep, drop, why):
        keep["merged"].append(drop["line"])
        keep["notes"] += f" · [merged dup ({why}) from jobs.md line {drop['line']}, {drop['date']}, was '{drop['legacy_status'][:60]}': {drop['notes'][:600]}]"
        for k in ("url", "url_canon", "req_id", "fit", "applied_at", "closed_at", "told_at", "package_path", "analysis_path"):
            if not keep.get(k) and drop.get(k):
                keep[k] = drop[k]
        if drop["date"] < keep["date"]:
            keep["date"] = drop["date"]
        merges.append((why, keep["company"], keep["title"], keep["status"], drop["line"], drop["title"], drop["legacy_status"][:40]))
    for rec in recs:
        target, why = None, None
        if (rec["ck"], rec["tk"]) in by_ct:
            target, why = by_ct[(rec["ck"], rec["tk"])], "company+title"
        elif rec["url_canon"] and rec["url_canon"] in by_url:
            o = by_url[rec["url_canon"]]
            if o["ck"] == rec["ck"] and title_sim(o["title"], rec["title"]) >= 0.5:
                target, why = o, "url"
            else:
                url_conflicts.append((rec["line"], rec["company"], rec["url_canon"], o["company"]))
                rec["url_canon"] = None
        if target is None and rec["req_id"] and (rec["ck"], rec["req_id"]) in by_req:
            target, why = by_req[(rec["ck"], rec["req_id"])], "req id"
        if target is None:
            survivors.append(rec)
            by_ct[(rec["ck"], rec["tk"])] = rec
            if rec["url_canon"]: by_url[rec["url_canon"]] = rec
            if rec["req_id"]: by_req[(rec["ck"], rec["req_id"])] = rec
            continue
        if better(target, rec):
            merge(target, rec, why)
            # make sure secondary keys of the dropped row don't collide later
            continue
        # rec is further along: swap contents into target slot
        old = dict(target)
        for k in list(target.keys()):
            target[k] = rec[k]
        target["merged"] = old["merged"] + rec["merged"]
        merge(target, old, why)
        by_ct[(target["ck"], target["tk"])] = target
        if target["url_canon"]: by_url.setdefault(target["url_canon"], target)
        if target["req_id"]: by_req.setdefault((target["ck"], target["req_id"]), target)

    # ---- write db
    if os.path.exists(db_path):
        os.remove(db_path)
    for ext in ("-wal", "-shm"):
        if os.path.exists(db_path + ext): os.remove(db_path + ext)
    c = J.connect(db_path)
    ts = J.now_iso()
    for rec in survivors:
        try:
            cur = c.execute("""INSERT INTO jobs(date,company,company_key,title,title_key,req_id,url,url_canon,lane,status,fit,
              source,source_detail,first_seen,updated_at,applied_at,closed_at,told_at,analysis_path,package_path,notes,
              legacy_status,legacy_line,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (rec["date"], rec["company"], rec["ck"], rec["title"], rec["tk"], rec["req_id"], rec["url"], rec["url_canon"],
               rec["lane"], rec["status"], rec["fit"], rec["source"], rec["source_detail"], rec["date"], ts,
               rec["applied_at"], rec["closed_at"], rec["told_at"], rec["analysis_path"], rec["package_path"],
               rec["notes"], rec["legacy_status"], rec["line"], rec["line"]))
            c.execute("INSERT INTO status_history VALUES (?,?,?,?,?,?)", (cur.lastrowid, None, rec["status"], ts, "migration", rec["legacy_status"][:200]))
        except Exception as e:
            unmapped.append((rec["line"], rec["company"], rec["title"], f"INSERT FAILED: {e}"))
    for nr in notes_rows:
        key = hashlib.sha1(json.dumps(nr["cells"]).encode()).hexdigest()
        c.execute("INSERT OR IGNORE INTO run_notes(date,cells,legacy_line,sort_order,raw_key) VALUES (?,?,?,?,?)",
                  (nr["date"], json.dumps(nr["cells"]), nr["line"], nr["line"], key))
    J.meta_set(c, "search_notes", search_notes)
    J.meta_set(c, "migrated_at", ts)
    J.meta_set(c, "migrated_from_sha", hashlib.sha256(text.encode()).hexdigest())
    c.commit()

    # ---- report
    final = collections.Counter(r["status"] for r in c.execute("SELECT status FROM jobs"))
    fitc = collections.Counter(r["fit"] for r in c.execute("SELECT fit FROM jobs"))
    srcc = collections.Counter(r["source"].split(":")[0] if r["source"].startswith(("peer", "vc", "news")) else r["source"] for r in c.execute("SELECT source FROM jobs"))
    na = c.execute("SELECT COUNT(*) FROM jobs WHERE analysis_path IS NOT NULL").fetchone()[0]
    nu = c.execute("SELECT COUNT(*) FROM jobs WHERE url IS NOT NULL").fetchone()[0]
    nr_ = c.execute("SELECT COUNT(*) FROM jobs WHERE req_id IS NOT NULL").fetchone()[0]
    L = [f"# jobs.md → jobs.db migration report ({ts})", "",
         f"- Table lines read: {stats['table_lines']} (job rows {stats['job_rows_in']}, run-note rows {stats['run_note_rows']}, continuation lines {stats['continuation_lines']} appended to the previous row)",
         f"- Jobs written: {len(survivors)} · duplicates merged: {len(merges)} · URL conflicts across companies (URL dropped on later row): {len(url_conflicts)} · unmapped status cells: {len(unmapped)}",
         f"- Run notes written: {len(notes_rows)} · rows with URL {nu} · with req ID {nr_} · linked to jd-analysis {na}",
         "", "## Final status counts", ""] + [f"- {s}: {final.get(s,0)}" for s in J.STATUSES] + [
         "", "## Fit counts (all statuses)", ""] + [f"- {k}: {v}" for k, v in fitc.most_common()] + [
         "", "## Source (first finder, inferred for legacy rows)", ""] + [f"- {k}: {v}" for k, v in srcc.most_common()] + [
         "", "## Raw status → enum", ""]
    for s in J.STATUSES:
        if raw_status_map.get(s):
            L.append(f"### {s}")
            for k, v in raw_status_map[s].most_common():
                L.append(f"- {v} × `{k}`")
    L += ["", "## Unmapped / manual", ""] + [f"- line {a}: {b} | {cc} | `{d}`" for a, b, cc, d in unmapped]
    L += ["", "## Merged duplicates", "", "| Why | Company | Kept title | Kept status | Dropped line | Dropped title | Dropped status |", "|---|---|---|---|---|---|---|"]
    L += [f"| {a} | {J.esc(b)} | {J.esc(cc)} | {d} | {e} | {J.esc(f)} | {J.esc(g)} |" for a, b, cc, d, e, f, g in merges]
    L += ["", "## URL conflicts (same URL on two rows that are not the same role; URL kept on the first row only)", ""]
    L += [f"- line {a} {b}: {cc} (already on {d})" for a, b, cc, d in url_conflicts]
    open(report_path, "w").write("\n".join(L) + "\n")
    return c, {"survivors": len(survivors), "merges": len(merges), "unmapped": len(unmapped), "final": dict(final), "stats": dict(stats), "rows_in": recs}

def verify(c, recs):
    """every Applied / Packaged / Interviewing source row must be findable with a status at least as far along"""
    keep = [r for r in recs if r["status"] in ("Applied", "Packaged", "Interviewing", "Offer")]
    missing = []
    for r in keep:
        row = c.execute("SELECT * FROM jobs WHERE company_key=? AND title_key=?", (r["ck"], r["tk"])).fetchone()
        if not row:
            row = c.execute("SELECT * FROM jobs WHERE notes LIKE ?", (f"%jobs.md line {r['line']},%",)).fetchone()
        if not row or J.RANK[row["status"]] < J.RANK[r["status"]] and not (r["status"] == "Packaged" and row["status"] in ("Applied", "Rejected", "Interviewing")):
            missing.append((r["line"], r["company"], r["title"], r["status"], row["status"] if row else None))
    return len(keep), missing

def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    os.makedirs(J.STATE, exist_ok=True)
    if a.dry_run:
        c, res = build(os.path.join(J.STATE, "jobs.dryrun.db"), os.path.join(J.HERE, "migration-report-dryrun.md"))
        n, missing = verify(c, res["rows_in"])
        print(json.dumps({k: v for k, v in res.items() if k != "rows_in"}, indent=1))
        print("verify: Applied/Packaged/Interviewing rows", n, "missing", len(missing), missing[:10])
        return
    with J.locked():
        if os.path.exists(J.DB_PATH):
            sys.exit("jobs.db already exists - refusing to overwrite (move it aside first)")
        stamp = dt.datetime.now().strftime("%Y-%m-%d-%H%M")
        bak = os.path.join(J.WS, f"jobs.md.bak-pre-db-{stamp}")
        shutil.copy2(J.JOBS_MD, bak)
        c, res = build(J.DB_PATH, os.path.join(J.HERE, "migration-report.md"))
        n, missing = verify(c, res["rows_in"])
        J.write_views(c)
        # round-trip: re-parse the generated jobs.md and check every survivor is present
        rows, _ = J.parse_jobs_md(open(J.JOBS_MD).read())
        jobs_in_view = sum(1 for r in rows if r["kind"] == "job")
        print(json.dumps({k: v for k, v in res.items() if k != "rows_in"}, indent=1))
        print("backup:", bak)
        print("verify: Applied/Packaged/Interviewing rows", n, "missing", len(missing), missing[:10])
        print("generated jobs.md job rows", jobs_in_view, "db jobs", c.execute("SELECT COUNT(*) FROM jobs").fetchone()[0])
        with open(os.path.join(J.HERE, "migration-report.md"), "a") as f:
            f.write(f"\n## Verification\n\n- Backup: `{os.path.basename(bak)}`\n- Applied/Packaged/Interviewing/Offer source rows: {n}; missing or regressed after migration: {len(missing)}\n")
            for m in missing: f.write(f"  - {m}\n")
            f.write(f"- Generated jobs.md job rows (as re-parsed): {jobs_in_view}\n")

if __name__ == "__main__":
    main()
