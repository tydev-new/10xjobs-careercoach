# t10 + t13 — the apply and outreach conversions, measured (2026-08-21)

Apply (skill six, 7b459d4) and outreach (skill seven, 9a9787b) were the
last two consumers of `improvement-loop.md`; converting them inlined
the tier-2 loop contract into each skill's own loops and removed the
shared file. Reviews: eleventh and twelfth DRIFT verdicts (14 and 13
findings, all fixed — 4399d90, the outreach fix commit). The harnesses
ran with the vault, targeted-by-default, concurrent.

## t13 — outreach's ceiling case (was "ceiling through a pointer")

| Round | Build | Result |
|---|---|---|
| v1, v2 (old: pointer to improvement-loop.md) | — | 0/2, 0/2 |
| v3 (old: marked echo at the drafting moment) | — | 2/2 |
| shapev1 (law inline at the Draft exit) | 9a9787b | 2/3 |
| shapev2 (+ "a list is not a message") | outreach fix commit | **3/3** |

The shapev1 miss: all four claims fit inside 300 characters as a
comma-spliced inventory, the sourced hook was cut, and the rubric line
still said `voice ✓`. The standard was met on the number and missed on
the rubric — the exit named only the number. Added at the exit: claims
that fit only as a list are brevity ✗ and voice ✗, UNMET. shapev2's
three trials each wrote exactly that into the contacts file and handed
the claim choice back as a decision.

The judge now feeds outreach's SKILL.md and anchors on the Draft exit
(FATAL if the anchor moves) — the case measures the same ceiling at its
new home.

## t10 — apply's four conduct cases

| Round | Build | storybank-default | verbatim-panel | coverage-classify | over-budget |
|---|---|---|---|---|---|
| history (loops2–5, v1–v3) | old shape | 3/4 | 5/6 | 2/8 | 4/8 |
| shapev1 | 7b459d4 (pre-review) | 2/2 | 2/2 | 1/2 | 0/2 |
| shapev2 (targeted) | after 4399d90 + the step-7 move | — | — | 0/2 | 0/2 |

shapev1 ran on the build with the review's H1 bug (the `--base` flag
passed bare — exit 2); no trial hit it (the agents ran the script
without the flag). The two weak cases were never stable in the old
shape either; the conversion did not move them.

What the over-budget transcripts showed, both shapev1 trials: "the
full table is in the application file" — the rows pointed at, not
pasted; in base order; `words` column "—" on every cut. Gate 3's text
was intact at step 5. Two of the three ingredients (weakest-first, what
each cut buys) lived in patterns.md; they moved to step 7 with the
pointer failure named.

**shapev2, targeted, 0/4 — and the reading is not "try another
sentence."** The judges' own notes: coverage-classify's classification
bet PASSED both trials (the `shown-but-unnamed` call was right, gaps
named without invention); the fails were the surrounding obligations —
rows pointed at, two requirements dropped from the table, a gap asked
as a claim. over-budget t1 disclosed the cut list and the file matched
it (progress), failing only on weakest-first order; t2 pre-cut 17
bullets before measuring and pointed at the file.

Across twelve trials of these two cases, old shape and new, **"paste the
rows" fails in prose however it is phrased.** That is the loop law's own
ceiling: two rounds with no movement → change strata, prose → code. The
recommendation, for the founder's call: a small script
(`apply/scripts/proposal_block.py --application <file>`) that prints the
validated coverage and selection tables as a paste-ready block, `out`
rows first; step 5 becomes "paste the script's output" and a pointer is
no longer a thing the agent can write. Weakest-first ordering is
judgment the script cannot supply, but it can refuse a `words` column of
"—" on an `out` row. Not built here — a new script is a design
decision, not a fix round.

## What this says about the shape

Both conversions' reviews were placement and precision (a live CLI bug,
invented callers, the chain naming a deleted file, conduct filed in
schema). The measured misses were all rules that existed but not at
their moment, or not phrased for the trigger that defeated them —
consistent with every conversion so far.

## Addendum, 2026-08-21 evening — the loop alignment, the script, and the design change

Three things changed after the 0/4 above, each measured on the same two
cases (over-budget, coverage-classify; TRIALS=2, targeted):

| Round | What changed | over-budget | coverage-classify | "Cut —" block in reply |
|---|---|---|---|---|
| alignv1 | loop alignment: `## Standard`, `## Rounds`, `## Panel`, count scoring | 0/2 | 0/2 | — (tables written every trial) |
| codev1 | `proposal_block.py` prints the tables; WARNs on `have`-without-their-word and base-ordered cuts | 0/2 | 0/2 | 0/4 — the script ran in every trial; its output stayed tool-side |
| codev2 | + "the candidate cannot see tool output" | 0/2 | 0/2 | 0/4 |
| deliverv1 | **design change: deliver first, disclose beside, silence is a yes**; the script prints a short decisions list, not the table; the page target is soft | **2/2** (first ever) | 0/2 | **4/4** |
| loopshape1 | the Tailoring section rewritten from ten steps to the loop shape (standard · budget · three moment rules · exits); the steps became `patterns.md § Tailoring — getting there` | 1/2 (t1: the two-page alternative not offered; t2: the old pointer mode once) | **2/2** (first ever) | 4/4 |

What the trail says:

- The twenty-trial failure was never wording. A 26-row, seven-column
  table is the work record, not a proposal a person reads; the model
  would not paste it, and in the real product its tool output is
  visible anyway (a collapsed card) — the judge reads only the reply.
  The founder's design change — deliver the document, disclose the
  decisions beside it as a short list, make reversal one sentence,
  treat silence as yes — is what moved the case, with the script
  printing the list.
- The loop shape held the design at least as well as the procedure
  (4 of 8 trial-outcomes each, carried by different cases) at a third
  the length. The prescriptive text was not what carried the result.
- Remaining single sightings: the page alternative not offered once;
  the pointer mode once. Watched, not reworded.

`proposal_block.py`'s `have`-without-their-word WARN is the classifier
career-ops did with zero LLM; here it is a flag the agent answers.

## The full suite on the loop shape (loopshape-full1 → loopshape2)

| Case | first conversion build | loop shape, full suite | after two moment rules restored |
|---|---|---|---|
| over-budget | 0/2 | **2/2** | — |
| coverage-classify | 1/2 | **2/2** | — |
| storybank-default | 2/2 | 0/2 | **2/2** |
| verbatim-panel | 2/2 | 1/2 | **2/2** |

The reshape to the loop shape moved two measured, moment-bound rules
into references — "a volunteered fact goes to the storybank; a new
line needs a yes on the exact line" and "the panel is three spawned
subagents" — and both failed at once. Two lines back in the loop, both
cases 2/2. **The rule the shape needs stated: a measured rule that
binds at a moment stays in the loop however short the loop is; the
hints in patterns are for how, never for what must be true.**

Net: **8/8 on one build** — the first time every t10 case has passed
together. Apply's SKILL.md is 2,050 words, down from 2,845 at the
procedure's peak; the ten steps live in `patterns.md § Tailoring —
getting there`.
