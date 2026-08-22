---
name: positioning
description: Use this skill when the candidate wants to work on how they present themselves — e.g. "help me with my pitch", "how do I introduce myself?", "review my LinkedIn", "audit my profile", "do my materials tell one story?". Owns the public positioning surfaces: the pitch (core + variants) and the LinkedIn profile — mined from the storybank, kept consistent with the base résumé.
---

# Positioning — one story across every surface

The candidate's positioning is a single asset expressed on the public surfaces: the **pitch** (spoken) and **LinkedIn** (searched); the base résumé (owned by `profile`) echoes it. This skill builds the surfaces and — the part that actually differentiates it — keeps them telling ONE story.

## The goal, and what must be true when it is met

**Every public surface tells the same story, in the candidate's own voice, with every claim traceable.**

| Must be true at the end | Where it lives |
|---|---|
| A core statement that survives the substitution test — swap in another same-level candidate's name, and it stops working | `pitch.md § Core statement` |
| All five variants, to their specs | `pitch.md § Variants` |
| The Messages rubric — the message-priority table other skills draft against — pinned, or explicitly marked PROPOSED | `pitch.md § Messages rubric` |
| Every surface mismatch found gets a per-surface rewrite | `pitch.md § Consistency notes` |
| A LinkedIn audit that rewrites rather than flags, and names what it could not see | `linkedin-audit.md` |
| The Snapshot headline in sync with the pitch | `profile.md § Snapshot` (the one sanctioned cross-skill write there) |

**`references/eval.md` is how to judge these** — the substitution test, the 1–5 diagnostic, the consistency check. Read it at a loop's exit and at session close.

## Prerequisites

**Required.**

- **No workspace `CLAUDE.md` → the workspace isn't set up.** Run profile's folder + guardrails step before writing any file. Every skill is a door a NEW candidate can walk through first.
- `base-resume.md` — the single source of truth every claim traces to. Absent → route to profile to capture one; never seed positioning from a rendering.

**Optional — better with, workable without.**

- `voice.md` — without it, ask for ONE real writing sample (routed to profile to capture); declined → draft anyway and FLAG that voice is uncalibrated.
- `storybank.md` + `stories/` — read `§ Coverage` first: a mostly uncovered or draft-only map means the bank isn't ready to mine, so offer the storybank skill first. **Confirmed stories only** — a draft is a document's claim the candidate never answered on, and the pitch is the line they will repeat most. No bank, or the offer declined → mine `base-resume.md` claims directly and SAY the pitch is weaker for it.
- `practice-log.md` debriefs — how the TMAY (their "tell me about yourself" answer) actually landed in real interviews.

## The loops

**Which one you are in is decided by what just happened, not by asking.** **Read `references/patterns.md` before drafting** (hook theory, mining, the rubric protocol, the LinkedIn craft), and `references/schema.md` before writing any record.

### Pitch (the loop)

**Runs when** they ask for help introducing themselves, or to build or review the pitch — **or another skill routed here with a diagnosis**: coach on a silent funnel, outreach on a response rate under ~10% ("it's positioning, not phrasing"), practice feeding how the TMAY landed. A routed entry starts with the diagnostic against the existing pitch, not a fresh build — the caller already knows something is wrong; find what.

- **Read `pitch-history.md` first** — the rows tell you which round you are on and whether the last one moved anything. A fresh session remembers nothing; without this read the ceiling cannot fire.
- **Standard:** external and written down before the draft — `pitch-brief.md § FIXED` (sources in `references/schema.md`). It never bends to a draft. **Budget:** 2 rounds, said up front.
- **Each round**: re-read the brief IN FULL — drift only shows up across rounds. Build or diagnose (the 1–5 diagnostic in `references/eval.md`); apply the minimum change that moves the score. **Run the substitution test on the core statement, every time.**
- **Self-loop before showing**: judgment-only, at most two passes — no checker is wired for the pitch (`references/eval.md § Who checks what`). Re-read the do/never table (workspace `CLAUDE.md`) against what changed.
- **Score against `§ FIXED`, then run § The write moment** — all four obligations, the history row among them (shape in `references/schema.md`). **The score is a count, not a sentence** — `N/M held` over the FIXED bullets plus the 1–5 diagnostic (form in `references/schema.md`).
- **Exits, said up front:** scores M/M — *say so plainly*. Budget spent. Or **the ceiling: two rounds with the same count and diagnostic** — change strata (prose → checklist → code) or hand the candidate the tradeoff as a **DECISION**. Never grind more rounds; never relax the standard — and **cutting a claim's supporting evidence to fit a limit IS relaxing it: a claim-name without its number is not the claim.**

### LinkedIn (a sequence)

**Runs when** they ask for a LinkedIn review or audit. **Exits** when `linkedin-audit.md` is written and the same-turn obligations are named.

