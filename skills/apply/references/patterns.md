# Apply — the craft

Technique, not rules: how to assemble a tailored résumé, write the
letter, draft answers, render the PDF, and work a live form. Rules live
in `../SKILL.md`; the standard in `eval.md`; file shapes in `schema.md`.
**Read § Assembly through § The page target before tailoring** — every
rule here was earned by a real incident (logged in the repo's
receipts ledger; read them when re-litigating a rule, not when
applying one).

## Tailoring — getting there

The loop in `../SKILL.md` says what must be true; this is the order that
reaches it fastest, earned over the 2026-08 rounds.

1. **Read before drafting**: this file through § The page target, the
   audit in `../../profile/references/eval.md § The résumé audit`, and
   the reader craft in `../../profile/references/patterns.md § The three
   readers`. Candidate-voiced prose (the Summary, the letter)
   reads `../../profile/references/candidate-voice.md` with `voice.md`.
2. **Write the standard, then the audit block.** `## Standard` in the
   application file: the JD's top requirements in their order, the
   band call (above-band leads with FUNCTION and player-coach signals,
   never org-chart altitude), the page target, the word budget, the two
   checkers. The page target is the rule's default — one page under 5
   years' experience, otherwise two — unless the candidate named one,
   and it is *soft*: over it, the candidate chooses cuts or the extra
   page. Then the audit block in the reply: ATS tier · recruiter tier ·
   band call · requirements · budget. An audit you have to show is an
   audit you have to run.
3. **Classify, then select, in the file.** Coverage rows: `have` = the
   base evidences it (name the bullet); `shown-but-unnamed` = true in
   the base but missing THEIR word — **not `have`**, because filing it
   as `have` makes the placement silently; `gap` = a question before
   it is a weakness — ask for evidence they might have, never for a
   claim; "no" is a recorded answer; cap at ~5 by the JD's weighting.
   Selection rows: every bullet in or out; the `out` rows are the cut
   list, **weakest-first for THIS posting**, each `why` saying what the
   cut buys. `proposal_block.py` WARNs a `have` whose JD word is absent
   from the base, and `out` rows left in base order.
4. **Assemble with your defaults** — cuts as selected; each
   `shown-but-unnamed` word placed where it does most (Summary, Skills
   line, or a bolded opener; bullets stay verbatim). The letter is
   always drafted — it doubles as outreach material; the form decides
   where it goes, never whether it exists.
5. **Render and measure** (`render_resume.py`), then the checks and
   the panel per `eval.md § The panel — three lenses`. Each lens
   returns `lens · finding` rows, you add the outcome, every finding
   ends fixed or discarded-with-why.
6. **Deliver with the decisions beside it**: the `.md` path and the
   PDF, the rubric line, then the `proposal_block.py` list, then the
   sentence that makes reversal cheap — *"say 'keep the onboarding
   guide' or 'ship it at two pages' and I'll restore and re-render;
   otherwise this is the version."*

What kept failing, so you don't: pointing at the file ("the full table
is in the application file") instead of putting the decisions in the
reply; retyping the table loosely; treating a script's output as shown;
marking a `shown-but-unnamed` row `answered` and placing the word
without saying so. Each was measured more than once.

## Assembly — patterns and antipatterns

The audit (`../../profile/references/eval.md § The résumé audit`) yields
a **change list, not a document**; the base is the document. Reshape by
reordering, selecting, and re-altituding. Apply each edit exactly once;
unchanged sections come straight from the base.

| Do | Never |
|---|---|
| Experience bullets are the base's own sentences — selection, order, and depth ARE the tailoring | Blended or story-flavored rewrites: out of context without the full story |
| Let what matches the JD's function and level open each section | Re-authoring content so it can lead |
| Off-target identity: order the transferable dimension first; when titles or products do not match the posting, one Summary bullet states the true adjacency and the gap — claims-free, the default | Authored bridging claims; a title never held; deleting the off-target signal |
| The Summary carries an achievement's headline number; the role bullet carries its *how* | The same sentence — or the same number — twice in the Summary |
| Recency opens every checklist bullet: the first clause answers "can they do it NOW" | Opening on old material |
| ≤2–3 company names per bullet, newest first | A parade of names — reads as reminiscence |
| The JD's own requirement order by default; ONE promotion, only if it also answers a top-3 requirement; the weakest-but-required answer closes the section | Ordering by your strengths alone, or by margin over the JD's bar |
| Re-altitude every achievement: open on the outcome | Mixed altitudes — perceived seniority drops to the lowest |

