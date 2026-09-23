# Profile — the file shapes

What `scripts/check_files.py` verifies, plus the shapes it cannot see but
the files must still hold. **The section list is the schema** — these
sections, these names, this order; the checker parses this file and
enforces it. Read it before writing or editing any of these records.

A required section always exists — an unknown value is `TODO:` under it,
never a missing section, so a gap stays visible and the work stays
resumable. Novel material goes in `## Other notes`; never invent a
top-level section, and never write a section that belongs to another file
(measured 2026-08-13: interview history landed in `criteria.md`, which
broke every consumer that reads it). The RULES about these files — what
may enter them and in what order — are in `../SKILL.md § State`, because
they fire while you work rather than while you write a record.

## `profile.md` — who they are; written at intake, then grown

- `## Snapshot` — name · location · contact · links · résumé headline (kept in sync by positioning when the pitch changes — the one sanctioned cross-skill write into this file) · seniority band · **directness preference** (gentle / straight / blunt, default straight; read by the coach, practice scoring and reviews — it changes padding, never content)
- `## Experience` — the arc in brief; the full body lives in `base-resume.md`
- `## Intake findings` — with all four:
  - `### Positioning strengths`
  - `### Likely interviewer concerns`
  - `### Career-narrative gaps`
  - `### Story seeds`
- `## Interview history` — counts · where each stopped · the diagnosis
- `## Constraints` — work authorization · relocation · start date
- `## Application defaults` — the stored form answers, one per line: work authorization (exact approved phrasing) · requires sponsorship · phone · location/relocation · remote preference · compensation strategy · earliest start · EEO standing instruction (default: decline to self-identify). Extend as forms demand; apply reads and offers to save new answers here
- `## Document preferences` — optional; page target, section order, production rules recorded after a second correction
- `## Other notes` — optional

## `criteria.md` — what they want; seeded at intake, then theirs to edit (search reads it every run and never rewrites their picks)

- `## Targets` — target roles + title variants
- `## Level`
- `## Geo`
- `## Compensation` — floor
- `## Dealbreakers`
- `## Target companies` — their own watchlist, the one home for it
- `## Retired`
- `## Search settings` — optional; the search's knobs (yield per sweep · max per company · active cap · stale days). Absent = defaults, which every sweep report prints
- `## Search plan` — optional; the standing plan the agent proposed and the candidate approved (instruments + queries + why). Scheduled runs execute it verbatim
- `## Other notes` — optional

## `base-resume.md` — the fact floor *(free-form body — the résumé keeps the candidate's own headings; only `## Claim rules` is required)*

- *(résumé body at full altitude — the candidate's own headings)*
- `## Claim rules` — ⚠ hazards + per-audience renderings, seeded at intake from the hazard table (`references/patterns.md`); also holds **intake rulings** — one line per declined proposal ("declined at intake: <value> from <source>, <date>"), read before proposing so a re-run never re-asks what was refused. **Internal, never ships.**
- `## Rounds` — optional; append-only round record `| date | round | driver | scored vs FIXED | what changed |` (inlined directly into the base résumé)

The single source of truth for every fact. Read by positioning, apply,
outreach, storybank. The audit lives in `eval.md § The résumé audit`.

**Where the base COMES FROM — never invent one.** In order, first hit wins:

1. `base-resume.md` in the workspace.
2. Résumé-shaped text pasted into the request. Use it, and save it as
   the new base.
3. A résumé-shaped file in the folder. Prefer names containing
   resume or cv, then the newest; if two are indistinguishable, ask.
   Extract it, then write `base-resume.md` so later runs skip the scan.

**Never shrink the base** — a partial find never overwrites a fuller
one. **No base anywhere: ask, and stop.** A missing base is a hard stop,
not permission to generate one.

## `base-resume-brief.md` — Loop A's brief

- `## FIXED`
- `## LIVING`

## `base-resume-history.md` — the round record *(or inlined as `## Rounds` in `base-resume.md`)*

Append-only rows `| date | round | driver | scored vs FIXED | what changed |`;
the header row and cell counts are checker-enforced. `scored vs FIXED`
is a count — `N/M held; unmet: <item>, <item>` over the FIXED bullets
(each bullet is one item; M is the bullet count), plus the reader tiers
(`ATS-Ready · Strong · Strong`) — so two rows can be compared without
reading prose. Rows written before 2026-08-21 are sentences; the
ceiling compares count rows only.

**Lifecycle.** Created on the first improvement round, never before.
Written by the base-résumé loop, one row per round — a round that changed
nothing still gets a row. **Read by that loop before it scores**: the
ceiling (two rows with the same count and tiers) is a fact about earlier rounds,
and a fresh session remembers none of them. Never pruned — append-only is
what makes the ceiling visible and a bad round revertible.

## `voice.md` — how they write; optional

- `## Writing samples` — 2–3 REAL samples, theirs, verbatim
- `## Never-say list` — AI-isms and phrases they'd never use

Samples and bans only — abstract style adjectives don't steer generation.
Read wherever candidate-voiced text is generated, together with the
do/never table in the workspace `CLAUDE.md` (always loaded; voice.md =
this candidate's register, the table = the craft for every candidate) and
the trace rule in `candidate-voice.md`.

## `pitch.md` — the positioning record

- `## Core statement` — atomic positioning line, substitution-tested
- `## Variants` — the five variants as bold labels inside the section
- `## Messages rubric` — the pinned message-priority table
- `## Diagnostics` — optional; scores + primary weakness
- `## Consistency notes` — optional; per-surface mismatches and rewrites
- `## Rounds` — optional; append-only round record `| date | round | driver | scored vs FIXED | what changed |`
- `## Other notes` — optional

## `pitch-brief.md` — the pitch loop's brief

- `## FIXED`
- `## LIVING`

## `pitch-history.md` — the pitch round record *(or inlined as `## Rounds` in `pitch.md`)*

Append-only rows `| date | round | driver | scored vs FIXED | what changed |`. Header and row cell counts checked.

## `linkedin-audit.md` — the LinkedIn profile review

- `## Profile review` — headline, about, and experience section audits and concrete rewrites
- `## Consistency notes` — alignment with base résumé and pitch
- `## Other notes` — optional
