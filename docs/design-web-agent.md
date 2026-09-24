# Design - Web agent contracts (MVP)

**Status:** Draft r4 for owner approval (plan step 1, contracts half)
**Date:** 2026-09-22 · **Owner:** Yong · **Author:** architect
**Amended:** 2026-09-24, § 9 (cut-off replies; owner-approved). Where § 9
and an earlier section disagree, § 9 wins.
**Builds on:** `docs/plan-portable-skills-and-web-agent.md` (Phase 0 settled),
`apps/workspace-ui/server/workspace-core.mjs`, `skills/coach/references/gate-grammar.md`,
`docs/loading-map.md`. Card prop types live in `docs/design-web-ui.md`; this doc
owns the wrapper and where each prop comes from (§ 6.2).

`UNVERIFIED` = not confirmed from vendor docs or the installed package.
`PENDING OWNER` = not yet confirmed by O. Reasons: Decision log.

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
  scripts: ScriptRunner;         // the ported checkers behind `python3` (§ 5)
  webSearch?: (q: string, n: number) => Promise<{ results: SearchResult[]; usd: number }>; // § 4
  checkLanguage?: (files: string[]) => Promise<{ report: string; usd: number }>;          // § 4
  limits?: { maxSteps?: number /* 25 */; spendGateUsd?: number /* 1.00, owner 2026-09-22 */; windowWords?: number /* 4000 */ };
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

- The browser entry builds `model`: the OpenRouter provider with `baseURL` =
  `ten-model-proxy` and the Supabase session JWT as auth (§ 8); no model key
  reaches the browser. The package imports no `window`, `document`,
  `localStorage`, `node:*`, or Supabase client.
- One loop: `streamText` with the tools and `stopWhen: stepCountIs(maxSteps)`,
  plus at most one continuation call after a cut-off reply (§ 9); `maxSteps`
  counts the steps of both calls. A headless run reads the same stream to the end.

**Prevents:** a browser-only or server-only coach that the server loop or the
MCP server would have to fork (rule 12).
**Proved by:** step 4's package tests run in Node with no DOM; a lint rule
fails on any `window`/`document`/`localStorage`/`node:` import in the package.

---

## 2. Workspace store

The versioned-write contract of `workspace-core.mjs` (a stale
`expectedVersion` fails with `version_conflict`), plus "create a text file".
The UI gets the **same instance** and never calls agent tools.

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
//   already_exists | path_conflict | not_editable | content_too_large | upload_too_large |
//   unsupported_type | workspace_full | not_a_member
```

**Path rules** (from `resolveRef`, one list for every backend):

- Paths are relative, NFC (the client normalizes; the server refuses other
  forms), ≤ 512 chars. No `..`, no segment starting with `.`, no `//`,
  backslash, control, invisible or format character (Unicode Cf and the
  characters HFS+ ignores). A new path may not sit under a file, be the folder
  of an existing path, or be a case variant of one (`path_conflict`): any of
  these breaks the export on a case-insensitive disk.
- `.md .txt .json .html` are editable and versioned (2 MB). `.html` is the
  rendered résumé, shown only in a sandboxed iframe (§ 6.1); step 2 adds it to
  the local store's `TEXT_EXTENSIONS`.
- `.pdf .docx` are upload-only and create-only, capped at 10 MB.
- `skills/` and any `CLAUDE.md` are **not writable** by the agent (§ 7),
  compared case-insensitively. Writes there fail with `not_editable`. The app
  creates the root `CLAUDE.md` before the first agent turn.

**Uploads:** the UI calls `upload("documents/<name>")` (then `-2`, `-3` on a
clash) **before** sending; the message's `file` part has
`url: "workspace:documents/<name>"`, which the package turns into one text
line. The bytes never go to the model.

**On Supabase (step 2; spike 3 showed Storage ignores `If-Match`):** each
file lives in exactly one place, chosen by its extension (rule 12).

- **Text files** (`.md .txt .json .html`) are rows in `ten_ws_files`
  (`user_id`, `path`, `content`, `version`, `updated_at`; primary key
  `user_id, path`). Users can only select their own rows, and every write
  goes through `ten_ws_write(path, content, expected)`. That function acts
  only on `auth.uid()`'s rows:
  - with `expected` null, it does `insert … on conflict do nothing`, and a
    clash is `already_exists`;
  - otherwise it does `update … where version = expected`, and zero rows is
    `version_conflict` (or `resource_missing`).

  `version` is a sha256 prefix of the content, computed in SQL, the same as
  the local store's. `updated_at` is `now()`, which `check_closeout` reads.
- **Binaries** (`.pdf .docx`) go to the private bucket `ten-workspaces`, at
  `users/{uid}/ws/{path}`, create-only (no `x-upsert`; a clash is a 409,
  per spike 3). `version` is the object's ETag.
- `list()` merges the two sources, which never overlap; the bucket policy
  accepts only `.pdf`/`.docx` names.
- Only beta members (§ 8) can write. Per-user caps: 2,000 text files and 50 MB
  (`workspace_full`), and 50 objects (≤ 500 MB).
- Refusals are SQLSTATE `PTxxx` (HTTP xxx), message = the `WorkspaceError`
  code (409, 404, 403, 400, 415, 413; table in the migration).

**Export, import, delete (rule 9):**

- Export: a zip in the exact folder shape (entry = `path`, bytes as stored).
- Import: a zip into an **empty** workspace only; one entry failing the path
  rules refuses the whole import (blocks zip-slip).
- Delete is `ten-delete-account` (§ 8): beta data only.
- The fixture for step 2 is `tests/always-on/fixtures/apply/` plus
  `tests/always-on/fixtures/{profile,criteria}.md`, an invented persona.

**Prevents:** two writers silently overwriting each other; one user reading
another's files; a cloud folder that can't be exported or deleted (rule 9).
**Proved by:** the step 2 exits on the named fixture; one store test suite run
against the in-memory, local-folder, and Supabase stores (including two
parallel writes with the same `expected`: exactly one wins); a delete test
that leaves no beta object or row.

---

## 3. Gate protocol

