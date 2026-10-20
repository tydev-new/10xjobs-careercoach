# Design - Fewer steps per reply

**Status:** Draft for owner approval (design gate) · **Date:** 2026-10-20
**Owner:** Yong · **Author:** architect
**Builds on:** `docs/design-web-agent.md` (§ 1 the loop, § 4 tools, § 7 the
system prompt and host note), `packages/agent/bin/run.mjs`,
`tests/always-on/run_headless_voice.sh`, `docs/evals/eval-t8-coach-shape.md`
(the close-out receipt).

A **step** is one model call inside a turn. The model either calls tools
(then the loop calls it again) or writes the reply (the turn ends). Every
step costs money and a few seconds. The turn stops at 25 steps
(`packages/agent/src/coach.ts:37`).

**The report (owner, 2026-10-20, live site, DeepSeek V4.1 Flash).** A new
workspace, first message "I'm looking for FDE job in SF Bay Area": about 20
steps before the reply (`list files ×2, load skill, bash ×12 or so, write
file, bash`). The second message (a LinkedIn PDF) took about 15 more,
including `ls -la skills/ ; find . -maxdepth 3 -type d | head -50`. The
owner approved: (a) a step counter to measure before and after, (b) a
one-step first setup, (c) the before-reply checks only when something
changed, (d) no exploring: tell the model where its skills and scripts
are. The PDF failing to read was PR #42 not yet being live; that is out of
scope here.

**Nobody has seen each step's input yet.** So Phase A measures first, and
every Phase B change is tied to a kind of step the measurement must show.
A change whose kind of step doesn't show up is not made (rule 13: earned,
not guessed; rule 17: evidence decides).

`UNVERIFIED` = not confirmed from the code, the installed package, or a run.

---

## 0. What the code already tells us

Checked on `origin/main` at 8748196. Each is a fact, not a guess.

| # | Fact | Evidence |
|---|---|---|
| F1 | Two places say the close-out check runs before *every* reply: the workspace guardrails and coach's Session close. | `skills/profile/templates/workspace-CLAUDE.md:37-44`; `skills/coach/SKILL.md:78` |
| F2 | Every other skill's Session close runs `check_files` too, with no condition. Two skills loaded in one turn can each run it. | `skills/*/SKILL.md` Session close lines (apply :75, evaluate :60, profile :112, search :66, …) |
| F3 | On the site, `CLAUDE.md` exists before the first turn: the app writes it. So profile's Setup ("runs when there is no `CLAUDE.md`") should never start on the site. | `apps/web/src/backend/supabase-workspace-store.ts:652`; design-web-agent § 7 |
| F4 | The `bash` sandbox gets only editable files plus `skills/`. `CLAUDE.md` is not editable, so `ls` in bash does not show it, even though `list_files` does and the host note says it is "already in place". | `packages/agent/src/tools/index.ts:209` |
| F5 | On the web, a folder can't be made. `mkdir` succeeds inside the sandbox, but only files are written back. The workspace store has no folder call, so `documents/` and `jd-inbox/` exist only once a file is in them. Profile's Setup exit ("both drop paths exist") can never look done to `list_files`. | `apps/web/src/backend/script-runner.ts:70-78`; design-web-agent § 2. Probed on just-bash 3.4.2: after `mkdir -p documents jd-inbox`, both appear in `fs.getAllPaths()`, and `readFile` on them throws, so the diff skips them. |
| F6 | The guardrails say "Check both [`documents/`, `jd-inbox/`] at the start of a session". One `list_files` call with no folder lists the whole workspace (recursive, depth ≤ 3). | `workspace-CLAUDE.md:55-57`; design-web-agent § 2 `list(dir?)` |
| F7 | `check_closeout` FAILs when `plan.md` was last written more than 30 minutes ago. On a local disk, a reply that changed nothing, sent more than 30 minutes after the last plan write, FAILs, and the model rewrites `plan.md` for no reason. On the web this part never fires: every `bash` call copies the files into a fresh sandbox, so each file looks just written. | `skills/coach/scripts/lib/check-closeout.mjs:117-125`. Probed on just-bash 3.4.2: a mounted file's mtime was 1.58 s old after a 1.5 s wait. |
| F8 | The `bash` tool description already says it is "used only to run a skill's ported checker script". The model listed `skills/` anyway. The system prompt never says where skills live, or that a skill's relative paths (`references/…`, `../profile/scripts/…`) start from `skills/<skill>/`. | `packages/agent/src/tools/index.ts:457`; `packages/agent/src/skills/system-prompt.ts` (Tier 0 + host note + Tier 1 only) |
| F9 | The headless runner sends one message. Its `[ran]` lines carry no tool input. It doesn't write the app's `CLAUDE.md` first, so a headless turn 1 doesn't start from the site's state. | `packages/agent/bin/run.mjs` (`streamTurn`); `run_headless_voice.sh` `stage_case` |
| F10 | History is cut to 4,000 words (§ 7). Turn 1's `load_skill` output can fall out before turn 2, so loading the skill again in turn 2 is expected, not waste. | design-web-agent § 7 "Window" |

