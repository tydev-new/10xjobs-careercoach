# Design - Web agent contracts (MVP)

**Status:** Draft r3 for owner approval (plan step 1, contracts half)
**Date:** 2026-09-22 · **Owner:** Yong · **Author:** architect
**Builds on:** `docs/plan-portable-skills-and-web-agent.md` (Phase 0 settled),
`apps/workspace-ui/server/workspace-core.mjs`, `skills/coach/references/gate-grammar.md`,
`docs/loading-map.md`. Card prop types live in `docs/design-web-ui.md`; this doc
owns the wrapper and where each prop comes from (§ 6.2).

`UNVERIFIED` = not confirmed from vendor docs or the installed package.
`PENDING OWNER` = proposed, not yet confirmed by O. Reasons: Decision log.

**Default model:** `anthropic/claude-sonnet-5` on OpenRouter (on its live
model list, 2026-09-22), for the web app and the B1 runner.

---

## 1. `packages/agent` - the public interface

```ts
export function createCoach(deps: Deps): Coach;

export interface Deps {
  model: LanguageModel;          // AI SDK model, built by the entry point
  workspace: WorkspaceStore;     // § 2
  skills: SkillBundle;           // read-only map "skills/<path>" -> text, built at build time
  gate: Gate;                    // § 3
  balance(): Promise<number>;    // USD left to spend, § 8
  fetch: typeof fetch;           // ATS fetch and the price list only
  clock: { now(): Date };        // every timestamp and mtime check reads this
  logger?: { info(e: object): void; warn(e: object): void; error(e: object): void };
  limits?: { maxSteps?: number /* 25 */; spendGateUsd?: number /* PENDING OWNER */; windowWords?: number /* 4000 */ };
}

export interface Coach {
  stream(input: { chatId: string; messages: UIMessage[]; abortSignal?: AbortSignal }):
    ReadableStream<UIMessageChunk>;   // one user turn, § 6
}
export type SkillBundle = Readonly<Record<string, string>>; // "skills/apply/SKILL.md" -> text

// Pure helpers the UI and the mock import from this package:
export function matchGateReply(text: string, origin: "typed" | "ui"): "approve" | "decline" | "none"; // § 3
export function statusOf(messages: UIMessage[], chat: ChatStatus): Status;                          // § 6.1
export function parsePlanTodo(md: string): { text: string; ref?: string }[];                        // § 6.2
```

- The entry point builds `model` (the OpenRouter provider, the user's key, the
  spike-4 provider filter). The package never sees the key, and imports no
  `window`, `document`, `localStorage`, `node:*`, or Supabase client.
- One loop: `streamText` with the tools and `stopWhen: stepCountIs(maxSteps)`.
  A headless run reads the same stream to the end.

**Prevents:** a browser-only or server-only coach that the server loop or the
MCP server would have to fork (rule 12).
**Proved by:** step 4's package tests run in Node with no DOM; a lint rule
fails on any `window`/`document`/`localStorage`/`node:` import in the package.

---

## 2. Workspace store

This is the versioned-write contract of `workspace-core.mjs`: a read returns a
`version`, and a write with a stale `expectedVersion` fails with
`version_conflict`. It adds "create a text file". The UI gets the **same
instance** for the side panel, downloads, and uploads, and never calls agent
tools.

```ts
export interface WorkspaceStore {
  list(dir?: string): Promise<FileInfo[]>;   // recursive, depth <= 3
  read(path: string): Promise<FileRead>;
  write(path: string, content: string, expectedVersion: string | null): Promise<FileInfo>; // null = create
  upload(path: string, bytes: Uint8Array): Promise<FileInfo>;  // .pdf/.docx, create-only
}
export interface FileInfo { path: string; version: string /* opaque */; size: number; updatedAt: string; editable: boolean }
export type FileRead = (FileInfo & { binary: false; content: string }) | (FileInfo & { binary: true; bytes: Uint8Array });
// WorkspaceError.code: invalid_ref | outside_workspace | resource_missing | version_conflict |
//   already_exists | not_editable | content_too_large | upload_too_large | unsupported_type
```

