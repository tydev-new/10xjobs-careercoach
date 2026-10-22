# Design - Ten as skills only: the hosts, the script language, and PR #43

**Status:** research and design gate, a draft for the lead and the owner ·
**Date:** 2026-10-22 · **Author:** architect · **Not built, nothing
decided** until the owner answers § 8.

**The owner's direction (2026-10-22, in chat):** "I'm thinking about moving
to skill only, and support grok bot, claude code/cowork, chatgpt dot. And
remove our own web and agent infra." Then: "yes, it's the direction we're
headed. The question for this PR is making sure it'll work with all agents
from grok, claude, chatgpt, and google." Then: "and meta muse". The owner
later gave the product pages for the two names the first pass was unsure
of: ChatGPT dots (`chatgpt.com/features/dots/`) and Muse (`muse.ai`).

**What this doc covers:** which hosts can run Ten as skills, the one script
language, PR #43 against those hosts, what breaks in today's skills, and a
smoke test per host that the owner runs by hand. **What it does not cover:**
shutting down the web app and its agent infrastructure. That is a separate,
later plan.

**Precedence:** `PRINCIPLES.md` → `design-cowork-coaching-goals.md` →
`design-cowork-coaching.md` → `skill-shape.md`. The skills-only direction
conflicts with four places in that chain (§ 7). They are reported, not
resolved.

**How to read the evidence.** Every claim about a host carries a source key
in square brackets, listed with its URL and date in § 10. **Vendor** means
the vendor's own docs or blog. **Third-party** means a blog or press
article, and it is marked so. **UNVERIFIED** means I could not confirm it
from any source. Vendor pages often carry no date; § 10 says so where that
is the case. All sources were read on 2026-10-21 and 2026-10-22.

---

## 1. What the owner's names point to

| Owner's word | The product | How sure | Why |
|---|---|---|---|
| "grok bot" | **xAI Grok Bot**: always-on agents ("Bots") that share one persistent cloud computer per account. Beta since August 2026 [X1, X7] | High | The product's exact name. The owner's own word, so it is the primary xAI target. xAI's local coding agent, **Grok Build**, is listed as a secondary row |
| "claude code/cowork" | **Claude Code** (terminal and the desktop app's Code tab) and **Claude Cowork** (the desktop app's local-folder mode, which runs commands in a local virtual machine) [C4, C7] | High | The owner named both |
| "chatgpt dot" | **ChatGPT dots**: always-on agents inside ChatGPT, each with its own cloud computer, launched 2026-09-29 [O1, O4]. The owner's page `chatgpt.com/features/dots/` returned 403 to my reader, and so did `openai.com/index/introducing-dots/`. The facts below come from OpenAI's docs site, `learn.chatgpt.com` | High | The owner's own link. OpenAI's **Codex** (the coding agent in the same app) is listed as a secondary row, because a dot hands coding tasks to it [O3] |
| "google" | Two products. **Gemini Spark** is Google's always-on agent in the Gemini app (launched 2026-05-19 [G1]); it is the same kind of product as dots and Grok Bot, and it is the host the earlier plan named (`plan-portable-skills-and-web-agent.md` Part A). **Google Antigravity** (desktop app, IDE and the `agy` CLI) is Google's coding agent [G8]. **Gemini CLI is not a target:** it stopped serving free, Google AI Pro and Ultra users on 2026-06-18, replaced by Antigravity CLI [G9] | Medium on which one the owner means | Owner question 1 (§ 8) |
| "meta muse" | **Muse** at `muse.ai`, a personal AI agent. **It is Meta's**: the page footer says "© Meta 2026", its sign-in redirects through `facebook.com`, and the domain's registrant is Meta Platforms, Inc. (`whois muse.ai`, read 2026-10-22). Launched 2026-09-08 in the US on iOS, Android and the web [M1, M12]. Meta's coding agent, **Muse Code**, is listed as a secondary row | High | The owner's own link, and the ownership is confirmed three ways |

The pattern: the owner's list is four **always-on cloud agents** (Grok Bot,
dots, Spark, Muse), each with its own computer at the vendor, plus Claude
Code and Cowork, which work in a folder on the user's own computer.

---

## 2. The host matrix

Six questions, one row per host. The owner's targets come first. The three
developer agents at the bottom matter because they are the same vendors'
way of running skills on the user's own computer.

**Questions:** (1) Skills: does it load `SKILL.md` folders (the open Agent
Skills format [A1]), and how does a user install from a GitHub link?
(2) Files: a folder on the user's computer, or a cloud computer, and does
it last between sessions? (3) Code: can it run code, with which Python and
Node? (4) Network: can a script make outbound web requests? (5) Subagents:
can it run separate agents with their own context? (6) Price: what a free or
ordinary paid user gets.

### 2.1 The owner's targets

