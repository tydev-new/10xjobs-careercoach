#!/usr/bin/env python3
"""Hacker News "Ask HN: Who is hiring?" — a company-discovery source for the
seed / Series-A lane.

Why this exists (earned 2026-08-04). Two real, evaluated roles came into a live
pipeline from OUTSIDE every automated channel the search had:

  Zep AI     — posts only on YC's own board   -> fixed by the `yc` vendor
  Shamrock AI— posts only on its own Wix site -> reachable via HN, and nowhere else

Shamrock was in the November 2025 Who-is-hiring thread. No ATS probe, no
aggregator query, and no company-list sweep could see it, because a company
with no ATS and no aggregator listing is invisible to all three. The monthly
HN thread is where that class of company announces itself.

AGGREGATOR RULE (same as --discover-roles): this finds COMPANIES, not board
rows. Output feeds companies.md with provenance; the ordinary sweep then
probes whatever ATS they turn out to have.

  python3 discover_hn.py --workspace . [--months 3] [--append-companies]

Network + stdlib only. Reads the workspace's own criteria.json so the geo and
theme rules stay in one place.
"""
import argparse, json, os, re, sys, urllib.parse, urllib.request

HN_API = "https://hn.algolia.com/api/v1"
UA = "10xjobs-plugin (job search; contact via github.com/tydev-new/10xjobs-careercoach)"

# An HN hiring comment is free text, not a JD. The convention is a header line
# like "CompanyName | Role | Location | REMOTE | url", so the first pipe-field
# is the company and the rest is prose. Both are matched loosely on purpose.
HEADER_SPLIT = re.compile(r"\s*\|\s*")
REMOTE_HINT = re.compile(r"\bremote\b", re.I)
US_HINT = re.compile(r"\b(usa?|united states|bay area|san francisco|sf|nyc|new york|"
                     r"seattle|austin|boston|remote \(us\)|us[- ]remote)\b", re.I)
NON_US = re.compile(r"\b(london|berlin|paris|amsterdam|dublin|zurich|munich|barcelona|madrid|"
                    r"lisbon|warsaw|prague|stockholm|bangalore|bengaluru|hyderabad|pune|delhi|"
                    r"singapore|tokyo|sydney|melbourne|toronto|vancouver|tel aviv|dubai)\b", re.I)


def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def load_criteria(workspace):
    path = os.path.join(workspace, "criteria.json")
    if os.path.exists(path):
        return json.load(open(path))
    return {}


def hiring_threads(limit):
    """The monthly 'Who is hiring?' stories, newest first. Filters out the
    sibling 'Who wants to be hired?' thread, which is candidates, not roles."""
    d = http_json(f"{HN_API}/search_by_date?tags=story,author_whoishiring&hitsPerPage={limit * 3}")
    out = []
    for h in d.get("hits", []):
        if "who is hiring" in (h.get("title") or "").lower():
            out.append((h["objectID"], h.get("title", ""), (h.get("created_at") or "")[:10]))
        if len(out) >= limit:
            break
    return out


def thread_comments(story_id):
    """Top-level hiring posts for one thread. 1000 is above the largest real
    thread (~800), so this is one request, not a paging loop."""
    d = http_json(f"{HN_API}/search?tags=comment,story_{story_id}&hitsPerPage=1000")
    return d.get("hits", [])


def clean(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    for a, b in (("&#x2F;", "/"), ("&#x27;", "'"), ("&quot;", '"'), ("&amp;", "&"), ("&gt;", ">"), ("&lt;", "<")):
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text).strip()


STOP_PREFIX = re.compile(r"^(backed by|we are|we're|our |the |a |an |come |i'm |i am |join )", re.I)