### Shape, top to bottom

1. **Header**: Name (`# Name`), followed by single delimiter-spaced contact line (`Location | Email | Phone | LinkedIn | GitHub`), followed by an optional italicized **target subtitle** — true positioning only, never a title not held (e.g., `*Field engineering leader — enterprise deployments*`). Never make the target title an H2 section name (confuses ATS parsers).
2. **Clean Typography (Zero Decorative Scaffolding)**:
   - **No horizontal rules (`---`, `***`, `___`)**: Banned across all candidate-facing documents (résumé, cover letter, outreach messages, pitch). In ATS parsers, plain-text clipboards, and PDF renderers, horizontal rules inject unmanaged vertical margins, break page-budget calculations, or get misinterpreted as document termination / signature markers.
   - **No ASCII box-art or raw HTML tags (`<hr>`, `<br>`, `<div>`)**: Structural hierarchy is expressed exclusively through semantic markdown headings (`#`, `##`, `###`) and clean paragraphs. The destination engine (PDF printer, ATS portal, email client) owns visual decoration.
   - **No decorative emojis** in professional artifacts (résumé, cover letter, executive outreach).
3. **`## Summary` — the single opening section; its shape is § The
   Summary.** Never a second list ("Core Expertise", "Highlights")
   that re-says it.
4. **`## Professional Experience` / `## Experience`**: 2–4 roles in
   reverse chronological order, current first — tailoring reorders
   bullets within a role, never the roles. The spine role (the one
   whose work best proves this mandate, usually the current one) keeps
   its 3–4 strongest bullets; 2–3 elsewhere; outcome first.
5. **`## Earlier Experience` / `## Other Experience`**: Roles older than ~10 years get one line each; older than ~15 fold into a single "Earlier" line with no dates.
6. **`## Selected Work, Patents & Publications` / `## Patents`**: Exact USPTO numbers and verified titles (without redundant co-inventor listings if not universally listed); open-source repos with direct URLs.
7. **`## Education`** (no graduation dates), then **`## Skills`** — one
   line of the posting's own nouns that the base supports; no rating
   bars, no stuffing; never a substitute for the Summary's proof.

Omit a section rather than fabricate to fill it. One page under 5
years' experience; **2 pages maximum otherwise**, even from a 3-page
base.

### The top third

- **Top third wins**: header, Summary, and the first role's opening
  bullets prove this mandate; patents and older roles stay below.
- **No search jargon**: a document sent to an employer or a contact
  never carries Ten's own labels (a verdict tier, a track name, a round
  count); the language checker's `search_jargon` rule holds the list.
- **No arrows**: write it in words ("from six months to one month");
  `check_materials.py` and `check_messages.py` FAIL arrow glyphs and
  ASCII arrow chains.

### The Summary — why it exists, and the least that does the job

Three reasons, and no others: a recruiter scans 7–11 seconds in an
F-pattern and lands here first; bullets are verbatim, so this is one of
only three places the posting's words can enter (with the Skills line
and bolded openers); it states the function and level the titles do not
("Field CTO" applying to Head of Engineering otherwise gets guessed).

**Always 4–7 short bullets, never a paragraph** — a recruiter scans
bullets; a paragraph is a wall. **Bullet 1 is the mandate sentence**:
function and level, stated as the outcome this seat exists to
deliver, never an echo of the posting's title. Each later bullet is one proof with its number, the
posting's hardest screen first. The PDF shows them as a list.

**The base résumé's Summary has the same shape.** With no posting,
bullet 1's mandate is the target in `criteria.md § Targets`, and the
proofs lead with what that target's postings screen for hardest.
Tailoring then reorders and swaps the base's bullets instead of
rewriting a paragraph.

**When over-qualification or a doubted hard screen is the real risk**,
bullets 2–7 take the requirement-checklist form: the posting's
phrasing, evidence after the colon, each bullet's evidence proving the
opener's EXACT claim. A JD's "N+ years of X" is answered with THEIR
number ("8+: yes —") proven by recent evidence — meet the bar, don't
triple it. This form answers one posting, so the base résumé never
takes it.