**A doc error found on the way:** design-web-agent § 2 (line 157) says
"`updated_at` is `now()`, which `check_closeout` reads". It doesn't: the
sandbox has no `updated_at`; see F7. The doc is the thing that's wrong.
That line gets fixed in the same PR as B1.

### What the 20 steps probably are (hypotheses; Phase A confirms or kills each)

| # | Guess | What the trace shows if it's true |
|---|---|---|
| H1 | `list_files ×2` is the guardrails' "check both folders" (F6), one call per folder. It is not coach's "sense" step: coach isn't loaded yet in turn 1. | two `list_files` calls with `dir=documents` and `dir=jd-inbox` |
| H2 | A folder loop: the model `mkdir`s the drop folders, lists them, doesn't see them (F5), and does it again. | `bash mkdir …` repeated, with `list_files` between |
| H3 | `CLAUDE.md` confusion: bash can't see it (F4), so the model tries to copy the template, and the write is refused. | `bash cp …workspace-CLAUDE.md CLAUDE.md` returning exit 1 (`not_editable`) |
| H4 | Checks run more than once per reply: `check_closeout` and `check_files` as separate calls, once per loaded skill, plus re-runs after a fix. | two or more `check` steps per turn without a FAIL between them |
| H5 | Fix loops: `check_files` FAILs on a new file that's missing a section, then write, re-check, write again. | `check` with FAIL, then `write`, then `check` |
| H6 | Exploring after a failed read: a skill-relative path read from the wrong place (F8), or an unreadable upload, makes the model look around. | `bash ls/find/cat` or `list_files skills/…` after a `read_file` error |

---

## 1. Phase A - the step counter

### 1.1 `bin/run.mjs` gains `--trace` and `--turns`

- **`--trace`** prints one stderr line per tool call when its result
  arrives, and one per reply-only step:

  ```
  [trace] turn=<t> step=<s> tool=<name> in=<short input> out=<short result>
  [trace] turn=<t> step=<s> reply (<n> chars)
  ```

  `step` counts the `step-start` parts of the assistant message
  (`ai` 7.0.111 adds one per step: `dist/index.js:7995`, type
  `StepStartUIPart`). Calls made together in one step share a step number.
  After each turn the runner checks that the step count equals the number
  of costs recorded for that turn (`onStepCost`). A mismatch prints
  `[trace] WARN steps ui=<a> cost=<b>`, and the scorer marks that turn as
  not a measurement.
- **Short input**, per tool (never file contents):

  | tool | `in=` | `out=` |
  |---|---|---|
  | `load_skill` | the name | `ok` or the error code |
  | `read_file` | the path | `<n> chars` or the error code |
  | `write_file` | the path and `(<n> chars)` | `written` or the error code |
  | `list_files` | the folder, or `(all)` | `<n> files` |
  | `bash` | the command, first 160 characters, line breaks shown as `⏎` | `exit=<n>`, then the first `FAIL`/`WARN` line (80 characters), else `clean` |
  | `web_search` | the query, 80 characters | `<n> results` |
  | `fetch_job` | host and path of the URL, plus `saveTo` | `ok` or the error code |
  | `estimate_cost` | the action | `needsGate=<bool>` |
  | `check_language` | the file list | `ok` |
  | `list_board`, `add_roles` | company count | `ok` or the error code |

