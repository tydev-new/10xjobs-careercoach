# Investigation - Can the skills' scripts be JavaScript only?

**Status:** investigation for the owner, not a design gate · **Date:**
2026-09-26 · **Author:** architect · **UNCOMMITTED**
**Asked (owner, 2026-09-26):** "do we still need both python and js
version? can we use JS only?", then "js only investigation".
**Precedence:** `PRINCIPLES.md` → `design-cowork-coaching-goals.md` →
`design-cowork-coaching.md` → `skill-shape.md`. No conflict in the chain
was found (§ 8). `UNVERIFIED` marks anything not confirmed from vendor
docs, the repo, or a command I ran.

## The short answer

**Yes, for everything that ships inside a skill, in stages.** Node is
available on every Anthropic surface where Python is documented, except
one where it is merely undocumented; and it is the only language on the
two surfaces we built ourselves (the web app and the planned MCP
server). The Python scripts use nothing Node lacks. What JS-only
deletes is the rule that every script change is made twice and proven
identical. What it costs is one requirement change for local users
(Node instead of Python), about two weeks of team time, and one
measured harness run. Repo tooling that never ships in a skill can stay
Python.

---

## 1. Where skill scripts run, and whether `node` and `python3` are there

This is the deciding question. A skill's scripts run wherever the
host's shell runs, which is not always the user's machine.

| Host | Where the scripts run | `python3` | `node` | Evidence |
|---|---|---|---|---|
| **Claude Code, terminal or desktop app, "Local"** | the user's own machine | **not guaranteed.** Our `INSTALL.md` already has to ask for Python 3.10+ | **not guaranteed.** The native installer, Homebrew and WinGet need no Node; npm is optional, and "the installed `claude` binary does not itself invoke Node" | [setup][cc-setup] |
| **Claude Code cloud sessions** (claude.ai/code, desktop "Cloud", `claude --cloud`) | an Anthropic VM | "Python 3.x with pip, poetry, uv…" | "Node.js 20, 21, and 22", with 22 on `PATH` | [cloud environments][cc-cloud], "Installed tools" |
| **Claude Cowork** (Claude desktop) | "a dedicated Linux VM" | **UNVERIFIED officially.** Two independent inspections (January 2026) found Python 3.10.12 | **UNVERIFIED officially.** Same inspections found Node.js 22.22.0 | official: [Cowork architecture][cowork-arch] says the VM exists but not what is installed; third-party: [pvieito][pvieito], [frr.dev][frr]. Note: the [get-started article][cowork-start] now says work "runs in an isolated environment on Anthropic's servers", so where Cowork runs may have changed (UNVERIFIED) |
| **claude.ai custom skills** (code execution / file creation) | an Anthropic container | yes | yes: "Claude to write and run code (for example Python or Javascript)"; version undocumented | [Create and edit files][claudeai-files] (updated 2026-08-06); [Agent Skills overview][skills-overview] |
| **Claude API skills** (code execution tool) | an Anthropic container, no network | "Python version: 3.11" | **not documented (UNVERIFIED).** Inferred present: Anthropic's own `docx` skill, offered on the API, says "`docx` is preinstalled … `require('docx')` directly" | [code execution tool][api-codeexec]; [anthropics/skills docx][docx-skill] |
| **Managed Agents cloud sandbox** | Ubuntu 24.04 container | "3.10, 3.11, 3.12, and 3.13" | "20, 21, and 22 (default)" | [cloud sandbox reference][managed-sandbox] |
| **Claude Agent SDK** | wherever the developer runs it | yes if they use the Python SDK ("Python 3.10+") | yes if they use the TypeScript SDK ("Node.js 18+") | [Agent SDK quickstart][sdk-quick]; both SDKs bundle the native Claude Code binary |
| **Our web app** | the browser tab, just-bash | **none.** `python3` is a fake command that reaches the JS ports (`design-web-agent.md` § 5). just-bash's real Python: "Python is not available in browser environments" | the ports are JS. just-bash's own `js-exec`: "not available in browser environments", so the fake-command dispatch stays either way | `packages/checkers/node_modules/just-bash/README.md` (3.4.2), lines 450 and 499 |
| **Remote MCP server** (plan, Step A: a Supabase Edge Function) | Deno | none | Deno runs the same ES modules (the ports import no `node:` module in `src/`); **UNVERIFIED** that the ports pass under Deno, never run | `docs/plan-portable-skills-and-web-agent.md` Part A; `packages/checkers/src/*.mjs` headers |
| **ChatGPT Work, Grok, Gemini Spark** | through the remote MCP server | moot | moot | the plan, Part A: "The prose ports; the scripts don't" |

