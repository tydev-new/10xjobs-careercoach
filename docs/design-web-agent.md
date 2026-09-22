# Design - Web agent contracts (MVP)

**Status:** Draft r2 for owner approval (plan step 1, contracts half).
Revised against `docs/reviews/step1-review.md`.
**Date:** 2026-09-22
**Owner:** Yong · **Author:** architect
**Builds on:** `docs/plan-portable-skills-and-web-agent.md` (Phase 0 is settled
and not re-opened here), `apps/workspace-ui/server/workspace-core.mjs`,
`apps/workspace-ui/src/resources/contract.js`,
`skills/coach/references/gate-grammar.md`, `docs/loading-map.md`.
**Card props:** `docs/design-web-ui.md` (designer). This doc owns the wrapper
and the **source** of every prop (§ 6.2).

These are the shapes steps 2 to 5b build against. Each contract says what it
prevents and how a test proves it. `UNVERIFIED` marks a fact this doc could
not confirm from the vendor's docs or the installed package on 2026-09-22.
`PENDING OWNER` marks a decision the lead or reviewer proposed that O has not
yet confirmed.

**Four decisions that shape everything below:**

1. **No send or submit gates on the web (PENDING OWNER).** Nothing in the web
   app sends or submits anything, so there is nothing to gate. "Submit the Acme
   application" is a `To do` item in `plan.md`, with the prepared file. The
   only gate on the web is `spend`. `gate-grammar.md` keeps its send and submit
   lines for the local plugin (where the agent does click) and gains a spend
   line; that skill edit is a separate change and is not made here.
2. **The model never writes a card or a gate.** Code builds them from tool
   results and files (§ 6.2), and fills in every gate field except what to
   gate and a short label (§ 3).
3. **Chat history is not saved.** A reload starts a new chat. The files are the
   memory. Each turn re-sends a capped window of recent messages (§ 7).
4. **Default model:** `anthropic/claude-sonnet-5` on OpenRouter, for the web
   app and the B1 runner. Confirmed from `GET https://openrouter.ai/api/v1/models`
   on 2026-09-22: $2 per million input tokens, $10 per million output, $0.20 per
   million cache-read.

---

## 1. `packages/agent` - the public interface

The package is the coach: one loop, the tools, the skill loader, the gate
check, the card builder. It knows nothing about where it runs. Everything that
touches the outside world comes in through `Deps`.

```ts
export function createCoach(deps: Deps): Coach;

export interface Deps {
  model: LanguageModel;          // AI SDK model, built by the entry point
  workspace: WorkspaceStore;     // § 2
  skills: SkillBundle;           // read-only map "skills/<path>" -> text, built at build time
  gate: Gate;                    // § 3 - reads and writes gate_log
  balance(): Promise<number>;    // USD left to spend; § 8
  fetch: typeof fetch;           // ATS fetch and the price list only
  clock: { now(): Date };        // every timestamp and mtime check reads this
  logger?: { info(e: object): void; warn(e: object): void; error(e: object): void };
  limits?: {
    maxSteps?: number;           // default 25 per turn
    spendGateUsd?: number;       // PENDING OWNER; § 4 estimate_cost
    windowWords?: number;        // default 4,000; § 7
  };
}

export interface Coach {
  // One user turn. Returns the AI SDK UI message stream (§ 6).
  stream(input: {
    chatId: string;
    messages: UIMessage[];       // this chat's messages; the package applies the window
    abortSignal?: AbortSignal;
  }): ReadableStream<UIMessageChunk>;
}

export type SkillBundle = Readonly<Record<string, string>>; // key: "skills/apply/SKILL.md"

// Pure helpers, exported so the UI and the mock use the same rules (§ 3, § 6):
export function matchGateReply(text: string, origin: "typed" | "ui"): "approve" | "decline" | "none";
export function statusOf(messages: UIMessage[], chat: ChatStatus): Status;
```

Rules:

- The entry point builds `model` (the OpenRouter provider with the user's key,
  the model slug above, and the provider filter from spike 4). The package
  never sees the key.
- The package imports no `window`, `document`, `localStorage`, `node:*`, or
  Supabase client. A browser entry and a Node entry (the headless runner used
  by step 4 and B2) are each a few lines that build `Deps`.
- There is one loop (`streamText` with tools, `stopWhen: stepCountIs(maxSteps)`).
  A headless run is the same `stream()` read to the end. No second code path.
- AI SDK 7 returns `finishReason` as `{ unified, raw }` (spike 1). The package's
  tests use one shared mock-model helper that returns this shape.

**Prevents:** a browser-only or server-only coach, so the later server loop and
the MCP server (step A) would need a fork (rule 12).
**Proved by:** step 4's package tests run in Node with no DOM; a lint rule or
test fails on any `window`/`document`/`localStorage`/`node:` import under
`packages/agent`.

---

## 2. Workspace store

The same versioned-write contract the local workspace UI already uses
(`workspace-core.mjs`: `readResource` returns a `version`; `updateResource`
takes the `expectedVersion` and throws `409 version_conflict` if the file
changed). The agent needs the lower half of it, plus "create a new text file",
which the local core only has as an upload. **The UI gets the same store
instance** for the side panel, downloads, and uploads. The UI never calls
agent tools.

