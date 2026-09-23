# The lean arm (B1) — fix round 3 (final)

An alternative, complete `skills/` tree — the owner's working
"job-search-os" export's idea (skills own files, gates, and invariants;
the model's own judgment owns craft) rebuilt as a full parity tree over
the repo's nine skills, so the always-on harness can run it via
`RUNNER_SKILLS_DIR` against the same cases the current skills run,
judged by the SAME frozen, unablated skill text (`JUDGE_SKILLS_DIR`
never points at this arm — see `tests/always-on/README.md § Skills
snapshot`). Nothing under the live `skills/` changed to build this.

**Source, read-only, not copied verbatim:** the owner's
`job-search-os-2026-09-22` export (`README.md`, `operating-rules.md`,
`skills/job-search-*.md`). Its 7 lean skill bodies map to 7 of this
repo's 9 skills (mapping in the table below); `profile` and `learn` have
no lean counterpart, so those two are the **full baseline** — see § C.
**No personal data was copied** — the export's `workspace-snapshot/` (a
real candidate's `profile.md`, `criteria.md`, notes) was never read into
any file here; every candidate-specific reference in the source text
(named companies, named tracks, comp floors, geo) is generalized to a
pointer at the candidate's own files.

This is **fix round 3, the last one**. Round 2 addressed an independent
reviewer's "not ready to measure" finding on round 1 (deleting
`patterns.md` outright, restating the same gate in five places,
dropping ideas the lean source actually had, keeping ideas it didn't,
and leaking words like "arm"/"lean" into skill text) — see §§ A–G below,
which still record that decision record. Round 3 is the reviewer's
re-check: **most things passed.** What didn't is fixed in § D′ — a
specific list of Policy/Code rows the reviewer found still missing
after round 2, restored in lean-style short wording, plus a small set of
Capability leftovers round 2 missed (the `patterns.md`-wide "Proposing a
new pattern" footer, two of search's own Capability rows, search's
two-pass ceiling and its scheduled-run section, and one apply Capability
phrase). The rule stated once, for both rounds: **Policy and Code are
never ablated; Capability and Craft the lean text lacks are removed.**

## A. Where the core lives

**Decision:** "Skill vs native" and the human-gate's four steps
(PRINCIPLES rule 7) live in exactly ONE place — `profile/templates/
workspace-CLAUDE.md` (Tier 0), which every suite installs as `CLAUDE.md`
and which every session reads. No `SKILL.md` in this arm restates the
four steps; each points at Tier 0 and/or `coach/references/
gate-grammar.md` (the wording PRINCIPLES.md itself names as
authoritative) instead.

- Tier 0 now carries two new sections — `## Skill vs native` (the lean
  cheat sheet, generalized, ~120 words) and `## Human gates — sends,
  submits, and money (rule 7)` (the four steps stated once, ~75 words)
  — alongside its existing data-safety sections.
- **`coach/SKILL.md`** no longer contains the "Skill vs native" list or
  a restated four-step gate; it points to the workspace `CLAUDE.md`
  in one line.
- **`apply/SKILL.md`**, **`outreach/SKILL.md`** point at "the human gate
  in your workspace `CLAUDE.md`" + `../coach/references/gate-grammar.md`
  for the exact wording, instead of re-spelling the four steps.
- **`apply/SKILL.md`**'s duplicated "Never" list (it appeared once under
  § Submit gate and again under § Guardrails) is now stated once, under
  § Guardrails; § Submit gate points there.
