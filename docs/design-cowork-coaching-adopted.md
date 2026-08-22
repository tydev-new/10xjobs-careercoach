# Design — Coaching on Cowork: what we're taking from the redesign doc

**Status: RECORD — decisions of 2026-08-13, all since executed or tracked.**

The verdicts that disposed of the CareerCoach import. Their content now
lives in `design-cowork-coaching.md` (the working design); the build list's
live copy is GitHub issues #11–#18; the prior-art pass method moved into
the working design. Nothing here governs — read it for why decisions went
the way they did.

## Verdicts

| Section | Verdict |
|---|---|
| §2 Philosophy | **Adopt whole.** Principle 3 gains the deletion valve (goals doc, goal 4) |
| §3.1 What loads when | **Replace** with the platform mechanism: `CLAUDE.md` + skill descriptions + `references/`. Keep the 12-skill decomposition and "skills judge; scripts compute" |
| §3.2 Loop A | **Adopt** — brief / current / history on `base-resume.md` and `pitch.md`; self-loop capped at two passes, checkable half in `check_materials.py` |
| §3.3 Loop B | **Adopt** — `retracted-claims.md`, the 3-tier question-sourcing ladder, "never sharpen a vague signal into a specific question" |
| §3.4 Judging | **Adopt, scoped** — strong/solid/gap for one-off answer reviews; practice's gated 1–5 rubric stays (gates satisfy principle 7) |
| §3.5 Job search | **Repo wins.** Take three things: source tier on the record, retirement by liveness, the field→sources map |
| §4 Data contract | **Adopt the structure, repo file names win.** The five classes + lifecycle rules become the manifest. Convention kept: a sweep appends; a state change rewrites one row |
| §5 Interface | **Replace** with what's proven on Cowork (artifacts read-only, inline widgets write back). Keep: read a living file from disk before every touch |
| §6 Implementation | **Replace the phases; adopt the eval method** (§6.1): planted workspace, scripted turns, mechanical fabrication check, fixtures from captured bytes, replay as standing regression |
| §6.2 Telemetry | **Delete** — openclaw-specific |
| §7 Enforcement | **Rework per goal 2**: code-FAIL only for file-missing / length / schema / duplicates; provenance + retracted claims are WARN (code flags, model defends) |
| §8 Assumptions | **Keep** A1 (rescoped to "the tier we eval against"), A3, A4, A7, A8, A14. A2 becomes "do descriptions route correctly" |
| Appendix A | **Adopt as the `CLAUDE.md` source**, trimmed to ~250–300 words |

## Settled calls

1. **One résumé, two layers.** Loop A governs `base-resume.md` against its
   brief — one document, one standard, one history. Apply's reshape-only
   tailoring is **derived output** per application, recorded in
   `applications/` — never a competing version. (Resolves A6 vs. the shipped
   apply skill.)

2. **Every application ships three things:** the tailored résumé, a cover
   letter making the case why this candidate for this JD, and an **outreach
   plan** — recruiter and hiring manager identified under outreach's evidence
   rules, with proposed messages. That is apply's destination; an application
   without an outreach plan isn't done. The candidate still sends everything.
   (D3 "contact discovery out" is overtaken.)

3. **`question-bank.md` becomes its own file**, out of `practice-log.md`.
   Read first by prep and practice per the sourcing ladder: asked of this
   candidate → researched company questions → generated from the format
   patterns + this JD, labeled `[inferred]`. No static seed file — a
   generated question tailored to the JD beats a generic seed, and the
   vendored snapshots remain the source if evals ever show otherwise.

4. **Target companies fold into `criteria.md`; `companies.txt` and the `*`
   convention retire.** The `*` mixed user-specified and machine-found
   companies in one file. The rule that replaces it: user-specified companies
   live in `criteria.md` (user-owned, always swept, theme filter relaxed for
   them); machine-discovered companies accumulate in a machine-owned file.
   Never mixed.

5. **Guardrails have scope** — recorded in the goals doc, goal 2: always-on
   only for what must fire before any skill loads; skill-scoped guardrails
   live in the skill body.

## The prior-art pass

Before building each item below, compare against both vendored sources —
`vendored/interview-coach/` (Noam) and `vendored/career-ops/` (see
`VENDORED.md`). Sort every mechanism into three bins:

| Bin | Tell | Fate |
|---|---|---|
| Baby instructions | output schemas, stage-detection logic, menus, state-file plumbing | strip — a strong model doesn't need them |
| Proven framework / knowledge | attributed patterns, rubric anchors, earned heuristics | keep, loaded on demand |
| Guardrails | anti-fabrication rules, hard gates, legal constraints | keep — always-on, code, or data files |

Both sources are proven in use — Noam across real candidates, career-ops
across a contributor community with reported hires. A rule kept from either
carries its receipt. Note career-ops' legal guardrails shipped as **data
files** (`templates/*.yml` — protected grounds, prohibited content,
restrictive covenants): goal 2's guardrails-as-code pattern, independently
arrived at, and the shape to prefer where it fits.

## Build list

1. `CLAUDE.md` draft (Appendix A → ~300 words) + stress replay against the
   installed plugin — the one surviving spike
2. `retracted-claims.md` + WARN wiring in `check_materials.py`
3. The manifest (§4 classes, repo names) + stray-file check
4. Loop A triple on `base-resume.md` and `pitch.md`
5. `question-bank.md` promotion + sourcing ladder + never-sharpen rule
6. Intake de-script (the pilot; writes the workspace `CLAUDE.md`)
7. Fold `companies.txt` into `criteria.md` + machine-found accumulator
   (search script change)
8. Apply's destination gains the outreach plan
9. `jobs.db` → markdown record, sqlite on demand (rides the manifest's
   strict-schema work)
10. Later: retirement by liveness · field→sources map · eval re-basing per
    the §6.1 method