Rule 7: show the complete thing, then one plain sentence of what happens, then
the candidate's typed yes, then a log entry. The wording comes from
`gate-grammar.md`.

**One kind on the web: `spend`** (owner decision, 2026-09-22). No tool sends or submits.
The candidate's sends and submits go in `plan.md § To do` with the prepared
file (the host note, § 7).

**There is one way to open a gate: `estimate_cost`.** When its result has
`needsGate: true`, code opens the spend gate and ends the turn:

- `label` is the tool's `action` input (6 words or fewer, checked).
- `text` is `action`, then each of `items` (the roles or files the run
  covers) on its own line, then the code-built cost line "Estimated cost: $X
  to $Y." (cents rounded up).
- `amountUsd` is `highUsd`, rounded up to the cent.
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
  textHash: string;              // "sha256:" + hex sha256 of text as shown (UTF-8)
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

1. At most one gate is open per chat; a new gate expires the old one.
2. The **next** message approves only if `origin` is `"typed"` **and** the
   whole message, trimmed and lowercased, with at most one trailing `.` or
   `!`, is exactly `yes`. Anything else leaves it open, and the real package
   forwards the reply to the model with a "not approved" note (the fixed line
   in § 6.1 is the mock's alone).
3. An exact `no`, `don't`, `cancel`, or `stop` declines it; the model is told
   not to ask again unprompted.
4. No approve button. The UI sets `metadata.origin` on every user message.

**Gate status has one owner: the `ten_gate_log` row.**

- `setGateStatus` writes the row, then emits `data-gate-status { gateId, status }`
  (at open, approve, decline, expire). A reply that leaves it open re-emits
  with no write. The UI shows the latest status per `gateId`. A chat's first
  turn expires `pending` rows from older chats.

**`ten_gate_log`** (migration, § 8; `gateId` a UUID; text columns capped):
own rows readable; members only write, through `ten_gate_open` (which expires
the chat's open gate), `ten_gate_decide` (off `pending` exactly once) and
`ten_gate_expire_other_chats`. It is **written by the candidate's browser**, a
record, not server proof of consent; no server control reads it. Spending is
enforced by the proxy's balance check and the key limit, so a self-approved
gate cannot spend past the balance.

**Prevents:** spending past the limit without the candidate's word; a job post
or web page approving a gate (only an exact typed `yes` counts, and the model
cannot write the candidate's message); a paraphrased gate line; a gate card
and a status light that disagree.
**Proved by:** a step 4 test (no spend past the allowance without a logged
typed yes); a `matchGateReply` table (`yes`, `Yes.`, `YES!` typed approve;
`yes but…`, `y`, `sure`, pasted text containing yes, a `ui`-origin `yes` do
not); the gate line equals the bundled spend line, amount filled; a new chat
expires older `pending` rows.

---

## 4. MVP tools

Every failure goes back to the model as `{ error: { code, message } }`.
Nothing is thrown into the stream.

| tool | input | output |
|---|---|---|
| `load_skill` | `{ name: "profile" \| "evaluate" \| "apply" \| "coach" }` | `{ path, content }` (§ 7) |
| `read_file` | `{ path }` (workspace path, or `skills/…`) | `{ path, content, readOnly }`; `.pdf`/`.docx` → `unsupported_type` (no extractor yet) |
| `write_file` | `{ path, content }` | `{ path, written: true }`, or `version_conflict` / `read_first` / `not_editable` |
| `list_files` | `{ dir? }` | `{ files: { path, size, updatedAt }[] }` |
| `bash` | `{ command }` | `{ stdout, stderr, exitCode, changed: string[] }` |
| `web_search` | `{ query, maxResults? (≤ 5) }` | `{ results: [{ url, title, excerpt }] }` |
| `fetch_job` | `{ url, saveTo? }` | `{ board, company, title, location, url, text, compensation?, savedTo? }` or `unsupported_url` |
| `estimate_cost` | `{ action (≤ 6 words), steps, webSearches, items? (≤ 8, each ≤ 12 words) }` | `{ action, lowUsd, highUsd, balanceUsd, needsGate, method }`; opens the gate when `needsGate` (§ 3) |
| `check_language` | `{ files }` → `{ report, usd }` | adopted by the owner, 2026-09-22 |

- **Versions are tracked by the package**, per chat and path, from
  `read_file`, `write_file` and `bash` write-backs. An existing file the chat
  never saw returns `read_first`; on `version_conflict` the model re-reads and
  redoes its change.
- **`read_file` on `.pdf`/`.docx`** returns `unsupported_type` until an
  extractor dep exists; no text copy is ever saved.
- **`bash`** is just-bash over an in-memory copy of the workspace, with the
  bundle mounted read-only at `skills/`.
  - Each changed file goes back through `WorkspaceStore.write` with its
    tracked version, under the same write rules (so `CLAUDE.md` and
    `skills/` are refused). A refusal or conflict fails the command with
    exit 1 and names the file.
  - `python3` is a custom command (§ 5), with `python: false`.
  - No network.
- **`web_search`** makes one proxy call with `plugins: [{ id: "web" }]` (the
  proxy fixes the engine and ≤ 5 results) and returns the `url_citation`
  annotations (**UNVERIFIED** how the provider exposes them; the proxy spike
  settles it).
- **`fetch_job`** accepts only these URL shapes:

  | board | job URL | API |
  |---|---|---|
  | Greenhouse | `boards.greenhouse.io/{b}/jobs/{id}`, `job-boards.greenhouse.io/{b}/jobs/{id}` | `GET boards-api.greenhouse.io/v1/boards/{b}/jobs/{id}` |
  | Lever | `jobs.lever.co/{c}/{id}` | `GET api.lever.co/v0/postings/{c}/{id}` |
  | Ashby | `jobs.ashbyhq.com/{b}/{id}` | `GET api.ashbyhq.com/posting-api/job-board/{b}?includeCompensation=true`, pick `{id}` |
  | SmartRecruiters | `jobs.smartrecruiters.com/{c}/{id}[-slug]` | `GET api.smartrecruiters.com/v1/companies/{c}/postings/{id}` |

  Anything else → `unsupported_url` ("paste the posting text"). HTML becomes
  plain text; `saveTo` writes it straight to the workspace (rule 11); it is
  data, not instruction. **UNVERIFIED:** browser access to single-posting
  endpoints.
- **`estimate_cost`** is computed by code:
  `lowUsd`/`highUsd` = `steps` × the median/highest cost per step so far in
  this chat (turn 1: step 4's measured constant, dated) + web searches at the
  plugin price (`GET /api/v1/models`, cached); `balanceUsd` = `deps.balance()`;
  `needsGate` = `highUsd > spendGateUsd`; it emits a `cost` card.

  Past the threshold, code always opens the gate, even when the spend exceeds
  the balance; the proxy's 402 (§ 8) is the only over-balance stop.
- **Allowance.** Each turn may spend `spendGateUsd`, or the amount of a gate
  approved by the message that started the turn. After each step the loop adds
  up the measured cost. If the next step would pass the allowance, the loop
  stops before it and opens a gate for spent-so-far + the last `highUsd`. A
  typed yes starts the next turn, and the model resumes from the files.

**Prevents:** claimed writes that never happened; conflicts on script-rewritten
files; arbitrary page fetches; an unannounced big run (rule 5); an uncomputed
cost figure (rule 8).
**Proved by:** step 4 unit tests per tool (in-memory store, stubbed `fetch`);
`fetch_job` refusing other hosts; a `bash` write-back then `write_file` on the
same path succeeding; a turn stopping at a gate before the step that would
pass its allowance.

---

## 5. Checkers to port (step 3)

Found by grepping the MVP skills for `scripts/`; skill prose unchanged.

**Dispatch:** `python3` matches its first argument by **file name**, so
`scripts/…`, `../apply/scripts/…` and `skills/apply/scripts/…` reach the same
port with the same flag parser. An unknown script, `-c`, or no argument exits
127 with `not available in the web app: <name>`. Output and exit codes match
the Python byte for byte.

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

- **Time:** ports read `deps.clock` and `FileInfo.updatedAt` (freezable).
- **`check_files --skills`** defaults to the bundle and reads every skill's
  `schema.md`, so the whole `skills/` tree is bundled.
- **`render_resume`** keeps the HTML builder and prints `words: N  ->  <path>`
  exactly. `--pdf` is ignored with a one-line note, because the candidate
  prints the sandboxed HTML. No page count is claimed until a browser method
  is proven (**UNVERIFIED**).
- **`check_messages.py`** (outreach-only) exits 127 in the MVP.
- **The parity corpus** is `tests/parity/cases/<script>/<case>/`: input files,
  argv, and the expected stdout, first stderr line, exit code, and changed
  files, all generated by running the Python script.
  - Every `def test_` in the matching `tests/test_*.py` files plus
    `test_e2e_lifecycle` (the one that runs `record_verdict`/`update_job`),
    and every CLI's argparse error, gets at least one case; a check fails on
    any gap, which fixes the denominator for "100%".
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

`useChat` with the SDK's `ChatTransport` (`ai@7.0.111`), implemented twice:
`agentTransport(coach)` and `mockTransport(fixture)`; both return `null` from
`reconnectToStream`, and swapping them is one line.

**Assistant parts:**

| kind | part | data |
|---|---|---|
| text | `text` | SDK standard |
| tool activity | `tool-<name>` | SDK standard; states `input-streaming`, `input-available`, `output-available`, `output-error` |
| card | `data-card` | `{ card: "verdict" \| "plan" \| "document" \| "checker" \| "cost", props, ref? }`, from code only (§ 6.2) |
| gate | `data-gate` | `GateRequest` (§ 3) |
| gate status | `data-gate-status` | `{ gateId, status }`; the latest one wins |
| error | `data-error` | `{ code: "over_balance" \| "model_error" \| "tool_error" \| "offline" \| "step_cap" \| "cut_off", message, retryable }` (`cut_off`: § 9.3, amended 2026-09-24) |

- `data-error.message` is the proxy's or tool's own sentence for the cause
  (§ 8) when one exists, else a fixed fallback per `code`. What was finished is
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

`meta` = persona, description, labelled placeholders (e.g. `spendGateUsd`);
`files` = the seed workspace, loaded into the in-memory store the UI also
reads; `messages` = the whole scripted `UIMessage[]`.

**Mock replay:**

- Each `sendMessages` emits the next assistant message after the latest user
  message, as chunks ~150 ms apart (`start`, `text-*`, `tool-input-available`/
  `tool-output-available`, `data-*`, `finish`).
- At an open gate: a reply equal to the fixture's next scripted user message
  replays that scripted turn; a typed exact yes (real `matchGateReply` →
  `approve`, origin `typed`) jumps to the turn after the fixture's scripted
  yes; `decline` emits `declined` and the line "Declined — nothing started.";
  an off-script reply emits `pending` and "Not approved — type yes to go
  ahead." and does not advance. A later yes at a declined gate is an ordinary
  message; the gate stays declined (§ 3).
- Fixture tool outputs and files come from **the real scripts**; cards from
  **the real builder**.
- **The `.html` side-panel view** (agent-writable, so it must open no outbound
  channel): an iframe `sandbox` without `allow-scripts` (and never
  `allow-scripts` with `allow-same-origin`), with `<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`
  prepended to its `srcdoc`.

### 6.2 Where every card comes from

The model never writes a card. After each tool result the package applies
this table. A card is a
**receipt of a file or a script's output**; reasoning stays in the prose.

| after | card | props from | `ref` |
|---|---|---|---|
| `estimate_cost` | `cost` | the result: `action`, `lowUsd`, `highUsd`, `balanceUsd` | - |
| `bash` `record_verdict.py`, exit 0 (every one) | `verdict` | the `jobs.md` row it wrote, via the `jobs_md` port: company, title, tier, score, track, `fit_reason` and dealbreakers word for word | the row's `jd_file` |
| `bash` `check_materials.py` | `checker`, one per file | stdout: `LABEL name: pass\|FAIL (n fail, m warn)`, then each `  [LEVEL] msg` line → a finding `{ level: "FAIL" \| "WARN", message: string }`, word for word | the checked file |
| `bash` `render_resume.py`, exit 0 | `document` | `--md` path; `words` from `words: N  ->  path`; `htmlPath` if inside the workspace; badge = the chat's latest `checker` result for that `.md`, else `not-run` | the `.md` |
| `bash` `check_closeout.py`, exit 0 | `plan` | `parsePlanTodo(plan.md)` and the `--stage` value | `plan.md` |

- **Verdict `ref`:** `record_verdict` gets `--jd-file` whenever a JD file
  exists (host note, § 7). With no `jd_file`, the card has no `ref` and shows
  "no analysis file linked"; it never guesses.
- **`parsePlanTodo(md) → { text, ref? }[]`** is pure and exported from
  `packages/agent`. The card builder and `apps/workspace-ui` (its `parsePlan`
  maps from it) both use it.
  - CRLF is normalized to LF. It reads the lines under the `To do` heading
    (a trailing count such as `To do (2)` is allowed), up to the next board
    heading or `##`.
  - It accepts `1. `, `- ` and `* ` bullets; `text` is the line without its
    bullet, word for word.
  - `ref` is the first backticked span that contains `/` or ends in a file
    extension (`keep` is not a ref), otherwise absent.
  - It never extracts a why, a time estimate, or a priority from the prose
    (rule 8).

**Prevents:** UI rework at the swap; a card that says more than its file
(rules 8, 11); a status light that disagrees with the gate log; a gate that
approves on a click.
**Proved by:** builder tests on real script stdout; a test that model output
cannot produce `data-card`/`data-gate`/`data-gate-status`; `parsePlanTodo` and
`statusOf` table tests; the step 5a exits; step 5b's transport-swap-only diff.

---

## 7. Staged loading and the per-turn window

1. **Always on (the system prompt):**
   - **Tier 0 is always the bundled `skills/profile/templates/workspace-CLAUDE.md`,
     never the workspace copy.** The app creates the workspace `CLAUDE.md`
     (create-only) at first run or import, for export; the agent cannot write it.
   - **The host note:** the literal text is the bundled
     `skills/profile/templates/web-host-note.md` (beside the Tier 0 template,
     so the word report counts it; a `skills/_host/` dir would fail the
     every-skill-is-converted invariant).
   - **Tier 1:** the `description:` lines of profile, evaluate, apply, and
     coach.
   - **The tool descriptions:** about 350 words.
2. **On match:** `load_skill(name)` → the `SKILL.md` with its bundle path.
3. **On demand:** `read_file("skills/<skill>/references/<file>.md")`.
4. **Never loaded:** scripts; only their `bash` output enters context.

**Target: ~3,300 words of instructions per turn** (owner decision,
2026-09-22, because Tier 0 grew). That is the always-on block plus one `SKILL.md`.

**Window:** the package re-sends at most `windowWords` (4,000) of history,
dropping whole older turns first and always keeping the latest user message.
A `SKILL.md` that falls out is loaded again when needed; gate state lives in
`ten_gate_log`. A reload starts a new chat.

**Prevents:** loading more than local does (rule 15); unbounded cost per turn
(rule 5); a transcript the export leaves out (rule 9); **persistent prompt
injection** — a job post talking the model into rewriting `CLAUDE.md` and so
changing the guardrails for every later chat.
**Proved by:**
- a test that the system prompt contains the bundled template byte for byte,
  even when the workspace `CLAUDE.md` differs;
- a test that `write_file("CLAUDE.md")` and a `bash` write to it or under
  `skills/` fail with `not_editable`;
- a word count of system prompt + tool descriptions + one `SKILL.md` against
  `python3 tests/word_report.py` on the same commit (within 10%);
- a 20-turn headless run whose re-sent history never passes `windowWords`.

---

## 8. Model proxy, balance, and the production project

**Setup (owner, 2026-09-23).** The proxy uses the owner's **existing**
OpenRouter key, which the live CareerCoach app also uses, stored as the secret
`TEN_OPENROUTER_API_KEY` in `ten-model-proxy` only. Its limit is **$20 with a
daily reset**, shared by both apps. A **beta-wide daily ceiling of $5**
(owner, 2026-09-23) keeps the live app's share: before forwarding, the proxy
sums today's (UTC) beta calls with the service-only `ten_beta_spend_today()`
and, at $5 or more, answers **503** "The beta has reached today's limit. Try
again tomorrow." (shown as `model_error`, not `over_balance`). So the live app
keeps at least $15/day, less only the beta calls already in flight when the
ceiling is crossed (each ≤ the ceiling below). Beta and live costs mix in
OpenRouter's usage view, so the ledger is the only beta cost record; rotating
the key means updating both apps.
Every model call goes through the proxy; the price list is fetched directly.

The beta shares the owner's **existing production Supabase project**,
`career-coach-nextgen` (Postgres 17), and its sign-in with the old app. On
2026-09-23 it had zero storage policies and RLS on for `storage.objects` and
`storage.buckets` (the observed baseline). Every object it adds is named `ten_…`/`ten-…`,
created by `supabase/migrations/20260923000000_ten_beta_init.sql` and dropped
by `supabase/teardown/ten_beta_teardown.sql`; the owner applies both, never an
agent, at a quiet time (3 s lock timeout; on a timeout nothing changes). Its
lasting protection is three **restrictive pins** (built-in functions only):
no permissive policy, now or added later by the old app, can open
`ten-workspaces` rows to anyone but their owner, or make the bucket public or
delete it. The apply-time guard is an **allowlist**: it refuses RLS off, a
`storage.buckets` UPDATE/DELETE/ALL policy, and any `storage.objects` policy
not deparsed as `bucket_id = '<name>'` (alone or ANDed at the top level);
a CASE, `= false` or `IS DISTINCT FROM` shape is refused, and so is a safe
`IN (…)` (no such policy exists today). The proof, in order: the owner's
read-only queries (header), then spike 3's isolation re-run, **both before
the first credit row**; until then nobody can write. RLS is on and `anon`
revoked from creation.

**Vercel:** only production signs in; previews run the mock with no Supabase
env. The production URL goes in Auth's **Redirect URLs** (the Site URL, used by
the old app's emails, is untouched), and every auth link passes `redirectTo`.

**Who is in:** public sign-up is **open**, so anyone on the internet can hold
a signed-in session; membership (a `credit` row an admin inserts, $5.00,
checked by `ten_is_member()`) is the **only barrier** to beta data. The proxy
(403) and every `ten_` function and policy that reads or writes beta data
check it; the one exception is the ledger's own-row read, where membership
itself lives. The app says: "You're signed in, but this beta is invite-only. Ask the
person who invited you to add you." (`design-web-ui.md` § 1.6 is canonical.)

**`ten-model-proxy`** accepts `POST …/ten-model-proxy/chat/completions` and
`OPTIONS`. Any other path or method gets 404. In order:

1. **Auth:** it resolves a signed-in user (`role = authenticated`, a `sub`),
   otherwise 401. The anon or publishable key alone gets 401.
2. **Size and membership:** a body over 256 KB gets 413, counted while the
   request body streams in (no trusting `Content-Length`). A non-member gets
   403.
3. **Balance and ceiling:** if the user's balance is not above 0, 402, shown
   as `over_balance`: "Your beta credit is used up. Ask the person who invited
   you for more." If the beta's spend today is $5 or more, 503 (above).
4. **Builds** the upstream body from an allowlist. It copies `messages`,
   `tools` (function tools only; server tools are dropped, so web search
   exists only as the fixed plugin below), `tool_choice` and `temperature`.
   It **sets**:
   - `model` = `anthropic/claude-sonnet-5`, an exact match with no suffix
     (anything else gets 400 `model_not_allowed`);
   - `max_tokens` = min(client, 8,192) (was 4,096; amended 2026-09-24, § 9.5);
   - `stream: true`;
   - `provider: { data_collection: "deny", zdr: true }`;
   - `cache_control: { type: "ephemeral" }`;
   - if the client asked for `plugins: [{ id: "web" }]`, exactly
     `[{ id: "web", engine: "exa", max_results: min(n, 5) }]`.

   Everything else (`models`, `max_completion_tokens`, `reasoning`,
   `web_search_options`, other plugins, `stream: false`, …) is dropped. One
   hard-coded upstream: `https://openrouter.ai/api/v1/chat/completions`.
5. **Streams** the response back, teed. Inside `EdgeRuntime.waitUntil` it
   reads the other copy to the end (parsing only the last `data:` line) and
   writes one `ten_usage_ledger` row keyed by the response `id`, from the
   final chunk's `usage.cost` and token counts, error endings included. The
   cost is used if it is a finite number from 0 to 10× the ceiling (a cost
   above the ceiling is recorded as reported, never undercounted, and
   logged as an anomaly; the caps make it unexpected); if it is missing,
   non-finite, negative or beyond 10×, or the meter passes its ~360 s
   deadline (timed from the request's start), the row records the
   **ceiling**, computed from the formula (64k input tokens ×
   input price + 8,192 × output price + one search; about $0.23 today, § 9.5).
   One metering path only; the same pass records `finish_reason` (§ 9.6).
6. **Failures:** an upstream 402 (the shared key's daily $20 is out) or 5xx,
   a Supabase error, or anything unexpected becomes a 503 with the CORS
   headers, shown as `model_error`, not `over_balance`.

**`ten_usage_ledger`** is the only money table (`kind` `credit`/`call`,
`request_id` unique, token counts, `usd numeric(12,6)`, `finish_reason`
(§ 9.6); columns in the migrations). Users select their own rows; only the service role writes.

- **Balance** = credits − calls, derived, never stored (rule 12).
  `ten_balance()` is a `security definer` wrapper that passes `auth.uid()` to
  the one formula, `ten_balance_for`, so it takes no argument and shows only
  the caller's; the proxy calls service-only `ten_balance_for(uid)`. `deps.balance()` reads
  it at turn end and on window focus. The chip rounds **down** to cents; a
  negative balance shows $0.00.
- **The honest bound** (owner, 2026-09-23: no server lock or rate limit): a
  member calling the proxy directly can run calls in parallel, each starting
  only while the balance is above 0. A user's loss is the calls in flight when
  it crosses zero (each ≤ the ceiling); the beta's total by the $5/day
  ceiling plus in-flight calls, and everything by the key's shared $20/day. The one-tab lock had no other use and is removed.
- **`ten-delete-account`** runs with the service role, needs only a
  signed-in user (not membership; anon/publishable key → 401), acts only on
  that user, and is idempotent. It removes `users/{uid}/` objects through the
  **Storage API** (listed and removed page by page; SQL deletes are refused
  and would orphan the files), then the `ten_ws_files`, `ten_gate_log` and
  `credit` ledger rows. It keeps the shared sign-in and the `call` ledger rows:
  cost records (tokens and USD, no career content), so the daily ceiling and
  the cost history stay intact. Rule 9 holds: career data is gone; cost
  metadata is not career data. The UI says: "This deletes your Ten beta data.
  Your sign-in stays because it's shared with the older app. Unused credit is
  forfeited. Your usage records, which show only amounts spent and no
  content, are kept."
- **CORS:** the proxy allows only the production Vercel origin and
  `http://localhost:5173`; its allowed headers include every header the AI
  SDK sends (at least `authorization`, `content-type`, `user-agent`), since
  Firefox and WebKit preflight them.
- **The browser holds** only the Supabase session. A custom `fetch` sets
  `Authorization: Bearer <current JWT>` on each call (§ 1).

**Time (paid plan: 400 s wall clock; 2 s CPU excluding I/O).** A proxy
request is one model call (tools run in the browser); 8,192 tokens at 30–80
tokens/s take 102–273 s, inside the meter's ~360 s (§ 9.5). A reply cut off at
the output cap is handled in the agent (§ 9, amended 2026-09-24); the earlier
retryable `model_error` "The reply was cut off…" is retired. A stream stopped
with no finish reason at all is a separate, open case (§ 9.8).

**Prevents:** a model key in the browser; any client field reaching around
the model, output, search, or path limits; spending a zero balance; a
non-member spending or storing; a free call from a disconnect; a balance
stored twice; deleting a shared sign-in; the beta starving the live app of
more than $5/day (plus in-flight calls); a later old-app storage policy
opening beta files.
**Proved by:** stubbed-upstream tests of the **outgoing** body (no `models`,
`max_completion_tokens`, `web_search_options`; `stream: true`; forced
`provider`; `max_results` ≤ 5); 401 (no JWT, anon or publishable key, both
functions); 403 non-member; 402 at zero; 413 over 256 KB; 404 `/embeddings`;
400 `…:online`; a stopped stream still writes a row; duplicate `request_id`
rejected; users cannot insert ledger rows; unlisted-origin preflight gets no
allow header; delete (twice: idempotent) leaves the auth user and the `call`
rows, no other beta rows, and a known path downloads as not-found; `ten_beta_spend_today()` sums only today's calls and
is service-only; the SQL harness in `tests/sql/` (README there: `run-r2.mjs`,
`r3-own.mjs`; guard, CAS, codes, caps, paths, membership, pins, teardown after
the Storage API step) passes.

---

## 9. Cut-off replies (amendment, 2026-09-24)

Owner-approved decisions (2026-09-24), written in by the architect. Where
this section and an earlier one disagree, this one wins; the earlier text
points here.

**Receipt (live beta, 2026-09-24; numbers only).** Three "evaluate 4 JDs"
runs in a row each ended on a reply of exactly 4,096 output tokens, the cap.
Each reply was the final write of all four verdicts. Nothing was saved, and
the turn ended with no text and no error. The next turn said no evaluation
had been run. About $1.37 was spent for nothing. A profile-intake turn hit
the same cap. Across ~140 calls, every reply that ended on its own used
≤ 3,038 output tokens; 4,096 tokens took 52–55 s (~75 tokens/s).

**Why it was silent (read in the installed packages).**

- When a stream ends with `finish_reason: "length"`,
  `@openrouter/ai-sdk-provider` 3.1.0 drops any tool call whose arguments
  were still being written. Its `flush()` emits unfinished calls only when
  the reason is `tool-calls`.
- The step then has no tool call, the `ai@7.0.111` loop ends, and
  `coach.ts` never read the finish reason.
- The loop also **continues** after a `length` step that holds a finished
  call (the provider emits a call once its arguments parse). So a later,
  unfinished call can vanish mid-run.
- On the next turn, `convertToModelMessages` leaves out a tool part still in
  `input-streaming`, so the model sees no trace of the attempt.

**Prevents:** work that is silently not saved; a next turn that says nothing
was attempted; paying twice for the same cut-off.

### 9.1 Detection (`packages/agent`)

A step is **cut off** when its finish reason is `"length"` (the step result
and the `finish-step` part both carry it). That is the whole test, and no
proxy change is needed. A partial text reply with no tool call counts the
same.

- The stop condition checks this **first**, before the step cap. A cut-off
  step stops the loop; its only other effect is recording the step's cost.
- A tool part the cut-off left open is a `tool-input-start` with no
  `tool-call` for its id (the existing stream tap sees both). Each one is
  closed with the SDK's `tool-input-error` chunk: `input: {}` and
  `errorText` "Cut off at the output limit before it ran. Nothing from it
  was saved."
  - The "ran …" line then shows that text, not an empty output (rule 11).
  - Later turns carry a small, valid call-and-error pair, not the partial
    arguments.

### 9.2 One continuation per turn

The identical request is never re-sent (`maxRetries: 0` stays). After a
cut-off the coach makes **one** continuation call per turn, only if all of
these hold:

1. no continuation has run this turn;
2. fewer than `maxSteps` steps are used, counting both calls (the
   continuation's stop condition uses the turn's total);
3. no gate is pending for the chat;
4. spent-so-far plus the projected next step (§ 4's projection) is within
   the turn's allowance;
5. the turn wasn't aborted, and the call didn't end on an `error` part.

**How it runs.** The AI SDK loop has already ended by then, so:

- The coach reads the first call's tapped stream to its end. It then reads
  `result.responseMessages` (every step's assistant and tool messages) and
  `result.steps`.
- Every step's cost is added **exactly once**. The stop condition records
  the steps it sees. After each call, the coach records any it didn't (at
  most the last). This also fixes a gap: today the last step of every call
  goes uncounted.
- A second `streamText` runs with the same `model`, `system`, `tools`,
  `abortSignal` and `maxRetries: 0`. Its `messages` are, in order:
  - the first call's input messages;
  - its response messages (drop a trailing assistant message with no
    content);
  - one **user-role** message with this note, word for word:

  > Note from the Ten app, not the candidate: your last reply was cut off
  > at the output limit. The part that was cut off never ran: a tool call
  > it was writing did not happen, and nothing from it was saved. Tool calls
  > that finished before it did run. Do the unfinished work in smaller
  > pieces, one file per write, and check the files before repeating
  > anything.

- The system prompt stays the same, so the continuation can reuse the
  prompt cache. A changed system prompt would re-bill the whole prefix.
- The note exists only in that request. It is never a `UIMessage`, and
  `matchGateReply` never sees it.
- **One assistant message on screen.** Every call's UI stream is merged
  with `sendFinish: false`, and every call after the first also has
  `sendStart: false`. The coach writes one `{ type: "finish" }` last. No
  `apps/web` code reads that chunk's fields (checked 2026-09-24).
- Inside the continuation the normal loop runs, with the same stop
  condition, allowance, gate and step cap. Its calls are metered like any
  other.

### 9.3 A visible stop: `cut_off`

A cut-off that can't be continued writes `data-error { code: "cut_off",
message, retryable: true }` (§ 6.1). That covers any of 1–5 failing,
including a second cut-off in the turn. There is never a third call. The
message is fixed:

> My reply got too long and was cut off, so its last step didn't save. Say
> continue to redo it in smaller pieces.

It says what happened and what the candidate can do, not what the agent
will do (the L2 rule in `apps/web/src/components/ErrorPart.tsx`).

- **Gates are untouched.** This path never opens, decides or expires a
  gate, and a pending gate stays pending.
- An allowance stop here opens no "Continue this run" gate. The
  candidate's next message starts a new turn with a fresh allowance (§ 4),
  so "say continue" is true.
- **UI change needed.**
  - `apps/web/src/types.ts` adds `"cut_off"` to `ErrorCode`.
  - `ErrorPart` renders it through its generic path, with no `nextStep`
    entry; the message already says what to do.
  - `design-web-ui.md` § 2.7 is updated to match.
  - The old § 8 cut-off `model_error` sentence is retired.

### 9.4 The next turn knows

The check is stateless and runs at the start of each turn. It looks at the
assistant message just before the latest user message, in the history as
sent, **before** the window trims it. If that message has a `data-error`
part with code `cut_off`, the coach appends this note to that turn's system
prompt (after the gate-pending note, when both apply):

> Your previous reply in this chat was cut off at the output limit and
> could not be finished, so part of that work was never saved. Check the
> files for what is actually there. Tell the candidate plainly what was
> saved and what wasn't (never that nothing was attempted), then do what's
> missing in smaller pieces, one file per write, unless they asked for
> something else.

- **No stored flag (rule 12).** Data parts stay in the history: none is
  transient, and the real transport sends every message.
- **Before the window, on purpose.** A multi-JD turn's tool results can pass
  `windowWords`. The window would then drop exactly the turn that was cut
  off.
- A turn whose continuation succeeded wrote no `cut_off`, so the next turn
  gets no note.

### 9.5 The cap and its time bound (proxy)

`max_tokens` = min(client, **8,192**) (was 4,096). The ceiling comes from
§ 8's formula with `core.ts`'s constants:

64,000 × $2/M + 8,192 × $10/M + one search (5 × $0.004)
= $0.128 + $0.08192 + $0.02 = **$0.22992, about $0.23** (was $0.18896).

**Why 8,192 and no higher:**

- The meter must finish within ~360 s of the request's start (Edge
  Runtime wall clock: 400 s).
- At the design's worst case of 30 tokens/s, 8,192 tokens take ~273 s, so
  they fit. 16,384 tokens would take ~546 s, so they would not.
- About 10,000 tokens (~333 s) is the most that fits. **Going beyond ~10k
  needs a longer-running host for the proxy, not a bigger number.**
- At today's measured ~75 tokens/s, 8,192 tokens take ~110 s.

### 9.6 Recording why each call ended (proxy)

This lets a cut-off show in the data without anyone reading a chat.

- **Column:** `ten_usage_ledger.finish_reason text`, nullable, with
  `check (finish_reason is null or char_length(finish_reason) <= 32)`.
  - It is added by a **new** migration file,
    `supabase/migrations/20260924000000_ten_ledger_finish_reason.sql` (3 s
    lock timeout, one `alter table … add column`). The applied
    `20260923000000_ten_beta_init.sql` is never edited.
  - The owner applies it, never an agent, **before** deploying the proxy
    that writes the column. Otherwise every insert would name an unknown
    column and fail.
  - The teardown needs no new statement (the column goes with the table),
    but its header names both files. The SQL harness applies both files in
    order.
- **Parse:** in the meter's existing pass over the `data:` lines,
  `finish_reason` is the **last non-null** `choices[0].finish_reason`
  (OpenRouter's normalized value, not `native_finish_reason`).
  - Reading only the last line would miss it: the usage chunk that follows
    often has no `choices`.
  - A string of 1–32 characters is kept. Anything else is null: another
    type, no finish reason, or a meter that hit its deadline.
- **Never blocks the insert:** a parse problem gives null, never an
  exception, and the rest of the row is written as today. Credit rows leave
  it null. It is cost metadata, so `ten-delete-account` keeps it with the
  `call` rows.

### 9.7 Prevention in the skill (evaluate)

This is a hint, not a step. (CLAUDE.md: a measured miss earns a moment rule,
a hint in patterns, or a script, never a step.)

It goes in `skills/evaluate/references/patterns.md`, § Full evaluation —
getting there, at the end of step 7 ("Record it"). It is host-neutral, word
for word:

> In a run over several roles, record each one as soon as its verdict is
> decided (its analysis file and its `record_verdict.py` call), then move
> to the next role. Never hold verdicts back to write together at the end:
> a batch cut off partway (a reply limit, a closed session) saves nothing,
> and the next session finds no sign the work was done. *(Receipt: web
> beta, 2026-09-24: three four-role runs lost everything at the final
> batch write.)*

The coder pastes it, an independent reviewer checks it, and the deployed
copy is refreshed with `cp -r skills/* ~/.claude/skills/`.

### 9.8 Test plan

The tester writes these from this section, not from the code. Use a stubbed
model, the in-memory store and a fake gate, never a real workspace.

- **(i) One continuation, then success.** The real
  `@openrouter/ai-sdk-provider` gets a stubbed `fetch` streaming SSE: text,
  a `write_file` whose arguments stop mid-string, then `finish_reason:
  "length"`. The second response is a normal call, then `stop`. Pass when:
  - there are exactly two requests;
  - the second has the same system prompt, differs from the first, and ends
    with the § 9.2 note word for word;
  - the second call's tool runs;
  - there is one message with one `start` and one `finish`;
  - the dangling part is `output-error` with the § 9.1 text;
  - there is no `cut_off`.

  Variants: a text-only cut-off; a mid-run cut-off, where a step holds a
  finished and an unfinished `write_file`. The finished one runs once, the
  loop stops, and the continuation runs.
- **(ii) Cut off twice.** Both requests end on `length`. Pass when there are
  exactly two requests and one `cut_off`, with its fixed message and
  `retryable: true`.
- **(iii) Continuation blocked.** In each case, pass when there is no
  second request and there is one `cut_off`:
  - (a) spent plus projected passes the allowance;
  - (b) the cut-off step is step `maxSteps`, and no `step_cap` is written;
  - (c) a gate is pending, and it stays pending.

  Also: the fake gate sees no open, decide or expire from this path, and
  the cut-off step's cost is counted once, in both the turn and the chat.
- **(iv) The next turn.**
  - A `cut_off` part on the last assistant message: the system prompt ends
    with the § 9.4 note word for word.
  - No such part: no note.
  - The cut-off turn outside `windowWords`: the note is still there.
  - A declined gate: no model call.
- **(v) Cap and ceiling.**
  - Clamp: 8,192 stays; 8,193, absent and garbage all give 8,192.
  - `CEILING_USD` = 64,000 × 2e-6 + 8,192 × 1e-5 + 5 × 0.004 = 0.22992.
  - Every 4,096 assertion is updated (`core.test.ts`, `handler.test.ts`,
    `tests/functions/*.test.ts`).
- **(vi) `finish_reason`.**
  - `"length"` on a content chunk, then a usage chunk with empty `choices`:
    `"length"`.
  - None, a number, `""`, or 33 characters: null.
  - A stream cut mid-line: the last whole value, or null.
  - A meter deadline: null.
  - In every case the insert carries the key and succeeds.
  - SQL harness: the column is nullable and refuses 33 characters, and
    teardown leaves no `ten_` object.
- **(vii) UI.**
  - `ErrorPart` shows a `cut_off` part's message word for word, plus the
    retryable line and no next-step line.
  - A part closed by `tool-input-error` shows the § 9.1 text in the
    expanded "ran …" line, as one part per call id.
  - `apps/web` typechecks.
- **(viii) Live, once, after deploy** (the owner approves the spend). A
  fixture persona, never real data, runs a four-JD evaluate in production.
  Pass when the ledger rows carry `finish_reason`, and any `length` row
  shows in chat as a finished continuation or a visible `cut_off`.
- **(ix) The hint.** A conduct harness per `tests/always-on/README.md`:
  four planted JDs, 3 trials, majority rule. Pass when each role's
  `jobs.md` row lands before the next role's analysis file. The owner
  approves the spend first (rule 5).

**UNVERIFIED** (the named test settles each one):

- that the production finish reason was `length`. This is inferred from
  the exact 4,096-token replies and the provider code; the new column
  confirms it next time;
- that a late `tool-input-error` updates the open part rather than adding
  a second one (vii);
- that OpenRouter accepts a user message right after tool results for
  this model (i);
- that the continuation reads the cache, i.e. its ledger `tokens_cached`
  is above 0 (viii);
- that the model accepts `max_tokens` 8,192 (viii).

Known noise: `ai` logs a console warning about `rawInput` whenever history
holds a part closed by `tool-input-error`.

**Open question (owner): a stream that ends with no finish reason at all.**
The provider maps that to `"other"`, not `"length"`.

- With a pending tool call, the provider emits the call with `{}` input,
  and it fails visibly as a tool error.
- With text only, the turn still ends silently.
- What a 400 s wall-clock kill looks like on the wire is **UNVERIFIED**.

Should that case count as a cut-off too? It is out of scope here.

---

## Step-1 spikes

The pass criteria are the plan's (step 1), except spike 4, which the proxy
spike replaced (owner, 2026-09-23).

- **1: PASS** (live streamed call and a turn-2 cache read, 2026-09-23), except
  the `web_search` annotations. Those are re-run through the proxy.
- **2: pass on the mechanism**; the letter moves to step 3 (§ 5).
- **3: isolation BLOCKED** until the owner applies the migration. The re-run
  proves, on `ten_ws_files` RLS and the `ten-workspaces` policies with the
  project's **real** policy list, that A cannot list, read, or write B's rows
  or objects, and that a non-member cannot write. Found: `If-Match` is
  ignored (hence the compare-and-swap in § 2); `updated_at` changes on
  overwrite.
- **4, the proxy spike** (with a live budget set first). It passes when:
  - the § 8 "Proved by" tests pass;
  - one ledger row per call has `usd` equal to `total_cost` from
    `GET /api/v1/generation?id=`;
  - a web-search call's `usage.cost` matches the change in the key's
    credits (if not, the proxy adds the listed plugin price);
  - there is a turn-2 cache read through the proxy;
  - streaming works end to end from the Vercel build.

---

## Decision log

- Spend is the only web gate; nothing there sends or submits (owner, 09-22).
- The gate opens from `estimate_cost`: one way in, one tool fewer.
- Cards are code-built receipts of files (rule 11); the plan card shows lines
  word for word (rule 8).
- Gate status lives in the row; UI status is derived (rule 12).
- No saved chat: files are the memory, cost per turn is bounded.
- Tier 0 from the bundle: a writable system prompt is a persistent injection.
- `check_language` adopted (owner, 09-22): one fresh-context call per document
  set (~$0.015–$0.02, measured in step 4).
- A proxy that builds its own body over the live app's existing key ($20/day,
  shared; owner, 09-23), and a ledger-derived balance.
- Text in `ten_ws_files` with a SQL compare-and-swap, binaries create-only in
  Storage: Storage has no conditional write (spike 3); one home per file.
- A credit row = beta member; delete removes beta data but keeps the shared
  sign-in and the `call` cost rows (not career data, rule 9).
- A $5/day beta-wide ceiling in the proxy (owner, 09-23): the shared key's
  $20/day stays at least $15 for the live app.
- Restrictive pins on the bucket, plus an allowlist guard at apply time: the
  pins hold against policies added later; parsing SQL text can't.
- Cut-off replies (owner, 09-24; § 9): detected in the agent from the finish
  reason, one continuation per turn under the same allowance, else a visible
  `cut_off`; the next turn is told, from history, with no stored flag (rule 12).
- The retry note is a user-role message, not a system-prompt change: the
  system prompt stays byte-identical, so the prompt cache survives. Prefill
  was rejected (it cannot resume a dropped tool call).
- Cap 8,192 (owner, 09-24): the most the ~360 s meter allows at 30 tokens/s,
  with margin; more needs another host. The ledger records `finish_reason`.
