# 10xjobs-careercoach

**Ten** is an executive job-search copilot with a built-in coach,
shipped as a set of Claude skills (and, in private beta, as a web app).
Story bank, one-verdict role evaluation, a pipeline board, tailored
applications, interview prep and practice, outreach — with **all of
your data in a folder on your machine** (or your own cloud workspace in
the web beta), and a coach that reads it and tells you what's next.

Install: [`INSTALL.md`](INSTALL.md). Then, in a folder you choose:
*"I need a job."*

## Start here (contributors)

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the pieces fit,
  with diagrams: one coaching turn, the money path, the data, deploys.
- [`docs/TEAM.md`](docs/TEAM.md): the agent team, the loop every change
  goes through, and where a human contributor fits in.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): setup, tests, your first
  contribution, and what a good pull request looks like.
- [`docs/PROCESS.md`](docs/PROCESS.md): the loop every change goes
  through, step by step.
- [`SECURITY.md`](SECURITY.md): keys, personal data, and how to report a
  vulnerability privately.

## How it works

Unified skills, one workspace. Each skill owns a few files; the coach owns
the plan. You never need to know the skills exist — three moves cover
everything: **"what's next?"** (the coach reads the workspace and
prescribes), **"do it"**, and **"here's what happened"**.

```
groundwork ──── searching ──── applying ──── interviewing ──── deciding
(profile,       (search,       (apply,       (interview,        (Rule 10
 storybank)      evaluate)      outreach)      learn)           boundaries)
```

What makes it a coach rather than a generator:

- **Nothing enters your résumé that you haven't ruled on.** A fact from
  a conversation is proposed, never written; a struck claim never comes
  back in other words; an independent checker reads every candidate-
  voiced document against your own rules before it ships.
- **Honest numbers.** No rate below five real outcomes, no trend on
  fewer than three points, no credential from a quiz, no role invented
  on a thin week.
- **Every improvement is a bounded loop against a written standard** —
  with a round budget, a record of each round, and a ceiling: two rounds
  without movement means change the approach or bring you the decision,
  never grind.
- **You fire every gate.** Nothing is sent, submitted, or accepted by
  the agent; it prepares, you click.

## The shape

Every skill has the same five files — `SKILL.md` (the goal, the loops
with their standard, budget, measured rules, and exits), `references/
eval.md` (how the work is judged, and who checks: script, independent
subagent, or the model), `references/schema.md` (the file shapes),
`references/patterns.md` (how to get there faster), and `scripts/`
(what code checks, so prose doesn't have to). The spec is
[`docs/skill-shape.md`](docs/skill-shape.md); `tests/test_invariants.py`
fails the moment a skill drifts from it.

Precedence for any design question: [`PRINCIPLES.md`](PRINCIPLES.md) →
[the goals](docs/design-cowork-coaching-goals.md) → [the design](docs/design-cowork-coaching.md)
→ [the shape](docs/skill-shape.md). The web app's contracts,
[`design-web-agent.md`](docs/design-web-agent.md) and
[`design-web-ui.md`](docs/design-web-ui.md), answer to the same chain;
their place inside it is not yet ranked. The process every change goes through
— design gate, independent review, measured harness — is
[`docs/PROCESS.md`](docs/PROCESS.md).

## Measured, not asserted

Each skill has a conduct harness (`tests/always-on/`): a planted
workspace, a baited prompt, an independent judge scoring the reply and
the files against a written expectation. The records are in
[`docs/evals/`](docs/evals/); the rollout that brought every skill to
the shape is [`eval-shape-rollout-2026-08-21.md`](docs/evals/eval-shape-rollout-2026-08-21.md).

```bash
python3 tests/run.py                                   # almost every suite (see CONTRIBUTING.md)
CASES=all TRIALS=2 tests/always-on/run_t8.sh <tag>     # one conduct suite
```

## Contributing

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), then `CLAUDE.md` and
[`docs/PROCESS.md`](docs/PROCESS.md). A change to a skill is a design
gate, an independent review, and a measurement — the ritual is the
product. MIT licensed.
