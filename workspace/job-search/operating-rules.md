# Job search — skill vs native (operating rules)

SSOT for how the assistant runs this search. **Skills** = process, memory, gates. **Native** = judgment, craft, improvisation. Default is **hybrid**.

## Practical rules

1. **Pipeline truth → skills**  
   Coach / evaluate / apply / source keep workspace SSOT (`plan.md`, the jobs DB `pipeline/jobs.db` via find.py / upsert.py / update_status.py, criteria, JD analysis, package folders). `jobs.md` and `active.md` are generated views (render.py); never hand-edit them. Prefer the skill sequence over inventing a parallel board.

2. **Story wording → native lead**  
   Scar → owned turn → one number → disagreeable lesson; spine vs depth; altitude. Storybank skill = coverage map, `stories/` + index, confirm-only, no invent — not mechanical STAR.

3. **Resume / cover → native lead**  
   Use the current user’s approved density, page target and cover format. Apply owns claim discipline, package paths and the submit gate.
   **Daily prep must ship native-density packages** the candidate would approve without a mid-day rewrite. Thin morning templates are a bug.
   **Daily packages require format lint PASS + claims check PASS + 4-lens PASS** (Hiring manager, Age signal and claims, Recruiter, ATS; `<apps-workspace>/rework/apply-rubric.md`) before the approve-to-apply digest. The current PASS line is recorded only by `tools/finalize_review.py`; re-verify with `finalize_review.py --verify` at submission readiness. The legacy reconcile/stamp path remains optional compatibility only. Every number and named fact must match `<search-workspace>/profile/claims.yaml` (`tools/check_claims.py`, blocking). Each step-6 gap or blocker is tagged blocker_flagged / adjacent_shown / omitted; a gap implied as met without a claim fails as an overclaim.
   **Prose style:** follow the current evidence-summary skill and the user’s configured typography/word/page limits; no forced short labels or fixed summary count.
   **Conversion craft:** top-third mandate; proof density (3–4 spine bullets); closest real claim shown plainly when titles/products don’t match (adjacent_shown, never written around a gap); reverse-chrono discipline; LinkedIn congruence; optional light Skills nouns; true positioning subtitle only (never fake employer title); no search-internal jargon in candidate-facing text. Enforced via the 4-lens review.

4. **Live ATS / OTP / captcha → native + apply guardrails**  
   Portal judgment is native; submit only after explicit go; no invented passwords/metrics; Greenhouse OTP via Gmail; captcha → box handoff / secure form.

5. **Booked-loop prep & drills → interview skill**  
   Rubric, ladder/pushback/retrieval/mock, `prep/` + `practice-log.md`. Native supplies live mock energy inside that frame.

6. **Evaluate stays skill — keep it lean**  
   Dealbreakers → lane → verdict → `pipeline/score.py` (writes `jd-analysis/job-<id>-*.md` + `.json` step-6 record and the DB row) + short card. Skip deep decode when dealbreaker already kills the role.

7. **Sourcing → source skill**  
   Multi-source scan under the current private criteria. Criteria owns who to hunt; source owns how to hunt.

8. **Outreach / inbox → outreach skill**  
   Contact mining + drafts only until explicit send ask. Gmail sync updates the jobs DB with `update_status.py` (rejects/confirms/interviews), then render.py.

9. **Thin asks → native**  
   Definitions, quick compares, “where’s the PDF?” — no full skill load.

10. **Skill fights taste → thin the skill, don’t ghost it**  
    Rewrite; don’t delete globally without explicit ask; don’t silently drop SSOT.

11. **Handoffs**  
    what’s next → coach · should I apply? → evaluate · find roles → source · tailor/submit → apply · contacts/email → outreach · stories → storybank · practice/prep/debrief → interview.

## Cheat sheet

| Use skill when… | Lead native when… |
|---|---|
| Updating jobs/plan/criteria truth | Resume/cover readability & spine |
| Dealbreakers / Strong–Solid verdict | Story tell (scar → turn → number → lesson) |
| Submit gate + claim discipline | Level check (EM vs Dir vs VP) |
| Package folders / outreach files | Positioning voice; steel-man mid-chat |
| Prep packs / scored drills | Live mock energy |
| Scout notify vs quiet | Thin one-offs |
| Multi-session continuity | Improvising a stuck ATS |

## Anti-patterns
- Skill theater on wording-only asks
- Thin skill-template resumes in daily prep
- Great chat story never filed to `stories/` + `storybank.md`
- Dual boards outside the jobs DB (`pipeline/jobs.db`) / `plan.md`; hand-editing the generated `jobs.md`
- Fake funnel math (n < 5) or invented claims
- Auto-submit / auto-send without explicit go
- Apply only the current user’s approved criteria; no historical targets, outcomes or exclusions are imported.
- Apply only the current user’s approved criteria; no historical targets, outcomes or exclusions are imported.
- Guessing a funding stage: no source → tag `stage unverified`, don't package
- Apply only the current user’s approved criteria; no historical targets, outcomes or exclusions are imported.
- Apply only the current user’s approved criteria; no historical targets, outcomes or exclusions are imported.

## Cadence (typical)

**User-configured apply-prep session (no routine installed):** read-only Gmail sync → `update_status.py` for rejects/confirms/interviews → candidates from the DB only (`find.py --status "To Review" --fit Strong,Solid --since <last run>`; no searching in this routine, sourcing is the scout's job) → one role per company → native packages on the routed base → format lint → `check_claims.py` → independent combined review into `reviews/combined.json` against the step-6 record → `finalize_review.py` → `update_status.py --status Packaged` → render.py + export_csv.py (weekly_report.py at the user-chosen review cadence) → digest (inbox delta + packages + residual gaps + blocker flags + HM-note targets) → wait for approve-to-apply. Never submits.  
**Scout cadence:** set by the new user; discover fresh matches and stay quiet when empty.
**Ad hoc:** extra Gmail sync on ask; batch submit only after explicit go naming the roles; the user URL drops → evaluate + peer expansion pass.

## Last updated
Candidate-specific history omitted. PIPELINE.md and the current nine skills are authoritative over older operational notes.
