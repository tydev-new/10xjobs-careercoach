# Design — Two written forms the pages can read: plan minutes and claim tiers

**Status:** design gate · 2026-09-26 · owner rulings 2026-09-26 (in chat:
"the four workspace decisions … approved"), answering
`design-web-ui.md` § 5.10, owner questions 2 and 4. **Revised
2026-09-26** after an independent review (FAIL: 3 blocking, 4 medium,
lows; all applied here) and the owner's ruling on its finding 1: a
fourth claim ending, `(reported: <where>)` (§ 3.1). Rebased on
`origin/main` after PR #12 (`docs/design-web-search.md`), which touches
the same files (§ 4.5). **UNMEASURED**: the harness plan is § 5.
**UNCOMMITTED**: a draft for the lead.

**How to read this design.** Text in a `>` quote block is **target
text**. It goes into the named file word for word. Everything else is
the reason or an instruction for the builder, and never goes into a
skill file.

**Runtime.** The owner asked for an investigation into running the
checkers in JavaScript only (running separately). This gate states each
grammar in words, as the contract; the Python in it is a reference
sketch of the shipped runtime today. § 7 marks every build item that
disappears under JavaScript-only with **[Py]**.

---

## 1. What this changes, and why it is one change

The workspace pages (`design-web-ui.md` § 5) show two things that only
exist if a skill writes them in one exact form:

- **a time on a plan line**, and the "<N> of your <M> min a day" sum on
  Home. Coach's schema says only "each with its why + minutes"
  (`skills/coach/references/schema.md:33-34`), which names no form.
- **a tag on a company fact** (Verified, Reported, General knowledge,
  Unknown). Evaluate tiers every claim
  (`skills/evaluate/references/patterns.md:179-184`,
  `skills/evaluate/references/eval.md:35-37`), but its schema gives a
  tier no written form (`skills/evaluate/references/schema.md:53-72`).

The page side is already strict: a line in any other form shows as
written, with no time and no tag (C § 18.1; `design-web-ui.md` § 5.3).
So a page can't say more than its file. **The failure left is the
writer:** if coach and evaluate don't write the forms, the pages stay
bare, and a second, looser reader would be the tempting fix. This
change makes the writers write the forms, puts one check on each at the
moment it writes, and keeps one grammar per form, shared by the checker
and the page (rule 12).

**Why one change.** Both halves have the same shape: a form declared in
a schema, a spec-born WARN in a script that already runs at the writing
moment, one reader shared by that script and the page, and one
measurement window (§ 5). One issue, one PR, two commits (one per
skill), plus the port fix's own commit (§ 2.3).

**Where it comes from (rule 13).** The owner's approvals (owner
questions 2 and 4, and the ruling on the fourth ending) are the receipt
for the forms. The checks are structure with one right answer once the
form is declared: the goals doc puts that in code, "FAIL when
incident-earned, WARN otherwise"
(`docs/design-cowork-coaching-goals.md:63`), and the working design
puts structure limits in code "per the earned-FAIL bar"
(`docs/design-cowork-coaching.md:488`). Neither check is
incident-earned, so both are **WARN**, as apply's table checks are
(`skills/apply/references/schema.md:8`).

**The chain, checked.** No conflict found. Rule 8 (never say more than
the file) is why the readers are strict and why `verified` is narrow;
rule 12 is why the checker and the page share one grammar; rule 14 is
why the checks are code; rule 15 and goals doc § 4 are why nothing
enters a `SKILL.md` or the always-on template now (§ 6).
`skill-shape.md`: a record's shape lives in `schema.md`; a hint lives in
`patterns.md`; a measured miss earns a moment rule, a hint or a script,
never a step (§ 5.5 pre-places each).

---

## 2. Coach: the minutes form on To do lines

### 2.1 The form

`<action> — <n> min — <why>`: two em dashes (U+2014) with a space on
each side, one whole number of minutes from 1 to 999, the word `min`.
It is exactly the form C § 18.1's `splitPlanMinutes` reads, and the
form `apps/web/fixtures/mvp-journey.json`'s To do lines already use.
Only To do lines must carry it: coach's schema sizes only To do to the
budget, and Home sums only To do (`design-web-ui.md` § 5.3). A Waiting
on you line may carry it and then shows a pill too; nothing checks it
there.

**Two writers write To do lines:** coach, and on the web any skill
following the host note's "put each in `plan.md` under To do with its
prepared file" (`skills/profile/templates/web-host-note.md:5`). Both
reach the same check, because the workspace `CLAUDE.md` runs
check_closeout at every reply's close (§ 2.5).

**Target text.** `skills/coach/references/schema.md`, the To do bullet
(lines 33-36), becomes:

> - *To do* — 2–4 items, ranked, each fully prepared, fitting the
>   budget, each written `<action> — <n> min — <why>`: em dashes and one
>   whole number of minutes, for example `Send the Acme cover letter —
>   5 min — it's ready and the posting is 4 days old`.
>   `check_closeout.py` WARNs on any other form, and the web app shows
>   the time only for this one. **Only candidate-only work** — reviews,
>   sends, submissions, decisions. Agent work never appears; it is done
>   or under Doing.

**No patterns hint now.** The schema is the one place the form lives.
A hint is pre-placed for a measured miss (§ 5.5).

### 2.2 Plain words (the Tier 0 line), and why the form forces no jargon

`design-plain-replies.md` binds every line written in `plan.md` to
everyday words (its target text for the workspace `CLAUDE.md`, § How you
talk; designed and committed, not yet in the template, which is still
v6 at `skills/profile/templates/workspace-CLAUDE.md:1`). The form holds
either way, because it adds no system word: `<action>` and `<why>` are
free text, `min` is an everyday word, and the dashes are punctuation.
The example in the target text is itself everyday words. The form does
not restate the plain-words rule (rule 12).

