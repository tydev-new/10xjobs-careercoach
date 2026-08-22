# Evaluate — how to judge the work

`SKILL.md` names the destination; this file is how to tell it is
reached, and who checks.

## Who checks what

- **Structure and counts → the scripts.** `scripts/record_verdict.py`
  owns the verdict row: four tiers, the upsert key, the printed
  created-or-updated line that catches a drifted company string. `../../profile/scripts/check_files.py` checks the
  manifest (`jd-analysis/`, `company/`) at session close.
- **Language against written rules → no checker-subagent.** The analyses
  are the analyst's voice, not the candidate's; nothing here is checked
  against `language-check.md`. Stated so nobody wires one for the sake
  of it.
- **Everything semantic → you, at the moment**: whether a label is
  honest, whether a claim's tier is right, whether the want side leaked
  into the tier.

## The destination, judged

- **The verdict is recorded** — one row, written by the script with the
  row's EXACT existing company + title strings; a "created" for a role
  that was already swept is a duplicate and fails the run
  (t6-duplicate-row measures this).
- **The track is assigned first** and named in the verdict, the row,
  and the analysis header when `criteria.md` defines tracks
  (t6-track-assignment).
- **Dealbreakers before research** — a hard hit is dismissed with its
  quoted dealbreaker and NO research follows (t14-dq-no-research); an
  ambiguity (comp unstated, location unclear) is a verification
  question, never a DQ (t14-ambiguity-not-dq).
- **Every LOW and UNKNOWN finding carries a recruiter question** —
  the candidate never walks away believing an inference is a fact.
- **Every company claim is tiered** (verified / general knowledge /
  unknown), conflicts shown both ways, anything older than 12 months
  flagged, and the brief names what could NOT be found
  (t6-research-honesty).
- **The cheap tier is stamped and named** — `quick-scan:` in the row's
  reason; a graduation says "was quick-scan 72 → full evaluation: 68"
  (t14-quickscan-honest measured the omission).
- **The card is the reply**, in the shape in `schema.md`; the files
  carry the depth.

## The verdict tiers — the scoring standard

The tier answers "would they hire you?" and nothing on the want side
moves it.

- **Strong Fit** — meets most requirements, seniority aligns, logical
  next step. Prep = positioning and differentiation.
- **Investable Stretch** — 1–2 addressable gaps; a credible case exists.
  Prep = gap-bridging narratives.
- **Long-Shot Stretch** — 3+ gaps or a fundamental mismatch (2+ levels
  up, zero domain overlap). Name the odds; coach if they proceed.
- **Weak Fit** — misalignment across multiple dimensions. Say so;
  suggest better-fit alternatives ("based on your profile, you'd be
  stronger for [role type] at [stage] because [reason]"). Respect their
  agency if they proceed anyway.

The fit score (0–100) is your calibrated judgment across the five
dimensions in `patterns.md § Fit assessment`. Judged: did company-side
findings get weighed, and did a ranking reuse a recorded score rather
than mint one (t14-no-second-number)?

## Research depth, judged

The depth chosen names which source classes it must cover
(`patterns.md § Company research`); a class skipped or empty appears in
the brief's "what I could NOT find" line. Three uncertain sources never
become one confident claim.