### Rewording for the JD's vocabulary

Verbatim selection stays the default. A bullet **may** be reworded into
the posting's words when the candidate approves it, under four rules:
same facts, same numbers; **same scope** — no noun the base does not
carry; the verb ceiling holds ("prototyped" never becomes "shipped");
vaguer is allowed, stronger never.

Each rewording appears in the proposal as `base → tailored`, approved
line by line, then declared in the file's `## Reworded` block. The
guarantee is not "nothing is reworded" but **"nothing is reworded off
the record"**. Scope is the part a script cannot check — the language
checker's `reworded_scope` rule reads each pair (career-ops's own
example, "collaborated with team" → "stakeholder management across
engineering, operations, and business", invents three departments while
changing no number). A rewording that is simply better goes upstream
into the base (direction rule); employer-specific vocabulary stays in
the tailored document.

### The page target, the budget, and the cut list

A Letter page fits roughly 520–560 words at the shipped type size, so 2
pages ≈ 1,050 words of visible text including headings; state the
budget in the audit block and draft against it. `render_resume.py`
measures. The page target is soft: over it, the `out` rows are the cut list, weakest-first for THIS posting, each saying what it buys, delivered beside the document with the page choice — and if the candidate would rather ship three pages, that is their call, not a defect. An over-long render is fixed
upstream in the `.md`, never by shrinking the font.

**Edit-in-place — the `.md` is the artifact.** Name its path every time
the document is delivered. When the candidate says they edited it, run
the script against the file on disk and do not regenerate the content
— their edits are the newest version. Re-run the checkers after any
hand edit; report; change nothing else.

## The cover letter

"An application letter, not a relationship DM." Standard: `eval.md § The
letter`.

1. Salutation — a known recipient gets their full name; never first-name
   a stranger; never invent a name ("Dear Hiring Manager").
2. Hook — the pitch's core statement when `pitch.md` exists (one story on
   every surface: adapt, don't re-derive), else the profile's positioning
   line.
3. Two or three body paragraphs mapping quantified storybank stories
   onto the JD's top competencies.
4. One **researched-specific** why-this-company reason
   (`company/<slug>.md`).
5. A low-friction close.

When the band call says above-band, the letter carries the one-line
scope-over-title answer ("this role owns the function I do best"); the
résumé never litigates level. When `voice.md` exists, mirror its samples
and respect its never-say list.

## Application answers — the drafting protocol

1. **Classify each question** before drafting (say the classification):
   Behavioral · Process/method · Tools-experience · Why-us ·
   Values/culture · Screening/logistics (candidate-supplied, never
   inferred) · Other. For essay-weight questions, also **state what the
   question rewards and the response shape before drafting** — the
   candidate redirects a wrong read cheaply here, expensively after.
2. **Prior-answer reuse**: scan `applications/` for semantically similar
   questions from earlier companies; surface the prior answer and ask
   "adapt or fresh?" — the answer library compounds.
3. **Gap check**: CONFIRMED stories only behind each question; missing →
   flag it, ask for a real example, draft what's supportable, mark the
   flagged question. Don't refuse the batch; don't invent.
4. **Story selection** — never auto-select. Offer 2–3 candidate stories
   with one-line rationales; `[Domain match]` is a tiebreaker, not a
   mandate. **Match the story's register to what the question rewards**:
   a values/culture prompt rewards collaborative, owned-outcome
   material; conflict-, decision-, and disagreement-type prompts are
   where costly or contested calls belong.
5. **Draft, by type — written register** (no narrative warm-up; start at
   the situation or the insight):
   - *Behavioral*: the story's STAR spine, compressed.
   - *Process*: principle first, then grounded in the story with a metric.
   - *Tools*: storybank first, profile fallback; name tools with scope of
     use; unevidenced tools (especially proprietary ones) → say so.
   - *Why-us*: from `company/<slug>.md` / the jd-analysis; neither and
     no research possible → **ask the candidate for 1–2 genuine reasons,
     never a generic answer**. Every sentence lands on the overlap
     between the company's situation and the candidate's record — if
     deleting a sentence wouldn't weaken the case for hiring them, it's
     flattery, not fit.
   - Default 150–200 words unless the form states a limit; first person,
     active voice.
