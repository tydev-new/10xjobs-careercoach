# Evaluate — the file shapes

What the files must hold. The verdict row is script-written and the
script is the authority on its fields; the two analysis files are yours
to write, in these shapes, so `prep`, `apply`, `outreach`, `storybank`,
and `learn` can read them without asking.

## `jobs.md` — the verdict row

Written ONLY by `scripts/record_verdict.py` — never hand-edit a row. The
script owns the field set, the verdict tier values, and the track
values (`--help` lists them); it upserts on the canonical (company,
title) key and prints whether it created or updated. Re-verdict
REPLACES verdict, score, reasons, and dealbreakers — pass the full set
every time.

- **`quick-scan:`** at the head of the reason field is the durable stamp
  of the cheap tier (`../SKILL.md § The quick-scan tier`). Dismissal
  prefixes (`dq:` among them) are search's: `../../search/references/
  schema.md`.

## `jd-analysis/<company_key>-<title_key>.md` — one full decode per role

Filename = the job's `company_key` + `title_key` from `jobs.md`
(deterministic, so two roles at the same company don't collide) — NOT a
free-form role name. The quick-scan tier writes NO file here; when a
later graduation writes one, its title line carries the depth. No
script parses this file — every consumer reads it as prose — so the
shape below is the one the written files already share, kept so the
readers find things where they expect them.

- `# [Company] — [Title]: decode ([date])` — with ` · deep` when the
  extras ran.
- `## Lens findings` — the six lenses, each finding with its confidence
  label (HIGH / MEDIUM / LOW / UNKNOWN), its evidence, and for MEDIUM/
  LOW/UNKNOWN the verification question.
- `## Competency extraction` — top 5–7 in priority order: competency ·
  source section(s) · confidence · repetition count · Screening or
  Differentiating.
- `## Fit assessment (Track X lens)` — the track in the heading when
  `criteria.md` defines tracks; `learn`'s 2+ sighting count reads these
  files by track, so an unstamped analysis is invisible to it. The five
  dimensions Strong / Moderate / Weak with evidence; per-competency
  Match / Partial / Gap (frameable or structural) / Unknown.
- `## Verdict: **[tier] — [score]/100**` — the why, in the card's terms.
- `## Verify with the recruiter` — ordered by impact on the decision.
- `## Teaching layer` — Pattern spotted · Trap to watch for · Next time,
  try.
- Dated intel lines *(free-form, anywhere after the verdict)* — what the
  candidate knows that the posting doesn't say; recruiter-call intel has
  no other home.

## `company/<company-slug>.md` — one research brief per company

Reusable across roles; staleness decides whether it is refreshed
(`../SKILL.md § Full evaluation`, step 4).

- `# [Company] — research brief ([date])` — the depth run (quick scan /
  standard / deep dive) named in the header.
- `## Snapshot` — stage · size · industry · funding/valuation · recent
  signals with dates · sources actually consulted.
- `## Culture & hiring signals` — public values (sourced) · what they
  optimize for · red flags · interview-process reports and questions
  candidates say they were asked (crowd-sourced — label it; `prep`
  sources company questions from here) · **what I could NOT find**
  (explicit — the reader sees the coverage, never assumes it).
- `## Fit notes` — the three company-side dimensions vs `profile.md`
  (seniority alignment · domain relevance · trajectory coherence),
  Strong/Moderate/Weak with evidence. Requirement coverage and
  competency overlap need a JD — assessed per role in `jd-analysis/`.
- `## Roles evaluated at this company` — running list: role → verdict →
  date → jd-analysis file.

**Sanctioned outside writes** (here and in `jd-analysis/`): `practice`'s
debrief lands DATED fact corrections (a round contradicted or confirmed
a recorded fact) and dated interviewer-conduct culture notes — corrected
at the source so re-prep can't resurrect a disproven fact.

## The summary card — the reply's shape

```markdown
## [Company] — [Role]: [Verdict] ([score][, Track X when criteria.md defines tracks])

**The role** (from decode): [2-3 lines — what this role actually is, seniority signal, top competencies]
**The company** (from research): [2-3 lines — stage, trajectory, the signals that matter for this decision]

**Why [verdict]:** [strongest matches with evidence · gaps, labeled frameable vs structural]
**Flags:** [dealbreakers/caveats — location, role-type mismatch, company red flags — or "none"]
**Your criteria:** [only when `criteria.md` exists — "clean" / "your criterion Y is unverifiable from the JD — ask"; omit the line entirely otherwise, never "n/a" (measured: eval-m13). Flags carries the JD/company facts; this line carries the judgment against the candidate's own stated criteria]

**Verify with the recruiter** (highest-impact unknowns):
1. [question — what it resolves]
2. …

Full analyses: `jd-analysis/<file>` · `company/<file>` — verdict recorded in the pipeline.
```