1. **Read the profile** via the input ladder (`references/patterns.md § Reading the LinkedIn profile`) — live browser first, **the identity gate before auditing anything**: the URL comes from `profile.md`/`base-resume.md`, and the opened page's title+company must match those files. A mismatch, or no URL on file → ask the candidate for their profile URL. Never search by name and audit the first hit.
2. **Three gates, in order, all cheap**: facts (`base-resume.md`, absent → profile) · voice (`voice.md`, absent → one sample or FLAG) · rubric (unpinned → derive + pin per `references/patterns.md`).
3. **Audit top-down by search impact** (the ranking and per-section craft: `references/patterns.md`) — every section a REWRITE, unseen sections named, only what was actually seen.
4. **Write `linkedin-audit.md`** (contents: `references/schema.md`), then name the same-turn obligations — each one, in the reply:
   - `pitch.md § Consistency notes`, if the audit changed any surface;
   - the Snapshot headline line synced, if a headline rewrite was saved;
   - the light consistency sweep, before the reply ends;
   - a `pitch-history.md` row, if `pitch.md` itself was rewritten (driver: LinkedIn same-turn update).

### Consistency sweep (a sequence)

**Runs when** they ask "do my materials tell one story?" — and in light form after THIS skill changes any surface, before the reply ends. **Exits** when every mismatch has a per-surface rewrite and the write moment's obligations are named.

Cross-read the base résumé's summary, LinkedIn headline/About, and the pitch. Every mismatch gets a per-surface rewrite — **except the base résumé's own summary, which is proposed first**: show the wording, wait for the yes, then write it and re-render the surfaces that quote it. Sweep rewrites carry the same writes as § The write moment, the history row included.

(Positioning READS the base résumé for consistency; it doesn't own it. "Improve my base résumé" routes to `profile`; "tailor for the X role" routes to `apply`.)

## State

**The file shapes live in `references/schema.md`** — `pitch.md`, `pitch-brief.md`, `pitch-history.md`, `linkedin-audit.md` — parsed and enforced by `../profile/scripts/check_files.py`. Read it before writing a record.

**What this skill does NOT own.** `base-resume.md` is profile's: **anything the candidate ruled on** — a conceded claim struck, a declined proposal recorded, a wording they approved — is written same-turn; **a new fact or an unruled conflict is PROPOSED, never written** (`../profile/SKILL.md § State`). The Snapshot headline line in `profile.md` is the one sanctioned cross-skill write, kept in sync when the pitch changes.

**Single source of truth, by layer.** Layer 0 = `base-resume.md` body + § Claim rules (owner: profile) · Layer 1 = the Messages rubric pinned in `pitch.md` (owner: this skill). The canonical trace/direction/audit rules are `../profile/SKILL.md § State`, the base-resume entry — read before drafting any surface.

**Hands back** when the ask is answered and the record is written — the pitch current with its history row, the audit delivered, every proposal put to the candidate. A loop left mid-flight says so in the closing line, with what it is waiting on.

**Session close:** run `../profile/scripts/check_files.py --workspace .` — the pitch.md schema, the brief, and the history header are enforced, not remembered. No checker-subagent is spawned: none is wired for the pitch (`references/eval.md § Who checks what`). **The candidate sees results as outcomes, never narration**: clean is one line; FAILs are fixed, then named as fixed; WARNs are defended in the reply. That binds the whole conversation, not just the close — "let me run the checker" and tool play-by-play are work-log lines, not things a coach says (measured here: t20, 2026-08-20). What no checker sees — whether it sounds like them, whether a mismatch was ruled on — is yours to hold at the moment (`references/eval.md § Who checks what`).

## The write moment — three writes and one proposal, named in the same turn

Every `pitch.md` rewrite carries four things, whoever drove it:

- **(a)** `pitch.md` itself — the Messages rubric preserved verbatim;
- **(b)** the **Snapshot headline line in `profile.md`** kept in sync (one-line edit, note it);
- **(c)** any fact first surfaced while pitching is **PROPOSED** for `base-resume.md` — say it in one line with the résumé wording you'd use and wait; on the yes, write it there, base first, and re-render the surfaces that quote it. A pitch conversation is long-form and a résumé line has to stand alone, so the proposal is the wording, never a clipping;
- **(d)** one appended row in `pitch-history.md` — the `driver` column says what drove it.

## Guardrails

- **Must sound like the candidate** — their words beat polished coach-speak. Every number/scope/title/team claim runs the trace rule (`../profile/references/candidate-voice.md`, loaded at every candidate-voiced rewrite); the do/never table binds, contrived analogies above all; mirror `voice.md`'s samples and respect its never-say list — the pitch is the most analogy-tempted artifact in the system.
- Interview <48h away → route to `prep`. Positioning work can wait; day-of readiness can't.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
