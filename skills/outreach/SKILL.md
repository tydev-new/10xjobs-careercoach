---
name: outreach
description: Use this skill when the candidate wants to reach people — e.g. "who should I contact at Snorkel?", "find the hiring manager", "what's this person been posting about?", "draft a connect request", "who do I know who can intro me?", "write the thank-you note". Finds contacts with evidence chains, enriches them with recent public signals, searches for warm-intro paths, and drafts every message type — the candidate always sends.
---

# Outreach — the right person, a real reason, your words

## Goal

Find who matters $\rightarrow$ learn what they care about $\rightarrow$ identify warm paths $\rightarrow$ draft tailored messages. **The candidate sends everything.**

| Must be true | Where |
|---|---|
| $\le$6 leads per company with evidence chain, confidence, and send channel | `contacts/<company>.md` |
| Sourced hooks from recipient's public signals, or explicit miss | lead's entry |
| Written rubric line and deterministic + language checks run before display | next to draft |
| Credential claims trace to base résumé | `base-resume.md § Claim rules` |
| Warm path evaluated or explicitly marked not found | warm-path line |
| All candidate sends logged and dated | send log |

## Prerequisites

- **Required:** Workspace `CLAUDE.md` (none → profile's Setup); target (company, person, or JD); `base-resume.md` (credential claims SSOT).
- **Optional:** `pitch.md`, `storybank.md`, `voice.md`, `company/<slug>.md`, `profile.md`.

## Loops and sequences

Extended search tactics and message frameworks live in `references/patterns.md`. File shapes in `references/schema.md`.

### Find contacts (a sequence)

**Runs when** candidate asks who to contact, as step 1 of apply's outreach plan, or on search radar hits.

1. **Mine JD & Signals:** Quote exact org/team names from JD. Identify hiring managers and recruiters. Startup founders included.
2. **Corroborate:** Verify currency on first-party pages; resolve send channels; assign confidence.
3. **Warm-path check:** Present mutual connections to candidate (only candidate knows true relationship strength; pin decision in file). Record $\le$6 leads.

**Exits** with leads recorded in `contacts/<company>.md`.

### Enrich (a sequence)

**Runs when** candidate asks what someone is working on, and always before drafting.

- Sweep public professional signals (articles, posts, talks). Date and source every hook; record 2–4 candidate hooks with the best one selected.

**Exits** with hooks recorded or explicit miss noted.

### Warm intro (a sequence)

**Runs when** candidate asks for an introduction or a verified mutual path exists.

- Rank by relationship strength; draft double-opt-in intro request and forwardable blurb for the candidate to send to the mutual.

**Exits** with intro request drafted.

### Draft (the loop)

**Runs when** drafting any outreach message, connect note, follow-up, or thank-you note.

- **Standard:** Channel limit (`references/eval.md`), recipient's sourced hook, top posting competency, 5-criterion rubric, and `voice.md`.
- **Budget:** 2 self-passes.
- **Each round:** Apply recipient hook (recipient's own words open, positioning closes). Draft inside limit. Self-loop with `python3 scripts/check_messages.py` and language checker-subagent (`../profile/references/language-check.md`). Write rubric line next to draft.
- **Exits:** Clears standard; or **the ceiling: two passes without clearing** → stop, record honest score (UNMET), and present tradeoff as a **DECISION**. Never relax the standard — **cutting a claim's supporting evidence to fit a limit IS relaxing it: a claim-name without its number is not the claim.**

### Plan close-out (a sequence)

**Runs when** an outreach plan is finalized for a company.

- Verify leads, channels, dated hooks, rubric lines, and stop rules across `contacts/<company>.md`.

**Exits** with plan summary delivered for candidate to execute.

## The send moment and stop rules

- **Send moment:** Rendered per `../coach/references/gate-grammar.md`. All sends made by candidate.
- **Stop rules:** 2 follow-ups max for networking, 3 for recruiters. Silence is an answer; do not chase past the limit.
- **Low response (<10%):** Flag as positioning/targeting issue, not message phrasing.

## State

Owned: `contacts/` (shapes in `references/schema.md`).

- **Hands back:** Interview booked → `interview`; low response rate → `profile`.
- **Session close:** Run `../profile/scripts/check_files.py --workspace .`. Language checker-subagent runs on every displayed draft. Report outcomes, never narration (clean is 1 line; fix FAILs before reply ends).

## Guardrails

- Personalization must trace to verified sourced hooks; no guessing email patterns as verified facts.
- Never contact on personal channels or violate professional boundaries.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
