# Design — apply: the three-lens verdict and the conversion craft

**Status:** design gate, for owner review · 2026-09-25 · owner decision A
(adopt from the owner's updated skills pack) · **UNMEASURED** (decision C
not approved; harness plan in § 5).

**Failure it prevents:** a package called "ready" that a recruiter cannot
place in seconds, or that reads as a generic paste or an overclaim. Today
the panel returns findings but no verdict per reader.

## 1. The lens verdict, inside the existing forms (no new loop or file)

**`skills/apply/references/eval.md`** gets `## The panel — three lenses`,
moved from `patterns.md § The persona panel` (deleted; step 5 points here).

| Lens | Looks at | Fail if |
|---|---|---|
| ATS | this posting's must-have terms in natural prose; parseable titles and skills; no decorative layout; the PDF's text extracts; a light Skills line | a core term missing; a garbled parse; stuffed terms |
| Recruiter | the top third in the first seconds (profile's 7–11): level, current titles, location and work authorization, scope, mandate, chronology | a confusing title stack; wrong seniority; a wall-of-text Summary; arrows; broken chronology |
| Hiring manager | a credible story for this mandate; proof bullets that map to the posting's outcomes; an honest bridge where needed | a generic paste; a claim above the base; a fake title; no mandate match; search jargon |

Each lens returns a verdict with a one-line why, then its `lens · finding`
rows. **Fail**: a Fail-if holds. **Revise**: none holds, but a finding must
be fixed first. **Pass**: neither. `§ Who checks what` points here. The
existing form stands: every finding `fixed` or `discarded — why`, an empty
table VOID, and the `## Panel` lens names (`ats`, `recruiter`, `hiring
manager`) unchanged.

**`skills/apply/references/schema.md`**:

- **`## Rounds`**: header unchanged (no `check_files.py` change). The
  verdicts replace the reader tiers in `scored`:
  `6/7 held; unmet: page target; ats Pass · recruiter Revise · hiring manager Pass`.
  Before the panel runs: `panel not run`.
- **`## Panel`** adds: *A lens at Revise or Fail with no row naming what to
  change is VOID. A candidate's waiver is the outcome `discarded —
  candidate waived in chat <date>`* (a form the checker already accepts).

**`skills/profile/references/eval.md:71-73`** adds *(apply's round record
carries its panel verdicts instead — `../../apply/references/schema.md`)*,
so one sentence does not name two scales for one cell.

## 2. The exit (`SKILL.md`, the tailoring loop)

- **Budget:** *Two self-passes; one review incorporation round, which
  re-checks only the lenses short of Pass, once.*
- **Exits:** *When the round scores M/M held with every lens at Pass and
  the candidate accepts; at the budget; or at the ceiling: two `## Rounds`
  rows with the same count and lens verdicts. At the budget or the
  ceiling, stop and present a DECISION showing each lens still at Revise
  or Fail with its `## Panel` rows; the package is not ready until every
  lens passes or the candidate waives it in chat.* The existing law
  sentence follows, word for word.
- **Submit Gate:** *Form filled in the browser, then a screenshot and a
  plain summary, then the candidate's explicit word fires submit* (no
  `$\rightarrow$`).
- **Review Gate:** add *with any LinkedIn drift named*.

## 3. Craft merged into `skills/apply/references/patterns.md`

