"""Synthetic board responses for the offline sweep tests. Every company, job and person here is made up; the shapes
follow each public API (Ashby posting-api, Greenhouse boards-api, Lever postings, SmartRecruiters, LinkedIn guest
search HTML, NEOGOV RSS, HN Algolia, Getro __NEXT_DATA__, a16z RSC payload, and the Workday script's JSON)."""
import json

UUID = "11111111-2222-3333-4444-{:012d}"
NOW = "2026-01-04T16:00:00Z"


def ashby():
    jobs = [{"id": UUID.format(i), "title": t, "location": loc, "isListed": True, "isRemote": rem, "publishedAt": NOW,
             "jobUrl": f"https://jobs.ashbyhq.com/acme-robotics/{UUID.format(i)}",
             "compensation": {"compensationTierSummary": "$160K – $190K"}, "secondaryLocations": [], "descriptionPlain": "..."}
            for i, (t, loc, rem) in enumerate([("Senior Platform Engineer", "Remote - US", True),
                                                ("Engineering Manager, Infrastructure", "Springfield", False),
                                                ("Account Executive", "Remote - US", True)])]
    jobs.append({**jobs[0], "id": UUID.format(9), "title": "Unlisted Role", "isListed": False})
    return {"https://api.ashbyhq.com/posting-api/job-board/acme-robotics": (200, {"jobs": jobs})}


def greenhouse():
    jobs = [{"id": 100 + i, "title": t, "location": {"name": loc}, "absolute_url": f"https://job-boards.greenhouse.io/contoso-labs/jobs/{100 + i}",
             "first_published": NOW, "requisition_id": f"REQ-{i}"} for i, (t, loc) in
            enumerate([("Staff Software Engineer, Platform", "Remote, United States"), ("Site Reliability Engineer", "Springfield")])]
    return {"https://boards-api.greenhouse.io/v1/boards/contoso-labs/jobs": (200, {"jobs": jobs})}


def lever():
    jobs = [{"id": UUID.format(i), "text": t, "categories": {"location": loc, "allLocations": [loc]}, "workplaceType": wp,
             "hostedUrl": f"https://jobs.lever.co/fabrikam/{UUID.format(i)}", "createdAt": 1767542400000,
             "salaryRange": {"min": 150000, "max": 180000}, "descriptionPlain": "..."} for i, (t, loc, wp) in
            enumerate([("Senior Infrastructure Engineer", "Remote", "remote"), ("Engineering Manager, Platform", "Springfield", "hybrid")])]
    return {"https://api.lever.co/v0/postings/fabrikam": (200, jobs)}


def smartrecruiters():
    content = [{"id": f"74400000{i}", "name": t, "releasedDate": NOW, "refNumber": f"R{i}", "company": {"name": "Woodgrove Systems"},
                "location": {"city": city, "region": "IL", "country": "us", "remote": rem}} for i, (t, city, rem) in
               enumerate([("Senior Platform Engineer", "Springfield", False), ("Staff Software Engineer", "Chicago", True)])]
    return {"https://api.smartrecruiters.com/v1/companies/woodgrove/postings": (200, {"content": content, "totalFound": len(content)})}


def linkedin_guest():
    cards = "".join(
        f"""<li><div class="base-card" data-entity-urn="urn:li:jobPosting:40000000{i}">
<h3 class="base-search-card__title">{t}</h3><h4 class="base-search-card__subtitle"><a>{co}</a></h4>
<span class="job-search-card__location">{loc}</span><time class="job-search-card__listdate" datetime="2026-01-04">1 day ago</time>
</div></li>""" for i, (t, co, loc) in enumerate([("Engineering Manager, Platform", "Tailspin Toys", "Springfield"),
                                                  ("Senior Platform Engineer", "Litware Inc", "United States")]))
    return {"https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search": (200, cards.encode())}


