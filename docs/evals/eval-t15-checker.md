# t15 — checker head-to-head: py parser vs checker-subagent (language tier)

**Date:** 2026-08-17 · **Issue:** #11 (design gate's named falsifier) ·
**Harness:** `tests/always-on/run_t15.sh` + deterministic `score_t15.py`

## The question

The guardrail sweep split enforcement by what the check must READ:
structure/counts → code, language/content → checker-subagent. The
structure half was already earned (four structure-tier checkers: 1–2
commits each, zero parser incidents). The language half was a
hypothesis — the founder's: an agent with rules is easier to maintain
AND better on edge cases where a fixed parser fails. t15 is its
falsifier.

## Design

Same four language-tier rules for both conditions (struck forms,
never-say, confirm-tier qualifier, letter word band — the last as a
counting canary, code's home turf). Four planted cases; truth.json per
case; NO judge model — a deterministic scorer, so an experiment about
model reliability doesn't rest on model reliability.

| Case | Planted | Predicted winner |
|---|---|---|
| verbatim | 3 violations, exact wording | tie |
| paraphrase | 4 — every violation reworded + letter 233w (under band) | agent (py false-passes by design) |
| drift | 3 verbatim violations, rule file reformatted the way the LIVE file drifted (⚠ on headings, no bold) | agent (the parser-incident class) |
| clean | 0 — legal temptations: corrected form, claim WITH qualifier | code (models over-flag) |

py: 3 identical runs (stability is free). Agent: Sonnet, 3 trials,
materials inlined, forced per-rule verdict table + quoted evidence.

## Results (median run; every agent trial identical at verdict level)

| Case | py | agent |
|---|---|---|
| verbatim | 3/3, 0 FA | 3/3, 0 FA |
| paraphrase | 1/4 (only the word count) | **4/4** — incl. the exact count "233" all 3 trials |
| drift | 1/3 (zero-parse flag fired, catches didn't) | **3/3** |
| clean | 0 FA on 3 rules, **1 FA** (confirm rung can't see the qualifier — every legal use costs a defense) | **0 FA** — passed the claim WITH its qualifier |
| **Grand** | **5/10, 1 FA** | **10/10, 0 FA** |

Stability: verdict sets IDENTICAL across trials for BOTH conditions,
every case. Agent variance existed only in quoted-span boundaries
(whole sentence vs phrase) — the first scorer draft labeled that
DIVERGENT; verified on disk and split into verdict-level vs span-level
before believing either. No holes: all 7 required rows present in
every agent output.

## Read

1. The hypothesis survived its falsifier — on the language tier the
   subagent beat the parser exactly where predicted (paraphrase, format
   drift), matched it on verbatim, and ALSO won the two probes designed
   for code to win (counting: exact; clean: fewer false alarms, because
   it can read the qualifier the string-matcher cannot).
2. Code's remaining edge in this experiment was operational, not
   accuracy: free, instant, offline. Real for session-close checks;
   weak for delivery moments, which are rare and already cost a model
   turn.
3. Caveats, honestly: n=3 trials, one fixture family, one surface
   (résumé+letter), Sonnet only, and the instruction file was written
   by the same author as the fixtures. The migration issue carries an
   independent review of both before any parser code is deleted.

## Consequence

Goal 2's checking-table status flips from "adopted pending t15" to
measured. The deletion valve opens on the language-tier parsing halves
of check_materials.py / check_messages.py — the follow-on migration
issue owns it (NOT #11, which stays structure-tier: manifest,
stray-file, accumulator schemas). checker-instructions.md graduates as
the production subagent contract prototype.

## Graduation review addendum (2026-08-18, #29)

The independent review of the contract + fixtures (both author-written)
returned GRADUATE-WITH-FIXES and honestly softened the headline:

- **Softer than it read:** struck form #1 was never tested as a
  violation (all three violation cases planted the same trio); the
  scorer ignored the truth's file field, never verified evidence
  against the document (rule-text quoting would have scored), and
  counted any length flag.
- **Fixes landed:** the production contract
  (`skills/profile/references/language-check.md`) is parameterized
  (documents + rule sources incl. pitch.md WATCH tier), carries the
  severity tiers, allows N rows per rule, states the missing-source
  convention ("no voice.md — rule not checkable"), and drops
  letter_length (the band stays code, per the gate). The
  qualifier-attachment question was resolved at the SOURCE: a
  confirm-tier entry states its own condition (same-or-next sentence
  default; intake.md seeds it).
- **Scorer hardened** (file match + evidence-substring-of-document +
  count verification), then the v1 archive RESCORED: every substantive
  agent catch survived — 9/9 on the agent-owned rules, 0 real false
  alarms (its one orphaned flag is the v1-era length rule, correct
  then, py-owned now). The 10/10 was not scorer-gamed.
- **Still owed:** the fresh fixture family by a different author (the
  review's ten SHOULD-ADD cases), run through the hardened scorer with
  the production contract — t15b, before this record's conclusion is
  final.

## t15b — the fresh family (2026-08-18): conclusion now final

Ten cases by an independent author (the contract unseen; a structural-
engineer persona, second-struck-form paraphrases, three false-flag
baits), production contract, hardened scorer, TRIALS=3, agent-only
(the parser is deleted; there is no py condition to compare).

**Median: 8/8 catches, 0 false alarms.** All four designed baits held:
no-voice stayed clean 3/3 (the banned-sounding phrase present, the rule
source absent — no rule invented), qualifier-next-sentence legal 3/3,
twice-once-bare flagged exactly the bare instance 3/3, prose-format
rules parsed 3/3. Split-sentence assembly, "nearly a third" for "cut
30%", and the WATCH-form paraphrase in blockquote drafts: all caught,
every trial.

Two trial-level wobbles, both fixed WITH receipts and remeasured:
- jd-echo drew a false flag in 1 of 3 trials (the never-say phrase
  inside the employer's own quoted posting) — the candidate's-voice
  scoping the old code had EARNED (2026-08-16) had not carried into
  the contract. Added, cited; remeasure 3/3 clean, fully stable.
- One malformed reply in 30 (no JSON) — now the contract's void-check
  rule: a non-table reply is a VOID check, re-spawn once, never
  deliver as if an unrun check passed.

Verdict-level stability: identical across trials in 9 of 10 cases
pre-fix, 10 of 10 counting the remeasure. (Accounting stated: the
scorer's raw label reads DIVERGENT in 2 of 10 pre-fix — the malformed
reply counts here as a VOID check per the contract's own rule, not as
a divergent verdict.) The READ-split's language
row is now measured on two fixture families by two authors.