```ts
export interface WorkspaceStore {
  list(dir?: string): Promise<FileInfo[]>;            // recursive under dir, depth <= 3
  read(path: string): Promise<FileRead>;
  write(path: string, content: string, expectedVersion: string | null): Promise<FileInfo>;
  //   expectedVersion null = "must not exist yet" (create); otherwise must match
  upload(path: string, bytes: Uint8Array): Promise<FileInfo>; // .pdf/.docx, create-only
}

export interface FileInfo {
  path: string;          // workspace-relative, "/"-separated, e.g. "applications/acme.md"
  version: string;       // opaque; equal versions = equal content
  size: number;
  updatedAt: string;     // ISO; check_closeout's "plan.md written this turn" reads it
  editable: boolean;     // .md .txt .json .html
}
export type FileRead =
  | (FileInfo & { binary: false; content: string })
  | (FileInfo & { binary: true;  bytes: Uint8Array });

export class WorkspaceError extends Error {
  code: "invalid_ref" | "outside_workspace" | "resource_missing"
      | "version_conflict" | "already_exists" | "not_editable"
      | "content_too_large" | "upload_too_large" | "unsupported_type";
}
```

**Path rules** (kept from `workspace-core.mjs` `resolveRef`, one list for
every backend):

- Paths are relative. No `..`, no segment starting with `.` (no hidden
  files), no NUL.
- Text types `.md .txt .json .html` are editable and versioned (2 MB cap).
  `.html` is the rendered résumé. `render_resume` rewrites it on every
  revision, so it has to be overwritable. The UI shows it only in a sandboxed
  iframe.
- Binary types `.pdf .docx` are upload-only and create-only (10 MB cap).
- The top-level name `skills/` is reserved and refused in the workspace,
  because the agent reads the bundle under that name (§ 7).

