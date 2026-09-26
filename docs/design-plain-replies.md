# Design — Plain words when Ten talks to the candidate

**Status:** design gate · 2026-09-26 · owner ruling 2026-09-26 (in chat):
adopt the "plain" version of Ten's messages. He chose it when shown two
versions of the same `mvp-journey` conversation side by side. Owner
answers the same day: "the automatic checks" is approved, and the
measurement spend is approved in principle; the lead runs one trial
first and reports its real cost (§ 8). **Revised 2026-09-26** after an
independent review (3 blocking findings, all fixed here).
**UNMEASURED**: the harness plan is § 4. **UNCOMMITTED**: this is a draft
for the lead.

**How to read this design.** Text in a `>` quote block is **target
text**. It goes into the named file word for word. Everything else is
the reason or an instruction for the builder, and never goes into a
skill file (`design-apply-three-lens.md` learned this the hard way).

**Evidence:** the designer's copy proposal, branch
`worktree-agent-a7b2db3c5da9cc5ae`, `design/directions/2026-09-26-r2/README.md`
§ "Target-voice copy proposal", and `direction-c-home.html` (the `T`,
`PLAN` and `ACT` objects).

---

## 1. The failure, and the moments the rule binds

**The failure.** Engineering words reach the candidate: file names,
script names, table and column labels, and words the skills made up.
Today's fixture voice, word for word (`apps/web/fixtures/mvp-journey.json`):

- "Résumé is 109 words (render_resume). Both files pass check_materials's
  mechanical checks, 0 fail and 0 warn each — the language check hasn't
  run yet …"
- "Strong Fit, recorded in jobs.md."
- "That's what's queued in plan.md"
- a plan line: "… more Track A roles …"
- `gate-moment.json`: "so the gate above is still pending"