- **The apply-queue sentence** ("Strong Fit or Investable Stretch, per
  `criteria.md`") is stated once, in `evaluate/SKILL.md § Apply queue`.
  `apply/SKILL.md` and `search/SKILL.md` now point at it
  (`../evaluate/SKILL.md § Apply queue`) instead of repeating it.
- **Tier 0 word count: 456** (the repo's own Tier 0 is 885 words for
  comparison — this one is shorter despite carrying two new sections,
  because it no longer needs the candidate-specific voice table the
  repo's carries).

## B. `patterns.md` — reduced, not deleted

**Decision:** every one of the 7 lean skills keeps a
`references/patterns.md` file. It no longer holds the craft technique
(assembly moves, decoding lenses, message frameworks, drill ladders,
research depth, elicitation prompts) — that's the model's own judgment,
named as such under each heading a kept file still points to. It DOES
keep, verbatim or near-verbatim, every row the rule inventory classes
as Code or Policy:

| Skill | Kept in the reduced `patterns.md` |
|---|---|
| apply | Summary is the single opening section (Code, `check_materials.py`) · experience bullets are the base's own sentences (Code) · rewording rules — same facts/scope/verb (Policy) · the PDF template contract, conversion ladder, and delivery verification (Code, `render_resume.py`) · the compensation field and salary-history rule (Policy) · CAPTCHA/failure honesty (Policy) |
| coach | The inbox 0-or-2+-matches loud-fail (Code, mirrors `update_job.py`) · shared-account partial-coverage disclosure (Policy) · calendar read-only (Policy) · encouragement cites evidence / never manufactured urgency (Policy) |
| evaluate | The dealbreaker two-step (Code, the exact command pair) · recording the verdict on exact strings (Code) · the three claim tiers — verified / general knowledge / unknown (Policy) |
| interview | Nothing — the inventory classes every row in interview's `patterns.md` Capability or Craft, none Code or Policy. The one heading `storybank/references/eval.md` still points into (`§ The brief — construction protocol`) is kept as a placeholder so that link still resolves. |
| outreach | The identity gate — an artifact binds to a lead only with an identity link (Policy) |
| search | The instrument catalog table (Code — "each script prints its own usage") · "research proposes candidates, only a posting is a role" (Policy) |
| storybank | Ask for a missing number once, then move on (Policy) · a draft is named as a draft, never counted as coverage (Policy) |

Every kept reference file that used to point into `patterns.md`
(`apply/references/{eval,schema}.md`, `coach/references/eval.md`,
`evaluate/references/eval.md`, `storybank/references/{schema,eval}.md`)
is now **byte-identical to `skills/`** — round 1's link edits (which
also, wrongly, changed evaluate's fit-dimension wording and apply's
résumé-section-order wording) are reverted. No link edits were needed
this round: the file the pointer names still exists.

## C. `profile` and `learn` — full baseline

**Decision:** the export has no `job-search-profile` or `job-search-learn`
skill, so these two directories are **byte-identical to `skills/`** —
`SKILL.md`, every `references/*.md` including the full `patterns.md`,
every script, the HTML template. Confirmed by `cmp` below (§
Verification) — the only difference anywhere under `profile/` is
`templates/workspace-CLAUDE.md` itself, which is Tier 0 (§ A) and is
deliberately shared/edited across every suite, not a profile-skill
change.

## D. Removed baseline process the lean text doesn't have

Round 1 imported repo baseline process wholesale into several skills.
This round audits every import against the rule: **remove it unless the
rule inventory classes it Code or Policy** (then keep it, in the lean
source's own wording where the lean source already has that wording).

| Item | Decision | Why |
|---|---|---|
| search plan-composition (a separate "propose the plan, wait for a yes, then write `criteria.md`" sequence) | **REMOVED** | Capability (`SE-S12`), not in the lean source, which assumes a standing plan without a dedicated approval gate |
| storybank draft-until-confirmed | **KEPT(Policy)**, lean's own wording | `SB-S13` — Policy (RC:profile "a doc does not waive the question", 2026-08-15); the lean source has "Status `confirmed` only if told directly" but NOT the mining-creates-`draft [source: …]`-rows clause; the whole row is kept because it's Policy, not only because it matches lean. **Fix (round 3):** round 2's README wrongly implied this was kept for coincidence alone ("not a baseline import at all") — it's a Policy row that would be kept regardless of what the lean source said |
| "a story is not a résumé line" | **KEPT(Policy)**, lean-adjacent wording | `SB-S17`/`SB-S11` — Policy; the lean source has the core idea ("propose … never auto-write") but not the declined-proposal logging clause, which is the same Policy row, so it's kept too |
| checkers before close (`check_materials.py`, `check_messages.py`, `check_stories.py`, `check_closeout.py`, `check_files.py`, the language checker-subagent) | **KEPT(Code)**, every skill | Every skill's own "session close" row is classed Code — never ablated, even though the lean source never names a script |
| storybank drill threshold | **KEPT, but the number is fixed to lean's 6+** | `SB-S15` (the threshold) is Capability, not Policy/Code; round 1 wrongly used the baseline's 8+ instead of the lean source's own explicit 6+ |
| interview `[inferred]`/banked-first/debrief writes/5 reverse questions | **split** — `[inferred]` tagging and "never sharpen a vague signal" **KEPT(Policy: `IN-S04`, `IN-S14`)**; "banked outranks generated" ordering **REMOVED** (Capability, no such ordering concept in the lean source); the four debrief writes **KEPT, lean's own wording** (lean's "capture → practice-log + question-bank notes + story use counts" already IS four writes, not a baseline import); the number "5" on reverse questions **REMOVED** (Craft, `IN-S05`) — the lean source just says "questions to ask them" |
| the outreach self-check loop (2-pass ceiling, "record UNMET, present a DECISION") | **REMOVED** the loop/ceiling framing (Capability, `OU-S14`/`OU-S15`, not in lean); **KEPT** the underlying checker call itself (Code — run `check_messages.py` + the language checker before display) |
| the outreach stop rules (2/3 follow-ups) and "<10% response rate → positioning" | **REMOVED**, both | Craft (`OU-S18`, `OU-S19`), unsourced counts, not in the lean source at all |
| apply's "pitch opener" (cover letter opens on `pitch.md`'s core statement) | **REMOVED**, replaced by lean's own 3-paragraph structure | Craft (`AP-P19`); see § E — the lean source has a different, real opener formula |
| apply's `proposal_block.py` | **KEPT(Code)** | Part of `AP-S24`'s Code-classed checker bundle, and it's literally the tool that prints the "disclose cuts/gaps" lean already asks for |
| apply's batch cap N ≤ 5 | **KEPT(Policy, `AP-S22`)** | Not in the lean source as a number, but the row is Policy; see § D′ item 3: the "never scheduled" clause of the same row is Policy and is kept |
| coach's offer/comp boundaries | **KEPT(Policy, rule 10), one line** | Not in the lean source at all; trimmed from round 1's four-clause paragraph to the one line the lead specified |
| session close (naming `check_files.py`, reporting outcomes not narration) | **KEPT(Code)**, added where round 1 omitted it | `evaluate` and `search` had NO session-close line in round 1 — added; every other skill already had one |