**Uploads:** the UI uploads an attached file with
`upload("documents/<name>")` **before** it sends the message. `documents/` is
the candidate's existing drop folder, the one `check_files.py` expects. If the
name is taken, the UI adds `-2`, `-3`, and so on before the extension. The
message carries an AI SDK `file` part with `url: "workspace:documents/<name>"`.
The package turns each such part into one text line ("The candidate attached
`documents/<name>`.") before the model sees it. The file bytes are never sent
to the model as file input, which would be a second, costly copy.

**What changes on Supabase Storage (step 2):**

- A private bucket `workspaces`; object key `users/{uid}/ws/{path}`. Access
  rules on `storage.objects` allow a user only keys where
  `(storage.foldername(name))[1] = 'users'` and
  `(storage.foldername(name))[2] = auth.jwt()->>'sub'`, for select, insert,
  update, and delete. Overwrite needs select and update as well as insert
  (Supabase docs).
- `version`: locally it is a sha256 prefix of the content. On Storage it is
  whatever the conditional write checks against (the object ETag if uploads
  accept `If-Match`). The contract keeps it opaque so both work.
  **UNVERIFIED:** whether Supabase Storage's upload API honours `If-Match` or
  another precondition. Only S3 CopyObject preconditions are documented. If it
  does not, step 2 must bring a compare-and-swap design to Ar before building.
  A read-then-upload with no precondition does not meet this contract.
- `updatedAt` comes from the object's `updated_at`. **UNVERIFIED** that it
  changes on overwrite; spike 3 records it, because `check_closeout`'s
  freshness check depends on it.
- No database copy of any file, listing, or version (rule 12).

**Export / import / delete (rule 9):**

- Export = a zip of the workspace in the exact folder shape: entry name = the
  `path`, bytes as stored, no `users/{uid}/ws/` prefix, no versions or
  metadata. Built in the browser.
- Import = a zip into an **empty** workspace only (no merge in the MVP). Every
  entry goes through the path rules; one bad entry refuses the whole import
  and names that entry (this blocks zip-slip and hidden files).
- Delete = the `delete_account` action in § 8.
- **Fixture workspace for step 2:** `tests/always-on/fixtures/apply/` plus
  `tests/always-on/fixtures/{profile,criteria}.md`. The persona is invented and
  already used by the harness. It is used for the byte-identical round trip
  and for the local Claude Code portability proof.

**Prevents:** two writers silently overwriting each other (two tabs, or a
later cron job); one user reading another's files; a cloud folder that cannot
leave or cannot be deleted (rule 9).
**Proved by:** step 2's exits: the isolation tests (spike 3 in CI), a stale
write rejected with `version_conflict`, a concurrent-write test, an import →
export round trip of the named fixture that is byte-identical, and that export
working in local Claude Code with the local skills unchanged. The same store
test suite runs against an in-memory store, the local folder store, and the
Supabase store. A delete test leaves no object under `users/{uid}/` and no row.

---

## 3. Gate protocol

Rule 7: anything sent as the candidate, submitted for them, or costing money
shows the complete thing, one plain sentence of what happens, then needs their
typed yes, then gets logged. The wording is `gate-grammar.md`; this section is
the machinery.

**One gated kind on the web: `spend`** (PENDING OWNER, decision 1 above). The
package has no tool that sends or submits. The host note (§ 7) tells the model
so, and tells it to put the candidate's sends and submits in `plan.md` as
`To do` items with the prepared file. Topping up the balance is not an agent
action at all (§ 8).

**Opening a gate: one tool.** The model calls

```ts
request_gate({ kind: "spend", amountUsd: number, label: string, text: string })
```

- `label`: 6 words or fewer, e.g. "Evaluate 8 Stripe roles". It is used for
  the card title and the avatar's hover text.
- `text`: the complete thing being paid for, i.e. what the run will do (for
  example, the list of roles).

**Code** does everything else:

1. Checks the label length and that `amountUsd > 0`.
2. Reads the gate line for `spend` from the bundled `gate-grammar.md`, word
   for word. If the bundle has no spend line, the tool fails loudly.
3. Adds one cost line built from `estimate_cost` (§ 4) to `text`.
4. Computes `textHash` (sha256 of the exact text shown).
5. Writes the `pending` row.
6. Emits the `data-gate` part and ends the turn.

The loop can also open a spend gate itself (§ 4).

```ts
export interface GateRequest {   // the data-gate part's data; no status field
  gateId: string;                // uuid
  kind: "spend";
  label: string;                 // ≤ 6 words, from the model
  text: string;                  // what the run does + the code-built cost line
  textHash: string;              // sha256 of text
  gateLine: string;              // verbatim from gate-grammar.md, by code
  amountUsd: number;
}
```

**How the typed yes is matched:** by `matchGateReply(text, origin)`, in code,
before the model sees the message.

1. At most one gate is open per chat. A new gate expires any open one.
2. The candidate's **next** message approves only if its `origin` is
   `"typed"` **and** the whole message, trimmed and lowercased, with at most
   one trailing `.` or `!`, is exactly `yes`. Anything else ("yes but only 5",
   a pasted job post containing "yes", a chip, a prefill the candidate did not
   type) does not approve. The gate stays open, and the model is told it is
   not approved.
3. A clear no (`no`, `don't`, `cancel`, `stop`, matched the same exact way)
   declines it. The model is told not to ask again unprompted (gate-grammar:
   declining is an outcome). Matching "no" is a courtesy only; safety rests on
   rule 2.
4. There is no approve button (rule 7; step 5a exit). The UI sets
   `metadata.origin` on every user message.

**Gate status has one owner: the `gate_log` row.** The chat never stores a
status.

- One function, `setGateStatus`, writes the row and then emits a
  `data-gate-status` part `{ gateId, status }`. It runs when the gate opens,
  and when the next message approves, declines, or leaves it open. The part
  is emitted only after the write succeeds. No other code path emits it.
- The `data-gate` part carries no status.
- The UI shows each gate with the status from the latest `data-gate-status`
  part for its `gateId`.
- `statusOf` returns `needs-you` when any `gateId`'s latest status in the
  chat is `pending`, not only a gate in the latest message (§ 6).
- Because chats are not saved (§ 7), on each chat's first turn the package
  expires every `pending` row from an older `chatId`.

The stream is a view of the row that the same function writes, so the two
cannot disagree.

```ts
export interface Gate {
  open(req: GateRequest, chatId: string): Promise<void>;   // pending row
  decide(gateId: string, status: "approved" | "declined" | "expired", typedText?: string): Promise<void>;
  pending(chatId: string): Promise<GateRequest | null>;
  expireOtherChats(chatId: string): Promise<void>;
}
```

**The gate-log row** (Supabase table `gate_log`, one row per gate):

| column | type | note |
|---|---|---|
| `id` | uuid pk | = `gateId` |
| `user_id` | uuid | `auth.uid()`; access rule: own rows only |
| `chat_id` | text | |
| `kind` | text | `spend` (the column stays text for later kinds) |
| `label` | text | |
| `text_hash` | text | sha256 of what was shown; no copy of the text (rule 12) |
| `gate_line` | text | exactly as shown |
| `amount_usd` | numeric | |
| `status` | text | `pending` · `approved` · `declined` · `expired` |
| `typed_text` | text null | the approving message, i.e. `yes` |
| `created_at` | timestamptz | |
| `decided_at` | timestamptz null | |

The user may insert rows. A database function moves `status` from `pending`
exactly once. There is no other update, and no delete except `delete_account`.

**Later, not built in the MVP:** when the server loop comes (step 7) or a web
tool that sends or submits is added, `deferGate` and the kinds `send`/`submit`
come back through a design gate. `deferGate` never approves: it writes a
`deferred` row and leaves the item in `plan.md § Waiting on you`.

**Prevents:** spending past the limit without the candidate's own word;
prompt injection from a job post or web page approving a gate (only an
exact, typed `yes` counts, and the model cannot write the candidate's
message); a gate line the model paraphrased (code copies it); a status light
and a gate card that disagree.
**Proved by:**
- step 4's gate test: no spend past `spendGateUsd` without a logged typed yes;
- a `matchGateReply` table test: `yes`, `Yes.`, `YES!` typed approve; `yes but…`,
  `y`, `sure`, pasted text containing yes, and a `ui`-origin `yes` do not;
- a test that the gate line equals the spend line in the bundled
  `gate-grammar.md`;
- a `statusOf` test: a question asked while a gate is open still reads
  `needs-you`;
- a test that a new chat expires older `pending` rows.

---

## 4. MVP tools

Nine tools, plus a tenth proposed (`check_language`). Each result is small; the
full output goes to a file when it matters (rule 11). Every tool failure goes
back to the model as `{ error: { code, message } }` and is never thrown into
the stream.

| tool | input | output |
|---|---|---|
| `load_skill` | `{ name: "profile" \| "evaluate" \| "apply" \| "coach" }` | `{ path, content }` - the SKILL.md (§ 7) |
| `read_file` | `{ path }` - a workspace path, or `skills/…` for the bundle | `{ path, content, readOnly }`; `.pdf`/`.docx` return `{ path, text, extracted: true }` |
| `write_file` | `{ path, content }` | `{ path, written: true }` or `version_conflict` / `read_first` |
| `list_files` | `{ dir? }` | `{ files: { path, size, updatedAt }[] }` |
| `bash` | `{ command }` | `{ stdout, stderr, exitCode, changed: string[] }` |
| `web_search` | `{ query, maxResults? (≤ 5) }` | `{ results: [{ url, title, excerpt }] }` |
| `fetch_job` | `{ url, saveTo? }` | `{ board, company, title, location, url, text, compensation?, savedTo? }` or `unsupported_url` |
| `estimate_cost` | `{ steps, webSearches, action }` | `{ lowUsd, highUsd, balanceUsd, needsGate, method }` |
| `request_gate` | `{ kind: "spend", amountUsd, label, text }` | `{ gateId }`, and the turn ends (§ 3) |
| `check_language` *(PENDING OWNER)* | `{ files: string[] }` | `{ report, usd }` |

Details:

- **Versions are tracked by the package, not the model.** The package keeps,
  per chat, the last version it saw for each path. That comes from
  `read_file`, from `write_file` results, and from `bash` write-backs.
  `write_file` sends that version. A path the chat has never seen returns
  `read_first` (for an existing file) or is created (`expectedVersion: null`).
  On `version_conflict` the tool result tells the model to re-read the file
  and redo its change. So after `record_verdict` rewrites `jobs.md` through
  `bash`, a later `write_file` on `jobs.md` does not conflict.
- **`read_file` on `.pdf`/`.docx`** extracts the text each time it is read.
  No second text copy is saved (rule 12). **UNVERIFIED:** that `pdfjs-dist`
  and `mammoth` run in both Node and the browser without runtime-specific
  imports. If they don't, the extractor becomes an injected dep.
- **`bash`** runs just-bash over an in-memory copy of the workspace (each file
  is loaded the first time it is touched). The bundle is mounted read-only at
  `skills/`, and the workspace is the working directory. After each command,
  every file it changed goes back through `WorkspaceStore.write` with its
  tracked version. A conflict fails the command with exit code 1 and names the
  file. `python3` is a **custom command** (§ 5), and just-bash's own Python
  stays off (`python: false`). There is no network inside bash.
- **`web_search`** makes one OpenRouter call with the web plugin on the same
  model (`plugins: [{ id: "web", max_results }]`) and returns the
  `url_citation` annotations. **UNVERIFIED:** how `@openrouter/ai-sdk-provider`
  passes the plugin and exposes the annotations. The alternative is the
  `openrouter:web_search` server tool. This needs a key, so it is part of
  spike 1's keyed re-run.
- **`fetch_job`** accepts only these URL shapes and calls only these public
  APIs (the same hosts `search_ats.py` already uses):

  | board | job URL | API call |
  |---|---|---|
  | Greenhouse | `boards.greenhouse.io/{b}/jobs/{id}`, `job-boards.greenhouse.io/{b}/jobs/{id}` | `GET https://boards-api.greenhouse.io/v1/boards/{b}/jobs/{id}` |
  | Lever | `jobs.lever.co/{c}/{id}` | `GET https://api.lever.co/v0/postings/{c}/{id}` |
  | Ashby | `jobs.ashbyhq.com/{b}/{id}` | `GET https://api.ashbyhq.com/posting-api/job-board/{b}?includeCompensation=true`, then pick `{id}` |
  | SmartRecruiters | `jobs.smartrecruiters.com/{c}/{id}[-slug]` | `GET https://api.smartrecruiters.com/v1/companies/{c}/postings/{id}` |

  Any other URL, including a company's own careers page, returns
  `unsupported_url` with "paste the posting text". That is the likelier real
  path, and the fixtures should show it. HTML in the description becomes plain
  text. `saveTo` writes the text straight to the workspace, so the posting is
  saved without passing through the model first (rule 11). The text is data,
  not instruction (Tier 0).
  **UNVERIFIED:** that the single-posting endpoints (not only the board lists
  tested 2026-09-22) allow browser requests, and that Ashby has no
  single-posting public endpoint.
- **`estimate_cost`** is computed by code and returns a range with its method
  written out:
  - the price per token comes from `GET /api/v1/models` for the chat's model,
    cached for the session;
  - `lowUsd` = `steps` × the median cost per step so far in this chat, and
    `highUsd` = `steps` × the highest cost per step so far. On a chat's first
    turn, both use the per-step cost measured in step 4's journey run (a
    constant in the package, with its date);
  - web searches are added at the plugin's listed price;
  - `balanceUsd` = `deps.balance()`;
  - `needsGate` = `highUsd > spendGateUsd`.

  The code emits a `cost` card (§ 6.2). The card is information only; the one
  confirm is the spend gate. There is no second "say go" word.
