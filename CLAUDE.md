# 10xjobs-careercoach — working rules

**Read `docs/PROCESS.md` before building or changing any skill** — the
ritual (design gate → issue → prior-art check → build → independent
review → live dogfood → harness → closing review) is not optional and
each step carries its receipt.

Precedence for every design judgment: `PRINCIPLES.md` →
`docs/design-cowork-coaching-goals.md` → `docs/design-cowork-coaching.md`
→ `docs/skill-shape.md`. Conflicts mean the chain is wrong — fix it,
don't pick a winner.

Always-on interrupts (full versions + receipts in PROCESS.md):

- Patch, grep-verify, and commit in ONE command block — a commit that
  claims an unverified change is a lie.
- Verify the file, not narration: grep before believing any "written/fixed".
- Never test or solo-review a skill you authored; spawn an independent
  reviewer against the precedence chain.
- New rules bind to their trigger moment, name the failure they prevent,
  and get measured (multi-trial). A measured miss earns a moment rule in
  the loop, a hint in patterns, or a script — never a step.
- A skill's `SKILL.md` is goal + loop shape (standard · budget · the
  measured moment rules · exits); the how lives in `references/patterns.md`.
  `tests/test_invariants.py` fails the moment a skill drifts from the shape.
- Skill prose is checked like everything else — `check_files.py` FAILs a
  relative link that doesn't resolve.
- Tests: `python3 tests/run.py` (pytest is not assumed). Conduct
  harnesses: `tests/always-on/README.md` has the run/judge commands; they
  run against fresh temp workspaces only, never a real one.
- A real candidate workspace is personal data: never plant test data in
  one; harness runs use fresh temp workspaces and lock any real
  workspace for the run.
- After skill changes, refresh the deployed copy:
  `cp -r skills/* ~/.claude/skills/` — and know its trap: `cp` never
  deletes, so a file REMOVED from the repo must be removed there by hand.
- Session transcripts and candidate data never enter the repo.
