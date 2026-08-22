# Storybank — the mechanical formats

What `scripts/check_stories.py` verifies, plus the shapes it cannot see
but the files must still hold. Read this when writing or editing a story
record.

## Index row — `storybank.md § Stories`

| Column | Description |
|---|---|
| **ID** | S001, S002, … |
| **Title** | Memorable and specific (not "led project") |
| **Primary Skill** | Main competency (tags below) |
| **Secondary Skill** | Optional additional competency |
| **Impact** | Quantified outcome, or the explicit reason it can't be |
| **Domain** | Technical / Product / Business / People |
| **Risk/Stakes** | What could have gone wrong; why it mattered |
| **Earned Secret** | One-line version of the counterintuitive insight |
| **Strength** | 1–5 (the scale is in `eval.md`) |
| **Status** | `confirmed`, or `draft [source: <file>]` |
| **Use Count / Last Used** | Incremented after real interviews — tracks overuse |
| **Notes** | Performance notes, feedback |

**IDs are sequential** — next = highest existing + 1 — and an ID is never
reused, even after retirement.

## Status — exactly two forms

    confirmed
    draft [source: <file>]

**`<file>` names a real document that was mined.** A conversation is not
a file. A story the candidate told you live is `confirmed`, however
incomplete it is — see `eval.md`, which separates *complete* from
*confirmed*.

`check_stories.py` FAILs anything that is not one of these two forms,
and FAILs an index row with no story file or a story file with no index
row.

## Story file — `stories/S###-<slug>.md`

The index is a quick reference. The full story lives in the file, and it
holds: the 30-second version · the full STAR narrative · What I Learned ·
the Earned Secret with its proof and when-to-deploy · Use This For (the
questions it answers) · Status · a pointer to its rounds in
`storybank-history.md`.

Without the full text, no later session can coach on the story without
re-eliciting it.

## Standardized skill tags

Leadership · Collaboration · Problem-solving · Data-driven decision
making · Communication · Technical depth · Strategic thinking ·
Ambiguity navigation · Conflict resolution · Customer focus · Innovation ·
Execution/delivery · Mentorship · Influence without authority

## The round record — `storybank-history.md`

Append-only, one row per improve round, header exact:

    | date | story | round | what changed | scored |

The header and cell counts are checker-enforced. A round that changed
nothing still gets a row — that is how the ceiling becomes visible.

**Lifecycle.** Created on the first improve round, never before — an
empty history file is noise. Written by the improve loop, one row per
round. **Read by the improve loop before it scores**, because the
ceiling ("two rounds with no movement") is a fact about earlier rounds
and a fresh session remembers none of them. Never pruned: append-only is
what makes the ceiling visible and a bad round revertible. A retired
story keeps its rows, for the same reason it keeps its file.

## Retiring a story

Set the index row's Notes to `RETIRED <date> — <reason>` and keep both
the row and the file. **Never delete**: use-count history survives, and
any prep brief or pitch that cites the story keeps its pointer.

## Earned secret — what the record must contain

Every story needs one before it is complete. The record format is three
parts: the secret as a two-sentence point of view · the proof (a metric,
an artifact, or a counterexample) · when to deploy it (which interview
questions it answers).

*(What makes an insight qualify, and the questions that draw one out,
are in `patterns.md`.)*
