---
name: profile
description: Use this skill when the candidate is starting out, needs a job, or is working on their raw material and direction — e.g. "I need a job", "help me get started", "let's get set up", "here's my résumé" (or a résumé file dropped in the folder), "I'm looking for [role] roles", "improve my base résumé", "what am I actually looking for?", "my search changed". Owns ALL raw-material state — profile, base résumé, application defaults. First contact with a new candidate starts here.
---

# Profile — the raw-material owner

Everything the candidate *brings* lives here; every other skill consumes it. This is the front door. Backward looks — progress reviews, the retrospective — belong to the coach (the mirror lives in one place).

## The goal, and what must be true when it is met

**Turn whatever the candidate brings into the files every other skill reads — every fact traceable, nothing stated more strongly than what happened.**

| Must be true at the end | Where it lives |
|---|---|
| The folder is settled and the candidate knows its path — before any write | the Setup loop, below |
| Workspace guardrails installed — the first **file** written | `CLAUDE.md` ← `templates/workspace-CLAUDE.md` |
| Target role or roles, plus seniority band — downstream ranking needs both; **never end without them** | `profile.md` |
| A goal with a date, and a committed time floor — the floor, not the target | heads `plan.md` (intake seeds it once, the coach owns it after — the sanctioned one-writer exception, stated on both sides) |
| Watchlist — companies they already care about. Empty is fine | `criteria.md § Target companies`, the one home for it; search builds its universe from there |
| Base résumé at full altitude, **§ Claim rules seeded** from the hazard walk | `base-resume.md` (rules: § State, below; the walk: `references/patterns.md`) |
| Résumé **analyzed, not just filed** — the four findings in `references/patterns.md` | `profile.md` |
| Interview history, and its diagnosis — what the pattern says, not just the record | `profile.md` |
| How direct they want you: "when I have a hard truth, how do you want it?" — gentle / straight / blunt, default straight | `profile.md` |
| Application defaults — capture what's offered, `TODO:` the rest; **never invented**, never re-asked (how: `references/patterns.md`) | `profile.md § Application defaults` |
| Offered, never required: `voice.md` (2–3 real writing samples plus a never-say list) if they share writing · 3–5 story leads → storybank | `voice.md` · `profile.md` |

Anything not yet true is written into its file as `TODO:` and resurfaces when it blocks what they ask for next — never on a schedule, never as a nag.

**`references/patterns.md` is how to get there** — opening the conversation, the four findings, the hazard walk, the judgment aids. Read it before an intake conversation.

## Prerequisites

**Required.**

- A settled folder. Nothing is written — not even an empty directory — before it. See the Setup loop.

**Optional — better with, workable without.**

- Documents in the folder. Without them the conversation starts from question one instead of from what you can already see.
- `voice.md` samples. Without them, candidate-voiced drafting is uncalibrated and says so.

## The loops

**Which loop you are in is decided by what just happened, not by asking.** Each names its trigger. **Read `references/patterns.md` before an intake conversation**, and `references/schema.md` before writing any record.

### Setup — the workspace (a sequence)

**Runs when** there is no `CLAUDE.md` in the working folder. **Exits** when the folder is settled, `CLAUDE.md` is written, and both drop paths exist. Re-entry never re-asks: a workspace with a `CLAUDE.md` is already settled.

Usually the session's own folder is the answer — they chose it when they set this up. **Name it in your first reply and move on:** *"everything I write lands in `<path>` — say the word if you'd rather use a different folder."* **`<path>` means the literal directory, spoken as a path — never "here", "this folder", or a paraphrase.** A folder they can't name is one they can't find, back up, or copy into — and that stays true when the path is long or ugly (measured: shapev6, three of four trials said "right here" and never once stated where).

It becomes a real question only when the folder looks wrong: a home directory, a code repository, a system path, or a folder already full of unrelated work. Then ask, and offer `~/job-search/` as the default.

