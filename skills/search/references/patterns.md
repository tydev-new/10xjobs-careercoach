# Search — the catalog and the craft

Technique, not rules: the instruments a plan is composed from, and what
was learned running them. Rules live in `../SKILL.md`. Read this when
composing or revising a plan.

## The catalog — what each instrument is for

Every instrument has an **addressing** (by-company needs the working set;
by-query takes the thesis directly) and an **authority** (an employer's
own system writes pipeline rows; a **lead** source must be confirmed
against the employer's own board before the candidate spends time — or
presented as unconfirmed). Every script prints its own usage — run it,
don't read it.

| Instrument | Addressing · authority | Use it when | Run |
|---|---|---|---|
| **ATS sweep** — 10 vendor contracts, uniform record; resolution via cloud map → cache → verified slug probe → `--register` | by-company · authoritative | a curated universe exists; the candidate's own companies always | `python3 scripts/search_ats.py --workspace .` |
| **Role-first market scan** — fans ≥10 title angles across an aggregator; measures the pool, surfaces unknown employers | by-query · lead | the universe under-represents a function that demonstrably exists; "how big is the market?" | `--discover-roles [--queries a,b,c] [--append-companies]` |
| **YC boards** — seed-stage; publishes salary AND equity, names founders | by-company · authoritative | seed/Series-A targets invisible to every other channel | `--register "Name=https://www.ycombinator.com/companies/<slug>"` |
| **HN who-is-hiring** — companies with no ATS and no aggregator presence announce themselves here | by-query · lead | the seed-stage blind spot; use niche vocabulary, not generic titles | `python3 scripts/discover_hn.py --workspace . [--append-companies]` |
| **Track B** — traditional employers hiring engineering leadership for AI transformation, a cohort no curated ATS list reaches | by-query · lead | `criteria.md` names that lane | `python3 scripts/discover_trackb.py --workspace .` |
| **Archetype research** — the thesis as company archetypes, agent-run web search, every proposal with a citable signal | by-query · lead (agent) | a track is under-represented; ≤12 searches per pass, evidence per company, never invented | conversation |
| **LinkedIn hiring-post radar** — the poster IS the hiring manager | by-query · lead (attended only) | the candidate is present and signed in; never scheduled | § The LinkedIn hiring-post radar, below |

Research never lands a role directly — it proposes *candidates for the
working set*, each with its evidence; the candidate confirms, then the
ATS sweep does the checking. Only a posting is a role.

A source none of these reach becomes a **build request** with evidence —
new fetchers are code under test, never improvised at runtime.
(career-ops' MIT provider library covers most enterprise vendors; a new
vendor is a translation job, not a from-scratch one.) Write the request
down in `jobs.md § Search notes`; do not hand-scrape the source into the
record.

Rules live in `../SKILL.md`; this is the menu and the craft.

## Composing a plan

Read `criteria.md` in full first, every time. Then, per lane the
criteria name: which instruments address it, which queries (the title
buckets, the stage, the geography), and why each fits — stated in a
sentence the candidate can disagree with. A plan that is just "run the
ATS sweep" is fine when the target list is strong; say so.

## The sweep — getting there