| Host | 1 Skills | 2 Files | 3 Code | 4 Network | 5 Subagents | 6 Price |
|---|---|---|---|---|---|---|
| **Claude Code** | Yes, Agent Skills [C1]. From GitHub: `/plugin marketplace add tydev-new/10xjobs-careercoach`, then `/plugin install` (`INSTALL.md`) | The user's own folder; it lasts [C4] | Whatever the user has installed. Nothing is guaranteed | Yes. An optional OS sandbox can limit it [C4] | Yes: own context, run in parallel, up to 20 at once [C3] | Pro ($20 a month) and up; not Free [C7] |
| **Claude Cowork** | Yes: plugins, and skills enabled on the user's claude.ai account [C1]. Skill folders are mounted read-only into the VM [C4]. `INSTALL.md` says plugins installed in Claude Code show up in Cowork; a third-party guide says the two have separate plugin panels: **UNVERIFIED** | A folder the user attaches is mounted into the VM, and edits land on disk [C4] | Linux VM: Python 3.10.12, Node 22.22.0, pip and npm work (third-party, January 2026 [C5]) | Allowlist. Consumer setting: "Package managers only" or "All domains", plus added domains (third-party [C6]). Only the Anthropic API, PyPI and npm were reachable in one test [C5] | The Task tool is present in the VM's Claude Code (third-party [C5]); as a product feature, **UNVERIFIED** | Rolling out to Pro and Max; Team has it [C7] |
| **ChatGPT dots** | ChatGPT skills use the `SKILL.md` format [O5, O6]. A dot can use plugins installed for the account; "Local skills require a connected computer" [O1, O2]. Install from GitHub into a dot: **UNVERIFIED** (Codex's `$skill-installer` installs from repos [O6]) | Its own cloud computer, which "can keep its state" with "its own files, software" [O2]. Optionally one connected personal computer, online with the ChatGPT app open [O1] | The cloud computer runs software [O1]; its Python and Node: **UNVERIFIED**. A dot can hand coding tasks to a Codex cloud environment the user set up [O3], whose reference image offers Python 3.10 to 3.14 and Node 18, 20, 22 [O9] | The dot's own computer: **UNVERIFIED**. Codex cloud: a per-environment setting [O8] | Yes: "background agents that run in parallel and report back" [O13] | Pro ($100, $200 or $500 a month; not in the EEA, UK or Switzerland) and Business Premium; Enterprise beta if an admin turns it on [O1] |
| **Grok Bot** | Bot skills are made in chat (Skill Creator) or come in plugins, and `/` invokes them [X2, X4]. No documented `SKILL.md` import or GitHub install for Bots [X4, X5]. Pointing a Bot at a `SKILL.md` and asking it to follow it worked in one test (third-party [X4]) | One persistent cloud computer per account, shared by every Bot; keep durable files in `/workspace`; installed packages are "replaceable"; a reset restores the last snapshot [X2, X3] | "A browser, command line, files" on a managed Linux VM [X2, X3]. Python and Node: **UNVERIFIED** | Yes, through shared IP addresses; optionally routed through the user's desktop [X3] | Several Bots run in parallel, message each other and hand work over [X1]. A model-spawned "subagent" is not documented | Paid Cursor plans, or SuperGrok Plus or Heavy; not SuperGrok Lite [X1, X3] |
| **Gemini Spark** | Upload a `SKILL.md`, or a folder or `.zip` with one at its top, on the Skills page (100 MB in total). Skills work "only" in Spark for now [G2]. No GitHub install | A cloud agent [G1]. The Mac app can work in folders the user links (US, Ultra, beta since 2026-06-30 [G11]). A lasting folder for skill work: **UNVERIFIED** | Code files `.py` and `.sh` are listed as allowed; `.js` and `.mjs` are not listed [G2]. Runtimes: **UNVERIFIED** | **No.** "Scripts that need internet access are not supported" [G2] | "Custom sub-agents" were announced as coming [G1]; shipped: **UNVERIFIED** | Google AI Pro or Ultra; not in the EEA, UK, Switzerland or Nigeria (third-party [G12]). The skills help page says skills need no subscription [G2], which conflicts |
| **Google Antigravity** | Yes, `SKILL.md` (`description` required). Workspace: `.agents/skills/`. Global: `~/.gemini/config/skills/` (app, IDE) or `~/.gemini/antigravity-cli/skills/` (CLI). `agy plugin install <GitHub URL>` [G3] | The user's own folders [G8] | Whatever the user has installed | The app's terminal sandbox is on by default on macOS and Linux, with **no network by default**; the CLI's sandbox is off by default [G5] | Yes: clean context, several at once [G6] | A free weekly quota; more on Google AI Pro and Ultra [G7] |
| **Meta Muse** | Meta writes Muse's built-in skills, and they "are already part of Muse" [M3]. Meta's engineering post mentions "developing custom skills" in the VM [M13], but Meta documents no way to install a `SKILL.md` [M4]. Attaching a `SKILL.md` to a chat and asking Muse to follow it worked in one test (third-party [M4]) | A persistent, isolated Linux computer per user ("Muse Secure VM") [M12]; a "full debian image", "backed up continuously"; users can "inspect, edit and download" its files [M13] | Muse "has its own computer, with a file system and a terminal, so it can write its own code" [M14]. Python and Node: **UNVERIFIED** | Every request passes "Sentinel", which allows, denies or asks by the user's policy [M13]. Default rules: **UNVERIFIED** | Yes: Muse "launches swarms of subagents" [M13] | A free tier, and $20 or $100 a month [M1] |

### 2.2 The same vendors' developer agents (secondary)

| Host | 1 Skills | 2 Files | 3 Code | 4 Network | 5 Subagents | 6 Price |
|---|---|---|---|---|---|---|
| **Codex** (OpenAI) | `SKILL.md` in `.agents/skills` (repo) and `~/.agents/skills` (user); `$skill-installer` installs from repos [O6]. Reads `AGENTS.md` [O7] | Local folder, or a cloud task (saved for up to 7 days) [O8] | Local: the user's. Cloud: see dots | Local default sandbox: **no network** unless turned on [O10]. Cloud: per environment [O8] | Yes, when asked [O11] | In every ChatGPT plan from Free up [O12] |
| **Grok Build** (xAI) | `SKILL.md` in `.grok/skills`, `~/.grok/skills`, `~/.agents/skills`; "fully compatible with Claude Code with zero configuration needed" [X6]. Reads `AGENTS.md` and `CLAUDE.md` [X6] | Local | The user's | Sandbox off by default (third-party [X5]) | Yes (third-party [X5]) | SuperGrok ($30) or X Premium+ ($40) (third-party [X8]) |
| **Muse Code** (Meta) | `SKILL.md` in `.agents/skills` and `~/.agents/skills`; also reads `~/.claude/skills` and `.claude/skills`; `muse skills import --from claude` [M7]. Reads `AGENTS.md`, then `CLAUDE.md` [M8] | Local; macOS and Linux [M6] | The user's | A `--sandbox-network` flag; default **UNVERIFIED** [M8] | Yes, 8 at once by default [M7] | Paid tiers from $5 to $200 a month (third-party, and the sources conflict [M10]) |

### 2.3 What the matrix says

- **Every target reads `SKILL.md` except, as documented, Grok Bot and Muse.**
  Both have a Linux computer with a terminal, so a Bot or Muse could clone
  the repository and follow the skills. Neither vendor documents that as a
  way to install. The smoke test (§ 6) decides.
- **No runtime is verified on every target.** Where a host documents
  either runtime, it has both: Cowork, ChatGPT's chat containers [O14] and
  Codex cloud. Grok Bot, the dots' own computer and Muse document a
  terminal but not which runtimes it has.
- **Network is blocked by default on most hosts.** That covers Cowork (for
  anything but package managers), ChatGPT's chat containers [O14], Codex
  local, the Antigravity app and Spark (always). It is open on Grok Bot and
  on the user's own computer. Muse asks through Sentinel.
- **The always-on hosts keep the candidate's files on the vendor's
  computer.** That collides with rule 9 (§ 7).

---

## 3. The script language

### 3.1 The facts

| Host | Python | Node | Source |
|---|---|---|---|
| Claude Code, Codex local, Grok Build, Antigravity, Muse Code | whatever the user installed | whatever the user installed | the user's own computer |
| Cowork VM | 3.10.12 | 22.22.0 | [C5], third-party, January 2026 |
| ChatGPT chat containers | yes | yes | [O14], third-party, January 2026 |
| Codex cloud (dots can delegate here) | 3.10 to 3.14 | 18, 20, 22 | [O9], reference image, "not an identical environment" |
| dots' own computer, Grok Bot, Muse | **UNVERIFIED** | **UNVERIFIED** | terminals documented, runtimes not |
| Gemini Spark | `.py` listed as an allowed file | `.js`/`.mjs` not listed | [G2]; runtimes **UNVERIFIED** |

**Today's skills already need both runtimes**, which is drift.
`INSTALL.md:42` says Node.js 18 is the one requirement. Yet 8 Python scripts
remain, and the prose calls them: `outreach/SKILL.md:62`,
`storybank/SKILL.md:67`, `learn/SKILL.md:47`, `search/SKILL.md:54`, and
`search/references/patterns.md:19,22,23`. Stage J3 of
`design-js-only.md` never ran.

**What the web's removal takes away from the JavaScript decision.** D1
prevented "a script behaving differently on the web and locally". With no
web, that reason is gone. D2 prevented "two copies drifting" (rule 12), and
that reason stays. The browser also explains some of today's complexity,
which can go later: the `scripts/lib/` split that keeps `node:` imports out
of browser code, and the 544 lines of Python-imitation helpers (`argx`,
`py-text`, `py-digits`, `help-text`, `traceback` in
`skills/profile/scripts/lib/`). Those helpers exist only because Python's
output is the frozen specification (`tests/checkers/FROZEN_AT`).

### 3.2 Recommendation

1. **One runtime, never both** (rule 12).
2. **The runtime probe decides, by a rule written now.** Step 0 of each
   host's smoke test (§ 6) runs `python3 --version` and `node --version` in
   the host's own terminal. The rule: **stay on Node if, on every target
   host where Python runs, Node runs too. Otherwise move every shipped
   script to Python 3.10+ with the standard library only.**
   - *Prevents:* picking a runtime by taste, then finding a target host
     that cannot run it (rule 17).
   - *Proved by:* the probe table in the smoke record (§ 6.4).
   - *Today's lean is to stay on Node.* No host is yet known to run Python
     but not Node. Spark's file-type list is the only hint against Node,
     and Spark fails Ten on network and on single-skill upload anyway
     (§ 4). Nine scripts are already ported and checked byte for byte.
   - *If the probe says Python,* the Python originals are in git
     (deleted at `ed7c4e8`), and `tests/checkers/cases/` is their own
     recorded output, so restoring them can be checked mechanically. The
     JavaScript-only additions since then (`feedback.mjs`, `boards.mjs`)
     would be ported.
3. **Pause J3** (porting the 8 remaining Python scripts) until the probe
   is in. **Fix `INSTALL.md` now** so it says both runtimes are needed until
   then. *Prevents:* a user who follows `INSTALL.md` hitting "python3: not
   found" in outreach, storybank, learn or search. *Proved by:* grep finds
   no `python3` in `skills/` that `INSTALL.md` fails to cover.
4. **A host with neither runtime runs Ten as prose, and says what didn't
   run.** This needs no new rule. The behaviour follows from rules that
   exist:
   - Every script's result is reported as "could not run". That extends
     the existing VOID rule (`skill-shape.md:112-113`,
     `profile/references/language-check.md:145-147`).
   - Nothing that needs a passing check gets called finished. For
     example, apply never calls a package ready
     (`apply/SKILL.md:17`: "Deterministic checks pass … before the package
     is called ready").
   - It is not a refusal. The coaching still helps, and the candidate is
     told plainly what was not checked (rule 8).
   - *Proved by:* smoke probe S4 on any host where step 0 shows no runtime.

### 3.3 D1 and D2 without the web: target text for `design-js-only.md` § 1

Proposed for the owner. It goes in only after the probe, and only if Node
stays:

> | D1 | **One runtime for every shipped script: Node.js 18 or newer** (amended 2026-10-xx, skills only: the web app is gone, so the reason is that every target host that runs Python also runs Node, measured by the per-host runtime probe in `design-skills-only-hosts.md` § 6) | a user or a host needing two runtimes | the probe table shows `node` wherever `python3` runs; every expected-output case passes on Node 18.19.1 and the current Node |
> | D2 | **Every shipped script (`skills/*/scripts`, `kit/`) is JavaScript only.** Contributor tooling (`tests/`, the harness) may stay Python: stage T is dropped, because a contributor's runtime never reaches a user | two copies of a script drifting (rule 12) | `git ls-files 'skills/*.py' 'kit/*.py'` is empty |

If the probe says Python, D1 and D2 swap the language and keep the same
shape. The proof becomes `git ls-files 'skills/*.mjs' 'kit/*.mjs'` is
empty, and the Python-imitation helpers are deleted with the JavaScript.

---

## 4. Today's skills against the matrix: what breaks where

Each row says where it is in the repo, which hosts break, and what a fix
would prevent. No fix is proposed where no host has failed yet, because a
rule needs a trigger (rule 13). The smoke test is that trigger.

| # | What | Evidence | Breaks on | Proposed change, what it prevents, how it is proved |
|---|---|---|---|---|
| B1 | **Two runtimes needed, one documented** | `INSTALL.md:42`; the `python3` calls in § 3.1 | Every host without Python | § 3.2 item 3 |
| B2 | **The guardrails file is named `CLAUDE.md`** | `profile/SKILL.md:17,42,46`; "Required: Workspace `CLAUDE.md`" in 8 skills (`apply:23`, `evaluate:24`, `coach:28`, `learn:22`, `outreach:23`, `storybank:22`, `interview:25`, `search:22`); goals doc § 2 (`design-cowork-coaching-goals.md:93`) | Auto-loaded only by Claude Code, Grok Build and Muse Code (and Cowork, **UNVERIFIED**). Codex reads only `AGENTS.md`, unless the user configures other names [O7]. Antigravity reads `AGENTS.md` or `GEMINI.md` [G4]. The always-on hosts document no auto-loaded file | **Rename it `AGENTS.md`, and make each skill's prerequisite say "read the workspace `AGENTS.md`".** `AGENTS.md` is read by Claude Code (when there is no `CLAUDE.md` in the folder or above it [C2]), Codex [O7], Grok Build [X6], Antigravity [G4] and Muse Code [M8]. The explicit read step covers the hosts that load nothing, and it covers a stray `CLAUDE.md` above the folder, which makes Claude Code skip `AGENTS.md` [C2]. *Prevents:* the guardrails silently not loading. *Proved by:* smoke probe S3 on every host. Also needed: a goals-doc amendment (§ 7), a template version bump, and the existing refresh-by-offer for old workspaces |
| B3 | **Cross-skill relative paths** | `../profile/scripts/check_files.mjs` appears 17 times in skill prose; `../search/scripts/update_job.mjs`; every script imports `../../profile/scripts/lib/` (`design-js-only.md` D5) | Hosts that take skills one at a time: Spark [G2], ChatGPT upload [O15]; Grok Bot and Muse **UNVERIFIED**. Fine wherever all ten folders sit side by side (plugin installs, `~/.claude/skills`, `~/.agents/skills`, `.agents/skills`) | **No change yet.** D5 already calls single-skill upload unsupported. Revisit only if an upload-only host passes S0 (a runtime) and S6 (network). Spark cannot pass S6 [G2]. The open option is a release step that zips each skill with the shared files it needs, never committed |
| B4 | **Script paths are relative to the skill folder** | `node scripts/check_files.mjs --workspace .` (`profile/SKILL.md:112`, and the same form in every skill) | Any host that does not tell the model where the skill folder is. Claude Code does (`${CLAUDE_SKILL_DIR}` [C1]); the others are **UNVERIFIED**. The spec says paths are "relative … from the skill root" [A1] | No change until S2 shows "Cannot find module" on some host |
| B5 | **`${CLAUDE_PLUGIN_ROOT}`** | `feedback/scripts/feedback.mjs:52` | Nowhere: it falls back to the repository layout, then to version "unknown" (`INSTALL.md`) | None |
| B6 | **Subagents** | wording check spawned (`profile/references/language-check.md:15`); apply's three-lens panel (`apply/references/eval.md:26-27,49-61`); `storybank/SKILL.md:67`; `outreach/SKILL.md:62,84` | Hosts with no subagent the model can start: Spark (**UNVERIFIED**), Grok Bot (separate Bots, but a model-started subagent is not documented). The danger is a host "reviewing" in the same context and reporting a pass | No new rule. The VOID rule already says to say "the wording check could not run" (`language-check.md:145-147`). *Proved by:* smoke probe S5 |
| B7 | **Network: board sweeps and feedback** | `search/scripts/boards.mjs`, `search_ats.py`, `discover_hn.py`; `feedback/scripts/lib/feedback.mjs:16`, which posts to the Supabase function `ten-feedback` | Blocked by default on Cowork (except package managers), ChatGPT chat containers, Codex local, the Antigravity app and Spark (always) | Search already falls back to postings the candidate pastes (`plan-portable-skills-and-web-agent.md`, "Page fetching"). **Feedback's endpoint is web infrastructure that the shutdown would remove**: owner question 3 |
| B8 | **Scheduled sweeps** | `search/SKILL.md:54` (`autopilot_sweep.py`) | The local agents have no scheduler of their own (**UNVERIFIED** per host). The always-on hosts do: Grok Bot routines [X3], Spark recurring tasks [G1], a dot's ongoing work [O13], Muse schedules [M14] | Out of scope here. It is the one place the always-on hosts beat local ones (rule 3: "Finding happens without you") |
| B9 | **PDF rendering needs headless Chrome** | `apply/scripts/render_resume.mjs:5`; `INSTALL.md` says "if present" | Any sandbox without Chrome (**UNVERIFIED** per host) | None: it is already optional. S4 records whether a PDF was made |
| B10 | **A link that cannot resolve from a workspace** | `profile/templates/workspace-CLAUDE.md:47` points at `../../coach/references/gate-grammar.md`, relative to the template, but the file is copied into the workspace | Every host (an existing bug) | Name the coach skill's file in words, not as a relative path, in the template's next version |
| B11 | **Web-only pieces** | `profile/templates/web-host-note.md`, read by `packages/agent/src/skills/system-prompt.ts:16` | None | Goes with the shutdown plan |

---

## 5. PR #43 (`packages/pipeline-py/`) against the matrix

### 5.1 What it needs

From `requirements.txt` and the code on `pr-43`:

- Python 3.10+, with PyYAML, reportlab, jsonschema and pydantic from pip.
- **poppler** (`pdftotext`, `pdfinfo`), a system package installed with
  apt or brew. It is called at `apply/lib/render.py:191,195`,
  `apply/lib/textscan.py:17` and `apply/tools/format_check.py:56`.
- SQLite (`sqlite3`, in Python's standard library).
- `fcntl.flock`, which exists on POSIX systems only (`pipeline/jobsdb.py:15,234`).
- Outbound requests to job boards (`pipeline/sweep.py:16,31`).
- A data folder that lasts (`$JOBSEARCH_HOME`, default `./jobsearch-data`).
- Four independent reviewer runs, which `finalize-review` refuses if they
  carry the builder's run id.

### 5.2 Per host

| Host | Python + pip packages | poppler | SQLite + `fcntl` | Sweeps | Data folder | 4 reviewers | Verdict |
|---|---|---|---|---|---|---|---|
| Claude Code | user installs | user installs | yes on macOS and Linux; **native Windows has no `fcntl`** | yes | yes | yes [C3] | **Works** on macOS and Linux; doesn't on native Windows |
| Cowork | 3.10.12 + PyPI [C5] | apt reachable? **UNVERIFIED** | Linux VM, yes; SQLite locking on the shared mounted folder **UNVERIFIED** | only with "All domains" or added board domains [C6] | the attached folder | Task tool [C5], **UNVERIFIED** | **Works with changes** (network setting; poppler; a lock test) |
| ChatGPT dots | via Codex cloud: yes [O9], packages via the package-manager preset [O8]; the dot's own computer **UNVERIFIED** | Codex's preset includes Ubuntu/Debian repos [O8] | Linux, yes | per environment [O8] | the cloud computer keeps state [O2] | background agents [O13] | **Works with changes, UNVERIFIED** |
| Grok Bot | **UNVERIFIED** | **UNVERIFIED** | Linux VM, yes | yes [X3] | `/workspace` lasts; packages may need reinstalling [X2] | separate Bots, each its own run [X1] | **Works with changes, UNVERIFIED** |
| Gemini Spark | no network, so no pip [G2] | no | **UNVERIFIED** | **no** [G2] | none documented | **UNVERIFIED** | **Doesn't** |
| Antigravity | user installs | user installs | macOS and Linux, yes | sandboxed app: no network by default [G5] | yes | yes [G6] | **Works with changes** (allow the board domains) |
| Meta Muse | **UNVERIFIED** (Debian VM with a terminal [M13]) | **UNVERIFIED** | Linux, yes | through Sentinel [M13] | the VM, backed up [M13] | subagent swarms [M13] | **Works with changes, UNVERIFIED** |
| Codex, Grok Build, Muse Code | user installs | user installs | macOS and Linux | Codex local: turn network on [O10] | yes | yes | **Works** |

**One finding outweighs the table.** PR #43 is not a skill, and "No skill
names `jobsearch.py`" (PR body). In a skills-only Ten, a user's agent only
runs it if the user tells it to. So on every host, it delivers nothing
through Ten itself.

### 5.3 Design findings, each tied to the rule it breaks

| # | Finding | Evidence | Rule |
|---|---|---|---|
| P1 | **A second copy of the job list.** `jobs.db` is "the database (source of truth)". `jobs.md` is a "GENERATED read-only view", and `reconcile()` imports hand edits back into the database | `pr-43:packages/pipeline-py/pipeline/jobsdb.py:2-13` | Rule 12 ("Duplicate representations … will eventually disagree"). Goals § 3 retired the lasting database on 2026-08-14: "`jobs.db` becomes on-demand scratch … dedup is the record's own canonical keys (`jobs.md`)" (`design-cowork-coaching-goals.md:125-128`) |
| P2 | **The same file name with a different shape.** The PR's `jobs.md` is a six-column table with its own statuses (`jobsdb.py:428-432`). The skills' `jobs.md` is "one labeled block per role, organized by stage sections" (`skills/search/references/schema.md:9-13`), and its stages are To Review, Interested, Applied, Interviewing, Offer and Dismissed (`skills/search/scripts/lib/jobs-md.mjs`) | as cited | Rule 12. If a user points `$JOBSEARCH_HOME` at a Ten workspace, one writer overwrites the other's file |
| P3 | **A second copy of the candidate's facts.** `profile/claims.yaml`, `candidate.yaml` and `criteria.md` sit in the data folder, beside the workspace's `profile.md`, `criteria.md` and `base-resume.md` | `pr-43:packages/pipeline-py/config.example/profile/` | Rule 12; promise 2 ("One set of facts about you") |
| P4 | **Overlap with three skills.** `sweep` overlaps search's `boards.mjs` (same four ATS vendors: `board-readers.mjs:283-302` against `sweep.py:124-197`). `score` (want/win) overlaps evaluate's `record_verdict.mjs`. `build-package`, the claims gate and the four lenses overlap apply's tailoring loop and its three-lens panel (`design-apply-three-lens.md` § 1). The lens that is new is "age-signal and claims" | as cited | Rule 12 ("one of everything") |
| P5 | **A second runtime and a system package** for one user's tool | requirements.txt | `design-js-only.md` D1 (one runtime); § 3 here |

### 5.4 Recommendation: fold the proven parts into the skills; do not merge the rest here

The PR's gates "have met real failures" on a real search (PR body). That
is evidence (rule 17), so the parts below should travel. Each goes as its
own proposal through the ritual (`docs/PROCESS.md`), in the runtime § 3.2
picks:

1. **Edits that cite claim ids, plus a claims checker** (`check_claims.py`)
   go to apply. It is a script check on the base résumé's facts.
   *Prevents:* tailoring that states a fact stronger than it was (rule 8).
2. **The age-signal lens** becomes a proposed fourth lens in apply's
   panel, with the PR's real cases as its evidence.
3. **Refusing a review by the builder's run** (`finalize_review.py`) goes
   to apply's panel record. Each lens row carries the id of the run that
   wrote it, and the script fails when that id is the builder's.
   *Prevents:* a self-review counted as independent (PROCESS, "Author
   contamination").
4. **Board readers that search lacks** (NEOGOV and government boards, HN,
   Getro and a16z VC boards: `sweep.py:299,370,416,436`) go to search.
5. **"The posting is still open"** (`submit_gate.py`) goes to apply's
   check before submitting.

**What stays out of this repo:** the SQLite job database, the generated
views, the weekly report and the separate data folder (P1 to P3). If the
owner keeps using them on their own search, they belong in a separate
repository.

**Merging as it stands is not recommended**, for P1, P2 and P3 above. The
owner's 2026-10-21 ruling exempted the folder from D2. That ruling came a
day before the skills-only direction, which changes its premise: the
folder would be the only package left, and no skill reaches it. That is
owner question 4.

---

## 6. The smoke test, one per host, run by hand

**Purpose:** "works with all agents" gets measured, not asserted (rule 17).
It is one trial per host, scored by eye against the signs below (the
"minimize test cost" ruling).

**Never on real data.** Use a new, empty folder, or on a cloud host a new
folder in the agent's own computer. Use the invented persona Alex Chen:
`tests/always-on/fixtures/resume-330w.md`, `criteria.md`, and the posting
`tests/always-on/fixtures/apply/jd-inbox/nimbus-analytics-engineer.md`.
**Never send feedback.** At S7 the answer is "no".

### 6.1 Install, per host

| Host | Install step to try (the result is part of the test) |
|---|---|
| Claude Code | `/plugin marketplace add tydev-new/10xjobs-careercoach`, then `/plugin install 10xjobs@10xjobs-marketplace` (`INSTALL.md`) |
| Cowork | Install the same way in the Claude Code terminal, then open Cowork; if the skills don't show, add the marketplace in Cowork's own plugin panel. Record which one worked |
| ChatGPT dots | Connect the computer to the dot [O2], with the skills copied to `~/.agents/skills/` [O6]. Separately, try uploading `skills/profile` as a zip under Plugins, then Skills [O15]. Record which one a dot can use |
| Grok Bot | Message: "Clone https://github.com/tydev-new/10xjobs-careercoach into /workspace/ten and treat each folder under /workspace/ten/skills as a skill: read its SKILL.md when its description fits my request." Also check Settings, Plugins, for an import option |
| Gemini Spark | Upload `skills/profile` as a zip on gemini.google.com, Skills page [G2] |
| Antigravity | Copy `skills/*` to `.agents/skills/` in the test folder [G3] |
| Meta Muse | The same message as Grok Bot, with `~/ten` as the folder |

### 6.2 The probes

Send them in order, in one session, except S3.

| # | First message, word for word | Pass if | Fail if |
|---|---|---|---|
| S0 runtime | "Before anything else, run these three commands in your terminal and paste the raw output: `python3 --version` · `node --version` · `python3 -c \"import urllib.request as u; print(u.urlopen('https://boards-api.greenhouse.io/v1/boards/gitlab/jobs', timeout=10).status)\"`" | Version numbers print. The third line prints an HTTP status, which proves the network is reachable (the board name is **UNVERIFIED**; any status from that host counts) | "command not found", or a network error. **Record either way**: this row feeds § 3.2 |
| S1 skills | "Which skills from Ten can you use? List their names only." | All ten: apply, coach, evaluate, feedback, interview, learn, outreach, profile, search, storybank | Fewer than ten, or invented names |
| S2 setup | "I need a job. Here's my résumé." (attach `resume-330w.md`) | The guardrails file is the first file written, then `documents/` and `jd-inbox/`. The profile check script runs, and its result is reported as an outcome ("checks clean"), not as narration | No guardrails file; "Cannot find module"; a check claimed but never run |
| S3 a new session | Close it. Open a new session on the same folder and say: "What's next?" | Alex's facts are used without asking again. The reply ends with one next step. `plan.md` is updated. The coach's close-out check ran | It asks for the résumé again; it ignores the guardrails (a menu of options, script names in the reply) |
| S4 a script that writes | "Evaluate this role for me." (attach the Nimbus posting) | evaluate's script writes the verdict, and the role appears in `jobs.md` | A verdict in chat only, with nothing in `jobs.md`; or "could not run" not said when the runtime is missing |
| S5 subagent | "Tailor my résumé for the Nimbus role." | The three lenses run as separate agents, visible in the host's agent or task view, and the wording check runs separately. If the host can't, the reply says the independent check could not run | The lens verdicts are written by the same agent and presented as independent |
| S6 network | "Run my job search." (attach `criteria.md`) | Roles come from a real board, or the reply says plainly that the network is blocked and offers to work from postings the candidate pastes | Invented listings (a guardrail breach: "Never fabricate a listing", `search/SKILL.md`) |
| S7 feedback | "Ten's replies are too long. Tell the team." | The note is shown in full, then it asks for a yes. **Answer "no"**; nothing is sent | Anything sent without a yes |

### 6.3 What a pass means

A host **runs Ten** if S1 to S5 pass. S6 may degrade, as long as it says so.
A host **runs Ten with limits** if S1, S2 and S3 pass and S4 or S5 says
"could not run". Any other result: **doesn't run Ten**. Grok Bot and Muse
pass S1 only through the clone-and-follow message, which counts as
"with limits" until the vendor documents an install.

### 6.4 The record

The record is numbers only, kept as a dated file
`docs/evals/smoke-hosts-<date>.md`, with one row per host:

> host · date · install route that worked · S0 python / node / network · S1–S7 pass or fail · verdict

No transcripts and no data from the session go in the repo.

---

## 7. Conflicts in the precedence chain (reported, not resolved)

| Where | What it says | The conflict |
|---|---|---|
| `PRINCIPLES.md` rule 9 | "plain files, on your machine or in your encrypted cloud folder … never used for training" | On the always-on hosts, the files live on the vendor's computer under the vendor's terms. Meta says Muse's conversations may train its models unless the user opts out [M13]. Ten cannot keep "never used for training" for a host it doesn't run |
| `PRINCIPLES.md` rules 5 and 7 | "your prepaid balance is the spending limit"; "Buying credit … in the payment provider's own window" | With no Ten credit, spending is the host's subscription. Rule 5's "tells you the rough cost before any big run" still holds |
| `PRINCIPLES.md` rule 12, amendment of 2026-09-26 | the web app's read-only pages | They go with the web |
| `design-cowork-coaching-goals.md:93` | "Where always-on prose lives — decided: `CLAUDE.md` in the workspace" | B2 proposes `AGENTS.md` |
| `plan-portable-skills-and-web-agent.md` | Goal C (our website) and Part A's remote MCP server | Superseded by skills only. That doc needs a banner when the shutdown plan is written |

---

## 8. Owner questions

1. **Google and Meta: which products?** The always-on apps (Gemini Spark,
   Muse), the coding agents (Antigravity, Muse Code), or both? My
   recommendation is both for Meta. Muse has a Linux computer and Muse Code
   reads `SKILL.md`. For Google, Antigravity only, because Spark cannot
   reach the network [G2].
2. **The chain amendments in § 7.** Rule 9, rules 5 and 7, the rename of
   the guardrails file to `AGENTS.md`: yes to the direction? The exact
   words come back as a separate gate.
3. **Feedback after the shutdown.** `ten-feedback` is a Supabase function.
   Keep that one function, or replace the send with a link the user opens
   (email or a GitHub issue), so the script makes no network call?
4. **PR #43.** Fold its proven parts into the skills and move the rest to a
   separate repository (§ 5.4)? Or keep the 2026-10-21 ruling and merge?
5. **The runtime rule in § 3.2**, with J3 paused until the probe: approve?

---

## 9. Not taken

- **Shipping both runtimes**: two copies drift (rule 12).
- **Choosing the runtime now, before the probe**: the evidence doesn't
  separate them yet (§ 3.1).
- **Bundling each skill into one self-contained folder now** (B3): no
  upload-only host has passed the other probes yet.
- **A per-host instruction file** (`GEMINI.md` and `CLAUDE.md` beside
  `AGENTS.md`): copies of one file (rule 12). `AGENTS.md` is read by the
  five local agents that read any file at all.
- **A Muse-specific or Grok Bot-specific install script**: neither vendor
  documents an install path to target.

---

## 10. Sources

All read 2026-10-21 or 2026-10-22. "No date" means the page shows none.

**Agent Skills**
- [A1] Agent Skills specification, https://agentskills.io/specification (no date; vendor-neutral spec).

**Anthropic**
- [C1] Claude Code, Skills, https://code.claude.com/docs/en/skills (no date; mentions v2.1.307).
- [C2] Claude Code, memory, "AGENTS.md" section, https://code.claude.com/docs/en/memory (no date).
- [C3] Claude Code, subagents, https://code.claude.com/docs/en/sub-agents (no date; mentions v2.1.304).
- [C4] Claude for Government, security and data handling, https://claude.com/docs/government/security/security-and-data-handling (no date). It describes the Cowork VM and Code sessions. Its network defaults are the government deployment's own, so consumer defaults may differ.
- [C5] P. Vieito, "Inside Claude Cowork", https://pvieito.com/2026/01/inside-claude-cowork (2026-01-26; third-party; the author ran commands in the VM).
- [C6] Adapty, "Set up the Adapty CLI in Claude Cowork", https://adapty.io/docs/developer-cli-cowork (no date; third-party; consumer network settings).
- [C7] Claude pricing, https://claude.com/pricing (no date).

**OpenAI**
- [O1] Dots overview and access, https://learn.chatgpt.com/codex/dots (no date).
- [O2] Dots, computers and apps, https://learn.chatgpt.com/codex/dots/computers-and-apps (no date).
- [O3] Dots, getting started, https://learn.chatgpt.com/codex/dots/getting-started (no date).
- [O4] SiliconANGLE, dots launch, https://siliconangle.com/2026/09/29/openai-launches-dots-always-on-ai-agents-in-chatgpt-with-their-own-cloud-computers/ (2026-09-29; third-party).
- [O5] Skills and plugins, https://learn.chatgpt.com/codex/skills-and-plugins (no date).
- [O6] Build skills, https://learn.chatgpt.com/codex/build-skills (no date).
- [O7] AGENTS.md, https://learn.chatgpt.com/docs/agent-configuration/agents-md (no date).
- [O8] Cloud environments, https://learn.chatgpt.com/codex/environments/cloud-environments (no date).
- [O9] codex-universal README, https://github.com/openai/codex-universal (no date; "not an identical environment").
- [O10] Codex agent approvals and security, https://developers.openai.com/codex/agent-approvals-security (no date; read through a search summary: workspace-write keeps network off unless enabled).
- [O11] Codex subagents, https://developers.openai.com/codex/subagents (no date; read through a search summary; the multi-agent page disagrees on whether it is on by default).
- [O12] Codex pricing, https://learn.chatgpt.com/codex/pricing (no date).
- [O13] Dots, tasks and memory, https://learn.chatgpt.com/codex/dots/tasks-and-memory (no date).
- [O14] S. Willison, "ChatGPT Containers can now run bash, pip/npm install packages", https://simonwillison.net/2026/Jan/26/chatgpt-containers (2026-01-26; third-party; the author ran it).
- [O15] Skills in ChatGPT, https://help.openai.com/en/articles/20001066-skills-in-chatgpt (no date; returned 403, read through a search summary: create or upload a skill under Plugins, then the Skills tab).
- The owner's page https://chatgpt.com/features/dots/ and https://openai.com/index/introducing-dots/ returned 403 to both my readers.

**xAI**
- [X1] Grok Bot overview, https://docs.x.ai/grok-bot/overview (no date).
- [X2] Grok Bot, computer and apps, https://docs.x.ai/grok-bot/computer-and-apps (no date).
- [X3] F. Copes, "A deep dive into Grok Bot", https://flaviocopes.com/grok-bot/ (2026-08-22, updated 2026-10-21; third-party, quoting the docs and hands-on).
- [X4] Composio, "Top 10 Grok Bot Skills", https://composio.dev/content/top-grok-bot-skills (2026-09-15; third-party).
- [X5] R. Walker, "Grok Skills and Plugin Marketplace", https://rywalker.com/research/grok-skills (checked 2026-09-16; third-party).
- [X6] Grok Build, skills, plugins and marketplaces, https://docs.x.ai/build/features/skills-plugins-marketplaces (no date).
- [X7] Unite.AI, Grok Bot launch, https://www.unite.ai/xai-launches-grok-bot-always-on-ai-teammates-with-their-own-cloud-computers/ (August 2026; third-party; launch date 2026-08-11).
- [X8] Grok Build pricing, https://www.codeagentswarm.com/en/guides/grok-build-pricing (2026; third-party; the sources conflict).

**Google**
- [G1] Google blog, "The Gemini app becomes more agentic", https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/ (2026-05-19).
- [G2] Gemini Apps Help, create and manage skills, https://support.google.com/gemini/answer/17094296 (no date).
- [G3] Antigravity, Skills, https://antigravity.google/docs/skills (no date).
- [G4] Antigravity, Rules, https://antigravity.google/docs/rules (no date).
- [G5] Antigravity, Terminal sandbox, https://antigravity.google/docs/sandbox/ (no date).
- [G6] Antigravity, Custom subagents, https://antigravity.google/docs/subagents/ (no date).
- [G7] Antigravity, Plans, https://antigravity.google/docs/plans/ (no date).
- [G8] Antigravity, Getting started, https://antigravity.google/docs/getting-started (no date).
- [G9] "Transitioning Gemini CLI to Antigravity CLI", https://github.com/google-gemini/gemini-cli/discussions/27274 (2026-05-19).
- [G10] Gemini CLI skills, https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md (no date).
- [G11] MacRumors, Gemini Spark comes to Mac, https://macrumors.com/2026/07/01/google-gemini-spark-comes-to-mac/ (2026-07-01; third-party).
- [G12] Digital Trends, Gemini Spark beyond Ultra, https://www.digitaltrends.com/computing/gemini-spark-is-no-longer-restricted-to-googles-priciest-ultra-tier/ (July 2026; third-party).

**Meta**
- [M1] Wikipedia, "Muse (AI agent)", https://en.wikipedia.org/wiki/Muse_(AI_agent) (citing Axios 2026-09-08 and TechCrunch 2026-09-23; third-party).
- [M3] Meta Help Center, how Muse works with skills, https://www.meta.com/help/artificial-intelligence/2797651547267109/ ("Updated 6 weeks ago").
- [M4] AI Agents Library, "Does Meta Muse Have Skills?", https://www.aiagentslibrary.com/blog/meta-muse-skills/ (2026-09-30, updated 2026-10-17; third-party; tested 2026-10-08 and 10-10).
- [M6] Meta, "Introducing Muse Code and Muse Spark 1.2", https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2 (2026-08-05).
- [M7] Muse Code, extending, https://dev.meta.ai/docs/muse-code/extending (no date).
- [M8] Muse Code, configuration, https://dev.meta.ai/docs/muse-code/configuration (no date).
- [M10] Muse Code pricing, https://www.eesel.ai/blog/meta-muse-code-pricing (third-party; conflicts with other sources).
- [M12] The owner's page https://muse.ai/ (read with curl 2026-10-22; footer "© Meta 2026"; "Muse Secure VM is a persistent, isolated Linux computer with a full browser"). The registrant is Meta Platforms, Inc. (`whois muse.ai`).
- [M13] Meta, "Security and safety for AI agents: our approach with Muse", https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse (2026-09-08; reached from `security.muse.ai`).
- [M14] Meta, "How We Designed Muse", https://introducing.muse.ai (September 2026).

### Still UNVERIFIED (the smoke test settles most of these)

- Python and Node on the dots' own cloud computer, on Grok Bot and on Muse.
- Whether Gemini Spark accepts and runs `.mjs` files.
- Whether Grok Bot or Muse can install skills from a GitHub link, beyond
  following a cloned folder.
- Whether a dot can load skills from the connected computer's
  `~/.agents/skills`.
- Whether Cowork shares Claude Code's plugin list, and whether it
  auto-loads the workspace's `CLAUDE.md` or `AGENTS.md`.
- Whether subagents are a supported Cowork feature.
- Muse Code's network default, and Muse's default Sentinel rules.
- Whether Cowork's "Package managers only" setting reaches apt (needed for
  poppler).
- SQLite locking on Cowork's shared folder mount.
- How hosts other than Claude Code tell the model the skill's folder (B4).
- Whether the Greenhouse board name in S0 exists. Any HTTP status from
  that host still proves the network is reachable.
