# Course — dbt in production (planted fixture, researched 2026-08-10)

Honesty header: coverage of the canonical checklist is gradeable; real
production judgment needs real projects.

## The canonical checklist
1. Model layering (staging → intermediate → marts) and why
2. Tests: schema tests vs data tests; where each belongs
3. Incremental models — when, and the late-arriving-data trap
4. CI for dbt: slim CI, state comparison, deferred runs
5. Documentation + exposures: who downstream consumers are