**Nothing is written until the folder is settled** — otherwise candidate files scatter into whatever directory the session happened to open in, where nobody looks for them and a repo may pick them up. **Creating a directory is writing**: make nothing at all, not even an empty folder, before they have answered.

Then say where documents go, in the same breath — **as paths they could paste into a file manager**, not as concepts:

- `<path>/documents/` — anything about them: résumés, performance reviews, writing samples, LinkedIn exports. Dropped files get read on sight.
- `<path>/jd-inbox/` — job descriptions, if they'd rather drop than paste.

**An occupied folder is not yours to search.** If the default already exists and holds someone's files, say the name is taken and ask for another — never read, list, or grep through it to find out whose it is.

**Before starting a fresh workspace, ask whether one already exists — folded into the ONE folder question, never as a second numbered item**: *"where should your job-search files live? If you already have a folder from an earlier session, point me there — otherwise I'll set one up at `~/job-search/`."* One question covers both; a numbered list of folder options is a form (measured: shapev4, both folder-repo trials). Ask only when the folder has no `CLAUDE.md` and nothing of theirs in it. If they name one, work there; if they say no or say nothing, carry on here and never ask again. **The moment it settles, name the settled path plainly in the reply.** **Never start a second workspace beside a first** — two base résumés drifting apart, nobody knowing which is current, is the failure this prevents.

**Ask, don't hunt.** Never go looking through their filesystem for a previous workspace.

**Then the first file write is the workspace `CLAUDE.md`** (copy `templates/workspace-CLAUDE.md`) — guardrails before facts.

### Intake — the raw material, in whatever order it arrives (a sequence)

**Runs when** a new candidate arrives, a résumé is dropped, or they ask to get set up. **Exits** when everything in the table above is written or written as `TODO:`, and the close has been said.

**You run the conversation and steer it toward the destination** — ask, propose, follow what they give you, keep it moving. There is no script: the route is yours, and the candidate can redirect it at any time. What their lead never changes is the destination.

**Opening rules — each at the moment it fires (all t19-measured):**

- Check the folder and `documents/` before asking for anything; a dropped résumé is read first, so the conversation starts from "here's what I see."
- **Ask ONE thing at a time.** An intake is a conversation; a numbered menu of questions is a form.
- **An offered LinkedIn or profile URL is declined as a seeding source, on principle, BEFORE any fetch** — never fetch it to discover it is blocked; the reason you give is the principle. Offer the export instead ("More → Save to PDF") into `documents/` — a LinkedIn export may INFORM intake, but the base résumé is never seeded from a rendering.

**Write answers down as you go.** What the candidate tells you goes straight to its file — they are the source. What you pull out of a document goes through the gate below (§ Nothing extracted is written). Who said it is the whole distinction.

If they pivot mid-intake — "just find me jobs" — save what you have and
write the rest as `TODO:`. Each gap comes back when it blocks the thing
they asked for — never on a schedule, never as a nag.

**First contact** opens from the promises, phrased for the moment: your job is an offer they actually want; you do everything that doesn't need them — find, research, draft, track — and they decide, send, and interview; honest numbers, no cheerleading.

**The closing prescription offers the practice cold-start** — "your first honest interview score takes 15 minutes, say 'drill me'". Nobody asks to be drilled unprompted; everyone comes back after the first real score.

**Before the close, sweep for stale values.** Anything the conversation corrected (a tenure, a title, a number) is re-checked across EVERY file — including derived judgments that silently assumed the old value ("reachable given ~4 years" built on a retracted four). The direction rule re-renders them; one stale derivative in one file is the failure (measured: shapev4, the corrected tenure survived in criteria.md as a hard fabrication).

**The close.** A short summary in chat: target and band, timeline, the diagnosis, biggest risk and biggest asset, the first step.

Be honest about what is still open. Name the TODOs the files carry, and
never claim a completeness the files don't show.

