# Design — Coaching on Cowork: the goals

**Status:** agreed · **Date:** 2026-08-13 · **Owner:** Yong

**These goals are `PRINCIPLES.md` applied to the coaching-layer rebuild** —
not a second constitution. Each traces to the rules it applies:

| Goal | Derives from PRINCIPLES *(P1.x = Part 1 promise x; P2.x = Part 2 rule x)* |
|---|---|
| 1 — model owns the path, skill owns the destination | P1.4 (you bring you) · P2.13 (every rule derivable or earned) |
| 2 — knowledge on demand, guardrails always-on or code | P1.7 (unmissable moments) · P1.8 (honest, in your voice, or silent) · P2.14 (match the checker) |
| 3 — every session leaves a file behind | P1.9 (yours) · P2.11 (believe the file) · P2.12 (one of everything) |
| 4 — skills small enough to read, safe to edit | P2.18 (plain language) · P2.13 (earned rules → the deletion valve) · P2.15 (context is scarce) |

**Precedence:** `PRINCIPLES.md` → this doc → `design-cowork-coaching.md`.
A conflict anywhere in the chain means one of them is wrong — fix the
chain, don't pick a winner ad hoc.

---

## 1. The model owns the path; the skill owns the destination

No scripted turn order, no menus, no ask-Q1-then-Q2. The model runs the
conversation naturally. What a skill states is the **destination** — what must
be true when the work is done: intake ends with target + seniority band
written; a story isn't complete without an earned secret.

The destination is a standing obligation, not a session one. The user can
leave mid-way; the skill records what's missing **in the file itself**
(`TODO: seniority band` in `profile.md` — a `TODO:` is never filled with a
guess). The gap resurfaces **when it blocks the next thing the user wants** —
apply needs screening defaults — never on a schedule, never as a nag.

Destinations are what evals score: the end state of the workspace, not the
path taken.

## 2. Knowledge loads on demand; guardrails are always on

Two different things, opposite treatment:

| | Loads | Examples |
|---|---|---|
| **Specialized knowledge** | on demand, from `references/` | question bank, STAR, negotiation scripts, rubric anchors |
| **Guardrails** | always — or become code | never invent a number, role, or schedule · provenance on claims · retracted claims · submit/send gates |

A skill's body loads only when its short description matches what the user
said — that match is the only trigger there is. So a guardrail loaded on
demand only fires when the model already judged it relevant — and
fabrication is confident precisely when it isn't. Guardrails can't rely on
that match.

Guardrails have scope: always-on carries only those that must fire **before
any skill loads** (fabricating about the candidate, inventing numbers). A
guardrail that only fires inside one skill's work ("never invent a listing")
lives in that skill's body — the skill is loaded whenever it could fire, and
the always-on budget stays honest.