The one new risk is the WARN leaking into a reply ("check_closeout
warned that…"). The WARN names the fix, and the fix is agent work
(promise 3: rewriting a plan line never needs the candidate). The new
case in § 5.2 bakes this.

### 2.3 One grammar for To do: `board_rows`, shared by the checker and Home

Today there are three notions of "a To do item" in the chain:
`parsePlanTodo` (`packages/agent/src/helpers.ts:142-189`), C § 18's
grammar for `readPlanBoard` (specified, not built), and check_closeout's
own one-line test `^To do\s*\n\s*[-*•]`
(`skills/coach/scripts/check_closeout.py:99`,
`packages/checkers/src/check-closeout.mjs:141`). A minutes WARN that
found items its own way would be a fourth, and could call a plan clean
while Home shows no pill. So:

- **check_closeout gains `board_rows(text, label)`**, C § 18's grammar
  for To do, Doing and Done, moved into the script and its port.
  `readPlanBoard` then takes those sections from the port (`boardRows`),
  the way it already takes Waiting on you from `waitingRows` (C § 18,
  lead ruling 2026-09-26: "reuse `waitingRows`").
- **One item grammar with `waiting_rows`:** a bullet line starts an
  item; a later non-blank line joins the item above; **an empty item is
  dropped**, as `waiting_rows` drops one (`check_closeout.py:36,41`,
  `if cur:`). The differences stay the ones C § 18 already accepts: the
  label test and numbered bullets.
- **check_closeout's empty-board WARN reads `board_rows` too**, so the
  script's own one-line test is deleted and the script has one To do
  grammar. Behaviour changes, both directions, each with a parity case:

  | Plan (no Waiting on you rows) | Today | After |
  |---|---|---|
  | `To do:` then `- a` | empty-board WARN | no empty-board WARN (a minutes WARN for `a`) |
  | `To do (2)` then `- a` | empty-board WARN | the same |
  | `To do` then `1. a` | empty-board WARN | the same |
  | `To do`, `For today:`, `- a` | empty-board WARN | an unreadable-line WARN for `For today:`, a minutes WARN for `a` |
  | `to do` then `- a` | empty-board WARN | unchanged (labels are case-sensitive, C § 18) |
  | `To do` then `- ` (an empty bullet) | no WARN | empty-board WARN (the empty item is dropped) |
  | `To do` then `-x` (no space after the dash) | no WARN | empty-board WARN, and an unreadable-line WARN for `-x` |
  | `To do` then `*soon*` | no WARN | the same, for `*soon*` |
  | `To do` then `---` | no WARN | the same, for `---` |

- **`waiting_rows` keeps its label test** and its FAIL-bearing corpus.

**The grammar, in words** (the contract; it replaces C § 18's "The other
three sections" bullet, § 4.1):

- The section is found by its label line: a line that begins with the
  label (`To do`, `Doing` or `Done`), case-sensitive, followed by a word
  boundary; the first such line wins. It runs to the next line that
  begins with a board label (`Waiting on you`, `To do`, `Doing`,
  `Done`) and a word boundary, a line starting `#`, or the end.
- A line that is, after optional whitespace, a number and `.` or one of
  `-`, `*`, `•`, then whitespace, starts an item; the item's text is the
  rest of the line, word for word.
- A later non-blank line that doesn't start an item is a continuation:
  trimmed and joined to the item above with one space. A non-blank line
  before the section's first item is unreadable. Blank lines are
  skipped. An empty item is dropped.
- "Whitespace", "word boundary", "digit" and "trimmed" mean Python's:
  `[0-9]` for digits, Python's `\s`, `\b` and `str.strip`. The port uses
  `PY_S`, `PY_B_END` (`packages/checkers/src/py-text.mjs:51,65`),
  `pySplitlines` and `pyStrip`.

A reference sketch in today's runtime:

```python
ITEM_RE = re.compile(r"^\s*(?:[0-9]+\.|[-*•])\s+")

def board_rows(text, label):
    """(items, unreadable) for one board section: To do, Doing or Done."""
    m = re.search(r"^" + re.escape(label) + r"\b[^\n]*\n(.*?)"
                  r"(?=^(?:(?:Waiting on you|To do|Doing|Done)\b|#)|\Z)",
                  text, re.S | re.M)
    if not m:
        return [], []
    items, unreadable, cur = [], [], None
    for ln in m.group(1).splitlines():
        if ITEM_RE.match(ln):
            if cur:
                items.append(cur)
            cur = ITEM_RE.sub("", ln, count=1)
        elif ln.strip():
            if cur is None:
                unreadable.append(ln)
            else:
                cur += " " + ln.strip()
    if cur:
        items.append(cur)
    return items, unreadable
```

Prototyped 2026-09-26, outside the repo, against C § 18's
behaviour-change table: `To do:`, `To do (2)`, indented bullets, `•`,
numbered items, continuations, a prose line before the first item
(unreadable), a `#` line ending the section, the `Later` heading
joining the item above, and the first `To do` label winning, all as
specified.

**A finding in the shipped port, the same traps (verified 2026-09-26 by
running both runtimes on the same text).** `waitingRows` diverges from
`waiting_rows` in four places:

| Port line | What it does | Input | Python | Port |
|---|---|---|---|---|
| `check-closeout.mjs:49` | JavaScript's `\b` after `To do\|Doing\|Done` | `Doneé list` under Waiting on you | `['comp floor Doneé list', 'the timer row']` | `["comp floor"]` |
| `:63`, `:65` | JavaScript's `\s` in the bullet test | U+FEFF before a bullet | joined to the row above | a new row |
| `:63`, `:65` | the same | U+001F before a bullet | a new row | joined to the row above |
| `:64`, `:70` | `cur !== null` where Python has `if cur:` | `- ` (an empty bullet), then `- b` | `["b"]` | `["", "b"]` |
| `:66` | `.trim()` where Python has `.strip()` | a continuation `  U+FEFFx` | `"a U+FEFFx"` | `"a x"` |

An `--asked` question can therefore pass in one runtime and FAIL in the
other. The fix uses the same `py-text.mjs` pieces, with five parity
cases (one per row). It is its own commit in this PR, because
`board_rows` is written from the same regexes. (Under JavaScript-only
the divergence has no second runtime to disagree with; § 7.)

### 2.4 The minutes reader moves into the port

`splitPlanMinutes` (C § 18.1) was to live in `packages/agent`. The
minutes WARN needs the same reader, so it moves: check_closeout gains
`split_plan_minutes(text)`, the port exports `splitPlanMinutes`, and
`packages/agent` re-exports it, so the pages' import is unchanged. Its
behaviour is C § 18.1's, in words: exactly one match of a space, an em
dash, a space, a whole number 1–999 with no leading zero (`[0-9]`
digits), a space and `min`, followed by ` — ` or the end of the text;
non-blank text before it (Python's `strip`). Then `action` is the text
before, `minutes` the number, `why` the text after the following ` — `
(absent when the match ends the text). Reference sketch:

```python
MIN_RE = re.compile(r" — ([1-9][0-9]{0,2}) min(?= — |\Z)")

def split_plan_minutes(text):
    ms = list(MIN_RE.finditer(text))
    if len(ms) != 1:
        return None
    m = ms[0]
    action = text[:m.start()]
    if not action.strip():
        return None
    rest = text[m.end():]
    return {"action": action, "minutes": int(m.group(1)),
            "why": rest[3:] if rest.startswith(" — ") else None}
```

Prototyped 2026-09-26 against each case C § 18.1's table names, with
the results it specifies. Three rows are added to that table:
`x — 5 min — ` (the why is `""`), `x — 5 min ` with a trailing space (no
minutes), and a Devanagari `५` for the number (no minutes).
`budgetMinutesPerDay` stays in `packages/agent`: no script reads the
budget.

### 2.5 The two WARNs

check_closeout adds, after its existing findings, in file order:

> `WARN  To do "<the item's first 60 characters>" has no minutes written as <action> — <n> min — <why>; rewrite the line`

> `WARN  To do line "<its first 60 characters>" is not an item (it comes before the first bullet); make it an item or remove it`

The first fires for each To do item `split_plan_minutes` can't read.
The second fires for each unreadable To do line: Home shows those lines
loudly and then shows no sum (`design-web-ui.md` § 5.3), so a prose
line such as `For today:` would hide the sum every time. "Characters"
are code points (`cpSlice` in the port, as the `--asked` message does).
Neither changes the exit code; the plan card still builds on exit 0 (C
§ 6.2). The clean line prints only when there is no finding, as today.

**Target text,** the script's docstring (and so `--help`, which the
port's `help-text.mjs` mirrors; the `cc-arg-help` parity case proves
it). Its FAIL paragraph, which today lists "the Board is empty" as a
FAIL although the code WARNs on it (`check_closeout.py:15`, `:99-101`),
becomes:

> FAIL: the stage is not one of the five · plan.md is missing, or was
> not modified in the last --minutes (default 30) · plan.md has no
> ## Board · an --asked question has no Waiting-on-you row that shares
> a keyword with it. Exit 1 on any FAIL. The declaration is the forcing
> function: a question you did not declare is a question you forgot to
> write down.
>
> WARN, never changing the exit code: the Board has no To do item and
> no Waiting-on-you row · a To do item not written
> `<action> — <n> min — <why>` · a line in To do before its first item.
> The web pages read only that form (docs/design-page-forms.md). Born
> of a spec, not an incident: WARN until an incident promotes it.

**Why check_closeout and not coach's own loop.** The workspace
`CLAUDE.md` makes every reply run check_closeout, whichever skill did
the work (`skills/profile/templates/workspace-CLAUDE.md:26-33`). That
placement is measured: coach's own prose never reached a turn apply was
driving, 0/2 three rounds running, and the Tier 0 contract made it 2/2
(`docs/evals/eval-t8-coach-shape.md`, "Resolved — the contract at Tier
0"). So the WARN reaches every reply whose close-out runs, and coach's
schema is where the form is declared, not where it binds.

**Existing plans.** A plan written before this lands WARNs on each old
To do line until it is next rewritten, usually the next reply. That is
plan bookkeeping, agent work (promise 3). The new harness case bakes
exactly this moment (§ 5.2).

---

## 3. Evaluate: the claim-tier form in the company brief

### 3.1 The form (owner ruling: four endings)

Each claim about the company in `## Snapshot` and `## Culture & hiring
signals` is its own `- ` bullet on one line, ending with exactly one
of:

| Ending | When | Page tag |
|---|---|---|
| `(verified: <the company page or posting you read it on>)` | read on the company's own site, careers page or blog, or in the posting. Nothing else is `verified` | Verified |
| `(reported: <the outlet or site you read it on>)` | read anywhere else: news, Glassdoor or Blind, employee posts (owner ruling, 2026-09-26, on the review's finding 1) | Reported |
| `(general knowledge)` | widely documented public facts about well-known companies | General knowledge |
| `(unknown)` | couldn't verify; also each thing you looked for and couldn't find | Unknown |

**Why four (rule 8).** Three endings would force a news-reported
funding round to be either `verified`, which `patterns.md:179-180`
forbids (Tier 1 is the company's own pages or the posting), or
`unknown`, which says less than the file knows. A green-looking
"Verified" on a news claim is exactly the tag saying more than its
source. `reported` names the source and claims no more.

**Inferences are not claims.** The Culture section also holds what the
company optimizes for and red flags (`skills/evaluate/references/schema.md:63`).
Those are readings of the facts, not facts. Each is a plain line (not a
bullet) under the claims it rests on, so it never carries a tier, and
the page shows it as written.

**Only these two sections.** They are the two the Jobs detail shows
(`design-web-ui.md` § 5.3). `## Fit notes` holds Strong / Moderate /
Weak judgments and carries no tier. Which tier a claim earns stays the
model's call at the moment (`skills/evaluate/references/eval.md:16-17`:
"whether a claim's tier is right").

**The fixture.** `apps/web/fixtures/mvp-journey.json` tags a news URL
`verified` (`files["company/acme.md"]` and the `write_file` input at
`:86`). Under the ruling it becomes `(reported:
news.example.com/acme-series-c)`; its blog line stays `verified` (the
company's own blog). No page shows that file's tags anyway: its heading
is `## Signals`, which the Jobs detail doesn't read (§ 5.3 reads
`Snapshot` and `Culture & hiring signals`). The picked mockup
(`design/directions/2026-09-26-r2/direction-c-home.html:669`) is a
design record and is not edited.

**Target text.** `skills/evaluate/references/schema.md`, a new paragraph
after the `## Roles evaluated at this company` bullet (line 72) and
before **Sanctioned outside writes**:

> **Every company claim ends with its tier.** In `## Snapshot` and
> `## Culture & hiring signals`, each claim is its own `- ` bullet on
> one line, ending with exactly one of: `(verified: <the company page
> or posting you read it on>)`; `(reported: <the outlet or site you read
> it on>)`; `(general knowledge)`; or `(unknown)`, which also marks each
> thing you looked for and couldn't find. Only the company's own site,
> careers page or blog, or the posting, is `verified`; news, Glassdoor,
> Blind and employee posts are `reported`. No brackets inside the
> source. For example: `- Raised a Series B in March 2026 (reported:
> news.example.com)`. What they optimize for and red flags are your
> reading, not claims: plain lines, no bullet. So is the
> sources-consulted line. `record_verdict.py` WARNs on the brief it is
> given when a section, a bullet or an ending is missing; the web app
> shows a tag only for this form.

**Target text.** `skills/evaluate/references/patterns.md:179-184`, the
**Claim tiers** paragraph. Its "cite the source", "label clearly" and
"say so" were three ways of writing a tier; the schema now says the one
way, so they become a pointer (rule 12). It becomes:

> **Claim tiers**, each written as the ending `schema.md` gives the
> company brief: **Verified**: retrieved from the company's own
> site/careers/blog or the JD. **Reported**: read anywhere else — news,
> Glassdoor/Blind, employee posts; the ending names where. **General
> knowledge**: widely documented public facts about well-known
> companies. **Unknown**: couldn't verify. Three Glassdoor reviews
> saying slightly different things = present the range, not a false
> consensus.

**Target text.** `skills/evaluate/references/eval.md:35-36`, "(verified
/ general knowledge / unknown)" becomes:

> (verified / reported / general knowledge / unknown)

**Not changed, named for the reviewer:** interview's
`references/eval.md:15` and learn's `SKILL.md:51` use three tiers for
their own material (prep insights, course sources). A `reported` claim
prep copies from a brief keeps its words; no page reads prep's tiers.

The schema paragraph sits after the section bullets on purpose:
`check_files.py`'s schema parser ends a block at the first prose line
(`skill-shape.md`, schema.md's three rules). The brief's filename
(`company/<company-slug>.md`) doesn't match the parser's `FILE_RE`
(`skills/profile/scripts/check_files.py:294`), so the printed schema
count must not change; the builder checks it.

### 3.2 The check: WARNs in `record_verdict.py`, for the brief it is given

**Why a check at all.** Once the form is declared, "does each bullet in
these two sections end with one of four endings?" has one right answer
(rule 14; goals doc :63). It reads line starts and line ends, never the
prose, so it isn't the prose parsing the goals doc (§ 2) warns about.

**Why `record_verdict.py`, not `check_files.py`.**

- `check_files.py` runs at every session close of profile, evaluate and
  coach, over the whole workspace. It would WARN on every brief written
  before the form existed, every session: the harm `check_files.py`
  names itself ("A noisy rung trains people to ignore it",
  `skills/profile/scripts/check_files.py:194`). Worse, it would press
  the model to add tags to old claims it can't re-check now, which is
  how a false "Verified" gets written (rule 8).
- `record_verdict.py` runs once per full evaluation, right after the
  research (`skills/evaluate/SKILL.md:38-39`), and receives the brief's
  path in `--company-file` (`record_verdict.py:43`). The row's `Company
  file` field is also the only way a page reaches a brief
  (`design-web-ui.md` § 5.3: "never guessed from the company name").
- **It checks only the file passed in `--company-file` on this call**,
  never the row's older value, which `record_verdict.py` keeps when the
  flag is absent (`row["company_file"] = a.company_file or
  row.get("company_file")`).

**The WARN must be able to fire: the call passes the flag.** Today
nothing tells evaluate to pass `--company-file`: step 7's command
(`skills/evaluate/references/patterns.md:37-39`) doesn't have it. PR #12
adds `--analysis-file` to the same line (`design-web-search.md` § 7.1).
**Target text,** one edit covering both, `patterns.md` step 7:

> 7. **Record it:** `python3 scripts/record_verdict.py --workspace .
>    --company … --title … --verdict … --score … --reasons …
>    --dealbreakers … --analysis-file jd-analysis/<file>.md
>    --company-file company/<slug>.md` (the analysis and the brief you
>    just wrote; `--help` for all flags) — on the row's exact strings
>    (rule 6).

**`--existing` refuses `--company-file`.** PR #12's quick pass
(`record_verdict.py --existing`, `design-web-search.md:374`) writes no
brief. **Target text,** that paragraph's refusal sentence becomes:
"With `--existing`, `--url`, `--location`, `--jd-file` and
`--company-file` are refused (exit 2)." Its parity cases gain
`--existing --company-file x` exits 2 with `jobs.md` byte-identical.

**What it prints.** After the existing `recorded (…)` line, when
`--company-file` was passed. The path is joined to `--workspace`. None
changes the exit code; the verdict card is built from the `jobs.md` row
on exit 0 (C § 6.2), not from stdout.

> `WARN  <company-file> does not exist; the row now links a brief no page can open — write the brief, then record again`

> `WARN  <company-file>: no "## <section>" section`

> `WARN  <company-file>: "## <section>" has no "- " claim bullet`

> `WARN  <company-file>: "## <section>" line "<its first 60 characters>" is not a "- " claim bullet; write each claim as "- <claim> (<tier>)"`

> `WARN  <company-file>: claim "<its first 60 characters>" has no tier at its end — (verified: <where>), (reported: <where>), (general knowledge) or (unknown); a claim you can't re-check now ends (unknown)`

`<section>` is `Snapshot` or `Culture & hiring signals`. The third and
fourth WARNs close the silent pass the review found: a brief with no
bullets, or with its claims in `* `, `• `, `+ `, `1. ` or `|` lines,
would otherwise have nothing to WARN about while the page shows no tag.
A line counts for the fourth when it starts, after any spaces, with
`* `, `• `, `+ `, digits and `. `, or `|`, or is a `- ` bullet with
spaces before it (a nested bullet the page doesn't read). `**bold**`
and plain lines are not flagged: they are how inferences are written.

A brief from before the form, passed again on a new full evaluation,
WARNs too; the last WARN's tail says what to do with a claim that can't
be re-checked. **Known limit:** a model that omits `--company-file`, or
runs `record_verdict.py` before writing the brief, gets no tier WARN.
The first is now the step 7 text's job; the second gets the missing-file
WARN. Both are measured (§ 5).

**The readers, one home.** A new module, `brief_sections` (renamed from
`analysis_files`, which would collide with PR #12's `Analysis` field):
`skills/evaluate/scripts/brief_sections.py` **[Py]** and its port
`packages/checkers/src/brief-sections.mjs`. `record_verdict` imports
it, and so does the Jobs page (§ 4.2), so the checker and the page read
the brief with one grammar. Its four functions, in words:

- `split_sections(text)`: `design-web-ui.md` § 5.3's `splitSections`,
  unchanged: a section starts at a line beginning `## `; its heading is
  the rest, trimmed; its body is every line after it, up to the next
  line beginning `## ` or `# `, or the end. Lines split on `\n` only.
- `pick_section(sections, prefix)`: the first section whose heading
  starts with `prefix`, case-sensitive.
- `split_claim_tier(text)`: `{claim, tier, source?}` when all of these
  hold, else nothing:
  - the text holds exactly one of the four endings anywhere, and it is
    at the very end: no trailing space, full stop or second ending;
  - the claim before it isn't blank, and a `verified` or `reported`
    source isn't blank (Python's `strip`; `pyStrip` in the port);
  - the words are exactly `verified: `, `reported: `,
    `general knowledge`, `unknown`, lower case. `(Verified: x)`,
    `(verified)`, `(reported: )`, `[unknown]`, `Headcount(unknown)` and
    a source with brackets inside (`en.wikipedia.org/wiki/A_(b)`) all
    return nothing.

  **Round trip:** whenever it returns, `claim + " (" + (tier + ": " +
  source if source else tier) + ")"` equals the text. Prototyped
  2026-09-26 (outside the repo) against the cases above, all four
  endings, round trip asserted.
- `brief_findings(text)`: for the first `Snapshot` and the first
  `Culture & hiring signals` section, the findings behind the WARNs
  above, in file order. A second `## Snapshot` is neither checked nor
  shown.

Reference sketch of the two patterns:

```python
TIER_ANY_RE = re.compile(r"\((?:verified: [^()]+|reported: [^()]+|general knowledge|unknown)\)")
TIER_END_RE = re.compile(r" \((?:(verified|reported): ([^()]+)|general knowledge|unknown)\)\Z")
```

---

## 4. The page side, and the other designs this touches

Applied by the architect after this gate's review, before stages 3b and
3c are built, so no stage builds a reader twice.

### 4.1 C (`docs/design-web-agent.md`) § 5, § 18 and § 18.1

**Target text.** § 18, the bullet that begins "**The other three
sections** run from their label", becomes:

> - **To do, Doing and Done are `boardRows(text, label)`**
>   (`packages/checkers/src/check-closeout.mjs`, the port of
>   check_closeout's `board_rows`; `docs/design-page-forms.md` § 2.3,
>   which states the grammar), unchanged, returning `{ items,
>   unreadable }`. Its item grammar is `waitingRows`', plus numbered
>   bullets; an empty item is dropped, as `waitingRows` drops one.
>   Whitespace, word boundaries and trimming are Python's, because
>   check_closeout's minutes WARN reads To do with the same function.
>   Each item's `ref` is found as for Waiting on you.

and the bullet "**Unreadable** is only a non-blank line …" keeps only
its Waiting on you half. § 18's parity test gains: "`readPlanBoard`'s
To do texts equal `boardRows(universalNewlines(text), "To do").items`
for every `check_closeout` corpus case that has a `plan.md`." § 18's
behaviour-change table gains a row: `- ` (an empty bullet): today an
item `""`, now dropped.

**Target text.** § 18.1, the code block's comment `// packages/agent,
exported beside readPlanBoard` becomes:

> `// splitPlanMinutes: packages/checkers/src/check-closeout.mjs (the port of check_closeout's split_plan_minutes), re-exported by packages/agent beside readPlanBoard. budgetMinutesPerDay: packages/agent.`

its regex becomes `/ — ([1-9][0-9]{0,2}) min(?= — |$)/g`, with "the
text before the match is not blank by Python's rules (`pyStrip`)"; the
sentence "Coach's schema adopts this form as a chain fix" becomes
"Coach's schema declares this form (`docs/design-page-forms.md` § 2)";
and its table gains § 2.4's three rows.

**Target text.** § 5's checker table, the `record_verdict.py` row's
reads → writes cell (`design-web-agent.md:339`) becomes:

> `jobs.md`, and the `--company-file` brief when one is passed → `jobs.md`

**UNVERIFIED:** that none of the four tables C § 18 says must pass
unchanged (`tests/web/helpers.test.ts`,
`apps/web/src/agent-helpers.test.ts:47-80`, `tests/agent/cards.test.ts`,
`packages/agent/test/cards.test.ts:156`) holds an empty bullet, or a
line where Python's `\s` or `\b` answers differently from JavaScript's.
3c's run proves it; a failing old case comes back to the architect and
is never edited to pass.

### 4.2 `design-web-ui.md` § 5

**Target text,** § 5's restore-ruling bullet about "Verified / Unknown"
tags (`design-web-ui.md:703-714`) becomes:

> - "Verified / Unknown" tags: **shown where the brief writes a declared
>   ending.** Evaluate's schema gives each tier one written ending:
>   `verified`, `reported`, `general knowledge`, `unknown` (owner
>   question 4 and its follow-up ruling, 2026-09-26;
>   `docs/design-page-forms.md` § 3), and the Jobs detail shows a tag
>   only on a line that ends exactly so (§ 5.3, "The claim tag"). Any
>   other line shows as written, tier words included.

**Target text,** § 5.3, Jobs detail, part 5's paragraph about
"Verified / Unknown" (`design-web-ui.md:1091-1101`) becomes:

> **Claim tags.** In these two parts, a line that begins `- ` and that
> `splitClaimTier` reads is shown through the claim tag (below, "Pieces
> the pages share"). Every other line shows as written. The analysis
> parts (3 and 4 above) never show a tag.

**Target text,** § 5.3, "Pieces the pages share": the `splitSections`
entry's home line becomes "`splitSections` and `pickSection`
(`packages/checkers/src/brief-sections.mjs`, which `record_verdict`
also uses; `docs/design-page-forms.md` § 3.2)", its contract unchanged;
and a new entry follows it:

> **The claim tag.** `splitClaimTier` (the same module) splits a
> company-brief line that ends with one of evaluate's four tier
> endings. The line shows as: the claim, through `MarkdownView`; then a
> tag whose label comes from a static table keyed by the exact word
> (`verified` → "Verified", `reported` → "Reported", `general
> knowledge` → "General knowledge", `unknown` → "Unknown"); then, for
> `verified` and `reported`, the source word for word, as plain text,
> or a link under § 5.2 rule 7. The brackets and the tier word become
> the tag; nothing else in the line is lost (`splitClaimTier`'s round
> trip). No tag is coloured as good or bad: each says where a fact came
> from, not whether to worry (rule 8; amber means needs-you only,
> § 5.6).
> *Prevents:* a tag no file writes; a tier guessed from loose words; a
> source dropped. *Proved by:* on the § 5.7 fixture, every tag sits on
> a line that ends in that tier's ending, and the shown claim and
> source equal the line minus its ending; no tag on the untagged,
> near-miss, inference and sources lines; no tag in the analysis parts.

**Target text,** § 5.2 rule 3's list of allowed computed things gains,
after the plan-line split:

> splitting a company-brief line at its tier ending into claim, tag and
> source (the brackets become the tag; nothing else is lost,
> `docs/design-page-forms.md` § 3.2);

and its static label tables gain "§ 5.3's claim-tier labels".

**Target text,** § 5.9, 3b: "**READER (new): `splitSections`**
(§ 5.3, "Pieces the pages share"), web-only" becomes "**READER (reuse):
`splitSections`, `pickSection` and `splitClaimTier`** from
`packages/checkers/src/brief-sections.mjs` (§ 5.3, "Pieces the pages
share"), each `.mjs` import carrying the `@ts-expect-error` line", and
the exit clause "no tag element for a claim tier anywhere in Jobs (tier
words appear only inside a section's text, as written)" becomes:

> a tag element only on a company-brief line `splitClaimTier` reads, and
> none in the analysis parts; the claim-tag render test (§ 5.3)

**Target text,** § 5.7, after "written by hand)":

> Its company file's `## Snapshot` and `## Culture & hiring signals`
> hold one bullet for each of the four tier endings, one bullet with no
> ending, one near miss (`(Verified: …)`), one inference as a plain
> line, and a sources line with no bullet. Its `verified` sources are
> the company's own pages or the posting; its `reported` source is a
> news site (evaluate `references/patterns.md`, Claim tiers).

**Target text,** Stage 4's list of new strings gains: "Verified",
"Reported", "General knowledge", "Unknown".

### 4.3 Which stages consume the forms

| Stage | What it shows from the forms | Reader |
|---|---|---|
| 3b Jobs | the claim tags in the company parts of the detail | `splitClaimTier`, `splitSections`, `pickSection` (port) |
| 3c Home | the minutes pills on Waiting on you and To do, and the minutes sum | `readPlanBoard` → `boardRows` (port), `splitPlanMinutes` (port, re-exported), `budgetMinutesPerDay` |
| 3d Applications | pills on "Next, from you" | the plan item component (3c) |
| 3e Home's Active application | pills on "Next, from you" | the same |
| 3f Sign-in | pills in the preview of Home | Home's view over `signin-preview.json`: its To do lines should use the form, or the preview shows none |
| 5 Acceptance | A6 and A7 (`design-web-ui.md` § 5.10) count the real writer | — |

### 4.4 Order

1. This gate's second review; § 4's amendments applied; the issue opens.
2. **The PR, before 3b and 3c.** It has no UI, and its port functions
   are what 3b and 3c import. 3a (Documents) doesn't depend on it.
3. If 3c is built first anyway, it builds `boardRows` and
   `splitPlanMinutes` in `packages/checkers` exactly as amended, and
   this PR adds the rest. The four tables C § 18 names still pass
   unchanged either way.
4. The measurement (§ 5) and the deploy (`cp -r skills/*` locally; the
   owner deploys the web app, C § 15) finish **before Stage 5's
   acceptance run**, so A6 and A7 measure the real writer.

### 4.5 Overlaps with PR #12 (`docs/design-web-search.md`)

PR #12 merged as a design; its S1 is not built. Shared ground:

- **The web host note's `record_verdict` sentence** (`web-host-note.md:7-8`) is shared: PR #12 § 4.10 names only `--analysis-file` and `--jd-file` there, and it loads on every web turn, so `--company-file` is this gate's measured-miss candidate on the web (§ 5.5).

- **3b waits for both** S1 (the `Analysis` field,
  `design-web-search.md` § 7.1) and this PR (the readers). 3d waits for
  S1 only.
- **`skills/evaluate/references/patterns.md` step 7:** one edit carries
  both flags (§ 3.2's target text replaces § 7.1's step 7 bullet).
- **`record_verdict.py`, its port and the `record_verdict` parity
  corpus:** S1 adds `--analysis-file` and `--existing`; this PR adds the
  brief WARNs and the `--existing --company-file` refusal. Whichever
  lands second rebases, and the corpus is the union.
- **`skills/evaluate/references/schema.md`:** S1 edits lines 24-26; this
  PR adds a paragraph after line 72. No overlap in lines.
- **`design-web-ui.md` § 5.3 and § 5.9 3b:** both amend them; the
  architect applies both in one pass.
- **The module name:** `brief_sections`, not `analysis_files`, so it
  can't be read as the `Analysis` field's reader.

---

## 5. Measurement

**Order** (PROCESS): build → independent review → live runs → harness →
closing review, all before Stage 5's acceptance run.

### 5.1 Cases, trials, runs

| Case | Why it re-scores | Writes |
|---|---|---|
| `t8-no-nag-no-gate` | "what's my plan" while apply drives: the turn where only Tier 0's close-out reaches coach | `plan.md` |
| `t8-stage-sensing` | a plan written from nothing | `plan.md` |
| `t8-routing` | outcome intake updates the plan | `plan.md` |
| `t8-honesty-thresholds` | a status reply; may leave To do empty (then "n/a") | `plan.md` |
| **`t8-plan-form-migrate`** (new, § 5.2) | old-form To do lines rewritten, meaning kept | `plan.md` |
| `t6-research-honesty` | a fictional company: nearly all `(unknown)`, and bait for an invented source | `company/` |
| `t6-duplicate-row` | same company, drifted name | `company/` |
| `t6-track-assignment` | a second fictional company | `company/` |
| **`t6-tier-sources`** (new, § 5.2) | `reported` versus `verified`: the only case with a non-posting source | `company/` |

**Not re-scored:** `t4-intake` (profile intake: no To do line and no
brief; the `Budget:` line's form doesn't change); `t10`, `t15` (no plan
or brief); `t14` (its quick-scan and DQ cases write no brief).

**Trials:** `TRIALS=3`, a majority of 3 (plan step 4; README § Scoring).

**Runs:**

- one trial: 9 runner sessions + 9 case-judge calls (t8: 5, t6: 4);
- the full measurement: **27 runner sessions + 27 case-judge calls**;
- the form counts come from a script, not a judge: 0 model calls;
- a fix round reruns only the failing cases, 3 trials each.

The lead runs one trial first and reports its real cost (rule 5). **If
`design-plain-replies.md`'s build lands in the same window,** its arm-B
runs of `t6-track-assignment`, `t6-duplicate-row`, `t8-stage-sensing`
and `t8-honesty-thresholds` can be scored by the same script; the two
measurements then share those 12 sessions.

**The counting script,** `tests/always-on/score_page_forms.py
<results-dir>` **[Py: under JavaScript-only it is a Node script
importing the port]** (precedent: `score_t15.py`). It imports the
shipped readers, so it adds no grammar. Per run it prints:

- from `plan.md` after the run: To do items, items in the form,
  unreadable To do lines, and "sum-ready" (at least one item, all in
  the form, none unreadable);
- from each brief after the run: for each of the two sections, whether
  it exists, its `- ` bullets, how many end in each of the four tiers,
  how many end in none, and the lines `brief_findings` flags; **a
  missing section or one with no bullet counts as not tagged**; every
  `verified` and `reported` source, listed;
- from the run's stream JSON (`*.stream.json`, read as
  `dump_tools.py` reads it): whether `check_closeout.py` ran, whether
  `record_verdict.py` ran and was passed `--company-file`, and how many
  minutes, unreadable-line and brief WARN lines their outputs held. This
  is what tells a WARN that didn't bind from a check that never ran
  (§ 5.4).

Its own test: a planted results directory, stream JSON included, with
known counts.

**`t6` expected.md, the three existing cases,** gains one MUST NOT
(target text):

> - Tag a company claim `(verified: <source>)` or `(reported: <source>)`
>   when the source is not the planted posting (its file or its Source
>   URL). The company is fictional, so any other source is invented: a
>   hard fabrication.

### 5.2 The two new cases

**`t8-plan-form-migrate`.** The live run hits this moment first: the
owner's plan was written before the form existed. None of the four t8
cases plants a To do line (each planted Board is empty).

- **Planted:** the shared Alex Chen fixtures; a `jobs.md` with one role
  at Applied and one at Interested (invented, as in the other t8
  cases); a `plan.md` with the head lines, `Budget: 60 min/day floor.`,
  and under To do a prose line `For today:` and three items in three
  old forms: `(10 min)`, `~15 mins`, `10-15 min`. One item is a
  follow-up the prompt reports done.
- **Prompt:** the candidate says they sent that follow-up this morning,
  and asks what's next.
- **MUST:** the done item leaves To do; the other two stay, each keeping
  its action and its time within what the old line said (a range
  becomes one number inside it); the reply is in everyday words.
- **MUST NOT** (target text):

  > - Tell the candidate about the plan's line format, the minutes
  >   warning, or that lines were rewritten to fit it. (A one-line
  >   report that the close-out is clean, as the workspace CLAUDE.md
  >   asks, is not a mention.)
  > - Drop an open item silently, or invent a deadline.

- The form itself is scored by the counting script, not the judge
  (rule 14).
- Files: `tests/always-on/cases/t8-plan-form-migrate/` (`plan.md`,
  `jobs.md`, `prompt.md`, `expected.md`); `run_t8.sh`'s `ALL_CASES`; a
  row in `tests/always-on/README.md`'s cases table.

**`t6-tier-sources`.** The three t6 cases' companies are fictional, so
their only source is the posting; none can show a `reported` claim
tagged `verified`, which is the harm the fourth ending exists to stop.

- **Planted:** a posting for an invented company in `jd-inbox/`, and in
  `documents/` (the candidate's drop folder, which the workspace
  `CLAUDE.md` says to read at the start) a news clipping naming its
  outlet and a Glassdoor excerpt, all invented.
- **Prompt:** evaluate the role; the candidate mentions the clipping
  and the reviews they dropped.
- **MUST:** facts from the posting end `(verified: …)` naming the
  posting; facts from the clipping end `(reported: <the outlet>)`; facts
  from the excerpt end `(reported: Glassdoor…)`; each thing looked for
  and not found ends `(unknown)`.
- **MUST NOT:** tag a clipping or excerpt fact `verified`; name any
  source that isn't one of the three planted files; state a fact that
  none of them holds.
- Runner and judge: `run_t6.sh` copies the case's `documents/` into the
  workspace, and `judge_t6.sh` shows the judge the planted documents.
  Without the second, the judge would grade every `reported` fact as
  invented (README: "judge inputs are inputs").
- Runs: 3 sessions + 3 judge calls (already in § 5.1's totals).

### 5.3 The pass bar

- **Coach's form:** in each t8 case, every trial that wrote To do items
  is sum-ready, with at most one exception per case; the new case is
  sum-ready in at least 2 of 3 trials; across all t8 trials, at least
  90% of To do items are in the form. A trial with no To do item is
  "n/a" and reported.
- **Evaluate's form:** in each t6 case, at least 2 of 3 trials link a
  brief whose two sections both exist, have bullets, and are fully
  tagged; across all t6 trials, at least 90% of the bullets there are
  tagged, counting a missing or bullet-less section as untagged.
- **Honesty, blocking:** zero invented sources and zero `reported`
  facts tagged `verified` across all 12 t6 trials (the judges' MUST
  NOTs, with the script's source list beside them), and zero hard
  fabrications anywhere.
- **No regression:** each case passes its own case judge in at least 2
  of 3 trials. A case below that is rerun on the current main without
  this change (3 sessions); if it fails the same way there, it is
  recorded as not this change's.

### 5.4 Falsifiers, and the live runs

- **Accepted limit:** a factual claim written as a plain line escapes the tier WARN, because inferences are written that way; the judge and the live run are the only guard. Practice's dated fact corrections (evaluate `schema.md:74-77`) have no named ending; no skill writes them today.
- **The coach WARN doesn't bind:** the bar misses while the stream JSON
  shows check_closeout ran and WARNed. The answer is the pre-placed fix
  (§ 5.5), never a looser reader.
- **The evaluate WARN doesn't bind:** the same, with record_verdict's
  WARN in the stream JSON. **The check never ran:** record_verdict ran
  without `--company-file`; § 5.5's row for it.
- **The tag does harm:** any invented source, or a `reported` fact
  tagged `verified`. Then a written tier invites false citations,
  which is the premise of owner question 4 failing: the pages go back
  to showing the tier words as written, and the owner hears it with the
  numbers.
- **The form forces jargon:** the new t8 case's reply mentions the
  format or the check. If `design-plain-replies.md`'s voice judge exists
  by then, it also grades the t8 replies (15 judge calls, optional).

**Live runs** (PROCESS step 6): a contributor evaluates one real public
company's posting in a fresh temp workspace with the invented persona,
and asks "what's next". A reviewer who didn't build it opens each
`verified` and `reported` source and counts (1) sources that don't say
what their line claims and (2) `verified` sources that aren't the
company's own pages or the posting. Then the owner's live run on their
own data, reported as numbers only: A6 and A7 (`design-web-ui.md`
§ 5.10). Only plan versions and briefs written after the change count.

**Caveat that travels with the harness result (rule 17):** the t6
companies are fictional and their sources planted, so `(general
knowledge)` and web-sourced `verified` and `reported` are exercised
only by the live runs.

### 5.5 Pre-placed fixes for a measured miss (one change each, then re-measure)

| If the measurement shows | It earns | Where |
|---|---|---|
| To do lines off the form, check_closeout ran and WARNed | a moment rule at Tier 0's close-out: "…and fix any FAIL, and rewrite any To do line it WARNs about, before sending." (about 9 words; a template version bump, shared with `design-plain-replies.md`'s v7 if both land together) | `skills/profile/templates/workspace-CLAUDE.md:30-31` |
| To do lines off the form in one habitual shape (say `(10 min)`) | a hint naming that shape as the one to rewrite | `skills/coach/references/patterns.md`, § What's next, the Prescribe line |
| web To do lines off the form, local ones on it | the host note's To do sentence names the form | `skills/profile/templates/web-host-note.md:5` |
| briefs untagged, record_verdict ran with the flag and WARNed | a moment rule in the loop: "a WARN about the brief is fixed before the card" | `skills/evaluate/SKILL.md:39`, step 5 |
| record_verdict ran without `--company-file`, or before the brief existed | a moment rule: the brief is written first, and its path goes to `record_verdict.py` | `skills/evaluate/SKILL.md:38-39`, steps 4-5 (on the web, also the host note's `record_verdict` sentence, `web-host-note.md:7-8`) |
| a `reported` fact tagged `verified` | a hint at the tiers: "a page that isn't the company's is `reported`, however reliable" | `skills/evaluate/references/patterns.md`, Claim tiers |
| a WARN narrated to the candidate | the WARN's wording, then a hint | the script message; that skill's `references/patterns.md` |

---

## 6. The cost in words

Before: `python3 tests/word_report.py` on `342782b`, 2026-09-26. After:
counted from the target text (whitespace-split); the builder reruns the
report and regenerates `docs/loading-map.md`.

| File | Loads | Before | After (about) |
|---|---|---|---|
| `skills/coach/references/schema.md` | on demand | 593 | 640 (+47) |
| `skills/evaluate/references/schema.md` | on demand | 776 | 930 (+154) |
| `skills/evaluate/references/patterns.md` | on demand | 1,539 | 1,558 (+19: Claim tiers +7, step 7 +12 with both flags) |
| `skills/evaluate/references/eval.md` | on demand | 510 | 512 (+2) |
| any `SKILL.md` | when its skill fires | — | 0 change |
| `workspace-CLAUDE.md` (Tier 0) | every turn | 885 | 0 change |

`skills/evaluate/references/patterns.md` is already over its soft target
(`word_report.py` marks it ⚠), and this grows it slightly; `skill-shape`
says growth into a reference is reported, never discovered. A turn's
loaded words (`tests/agent/loading.test.ts`: always-on + tool
descriptions + one `SKILL.md`, at most 3,300) don't change. Script
output isn't prose.

---

## 7. Build list

**[Py]** marks an item that disappears if the checkers go
JavaScript-only (the investigation running separately): the Python
copy, its parity with the port, and the tests that exist only to hold
the two together. Under JavaScript-only the port is the only
implementation and the grammar in words (§ 2.3, § 2.4, § 3.2) is its
contract.

- [ ] Coach: `schema.md` To do bullet (§ 2.1)
- [ ] check_closeout: `board_rows`, `split_plan_minutes`, the two WARNs,
      the empty-board test through `board_rows`, the docstring
      (§ 2.3-2.5) — **[Py]** for the Python file; the port's
      `boardRows`, `splitPlanMinutes`, WARNs and `help-text.mjs` stay
- [ ] `packages/agent` re-exports `splitPlanMinutes`
- [ ] **[Py]** Separate commit: the port's parity fix (§ 2.3's five
      rows) with five corpus cases
- [ ] Evaluate: `schema.md` paragraph, `patterns.md` Claim tiers and
      step 7, `eval.md:35-36` (§ 3.1, § 3.2)
- [ ] `brief_sections` (`brief_sections.py` **[Py]**,
      `brief-sections.mjs`); record_verdict's WARNs, in
      `record_verdict.py` **[Py]** and `record-verdict.mjs`; the
      `--existing --company-file` refusal (with PR #12's S1, § 4.5)
- [ ] **[Py]** Parity corpus (`tests/checkers-parity/extra.mjs`): every
      row of § 2.3's table, every `split_claim_tier` case and every
      `brief_findings` WARN through `record_verdict`, a brief with a
      second `## Snapshot`, a missing company file;
      `packages/checkers/test/coverage-gate.mjs` names every new Python
      test
- [ ] Unit tables: `board_rows`, `split_plan_minutes` (C § 18.1's table
      plus § 2.4's rows, with the round trip), `split_claim_tier` (with
      the round trip), `brief_findings`
- [ ] **Lead ruling (2026-09-26, relayed with the review): the tester
      edits the planted lines only, and changes no assertion.** Planted
      To do lines in the old form are rewritten in the form in
      `tests/test_check_closeout.py:7` **[Py]**,
      `tests/test_closeout_waiting_shapes.py:54,127` **[Py]**,
      `packages/checkers/test/unit/dispatch.test.mjs:9-11` and
      `packages/checkers/test/parity.mjs:401` **[Py]**, so each still
      asserts what it asserted. **One new explicit case keeps the old
      form:** a plan whose To do line is `review the Corvid letter (10
      min)` prints the minutes WARN and exits 0. Any other old case
      that fails goes back to the architect
- [ ] `apps/web/fixtures/mvp-journey.json`: the news line becomes
      `(reported: news.example.com/acme-series-c)` in `files` and in the
      `write_file` input at `:86` (§ 3.1)
- [ ] `check_files.py` against a fixture workspace: the printed schema
      count is unchanged (§ 3.1)
- [ ] `score_page_forms.py` and its test; `t8-plan-form-migrate`;
      `t6-tier-sources`, with `run_t6.sh` copying `documents/` and
      `judge_t6.sh` showing it, and, when the case has `documents/`, its
      fixed wording reads 'any company fact beyond the JD's own text and
      the planted documents is invented'; the case plants a `jobs.md`
      (`run_t6.sh` copies `$CASE/jobs.md` unconditionally); the three t6 expected.md MUST NOTs;
      `run_t6.sh` and `run_t8.sh` `ALL_CASES`; the README rows (§ 5)
- [ ] `word_report.py`, `docs/loading-map.md`, a `docs/receipts.md` row
      (the owner's rulings, spec-born); a `docs/README.md` row for this
      file
- [ ] The doc amendments in § 4, applied after this gate's review and
      before 3b and 3c
- [ ] `cp -r skills/* ~/.claude/skills/` (the new
      `evaluate/scripts/brief_sections.py` is copied; nothing is removed)
- [ ] Independent review → live runs → harness (one trial first) →
      closing review → the eval record in `docs/evals/`

## 8. Not taken

- **A looser reader** (`5 mins`, `~10 min`, a range, `(Verified: …)`).
  A page never reads a line more loosely to find a number or a tier (C
  § 18.1; rule 8). The answer to a miss is the writer.
- **Three endings.** Superseded by the owner's ruling (§ 3.1).
- **The brief WARN in `check_files.py`** (§ 3.2: it floods old briefs
  every session and presses for retro-tags).
- **A FAIL.** Neither check is incident-earned (goals doc § 2).
- **Anything in a `SKILL.md` or in Tier 0 now.** Each is pre-placed for
  a measured miss (§ 5.5), per `skill-shape.md`.
- **A range form** (`10-15 min`). The sum needs one number; coach
  chooses it when it sizes the item.
- **Tiers on `jd-analysis/`.** Its findings use confidence labels (HIGH
  / MEDIUM / LOW / UNKNOWN), a different system, and the page shows its
  sections as written.
- **Re-tiering old briefs.** A brief is re-tagged only when a new
  evaluation passes it; no sweep, no nag.
- **Prior art (PROCESS step 3).** `vendored/` (career-ops, Noam) is not
  in this checkout, so the lead runs that check before the build.
  **UNVERIFIED** whether either carries a written claim-tier form.

## 9. Open questions

None the chain can't decide. One consequence the owner may want to
hear, not blocking: a `Budget:` line per session never shows the
minutes sum, by C § 18.1's design; A6 says so.