## D′. Round 3 — the reviewer's remaining list

Every row below is Policy or Code and was **absent** from round 2's
skill text (not merely re-worded) — restored now in lean-style short
wording, in the skill that owns it.

| Row | Class | Restored where | What it says |
|---|---|---|---|
| `AP-S12` | Policy | `apply/SKILL.md § Tailoring` step 2 | A fact the candidate volunteers goes to `storybank`, not straight into a résumé line — no line without the candidate's explicit yes on that line (round 2 had this backwards: "claims … or the candidate's own words this turn," which let a spoken fact become a résumé claim without the storybank detour — removed, § D′ item 2 below) |
| `AP-S23` | Code | `apply/SKILL.md § Owns` (new section) | Owns `applications/`; hand-back routes named |
| `EV-S08` | Policy | `evaluate/SKILL.md § Quick-scan` (new section) | The cheap tier is stamped `quick-scan:` in `jobs.md`'s reason field; graduating it to a full evaluation always names the prior score |
| `EV-P02` (first half) | Code | `evaluate/references/patterns.md § Intake` (new section) | The JD and company name; a swept role's JD is read from the row's `jd_file`, not re-fetched — round 2 kept only the DQ-two-step half of this row |
| `SE-S04` | Code | `search/SKILL.md § Listing sources`, closing sentence | Every hit is saved with the direct employer posting URL, never an aggregator link standing in for the source |
| `SE-S05` (remainder) | Policy | `search/SKILL.md § The sweep` step 5 | The digest reports yield per source, counts, and the settings in force — honestly, every time |
| `SE-S16` | Policy | `search/SKILL.md § The sweep` step 7 (new) | Dismissing a row (stale/dead/outranked) needs the candidate's one explicit batch approval |
| `IN-S03` | Code | `interview/SKILL.md § Prep` | The brief's header metadata (company, round, date) is kept current |
| `IN-S04` | Policy | `interview/SKILL.md § Prep` | Questions are labeled `banked` (from `question-bank.md`), researched (cited), or `[inferred]` (generated) — round 2 restored the citation/`[inferred]` half of this row but dropped the `banked` label entirely |
| `IN-S15` | Policy | `interview/SKILL.md § Prep` | Company and interviewer intel comes from public professional URLs only, never personal data |
| `IN-S28` | Policy | `interview/SKILL.md § Guardrails` (new section) | Never put a struck claim or an unconfirmed detail into a spoken script |
| `IN-S29` | Policy | `interview/SKILL.md § Guardrails` | A fabricated drill answer is named directly, not polished |
| `OU-S22` | Policy | `outreach/SKILL.md § Guardrails` | Never contact through a personal channel |
| `SB-S10` | Policy | `storybank/SKILL.md § Capture` step 4 (new) | Extract the earned secret; the file carries `TODO: earned secret` until it's actually extracted |

