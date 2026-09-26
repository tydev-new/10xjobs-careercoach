# Apply — the file shapes

What the files must hold. The application file is cross-session state
with five readers (this skill writes; the verifier, a later session, the
coach's board, prep, and the harness judge read), so its shape is
declared here, not remembered. Its four tables — coverage, selection,
rounds, panel — are checked by `../../profile/scripts/check_files.py`
(header, cell count, enums — WARN until an incident promotes it); the
script's enum sets are the authority and the declarations below match
them.

All filenames use the job's `company_key` + `title_key` from `jobs.md`
(deterministic, so two roles at the same company don't collide) — NOT a
free-form role name.

## `applications/<company_key>-<title_key>.md` — the application file

One canonical file per application: the standard, the proposal, the
round record, the form's fields and answers, the submission record, the
outreach-plan summary.

- `## Standard` — written at the audit step, BEFORE the documents, and
  never edited to fit a draft. **A bulleted list, and each bullet is
  one item — M is the bullet count.** Each of the JD's top requirements
  is its own bullet, in the JD's order; then one bullet each for the
  band call, the page target, the word budget, "check_materials.py
  clean", and "language checker clean". It is the tailoring loop's
  FIXED — one job, one file, so it lives here instead of in a brief.
- `## Coverage` — one row per requirement in the jd-analysis:
  `| requirement | status | evidence | decision |` — `status` one of
  `have` / `shown-but-unnamed` / `gap`; `decision` one of `open` /
  `answered` / `skipped`. Free text in an enum cell is how a map breaks
  (the knowledge-map em-dash incident).
- `## Selection` — every bullet in play, in or out:
  `| # | role | bullet | in/out | source | words | why |` — `in/out` one
  of `in` / `out`; `source` one of `base` / `story` / `new`. The `out`  rows ARE the cut list, written weakest-first for THIS posting.  `scripts/proposal_block.py` prints the candidate's decisions from both tables as the reply's short block (cuts, placements, gaps) and checks them; the tables themselves are the record and never go in the reply. A `base` row whose `[source: …]` names a session
  or storybank origin says so in `why`; when the base carries no
  annotations at all, `why` says provenance is UNKNOWN, never nothing.
- `## Rounds` — the round record, one row per round, a round that
  changed nothing included: `| date | round | driver | scored | what
  changed |`. **`scored` is a count, not a sentence**: `N/M held;
  unmet: <item>, <item>` over the `## Standard` bullets, plus the
  panel's lens verdicts: `6/7 held; unmet: page target; ats Pass ·
  recruiter Revise · hiring manager Pass`. Before the panel runs:
  `panel not run`. Read by the loop before it scores — the ceiling is
  two rows with the same count and lens verdicts. The checker enforces
  the header and cells; the cell's form is yours.
- `## Panel` — the persona panel's findings, one row per finding:
  `| lens | finding | outcome |` — `lens` one of `ats` / `recruiter` /
  `hiring manager`. **The lens returns `lens` and `finding`; you fill
  `outcome`** with `fixed` or `discarded — <why>` (the checker accepts
  only those two forms). Every finding is one or the other; an
  undischarged finding blocks delivery. A lens that returned prose
  twice gets one row: `| <lens> | VOID — <why> | — |`; an empty table
  says `VOID` and why. A lens at Revise or Fail with no row naming what
  to change is VOID. A candidate's waiver is the outcome `discarded —
  candidate waived in chat <date>`.
- `## Fields` — every field the form collects, bucketed Standard /
  Screening / Essays; each with its value, or `NEEDS CANDIDATE`, or
  `predicted` when the field set came from a form you could not open
  (a prediction decides what to draft; the live form replaces it before
  filling). Essays carry the source grounding each answer.
- `## Answers` — ready-to-paste blocks labeled by question + type +
  story used, then **Flagged Gaps** — what the candidate must supply.
- `## Submission` — the captured confirmation (number / screenshot /
  email trigger) and the date. Absent until a confirmed submit; never
  written from memory.
- `## Outreach plan` — the summary: recruiter + hiring manager (+
  founders at startups), each with its send channel and the message
  drafted, or the honest "no findable X" line. The leads and drafts
  themselves live in `contacts/<company>.md` — outreach's file,
  outreach's rules.

## `applications/<company_key>-<title_key>-resume.md` — the tailored résumé

The `.md` is the artifact; the PDF is the deliverable that gets
uploaded. Sections in `patterns.md § Shape` order. Experience bullets are
the base's own sentences except the declared `## Reworded` pairs.

- `## Reworded` — IN THE RÉSUMÉ FILE: each approved rewording as a
  `base:` / `tailored:` pair. `scripts/check_materials.py` exempts
  exactly these lines and still FAILs any other non-verbatim bullet;
  the language checker reads the same block.

- The PDF is rendered by `scripts/render_resume.py` only — it owns the
  markup, the escaping, and the measurement (words · pages against the
  target · file size against the upload limit the script states). Its filename is
  the one human-facing name: `<Candidate Name> - <Company> - Resume.pdf`.

## `applications/<company_key>-<title_key>-cover-letter.md`

Length bounds are `check_materials.py`'s advisory WARNs. Opens on the pitch's core
statement when `pitch.md` exists. Gets a PDF only when a form takes one.

## The rubric line — shipped with every artifact, each artifact's OWN rubric

    rubric: thesis ✓ · single argument ✓ · their language ✓ · traced numbers ✓ · forward close ✓ (290w)

The letter's is the conversion rubric (`eval.md`); an outreach message
carries outreach's message rubric. An unmet item is shown as ✗ with the
tradeoff, never dropped.

## Writes outside the manifest

- `base-resume.md` — **anything they ruled on** (a conceded claim
  struck, a declined proposal recorded, a wording they approved) is
  written same-turn; **a new fact or an unruled conflict is PROPOSED,
  never written** (`../../profile/SKILL.md § State`).
- `contacts/<company>.md` rows — via outreach's playbooks, under
  outreach's rules.
- `plan.md § Waiting-on-you` — one "gap interview open" line while any
  coverage row is `open` (coach owns the file). A row left `open` parks
  a standing line there and returns next session — write skipped rows
  `skipped`.
- `jobs.md` — the row moves to Applied via
  `../../search/scripts/update_job.py` after a confirmed submit only; a
  closed posting is dismissed with reason "posting closed".