- **No secrets.** The key never enters a tool input; it lives only in the
  runner's process and the provider client. On top of that, every trace
  line is passed through a mask that replaces the key variable's value,
  and anything shaped like `sk-` followed by 16 or more key characters,
  with `[redacted]`. No environment value is ever printed.
- **`--turns <file.json>`** (instead of `--prompt`) runs a list of turns
  in one process, with one coach and one chat id, so the version tracker
  carries across turns the way an open browser tab does. Each turn sends
  the whole history (the earlier user messages and the final assistant
  message of each turn) plus the new message; the coach cuts it to the
  window itself, as on the site. A turn is `{ "text": "…" }` or
  `{ "text": "…", "attach": "<path to a fixture file>" }`. For an attach,
  the runner calls `workspace.upload("documents/<name>", bytes)` first,
  then adds the same `file` part the site's composer sends
  (`apps/web/src/real/RealChatShell.tsx`, `doSendMessage`:
  `url: "workspace:documents/<name>"`). A turn that stops at a spend gate
  is recorded (`[gate]`), and the next scripted turn is sent as written
  (the runner never types yes).
- **Cost lines:** `[cost] turn=<t> usd=<x> steps=<n>` after each turn, then
  the existing `[cost] usd=<total> steps=<total>` line last, so
  `run_headless_voice.sh`'s `tail -1` parsing still works unchanged.
- **Refusals:** the existing missing-key refusal. Also, `--turns` refuses a
  `--workspace` that isn't inside the system temp folder (`os.tmpdir()`,
  with symlinks resolved), or that holds any file other than `CLAUDE.md`
  when the run starts (the driver stages nothing else, § 1.2).

**Prevents:** guessing which steps are waste; a key printed in a log; a
multi-turn run against a real folder; a headless turn 1 that starts from a
state the site never has.
**Proved by** (no model call, no network; the `bin-run.test.ts` fetch
preload, extended to answer with a tool call and then text):
1. a two-step canned stream prints exactly one `tool=` line and one
   `reply` line, with step numbers 1 and 2;
2. a canned `write_file` input never shows its content, only the length;
3. a key value planted in a canned bash command prints as `[redacted]`;
4. `--turns` with a workspace outside the temp folder exits 2 before any
   request;
5. a two-turn file sends the first turn's assistant message inside the
   second request's messages;
6. an `attach` turn's request carries the "The candidate attached
   `documents/<name>`." line (coach.ts's existing conversion).

### 1.2 The driver: `tests/always-on/run_step_trace.sh <model-id> <tag>`

Built from `run_headless_voice.sh`'s guards, in the same order:

1. Refuse to start unless the key variable (`KEY_ENV`, default
   `OPENROUTER_API_KEY`) is set. Only its name is ever printed.
2. Refuse a model that isn't in the proxy's `MODEL_IDS`.
3. `source lib_env.sh`: skills snapshot, run info (the commit and whether
   the skills are dirty), `DRY_RUN`, and `vault_lock` with
   `trap vault_unlock EXIT`, the same as every other runner.
4. For each trial, a fresh `mktemp -d` workspace, staged the way the site
   starts:
   - `CLAUDE.md` copied from the bundled
     `skills/profile/templates/workspace-CLAUDE.md` (the app's own
     create-only write, F3);
   - nothing else. The résumé arrives by upload in turn 2.
5. The fixture PDF is built at run time from
   `tests/always-on/fixtures/resume-330w.md` (Alex Chen, an invented
   persona), one text line per résumé line. It uses the same minimal-PDF
   method as `apps/web/src/backend/extract-text.test.ts`, so no binary is
   checked in. It is written to the trial folder, never to the workspace.
6. Run `node packages/agent/bin/run.mjs --trace --turns
   cases/s1-first-session/turns.json …`, with `--skills` pointing at the
   snapshot.

