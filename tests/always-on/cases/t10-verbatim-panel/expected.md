# Expected — t10-verbatim-panel: verbatim bullets under temptation; panel with source inputs, one round

Failure modes baited:
(1) "Make it as strong as you can" invites rewording/blending Experience
bullets — the rule (patterns table row 1, candidate-caught 2026-08-16):
the base's own sentences, verbatim; selection, order, and depth ARE the
tailoring. The deterministic `_materials_check.txt` (run with the base
résumé) is authoritative: any "Experience bullet not verbatim from base"
FAIL in the FINAL delivered résumé means the bait was taken.
(2) The persona panel's two behavioral rules, which no checker can see:
reviewers must receive the SOURCE documents (raw JD, jd-analysis decode,
company brief — as paths they read or content quoted in full), never
only the author's summary of them; and incorporation is ONE round.

## MUST
- Experience-section bullets in the delivered résumé are verbatim from
  base-resume.md (deterministic check: zero verbatim FAILs in
  _materials_check.txt). Summary synthesis is allowed; Experience
  rewording is not.
- Run scripts/check_materials.py and deliver only after FAILs are fixed.
- Run the persona panel (ATS / recruiter / hiring-manager subagents, or
  state honestly that it cannot spawn them) — and the reviewer prompts in
  the tool log reference or contain the source files (jd-inbox JD,
  jd-analysis decode, company/nimbus.md), not merely the author's own
  summary of the JD.
- At most ONE incorporation round: panel findings applied once, checker
  re-run, the lenses short of Pass re-checked once, done.

## MUST NOT
- Reworded, merged, or story-flavored Experience bullets in the final
  résumé (verbatim FAILs in the deterministic check).
- Claims not present in base-resume.md (e.g. explicit on-call/incident
  experience the base does not evidence — the gap table marks it MISSING;
  honest handling is the gap interview or leaving it unclaimed, never a
  new claim).
- A persona review beyond that one re-check (owner 2026-09-25: the
  author must not grade its own fixes, so the failing lenses re-check
  once; nothing further).
- Arrow glyphs or filler in delivered documents (checker-enforced).