**Item 2 — the AP-S12 contradiction.** `apply/SKILL.md:31-32` (round 2)
read "claims only from `base-resume.md`, confirmed storybank stories, or
the candidate's own words this turn" — the third clause let a spoken
fact go straight into a résumé line, which is exactly what `AP-S12`
forbids (a volunteered fact needs the storybank detour and an explicit
yes on the specific résumé line). Removed; the guardrail now names only
`base-resume.md` and confirmed storybank stories as claim sources, with
`AP-S12`'s rule stated explicitly alongside it.

**Item 3 — AP-S22 wins over the lean scheduled-prep line; recorded as a
known conflict.** Round 2 (§ F, below) let the lean source's scheduled
daily-prep routine override `AP-S22`'s "never scheduled" clause. The
lead's ruling (rule D: Policy is never ablated) reverses that; the reviewer had flagged the D-vs-F conflict for a decision. `AP-S22` is Policy, and Policy is never
ablated in this arm, full stop — the "lean wins on contradictions"
instruction from round 2 only ever applied *unless it breaks a kept
Policy file*, and this does. **Fixed:** `apply/SKILL.md § Batch prep`
now reads "candidate-armed, never scheduled" again; `search/SKILL.md`'s
"Scheduled (unattended) run" section is gone entirely (§ D′ below —
`SE-S18` is Capability; the lean skill body's own automated daily-prep
wording is reworded as candidate-armed, see the § D note on SE-S18).
**This is a known, acknowledged conflict between the owner's own
routines** (the export's README describes a 7:15am weekday "daily job
apply prep" and a 2-hourly "new job posting scout" as standing scheduled
jobs) **and the repo's Policy layer**, which currently has no
scheduled/unattended path for either apply batch prep or a search
sweep that isn't `autopilot_sweep.py`'s own attended-adjacent design.
**Left for the owner to decide** (not this fix round, which only builds
the arm): whether `AP-S22` should be relaxed for a future scheduled-prep
feature, or whether the owner's routines need their own gate design
first. Recorded here per the lead's explicit instruction, not resolved.

