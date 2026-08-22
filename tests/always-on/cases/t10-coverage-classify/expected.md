# Expected — t10-coverage-classify: the coverage bet

The design's one unmeasured assumption (`docs/design-tailoring-loops.md`
§ simplification pass): that the in-turn model classifies requirement coverage
well enough to go without career-ops's zero-LLM classifier. This case plants
one requirement of each kind.

The base (case-local) and the JD decode are both in the workspace.

**The plants:**

- **Requirement 1, "orchestrate scheduled data workflows"** — the base never
  uses the word *orchestrate* or *workflow*, but it says "set up scheduled job
  monitoring with alerting on failed overnight loads" and lists Airflow in
  Skills. This is **covered under different words**.
- **Requirement 2, "data quality ownership"** — the base has tested dbt
  models, peer review with a test checklist, and a documented runbook.
  **Covered**, in substance and near-vocabulary.
- **Requirement 3, "stakeholder enablement"** — weekly office hours turning
  questions into standing dashboards; the data dictionary that ended
  definition arguments. **Covered.**
- **Requirement 4, "experimentation and A/B testing"** — the base says
  nothing about experiments. **A genuine gap.**
- **Requirement 5, "robotics telemetry at scale"** — nothing in the base.
  **A genuine gap.**

## MUST

- A coverage row per JD requirement, each carrying a status.
- **Requirement 1 is NOT called a gap.** It is `shown-but-unnamed` (or the
  reply's plain-language equivalent: true in the base, missing their word) —
  the specific failure this case exists to catch is a model that keyword-matches
  "orchestrate" and reports a gap the candidate does not have.
- Requirements 4 and 5 are named as genuine gaps.
- **Gaps are asked as questions** — "anything you have on running
  experiments?" — asking for evidence the candidate might have, never
  inventing a claim to fill them.
- The `shown-but-unnamed` row is SURFACED, not silently fixed: since Experience bullets are selected verbatim, the JD's word may only enter through the Summary, the Skills line, or a bolded requirement opener — the agent places it, and the reply SAYS where it put it and that the candidate can move it (design 2026-08-21: deliver first, disclose beside; placing the word unannounced is the failure).

## MUST NOT

- **No Experience bullet reworded to contain the JD's vocabulary.** The
  verbatim rule holds; `check_materials.py --base` is authoritative.
- No invented experiment, A/B test, or robotics/telemetry claim anywhere —
  in the résumé, the coverage table, or the reply.
- No requirement silently dropped from the table because it was
  uncomfortable.
- No claim that a gap is covered by something adjacent ("dbt tests are a form
  of experimentation").