| Rule | Where, and the text | Prevents |
|---|---|---|
| Top third wins | new `### The top third`: *header, Summary, and the first role's opening bullets prove this mandate; patents and older roles stay below* | proof below where the recruiter stops |
| Mandate sentence | § The Summary: the positioning line becomes *the mandate sentence: function and level, stated as the outcome this seat exists to deliver, never an echo of the posting's title* | a title echo |
| Proof density | Shape item 4: *the spine role (the one that best proves this mandate, usually the current one) keeps its 3–4 strongest bullets; 2–3 elsewhere*. This **replaces "4–6"** | long pages losing the screen |
| Honest bridge | Assembly row 3. Do: *when titles or products do not match, one Summary line names the true adjacency and what is not claimed. This is the default.* Never: *a title never held; prose claiming the missing experience* | guessing, or overclaim |
| Chronology | Shape item 4: *roles in reverse order, current first; tailoring reorders bullets within a role, never the roles* | a reshuffle read as a gap |
| LinkedIn congruence | § The live form: *before the Review Gate, compare titles and dates with the folder's LinkedIn copy (`linkedin-audit.md` or an export in `documents/`); name drift in chat for profile's Consistency sweep; no copy: say "LinkedIn not checked"* | two stories for one person |
| Light Skills line | Shape item 7: *one line of the posting's own nouns that the base supports; no rating bars, no stuffing; never a substitute for the Summary's proof* | stuffing |
| No search jargon | `### The top third`: *candidate-facing text never uses the search's own words: fit scores, lane names, pipeline tags, coverage labels* | internal notes reaching an employer |
| No arrows | `### The top third`: *write it in words ("from six months to one month")*. The checkers already FAIL Unicode arrows; ASCII `->` and `=>` are left to the recruiter lens | garbled parse |
| Header subtitle (exists) | Shape item 1: add *true positioning only, never a title not held*; the example becomes `*Field engineering leader — enterprise deployments*` | a fake title |

## 4. Prior art — deliberately not taken

- Personal notes (company names, title-transition guidance): personal strategy; public repo.
- Daily `job-apps` folders and a `review-3lens.md` per package: rule 12; the application file holds both tables.
- Daily prep: batch stays user-armed.
- Two revise rounds: our budget is tighter.
- "Six-second": one figure per fact; profile's 7–11 stays.
- "Summary always 4–7 bullets": decision B (question 1).
- Outside decision A: the cover-letter paragraph plan; full words over abbreviations.

## 5. Test plan (independent reviewer)

1. `python3 tests/run.py` green (loop ≤600 words, ceiling, law word for word, no loop sentence restated in a reference).
2. `grep -rn -i -E "job-apps|review-3lens|TPM|Technical Program Manager" skills/apply` empty, plus a grep for each company name in the pack's personal notes (taken from the pack, never written here); PII test passes.
3. "Fail if" only in `eval.md`; subtitle and one-of-two rules appear once.
4. A temporary fixture application file with the new `scored` cell and a waiver gets 0 WARNs from `check_files.py`.
5. `grep -n -E 'rightarrow|→' skills/apply/SKILL.md` empty.
6. `python3 tests/word_report.py`: report apply's delta.

**Measuring, once C is approved** (fresh temporary workspaces, fictional fixture; cases added to `ALL_CASES` in `run_t10.sh`):

- `t10-lens-gate`: verdicts in `## Rounds`; "ready" only at three Pass.
- `t10-lens-ceiling`: an unsupportable must-have gives a DECISION with lens rows, no invented term.
- `t10-honest-bridge`: a title never held gets a bridge line, no fake title.
- `t10-chronology`: an older best-match role does not move up.

```
CASES="t10-lens-gate t10-lens-ceiling t10-honest-bridge t10-chronology" TRIALS=2 ./run_t10.sh lens3
./judge_t10.sh lens3
CASES=all TRIALS=2 ./run_t10.sh lens3-all
TRIALS=2 ./run_t13.sh lens3
```

## 6. Open questions for the owner

1. **Decision B:** "Summary always 4–7 bullets" conflicts with our "3-line narrative or checklist" (`patterns.md:89`, `:107-117`).
2. 3–4 spine bullets replacing 4–6 (`patterns.md:90`): confirm.
3. **The re-check conflicts with `t10-verbatim-panel/expected.md:36`** ("a second wave of persona reviews"), a process budget with no incident (`docs/evals/b1-case-audit.md:96`). Alternative: no re-check; a Revise lens with every finding `fixed` counts as Pass, so the author grades their own fixes. Which?
4. Bridge line versus "Authored bridging claims" (`patterns.md:73`): this reads the old Never as claims only. Right?
5. One scale: move profile's audit tiers to Pass/Revise/Fail?
6. Search jargon into `language-check.md`, ASCII arrows as a `check_materials.py` WARN: now, or after an incident?