6. **Output**: the `## Answers` blocks and Flagged Gaps in the
   application file.

## The PDF — ATS-safe rendering

`scripts/render_resume.py` owns the markup, the escaping, and the
measurement; never hand-roll the HTML at delivery (both formatting bugs
that reached a candidate on 2026-08-18 came from a renderer improvised
per run). The template contract it implements: single column; no
tables, text boxes, images, icons, headers/footers; section names from
the `.md`; standard fonts only, **never embedded font files** (a 121KB
upload failed, ~8KB worked); 10.5–11.5pt body; plain `•` bullets; real
selectable text.

**Conversion ladder** (the script's fallback story): a platform tool
that renders HTML → PDF · headless Chrome (`--headless --disable-gpu
--print-to-pdf`) · `weasyprint`/`reportlab` if installed (don't install
for this) · the honest fallback — open the HTML and ask the candidate to
print-to-PDF.

**Verify before delivering, every time**: text extracts back with a REAL
extractor (`pdftotext` / `pypdf` — never stream-grep; Chrome's subset
fonts defeat it and produce a false "empty" verdict); numbers and names
match the `.md` exactly; page count measured against the target; file
size under ~100KB (the Chrome rung lands 50–80KB for two pages — if
over, cut content, not quality).

## The live form — browser mechanics

- **Field buckets**: Standard (name, email, phone, location,
  LinkedIn/site, résumé upload) · Screening (work authorization, visa,
  onsite/relocation, compensation, start date, "worked here before") ·
  Essays. Multi-page forms: walk every page BEFORE drafting — late-page
  surprise questions are common.
- **Compensation**: a stated strategy if the candidate has one;
  otherwise the field-appropriate non-answer (blank / "flexible" / range
  only if forced) and ask. Salary HISTORY is a different field, banned
  in 21+ states — say so, point at a lookup for their state, leave it
  blank pending their call; you are not their lawyer.
- **Why-us / why-you essays**: `company/<slug>.md` × the candidate's
  trajectory; `jd-analysis` competencies × storybank evidence; specific
  beats flattering; never recycle one paragraph across companies (the
  file trail makes reuse auditable).
- **File attachment ladder** (field-validated on Ashby 2026-07-14): a
  native upload tool → DataTransfer injection via page JS (build the
  File from base64 → `DataTransfer` → `input.files` → dispatch `change`;
  keep the PDF small; **read the widget back** to confirm the ATS
  registered it; drag-drop-only widgets take the same File via a
  dispatched `drop`) → both fail: stage everything else and fold the
  attachment into the submit gate.
- **Verify by reading back, not by trusting the click**: selects/radios
  are the common silent miss; rich-text fields flatten programmatic
  paragraph breaks — count newlines after filling; unsaved form state is
  volatile (stage → verify → submit in one pass).
- **LinkedIn congruence**: before the Review Gate, compare titles and
  dates with the folder's LinkedIn copy (`linkedin-audit.md` or an
  export in `documents/`); name drift in chat for profile's Consistency
  sweep; no copy: say "LinkedIn not checked".
- **Reading an Ashby form the browser can't open** (2026-08-01): the
  job-board GraphQL answers without auth —
  `POST https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting`
  with `query ApiJobPosting($organizationHostedJobsPageName: String!,
  $jobPostingId: String!) { jobPosting(…) { applicationForm { sections
  { title } } } }`. Introspection is disabled and per-field names are
  hidden — `sections { title }` is the deepest reliable selection; don't
  burn turns guessing subfield names. `[{"title": null}]` means a
  DEFAULT form: standard fields only, no custom essay block — enough to
  answer "does this form collect a cover letter?". The public posting
  API (`https://api.ashbyhq.com/posting-api/job-board/<board>`) returns
  full JD bodies, compensation when published. Everything this yields is
  a PREDICTION, marked `predicted` in the application file.
- **Failure honesty**: CAPTCHA → hand to the candidate. Form
  rejects/timeouts → report exactly what happened and the state the form
  was left in. ATS that blocks automation → say so; the application file
  is copy-paste-ready by design.

## Proposing a new pattern

When an assembly move, a letter structure, or a form technique proves
itself on two real applications, write it as a dated line at the end
of the application file — name the two files. A pattern is never self-adopted; a human promotes it into this
file.
