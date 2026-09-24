# Evaluate — the craft of decoding and research

Technique, not rules: how to read a JD, how to research a company, how
to assess fit. Rules live in `../SKILL.md`; the scoring standard in
`eval.md`. **Read this before decoding** — the t6 design gate measured
that a decode without it matches an unskilled read.

## Full evaluation — getting there

1. **Intake.** The JD and the company name. A swept role's JD is
   already in `jd-inbox/` — read it from the row's `jd_file`.
2. **Dealbreakers** (the sequence's rule 2). Two steps for a pasted
   role with no row: `scripts/record_verdict.py --workspace . --company
   <company> --title <title> --verdict weak --score 0 --reasons
   "dq: <quote>"` (creates the row), then `../../search/scripts/update_job.py
   --workspace . --company <company> --title <title> --dismiss --reason
   "dq: <quote>"`, same reason — the script's four tiers stay untouched.
   An existing row (already swept) skips straight to the second command.
3. **Assign the track** (rule 3): judge against that track's lens — a
   Track-B transformation role is not scored on the Track-A template.
4. **Company research.** `company/<slug>.md` exists → staleness: under
   2 weeks, use it and offer a refresh; 2–8 weeks, ask ("my research on
   [Company] is [N] weeks old — want a refresh focused on what's
   new?"); over 8 weeks, refresh and compare verdicts explicitly ("last
   time: Investable Stretch; now [verdict] because [reason]"). Otherwise
   § Company research below — live web, cite what you actually looked
   at, tier every claim. Write or update the brief.
5. **Decode the JD** — the six lenses with confidence labels,
   competency extraction, the five-dimension fit against `profile.md`
   (storybank evidence where it exists), the teaching layer, the
   deep-decode extras when the table calls for them. Write the analysis
   to `jd-analysis/`; close with the read of the bar (rule 4).
6. **One verdict** — both halves into one tier (`eval.md § The verdict
   tiers`) plus a fit score (0–100); Flags carry the softer caveats
   (location vs profile geo, role-type mismatch, a criterion the JD
   leaves unverifiable).
7. **Record it:** `python3 scripts/record_verdict.py --workspace .
   --company … --title … --verdict … --score … --reasons …
   --dealbreakers …` (`--help` for all flags) — on the row's exact
   strings (rule 6).

   In a run over several roles, record each one as soon as its verdict is
   decided (its analysis file and its `record_verdict.py` call), then move
   to the next role. Never hold verdicts back to write together at the end:
   a batch cut off partway (a reply limit, a closed session) saves nothing,
   and the next session finds no sign the work was done. *(Receipt: web
   beta, 2026-09-24: three four-role runs lost everything at the final
   batch write.)*
8. **The summary card** (`schema.md`) is the reply — decision-ready;
   the files carry the depth.

## How JDs actually work

Signal density by section: **Requirements** = screening criteria (what
filters you in/out before a human looks). **Responsibilities** = what
the role actually does — often more honest than requirements.
**Nice-to-haves** = the "Strong Hire" profile; skipping them is a
mistake. **Company intro** = how the company wants to be perceived.
**Benefits** = comp philosophy (equity-heavy = startup; benefits-heavy =
mature org).

What JDs don't tell you (be explicit about these limits): actual
day-to-day reality, team dynamics and manager quality, backfill vs. new
headcount, whether the req is real vs. evergreen, true comp,
internal-candidate preference, timeline urgency.

## The six decoding lenses

1. **Repetition frequency** — count key themes. Repeated 3× = a primary
   evaluation criterion, regardless of where it appears.
2. **Order & emphasis** — first 3 bullets of responsibilities/
   requirements ≈ the top 3 evaluation criteria.
3. **Required vs. nice-to-have** — screening vs. what separates Hire
   from Strong Hire.
4. **Verb choices** — "own" vs "support" vs "contribute to" = autonomy
   and scope; "drive" vs "execute" = strategy vs implementation.
5. **Between the lines** — euphemisms, decoded with humility:
   "fast-paced" ≈ understaffed or rapid change; "comfortable with
   ambiguity" ≈ undefined role/early stage; "stakeholder management" ≈
   political; "wear many hats" ≈ no role boundaries. These are
   interpretations — label LOW/MEDIUM and attach a verification
   question.
6. **What's missing** — absence is information (a senior role with no
   mention of mentoring signals an IC-heavy org) but ambiguous: state
   what the absence might mean AND might not.

For each finding: the finding, the confidence label, the evidence, and
(for MEDIUM/LOW/UNKNOWN) the verification question.

## Confidence labels — what each means

| Label | Meaning |
|---|---|
| **HIGH** | Directly stated, standard meaning |
| **MEDIUM** | Reasonable inference from language patterns / industry norms |
| **LOW** | Interpretation of ambiguous language, euphemism decoding |
| **UNKNOWN** | Cannot determine from the JD (team size, reporting line, day-to-day) |

A recruiter question says what to verify, why it matters, and how to
ask it naturally ("Can you tell me more about [topic]?" — not "your JD
said X, what does that mean?"). Order by impact on the apply/don't-apply
decision.

## Competency extraction

Top 5–7 competencies in priority order; for each: the specific
competency, source section(s), confidence, repetition count, and type —
**Screening** (required) or **Differentiating** (nice-to-have).

## Fit assessment — five dimensions

| Dimension | Measures |
|---|---|
| Requirement Coverage | Required qualifications met vs. missed |
| Seniority Alignment | Experience level vs. the role's real expectations |
| Domain Relevance | Transferability of industry/domain experience |
| Competency Overlap | Demonstrated skills vs. the role's core competencies (storybank evidence = highest confidence) |
| Trajectory Coherence | Does this role make sense as the next career move? |

Score each Strong / Moderate / Weak; flag unknowns rather than guessing.
Per-competency mapping: **Match** (cite specific evidence) / **Partial**
(adjacent — explain the bridge) / **Gap** (name it honestly, classify
**frameable** vs **structural**) / **Unknown**. JDs are wish lists —
60–70% requirement coverage is often competitive, and
qualified-but-doesn't-advance is a different kind of poor fit
(trajectory), not a strong one.

## Deep-decode extras (high-priority targets, seniority mismatch, unusual JDs)

- **Seniority calibration**: what level the JD *states* vs. what its
  scope/verbs/requirements actually target — aligned / over-titled /
  under-titled, with implication for positioning.
- **Team maturity signals** and **JD structural quality** (well-written /
  boilerplate / kitchen-sink / contradictory — a kitchen-sink JD often
  means committee-written requirements or an unclear role).
- **Challenge pass**: assumptions this decode rests on; blind spots
  (what a JD can't show); devil's advocate (strongest case the decode is
  wrong); the single highest-leverage verification question.

## Batch triage (2–5 JDs)

After per-role evaluations: rank by fit (with evidence); **overlapping
competencies across JDs = the candidate's market-validated sweet spot**;
divergent requirements = a scope decision to make explicit; allocation
recommendation (pursue first / pursue with targeted prep / research more
/ skip — honest about skips); and a market-profile synthesis (what these
JDs collectively say the market wants from this candidate).

## Teaching layer — build the candidate's own decoding skill

Include in every standard evaluation: **Pattern spotted** (a decoding
insight from THIS JD they can reuse), **Trap to watch for** (a common
misread this JD exemplifies — e.g. "12 'required' qualifications is a
wish list; 6–8 matches is strong, don't self-screen out"), **Next time,
try** (a self-decode prompt for the next JD they read).

## Company research — sources, depths, tiers

Compose your own searches; cite what you consulted.

- **Careers page** → open roles, stated values, blog links
- **About/mission** → stage, funding, size, founding story
- **News, current year** → funding, layoffs, launches, leadership
  changes. Recent events change hiring culture — a company that just
  laid off 20% hires differently than one that just raised a round.
- **Interview-process signal** → Glassdoor/Blind (label crowd-sourced,
  not verified)
- **Engineering/product blog** → culture signals, technical maturity
- **Culture** → reviews, values page, employee posts
- **Leadership** (deep dive) → profiles, talks, published thinking

**Depths** — which classes the chosen depth must cover: **Quick scan**
(careers + about + news — enough for a basic verdict when triaging 5+
companies; this is a RESEARCH depth, not the skill's quick-scan tier,
which does no research at all) · **Standard** (all but leadership; the
default) · **Deep dive** (everything + employee posts, product reviews,
competitor analysis — for top-3 targets or scheduled interviews).

**Claim tiers:** **Tier 1 — Verified**: retrieved from the company's own
site/careers/blog or the JD; cite the source. **Tier 2 — General
knowledge**: widely documented public facts about well-known companies;
label clearly. **Tier 3 — Unknown**: couldn't verify; say so. Three
Glassdoor reviews saying slightly different things = present the range,
not a false consensus.

## Positioning, not role fit

A candidate can be Strong Fit on paper and still land badly —
positioning that doesn't address this company's current pain points
("you need a spear, not a net" — Phyl Terry). If the evaluation reveals
broad targeting with no positioning thesis, flag it as a strategic issue
distinct from role fit: it routes to `positioning` (the pitch) or
`profile` (narrower targets), and it never moves the fit score.

## Proposing a new pattern

When a lens, a euphemism reading, or a research source proves itself
on two real JDs, write it in the jd-analysis file's `## Teaching layer`
as a proposal — name the two files. A pattern is never self-adopted; a
human promotes it into this file.
