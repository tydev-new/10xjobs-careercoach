# Design — apply: the three-lens verdict and the conversion craft

**Status:** design gate · 2026-09-25 · owner decision A (adopt from the
owner's updated skills pack) · **owner rulings on every open question
recorded 2026-09-25 (§ 8)** · **UNMEASURED** (decision C not approved;
harness plan in § 7).

**Failure it prevents:** a package called "ready" that a recruiter cannot
place in seconds, or that reads as a generic paste or an overclaim. Today
the panel returns findings but no verdict per reader.

## 1. The lens verdict, inside the existing forms (no new loop or file)

**`skills/apply/references/eval.md`** gets `## The panel — three lenses`,
moved from `patterns.md § The persona panel` (deleted; step 5 points here).

| Lens | Looks at | Fail if |
|---|---|---|
| ATS | this posting's must-have terms in natural prose; parseable titles and skills; no decorative layout; the PDF's text extracts; a light Skills line | a core term missing; a garbled parse; stuffed terms |
| Recruiter | the top third in the first seconds (profile's 7–11): level, current titles, location and work authorization, scope, mandate, chronology | a confusing title stack; wrong seniority; a Summary that is a paragraph, not bullets; symbol chains the checker cannot see ("A > B > C"); broken chronology |
| Hiring manager | a credible story for this mandate; proof bullets that map to the posting's outcomes; a claims-free bridge where needed | a generic paste; a claim above the base; a fake title; no mandate match |

Each lens returns a verdict with a one-line why, then its `lens · finding`
rows. **Fail**: a Fail-if holds. **Revise**: none holds, but a finding must
be fixed first. **Pass**: neither. `§ Who checks what` points here. The
existing form stands: every finding `fixed` or `discarded — why`, an empty
table VOID, and the `## Panel` lens names (`ats`, `recruiter`, `hiring
manager`) unchanged.

Arrows and search jargon leave the lens lists: they now have one-right-answer
or written-rule owners (§ 4), and rule 14 puts them there, not in a
second judge.

`§ Who checks what` also changes two lines: the script list's "no arrow or
scaffolding glyphs" becomes *no arrow glyphs or ASCII arrow chains (`->`,
`=>`, `<-`, `<=>`; code, comments, and URLs exempt)*; the language
checker "owns never-say, struck forms, confirm-tier hazards, and
`reworded_scope`" gains *and `search_jargon`*.

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

**Shape item 3 (replaces `:87-89`):**

> 3. **`## Summary` — the single opening section, always 4–7 short
>    bullets.** Bullet 1 is the mandate sentence (§ The Summary). Never a
>    paragraph, and never a second list ("Core Expertise", "Highlights")
>    that re-says it.

**§ The Summary (`:107-117` replaced; the "Three reasons" paragraph
`:101-105` stays):**

> **Always 4–7 short bullets** — a recruiter scans bullets; a paragraph
> is a wall. **Bullet 1 is the mandate sentence**: function and level,
> stated as the outcome this seat exists to deliver, never an echo of the
> posting's title. Each later bullet is one proof with its number, the
> posting's hardest screen first. The PDF shows them as a list.
>
> **When over-qualification or a doubted hard screen is the real risk**,
> bullets 2–7 take the requirement-checklist form: the posting's
> phrasing, evidence after the colon, each bullet's evidence proving the
> opener's EXACT claim. A JD's "N+ years of X" is answered with THEIR
> number ("8+: yes —") proven by recent evidence — meet the bar, don't
> triple it.

**Shape item 4 (replaces `:90`):**

> 4. **`## Professional Experience` / `## Experience`**: 2–4 roles in
>    reverse chronological order, current first — tailoring reorders
>    bullets within a role, never the roles. The spine role (the one
>    whose work best proves this mandate, usually the current one) keeps
>    its 3–4 strongest bullets; 2–3 elsewhere; outcome first.

**Assembly row 3 (`:73`; the Never cell's first phrase stands):**

> | Off-target identity: order the transferable dimension first; when titles or products do not match the posting, one Summary bullet states the true adjacency and the gap — claims-free, the default | Authored bridging claims; a title never held; deleting the off-target signal |

**Other rows:**

| Rule | Where, and the text | Prevents |
|---|---|---|
| Top third wins | new `### The top third`: *header, Summary, and the first role's opening bullets prove this mandate; patents and older roles stay below* | proof below where the recruiter stops |
| LinkedIn congruence | § The live form: *before the Review Gate, compare titles and dates with the folder's LinkedIn copy (`linkedin-audit.md` or an export in `documents/`); name drift in chat for profile's Consistency sweep; no copy: say "LinkedIn not checked"* | two stories for one person |
| Light Skills line | Shape item 7: *one line of the posting's own nouns that the base supports; no rating bars, no stuffing; never a substitute for the Summary's proof* | stuffing |
| No search jargon | `### The top third`: *candidate-facing text never uses the search's own words; the language checker's `search_jargon` rule holds the list* | internal notes reaching an employer |
| No arrows | `### The top third`: *write it in words ("from six months to one month"); `check_materials.py` and `check_messages.py` FAIL arrow glyphs and ASCII arrow chains* | garbled parse |
| Header subtitle (exists) | Shape item 1: add *true positioning only, never a title not held*; the example becomes `*Field engineering leader — enterprise deployments*` | a fake title |

## 4. Checker changes (owner ruling 6)

**`skills/profile/references/language-check.md`**

- Inputs, after the rule-source list: *One rule, `search_jargon`, takes
  its list from this file, not from a candidate file, so it is always
  checkable.*
- New rule 6:

> 6. **`search_jargon`** — the search's own working words must not
>    appear in a candidate-facing document, in any wording:
>    - evaluate's verdict labels and fit scores ("investable stretch",
>      "long shot", "82/100");
>    - track, lane, stage, source-tier, scout, and lead labels ("Track
>      B", "To Review");
>    - the application file's words: coverage statuses
>      ("shown-but-unnamed"), round counts ("6/7 held"), audit tiers
>      ("ATS-Ready"), lens verdicts ("recruiter Revise"), "band call",
>      "spine role", "mandate sentence", "DECISION".
>
>    The echo exemption applies: the posting's own word, quoted, is not
>    jargon. *Severity: fix-before-delivery.*

- Output: the `rule` enum gains `|search_jargon`.

**`skills/apply/scripts/check_materials.py`** and
**`packages/checkers/src/check-materials.mjs`**, in `_shared` / `shared`,
right after the Unicode check (after the `## Claim rules` strip):

- Pattern (same source text in both):
  `ASCII_ARROWS = <=+>|<-+>?|-+>|=+>`. It catches `->`, `-->`, `<-`,
  `<->`, `=>`, `==>`, `<=>`. It does not match `<=`, `>=`, `<`, or `>`
  alone.
- Exempt spans, replaced with one space before scanning:
  `` ```…``` `` blocks, `<!--…-->` comments, `` `…` `` inline code
  (one line), and `https?://\S+` URLs. It is a single alternation
  (Python `re.S`; JS `[\s\S]` for `.`).
- **Level: FAIL.** It is the same failure as the Unicode glyphs, which
  were candidate-caught on 2026-08-16, so it carries that receipt.
- Message:
  `arrow/scaffolding chain "<m>" — write transitions in words ("from 80% to under 1%"); symbol arrows garble in ATS parsers`.
  Only the first match is reported, as with the glyph FAIL.
- The opener FAIL's "(case + checklist)" becomes "ONE Summary" in both
  files, because decision B retired the case.

**`skills/outreach/scripts/check_messages.py`** gets the same pattern and
exemptions, scoped to drafts. The message is
`draft <i>: arrow chain "<m>" — write it in words`. There is no JS port,
so there is no parity item.

**Parity:** `node packages/checkers/test/parity.mjs` and
`node tests/checkers-parity/extra.mjs` must stay 100% identical in
stdout, exit code, and files. The corpus needs these cases:

- each arrow form;
- an arrow inside a URL, an inline code span, a fence, and a comment
  (all exempt);
- `<=` alone (no finding);
- a document carrying both Unicode and ASCII arrows (two FAILs, Unicode
  first);
- accented text beside an arrow.

Every new `def test_` needs its `covers:` entry.

## 5. Test-file text (the builder applies it)

- **`tests/always-on/cases/t10-verbatim-panel/expected.md:26-27`**, the
  MUST: *At most ONE incorporation round: panel findings applied once,
  checker re-run, the lenses short of Pass re-checked once, done.*
- **`:36`**, the MUST NOT: *A persona review beyond that one re-check
  (owner 2026-09-25: the author must not grade its own fixes, so the
  failing lenses re-check once; nothing further).*
- **`tests/test_check_materials.py:183`**: the rule tuple gains
  `"search_jargon"`. New tests:
  - each arrow form FAILs;
  - each exempt span passes;
  - `<=` passes;
  - a bullets-only Summary passes the case budget.
- **`tests/test_check_messages.py`**: an ASCII arrow in a draft FAILs, and
  the same arrow in a URL passes.
- `tests/always-on/arms/lean/**` is a measurement arm and is not
  rewired.

## 6. Prior art — deliberately not taken

- Personal notes (company names, title-transition guidance): personal
  strategy, and the repo is public.
- Daily `job-apps` folders and a `review-3lens.md` per package: rule 12.
  The application file holds both tables.
- Daily prep: batch stays user-armed.
- Two revise rounds: our budget is tighter.
- "Six-second": one figure per fact, so profile's 7–11 stays.
- Outside decision A: the cover-letter paragraph plan, and full words
  over abbreviations.

## 7. Test plan (independent reviewer)

1. `python3 tests/run.py` is green. That covers the loop limit of 600
   words or fewer, the ceiling, the law sentence word for word, no loop
   sentence restated in a reference, and both parity suites.
2. `grep -rn -i -E "job-apps|review-3lens|TPM|Technical Program Manager"
   skills/apply` is empty. Also grep for each company name in the pack's
   personal notes, taking the names from the pack; they are never written
   here. The PII test passes.
3. "Fail if" appears only in `eval.md`. The subtitle rule and the
   Summary rule each appear once. "3-line", "Three or four lines", and
   "≤50 words" are gone from apply's patterns.
4. A temporary fixture application file with the new `scored` cell and a
   waiver gets 0 WARNs from `check_files.py`.
5. `grep -n -E 'rightarrow|→' skills/apply/SKILL.md` is empty.
6. Every pattern and message in § 4 matches the code (use `grep -F`).
   `ASCII_ARROWS` has the same source text in the `.py` and `.mjs` files.
7. `language-check.md` has 6 rules, and its enum lists `search_jargon`.
8. `python3 tests/word_report.py`: report apply's delta.

**Measuring, once C is approved.** Use fresh temporary workspaces and a
fictional fixture. Add the cases to `ALL_CASES` in `run_t10.sh`:

- `t10-lens-gate`: verdicts in `## Rounds`; "ready" only at three Pass.
- `t10-lens-ceiling`: a must-have the base cannot support gives a
  DECISION with lens rows, not an invented term.
- `t10-honest-bridge`: a title the candidate never held gets a
  claims-free bridge bullet, not a fake title.
- `t10-chronology`: an older best-match role does not move up.
- `t10-summary-bullets`: the base has a paragraph Summary; the tailored
  one has 4–7 bullets, with the mandate first.

```
CASES="t10-lens-gate t10-lens-ceiling t10-honest-bridge t10-chronology t10-summary-bullets" TRIALS=2 ./run_t10.sh lens3
./judge_t10.sh lens3
CASES=all TRIALS=2 ./run_t10.sh lens3-all
TRIALS=2 ./run_t13.sh lens3
./run_t15.sh lens3 && python3 score_t15.py lens3   # the new rule adds rows; the three scored rules are unchanged
```

## 8. Owner rulings, 2026-09-25 (resolved)

1. **Decision B:** the Summary is always 4–7 short bullets, and bullet 1
   is the mandate sentence. This replaces `patterns.md:89` and `:107-117`
   (§ 3).
2. The spine role keeps its 3–4 strongest bullets, replacing 4–6 (§ 3).
3. The lenses short of Pass are re-checked once after incorporation,
   because the author must not grade its own fixes. `t10-verbatim-panel`
   is amended (§ 5).
4. The bridge is claims-free: it states the adjacency and the gap. The
   Never cell "Authored bridging claims" stands (§ 3).
5. **Follow-up, later and separate:** move profile's audit tiers to
   Pass/Revise/Fail.
6. Now: `search_jargon` goes into the language checker, and ASCII arrows
   become a checker FAIL, with parity (§ 4).

**Still open:** profile has no Summary-shape rule of its own, and this
ruling binds apply's tailored résumé. Should the base résumé's Summary
also be 4–7 bullets, so tailoring reshapes it instead of rewriting it?
