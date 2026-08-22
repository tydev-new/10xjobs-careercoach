# t5-search — the shape conversion, measured (2026-08-21)

Search was skill four to take the shape (#36; commits 7184e45 build,
b06e4e5 review fixes). t5 is its conduct harness: attended (no plan →
propose, write on the yes, then run) and scheduled (standing plan →
verbatim, never widen). TRIALS=2 per round, judged against `expected.md`.
`run_t5.sh` gained the vault this round (real `~/job-search` locked for
the run).

## Result: 4/4 · 4/4 — parity with the pre-conversion baseline

| Round | Skill version | attended | scheduled | hard fabrications |
|---|---|---|---|---|
| 20260814d/e (baseline, old shape) | 4994a66 | pass · pass | pass · fail (d) · pass (e) | 2 in the d fail |
| shapev1 | 7184e45 (first build) | pass · pass | pass · pass | 0 |
| shapev2 | b06e4e5 (after the ninth DRIFT review) | pass · pass | pass · pass | 0 |

Plan composed before executing in every attended trial; `criteria.md`
byte-identical after every scheduled trial; the user's `§ Target
companies` untouched everywhere.

## What the review fix changed, and what it didn't

The reviewer's finding 3 (agent actions misfiled in `schema.md`) had a
live symptom in shapev1: both attended trials listed unconfirmed leads
to the candidate — one with comp figures by company name. "Leads are
never shown" was a sentence in the file-shape reference; the review
moved it to sweep step 7.

shapev2: **1 of 2 held.** t2 kept leads out of the reply entirely. t1
still reported "18 leads, mostly consulting titles (PwC, EY…)" under a
"Not yet roles" heading — labeled as unconfirmed, but shown. Relocation
helped (named companies with comp → a labeled count); it is not yet
sealed. One sighting; watch, don't rewrite. If it recurs, the likely fix
is the rule's phrasing as an action at the report step ("the report
names sources and counts of leads, never the lead itself").

Soft blemishes the judge logged, none conduct failures: tool narration
in the attended t1 ("Now HN and Track B") — the outcomes-not-narration
line is in the close paragraph, the same placement that left t20's
positioning narrating; a 7-vs-6 count/list mismatch in t2's Track B
line; an asserted skill-installation fact in a scheduled run.

## Reviewer's classification note, carried forward

The sweep passes the letter of "loop" (standard, budget, re-scored by
yield) but most sweeps run zero revision rounds. Kept as the loop with
the full three exits rather than a half-loop; if later skills show the
same shape, the spec should name "sequence with a bounded revision
sub-loop" as a class.