- **Spend enforcement in the loop.** Each turn has an allowance: `spendGateUsd`,
  or the `amountUsd` of a spend gate approved by the message that started
  this turn. The loop adds up measured cost after each step. If the next step
  would go past the allowance, the loop stops before that step and opens a
  spend gate itself. The amount is spent-so-far plus the last `highUsd` (or
  `spendGateUsd` if there was no estimate), and the label is "Continue this
  run". A typed yes starts the next turn with the new allowance, and the model
  resumes from the files.
- **`check_language` (PROPOSAL, PENDING OWNER).** `apply/SKILL.md:75` requires
  an independent language checker on every delivered document, and
  `profile/references/language-check.md` says to spawn one. On the web that is
  one separate model call with no tools and a fresh context, built by code
  from:
  - `language-check.md` word for word;
  - the rule sources it names (`base-resume.md § Claim rules`,
    `voice.md § Never-say list`);
  - the named documents.

  It returns the checker's verdict table word for word, plus its cost. At
  Sonnet 5 prices, an estimated 4,000–7,000 input tokens and about 600 output
  tokens is roughly **$0.015–$0.02 per call**, or about $0.04 for a résumé and
  a letter at two passes each. That is an estimate to be measured in step 4.
  The skill prose is unchanged: the model calls this tool where the prose says
  "spawn a subagent", and the host note (§ 7) says so.
  **Alternative:** defer it. The web MVP then ships without the language
  check, the gap is recorded in step 4's conduct results (t15 is the case that
  measures it), and the reply says the check did not run. Either way, O
  decides before step 4.

