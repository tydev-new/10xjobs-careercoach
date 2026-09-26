# Design — apply: the three-lens verdict and the conversion craft

**Status:** design gate · 2026-09-25 · owner decision A (adopt from the
owner's updated skills pack) · **owner rulings on every open question
recorded 2026-09-25 (§ 8)** · built in 9842d81 · **amended 2026-09-25
after the independent review of that build (tests 50fa84f)**: §§ 1–5,
7, 8 and the new § 9 (the round 2 build list) · **UNMEASURED** (decision
C not approved; harness plan in § 7).

**Failure it prevents:** a package called "ready" that a recruiter cannot
place in seconds, or that reads as a generic paste or an overclaim. Today
the panel returns findings but no verdict per reader.

**How to read this design.** Text in a `>` quote block or in *italics*
is **target text**: it goes into the named file word for word.
Everything else is instruction or rationale for the builder and never
enters a skill file. Round 1 copied such notes into `eval.md` and
`schema.md` (§ 9, item 1), because § 1 mixed the two.

## 1. The lens verdict, inside the existing forms (no new loop or file)

**`skills/apply/references/eval.md`** gets `## The panel — three lenses`,
moved from `patterns.md § The persona panel` (deleted; step 5 points here).
The section's target text is the table and the paragraph below it:

> | Lens | Looks at | Fail if |
> |---|---|---|
> | ATS | this posting's must-have terms in natural prose; parseable titles and skills; no decorative layout; the PDF's text extracts; a light Skills line | a core term missing; a garbled parse; stuffed terms |
> | Recruiter | the top third in the first seconds (profile's 7–11): level, current titles, location and work authorization, scope, mandate, chronology | a confusing title stack; wrong seniority; a Summary that is a paragraph, not bullets; symbol chains the checker cannot see ("A > B > C"); broken chronology |
> | Hiring manager | a credible story for this mandate; proof bullets that map to the posting's outcomes; a claims-free bridge where needed | a generic paste; a claim above the base; a fake title; no mandate match |
>
> Each lens returns a verdict with a one-line why, then its `lens ·
> finding` rows. **Fail**: a Fail-if holds. **Revise**: none holds, but
> a finding must be fixed first. **Pass**: neither. Every finding ends
> `fixed` or `discarded — why`; an empty table is VOID. In `## Panel`
> the lenses are named `ats`, `recruiter`, and `hiring manager`.

**Not target text.** Arrows and search jargon are absent from the lens
lists because code and the language checker own them (rule 14: one
right answer goes to code, a written rule to the checker-subagent, not
to a second judge). `§ Who checks what` already points at this section
from its semantic bullet. Neither fact is written into `eval.md`.

`§ Who checks what` changes three lines:

- the script list's "case length" becomes *Summary prose over 50 words
  before its bullets* (decision B retired the case; § 4 renames the
  FAIL to match);
- the script list's "no arrow or scaffolding glyphs" becomes *no arrow
  glyphs or ASCII arrow chains (`->`, `=>`, `<-`, `<=>`; code,
  comments, and URLs exempt)*;
- the language checker's "owns never-say, struck forms, confirm-tier
  hazards, and `reworded_scope`" gains *and `search_jargon`*.

`§ The destination, judged` changes two bullets, so the judged
destination matches the new exit:

> - **The round was scored as a count** — `N/M held; unmet: …` and the
>   three lens verdicts in `## Rounds`, the earlier rows read first;
>   the exit said M/M with every lens at Pass, budget, or the ceiling.
> - **The panel was three subagents, one per lens**, each fed the
>   SOURCE documents (raw JD, decode, company brief), never the
>   author's summary; one incorporation round; the checker re-ran; the
>   lenses short of Pass re-checked once (t10-verbatim-panel).

**`skills/apply/references/schema.md`**:

- **`## Rounds`**: header unchanged (no `check_files.py` change). The
  verdicts replace the reader tiers in `scored`:
  `6/7 held; unmet: page target; ats Pass · recruiter Revise · hiring manager Pass`.
  Before the panel runs: `panel not run`.
- **`## Panel`** adds: *A lens at Revise or Fail with no row naming what to
  change is VOID. A candidate's waiver is the outcome `discarded —
  candidate waived in chat <date>`.* (Not target text: the checker
  already accepts that form — the paragraph says so two sentences
  earlier, "the checker accepts only those two forms".)

**`skills/profile/references/eval.md:71-73`** adds *(apply's round record
carries its panel verdicts instead — `../../apply/references/schema.md`)*,
so one sentence does not name two scales for one cell.

## 2. The exit (`SKILL.md`, the tailoring loop)

- **Budget:** *Two self-passes; one review incorporation round, which
  re-checks only the lenses short of Pass, once. Said up front.* (The
  last three words are not optional: `docs/skill-shape.md` requires a
  loop's budget "said up front", and the round 1 text dropped them.)
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
- **Goal table, the checks row (`SKILL.md:17`):** *Deterministic checks
  pass, and all three panel lenses Pass or are waived in chat, before
  the package is called ready.* "Multi-persona review" is the retired
  name of the panel.
- **Each round (`SKILL.md:36`):** "Run checks and multi-persona review
  panel (`references/eval.md`)" becomes *Run the checks and the
  three-lens panel (`references/eval.md § The panel — three lenses`).*

## 3. Craft merged into `skills/apply/references/patterns.md`

The Summary rule has ONE home, apply's `§ The Summary`; shape item 3
points there and carries only the one-opening-section rule, which is
its own (and a `check_materials.py` FAIL). Round 1's target text stated
"4–7 short bullets" and "bullet 1 is the mandate sentence" in both
places. Since ruling 7 (§ 8) the same home also binds the base résumé;
profile points to it (§ 3a). Line numbers below are the pre-build
file's; round 2 edits the built file (`patterns.md:87-90` for item 3).

**Shape item 3 (replaces `:87-89`):**

> 3. **`## Summary` — the single opening section; its shape is § The
>    Summary.** Never a second list ("Core Expertise", "Highlights")
>    that re-says it.

**§ The Summary (`:107-117` replaced; the "Three reasons" paragraph
`:101-105` stays):**

> **Always 4–7 short bullets, never a paragraph** — a recruiter scans
> bullets; a paragraph is a wall. **Bullet 1 is the mandate sentence**:
> function and level, stated as the outcome this seat exists to
> deliver, never an echo of the posting's title. Each later bullet is one proof with its number, the
> posting's hardest screen first. The PDF shows them as a list.
>
> **The base résumé's Summary has the same shape.** With no posting,
> bullet 1's mandate is the target in `criteria.md § Targets`, and the
> proofs lead with what that target's postings screen for hardest.
> Tailoring then reorders and swaps the base's bullets instead of
> rewriting a paragraph.
>
> **When over-qualification or a doubted hard screen is the real risk**,
> bullets 2–7 take the requirement-checklist form: the posting's
> phrasing, evidence after the colon, each bullet's evidence proving the
> opener's EXACT claim. A JD's "N+ years of X" is answered with THEIR
> number ("8+: yes —") proven by recent evidence — meet the bar, don't
> triple it. This form answers one posting, so the base résumé never
> takes it.

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
| No search jargon | `### The top third`: *a document sent to an employer or a contact never carries Ten's own labels (a verdict tier, a track name, a round count); the language checker's `search_jargon` rule holds the list* (round 2: round 1's "never uses the search's own words" was unbounded, like rule 6) | internal notes reaching an employer |
| No arrows | `### The top third`: *write it in words ("from six months to one month"); `check_materials.py` and `check_messages.py` FAIL arrow glyphs and ASCII arrow chains* | notes where a reader expects a sentence; for the Unicode glyphs, also a garbled parse |
| Header subtitle (exists) | Shape item 1: add *true positioning only, never a title not held*; the example becomes `*Field engineering leader — enterprise deployments*` | a fake title |

### 3a. Profile side: the base résumé's Summary (ruling 7)

**Why the home stays in apply.** Apply's `§ The Summary` already holds
the whole rule — why the Summary exists, the mandate sentence, the
checklist form — and profile already sends the 7–11-second craft there
(`profile/references/patterns.md:123-124`). Moving the home to profile
would re-open round 1's build for no gain. Profile gets pointers only,
and no Summary sentence of its own.

**Pointers (target text):**

- **`skills/profile/SKILL.md:58`**, the base-résumé loop's read step —
  a read the loop's rules depend on is a step that says "read X"
  (`docs/skill-shape.md`), not a parenthetical. The sentence becomes:
  *Read the base resolution ladder (`references/schema.md`), the audit
  (`references/eval.md`), reader craft (`references/patterns.md`), and
  the Summary's shape (`../apply/references/patterns.md § The
  Summary`).*
- **`skills/profile/references/patterns.md:123-124`**, the parenthetical
  under Reader 2, becomes: *(`../../apply/references/patterns.md § The
  Summary` turns those 7–11 seconds into the Summary's shape, for the
  base résumé too; `check_materials.py` FAILs more than 50 words of
  Summary prose.)* — it named "the ≤50-word case budget", which
  decision B retired.
- **`skills/profile/references/eval.md:59-60`**, the Recruiter reader:
  "case budget" becomes *the Summary's shape
  (`../../apply/references/patterns.md § The Summary`)*.

**The reader tiers stay.** Profile's base-résumé rounds still score
`N/M held` plus the reader tiers `ATS-Ready · Strong · Strong`
(`profile/SKILL.md:63`, `profile/references/schema.md:77`,
`profile/references/eval.md:56-63`). Moving them to Pass/Revise/Fail is
ruling 5's separate, later change; ruling 7 changes what the Recruiter
tier looks at, not its scale.

**What already agrees.** Profile's loop runs `check_materials.py` on
the base (`profile/SKILL.md:62`), so the 50-word Summary-prose FAIL (§ 4)
already binds the base; its message names apply's `§ The Summary`, the
one home.

## 4. Checker changes (owner ruling 6)

**`skills/profile/references/language-check.md`**

- Inputs, after the rule-source list: *One rule, `search_jargon`, takes
  its list from this file, not from a candidate file, so it is always
  checkable.*
- New rule 6 (round 2 replaces round 1's text whole):

> 6. **`search_jargon`** — Ten's own labels, used as labels, must not
>    appear in a document that goes to an employer or a contact: the
>    tailored résumé, the cover letter, application answers, and
>    outreach drafts. A story file is the candidate's own record and is
>    never sent, so this rule has no row for it. The labels, in the
>    forms that count:
>    - evaluate's verdict tiers written as tiers — "Strong Fit",
>      "Investable Stretch", "Long-Shot Stretch", "Weak Fit" in title
>      case or beside a score — and a fit score beside a tier or the
>      word fit ("Strong Fit — 82/100", "fit 82/100");
>    - a track name: "Track A", "Track B";
>    - the pipeline stage "To Review";
>    - the application file's labels: a round count ("6/7 held"), a
>      lens verdict — a lens name, then Pass, Revise, or Fail
>      ("recruiter Revise") — an audit tier ("ATS-Ready"), and
>      "DECISION" in capitals;
>    - terms Ten coined, which have no everyday meaning, in any
>      capitalization: "investable stretch", "long-shot stretch",
>      "shown-but-unnamed", "band call", "spine role", "mandate
>      sentence".
>
>    Ordinary English is never this rule's flag, even when it shares a
>    word with a label: "a strong fit for this team", "at this stage",
>    "on track", "leads a team of 12", "my lane", "the decision to
>    migrate", and a metric such as "scored 96/100 in the customer
>    survey" all pass. When a word could be either, it is English —
>    pass it. The echo exemption applies: the posting's own word,
>    quoted, is not jargon. *Severity: fix-before-delivery.*

- Output: the `rule` enum gains `|search_jargon`.

**Why rule 6 was rewritten (not target text).** Round 1 said "in any
wording", which makes everyday words flags: strong fit, stage, track,
lead, lane, decision. It also named labels that no skill defines —
`grep -r -i -F` over `skills/` finds "source-tier" and "scout" only in
rule 6 itself, and no lane label ("Lane A") anywhere; "long shot" is
English (evaluate's tier is "Long-Shot Stretch", `skills/evaluate/SKILL.md:39`);
"lead" is search's source-authority tag (`search/references/patterns.md:18-24`)
but also an everyday verb. The new text lists only labels that exist
in `skills/`, each in the shape a label takes. Two classes, because
they fail differently: a label built from everyday words ("Strong
Fit", "Track B") is a flag only in its label shape; a coined term
("spine role") has no everyday reading, so any use is a leak. The
stage names Interested, Applied, Interviewing, and Offer
(`search/scripts/jobs_md.py:18`) are everyday words and stay off the
list. Story files are out of scope because storybank's checker run
covers struck forms and never-say only
(`storybank/references/eval.md:30-35`), a story is never sent, and a
label copied from a story into a sent document is caught there; the
output contract already requires rows only "per document it applies
to" (`language-check.md:114`). What the rule must NOT flag is measured
in § 7 (the `t15c` fixture family).

**`skills/apply/scripts/check_materials.py`** and
**`packages/checkers/src/check-materials.mjs`**, in `_shared` / `shared`,
right after the Unicode check (after the `## Claim rules` strip):

- Pattern (same source text in both):
  `ASCII_ARROWS = <=+>|<-+>?|-+>|=+>`. It catches `->`, `-->`, `<-`,
  `<->`, `=>`, `==>`, `<=>`. It does not match `<=`, `>=`, `<`, or `>`
  alone. (Unchanged in round 2.)
- Exempt spans, replaced with one space before scanning: backtick and
  tilde fences, `<!--…-->` comments, double- and single-backtick inline
  code (one line), and `http(s)://` URLs. One alternation; the
  double-backtick branch must come before the single-backtick one.
  - Python (`check_materials.py` and `check_messages.py`, same source
    text; `check_messages.py` keeps its name `EXEMPT_SPANS`):

    ~~~
    ARROW_EXEMPT_SPANS = re.compile(r"```.*?```|~~~.*?~~~|<!--.*?-->|``[^\n]*?``|`[^`\n]*`|https?://\S+", re.S)
    ~~~
  - JS: the same alternation with `[\s\S]` for Python's `.`, and the
    URL's `\S` built from `py-text.mjs`'s `PY_NOT_S` — never a bare JS
    `\S`, which differs from Python's on U+001C–U+001F, U+0085, and
    U+FEFF (the review's M1; the tester's corpus in 50fa84f FAILs four
    cases on exactly this):

    ~~~
    const ARROW_EXEMPT_SPANS = new RegExp("```[\\s\\S]*?```|~~~[\\s\\S]*?~~~|<!--[\\s\\S]*?-->|``[^\\n]*?``|`[^`\\n]*`|https?://" + PY_NOT_S + "+", "g");
    ~~~
- **Level: FAIL — a named exception to the earned-FAIL bar** (below).
- **Message** — the same text in the Python and JS files, word for
  word; `check_messages.py` prints the same text after its standard
  `draft <i>: ` prefix:

  `arrow chain "<m>" — write it in words ("from 80% to under 1%"); a reader sees an arrow as notes, not a sentence`

  Only the first match is reported, as with the glyph FAIL. The Unicode
  glyph FAIL keeps its message unchanged in all three files (its
  receipt is real: `docs/receipts.md:36`).
- The opener FAIL's "(case + checklist)" becomes "ONE Summary" in both
  files, because decision B retired the case. (Done in round 1.)
- **The rest of "the case" goes too**, in both files, messages
  identical:
  - the 50-word FAIL (earned 2026-08-01 by a 133-word case, still the
    same harm) becomes
    `Summary opens with <n> words of prose (max 50) — the Summary is bullets (apply's patterns.md § The Summary); a recruiter reads 7-11s in an F-pattern and prose past ~2 lines is invisible`.
    It stays a 50-word FAIL, not a FAIL on any prose: the incident
    earned 50 words, and a shorter paragraph is the recruiter lens's
    call;
  - the repeated-number WARN's "the case carries the strongest number
    once" becomes "the Summary carries each number once";
  - `CASE_MAX_WORDS` is renamed `SUMMARY_PROSE_MAX_WORDS`, and the
    comments that say "the case" say "Summary prose".

**`skills/outreach/scripts/check_messages.py`** gets the same pattern and
exemptions, scoped to drafts. The message is `draft <i>: ` followed by
the message above. There is no JS port, so there is no parity item.

**`skills/outreach/references/eval.md`** (round 1 left it unwired):

- `:10` — "aggregate year counts, arrow glyphs, draft scoping" becomes
  *aggregate year counts, arrow glyphs and ASCII arrow chains (code,
  comments, and URLs exempt), draft scoping*;
- `:17` — "never-say, WATCH-tier struck forms, and any rewording of
  either (t15; #29)" becomes *never-say, WATCH-tier struck forms, any
  rewording of either (t15; #29), and `search_jargon` — Ten's own
  labels in a draft*.

### The FAIL level is a named exception to goals § 2

Goals § 2's earned-FAIL bar: *"a code FAIL is earned by a real
incident; rules derived from a spec or a style preference start as
WARN."* The ASCII-arrow FAIL has no incident. Round 1 borrowed the
Unicode glyphs' receipt (`docs/receipts.md:36`, candidate-caught
2026-08-16, "glyphs garble in ATS parsers"), and that receipt does not
carry over: a 7-bit `->` is plain ASCII and extracts intact. The
message's "symbol arrows garble in ATS parsers" was therefore a false
claim, and it goes.

The real harm is the reader's: **an arrow reads as shorthand notes, the
author's scaffolding, not a sentence** — the same second harm
`check_materials.py:71-72` already names for the glyphs ("read as audit
scaffolding that leaked into the document"). Owner ruling 6 sets FAIL
on that harm without an incident. It is recorded as a named exception,
not passed off as earned:

- here;
- in `docs/receipts.md § apply`, the ledger where a rule's provenance
  lives (`receipts.md:17-19`: "Adding a rule? Add its row here") — the
  row says "none" in the incident column and names the ruling;
- in both scripts' comments (§ 9, the round 2 build list).

The exception ends one of two ways: an incident earns it (the receipts
row gets the incident), or the owner rules it back to WARN. The chain
itself calls an exception "drift that somebody blessed"
(`docs/skill-shape.md:31`); whether goals § 2 should admit owner-ruled
FAILs at all is the owner's question, listed in § 8.

### Known limits of the arrow checker (accepted unless marked)

Verified against the round 1 alternation and the round 2 one (Python
and a JS build with `PY_NOT_S`, same results):

| Input | Result | Decision |
|---|---|---|
| a double-backtick code span, two backticks each side of `a->b` | false FAIL (the opening backtick pair is taken as an empty single-backtick span, then the arrow is scanned) | **fixed in round 2** — the double-backtick branch |
| a tilde fence (`~~~`) | false FAIL | **fixed in round 2** — the tilde-fence branch |
| `<-5 C` — "less than minus five" | false FAIL `<-` | accepted: rare in these documents, and the fix the message asks for ("below −5 °C") is better prose |
| four-space indented code | false FAIL | accepted: these documents carry no code blocks, and exempting indented lines would also exempt a list item's indented continuation lines — a false pass on real prose |
| a URL with no scheme (`example.com/a->b`) | false FAIL | accepted: telling a scheme-less URL from prose is guesswork |
| an arrow glued to a URL (`https://x.com/p->next`) | missed — the URL span runs to the next space | accepted: rare; the recruiter lens reads the page |

**Python/JS parity is a hard requirement** for every row, accepted or
fixed: a limit may exist, but it must be the same limit in both.

**Parity:** `node packages/checkers/test/parity.mjs` and
`node tests/checkers-parity/extra.mjs` must stay 100% identical in
stdout, exit code, and files. The corpus needs these cases:

- each arrow form;
- an arrow inside a URL, an inline code span, a double-backtick span, a
  backtick fence, a tilde fence, and a comment (all exempt);
- text after a double-backtick span, still scanned;
- `<=` alone (no finding);
- a document carrying both Unicode and ASCII arrows (two FAILs, Unicode
  first);
- accented text beside an arrow;
- each accepted limit in the table, pinned, so a change to one is
  visible;
- a URL carrying U+001C–U+001F, U+0085, or U+FEFF (the M1 cases already
  in `tests/checkers-parity/extra.mjs` from 50fa84f) — all must pass.

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
  - a bullets-only Summary passes the 50-word Summary-prose FAIL.
- **`tests/test_check_messages.py`**: an ASCII arrow in a draft FAILs, and
  the same arrow in a URL passes.
- `tests/always-on/arms/lean/**` is a measurement arm and is not
  rewired.

**Round 2: the tests that encode round 1's text.** These assert text
that § 4 now changes, so they change with it. The builder updates its
own round 1 tests; the tester, not the builder, updates the tester's
file (`tests/test_three_lens_review.py`, 50fa84f), re-deriving each
assertion from this amended spec (PROCESS step 5: the author never
grades the build).

- Builder: `tests/test_check_materials.py:247,259` ("arrow/scaffolding
  chain" → "arrow chain"); `:122,277` and
  `packages/checkers/test/unit/check-materials.test.mjs:84` ("case is"
  → "Summary opens with").
- Tester: `tests/test_three_lens_review.py:25-26` (the message),
  `:44` (the match string), `:163` (the exempt alternation); new tests
  for the tilde fence and the double-backtick span, for rule 6's
  ordinary-English sentence and story-file scope, and for the
  `draft <i>: ` + message form in `check_messages.py`.

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
3. "Fail if" appears only in `eval.md`. In apply's `patterns.md`,
   "4–7" and "Bullet 1 is the mandate sentence" each appear once, in
   § The Summary, and shape item 3 points there
   (`grep -c -F "4–7" skills/apply/references/patterns.md` is 1), and
   profile states no Summary shape of its own (`grep -rn -F "4–7"
   skills/profile` is empty; its three pointers name apply's
   `§ The Summary`). The subtitle rule appears once. "3-line", "Three
   or four lines", and "≤50 words" are gone from apply's patterns. "The case" as the
   Summary's name is gone from apply: `grep -rn -i -w "case"
   skills/apply` shows no hit about the Summary (other senses of the
   word, like "the case for hiring them", stay).
4. A temporary fixture application file with the new `scored` cell and a
   waiver gets 0 WARNs from `check_files.py`.
5. `grep -n -E 'rightarrow|→' skills/apply/SKILL.md` is empty.
6. Every pattern and message in § 4 matches the code (use `grep -F`).
   `ASCII_ARROWS` has the same source text in the `.py` and `.mjs` files;
   the Python exempt alternation is the same text in both Python
   checkers; the JS one uses `PY_NOT_S`, and no bare `\S` remains in
   it. The new arrow message appears word for word in all three
   checkers, and "garble" appears only in the Unicode glyph messages.
7. `language-check.md` has 6 rules, and its enum lists `search_jargon`.
   Rule 6 names no term that `grep -r -i -F` cannot find elsewhere in
   `skills/` (no "source-tier", no "scout", no lane label).
8. `python3 tests/word_report.py`: report apply's delta.
9. `docs/receipts.md § apply` carries the ASCII-arrow row, and its
   incident column says none and names ruling 6.

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
- Ruling 7 (the base résumé): no harness case covers profile's
  base-résumé loop today (`tests/always-on/cases` has none). A case —
  a base with a paragraph Summary, improved with no posting, ends with
  4–7 bullets and the `criteria.md` target as the mandate — is needed
  before ruling 7 can be called measured. The tester names and builds
  it.

```
CASES="t10-lens-gate t10-lens-ceiling t10-honest-bridge t10-chronology t10-summary-bullets" TRIALS=2 ./run_t10.sh lens3
./judge_t10.sh lens3
CASES=all TRIALS=2 ./run_t10.sh lens3-all
TRIALS=2 ./run_t13.sh lens3
./run_t15.sh lens3 && python3 score_t15.py lens3   # the three scored rules must not move; read every search_jargon flag
FIXDIR=fixtures/t15c SKIP_PY=1 TRIALS=3 ./run_t15.sh jargon && FIXDIR=fixtures/t15c python3 score_t15.py jargon
```

**Rule 6's false alarms, measured (added in round 2).** t15 re-scores
only the three rules it was built for (`score_t15.py` `RULES`). But its
false-alarm count takes every flag row that matches no planted
violation, whatever its rule (`score_t15.py` `score()`), so on the
existing t15 and t15b fixtures any `search_jargon` flag already shows
up as a false alarm: read each one — none of those fixtures plants a
Ten label. That is a side check, not a measurement of rule 6. The
measurement is a new fixture family, `tests/always-on/fixtures/t15c`
(fictional candidate, agent condition only), three cases:

- `jargon-planted`: a letter and a résumé carrying each label shape
  from rule 6 once ("Investable Stretch", "fit 82/100", "Track B",
  "To Review", "6/7 held", "recruiter Revise", "ATS-Ready",
  "DECISION", "spine role"); `truth.json` lists each as a
  `search_jargon` violation;
- `jargon-plain-english`: the false-alarm probe — a letter and
  application answers that use the everyday words the round 1 text
  would have flagged: "a strong fit", "at this stage", "on track",
  "leads a team of 12", "my lane", "the decision to migrate", "scored
  96/100 in the customer survey", "Applied", "Interviewing"; empty
  `truth.json`;
- `jargon-echo`: a posting whose own words share a label's shape (its
  "Track B modernization program"), double-quoted in the letter; empty
  `truth.json`.

The bar, per case on the median of three trials: every planted label
caught, and **zero `search_jargon` false alarms on the two clean
cases in every trial**. A false alarm on the plain-English probe fails
the rule; the fix is a narrower label shape in rule 6, then re-measure.
`score_t15.py` scores the family when `search_jargon` is in its rule
list for this `FIXDIR` (a tester change; the scorer must not change
the t15 and t15b numbers).

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
   become a checker FAIL, with parity (§ 4). The FAIL level has no
   incident behind it, so it is recorded as a named exception to goals
   § 2's earned-FAIL bar (§ 4, and `docs/receipts.md § apply`).
7. **The base résumé's Summary is also 4–7 short bullets, bullet 1 the
   mandate sentence** (owner, 2026-09-25, relayed in chat by the lead;
   it answers round 1's open question). The rule keeps its one home in
   apply's `§ The Summary`; profile points there (§ 3a). Decision C
   (measurement) is still not approved.

**Still open — for the owner, not decided here:**

1. **Goals § 2 versus ruling 6.** The goals doc says a code FAIL is
   earned by a real incident; `docs/skill-shape.md:31` says "an
   exception is drift that somebody blessed". Ruling 6 is now such an
   exception. Three ways to make the chain consistent: (a) amend goals
   § 2 so an owner ruling that names a concrete harm, with a row in
   `docs/receipts.md`, may set a FAIL; (b) keep ruling 6 as the one
   named exception, as recorded now; (c) lower ASCII arrows to WARN
   until an incident earns the FAIL. This design records (b) because
   it overturns nothing; it does not choose among them.

## 9. Round 2 build list (from the review of 9842d81)

One checklist for the coder. Each item names the review finding, the
file and line in the built tree, and the section that holds its target
text. "Design" in the cause column means round 1's target text caused
it and is fixed above; "build" means the text was right and the build
missed it.

| # | Finding | Where | Target text | Cause |
|---|---|---|---|---|
| 1 | L1 — builder notes in skill files | `apply/references/eval.md:58-61` ("`§ Who checks what` points here", "The existing form stands … unchanged") and `:63-66` (the "Arrows and search jargon leave the lens lists" paragraph); `apply/references/schema.md:57-58` ("(a form the checker already accepts)") | § 1 | design |
| 2 | L4 — the judged destination misses the lenses | `apply/references/eval.md:83-88`, the round and panel bullets | § 1 | design |
| 3 | L9 — "multi-persona review" | `apply/SKILL.md:17,36` | § 2 | design |
| 4 | L7 — budget not said up front | `apply/SKILL.md:35` | § 2 | design |
| 5 | L3 — the Summary rule in two places | `apply/references/patterns.md:87-90` (shape item 3) and `:125-126` | § 3 | design |
| 6 | M2 — rule 6 unbounded | `profile/references/language-check.md:62-74` | § 4 | design |
| 7 | M3 — false ATS claim in the ASCII message | `apply/scripts/check_materials.py:243-244`, `packages/checkers/src/check-materials.mjs:180`, `outreach/scripts/check_messages.py:106`; the comments that say "the same failure class" (`check_materials.py:74-76`, `check-materials.mjs:32-35`, `check_messages.py:26-29`) say instead: a named exception to the earned-FAIL bar, row in `docs/receipts.md` | § 4 | design |
| 8 | M1 + L6 — URL `\S` parity; tilde fences and double-backtick spans | the exempt alternation in `check_materials.py:81`, `check-materials.mjs:40`, `check_messages.py:32`; the parity corpus | § 4 | design (round 1 was silent on `\S`) |
| 9 | L5 — "case" wording | `apply/references/eval.md:10`; `check_materials.py:61-62,153-155,188,195,198-201` and `check-materials.mjs:24,102,141-142`; `apply/references/patterns.md:19` ("the Summary's case, the letter" becomes "the Summary, the letter") | §§ 1, 4 | design |
| 10 | L2 — outreach's eval not rewired | `outreach/references/eval.md:10,17` | § 4 | design |
| 10a | ruling 7 — the base résumé's Summary | `profile/SKILL.md:58` (read step); `profile/references/patterns.md:123-124`; `profile/references/eval.md:59-60`; the base-résumé sentence and the checklist-form sentence in `apply/references/patterns.md § The Summary` | §§ 3, 3a | new ruling |
| 10b | "No search jargon" craft line unbounded, like rule 6 | `apply/references/patterns.md:111-113` | § 3, "Other rows" | design |
| 11 | receipts row for the renamed FAIL | `docs/receipts.md:39` "Case ≤50 words" becomes "Summary prose ≤50 words before its bullets (once called the case)"; the incident cell stays. Lands in the same commit as item 9 | — | build |
| 12 | `docs/loading-map.md` figures | this design names no owner for them, and `docs/skill-shape.md:218` makes regeneration a step of a shape conversion, which this is not. Recommended: after round 2, run `python3 tests/word_report.py` and update apply's, profile's, and outreach's figures in the same commit; the lead decides | — | build |
| 13 | tests that encode round 1's text | § 5, "Round 2" (builder's and tester's lists are separate) | § 5 | — |
| 14 | deploy | `cp -r skills/* ~/.claude/skills/`; round 2 removes no file | — | — |

Already done by this amendment (docs only): the ASCII-arrow row in
`docs/receipts.md § apply`.