**What this says.** Every surface where Python is documented also has
Node documented, except the API container, where Node is undocumented
but Anthropic's own shipped skill relies on it. The web app and the MCP
server can only run JavaScript. The one surface where **neither** is
guaranteed is a local machine, and that is true today: a local user
already has to install Python 3.10+.

**What I could not confirm.** Cowork's installed runtimes from any
Anthropic page; Node's presence and version in the API container;
Node's version on claude.ai. The local-machine claims below are common
knowledge I did not check against vendor pages: macOS's
`/usr/bin/python3` only works after the Command Line Tools install it
prompts for, and on Windows `python3` often opens the Microsoft Store
(both **UNVERIFIED**).

**A hidden cost of Python today.** The ports copy Python 3.14's
`argparse` wording (`packages/checkers/README.md:129-131`), because that
is the Python the parity suite runs against. A Cowork user on 3.10
(third-party evidence) or an API user on 3.11 runs a different Python,
so "byte-identical" is proven for one Python version only. JavaScript
gives one output on every host.

## 2. Inventory

### 2.1 Scripts that ship in skills

Lines are `wc -l` on `origin/main` at `1e8954f`. "Web" is whether the
web app's skills (`MVP_SKILLS`: profile, evaluate, apply, coach) call it.

| Script | Lines | JS port (lines) | Web | Local-only because | Python tests that run it |
|---|---|---|---|---|---|
| `apply/scripts/check_materials.py` | 315 | `check-materials.mjs` (283) | yes | - | `test_check_materials`, `test_three_lens_review`, `test_e2e_lifecycle` |
| `apply/scripts/proposal_block.py` | 151 | `proposal-block.mjs` (159) | yes | - | `test_proposal_block` |
| `apply/scripts/render_resume.py` | 173 | `render-resume.mjs` (169), **HTML and word count only** | yes | `--pdf` starts headless Chrome as a subprocess | `test_render_resume` (imports it as a library) |
| `coach/scripts/check_closeout.py` | 110 | `check-closeout.mjs` (173) | yes | - | `test_check_closeout`, `test_closeout_waiting_shapes`, `test_e2e_lifecycle` |
| `evaluate/scripts/record_verdict.py` | 75 | `record-verdict.mjs` (83) | yes | - | `test_e2e_lifecycle`, `test_evaluate_record_hint` (reads prose only) |
| `search/scripts/jobs_md.py` (library) | 178 | `jobs-md.mjs` (223) | yes | - | `test_jobs_md` (library) |
| `search/scripts/update_job.py` | 55 | `update-job.mjs` (59) | yes | - | through `test_e2e_lifecycle` and the parity corpus |
| `profile/scripts/check_files.py` | 477 | `check-files.mjs` (502) | yes | - | `test_check_files`, `test_three_lens_review`, `test_docs_guard`, `test_invariants` and `test_e2e_lifecycle` (as a library) |
| `learn/scripts/check_knowledge.py` | 56 | **none** | no | learn is not a web skill yet | `test_check_knowledge`, `test_e2e_lifecycle` |
| `outreach/scripts/check_messages.py` | 138 | **none** (web exits 127) | no | outreach is not a web skill yet | `test_check_messages`, `test_three_lens_review`, `test_e2e_lifecycle` |
| `storybank/scripts/check_stories.py` | 101 | **none** | no | storybank is not a web skill yet | `test_check_stories`, `test_e2e_lifecycle` |
| `search/scripts/search_ats.py` | 1,403 | **none** | no | network sweeps, RSS/XML, ten board vendors | `test_search_filters` (34), `test_search_targets` (12) |
| `search/scripts/discover_hn.py` | 210 | **none** | no | network | none |
| `search/scripts/discover_trackb.py` | 121 | **none** | no | network | none |
| `search/scripts/autopilot_sweep.py` | 49 | **none** | no | runs `search_ats.py` as a subprocess | none |
| `search/scripts/migrate_jobs_db.py` | 51 | **none** | no | one-shot SQLite migration (2026-08-14) | none |