def gov():
    rss = """<?xml version="1.0"?><rss xmlns:joblisting="http://www.neogov.com/namespaces/JobListing"><channel><title>City of Springfield</title>
<item><title>Senior Software Engineer (IT)</title><link>https://www.governmentjobs.com/careers/springfield/jobs/1</link>
<joblisting:location>Springfield</joblisting:location><joblisting:advertiseFromDate>2026-01-04T08:00:00Z</joblisting:advertiseFromDate>
<joblisting:minimumSalary>120000</joblisting:minimumSalary><joblisting:maximumSalary>150000</joblisting:maximumSalary>
<joblisting:salaryInterval>Annually</joblisting:salaryInterval><joblisting:jobNumberSingle>26-001</joblisting:jobNumberSingle></item>
</channel></rss>"""
    return {"https://www.governmentjobs.com/SearchEngine/JobsFeed": (200, rss.encode()),
            "https://www.calcareers.ca.gov/x": (200, b"<html>no links</html>")}


def hn():
    story = {"hits": [{"objectID": "900", "title": "Ask HN: Who is hiring? (January 2026)"}]}
    comments = {"nbPages": 1, "hits": [
        {"objectID": "901", "parent_id": 900, "created_at": NOW,
         "comment_text": "Acme Robotics | Senior Platform Engineer | REMOTE (US) | https://jobs.ashbyhq.com/acme-robotics"},
        {"objectID": "902", "parent_id": 901, "created_at": NOW, "comment_text": "reply, not a lead"}]}
    return {"https://hn.algolia.com/api/v1/search_by_date?tags=story": (200, story),
            "https://hn.algolia.com/api/v1/search_by_date?tags=comment": (200, comments)}


def getro():
    data = {"props": {"pageProps": {"initialState": {"jobs": {"found": [
        {"title": "Senior Platform Engineer", "url": "https://jobs.example-vc.com/companies/acme/jobs/1", "createdAt": 1767542400,
         "locations": ["Remote, US"], "workMode": "remote", "organization": {"name": "Acme Robotics", "stage": "series_b", "headCount": 120},
         "compensationAmountMinCents": 16000000, "compensationAmountMaxCents": 19000000}]}}}}}
    page = f'<html><script id="__NEXT_DATA__" type="application/json">{json.dumps(data)}</script></html>'
    return {"https://jobs.example-vc.com/jobs": (200, page.encode())}


def a16z():
    o = {"id": "ats:1", "title": "Engineering Manager, Infrastructure", "company_name": "Contoso Labs", "location": "Remote",
         "workplace_type": "remote", "apply_url": "https://jobs.example.com/contoso/1", "posted_at": NOW, "salary_min": 170000, "salary_max": 200000}
    return {"https://jobs.a16z.com/jobs": (200, ("0:" + json.dumps([o], separators=(",", ":"))).encode())}


def workday_script_output():
    return {"summary": {"tenantsOk": 1, "failures": [], "hits": 1, "dropped": 0, "queries": 2},
            "hits": [{"company": "Proseware", "title": "Senior Platform Engineer", "locations": ["Remote - USA"], "remoteType": "Remote",
                      "url": "https://proseware.wd5.myworkdayjobs.com/External/job/Remote/Senior-Platform-Engineer_JR100",
                      "startDate": "2026-01-04", "reqId": "JR100", "ageDays": 1}]}


ALL = {"ashby": ashby, "greenhouse": greenhouse, "lever": lever, "smartrecruiters": smartrecruiters,
       "linkedin_guest": linkedin_guest, "gov": gov, "hn_whos_hiring": hn, "getro": getro, "a16z": a16z}


def fake_http(name):
    table = ALL[name]()
    def http(url, data=None, headers=None, timeout=30):
        for prefix, (code, body) in table.items():
            if url.startswith(prefix):
                return code, body if isinstance(body, bytes) else json.dumps(body).encode()
        return 404, b""
    return http
