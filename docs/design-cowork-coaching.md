# Design — Coaching on Cowork: the working design

**Status:** current · **Date:** 2026-08-13 · **Owner:** Yong

The platform-neutral design carried forward from
the CareerCoach redesign doc (superseded, not carried into this repo), rewritten
for Cowork with this repo's file names, with what has shipped marked, and
with the 2026-08-13 measurements folded in. Companions:
`design-cowork-coaching-goals.md` (the four goals — wins any conflict) and
`design-cowork-coaching-adopted.md` (the decision record + build list).

---

## 1. Design principles — eight

Not a second constitution: 1, 2, 4, and 7 are new at this layer; 3, 5, 6,
and 8 apply a `PRINCIPLES.md` rule to coaching design (the goals doc's
notation: P1.x = Part 1 promise x, P2.x = Part 2 rule x).

1. **The model drives; we supply interrupts** — short rules attached to
   the exact moment they matter. A rule not attached to a moment never
   fires. *"Be evidence-based"* dies; *"before any claim
   about the candidate, say where it came from"* survives.
2. **Write down only what the model can't see from inside the turn** —
   drift across rounds, its own revision spend, whether the work is done.
3. **A line earns its place only if** *(applies P2.13, derivable-or-earned)*: you can name the moment it fires; a
   strong model does meaningfully worse without it; and it wouldn't
   self-correct across sessions. *(Measured three times by
   2026-08-14, in both directions: the claim-hazard list was needed —
   1/7 caught without it, 7/7 with; the diagnosis map was not — 6/6
   unaided; the search-plan gate went 0/2 → 2/2 once bound to its
   moment. The working law: described behavior is not produced
   behavior — bind the rule to its trigger, state the failure it
   prevents, and measure. Test before trusting either intuition.)*
4. **Load order, not deletion.** Underivable domain content — question
   patterns, negotiation scripts, worked examples — stays whole and opens
   only when the work reaches it.
5. **Files are the specification** *(applies P2.11, believe the file)*. What the system keeps determines what
   it can do. The schemas live with their owning skills, enforced by code.
6. **Claims carry provenance, and an empty evidence floor is loud**
   *(applies P1.8, honest or silent)*. The
   evidence floor is the file of facts the candidate has confirmed they
   can defend; if it's empty, the check must say so rather than pass with
   nothing to check. A guard whose input can be emptied is not a guard.
7. **A score is worth having only when crossing a threshold changes what
   happens next.** A job's fit gets a number (it decides apply-or-don't
   and sorts the pipeline); an answer's quality gets words — except
   practice's gated drill ladder, whose gates *are* thresholds.
8. **Degrade loudly** *(applies P1.8)*. Say what you couldn't get and carry on. The one
   hard stop: an unsourced claim in a document that gets sent.

## 2. What loads when

```
 ALWAYS IN CONTEXT  (~1,180 w)
 ┌──────────────────────────────────────────────────────┐
 │ workspace CLAUDE.md   ~450 w (v3) — the interrupts        │
 │ 12 skill descriptions ~860 w — the load switches     │
 └───────────────────────┬──────────────────────────────┘
                         │ a description matches the message
                         ▼
 ┌──────────────────────────────────────────────────────┐
 │ SKILL.md — destination · modes · schemas · guardrails│
 └───────────────────────┬──────────────────────────────┘
                         │ the work reaches it
                         ▼
 ┌──────────────────────────────────────────────────────┐
 │ references/ (knowledge) · scripts/ (checks, fetch)   │
 │ templates/ (shipped seeds: CLAUDE.md, forms)         │
 └──────────────────────────────────────────────────────┘
```