- **Ported:** 8 files, 1,534 Python lines. Their ports share 1,011
  lines of helpers (`argx` 201, `py-text` 256, `py-digits` 46,
  `help-text` 13, `traceback` 25, `fs-walk` 71, `path-util` 66,
  `io-node` 62, `dispatch` 89, `just-bash-command` 77, plus the `bin/`
  wrappers, 98).
- **Not ported, small:** `check_knowledge`, `check_messages`,
  `check_stories`, 295 lines together, standard library only.
- **Not ported, going away anyway:** `search_ats`, `discover_hn`,
  `discover_trackb`, `autopilot_sweep` (1,783 lines) are deleted by
  web-search stage S4 (`docs/design-web-search.md` § 5.1). They should
  never be ported. `migrate_jobs_db` is "unrelated and stays" there; it
  is a one-shot migration from a storage format retired on 2026-08-14,
  a candidate for deletion (owner question 5).

### 2.2 Other Python

| Where | What | Ships in a skill? |
|---|---|---|
| `tests/run.py` | the one test command; already runs every Node, Deno and SQL suite | no |
| `tests/test_*.py` (18 files) | skill tests, repo rules, doc guards | no |
| `tests/word_report.py` | words loaded per tier | no |
| `tests/always-on/extract_text.py`, `dump_tools.py`, `score_t15.py`, a `python3 -c` in `lib_env.sh` | harness helpers | no |
| `tests/always-on/arms/lean/` | a pinned copy of the old skills, Python scripts included | no (a dated arm) |
| `kit/shapecheck.py` (305) | a copy of `check_files.py`'s domain-neutral functions for a second product, guarded identical by `kit/tests/test_kit.py` | **yes, in the other product** (owner question 4) |

### 2.3 The parity machinery JS-only would delete

| File | Lines | What it does |
|---|---|---|
| `packages/checkers/test/parity.mjs` | 844 | runs the real Python and the JS bins on each case and diffs them |
| `tests/checkers-parity/extra.mjs` | 704 | the tester's 141 adversarial cases, both engines |
| `packages/checkers/test/coverage-gate.mjs` | 177 | fails if any Python `def test_` has no parity case |
| `tests/checkers-parity/e2e_both.py` | 76 | replays `test_e2e_lifecycle` through both engines |
| `tests/run.py` parity wiring | about 35 | runs the four above |
| `packages/checkers/README.md` | most of 580 | nine documented places where JS and Python disagree, and how each is imitated |

About **1,800 lines of parity harness**, plus the **1,534 lines of
duplicate Python**, plus the standing rule that every future script
change is written twice. The case *inputs* in `parity.mjs` and
`extra.mjs` are worth keeping: they become ordinary expected-output
tests (§ 7, stage J1). What goes is the second runtime.

Already in the queue, and deleted before it is written under JS-only:
web-search S2 plans a new `boards.py` (about 300 lines) **and**
`boards.ts` **and** a board-parity suite with a hand-written entity
table and whitespace class, which exist only so two languages agree
(`design-web-search.md` § 4.4, § 5.2).

## 3. What changes in skill prose