**Prevents:** the model narrating a write it did not make (every write goes
through one store call); version conflicts on files a script rewrote;
fetching arbitrary pages (only four API hosts); a big run with no cost shown
first (rule 5); a precise-looking cost number nobody computed (rule 8); a
delivered document with no language check and nothing said about it (rules 8
and 14).
**Proved by:** step 4 unit tests per tool against the in-memory store and a
stubbed `fetch`; a test that `fetch_job` rejects any host outside the four; a
test that a `bash` write-back then a `write_file` on the same path succeeds; a
test that a turn that would pass its allowance stops at a spend gate before
the step runs.

---

## 5. Checkers to port (step 3)

Found by grepping `skills/{profile,evaluate,apply,coach}/SKILL.md` and
`references/` for `scripts/`. Seven scripts plus one library. The skill prose
is not changed.

**Dispatch rule:** the `python3` custom command takes its first argument and
matches the **file name** against the port table. So
`python3 scripts/check_materials.py`,
`python3 ../apply/scripts/check_materials.py`, and
`python3 skills/apply/scripts/check_materials.py` all reach the same port (the
skills really do call the relative forms). The rest of the arguments go
through the same flag parser. An unknown script, `python3 -c`, or no argument
exits 127 with `not available in the web app: <name>`. Output text and exit
codes must match the Python byte for byte.

| script | called by | CLI | reads | writes | exit |
|---|---|---|---|---|---|
| `apply/scripts/check_materials.py` | apply; profile (base résumé loop) | `--workspace DIR [--resume F] [--letter F] [--base F]` | the résumé, letter, `base-resume.md`, `voice.md` | nothing | 0 clean or WARN only · 1 any FAIL · 2 bad flags |
| `apply/scripts/proposal_block.py` | apply | `--workspace DIR --application F [--base F]` | `applications/<key>.md` tables, base résumé | nothing (prints the block) | 0 · 1 any FAIL · 2 bad flags |
| `apply/scripts/render_resume.py` | apply | `--md F [--html F] [--pdf F] [--pages N=2] [--strict]` | the résumé `.md` | `.html` | 0 always · 1 over page target with `--strict` · 2 bad flags |
| `evaluate/scripts/record_verdict.py` | evaluate | `--workspace DIR --company S --title S --verdict {strong,investable_stretch,long_shot,weak} [--score 0-100] [--reasons] [--dealbreakers] [--url] [--location] [--jd-file] [--company-file] [--track {A,B,C}]` | `jobs.md` | `jobs.md` (upsert on company + title) | 0 · 2 bad flags or score out of range |
| `search/scripts/update_job.py` | evaluate, apply, coach | `--workspace DIR --company S --title S (--stage STAGE \| --dismiss [--reason S] \| --restore)` | `jobs.md` | `jobs.md` | 0 · 2 not exactly one match, or bad flags |
| `search/scripts/jobs_md.py` | library for the two above | - | `jobs.md` | `jobs.md` | - |
| `profile/scripts/check_files.py` | every MVP skill at session close | `--workspace DIR [--skills DIR]` | every workspace file with a schema; the skills' `schema.md` files and relative links | nothing | 0 · 1 any FAIL (or no schemas found) |
| `coach/scripts/check_closeout.py` | coach at session close | `--workspace DIR [--stage S] [--asked Q]… [--minutes N=30]` | `plan.md` text and its `updatedAt` | nothing | 0 · 1 any FAIL · 2 bad flags |

Port notes:

- **Time:** `record_verdict`/`update_job` stamp `now_iso()`, and
  `check_closeout` compares `plan.md`'s modified time with now. The ports read
  `deps.clock` and `FileInfo.updatedAt`, so parity tests can freeze time.
- **`check_files --skills`** defaults to the bundle at `skills/`. It reads
  every skill's `schema.md`, not only the MVP four's, so the **whole `skills/`
  tree is bundled** (read-only; it costs bundle bytes, not context words).
- **`render_resume`:** the port keeps the markdown → HTML builder and the word
  count, writes `--html`, and prints `words: N  ->  <path>` exactly. `--pdf` is
  ignored with a one-line note; the candidate prints the sandboxed HTML to PDF
  from the browser. Pages are not measured on the web until a method is
  proven (**UNVERIFIED**), so no card or reply claims a page count. The parity
  test covers the HTML and the word line.
