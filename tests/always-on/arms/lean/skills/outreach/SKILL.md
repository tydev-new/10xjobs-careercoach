---
name: outreach
description: Use this skill when the candidate wants to reach people — e.g. "who should I contact at Snorkel?", "find the hiring manager", "what's this person been posting about?", "draft a connect request", "who do I know who can intro me?", "write the thank-you note". Finds contacts with evidence chains, enriches them with recent public signals, searches for warm-intro paths, and drafts every message type — the candidate always sends.
---

# Outreach — the right person, a real reason, their own words

## Goal

Find who matters → learn what they care about → identify warm paths →
draft tailored messages. **The candidate sends everything — the agent
never sends.**

## Contact mining

1. Target live Applied / about-to-apply roles first.
2. Prefer the hiring manager, a peer, or the recruiter covering the req
   — up to 6 leads with an evidence chain, or an honest "none
   findable".
3. Note mutuals and warm paths; draft the note for the candidate (or a
   mutual) to send.
4. The agent drafts only — it never sends a DM, email, or text; the
   candidate always sends it themselves.

## Draft voice

Short, specific, non-needy. Reference a concrete, sourced hook from the
recipient's own public signal or the JD's own mandate — never a guessed
one. Soft ask (a pointer, or 15 minutes), not a résumé dump. No internal
pipeline language in an external draft. Credential claims trace to
`base-resume.md § Claim rules`.

## Before display

Run `scripts/check_messages.py` and the independent language
checker-subagent (`../profile/references/language-check.md`) on every
draft before it reaches the candidate; fix a FAIL before it's shown.

## Sends

The agent never sends. Every send follows the human gate in your
workspace `CLAUDE.md` (wording in `../coach/references/gate-grammar.md`)
— **one message at a time, never a batch**: the complete drafted
message shown, the gate line naming what sending means, the candidate
copies it and sends it themselves, then tells you so it's logged (date,
channel, follow-up cadence).

## Gmail / outcome sync

On ask, or when useful: search recent application/recruiting mail;
update `jobs.md` via `../search/scripts/update_job.py` (confirms stay
Applied; rejections and interviews move stage); surface action items
(surveys, scheduling links) separately from noise; one honest digest, no
fabricated conversion rates.

## Session close

Run `../profile/scripts/check_files.py --workspace .`; fix a FAIL
before the reply ends. Report outcomes, never narration.

## Guardrails

Draft ≠ send. Unsolicited fan-out is forbidden. Never contact through a
personal channel. Credentials/OTP: a secure form or the candidate's own
hand — never invent a password.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