**The count** (`grep` on `skills/**/*.md`): 8 explicit `python3`
invocations, and 73 mentions of a `.py` file name across 34 files (16 in
`SKILL.md` files). Most mentions are bare (`scripts/record_verdict.py`),
so the model picks the interpreter from the extension. Two template
files are copied into places we don't control:
`profile/templates/workspace-CLAUDE.md:30` (copied into every local
workspace at setup) and `profile/templates/web-host-note.md:7`.

**Options:**

| Option | What the prose says | For | Against |
|---|---|---|---|
| **A. Rename** | `node scripts/check_files.mjs --workspace .` | one runtime everywhere; the web dispatch matches `node <name>.mjs` exactly as it matches `python3 <name>.py` today; word count unchanged | a prose change, so it is measured (§ 7, J5) |
| B. Python shim | `python3 scripts/check_files.py`, a three-line file that starts Node | no prose change | the local host then needs **both** runtimes: worse than today. Rejected |
| C. No extension | `scripts/check_files`, a `#!/usr/bin/env node` file | prose never names a runtime again | needs the executable bit to survive plugin install and zip upload (**UNVERIFIED**); fails on native Windows; models tend to add an interpreter anyway. Rejected |
| D. A `run` command | `run check_files …` | runtime hidden | a new tool every host must install; the web needs another fake command; no host gives us one. Rejected |

**Recommendation: A.** Keep today's snake_case names so only the
extension changes (`check_files.py` → `check_files.mjs`).

- **Word budget:** `tests/word_report.py` counts whitespace-separated
  words (`word_report.py:16`); `python3` → `node` and `.py` → `.mjs`
  change no count. The tight web margins (`design-web-search.md` § 4.10:
  327 of 330 words, host note 110 of 110) are untouched. Adding `node`
  in front of the bare mentions would add about ten words across the
  skills; do it only if the harness shows the model guessing wrong.
- **Web dispatch:** register `node` as the just-bash custom command;
  match by file name as today. A leftover `python3 x.py` exits 127 with
  a message naming the `node … .mjs` form, so a model's habit costs one
  retry, not a silent failure. `packages/agent/src/cards.ts:85-95`
  matches script names to build cards; those names change, and so do
  the fixtures (`apps/web/fixtures/*.json`) and about 90 test references
  (`grep` count, `packages/agent`, `apps/web/src`, `tests/agent`).