1. `criteria.md` changed since the last run → regenerate `criteria.json`
   first (the script warns loudly if you forget; don't make it).
2. Run the standing plan's instruments — the scripts; each prints its
   usage.
3. Read the report: counts, rejection reasons, yield per source.
4. Judge the result (§ Reading a thin result, below). Research
   (archetype) proposes companies for the working set.
5. The evidence says revise → the loop's rule 1, then rerun from step 2.
6. A *high-signal* lead (exact target title, named company) gets one
   check against the employer's careers site before it can age out —
   our own filters are a known false-negative source.
7. Report: what landed, what was rejected and why, which rows are
   cross-listed (apply through ONE channel only), the settings in force.
8. The prune report — three exits, one question:
   - **DEAD** — Delisted (a To-Review posting gone from a successfully
     swept feed; only rows the candidate never touched) or Closed (stale
     AND positive evidence the posting is dead — one cheap probe per
     stale row, closure-banner patterns included). Removed
     automatically, already the sweep's behavior. **Uncertainty is
     never "dead."**
   - **STALE** — at To Review past the stale-days window with no
     candidate action. Sorted down, still listed, and *proposed*.
   - **OUTRANKED** — over the active cap; a role stays only by
     outranking the weakest on quick-scan fit; the displaced row is
     proposed. The ranked set is To Review rows only; the cap counts To
     Review rows only.
   The proposal's one question: "2 dead removed; 9 stale + 6 outranked —
   dismiss all 15?" A vanished posting on an Applied/Interviewing row is
   coach-conversation material. Dismissal reasons carry the prefixes in
   `schema.md`; the reason distribution is the plan-revision evidence
   (9 stale from one source = that source's queries need work).

## Reading a thin result

Three different things look alike:

- **Query design** — fresh results, zero hits. The vocabulary is wrong
  (see the radar notes below). Adjust one term; rerun.
- **Coverage** — the companies the candidate cares about aren't in the
  working set, or their ATS isn't one the sweep speaks. Discovery or a
  build request, not a widened query.
- **The market** — the right companies, the right words, nothing posted.
  A real answer; report it as one and wait.

The rejection counts and per-source yields in the report tell which.
Guessing is how plans widen into noise.

## The LinkedIn hiring-post radar — attended only

A hiring manager posting "my team is hiring" is the highest-signal lead
available: the role is fresh, **the poster IS the hiring manager**
(search and contact-finding collapse into one step), and the post is a
standing invitation to respond. This signal decays in days — surface
post dates and lead with the freshest.

**Attended only.** The candidate is present and signed into LinkedIn in
the pane; logged-in browsing is never scheduled or headless.

### Query design (every rule here was earned live)

- **Bounds:** ≤3 searches, ≤20 posts per sweep — the same
  bounded-investigation contract as contact-finding.
- Build searches from the `criteria.md` title buckets: `keywords =
  "hiring" + <bucket terms>`, past-week filter, sorted by date.
- **Prefer niche vocabulary.** "Forward deployed" outperformed every
  generic title — niche terms self-filter; generic ones drown in
  recruiter-bot noise. There is no geo filter on post search.
- **Use "my team", NOT "I'm hiring"** (tested 2026-08-03 — the earlier
  guidance was backwards): "I'm hiring" selects FOR staffing agencies,
  because recruiters use that exact phrase as a hook (3/3 hits were
  agencies); "my team … hiring" returned actual functional leaders (2/2).
  Managers describe the team they own; recruiters describe themselves.
- Beware phrase-collisions with company names ("head of solutions"
  matched a company named Head Field Solutions).
- With target companies on file, a per-company pass (company name +
  "hiring") beats generic sweeps.
- A zero-lead sweep with fresh results is **query design, not a dead
  channel** — say so and adjust next time.

### Each qualifying hit produces THREE artifacts in one pass

A real role, on-thesis, poster plausibly owns it →

1. a pipeline row (`source=linkedin_post`, url = the post — some of these
   roles never reach an ATS board),
2. a contact entry per the outreach skill's rules (poster =
   self-declared hiring manager, the highest evidence tier; the post is
   both hook and occasion),
3. a drafted response per outreach's Draft loop (framework 10 in its
   `references/patterns.md § The ten frameworks`).

### The public fallback is bonus-only

A `site:linkedin.com/posts` web search can ride a scheduled sweep, but
Google's index of LinkedIn posts runs months-to-years stale (probed
2026-07-17: top results were 2022–24 certification chaff). Treat any hit
as a bonus lead; never report this pass as coverage.

## Proposing a new pattern

When a query, source, or reading of the evidence works twice, write it
in `jobs.md § Search notes` as a proposal — name what it beat and the
two runs that showed it. A pattern is never self-adopted; a human
promotes it into this file. One adopted on a single good week is how
the earlier "I'm hiring" guidance got in backwards.
