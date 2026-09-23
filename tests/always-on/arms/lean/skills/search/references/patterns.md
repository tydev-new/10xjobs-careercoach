# Search — the catalog that binds

Reading a thin result, the LinkedIn hiring-post radar's query design,
and composing a plan's wording are the model's own judgment. This file
holds the instrument catalog and the one rule about what research may write.
Rules live in `../SKILL.md`.

## The catalog — what each instrument is for

| Instrument | Addressing · authority | Use it when | Run |
|---|---|---|---|
| **ATS sweep** — 10 vendor contracts, uniform record | by-company · authoritative | a curated universe exists; the candidate's own companies always | `python3 scripts/search_ats.py --workspace .` |
| **Role-first market scan** — fans title angles across an aggregator | by-query · lead | the universe under-represents a function that demonstrably exists | `--discover-roles [--queries a,b,c] [--append-companies]` |
| **YC boards** — seed-stage; publishes salary and equity, names founders | by-company · authoritative | seed/Series-A targets invisible to every other channel | `--register "Name=https://www.ycombinator.com/companies/<slug>"` |
| **HN who-is-hiring** — companies with no ATS and no aggregator presence | by-query · lead | the seed-stage blind spot; niche vocabulary, not generic titles | `python3 scripts/discover_hn.py --workspace . [--append-companies]` |
| **Track B** — traditional employers hiring for a named transformation lane | by-query · lead | `criteria.md` names that lane | `python3 scripts/discover_trackb.py --workspace .` |
| **Archetype research** — the thesis as company archetypes, agent-run web search | by-query · lead (agent) | a track is under-represented; every proposal needs a citable signal, never invented | conversation |
| **LinkedIn hiring-post radar** — the poster IS the hiring manager | by-query · lead (attended only) | the candidate is present and signed in; never scheduled | conversation, attended |

## What research may write

Research never lands a role directly — it proposes *candidates for the
working set*, each with its evidence; the candidate confirms, then the
ATS sweep does the checking. Only a posting is a role.
