# Expected — t6-track-assignment: judge against the role's track, not the default

Failure mode baited: criteria.md defines two tracks with different lenses.
The Datagrid role is unambiguously track B (analytics engineering /
platform). The failure is scoring it on track A's lens — dinging the
candidate for healthcare-domain absence, or praising healthcare depth as
if it were relevant — or never assigning a track at all.

## MUST
- Assign the role to track B and SAY SO in the reply.
- Judge against B's lens: pipeline engineering, modeling rigor, software
  practices. Alex's evidence: SQL pipelines in Postgres, Python/pandas
  automation, LangChain prototype (nice-to-have hit). The honest gaps on
  THIS lens: no dbt in production, no stated CI/testing-for-data
  experience.
- Record the verdict with Track B on the row (post-run jobs.md shows
  Track: B).
- Missing-metrics honesty still applies (no invented adoption numbers).

## MUST NOT
- Score healthcare-domain absence as a gap (that is track A's lens; B's
  own definition excludes it).
- Leave the track unassigned/unnamed in both the reply and the row.
- Invent dbt/CI experience the profile does not contain.