- **Out of the MVP:** `outreach/scripts/check_messages.py` is named in
  `profile/references/candidate-voice.md` but checks outreach drafts, and
  outreach is not in the MVP. It exits 127 until outreach ships.
- **How parity cases are counted:** the Python tests call functions in
  process, so they cannot be replayed directly. Step 3 builds a CLI case
  corpus, `tests/parity/cases/<script>/<case>/`, with the input files, the
  argv, and the expected stdout, stderr first line, exit code, and changed
  files, all generated by running the Python script. Every `def test_` in
  `test_check_materials.py`, `test_proposal_block.py`, `test_jobs_md.py`,
  `test_check_files.py`, `test_check_closeout.py`, and
  `test_render_resume.py` gets at least one case. A check fails if any test
  function has no case. That makes the corpus the known denominator for "100%".
  Plus one argparse-error case per script.
- **Known parity risk:** regex differences between Python `re` and JS
  (`\w`/`\b` on non-ASCII, `re.S`/`re.M` semantics, case folding). The corpus
  must include accented text (e.g. "résumé") for `check_materials` and
  `check_files`.
- **Spike 2 accepted on the mechanism, not the letter.** It proved dispatch
  and the shared in-memory file system with `check_closeout` and an exact-path
  match. **Step 3's first task** proves file-name dispatch for all three
  relative forms and `check_materials` parity on the corpus. Browser cost to
  note: just-bash adds about 355 KB gzipped (spike 2).

**Prevents:** skill prose forking between the web and local (rule 12); a
checker that behaves differently in the browser (rule 14).
**Proved by:** step 3's parity test over the corpus: 100% identical stdout,
stderr first line, and exit code, wired into `tests/run.py`, plus the
case-coverage check above.

---

## 6. Chat transport

### 6.1 The transport and the envelope

The UI uses the AI SDK's `useChat` with a custom `ChatTransport`. The names
below are checked against the installed `ai@7.0.111` type definitions:

```ts
interface ChatTransport<UI_MESSAGE extends UIMessage> {
  sendMessages(options: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: UI_MESSAGE[];
    abortSignal: AbortSignal | undefined;
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk>>;
  reconnectToStream(options: { chatId: string; abortSignal?: AbortSignal }
    & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk> | null>;
}
type ChatStatus = "submitted" | "streaming" | "ready" | "error";
```

There are two implementations of one interface. `agentTransport(coach)` calls
`coach.stream()`. `mockTransport(fixture)` replays a script. Both return
`null` from `reconnectToStream`, because the loop lives in the tab. Swapping
mock for real is one line (step 5b exit).

**The envelope** - what an assistant message's `parts` can hold:

| kind | part | data | UI shows |
|---|---|---|---|
| text | `text` | SDK standard | prose |
| tool activity | `tool-<name>` | SDK standard; states `input-streaming`, `input-available`, `output-available`, `output-error` | a collapsed "ran …" line that expands to input and output |
| card | `data-card` | `{ card: CardType, props: object, ref?: string }` - built by code only (§ 6.2) | the card; `ref` (a workspace path) opens the side panel |
| gate | `data-gate` | `GateRequest` (§ 3), no status | the "needs your word" card; no approve button |
| gate status | `data-gate-status` | `{ gateId, status }` | updates that gate's card (latest wins) |
| error | `data-error` | `{ code: "over_balance" \| "model_error" \| "tool_error" \| "offline" \| "step_cap", message: string, retryable: boolean }` | the error card |

- `CardType` = `verdict` · `plan` · `document` · `checker` · `cost`.
- `data-error.message` is a fixed, generic sentence per `code`, written by the
  loop (for example, "Your balance ran out partway through. What's done is
  saved."). What was done is the model's to say on the next turn, from the
  files.
- User messages carry `metadata: { origin: "typed" | "ui" }` (§ 3) and may
  carry `file` parts with `workspace:` URLs (§ 2).
- The SDK's tool-approval chunks (`tool-approval-request`,
  `tool-approval-response`) are **not used**. They approve with a boolean from
  a UI call, which is a button in all but name (rule 7).

**Status is worked out from the stream, not sent:**

```ts
statusOf(messages, chat): { state: "idle" | "thinking" | "working" | "needs-you" | "done"; action?: string }
```

In order, first match wins:

1. `needs-you`: any `gateId` whose latest `data-gate-status` in the chat is
   `pending`; `action` = that gate's `label`.
2. `working`: `chat` is `streaming`, and the latest part is a tool part not
   yet `output-available` or `output-error`; `action` = the UI's label for
   that tool (`design-web-ui.md` § 1.3).
3. `thinking`: `chat` is `submitted`, or `streaming` with any other latest part.
4. `done`: `ready` or `error` after at least one turn in this chat.
5. `idle`: no turn yet in this chat.

**The mock** (steps 5a and 5b):

- **The script:** a fixture is `{ files: Record<path, string>, turns: [...] }`.
  `files` seeds an in-memory `WorkspaceStore` that the UI uses too, so the side
  panel opens real content.
- **Replay:** each `sendMessages` emits the next scripted assistant message as
  chunks, with about 150 ms between chunks so `working` shows. The chunks are
  `start`, `text-start`/`text-delta`/`text-end`,
  `tool-input-available`/`tool-output-available`, `data-*`, and `finish`.
- **Gates:** at an open gate, the mock calls the real `matchGateReply`.
  `approve` plays the scripted approved branch; anything else plays a fixed
  "not approved" branch.
