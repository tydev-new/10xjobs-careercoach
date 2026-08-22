#!/usr/bin/env python3
"""Record an evaluation verdict in the pipeline record (jobs.md).

The evaluate skill's ONE structured write. Upserts on the canonical
(company, title) key — re-evaluating updates the role instead of duplicating
it. Re-verdict semantics: verdict/score/reason/dealbreakers are REPLACED on
re-evaluation; pass the full set every time. To avoid duplicate roles, pass
the EXISTING role's exact company/title when it was already swept ("Baseten
AI" != "Baseten" — canon() strips inc/llc/labs, not "AI").

Storage moved from jobs.db to jobs.md 2026-08-14; the shared record library
lives with the search skill (the pipeline's writer of first entry).

  python3 record_verdict.py --workspace . --company "Writer" \
    --title "Director, solutions architecture" --verdict investable_stretch \
    --score 85 --reasons "..." --dealbreakers "..." --url "..." \
    --jd-file "jd-analysis/..." --company-file "company/writer.md"
"""
import argparse, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "..", "search", "scripts"))
import jobs_md as jm

# Exactly the four tiers the skill prose defines — a fifth ("good") survived
# here from the board era with no prose defining it and no row using it;
# removed in the 2026-08-14 closing drift review.
VERDICTS = ("strong", "investable_stretch", "long_shot", "weak")
TRACKS = ("A", "B", "C")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--workspace", required=True)
    p.add_argument("--company", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--verdict", required=True, choices=VERDICTS)
    p.add_argument("--score", type=int)
    p.add_argument("--reasons")
    p.add_argument("--dealbreakers")
    p.add_argument("--url")
    p.add_argument("--location")
    p.add_argument("--jd-file", dest="jd_file")
    p.add_argument("--company-file", dest="company_file")
    p.add_argument("--track", choices=TRACKS)
    a = p.parse_args()
    if a.score is not None and not (0 <= a.score <= 100):
        print("error: --score must be 0-100", file=sys.stderr)
        return 2

    rows = jm.load(a.workspace)
    now = jm.now_iso()
    k = (jm.canon(a.company), jm.canon(a.title))
    row = next((r for r in rows if jm.key(r) == k), None)
    existed = row is not None
    if not existed:
        row = {"company": a.company, "title": a.title, "stage": "To Review",
               "dismissed": False, "seen_at": now}
        rows.append(row)
    # replace the evaluation wholly; keep-first for identity fields
    row["fit_verdict"], row["fit_score"] = a.verdict, a.score
    row["fit_reason"], row["dealbreakers"] = a.reasons, a.dealbreakers
    row["url"] = a.url or row.get("url")
    row["location"] = a.location or row.get("location")
    row["jd_file"] = row.get("jd_file") or a.jd_file
    row["company_file"] = a.company_file or row.get("company_file")
    row["track"] = a.track or row.get("track")
    row["evaluated_at"] = row["updated_at"] = now
    jm.save(a.workspace, rows)
    how = "updated existing role" if existed else "created NEW role"
    print(f"recorded ({how}): {row['company']} — {row['title']} → {a.verdict} ({a.score})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