What checks what — split by what the check must READ (amended 2026-08-17,
the guardrail sweep; conclusions on issue #11):

| What the check must read | Checker | Examples |
|---|---|---|
| Structure or counts — one right answer | **code** — FAIL when incident-earned, WARN otherwise (the bar below) | FAIL: file missing · schema violation · duplicate row · a malformed history row. WARN: a stray file · a spec-born length band |
| Language or content, against written rules | **checker-subagent** — severities in its contract: struck forms / never-say / WATCH = fix-before-delivery hard stops; confirm-tier = defend-or-qualify | a struck claim reworded · a claim missing its required qualifier · a voice violation |
| Purely semantic, in the turn | **model** — self-check at the moment; in tests, a second model grades the output (an "LLM judge") | does it sound like them · is the tradeoff honestly named |

Why the split runs on what the rule READS: structure-tier code has proven
~free to keep (four checkers, 1–2 commits each, zero parser incidents),
while every parser fix-round and silent edge-case failure lived in the
code that had to understand prose — including a hazard parser that
silently loaded ZERO claims against a "never drifts" guarantee. Language
is the model's native format. The subagent row carries two required
mitigations for known agent failure modes: a **per-rule verdict table**
(every rule gets a row, so a skipped rule is a visible hole, not a silent
pass) and **quoted evidence on every flag** (each claim checkable by eye
or grep). Status: the structure row is earned; the subagent row is
**measured** — t15 (2026-08-17, record: `docs/evals/eval-t15-checker.md`):
subagent 10/10 catches with 0 false alarms vs the parser's 5/10 with 1,
verdict-identical across trials, exact on the word-count canary; it won
the paraphrase and format-drift cases as hypothesized and ALSO the two
probes designed for code to win.

**The earned-FAIL bar:** a code FAIL is earned by a real incident; rules
derived from a spec or a style preference start as WARN (or stay prose)
until an incident promotes them. The sweep found the only never-fired
rungs were ones set to FAIL — backwards, now corrected.

Silence on a WARN is not a pass. Stated honestly: exact-match code
false-passes on a paraphrase, and a false guarantee is worse than no
check — that gap is exactly what moves language checking to the
subagent tier.

**Where always-on prose lives — decided: `CLAUDE.md` in the workspace,
written at setup.** Native, no machinery, and a file the user can read.
Three conditions:

- **Small.** Interrupts only — it loads every turn; the budget is real.
  ~670 words as of v4 (2026-08-20): grown past the original ~300 ONLY by
  measured rules — t19's env-metadata line, the folder/drop section, and
  v4's candidate-voice do/never table, every row of which carries a
  receipt in `docs/receipts.md` (the verb ceiling t10-measured, the
  year-count and metaphor rows candidate-caught). A new line still needs
  its measurement receipt to enter.
- **Written at setup, checked after.** A plugin can't ship it, so intake
  writes it — and every skill treats a missing `CLAUDE.md` as a blocking
  gap (goal 1's resurface rule).
- **Refreshed by offer, never silently.** It's a snapshot and will drift as
  the plugin's guardrails improve. A version marker in the file; when the
  plugin is newer, offer the refresh — the user may have edited it, and
  it's their file.

Consequence, accepted with eyes open: prose guardrails in `CLAUDE.md` are
user-editable. The hard gates (submit, schema, duplicates) stay in code,
where no edit reaches them.

## 3. Every session that changed the picture leaves a file behind

Model strength improves reasoning inside a turn; it never closes the memory
gap across sessions. A session that changed the understanding and wrote
nothing has to be repeated.

Persistence rules:

- **Markdown only.** The durable record is `.md` files a person can open,
  read, and edit. The one database (`jobs.db`) becomes on-demand scratch —
  rebuilt for a sweep or a query, thrown away after; dedup is the
  record's own canonical keys (`jobs.md`), not a separate key file —
  shipped 2026-08-14.
- **Strict shape where scripts write.** Markdown-as-record is deterministic
  only if rows have a fixed schema that only the owned scripts write — a
  rigid table, or one small labeled header block per role. Free-form rows
  would recreate the old failure this repo was built to escape: one big
  free-form file that code parsed with pattern-matching, and that broke
  whenever the wording shifted.
- **A manifest — the list of which files may exist, and who writes each.**
  One file per concern, one owner. A
  stray-file check (glob against the manifest) catches `resume-v2.md` and
  `notes-stripe.md` before they become a second source of truth.
- **The escape hatch, named:** at a few hundred pipeline rows, parsing
  markdown to render a board gets silly and the pipeline moves to a real
  table. Reverse on evidence, not frustration.

## 4. A skill is small enough to read and safe to edit

The audience for skill prose is the **user**, not just the model. Noam's
interview-coach and career-ops both grew past the point where a normal user
could understand or change them; this goal prevents that.

- **Soft budget, measured.** A `SKILL.md` around ~700 words, plain register,
  one concern per reference file. An automatic check prints the word counts
  on every change; exceeding the target triggers a review, never a build
  failure.
- **The deletion valve.** Prose earns its place by an observed failure — and
  when an earned rule becomes checkable, it moves to code and the prose is
  deleted. The receipt lives in the commit or the script docstring, not the
  skill. Without this valve, earn-your-place is a one-way ratchet — which is
  exactly how skills become unreadable.
- **Three editing tiers.** Everyone customizes through their own files
  (`voice.md`, `companies.txt`, criteria) — the skill reads their file; they
  never open ours. Power users edit skill prose, and can, because it's short.
  Nobody edits away the hard gates, because those live in code; the prose
  guardrails in `CLAUDE.md` are theirs to edit, eyes open (goal 2).

---

## What this changes in the repo

- README architecture rule 1: "pipeline SQLite" → markdown record, sqlite on
  demand. The four pipeline scripts keep their interfaces and swap the
  storage layer.
- Evals re-base from "followed the protocol" to "the workspace ended correct."
- First pilot: de-script `profile`'s intake — the most scripted station, with
  the clearest destination.
