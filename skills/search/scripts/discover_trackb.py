#!/usr/bin/env python3
"""Track B discovery: find TRADITIONAL employers hiring engineering leadership
for AI transformation — the cohort a curated ATS sweep structurally cannot see.

    python3 discover_trackb.py --workspace . [--min-size 200] [--append]

Why this exists (earned 2026-08-03, after four failed approaches):
  search_ats.py natively supports eight startup-shaped vendors. Traditional
  employers run Taleo, iCIMS, Oracle Cloud, SuccessFactors, ADP, Jobvite,
  PageUp, Zoho — every one invisible to the sweep. Registering Workday tenants
  one at a time was tested and does not scale (and Workday returns no JD body,
  so body-filtering is impossible there). hiring.cafe already indexes all of
  them, and the vendor fetcher was already in the codebase — it was just
  hard-wired to a single company.

What it does NOT do: add roles to jobs.db. Per the skill's aggregator rule,
role-first sources feed the COMPANY universe (companies.md) and nothing else;
the company's own feed is then probed like everyone else's. That rule exists
because aggregators surface staffing-agency reposts, which must never be
attributed to an employer.

Output is a set of companies.md rows, each carrying the live role that
evidenced it — so every proposal is falsifiable.
"""
import argparse, collections, importlib.util, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ats", os.path.join(HERE, "search_ats.py"))
ats = importlib.util.module_from_spec(spec); spec.loader.exec_module(ats)

# Tuned queries. Yield is very uneven by wording (1 hit vs 47 in testing), so a
# small SET beats one clever query. Each targets engineering leadership where
# the AI angle is explicit enough to rank.
QUERIES = [
    "Head of Engineering AI",
    "VP of Engineering artificial intelligence",
    "Director of Engineering artificial intelligence",
    "VP Engineering AI transformation",
    "Head of AI Engineering",
    "Director of Software Engineering AI",
    "Chief Technology Officer AI transformation",
    "VP Technology artificial intelligence",
]

LEAD = re.compile(r"\b(vp|vice president|head of|director|chief|cto)\b", re.I)
ENG = re.compile(r"\b(engineer|engineering|technology|technical|software|platform|architect)\b", re.I)
# Employers to drop: aggregators, staffing, and job-board shells that repost.
DENY = re.compile(r"\b(jobgether|staffing|recruit(ing|ment)?|talent|consultanc|outsourc|"
                  r"placement|staffmark|robert half|insight global|teksystems)\b", re.I)


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--workspace", required=True)
    p.add_argument("--append", action="store_true",
                   help="append the discoveries to companies.md (default: print only)")
    a = p.parse_args()

    # Geo gate. Without it the aggregator returns a national spread — in testing,
    # 59 raw employers were dominated by NY/Boston/Midwest financial services,
    # which no amount of title precision fixes. Reuse the workspace's own lists so
    # discovery and the sweep can never disagree about geography.
    crit, _ = ats.load_criteria(a.workspace)
    def geo_ok(loc):
        l = (loc or "").lower()
        if not l:
            return False                       # unknown location is not a pass
        if any(x in l for x in crit["geo_exclude"]):
            return False
        return any(b in l for b in crit["geo_include"])

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import search_ats as sa  # shared companies.md / criteria.md helpers
    known = set(sa.load_companies_md(a.workspace))
    known |= {sa.canon(n) for n in sa.parse_criteria_md(a.workspace)[0]}

    found = {}          # canon company -> (display name, best role, loc, url, ats domain)
    per_q = collections.Counter()
    for q in QUERIES:
        try:
            hits = ats.hiring_cafe_search(q)
        except Exception as e:
            print(f"  ! query failed {q!r}: {e}", file=sys.stderr)
            continue
        per_q[q] = len(hits)
        for h in hits:
            co, title, loc, url = h.get("company", ""), h.get("title", ""), h.get("loc", ""), h.get("_url", "")
            if not co or not title:
                continue
            if DENY.search(co):
                continue
            if not (LEAD.search(title) and ENG.search(title)):
                continue
            if not geo_ok(loc):
                continue
            k = ats.canon(co)
            if k in known or k in found:
                continue
            dom = re.sub(r"^https?://", "", url).split("/")[0]
            found[k] = (co, title, loc, url, dom)

    print(f"queries run: {len(QUERIES)}  ·  hits per query: "
          f"{', '.join(f'{n}' for n in per_q.values())}")
    print(f"NEW employers (leadership+engineering title, not already known): {len(found)}\n")

    for co, title, loc, url, dom in sorted(found.values()):
        print(f"  {co[:34]:<34} {title[:48]:<48} {loc[:26]}")
        print(f"      {dom}")

    if a.append and found:
        added = sum(sa.append_discovered(a.workspace, co, "trackb",
                                         f'LIVE "{title}" ({loc}) — ATS {dom}')
                    for co, title, loc, url, dom in found.values())
        print(f"\nadded {added} companies to companies.md")
    elif not a.append:
        print("\n(dry run — pass --append to write to companies.md)")


if __name__ == "__main__":
    main()
