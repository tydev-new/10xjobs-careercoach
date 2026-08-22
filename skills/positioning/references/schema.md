# Positioning — the file shapes

What `../../profile/scripts/check_files.py` verifies, plus the shapes it
cannot see but the files must still hold. **The section list is the
schema** — these sections, these names, this order; the checker parses
this file and enforces it. Read it before writing or editing any of
these records.

## `pitch.md` — the positioning record

- `## Core statement` — the atomic positioning line, substitution-tested
- `## Variants` — the five, as bold labels inside the section, not `###` headings
- `## Messages rubric` — the pinned message-priority table; preserved verbatim on rewrites
- `## Diagnostics` — optional; scores + the primary weakness
- `## Consistency notes` — optional; per-surface mismatches and rewrites
- `## Other notes` — optional

Cross-session state other skills read: outreach mines hooks under the
pinned rubric's tiers, practice drills the TMAY variant, apply echoes the
core statement. Proof points cite stories by `S###` (confirmed only),
never copied story text. **No history section in this file** — history
lives in `pitch-history.md`, where append-only survives rewrites.

**The five variant specs are contracts:**

| Variant | Length | Shape |
|---|---|---|
| Interview TMAY | 60–90s | Present–Past–Future; judged on clarity, coherence, role relevance, self-awareness, energy — never a chronological résumé walk |
| Networking | 30–45s | Hook–Context–**Ask**; ends with a question |
| Recruiter call | 30–60s | keyword-aware, seniority-signaling, explicit "what I'm looking for" |
| Career fair | 30–60s | high energy, strongest credential first, one memorable phrase |
| LinkedIn hook | ~300 chars | above-the-fold; keywords + curiosity gap; written for reading |

**The Messages rubric** is the one authoritative message-priority table —
dated tiers: PRIMARY / KEY DIFFERENTIATOR / SELECTIVE / ⚠ WATCH. An
unpinned rubric is marked PROPOSED and treated as advisory, never
silently as authoritative.

## `pitch-brief.md` — the pitch loop's brief

- `## FIXED`
- `## LIVING`

`§ FIXED` draws on the target plus LinkedIn's hard limits (headline 220
characters, About 2,600). It never bends to a draft; it changes only
when its source changes.

## `pitch-history.md` — the round record

Append-only rows `| date | round | driver | scored vs FIXED | what changed |`;
the header row and cell counts are checker-enforced; `scored vs FIXED`
is `N/M held; unmet: …` over the FIXED bullets (each bullet one item)
plus the 1–5 diagnostic; rows written before 2026-08-21 are sentences
and the ceiling compares count rows only. A row is appended on
EVERY `pitch.md` rewrite, whoever drove it — improvement round,
consistency sweep, LinkedIn same-turn update; the `driver` column says
which.

**Lifecycle.** Created on the first rewrite, never before. Written one
row per round — a round that changed nothing still gets a row. **Read by
the pitch loop before it scores**: the ceiling (two rows with the same count and diagnostic) is a fact about earlier rounds, and a fresh session remembers
none of them. Never pruned.

## `linkedin-audit.md` — the audit report

Free-form report, regenerated per audit (manifest-listed, not
schema-checked). Must contain: per-section findings + rewrites,
**Conflicts and Gaps** vs the authoritative files, a prioritized fix
list, the content plan when the timeline allows one, and what could not
be audited — unseen sections named, with why.