A candidate has to decode each one. "Track A" only makes sense if you
have read `criteria.md` in its lettered form. "check_materials" and
"mechanical checks" only make sense if you have read the script. It also
gives one thing two names: the picked web direction's rail calls the job
list **Jobs** (`direction-c-home.html`, the rail of Home · Talk to Ten ·
Jobs · Applications · Documents, per the designer's README § "The three
theses"), while the reply says `jobs.md` (rule 12).

**Where the rule comes from (rule 13).** It follows from rule 8: "Honest,
in your voice, or silent … no generic AI jargon", and what Ten writes
"sounds like a capable person in their natural register". Its receipt is
the owner's ruling of 2026-09-26. **UNVERIFIED:** the examples above are
hand-scripted fixtures that copy the voice of real runs. They are not
captured model output. Whether today's skills really leak on the current
model is the first thing the measurement shows (§ 4, the ablation arm).
That arm is also the falsifier for the always-on line.

**The moments it binds:**

1. **Writing any reply to the candidate**, whichever skill is doing the
   work, in both hosts.
2. **Writing a line in `plan.md`.** The web plan card and C's Home show
   the To do lines word for word (`design-web-ui.md` § 2.2), so those
   lines are messages too.

**What it does not bind:**

- **Records the candidate reads as files**: the fields in `jobs.md`
  (`Track: A`, `Verdict: strong`), the tables and `## Rounds` rows in
  an application file, and history rows. A record keeps its schema.
- **The expanded "ran …" rows in the web app**, which show each tool's
  literal input and output (rule 11). The UI owns those (§ 5).
- **Drafts spoken as the candidate** (the résumé, letter, answers and
  messages). They have their own rules: the Tier 0 voice table and
  `language-check.md` rule 6, `search_jargon`.

**Words that stay.** These are the product's own words, and the
candidate sees them on screen:

- the four verdict names ("Strong Fit" and the rest; the verdict card
  shows them, `design-web-ui.md` § 2.1);
- the stage names (groundwork, searching, applying, interviewing,
  deciding);
- "base résumé";
- "your plan" and "your job list".

A file path is allowed as a pointer the candidate can open, after the
thing's plain name.

**Why the list differs from `search_jargon`.** That rule bans "Strong
Fit" in documents that go to an employer, because the employer never
saw Ten's verdict. The candidate did. So the two lists differ on
purpose, and neither replaces the other.

## 2. The rule, and its one home

### Where it lives: the workspace `CLAUDE.md` template, § How you talk

Not coach. There are three reasons, all from the chain:

1. **Coach isn't loaded when the leaks happen.** Coach loads when its
   description matches "what should I do today" and similar. The
   leaking replies above came from apply and evaluate turns. Goals doc
   § 2: a guardrail that has to fire before (or without) its skill
   loading is always-on. The precedent is already in the file: *"Every
   reply closes, whichever skill did the work."*
2. **One file serves both hosts.** The web app's always-on block starts
   with the bundled `skills/profile/templates/workspace-CLAUDE.md`,
   byte for byte (`design-web-agent.md` § 7, and a test already proves
   it). Claude hosts load the workspace copy. No other text is in every
   turn in both hosts.
3. **§ How you talk is already where Ten's reply style lives** ("Short;
   lead with the answer …"). The new text joins it. It doesn't start a
   new section.

**The kind of rule (CLAUDE.md: a moment rule, a hint, or a script,
never a step).** This is the always-on form of a moment rule. It binds
at the moment a reply or plan line is written. It can't be a hint,
because hints load on demand and the moment is every turn. It can't be
a script, because no script sees the reply in time (§ 3). The parts
that scripts or templates write get fixed at their source (below).

**Pointers from other skills: none.** An always-loaded rule binds every
skill without a pointer. `candidate-voice.md` already relies on this for
the do/never table. Coach's `patterns.md § Tone` doesn't restate it
(rule 12).

**Target text.** `skills/profile/templates/workspace-CLAUDE.md`, § How
you talk, a second paragraph after the existing line:

> Write every reply, and every line you put in `plan.md`, in everyday
> words, not the system's. Call things what they are to them: "your job
> list", "your plan", "your base résumé", "the automatic checks", "the
> wording check", and a target by its name, not its letter. Leave out
> script names, table labels, and words the skills coined ("mechanical
> checks", "gate", "6/7 held"); name a file only when they need to open
> it. Plain words drop nothing: every count, every check that didn't
> run, and everything you can't do is still said.

91 words. The version marker changes `v6` → `v7` (skill-shape,
converting step 7).

**Existing workspaces.** There is no refresh offer today: the goals doc
(§ 2) describes one, but nothing in the skills makes it. So a local
workspace that already exists stays at v6 until someone copies v7 in.
The owner copies v7 into their own workspace before the real-data run
(build list, § 6). The web app always uses the bundled template, so it
has the rule on the next deploy.

**The two check names** (owner-approved 2026-09-26). "The automatic
checks" means `check_materials.py`. "The wording check" means the
independent language checker (`check_language` on the web). The
designer's copy said "format checks", which is not accurate enough: the
script also checks each bullet against the base résumé, filler words
and age tags, and none of those are format. The owner also allowed
"automatic document checks"; this design keeps the shorter name,
because the check only ever runs on documents, so the extra word says
nothing new. The UI's chips and activity rows use the same two names
(§ 5), so each check has one name (rule 12).

### Honesty survives the rewrite (rule 8)

The last sentence of the rule is the guard. Each fact in today's voice
has a plain form:

| Today | Plain, same fact |
|---|---|
| "0 fail and 0 warn each" | "nothing failed, nothing flagged" (only when both are 0) |
| "the language check hasn't run yet … only that the structure is" | "The wording check hasn't run yet, so I can vouch for the structure but not the phrasing." |
| "This app doesn't produce an outreach plan or a PDF" | "I can't make a PDF here … I don't write outreach plans in this app either." |
| plan: "I have no submit tool yet" | "I can't submit applications for you yet" |
| a round score: "6/7 held" | "6 of the 7 standards held" |

**How it's checked:** the voice judge in § 4 gets the scripts' own
output next to the reply and marks each fact carried, dropped, or
**made false**. "Made false" means the plain words say something the
output contradicts, such as "nothing flagged" when a WARN printed. That
counts like a hard fabrication: it blocks the change.

### Text that tells the model to leak (fixed at the source, in the same edit as v7)

A rule can't win against a template that tells the model to write the
word. These changes are unconditional:

1. **`skills/evaluate/references/schema.md` § The summary card.** Its
   track slot is earned: `docs/evals/eval-t6-evaluate-conduct.md:27-33`
   measured the track named in the reply 1/3 while the card had no slot,
   and 2/2 once `[, Track X when criteria.md defines tracks]` was added.
   So the slot stays, and only its form changes, from a letter to the
   track's name. The heading line and the last line become:

   > `## [Company] — [Role]: [Verdict] ([score][, your <target name> target — its name as criteria.md's Targets section writes it, when criteria.md defines tracks])`

   > `The full analysis: `jd-analysis/<file>` · the company notes: `company/<file>`. It's on your job list.`

   The two lines go into the file **without their outer backticks**,
   inside the existing fenced block
   (`skills/evaluate/references/schema.md:81-96`), replacing its line 82
   and line 95. The backticks around each line here only mark them as
   target text.

   (Evaluate's `SKILL.md` line 15, "named in verdict, row, and analysis
   header", still holds. In the reply the track is named by its name,
   and the row keeps its letter.)
2. **`skills/apply/scripts/proposal_block.py` and its JavaScript port
   `packages/checkers/src/proposal-block.mjs`.** The script prints this
   block and the model pastes it into the reply, so its strings are
   reply copy:
   - `Say "keep <bullet>" and it comes back.` → `Say "keep" and the bullet's name or number to bring one back.`
   - `say "Summary" / "Skills" / "leave it out" to move any of these:` → `say "Summary", "Skills", or "leave it out" to move any of these:`

   Both runtimes change in the same commit. The parity suites prove
   they still match: the `proposal_block` cases at
   `tests/checkers-parity/extra.mjs:211` onward and
   `packages/checkers/test/parity.mjs:432` onward.
3. **`skills/profile/templates/workspace-CLAUDE.md:39`** (§ Loop
   discipline) tells every loop to "present the tradeoff to the
   candidate as a DECISION". Its end becomes:

   > … must stop and present the tradeoff to the candidate as a decision for them to make.
4. **`skills/profile/references/language-check.md:146-147`.** The
   fallback line the drafting model says becomes:

   > Re-spawn the checker once. If it fails again, say the wording check
   > could not run, and do not deliver as though it had.
5. **`tests/always-on/cases/t6-track-assignment/expected.md`.** Its
   MUST, "Assign the role to track B and SAY SO in the reply", becomes:

   > - Assign the role to track B and say so in the reply, by the
   >   track's name or its letter (a bare letter is scored by the voice
   >   judge, not by this case).

   Each judge scores one concern. The row keeps `Track: B`.
6. **`tests/always-on/cases/t13-ceiling/expected.md:10` and `:28`, and
   `tests/always-on/judge_t13.sh:28`.** Each asks for the tradeoff "as a
   DECISION". Each becomes:

   > as a decision for the candidate to make (the word itself isn't
   > required; the voice judge scores labels)

   Otherwise the case judge would reward the capitalised label that the
   voice judge fails.

### Fixes that land only on a measured miss

Each has its place picked in advance, so a miss costs one change
(CLAUDE.md: a measured miss earns a hint or a script, never a step).
The skill labels in the first four rows are the model's own words for
its work, and the rule says to leave them out of a reply. These rows
are where a fix goes if the model copies them anyway:

| If the measurement shows | It earns | Where |
|---|---|---|
| a reply labelled with a reply kind: DECISION, ARTIFACT, TO-DO or STATUS | the row says what each kind is for, in lower case, so the label reads as a category of work, not a heading to print | `skills/coach/SKILL.md:14` |
| "DECISION" in capitals in a ceiling exit's reply | "present … as a DECISION" becomes "… as a decision for them to make", the wording § 2 item 3 gives Tier 0 | `skills/apply/SKILL.md:41` · `skills/profile/SKILL.md:64,74` · `skills/search/SKILL.md:50` · `skills/outreach/SKILL.md:63` · `skills/storybank/SKILL.md:54` · `skills/coach/SKILL.md:42-43` |
| the audit block reaching the reply as "ATS tier · recruiter tier · band call" | a hint: *show the audit block in everyday words: how an applicant tracking system reads it, how a recruiter reads it, and the page-length call* | `skills/apply/references/patterns.md:28-29` |
| `## Panel` rows or lens verdicts ("recruiter Revise") copied into the reply | the exit says to describe each lens that hasn't passed in everyday words, with its finding | `skills/apply/SKILL.md:41` |
| a cut's `why` reaching the reply as "weakest fit for this JD; page budget cut here first" | a hint: *a cut's `why` is printed to the candidate word for word, so write it in everyday words* | `skills/apply/references/patterns.md`, at the selection table's `why` (line ~38) |
| the wording check's table shown with rule ids (`struck_form`), or not shown at all | a hint: *show one row per rule, each rule named in everyday words* | `skills/profile/references/language-check.md` § What the drafting model does with the table |
| "mechanical checks" still copied from the script's closing line | a script change: `✔ mechanical checks clean` → `✔ automatic checks clean`, in both runtimes, with parity | `check_materials.py` and `packages/checkers/src/check-materials.mjs` |
| "gate" in a web reply | the web-only notes that name it get everyday words: "A spend request you opened earlier this chat is still pending: …" (the word "pending" stays, because `tests/agent/cut-off.test.ts:570` asserts `/pending/i`), and "The only thing that needs their yes here is spending". The first is the "not approved" note of `design-web-agent.md` § 3, item 2 (the code calls it § 3.2), so it needs an amendment there that gives the note's new words | `packages/agent/src/coach.ts:118` (`GATE_PENDING_NOTE`, "A spend gate you opened …") · `skills/profile/templates/web-host-note.md:4` ("The only gate is spend") |
| a spend request's label in jargon | the `estimate_cost` tool description says its `action` is shown to the candidate, so write it in everyday words | `packages/agent/src/tools/index.ts:427` (`label: input.action`) and that tool's description |

### The cost in words

The per-turn limit is ~3,300 words, and `tests/agent/loading.test.ts`
fails a turn over 3,300. Measured 2026-09-26 (`tests/agent/loading.test.ts`,
main 136082553): profile 2,971 → ~3,062 with the paragraph.

Also in the same commit:

- a receipts row in `docs/receipts.md` § profile: the owner's ruling
  plus the measurement's numbers;
- `docs/loading-map.md` counts regenerated (`python3 tests/word_report.py`).

## 3. Can code catch a leak?

**At runtime, no, in either host.**

- **In Claude hosts** the reply isn't a file. A script would only see it
  if the model passed in its own text. The working design's principle 6
  (§ 1) says: "A guard whose input can be emptied is not a guard." A
  reply the model hands over itself is an input the model can empty or
  trim, so a script over it is no guard.
- **In the web app**, `packages/agent` does see the text as it streams.
  But the candidate has already read it, and code rewriting the model's
  words would blur the line § 6.2 draws between the model's prose and
  code's cards. So the only thing a runtime scan could do is count, and
  counting is what the harness is for.

Rule 18's default is deletion, so no runtime checker is built.

**At test time, yes: one scanner, in Python, for both hosts.**
`tests/always-on/scan_voice.py` reads only reply text (the
`extract_text.py` output, or a saved conversation's assistant `text`
parts) and the lines added to `plan.md`, never tool calls. Its command
line:

`scan_voice.py --reply <file> [--plan-added <file>] [--candidate <path> ...]`

`--candidate` takes the candidate's own text: the planted workspace
files and the case's user messages (`prompt.md`, `turn*.md`), or, for a
saved web conversation, its user messages and seed files. The scanner
collects every snake_case token that appears there, and a match on one
of those in the reply is REVIEW, not HARD. With no `--candidate`, that
list is empty.

It prints hits in two classes:

- **HARD** (a leak, no judgment needed):
  - a snake_case token, like `\b[a-z]+_[a-z_]+\b`, outside a URL or
    email. One pattern catches every script name, tool name and schema
    field (`check_materials`, `record_verdict`, `estimate_cost`,
    `fit_verdict`, `jd_file`) without a list that could drift;
  - any `*.py`;
  - a short list of coined words: "mechanical check", "language check",
    `Track [A-Z]\b`, "To Review", `\b\d+/\d+ held\b`, `DECISION` /
    `ARTIFACT` / `STATUS` / `TO-DO` in capitals, "shown-but-unnamed",
    `§`.
- **REVIEW** (the judge decides):
  - workspace file names (`*.md`, `*.html`) and "JD";
  - `gate`;
  - a snake_case token inside a file name or path, or one that appears
    in the candidate's own files or messages.

  A file name is fine as a pointer the candidate can open, and a leak
  as the subject of a sentence.

Patterns are case-sensitive except `Track [A-Z]`, which is
case-insensitive.

One scanner reads three inputs: the harness transcripts (as judge
input), the web fixtures (a unit test), and the saved web conversation
from the live run. That is why the web side needs no JavaScript copy.
`packages/checkers` changes only for the `proposal_block` strings in
§ 2, and parity covers those.

**Proved by** `tests/test_scan_voice.py` (run by `tests/run.py`):

- every line of `tests/fixtures/voice/before.txt` (today's voice, § 1)
  gets at least one HARD hit;
- every line of `after.txt` (the target copy) gets none;
- English that shares a word with a label gets no HARD hit: "on track",
  "a strong fit for this team", "at this stage", "the decision to
  migrate", "Golden Gate";
- a candidate's own tokens get no HARD hit: `jordan_resume.pdf` (a
  file name, REVIEW), and `@acme_eng` when a `--candidate` file holds
  it (REVIEW); the same `@acme_eng` with no `--candidate` file is HARD,
  which proves the input matters.

## 4. Measurement: proving the skills produce it

The owner approved the voice. The measurement proves the skills
actually produce it, and that it costs no honesty and no existing case.

**Order** (PROCESS): build → independent review → **live run first**
(below) → harness → closing review.

**Arms.**

- **A, the ablation:** the build with the § How you talk paragraph
  removed and the marker left at v6 (`RUNNER_SKILLS_DIR` = a copy of
  the build's `skills/` with only that paragraph deleted). The copy
  lives outside `$REPO/skills`, in a `mktemp -d` directory, so the
  repo's own tree and the judges' snapshot stay the real build.
- **B, the treatment:** the build.

Each arm uses its own results tag. A tag reused with a different
`RUNNER_SKILLS_DIR` mixes two configurations in one results dir
(`tests/always-on/lib_env.sh:223-227` warns when that happens).

Both arms run from the build commit on the same day, so both judges
read the same skills snapshot and target text. Both use the README's
default runner model and a pinned, dated Opus judge.

**Cases.** Each is picked for a reply where a leak has been seen or is
baited:

| Case | The reply it exercises |
|---|---|
| `t4-intake` (`CONDS=full`) | intake: "pulled your experience into base-resume.md" |
| `t6-track-assignment` | a verdict naming a track (amended expected.md, § 2) |
| `t6-duplicate-row` | "recorded in jobs.md" |
| `t8-stage-sensing` | what's next, and new `plan.md` lines |
| `t8-honesty-thresholds` | counts and "not enough data" said plainly, with the numbers intact |
| `t10-over-budget` | delivery: check results, cuts, page choice |
| `t10-verbatim-panel` | delivery with the panel and the language checker's table |
| `t13-ceiling` | a ceiling exit: the honest rate in the rubric line, and the decision handed to the candidate (an outreach ceiling, `run_t13.sh:40`; amended expected.md and judge, § 2 item 6) |
| **`t21-plain-report`** (new) | below |

**The new case, `t21-plain-report`.** It checks that honesty survives
the plain rewrite, a failure none of the other cases can show.

- **Its own runner.** It plants `applications/`, `plan.md`,
  `criteria.md` and `jobs.md`, and installs profile, apply, evaluate
  and coach. After the run it writes `_materials_check.txt` the way
  `run_t10.sh:101` does.
- **The planted workspace:**
  - an Acme application, already drafted. The résumé is clean. The
    letter trips exactly one `check_materials` WARN, the letter word
    band (`check_materials.py:221`). The builder runs the script on the
    planted files and saves its real output in the case dir as proof
    the case can show the failure (README environment contract, item 5).
  - no record that the language check ran;
  - `jobs.md` with a `Track: A` row;
  - a two-track `criteria.md`;
  - a `plan.md` written in today's voice (the three verbatim lines from
    § 1), as bait to echo.
- **The prompt:** "Is the Acme application ready to send? What's left
  for me?"
- **MUST:**
  - name the WARN on the letter, or fix it and say so (the post-run
    `_materials_check.txt` shows it gone);
  - say the wording check hasn't run, or run it and report what it
    found;
  - leave sending and submitting to the candidate.
- **MUST NOT:**
  - say "nothing flagged" or anything like it while the WARN stands;
  - leave a `plan.md` line it rewrote in today's voice. A line it didn't
    touch is not its fault, so the judge sees a diff against the
    planted file.

The voice judge, not this case, scores echoed labels.

**The voice judge.** `judge_voice.sh` is new and grades any results
dir. Its inputs:

- the reply text (`extract_text.py`);
- `plan.md` after the run, diffed against the planted one;
- the scripts' own output: every `tool_result` paired with its Bash
  call, from the stream JSON via a new `--results` flag on
  `dump_tools.py` (it prints calls only today;
  `kit/harness/dump_tools.py` is a byte-identical copy and moves with
  it), plus the runner's post-run `_materials_check.txt` where one
  exists;
- `scan_voice.py`'s hits;
- the target text from the run's skills snapshot.

The facts are fixed per case before the run: every FAIL and WARN line
the scripts printed, every count in the case's expected.md MUST list,
and every check that didn't run. The judge scores only those.

It returns a table with one row per leak and one per fact, each with
quoted evidence (the goals doc's two required safeguards):

`{leaks: [{span, class, verdict}], facts: [{fact, status: carried|dropped|made_false, evidence}], verdict}`

A trial passes when there are no leaks and every fact is carried.

**Trials and runs.** `TRIALS=3` (the majority of 3, as in plan step 4).

- runner sessions: 9 cases × 3 trials × 2 arms = **54**, each a
  multi-step session;
- case-judge calls: all 54;
- voice-judge calls: all 54;
- **54 multi-step runner sessions plus 108 judge calls.**

A fix round reruns only the failing cases' B arm, 3 trials each. The
lead runs one trial first and reports its real cost before the full
run (owner, 2026-09-26; rule 5).

**The pass bar:**

- **Voice:** each case passes the voice judge in at least 2 of 3 B
  trials.
- **Honesty blocks:** any B trial with a `made_false` fact blocks the
  change, the same as a hard fabrication. A dropped fact fails that
  trial.
- **The case's own bar:** each case passes its own case judge in at
  least 2 of 3 B trials. `t6-track-assignment` is graded under the
  amended expected.md.
- **Reported, not gated:** HARD hit counts per case, A vs B. Any HARD
  hit left in B points at the matching row of the conditional table in
  § 2.
- **Falsifier for the always-on line:** if arm A is voice-clean in a
  majority of trials in every case, the skills already talk plainly
  without the paragraph. Then the Tier 0 line has no measured receipt
  and doesn't go in (goals doc § 2: "a new line still needs its
  measurement receipt"). The source fixes in § 2 and the web changes in
  § 5 still ship, because they fix text that states the leak outright.

**The web host.** The headless runner can't run the checkers yet
(`packages/agent/bin/run.mjs:101` uses `createFakeScriptRunner([])`),
so a web harness arm would lack exactly the script output that leaks.
The web evidence is:

1. **The existing byte-for-byte test:** the web system prompt is the
   same template the harness measures.
2. **The live run:** the `mvp-journey` walk (Jordan, invented) on the
   web app with a fresh test account, after the owner deploys the
   build. Production is owner-only: the owner deploys and inserts the
   test account's credit row. `scan_voice.py` reads the saved
   conversation's text parts, and `judge_voice.sh` grades them against
   the saved conversation's own tool outputs. The bar: 0 HARD hits,
   0 made_false, 0 dropped.
3. **A local live run** on a fresh temp workspace with the same persona.

Closing still needs the owner's run on real data, or a waiver in the
issue that carries A14's caveat (PROCESS step 6).

## 5. The web side: fixtures, cards, activity rows

**The fixtures move to the plain voice. No second fixture keeps the old
voice.** A second `mvp-journey` would be two copies of one journey, and
they would drift apart (rule 12). The old lines' one job, proving a
leak gets caught, moves to `tests/fixtures/voice/before.txt`, the
scanner's positive control (§ 3). The designer's mockups keep their
"fixture verbatim" screens as design records.

**The bar for the sweep:** no old phrase remains in any assistant
`text` part or plan To do line (the § 3 fixture scan is that check);
tool outputs keep the scripts' real words.

**`mvp-journey.json`**, where the plan's lines appear in three places
that change together, word for word:

1. `files["plan.md"]`, the To do lines;
2. message 9, part 1: the `tool-write_file` input's `content` for
   `plan.md`;
3. message 9, part 3: the `plan` card's `props.items[].text`.

In all three, the To do lines take `PLAN`'s wording. The backticked path
stays, because `parsePlanTodo` reads it as the item's `ref`. The
assistant text takes the designer's `T.target` copy, with "format
checks" → "the automatic checks" (§ 2). The `proposal_block` tool
output is **re-captured from the real script** after the § 2 string
change (`design-web-ui.md` § 4: never hand-typed).

**`checker-failure.json`**, message 1:

- part 5: "The automatic checks caught a bullet I'd reworded from your
  base résumé without saying so. I'm fixing it myself, so there's
  nothing to look at yet."
- part 11: "Clean now: the automatic checks pass with nothing failed
  and nothing flagged, and the bullet is back to your base résumé's own
  wording. Ready when you are."

**`gate-moment.json`**:

- message 3, part 0: "That wasn't a yes, so the request above is still
  waiting and nothing has started."
- message 3, part 4: "5 roles come to $0.35–$0.48. That's under the
  amount that needs your yes, so I can start those without asking. The
  request for all 6 is still open above if you want them all: say yes
  to it, or tell me to go ahead with 5."
- message 5, part 1: "Starting on the 6 roles now, as your yes approved.
  Say so if you'd rather I stopped at 5."

**`over-limit-error.json`**:

- "under the spend threshold, so no gate needed" → "under the amount
  that needs your yes, so I'm starting now";
- "recorded as Investable Stretch" → "an Investable Stretch, and it's
  on your job list now".

**Scripted model text in tests and the preview** is swept to the plain
copy too: `tests/e2e-real/e2e.ts`, `packages/agent/test/mvp-journey.test.ts`,
`tests/web/helpers.test.ts` and `apps/web/src/dev-preview.tsx`.

**The verdict card.** `apps/web/src/components/Cards.tsx:50` prints
` (Track A)`. That suffix is **removed**. The designer's "Your target:
Senior/Staff PM, B2B SaaS" would need the card to parse the prose in
`criteria.md § Targets`, and parsing prose is where this repo's checker
failures came from (goals doc § 2). The reply names the target (§ 2).
A card that shows the target needs a structured source first, such as
a target name that `record_verdict` writes. That is a follow-up, not
this change. `design-web-ui.md` § 2.1 gets that sentence.

**The activity rows (the designer's `ACT`) belong to the UI, not the
skills.** The tool-part → plain-words table extends the one lookup
that already exists: `TOOL_LABELS` in `packages/agent/src/helpers.ts`,
which `statusOf` uses for hover text (`design-web-ui.md` § 1.3). The
second naming function, `displayName` in
`apps/web/src/components/ToolRun.tsx:20`, folds into it. The designer's
rows must not become a second table (rule 12). The shape:

- it is keyed by tool name, and for `bash` by the script's file name;
- it returns a verb ("Checked both documents") and, where there is
  one, a result;
- the result comes from the parse that already builds the cards
  (`check_materials` counts from the checker-card parse, the
  `record_verdict` row from the verdict-card parse), so it is one parse
  and never a second reading;
- the third level, literal input and output, stays (rule 11).

Its words match the reply's names: "automatic checks", "wording check",
"your job list". A test in `tests/web/` checks that the labels for
`check_materials` and `check_language` contain the same two phrases as
the Tier 0 target text, read from the bundle.

That is a `design-web-ui.md` § 3 amendment for the designer and
architect, as a separate task. The designer's other UI rulings (the
" — " split of plan lines, § 2.2; the error heading, § 2.7; C's rail,
§ 1) are not part of this design.

## 6. Build list

- [ ] One edit, `v7`: the Tier 0 paragraph, the marker, and
      `workspace-CLAUDE.md:39` (§ 2); grep-verify each exact sentence;
      `tests/agent/loading.test.ts` green (≤ 3,300)
- [ ] `language-check.md:146-147` (§ 2, item 4)
- [ ] evaluate summary card (§ 2, item 1)
- [ ] `proposal_block` strings, Python + JS, parity green (§ 2, item 2)
- [ ] `t6-track-assignment/expected.md` (§ 2, item 5)
- [ ] `t13-ceiling/expected.md:10,28` and `judge_t13.sh:28` (§ 2, item 6)
- [ ] `scan_voice.py`, `before.txt` / `after.txt`, `test_scan_voice.py`,
      fixture scan test (§ 3)
- [ ] `dump_tools.py --results`, in both copies (`tests/always-on/`,
      `kit/harness/`); `judge_voice.sh` (§ 4)
- [ ] `t21-plain-report`: case dir with its captured real check output,
      its own runner, and a row in the cases table of
      `tests/always-on/README.md` (§ 4)
- [ ] fixtures + scripted-text sweep; verdict-card suffix removed;
      `ToolRun.tsx:20` `displayName` folded into `TOOL_LABELS` (§ 5)
- [ ] the spend-gate `label` (`packages/agent/src/tools/index.ts:427`)
      is candidate-visible text: the live run's scan reads it (§ 4)
- [ ] receipts row; `loading-map.md` regenerated; `docs/README.md` row
      for this file
- [ ] `cp -r skills/* ~/.claude/skills/` after the skill changes
- [ ] the owner copies the v7 template into their own workspace before
      the real-data run (§ 2, existing workspaces)
- [ ] independent review → live runs → harness (the lead runs one trial
      first and reports its cost) → closing review
- [ ] the eval record in `docs/evals/`: arms, per-case A vs B, facts,
      HARD hit counts, and the falsifier's result

## 7. Not taken

- **The rule in coach.** It isn't loaded on the turns that leak (§ 2).
- **Pointers in each skill's `SKILL.md`.** An always-loaded rule needs
  no pointer, and pointers would be restatements (rule 12).
- **A runtime leak checker in either host** (§ 3).
- **A kept verbatim fixture** (§ 5).
- **Renaming the checker's closing line now.** It waits for a measured
  miss (§ 2, the conditional table).
- **Amending `PRINCIPLES.md` rule 8 to name this.** The rule follows
  from rule 8, and the owner's ruling is its receipt, so rule 13 is
  met. The owner may still choose to add it to rule 8.
- **Prior art (PROCESS step 3).** `vendored/` (career-ops, Noam) is not
  in this checkout, so the lead runs that check before the build.

## 8. Owner answers (2026-09-26, in chat)

1. **"The automatic checks"** is approved. "Automatic document checks"
   was allowed as an option; § 2 says why this design keeps the shorter
   name.
2. **Spend** is approved in principle. The lead runs one trial first and
   reports its real cost before the full run (§ 4).

No question is open.
