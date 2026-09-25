# Apply — how to judge the work

`SKILL.md` names the destination and the gates; this file is how to
tell they are met, and who checks.

## Who checks what

- **Structure and counts → the scripts.**
  `scripts/check_materials.py` — the mechanical floor for the
  résumé and letter: case length · salutation register · one opening
  section · standard section names · no aggregate year counts (quoting
  the JD's bar in a bolded opener is exempt) · no arrow glyphs or ASCII
  arrow chains (`->`, `=>`, `<-`, `<=>`; code, comments, and URLs
  exempt) · banned filler · repeated Summary numbers · graduation years
  and stale per-role dates · duplicated Summary/Experience sentences ·
  every Experience bullet verbatim from the base except the declared
  `## Reworded` pairs. The letter's length bounds are advisory WARNs
  (spec-born, never fired; an incident promotes them).  `scripts/render_resume.py` measures words, pages, and file size.
  `scripts/proposal_block.py` prints the proposal as the block the
  reply carries (out rows first, verbatim) and checks what prose kept
  failing: a `have` row whose JD word is absent from the base (WARN —
  `shown-but-unnamed` unless defended), `out` rows in base order
  (WARN), a cut with no `why`/`words` (FAIL).
  `../../profile/scripts/check_files.py` validates the four declared tables.
- **Language against written rules → an INDEPENDENT checker-subagent**,
  spawned on `../../profile/references/language-check.md` with the
  documents and their rule sources (`voice.md`, `base-resume.md § Claim
  rules`). It owns never-say, struck forms, confirm-tier hazards,
  `reworded_scope` — the rewording that adds a noun, department, tool,
  or strength the base lacks — and `search_jargon`. It catches
  paraphrases exact-match never could (t15: 10/10 vs the parser's 5/10).
- **Everything semantic → you, at the moment**, and the panel at
  delivery (`## The panel — three lenses`, below): the band call,
  whether the Summary answers "what role and why this one", whether a
  letter argues or lists.

**What belongs here vs in `patterns.md`**: a line here produces a
verdict and names who produces it. The assembly table's Do/Never rows
are craft — the rows a checker enforces (verbatim bullets, a repeated
Summary number, one opening section) are the ones listed above; the
rest are judged by the panel and never scored.

Results reach the candidate as outcomes: every FAIL and every
fix-before-delivery flag is fixed before delivery; a WARN or
defend-or-qualify flag is actively defended in the reply, never silently
passed; both outputs are shown.

## The panel — three lenses

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

Arrows and search jargon leave the lens lists: they now have
one-right-answer or written-rule owners — `check_materials.py` for
arrows, the language checker's `search_jargon` rule for jargon — and
rule 14 puts them there, not in a second judge.

## The destination, judged

An application is three artifacts: the tailored résumé (+ ATS PDF), the
cover letter, and the outreach plan. **A packet without its third
artifact is not done**; a document that skipped a gate is not
deliverable.

- **Reshape-only holds** — no claim the base doesn't support, no
  function, title, or seniority the base doesn't carry; unsupported
  sections omitted, never filled. Selection, order, and depth ARE the
  tailoring.
- **The decisions were disclosed beside the delivered document** — the `proposal_block.py` list in the reply: every cut with what it buys (weakest first), every `shown-but-unnamed` word with where it was placed, every gap as a question, the page choice if the render ran over, and the one sentence that makes reversal cheap. The delivered file matches the list exactly; tool output the candidate never sees does not count (t10-coverage-classify, t10-over-budget measure this — and ~20 trials measured a wait-before-delivery dead).
- **The standard was written before the draft** (`## Standard`), the
  audit came before the documents, and the page count was measured
  against the target the candidate gave, not discovered.
- **The round was scored as a count** — `N/M held; unmet: …` in
  `## Rounds`, the earlier rows read first; the exit said M/M, budget,
  or the ceiling.
- **The panel was three subagents**, each fed the SOURCE documents (raw
  JD, decode, company brief), never the author's summary; one
  incorporation round; the checker re-ran (t10-verbatim-panel).
- **A draft story's claim was never treated as the candidate's**
  (t10-storybank-default): proposed and waited, exactly as a new fact.
- **Nothing submitted without the captured confirmation**, and nothing
  submitted without the candidate's go.

## The letter — the conversion rubric

A letter's job is the interview; it is an argument, not a checklist:

- one thesis in the first two lines (why THIS candidate for THIS role);
- a single argument — a paragraph that merely adds gets deleted;
- their language and their priorities, in their order;
- one traced number per claim;
- a forward-motion close.

## The Summary — the test

*"What role is this person targeting, and why this one?"* If the Summary
does not answer that, it is decoration. A second abstract sentence fails
the substitution test — put another candidate at that level in its place
and it still reads true.

## Answers — the standard

The question and its word limit, exactly. Every claim true of the
candidate and traced; a CONFIRMED story behind every example; a
question with no honest good answer gets an honest adequate answer,
never an invented one. Written register: read, not heard.
