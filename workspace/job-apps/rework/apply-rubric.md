# Apply review standard: one combined review, 4 angles

Version: `apply-rubric-sanitized-v1`

Live and eval-gated. The combined reviewer (`rework/reviewer-brief.md`) reads this on every package. Any rule edit must bump the Version line, pass the original application tests and evals once synthetic fixture coverage is complete, be logged by the maintainer and get the current user's OK. Code owns deterministic checks; this file keeps facts and judgment. No former approval or revision history is imported.

## Code checks this, so do not re-judge it (`tools/precheck.py`)
Format, sections, configured date restrictions, the configured graduation-year policy; the configured SUMMARY count (standalone evidence bullets plus optional logistics), configured word caps, the configured page target; em-dash and arrows; leaked internal text; every number and banned or scoped phrase vs `claims.yaml` (`check_claims.py`); the user's banned terms and career-length wording (`tools/precheck_terms.yaml`); duplicate sentences; JD copy runs (8+ words = FAIL, 6-7 = WARN); cover required by the form or not. Its WARN lines (long sentences, repeats, acronym runs, keyword coverage, default-plan gap hits) are yours to call.

## Confirmed facts (a line that conflicts with these fails)
Read the current candidate’s approved claims, role headers, dates, technology scope, metrics and permissions from private configuration. No original career fact is distributed here.

## Gap handling (one `gap_handling` entry per step-6 gap and blocker)
- `blocker_flagged`: a hard requirement the user can't meet. Record `decision: user_applies_anyway` with a `decision_ref`, or `flagged_to_user`. A flagged blocker can never PASS.
- `adjacent_shown`: show the closest approved claim (`claim_id`, with `shown_as` quoting the line), plainly and in candidate voice.
- `omitted`: leave it out. The cover may name it only as a plan, and only when the JD makes it central.
- **Overclaim:** any wording that implies a gap is met without an approved claim fails, including paraphrases ("would a hiring manager read this as the gap skill?"). `tools/implied_terms.yaml` is a floor, not the list.

## The 4 angles (one verdict each)
- **hiring_manager (fit).** Do the top-third bullets prove the JD's top 3-5 outcomes? Is the level right (builder for IC, leader for manager, player-coach for Head-of)? For hands-on roles, surface recent approved hands-on evidence at the top. Name the single most likely rejection reason and say whether the resume answers it. FAIL on generic paste, no mandate match, level mismatch, or a central must-have left unanswered.
- **recruiter (story and tone).** Is it clear in a brief scan? Read the SUMMARY on its own first, before the JD: is it self-contained, in full sentences, with any unfamiliar product introduced before it is referenced and any transition explained? No forced short labels or defensive disclaimers. Then check JD coverage. Is the language plain and reverse-chronological, current role first? Cover only when required: greeting, one fit sentence, bold-label approved proof bullets and a closing line; word/bullet targets come from policy.yaml.
- **ats.** List 8-12 must-have terms with aliases, top 3 first. Coverage under 70% = FAIL, under 85% = REVISE, a missed top-3 term = REVISE. Never ask for a gap term. The target title belongs in the headline or SUMMARY, never as a fake held title. Keep a light skills line of nouns only.
- **age_signal_claims (truth).** Check every claim against the approved facts and claims.yaml, including paraphrase overclaims, configured legacy-technology restrictions in headline/SUMMARY and format tells (unneeded street address, objective statement or a title not held). No former technology bans or age cutoff are inherited. Record gap handling here.

## Final gate
PASS only when precheck has no FAIL, every angle is PASS on every shipped doc, no blocker waits on the user, and the rejection reason is answered. Rounds: rounds within the configured limit are normal. The next round is automatic only for a wording-only fix (`tools/wording_check.py`); otherwise it goes to the user, and later rounds always does. Residual gaps go to the approve-to-apply digest.

## Conversion craft
The top third proves the mandate in about 10 seconds. Prefer proof density over breadth: 3-4 strong bullets on the spine role. Write adjacency in candidate voice (never "I do not claim"). Keep titles and dates congruent with LinkedIn. The tagline is true positioning, with no number repeated from SUMMARY. Use no pipeline jargon in candidate-facing text.

## SUMMARY method
- Map the JD's top 3-5 asks to approved proof **privately** (notes and best_candidate only, never on the resume).
- Write a self-contained SUMMARY: usually 3-4 distinct full-sentence bullets (not a fixed count), plus an optional logistics line. Introduce an unfamiliar product before referring to it, explain transitions between roles or domains, and avoid forced labels ("Multi-step agent workflows.") and defensive disclaimers ("not LLM or security").
- Read it standalone first, then check coverage against the JD. Every fact still comes from approved claims.yaml ids; hard facts and precheck FAILs are unchanged.