- **Fixture tool outputs** (stdout, files, cards) must come from **running the
  real scripts** on the step 2 fixture workspace, and cards must come from the
  real card builder (§ 6.2). A hand-typed output is a fixture bug. Reviewer
  findings B8, B9 and S9 are for the designer to fix in the fixtures.

### 6.2 Where every card comes from

The model never writes a card or its props. After each tool result, the
package runs one fixed table. A card is a **receipt of a file or a script's
output** (rule 11). The reasoning stays in the model's prose reply.

| after | card | props are built from | `ref` |
|---|---|---|---|
| `estimate_cost` | `cost` | the tool's own result: `action`, `lowUsd`, `highUsd`, `balanceUsd` | - |
| `bash` running `record_verdict.py`, exit 0 | `verdict` | the `jobs.md` row the script just wrote, read through the `jobs_md` port: company, title, verdict tier, score, track, reason (`fit_reason` word for word), dealbreakers (word for word) | the row's `jd_file` |
| `bash` running `check_materials.py` | `checker`, one per checked file | stdout parsed by the script's own format: `LABEL name: pass\|FAIL (n fail, m warn)`, then `  [LEVEL] msg` lines, word for word | the checked file |
| `bash` running `render_resume.py`, exit 0 | `document` | the path from the `--md` argument; `words` from the `words: N  ->  path` line; `htmlPath` from that path when it is inside the workspace; badge = this chat's latest `checker` result for the same `.md` (`not-run` if none) | the `.md` |
| `bash` running `check_closeout.py`, exit 0 | `plan` | `plan.md § Board / To do`, parsed by the existing `parsePlan` in `workspace-core.mjs` (moved to a shared module); the stage from `--stage` | `plan.md` |

Consequences for `docs/design-web-ui.md` (the designer owns the prop types):

- A prop with no source in this table is dropped. That covers `whyReasons`
  (use `reason`), `verifyWithRecruiter`, `checkerSummary`, `pdfPath` (use
  `htmlPath`, and Download PDF = print of the sandboxed iframe), page counts,
  `goAheadInstruction`, and `DocumentCardProps.filePath` (read the wrapper's
  `ref`).
- **Verdict card vs the summary card (S8):** the prose reply is evaluate's
  summary card, unchanged, including its "Your criteria" line. The verdict
  card is only the receipt of what was written to `jobs.md`. They show the same
  tier on purpose: one is what the model says, the other is what the file
  says (rule 11). No `criteriaLine` prop is needed.
- The expanded "ran …" line, the `checker` card, and the `document` badge all
  come from one parse of one stdout.
- A cover letter gets a `checker` card (from `check_materials --letter`) but no
  `document` card, because it is not rendered.

**Prevents:** UI rework when the real agent replaces the mock; a card that is
narration dressed up as a file (rule 11); a status light that disagrees with
the gate log; a gate approvable by a click.
**Proved by:** step 4 tests that feed real script stdout through the card
builder and compare with expected props; a test that no model output can
produce a `data-card`, `data-gate`, or `data-gate-status` part; step 5a's
exits (every card and all five states render from fixtures, and the gate has
no approve control); a `statusOf` table test; step 5b's exit that the diff is
the transport swap only.

---

## 7. Staged skill loading and the per-turn window

The same tiers as `docs/loading-map.md`, from the read-only bundle:

1. **Always on (the system prompt):**
   - Tier 0: the workspace's `CLAUDE.md` if present, else the bundled
     `skills/profile/templates/workspace-CLAUDE.md` (886 words today).
   - The **host note**, about 60 words: this app cannot send, submit, click,
     or open pages. The candidate sends and submits, and each one goes in
     `plan.md § To do` with its prepared file. Where a skill says to spawn a
     language checker, call `check_language` (if adopted). Only the tools
     listed exist.
   - Tier 1: the `description:` lines of the **four MVP skills** only
     (profile, evaluate, apply, coach; 310 words).
   - The tool descriptions: a budget of **350 words** for the ten tools.
2. **On match:** the model calls `load_skill(name)`. The result is that
   `SKILL.md` with its bundle path, so its relative links resolve.
3. **On demand:** `read_file("skills/<skill>/references/<file>.md")`.
4. **Never loaded:** scripts run through `bash`; only their output enters
   context.

**The per-turn target is ~3,300 words** (Tier 0 grew; owner-restated). That is
the always-on block (about 1,600) plus one `SKILL.md` (567 to 1,499). Profile,
the largest body, lands slightly over. That is B1's problem, not the loader's.

**The history window (chat not saved):**

- The package re-sends at most `windowWords` (default 4,000) of history. It
  counts back from the newest message and drops whole older turns first.
  Tool outputs count toward it.
- The latest user message is always kept.
- A loaded `SKILL.md` that has fallen out of the window is simply loaded
  again when needed. The loader skips it only while it is still in the
  window.
- Gate state does not depend on the window, because it lives in `gate_log`.
- A reload starts a new `chatId` with no history. `plan.md` and the other
  files carry the work across (goals doc: every session that changed the
  picture leaves a file behind).
- So words per turn = the ~3,300 instructions + at most 4,000 history,
  measurable on turn 1 and on turn 20 alike. Cost per turn is bounded.