| Layer | Size | Mechanism |
|---|---|---|
| Workspace `CLAUDE.md` | ~450 w (v3) | written at setup by intake; version marker; refresh by offer. **Shipped:** `skills/profile/templates/workspace-CLAUDE.md` (v2, measured) |
| 12 skill descriptions | ~860 w | always in the prompt — **the description is what decides whether a skill ever loads** (11 after pipeline-board's deletion 2026-08-14; 12 again when learn arrived 2026-08-15) |
| Skill bodies + references | ~40 k w | on demand, when a description matches / the work reaches them |

**Skills judge; scripts compute.** Anything deterministic — fetching,
sweeping, dedup, rendering, schema checks — is a script under test, not a
paragraph. Guardrail scoping (goals doc): always-on carries only what must
fire before any skill loads; a guardrail that fires only inside one
skill's work lives in that skill.

**Measured 2026-08-13** (the t4 experiment, `eval-t4-attribution.md`): the
always-on layer alone is *not* enough
for real work — it produced files that were transcriptions, not analysis
(0/7 hazards; "no positioning read"). The redesign's assignment of "who
they are, what they want" to the always-on layer is falsified on Sonnet;
the skill layer is what turns filing into analyzing. Model = analysis,
`CLAUDE.md` = persistence + honesty, skill = structure + coverage.
Refined by t6 (2026-08-14, `evals/eval-t6-evaluate-conduct.md`): CLAUDE.md's
persistence reach ends at the prose files its do-first order names —
bare-condition evaluate runs (CLAUDE.md present, no skill) wrote nothing:
no verdict row, no analyses. Structured records persist only through the
owning skill's destination + script.

## 3. Loop A — improving one deliverable *(built 2026-08-17 as `improvement-loop.md`, #12; since 2026-08-21 stated inline per loop — profile § Base résumé, positioning § Pitch, apply § The loop law, outreach § Draft — and the shared file is removed)*

Every deliverable gets a brief with two halves: **FIXED** — the standard,
which comes from outside the draft and never bends to it — and **LIVING**
— the candidate's angle, which may change every round.

```
 trigger ──▶ <name>-brief.md ┬─ FIXED   the standard  ← external, sourced
                             └─ LIVING  the angle     ← the candidate's
                                  │
                                  ▼
       ┌────────▶  the current file  (overwritten each round)
       │                │
       │                ▼   re-read the brief IN FULL
       │          <name>-history.md ── one appended entry per round:
       └────────────────┘              who drove it · scored against FIXED
                                       · what changed. 2–3 rounds, said up front
```

**A draft never justifies relaxing the standard.** The standard changes
only when its *source* changes. Four rules, because four things are
invisible from inside a turn:

| Stage | Rule |
|---|---|
| Enter | nothing — the loop happens because the artifact is a **file**; round 2 happens next time it comes up |
| Execute | re-read the brief **in full** before each round — drift is only visible across rounds |
| Exit | say the round count up front; **say plainly when it clears** — a coach who never says *done* teaches distrust of the praise; **third exit (added 2026-08-15, built #12): the measured ceiling** — two consecutive rounds without movement against the standard → document the honest rate and change strata or escalate as a DECISION; never grind, never relax |
| Self-loop | fix what's checkable before showing (`check_materials.py`), **at most two passes** |

**Where each standard comes from** — an unsourced standard is the bug:

| Deliverable | FIXED comes from | Rounds |
|---|---|---|
| `base-resume.md` | targets in `criteria.md` + competencies recurring in **2+** postings + the evidence floor (`base-resume.md § Claim rules`) | 2–3 |
| `pitch.md` | target + LinkedIn's limits (headline 220 characters, About section 2,600) | 2 |
| A story | the competency it evidences + "specific, owned, only you could tell it" | 2–3 |
| Outreach message | recipient + channel limit (300-char invite, 75–125-word email) + the posting's top competency | 2 |
| Application answer | the question + its word limit | 2 |

*(Build note 2026-08-17: the table's deliverables split into two tiers — base-resume.md and pitch.md carry the full brief+history triple; messages, answers, the persona panel, and stories keep inline standards. The operational copy of all rules was `improvement-loop.md` until 2026-08-21; each loop now states its own in its skill's `SKILL.md`.)*

**One base résumé, two layers** (settled call 1): Loop A governs
`base-resume.md` — one document, one brief, one history. Apply's
reshape-only tailoring produces *derived* per-role output in
`applications/`, never a competing version. Asked for "a version B":
has the target changed? Then change the brief — the same document gets
held to the new standard. A posting may change the base in exactly one
way: a competency in the top three of **two or more** postings that the
base doesn't evidence. One posting is never a trigger.

## 4. Loop B — learning from real interviews *(→ #17, #11)*

```
              a REAL interview happens
                        │  debrief
      ┌─────────────────┼─────────────────┐
      ▼                 ▼                 ▼
 question-bank.md   storybank.md     base-resume.md § Claim rules
 Q · company ·      stories it       conceded claims struck
 round · date       surfaced         as ⚠ never-forms
      └─────────────────┼─────────────────┘
                        ▼
         read FIRST by the next prep brief,
         the next role dossier, the next résumé pass
```

| File | Holds | Status |
|---|---|---|
| `question-bank.md` | questions actually asked: Q · company · round · date | promotion out of `practice-log.md` → #17 |
| `storybank.md` + `stories/` | stories the debrief surfaced | shipped |
| `base-resume.md § Claim rules` (⚠ struck forms) | claims conceded as indefensible, in double quotes, with what to say instead — FOLDED into the existing struck-form gate: one list of never-ship phrases, no parallel file | shipped (#11) |

**Question sourcing, in precedence order** (settled call 3):

1. `question-bank.md` — asked of *this candidate*, for real.
2. `company/<slug>.md` research — sourced questions for this company.
3. **Generated** from format patterns + this JD — always labeled
   `[inferred]`. No static seed file: a generated question tailored to
   the JD beats a generic seed, and the vendored snapshots remain the
   source if evals ever show otherwise.

**The ladder degrades silently.** An empty tier 1 is the normal state for
a new candidate. Never open with "based on what you've been asked" over an
empty bank. **Two provenance labels, no third**: `[source: URL/date]` or
`[inferred from posting]`. **Never sharpen a vague signal into a specific
question** — a source saying "distributed systems" is reported as that,
not converted into the question it implies.

**When a source can't be reached:** search empty → say the intel is
sparse, widen to similar-stage companies, record `intel: sparse` so the
next run knows. Site blocks → note it, move on; never retry in a loop.
Nothing anywhere → proceed on tiers 1+3, labeled, and say so once. A
*confident* dossier built from nothing is worse than no dossier.

**A struck form is a gate, not an input.** A ⚠ never line in
`base-resume.md § Claim rules` never appears in a draft, a practice
answer, or a review — the checker-subagent
enforces it in ANY wording, exact or reworded (shipped, #29). Memory by
subtraction: without it, a metric that fell apart in January is still on
the résumé in March. **Records store what was said, not what we wish had
been said.**

## 5. Judging an answer

```
✅ Strong   specific · grounded in stated experience · precise vocabulary ·
            includes reflection · right domain · differentiated
🟡 Solid    covers the core point; thin on depth, precision, or domain fit
🔴 Gap      misses the point · vague · unverifiable · no reflection
```

Running **beside** that, not inside it: is the claim in the evidence
floor? Not there → flagged undefendable. A ⚠ struck form → hard
stop. **A fabricated metric is not a 2/5 on credibility — it's a stop.**
That separation is why credibility isn't a scored dimension.

Feedback per answer, fixed and short: what landed (quoting their words) ·
what to sharpen · the stronger version (≤2 sentences, only facts they
stated) · status. Practice's gated 1–5 drill ladder stays — its gates
change what happens next, which is exactly principle 7's test.

## 6. Job search — a plan over instruments

**The model composes the search; tools execute it.** This restores the
imported design's own split, which the shipped skill had drifted from:
the model decides which sources are worth hitting for *this* target, what
the queries are, and what deserves the candidate's attention; a tool does
the fetching, deduplication, rate limits, and the uniform record.

Every instrument sits on **two orthogonal axes**, and the plan composes
across both:

|  | **Authoritative** — the employer's own system | **Lead** — aggregator, post |
|---|---|---|
| **Company-addressed** (needs a slug) | ATS vendors, YC → write pipeline rows | *(none today)* |
| **Query-addressed** (thesis in, postings out) | USAJOBS → writes rows directly, **no company list involved** | role-first fan-out, LinkedIn radar, HN → confirm-or-label |

**Addressing** decides whether an instrument needs a company universe at
all; **authority** decides whether its results write rows directly or
enter as leads. (The old "aggregators feed the universe, never the
board" rule conflated the axes — it was written when the only
query-addressed instrument *was* an aggregator. It survives as the lead
column's rule, not as a rule about query instruments.)

`companies.md` is therefore **state for the company-addressed class, not
a pipeline stage** — and discovery is *universe maintenance*, in the plan
only when company-addressed instruments serve the target and the universe
is thin. A federal-targeting candidate's plan can be pure query-mode:
zero companies, zero discovery, the source's own search is the sweep.

```
 plan ──▶ query-addressed instruments ───────────────▶ pipeline rows
   │                                                   (authoritative)
   │                                                   or leads (confirm)
   └────▶ company-addressed instruments ◀── companies.md
              │                                 ▲
              └── discovery maintains it ───────┘
                  (only when the plan needs this class)
```

### The two-file company model

`criteria.md § Target companies` holds the candidate's own picks — theirs
to edit, search only reads. **`companies.md` is the whole working set** —
one row per company the search touches, script-owned, human-readable:
Company · source (`criteria` / `discovery-<channel> <date>` / `cloud`) ·
evidence · status (`swept` / `unresolved` / `no-ats`). Rows sourced from
`criteria.md` are regenerated from it every sweep (criteria stays
authoritative for its rows — deletions propagate); discovered and cloud
rows persist with provenance. One writer (the script), one readable
answer to "what is my search covering?". `companies.txt`, the `*`
watchlist convention, and `search-criteria.md` are deleted; every
user-specified company gets the old watchlist treatment (always swept,
theme filter relaxed).

### The source catalog

The skill's catalog, read at plan composition
(`references/patterns.md § The catalog`), is **one card per instrument** — what it
covers · which activity it serves · cost · freshness · JD fidelity ·
bounds · when it wins · its earned lore. A general "pick appropriate
sources" underperforms an enumerated menu (measured 2026-08-13: an
enumerated list moved hazard catching from 1/7 to 7/7; the same mechanism
applies). Cards at launch: the cloud company→ATS map (628 rows, a
key-gated Supabase edge function; resolution pre-solved, discoveries flow
back through a verified staging table) · the ATS sweep (10 vendor
contracts, uniform record) · role-first fan-out (measures the market,
finds unknown employers) · the YC vendor (seed-stage, salary+equity+
founders) · the HN who-is-hiring parser · bounded archetype web research
· the attended LinkedIn radar. Deterministic gotchas live in the code
that hits them, not on the card.

### The plan — composed attended, executed frozen

The agent researches the target, proposes a plan — instruments, queries,
rationale — and the candidate's yes makes it standing in
**`criteria.md § Search plan`**. Revision follows the same
confirm-before-standing rule; this absorbs the old widening machinery
(widening = plan revision; `widened_by` provenance = plan history; the
levers survive as revision guidance, still picked by rejection-count
evidence, still capped by what `criteria.md` permits). **Autopilot
executes the approved plan verbatim** — an unattended agent never
re-researches, never adds sources, never widens; a thin scheduled run
reports the evidence and waits for the next conversation. The sweep
report prints **per-instrument yield**, which is the evidence plan
revisions run on.

### New sources — two tiers, split by determinism

The agent may freely make **new uses of general capabilities**: web-search
a niche board it found, read it attended, harvest companies from it —
bounded, and everything from a runtime-found source enters at the **lead
tier**: confirmed against the employer's own board before the candidate
spends time, or presented as unconfirmed. The agent may **not** improvise
a new fetcher at runtime — vendors are code under test. A source the
agent can't reach becomes a **build request** written to the shared
field→sources map with evidence (the accretion loop diagrammed below);
USAJOBS is the designated first proof vendor for that path — search-first
like hiring.cafe, and the first credentialed one (a free registered API
key, held in the user's workspace like `market-api.json`).

- **The field→sources map** *(build requests land here)*: where a field has
  its own ecosystem (federal, academia, nonprofit, licensed trades), the
  same accretion loop as company→board, one level up. Two maps, one
  mechanic; both start small, grow from real use, and return `unknown`
  loudly:

  ```
     company name (or target field)
          │
          ▼
     the map ──── hit ────▶  fetch the board / the field's boards
          │ miss
          ▼
     the model looks — "does <company> use greenhouse/lever/…?"
                       "where are <field> roles posted?"
          │
          ├─ found, reachable ──▶ write it back to the map ──▶ fetch
          ├─ found, needs a new fetcher ──▶ a BUILD REQUEST with evidence
          └─ nothing ─▶ record "unknown", say so, move on
                        (never a silent zero-results)
  ```

### Settings, triage, and the posting lifecycle

**`criteria.md § Search settings`** (optional; absence = defaults, and
the sweep report prints the effective values every run so the knobs are
discoverable): target yield per sweep (3) · max new per company (5) ·
active (To Review) pipeline cap (25 — above it, the prune report proposes the
outranked-by-quick-scan-fit rows for the candidate's batch confirm; #20
2026-08-17, replacing surface-only-top-few) · stale-after (30 days). All project into
the validated machine filters, loud-fail on bad values.

Triage is unchanged: read `criteria.md` in full, hard filters cut,
survivors get the fit verdict (the one right place for a number), only
the top few presented. **Never invent a listing** — "nothing new matched
this week" is a real answer.

Lifecycle — nothing is ever deleted; states change and views filter:

```
 sweep admits → To Review ── evaluate → verdict ── Applied → Interviewing …
                   │
                   ├─ candidate dismisses (reason recorded)
                   ├─ DELISTED (shipped): gone from a successfully-swept
                   │    feed → auto-dismissed — but only rows the candidate
                   │    never touched; engaged rows are NEVER auto-closed
                   ├─ STALE: no action for stale-after days → sorted down;
                   │    proposed in the prune report (batch confirm)
                   ├─ OUTRANKED (#20): over the cap, weakest by quick-scan
                   │    fit → proposed (candidate's batch yes; Target-companies
                   │    rows exempt from auto-proposal)
                   └─ CLOSED: stale AND the posting no longer resolves
                        (a cheap liveness probe, run only on stale rows —
                        covers what delisting can't: pasted links, posts)
```

**Leads validate automatically** *(shipped 2026-08-14)*: an
aggregator-sourced role is internal (`leads.md`) until the employer's
RAW feed confirms it — then it is promoted as a pipeline row with the
employer URL; swept-and-absent dies immediately; an unknown company
joins the universe so the next sweep validates; unresolvable companies
get one agent careers-site check before the stale window closes. The
user never reads a lead. Search output the user should see lands in
`jobs.md § Search notes` — **`criteria.md` is input-only** (its single
search-side write is `§ Search plan`, on the explicit yes). Dedup is
the record's own canonical keys — rejected postings are simply
re-filtered each sweep; no separate key file exists to drift.

### Kept from prior art, deliberately

From career-ops (MIT — port, don't rewrite):

- **The provider library — the biggest prize.** ~65 vendor fetchers,
  including the exact non-tech/enterprise set this design defers: iCIMS,
  SuccessFactors, Oracle Cloud, Cornerstone, Eightfold, Phenom, Avature,
  Jobvite, Workable, Recruitee, Personio — plus sector boards
  (HigherEdJobs for academia) and query-addressed remote boards. A "new
  vendor" build request drops from write-from-scratch to
  translate-under-test against a working reference. (USAJOBS is not
  among them — still ours to build.)
- **Cross-listing detection (SimHash).** The employer+agency double-post
  evades both URL dedup and company+title dedup — agencies strip the
  employer name but rarely rewrite the JD. A 64-bit SimHash of the JD
  body, flagged when two rows from *different* companies are ≥92%
  similar within 90 days. Warn-only, and the warning matters: apply
  through ONE channel, or the double submission burns the candidate with
  both parties. We already store JD bodies in `jd-inbox/` — the signal
  is nearly free.
- **The trust validator.** Flag-only 0–100 score on admission: URL
  structure, missing apply URL, shortener domains, company↔domain
  mismatch against an ATS allowlist. Never drops a row — feeds the lead
  tier's confirm-or-label rule with deterministic evidence.
- **The liveness pattern library.** Closure-banner detection hardened by
  real incidents — typographic apostrophes (U+2019) silently defeating
  ASCII patterns; the Phenom "has been filled" phrasing needing
  lookahead/lookbehind guards so "once the application form has been
  filled…" on a LIVE posting doesn't read as expired. Our liveness probe
  adopts these patterns wholesale instead of learning them again.
- **Per-source yield history** and **portal health** (consecutive
  failures flag a dying source) — as previously adopted.

From our own shipped code: the uniform record · the loud-fail
criteria seam · the single seeded rejection-reason list (a novel reason
once crashed a 175-company sweep) · identity-verified slug probing ·
delisting detection.


## 7. Data lifecycle

The schemas (which sections each file has) live with their owning skill,
enforced by `check_files.py`. These are the rules *around* them:

**One file per writer, per rate of change.** Combine two things only if
the same step always writes both. The test: if a routine action rewrites
content it didn't touch, split the file. Two sanctioned exceptions, each
with a stated mechanism: `plan.md` (intake seeds the head once; the coach
owns it after) and the pipeline (sweeps append; a state change rewrites
one row).

1. **Nothing exists until something creates it.** No empty templates —
   an absent file is information. (A required *section* inside an
   existing file is the opposite: always present, `TODO:` when unknown.)
2. **The agent never deletes.** It appends, edits, or marks retired with
   a reason. One carve-out, about the world rather than the workspace: an
   untouched 30-day-old role whose posting no longer resolves is marked
   closed — still a state change, not a removal.
3. **The user can delete anything, and is told what it costs first:** a
   document — their work, no warning · `profile.md`/`criteria.md` — the
   agent starts over · the banks — it forgets what they were really asked
   · the ⚠ struck lines in `base-resume.md § Claim rules` — **those
   claims can go back into a sent document**; spell this one out, it's
   the deletion most likely made for the wrong reason.
4. **Nothing is auto-archived.** Files may grow — they aren't loaded
   every turn. Growth is handled by what's shown, not by what's kept.

**Three populations:** candidate files (the workspace — theirs);
shipped content (the plugin — read-only, updates with releases; the
workspace `CLAUDE.md` is the deliberate exception: shipped once, then
theirs); repo docs (invisible at runtime — **a rule that lives only in a
design doc doesn't bind the agent. Including this one.**)

## 8. Interface (Cowork)

Empirically settled 2026-07-15 and kept: **deliverables render as
artifacts** — read-only pages beside the chat (résumés, boards, briefs);
**forms that save answers are inline widgets** — small forms inside the
chat itself, the only surface whose Save can post back; **data changes go
through chat** so the record and its view can't disagree. The
anti-rule survives from the redesign: if a surface only displays what the
agent could say in a sentence, it's a message, not a panel. Living files
are **read from disk before every touch** — the candidate may have edited
them; that replaces any change-marker machinery.

## 9. Enforcement — guaranteed vs asked for

| Invariant | How | Where |
|---|---|---|
| Structure limits (lengths, sections, glyphs, verbatim bullets) | **code — FAIL/WARN per the earned-FAIL bar** | `check_materials.py` / `check_messages.py` (shipped) |
| Never-say, ⚠ struck forms, confirm-tier — any wording incl. paraphrase | **independent checker-subagent** — severities in the contract | `profile/references/language-check.md` (shipped, #29; measured t15) |
| Required sections exist; no section in the wrong file | **code — FAIL** | `check_files.py` (shipped) |
| Duplicate pipeline rows | **code — loud-fail** | `update_job.py`/`record_verdict.py` (shipped) |
| Judgment calls code can detect cheaply | **code flags → model defends — WARN**; silence is not a pass | both checkers |
| Conceded claims: struck at the concession moment, then enforced any-wording | the checker-subagent's contract, severity fix-before-delivery | shipped (#11 fold + #29) |
| Provenance on every candidate claim; never invent a number/listing; ask-before-diagnosing | **discipline** — workspace `CLAUDE.md`, measured | shipped |
| Re-read the brief in full; say when it's done | **discipline** — Loop A prose | built (#12; inline per loop since 2026-08-21) |

**Anything that later becomes checkable moves up to code** — and the
receipt moves with it, into the commit or the docstring, out of the prose
(goal 4's deletion valve).

## 10. Assumptions still live

| # | Assumption | How we'd know it's wrong |
|---|---|---|
| A1 | Results at the eval tier hold in use — **rescoped**: the user picks the model on Cowork | the standing regression, per model tier if needed |
| A2 (revised) | Descriptions route correctly — the right skill loads on the natural phrasing | routing evals; the known gap: profile's description misses "I need a job" first contact |
| A3 | Candidates iterate on a draft (else Loop A is ceremony) | #12: how often a second round happens |
| A4 | Candidates supply what's asked (the provenance stance assumes asking works) | how often a `TODO:` is still open three turns later |
| A7 | The re-read instruction is obeyed | #12: the brief's FIXED half byte-identical after three rounds |
| A8 | Candidates debrief real interviews — **upside only** if false | empty tier 1 rate |
| A15 | The want side survives on `criteria.md` alone — dealbreakers, comp floor, geo, targets — now that CMF is gone (removed 2026-08-19: an optional file, present in seven skills, that every consumer had an absent-branch for). **Correction 2026-08-19, reviewer-caught:** the original wording of this row claimed "a schema no checker knew." False — `cmf.md` WAS a registered schema, parsed out of `profile/SKILL.md` by `load_schemas()`; the checker went 11 schemas → 10. Real consequence: a pre-existing workspace holding a `cmf.md` now draws a stray-file WARN, since `check_strays` allowed it via that schema | **countable, from `jobs.md`:** a row dismissed AFTER it reached Applied for a reason that was already written in `criteria.md` — the want-side check had the fact and did not use it. One is noise; a pattern means `criteria.md` is too thin and CMF (or a section of `profile.md`) comes back with a receipt |
| A16 | The deciding stage is **deferred, not dropped** — negotiate removed 2026-08-19 (2,306 words; one eval, `eval-m12` 2026-07-14, and no case in the current harness) to be **rebuilt after a real review**, per the founder. `PRINCIPLES.md` still promises the offer stage and that promise stands; this records that the system does not keep it yet. What survives: `negotiation/<company>.md` (practice writes a STATED number, prep's day-of sheet reads it) and four rules bound to the coach's offer routing row — never accept or walk on the call, never generate a comp number, never fabricate a competing offer or share paperwork between companies, professionals handle tax/equity/contract | **the recruiter screen, not the written offer** — that is where the anchor is set (`anchor.md`'s first line, now deleted: the highest-leverage comp moment of the process). If a candidate names a number at a screen and the system had nothing to say, the loss has already happened and the offer arrives too late to observe it |
| A14 | A fixture replay predicts live behaviour | live runs vs harness results (Phase D: live intake diverged from t4 in richness, matched in discipline) |

## 11. The prior-art pass

Before building any item, compare both vendored sources —
`vendored/interview-coach/` (Noam) and `vendored/career-ops/` — and sort
every mechanism three ways: **baby instructions** (output schemas, menus,
state plumbing) → strip; **proven framework or knowledge** → keep, on
demand; **guardrails** → always-on, code, or data files. Both sources are
proven in use; a rule kept from either carries its receipt.

## 12. The eval method

Lives in `tests/always-on/README.md`: a planted workspace with known
facts · scripted user turns · test inputs captured from real runs, never
retyped · an isolated environment (`check_env.sh` verifies it) · a second
model grades each transcript, splitting fabrications into **hard** (an
invented number, title, employer, or date) and **soft** (embellished
framing of a true fact) · **multi-trial gates**, because single runs are
noise · the three guardrail cases re-run at the end of every phase, and
any hard fabrication blocks the phase.

## 13. Coach — the arc over the stages *(decided 2026-08-14)*

The journey has stages; coach is the one skill that spans them all while
owning none of their destinations:

```
groundwork ──── searching ──── applying ──── interviewing ──── deciding
(profile,       (search,       (apply,       (prep, practice,  (not yet covered)
 storybank,      evaluate)      outreach)      storybank, learn)
 positioning,
 learn)
```

**Groundwork** is the named first stage: the candidate's materials made
search-ready — profile, storybank populated, pitch + LinkedIn
(positioning). It is a **state coach senses, not a skill**: no interviews
scheduled + no pitch file + a thin storybank = groundwork, and coach
prescribes the 1–3 next actions and routes to the owning skill. This
resolves the "prep" naming trap (2026-08-14: the founder read "prep" as
search-readiness; the skill means one scheduled interview): prep stays
narrow — one interview, one brief — and the campaign-readiness umbrella
skill is deliberately not built. A skill that routes to other skills is
how career-ops fused into an unreadable pipeline.

Coach's relationship to the always-on layer, kept sharp: `CLAUDE.md` is
always-**loaded** (~300 words, every turn, guardrails only). Coach is
always-**applicable** — its trigger is the journey itself ("what should I
do today", "I'm back", any outcome), and it reads the workspace to name
the stage, the gaps, and the next actions. This stage model is the spine
for the coach rebuild (coach was rebuilt to this spine 2026-08-15 (#22); its heavy reference is `references/patterns.md` (was program.md until 2026-08-21)); vocabulary: "groundwork remaining: …" / "you're
search-ready."

**Stages are an opinionated order, never gates** (added 2026-08-14). The
candidate can skip anything; the system responds two ways, both already
precedented: the gap **resurfaces when it blocks the next thing they
want** (goal 1's resurface rule — never a nag), and until then the
experience **degrades honestly and says so** — a pitch built without a
storybank is mined from résumé claims and labeled weaker; a prep brief
over an empty question bank never pretends recall (the sourcing ladder's
"degrades silently"); an evaluate card with no `criteria.md` omits the criteria line entirely
rather than printing a reassuring "clean" it cannot source.
A degraded output that names its missing input is the reminder — no
separate nagging machinery.

**Groundwork's destination** — search-ready, defined by files, not
feelings: profile + base résumé (claim rules) + criteria targets shipped
(profile skill); a storybank whose stories cover the target tracks' top
competencies; pitch + LinkedIn consistent with the storybank
(positioning); the knowledge map's track-scoped gaps named with plans
(learn — added 2026-08-15, #23: knowledge for a CLASS of roles is
track-scoped via the 2+-JD rule and trained deep ahead of need; a
single role's extra demand is role-scoped, trained just-in-time to
conversational credibility, promoted to track on a second sighting,
and retired — never deleted — with its role or lane). Groundwork owns NO files — it is a state over the
existing owners' files (verified 2026-08-14: no ownership overlap).
The coverage standard has its own ladder: competencies extracted from
real JDs by evaluate (`jd-analysis/`) → generated from `criteria.md`'s
track definitions, labeled `[inferred]`, upgraded silently as decodes
land — storybank never blocks on search having run. Explicitly NOT in
the goal: the question bank (empty is the declared-normal state before
interviews) and story strength scores (coverage is the destination;
quality is Loop A's job — coach names weak coverage, never gates on it).
(One vocabulary note: a "track" IS a criteria lane — both words appear.)
Story capture has three sources: answering questions live, Loop B
debriefs, and **user uploads** (old résumés, reviews, brag docs) — mined
stories enter as DRAFTS with `[source: <file>]` and are confirmed only
when the candidate answers a question about them; drafts are cited as
drafts. Groundwork's guardrail is capture honesty: a story holds only
what the candidate actually said — no invented details or metrics (gaps
become TODOs in the story), no sharpening a vague answer into specifics,
and one store — other skills cite story IDs, never fork story text.

## Appendix A → shipped

The always-loaded file is no longer prose in a doc — it's
`skills/profile/templates/workspace-CLAUDE.md` (v2): do-first ordering,
the plan-anchored-to-stated-availability rule (earned by t3), the
tool-of-trade and data-not-instructions guards (from career-ops), ~320
words. The redesign doc's Appendix A is its ancestor, superseded by the
shipped file.