def company_of(text):
    """First pipe-field, cleaned. The 'Company | Role | Location' convention is
    strong but not universal, and the misses are systematic, not random —
    measured on 3 live threads (2026-08-04): URLs inside the field, leading
    '*' from markdown, and prose openers like 'Backed by Sequoia Capital,'
    where the poster wrote a sentence instead of a header."""
    head = text[:220]
    parts = [p.strip() for p in HEADER_SPLIT.split(head) if p.strip()]
    cand = parts[0] if parts else ""
    cand = re.sub(r"https?://\S+", " ", cand)          # URL inside the name field
    cand = re.sub(r"\s*\(.*?\)?\s*$", " ", cand)       # trailing "( https://..." fragment
    cand = re.sub(r"\s*\(.*?\)\s*", " ", cand)         # parenthetical aside
    cand = re.sub(r"\s+", " ", cand).strip(" *-–—:,|")
    if not cand or STOP_PREFIX.match(cand) or len(cand) > 45 or len(cand.split()) > 5:
        return ""                                       # no reliable name -> skip, don't guess
    return cand


# HN posts are free prose, so the workspace's 26 criteria themes are far too
# loose here: "software engineering", "delivery" and "deployment" match almost
# every post (141 companies from 3 threads, mostly IC roles). This channel
# earns its keep on the DISTINCTIVE vocabulary that self-filters — the same
# lesson the LinkedIn radar learned about niche terms.
HN_THEMES = ["forward deployed", "forward-deployed", "fde", "solutions engineer",
             "solutions engineering", "solutions architect", "field engineer",
             "field engineering", "customer engineer", "deployment engineer",
             "implementation engineer", "applied ai"]
LEADERSHIP = re.compile(r"\b(head of|vp|vice president|director|founding|lead|principal|manager)\b", re.I)


def matches(text, crit=None):
    """Distinctive theme + geo. A leadership word is NOT required — a company
    hiring an IC forward-deployed engineer today has an FDE function, which is
    what makes it worth adding to the universe. It is flagged, not filtered."""
    low = text.lower()
    hits = sorted({t for t in HN_THEMES if t in low})
    if not hits:
        return None
    if NON_US.search(text) and not (US_HINT.search(text) or REMOTE_HINT.search(text)):
        return None
    return hits


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--workspace", required=True)
    p.add_argument("--months", type=int, default=3, help="how many monthly threads to read")
    p.add_argument("--append-companies", action="store_true",
                   help="append NEW companies to companies.md with provenance")
    a = p.parse_args()

    crit = load_criteria(a.workspace)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import search_ats as sa  # shared companies.md / criteria.md helpers
    known = set(sa.load_companies_md(a.workspace))
    known |= {sa.canon(n) for n in sa.parse_criteria_md(a.workspace)[0]}

    threads = hiring_threads(a.months)
    if not threads:
        print("no Who-is-hiring threads found", file=sys.stderr)
        return 1

    found, seen = [], set()
    for sid, title, created in threads:
        comments = thread_comments(sid)
        n_match = 0
        for c in comments:
            text = clean(c.get("comment_text"))
            if not text or len(text) < 40:
                continue
            hits = matches(text)
            if not hits:
                continue
            n_match += 1
            name = company_of(text)
            if not name:          # unparseable header -> a guessed name is worse than none
                continue
            key = re.sub(r"[^a-z0-9]", "", name.lower())
            if key in seen:
                continue
            seen.add(key)
            found.append({"company": name, "key": key, "themes": hits, "thread": title,
                          "lead": bool(LEADERSHIP.search(text[:260])),
                          "date": created, "text": text[:300],
                          "url": f"https://news.ycombinator.com/item?id={c.get('objectID')}",
                          "is_new": key not in known})
        print(f"{title}  ({created})  {len(comments)} posts, {n_match} on-theme")

    fresh = [f for f in found if f["is_new"]]
    print(f"\non-theme companies: {len(found)}   NEW: {len(fresh)}\n")
    for f in sorted(found, key=lambda x: (not x["is_new"], x["company"].lower())):
        print(f"  {'NEW ' if f['is_new'] else '    '}{'LEAD ' if f['lead'] else '     '}"
              f"{f['company'][:30]:<30} {', '.join(f['themes'])[:34]:<34} {f['url']}")
        print(f"        {f['text'][:150]}")

    if fresh and a.append_companies:
        added = sum(sa.append_discovered(a.workspace, f["company"], "hn",
                                         f"{', '.join(f['themes'])} — {f['url']}")
                    for f in fresh)
        print(f"\nadded {added} companies to companies.md")
    elif fresh:
        print("\n(re-run with --append-companies to add these to the universe)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