**Path rules** (from `resolveRef`, one list for every backend):

- Paths are relative. No `..`, no segment starting with `.`, no NUL.
- `.md .txt .json .html` are editable and versioned, capped at 2 MB. `.html`
  is the rendered résumé, rewritten on every revision. The UI shows it only in
  a sandboxed iframe. Step 2 adds `.html` to the local store's
  `TEXT_EXTENSIONS`.
- `.pdf .docx` are upload-only and create-only, capped at 10 MB.
- `skills/` and `CLAUDE.md` at the root are **not writable** by the agent
  (§ 7). Writes there fail with `not_editable`.

**Uploads:** the UI calls `upload("documents/<name>")` **before** sending the
message. If the name is taken, it tries `-2`, `-3`, and so on. The message
carries a `file` part with `url: "workspace:documents/<name>"`. The package
turns that part into one text line ("The candidate attached
`documents/<name>`."). The bytes are never sent to the model.

**On Supabase Storage (step 2):**

- A private bucket. Each object is stored at `users/{uid}/ws/{path}`.
- Per-user access rules. Spike 3 proves that user A cannot list, read, or
  write user B's objects.
- `version` is whatever the conditional write checks, such as the ETag.
  **UNVERIFIED:** whether uploads honour `If-Match`. If they don't, step 2
  brings a compare-and-swap design to the architect before building it. A
  read-then-upload does not meet this contract.
- `updatedAt` comes from the object's `updated_at`. **UNVERIFIED** that
  overwriting updates it; spike 3 records this.
- No database copy of any file, listing, or version (rule 12).

**Export, import, delete (rule 9):**

- Export is a zip in the exact folder shape: entry name = `path`, bytes as
  stored, no prefix, no metadata.
- Import takes a zip into an **empty** workspace only. Every entry is checked
  against the path rules, and one bad entry refuses the whole import. This
  blocks zip-slip and hidden files.
- Delete is `delete_account` (§ 8).
- The fixture for step 2 is `tests/always-on/fixtures/apply/` plus
  `tests/always-on/fixtures/{profile,criteria}.md`, an invented persona.

**Prevents:** two writers silently overwriting each other; one user reading
another's files; a cloud folder that can't be exported or deleted (rule 9).
**Proved by:** the step 2 exits on the named fixture; one store test suite run
against the in-memory, local-folder, and Supabase stores; a delete test that
leaves no object and no row.

---

## 3. Gate protocol

Rule 7: show the complete thing, then one plain sentence of what happens, then
the candidate's typed yes, then a log entry. The wording comes from
`gate-grammar.md`.

**One kind on the web: `spend`** (PENDING OWNER). No tool sends or submits.
The candidate's sends and submits go in `plan.md § To do` with the prepared
file (the host note, § 7).

**There is one way to open a gate: `estimate_cost`.** When its result has
`needsGate: true`, code opens the spend gate and ends the turn:

- `label` is the tool's `action` input (6 words or fewer, checked).
- `text` is `action` plus the code-built cost line.
- `amountUsd` is `highUsd`.
- `gateLine` is the spend line from the bundled `gate-grammar.md`, word for
  word, with `$<amount>` filled from `amountUsd` to two decimals. If the
  bundle has no spend line, the tool fails loudly. Today the line reads
  "This costs up to $<amount> — nothing starts until you say yes."
  (`gate-grammar.md`, "The four steps (PRINCIPLES rule 7)").

The loop's own mid-run stop (§ 4) opens a gate the same way, with the action
"Continue this run".

```ts
export interface GateRequest {   // data of the data-gate part; carries no status
  gateId: string; kind: "spend"; label: string; text: string;
  textHash: string;              // sha256 of text as shown
  gateLine: string; amountUsd: number;
}
export interface Gate {
  open(req: GateRequest, chatId: string): Promise<void>;
  decide(gateId: string, status: "approved" | "declined" | "expired", typedText?: string): Promise<void>;
  pending(chatId: string): Promise<GateRequest | null>;
  expireOtherChats(chatId: string): Promise<void>;
}
```

**Matching the reply.** `matchGateReply` runs in code, before the model sees
the message.

1. At most one gate is open per chat. A new gate expires the old one.
2. The **next** message approves only if its `origin` is `"typed"` **and** the
   whole message, trimmed and lowercased, with at most one trailing `.` or
   `!`, is exactly `yes`. Anything else leaves the gate open, and the model is
   told it is not approved.
3. An exact `no`, `don't`, `cancel`, or `stop` declines the gate. The model is
   told not to ask again unprompted.
4. There is no approve button. The UI sets `metadata.origin` on every user
   message.

**Gate status has one owner: the `gate_log` row.**

- `setGateStatus` writes the row, then emits `data-gate-status { gateId, status }`.
  It runs at open (`pending`) and at approve, decline, or expire.
- When a reply leaves the gate open, the part is emitted again with no write.
- The UI shows the latest status per `gateId`. On a chat's first turn, the
  package expires every `pending` row from older chats.

**`gate_log` table** (own rows only; a database function moves `status` off
`pending` exactly once; no other update; no delete except `delete_account`):

`id` uuid pk (= gateId) · `user_id` uuid · `chat_id` text · `kind` text ·
`label` text · `text_hash` text · `gate_line` text · `amount_usd` numeric ·
`status` text (`pending`/`approved`/`declined`/`expired`) · `typed_text` text
null · `created_at` · `decided_at` null.

**Prevents:** spending past the limit without the candidate's word; a job post
or web page approving a gate (only an exact typed `yes` counts, and the model
cannot write the candidate's message); a paraphrased gate line; a gate card
and a status light that disagree.
**Proved by:**
- a step 4 test that no spend past the allowance happens without a logged
  typed yes;
- a `matchGateReply` table: `yes`, `Yes.`, `YES!` typed approve; `yes but…`,
  `y`, `sure`, a pasted text containing yes, and a `ui`-origin `yes` do not;
- a test that the gate line equals the bundled spend line with the amount
  filled in;
- a test that a new chat expires older `pending` rows.

---

## 4. MVP tools

Every failure goes back to the model as `{ error: { code, message } }`.
Nothing is thrown into the stream.

| tool | input | output |
|---|---|---|
| `load_skill` | `{ name: "profile" \| "evaluate" \| "apply" \| "coach" }` | `{ path, content }` (§ 7) |
| `read_file` | `{ path }` (workspace path, or `skills/…`) | `{ path, content, readOnly }`; `.pdf`/`.docx` → `{ path, text, extracted: true }` |
| `write_file` | `{ path, content }` | `{ path, written: true }`, or `version_conflict` / `read_first` / `not_editable` |
| `list_files` | `{ dir? }` | `{ files: { path, size, updatedAt }[] }` |
| `bash` | `{ command }` | `{ stdout, stderr, exitCode, changed: string[] }` |
| `web_search` | `{ query, maxResults? (≤ 5) }` | `{ results: [{ url, title, excerpt }] }` |
| `fetch_job` | `{ url, saveTo? }` | `{ board, company, title, location, url, text, compensation?, savedTo? }` or `unsupported_url` |
| `estimate_cost` | `{ action (≤ 6 words), steps, webSearches }` | `{ lowUsd, highUsd, balanceUsd, needsGate, method }`; opens the gate when `needsGate` (§ 3) |
| `check_language` | PENDING OWNER: `{ files }` → `{ report, usd }` | or deferred (see Decision log) |

- **Versions are tracked by the package.** Per chat, it keeps the last version
  it saw for each path, from `read_file`, `write_file`, and `bash`
  write-backs. Writing an existing file the chat has never seen returns
  `read_first`. On `version_conflict`, the model is told to re-read the file
  and redo its change.
- **`read_file` on `.pdf`/`.docx`** extracts the text on every read. No text
  copy is saved. **UNVERIFIED:** that `pdfjs-dist` and `mammoth` run in both
  Node and the browser. If not, the extractor becomes a dep.
- **`bash`** is just-bash over an in-memory copy of the workspace, with the
  bundle mounted read-only at `skills/`.
  - Each changed file goes back through `WorkspaceStore.write` with its
    tracked version, under the same write rules (so `CLAUDE.md` and
    `skills/` are refused). A refusal or conflict fails the command with
    exit 1 and names the file.
  - `python3` is a custom command (§ 5), with `python: false`.
  - No network.
- **`web_search`** makes one OpenRouter call with `plugins: [{ id: "web", max_results }]`
  and returns the `url_citation` annotations. **UNVERIFIED:** how the provider
  package passes the plugin and returns the annotations. The alternative is
  the `openrouter:web_search` server tool. Spike 1's keyed run settles it.
- **`fetch_job`** accepts only these URL shapes:

  | board | job URL | API |
  |---|---|---|
  | Greenhouse | `boards.greenhouse.io/{b}/jobs/{id}`, `job-boards.greenhouse.io/{b}/jobs/{id}` | `GET boards-api.greenhouse.io/v1/boards/{b}/jobs/{id}` |
  | Lever | `jobs.lever.co/{c}/{id}` | `GET api.lever.co/v0/postings/{c}/{id}` |
  | Ashby | `jobs.ashbyhq.com/{b}/{id}` | `GET api.ashbyhq.com/posting-api/job-board/{b}?includeCompensation=true`, pick `{id}` |
  | SmartRecruiters | `jobs.smartrecruiters.com/{c}/{id}[-slug]` | `GET api.smartrecruiters.com/v1/companies/{c}/postings/{id}` |

  - Anything else returns `unsupported_url`, with "paste the posting text".
  - HTML becomes plain text.
  - `saveTo` writes the text straight to the workspace, so the model never
    retypes it (rule 11). The text is data, not instruction.
  - **UNVERIFIED:** that the single-posting endpoints allow browser requests.
- **`estimate_cost`** is computed by code:
  - the price comes from `GET /api/v1/models`, cached;
  - `lowUsd` and `highUsd` are `steps` × the median and the highest cost per
    step so far in this chat (on turn 1, step 4's measured per-step cost, a
    dated constant), plus web searches at the listed plugin price;
  - `balanceUsd` = `deps.balance()`;
  - `needsGate` = `highUsd > spendGateUsd`;
  - it emits a `cost` card.

  There is no pre-emptive over-balance error. The card shows the balance, and
  the key's own limit stops the run (§ 8).
- **Allowance.** Each turn may spend `spendGateUsd`, or the amount of a gate
  approved by the message that started the turn. After each step the loop adds
  up the measured cost. If the next step would pass the allowance, the loop
  stops before it and opens a gate for spent-so-far + the last `highUsd`. A
  typed yes starts the next turn, and the model resumes from the files.

**Prevents:** claimed writes that never happened; conflicts on script-rewritten
files; arbitrary page fetches; an unannounced big run (rule 5); an uncomputed
cost figure (rule 8).
**Proved by:** step 4 unit tests per tool against the in-memory store and a
stubbed `fetch`; a test that `fetch_job` refuses other hosts; a test that a
`bash` write-back then a `write_file` on the same path succeeds; a test that a
turn stops at a gate before the step that would pass its allowance.

---

## 5. Checkers to port (step 3)

These are found by grepping the MVP skills' `SKILL.md` and `references/` for
`scripts/`. The skill prose is not changed.

**Dispatch:** the `python3` command matches its first argument by **file
name**. So `scripts/…`, `../apply/scripts/…` and `skills/apply/scripts/…` all
reach the same port. The rest of the arguments go through the same flag
parser. An unknown script, `-c`, or no argument exits 127 with
`not available in the web app: <name>`. Output and exit codes match the Python
byte for byte.

| script | called by | CLI | reads → writes | exit |
|---|---|---|---|---|
| `apply/scripts/check_materials.py` | apply; profile | `--workspace DIR [--resume F] [--letter F] [--base F]` | résumé, letter, `base-resume.md`, `voice.md` → nothing | 0 clean/WARN · 1 FAIL · 2 flags |
| `apply/scripts/proposal_block.py` | apply | `--workspace DIR --application F [--base F]` | `applications/<key>.md`, base → nothing | 0 · 1 FAIL · 2 flags |
| `apply/scripts/render_resume.py` | apply | `--md F [--html F] [--pdf F] [--pages N] [--strict]` | `.md` → `.html` | 0 · 1 over target with `--strict` · 2 flags |
| `evaluate/scripts/record_verdict.py` | evaluate | `--workspace DIR --company S --title S --verdict {strong,investable_stretch,long_shot,weak} [--score] [--reasons] [--dealbreakers] [--url] [--location] [--jd-file] [--company-file] [--track]` | `jobs.md` → `jobs.md` | 0 · 2 flags/score |
| `search/scripts/update_job.py` | evaluate, apply, coach | `--workspace DIR --company S --title S (--stage S \| --dismiss [--reason S] \| --restore)` | `jobs.md` → `jobs.md` | 0 · 2 not one match/flags |
| `search/scripts/jobs_md.py` | library for the two above | - | - | - |
| `profile/scripts/check_files.py` | every MVP skill at close | `--workspace DIR [--skills DIR]` | schema'd files, skills' `schema.md` and links → nothing | 0 · 1 FAIL |
| `coach/scripts/check_closeout.py` | coach at close | `--workspace DIR [--stage S] [--asked Q]… [--minutes N]` | `plan.md` + `updatedAt` → nothing | 0 · 1 FAIL · 2 flags |

- **Time:** the ports read `deps.clock` and `FileInfo.updatedAt`, so tests can
  freeze time.
- **`check_files --skills`** defaults to the bundle, and it reads every
  skill's `schema.md`. That is why the whole `skills/` tree is bundled
  (bundle bytes, not context words).
- **`render_resume`** keeps the HTML builder and prints `words: N  ->  <path>`
  exactly. `--pdf` is ignored with a one-line note, because the candidate
  prints the sandboxed HTML. No page count is claimed until a browser method
  is proven (**UNVERIFIED**).
- **`check_messages.py`** is outreach-only and exits 127 in the MVP.
- **The parity corpus** is `tests/parity/cases/<script>/<case>/`: input files,
  argv, and the expected stdout, first stderr line, exit code, and changed
  files, all generated by running the Python script.
  - Every `def test_` in `test_check_materials`, `test_proposal_block`,
    `test_jobs_md`, `test_check_files`, `test_check_closeout`,
    `test_render_resume` and `test_e2e_lifecycle` (which is the one that runs
    `record_verdict` and `update_job`) gets at least one case.
  - Every CLI gets at least one argparse-error case.
  - A check fails when a test function or a CLI has no case. That fixes the
    denominator for "100%".
- **Known risk:** Python and JS regexes differ on non-ASCII; the corpus
  includes accented text. Step 3 starts with file-name dispatch and
  `check_materials` parity (spike 2 proved the mechanism only).

**Prevents:** skill prose forking between web and local (rule 12); a checker
that behaves differently in the browser (rule 14).
**Proved by:** step 3's parity test, 100% identical over the corpus and wired
into `tests/run.py`, plus the coverage check.

---

## 6. Chat transport

### 6.1 Transport, envelope, status, mock

The UI uses `useChat` with a custom `ChatTransport` (the SDK's own interface,
`ai@7.0.111`). There are two implementations: `agentTransport(coach)` calls
`coach.stream()`, and `mockTransport(fixture)` replays a fixture. Both return
`null` from `reconnectToStream`. Swapping one for the other is one line.

**Assistant parts:**

| kind | part | data |
|---|---|---|
| text | `text` | SDK standard |
| tool activity | `tool-<name>` | SDK standard; states `input-streaming`, `input-available`, `output-available`, `output-error` |
| card | `data-card` | `{ card: "verdict" \| "plan" \| "document" \| "checker" \| "cost", props, ref? }`, from code only (§ 6.2) |
| gate | `data-gate` | `GateRequest` (§ 3) |
| gate status | `data-gate-status` | `{ gateId, status }`; the latest one wins |
| error | `data-error` | `{ code: "over_balance" \| "model_error" \| "tool_error" \| "offline" \| "step_cap", message, retryable }` |

- `data-error.message` is one fixed sentence per `code`. What was finished is
  the model's to say next turn, from the files.
- User messages carry `metadata.origin` and may carry `workspace:` file parts.
  The SDK's tool-approval chunks are not used (a UI boolean, rule 7).

**`statusOf(messages, chat)`** → `{ state, action? }`. The first match wins:

1. `working`: `streaming`, and the latest part is a tool part that isn't done
   yet. `action` is the UI's label for that tool.
2. `thinking`: `submitted`, or `streaming` with any other latest part.
3. `needs-you`: `ready`, and some `gateId`'s latest status is `pending`.
   `action` is that gate's `label`.
4. `done`: `ready` or `error` after at least one turn in this chat.
5. `idle`: no turn yet in this chat.

**Fixture file** (steps 5a and 5b): `{ meta, files, messages }`.

- `meta`: the persona, a description, and placeholders such as
  `spendGateUsd`, labelled as placeholders.
- `files`: the seed workspace (`path → content`). The mock loads it into the
  in-memory `WorkspaceStore` that the UI also reads, so the side panel opens
  real content.
- `messages`: `UIMessage[]`, the whole scripted chat.

**Mock replay:**

- Each `sendMessages` emits the next assistant message that follows the
  latest user message in `messages`.
- Chunks are emitted about 150 ms apart: `start`, `text-*`,
  `tool-input-available`/`tool-output-available`, `data-*`, `finish`.
- At an open gate, the mock calls the real `matchGateReply`. On `approve` it
  continues the script. On anything else it emits a fixed
  `data-gate-status: pending` and one "Not approved — type yes to go ahead"
  line.
- Tool outputs and files in a fixture come from **running the real scripts**,
  and its cards come from the **real card builder**.

### 6.2 Where every card comes from

The model never writes a card. After each tool result, the package applies
this table. A card is a **receipt of a file or a script's output**; the
reasoning stays in the model's prose.

| after | card | props from | `ref` |
|---|---|---|---|
| `estimate_cost` | `cost` | the result: `action`, `lowUsd`, `highUsd`, `balanceUsd` | - |
| `bash` `record_verdict.py`, exit 0 | `verdict` | the `jobs.md` row it wrote, via the `jobs_md` port: company, title, tier, score, track, `fit_reason` and dealbreakers word for word | the row's `jd_file` |
| `bash` `check_materials.py` | `checker`, one per file | stdout: `LABEL name: pass\|FAIL (n fail, m warn)` and each `  [LEVEL] msg`, word for word | the checked file |
| `bash` `render_resume.py`, exit 0 | `document` | `--md` path; `words` from `words: N  ->  path`; `htmlPath` if inside the workspace; badge = the chat's latest `checker` result for that `.md`, else `not-run` | the `.md` |
| `bash` `check_closeout.py`, exit 0 | `plan` | `parsePlanTodo(plan.md)` and the `--stage` value | `plan.md` |

- **Verdict `ref`:** `record_verdict` is called with `--jd-file` whenever a job
  description file exists (the host note, § 7, says so). If the row has no
  `jd_file`, the card has no `ref` and shows "no analysis file linked". It
  never guesses a path.
- **`parsePlanTodo(md) → { text, ref? }[]`** is pure and exported from
  `packages/agent`. The card builder and `apps/workspace-ui` (its `parsePlan`
  maps from it) both use it.
  - It reads the lines under `To do`, up to the next board heading or `##`.
  - It accepts `1. `, `- ` and `* ` bullets.
  - `text` is the line without its bullet, word for word.
  - `ref` is the first backticked workspace path in the line, otherwise
    absent.
  - It never extracts a why, a time estimate, or a priority from the prose
    (rule 8).

**Prevents:** UI rework at the swap; a card that says more than its file
(rules 8, 11); a status light that disagrees with the gate log; a gate that
approves on a click.
**Proved by:**
- step 4 tests that feed real script stdout through the builder;
- a test that model output cannot produce `data-card`, `data-gate`, or
  `data-gate-status`;
- a `parsePlanTodo` table test: `-` and numbered bullets, with and without a
  backticked path;
- a `statusOf` table test;
- the step 5a exits;
- step 5b's exit that the diff is the transport swap only.

---

## 7. Staged loading and the per-turn window

1. **Always on (the system prompt):**
   - **Tier 0 is always the bundled `skills/profile/templates/workspace-CLAUDE.md`,
     never the workspace copy.** At sign-up, code (not the model) writes that
     template to the workspace `CLAUDE.md`, so the export works locally.
     After that, the agent cannot write it (§ 2).
   - **The host note (about 80 words):** this app cannot send, submit, click,
     or open pages. Sends and submits go in `plan.md § To do` with their
     prepared file. Outreach plans and PDF files are not made here; say so
     when you deliver. `CLAUDE.md` is already in place. Pass `--jd-file` to
     `record_verdict` when a job description file exists. Language check:
     per the owner's `check_language` decision.
   - **Tier 1:** the `description:` lines of profile, evaluate, apply, and
     coach.
   - **The tool descriptions:** about 350 words.
2. **On match:** `load_skill(name)` returns the `SKILL.md` with its bundle
   path, so its relative links resolve.
3. **On demand:** `read_file("skills/<skill>/references/<file>.md")`.
4. **Never loaded:** scripts run through `bash`, and only their output enters
   context.

**Target: ~3,300 words of instructions per turn** (PROPOSED by the lead on
2026-09-22 because Tier 0 grew; **pending owner decision**. The plan's step 4
exit says ~3,000 until the owner decides). That is the always-on block plus one `SKILL.md`.

**Window:** the package re-sends at most `windowWords` (4,000) of history,
dropping whole older turns first and always keeping the latest user message.
A `SKILL.md` that falls out of the window is loaded again when it is needed.
Gate state lives in `gate_log`, so it does not depend on the window. A reload
starts a new chat. So a turn costs at most ~3,300 words of instructions plus
4,000 of history, on turn 1 and on turn 20.

**Prevents:** loading more than the local skills do (rule 15); cost per turn
that grows without limit (rule 5); a saved transcript that the export leaves
out (rule 9); **prompt injection that persists** — a job post that talks the
model into rewriting `CLAUDE.md` would otherwise change the always-on
guardrails for every later chat.
**Proved by:**
- a test that the system prompt contains the bundled template byte for byte,
  even when the workspace `CLAUDE.md` differs;
- a test that `write_file("CLAUDE.md")` and a `bash` write to it or under
  `skills/` fail with `not_editable`;
- a word count of system prompt + tool descriptions + one `SKILL.md` against
  `python3 tests/word_report.py` on the same commit (within 10%);
- a 20-turn headless run whose re-sent history never passes `windowWords`.

---

## 8. Key and balance

One Supabase Edge Function, `openrouter-key`, holds the OpenRouter
provisioning key. It is the only server code in the MVP.

**The balance is one number:** `accounts.balance_usd` minus the live key's
usage, which equals the live key's remaining limit.

| action | caller | does |
|---|---|---|
| `mint` | user session | if a key is live: disable it, read its usage, subtract it, delete it. Then create a key with `limit = balance_usd` and return it once |
| `revoke` | user session | disable, read usage, subtract, delete (sign-out) |
| `delete_account` | user session | `revoke`; delete everything under `users/{uid}/`; delete the rows and the auth user |
| `raise` | **service role only** | add to `balance_usd`, and `PATCH` the live key's `limit` up by the same amount |

- OpenRouter endpoints: `POST /api/v1/keys` (`name`, `limit`),
  `PATCH /api/v1/keys/{hash}`, `DELETE /api/v1/keys/{hash}`.
- The `accounts` row: `user_id` · `balance_usd` · `key_hash` · `updated_at`.
  The user can read their own row; only the function writes it.
- **Beta funding (PENDING OWNER):** an admin-set starter credit through
  `raise`. There is no payment page. The first-run greeting is static UI text,
  not a `UIMessage`, and is never sent to the model. It says when the balance
  is $0.
- **The browser holds** the user's key in memory only (fetched at run time,
  never from a build variable) and the Supabase session.
- **One tab:** a Web Locks lock. A second tab shows "Ten is open in another
  tab" and does not mint. A reload mints again, which rotates the key.
- **`deps.balance()`** is `GET /api/v1/key` → `data.limit_remaining` with the
  user's key. This is documented by OpenRouter; spike 4 confirms it live. The
  chip and `estimate_cost` both read it. The UI re-reads it when a turn ends
  and when the window regains focus, with no polling.
- **Over the limit:** OpenRouter answers 402 (documented; spike 4 confirms
  it). The loop emits `data-error over_balance` and ends the turn.

**Prevents:** a server secret in the bundle; a user raising their own
balance; a leaked key overspending; a key outliving sign-out; a second tab
killing a run; an undeletable account.
**Proved by:** spike 4; the step 5b exits; function tests showing that
`raise` with a user token is refused, that `mint` twice leaves one live key
and the right balance, and that `delete_account` leaves nothing behind.

---

## Step-1 spikes

The pass criteria are the plan's (step 1). Status:

- **1: BLOCKED** on a key (streamed call, turn-2 cache read, `web_search`
  annotations). Keyless still to show: the `provider` filter in the
  intercepted request; `streamText` → `toUIMessageStream` in the page.
- **2: pass on the mechanism**; the letter moves to step 3 (§ 5), owner to accept.
- **3: no note.** Also records `If-Match` on a stale ETag and `updated_at` on overwrite.
- **4: no note.** Also records the 402, `limit_remaining`, and the provider filter used.

---

## Decision log

- Only a spend gate on the web: nothing there sends or submits (PENDING
  OWNER; the local plugin keeps send and submit).
- The gate opens from `estimate_cost`: one way to open a gate, and one fewer
  tool in every turn's context.
- Cards are built by code: a card the model wrote would be narration
  presented as a file (rule 11).
- The verdict card is a receipt, not a summary: evaluate's summary card
  stays the prose reply, so no `criteriaLine` is needed.
- The plan card shows each line word for word: splitting prose into
  why/minutes would put unsupported numbers on screen (rule 8).
- Gate status lives in the row only: two stored copies disagree (rule 12).
- No saved chat (files are the memory): no persistence or export question,
  and a bounded cost per turn.
- Tier 0 comes from the bundle: a writable system prompt is a persistent
  injection path.
- Versions tracked by the package; status derived, not sent (no second copy).
- `check_language` (PENDING OWNER): either one fresh-context model call per
  document set (about $0.015–$0.02 a call, to be measured), or defer it and
  record the gap in step 4's t15 results, with the reply saying the check did
  not run.