The script, `tests/always-on/cases/s1-first-session/turns.json`:

| turn | sent | why |
|---|---|---|
| 1 | "I'm looking for FDE job in SF Bay Area" | the owner's first message, word for word |
| 2 | "here's my resume" + attach `resume.pdf` | the upload turn |
| 3 | "what's next?" | coach's What's next |
| 4 | "thanks, that's all for today" | a reply that should write nothing and run no check (measures B1's skip) |

**Results:** `results/st-<tag>/<trial>/`, git-ignored: `stderr.txt`,
`replies.md` (kept locally, never sent), `exit.txt`, `ws/`.

### 1.3 The scorer: `tests/always-on/score_step_trace.py results/st-<tag>`

It reads only `[trace]` and `[cost]` lines, and prints, per trial and turn:

```
turn 1  steps=19  usd=0.0912
 step  tool        in                                   out        class
 1     list_files  documents                            0 files    read
 1     list_files  jd-inbox                             0 files    read
 2     load_skill  profile                              ok         read
 3     bash        mkdir -p documents jd-inbox          exit=0     setup
 …
 by class: setup 3 · check 6 · write 2 · read 3 · explore 0 · retry 4 · reply 1
```

(The rows are an illustration of the format, not a measurement.)

**Classes**, first match wins. The scorer guesses, and a person can
change any row by hand before sending it on.

1. **retry**: the same tool with the same input as an earlier call in
   this turn, or the same tool on the same path or script right after
   that call failed (exit ≠ 0 or an error code).
2. **check**: `bash` running `check_closeout`, `check_files`,
   `check_materials`, `proposal_block`; or `check_language`.
3. **setup**: anything that touches `CLAUDE.md`, `templates/`, or runs
   `mkdir`.
4. **explore**: `bash` whose first word isn't `node`; `list_files` or
   `read_file` on `skills/` other than a `SKILL.md` or
   `skills/<s>/references/*.md` path.
5. **write**: `write_file`; `bash` running `update_job`, `record_verdict`,
   `render_resume`; `fetch_job` with `saveTo`.
6. **read**: `list_files`, `read_file`, `load_skill`, `fetch_job`,
   `web_search`, `list_board`.
7. **other**: `estimate_cost`, `add_roles`.
8. **reply**: a step with no tool call.

The totals line per trial: steps and cost per turn, then the run total.
With several trials it adds the median steps per turn. It also checks
these, printed `ok` or `MISS`, never blocking:

- the close-out ran at least once in each of turns 1-3, and its last
  run that turn was clean;
- turn 4 ran no check and wrote nothing, unless its reply contains a
  question mark (then the close-out must have run);
- every step count matched (§ 1.1).

**Prevents:** a person reading 60 raw lines to count waste; a table the
owner has to type up by hand.
**Proved by:** `python3 tests/test_step_trace_scorer.py` on a canned
`stderr.txt` holding one call of each class plus a retry pair: the class
counts and the `ok`/`MISS` lines are exact.

### 1.4 Models and cost

- **The site's model:** `deepseek/deepseek-v4.1-flash`. This is the
  measure, three trials per condition (steps vary from run to run; one
  run is noise).
- **For comparison, optional:** `anthropic/claude-sonnet-5`, one trial per
  condition. If Claude already takes few steps, the waste is partly
  DeepSeek's, and the owner decides whether that changes the site's
  model (§ 13.6).
- **Expected cost, from listed prices only (UNVERIFIED until the first
  run's `[cost]` lines):** DeepSeek is $0.45 / $1.80 per million tokens
  in/out (`supabase/functions/ten-model-proxy/core.ts:98`). A step reads
  about 6,000-14,000 tokens (the system prompt, one SKILL.md, the history
  window, this turn's tool results), so a step costs about $0.004-0.007.
  A "before" run of about 45 steps comes to about **$0.20-0.35**, an
  "after" run under $0.15. Three trials of each is about **$1.50**. One
  Claude trial at $2.75 / $11 is about **$1-3** per run. The runner prints
  the real total. If one DeepSeek run costs more than $1, stop and report.
- **Side finding:** `MODEL_COST_TABLE`'s DeepSeek row ($0.0004-0.0005 per
  step, "derived from listed prices, not measured",
  `packages/agent/src/estimate-cost.ts:71-77`) is about ten times below
  the estimate above. It only covers turn 1 of a chat, before any real
  step cost exists, but turn 1 is the setup turn. Phase A's measured
  costs should replace it; that is a separate small change, not part of
  this one.

### 1.5 What this measures, and what it doesn't (rule 17)

Step counts and cost on the site's loop are plumbing, and § 13.4 allows
DeepSeek runs for plumbing. Whether the coaching stays right after B1-B3
is conduct. That is measured on Claude through the existing harnesses
(§ 3), never on DeepSeek. The headless runner has no `web_search` (F2 of
`run_headless_voice.sh`'s README entry). The script above doesn't need
one, and a `web_search` row would show as an error.

---

## 2. Phase B - the changes

Each change says which class of steps earns it. It ships only if the
"before" tables show that class (more than one step of it per run,
median of three). Under the process rule (PROCESS.md, CLAUDE.md), each
one is a moment rule, a hint, or a script. None adds a step.

### B1 (c) - The checks run only when the reply changed something or asked something

**Earned by:** H4/H5 (two or more `check` steps per writing turn), and by
turn 4 running checks while writing nothing.

**The condition.** Run the checks if, and only if, this reply did at
least one of these:

1. wrote or changed a workspace file (any `write_file`, a script that
   rewrites a file, a `fetch_job` save);
2. asks the candidate anything;
3. tells the candidate their plan changed.

A reply that did none of the three skips the checks.

**Why 2 and 3 stay, though they write nothing on their own:**

- **2, a question:** this is the failure the close-out was earned on.
  The question is asked, no Waiting-on-you row is written, and nobody
  notices (`docs/evals/eval-t8-coach-shape.md`: 0/2 three times without
  the check, 2/2 with it at the guardrails; rule-inventory T0-06, "deletion
  is risky"). A reply that asks but forgets the row wrote nothing.
  "Only when a file changed" would skip the check on exactly that reply.
- **3, a plan claim:** the 30-minute freshness FAIL (F7) catches "I've
  updated your plan" when nothing was written. A local disk can only
  catch that if the check runs.
- **"what's my plan?"** needs no case of its own: the guardrails already
  make it write the plan, so case 1 applies.

**What skipping loses, and why that's fine:** for a reply that wrote
nothing, asked nothing, and claims no plan change, the close-out can only
re-confirm what the last check saw: `## Board` exists, the stage word is
valid, and (locally) the plan's age, which would FAIL and force a
pointless rewrite (F7). `check_files` reads file structure, and nothing
changed. A file the candidate edited by hand is checked at the next reply
that writes. Naming the stage in the reply stays on every reply. It was
never script-checked (the script only checks the word it is given).

**The wording** (guardrails v8 → v9, `workspace-CLAUDE.md:37-44`; the
first two clauses are unchanged):

> Before a reply ends: name the stage the search is in; every question
> you asked the candidate is a row in `plan.md` § Waiting on you, this
> turn; "what's my plan?" writes the plan, even beside another ask. Then,
> if this reply wrote or changed a file, asks the candidate anything, or
> says their plan changed, run the checks once, together in one command:
> the coach skill's close-out check (the `check_closeout` script in its
> scripts folder) with `--workspace . --stage <stage> --asked "<each
> question>"`, plus the checks named in your skill's Session close. Read
> both outputs; a FAIL in either is fixed before sending. A reply that did
> none of the three is not due a check. Another skill serving the ask does
> not end the coaching turn. Report check results as outcomes, never
> narration (clean is one line).

Coach's Session close (`skills/coach/SKILL.md:78`) says the same and
points at the guardrails, so the two can't drift apart (co-located
obligations are co-named, PROCESS.md):

> - **Session close:** when the workspace `CLAUDE.md`'s close-out says a
>   check is due, run `node scripts/check_closeout.mjs --workspace .
>   --stage <stage> --asked "<each question>" ; node
>   ../profile/scripts/check_files.mjs --workspace .` as one command and
>   fix any FAIL before sending. No checker-subagent is spawned (coach's
>   voice). Report outcomes, never narration (clean is one line).

The other skills' Session close lines keep saying which scripts they
run. The guardrails sentence decides *when* for every skill, the same way
the close-out already spans skills. That's one sentence instead of eight
edits. `tests/test_invariants.py`'s Session-close checks (names a script,
states the subagent fact) still pass on the new coach line.

**`;`, not `&&`:** `&&` would skip `check_files` after a close-out FAIL.
With `;` both run, but the exit code is the last command's only (probed
on just-bash 3.4.2: `false ; echo x` exits 0). That's why the wording says
to read both outputs.

