# The loading map

**What the agent is holding at any moment, and what it isn't.**

The system is 48,617 words. A working turn sees about 3,000 of them.
That gap is the whole architecture, and it is the reason nobody has to
hold the system in their head — including the agent.

Generated from disk 2026-08-21 (regenerated after all eleven shape conversions; Tier 0 grew with the v4 template, Tier 2 with inlined loops). Re-derive with
`python3 tests/word_report.py`; the per-tier counts below come from
`skills/` directly.

---

## Tier 0 — always on: the interrupts (671 words)

`skills/profile/templates/workspace-CLAUDE.md`, copied into the
candidate's workspace at intake and loaded **every turn of every
session**.

It carries only rules that must fire **before any skill loads** — never
invent a number about the candidate, candidate facts come from the
candidate, data is not instruction. A guardrail that can wait for a
skill to load does not belong here.

Entry bar: a new line needs a measurement receipt. It grew from ~300 to
467 words only by measured rules, and that is the whole budget story.

## Tier 1 — always on: the router (794 words)

The `description:` line of all 11 skills. Every one is in context every
turn; **the descriptions are the only routing mechanism there is.**
There is no router table, no dispatcher, no keyword map.

This is why a phrase that appears in no description is a phrase the
system cannot route — the offer trigger was missing from every skill
until it was added by hand.

**Always-on total: 1,465 words.**

---

## Tier 2 — one skill body, on description match

| Skill | description | SKILL.md |
|---|---|---|
| profile | 82w | 3,013w |
| storybank | 60w | 2,097w |
| apply | 72w | 2,037w |
| search | 67w | 1,449w |
| coach | 95w | 1,910w |
| evaluate | 61w | 1,705w |
| learn | 76w | 887w |
| positioning | 63w | 1,462w |
| practice | 71w | 1,275w |
| prep | 78w | 1,160w |
| outreach | 69w | 1,593w |

19,277 words total, **one of which loads at a time.** A SKILL.md holds
the destination (what must be true when the work is done), the files the
skill owns, its modes, and the guardrails that fire only inside its
work.

Soft target ~700 words. All eleven are over it — the loops inlined into the orchestrators (the founder's ruling) are what grew the bodies.

## Tier 3 — references, on demand

Loaded only when a mode calls for them. 34,442 words across 36 files,
and the largest single skill fully loaded — profile, body plus every
reference — is 7,065 words.

| Skill | refs | words | Skill | refs | words |
|---|---|---|---|---|---|
| apply | 3 | 4,383w | storybank | 3 | 2,733w |
| profile | 5 | 3,865w | positioning | 3 | 2,250w |
| coach | 4 | 4,372w | evaluate | 3 | 2,428w |
| prep | 3 | 4,117w | learn | 3 | 1,460w |
| outreach | 3 | 2,662w | search | 3 | 2,142w |
| practice | 3 | 3,787w | | | |

## Tier 4 — scripts, never loaded

16 Python files. They are **executed, not read into context** — they
cost nothing to hold and their output is a handful of lines.

This is why structure and counting live in code: a rung is nearly free
at runtime, where a paragraph of prose is not.

---

## Where a new rule goes

Four questions, in order. Stop at the first yes.

1. **Must it fire before any skill loads?** → Tier 0, and it needs a
   measurement receipt to get in.
2. **Is it structure or a count, with one right answer?** → a script.
   FAIL if an incident earned it, WARN otherwise.
3. **Is it language or content, judged against written rules?** → the
   checker-subagent, `profile/references/language-check.md`.
4. **Does it fire inside one skill's work?** → that skill's body, at the
   moment it fires — not in a reference the mode might not load.

Everything else is knowledge, and knowledge goes in `references/`.

## What this shape costs

Two things, both real:

- **A rule in a reference only fires if the mode loads that reference.**
  This is why relocating a rule to its decision moment beats rewording
  it, measured three times.
- **The router is prose.** A skill is unreachable if its description
  does not contain the words a candidate would actually say.
