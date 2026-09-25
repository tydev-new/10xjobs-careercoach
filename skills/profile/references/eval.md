# Profile — how to judge the work

`SKILL.md` names the destination; this file is how to tell it is reached,
and who checks. It evaluates the whole skill — the résumé audit below is
one section of it, scoped by its name.

## Who checks what

The split runs on what the check must read (goal 2's table, measured
t15: an independent checker caught 10/10 language violations where
self-check caught 1/7).

- **Structure and counts → `scripts/check_files.py`**: schemas, history
  tables, the file manifest, stray files. Run at session close.
- **Language against written rules → the checker-subagent**
  (`language-check.md`): runs inside the base-résumé loop's self-loop —
  the base is profile's one candidate-voiced surface. Rule sources:
  `base-resume.md § Claim rules` + `voice.md`.
- **Everything semantic → you, at the moment**, with the candidate's
  confirmation as the backstop: provenance of a claim, whether a
  conflict was ruled on, whether a target is truly theirs.

## The destination, judged

For each row of `SKILL.md`'s table, what to look at:

- **Folder settled** — `CLAUDE.md` exists and the candidate was told the
  path in the reply.
- **Target + band** — written in `profile.md`, in the candidate's words;
  proposed is fine, recorded-unagreed is not.
- **Goal + time floor** — heads `plan.md`; the floor is theirs, never
  assumed.
- **Base at full altitude, rules seeded** — `§ Claim rules` is non-empty
  and every hazard-walk hit was confirmed or declined by the candidate.
- **Analyzed, not filed** — all four findings present in
  `profile.md § Intake findings`; interview history carries a diagnosis,
  not just counts.
- **Defaults captured** — `§ Application defaults` exists; unknowns are
  `TODO:`, never invented.
- Anything else not yet true reads `TODO:` in its file — a gap is
  visible, never silent.

## The résumé audit — scoped to `base-resume.md` and its renderings

**Read `base-resume.md § Claim rules` first** — the fact layer travels
with the résumé (the trace and ruling rules: `../SKILL.md § State`).

Walk the three readers in order. Steps marked **[JD]** need a job
description: apply's tailoring runs them; profile's base-résumé mode
audits against the candidate's target band and skips them.

0. **Facts.** Every number, title, date, and scope word traces to the
   base body, and no ⚠ struck form from `§ Claim rules` appears in any
   phrasing. A page that fails here stops the audit — nothing else
   matters if it isn't true.
1. **ATS** → ATS-Ready / Risky / Broken. Structure, headings,
   extractability. **[JD]** the keyword-gap map: each posting term →
   present? where? action (add / reorder / rewrite).
2. **Recruiter** → Strong / Moderate / Weak. First-seconds story, case
   budget, level legibility, scope escalation across roles, whether the
   red flags are visible.
3. **Hiring manager** → Strong / Moderate / Weak. Would they take the
   call: bullets are accomplishments with numbers (not responsibilities),
   the storybank's best evidence is present, **[JD]** the band call is
   right and concerns are framed. The craft behind each of these
   (XYZ, AI-smell, altitude) is `patterns.md § The three readers`.
4. **Consistency** → Clean / Issues (listed). Tense (present for the
   current role, past for the rest), uniform dates and punctuation, no
   first person, no buzzword padding, a timeline that matches LinkedIn.

The tier words — ATS-Ready, Strong, the band call — get used, not
decorated: they go in the round record's `scored` cell beside the
`N/M held` count (apply's round record carries its panel verdicts
instead — `../../apply/references/schema.md`), and `apply` shows them
in its audit block before the documents. **What belongs here vs in
`patterns.md`**: a line here
produces a verdict (a tier, a count, a flag) and names who produces it;
a line that makes a draft better but produces no verdict is craft and
lives in patterns.
The craft each reader responds to is in `patterns.md § The three
readers`.
