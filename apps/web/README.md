# apps/web — the web app

Two builds from one codebase, switched by ONE line in `src/main.tsx`
(`SHOW_MOCK_CONTROLS`, plan step 5b's "one-line swap"):

- **`npm run dev` / `npm run build:preview`** — the **mock preview**,
  unchanged from step 5a: it replays the fixture conversations in
  `fixtures/*.json` through `MockChatTransport` (the AI SDK's own
  `ChatTransport` interface) so the owner can see the layout, the avatar
  states, the cards, and the gate protocol with no network call, no API
  key, and no real candidate data — every fixture is an invented persona.
- **`npm run build`** (the default, production build) — the **real app**
  (step 5b): sign-in → one membership check → the chat, running
  `packages/agent`'s `createCoach(deps)` **in the browser tab**, through
  the `ten-model-proxy` Edge Function (never a model key in the bundle) and
  `SupabaseWorkspaceStore`. See "The real backend (step 5b)" below.

Both builds share every UI component (Header, Transcript, Composer,
SidePanel, Cards, GateCard, ErrorPart) unchanged — the diff really is the
transport, the store, and the balance/error wiring, per the step 5b exit
criterion.

## Run it

```bash
cd apps/web
npm install
npm run dev
```

Opens on **http://localhost:5173**. Pick a fixture from the "Preview:
fixture" dropdown in the header, then either type the fixture's own
messages yourself or click **Autoplay** to have it type them for you.
Autoplay stops on its own the moment a gate opens — it never types the
fixture's own "yes" for you (rule 7); type `yes` yourself to approve the
spend gate — there is no approve button.

The fixture picker and Autoplay button are **dev/preview-only controls**:
visible under `npm run dev` (`import.meta.env.DEV`) and under
`npm run build:preview` (sets `VITE_SHOW_MOCK_CONTROLS=1`), **absent from
the default `npm run build`** — see `src/components/Header.tsx`'s
`SHOW_MOCK_CONTROLS`. There is no committed `.env`; the flag is opt-in per
build, not a repo default.

## Other scripts

```bash
npm run build         # tsc --noEmit + vite build -> dist/ — the real
                       # production bundle: no fixture picker, no Autoplay
npm run build:preview # same, with VITE_SHOW_MOCK_CONTROLS=1 — for trying
                       # the mock controls against a built (not dev) bundle
npm run preview        # serves dist/ on http://localhost:4173
npm test               # node --test — this package's own unit tests (pure
                        # helpers + the mock transport), no DOM, no browser
npm run verify:screens [dir]
                       # Playwright: plays mvp-journey and gate-moment end
                       # to end against a built preview server, asserts the
                       # cards render, the gate has no button, and the
                       # "Print / Save as PDF" iframe blocks an injected
                       # <script>; saves screenshots to [dir] (arg) or
                       # $SCREENSHOT_DIR or the gitignored
                       # apps/web/.local/screenshots/ by default
```

### The independent tester's suite (`tests/web/`)

Owned by the tester, not this package — don't edit it. Run from the repo
root:

```bash
node --test tests/web/*.test.ts          # pure helpers, mock transport,
                                          # fixture/card-table conformance
(cd apps/web && VITE_SHOW_MOCK_CONTROLS=1 npx vite build --outDir /tmp/web-e2e \
  && npx vite preview --outDir /tmp/web-e2e --port 4311 --strictPort) &
node tests/web/e2e.mjs http://localhost:4311/
```

`python3 tests/run.py` (repo root) also runs `node --test tests/web/*.test.ts`
as one more unit in its own pass/fail count — skipping loudly (a printed
`SKIPPED` line, not silence) if `node` isn't on `PATH`. It does not run
`tests/web/e2e.mjs` (a Playwright script, not a `node --test` suite — run
it separately, as above, against a built preview server).

## What's here

- `src/agent-helpers.ts` — `matchGateReply`, `statusOf`, `parsePlanTodo`,
  pure functions per `docs/design-web-agent.md` § 3/§ 6.1/§ 6.2.
  `parsePlanTodo` accepts a "To do" heading with a trailing count
  ("To do (2)"), normalizes CRLF, and its `ref` is the first backticked
  span that contains "/" or ends in a file extension (never just the
  first backticked span — a line can quote a non-path word first). No
  window/document/localStorage/Node-only API.
- `src/mock-transport.ts` — `MockChatTransport`, § 6.1's "Mock replay" in
  full:
  - Outside a pending gate: content-addressed replay (a reply's text is
    looked up against the fixture's own remaining user messages, not a
    position counter that can drift) — a match replays that scripted turn.
  - At a pending gate: a reply that equals the fixture's own **next**
    scripted user message (not a free search) replays that scripted turn
    verbatim (e.g. `gate-moment.json`'s `m3` replays `m4`'s richer
    non-approval content, never a canned line); a typed exact "yes" jumps
    to the turn after the fixture's own scripted "yes" (found by
    searching, so it's correct no matter how many off-script replies came
    first); a decline word (no/don't/cancel/stop) declines; anything else
    gets the one fixed pending line and does not move the read position.
  - A gate's status leaves "pending" **exactly once**: once a gate has
    resolved, a later reply is never allowed to replay that gate's own
    resolution turn again (which would silently re-emit a status) — it's
    treated as an ordinary off-script message about that resolved gate
    instead, built only from the gate's own already-on-screen `label`.
- `src/store.ts` — `FixtureStore`, a `WorkspaceStore` (`docs/design-web-agent.md`
  § 2: async `read` -> `FileRead`, `list`, `write`, `upload`) backed by a
  fixture's `files`. The UI never reads a fixture's `files` directly — only
  through this store. Also exposes a mock-preview-only `async balance()`:
  the mock's stand-in for `deps.balance()` (C § 8) — the fixture's own
  explicit `meta.startingBalanceUsd` if it has one, else `undefined`
  ("unknown" — the header chip shows "—"). A workspace having **no files
  does not mean $0** (`gate-moment.json` has `files: {}` mid-conversation,
  not a new account) — only an explicit `meta.startingBalanceUsd`
  (currently `empty-first-run.json`, `5`, matching a member's starting
  credit) ever produces a number here. `gate-moment.json` and
  `over-limit-error.json` declare none, so their header chip stays "—"
  even after a cost card streams (see `ChatShell.tsx` below) — that's a
  deliberate consequence of decoupling the chip from the cost card, not a
  bug: the `cost` card inside the transcript still shows its own
  `balanceUsd`, from `estimate_cost`'s own return (design-web-ui.md § 2.6),
  untouched.
- `src/format.ts` — `formatUsd` (the cost card's numbers: at least 2
  decimals, never rounds one off — keeps whichever is longer, 2 or the
  number's own) and `formatBalanceUsd` (the header chip only: rounds
  **down** to the cent, and a balance at or below zero reads `$0.00`,
  never negative — design-web-agent.md § 8).
- `src/ChatShell.tsx`, `src/App.tsx` — wiring: `useChat` +
  `MockChatTransport`, the fixture picker, Autoplay, theme toggle. The
  balance chip reads `store.balance()` (never the latest `cost` card —
  docs/reviews/proxy-change-review.md S2), read at the same moments the
  real `deps.balance()` is: once on mount/fixture change, at the end of
  each turn, and on window focus. An `over_balance` refusal already on
  screen clamps the reading to `$0.00` regardless of the store's declared
  figure, since that error code only ever fires when the real balance
  isn't above zero. The first-run greeting shows only when the **store**
  is empty (`store.list()` returns nothing) *and* no messages exist yet —
  not merely an empty chat on a fixture whose workspace already has files.
- `src/components/` — Header/Avatar (§ 17, 2026-09-25: `onBuyCredit` — the
  balance chip becomes a real `<button>` only when it's given, real mode
  only; the ⋯ menu gains "Buy credit" the same way, absent outright rather
  than merely disabled when the prop isn't passed, same posture as every
  other real-only menu item here), Transcript, ToolRun (the collapsed
  "ran …" line), Cards (verdict/plan/document/checker/cost — verdict
  labels are `eval.md`'s own tier names; the cost card shows
  `estimate_cost`'s numbers via `formatUsd`, never widened or rounded
  down), GateCard, ErrorPart (each line states only what happened or what
  the candidate can do — never a promise of what the agent itself will do
  next; `over_balance` and `model_error` carry no extra "next step" line
  of their own anymore — the server's own `message` already says what to
  do, per-cause, and a single static line can't fit every cause without
  contradicting one of them), Composer, SidePanel ("Print / Save as PDF"
  opens the sandboxed iframe and calls its own `print()`; sandboxed
  `allow-same-origin allow-modals`, deliberately **no** `allow-scripts` —
  see the code comment in `SidePanel.tsx` — and every `.html` file's own
  content gets a Content-Security-Policy `<meta>` prepended,
  `default-src 'none'; style-src 'unsafe-inline'; img-src data:`, so a
  hostile `<img src="https://...">` beacon can't be fetched either),
  MarkdownView (a small dependency-free renderer for `.md` in the panel).
- `fixtures/*.json` — not owned by this slice; see
  `docs/design-web-ui.md` § 4 and `docs/design-web-agent.md` § 6.1. Edits
  made here for the proxy contract change (r4; `docs/reviews/proxy-change-review.md`
  S2/N3): `empty-first-run.json`'s `meta.startingBalanceUsd` is now `5`
  (a member's credit row starts at $5, not $0); `over-limit-error.json`
  no longer has a `tool-web_search output-error` part or a trailing
  model `text` part after the refusal (the proxy now refuses the next
  call **before** it reaches the model, so nothing composes a reply for
  that step) and its `data-error.message` is the proxy's real 402 text —
  updated again 2026-09-25 for § 17.4/design-web-ui.md § 1.11's replaced
  copy, "Your credit is used up. You can buy more from your balance at
  the top." (was "Your beta credit is used up. Ask the person who invited
  you for more." — buying credit replaces "ask the person who invited
  you" as the next step).

## Known gaps / open questions for the lead

- **N3's hostile-`<img>` beacon: genuinely blocked, but Playwright's
  `request` event still fires for it.** Confirmed directly (see below):
  the CSP `<meta>` does block the fetch — Chromium logs `"Loading the
  image '...' violates ... img-src data:. The action has been blocked."`
  and the request finishes as `requestfailed` with `errorText: "csp"` —
  but Chromium's DevTools Network domain reports `Network.requestWillBeSent`
  (which is what Playwright's `page.on("request")` surfaces, and what
  `tests/web/e2e.mjs`'s "makes no external request" check is built on)
  *before* CSP intervenes, for every resource load, blocked or not.
  There's no sandbox/CSP combination that stops that specific DevTools
  event from firing — it isn't a signal CSP is designed to suppress.
  Everything else in that test passes (no script executes, no
  `postMessage`, no navigation, no popup, still one page). Proof, run
  against a plain `sandbox="allow-same-origin allow-modals"` iframe with
  the same CSP `<meta>` this package uses:
  ```
  requests: [ 'https://tracker.example.invalid/pixel3.png' ]
  failed: [ [ 'https://tracker.example.invalid/pixel3.png', 'csp' ] ]
  console: [ `Loading the image 'https://tracker.example.invalid/pixel3.png' violates
    the following Content Security Policy directive: "img-src data:". The action has
    been blocked.` ]
  ```
  Suggest the test check `requestfailed` with a `csp`-shaped
  `errorText`/blocked-reason instead of the plain absence of a `request`
  event.
- **PDF page count.** Per `docs/design-web-ui.md` § 2.3, no page count is
  ever shown (UNVERIFIED in the browser print layout).
- **Composer `/` skill picker and attach button** are visually present
  (per the wireframe) but inert — the design doc marks the skill picker
  optional ("plain language always works", rule 18), and there's no real
  upload target in a mock preview.

## The real backend (step 5b)

`src/backend/` — pieces built against real Supabase/OpenRouter wire
shapes, each with its own `node --test` unit tests (no live network, no
real key):

- `coach-model.ts` (§ 13.2) — the ONE list, NO imports: the two allowed
  model ids and their candidate-facing names (`"Claude Sonnet 5"` /
  `"DeepSeek V4.1 Flash (testing)"`). `coach-model.test.ts` checks these
  ids against the proxy's own `MODEL_IDS`
  (`supabase/functions/ten-model-proxy/core.ts`) directly — a repo test,
  not a live check, and it fails if the two ever disagree.
- `model.ts` — `createCoachModel({ modelId, proxyUrl, getAccessToken })`:
  the `@openrouter/ai-sdk-provider` (pinned as in `spikes/1-browser-loop`)
  pointed at `ten-model-proxy` instead of `openrouter.ai`; a custom
  `authedFetch` sets `Authorization: Bearer <current Supabase JWT>` fresh
  on every call (never a cached/baked-in key). `modelId` is the active
  model's id (`env.coachModel.id`, § 13.2); the client no longer sets
  `cache_control` itself (the proxy forces its own, Claude only, § 13.1) —
  one place for that fact, not two.
- `gate.ts` — `createSupabaseGate(...)`: the `Gate` interface
  (`docs/design-web-agent.md` § 3) over `ten_gate_open`/`ten_gate_decide`/
  `ten_gate_expire_other_chats`, plus a plain `select` for `pending()`
  (RLS: own rows readable — there's no dedicated read RPC).
- `balance.ts` — `createBalanceFn(...)`: `deps.balance()` via the
  `ten_balance()` RPC.
- `script-runner.ts` — `createRealScriptRunner()`: the real `ScriptRunner`
  the `bash` tool calls, backed by `just-bash` + `packages/checkers`'
  file-name `python3` dispatch (`packages/checkers/src/just-bash-command.mjs`).
  Its own tests run the REAL ported checkers (`check_materials.py`,
  `record_verdict.py`, …), not canned output.
- `web-search.ts` — `createWebSearch({ modelId, ... })`: `deps.webSearch`,
  one raw `ten-model-proxy` call with `model` (§ 13.2: "web search passes
  the model too") and `plugins: [{ id: "web" }]`, parsing the
  forced-`stream: true` SSE response for `url_citation` annotations.
  **UNVERIFIED** (design-web-agent.md § 4's own flag) how the provider
  actually shapes them — this parser degrades to an empty result list
  (never throws) on an unrecognized shape; needs a live-key re-check once
  the proxy spike (§ Step-1 spikes, item 4) has a real budget.
- `skills-bundle.ts` / `skills-bundle-normalize.ts` — the build-time
  `SkillBundle`, via Vite's `import.meta.glob("../../../../skills/**/*",
  { query: "?raw", eager: true })`. Split in two because
  `import.meta.glob` is Vite-only syntax `node --test` can't even import;
  `skills-bundle-normalize.ts` (the key-shape logic) IS unit-tested there,
  and the glob's own file-discovery is verified by a real `npm run build`
  + grepping the emitted bundle (see "Verifying the production build"
  below), not by a `node --test` unit test.
- `upload-errors.ts` — the composer's attach flow: `documents/<name>`,
  then `-2`/`-3` on a clash (retried only for an actual `already_exists`),
  and a plain-language message for every `WorkspaceError` code plus a
  best-effort classification of `SupabaseWorkspaceStore`'s own
  undocumented generic Storage refusals (403/413/400) — see that file's
  header for exactly which half of "the known gap" (case clash, the
  50-object cap, non-member) is closed here vs. still open at the store
  layer.
- `env.ts` — `readEnv()`/`hasTenEnv()`: `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` required; `VITE_MODEL_PROXY_URL` optional,
  defaulting to `<VITE_SUPABASE_URL>/functions/v1/ten-model-proxy`.
  Throws `MissingEnvError` (never silently guesses); `src/main.tsx`
  catches it and shows a plain config-error screen instead of a blank one.
  § 13.2 adds `VITE_COACH_MODEL` to the same resolution: unset/blank ->
  Claude (`coach-model.ts`'s `CLAUDE_COACH_MODEL`, never a silent fallback
  to something else); exactly one of the two ids (trimmed) -> that model;
  anything else is pushed onto the SAME `missing` list under the var's own
  name, so it fails exactly like a missing required var — the existing
  config-error screen already names whatever's in `missing`, so a typo'd
  setting can never make the owner think DeepSeek is running when it
  isn't. § 17.1 (2026-09-25) adds `paypalClientId` (from
  `VITE_PAYPAL_CLIENT_ID`) to the SAME `TenEnv`, trimmed but **not** added
  to the required-vars list — see the env-var table above for why.
- `delete-account.ts` — calls the `ten-delete-account` Edge Function and
  returns its summary. § 17.4 (amended 2026-09-25): the summary no longer
  carries a `creditRows` field at all — the function stops deleting any
  ledger row, so there's nothing to report there.
- `paypal.ts` (§ 17.1, 2026-09-25) — calls the `ten-paypal` Edge Function's
  two endpoints: `createPaypalOrder(opts, pack)` (`POST .../create-order`,
  body `{ pack }` only — the amount always comes from the server's own
  table, never sent from here) and `capturePaypalOrder(opts, orderId)`
  (`POST .../capture-order`). Both throw with the server's own `error.message`
  on a non-2xx response, same shape as `delete-account.ts`. PayPal's own
  decimal strings (`grossUsd`/`feeUsd`/`creditedUsd`) pass through as
  plain strings, never parsed to a float here either.
- `auth.ts`, `supabase-workspace-store.ts`, `workspace-export.ts` — from
  step 2 (SupabaseWorkspaceStore, export/import, auth); not owned by this
  slice, used as-is. `auth-client-adapter.ts` (this slice) adapts a real
  `SupabaseClient` to `auth.ts`'s own `AuthClientLike` — `rpc()` on a real
  client returns a thenable `PostgrestFilterBuilder`, not a structural
  `Promise`, which fails `AuthClientLike`'s type; the adapter `await`s it
  once, no behavior change, no edit to `auth.ts` itself.

`src/real-transport.ts` — `AgentChatTransport`: wraps `Coach.stream()` as
`ai@7`'s own `ChatTransport` interface. This really is the whole diff from
`mock-transport.ts`'s shape — `Coach.stream({ chatId, messages,
abortSignal })` already returns the exact `ReadableStream<UIMessageChunk>`
`sendMessages` must resolve.

`src/real/` — the real screens (`docs/design-web-ui.md` §§ 1.4-1.7):

- `SignIn.tsx` — magic link or email+password, `redirectTo = VITE_SITE_URL`.
- `NotAMember.tsx` — the exact § 1.6 copy, sign-out only.
- `RealApp.tsx` — the state machine: loading → signed-in? → one
  membership check → not-a-member OR (create the root `CLAUDE.md` from the
  bundled Tier 0 once, build `Deps`, `createCoach`) → the chat.
- `RealChatShell.tsx` — the real chat screen: `AgentChatTransport`,
  `SupabaseWorkspaceStore`, `deps.balance()` for the chip, the ⋯ menu's
  export/import/delete/buy credit/sign out, the composer's attach → upload
  wiring. § 17 (2026-09-25) adds `showBuyCredit` state and
  `<BuyCreditDialog>`, wired from both `Header`'s `onBuyCredit` and the
  chip; `onCredited` is `refreshBalance` itself (the SAME function § 8's
  own "read at turn end and on window focus" already uses), so a credited
  purchase refreshes the chip through the one existing path, not a new
  one. `paypalClientId` is an optional prop (default `""`) so a harness
  that predates § 17 (`tests/web/version/harness.tsx`, not owned by this
  slice) keeps mounting this component unchanged.
  Deliberately its OWN file, not a refactor of `ChatShell.tsx` (kept
  unchanged, per the instruction that the mock preview must stay as-is) —
  they share every child component (Header, Transcript, Composer,
  SidePanel), so there's no screen rework, only duplicated hook-wiring
  glue.
- `DeleteBetaDataConfirm.tsx` — § 1.7's four-step confirmation (the
  complete thing, the one sentence word for word, a typed `yes` matched
  the same way `matchGateReply` matches a spend gate's reply, the
  report-back). Its own component, not a reuse of `GateCard` (§ 1.7 marks
  that choice "open for the architect"; C § 3's `GateRequest.kind` is
  `"spend"` only, and this confirmation carries no `gateId` and never
  touches `ten_gate_log`). § 17.4 (amended 2026-09-25): its copy changed —
  credit is no longer named among what's erased ("your workspace files,
  your conversation, and your gate log"), and the one sentence is
  design-web-ui.md § 1.11's own replacement, word for word.
- `BuyCreditDialog.tsx` (§ 17, design-web-ui.md § 1.11, 2026-09-25) — the
  Buy-credit dialog: `$10`/`$20`/`$40` pack buttons, then PayPal's own JS
  SDK buttons (loaded lazily, ONLY once a pack is picked, via a `<script>`
  tag built from `VITE_PAYPAL_CLIENT_ID`, `currency=USD&intent=capture
  &disable-funding=paylater` — § 17.9: "Pay Later off"), wired to
  `backend/paypal.ts`. Every § 1.11 outcome line (credited/pending/
  declined/window_closed/create_failed/not_credited) is its own literal
  string, word for word from the contract — never built from a template
  that could drift. Members only: mounted by `RealChatShell.tsx` alone,
  opened only from the balance chip or the ⋯ menu's "Buy credit" line
  (`Header.tsx`'s new `onBuyCredit` prop) — no card, no chat message, and
  no bundled skill ever mentions or opens it (§ 17.2's rule-7 conditions).
  This file freely uses `window`/`document` (the SDK's own `<script>` tag)
  — it's apps/web UI, not `packages/agent` or a ported checker, which is
  what the no-window/no-document rule actually covers
  (`docs/ARCHITECTURE.md`'s system map).
- `deps.ts` — `buildRealDeps()`: wires every piece above into one `Deps`
  object. `checkLanguage` is left **unset** on purpose — the tool's own
  default (`packages/agent/src/tools/index.ts`) already does "a
  fresh-context call using `deps.model`" (which already routes through
  the proxy), matching § 4's "check_language ... through the same model"
  with no separate wiring needed.

### Env vars (production build only; the mock preview needs none)

| var | required | default |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | — |
| `VITE_SUPABASE_ANON_KEY` | yes (the publishable/anon key, not service-role) | — |
| `VITE_SITE_URL` | yes (read by `auth.ts`'s `siteRedirectUrl()`) | — |
| `VITE_MODEL_PROXY_URL` | no | `<VITE_SUPABASE_URL>/functions/v1/ten-model-proxy` |
| `VITE_SHOW_MOCK_CONTROLS` | no (Vercel Preview environment only) | unset (production) |
| `VITE_COACH_MODEL` (§ 13.2) | no | unset/blank -> `anthropic/claude-sonnet-5` (Claude, the measured model). `deepseek/deepseek-v4.1-flash` switches to DeepSeek (testing only, § 13.6 (2)). Any other value fails the build-time config check the same way a missing required var does. |
| `VITE_PAYPAL_CLIENT_ID` (§ 17.1) | no (but see below) | `""` — the Buy-credit dialog shows "Couldn't start a payment. No money moved." instead of loading the PayPal JS SDK when blank |

Nothing here is secret — the anon key AND `VITE_PAYPAL_CLIENT_ID` are both
meant to ship in the client bundle (RLS/PayPal's own domain-allowlisting
are the actual boundaries); no OpenRouter key, no PayPal client SECRET, no
Supabase service-role key ever reaches this package.
`VITE_PAYPAL_CLIENT_ID` is deliberately NOT in `readEnv()`'s required-vars
list (unlike the three Supabase vars) — buying credit is a member-only
ADDITION (§ 17.2), never load-bearing for the chat itself, so a blank value
must never fail the whole app's boot; only the dialog itself degrades.

**Switching models (§ 13.2/§ 13.6 (2)):** set or remove `VITE_COACH_MODEL`
on Vercel (Production), then run `deploy-prod.sh` — it's a setting change
and a redeploy, never a code change. DeepSeek runs only while the owner
and testers who know it's testing are the active users; before any
outside beta member is invited, remove `VITE_COACH_MODEL` (back to
Claude) and redeploy. § 10's new-version notice stops an already-open tab
from sending on the old build, so the very next send after a switch uses
the new model.

### Deploying to Vercel (project `ten-coach`)

Production is https://ten-coach.vercel.app. Deploy from this machine as a
**prebuilt** upload, never a plain `vercel --prod`: the app imports source
from `packages/` and bundles `skills/` at build time, and a plain upload of
`apps/web` carries neither.

```sh
apps/web/scripts/deploy-prod.sh
```

The script pulls the production env, builds with this repo's
`node_modules`, refuses to upload a bundle holding a home-directory path or
missing the skill text, then deploys.

`VITE_*` values are baked in at build time, so any env change on Vercel
needs a fresh run of the script. The Edge Functions deploy
separately (`supabase/functions/README.md`); `TEN_APP_ORIGIN` must equal the
production origin above or the browser's calls are refused by CORS.

**Deploy order for § 13 (the site's model is a setting), first time —
site → proxy → setting, per `docs/design-web-agent.md` § 13.2 (an agent
never runs any of this; the owner does, in this order):**

1. **Site first.** Deploy `apps/web` with the § 13 code (this change) but
   `VITE_COACH_MODEL` still unset — the site keeps sending Claude, and
   every request (chat AND web search) now names `model` explicitly. The
   OLD proxy still accepts a named `anthropic/claude-sonnet-5` (it only
   ever forced that one model), so nothing breaks mid-rollout.
2. **Proxy second.** Deploy `ten-model-proxy` with the § 13 allowlist
   (`supabase/functions/README.md`'s own deploy steps). It refuses a
   missing `model` (400 `model_not_allowed`) — which, by now, only an OLD
   (pre-§ 13) site tab would ever send, and § 10's new-version notice
   already stops those tabs from sending once the new site build (step 1)
   is live.
3. **Setting last.** Only once both of the above are live, set
   `VITE_COACH_MODEL=deepseek/deepseek-v4.1-flash` on Vercel (Production)
   and run `deploy-prod.sh` again, if/when testing DeepSeek is wanted.
   Until then the setting stays unset and the site keeps running Claude.

Reversing steps 1/2 (proxy before site) would 400 every call from the
CURRENT (pre-§ 13) site build, which never sends `model` at all — that's
why site goes first.

### Verifying the production build

```sh
npm run build          # the real app; the DEFAULT build
grep -o "Preview: fixture" dist/assets/*.js   # -> nothing (mock UI tree-shaken out)
grep -oE '"Autoplay"' dist/assets/*.js         # -> nothing
grep -c "record_verdict\|check_materials" dist/assets/*.js  # -> >0 (the skills glob worked)
grep -riE "sk-or-|service_role" dist/assets/*.js             # -> nothing (no secret baked in)
ls dist/privacy.html                                          # -> present (§ 13.6)

npm run build:preview  # the mock; VITE_SHOW_MOCK_CONTROLS=1
grep -o "Preview: fixture" dist/assets/*.js   # -> present
ls dist/privacy.html                                          # -> present in the mock build too
```

### Known gaps / open questions for the lead (step 5b)

- **No Playwright e2e against a local stub proxy + stub/PGlite Supabase**
  (the plan's step 5b test item) — not built this pass; see the coder's
  hand-back for why and a suggested shape.
- **`packages/agent/src/coach.ts`** — two small, flagged, tested fixes
  outside this slice's own directory: (1) `data-error.message` now passes
  through the proxy's own `{ error: { code, message } }` text when
  present (design-web-ui.md § 2.7), falling back to the old generic
  sentence otherwise; (2) `ReadableStream.from(...)` (missing from the
  installed TypeScript's DOM lib entirely) replaced with a manual
  pull-based `ReadableStream`, same behavior, no `.from()` dependency.
  Both have their own tests in `packages/agent/test/`.
- **`tests/store/*.test.ts`** (the tester's own step 2 suite, not part of
  this slice, "still being updated" per the lead) has 3 pre-existing
  failures once its own `node_modules` are installed (they were SKIPPED
  before, for lack of `node_modules`, not green) — none caused by this
  slice's changes: an NFD-normalization import case, a PGlite stand-in
  that doesn't support keyset pagination's `gt.` operator, and a case
  explicitly self-labeled `(known step 5b gap)` in its own test name —
  see the coder's hand-back.

### § 17 (buying credit with PayPal, 2026-09-25) — flagged for the lead

- **`supabase/functions/ten-model-proxy/handler.ts`/`handler.test.ts`**
  were touched — `MESSAGES.overBalance`, updated to design-web-ui.md §
  1.11's replaced copy ("Your credit is used up. You can buy more from
  your balance at the top."), since that's the server text the `over_balance`
  message this slice was asked to change actually comes from
  (`ErrorPart`/`coach.ts` pass the proxy's own literal `message` straight
  through). `ten-model-proxy` itself is not in this slice's named Edge
  Function scope (only `ten-paypal`/`ten-paypal-webhook`/`ten-delete-account`
  were) — flagged here for the lead's OK rather than a silent edit.
- **Root `tests/` files (the independent tester's, not edited here) will
  now fail** on the OLD `over_balance`/delete-copy text, since both
  changed under the approved § 17.4/§ 1.11 contract:
  `tests/e2e-real/e2e.ts` (lines ~840, ~866, ~953, ~955),
  `tests/web/e2e.mjs` (~190), `tests/web/r4-ui.test.ts` (~67),
  `tests/functions/proxy_money.test.ts` (~27, its own `OVER_BALANCE`
  constant).
- **`docs/design-web-agent.md` § 17.4** also says "When built,
  `ARCHITECTURE.md` § 3–4 and the functions README follow" — the functions
  README followed (`supabase/functions/README.md`); `docs/ARCHITECTURE.md`
  itself was NOT touched (it's outside this slice's named directories) and
  still describes the pre-§ 17 `ten-delete-account`/ledger shape in its §
  3–4 tables and system map. Left for the lead.
- **`supabase/functions/_shared/test-support.ts`** (shared by every
  function's tests, not owned exclusively by this slice) gained a mock
  PayPal server (`startMockPaypal`/`freshPaypalState`), a service-role
  `GET /rest/v1/ten_usage_ledger` membership-by-uid query (for the
  webhook's own `isMemberByUid`), and the § 17.3 paypal-breakdown check on
  the mock ledger insert — listed here since it's a shared file, not
  exclusive to `ten-paypal`/`ten-paypal-webhook`.
- **`tests/sql`** (the independent tester's own SQL harness, § 17.8 item
  7) was NOT extended with a case for the new migration
  (`20260925000000_ten_paypal_credit.sql`) — that's explicitly the
  independent tester's suite per the contract, not this slice's to write.
