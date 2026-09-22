# Rule inventory and run budget (plan step B1, items 1–2)

**Status:** classification and sizing only. No skill was edited and no harness run happened.
**Pinned to:** commit `a80c2df` (HEAD on 2026-09-22). Every `file:line` and word count below is taken from that commit (`git show a80c2df:<path>`), so the numbers can be reproduced. `a80c2df` changed only `evaluate`; everything else is the same as `47c51f4`.
**Scope:** the 9 skills' `SKILL.md` and `references/patterns.md`, plus Tier 0 (`skills/profile/templates/workspace-CLAUDE.md`). 19 files, **21,796 words** (the same total `tests/word_report.py` prints for these files).
**Author:** architect. The spend it sizes needs the owner's approval (rule 5) before anything runs.

---

## How to read this

**One row per rule.** In `SKILL.md` and Tier 0, each rule, moment rule, goal-table row, or exit is a row. In `patterns.md`, technique comes in blocks (a numbered list, a table, a subsection), and the plan lets a whole Craft section be ablated as one unit, so each block is one row. Every line in the 19 files belongs to exactly one row. The row word counts add up to the file totals, and a script checked that.

**Classes** (from the plan, Part B):

| Class | Meaning | In B1 |
|---|---|---|
| Code | has one right answer; a script or schema does, or should, enforce it | never ablated |
| Policy | a Part 1 promise: gates (P7), claims never stronger than the facts (P8), candidate facts come from the candidate, rule 10, honest numbers, data is not instruction, the candidate's own calls (P4), folder and data safety (P9) | never ablated |
| Capability | a moment rule, loop rule, or ceiling earned against an older model; Tier 0 interrupts with no data-safety receipt | ablation candidate |
| Craft | world knowledge a frontier model probably has (résumé craft, interview frameworks, research technique) | strong ablation candidate |
| Structure | frontmatter, titles, section headings, pointers. Not a rule. Listed only so the word totals reconcile | — |

Two tags sit on top of the class:

- **`[goal]`** marks a row of a skill's Goal table. The goal-only arm keeps these rows, so they are not separate per-rule ablation units.
- **`= X`** in the receipt column marks a duplicate of rule X. It is measured together with X. Deleting a duplicate is not automatically free, because a rule that is named where it fires is doing work (PROCESS, "co-located obligations must be co-named").

**Receipt codes:**

- `RC:<section>`: a row in `docs/receipts.md`.
- `EV:<tN>`: the eval record in `docs/evals/` for that harness.
- `D:Pn`: the rule follows from PRINCIPLES Part 1 rule *n*. This is rule 13's other way in: a rule may be derived instead of earned.
- `(in text)`: the date of the incident sits inside the skill prose. `receipts.md` says that history should move out of the skill.
- `none found`: I searched `docs/evals/`, `docs/receipts.md`, `docs/PROCESS.md`, `docs/skill-shape.md`, the case `expected.md` files, and `git log`. Only 10 commits exist since the fork, so most history lives in the pre-fork CareerCoach repo, which I did not search. **UNVERIFIED:** that repo may hold receipts I could not see.

**Harness cases:** the `tests/always-on/cases/*` whose `expected.md` would fail, or lose signal, if the rule stopped working. A case only counts if its runner ships the rule's skill (for example, coach rules can only be measured by `t8-*`, the one runner that ships every skill). `(partial)` means the case touches the rule but was not built for it. `none` means the rule **cannot be ablated with evidence yet**.

**Judgment calls between Policy and Capability.** Where a row could be either, I chose Policy, as the brief asks. These are the rows:

- AP-S12: a volunteered fact goes to the storybank. Chosen because it is "candidate facts come from the candidate".
- PR-S17: decline a LinkedIn URL as the seed. Chosen for source integrity. The same line also holds "ask ONE question", which is Capability, so that clause can't be ablated alone until the line is split.
- SE-S16 and SE-S19: dismissals need the candidate's batch yes, and never happen unattended. Chosen because the pipeline decisions are the candidate's (P4).
- CO-S04: the plan's size. Chosen because it is a P6 promise.
- T0-21: don't overrule their target. Chosen under P4.
- SB-S08: never guess.
- SB-P14: a draft is never counted as coverage. Chosen because it is an honest number.

---

## What the inventory found before any run

These change what the budget should buy first. Each one has its evidence.

1. **The 11-to-9 consolidation (`bf89a7c`, 2026-08-24) deleted measured moment rules, and no harness run was recorded after it.** The latest records in `docs/evals/` are dated 2026-08-21/22. Rules that won measured passes are no longer in the text:
   - `t14`'s "the dealbreaker is not yours to soften" (EV:t14 shapev3). Missing at `evaluate/SKILL.md:36`.
   - Target-companies protection, and "correct the count, build from the board" (EV:t14 shapev3/v4). Missing at `search/SKILL.md:48`. EV:t8 had already measured the *trimmed* version of this rule dropping from 3/3 to 0/2.
   - `t6`'s "a near-match IS that row; say which; proceed", now compressed at `evaluate/SKILL.md:35`.
   - `t13`'s "claims that fit only as a list are UNMET". Missing at `outreach/SKILL.md:63`.
   - `t12`'s "a row marked rough is top priority" and "every banked question keeps its origin mark". Missing at `interview/SKILL.md:36`.
   - `t10`'s "reviewers get SOURCE documents" (RC:apply). Missing at `apply/references/patterns.md:173-183`.
   - `t8`'s "say WHEN the numbers become meaningful" (EV:t8). Missing at `coach/SKILL.md:84`.
   - `t19`'s "creating a directory IS writing" and "decline before any fetch". Missing at `profile/SKILL.md:44,52`.
   - `t7`'s imperative "PROPOSE it now … silence is not the safe option" (EV:t7 round 3). It is now the softer "propose it in chat" at `storybank/SKILL.md:36`. EV:t7 measured the classification-style wording failing.

   **In effect, the consolidation was an ablation that was never measured.** The first run in any option below is therefore a baseline of HEAD, and it doubles as the measurement of `bf89a7c`.