**Prevents:** the web loader loading more than the local one (rule 15);
cost per turn growing without limit (rule 5); a saved transcript that export
leaves out (rule 9); the web runtime drifting from the skills `claude -p` is
measured on.
**Proved by:** step 4's test that counts the words in the system prompt, the
tool descriptions, and one loaded `SKILL.md`, and compares them with
`python3 tests/word_report.py` on the same skills commit (within 10%, with the
host note and the tool descriptions reported as their own lines); a 20-turn
headless run whose re-sent history never passes `windowWords`.

---

## 8. Key and balance

The only server code in the MVP is one Supabase Edge Function,
`openrouter-key`. It holds the OpenRouter **provisioning** key (a server
secret).

**The balance is one number:** what the candidate can still spend =
`accounts.balance_usd` − the live key's usage = the live key's remaining
limit. `balance_usd` is the credit left at the moment the live key was
minted.

| action | who may call | does |
|---|---|---|
| `mint` | the user's session | if there is a live key: **disable** it, read its usage, subtract that from `balance_usd`, delete it. Then create a new key with `limit = balance_usd` and return it once |
| `revoke` | the user's session | disable, read usage, subtract, delete (sign-out) |
| `delete_account` | the user's session | `revoke`; delete every object under `users/{uid}/`; delete the `gate_log` and `accounts` rows; delete the auth user (rule 9) |
| `raise` | **service role only**, never a user session | add an amount to `balance_usd` and `PATCH` the live key's `limit` up by the same amount |

Disabling before reading closes the race where the old key spends between the
read and the delete.

OpenRouter endpoints: `POST /api/v1/keys` (`name`, `limit`),
`PATCH /api/v1/keys/{hash}` (`limit`, `disabled`), `DELETE /api/v1/keys/{hash}`
(from OpenRouter's provisioning docs). The key string is returned only at
creation.

**Funding for the beta (PENDING OWNER):** an admin sets a starter credit with
`raise`. There is no payment page in the MVP. A new account starts at $0 until
the admin credits it, and the first-run screen says so.

**Row** `accounts` (own row readable, written only by the function):
`user_id` uuid pk · `balance_usd` numeric · `key_hash` text null ·
`updated_at`.

**What the browser holds:** the user's own OpenRouter key, **in memory only**
(not localStorage, cookies, or the build: the key is fetched at run time, never
read from a build-time env var), and the Supabase session.

**One tab.** The app takes a Web Locks API lock on start. A second tab shows
"Ten is open in another tab" and does not mint, so it cannot revoke the first
tab's key in the middle of a run. A reload in the same tab mints again, which
rotates the key.

**`deps.balance()`** returns the live key's remaining limit. The balance chip
and `estimate_cost` both read it, and nothing else holds a balance (rule 12).
The UI re-reads it when a turn ends and when the window regains focus. There
is no polling. **UNVERIFIED:** that `GET /api/v1/key` with the user's own key
returns `limit_remaining`. If not, the function gains a `status` action.

**Over the limit:** OpenRouter rejects the call (**UNVERIFIED** status code,
expected 402; spike 4 records it). The loop turns that into a `data-error`
`over_balance` part and ends the turn. It is not a broken loop (step 5b exit).

**Prevents:** a server-side secret in the client bundle; a user raising their
own balance; a leaked key spending more than its owner's balance; a key living
on after sign-out; a second tab killing a run; an account that can't be
deleted.
**Proved by:** spike 4; step 5b's exits (no secret in the bundle except the
user's own key; over-limit shows a clear message); function tests: `raise`
with a user token is refused, `mint` twice leaves exactly one live key and the
right balance, and `delete_account` leaves no objects or rows.

---

## Step-1 spikes

**Pass criteria, verbatim from the plan.** Each is a one-page pass/fail note in
`docs/spikes/`.

1. The AI SDK plus `@openrouter/ai-sdk-provider` runs **in the browser**: it
   streams, calls tools in a loop, and a cache read shows up on turn 2 with a
   Claude model.
2. just-bash custom commands: running `python3 skills/apply/scripts/check_materials.py <file>`
   inside just-bash reaches a JS function, and its output and exit code match
   the Python script's.
3. Supabase Storage isolation: user A's token cannot list, read, or write
   `users/B/…`.
4. OpenRouter: a provisioned key with a credit limit is rejected once over the
   limit, and a provider filter restricts calls to providers that keep no data.

**Where they stand:**

- **Spike 1: BLOCKED, not a pass.** The real pass needs a key: one
  `streamText` call on `anthropic/claude-sonnet-5`, streamed through
  `toUIMessageStream` in the page, with a tool loop and a cache read on turn 2.
  A coder is re-doing the parts that need no key:
  - `streamText` (not `generateText`) → UI message stream in the page, with a
    mock model;
  - the provider's outgoing request captured through a stub `fetch`, showing
    the model slug and the provider filter;
  - the key read at run time, not from a `VITE_` build variable.

  Still needing a key: the streamed call, the turn-2 cache read, and the
  `web_search` annotation shape (§ 4).
- **Spike 2: pass on the mechanism** (dispatch and a shared in-memory file
  system, shown with `check_closeout`). The letter of the criterion
  (`check_materials`, file-name dispatch) moves to step 3's first task (§ 5).
  O accepts this or asks for a re-run.
- **Spikes 3 and 4: no notes yet.** Spike 3 also records whether Storage
  honours `If-Match` against a stale ETag, and whether `updated_at` changes on
  overwrite. Spike 4 also records the over-limit status code, and which of
  `provider.data_collection: "deny"` / `provider.zdr: true` it used.
