---
name: outreach
description: Use this skill when the candidate wants to reach people — e.g. "who should I contact at Snorkel?", "find the hiring manager", "what's this person been posting about?", "draft a connect request", "who do I know who can intro me?", "write the thank-you note". Finds contacts with evidence chains, enriches them with recent public signals, searches for warm-intro paths, and drafts every message type — the candidate always sends.
---

# Outreach — the right person, a real reason, your words

## Goal

Cold applications convert at single digits; referred candidates are
5–15× more likely to be hired. This skill works that math: find who
matters → learn what they care about right now → find who can
introduce you → say something only the candidate could say. **The
candidate sends everything.** Scored by `references/eval.md`.

| Must be true | Where |
|---|---|
| ≤6 leads per company, each with an evidence chain, a confidence, and a named send channel | `contacts/<company>.md` |
| Every draft has a sourced hook from the recipient's own signals, or a recorded miss | the lead's entry |
| Every draft carries its written rubric line; both checks ran before it was shown | next to the draft |
| Every credential claim in a message or blurb traces to the base résumé | `base-resume.md § Claim rules` |
| The warm path was searched, or the file says it wasn't | the warm-path line |
| Nothing was sent; every send the candidate made is logged, dated, by channel | the send log |

## Prerequisites

- **Required:**
  - a workspace `CLAUDE.md`. None → the workspace isn't set up; run
    profile's Setup before writing any file. (Every skill is a door a
    NEW candidate can walk through first — goal 2's blocking gap.)
  - a target: a company, a person, or a role with its `jd-analysis/`
    (the JD is the highest-evidence contact source).
  - `base-resume.md` — every credential claim traces to it.
- **Optional:** `pitch.md` (hooks and the pinned Messages rubric; absent
  or PROPOSED → confirm the table before drafting) · `storybank.md`
  (earned secrets) · `voice.md` (drafts in the candidate's real voice)
  · `company/<slug>.md` (company-level hooks) · `profile.md` (warm-path
  overlap) · `prep/` (thank-you context).

## Loops and sequences

One loop drafts against a fixed standard; four sequences feed it and
close the plan. The craft: `references/patterns.md`. The file shape:
`references/schema.md`. The whole chain — find → enrich → warm path →
draft → close-out — runs on "help me network into Writer".

### Find contacts (a sequence)

**Runs when** the candidate asks who to talk to, and as the first step
of apply's outreach plan (apply's full application, step 7) and of a
search radar hit (the poster IS the hiring manager — record the post
as the evidence chain).

1. **Read `references/patterns.md § Finding contacts`.** Mine the JD
   first — **org and team names are JD/ATS-truth: quote exactly or
   omit, never fabricate a department**; open the posting's LinkedIn
   job page; a startup's founders ride inside the cap.
2. A logged-in LinkedIn session is reachable → search it FIRST,
   read-only. Otherwise: ≤4 search angles, ≤2 widen rounds, then the
   org-chart step. Never invent a title to search.
3. Corroborate on first-party pages (≤3 fetches); verify currency;
   assign confidence; **resolve the send channel per lead now** — a
   draft never assumes a channel that doesn't exist.
4. The warm-path check before ranking. **A mutual connection is NOT a
   warm path — only the candidate knows which relationships are real**:
   present the named mutuals, ask ONCE, pin the answer in the file; a
   "cold path chosen" pin is never re-raised, and a mutual that surfaces
   later gets flagged once — their call.
5. Record ≤6 leads. "Found the recruiter, couldn't pin the hiring
   manager" is an acceptable result only AFTER the org-chart step.

**Exits** with the leads recorded.

### Enrich (a sequence)

**Runs when** the candidate asks what someone is about — and ALWAYS
before a draft: enrichment is a dependency of drafting, not an optional
stop. Read `references/patterns.md § Enrichment`; run the sweep, capped;
apply the identity gate; date and source every item; record 2–4 hooks
and the best one.