- **Existing local workspaces:** each carries a copy of the template
  that says "run the coach skill's `check_closeout.py`". After the
  switch that file is gone. Either the template names the check without
  an extension ("the coach skill's close-out check, `check_closeout`, in
  its scripts folder") and profile offers a one-time refresh, or we
  accept that the model finds `check_closeout.mjs` itself. That is a
  behaviour, so a harness case must bait it (§ 7, J5). The web is not
  affected: its Tier 0 comes from the bundle.
- **The link guard:** `check_files.py:220` makes a prose mention of
  `…/x.md`, `.py` or `.html` that doesn't resolve a FAIL. It must learn
  `.mjs`, or a renamed script could be named in prose and missing on
  disk with no test failing. `tests/test_invariants.py:94` requires
  `".py"` in every Session close; it becomes `.mjs`.

## 4. Dependencies

Every Python script imports only the standard library (checked with
`grep` on each file's imports). None uses a PDF, XML or HTML library
that Node lacks.

| Python needs | Used by | Node equivalent | JS port today |
|---|---|---|---|
| `subprocess` → headless Chrome `--print-to-pdf`; page count by counting `/Type /Page` bytes | `render_resume.py:123-136` | `node:child_process` and `node:fs`, in the Node-only CLI wrapper; the shared module stays browser-safe | prints "PDF: NOT RENDERED — the web app renders the HTML for the candidate's own browser to print" (`render-resume.mjs:164-166`) |
| `urllib.request` | `search_ats`, `discover_hn` | global `fetch` (Node 18+) | none; deleted by S4 |
| `xml.etree` (Teamtailor RSS) | `search_ats.py:209` | no built-in XML parser in Node | none; Teamtailor is deleted by S4 (§ 5.1) |
| `html.unescape` | `search_ats` | none built in; S2 already specifies a fixed entity table | none; deleted by S4 |
| `sqlite3` | `migrate_jobs_db.py` | `node:sqlite` (Node 22.5+; stability **UNVERIFIED**) | none; retire instead |
| `argparse` | every CLI | none needed | `argx.mjs` imitates argparse's exact messages |

The ports have no dependencies. I ran `node packages/checkers/bin/check_closeout.mjs --help`
and `bin/check_files.mjs` in this worktree, which has no `node_modules`:
both ran. `just-bash` is imported only by the web adapter.

## 5. The test harness: what must move, what can stay

**Must change (it touches what ships):**

- The 8 test files that start a script with `[sys.executable, SCRIPT]`
  (`test_check_files`, `test_check_knowledge`, `test_check_closeout`,
  `test_check_stories`, `test_closeout_waiting_shapes`,
  `test_e2e_lifecycle`, `test_proposal_block`, `test_three_lens_review`):
  swap to `["node", SCRIPT_MJS]`. They stay Python and become black-box
  tests of the JS scripts, written before the switch: a good property.
- The 9 test files that import a script **as a library** (about 100 calls
  to internal functions: `cf.load_schemas`, `cm.check_resume`,
  `jm.save`, `rr.to_html`, `waiting_rows`, …): those move to the JS unit
  tests. `packages/checkers/test/unit/` already mirrors most of them,
  and the coverage gate already maps every `def test_` to a JS case, so
  the gate's map is the migration checklist. `test_invariants.py` and
  `test_docs_guard.py` use `check_files` as a library for repo rules;
  they either call the `.mjs` CLI or move to `node --test`.
- The conduct harness runners that produce the deterministic check
  output the judge reads: 8 lines in `run_t6/t7/t8/t9/t10/t13/t15.sh`
  (`python3 "$RUNNER_SKILLS_DIR/…/x.py"` → `node …/x.mjs`).
- `tests/test_search_filters.py` and `test_search_targets.py`: deleted
  by S4 anyway.

**Can stay Python (never ships):** `tests/run.py`, `word_report.py`,
the harness helpers (`extract_text.py`, `dump_tools.py`,
`score_t15.py`, `lib_env.sh`), and the lean arm, which is a pinned
historical copy. Contributors already need both (`CONTRIBUTING.md:15-16`).
Porting them buys nothing a user sees.

**The one decision:** `kit/shapecheck.py` is a guarded copy of the
host checker for a second product (`kit/README.md`). If the host
checker becomes JS, the kit's copy either becomes `shapecheck.mjs`
(the guard compares JS), or it is frozen as Python and allowed to drift
from the host. Owner question 4.

## 6. Risks

1. **A local user without Node.** The same risk exists today for Python.
   What changes is which install we ask for: `INSTALL.md` goes from
   "Python 3.10+" to "Node.js N+". A missing interpreter fails loudly
   in the shell ("command not found"), but a model can narrate a check
   it never ran (rule 11). The harness counts that (§ 7, J5).
2. **Minimum Node version: UNVERIFIED.** The ports use Unicode regex
   escapes, `replaceAll` and `TextDecoder`; S2's board reader would use
   `fetch` (Node 18+). Ubuntu 24.04's own packaged Node is said to be 18
   (a web search summary with no clear source; **UNVERIFIED**). Proposal: floor
   Node 18, proven by running the expected-output corpus on Node 18 and
   on the current release before the floor is written into `INSTALL.md`.
3. **Measurement receipts.** The earned moment rules are about conduct,
   not the interpreter, and none of their receipts names `python3`. The
   eval records that quote a command (3 files in `docs/evals/`) are
   dated records and stay as written. A pure command rename changes no
   rule, but it can change behaviour (the model reaches for the wrong
   interpreter, or skips the check), so it is measured once (J5), not
   per skill.
4. **Stale copies.**
   - `cp -r skills/* ~/.claude/skills/` never deletes (`CLAUDE.md`). After
     the switch, every old `.py` stays in the deployed copy, and a model
     may run a stale Python checker with old behaviour. The stage exit
     must remove them by hand.
   - Whether a marketplace plugin update removes deleted files is
     **UNVERIFIED**.
   - Existing workspaces' `CLAUDE.md` (§ 3).
5. **Packaging without npm.** A skill can ship plain `.mjs` files with
   relative imports and no `package.json` (shown in § 4). Two limits:
   - Shared helpers need one home. Cross-skill imports already exist in
     Python: `record_verdict.py` puts `../../search/scripts` on its path
     to import `jobs_md`. So cross-skill imports are not new.
   - A skill uploaded alone as a zip (claude.ai) loses its cross-skill
     imports. That is equally true of Python today, and the prose's
     cross-skill links (`../profile/scripts/check_files.py`) break there
     too. Single-skill upload is not a supported path now.
   - Bundling each script into one self-contained file (esbuild) would
     remove the limit, but it adds a build step and committed generated
     copies (rule 12). Not recommended unless single-skill upload
     becomes a goal.
6. **The Python-imitation layer stays at first.** `argx`, `py-text`,
   `help-text` and `traceback` exist to match Python byte for byte. After
   the switch they are simply the behaviour. Deleting them changes output,
   so they stay until a deliberate, reviewed expected-output change
   justifies it. One such change is required at the switch: help and
   usage text say `check_closeout.py` and must say `.mjs`.
7. **Sequencing with B1.** B1 batches may touch only `SKILL.md` and
   `patterns.md`, and a check fails a B1 branch that crosses into
   `scripts/` (plan, Step B1 guardrails). The switch touches both, so
   no B1 batch should be open on a skill while its scripts switch.

## 7. Recommendation and migration plan

**JS-only: yes, for every script that ships in a skill. Partial in
two places:**

- repo tooling stays Python;
- the search scripts are retired by S4, never ported.

Conditions:

- the owner accepts Node as the local requirement (question 1);
- the J5 measurement shows no regression.

**Why (rule 12, one of everything):** the plan allowed the duplicate
"only with a loud-fail parity test … until the local plugin switches
over" (plan, Phase 0 row 6). The parity test has done its job. Nothing
in the Python does anything Node can't, and Python cannot reach the web
app or the MCP server. The duplicate now costs every change twice, and
it guarantees identical output for one Python version only (§ 1).

### Stages, each through `docs/PROCESS.md`

| Stage | What | PROCESS steps | Owner | Effort |
|---|---|---|---|---|
| **J0. Gate** | This investigation → owner decisions (§ 9). Chain text: `skill-shape.md:22` `scripts/*.py` → zero-dependency `scripts/*.mjs` run with `node`; plan row 6 "switched"; `design-web-agent.md` § 5 dispatch on `node`; `INSTALL.md`, `CONTRIBUTING.md`, `loading-map.md` § Tier 4, `ARCHITECTURE.md`. One GitHub issue. Prior art: Anthropic's own `docx` skill mixes Node and Python scripts ([docx-skill]), so one-runtime skills are a choice, not a host rule | 1, 2, 3 | Ar, O | 0.5 day |
| **J1. Freeze the spec** | Run the Python once, at one pinned commit, over every case in `parity.mjs`, `extra.mjs`, `e2e_both.py` and the coverage map. Save argv, input files, stdout, stderr, exit code and changed files as expected-output tests. From then on Python's behaviour is a record, not a running twin | 4 | Te | 1–1.5 days |
| **J2. Move the 8 ported scripts** (same PR as J1) | The ports become `skills/*/scripts/<name>.mjs` (one copy; `packages/checkers` imports them from `skills/`). Shared helpers live in one skill folder (proposal: `profile/scripts/lib/`, beside the shared `check_files`). Add `render_resume`'s Chrome path in the Node-only wrapper. `check_files` link rung learns `.mjs`. Help and usage names change (the one deliberate expected-output change). Delete the 8 Python files. Re-point the Python CLI tests to `node`; move library-level tests to JS by the coverage map. Web: dispatch on `node`, `python3` → 127 naming the new form; `cards.ts` names; fixtures | 4, 5 | Co, Te | 3–4 days + 2 days test |
| **J3. Port the three small checkers** | `check_knowledge`, `check_messages`, `check_stories` (295 lines): expected outputs from Python first (as J1), then the port, then delete the Python | 4, 5 | Co, Te | 1.5 days + 1 day test |
| **J4. Prose and templates** | 8 `python3` → `node`; 73 `.py` names → `.mjs`; the workspace template's close-out line (question 8); harness runners' 8 lines; `test_invariants.py:94` | 4, 5 (independent review against the chain) | Co, reviewer | 1 day |
| **J5. Live run, then the measured harness** | Live: a fixture persona in a fresh temp workspace on local Claude Code **and** Cowork, one journey touching every script. Then the harness: **(a) mechanical, from the tool logs (`dump_tools.py`), every trial:** every script call is `node … .mjs`; zero `python3` calls; zero "command not found" or exit 127; every Session close's check actually ran (a close that reports a result with no matching call fails). **(b) conduct, majority of 3:** t6, t7, t8, t9, t10, t13 at their last recorded pass rates or better. **(c) one new case:** an existing workspace whose `CLAUDE.md` still names `check_closeout.py`. Spend: 18 cases × 3 trials ≈ $60 runner + $16 judge, about **$75, or about $150 with a fresh baseline arm**, from `docs/evals/rule-inventory.md`'s medians, which are themselves **UNVERIFIED**; owner approves first (rule 5). Recorded in `docs/evals/eval-js-only.md` | 6, 7 | Te, O | 1–2 days + spend |
| **J6. Close** | Closing drift review of what the acceptance produced; `cp -r skills/* ~/.claude/skills/` **and** delete every `.py` under `~/.claude/skills/*/scripts/` by hand; plugin version bump; owner's own-workspace run as numbers only | 8, 9 | Ar, O | 0.5 day |

**Total:** about 10–13 agent-days, roughly two calendar weeks with
review rounds, plus the harness spend. J1 and J2 ship as one pull
request, so no commit has skills pointing at missing scripts. J3 can
fold into J2.

**Proved by:** the J1 expected-output corpus passes 100% on Node 18 and
the current Node; `tests/run.py` green with no Python left under
`skills/*/scripts/` (a new invariant: `find skills -name '*.py'` is
empty after J3, allowing only the search files S4 deletes); J5's
mechanical metric at zero failures; conduct at or above baseline.
**Prevents:** a script behaving one way locally and another on the web
(rule 14), two copies drifting (rule 12), and every future change paid
twice.

### In-flight work

- **Web-search S1** (jobs list hardening, the `Analysis` field,
  `--analysis-file` and `--existing`): **do not pause.** It is small, it
  is already specified with parity cases, the parity machinery for it
  already exists, and it unblocks the workspace stages W3b and W3d
  before the beta. Its Python half (under a day) is thrown away at J2;
  that costs less than holding the beta path for the switch.
- **The page-forms chain fix** (coach's minutes form with a WARN in
  `check_closeout`, `design-web-ui.md` "Chain fixes"; evaluate's
  claim-tier form if adopted): same answer. It is a few lines in each
  runtime. If J2 lands first, write it in JS only.
- **Web-search S2** (board readers): **write it JS-only** if the owner
  says yes to J0: one `skills/search/scripts/boards.mjs` whose pure
  parts `packages/agent`'s `list_board` imports, and whose Workday
  reader runs only under Node. No `boards.py`, no board-parity suite, no
  two-language entity table. This is the single largest saving. If the
  answer is no, S2 proceeds as designed.
- **Web-search S4** (the local search rewrite): its new prose names
  `node` commands, so its § 8 comparison measures them at no extra
  cost. It deletes `search_ats`, `discover_*` and `autopilot_sweep`, so
  nothing there is ported.
- **Suggested order:** S1 and page-forms land now, in both runtimes →
  J0 → J1+J2 → S2 in JS → J3, J4 → J5 → S3–S7 as designed.

## 8. Chain check

- No conflict in the precedence chain. `PRINCIPLES.md` rule 14 names
  "deterministic code", not a language; the goals and the working
  design name checkers by file (`design-cowork-coaching.md:126, 488-491`),
  and those names change with J4.
- `skill-shape.md:22` names `scripts/*.py`: an amendment the plan's
  row 6 already anticipated, not a conflict.
- **Doc drift found on the way (not a chain conflict):**
  `design-web-agent.md:353` says the parity corpus is
  `tests/parity/cases/<script>/<case>/`. No such folder exists; the
  cases live inline in `packages/checkers/test/parity.mjs` and
  `tests/checkers-parity/extra.mjs`. J1 makes this moot, but until
  then § 5 describes a folder nobody can find.

## 9. Open questions for the owner

1. **Node instead of Python as the local requirement?** `INSTALL.md`
   would say Node.js 18+ (after J1 proves 18). Local users without Node
   must install it; Cowork appears to have both (third-party evidence
   only).
2. **S1 and the page-forms fix:** land in both runtimes now
   (recommended), or hold them for J2?
3. **S2:** write the board readers in JS only (recommended, if yes
   to 1)?
4. **`kit/shapecheck.py`:** port it with the host checker, or freeze the
   kit as Python and let it drift (this affects the second product)?
5. **`migrate_jobs_db.py`:** retire it? Only a workspace still holding
   a `jobs.db` from before 2026-08-14 needs it.
6. **Harness spend** for J5: about $75, or about $150 with a fresh
   baseline arm (**UNVERIFIED** estimate).
7. **Where the shared helpers live** (proposal: `profile/scripts/lib/`),
   and confirming single-skill zip upload stays unsupported.
8. **Existing workspaces' `CLAUDE.md`:** name the close-out check
   without an extension in the template, plus a one-time refresh offer
   from profile; or rely on the model finding `check_closeout.mjs`
   (J5's case (c) measures it either way).

## 10. Facts checked (2026-09-26) and what stays UNVERIFIED

**Checked:**

- Claude Code's installers need no Node ([setup][cc-setup]).
- Cloud sessions: Python 3.x and Node 20/21/22 ([cc-cloud]).
- Managed Agents sandbox: Python 3.10–3.13 and Node 20/21/22
  ([managed-sandbox]).
- API code execution: Python 3.11, with no Node listed
  ([api-codeexec]).
- claude.ai runs "Python or Javascript" ([claudeai-files]).
- Agent SDK: "Node.js 18+ or Python 3.10+" ([sdk-quick]).
- just-bash 3.4.2: neither real Python nor `js-exec` runs in a browser
  (its README).
- The Python scripts import only the standard library (grep).
- The JS bins run with no `node_modules` (ran them).

**UNVERIFIED:**

- Cowork's installed runtimes, and whether Cowork now runs locally or
  on Anthropic's servers.
- Node's presence and version in the API container (inferred from the
  `docx` skill).
- Node's version on claude.ai.
- The minimum Node version the ports need.
- The ports running under Deno.
- Whether the executable bit and file deletions survive plugin install
  and update.
- macOS's and Windows' default `python3` behaviour.
- The script runtimes of ChatGPT Work, Grok and Gemini Spark (moot per
  the plan).
- The harness cost figures.

[cc-setup]: https://code.claude.com/docs/en/setup
[cc-cloud]: https://code.claude.com/docs/en/cloud-environments
[cowork-arch]: https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview
[cowork-start]: https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork
[pvieito]: https://pvieito.com/2026/01/inside-claude-cowork
[frr]: https://www.frr.dev/posts/claude-vm-cowork-code-comparison/
[claudeai-files]: https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude
[skills-overview]: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
[api-codeexec]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool
[docx-skill]: https://github.com/anthropics/skills/blob/main/skills/docx/SKILL.md
[managed-sandbox]: https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference
[sdk-quick]: https://code.claude.com/docs/en/agent-sdk/quickstart