**Item 4 — outreach's send clause.** `outreach/SKILL.md § Contact
mining` step 4 (round 2) read "never send … unless the candidate
explicitly asked to send that exact message" — readable as the AGENT
sending on instruction, contradicting the file's own "the agent never
sends" (§ Goal, § Sends). Rewritten: "The agent drafts only — it never
sends a DM, email, or text; the candidate always sends it themselves."

**Item 5 — Capability leftovers removed:**
- **"Proposing a new pattern"** — removed from all 7 reduced
  `patterns.md` files (it's Capability everywhere it appears — `AP-P33`
  / `CO-P34` / `EV-P21` / `IN-P12` / `LE-P09` / `OU-P21` / `SB-P18` /
  `SE-P14`, all "= AP-P33" duplicates or the row itself — and not in the
  lean source, which has no craft-promotion ritual at all). Confirmed no
  kept file (`schema.md`/`eval.md`) links to that heading, so nothing
  breaks.
- **`SE-P02`** ("Addressing and authority" as its own explanatory
  paragraph before the table) and **`SE-P05`** ("unreachable source →
  build request, never hand-scrape") — removed from
  `search/references/patterns.md`. Both Capability, not in the lean
  source. **Correction within round 3 itself:** an earlier pass of this
  fix also stripped the "Addressing · authority" *column* out of the
  instrument table — that was wrong, because the column is inside
  `SE-P03`'s own line range (`search/references/patterns.md:16-24`,
  classed Code), not `SE-P02`'s separate paragraph. The column is
  restored; only the standalone prose paragraphs are gone.
- **`search/SKILL.md`'s two-pass ceiling** (`SE-S17`: "at most 2 revision
  passes… present a parameter change as a DECISION") — removed. Capability,
  not in the lean source, which just runs the plan and reports.
- **`search/SKILL.md`'s "Scheduled (unattended) run" section**
  (`SE-S18`) — removed entirely. Capability. Note: the lean skill body (`job-search-source.md § Daily
  apply-prep shape`) also described daily prep as an automated run, not
  only the unported `routines/`; in this arm that section is reworded as
  candidate-armed (`search/SKILL.md § Apply-prep on request`), per § D′ item 3.
- **Apply's "Never relax the standard to fit a limit"** — removed from
  `apply/SKILL.md § Tailoring` step 5. Part of `AP-S15`'s Capability
  ceiling clause, not in the lean source; the two-round ceiling itself
  (`Two rounds max without score movement → present the tradeoff as a
  DECISION`) stays, because that IS in the lean source verbatim
  ("Two rounds max without movement → DECISION").

**Item 6 — `__pycache__`.** Deleted (`search/scripts/__pycache__/`,
regenerated once by this round's own verification run, and swept again
after re-verifying).

## E. Restored — ideas the lean source actually has, that round 1 dropped

- **The native-density bar.** Generalized (no personal data — the
  export's own reference companies are gone): *"reshape summary and
  bullets for readability, matching the density of the candidate's own
  best past packages (see `documents/` or `profile.md`) — a thin
  template is a bug, not a starting point"* — `apply/SKILL.md §
  Tailoring`, pointed at from `search/SKILL.md`'s daily-prep shape.
- **A readable ~2-page résumé** — restored as an explicit page target in
  `apply/SKILL.md § Tailoring` (round 1 said "readability" with no
  number).
- **The 3-paragraph cover letter** — restored verbatim in shape:
  paragraph 1 soft-orients (the mandate/problem + who you are) without
  restating the job title; paragraph 2 is proof; paragraph 3 is
  logistics + the ask; never internal pipeline notes in a
  candidate-facing letter. This REPLACES round 1's "opens on `pitch.md`'s
  core statement" line, which was a baseline import the lean source
  doesn't have (§ D).
- **"A stretch verdict needs a one-line why"** — restored on both stretch
  tiers in `evaluate/SKILL.md § Sequence` step 6.
- **The salary free-text rule** — restored in `apply/SKILL.md § Submit
  gate`: match the posting's stated band when the form requires one,
  else ask if the form forces a single number.
- **LinkedIn as a listing source** — restored as the first line of
  `search/SKILL.md § Listing sources` (round 1 dropped it entirely).

**Deliberate deviation, noted per the lead's instruction:** `apply/
SKILL.md` keeps the **baseline's hard requirement** that `base-resume.md`
is the claims SSOT with a hard stop if it's absent — it does NOT restore
the lean source's fallback ("reshape from the best existing tailored
PDF/text… disclose that base is TODO"). The hard stop is Policy
(candidate facts come from the candidate; D:P8) and the fallback would
let an unvetted PDF stand in as a claims source, which is exactly the
class of thing Policy exists to block. This is a genuine, acknowledged
deviation from the lean source's own text, not an oversight.

## F. Contradictions — lean wins unless it breaks a kept Policy file

- **Aggregators are allowed.** `search/SKILL.md § Guardrails` no longer
  says "direct employer URLs only, no aggregators" — the lean source's
  own listing sources include aggregators and community digests, and
  nothing Code/Policy depends on excluding them. Unchanged by round 3.
- **Daily prep may be scheduled — SUPERSEDED in round 3.** Round 2 let
  the lean source's scheduled daily-prep routine override `AP-S22`'s
  "never scheduled" clause here. The lead ruled that backwards
  (rule D; the reviewer flagged the conflict): `AP-S22` is Policy, so it wins regardless of what lean's
  own routines describe — "lean wins on contradictions" was always
  qualified by "unless it breaks a kept Policy file," and this one does.
  **`apply/SKILL.md § Batch prep` now says "never scheduled" again.**
  See § D′ item 3 for the full record, including the known conflict this
  leaves between the owner's own cron-style routines (unported — see §
  Judgment calls) and the repo's Policy layer.
- **Sending: the agent never sends.** `outreach/SKILL.md § Sends` says
  explicitly "the agent never sends" and describes the candidate copying
  and sending the message themselves — matching `gate-grammar.md`'s own
  text for a Send gate exactly. Round 3 closed the one remaining gap
  (§ Contact mining step 4 — see § D′ item 4).

## G. No experiment markers

Grepped (case-insensitive) for `lean`, `arm`, `baseline`, `ablat` across
every file under `tests/always-on/arms/lean/skills/` (§ Verification,
below). The only two hits are `evaluate/SKILL.md`'s "Keep the sequence
lean" / "## Sequence (keep lean)" — the export's OWN design language for
evaluate's philosophy (also in its frontmatter description, copied
verbatim from the repo), not a reference to this being an experimental
arm. Every other marker round 1 leaked — the `(lean)` suffix on every
`SKILL.md`'s H1 title, "in this arm" inside the reduced `patterns.md`
files, "lean arm" in Tier 0's opening HTML comment — is gone.

## Mapping (export file → repo skill)

| Export | Repo skill |
|---|---|
| `job-search-coach.md` | `coach` |
| `job-search-evaluate.md` | `evaluate` |
| `job-search-apply.md` | `apply` |
| `job-search-outreach.md` | `outreach` |
| `job-search-storybank.md` | `storybank` |
| `job-search-interview.md` | `interview` |
| `job-search-source.md` | `search` |
| — (§ C, full baseline) | `profile` |
| — (§ C, full baseline) | `learn` |

Frontmatter (`name` + `description`) is copied byte-for-byte from the
repo's own `SKILL.md` in all 9 cases, so skill triggering (the
`t8-routing` falsifier) is identical between arms — only the body
differs, and only for the 7 mapped skills.

## Word counts

Per `SKILL.md`, current (`skills/`) vs this arm, after round 3's
restorations:

| Skill | Current | Arm | Δ |
|---|---:|---:|---:|
| apply | 843 | 656 | −187 |
| coach | 882 | 444 | −438 |
| evaluate | 585 | 560 | −25 |
| interview | 932 | 458 | −474 |
| learn | 494 | 494 | 0 (full baseline) |
| outreach | 704 | 432 | −272 |
| profile | 1,499 | 1,499 | 0 (full baseline) |
| search | 559 | 446 | −113 |
| storybank | 666 | 478 | −188 |
| **`SKILL.md` total** | **7,164** | **5,467** | **−1,697 (−24%)** |

Whole-tree totals (every `.md` under `skills/`, both trees — Tier 0
counted once each):

| | Files | Words |
|---|---:|---:|
| Current `skills/` | 40 | 34,272 |
| This arm | 40 | 21,918 |
| **Δ** | **0** | **−12,354 (−36%)** |

File count is unchanged (every `patterns.md` survives, reduced) — the
word drop decomposes exactly (1,697 + 10,228 + 429 = 12,354): the
`SKILL.md` rewrites (−1,697 — smaller than round 2's −1,829 because
round 3 added back 14 Policy/Code rows), the 7 `patterns.md` files
losing their Craft/Capability while keeping Code/Policy rows (apply
2,733→448, coach 2,637→225, evaluate 1,462→252, interview 452→69,
outreach 1,719→108, search 1,393→330, storybank 1,361→97 — a combined
−10,228, larger than round 2's −9,838 because round 3 removed the
"Proposing a new pattern" footer everywhere plus `SE-P02`/`SE-P05`), and
Tier 0 (885→456, −429, unchanged from round 2).

## Verification

**Kept files byte-identical** (every file NOT one of the 7 `SKILL.md` +
7 reduced `patterns.md` + Tier 0 must `cmp` clean against `skills/`):

```
$ for f in $(find tests/always-on/arms/lean/skills -type f | sort); do
    rel=${f#tests/always-on/arms/lean/skills/}
    [ -f "skills/$rel" ] && cmp -s "$f" "skills/$rel" || echo "DIFFERS: $rel"
  done
DIFFERS: apply/SKILL.md
DIFFERS: apply/references/patterns.md
DIFFERS: coach/SKILL.md
DIFFERS: coach/references/patterns.md
DIFFERS: evaluate/SKILL.md
DIFFERS: evaluate/references/patterns.md
DIFFERS: interview/SKILL.md
DIFFERS: interview/references/patterns.md
DIFFERS: outreach/SKILL.md
DIFFERS: outreach/references/patterns.md
DIFFERS: profile/templates/workspace-CLAUDE.md
DIFFERS: search/SKILL.md
DIFFERS: search/references/patterns.md
DIFFERS: storybank/SKILL.md
DIFFERS: storybank/references/patterns.md
```
Exactly the 15 intended files — 7 lean `SKILL.md`, 7 reduced
`patterns.md`, 1 Tier 0 template. Everything else, including all of
`profile/` and `learn/` apart from that one shared Tier 0 file, all
`scripts/*.py`, all `schema.md`/`eval.md`/`gate-grammar.md`/
`candidate-voice.md`/`language-check.md`, is byte-identical to `skills/`.

**Link check** (`check_files.py`'s own `check_skill_prose`):
```
$ python3 -c "...cf.check_skill_prose('tests/always-on/arms/lean/skills')..."
0 FAIL(s), 0 WARN(s)
$ python3 skills/profile/scripts/check_files.py --workspace /tmp/ws --skills tests/always-on/arms/lean/skills
0 file(s) checked against 11 schema(s); 0 failure(s).
```

**Marker and personal-data scan** (the arm's own text only):
```
$ grep -rniw "lean\|arm\|baseline\|ablat" tests/always-on/arms/lean/skills
evaluate/SKILL.md:11:apply; you give the odds and the blockers.** Keep the sequence lean.
evaluate/SKILL.md:19:## Sequence (keep lean)
$ grep -rn "Solid\|1–3\|1-3" tests/always-on/arms/lean/skills
(no matches)
$ grep -rn "/workspace\|[Gg]rok" tests/always-on/arms/lean/skills
(only pre-existing, unrelated hits: a script's --workspace CLI flag/example,
 the literal filename templates/workspace-CLAUDE.md — not host paths)
$ grep -rin "yong\|tian\|maintainx\|alphasense\|\bjane\b" tests/always-on/arms/lean/skills
(no matches)
```

**Dealbreaker two-step, re-executed** against a fresh temp workspace,
using the arm's own scripts and the exact command pair from
`evaluate/SKILL.md`/`evaluate/references/patterns.md` (re-run after
round 3's edits to confirm nothing broke):
```
$ python3 evaluate/scripts/record_verdict.py --workspace . --company "FinalCheckCo" --title "Staff Eng" --verdict weak --score 0 --reasons "dq: role requires relocation candidate has ruled out"
recorded (created NEW role): FinalCheckCo — Staff Eng → weak (0)
$ python3 search/scripts/update_job.py --workspace . --company "FinalCheckCo" --title "Staff Eng" --dismiss --reason "dq: role requires relocation candidate has ruled out"
updated: FinalCheckCo — Staff Eng — dismissed (dq: role requires relocation candidate has ruled out)
```
`jobs.md` ends with the role correctly under `## Dismissed`, `Was: To
Review`, reason preserved — both commands ran with no errors.

**Harness DRY_RUN, via `run_b1.sh`** (the B1 named-case wrapper — runs
the minimal 14-case set's runner+judge per suite, one suite at a time):
```
$ JUDGE_MODEL=<dated-id> DRY_RUN=1 tests/always-on/run_b1.sh finalcheck lean
suite t4: cases=[t4-intake] ...
suite t19: cases=[t19-folder-repo] ...
suite t6: cases=[t6-duplicate-row] ...
suite t14: cases=[t14-dq-no-research t14-quickscan-honest t14-silent-dismissal] ...
suite t10: cases=[t10-storybank-default t10-over-budget] ...
suite t8: cases=[t8-honesty-thresholds t8-no-nag-no-gate] ...
suite t7: cases=[t7-mining-correction] ...
suite t12: cases=[t12-debrief-bank] ...
suite t13: cases=[t13-ceiling] ...
suite t5: cases=[t5-plan-attended] ...
[runner/judge dry-run pairs per suite, each: runner_skills_dir=…/arms/lean/skills,
 judge_skills_dir=(snapshot target)/…/_skills-snapshot-<commit>-<hash>]
== done: tag=finalcheck-lean results=… ==
$ echo "exit=$?"
exit=0
```
10 suites resolved from `b1-cases.txt` (t4, t19, t6, t14, t10, t8, t7,
t12, t13, t5), 20 "OK" lines (runner+judge per suite), 0 `FAILED`, exit
0. Every suite's `runner_skills_dir` points at this arm; every suite's
`judge_skills_dir` points at that run's own frozen snapshot of the
real, unablated `skills/` — never at `RUNNER_SKILLS_DIR` — confirming a
real conduct run of this arm would still be graded against the current
skill text. Results dirs and the log removed after
(`rm -rf results/*-finalcheck-lean* results/b1-finalcheck*.log`).

**`python3 tests/run.py`** (re-run after every edit in this round):
```
… 103/103 node unit tests, 11/11 checker-table tests, 113/113 web tests — 0 failures
```

## Judgment calls (mine, to flag for the lead)

- **The apply-queue pointer and the batch-prep pointer are one hop away**
  (`../evaluate/SKILL.md § Apply queue`, `../apply/SKILL.md §
  Tailoring`) rather than stated inline. `check_skill_prose` deliberately
  doesn't validate `§ Section` anchors, so this is a judgment call about
  what "stated once" means, not something the checker can confirm beyond
  "the file exists."
- **Tier 0's Skill vs native section is shorter than `operating-rules.md`'s
  full cheat sheet** (11 numbered rules + a 7-row table + a cadence
  section) — I compressed it to the routing decisions that matter for a
  skill picking up the workspace, on the instruction to keep Tier 0
  short. The cadence section (weekday routines, cron-style schedules)
  isn't ported at all — it has no repo equivalent slot and isn't gate or
  routing content.
- **`storybank/references/eval.md`'s pointer into `interview/references/
  patterns.md § The brief — construction protocol`** now resolves to a
  placeholder section (interview's patterns.md has no Code/Policy content
  at all) rather than real craft. This is a faithful consequence of B's
  rule (keep only Code/Policy, plus a placeholder for any pointed-to
  Craft heading) — flagging it since it's the one case where an entire
  linked section is placeholder, not a mix.
- **Search's reduced `patterns.md` keeps the full instrument catalog
  table**, including the "Addressing · authority" column, because the
  whole table (all 7 rows, all 4 columns) is one Code-classed span
  (`SE-P03`, `search/references/patterns.md:16-24`) in the inventory —
  I read that as "keep the table as it stood," not "keep one row of
  it." (Round 3 caught and fixed an over-correction where an earlier
  pass of this same round had stripped that column, mistaking it for
  `SE-P02`'s separate explanatory paragraph — see § D′ item 5.)
- **The owner's scheduled routines (`routines/` in the export) are still
  not ported**, and after round 3 that gap is sharper, not softer: with
  `AP-S22` restored, this arm now has NO scheduled path for daily prep
  at all (round 2 had one, briefly). That's the correct read of "Policy
  is never ablated," but it does mean the arm can't express the owner's
  actual daily habit until the conflict in § D′ item 3 is resolved.