**Exits** with hooks recorded, or the explicit miss. If enrichment is
BLOCKED (authwall, no access): any draft written meanwhile is marked
`PROVISIONAL: missing <input>`, and the pass re-runs UNPROMPTED the
moment the input becomes available — the access event is the trigger,
not the candidate asking. (2026-07-18: authwall drafts shipped hookless
with no marker; when access returned nothing re-triggered; the candidate
had to ask for the targets' posts himself.)

### Warm intro (a sequence)

**Runs when** the candidate asks who can introduce them, or the
warm-path check found a real path. Read `references/patterns.md § The
warm intro`; climb the access ladder (read-only, human-paced — the
volume caps protect the CANDIDATE's account); rank by relationship
strength, asking; draft the double-opt-in request with its forwardable
blurb. Record path type and status. A declined intro is never re-asked
through a different mutual to the same target without the candidate
explicitly deciding that; intro requests follow the same cadence and
stop rules as every other message.

**Exits** with the request drafted for the candidate to send to the
mutual — the first message goes to the connector, not the target.

### Draft (the loop)

**Runs when** the candidate asks for a message of any type, and for
every lead in a plan. Callers: apply (the recruiter + HM drafts, step
7); coach's inbox read (replies the candidate should make are drafted
under these rules); search (a hiring-post response, within the post's
week). Thank-you notes come from the candidate after an interview — no
skill routes them.

- **Standard:** four things, written down before drafting — the
  channel's limit (`references/eval.md § Channel limits`), this
  recipient's sourced hook, the posting's top competency, and the
  five-criterion rubric, with the pitch's pinned rubric deciding which
  claims lead. **Budget:** two self-passes — say so up front.

1. Enrichment has run for this recipient (above). Read
   `../profile/references/candidate-voice.md` with `voice.md` — the
   Never column binds every candidate-voiced sentence.
2. Pick the framework (`references/patterns.md § The ten frameworks`)
   and the hooks: the recipient's own words open, positioning closes;
   PRIMARY-tier claims lead, ⚠ WATCH-tier claims never become hooks.
   The hook comes from THIS recipient's entry — never person A's post
   in a message to person B.
3. Draft inside the limit. Score it: write the rubric line next to the
   draft in the file — **the score is WRITTEN, not performed**; a check
   that leaves no record didn't happen.
4. Self-loop, at most two passes: `python3 scripts/check_messages.py
   --workspace <dir> --contacts contacts/<company>.md`, then the
   INDEPENDENT language subagent on
   `../profile/references/language-check.md` with the drafts, `voice.md`,
   `base-resume.md § Claim rules`, and the pitch's rubric. Fix every FAIL
   and fix-before-delivery flag; re-read the workspace `CLAUDE.md §
   Writing in their voice` table against what changed.
5. Show the draft with its rubric line and both checks' outcomes.

**Exits** when the draft clears the standard — **say so plainly**; or at
two passes without clearing it — **the ceiling**: stop, record the
honest rate on the rubric line (UNMET, and what didn't fit), and hand
the tradeoff to the candidate as a **DECISION** (which claims lead;
two variants, their pick). **A list is not a message**: claims that fit
the limit only as a comma-spliced inventory, with the hook cut, are
brevity ✗ and voice ✗ — the bar is UNMET, not met. Never grind a third
pass, and never relax the standard — **cutting a claim's supporting evidence to fit a limit IS
relaxing it: a claim-name without its number is not the claim.**

### Plan close-out (a sequence)

**Runs when** a company's plan is about to be called done — apply's
outreach plan, or the candidate's "is Writer ready?". One pass over
`contacts/<company>.md`: every lead has an evidence chain AND a named
channel · every hook is dated · every draft carries its rubric line,
passes `check_messages.py`, and has the language checker's verdict ·
the send plan has dates and the stop rules · the warm-path line says
searched-or-not honestly. **No findable hiring manager is a finding,
not a failure — say so and ship the recruiter path.**

**Exits** with the plan summary: leads, channels, drafts, dates — and
the candidate sending.

## The send moment and after

- **The send moment** is rendered per
  `../coach/references/gate-grammar.md` (artifact → gate line →
  report-back). A send happens by the candidate's hand, or their
  explicit per-message approval through a mail connector.
- **Every send and outcome is logged, DATED**, in the status enum
  (`references/schema.md`) — the enum is the response-rate denominator
  the coach's funnel reads by channel.
- **Stop rules are hard: 2 follow-ups networking, 3 recruiter** —
  *"Silence is an answer — don't chase past the limit. Dignity matters
  more than persistence."*
- **Under ~10% response across a real sample** → say the honest thing:
  **it's positioning, not phrasing** — "a spear, not a net"; route to
  retargeting (`profile`) or the pitch (`positioning`) before polishing
  templates.

## State

Owned: `contacts/` — shape in `references/schema.md`. Writes nothing
else; apply's outreach plan writes here under these rules, stated on
both sides.

**Hands back:** an interview booked → `prep` (it reads this file for
interviewer intelligence); a sub-10% response rate → `profile` or
`positioning`; a recruiter's comp range → the candidate, recorded on
the row's conversation.

**Session close:** run `../profile/scripts/check_files.py --workspace .`
for the manifest; the language checker-subagent IS spawned here, on
every draft shown, and its verdict table is in the reply — an empty
table says VOID and why. **The candidate sees results as outcomes,
never narration**: clean is one line; FAILs are fixed, then named as
fixed; WARNs are defended in the reply. Say what the workspace now holds —
leads, drafts, what is waiting on the candidate's send.

## Guardrails

- **Every personalization traces to a sourced hook; every org/title
  claim to its evidence chain.** No fabricated departments, no guessed
  emails presented as real, no data-broker lookups, nothing personal.
- The boundaries in `references/eval.md § Boundaries`.

*Every reply ends with ONE contextual next step — a sentence with its
why, not a menu.*