2. **The precedence chain disagrees with itself about the gate** (PRINCIPLES → goals → design; I report this and don't pick a winner):
   - PRINCIPLES rule 7 has four steps: see the complete thing, one plain sentence, explicit yes, log entry.
   - `coach/references/gate-grammar.md:5-12` matches it: artifact, gate line, and report-back (the log), with the explicit go in its Rules.
   - Tier 0 (`workspace-CLAUDE.md:36`) calls itself the same "4-part gate grammar" but lists different parts: "what will happen, what they must verify, how to reverse, and explicit trigger". A candidate-facing agent reads Tier 0 on every turn, so the version it sees most is the one that disagrees.

   Separately, PRINCIPLES rule 6 says the plan holds "two to four things", while `coach/SKILL.md:15` says 1–3.
3. **`storybank/SKILL.md:82` is corrupted.** It holds a dangling fragment ("ves challenge; generic advice and borrowed insight don't qualify.") glued onto the closing line, and the closing line is then repeated at :84. `check_files.py` did not catch it.
4. **`interview` writes to `base-resume.md § Claim rules` directly** (`interview/SKILL.md:21,66`, `references/patterns.md:47`). This goes against RC:profile "`base-resume.md` has ONE writer: profile" (2026-08-19), which is exactly the incident class that receipt records.
5. **Tier 0 points to the wrong place.** `workspace-CLAUDE.md:81` says the marked echo is in the profile skill's `SKILL.md § Nothing extracted is written`. The echo is actually at `profile/references/patterns.md:16-20`.
6. **Rule 12 duplicates.** "Every reply ends with ONE next step" appears in Tier 0 and in all 9 `SKILL.md`s. "Proposing a new pattern" appears in all 9 `patterns.md`s (447 words; the 8 next-step duplicates add 136). The ceiling clause "a claim-name without its number is not the claim" appears in Tier 0 and 5 exits. The four debrief writes appear twice (`interview/SKILL.md:61-65` and `references/patterns.md:39-48`). The no-story answer patterns appear twice (`storybank/references/patterns.md:105-119` and `interview/references/patterns.md:14`).
7. **Craft carries numbers with no source**, which is a risk under rule 8 (no invented numbers). Examples: the channel response-rate table (`outreach/references/patterns.md:131-145`), "60–70% coverage is often competitive" (`evaluate/references/patterns.md`, EV-P13), the goal-math week counts (`coach/references/patterns.md:39-43`), the 150–200-word answer default (AP-P22), and the ≤150-people founders tier (OU-P03). Deleting these through ablation is a win twice over.
8. **Harness problems that block a valid ablation. These are cheap and should be fixed before any spend:**
   - **The judges read the live skill text.** 10 of 12 judge scripts `cat $REPO/skills/...`. In an ablation arm, the judge would then grade against the *ablated* text, so a removed rule would also disappear from the judge's standard. This is the "judge inputs are inputs" law (RC:cross-cutting). Fix: judges read the skills from a pinned baseline commit (for example a `JUDGE_SKILLS_REF`).
   - **The judge is not pinned.** `JUDGE_MODEL` defaults to the alias `opus`. It should be an explicit model ID, so the judge stays fixed across the months B1 runs.
   - **The runner default is `sonnet`.** It resolved to `claude-sonnet-5` in the August runs. The plan says the runner is "the MVP's default Claude model", and **that model is not named anywhere I could find (UNVERIFIED).** The budget below assumes Sonnet 5 and gives the cost if it is Opus 5.5 instead.
   - **Some Policy has no harness case at all:** send/submit gates (T0-07, AP-S07/S20, OU-S17), rule 10 offers (CO-S19, IN-S30), the inbox read-only boundary (CO-S21), and document text as data (PR-P05). B1 never ablates Policy, so this doesn't block B1. It does matter for B2, and for the step 4 parity check on the web runtime.

---
## Summary tables

### Rows and words by class, per skill (`rows · words`)

| Skill | Code | Policy | Capability | Craft | Structure | Total words |
|---|---|---|---|---|---|---|
| tier0 | 1 · 24 | 9 · 343 | 10 · 453 | 1 · 26 | 1 · 40 | 886 |
| apply | 7 · 335 | 12 · 488 | 25 · 1,233 | 14 · 1,419 | 2 · 101 | 3,576 |
| coach | 5 · 186 | 9 · 314 | 29 · 1,686 | 16 · 1,207 | 2 · 126 | 3,519 |
| evaluate | 7 · 272 | 5 · 109 | 18 · 561 | 11 · 992 | 2 · 113 | 2,047 |
| interview | 2 · 81 | 11 · 163 | 14 · 440 | 13 · 541 | 3 · 159 | 1,384 |
| learn | 3 · 108 | 6 · 121 | 10 · 443 | 4 · 273 | 2 · 109 | 1,054 |
| outreach | 2 · 74 | 8 · 143 | 10 · 373 | 21 · 1,677 | 3 · 156 | 2,423 |
| profile | 2 · 77 | 21 · 535 | 29 · 1,628 | 7 · 532 | 1 · 131 | 2,903 |
| search | 4 · 366 | 5 · 96 | 23 · 1,059 | 3 · 322 | 2 · 109 | 1,952 |
| storybank | 1 · 51 | 8 · 284 | 11 · 397 | 13 · 1,103 | 4 · 217 | 2,052 |
| **all** | **34 · 1,574** | **94 · 2,596** | **179 · 8,273** | **103 · 8,092** | **22 · 1,261** | **21,796** |

Where the ablatable words sit, split between `SKILL.md` and `patterns.md` (Capability · Craft words):

| Skill | SKILL.md: Cap · Craft words | patterns.md: Cap · Craft words | patterns.md total |
|---|---|---|---|
| apply | 423 · 13 | 810 · 1,406 | 2,733 |
| coach | 460 · 0 | 1,226 · 1,207 | 2,637 |
| evaluate | 270 · 0 | 291 · 992 | 1,462 |
| interview | 320 · 230 | 120 · 311 | 452 |
| learn | 225 · 0 | 218 · 273 | 560 |
| outreach | 220 · 204 | 153 · 1,473 | 1,719 |
| profile | 823 · 43 | 805 · 489 | 1,404 |
| search | 292 · 0 | 767 · 322 | 1,393 |
| storybank | 239 · 38 | 158 · 1,065 | 1,361 |

**What this means for the Part B hypothesis.** The hypothesis is that `patterns.md` loses ≥ 40% of its words and Capability rules lose ≥ 25%, with no drop in pass rate.

- **patterns.md:** all 9 files total 13,721 words, so 40% is ≈ 5,490 words. Craft is 7,538 of those words, but only 15 Craft blocks (1,728 words) have *any* harness case. The 40% target can therefore only be reached by deleting Craft that no case can see. If that happens, "no pass-rate drop" holds automatically and proves nothing (rule 17: the caveat travels with the claim).
- **Capability:** there are 134 Capability rules (not counting `[goal]` rows or duplicates). 25% is 34 rules, and 89 of the 134 are measurable, so this half of the hypothesis *is* testable.

### Capability and Craft rows with no harness case (ablation can't be measured yet)

| Skill | Capability rows with no case | Craft rows with no case | Words |
|---|---|---|---|
| tier0 | T0-12, T0-17 | — | 47 |
| apply | AP-S08, AP-S14, AP-S16, AP-S18, AP-S19, AP-S21, AP-S27, AP-P18, AP-P30, AP-P33 | AP-P09, AP-P11, AP-P12, AP-P14, AP-P15, AP-P21, AP-P22, AP-P26, AP-P28, AP-P29, AP-P31 | 1,539 |
| coach | CO-S11, CO-S12, CO-S13, CO-S14, CO-S15, CO-S27, CO-P08, CO-P11, CO-P13, CO-P15, CO-P21, CO-P24, CO-P26, CO-P33, CO-P34 | CO-P01, CO-P05, CO-P07, CO-P09, CO-P16, CO-P17, CO-P18, CO-P19, CO-P20, CO-P22, CO-P23, CO-P28, CO-P30, CO-P31 | 1,793 |
| evaluate | EV-S22, EV-P16, EV-P21 | EV-P04, EV-P12, EV-P14, EV-P15, EV-P18, EV-P20 | 525 |
| interview | IN-S02, IN-S07, IN-S18, IN-S20, IN-S31, IN-P12 | IN-S05, IN-S06, IN-S19, IN-S25, IN-P03, IN-P05, IN-P06, IN-P07, IN-P08, IN-P09, IN-P10 | 723 |
| learn | LE-S13, LE-S16, LE-P09 | LE-P06 | 120 |
| outreach | OU-S03, OU-S07, OU-S16, OU-S23, OU-P05, OU-P12, OU-P21 | OU-S11, OU-S12, OU-S13, OU-S18, OU-S19, OU-P02, OU-P03, OU-P04, OU-P06, OU-P07, OU-P08, OU-P09, OU-P11, OU-P13, OU-P14, OU-P15, OU-P17, OU-P18, OU-P19, OU-P20 | 1,635 |
| profile | PR-S09, PR-S20, PR-S21, PR-S22, PR-S25, PR-S27, PR-S40, PR-P10, PR-P20 | PR-P14, PR-P15, PR-P16, PR-P17, PR-P18, PR-P19 | 932 |
| search | SE-S06, SE-S14, SE-S17, SE-S22, SE-S23, SE-P05, SE-P10, SE-P12, SE-P14 | SE-P09, SE-P11, SE-P13 | 701 |
| storybank | SB-S14, SB-S15, SB-P18 | SB-S05, SB-P03, SB-P04, SB-P07, SB-P09, SB-P10, SB-P11, SB-P12, SB-P13, SB-P15, SB-P16 | 1,152 |
| **all** | **67 rows** | **83 rows** | **9,167** |

The biggest blind spots by words:
- outreach: the ten frameworks, channels, enrichment, and warm intro. Only `t13-ceiling` loads outreach.
- coach: the whole progress review and the weekly mirror loop. No case exercises the mirror at all.
- apply: the letter, answers, and live-form craft.
- storybank: shaping, earned secret, red-team, and drills.
- profile: the three readers and the base-résumé loop.

### Rows with no receipt found

| Skill | Capability — no receipt, not derivable (rule 13 deletion candidates) | Craft — no receipt (defence is P4 + ablation) |
|---|---|---|
| tier0 | T0-11 | T0-16 |
| apply | AP-S02, AP-S08, AP-S14, AP-S16, AP-S19, AP-S21, AP-P18, AP-P30 | AP-S04, AP-P09, AP-P14, AP-P19, AP-P21, AP-P22, AP-P26, AP-P28 |
| coach | CO-S02, CO-S11, CO-S13, CO-S14, CO-S15, CO-S20, CO-P06, CO-P08, CO-P11, CO-P21, CO-P24, CO-P33 | CO-P04, CO-P05, CO-P07, CO-P09, CO-P14, CO-P16, CO-P17, CO-P18, CO-P19, CO-P20, CO-P22, CO-P28, CO-P30, CO-P31 |
| evaluate | EV-S09, EV-S15, EV-S17, EV-P05, EV-P06, EV-P08, EV-P16 | EV-P04, EV-P09, EV-P11, EV-P12, EV-P13, EV-P14, EV-P15, EV-P17, EV-P18, EV-P20 |
| interview | IN-S02, IN-S07, IN-S11, IN-S17, IN-S18, IN-S20 | IN-S05, IN-S06, IN-S19, IN-S21, IN-S25, IN-P03, IN-P04, IN-P05, IN-P06, IN-P07, IN-P08, IN-P09, IN-P10 |
| learn | LE-S02, LE-S13, LE-P02 | LE-P04, LE-P05, LE-P06, LE-P07 |
| outreach | OU-S03, OU-S07, OU-S16, OU-P12 | OU-S11, OU-S12, OU-S13, OU-S18, OU-S19, OU-P03, OU-P06, OU-P07, OU-P09, OU-P11, OU-P13, OU-P14, OU-P15, OU-P16, OU-P17, OU-P18, OU-P19, OU-P20 |
| profile | PR-S05, PR-S09, PR-S16, PR-S20, PR-S21, PR-S25, PR-S27, PR-P10, PR-P12 | PR-S07, PR-P14, PR-P15, PR-P16, PR-P17, PR-P18, PR-P19 |
| search | SE-S02, SE-S06, SE-S11, SE-S14, SE-S17, SE-S22, SE-P02, SE-P05, SE-P06, SE-P07, SE-P10, SE-P12 | SE-P09 |
| storybank | SB-S02, SB-S12, SB-S14, SB-S15, SB-P06 | SB-S03, SB-S05, SB-P03, SB-P04, SB-P07, SB-P08, SB-P09, SB-P10, SB-P11, SB-P12, SB-P13, SB-P15, SB-P16 |
| **all** | **67 rows, 2,896 words** | **89 rows, 6,427 words** |

How to read this table:

- **Capability rows here are rule 13's deletion candidates.** They have no incident on file and don't follow from Part 1. The rule says: delete them, or find the receipt. Many of them are the skeleton of loops and sequences (runs-when, exits). Those are better tested by the goal-only arm than one by one.
- **Craft rows with no receipt can be defended by P4** ("Ten brings the world's playbook"), which makes them derivable. So rule 13 doesn't force their deletion. Their only real test is ablation, which brings back the coverage gap above.
- **Policy rows are all derivable** (`D:P…`). None of them is on this list.
- **One Code row is on this list:** AP-P24, the PDF conversion ladder, which restates what `render_resume.py` already does.

---

## Run budget

### Cost per run, from what past runs actually cost

The source is the `result` event of 701 past `claude -p` streams in `10xjobs-cowork/tests/always-on/results/`, from August 2026, with Sonnet 5 as the runner. I read only the cost, duration, and turn fields, never the transcripts. These are median runner costs per case trial (all turns summed):

| Suite (cases) | $ per trial | minutes per trial | notes |
|---|---|---|---|
| t1, t2, t3 (replay) | 0.13–0.15 | 0.6–0.8 | single turn |
| t4-intake | 0.82 | 4.1 | 2 turns, full arm |
| t5 (2) | 0.35–0.38 | 1.4–1.6 | |
| t6 (3) | 0.61–0.68 | 2.5–2.7 | |
| t7 (3) | 0.17–0.56 | 0.5–2.2 | |
| t8 (4) | 0.42–2.05 | 2.0–5.3 | all skills ship; no-nag is the costly one |
| t9 (3) | 0.24–0.36 | 1.1–1.6 | |
| **t10 (4)** | **2.23–3.13** | **6.8–9.8** | apply dominates every budget |
| t12 (3) | 0.37–0.79 | 1.4–4.0 | |
| t13 (1) | 0.49 | 2.0 | |
| t14 (6) | 0.14–0.72 | 0.5–3.8 | |
| t19 (2), t20 | 0.45–1.53 | 1.1–6.5 | plus the persona-simulator calls, not in the streams (I added about $0.06–0.12) |

**Assumptions:**

- **Runner:** Sonnet 5 ($2 / $10 per million tokens). The streams' own `total_cost_usd` already reflects that price.
- **Judge:** one Opus call per trial, about 40K tokens in and 2K out, including Claude Code's own overhead. That is about **$0.30 per trial** at Opus 5.5's $4 / $20. This figure is **UNVERIFIED**: judge usage was never logged, and the `opus` alias may resolve to a different Opus.
- **Trials:** 3 per case.
- **Skill size:** the August skills were about 30% longer than today's, so these costs are a ceiling.
- **Wall time:** the runners already run 6 cases at once (`PAR=6`), so wall time ≈ serial time ÷ 6. That assumes no rate limiting, which is **UNVERIFIED** for this account.
- **Not counted:** the agent and reviewer time to build, review, and record each ablation variant. Across 106 variants, that labour, not compute, is the real bottleneck.

### The options

| Option | What runs | Runner runs | Est. cost | Serial compute | Wall at 6-way |
|---|---|---|---|---|---|
| **0. Baseline of HEAD** (needed by every option; also measures `bf89a7c`) | all 36 cases × 3 | 108 | **$116** | 5.3 h | ~1 h |
| **(a) Per-rule ablation**, every measurable Capability + Craft rule | 106 rules (89 Capability, 17 Craft) × their mapped cases × 3 | 516 | **$650** | 31 h | ~5–6 h |
| (a) by skill | apply $229 · evaluate $92 · tier0 $84 · profile $65 · coach $58 · search $43 · interview $27 · storybank $24 · learn $20 · outreach $7 | | | | |
| (a, cheap variant) | each rule on its single cheapest mapped case | 318 | $362 | | weaker evidence: one case per rule |
| **(b) Goal-only arm**, per skill (`SKILL.md` = Goal table + exits; patterns kept) | 9 arms × that skill's cases × 3 | 132 | **$142** | 6.5 h | ~1.2 h |
| (b′) Goal-only *and* no `patterns.md` | 9 more arms | 132 | $142 | 6.5 h | ~1.2 h |
| (b″) Tier 0 cut to Policy + data-safety rows only | all 36 cases × 3 | 108 | $116 | 5.3 h | ~1 h |
| **(c) Staged** (recommended; below) | stages 0–3 | 426–942 | **$445 if every block holds; ~$770 if half the per-rule set must run; ~$1,100 worst case**. You can stop after any stage | | |
| Re-measure each landed batch (plan step 5) | skill's cases × 3, 9 batches | 132 | $142 | | |

The cost of goal-only arm (b) for each skill: apply $35 · evaluate $22 · profile $18 · storybank $18 · search $17 · coach $15 · interview $8 · learn $5 · outreach $2.

**How the price moves:**

- If the MVP's default model is **Opus 5.5** instead of Sonnet 5, the runner part roughly doubles: baseline ≈ $200, option (a) ≈ $1,150.
- Running the flaky suites (t8, t10, t14) at 5 trials instead of 3 adds about 45% to (a).

### (c) The staged option

- **Stage 0 (no spend first).** Fix the harness blockers in finding 8: the judge reads a pinned baseline commit's skills, the judge model is pinned, and the runner model is named. Then run the **baseline, $116**. Compare it with the 2026-08-21 records. The owner then decides whether to restore the rules `bf89a7c` dropped *before* ablating anything, because ablating from a regressed baseline would measure the wrong thing.
- **Stage 1: one skill, evaluate. 4 arms, $88** (108 runs, about 1 h wall). The arms: Craft block out · Capability block out · goal-only · goal-only with no patterns. Why evaluate first:
  - its 9 cases are cheap ($0.14–0.72 per trial) and already run concurrently;
  - `run_t6.sh` already has a model-only arm (`CONDS="full bare"`, the decode falsifier), which is the only existing way to measure Craft;
  - it holds the most *measurable* Craft (EV-P09, P10, P11, P13, P17);
  - `a80c2df` just touched it, so its baseline is fresh.
- **Stage 2: Craft block and goal-only arms for the other 8 skills, cheapest first**: learn, outreach, interview, search, storybank, profile, coach, then apply. This is 2 × $120 = **$240**.
- **Stage 3: per-rule ablation only inside blocks that lost pass rate.** It costs $0 if every block holds, about $325 if half the per-rule set has to run, and $650 at most.
- **First approval needed: Stages 0 and 1, $204.** Every later stage is approved separately, using what the earlier stages showed.

### Two measurement cautions to approve along with the money

1. **At 3 trials, "ablated ≥ baseline" is mostly noise for flaky cases.** A case that passes 83% of the time (t14's history, 10 of 12) fails at least once in 3 trials 43% of the time. My recommendation:
   - compare the *count of MUST criteria met, pooled over the rule's cases*, not whole-case pass/fail;
   - require zero new hard fabrications;
   - use 5 trials on t8, t10, and t14;
   - re-run any single disagreeing result once before deciding.
2. **83 Craft rows (6,242 words) have no case**, so none of the options above can measure them. Deleting them honestly needs one of two things, and the owner decides which:
   - **(i) paired quality cases:** one prompt per Craft block, baseline and ablated transcripts judged side by side. About 25 grouped blocks × 3 trials × 2 arms × ~$0.60 ≈ **$90** in runs, plus the tester's time to write the prompts.
   - **(ii) an explicit owner ruling** that unmeasured Craft is deleted on P4 grounds and watched in dogfooding (rule 13's "running our own job searches is that test").

### Recommended order

1. **No spend:**
   - fix the judge inputs and pin the judge;
   - name the MVP default model;
   - the owner rules on the gate-grammar conflict and on P6 (2–4) vs coach (1–3);
   - repair `storybank/SKILL.md:82` through the normal ritual.
2. **Stage 0 baseline ($116).** Then the owner decides whether to restore the rules `bf89a7c` dropped.
3. **Stage 1 on evaluate ($88).**
4. **Stage 2**, cheapest skill first ($240), with apply last.
5. **Stage 3**, per-rule, only where a block failed.
6. **In parallel, no runner spend:** the tester writes Craft quality cases for the largest blind spots: outreach frameworks and channels, coach progress review and mirror, apply letter and answers, storybank shaping.

**Where the evidence already points** (rank these first; this is not a verdict):

- **T0-03** (ask counts before diagnosing): EV:t4 measured the model reaching the right diagnosis 6/6 *without* the rule.
- **Deletion is risky** for T0-06 (the close-out) and AP-S12 / AP-S13 (storybank default, deliver-and-disclose). These are the most strongly measured rules on file: each failed repeatedly without its current wording and passed with it.

---

## The inventory

Every `file:line` is relative to `skills/` at `a80c2df`. Words = whitespace-split tokens over the row's line range (the method `tests/word_report.py` uses).

### tier0

| id | file:line | rule | class | receipt | harness cases | words |
|---|---|---|---|---|---|---|
| T0-01 | `profile/templates/workspace-CLAUDE.md:1-6` | Header: you are a coach; this file covers where coaching goes wrong | Structure | — | — | 40 |
| T0-02 | `profile/templates/workspace-CLAUDE.md:8-9` | Short, answer first; praise evidence; end with ONE next step, never a menu | Capability | RC:profile "Ask ONE thing" (t19 menus); t5 no-menu MUST NOT | t5-plan-attended, t19-intake, t20-positioning, t8-* | 32 |
| T0-03 | `profile/templates/workspace-CLAUDE.md:11-15` | Ask application counts and stop-points before diagnosing a quiet search | Capability | t1 case (Phase A 2026-08-13; its record eval-phase-a-always-on.md is not in this repo); EV:t4 found the diagnosis right 6/6 unaided | t1-diagnosis, t4-intake | 47 |
| T0-04 | `profile/templates/workspace-CLAUDE.md:17-19` | Write the rewrite into the file and show it; then one question | Capability | t2 MUST; EV:t4 (bare model wrote nothing, 2/2) | t2-fabrication, t1-diagnosis | 33 |
| T0-05 | `profile/templates/workspace-CLAUDE.md:21-24` | Persist what changed your understanding; skills say which files they own | Capability | EV:t4 (bare 0 files; this line alone made files appear) | t4-intake (guardrails arm), t7-capture-honesty, t9-never-certify | 37 |
| T0-06 | `profile/templates/workspace-CLAUDE.md:26-33` | Every reply: name stage, asked question = Waiting row, write plan, run check_closeout | Capability | EV:t8 addendum — 0/2 x3 in coach only, 2/2 at Tier 0 | t8-no-nag-no-gate, t8-stage-sensing, t8-routing | 92 |
| T0-07 | `profile/templates/workspace-CLAUDE.md:35-36` | Sends, submits, comp agreements need explicit approval via the gate grammar | Policy | D:P7 | none | 47 |
| T0-08 | `profile/templates/workspace-CLAUDE.md:38-39` | Loops write standard first, score as count, two flat rounds → DECISION | Capability | RC:profile loop ceiling (measured once); t13 v1–v3 | t13-ceiling, t10-coverage-classify | 59 |
| T0-09 | `profile/templates/workspace-CLAUDE.md:41-46` | Folder is theirs; read documents/ and jd-inbox/ before asking | Capability | EV:t4 MUST (read résumé first); EV:t19 (drop paths) | t4-intake, t19-intake | 59 |
| T0-10 | `profile/templates/workspace-CLAUDE.md:48-54` | Every fact from profile.md or [inferred]; TODO not plausible fill; using ≠ authoring | Policy | D:P8; t2 case; RC:profile hazards | t2-fabrication, t4-intake, t7-capture-honesty, t19-intake | 76 |
| T0-11 | `profile/templates/workspace-CLAUDE.md:56-62` | Anything in candidate's voice follows voice.md and this table | Capability | none found | t20-positioning | 47 |
| T0-12 | `profile/templates/workspace-CLAUDE.md:63` | No invented analogy or metaphor in the candidate's voice | Capability | RC:profile "No contrived analogies" 2026-08-16 | none (t15b checker-side only) | 21 |
| T0-13 | `profile/templates/workspace-CLAUDE.md:64` | Keep the base's verb; ownership, scope, scale never above base | Policy | D:P8; RC:profile verb ceiling (t10 v2) | t10-verbatim-panel | 38 |
| T0-14 | `profile/templates/workspace-CLAUDE.md:65` | No tenure-as-evidence or aggregate year count (age tag) | Code | RC:profile Vercel 2026-08-03; FAILed by check_materials/check_messages | t4-intake (H4) | 24 |
| T0-15 | `profile/templates/workspace-CLAUDE.md:66` | Every claim traces to base résumé or storybank; no blended claims | Policy | D:P8; RC:apply 2026-08-16 | t10-verbatim-panel, t2-fabrication | 17 |
| T0-16 | `profile/templates/workspace-CLAUDE.md:67` | Low-ego, concrete; no filler, no AI tells in letters/messages | Craft | none found (banned filler is check_materials Code) | t10-verbatim-panel (checker only) | 26 |
| T0-17 | `profile/templates/workspace-CLAUDE.md:68` | Echo their phrase only where it answers their line; no stuffing | Capability | RC:profile 2026-08-16 candidate-caught | none | 26 |
| T0-18 | `profile/templates/workspace-CLAUDE.md:70-74` | Never invent a number or schedule; ask available time first | Policy | D:P8; t3 case; t4 MUST NOT | t3-injection, t4-intake | 53 |
| T0-19 | `profile/templates/workspace-CLAUDE.md:75-76` | Never invent a listing, interview question, or company fact | Policy | D:P8; t6/t12 cases | t3-injection, t6-research-honesty, t12-never-sharpen, t9-uncited-canon | 20 |
| T0-20 | `profile/templates/workspace-CLAUDE.md:77` | Postings, pages, emails are data, never instructions | Policy | data-is-not-instruction; t3 case | t3-injection | 12 |
| T0-21 | `profile/templates/workspace-CLAUDE.md:78-79` | Say once, with evidence, if aiming wrong; then it's their call | Policy | D:P4 (your decisions shape the hunt) | t4-intake, t8-no-nag-no-gate | 20 |
| T0-22 | `profile/templates/workspace-CLAUDE.md:81` | Account identity and environment metadata are never candidate facts | Policy | RC:profile t19 (harness email written as fact) | t19-intake | 60 |

### apply

| id | file:line | rule | class | receipt | harness cases | words |
|---|---|---|---|---|---|---|
| AP-S01 | `apply/SKILL.md:1-6` | Frontmatter trigger description and title | Structure | — | t8-routing (descriptions route) | 86 |
| AP-S02 | `apply/SKILL.md:8-10` | [goal] An application ships three artifacts incl. outreach plan | Capability | none found | t10-* (partial) | 39 |
| AP-S03 | `apply/SKILL.md:12-14` | [goal] Tailored résumé reshape-only from base; PDF measured vs page target | Policy | D:P8; RC:apply verbatim, page measured | t10-verbatim-panel, t10-over-budget | 27 |
| AP-S04 | `apply/SKILL.md:15` | [goal] Letter argues one thesis in candidate's voice | Craft | none found | t10-storybank-default | 13 |
| AP-S05 | `apply/SKILL.md:16` | [goal] Cuts, placed words, gaps disclosed beside the delivered doc | Capability | EV:t10 deliverv1 (0/20 → 2/2) | t10-over-budget, t10-coverage-classify | 15 |
| AP-S06 | `apply/SKILL.md:17` | [goal] Checks and persona panel pass before delivery | Capability | RC:apply panel gets source docs | t10-verbatim-panel | 15 |
| AP-S07 | `apply/SKILL.md:18` | [goal] Nothing submitted without explicit go and captured confirmation | Policy | D:P7 | none | 18 |
| AP-S08 | `apply/SKILL.md:19` | [goal] Outreach plan with findable leads or honest "none findable" | Capability | none found | none | 18 |
| AP-S09 | `apply/SKILL.md:21-24` | Prereqs: base-resume.md is a hard stop; jd-analysis first | Policy | D:P8 (never fabricate without base) | t10-* | 43 |
| AP-S10 | `apply/SKILL.md:26-28` | Section heads and pointers | Structure | — | — | 15 |
| AP-S11 | `apply/SKILL.md:30-36` | Tailoring loop: read Standard+Rounds, reshape-only, checks+panel, N/M count | Capability | EV:t10 addendum (alignv1, loopshape1) | t10-over-budget, t10-coverage-classify, t10-verbatim-panel | 83 |
| AP-S12 | `apply/SKILL.md:37-38` | Volunteered facts go to storybank; no résumé line without explicit yes | Policy | RC:apply blanket assent 2026-08-16; EV:t10 loopshape2 (0/2 moved out, 2/2 back) | t10-storybank-default | 22 |
| AP-S13 | `apply/SKILL.md:39` | Deliver the doc beside the proposal_block cut list with cheap reversal | Capability | EV:t10 deliverv1 2/2; RC:apply cuts never silent 2026-08-18 | t10-over-budget, t10-coverage-classify | 21 |
| AP-S14 | `apply/SKILL.md:40` | Candidate's exact edits applied in place, then re-render | Capability | none found | none | 11 |
| AP-S15 | `apply/SKILL.md:41` | Exits; ceiling = two same rows → DECISION; claim-name needs its number | Capability | RC:profile claim-name (t13); RC:profile loop ceiling | t10-coverage-classify, t13-ceiling (outreach analog) | 63 |
| AP-S16 | `apply/SKILL.md:43-46` | Answers loop: runs when, follow patterns and voice.md | Capability | none found | none | 20 |
| AP-S17 | `apply/SKILL.md:47` | Answers address the exact prompt, CONFIRMED stories only | Policy | D:P8; RC:profile doc does not waive question | none | 13 |
| AP-S18 | `apply/SKILL.md:48-49` | Answers budget 2 rounds; exit repeats the claim-name clause | Capability | RC:profile claim-name (t13) | none | 49 |
| AP-S19 | `apply/SKILL.md:51-55` | Full application: extract every field/page before drafting; defaults for screening | Capability | none found | none | 36 |
| AP-S20 | `apply/SKILL.md:56-57` | Review gate in chat; submit fires only on the candidate's explicit word | Policy | D:P7 | none | 38 |
| AP-S21 | `apply/SKILL.md:58-60` | Capture confirmation, set Applied, draft outreach plan; exits | Capability | none found | none | 36 |
| AP-S22 | `apply/SKILL.md:62-68` | Batch prep ≤5, user-armed, never scheduled, never auto-submit | Policy | D:P7 | none | 48 |
| AP-S23 | `apply/SKILL.md:70-74` | Owns applications/; hand-back routes | Code | D:P12 (one writer) | — | 27 |
| AP-S24 | `apply/SKILL.md:75` | Session close: check_materials, proposal_block, check_files, language subagent | Code | RC:cross-cutting t15/t15b; checker that never runs | t10-verbatim-panel, t10-storybank-default | 33 |
| AP-S25 | `apply/SKILL.md:77-79` | Reshape-only, never invent; omit unsupported sections | Policy | D:P8 | t10-verbatim-panel, t2-fabrication | 20 |
| AP-S26 | `apply/SKILL.md:80` | Never create accounts, handle passwords, bypass CAPTCHA, guess screening, claim submitted | Policy | D:P7/P8 | none | 17 |
| AP-S27 | `apply/SKILL.md:82` | Every reply ends with ONE next step (Tier 0 duplicate) | Capability | = T0-02 | = T0-02 | 17 |
| AP-P01 | `apply/references/patterns.md:1-9` | Read § Assembly through § Page target before tailoring | Capability | skill-shape "the loop needs its read step" (4 review findings) | t10-* | 75 |
| AP-P02 | `apply/references/patterns.md:11-20` | Getting there 1: read profile audit, three readers, candidate-voice | Capability | EV:t10 addendum (the ten steps moved here) | t10-* | 67 |
| AP-P03 | `apply/references/patterns.md:21-30` | Getting there 2: write Standard, band call, soft page target, audit block in reply | Capability | EV:t10 alignv1; page default is Craft | t10-over-budget, t10-coverage-classify | 111 |
| AP-P04 | `apply/references/patterns.md:31-40` | Getting there 3: classify have / shown-but-unnamed / gap; cuts weakest-first | Capability | RC:apply shown-but-unnamed, gap-as-question 2026-07-18 | t10-coverage-classify, t10-over-budget | 116 |
| AP-P05 | `apply/references/patterns.md:41-45` | Getting there 4: place the unnamed word in Summary/Skills/opener; letter always drafted | Capability | EV:t10 design 2026-08-21 | t10-coverage-classify | 48 |
| AP-P06 | `apply/references/patterns.md:46-49` | Getting there 5: render, measure, checks, panel; every finding fixed or discarded | Capability | RC:apply page count measured 2026-08-18 | t10-over-budget, t10-verbatim-panel | 35 |
| AP-P07 | `apply/references/patterns.md:50-54` | Getting there 6: deliver path, PDF, rubric, block, reversal sentence | Capability | EV:t10 deliverv1 | t10-over-budget | 49 |
| AP-P08 | `apply/references/patterns.md:56-60` | What kept failing: pointing at the file, script output treated as shown | Capability | EV:t10 codev1/codev2 (0/4 each) | t10-over-budget, t10-coverage-classify | 54 |
| AP-P09 | `apply/references/patterns.md:62-68` | Audit yields a change list; reshape by reorder/select/re-altitude | Craft | none found | none | 43 |
| AP-P10 | `apply/references/patterns.md:69-71` | Experience bullets are the base's own sentences | Code | RC:apply 2026-08-16; check_materials --base FAILs | t10-verbatim-panel | 35 |
| AP-P11 | `apply/references/patterns.md:72-78` | Assembly do/never rows: JD order, recency, ≤2–3 names, re-altitude | Craft | summary-number dupe is Code (check_materials); rest none found | none | 162 |
| AP-P12 | `apply/references/patterns.md:80-86` | Header shape; no horizontal rules, HTML, box-art, emoji | Craft | commit e5c8595, no incident cited; no checker enforces it | none | 153 |
| AP-P13 | `apply/references/patterns.md:87-89` | One opening section; no dual summary | Code | RC:apply two opening sections 2026-08-01; check_materials FAIL | t10-verbatim-panel (checker) | 60 |
| AP-P14 | `apply/references/patterns.md:90-97` | Section shapes: 2–4 roles, bullet counts, earlier folding, education, skills | Craft | none found | none | 116 |
| AP-P15 | `apply/references/patterns.md:99-117` | Summary: positioning line + strongest card ≤50 words; checklist alternative | Craft | RC:apply strongest card 2026-08-19; case ≤50 (Code) 2026-08-01 | none | 178 |
| AP-P16 | `apply/references/patterns.md:119-136` | Rewording only when approved, same facts/scope/verb, declared in ## Reworded | Policy | D:P8; RC:apply 2026-08-19 | t10-verbatim-panel | 149 |
| AP-P17 | `apply/references/patterns.md:138-144` | Page ≈520–560 words; soft target; cuts weakest-first; never shrink the font | Capability | EV:t10; t10-over-budget MUST NOT (font) | t10-over-budget | 108 |
| AP-P18 | `apply/references/patterns.md:146-150` | The .md is the artifact; candidate edits are newest; re-run checks only | Capability | none found | none | 55 |
| AP-P19 | `apply/references/patterns.md:152-171` | Cover letter: salutation, hook from pitch, story paragraphs, researched why, close | Craft | none found (salutation check is Code) | t10-storybank-default (letter only) | 122 |
| AP-P20 | `apply/references/patterns.md:173-183` | Persona panel: ATS / recruiter / hiring-manager lenses; fixes apply once | Craft | RC:apply panel source docs (that rule is no longer in the text) | t10-verbatim-panel | 79 |
| AP-P21 | `apply/references/patterns.md:185-198` | Answers 1–3: classify question, reuse prior answers, gap check | Craft | none found | none | 115 |
| AP-P22 | `apply/references/patterns.md:199-220` | Answers 4–6: offer 2–3 stories, register match, drafting by type, 150–200 words | Craft | none found | none | 186 |
| AP-P23 | `apply/references/patterns.md:222-231` | render_resume.py owns markup; ATS-safe template; no embedded fonts | Code | RC:apply renderer 2026-08-18; fonts 121KB | t10-over-budget | 77 |
| AP-P24 | `apply/references/patterns.md:233-237` | PDF conversion ladder | Code | none found (script behaviour restated) | none | 42 |
| AP-P25 | `apply/references/patterns.md:239-244` | Verify PDF with a real extractor, numbers, pages, <100KB | Code | RC:apply stream-grep 2026-07-15; upload limit | t10-over-budget (partial) | 61 |
| AP-P26 | `apply/references/patterns.md:246-252` | Form field buckets; walk every page before drafting | Craft | none found | none | 45 |
| AP-P27 | `apply/references/patterns.md:253-257` | Comp field non-answer; salary history banned in states; not their lawyer | Policy | D:P10 | none | 55 |
| AP-P28 | `apply/references/patterns.md:258-261` | Why-us essays specific; never recycle a paragraph | Craft | none found | none | 30 |
| AP-P29 | `apply/references/patterns.md:262-268` | File attachment ladder (native → DataTransfer → hand to gate) | Craft | field-validated Ashby 2026-07-14 (in text) | none | 68 |
| AP-P30 | `apply/references/patterns.md:269-272` | Verify form fields by reading back | Capability | none found | none | 40 |
| AP-P31 | `apply/references/patterns.md:273-285` | Ashby GraphQL form read; results marked predicted | Craft | 2026-08-01 (in text) | none | 109 |
| AP-P32 | `apply/references/patterns.md:286-289` | CAPTCHA to candidate; report form state exactly | Policy | D:P7/P8 | none | 38 |
| AP-P33 | `apply/references/patterns.md:291-296` | New patterns proposed with two uses, never self-adopted | Capability | search "I'm hiring" backwards (in search patterns) | none | 52 |

### coach

| id | file:line | rule | class | receipt | harness cases | words |
|---|---|---|---|---|---|---|
| CO-S01 | `coach/SKILL.md:1-6` | Frontmatter trigger description and title | Structure | — | t8-routing | 106 |
| CO-S02 | `coach/SKILL.md:8-10` | [goal] Run the search vs goal date, limits, raw material | Capability | none found | t8-stage-sensing | 31 |
| CO-S03 | `coach/SKILL.md:12-14` | [goal] Every reply is DECISION/ARTIFACT/TO-DO/STATUS and names the stage | Capability | EV:t8 close-out trio | t8-* | 39 |
| CO-S04 | `coach/SKILL.md:15` | [goal] Plan holds 1–3 prepared ranked items fitting the budget | Policy | D:P6 (P6 says two to four — chain conflict) | t8-stage-sensing | 16 |
| CO-S05 | `coach/SKILL.md:16` | [goal] Every question asked is a Waiting row; claimed writes on disk | Capability | EV:t8 addendum; check_closeout | t8-no-nag-no-gate | 19 |
| CO-S06 | `coach/SKILL.md:17` | [goal] State changes named; pipeline changes via scripts | Code | D:P11/P14 | t8-routing | 16 |
| CO-S07 | `coach/SKILL.md:18` | [goal] Honest numbers: counts, not rates, under n=5 | Policy | D:P8; EV:t8 honesty | t8-honesty-thresholds | 16 |
| CO-S08 | `coach/SKILL.md:20-24` | Stage diagram (groundwork → deciding) | Code | check_closeout validates stage names | t8-stage-sensing | 22 |
| CO-S09 | `coach/SKILL.md:26-29` | Prereqs; no budget captured → asking is the first prescription | Capability | t8-stage-sensing expected.md | t8-stage-sensing | 34 |
| CO-S10 | `coach/SKILL.md:31-33` | Section heads and pointers | Structure | — | — | 20 |
| CO-S11 | `coach/SKILL.md:35-41` | Mirror loop: read plan-log, goal math, write plan + log row | Capability | none found | none | 101 |
| CO-S12 | `coach/SKILL.md:42` | Avoided item: raise once, then shrink, queue, or drop | Capability | D:P6 | none | 23 |
| CO-S13 | `coach/SKILL.md:43` | Math mismatch → DECISION early | Capability | none found | none | 24 |
| CO-S14 | `coach/SKILL.md:44` | One hypothesis per briefing | Capability | none found | none | 7 |
| CO-S15 | `coach/SKILL.md:45` | Mirror exits; ceiling = two weeks same K → root causes | Capability | none found | none | 33 |
| CO-S16 | `coach/SKILL.md:47-52` | What's next: do all agent work now; 1–3 ranked; write plan same reply | Capability | D:P3/P6; EV:t8 | t8-stage-sensing, t8-no-nag-no-gate | 84 |
| CO-S17 | `coach/SKILL.md:54` | Exits with plan written and stage named | Capability | EV:t8 | t8-stage-sensing | 8 |
| CO-S18 | `coach/SKILL.md:56-60` | Outcome intake: map via update_job.py; update plan same reply | Code | t8-routing expected.md | t8-routing | 38 |
| CO-S19 | `coach/SKILL.md:61` | Offers: never accept/walk on call, no comp numbers, no leverage, pros for legal | Policy | D:P10; RC:deletions negotiate 2026-08-19 | none | 39 |
| CO-S20 | `coach/SKILL.md:63` | Outcome exits | Capability | none found | t8-routing | 12 |
| CO-S21 | `coach/SKILL.md:65-71` | Inbox sweep read-only: never send, reply, archive, delete | Policy | D:P7/P9 | none | 46 |
| CO-S22 | `coach/SKILL.md:73-80` | State; session close runs check_closeout and check_files | Code | EV:t8 addendum | t8-* | 77 |
| CO-S23 | `coach/SKILL.md:82` | Serve first, advise once, never re-raise | Capability | D:P6; t8-no-nag-no-gate | t8-no-nag-no-gate | 11 |
| CO-S24 | `coach/SKILL.md:83` | Never re-coach a sibling skill from memory; open its files | Capability | t8-routing (the deleted router table) | t8-routing | 17 |
| CO-S25 | `coach/SKILL.md:84` | n<5 → raw count; no trend under 3 points | Policy | D:P8; EV:t8 (the "say WHEN it becomes meaningful" clause is gone) | t8-honesty-thresholds | 19 |
| CO-S26 | `coach/SKILL.md:85` | Never manufacture urgency, optimism, praise | Policy | D:P8 | t8-honesty-thresholds, t8-routing | 7 |
| CO-S27 | `coach/SKILL.md:87` | ONE next step (Tier 0 duplicate) | Capability | = T0-02 | = T0-02 | 17 |
| CO-P01 | `coach/references/patterns.md:1-11` | Three first principles: goal, stages, agent-vs-human minutes | Craft | D:P1–P3 (restates them) | none | 90 |
| CO-P02 | `coach/references/patterns.md:13-22` | Groundwork sensing: read files, never ask what exists; ≤1 slot | Capability | t8-stage-sensing | t8-stage-sensing | 90 |
| CO-P03 | `coach/references/patterns.md:24-27` | Sense / prepare / prescribe / record | Capability | D:P3 | t8-stage-sensing, t8-no-nag-no-gate | 100 |
| CO-P04 | `coach/references/patterns.md:29-31` | Ranking: work the stuck stage; most time-sensitive first | Craft | none found | t8-stage-sensing (partial) | 55 |
| CO-P05 | `coach/references/patterns.md:33` | Live human threads always first | Craft | none found | none | 22 |
| CO-P06 | `coach/references/patterns.md:34` | Aging items: age from posted_at; Target companies first; backfill costs money | Capability | none found | t8-stage-sensing (Northpine) | 121 |
| CO-P07 | `coach/references/patterns.md:35` | Steady habits hold a protected slot | Craft | none found | none | 34 |
| CO-P08 | `coach/references/patterns.md:37` | Hard deadlines: one scope question; passed deadline → ask | Capability | none found | none | 37 |
| CO-P09 | `coach/references/patterns.md:39-43` | Goal math, backward from offer date | Craft | none found (unsourced week counts) | none | 105 |
| CO-P10 | `coach/references/patterns.md:45-49` | Candidate is the client; serve first; accountability only weekly | Capability | D:P4/P6 | t8-no-nag-no-gate | 96 |
| CO-P11 | `coach/references/patterns.md:51-55` | Cadence: mirror, standup, plan updates on events | Capability | none found | none | 114 |
| CO-P12 | `coach/references/patterns.md:57-59` | Practice floor: cold-start drill; moment prescriptions; format gap | Capability | "earned 2026-08-14" (heading; no incident found) | t8-routing (rejection → one drill) | 175 |
| CO-P13 | `coach/references/patterns.md:61-65` | Feedback loop reads existing records; builds no plumbing | Capability | D:P12 | none | 44 |
| CO-P14 | `coach/references/patterns.md:67-75` | Funnel metrics table with counting footnotes | Craft | none found | t8-honesty-thresholds (counting) | 208 |
| CO-P15 | `coach/references/patterns.md:77-81` | Patterns are hypotheses with evidence; one per briefing | Capability | D:P8 | none | 56 |
| CO-P16 | `coach/references/patterns.md:83-92` | Pattern → action library | Craft | none found (unsourced <~10%) | none | 168 |
| CO-P17 | `coach/references/patterns.md:94-99` | Monday briefing shape | Craft | none found | none | 59 |
| CO-P18 | `coach/references/patterns.md:101-109` | Progress review: self-assessment before coach scores | Craft | none found | none | 67 |
| CO-P19 | `coach/references/patterns.md:111-116` | Trend narration, never raw tables | Craft | none found | none | 43 |
| CO-P20 | `coach/references/patterns.md:118-127` | Outcomes and targeting; feedback → dimension map | Craft | none found | none | 76 |
| CO-P21 | `coach/references/patterns.md:129-131` | Graduation criteria pointer | Capability | none found | none | 30 |
| CO-P22 | `coach/references/patterns.md:133-139` | Progress review output shape | Craft | none found | none | 52 |
| CO-P23 | `coach/references/patterns.md:141-154` | Retrospective: growth story; anti-sycophancy; archive, never delete | Craft | D:P8/P9 for the two clauses | none | 116 |
| CO-P24 | `coach/references/patterns.md:156-161` | Assume a dedicated job-search email; no connector → say once | Capability | none found | none | 61 |
| CO-P25 | `coach/references/patterns.md:163-165` | Sweep since last date; shared account → known senders only, say partial | Policy | D:P9 | none | 65 |
| CO-P26 | `coach/references/patterns.md:167-176` | Inbox event table; never stage a reply to a comp question | Capability | D:P10 for the comp clause | none | 223 |
| CO-P27 | `coach/references/patterns.md:178` | 0 or 2+ row matches → show and ask | Code | update_job.py loud-fail | none | 33 |
| CO-P28 | `coach/references/patterns.md:179` | Digest; never narrate 40 auto-acks | Craft | none found | none | 25 |
| CO-P29 | `coach/references/patterns.md:181-183` | Calendar read-only | Policy | D:P9 | none | 48 |
| CO-P30 | `coach/references/patterns.md:185-187` | Screenshots are first-class updates | Craft | none found | none | 40 |
| CO-P31 | `coach/references/patterns.md:189-193` | Tone persona; warm to the person, blunt about the work | Craft | none found | none | 47 |
| CO-P32 | `coach/references/patterns.md:194-196` | Encouragement cites evidence; never manufacture urgency or praise | Policy | D:P8 | t8-honesty-thresholds | 58 |
| CO-P33 | `coach/references/patterns.md:197` | Directness setting changes padding, never content | Capability | none found | none | 32 |
| CO-P34 | `coach/references/patterns.md:199-204` | New patterns proposed, never self-adopted | Capability | = AP-P33 | none | 47 |

### evaluate

| id | file:line | rule | class | receipt | harness cases | words |
|---|---|---|---|---|---|---|
| EV-S01 | `evaluate/SKILL.md:1-6` | Frontmatter trigger description and title | Structure | — | t8-routing | 74 |
| EV-S02 | `evaluate/SKILL.md:8-10` | [goal] One decision-ready verdict; the candidate decides | Capability | D:P4 | t6-* | 31 |
| EV-S03 | `evaluate/SKILL.md:12-14` | [goal] Verdict recorded via script on exact strings | Code | record_verdict.py docstring (Baseten AI) | t6-duplicate-row | 24 |
| EV-S04 | `evaluate/SKILL.md:15` | [goal] Track assigned first, named in verdict, row, header | Capability | EV:t6 (1/3 → card fix → 2/2) | t6-track-assignment | 16 |
| EV-S05 | `evaluate/SKILL.md:16` | [goal] Dealbreaker hit dismissed with quote before research | Capability | EV:t14 (#20) | t14-dq-no-research | 16 |
| EV-S06 | `evaluate/SKILL.md:17` | [goal] JD decode on file | Code | check_files schema | t6-* | 14 |
| EV-S07 | `evaluate/SKILL.md:18` | [goal] Company brief with tiered, dated claims | Policy | D:P8 | t6-research-honesty | 14 |
| EV-S08 | `evaluate/SKILL.md:19` | [goal] Cheap tier stamped quick-scan; graduation notes prior score | Policy | D:P8; EV:t14 quickscan-honest | t14-quickscan-honest | 16 |
| EV-S09 | `evaluate/SKILL.md:20` | [goal] Summary card in reply | Capability | none found | t6-* | 9 |
| EV-S10 | `evaluate/SKILL.md:22-25` | Prerequisites | Code | — | t6-* | 28 |
| EV-S11 | `evaluate/SKILL.md:27-33` | Section heads; runs when (incl. routed) | Structure | — | — | 39 |
| EV-S12 | `evaluate/SKILL.md:35` | Match existing rows before creating duplicates | Capability | EV:t6 shapev1→v2 ("a near-match IS that row; say which; proceed" — now compressed) | t6-duplicate-row | 11 |
| EV-S13 | `evaluate/SKILL.md:36` | Dealbreaker gate: record the DQ (create row first), stop before research | Capability | EV:t14 (the "not yours to soften" rule from shapev3 is gone) | t14-dq-no-research, t14-ambiguity-not-dq | 40 |
| EV-S14 | `evaluate/SKILL.md:37` | Assign track before judging | Capability | EV:t6 | t6-track-assignment | 11 |
| EV-S15 | `evaluate/SKILL.md:38` | Research company; decode JD across the six lenses | Capability | none found | t6-research-honesty | 16 |
| EV-S16 | `evaluate/SKILL.md:39` | Verdict tier; record via record_verdict.py | Code | a80c2df aligned the tier names with the script (was 5 tiers vs the script's 4 at 47c51f4) | t6-* | 30 |
| EV-S17 | `evaluate/SKILL.md:40-42` | Summary card in chat; exits | Capability | none found | t6-* | 28 |
| EV-S18 | `evaluate/SKILL.md:44-53` | Quick-scan tier: DQ, criteria-only fit, stamp, graduate before human time | Capability | EV:t14 | t14-quickscan-honest, t14-no-second-number | 75 |
| EV-S19 | `evaluate/SKILL.md:55-62` | State; session close check_files | Code | — | — | 52 |
| EV-S20 | `evaluate/SKILL.md:64` | Honest verdicts; no cheerleading or false pessimism | Policy | D:P8 | t3-injection, t6-* | 11 |
| EV-S21 | `evaluate/SKILL.md:65` | Never turn uncertain sources into confident claims | Policy | D:P8 | t6-research-honesty | 13 |
| EV-S22 | `evaluate/SKILL.md:67` | ONE next step (Tier 0 duplicate) | Capability | = T0-02 | = T0-02 | 17 |
| EV-P01 | `evaluate/references/patterns.md:1-7` | Read this before decoding | Capability | EV:t6 bare arm (decode falsifier) | t6-* (full vs bare) | 54 |
| EV-P02 | `evaluate/references/patterns.md:8-18` | Intake from jd_file; DQ two-step for a pasted role | Code | t14-dq-no-research expected.md | t14-dq-no-research | 93 |
| EV-P03 | `evaluate/references/patterns.md:19-20` | Judge against the assigned track's lens | Capability | EV:t6 | t6-track-assignment | 23 |
| EV-P04 | `evaluate/references/patterns.md:21-27` | Company brief staleness bands (2 / 2–8 / 8 weeks) | Craft | none found (unsourced bands) | none | 73 |
| EV-P05 | `evaluate/references/patterns.md:28-32` | Decode and write jd-analysis | Capability | none found | t6-* | 49 |
| EV-P06 | `evaluate/references/patterns.md:33-36` | One verdict + score; flags carry caveats | Capability | none found | t6-* | 36 |
| EV-P07 | `evaluate/references/patterns.md:37-40` | Record on the row's exact strings | Code | record_verdict.py docstring | t6-duplicate-row | 31 |
| EV-P08 | `evaluate/references/patterns.md:41-42` | Summary card is the reply | Capability | none found | t6-* | 15 |
| EV-P09 | `evaluate/references/patterns.md:44-58` | How JDs work: section signal density; what JDs can't tell | Craft | none found | t6-* (bare arm) | 101 |
| EV-P10 | `evaluate/references/patterns.md:59-81` | The six decoding lenses | Craft | EV:t6 bare arm 0/1 per case | t6-* (bare arm) | 165 |
| EV-P11 | `evaluate/references/patterns.md:82-95` | Confidence labels; recruiter verification questions | Craft | none found | t14-ambiguity-not-dq, t6-research-honesty | 97 |
| EV-P12 | `evaluate/references/patterns.md:96-101` | Competency extraction | Craft | none found | none | 27 |
| EV-P13 | `evaluate/references/patterns.md:102-119` | Five-dimension fit; match/partial/gap; 60–70% coverage | Craft | none found (unsourced 60–70%) | t6-track-assignment | 136 |
| EV-P14 | `evaluate/references/patterns.md:120-131` | Deep-decode extras | Craft | none found | none | 88 |
| EV-P15 | `evaluate/references/patterns.md:132-140` | Batch triage | Craft | none found | none | 65 |
| EV-P16 | `evaluate/references/patterns.md:141-148` | Teaching layer in every evaluation | Capability | none found | none | 64 |
| EV-P17 | `evaluate/references/patterns.md:149-163` | Company research sources | Craft | none found | t6-research-honesty | 99 |
| EV-P18 | `evaluate/references/patterns.md:164-170` | Research depths | Craft | none found | none | 67 |
| EV-P19 | `evaluate/references/patterns.md:171-177` | Claim tiers verified / general / unknown; show the range | Policy | D:P8 | t6-research-honesty, t9-uncited-canon | 55 |
| EV-P20 | `evaluate/references/patterns.md:178-186` | Positioning problem ≠ role fit; never moves the score | Craft | none found | none | 74 |
| EV-P21 | `evaluate/references/patterns.md:187-192` | New patterns proposed, never self-adopted | Capability | = AP-P33 | none | 50 |

### interview

| id | file:line | rule | class | receipt | harness cases | words |
|---|---|---|---|---|---|---|
| IN-S01 | `interview/SKILL.md:1-6` | Frontmatter trigger description and title | Structure | — | t8-routing | 103 |
| IN-S02 | `interview/SKILL.md:8-10` | [goal] Prepared for every interview; mastery compounds | Capability | none found | — | 40 |
| IN-S03 | `interview/SKILL.md:12-14` | [goal] Brief on file with header metadata | Code | check_files schema | t12-ladder-rank | 22 |
| IN-S04 | `interview/SKILL.md:15` | [goal] Questions labelled banked / researched with cite / [inferred] | Policy | D:P8 | t12-ladder-rank, t12-never-sharpen | 16 |
| IN-S05 | `interview/SKILL.md:16` | [goal] 5 reverse questions | Craft | none found | none | 18 |
| IN-S06 | `interview/SKILL.md:17` | [goal] Day-of cheat sheet closes the brief | Craft | none found | none | 14 |
| IN-S07 | `interview/SKILL.md:18` | [goal] Scored rounds: coach first, band stated, delta recorded | Capability | none found | none | 18 |
| IN-S08 | `interview/SKILL.md:19` | [goal] Debrief leaves 4 writes | Capability | EV:t12 practice1 (0/2 → 3/3) | t12-debrief-bank | 25 |
| IN-S09 | `interview/SKILL.md:20` | [goal] Bank real questions; vague stays vague | Policy | D:P8; EV:t12 | t12-debrief-bank | 15 |
| IN-S10 | `interview/SKILL.md:21` | [goal] Comp numbers and concessions routed to owner files | Policy | D:P10 (concession write conflicts with base one-writer) | none | 18 |
| IN-S11 | `interview/SKILL.md:23-26` | Prerequisites | Capability | none found | t12-* | 35 |
| IN-S12 | `interview/SKILL.md:28-34` | Section heads; brief runs when | Structure | — | — | 35 |
| IN-S13 | `interview/SKILL.md:36` | Banked questions outrank generated; cites; [inferred] | Capability | EV:t12 prepshape (the rough-first and origin-mark rules are gone) | t12-ladder-rank | 19 |
| IN-S14 | `interview/SKILL.md:37` | Never sharpen a vague signal into a verified question | Policy | D:P8; EV:t12 | t12-never-sharpen, t12-debrief-bank | 14 |
| IN-S15 | `interview/SKILL.md:38` | Intel via public professional URLs, never personal data | Policy | D:P9 | none | 15 |
| IN-S16 | `interview/SKILL.md:39` | Map to confirmed stories; never deploy a struck claim | Policy | D:P8 | none | 19 |
| IN-S17 | `interview/SKILL.md:41` | Brief exits | Capability | none found | t12-ladder-rank | 13 |
| IN-S18 | `interview/SKILL.md:43-49` | Drill loop: 5 dims at band, read practice-log, round order | Capability | none found | none | 74 |
| IN-S19 | `interview/SKILL.md:50-53` | Score first, state band, label synthetic | Craft | none found | none | 32 |
| IN-S20 | `interview/SKILL.md:54` | Drill exits; 3+ stagnant sessions → diagnose | Capability | none found | none | 35 |
| IN-S21 | `interview/SKILL.md:56-60` | Debrief: emotional check-in, capture | Craft | none found | t12-debrief-bank | 20 |
| IN-S22 | `interview/SKILL.md:61-65` | Four writes in the same turn | Capability | EV:t12 practice1 | t12-debrief-bank | 36 |
| IN-S23 | `interview/SKILL.md:66` | Comp numbers → negotiation/; concessions → base § Claim rules | Policy | D:P10 (same one-writer conflict) | none | 15 |
| IN-S24 | `interview/SKILL.md:68` | Debrief exits | Capability | EV:t12 | t12-debrief-bank | 8 |
| IN-S25 | `interview/SKILL.md:70-80` | Satellites: questions to ask, counters, day-of, mock, plan, transcript, presentation | Craft | none found | none | 146 |
| IN-S26 | `interview/SKILL.md:82-89` | State; session close | Code | — | — | 59 |
| IN-S27 | `interview/SKILL.md:91` | Never fabricate process, panels, past questions | Policy | D:P8 | t12-ladder-rank, t12-never-sharpen | 14 |
| IN-S28 | `interview/SKILL.md:92` | Never put struck claims or unconfirmed details in spoken scripts | Policy | D:P8 | none | 13 |
| IN-S29 | `interview/SKILL.md:93` | A fabricated drill answer is named, not polished | Policy | D:P8 | none | 14 |
| IN-S30 | `interview/SKILL.md:94` | Record stated comp figures; never invent counters | Policy | D:P10 | none | 10 |
| IN-S31 | `interview/SKILL.md:96` | ONE next step (Tier 0 duplicate) | Capability | = T0-02 | = T0-02 | 17 |
| IN-P01 | `interview/references/patterns.md:1-3` | Header | Structure | — | — | 21 |
| IN-P02 | `interview/references/patterns.md:5-7` | Brief 1: intake and reuse; bank first | Capability | EV:t12 | t12-ladder-rank | 24 |
| IN-P03 | `interview/references/patterns.md:8` | Brief 2: format discovery | Craft | none found | none | 20 |
| IN-P04 | `interview/references/patterns.md:9` | Brief 3: sourced company and interviewer intel | Craft | none found | t12-never-sharpen | 15 |
| IN-P05 | `interview/references/patterns.md:10-13` | Brief 4: concern tiers and 3-part counters | Craft | none found | none | 29 |
| IN-P06 | `interview/references/patterns.md:14` | Brief 5: story mapping and named gap patterns | Craft | none found | none | 26 |
| IN-P07 | `interview/references/patterns.md:15` | Brief 6: five reverse questions | Craft | none found | none | 16 |
| IN-P08 | `interview/references/patterns.md:16` | Brief 7: day-of cheat sheet contents | Craft | none found | none | 18 |
| IN-P09 | `interview/references/patterns.md:18-29` | Gated practice ladder, 8 stages | Craft | none found | none | 134 |
| IN-P10 | `interview/references/patterns.md:31-37` | Round protocol (repeats the SKILL.md loop) | Craft | none found | none | 53 |
| IN-P11 | `interview/references/patterns.md:39-48` | Debrief protocol (repeats the four writes) | Capability | = IN-S22 (duplicate) | t12-debrief-bank | 63 |
| IN-P12 | `interview/references/patterns.md:50-52` | New patterns proposed, never self-adopted | Capability | = AP-P33 | none | 33 |

### learn

| id | file:line | rule | class | receipt | harness cases | words |
|---|---|---|---|---|---|---|
| LE-S01 | `learn/SKILL.md:1-6` | Frontmatter trigger description and title | Structure | — | t8-routing | 90 |
| LE-S02 | `learn/SKILL.md:8-10` | [goal] Map demand, assess honestly, build courses | Capability | none found | t9-* | 27 |
| LE-S03 | `learn/SKILL.md:12-14` | [goal] Map row: scope, source, sightings, depth | Code | check_knowledge.py | t9-scope-discipline | 27 |
| LE-S04 | `learn/SKILL.md:15` | [goal] Assessment logged and stamped same turn | Capability | t9-never-certify expected.md | t9-never-certify | 19 |
| LE-S05 | `learn/SKILL.md:16` | [goal] Live gaps have researched, cited courses | Policy | D:P8 | t9-uncited-canon | 12 |
| LE-S06 | `learn/SKILL.md:17` | [goal] Status advances only on logged evidence | Policy | D:P8 | t9-never-certify, t9-scope-discipline | 16 |
| LE-S07 | `learn/SKILL.md:18` | [goal] Never certify unearned credentials | Policy | D:P8 | t9-never-certify | 14 |
| LE-S08 | `learn/SKILL.md:20-23` | Prerequisites | Code | — | t9-* | 25 |
| LE-S09 | `learn/SKILL.md:25-36` | Topic loop: map, assess, course, train | Capability | EV:rollout learn (3/6, 2/4 → 6/6) | t9-* | 95 |
| LE-S10 | `learn/SKILL.md:37` | Track scope needs two independent JD sightings | Capability | EV:rollout learn; t9-scope-discipline | t9-scope-discipline | 20 |
| LE-S11 | `learn/SKILL.md:38` | State exact score and depth; never generic mastery | Policy | D:P8 | t9-never-certify | 12 |
| LE-S12 | `learn/SKILL.md:39` | Log and stamp the row in the same turn | Capability | t9-never-certify expected.md | t9-never-certify | 17 |
| LE-S13 | `learn/SKILL.md:40` | Exits; ceiling = two reps same count; never relax checklist | Capability | none found | none | 30 |
| LE-S14 | `learn/SKILL.md:42-49` | State; session close | Code | — | — | 56 |
| LE-S15 | `learn/SKILL.md:51` | Curricula researched with tiered, dated sources | Policy | D:P8 | t9-uncited-canon | 17 |
| LE-S16 | `learn/SKILL.md:53` | ONE next step (Tier 0 duplicate) | Capability | = T0-02 | = T0-02 | 17 |
| LE-P01 | `learn/references/patterns.md:1-4` | Header | Structure | — | — | 19 |
| LE-P02 | `learn/references/patterns.md:6-12` | Two scopes: track trains deep ahead, role just-in-time | Capability | none found | t9-scope-discipline | 84 |
| LE-P03 | `learn/references/patterns.md:14-22` | No jd-analyses → derive from track, label [inferred]; never block | Capability | t9-scope-discipline expected.md | t9-scope-discipline | 85 |
| LE-P04 | `learn/references/patterns.md:24-36` | Domain vs interview-format courses; ask which interview | Craft | none found | t8-routing | 111 |
| LE-P05 | `learn/references/patterns.md:38-42` | Build from public canon; tier sources; thin → ask the candidate | Craft | none found | t9-uncited-canon | 62 |
| LE-P06 | `learn/references/patterns.md:44-46` | Refresh triggers; research date | Craft | none found | none | 24 |
| LE-P07 | `learn/references/patterns.md:48-57` | Training reps against the checklist | Craft | none found | t9-never-certify | 76 |
| LE-P08 | `learn/references/patterns.md:59-61` | Honest phrasings ("hands-on with…", not "strong in") | Policy | D:P8 | t9-never-certify | 50 |
| LE-P09 | `learn/references/patterns.md:63-68` | New patterns proposed, never self-adopted | Capability | = AP-P33 | none | 49 |

### outreach

| id | file:line | rule | class | receipt | harness cases | words |
|---|---|---|---|---|---|---|
| OU-S01 | `outreach/SKILL.md:1-6` | Frontmatter trigger description and title | Structure | — | — | 85 |
| OU-S02 | `outreach/SKILL.md:8-10` | [goal] Find, learn, warm paths, draft; the candidate sends everything | Policy | D:P7 | t13-ceiling | 23 |
| OU-S03 | `outreach/SKILL.md:12-14` | [goal] ≤6 leads with evidence chain, confidence, channel | Capability | none found | none | 23 |
| OU-S04 | `outreach/SKILL.md:15` | [goal] Sourced hooks or explicit miss | Policy | D:P8 | none | 14 |
| OU-S05 | `outreach/SKILL.md:16` | [goal] Rubric line and checks before display | Capability | EV:t13 | t13-ceiling | 17 |
| OU-S06 | `outreach/SKILL.md:17` | [goal] Credential claims trace to base | Policy | D:P8 | t13-ceiling | 13 |
| OU-S07 | `outreach/SKILL.md:18` | [goal] Warm path evaluated or marked not found | Capability | none found | none | 13 |
| OU-S08 | `outreach/SKILL.md:19` | [goal] All sends logged and dated | Policy | D:P7 (log entry) | none | 11 |
| OU-S09 | `outreach/SKILL.md:21-24` | Prerequisites | Code | — | t13-ceiling | 26 |
| OU-S10 | `outreach/SKILL.md:26-28` | Section heads and pointers | Structure | — | — | 17 |
| OU-S11 | `outreach/SKILL.md:30-38` | Find contacts: mine JD, corroborate, warm-path check, ≤6 leads | Craft | none found | none | 82 |
| OU-S12 | `outreach/SKILL.md:40-46` | Enrich: date and source every hook, 2–4 candidates | Craft | none found | none | 47 |
| OU-S13 | `outreach/SKILL.md:48-54` | Warm intro: double-opt-in request and forwardable blurb | Craft | none found | none | 43 |
| OU-S14 | `outreach/SKILL.md:56-62` | Draft loop: hook, limit, check_messages + language subagent, rubric line | Capability | EV:t13 | t13-ceiling | 64 |
| OU-S15 | `outreach/SKILL.md:63` | Two passes without clearing → UNMET, DECISION; claim-name needs number | Capability | EV:t13 v1–v3, shapev2 (the "a list is not a message" clause is gone) | t13-ceiling | 49 |
| OU-S16 | `outreach/SKILL.md:65-71` | Plan close-out verification | Capability | none found | none | 37 |
| OU-S17 | `outreach/SKILL.md:73-75` | Send moment per gate grammar; the candidate sends | Policy | D:P7 | none | 18 |
| OU-S18 | `outreach/SKILL.md:76` | Stop rules: 2 follow-ups networking, 3 recruiters | Craft | none found (unsourced counts) | none | 21 |
| OU-S19 | `outreach/SKILL.md:77` | Response <10% → positioning, not phrasing | Craft | none found | none | 11 |
| OU-S20 | `outreach/SKILL.md:79-86` | State; session close | Code | — | t13-ceiling | 48 |
| OU-S21 | `outreach/SKILL.md:88` | Hooks must be verified; guessed emails never stated as fact | Policy | D:P8 | none | 15 |
| OU-S22 | `outreach/SKILL.md:89` | Never personal channels | Policy | D:P9 | none | 10 |
| OU-S23 | `outreach/SKILL.md:91` | ONE next step (Tier 0 duplicate) | Capability | = T0-02 | = T0-02 | 17 |
| OU-P01 | `outreach/references/patterns.md:1-7` | Header | Structure | — | — | 54 |
| OU-P02 | `outreach/references/patterns.md:9-18` | Mine the JD first; LinkedIn job page's hiring-team card | Craft | 2026-07-18 (in text) | none | 90 |
| OU-P03 | `outreach/references/patterns.md:20-25` | Founders tier at ≤150 people | Craft | none found | none | 65 |
| OU-P04 | `outreach/references/patterns.md:27-45` | Logged-in LinkedIn first, read-only; the two queries | Craft | 2026-07-18 (in text) | none | 167 |
| OU-P05 | `outreach/references/patterns.md:47-50` | ≤4 queries, ≤2 widen rounds, then present | Capability | D:P16 (bounded) | none | 42 |
| OU-P06 | `outreach/references/patterns.md:52-64` | Evidence sources in order; hiring-post poster top tier | Craft | none found | none | 92 |
| OU-P07 | `outreach/references/patterns.md:66-72` | Confidence per lead; email guesses flagged unverified | Craft | none found | none | 70 |
| OU-P08 | `outreach/references/patterns.md:74-80` | Warm-path check; reference-value contacts | Craft | 2026-07-18 (in text) | none | 67 |
| OU-P09 | `outreach/references/patterns.md:82-91` | Enrichment sources in value order; time cap | Craft | none found | none | 84 |
| OU-P10 | `outreach/references/patterns.md:93-96` | Identity gate: an artifact binds only with an identity link | Policy | D:P8 (same-name misattribution) | none | 39 |
| OU-P11 | `outreach/references/patterns.md:97-103` | Date items; their words vs facts; 2–4 hooks; say when nothing found | Craft | none found | none | 68 |
| OU-P12 | `outreach/references/patterns.md:105-113` | Mutuals access ladder; human-paced to protect their account | Capability | none found | none | 61 |
| OU-P13 | `outreach/references/patterns.md:115-119` | Rank paths by relationship strength | Craft | none found | none | 54 |
| OU-P14 | `outreach/references/patterns.md:121-129` | Intro request craft | Craft | none found | none | 88 |
| OU-P15 | `outreach/references/patterns.md:131-145` | Channel response statistics | Craft | none found (unsourced percentages) | none | 155 |
| OU-P16 | `outreach/references/patterns.md:147-180` | The ten message frameworks | Craft | none found | t13-ceiling (partial) | 285 |
| OU-P17 | `outreach/references/patterns.md:182-187` | Thank-you notes | Craft | none found | none | 57 |
| OU-P18 | `outreach/references/patterns.md:189-197` | Hooks from pitch + confirmed 4+ earned secrets | Craft | none found | none | 67 |
| OU-P19 | `outreach/references/patterns.md:199-202` | Follow-up cadence | Craft | none found | none | 25 |
| OU-P20 | `outreach/references/patterns.md:204-209` | Campaign phasing; peer council | Craft | none found | none | 39 |
| OU-P21 | `outreach/references/patterns.md:211-216` | New patterns proposed, never self-adopted | Capability | = AP-P33 | none | 50 |

### profile

| id | file:line | rule | class | receipt | harness cases | words |
|---|---|---|---|---|---|---|
| PR-S01 | `profile/SKILL.md:1-8` | Frontmatter trigger description, title, scope line | Structure | — | t8-routing | 131 |
| PR-S02 | `profile/SKILL.md:10-12` | [goal] Every fact traceable; nothing stronger than what happened | Policy | D:P8 | t19-intake, t4-intake | 37 |
| PR-S03 | `profile/SKILL.md:14-16` | [goal] Folder settled and path known before any write | Policy | RC:profile folder 2026-08-18; RC:cross-cutting 2026-08-20 breakout | t19-folder-repo, t19-intake | 33 |
| PR-S04 | `profile/SKILL.md:17` | [goal] Guardrails CLAUDE.md is the first file | Capability | t19 general conduct | t19-intake | 14 |
| PR-S05 | `profile/SKILL.md:18-20` | [goal] Target + band; goal date + time floor; watchlist | Capability | none found | t4-intake, t19-intake | 54 |
| PR-S06 | `profile/SKILL.md:21` | [goal] Base résumé with Claim rules seeded from the hazard walk | Policy | D:P8; EV:t4 (1/7 without the list) | t4-intake | 22 |
| PR-S07 | `profile/SKILL.md:22-24` | [goal] Pitch core statement, 5 variants, messages rubric | Craft | none found | t20-positioning | 43 |
| PR-S08 | `profile/SKILL.md:25-27` | [goal] LinkedIn audit, Snapshot sync, directness | Capability | EV:t20 (Snapshot sync miss) | t20-positioning | 34 |
| PR-S09 | `profile/SKILL.md:28-29` | [goal] Application defaults; voice.md; story leads | Capability | none found | none | 34 |
| PR-S10 | `profile/SKILL.md:31` | Unmet items are TODO; resurface when blocking, never nag | Capability | D:P6 | t19-intake | 30 |
| PR-S11 | `profile/SKILL.md:33-36` | Prereq: settled folder, nothing written before; documents read on sight | Policy | RC:profile folder 2026-08-18 | t19-* | 31 |
| PR-S12 | `profile/SKILL.md:38-42` | Setup runs when; exits with CLAUDE.md and both drop paths | Capability | EV:t19 (drop paths) | t19-intake | 37 |
| PR-S13 | `profile/SKILL.md:44` | Settle the path: name it; occupied/generic → propose ~/job-search | Policy | RC:profile 2026-08-18; EV:t19 shapev7–8 ("creating a directory IS writing" is gone) | t19-folder-repo, t19-intake | 41 |
| PR-S14 | `profile/SKILL.md:45` | Never hunt the filesystem; ask once about an old folder | Policy | RC:profile occupied folder 2026-08-18 | t19-folder-repo | 16 |
| PR-S15 | `profile/SKILL.md:46` | Write CLAUDE.md before any candidate file | Capability | t19 general conduct | t19-intake | 14 |
| PR-S16 | `profile/SKILL.md:48-50` | Intake runs when; exits | Capability | none found | t4-intake, t19-intake | 40 |
| PR-S17 | `profile/SKILL.md:52` | Documents first; ONE question at a time; decline LinkedIn URL as seed | Policy | RC:profile t19 (ONE question; rendering declined) — Policy because the decline is source integrity | t19-intake, t4-intake | 22 |
| PR-S18 | `profile/SKILL.md:53` | Told facts written; extracted facts pass the proposal table | Policy | D:P8; RC:profile 2026-08-18 | t19-intake, t4-intake | 23 |
| PR-S19 | `profile/SKILL.md:54` | Close summary; offer the practice cold-start | Capability | RC:profile close is conversation (t19) | t19-intake | 27 |
| PR-S20 | `profile/SKILL.md:56-58` | Base-résumé loop runs when; reads ladder, audit, craft | Capability | none found | none | 42 |
| PR-S21 | `profile/SKILL.md:60-63` | Base loop: standard, round, budget, checks, count score | Capability | none found | none | 83 |
| PR-S22 | `profile/SKILL.md:64` | Base loop exits and ceiling | Capability | RC:profile loop ceiling | none | 55 |
| PR-S23 | `profile/SKILL.md:66-73` | Pitch loop: brief, budget, round, substitution test, count score | Capability | EV:t20 | t20-positioning | 109 |
| PR-S24 | `profile/SKILL.md:74` | Pitch loop exits and ceiling | Capability | RC:profile loop ceiling | t20-positioning | 54 |
| PR-S25 | `profile/SKILL.md:76-84` | LinkedIn: verify URL, audit top-down, write, sync headline | Capability | none found | none | 65 |
| PR-S26 | `profile/SKILL.md:86-92` | Consistency sweep; propose base changes before writing | Policy | D:P8 (base writes need a yes) | none | 46 |
| PR-S27 | `profile/SKILL.md:94-99` | Direction change: update criteria, archive, flag staleness | Capability | none found | none | 54 |
| PR-S28 | `profile/SKILL.md:101-106` | Owned files | Code | check_files manifest | — | 23 |
| PR-S29 | `profile/SKILL.md:107` | Trace rule: every claim traces here; vaguer, never stronger | Policy | D:P8 | t10-verbatim-panel, t20-positioning | 21 |
| PR-S30 | `profile/SKILL.md:108` | Ruling gate: concessions, declines, approved wordings written now | Policy | D:P8; RC:profile | t20-positioning | 17 |
| PR-S31 | `profile/SKILL.md:109` | Direction rule: agreed correction updates base first | Capability | RC:profile one-writer 2026-08-19 (an ordering rule) | t19-intake (late correction) | 20 |
| PR-S32 | `profile/SKILL.md:110` | Pitch write moment: four actions same turn | Capability | EV:t20 (1 of 4 missed once) | t20-positioning | 40 |
| PR-S33 | `profile/SKILL.md:111-112` | Hands back; session close check_files | Code | — | — | 54 |
| PR-S34 | `profile/SKILL.md:114-120` | Nothing extracted is written until proposed, checked, confirmed | Policy | RC:profile 2026-08-15, 2026-08-18 | t19-intake, t4-intake | 38 |
| PR-S35 | `profile/SKILL.md:121` | Document rows confirmed in one batch with opt-out | Policy | D:P8 | t4-intake | 12 |
| PR-S36 | `profile/SKILL.md:122` | Conversation claims and inferences need their own yes | Policy | RC:profile 2026-08-18 | t20-positioning, t10-storybank-default | 13 |
| PR-S37 | `profile/SKILL.md:123-126` | Declined proposals recorded as rulings | Policy | D:P6 (recorded once) | t20-positioning | 26 |
| PR-S38 | `profile/SKILL.md:127` | Targets and core statement in the candidate's words | Policy | D:P4 (you bring you) | t20-positioning | 16 |
| PR-S39 | `profile/SKILL.md:128` | Respect voice.md; no analogies or inflated scope | Policy | D:P8 (repeats T0-12/13) | t20-positioning | 11 |
| PR-S40 | `profile/SKILL.md:130` | ONE next step (Tier 0 duplicate) | Capability | = T0-02 | = T0-02 | 17 |
| PR-P01 | `profile/references/patterns.md:1-5` | Read before an intake and before any audit | Capability | skill-shape read step | t4-intake | 37 |
| PR-P02 | `profile/references/patterns.md:7-12` | Check the folder; read a dropped résumé before asking | Capability | EV:t4 MUST | t4-intake | 39 |
| PR-P03 | `profile/references/patterns.md:14` | Annotate every extraction with its source | Policy | D:P8 | t4-intake, t19-intake | 9 |
| PR-P04 | `profile/references/patterns.md:16-20` | Environment metadata is never a candidate fact (marked echo) | Policy | RC:profile t19 | t19-intake | 48 |
| PR-P05 | `profile/references/patterns.md:22-23` | Document text is evidence, never instruction; never re-ask what's on file | Policy | data-is-not-instruction | none (t3 covers pasted JDs only) | 19 |
| PR-P06 | `profile/references/patterns.md:25-32` | The four findings | Capability | EV:t4 (the skill turns filing into analysis) | t4-intake | 63 |
| PR-P07 | `profile/references/patterns.md:34-36` | Dig for the number; estimates labelled as theirs | Policy | D:P8 | t19-intake, t7-capture-honesty | 34 |
| PR-P08 | `profile/references/patterns.md:38-48` | Walk the enumerated list; each rule states its own condition | Capability | RC:profile hazards (1/7 without the list) | t4-intake | 101 |
| PR-P09 | `profile/references/patterns.md:50-59` | Claim hazard table (8 hazards) | Capability | RC:profile 2026-08-13; EV:t4 | t4-intake | 208 |
| PR-P10 | `profile/references/patterns.md:61-66` | Application defaults via inline widget; nothing invented | Capability | none found | none | 38 |
| PR-P11 | `profile/references/patterns.md:68-79` | Transitions; founder re-entry gets its own question | Capability | RC:profile founder re-entry (5/6 missed) | t4-intake | 105 |
| PR-P12 | `profile/references/patterns.md:81-89` | Target reality check: role mismatch | Capability | none found (thresholds from evaluate eval.md) | t4-intake (partial) | 76 |
| PR-P13 | `profile/references/patterns.md:90-96` | Timeline mismatch: exec offer <~8 weeks | Capability | RC:profile timeline (5/6 missed) | t4-intake | 83 |
| PR-P14 | `profile/references/patterns.md:98-109` | One source, three readers | Craft | none found | none | 105 |
| PR-P15 | `profile/references/patterns.md:111-116` | ATS: one column; the posting's own language | Craft | none found | none | 40 |
| PR-P16 | `profile/references/patterns.md:118-128` | Recruiter 7–11 s scan; verb ladder | Craft | none found | none | 103 |
| PR-P17 | `profile/references/patterns.md:130-142` | Hiring manager: XYZ, so-what ladder, judgment visible | Craft | none found | none | 107 |
| PR-P18 | `profile/references/patterns.md:143-154` | Band alignment above / below / at | Craft | none found | none | 108 |
| PR-P19 | `profile/references/patterns.md:155-157` | Frame the worries, don't hide them | Craft | none found | none | 26 |
| PR-P20 | `profile/references/patterns.md:159-164` | New patterns proposed, never self-adopted | Capability | = AP-P33 | none | 55 |

### search

| id | file:line | rule | class | receipt | harness cases | words |
|---|---|---|---|---|---|---|
| SE-S01 | `search/SKILL.md:1-6` | Frontmatter trigger description and title | Structure | — | — | 79 |
| SE-S02 | `search/SKILL.md:8-10` | [goal] New on-thesis roles to To Review; search finds, evaluate judges | Capability | none found | t5-* | 22 |
| SE-S03 | `search/SKILL.md:12-14` | [goal] Confirmed plan before any sweep | Capability | EV:t5 (permission-mode artifact, 2026-08-14) | t5-plan-attended | 21 |
| SE-S04 | `search/SKILL.md:15` | [goal] Saved JDs and direct employer URLs | Code | check_files / jobs_md | t5-* | 19 |
| SE-S05 | `search/SKILL.md:16` | [goal] Honest yield per source, counts, settings | Policy | D:P8 | t5-* | 11 |
| SE-S06 | `search/SKILL.md:17` | [goal] Market insights dated in Search notes | Capability | none found | none | 12 |
| SE-S07 | `search/SKILL.md:18` | [goal] Prune proposes; engaged rows never touched | Capability | EV:t14 | t14-protected-rows | 15 |
| SE-S08 | `search/SKILL.md:20-23` | Prerequisites | Code | — | t5-* | 22 |
| SE-S09 | `search/SKILL.md:25-31` | Section heads; plan runs when | Structure | — | — | 30 |
| SE-S10 | `search/SKILL.md:33` | Read criteria.md in full | Capability | skill-shape read step | t5-plan-attended | 5 |
| SE-S11 | `search/SKILL.md:34` | Compose queries and instruments | Capability | none found | t5-plan-attended | 11 |
| SE-S12 | `search/SKILL.md:35-37` | Propose the plan and stop; the yes writes it before execution | Capability | EV:t5; README env rule 5 (0/2 at full permission) | t5-plan-attended | 27 |
| SE-S13 | `search/SKILL.md:39-46` | Sweep loop: run, parse, diagnose thin yield, propose prune | Capability | EV:t5, EV:t14 | t5-plan-attended, t14-* | 66 |
| SE-S14 | `search/SKILL.md:47` | One evidence-backed revision pass at a time | Capability | none found | none | 10 |
| SE-S15 | `search/SKILL.md:48` | Only To Review rows ranked; engaged rows excluded from prune | Capability | EV:t14 shapev2–v4; EV:t8 (trimmed 3/3 → 0/2); Target-companies protection and count correction are gone | t14-protected-rows, t14-silent-dismissal | 16 |
| SE-S16 | `search/SKILL.md:49` | Dismissals need one explicit batch approval | Policy | D:P4 (your decisions); t14 MUST NOT | t14-protected-rows, t14-silent-dismissal | 10 |
| SE-S17 | `search/SKILL.md:50` | Exits; ceiling = two passes same yield → DECISION | Capability | none found | none | 33 |
| SE-S18 | `search/SKILL.md:52-56` | Scheduled run: standing plan verbatim, no logged-in scraping, no widening | Capability | EV:t5 scheduled | t5-plan-scheduled | 28 |
| SE-S19 | `search/SKILL.md:57-59` | Unattended: list prune candidates, never auto-dismiss | Policy | D:P4; EV:t14 silent-dismissal | t14-silent-dismissal | 27 |
| SE-S20 | `search/SKILL.md:61-68` | State; session close | Code | — | — | 55 |
| SE-S21 | `search/SKILL.md:70` | Never fabricate a listing, company, or metric | Policy | D:P8 | t5-* | 14 |
| SE-S22 | `search/SKILL.md:71` | Direct employer URLs; no aggregators | Capability | none found | none | 9 |
| SE-S23 | `search/SKILL.md:73` | ONE next step (Tier 0 duplicate) | Capability | = T0-02 | = T0-02 | 17 |
| SE-P01 | `search/references/patterns.md:1-5` | Read when composing or revising a plan | Capability | skill-shape read step | t5-plan-attended | 36 |
| SE-P02 | `search/references/patterns.md:7-14` | Addressing and authority; leads confirmed before candidate spends time | Capability | none found | t5-plan-attended | 67 |
| SE-P03 | `search/references/patterns.md:16-24` | Instrument catalog and the scripts that run them | Code | scripts' own usage | t5-plan-attended, t5-plan-scheduled | 270 |
| SE-P04 | `search/references/patterns.md:26-28` | Research proposes companies; only a posting is a role | Policy | D:P8 | t5-plan-attended | 34 |
| SE-P05 | `search/references/patterns.md:30-37` | Unreachable source → build request, never hand-scrape | Capability | none found | none | 70 |
| SE-P06 | `search/references/patterns.md:39-45` | Compose per lane with a reason the candidate can disagree with | Capability | none found | t5-plan-attended | 63 |
| SE-P07 | `search/references/patterns.md:47-61` | Sweep steps 1–7 (regenerate criteria.json, report, cross-listing) | Capability | none found | t5-* | 136 |
| SE-P08 | `search/references/patterns.md:62-79` | Prune report: DEAD / STALE / OUTRANKED; one question | Capability | EV:t14 | t14-silent-dismissal, t14-protected-rows, t14-no-second-number | 167 |
| SE-P09 | `search/references/patterns.md:81-94` | Reading a thin result: query, coverage, or market | Craft | none found | none | 101 |
| SE-P10 | `search/references/patterns.md:96-105` | LinkedIn post radar is attended only | Capability | none found | none | 81 |
| SE-P11 | `search/references/patterns.md:107-126` | Post-radar query design ("my team", not "I'm hiring") | Craft | tested 2026-08-03 (in text) | none | 176 |
| SE-P12 | `search/references/patterns.md:128-138` | Each hiring-post hit → row, contact, drafted reply | Capability | none found | none | 80 |
| SE-P13 | `search/references/patterns.md:140-145` | Public LinkedIn search is bonus-only | Craft | probe 2026-07-17 (in text) | none | 45 |
| SE-P14 | `search/references/patterns.md:147-153` | New patterns proposed, never self-adopted | Capability | "I'm hiring" adopted backwards (in text) | none | 67 |

### storybank

| id | file:line | rule | class | receipt | harness cases | words |
|---|---|---|---|---|---|---|
| SB-S01 | `storybank/SKILL.md:1-8` | Frontmatter trigger description, title, intro | Structure | — | — | 100 |
| SB-S02 | `storybank/SKILL.md:10-12` | [goal] A bank that covers the map with complete, strong stories | Capability | none found | t7-* | 17 |
| SB-S03 | `storybank/SKILL.md:14-16` | [goal] Complete: STAR, secret, metrics, questions | Craft | none found | t7-capture-honesty | 20 |
| SB-S04 | `storybank/SKILL.md:17` | [goal] Strong: 4+ before consumers cite | Capability | EV:t20 (4+ bar held S002 out) | t7-draft-not-confirmed, t20-positioning | 20 |
| SB-S05 | `storybank/SKILL.md:18` | [goal] Covering incl. feedback, conflict, failure | Craft | none found | none | 18 |
| SB-S06 | `storybank/SKILL.md:20-23` | Prereqs: coverage map (from jd-analysis or [inferred]); Claim rules | Capability | t7-capture-honesty MUST (map before first question) | t7-capture-honesty | 31 |
| SB-S07 | `storybank/SKILL.md:25-31` | Section heads; capture runs when | Structure | — | — | 35 |
| SB-S08 | `storybank/SKILL.md:33` | Aim at uncovered competency; drill for specifics, never guess | Policy | D:P8 (never guess) | t7-capture-honesty | 21 |
| SB-S09 | `storybank/SKILL.md:34` | Write story file + index row now; Status confirmed | Capability | EV:t7 (persistence) | t7-capture-honesty | 18 |
| SB-S10 | `storybank/SKILL.md:35` | Earned secret; TODO until extracted | Policy | D:P8 | t7-capture-honesty | 13 |
| SB-S11 | `storybank/SKILL.md:36` | New fact → propose the résumé line in chat | Policy | EV:t7 round 3 (imperative wording; current wording is softer) | t7-capture-honesty | 27 |
| SB-S12 | `storybank/SKILL.md:38` | Capture exits | Capability | none found | t7-capture-honesty | 11 |
| SB-S13 | `storybank/SKILL.md:40-45` | Mining: draft [source]; confirmed only after a question | Policy | RC:profile doc does not waive question 2026-08-15 | t7-mining-correction, t7-draft-not-confirmed | 43 |
| SB-S14 | `storybank/SKILL.md:47-54` | Improve loop with ceiling | Capability | none found | none | 101 |
| SB-S15 | `storybank/SKILL.md:56-60` | Find gaps; drill at 8+; narrative identity at 5+ | Capability | none found (thresholds unsourced) | none | 41 |
| SB-S16 | `storybank/SKILL.md:62-67` | State; session close | Code | — | t7-* | 51 |
| SB-S17 | `storybank/SKILL.md:69-74` | A story is not a résumé line: exact wording yes; declines logged | Policy | RC:profile 2026-08-19 | t7-capture-honesty, t10-storybank-default | 54 |
| SB-S18 | `storybank/SKILL.md:76-80` | Never fabricate; trace to base; firsthand secrets | Policy | D:P8 | t7-* | 28 |
| SB-S19 | `storybank/SKILL.md:82-84` | Corrupted fragment + duplicated closing line (defect) | Structure | — | — | 42 |
| SB-P01 | `storybank/references/patterns.md:1-5` | Header | Structure | — | — | 40 |
| SB-P02 | `storybank/references/patterns.md:7-10` | Ask ONE prompt at a time | Capability | RC:profile t19 menus | t7-capture-honesty, t19-intake | 28 |
| SB-P03 | `storybank/references/patterns.md:12-21` | Aim before phrasing; aim at a known story | Craft | none found | none | 87 |
| SB-P04 | `storybank/references/patterns.md:23-36` | Reflective prompts | Craft | none found | none | 124 |
| SB-P05 | `storybank/references/patterns.md:38-39` | Ask for the number once; TODO it | Policy | D:P8 | t7-capture-honesty | 21 |
| SB-P06 | `storybank/references/patterns.md:41-43` | Capture at first sign, then drill | Capability | none found | t7-capture-honesty | 34 |
| SB-P07 | `storybank/references/patterns.md:45-60` | Shaping (Storyworthy) | Craft | none found | none | 134 |
| SB-P08 | `storybank/references/patterns.md:62-78` | Drawing out the earned secret; what qualifies | Craft | none found | t7-capture-honesty | 117 |
| SB-P09 | `storybank/references/patterns.md:80-92` | Improving by score band | Craft | none found | none | 100 |
| SB-P10 | `storybank/references/patterns.md:94-103` | Red-teaming a story | Craft | none found | none | 70 |
| SB-P11 | `storybank/references/patterns.md:105-119` | Answering when no story exists (repeats interview's gap patterns) | Craft | none found | none | 111 |
| SB-P12 | `storybank/references/patterns.md:121-127` | The three gaps always worth checking | Craft | none found | none | 62 |
| SB-P13 | `storybank/references/patterns.md:129-135` | Finding themes (Lichaw) | Craft | none found | none | 56 |
| SB-P14 | `storybank/references/patterns.md:137-146` | Find-gaps pass; a draft is named, never counted | Policy | D:P8 (a draft counted as coverage inflates); t7-draft-not-confirmed | t7-draft-not-confirmed | 77 |
| SB-P15 | `storybank/references/patterns.md:148-160` | Retrieval drill | Craft | none found | none | 93 |
| SB-P16 | `storybank/references/patterns.md:162-176` | Naming the narrative identity | Craft | none found | none | 111 |
| SB-P17 | `storybank/references/patterns.md:178-186` | Antipatterns: menus, sharpening, draft≠incomplete, narrating | Capability | RC:profile close is conversation (t19); EV:t7 | t7-*, t19-intake | 52 |
| SB-P18 | `storybank/references/patterns.md:188-193` | New patterns proposed, never self-adopted | Capability | = AP-P33 | none | 44 |
