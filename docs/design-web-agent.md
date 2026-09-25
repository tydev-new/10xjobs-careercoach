# Design - Web agent contracts (MVP)

**Status:** Draft r4 for owner approval (plan step 1, contracts half)
**Date:** 2026-09-22 · **Owner:** Yong · **Author:** architect
**Amended:** 2026-09-24, § 9 (cut-off replies; owner-approved) and § 10
(new-version notice; owner-approved). Where § 9 and an earlier section
disagree, § 9 wins. Again 2026-09-24: § 11 (the conversation is kept;
owner requirement) and § 12 (a turn that grows too large), both approved
by the owner as written (2026-09-24). Each wins over earlier text it names.
Again 2026-09-24: § 13 (the site's model is a setting; approved by the owner,
2026-09-24, with the answers in § 13.6).
Again 2026-09-24: § 14 (web search is billed per request; owner request).
Again 2026-09-25: § 15 (production is owner-only; owner decision).
Again 2026-09-25: § 16 (setting and resetting a password; owner-reported
gap; draft for owner approval).
Again 2026-09-25: § 17 (buying credit with PayPal; approved by the owner,
2026-09-25, with the answers in § 17.9; § 17.10, only Ten's own orders, lead
ruling 2026-09-25).
**Builds on:** `docs/plan-portable-skills-and-web-agent.md` (Phase 0 settled),
`apps/workspace-ui/server/workspace-core.mjs`, `skills/coach/references/gate-grammar.md`,
`docs/loading-map.md`. Card prop types live in `docs/design-web-ui.md`; this doc
owns the wrapper and where each prop comes from (§ 6.2).

`UNVERIFIED` = not confirmed from vendor docs or the installed package.
`PENDING OWNER` = not yet confirmed by O. Reasons: Decision log.

**Default model:** `anthropic/claude-sonnet-5` on OpenRouter (on its live
model list, 2026-09-22), for the web app and the B1 runner. Since § 13 the
site's model is a build setting, `VITE_COACH_MODEL`, with this model as the
fallback; the proxy allows exactly two models.

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
  this chat (turn 1: step 4's measured constant, dated) + `webSearches` ×
  the median/highest measured cost of one search call (§ 14; was the
  plugin price alone); `balanceUsd` = `deps.balance()`;
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
| error | `data-error` | `{ code: "over_balance" \| "model_error" \| "tool_error" \| "offline" \| "step_cap" \| "cut_off" \| "too_large", message, retryable }` (`cut_off`: § 9.3; `too_large`: § 12.2; both amended 2026-09-24) |

- `data-error.message` is the proxy's or tool's own sentence for the cause
  (§ 8) when one exists, else a fixed fallback per `code`. What was finished is
  the model's to say next turn, from the files.
- `step_cap` (the turn used `maxSteps` steps) has a fixed message, "This turn
  ran out of steps before finishing.", with `retryable: true`. The UI adds the
  line "Say continue to carry on from what's already saved." (`design-web-ui.md`
  § 2.7). The next turn is told it stopped (§ 9.4; amended 2026-09-24, round 2).
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
`ten_gate_log`. A reload restores the saved conversation, and the window
applies to it the same way (§ 11, amended 2026-09-24; this used to say "A
reload starts a new chat"). The window trims earlier turns only; § 12
bounds the current one.

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
     (anything else gets 400 `model_not_allowed`; two models, § 13);
   - `max_tokens` = min(client, 8,192) (was 4,096; amended 2026-09-24, § 9.5);
   - `stream: true`;
   - `provider: { data_collection: "deny", zdr: true }`;
   - `cache_control: { type: "ephemeral" }` (Claude only, § 13);
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
   input price + 8,192 × output price + one search; about $0.22 today, § 9.5
   and § 14;
   per model, § 13).
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
  and would orphan the files), then the `ten_ws_files`, `ten_conversations`
  (§ 11.7), `ten_gate_log` and `credit` ledger rows. It keeps the shared sign-in and the `call` ledger rows:
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
- `ai@7.0.111` runs tools only when a step ends on `stop` or `tool-calls`
  (`isToolExecutionAllowedFinishReason`). On a `length` step **no** tool
  runs, not even one whose input finished, and the loop ends without
  calling `stopWhen`. *(Corrected 2026-09-24, fix round 1 of issue #2: the
  tester showed this on the real packages; the first draft said a finished
  call ran.)*
- That finished call stays in the response messages, and in its UI part
  (`input-available`), with no result. A request built from them fails
  before sending with `MissingToolResultsError`, so every later turn in
  the chat would fail too.
- On the next turn, `convertToModelMessages` leaves out a tool part still in
  `input-streaming`, so the model sees no trace of the attempt.

**Prevents:** work that is silently not saved; a next turn that says nothing
was attempted; paying twice for the same cut-off; a chat that fails on every
later turn.

### 9.1 Detection (`packages/agent`)

A step is **cut off** when its finish reason is `"length"`. That is the
whole test, and no proxy change is needed. A partial text reply with no
tool call counts the same.

- A cut-off step is always its call's last step, because the loop ends
  there. So the coach checks after each call ends, using the last
  `finish-step` part the tap saw (or the last of `result.steps`).
- The stop condition never runs on a cut-off step and gets no new check.

**Every tool call in a cut-off step is treated as not run**, whether or not
its input finished, because none of them ran (above). The coach never runs
a tool itself. In the UI, each one is closed with the SDK's
`tool-input-error` chunk: `input: {}` and `errorText` = the **closing
text**:

> Cut off at the output limit before it ran. Nothing from it was saved.

- **Which parts:** every `tool-input-start` id and every `tool-call` id the
  tap saw in the cut-off step. A finished call has both; an unfinished one
  has only the first.
- The tap's list starts empty at each step, so a tool call that ran in
  an earlier step keeps its real result, on screen and in the
  continuation.
- The "ran …" line then shows the closing text, not an empty output
  (rule 11).
- Later turns turn each one into a small, valid call-and-error pair
  (`input: {}`), not the partial or unrun arguments.

**A chat is never left broken.** After any cut-off (continued, stopped with
`cut_off`, or aborted), the next turn must reach the model. Two things
make sure of it:

- the closing above, so no part is left `input-available`;
- every turn converts history with `convertToModelMessages(…,
  { ignoreIncompleteToolCalls: true })`. A tool part that never got a
  result (from a cut-off, an abort, or a closed tab) is then left out of
  the request instead of failing it.

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
  - right after the cut-off step's assistant message, one `tool` message
    holding a synthesized result for **each** of that message's
    `tool-call` parts: `{ type: "tool-result", toolCallId, toolName,
    output: { type: "error-text", value: <the closing text> } }`;
  - one **user-role** message with this note, word for word:

  > Note from the Ten app, not the candidate: your last reply was cut off
  > at the output limit, so none of the actions in it ran. Every tool call
  > in that reply was cancelled, including any that looked complete, and
  > nothing from it was saved. Redo that reply's work in smaller pieces,
  > one file per write. Actions from your earlier replies did run; check
  > the files before repeating any of them.

- Why the synthesized results:
  - The SDK requires every tool call to have a result, and throws
    `MissingToolResultsError` otherwise. The results keep the request
    valid, and they show the model exactly which calls did not run.
  - Each call keeps its own input, so the model can split that content
    into smaller writes.
  - Unfinished calls never reached the response messages, so they need
    nothing.

- The system prompt stays the same, so the continuation can reuse the
  prompt cache. A changed system prompt would re-bill the whole prefix.
- The note exists only in that request. It is never a `UIMessage`, and
  `matchGateReply` never sees it.
- **One assistant message on screen.** Every call's UI stream is merged
  with `sendFinish: false`, and every call after the first also has
  `sendStart: false`. The coach writes one `{ type: "finish" }` last of
  all, after any `cut_off` error. That holds when the turn throws, too:
  the outer catch writes its `data-error`, then the `finish`. No
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

### 9.4 The next turn knows (a turn that ended early)

*Generalized 2026-09-24, round 2 (lead ruling): the same check now also
covers `step_cap`.*

One stateless check runs at the start of each turn. It looks at the
assistant message just before the latest user message, in the history as
sent, **before** the window trims it. *(Lead ruling, 2026-09-24, fix round
2 of § 10–12: "just before" means the most recent assistant message
before the latest user message that has at least one part other than
`data-gate-status`. An assistant message made only of `data-gate-status`
parts, such as § 11.6's reconciliation message, is skipped; otherwise it
hides a `cut_off`, `step_cap` or `too_large` from this check. Measured by
the tester: the `cut_off` note was lost.)* For each code below that appears on a
`data-error` part of that message, the coach appends that code's note to
the turn's system prompt:

- each code's note at most once;
- in the order below, after the gate-pending note when that applies.

**`cut_off`** (§ 9.3; it comes first, after the gate-pending note when both apply):

> Your previous reply in this chat was cut off at the output limit and
> could not be finished, so part of that work was never saved. Check the
> files for what is actually there. Tell the candidate plainly what was
> saved and what wasn't (never that nothing was attempted), then do what's
> missing in smaller pieces, one file per write, unless they asked for
> something else.

**`step_cap`** (the turn used `maxSteps` steps):

> Your previous turn in this chat stopped at its step limit before it
> finished. The actions it finished did run; nothing after the stop ran.
> Check the files for what was actually saved before redoing anything,
> tell the candidate plainly where it stopped, then carry on from there,
> unless they asked for something else. If the files don't show what that
> turn was working on, ask the candidate in one line.

**`too_large`** comes third; its note is in § 12.2 (amended 2026-09-24).

- **No stored flag (rule 12).** Data parts stay in the history: none is
  transient, and the real transport sends every message. They never reach
  the model themselves: `convertToModelMessages` drops data parts, so
  without a note the model cannot know a turn stopped.
