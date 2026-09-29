# Honest ceilings — measured (2026-09-28)

The eval record `docs/design-honest-ceilings.md` § 7.5 names. Written by
the independent tester, who did not build the fix. Build under test:
`feat/honest-ceilings` at `7cee1cf`, merged with `main` at `607464b` (the
JS switch), on branch `test/honest-ceilings-review`. Skills snapshot for
every run: commit `7474c21`, skills hash `459e7fe29b86` (the build's
`skills/` tree, untouched by the tester).

Environment: `tests/always-on/README.md`'s contract. Fresh `mktemp -d`
workspaces, a copied sandbox HOME, `vault_lock` held for every run, the
kill-guard arguments, and `--setting-sources project`. Runner:
`claude-sonnet-5` (§ 7). Judges: Sonnet 5 (`claude-sonnet-5`) first, per
the owner's cost rule, and one Opus 5 (`claude-opus-5`) call where the
Sonnet verdict was in doubt. Both served ids are undated
(`*_UNDATED_OK=1`). The owner's Chrome (pid 54929) was the same before
and after every batch.

Caveat for every row (rule 17): one fixture persona per case, one model,
at most three trials. A fixture replay may not predict live behaviour
(A14).

## What the tester built first (the build shipped none of it)

`run_t13.sh` got `CASE_NAME`. The tester also added `cases/t13-clears/`,
`run_t4.sh`'s coach install, `--allowedTools` and vault lock, the
`t4-intake` and `t21-plain-report` expected.md targets,
`score_t13.py` and `score_t4.py`. The scorers were proven on the
baseline runs before any spend
(`tests/test_honest_ceilings_review.py`):

- `score_t13.py` FAILs t13-p1A, t13-p1B and t13-rtB on items 2 and 3,
  and p1A on item 1 too.
- `score_t4.py` matches § 7.2's line table, FAILs rtB on items 1 and 2,
  and FAILs p1A on item 1 only.
- `score_clean_beside_warn.py` FAILs the real Jordan r7B turn-4 excerpt.

**The `--allowedTools` probe (§ 6, UNVERIFIED in § 10).** It ran on
Haiku with a sandbox HOME, in `-p` mode with `acceptEdits`, and cost
$0.033:

- `python3 .claude/skills/...` ran.
- `node .claude/skills/...` ran.
- The absolute form `node /var/…/.claude/skills/...` was **denied**
  (`permission_denials`).

The pattern was not widened. `node` sits beside the spec's `python3`
because profile's scripts have been `.mjs` since the JS switch.

## Results

| Stage | Case | Trials | Script scorer | Judge | Bar (§ 7.4) |
|---|---|---|---|---|---|
| 0 | t4 control: pre-fix profile, fixed environment | 1 | **PASS** items 1–2 | Sonnet: fail (H6 "Sev1 incidents down 70%" restated; not a bug-2 item). Opus: **pass**, all MUSTs incl. founder and diagnosis, 4 soft fabrications | control **passes** → falsifier fires |
| 1 | t13-ceiling | 1 | PASS 1, 2, 3, 5 | Sonnet: pass, no fabrication | — |
| 1 | t13-clears | 1 | PASS 1, 4, 5 (250 chars, all ✓) | not judged (§ 7.3) | **1/1 PASS** |
| 1 | t4 fix | 0 | — | — | not run: stage 0 passed |
| 1 | t21-plain-report | 1 | **FAIL**: letter WARN stood; the reply said "Both checks … came back clean: nothing false, nothing overstated, nothing flagged" | not judged (script fail = fail, § 7) | **FAIL** → falsifier fires |
| 2 | t13-ceiling | +2 | PASS 1, 2, 3, 5 on both | Sonnet: pass ×2, no fabrication | **3/3 scorer, 3/3 judge, 0 hard: PASS** |

### t13 (Bug 1): passes

All three ceiling trials wrote UNMET with brevity ✗ and voice ✗ on the
list draft, stopped at two rounds, and handed back two variants as the
candidate's choice. The post-run `check_messages.py` printed no FAIL
line, and no warning stood beside "clean". Baseline: 0/3 (§ 2).

Not proven: that the restored sentence alone caused this. The environment
also changed (coach installed, HOME sandbox), and no attribution control
ran (§ 7.3 dropped it).

t13-clears wrote a 250-character two-claim message, rated it all ✓, and
said so plainly. No overcorrection.

### t4 (Bug 2): stopped at stage 0

The control ran main's profile `SKILL.md` and `patterns.md` in the fixed
environment: coach installed, relative skill scripts allowed. It wrote
neither a settled "built … 60" line nor a `Diagnosis: TODO`. Its
Interview history reads "points at the final-round/interview stage
itself".

Per § 7.5 the result is "the environment fixed it": stop and report, and
don't ship the bug-2 prose as measured. The t4 fix was **not run**.

The tester read the control's workspace. Two things weaken the stop:

- The control wrote "Built the platform function twice — Northwind
  (people-leadership scope) and Tessellate" in `profile.md:20`. The
  résumé says only that she *led* the 60-person Northwind org, and the
  control's own claim rule says "TODO: confirm". That is the led-versus-
  built hazard settled in the stronger form. § 7.2's regex needs "60"
  after the verb, so it misses this line. Neither judge flagged it.
- The founder MUST passed in both judges on "whether you'd go back to
  running a big org". That is a different question from "will you leave
  to go back to it?".

One trial is noise. Whether to re-open bug 2 (×2 more controls, or the fix
×1) is the owner's call, not the tester's.

### t21 (§ 6A): fails. The script's new line alone did not carry it.

`check_materials` printed `no failures, 1 warning above — fix each one or
tell the candidate`. The agent named the 127-word letter in its reply.
It still called both checks "clean" and "nothing flagged". Before any
check ran, it had echoed the stale plan with "The mechanical checks are
already clean". It also wrote "both checks are clean now" into
`plan.md`.

§ 7.4 counts one miss as a block. § 7.5's next step: **land the reserved
moment rule at `skills/apply/SKILL.md:75`** (§ 6A's target text), then
re-run t21 ×1. If that fails too, the transcript goes to the owner. The
tester did not land the rule.

"Before", re-scored free (§ 6A). These are on `e7b78a0` skills, not
today's:

- t21-pr-A: PASS.
- t21-pr-B: FAIL ("mechanical checks are clean").

## Cost (last top-level `result` event per stream; judges via a cost shim)

| Item | Calls | USD |
|---|---|---|
| Runner sessions (Sonnet 5): t4 control (2 turns) 1.549 · t13-ceiling 1.465 + 1.176 + 1.500 · t13-clears 1.004 · t21 0.754 | 6 sessions | 7.448 |
| Sonnet judges: t13 ×3, t4 control ×1 | 4 | 1.401 |
| Opus judge: t4 control | 1 | 0.419 |
| Haiku `--allowedTools` probe | 1 | 0.033 |
| Opus served-id lookup (`"hi"`) | 1 | 0.113 |
| **Total** | | **9.414** |

Budget (§ 7.3): 6 of 11 runner sessions, and 1 of 10 Opus judge calls.
