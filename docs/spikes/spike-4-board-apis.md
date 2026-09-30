# Spike 4 — board API CORS, from a real browser (S2)

**Code:** `spikes/4-board-apis/` (one static page, no build step) · **Date:**
2026-09-28 · **Settles:** `design-web-agent.md` § 4's "browser access to
single-posting endpoints" UNVERIFIED note (`design-web-search.md` § 7.5
names this spike as the settling evidence).

**Production/preview deploys are owner-only** (`design-web-agent.md`
§ 15): this spike's page and its exact `curl`-based pre-checks below are
mine; the live Vercel-preview run — the actual browser cross-origin
`fetch()` calls — is the **owner's step**, listed at the end of this note.

## What this settles

`design-web-search.md` § 4.1/§ 4.4 assumes four list endpoints
(Greenhouse, Lever, Ashby, SmartRecruiters) and three single-posting
endpoints (Greenhouse, Lever, SmartRecruiters — Ashby has none, § 4.1)
answer a **browser's** cross-origin request, not just `curl`'s. `curl`
never enforces CORS (it has no same-origin concept to police), so a
`curl` 200 with an `Access-Control-Allow-Origin` header is strong
evidence but not proof a real browser's `fetch()` succeeds the same way;
a browser that gets a bad/missing CORS answer throws an opaque
`TypeError: Failed to fetch` with no status code visible to page JS — this
spike's page (`index.html`) makes the same seven calls the design names,
from whatever origin actually serves the page, and reports PASS/FAIL from
that real browser behavior, not from an assumption.

## My own pre-checks (manual, read-only `curl`, no browser, § 12-style)

Rule scope for coders: "a few manual read-only GETs against public board
APIs to confirm response shapes are OK... record what you fetched, never
store personal data." Every address below is a public job board (no
login, no candidate data); run 2026-09-28 from this environment, not from
a browser page — this is the SHAPE/CORS-header pre-check, not the
browser-CORS proof itself (that needs the deployed page, below).

| Call | Address | Result |
|---|---|---|
| Greenhouse list | `boards-api.greenhouse.io/v1/boards/gitlab/jobs` | `200`, `access-control-allow-origin: *`, `content-type: application/json`, 199 jobs |
| Greenhouse posting | `boards-api.greenhouse.io/v1/boards/gitlab/jobs/8556658002?content=true` | `200`, `access-control-allow-origin: *`; `content` field is entity-encoded (`&lt;div class=&quot;content-intro&quot;&gt;…`) — confirms § 4.4's named bug's premise directly |
| Lever list | `api.lever.co/v0/postings/leverdemo?mode=json` | `200`, `access-control-allow-origin: *`; 11 postings, each with `id` (36-char UUID), `hostedUrl`, `categories.team`, **no `company` field** (confirms § 6's "the company check has a hole on Lever") |
| Lever posting | `api.lever.co/v0/postings/leverdemo/681fbc53-1e34-4a46-8677-3a78118674eb` | `200`, `access-control-allow-origin: https://example.vercel.app` (echoes the sent `Origin`, matching § 12's own note); no `company` field |
| Ashby list | `api.ashbyhq.com/posting-api/job-board/ashby?includeCompensation=true` | `200`, `access-control-allow-origin: *`; `{apiVersion, jobs}`, 67 jobs, no company name field; **found a field-name bug of my own**: real compensation field is `compensation.compensationTierSummary`, not `.summary` — fixed in `board-readers.mjs` on the way (not one of § 4.4's two NAMED bugs, but a live-checked correction) |
| SmartRecruiters list | `api.smartrecruiters.com/v1/companies/smartrecruiters/postings?limit=100&offset=0` | `200`, `access-control-allow-origin: *`; `{content, limit, offset, totalFound}`, `company.name`/`location.city` present as the design's § 12 facts say |
| SmartRecruiters posting | `api.smartrecruiters.com/v1/companies/smartrecruiters/postings/744000148454651` | `200`, `access-control-allow-origin: *`; `jobAd.sections.{jobDescription,qualifications}.text`, matching `board-readers.mjs`'s own extraction |

**Not re-checked here (already in `design-web-search.md` § 12, unchanged
since):** Workday's `cxs` preflight — 404, no CORS header, confirming
Workday stays local-only (Node), never attempted from `boards.ts`.

## The page (`spikes/4-board-apis/index.html`)

A single static HTML file, no framework, no build step (`vercel.json`
marks it as pre-built static output). It runs the same seven calls above
as real `fetch(url, { redirect: "error" })` calls — the exact option
`board-readers.mjs`'s own request budget uses (§ 4.8) — and reports
PASS/FAIL with the HTTP status, byte count and timing for each, or the
browser's own opaque CORS-failure text when one is refused.

## Owner steps (production/preview deploys are owner-only, § 15)

1. From the repo root: `cd spikes/4-board-apis && vercel deploy` (or drag
   the folder into the Vercel dashboard) — a **preview** deploy, no
   project settings, no secret, no production alias.
2. Open the preview URL, click "Run the 7 calls".
3. Expect **7/7 PASS**. Paste the page's own output block into this
   note's "Live result" section below (or attach a screenshot) and note
   the preview URL and the date run.
4. Tear the preview down (or let it expire) — nothing here needs to stay
   deployed.

### Live result

*(owner fills in after running the deployed page — this spike's code and
`curl` pre-checks are complete without it, but the browser-CORS proof
itself is not written down until this section is filled in.)*