- **Before the window, on purpose.** A long turn's tool results can pass
  `windowWords`, and the window then drops that whole turn, the candidate's
  request included.
  - *Measured 2026-09-24 (tester, issue #2 round 2):* a 25-step evaluate
    turn over four 1,200-word JDs was dropped whole. The next request held
    only the system prompt and "keep going".
  - That is why the `step_cap` note says to ask when the files don't show
    the task.
- A turn whose continuation succeeded wrote no `cut_off`, so the next turn
  gets no note.

### 9.5 The cap and its time bound (proxy)

`max_tokens` = min(client, **8,192**) (was 4,096). The ceiling comes from
§ 8's formula with `core.ts`'s constants (per model since § 13, which also
proposes Claude's prices at the dearest allowed host):

64,000 × $2/M + 8,192 × $10/M + one search ($0.007 per request, § 14)
= $0.128 + $0.08192 + $0.007 = **$0.21692, about $0.22** (was $0.18896;
$0.22992 until § 14 corrected the search term from 5 × $0.004).

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
    column and fail: the meter retries once, then logs the row as lost,
    so the call is never charged to the balance or the $5 daily ceiling.
  - Then reload PostgREST's schema cache (`NOTIFY pgrst, 'reload
    schema';` in the SQL editor) before the proxy deploy. Supabase's DDL
    trigger normally does this, but open Supabase issues report new
    columns missed (**UNVERIFIED** on this project; the reload is cheap).
  - The full order is **migration → reload → proxy → site**. Only the
    first three must go in that order: the site (the agent change) works
    with either proxy, and the old site works with the new proxy.
  - The teardown needs no new statement (the column goes with the table),
    but its header names both files. The SQL harness applies both files in
    order.
- **Parse:** in the meter's existing pass over the `data:` lines,
  `finish_reason` is the **last non-null** `choices[0].finish_reason`
  (OpenRouter's normalized value, not `native_finish_reason`).
  - Reading only the last line would miss it: the usage chunk that follows
    often has no `choices`.
  - A string of 1–32 characters is kept. Anything else is null: another
    type, or no finish reason.
  - At the meter's deadline, it records the last value seen before the
    deadline, or null if there was none. (Lead ruling 3, 2026-09-24: this
    tells more, and the deadline stop already has its own log line.)
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
  "length"`. The continuation replies with a normal call, then `stop`.
  Pass when:
  - exactly one request carries the § 9.2 note, word for word, as its last
    message; that request has the same system prompt as the first and
    differs from it;
  - total requests are 2 when the continuation replies with text only, and
    more when it calls tools (the SDK's normal loop);
  - the continuation's tool runs;
  - there is one message with one `start` and one `finish`, and `finish`
    is the last chunk;
  - the dangling part is `output-error` with the closing text;
  - there is no `cut_off`.

  Variants:
  - A text-only cut-off.
  - A cut-off step holding a **finished** and an unfinished `write_file`.
    Pass when:
    - neither runs, and the store is unchanged;
    - both UI parts end `output-error` with the closing text;
    - the note-carrying request holds one synthesized `error-text`
      result, for the finished call;
    - it is sent with no `MissingToolResultsError`.
  - A cut-off step whose only call finished, and one with three finished
    calls plus one cut off (the receipt's batch write). Pass when none
    runs and there is one synthesized result per finished call, in call
    order.
  - A tool call that ran in an earlier step, before the cut-off step.
    Pass when it keeps its real result: no closing chunk and no
    synthesized result.
- **(ii) Cut off twice.** The continuation's first reply also ends on
  `length`. Pass when:
  - there are exactly two requests;
  - there is one `cut_off`, with its fixed message and `retryable: true`;
  - `finish` comes after it.
- **(iii) Continuation blocked.** In each case, pass when there is no
  second request and there is one `cut_off`:
  - (a) spent plus projected passes the allowance;
  - (b) the cut-off step is step `maxSteps`, and no `step_cap` is written;
  - (c) a gate is pending, and it stays pending.

  Also: the fake gate sees no open, decide or expire from this path, and
  the cut-off step's cost is counted once, in both the turn and the chat.
- **(iv) The next turn.**
  - A `cut_off` part on the last assistant message: the system prompt ends
    with the § 9.4 `cut_off` note word for word.
  - No such part: no note.
  - The cut-off turn outside `windowWords`: the note is still there.
  - A declined gate: no model call.
- **(v) Cap and ceiling.**
  - Clamp: 8,192 stays; 8,193, absent and garbage all give 8,192.
  - `CEILING_USD` = 64,000 × 2e-6 + 8,192 × 1e-5 + 0.007 = 0.21692 (§ 14;
    was 5 × 0.004 = 0.22992).
  - Every 4,096 assertion is updated (`core.test.ts`, `handler.test.ts`,
    `tests/functions/*.test.ts`).
- **(vi) `finish_reason`.**
  - `"length"` on a content chunk, then a usage chunk with empty `choices`:
    `"length"`.
  - None, a number, `""`, or 33 characters: null.
  - A stream cut mid-line: the last whole value, or null.
  - A meter deadline: the last value seen before it, or null if none.
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
- **(x) The chat is never poisoned.** Take each outcome:
  - continued and succeeded;
  - `cut_off` from each of conditions 1–5;
  - a second cut-off;
  - aborted during the continuation.

  Add a new typed user message to the resulting UI messages and run the
  next turn. Pass when that turn's model request is sent, with no
  `MissingToolResultsError` and no `model_error`. Also pass a hand-built
  history with a tool part stuck in `input-available` (the shape before
  this fix): it must reach the model too.
- **(xi) The next turn after a step cap** (round 2), mirroring (iv):
  - A `step_cap` part on the last assistant message: the system prompt ends
    with the § 9.4 `step_cap` note word for word.
  - A `step_cap` part only on an older assistant message, or none: no
    note.
  - A capped turn long enough that the window drops it (for example 25
    steps over four 1,200-word JDs, then "keep going"): the turn's messages
    are gone from the request, and the note is still there.
  - A hand-built message carrying both codes: each note once, `cut_off`
    first.
  - A declined gate reply: no model call.
- **(xii) The step-cap copy** (round 2). `ErrorPart` renders a `step_cap`
  part with:
  - the message "This turn ran out of steps before finishing." word for
    word;
  - the next-step line "Say continue to carry on from what's already
    saved." word for word.

  Pass when no line mentions a gate or promises what the agent will do.

**UNVERIFIED** (the named test settles each one):

- that the production finish reason was `length`. This is inferred from
  the exact 4,096-token replies and the provider code; the new column
  confirms it next time;
- that a late `tool-input-error` updates the open part rather than adding
  a second one (vii);
- that OpenRouter accepts the synthesized error results followed by a
  user message, for this model (i);
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

## 10. Telling an open tab a newer version is live (amendment, 2026-09-24)

Owner-approved (2026-09-24). Candidate-facing copy: `design-web-ui.md` § 1.8.

**Receipt (live beta, 2026-09-24; numbers only).** The § 9 fix went live
at 11:57. A 14:00 run used a tab opened earlier: the new proxy capped the
reply at 8,192, but the old app made no continuation call and showed no
`cut_off`, and its bundled skills lacked the § 9.7 hint. It saved nothing
and cost about $0.81. The agent and skills run inside the tab (§ 1), so a
tab runs the code it loaded until it reloads.

**Prevents:** spending on code a deploy already replaced.

### 10.1 One build id, in two places

- `apps/web/vite.config.ts` computes one id per build, `<short git
  sha>-<UTC build time, YYYYMMDDTHHMMSSZ>` (`nogit-<time>` without git),
  so every build differs.
- That value goes into the bundle (Vite `define`) and into `version.json`
  at the site root, `{"id":"<id>"}`, emitted by a small plugin in the same
  config. One value feeds both.
- No header config: Vercel serves static files `max-age=0,
  must-revalidate` (live site, 2026-09-24) and caches them per deployment
  (Vercel CDN cache docs); the client fetches with `cache: "no-store"`.
- `deploy-prod.sh` gains a third refusal: no `version.json` in the static
  output, or its id in no file under `assets/` (else every tab stays
  silent).

### 10.2 Detection (`apps/web`, member chat screen only)

A check fetches `/version.json` (2 s timeout). **Newer** means status 200
and a non-empty string `id` that differs from the built-in one (differs,
not higher: a rollback counts). **Anything else is ignored silently**:
network error, timeout, non-200, bad JSON, no `id`. Nothing shows, nothing
is blocked; the dev server has no `version.json`, so it stays silent.
Once newer is known, checks stop.

**When:** on mount; when the tab becomes visible or the window gets focus;
every 5 minutes while visible; before every send.

### 10.3 No turn starts on replaced code

Every send (a gate `yes` included) checks first, with the composer
disabled as while a turn is submitted.

- **Newer:** the message is **not sent**: no model call, no spend. Its
  text goes back into the composer word for word, and the notice shows
  its "not sent" line.
- **Same id, or the check failed:** sent as today.

**Why block, not warn:** a warning still lets replaced code spend the
candidate's money, as in the receipt (rule 5). A reload takes seconds and
loses only unsent text and any turn not yet saved (§ 11; before § 11, the
whole chat on screen). A failed check never blocks. **Known limit:** tabs opened before the first
build with this check can't be reached.

### 10.4 Test plan

Written from this section and UI § 1.8, not the code.

- **(i) Build:** `dist/version.json` is `{"id": X}`, X has the § 10.1
  format and appears in a `dist/assets/*.js` file; two builds, two ids.
- **(ii) Deploy scans:** with a stub `npx` first on `PATH` (its `vercel
  build` copies a real `dist` to `.vercel/output/static`; its `vercel
  deploy` records the call), a clean build deploys; a home path or no
  `SKILL.md` is still refused; no `version.json`, or its id in no asset,
  is refused (exit 1, no deploy call).
- **(iii) Detection** (injected fetch): same id, no notice; different,
  notice; reject, timeout, 404, 500, bad JSON, no or empty `id`: no
  notice, and a send goes through.
- **(iv) When** (fake timers): fetches on mount, visible, focus, every 5
  minutes while visible; none while hidden or once newer is known.
- **(v) Pre-send:** newer: `sendMessages` is never called, no proxy
  request, the composer holds the text word for word, the "not sent" line
  shows. Same id, a failed fetch, or one over 2 s: sent once. A typed
  `yes` at a pending gate with a newer id: not sent, gate still pending.
- **(vi) UI:** § 1.8 copy word for word; hidden during a turn, shown
  after; Reload calls `location.reload()`; 375 px, target ≥ 44 px; the
  notice alone disables nothing.
- **(vii) Live, once, after this ships** (owner's call; blocked sends
  spend nothing): open the site, deploy again, focus the tab: the notice
  shows, and a send is not sent and adds no ledger row.

**UNVERIFIED:** Vite 8's bundler (Rolldown) emitting a plugin file as
Rollup does ((i) settles it); `vercel build` copying `version.json` to the
static root (the new refusal settles it on the first deploy).

---

## 11. Keeping the conversation (amendment, 2026-09-24)

Owner requirement (2026-09-24): the conversation survives reloads and
sign-ins. This replaces § 7's "a reload starts a new chat" and the
decision-log line "No saved chat". Candidate-facing copy: `design-web-ui.md`
§ 1.7–1.9.

**Resolved (owner, 2026-09-24, relayed by the lead; approved as written):**

1. No "start fresh" in this release (§ 11.1).
2. Past the size cap, the oldest turns are dropped with the on-screen line
   (§ 11.4, UI § 1.9); no archive.
3. Import skips `.ten/conversation.json` and starts a new conversation
   (§ 11.7).
4. No separate conversation viewer: the export covers rule 9 (§ 11.7).

**Prevents:** losing the conversation to a reload, a deploy notice or
another device; a second conversation (rule 12); a saved copy of a file
drifting from the file (rules 11, 12); a conversation the export or the
delete leaves out (rule 9).

### 11.1 One conversation per user

One continuing conversation, restored on load; no list, no "start fresh"
(owner, 2026-09-24: it would need an archive and a viewer). Why: rule 12 and
the cross-host contract's "one persistent canonical chat"
(`design-cross-host-active-context.md`). The window (§ 7) keeps a long
conversation's cost per turn flat. The key is the user, so the database
enforces one.

### 11.2 Storage: `ten_conversations`

A **new** migration, `supabase/migrations/20260924100000_ten_conversations.sql`
(3 s lock timeout; applied files are never edited).

| column | rule |
|---|---|
| `user_id` | uuid, primary key, `references auth.users on delete cascade` |
| `chat_id` | text ≤ 100; set when the row is created, never changed |
| `messages` | jsonb array; `octet_length(messages::text)` ≤ 1,048,576 |
| `older_dropped` | boolean, default false (§ 11.4) |
| `version` | sha256 prefix of `messages::text`, computed in SQL (as `ten_ws_write`) |
| `updated_at` | timestamptz, `now()` |

- RLS on. Members select their own row only (`user_id = auth.uid()` and
  `ten_is_member()`), like `ten_ws_files`. No insert, update or delete
  grant.
- Every write goes through `ten_conversation_save(chat_id, messages,
  older_dropped, expected)`: security definer, `auth.uid()`'s row only,
  members only (PT401/PT403). `expected` null inserts (`on conflict do
  nothing`); otherwise it updates `where version = expected and chat_id =
  chat_id`. No row changed is PT409 `version_conflict`; not an array is
  PT400 `invalid_ref`; over the cap is PT413 `conversation_too_large`. It
  returns the new version.
- **Why a table, not a workspace file:** no agent tool reaches it (a job
  post can't get its own history rewritten, the § 7 injection), and chat
  stays out of the records folder (PROCESS: files are records, chat is the
  interface).

### 11.3 What is saved

`conversationToSave(messages)`, a pure function in `packages/agent`:

1. **Kept word for word:** text parts (both sides), `step-start`, every
   `data-*` part (cards, gates, statuses, errors; § 9.4 and `statusOf` read
   them), `metadata`, and `file` parts whose `url` starts `workspace:` (a
   path, no bytes).
2. **Dropped:** `reasoning` parts and every other `file` part.
3. **Tool parts:** every string over 2,000 characters in `input`,
   `output` or `errorText` becomes **the stub** (shared with § 12), with N
   the removed length:

   > [Removed to save space: N characters. The workspace files hold what
   > was saved; read a file again if you need it.]

   The stub text, the 2,000-character threshold and the walker that
   replaces strings are **one shared implementation**, used by this
   section and § 12.1 (rule 12; tester finding 7, fix round 2).

   A tool part in any state but `output-available`/`output-error` is saved
   as `output-error`, `errorText` "Stopped before a result came back.
   Check the files for what was saved."

**Why the stub:** a long tool string is mostly a copy of a file at one
moment (`read_file`, `fetch_job`, a write's content). Restored days later
it disagrees with the file, and the model may believe it (rules 11, 12).
After a reload, the "ran …" line (UI § 3) shows the stub, which says what
was removed.

### 11.4 When, and how big

- **Once per ended turn,** in `useChat`'s `onFinish`, however it ended
  (`ai@7.0.111` passes the full `messages` and `isAbort`/`isDisconnect`/
  `isError`). One write of the whole array. **Known limit:** a tab closed
  mid-turn loses that turn from the conversation, not from the files.
- **Cap:** the client keeps the sanitized array ≤ 900,000 bytes (UTF-8 of
  `JSON.stringify`, leaving room for jsonb's own spacing under the 1 MB
  check), dropping the oldest whole turns and setting `older_dropped`
  (UI § 1.9's line shows). Outcomes are files, so none is lost. At ~5–20 KB
  a turn (**UNVERIFIED**; (iv) measures), that is 45–180 turns.
- **A failed save** shows UI § 1.9's line; the next save carries the whole
  array.

### 11.5 Two tabs or devices

- Each tab remembers the version it loaded or last saved. **Before every
  send**, beside § 10.3's check and under its rules (2 s; a failed check
  never blocks), it reads the row's `version`. If it differs: not sent,
  no model call, text back in the composer, UI § 1.9's "not sent" line.
- The save's compare-and-swap is the backstop. On `version_conflict` the
  tab never overwrites or merges (no tab saw a merged history); it shows
  UI § 1.9's line, and the check blocks its later sends.

### 11.6 Load, chat id, gates

- **Setup** (before the chat mounts, like the membership check) reads the
  row. None: a new `chat-<uuid>`, and the first save creates the row.
  Found: its `chat_id`, and its messages checked with `validateUIMessages`
  (exported by `ai@7.0.111`), then `useChat({ id, messages })`. A failed
  read or check goes to the setup error screen (UI § 1.9). Never mount
  empty over a saved conversation.
- **A pending gate survives.** The chat id is stable, so
  `gate.pending(chatId)` finds it and the first turn's
  `expireOtherChats(chatId)` spares it (§ 3); a typed exact `yes` approves
  it as before.
- **The row owns gate status** (§ 3, rule 12), and a turn can run without
  being saved (a closed tab). So before mounting, for each gate whose
  latest restored status is `pending`, the app reads its own
  `ten_gate_log` row and appends the row's status as a `data-gate-status`
  part. *(Lead ruling, 2026-09-24, fix round 2:)* these parts go in one
  data-only assistant message, placed last, whose id is unique per load,
  `gate-reconcile-${chatId}-${uuid}` (a fixed id repeated across loads).
  § 9.4's check skips such a message. A pending gate whose card is not in the restored messages (the cap
  dropped it) is expired first: no yes without the complete thing on
  screen (rule 7).
- The coach's per-chat memory starts empty after a load; each part
  already falls back safely (`read_first`, the `not-run` badge, the dated
  cost constant). The model gets the window of the restored history, and
  § 9.4 reads its `data-error` parts.

### 11.7 Export, delete, logs

- **Export** adds `.ten/conversation.json` (the saved array) when a row
  exists; local `check_files` skips dot entries and no skill reads it.
  **Import** skips `.ten/` entries instead of refusing; an import starts a
  new conversation. With no row the export is unchanged (step 2's round
  trip holds).
- **Delete:** `ten-delete-account` deletes the caller's row (§ 8); UI § 1.7
  names "your conversation". The `auth.users` cascade covers an old-app
  account delete.
- **Logs** never hold conversation content: save and load failures log
  `{ event, code, bytes }` only, and no logger or console call gets a
  message, a part, or an `APICallError` (its `requestBodyValues` is the
  whole request). Postgres logs RPC parameters on error only if
  `log_parameter_max_length_on_error` is set (default 0; **UNVERIFIED** on
  this project), the same exposure `ten_ws_write` has today.

### 11.8 Deploy order

The owner applies: migration → `NOTIFY pgrst, 'reload schema';` →
`ten-delete-account` → site (the delete must cover conversations before
any site writes one, rule 9). The teardown drops
`ten_conversation_save(text, jsonb, boolean, text)` and
`ten_conversations` before the functions their policy calls; its header
names all three files; the SQL harness applies them in order. **UI § 1.8's
new copy ships in the same site release as the save**, never apart.

### 11.9 Test plan

Written from this section; fixture personas and fresh workspaces only.

- **(i) RLS**, members A and B: B reads nothing of A's and B's save never
  changes A's row; anon and a non-member read nothing, save PT401/PT403;
  `authenticated` can't insert, update or delete directly.
- **(ii) Save:** null `expected` twice, or a stale one: PT409; a non-array
  PT400; 1 MB + 1 byte PT413; `version` = SQL's sha256 prefix.
- **(iii) Sanitize table:** a 10,000-character output → the stub, N = 10000;
  2,000 stays; text and `data-*` identical; `reasoning` and a `data:` file
  part dropped; `input-available` → the fixed `output-error`.
- **(iv) Restore** (browser e2e): two turns, reload: same sanitized
  messages and chat id, avatar `done`, next request = the window of them.
  Record bytes per turn.
- **(v)** A `step_cap` or `cut_off` turn, reload: the next turn has its note.
- **(vi) Pending gate:** reload: card and `needs-you`; typed `yes`
  approves (allowance = amount), `ui` yes doesn't. Row approved, saved
  status pending: shows approved. Card dropped by the cap: row expired.
- **(vi-b) Reconciliation × § 9.4** (fix round 2): a restored history
  whose last real assistant message carries `cut_off` (then `step_cap`,
  then `too_large`), followed by a reconciliation message: the next turn
  has that code's note. Two loads produce two different reconciliation
  ids, and no id repeats in the messages.
- **(vii) Cap:** over 900,000 bytes drops oldest turns only, sets
  `older_dropped`, shows the line.
- **(viii) Two tabs:** a stale tab's send: not sent, no proxy request,
  text kept. Simultaneous saves: one wins, the other shows its line. A
  failed check sends.
- **(ix)** Delete (twice) leaves no row; teardown leaves no `ten_` object.
- **(x) Export/import:** `.ten/conversation.json` parses; importing it
  succeeds without it; the fixture round trip is byte-identical.
- **(xi) Logs:** a sentinel string in a message reaches no logger or
  console call (failed save, failed load, 413, turn error).
- **(xii) Copy:** UI § 1.8–1.9 word for word, by saved state.

---

## 12. A turn that grows too large (amendment, 2026-09-24)

**Receipt (live beta, 2026-09-24; numbers only).** An evaluate over three
roles. **Worked (positive receipt for § 9):** every verdict was saved; the
continuation fired once after an 8,192-token cut-off, and the model then
wrote one file per reply, as § 9.2's note asks. **Failed:** after the turn
reached ~69,800 input tokens, the proxy refused the final request, 413
"Request too large." (over 256 KB, § 8). The candidate saw a generic
`model_error` (`packages/agent/src/coach.ts:240-243`) plus "This can be
retried." (`apps/web/src/components/ErrorPart.tsx:56`), with nothing about
what was saved. The window (§ 7) trims only earlier turns, so one turn
grows without bound (~10,000-character reads, web results, big writes),
here past the 64k input tokens § 8's ceiling assumes.

**Prevents:** a turn refused for size after its steps were paid for; a
request past the ceiling's 64k-token assumption; an error that promises a
retry that can't help.

### 12.1 Trimming inside the turn (`packages/agent`)

The proxy's 256 KB cap and the cost ceiling stay. Every `streamText` call
(the first and § 9.2's continuation) gets a `prepareStep`. In
`ai@7.0.111` it receives the step's `messages`, and a returned `messages`
carries forward to later steps (read in the installed `index.d.ts`).

- **Measure:** UTF-8 bytes of `JSON.stringify(messages)`. System prompt
  and tools are fixed all turn (~30 KB), so this tracks the proxy's check.
- **Budget:** over **160,000** bytes, trim down to **120,000**. With the
  fixed ~30 KB and the provider's escaping, that stays well under 256 KB;
  at 3–4 bytes per token it is ~48–63k tokens, inside the 64k.
- **Why down to 120,000:** a change voids the prompt cache from that
  point on, so trimming lower makes trims rare, not every step.
- **What:** this turn's steps (its calls' response messages: an
  assistant message plus its tool message), oldest first, except the
  **last 2**, which the next step most likely needs. In a step, every
  string over 2,000 characters in a tool call's input or a tool result's
  output becomes § 11.3's stub. One step at a time, re-measuring after
  each.
- **Never touched:** the system prompt (byte-identical, § 9.2), every
  user-role message (the candidate's, § 9.2's note), text the model wrote,
  earlier turns (the window bounds them), the last 2 steps. If those alone
  are over budget, the request goes as it is, and § 12.2 handles a refusal.
- **Not taken:** the SDK's `pruneMessages` removes whole tool calls, so the
  model loses the trace of what ran (rule 11). A larger proxy cap moves the
  cost ceiling (rule 5).

### 12.2 A refusal: `too_large`

A new `data-error` code, `too_large`, for a proxy 413 (the status, or the
body's `too_large` code) in either call. It is its own code because the
remedy differs from `model_error`: the same request fails again, but a new
turn starts small (the window drops the long turn).

- Message, fixed: "This turn got too big to send, so it stopped partway."
  `retryable: true`. UI § 2.7 adds the `nextStep` line.
- No gate is touched; no continuation runs (§ 9.2 condition 5); `finish`
  comes last.
- § 9.4 gains a third note, after `step_cap`, word for word:

  > Your previous turn in this chat stopped because its request grew too
  > large to send. The actions it finished did run; nothing after the stop
  > ran. Check the files for what was actually saved before redoing
  > anything, tell the candidate plainly where it stopped, then carry on
  > in smaller pieces, reading only what the next step needs, unless they
  > asked for something else. If the files don't show what that turn was
  > working on, ask the candidate in one line.

- `apps/web/src/types.ts` adds the code; `ErrorPart` adds its line.

### 12.3 Test plan

- **(i) Trim:** a stubbed model, 22 steps each reading a 10,000-character
  file (12 peak at ~131 KB, under the trigger, so they never trim; with 22
  the first trim comes at request 16; fix round 2). Trimming must happen
  at least once. Every request's messages ≤ 160,000 bytes; stubs land oldest step
  first; the last 2 steps, user messages and model text are byte-identical;
  the system prompt is identical on every request; the stub word for word.
- **(ii)** Under budget: no override. **(iii)** Between two trims, each
  request's messages begin with the previous request's.
- **(iv) Continuation:** a cut-off after a trim; call 2 also stays ≤ 160,000
  and carries the note.
- **(v) Refusal:** a stubbed fetch answers 413 with the proxy's body at
  step 4: one `too_large`, fixed message, no `model_error`, no further
  request, `finish` last, steps 1–3's files saved.
- **(vi) Next turn:** the note word for word; order `cut_off`, `step_cap`,
  `too_large`; still there when the window drops the long turn.
- **(vii) UI:** the message and `nextStep` word for word.
- **(viii) Live, once** (the owner approves the spend): the receipt's
  three-role evaluate with a fixture persona. No 413; every ledger
  `tokens_in` ≤ 64,000.

**UNVERIFIED:** that the provider accepts a tool call whose input was
shortened ((i) through the real `@openrouter/ai-sdk-provider`, then
(viii)); the cache prices behind "down to 120,000" ((viii)'s
`tokens_cached`).

---

## 13. The site's model is a setting (amendment, 2026-09-24)

**Approved by the owner (2026-09-24)**, with the four answers in § 13.6.
Owner request (2026-09-24): "change the LLM to deepseek to save testing
cost". Where this section and an earlier one disagree,
this one wins; § 8 and § 9.5 point here. It ships after § 10–12.

**What changes.** The proxy allows exactly two models. One build setting
on Vercel picks which one the site uses. Switching back to Claude is a
setting change and a redeploy, never a code change.

| model id (exact, no suffix) | name shown | role |
|---|---|---|
| `anthropic/claude-sonnet-5` | Claude Sonnet 5 | the measured model; the fallback |
| `deepseek/deepseek-v4.1-flash` | DeepSeek V4.1 Flash | testing plumbing and cost |

**Prevents:** paying Claude prices to test plumbing; a missing or mistyped
setting silently changing which model coaches (and what it costs); a
per-call ceiling or cost estimate priced for the wrong model; a cost record
that doesn't say which model ran; a tool request sent to a host that
ignores tools.

**Prices (read 2026-09-24 from OpenRouter's public API: `GET
/api/v1/models`, `/api/v1/models/{id}/endpoints`, `/api/v1/endpoints/zdr`).**
The provider filter (`zdr: true`, `data_collection: "deny"`) means only
the no-data-kept hosts can serve a call, so those hosts' prices are the
ones that matter, not the model's headline price.

- **Claude Sonnet 5:** 6 no-data-kept hosts (Bedrock and Vertex, global
  and regional). Global: $2.00 in, $10.00 out, $2.50 per 1M for a cache
  write. Regional: $2.20 in, $11.00 out, $2.75 cache write. Every host
  supports tools; max output 128,000.
- **DeepSeek V4.1 Flash:** 22 no-data-kept hosts. 21 list tool support
  (DekaLLM does not). Input $0.04 to $0.375, output $0.30 to $1.50 (Venice
  is the dearest). None lists a cache-write price. The smallest max output
  among tool hosts is 32,768 (BaseTen), so 8,192 fits every host. DeepSeek's
  own API ($0.15 in, $0.60 out, with weekday price doubling at some hours)
  is **not** a no-data-kept host, so the filter never uses it. Candidate
  data never goes to DeepSeek's own API.

### 13.1 Proxy (`ten-model-proxy`)

One table in `core.ts`, keyed by model id, replaces `MODEL` and the
ceiling constants. Everything else in § 8 is unchanged.

- **Allowlist.** The request's `model` must be exactly one of the two ids.
  Anything else, including a missing `model`, a suffix (`:online`,
  `:free`, `:nitro`), another case, or `deepseek/deepseek-v4-pro`, gets
  400 `model_not_allowed`, "This model is not allowed.", with no upstream
  call and no ledger row. The proxy no longer fills in a model: the site
  always names it (§ 13.2).
- **Claude's request is unchanged.** For `anthropic/claude-sonnet-5`, the
  outgoing body is byte-identical to today's, `cache_control` included.
- **DeepSeek's request differs in two fields only:**
  - no `cache_control`. OpenRouter's docs (prompt caching page, read
    2026-09-24) list top-level `cache_control` for Anthropic, Vertex,
    Azure and Bedrock only, and say DeepSeek caching is automatic with no
    configuration.
  - `provider: { data_collection: "deny", zdr: true, require_parameters:
    true }`. OpenRouter routes a request with `tools` to tool hosts only
    as "best effort" (provider routing docs, 2026-09-24), and picks hosts
    weighted toward the cheapest. The cheapest no-data-kept host
    (DekaLLM, $0.04 in) lists no tool support, so without this a turn
    could silently run with no tools. `require_parameters` makes every
    host used support everything the request sends. Claude does not get it,
    because every Claude host supports tools and its body stays as it is.
- **`max_tokens`** = min(client, 8,192) for both. The time bound of § 9.5
  applies to both.
- **Web plugin** unchanged for both (`exa`, at most 5 results).
- **Per-call ceiling**, per model, by § 8's formula: 64,000 input tokens ×
  the highest input price + 8,192 × the highest output price + one search
  ($0.007 per request, § 14). "Highest" means the dearest no-data-kept, tool-capable
  host above, and for Claude the cache-write price, because the proxy
  forces caching and the first call of a turn writes the cache at that
  price.

  | model | input $/M | output $/M | ceiling |
  |---|---|---|---|
  | Claude Sonnet 5 | 2.75 (regional cache write) | 11.00 | 0.176 + 0.090112 + 0.007 = **$0.273112, about $0.27** |
  | DeepSeek V4.1 Flash | 0.375 | 1.50 | 0.024 + 0.012288 + 0.007 = **$0.043288, about $0.04** |

  **This raises Claude's ceiling** from § 9.5's $0.21692, which used the
  global $2/$10 and no cache write. A regional host plus a cache write can
  cost up to $0.273 per call today, so § 8's "each ≤ the ceiling" was not
  true. **Approved** (owner, 2026-09-24; § 13.6 (1)): Claude's ceiling is
  $0.273112, so § 8's bound holds again.
- **Ceiling uses:** the meter's fallback charge (missing cost, deadline)
  and the 10× sanity bound both use the **request's** model's ceiling.
  A DeepSeek cost above $0.43288 is recorded as that model's ceiling.
  Prices drift. The table is dated, and a cost above the ceiling is
  still recorded as reported, up to 10×, so drift never undercounts.
- **The $5/day beta ceiling** is unchanged. It sums all models.
- **Ledger `model`** records the id the proxy sent: the validated request
  id, not the stream's `model` string. The upstream may add a dated suffix
  (the listing names `deepseek/deepseek-v4.1-flash-20260910`). No
  `models` fallback list is ever forwarded (§ 8), so the id sent is the
  model that ran. No migration: the column exists (`20260923000000`).
- **Not taken:** `provider.max_price` to enforce the ceiling prices (one
  more forced field, and a price rise would fail calls instead of costing
  a little more); a host column in the ledger (a migration; OpenRouter's
  `GET /api/v1/generation?id=` names the host per request id when needed).

### 13.2 Site (`apps/web`)

- **Setting:** `VITE_COACH_MODEL`, a Vercel Production environment
  variable, read at build time like `VITE_SUPABASE_URL` (the same `vercel
  pull` path in `deploy-prod.sh`).
  - unset or blank → `anthropic/claude-sonnet-5`. A missing setting never
    changes the model: Claude is the one the skills were measured on.
  - exactly one of the two ids (trimmed) → that id.
  - anything else → `readEnv` fails the same way a missing required variable
    does. The existing config screen names `VITE_COACH_MODEL`, and no model
    call is made. A typo never falls back silently, because the owner
    would think DeepSeek was running.
- **One list, one reader.** A new `apps/web/src/backend/coach-model.ts`,
  with no imports, holds the two ids and their names from the table
  above. `readEnv` returns `coachModel`. `real/deps.ts` passes it to
  `createCoachModel` (it replaces `COACH_MODEL_ID`) and to
  `createWebSearch`, whose request now carries `model`. `check_language`
  uses `deps.model`, so it follows by itself.
- **The client stops setting `cache_control`** (`backend/model.ts`). The
  proxy drops the client's copy and sets its own, so the client's copy was
  a second place for one fact (rule 12), and wrong for DeepSeek.
- **`packages/agent` gets no new field.** The active id is `deps.model`'s
  id: the string itself, or `.modelId` (`@openrouter/ai-sdk-provider`
  3.1.0 declares `readonly modelId`; `ai` 7.0.111's `LanguageModel` may be
  a string).
- **Proxy and site must agree.** The proxy's table is the gate, and the
  site's list is the choice. A repo test fails if their ids differ.

**Switching.** Set or remove `VITE_COACH_MODEL` on Vercel (Production),
then run `deploy-prod.sh`. § 10's notice stops open tabs from sending on
the old build, so the next send uses the new model.

**Deploy order (first time):** site → proxy → setting. The new site sends
`model` on every call, including web search, which the old proxy accepts
for Claude. The new proxy refuses a missing `model`, which only the old
site's web search omits, and § 10 blocks sends from old tabs.

### 13.3 Honesty

- **Estimates use the active model.** Only the constants used before a chat
  has measured steps depend on the model. They become one per-model table in
  `estimate-cost.ts`, used by all three places that read them today:
  `computeCostEstimate` (turn 1), `projectedNextStepUsd` and the fallback
  in `recordStepCost`.
  - Claude: median $0.0019, highest $0.0025 per step (measured
    2026-09-23, unchanged).
  - DeepSeek: median $0.0004, highest $0.0005. These are **derived, not
    measured**: Claude's values × 0.1875 (the larger of 0.375/2.00 and
    1.50/10.00), rounded up. `method` says "derived from listed prices
    (2026-09-24), not measured".
  - An unknown id (a stub or test model) uses Claude's values, the higher
    ones, which err toward opening a gate (rule 5).
  - Once a chat has measured steps, those are used whatever the model.
  - After the first DeepSeek day, the median and highest per-call `usd`
    from the ledger replace the derived values, with the date.
  - Web search (§ 14): the $0.007 fee doesn't depend on the model; the
    search call's own tokens do. Claude: median $0.035, highest $0.047
    per search (measured 2026-09-24). DeepSeek: Claude's token part
    (each value − $0.007) × 0.1875 + $0.007, rounded up: median $0.013,
    highest $0.015, **derived, not measured**.
    The `check_language` fallback ($0.0175) is used only when a call reports
    no cost, and on DeepSeek it overstates the cost, the safe direction.
- **The candidate is never told a wrong model.** Code shows the model:
  the `⋯` menu (UI § 1.1) gets a last line that is text, not a button. In
  real mode only, word for word:
  - `Model: Claude Sonnet 5`
  - `Model: DeepSeek V4.1 Flash (testing)`

  It is built from `coachModel`, so it cannot disagree with what is sent.
  Nothing is added to the system prompt. If asked, the model may name
  itself wrongly (the skills mention Claude and `CLAUDE.md`), and the
  menu line is the source of truth. `design-web-ui.md` § 1.1 gets a
  pointer here when this ships (not now, because the v2 UI branch edits it).

### 13.4 Quality caveat (travels with every DeepSeek result, rule 17)

The skills were measured on Claude: the conduct harnesses, B1's
simplification bar ("no pass-rate drop on the default model"), and every
live dogfood receipt. DeepSeek is for testing plumbing and cost. A DeepSeek
run is evidence about the pipes, never about coaching quality, and no B1
deletion may be justified by a DeepSeek run. The plan's B2 still holds: a
model offered to beta members must pass the conduct subset first, or it
is dropped (§ 13.6 (2)).

What to watch in DeepSeek runs (ledger and chat, numbers only):

- **Tool calls over long runs:** malformed arguments, tool calls written
  as prose, a turn ending with no tool call where Claude made one, and
  loops that hit the step cap (`step_cap`).
- **The spend gate:** gate text word for word
  (`skills/coach/references/gate-grammar.md`). A gate must never be
  treated as approved without a typed yes.
- **Word-for-word rules:** fixed lines quoted exactly (§ 9.7's hint,
  checker output, the plan card), claims never stated stronger than the
  facts (rule 8).
- **Reasoning:** the model supports reasoning, and the proxy drops the
  client's `reasoning` field, so the default applies (**UNVERIFIED**
  whether it reasons by default). OpenRouter bills reasoning as output,
  and on most hosts it counts against `max_tokens`. So watch the rate of
  `finish_reason = length` and `tokens_out` by model. Also watch for host
  errors after tool calls: OpenRouter asks for reasoning blocks to be passed
  back unchanged, and § 11's saved conversation and § 12's trim were
  tested only on Claude.
- **Size:** § 12's byte budget assumed Claude's tokenizer. Check that
  DeepSeek's `tokens_in` stays ≤ 64,000.

### 13.5 Test plan

- **(i) Allowlist:** each id → 200, and the outgoing `model` equals it.
  Missing, `null`, a number, `anthropic/claude-sonnet-5:online`,
  `deepseek/deepseek-v4.1-flash:free`, `DeepSeek/deepseek-v4.1-flash`,
  and `deepseek/deepseek-v4-pro` → 400 `model_not_allowed`, no upstream
  fetch, no ledger row.
- **(ii) Claude body unchanged:** a golden body captured from today's
  proxy for a fixed input equals the new proxy's body byte for byte.
- **(iii) DeepSeek body:** no `cache_control`; `provider` exactly
  `{ data_collection: "deny", zdr: true, require_parameters: true }`;
  `max_tokens` 8,192 for a client 20,000 and 100 for 100; `stream: true`;
  the web plugin rewrite is the same as Claude's.
- **(iv) Ceiling per model:** the table's values are 0.273112 and
  0.043288 (1e-9). A DeepSeek call with no
  `usage.cost` and one that passes the deadline both record $0.043288; a
  Claude call records Claude's ceiling. A DeepSeek cost of $0.60 is
  recorded as $0.043288; the same $0.60 on Claude is recorded as $0.60
  with the anomaly log.
- **(v) Ledger model:** the row's `model` is the request's id, even when
  the stream's `model` is `deepseek/deepseek-v4.1-flash-20260910`.
- **(vi) Daily ceiling:** $4.99 of Claude rows plus $0.02 of DeepSeek
  rows → 503, the same message.
- **(vii) Setting:** `readEnv` with the setting unset, `""` or `"  "` gives
  Claude; each id (with spaces around it) gives that id;
  `deepseek/deepseek-v4.1-flsh` and `anthropic/claude-sonnet-5:online`
  give the config error naming `VITE_COACH_MODEL`. With DeepSeek set, the
  chat request and the web-search request both carry the DeepSeek id, and
  neither body has `cache_control`.
- **(viii) Estimates:** with no measured steps, DeepSeek's turn-1 estimate
  uses 0.0004/0.0005, Claude's uses 0.0019/0.0025, and a stub model id
  uses Claude's. `projectedNextStepUsd` and the `recordStepCost` fallback
  use the same per-model values. With measured steps, both models use the
  measured ones.
- **(ix) Menu line:** word for word for each model, last in the `⋯`
  menu, not focusable as an action; absent in mock mode.
- **(x) Agreement:** a test fails if the proxy table's ids and
  `coach-model.ts`'s ids differ.
- **(xi) Live, once per model** (the owner approves the spend, a fixture
  persona, a fresh workspace): one turn that writes a file with a tool,
  and one web search.
  - Each ledger row names its model.
  - DeepSeek: the file is really in the workspace (rule 11). Record
    `tokens_cached` on turn 2, which settles whether its hosts cache, and
    the host per call from `GET /api/v1/generation?id=`.
  - Claude: turn 2 still shows a cache read.

**UNVERIFIED:** whether no-data-kept DeepSeek hosts cache at all (they
list cache-read prices, but the ZDR listing says `supports_implicit_caching:
false`; (xi) settles it, and the ceiling assumes no caching either way);
DeepSeek's default reasoning and its throughput against § 9.5's 30 tokens/s
worst case (the meter's deadline fallback covers a slow host); whether
`require_parameters` interacts with the web plugin ((xi)); that § 12's
160,000-byte budget stays under 64k DeepSeek tokens ((xi)'s `tokens_in`).

### 13.6 Resolved (owner, 2026-09-24)

The owner approved § 13 as written, with these four answers.

1. **Claude's ceiling is raised** to the dearest allowed host, including the
   cache-write price: **$0.273112**, using § 14's search term. The approval
   quoted $0.286112, the figure § 13 showed before § 14 changed the search
   term from $0.02 to $0.007. The approved basis is the same. § 8's "each
   call ≤ the ceiling" holds again.
2. **DeepSeek runs only while the owner and testers who know about it are
   the active users.** Before any outside beta member is invited, the
   site goes back to Claude (remove `VITE_COACH_MODEL`, run
   `deploy-prod.sh`). Plan step B2 stands: a model offered to outside
   members passes the conduct subset first.
3. **The privacy terms name the processors**, as described below.
4. **The menu label keeps "(testing)"**, word for word as in § 13.3.

**Where the processor list lives.** The product has no privacy terms yet.
This starts them, and they **ship with § 13**, in the same site deploy.

- **One page:** `apps/web/public/privacy.html`, served at `/privacy.html`.
  It is the only copy candidates see. The `⋯` menu gets a `Privacy` link
  to it, just above the model line, in real and mock mode.
- **What it says**, in plain words:
  - what the model's host receives: the turn's messages, the files the
    coach reads, and tool results;
  - that every call goes through OpenRouter, routed only to hosts that
    keep no data and don't collect it for training;
  - that web searches go to Exa through OpenRouter;
  - the hosts for each model, as read from `GET /api/v1/endpoints/zdr`
    on 2026-09-24, with that date:
    - **Claude Sonnet 5:** Amazon Bedrock, Google Vertex AI.
    - **DeepSeek V4.1 Flash:** BaseTen, CoreWeave, DeepInfra, DekaLLM
      (web-search calls only: it lists no tool support, so § 13.1's
      `require_parameters` keeps tool calls off it), DigitalOcean,
      Fireworks, Krea, Makora, Modal, Morph, NextBit, Novita,
      OpenInference, Parasail, Phala, Relace, Sail Research, SiliconFlow,
      Together, Venice, Wafer.
  - that OpenRouter picks among the hosts that keep no data at the time of
    each call, so the list can change, and that DeepSeek's own API is
    never used.
- **One place per fact** (rule 12): this section holds the list to copy,
  and the page is the only candidate-facing copy. The menu line (§ 13.3)
  says which model runs, and the page says who can process it.
- **Refresh:** read the list again, with the new date, whenever a model
  is added to § 13's table or the site switches models.

Test (xii), added to § 13.5: the build output has `/privacy.html`. It
names OpenRouter, Exa, every host above and the date, and the `⋯` menu
links to it in both modes.

---

## 14. Web search is billed per request (amendment, 2026-09-24)

Owner request (2026-09-24): make the cost estimate match what a web search
actually bills, and keep the proxy's ceiling consistent with it. Found by
the architect while drafting § 13. Where this section and an earlier one
disagree, this one wins; § 4, § 8, § 9.5 and § 13 point here.

**The finding.** Two constants priced the same search two ways, and
neither was right:

- `estimate-cost.ts` charged $0.004 per search.
- `core.ts`'s ceiling charged $0.004 per result × 5 results = $0.02 per
  search.

**What a search bills (two sources, and they agree).**

- **OpenRouter's web-search docs** ("Exa Search Pricing", read
  2026-09-24): Exa's default mode, Auto, costs **$0.007 per request,
  including up to 10 results**, then $0.001 per extra result, plus the
  model's own tokens for the results it reads. The proxy never sets a
  mode, so Auto applies, and it caps results at 5, so there are never
  extra results. The Exa price applies only because the proxy forces
  `engine: "exa"`: with no engine, Anthropic models use their native
  search, priced differently (same docs).
- **The ledger** (`ten_usage_ledger`, all 189 Claude `call` rows, read
  only, 2026-09-24): each row's `usd` minus its tokens at $2.50/M
  uncached input (the cache-write price), $0.20/M cached input and $10/M
  output leaves either $0.0000 (165 agent steps) or exactly **$0.0070**
  (24 search calls), whatever the result count. The fee is inside
  `usage.cost`, so the meter already records it. This settles spike 4's
  "does `usage.cost` include the plugin price" bullet: it does.

So search is billed **per request**: $0.007.

**A second finding: the fee is the small part.** A `web_search` is a
whole proxy call. The model reads the results (median 3,641 tokens in)
and writes an answer that the tool throws away (median 1,811 tokens out,
up to 3,038). Over the 24 calls, one search cost a median **$0.0347**,
lowest $0.0254, highest **$0.0468**. The $0.007 fee is about a fifth of
that, so pricing the estimate at the fee alone would still undercount
about five times.

### 14.1 The estimate (`packages/agent/src/estimate-cost.ts`)

- One search is priced at what a search call bills, measured and dated
  like the step constants: median **$0.035**, highest **$0.047** (the 24
  calls above, rounded up).
- `lowUsd` = `steps` × the step median + `webSearches` × $0.035;
  `highUsd` = `steps` × the step highest + `webSearches` × $0.047.
  Before, both used $0.004.
- The search constants apply with or without the chat's measured steps: a
  step's measured cost never includes a search, which the tool makes as a
  separate call.
- **The spend fallback**, when a search call reports no `usage.cost` (the
  `web_search` tool, and `createWebSearch`'s `defaultUsd` from the real
  deps), is the highest, $0.047, so a missing cost never undercounts.
- These are Claude's numbers. Under § 13, the search call runs on the
  active model: its token part scales like the step constants, and the
  $0.007 fee does not (§ 13.3).
- When more search calls are in the ledger, the median and highest are
  read again and replace these, with the date.

### 14.2 The ceiling (`supabase/functions/ten-model-proxy/core.ts`)

- The search term is one request, $0.007, not 5 × $0.004: 64,000 × $2/M
  + 8,192 × $10/M + $0.007 = $0.128 + $0.08192 + $0.007 = **$0.21692,
  about $0.22** (§ 9.5 had $0.22992).
- The ceiling drops by $0.013. It is still the meter's fallback charge
  and the 10× bound. § 13's separate finding (a cache write on a regional
  host puts Claude's real worst case above this ceiling) was approved
  by the owner (§ 13.6 (1)). Once § 13 is built, with this search term,
  the ceiling is $0.273112 for Claude and $0.043288 for DeepSeek.
- `MAX_WEB_RESULTS` stays 5. Past 10 results, each extra one costs $0.001
  and the search term becomes $0.007 + (n − 10) × $0.001. A comment at
  the constant says so.

### 14.3 Not taken

- **Pricing a search at the fee alone ($0.007):** it would still
  undercount about five times (above).
- **Reading the price from `GET /api/v1/models`** (§ 4's first plan): the
  plugin fee is not in that list, and the token part depends on how much
  the model writes.
- **Cutting the search call's cost**, for example a small `max_tokens` on
  the search request, since the tool keeps only the annotations. This
  could save most of the ~$0.028 token part, but it changes the call and
  needs a live check that annotations still arrive. It is its own change,
  not this one.

### 14.4 Test plan

- **(i) Estimate, no measured steps:** `{ steps: 0, webSearches: 1 }` →
  low 0.035, high 0.047; `{ steps: 2, webSearches: 3 }` → low
  2 × 0.0019 + 3 × 0.035 = 0.1088, high 2 × 0.0025 + 3 × 0.047 = 0.146.
- **(ii) Estimate, measured steps:** the search part is the same
  (`webSearches` × 0.035 / × 0.047).
- **(iii) Spend fallback:** a `web_search` seam that returns no `usd` adds
  0.047 to the turn's spend; one that returns `usd` adds exactly that.
- **(iv) Seam:** `createWebSearch` returns `defaultUsd` when the stream
  has no `usage.cost`, and the real deps pass 0.047.
- **(v) Ceiling:** `CEILING_USD` = 64,000 × 2e-6 + 8,192 × 1e-5 + 0.007 =
  0.21692 (1e-9); a meter with no readable cost records 0.21692. Every
  0.22992 assertion is updated (`core.test.ts`, `handler.test.ts`,
  `tests/functions/*.test.ts`). These are the single-model values; once
  § 13 is built, § 13.5 (iv)'s per-model ceilings replace them.
- **(vi) No stale price:** no `0.004` search price and no
  `CEILING_SEARCH_USD_PER_RESULT` remain in `packages/`, `apps/web/src/`
  or `supabase/functions/`.

---

## 15. Production is owner-only (amendment, 2026-09-25)

Owner decision (2026-09-25). Every production step is run by the
**owner**: a migration or teardown, an Edge Function deploy or secret, a
site deploy, a Vercel or Auth setting, a credit row. Agents prepare the
exact commands and the checks to run after them; they never run them and
never hold secrets. This restates the rule the earlier sections already
give ("the owner applies …, never an agent").

**A closed exception, recorded (rule 11).** During the 2026-09-23 to
2026-09-25 beta setup, the lead agent ran several production steps:
migrations, function deploys, secrets read from the owner's env file, a
credit row, site deploys, and a Vercel setting. Each ran on the owner's
explicit approval for that action. That exception is now closed.

**Prevents:** a secret or a production write reaching an agent session;
records that say one thing while production was changed another way.
**Proved by:** a review, not a test: each production change in an issue
or commit names the owner as the one who ran it.

---

## 16. Setting and resetting a password (amendment, 2026-09-25)

Owner-reported gap (2026-09-25); **draft for owner approval.** Screens and
exact copy: `design-web-ui.md` § 1.10. No new table, Edge Function, secret
or server code: every call goes from the browser to Supabase Auth.

**Prevents:** an email-link account with no way to get a password; a
forgotten password with no way back; the reset form telling a stranger
whether an email has an account; a password reaching anything but
Supabase Auth; a recovery link that opens the chat without asking for the
new password.

### 16.1 The calls

Read in the installed package (`supabase-js` 2.58.0, `auth-js` 2.72.0,
`apps/web/node_modules/@supabase/auth-js/src/GoTrueClient.ts`).

- **`auth.ts` gains** three methods the real client already has, added to
  `AuthClientLike`: `resetPasswordForEmail(email, { redirectTo })`,
  `updateUser({ password, nonce? })`, `reauthenticate()`. Also
  `MIN_PASSWORD_LENGTH = 8`, which `SignIn.tsx`'s sign-up `minLength={8}`
  then uses (one number in code), and the pure
  `authRedirectFromUrl(href)`: `recovery` when the hash or query has
  `type=recovery`, `link-error` when it has `error_code`, else `none`.
- **Set a new password:** `updateUser({ password })`. Supabase's User
  object has no "has a password" field, hence one menu label.
- **Secure password change**, designed for both settings. The app never
  reads the setting; it reacts to the answer. Off, or on with a session
  under 24 hours old: the call saves. On with an older session: error
  code `reauthentication_needed`. The app then calls `reauthenticate()`,
  which emails a 6-digit code, and retries with
  `updateUser({ password, nonce: code })`. A wrong or expired code is
  `reauthentication_not_valid`. The setting is the owner's and can change
  without a deploy, so the app must not assume either.
- **Forgot:** `resetPasswordForEmail(email, { redirectTo: siteRedirectUrl() })`,
  which is `VITE_SITE_URL` (§ 8: every auth link passes `redirectTo`).
  Supabase returns no error when no account exists (its password guide).
- **The link back.** The flow stays **implicit**, the client's default
  (nothing sets `flowType`), so the link works in any browser, not only the
  one that asked. It lands as `#access_token=…&type=recovery`.
  `detectSessionInUrl` saves the session, then fires `PASSWORD_RECOVERY`
  a tick later (`setTimeout`, line 424). Each listener also gets
  `INITIAL_SESSION` with that session once setup finishes (line 2075), and
  the two have no guaranteed order. Today `RealApp.tsx`'s listener would
  run the membership check and open the chat on `INITIAL_SESSION`.
  So `RealApp` reads `authRedirectFromUrl(window.location.href)` **once,
  before creating the client** (the client clears the hash). `recovery`, or
  a `PASSWORD_RECOVERY` event, shows "Choose a new password" in place of
  every other screen; while it shows, the listener acts only on sign-out.
  After a save, `Continue` runs the normal membership check once.
  Nothing is stored: a reload during recovery goes on to the app signed
  in (the link was a valid sign-in), and the menu still offers the
  password.
- **A link error** (`error_code`, for example `otp_expired`): the sign-in
  screen shows the expired line, then `history.replaceState` removes the
  parameters so a reload doesn't repeat it.

### 16.2 Security

- The password and the code live only in the form's React state, cleared
  on success, `Cancel`, sign-out and unmount. They leave the tab only in
  the body of Supabase Auth's own calls (HTTPS).
- Never: the console or `logSetupError`, `localStorage` or
  `sessionStorage`, the conversation (§ 11), workspace files, the gate log,
  the agent, any URL. Shown errors come from § 1.10's table, never
  `error.message`. Forms are `method="post"` and the fields have no `name`,
  so no fallback submit can put a password in a URL. Fields are
  `type="password"` until Show; `autocomplete="new-password"`, and the
  code is `autocomplete="one-time-code"`.
- Supabase enforces the password rules; the app's 8 is only a first
  check. If the dashboard asks for more, the `weak_password` line says so.
- **The sign-in is shared** (§ 8): the new password, and every setting
  below, also applies to the older app. The copy says so.
- Enumeration: the screen shows success and a 429 identically. What the
  Auth API itself reveals to a script calling it directly is Supabase's
  behaviour, not this screen's (UNVERIFIED: whether its 429 can differ
  by account).

### 16.3 Owner checklist (production is owner-only, § 15)

Dashboard of `career-coach-nextgen`. Agents never change these; the owner
checks each and tells the lead the values. The provider page URL and Rate
Limits come from Supabase's docs; the menu paths in items 1, 2, 3 and 5
are UNVERIFIED against today's dashboard (menus move).

1. **Authentication → URL Configuration.** Redirect URLs has
   `https://ten-coach.vercel.app/**`, and Vercel's `VITE_SITE_URL` falls
   inside it. Site URL stays the old app's. A `redirectTo` not on the list
   falls back to the Site URL, so the reset link would open the old app.
2. **Authentication → Email Templates → Reset Password.** The link is
   `{{ .ConfirmationURL }}` (it carries `redirect_to`), not a fixed
   `{{ .SiteURL }}` path. The wording suits both apps: it is shared.
3. **Authentication → Email Templates → Reauthentication.** It contains
   `{{ .Token }}`.
4. **Authentication → Providers → Email**
   (`/dashboard/project/_/auth/providers?provider=Email`):
   - *Minimum password length:* 8, or tell the lead the number (the app's
     first check must not be below it).
   - *Password requirements* and *leaked password protection* (Pro plan):
     either value works; report them.
   - *Secure password change:* either works; report which.
   - *Require the current password*, if shown: must be **off**.
     `current_password` needs `supabase-js` 2.102 or later (vendor docs),
     and email-link accounts have no current password.
5. **Authentication → Emails → SMTP Settings** and **Authentication → Rate
   Limits.** Custom SMTP is set: the built-in sender allows 2 emails an
   hour for the whole project, old app included. Note the per-user 60 s
   interval and the email OTP expiry (the link's and the code's lifetime).
6. **After the site deploy**, the owner's live run on a fresh test account
   (PROCESS step 6): forgot → email → "Choose a new password" → sign out →
   sign in with it; then "Set a new password" from the menu.

### 16.4 Test plan (independent tester)

A fake `AuthClientLike` for units. For e2e, the GoTrue stand-in in
`tests/e2e-real/stand-in.ts` gains `POST /recover`, `PUT /user` and
`GET /reauthenticate`.

1. **Form:** a mismatch and a 7-character password make no call.
2. **Secure change off**, or on with a fresh session: `updateUser` is
   called once with exactly `{ password }`; the success line shows.
3. **Secure change on, older session:** `reauthentication_needed`, then
   `reauthenticate` once, then the code step. A wrong code gives its
   line and keeps the password; `Send a new code` calls `reauthenticate`
   again; the right code sends `{ password, nonce }`.
4. **Every error code** gives its § 1.10 line, and the shown text never
   contains the fake's `error.message`.
5. **Forgot:** called with `(email, { redirectTo: VITE_SITE_URL })`. The
   has-account, no-account and 429 fakes render byte-identical text;
   another error gives the failure line.
6. **Recovery:** `authRedirectFromUrl` cases (recovery hash, error in the
   hash, error in the query, none). `RealApp` with a fake that emits
   `INITIAL_SESSION` then `PASSWORD_RECOVERY`, the reverse, and the URL
   alone: the recovery screen shows, `ten_is_member` is not called and no
   chat mounts; after save and `Continue` it is called once. An
   `otp_expired` hash shows the expired line.
7. **No leak:** a sentinel password and code. Spies on `console.*`,
   storage `setItem`, `fetch` URLs and bodies, `location` and `history`,
   the conversation save and workspace writes: the sentinel appears only
   in a Supabase Auth request body.
8. **375px:** the dialog, the reset card and the recovery screen have no
   horizontal scroll, tap targets of at least 44px, `data-theme="light"`,
   and new CSS uses only `styles.css` custom properties.

---

## 17. Buying credit with PayPal (amendment, 2026-09-25)

**Approved by the owner (2026-09-25)**, with the answers in § 17.9. Owner
decisions: the older app's PayPal business account and REST app keys;
credit = what PayPal says arrived, net of its fee; one-time payments, no
monthly charge. Lead defaults, approved with it: packs of $10, $20, $40;
the $5 starter stays; refunds by hand; paid credit is never deleted;
members only (buying adds credit, never membership). Screens: `design-web-ui.md` § 1.11. Wins
over § 8 where they differ.

**Prevents:** paying without credit, or credit twice; credit for money not
received (a changed amount, another user's order, the older app's
payments); agent spending behind a button; a secret outside the owner's
hands; the older app retrying Ten's payments for 3 days.

### 17.1 The flow

1. A member picks a pack in "Buy credit". PayPal's JS SDK buttons (loaded
   only then; `VITE_PAYPAL_CLIENT_ID`, `intent=capture`, `currency=USD`,
   `disable-funding=paylater`) call:
2. **`POST ten-paypal/create-order`** `{ pack: "10"|"20"|"40" }`: signed in
   (401), member (403), known pack (400). Creates an Orders v2 order,
   `intent: CAPTURE`: the pack's amount from the server's table,
   `custom_id: "ten:<uid>"`, `invoice_id` signed as in § 17.10 (PayPal wants
   it unique), `description: "Ten credit $10"`, no shipping address. No
   vault, saved method, agreement or plan. Returns `{ orderId }`.
3. The payer confirms in PayPal's window.
4. **`POST ten-paypal/capture-order`** `{ orderId }`: signed in, member.
   Reads the order first: unless it passes § 17.10's check (403
   `not_ten_order`) and its uid is the caller's (403), nothing is captured. Captures with
   `PayPal-Request-Id: ten-capture-<orderId>` (kept 6 hours: a retry returns
   the same capture); `ORDER_ALREADY_CAPTURED` → read the order's capture.
   `COMPLETED` → credit (§ 17.3), `{ status: "credited", grossUsd, feeUsd,
   creditedUsd }`; `PENDING` → `"pending"` (no fee breakdown until it
   clears); `DECLINED` or `FAILED` → `"declined"`; any other error → 503
   `"unconfirmed"` (§ 17.10). A failed credit write → 503
   `"paid_not_credited"`.
5. **`ten-paypal-webhook`, the backup. Decision: Ten registers its own URL
   on the shared app, event `PAYMENT.CAPTURE.COMPLETED` only.** Without it,
   a pending payment that clears later, or a failed credit write after the
   tab closed, stays uncredited until the user complains. PayPal posts to
   every subscribed URL and retries a non-2xx up to 25 times over 3 days.
   Checks, in order: POST, ≤ 64 KB, JSON; a missing `paypal-*` signature
   header → 401 without calling PayPal. **Then PayPal's signature**
   (owner, 2026-09-25): `POST /v1/notifications/verify-webhook-signature`
   with the five `paypal-*` headers, the event and `TEN_PAYPAL_WEBHOOK_ID`;
   anything but `SUCCESS` → 401, no credit; the call failing, or the secret
   unset → 503, so PayPal retries. Then: another event type → 200;
   `resource.custom_id` not exactly `ten:` + a lowercase UUID → 200 (the
   older app's);
   not a member → 200 and an alert ("refund by hand"). **Then, still,
   re-fetch** `GET /v2/payments/captures/{id}` with Ten's keys (404 → 200
   and a log line; other failure → 503): the signature proves PayPal sent
   the event, the re-fetch proves the capture (rule 11). It must pass
   § 17.10's check and show the same `custom_id` and `COMPLETED`, else 200
   and a log line; credit (a failed write → 503). Deployed
   with `verify_jwt = false`; no CORS.

### 17.2 Buying is not spending (rule 7)

Rule 7's owner-approved sentence (2026-09-25): "Buying credit, done by you
in the payment provider's own window, is your action, not Ten's; Ten never
starts it." Rule 7 covers what Ten does for the candidate, spending included; every
spend stays behind § 3's typed `yes` and § 8's proxy. Buying is the
candidate paying, by choice, in PayPal's window, which shows amount and
payee and takes their confirmation; Ten's button only opens it. Money moves
into the balance, never out. This holds only while, tested (§ 17.8):

- **Only PayPal's window moves money.** Ten can capture only an order the
  payer approved (else `ORDER_NOT_APPROVED`); nothing is saved to charge
  again.
- **A purchase approves nothing:** no gate opened, approved or raised, no
  allowance changed; `ten-paypal` never touches `ten_gate_log`.
- **The agent can't reach it:** no tool, card or model output opens the
  dialog or calls `ten-paypal`; the coach's prompt and skills never mention
  buying, so it can't upsell (rule 8). The one pointer is fixed
  `over_balance` copy.

### 17.3 The ledger (a new migration file)

One `credit` row per capture: `request_id = 'paypal:<captureId>'` (already
unique, so capture, webhook and replays credit once), `usd` = PayPal's
`net_amount`, plus new nullable `gross_usd`, `fee_usd` (`numeric(12,2)`).
PayPal's decimal strings reach Postgres unparsed. The migration adds:

- a two-way check: a `paypal:` row without `gross_usd` and `fee_usd` is
  refused, and so is either column on any other row; a `paypal:` row
  also needs `kind = 'credit'`, `fee_usd >= 0`,
  `usd > 0`, `usd = gross_usd - fee_usd`, so a breakdown that doesn't add up
  is refused;
- the kind `refund` (§ 17.5). `ten_balance_for` already subtracts every
  non-credit kind; membership and the day's spend read only `credit` and
  `call`. No function or policy change.

No payer name or email is kept. The teardown refuses while `paypal:` rows
exist, until the owner exports them (a query in its header).

### 17.4 Delete keeps credit (amends § 8)

`ten-delete-account` stops deleting ledger rows, the $5 starter included:
calls aren't tied to the credit they used, so deleting any credit row can
take paid credit with it. A member who deletes keeps membership and
balance, with an empty workspace; rule 9 holds (amounts, no career
content). Deploy it before `ten-paypal`, the new copy after it. When built,
`ARCHITECTURE.md` § 3–4 and the functions README follow.

### 17.5 Limits and refunds

Unchanged: the $5/day beta ceiling, per-call ceilings, gate and allowance
(§ 3, 4, 8, 13, 14). **Refunds, by hand:** the owner refunds in PayPal, at
most the current balance, then inserts `kind 'refund'`, `request_id
'paypal-refund:<refundId>'`, `usd` = the amount. Disputes likewise.
**When the beta ends,** unused paid credit stays usable; refunds on
request.

### 17.6 Secrets, sandbox, the older app, privacy

Function secrets, owner-set (§ 15): `TEN_PAYPAL_CLIENT_ID`,
`TEN_PAYPAL_CLIENT_SECRET`, `TEN_PAYPAL_API_BASE`, `TEN_PAYPAL_WEBHOOK_ID`
(Supabase secrets are project-wide; the prefix keeps them apart). The functions refuse to start
unless the base is `https://api-m.sandbox.paypal.com` or
`https://api-m.paypal.com`. The browser gets only the public
`VITE_PAYPAL_CLIENT_ID`. `ten-paypal` uses `_shared/cors.ts`. Sandbox
first; for live, switch secrets, Vercel value, webhook and its id together.

The older app's webhook gets every Ten payment too; today it fails on
`ten:<uuid>`, answers 500 and is retried for 3 days. Its patch:
[`old-app-paypal-ten-prefix.md`](old-app-paypal-ten-prefix.md).

`/privacy.html` gains "Payments go through PayPal": you pay in PayPal's
window; Ten never sees your card or login; PayPal gets an internal account
id; Ten keeps the amount, fee and PayPal's transaction id, nothing else;
records survive a delete.

### 17.7 Owner checklist (sandbox, then live)

**Refund contact:** `support@10xjobs.co` (owner, 2026-09-25; shown in
`design-web-ui.md` § 1.11). The earlier release blocker is cleared.

1. Deploy the older-app patch; a `ten:` payment gets 200 "ignored" there.
2. PayPal: the account takes USD without manual acceptance (else payments
   sit `PENDING`); unique invoice ids stays on.
3. Apply the migration; `NOTIFY pgrst, 'reload schema';`.
4. `supabase secrets set TEN_PAYPAL_CLIENT_ID=… TEN_PAYPAL_CLIENT_SECRET=…
   TEN_PAYPAL_API_BASE=https://api-m.sandbox.paypal.com --project-ref
   ivunfotoggdxbjouumdk`.
5. `supabase functions deploy ten-delete-account`, then `ten-paypal`, then
   `ten-paypal-webhook --no-verify-jwt` (same project ref).
6. developer.paypal.com → the app → Webhooks → Add:
   `https://ivunfotoggdxbjouumdk.supabase.co/functions/v1/ten-paypal-webhook`,
   "Payment capture completed" only. Copy the Webhook ID PayPal shows,
   `supabase secrets set TEN_PAYPAL_WEBHOOK_ID=<it> --project-ref
   ivunfotoggdxbjouumdk`, then redeploy `ten-paypal-webhook
   --no-verify-jwt`. Until the id is set, it answers 503.
7. Vercel: `VITE_PAYPAL_CLIENT_ID`, then deploy the site.
8. Buy $10: one `paypal:` row, `usd` = net, the chip up by net, the webhook
   delivery 200 with no second row. Live: refund it by hand.

### 17.8 Test plan (independent tester)

Mocked PayPal (a loopback stub, as in `_shared/test-support.ts`) and
Supabase; sandbox is the owner's step 8.

1. create-order: 401, 403, 400; the amount comes from the table whatever
   the body adds (`amount`, `custom_id`); `custom_id` is `ten:<caller>`; no
   vault or agreement field.
2. capture-order on another user's order, an older-app order (bare UUID),
   a `ten:` order with a non-pack amount: all 403 (the last two
   `not_ten_order`); no capture call. More in § 17.10.
3. Parallel captures, capture then webhook, webhook then capture, a webhook
   replayed 3 times, `ORDER_ALREADY_CAPTURED`: one row.
4. Webhook: a bad or missing signature → 401, no re-fetch, no row; the
   verify call failing or no `TEN_PAYPAL_WEBHOOK_ID` → 503, no row. A valid
   signature with a non-`ten:` `custom_id` (bare UUID, other text), an
   unknown capture, a non-member, or a re-fetched `custom_id` unlike the
   event's → 200, no row. Valid and `ten:` → re-fetch → one row, replayed
   or not. A PayPal or DB failure: 503.
5. `PENDING`: no row; the later webhook: one row.
6. The breakdown cases: § 17.10.
7. `tests/sql`: the checks; users can't insert; a refund lowers
   `ten_balance()`, not `ten_beta_spend_today()`; the teardown refuses.
8. Delete, twice: files, conversation, gates gone; ledger, membership and
   balance stay.
9. Rule 7: after a purchase a run over the allowance still stops at a gate;
   no tool or bundled skill offers buying; no card opens the dialog.

### 17.9 Resolved (owner, 2026-09-25)

Approved with the lead's recommendations:

- Rule 7 gains the sentence quoted in § 17.2 (`PRINCIPLES.md`).
- The webhook checks PayPal's signature first and still re-fetches the
  capture before crediting (§ 17.1 step 5; was "no signature check").
- Delete keeps the $5 starter row, so the person stays a member (§ 17.4).
- Unused paid credit stays usable when the beta ends; refunds on request.
- Pay Later off; the teardown refuses while paid rows exist.
- The refund contact is `support@10xjobs.co` (owner, 2026-09-25); the
  release blocker is cleared (§ 17.7).
- The older app credits gross from its webhook and net from its capture
  route: a known issue, a separate fix for the older app, not part of
  Ten's build (`old-app-paypal-ten-prefix.md`).

### 17.10 Only Ten's own orders (amendment, 2026-09-25; lead ruling)

The independent tester's finding F1: capture checked `custom_id` and the
amount, never that Ten created the order. The client id is public, so a
browser can create an order itself, with a `ten:` `custom_id` and possibly
another payee. Wins over § 17.1–17.8 where they differ.

**Prevents:** crediting an order Ten didn't create; calling a capture or
webhook failure "declined"; crediting a breakdown that doesn't add up.

**The signed `invoice_id`.** `create-order` sets
`ten-<U>-<T>-<N>-<H>`, 73 characters (PayPal allows 127), matching
`^ten-[0-9a-f]{8}-[0-9]{10}-[0-9a-f]{16}-[0-9a-f]{32}$`:

- `U`: the first 8 characters of the caller's uid, for reading PayPal's
  reports;
- `T`: Unix time in seconds;
- `N`: 8 random bytes as 16 lowercase hex characters. It makes the id
  unique before an order id exists;
- `H`: the first 32 lowercase hex characters of
  HMAC-SHA256(`K`, `v1|<uid>|<pack>|<amount>|<T>|<N>`), where `uid` is the
  full lowercase UUID, `pack` is `10`, `20` or `40`, and `amount` is the
  exact value string sent to PayPal (`10.00`);
- `K` = HMAC-SHA256(`TEN_PAYPAL_CLIENT_SECRET`, `ten-invoice-v1`), the raw
  32 bytes. No new secret.

**The check**, one shared function, run before any credit: by
`capture-order` on the order it read, and by the webhook on the re-fetched
capture (a capture carries `invoice_id`, `custom_id` and `amount`, per
PayPal's published Payments v2 spec). It passes only when `custom_id` is
exactly `ten:` + a lowercase UUID; the amount is USD and its value string
equals one pack's exactly, which gives `pack`; `invoice_id` matches the
pattern; `U` is the uid's first 8 characters; and the recomputed `H`
equals the given one, compared in constant time. Otherwise `capture-order`
answers 403 `not_ten_order` and never calls capture; the webhook answers
200 "ignored" and logs one line (capture id and reason, no payer data).
`T`'s age is not checked: a pending payment can clear days later.
Rotating `TEN_PAYPAL_CLIENT_SECRET` breaks the tags of payments not yet
credited: rotate when none is pending, or credit those by hand.

**Errors and the breakdown.**

- A capture call answering 5xx, timing out, or with any error other than
  `ORDER_ALREADY_CAPTURED` → 503 `unconfirmed`, shown with "Ten couldn't
  confirm the credit yet…" (UI § 1.11), never "declined".
- `gross_amount`, `paypal_fee` and `net_amount` must all be present and in
  USD, and net = gross − fee, compared in whole cents from the decimal
  strings. Otherwise: no row and an `ALERT` log line; `capture-order`
  answers 503 `paid_not_credited`, the webhook 200 (a retry can't fix it;
  the owner resolves it by hand).

**Open for the lead (architect's note).** The tag does not bind the
payee. A member can mint a tag with `create-order`, then create their own
order in the browser with that `invoice_id`, `custom_id` and amount and
another account as payee; PayPal's unique-invoice rule is per account.
Whether Ten's keys can capture or re-fetch such an order is UNVERIFIED
(PayPal likely refuses it as another merchant's). Closing it: the check
also requires the payee's `merchant_id` to be Ten's (read on the order;
the webhook would read the order too), from a non-secret
`TEN_PAYPAL_MERCHANT_ID`.

**Tests** (added to § 17.8):

1. create-order's `invoice_id` matches the pattern and equals a fixed
   test vector (known key, uid, pack, `T`, `N`).
2. capture-order with no `invoice_id`, a random one, another uid's valid
   tag, another pack's tag, one hex digit changed, or a tag from another
   secret: 403 `not_ten_order`, no capture call. The webhook, the same six
   on the re-fetched capture: 200, a log line, no row.
3. Capture 500, timeout, an unknown error: 503 `unconfirmed`; `DECLINED`
   or `FAILED`: `declined`.
4. A non-USD field; a missing fee or net; net off by one cent: no row, an
   `ALERT`; capture-order 503 `paid_not_credited`, the webhook 200.
5. Webhook: each signature header missing in turn → 401, verify never
   called; `custom_id` `TEN:<uuid>`, an uppercase UUID, a trailing space →
   200 ignored; re-fetch 404 → 200 and a log line; re-fetch 500 → 503.
6. `tests/sql`: both directions of the two-way check are refused.
7. Review: the tag compare is a constant-time byte compare.

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
    credits (if not, the proxy adds the listed plugin price). Settled
    2026-09-24 from the ledger: it includes the $0.007 fee (§ 14);
  - there is a turn-2 cache read through the proxy;
  - streaming works end to end from the Vercel build.

---

## Decision log

- Spend is the only web gate; nothing there sends or submits (owner, 09-22).
- The gate opens from `estimate_cost`: one way in, one tool fewer.
- Cards are code-built receipts of files (rule 11); the plan card shows lines
  word for word (rule 8).
- Gate status lives in the row; UI status is derived (rule 12).
- ~~No saved chat: files are the memory, cost per turn is bounded.~~
  Superseded 2026-09-24 by the owner's requirement (§ 11). Files stay the
  memory: the saved chat keeps what ran, not copies of files.
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
- Every tool call in a cut-off step is treated as not run (lead ruling,
  09-24, fix round 1 of issue #2): `ai@7.0.111` runs no tool on a `length`
  step. Synthesized error results keep the continuation valid, and
  `ignoreIncompleteToolCalls` keeps every later turn valid.
- A step-capped turn is told to the next turn the same way as a cut-off
  (lead ruling, 09-24, round 2): § 9.4 is one check with one note per code,
  because the window can drop the whole capped turn.
- Cap 8,192 (owner, 09-24): the most the ~360 s meter allows at 30 tokens/s,
  with margin; more needs another host. The ledger records `finish_reason`.
- A deploy tells open tabs (owner, 09-24; § 10): one build id in the bundle
  and in `version.json`; a newer id blocks the next send, so no spend on
  replaced code; a failed check never blocks.
- The conversation is kept (owner, 09-24; § 11): one row per user, so one
  conversation (rule 12); tool data over 2,000 characters is not kept,
  because a copy of a file drifts from the file (rules 11, 12); a table,
  not a workspace file, so no agent tool can rewrite it. Approved as
  written (owner, 09-24), with: no "start fresh"; past the cap, oldest
  turns dropped with a visible line, no archive; import skips
  `.ten/conversation.json` and starts a new conversation; no separate
  viewer, the export covers rule 9.
- A long turn trims itself (§ 12; approved as written, owner, 09-24): older tool data in the current turn
  becomes a stub before a step would pass 160 KB; the proxy's 256 KB cap
  and the cost ceiling stay. A refusal is its own code, `too_large`.
- The site's model is a setting (§ 13, approved by the owner, 09-24): the
  proxy allows Claude Sonnet 5 and DeepSeek V4.1 Flash; `VITE_COACH_MODEL`
  picks one, unset means Claude, a bad value refuses to start. The ceiling
  and the turn-1 estimate are per model; Claude's request body is unchanged.
  Resolved with it (§ 13.6): Claude's ceiling is raised to the dearest
  allowed host with a cache write ($0.273112 with § 14's search term; the
  approval quoted the pre-§ 14 $0.286112); DeepSeek only while the owner and
  informed testers are the active users, so switch back to Claude before
  outside members are invited (B2 stands); the privacy terms start as
  `/privacy.html`, naming OpenRouter, Exa and each model's hosts, and ship
  with § 13; the menu keeps "(testing)".
- Production is owner-only (§ 15; owner, 09-25): agents prepare
  commands and checks, never run them or hold secrets; the 09-23..25
  setup exception (the lead ran steps on per-action approval) is closed.
- Fix round 2 of § 10–12 (lead rulings, 09-24): § 9.4 skips an assistant
  message made only of `data-gate-status` parts, so § 11.6's
  reconciliation message can't hide a stop; each reconciliation message
  gets a unique id; § 12.3 (i) uses 22 reads so the trim really fires;
  the § 11.3/§ 12.1 stub is one shared implementation.
- Password reset stays on the implicit flow (§ 16; draft, 09-25): the
  link works in any browser; the recovery screen is chosen from the URL,
  read before the client exists, because the two auth events have no
  guaranteed order. The app reacts to `reauthentication_needed` rather
  than reading the secure-change setting.
- Buying credit (§ 17; approved by the owner, 09-25): PayPal on the older
  app's account, credit = PayPal's net, one row per capture keyed
  `paypal:<captureId>`; Ten's own capture webhook as the backup, checked by
  PayPal's signature and then a re-fetch; buying is paying in PayPal's window, never Ten spending
  (rule 7); delete keeps every ledger row. Only Ten's own orders are
  credited: a signed `invoice_id` checked before any credit (§ 17.10, lead
  ruling on F1, 09-25).