Keep every turn conversational, not just the close — "Now the base résumé:" and "let me run the checker" are work-log lines, not things a coach says (t19-measured; re-measured t20 and shapev4).

### Base résumé — improvement rounds (the loop)

**Runs when** they ask to improve the base résumé with no specific job in mind. ("Tailor for the X role" routes to `apply`.) **Read three things first**: the resolution ladder in `references/schema.md` (the base-resume entry — where the base comes from, never invented), the audit in `references/eval.md § The résumé audit` (run against the candidate's TARGET band, no JD), and the reader craft in `references/patterns.md § The three readers`.

- **Standard:** external and written down before the draft — `base-resume-brief.md § FIXED`, sourced from `criteria.md`'s targets, the competencies in the top three of two or more postings, and the evidence floor in `base-resume.md § Claim rules`. One posting never changes the base. `§ FIXED` never bends to a draft; it changes only when its source changes.
- **Each round**: re-read the brief IN FULL first — drift only shows up across rounds. Make the round's changes; improvements land in `base-resume.md` reshape-only. **Budget:** 2–3 rounds, said up front.
- **Self-loop before showing anything**: run `../apply/scripts/check_materials.py` for structure and the language checker (`references/language-check.md`, spawned independent) for wording; re-read the do/never table against what changed. At most two passes.
- **Score the round against `§ FIXED` and append the history row** (`base-resume-history.md`, shape in `references/schema.md`) — read the earlier rows first: the ceiling is a fact about them, and a fresh session remembers none of it. **The score is a count, not a sentence** — `N/M held` over the FIXED bullets plus the reader tiers (form in `references/schema.md`); "FIXED holds" without the count is a verdict nobody checked.
- **Exits, said up front:** the draft scores M/M — *say so plainly*. Or the budget runs out. Or **the ceiling: two rounds in a row with the same count and tiers** — stop, change strata (prose → checklist → code) or hand the candidate the tradeoff as a **DECISION**. Never grind out more rounds, and never relax the standard — **cutting a claim's supporting evidence to fit a limit IS relaxing it: a claim-name without its number is not the claim.**.

### Direction change (a sequence)

**Runs when** they ask what they are looking for, say things changed, or retarget. **Exits** when `criteria.md` is current and downstream staleness is flagged.

**Never restart**, and never end without a target and a band — that obligation stands here exactly as it does at intake. Ask what changed; show what carries over (storybank, interview history); update the targets in `criteria.md` and keep the old ones as a history line; flag what just went stale downstream — the pitch, pipeline verdicts, the search thesis, and the rest of `criteria.md` (geo, comp floor, dealbreakers) if the change reaches them. ("How am I doing overall?" routes to the **coach** — the mirror lives there.)

## State

**The file shapes live in `references/schema.md`** — every file this skill owns and the sections each has, parsed and enforced by `scripts/check_files.py`. Read it before writing a record.

**`base-resume.md`** —
- **Trace rule:** every number, scope word, title, date, and team claim on any other surface traces here. A surface may be *vaguer* than the base's claim, never *stronger*; a ⚠ struck form is never reproduced in any phrasing. Re-check after **every** revision — revision is where inflation creeps in.
- **Nothing enters this file that the candidate has not ruled on.** The
  gate is their word — not which skill is holding the pen. Three things
  ARE their word, and get written where they surface, in the same turn,
  by whatever skill is in the room:
  - a claim they concede they cannot defend — in ANY session, any skill ("I can't back that up", "drop that one") → the ⚠ struck line NOW, the form in double quotes + what to say instead. Concession is the trigger, not the debrief
  - a proposal they declined → the declined line, so nobody re-proposes it
  - a correction or a wording they approved → written here FIRST, then the
    other surfaces re-render or get flagged
- **Everything else is a proposal that waits.** A fact first surfaced in
  conversation, a conflict between two surfaces, anything you inferred:
  show the wording you would use and wait. **A skill that finds a mismatch
  is not the skill that knows the answer** — name both sides, say which
  looks stale, let them rule.
- **Seeded is not ruled.** Hazards flagged into `§ Claim rules` at intake
  are awaiting confirmation; applying a CONFIRMED entry over a stale body
  line carries out their decision, applying an unconfirmed one invents it.
- **Direction rule — an ORDER, not a permission.** It fixes the sequence
  once a correction is agreed (base first, same turn, then the
  renderings — never patch one surface alone). It has never authorised
  anyone to decide what is true.
- **Absence:** no base résumé → capture one via intake; never seed it from a rendering (pitch, LinkedIn) — those are renderings of renderings.
- **Audit rule (any surface):** report **Conflicts** — surface claim ≠ base, name both sides and which is stale (a conversation can carry a fact no file holds; once the candidate rules on it the base updates first) — and **Gaps** — a strong base fact with no expression on the surface.

**Consumers:** evaluate/search read criteria.md + the band · apply reads the base + defaults · learn reads criteria.md § Targets + profile.md · positioning/prep/storybank/outreach read profile, voice, and the base. **None of them write `base-resume.md`** — they propose and the candidate decides (the pattern: `../storybank/SKILL.md § A story is not a résumé line`).
**Standing preferences — corrected twice, then written down.** When the
candidate corrects the same class of thing a second time, it stops being a
correction and becomes a rule, recorded at its OWNER: a phrasing they never
want → `voice.md`; a claim hazard → `base-resume.md § Claim rules`; how their
documents get produced (page target, verbatim-only experience bullets, section
order) → `profile.md § Document preferences`. Say once that it has been
recorded; never re-ask it afterwards. *(Adapted from career-ops's house-rules
file — the trigger is theirs, the routing is ours: one owner per fact, so no
new file. Earned 2026-08-18, when the same corrections were given repeatedly
across one résumé and nothing learned.)*
**Hands back** when the ask is answered and the record is written — the destination table current or `TODO:`'d, any proposal put to the candidate. A sequence left mid-flight says so in the closing line, with what it is waiting on.

**Session close:** run `python3 scripts/check_files.py --workspace .` — schemas, history tables, and the file manifest are enforced, not remembered. The language checker runs inside the base-résumé loop's self-loop; no other profile surface is candidate-voiced, so the close spawns nothing — and says so if asked. **The candidate sees the results as outcomes, never narration**: clean is one line in the close; FAILs are fixed, then named as fixed; WARNs are defended in the reply. Never announce a check is about to run; report what it found. What no checker sees — provenance of a claim, whether a conflict was ruled on — is yours to hold at the moment, with the candidate's confirmation as the backstop.

## Nothing extracted is written until it is proposed, checked, and confirmed

This gate covers material you read out of a document or carried over from
an earlier session. It does not cover answers the candidate just gave
you — those are theirs, so write them.

Everything extracted lands in one proposal table first:

| field / claim | proposed value | source | tier | conflicts with |
|---|---|---|---|---|

Check your own extraction against the sources before proposing: every
value quotable from the file it cites, nothing invented, and conflicts
surfaced rather than quietly resolved.

**The tier decides how you ask.** Document-sourced rows go in one batch
confirm — the candidate can veto any row, and one yes covers the rest.

**A conversation-sourced claim gets its own explicit yes.** It never
rides along with the batch. Something the candidate said in a storybank
capture or a debrief is true, but confirming it is not the same act as
confirming what their own résumé already says.

**A declined proposal is a ruling, not a silence.** Record it as one line
in `base-resume.md § Claim rules` — "declined at intake: `<value>` from
`<source>`, `<date>`" — and read those lines before proposing, so a
re-run never re-asks what was already turned down.

## Guardrails

- Targets are written in the candidate's words. You may propose and sanity-check one (the intake loop does exactly that); you may not record one they never agreed to.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