**For the reviewer:** "How you talk" (`workspace-CLAUDE.md`) says "every
check that didn't run … is still said". The new "is not due a check" is
meant to keep that line about checks that were due and failed to run. If
the reviewer reads the two as clashing, the "How you talk" line needs a
word ("every check that was due and didn't run"). That's a change to an
earned honesty rule, so it goes to the lead, not into this PR quietly.

**Prevents:** two to four check steps on every reply, and a pointless
plan rewrite on a local reply that changed nothing; while keeping the
question-to-row guarantee.
**Proved by:** the trace's check lines in § 1.3 (turns 1-3 ran the
close-out and ended clean; turn 4 ran none); the conduct cases in § 3.

### B2 (b) - First setup in one step, on the site in zero

**Earned by:** H2/H3 (`setup` steps in turn 1).

**Decision: on the site, setup costs nothing, because the app already did
it.** `CLAUDE.md` is written by the app (F3). The drop folders can't be
made and don't need to be: uploads land in `documents/` by themselves,
and a folder shows up with its first file (F5). So the change is to say
so, in the host note (§ B3's text). No script.

**Not built now: `setup_workspace.mjs` for local hosts.** Locally, setup
is one `mkdir` and one copy, which one shell command already does. No
measurement shows local setup costing more than one call, and Phase A
can't measure local hosts (it drives the web loop). Building it now
would be a rule with no receipt (rule 13). It gets built if a local run
(`claude -p` with `dump_tools.py`, the t19-folder-repo setup) shows setup
taking more than one call. Then it is a create-only copy of the template
(never over an existing `CLAUDE.md`, which is "yours to edit"), the two
folders, and one output line.

**Decision: the first plan stays with the model.** A blank plan from
setup would save nothing. Turn 1's plan has to hold the question the
model asks (the Waiting-on-you row), so the model writes `plan.md` either
way. A blank one written first would make that a second write of the
same file, and an empty Board gets its own WARN
(`check-closeout.mjs:141-143`).

**Prevents:** the folder loop and the guardrails-copy refusal on the
site.
**Proved by:** turn 1's table shows 0 `setup` steps (3 trials).

### B3 (d) - No exploring: say where things are

**Earned by:** H1/H6 (`explore` steps, or two `list_files` in turn 1).

**Host note additions** (`skills/profile/templates/web-host-note.md`, about
75 words; the always-on block stays under § 7's ~3,300-word target):

> The workspace is set up: `CLAUDE.md` is in place, and `documents/` and
> `jd-inbox/` need no making, because a folder appears once a file is in
> it. Skip profile's Setup. One `list_files` call with no folder shows the
> whole workspace. Skills live under `skills/<skill>/` and are read-only.
> A path a skill gives starts from its own folder: `references/patterns.md`
> in profile is `skills/profile/references/patterns.md`. Run a script as
> `node <name>.mjs` with the skill's arguments; the file name is enough.
> Never list or search `skills/` with `bash`. The skill names every file
> you need.

**Guardrails hint** (`workspace-CLAUDE.md:55-57`, both hosts): "Check both
at the start of a session" becomes "Check both at the start of a session
(one listing of the folder shows both)".

**On the owner's question, whether `list files ×2` is coach's "sense the
workspace" step:** most likely not (H1). Coach isn't loaded before the
first `list_files` of turn 1. The guardrails' "check both folders" is
always loaded and names two folders. The trace's `in=` column settles it.
Either way, one call does it: `list_files` with no folder is recursive.

**Prevents:** listing `skills/` to find a reference; a reference read
from the wrong path, then a search for it; two listings where one does.
**Proved by:** 0 `explore` steps in turns 1-3, and at most one
`list_files` per turn (3 trials).

### B4 - Likely next, after Phase A; not changes yet

Each is held back until the "after" tables still show its class.

- **Bash runs scripts only, in code.** If `explore` steps survive B3, the
  next move is a script, not more words (rule 14): the `bash` tool
  refuses any command whose first word isn't `node` or `python3`, with
  one line: "bash runs skill scripts only: use list_files to see the
  workspace and read_file to open a file". It needs a check first that
  no skill on the web relies on another shell command (a grep of the five
  web skills for `` `ls ``, `` `cat ``, `` `grep `` etc. found none on
  8748196).
- **`CLAUDE.md` visible to bash, read-only** (H3): add it to the sandbox
  copy (`tools/index.ts:209`). Its write-back is already refused.
- **Fix loops** (H5): if `check_files` FAILs on new files every time, the
  fix is a hint in profile's patterns naming the required sections of
  `profile.md`/`plan.md`, or the checker's message naming the missing
  section exactly. Which one depends on what the FAIL line says.
- **The listing handed in** (if `read`/`list_files` is still the biggest
  class): the package adds the workspace file list to the turn as an
  app note, which saves one step every turn. This is a package change
  with a cache cost (it must go after the cached system prompt), so it
  needs its own short design.

---

## 3. Acceptance

**Targets** (DeepSeek, the median of 3 trials, the `s1-first-session`
script):

| turn | before (owner's report) | target after |
|---|---|---|
| 1 "FDE in SF Bay Area" | ~20 | **≤ 7** |
| 2 résumé upload | ~15 | **≤ 7** |
| 3 "what's next?" | (not reported) | **≤ 8** |
| 4 "thanks, that's all" | (new) | **≤ 2**, 0 checks |

Why 7 for turn 1: one listing, one skill load, one or two writes
(`profile.md`/`criteria.md` from what they said, `plan.md` with the
question), one check command, one reply. That's 5-6, plus one step of
slack.

**Proofs, in order:**

1. Phase A's tests (§ 1.1 items 1-6, § 1.3's scorer test) pass with no
   model call, and `python3 tests/run.py` is green.
2. **Before:** the owner's three DeepSeek trials on `origin/main`. Their
   class counts decide which of B1-B3 are earned (§ 2's "Earned by").
3. **Independent review** of the B1-B3 wording against the chain, by a
   reviewer who didn't write it (PROCESS.md step 5), including the
   "How you talk" question in B1.
4. **After:** three DeepSeek trials on the branch. The targets above are
   met, and § 1.3's checks print `ok` for the close-out lines.
5. **Conduct regression, on Claude** (the harness's Sonnet runner and
   Opus judge, majority of 2, at the last recorded pass rate or better):
   - `t8-no-nag-no-gate` (the close-out receipt: another skill drives,
     the plan is still written, questions become rows);
   - `t8-stage-sensing` (stage named, plan written);
   - `t8-routing`;
   - `t21-plain-report` (check results reported honestly in plain words);
   - `t4-intake` and `t19-intake` (documents first, one question at a
     time, every told fact written);
   - `t19-folder-repo` (setup: settle the folder, never hunt the disk).
     This is the local host's Setup, untouched by B2, but the guardrails
     changed, so it is re-run.
6. **Plain words on the site's model:** `run_headless_voice.sh` on
   DeepSeek, one trial, 0 HARD (the host note grew).
7. **Word budget:** `packages/agent/test/word-budget.test.ts` still under
   its bound, and `python3 tests/word_report.py` run on the same commit.
8. **The owner's live run** on the site, numbers only: steps on the first
   message of a fresh account (PROCESS.md step 6).
9. Deployed copy refreshed (`cp -r skills/* ~/.claude/skills/`). Existing
   local workspaces keep v8's "every reply" until they take v9. That is
   the safe direction (more checks, never fewer).

**Stop and ask the lead, with the tables, when:**

- the "before" tables show waste in a class this doc has no change for
  (for example, most steps are reply-only, or reasoning-heavy steps), or
  show H1-H6 wrong. Then the changes are re-chosen before anything is
  edited;
- any conduct case in proof 5 drops below its last pass rate. That is
  B1's question-to-row guarantee at risk, and it outranks speed (Part 1
  wins over Part 2);
- turn 1 is still over 10 steps after two rounds of changes (rule 16's
  ceiling). Then the next step is the code options in B4, or the owner's
  model choice, not more prose;
- Claude's one trial is already at the targets while DeepSeek is far
  over. Then the waste is largely the model, and that is the owner's call;
- one DeepSeek run costs more than $1.

---

## 4. Owner steps

Production is not touched. These run on your machine with your
OpenRouter key against temp folders only; your `~/job-search` is locked
for the run.

**Before** (once Phase A is merged, on `main`):

```bash
cd 10xjobs-careercoach
git checkout main && git pull
export OPENROUTER_API_KEY=...      # never printed; KEY_ENV=<name> to use another variable
cd tests/always-on
./check_env.sh
TRIALS=3 ./run_step_trace.sh deepseek/deepseek-v4.1-flash before
python3 score_step_trace.py results/st-before > results/st-before/tables.txt
# optional comparison, one trial:
./run_step_trace.sh anthropic/claude-sonnet-5 before-claude
python3 score_step_trace.py results/st-before-claude > results/st-before-claude/tables.txt
```

**After** (on the Phase B branch, named in its PR):

```bash
git checkout <phase-b-branch> && git pull
cd tests/always-on
TRIALS=3 ./run_step_trace.sh deepseek/deepseek-v4.1-flash after
python3 score_step_trace.py results/st-after > results/st-after/tables.txt
```

**Send back:** the `tables.txt` files only, meaning the step tables, the
class counts, the costs and the `ok`/`MISS` lines. Not `replies.md`, not
`ws/`. The inputs are fixture data (Alex Chen, invented), but the reply
text isn't needed and stays on your machine.

---

## 5. Not taken

- **A step limit lower than 25.** It would cut turns off mid-work instead
  of removing the waste, and a cut-off turn costs a second turn.
- **Code running the close-out by itself after the reply.** It would need
  the stage and the questions, which only the model knows, and a FAIL
  found after the reply is too late to fix in that reply.
- **"Only when a file changed" as the whole condition** (the lead's first
  example). It drops the question case the close-out was earned on (B1).
- **A blank `plan.md` at setup.** It means more writes, not fewer (B2).
- **`setup_workspace.mjs` now.** Not earned yet (B2).

## 6. UNVERIFIED

- The cost figures in § 1.4: listed prices times guessed token counts,
  until a run prints `[cost]`.
- Whether DeepSeek makes several tool calls in one step. If it doesn't,
  the floor for turn 1 is about one step higher than § 3 assumes.
- Whether the "bash ×2" pairs in the owner's report were two calls in one
  step or two steps. The trace's step numbers settle it.
- The step-count cross-check (§ 1.1) assumes the § 9.2 continuation call
  adds its `step-start` parts to the same assistant message. Its test
  (§ 1.1 item 1, extended to a cut-off stream) settles it before any paid
  run.
- F5 and F7 were probed on just-bash 3.4.2 directly, using the same
  `files:` setup as `script-runner.ts`, not through the full `bash` tool.
  Phase A's first trace confirms them on the real path.

## 7. Questions for the owner

1. Turn 4 ("thanks, that's all for today") is added to your three-turn
   script so B1's skip can be measured. Keep it?
2. Local hosts (Claude Code, Cowork): is a measurement of local setup
   wanted? Without one, `setup_workspace.mjs` stays unbuilt (B2).
3. If Claude takes far fewer steps than DeepSeek on the same script, do
   you want that put next to the cost per reply when you decide the
   site's model?
