# supabase/functions — Ten's two Edge Functions

Contract: `docs/design-web-agent.md` § 8, amended by § 13 ("the site's
model is a setting" — the proxy now allows exactly two models, Claude
Sonnet 5 and DeepSeek V4.1 Flash, each with its own per-call ceiling) and
§ 14 (web search's own per-request price). Built and tested **locally
only** (Deno, mocked OpenRouter and mocked Supabase — see "Tests" below).
**Not deployed by this change.** Every deploy below needs the owner's
explicit approval for that action; the owner, or the lead agent acting
on that approval, runs it. No other agent role (architect, designer,
coder, tester) ever deploys or touches production. Nothing here calls
the live OpenRouter key or a production Supabase project.

```
supabase/functions/
  _shared/
    cors.ts            allowed-origin list + CORS headers (both functions)
    supabase.ts         thin fetch client: Auth, PostgREST RPC/table, Storage API
    test-support.ts     TEST ONLY — local stub OpenRouter + local stub Supabase
  ten-model-proxy/
    core.ts              pure: the request-field allowlist, path match, SSE usage parser
    handler.ts            handleRequest(req, deps, env) — no Deno/Edge-Runtime global
    index.ts              Deno.serve bootstrap; wires real deps from Deno.env
    core.test.ts / handler.test.ts
  ten-delete-account/
    handler.ts / index.ts (same split)
    handler.test.ts
```

Both `handler.ts` files take every side effect (auth, DB, storage, the
upstream call, `waitUntil`) through an injected `deps` object, so the request
logic is testable with `deno test` and no network to a real project. Only
`index.ts` touches `Deno.env`, `Deno.serve`, and `EdgeRuntime.waitUntil`.

## Tests (run these; nothing here needs a deployed function or a real key)

```
deno test --allow-net supabase/functions/
```

Current result (§ 13 "the site's model is a setting", run 2026-09-25):

```
running 12 tests from ./supabase/functions/ten-delete-account/handler.test.ts
... (12 passed)
running 49 tests from ./supabase/functions/ten-model-proxy/core.test.ts
... (49 passed)
running 50 tests from ./supabase/functions/ten-model-proxy/handler.test.ts
... (50 passed)

ok | 111 passed | 0 failed
```

The new coverage (§ 13.1/§ 13.5): the allowlist accepts each id and
refuses a missing/other one (400, no upstream call, no ledger row); a
golden-body test pins Claude's outgoing body byte-identical to before
§ 13; `cache_control` only for Claude, `provider.require_parameters` only
for DeepSeek; each model's own ceiling ($0.273112 / $0.043288, to 1e-9)
drives the meter's fallback and 10× bound; the ledger's `model` column is
the id THIS proxy sent, for either model.

`deno check supabase/functions/**/*.ts` and `deno lint supabase/functions/`
are also clean.

`--allow-net` is required because the tests spin up local loopback HTTP
servers (`_shared/test-support.ts`, `Deno.serve({ port: 0 }, ...)`) to stand
in for OpenRouter and Supabase — no external network is reached, and no
`TEN_OPENROUTER_API_KEY` or Supabase credential is used or needed.

Not covered by these local tests (need a live upstream/project, which this
change explicitly does not touch — see the Step-1 spike-4 note in
`docs/design-web-agent.md`): a ledger row's `usd` matching OpenRouter's own
`GET /api/v1/generation?id=` accounting, a web-search call's cost matching
the key's credit change, a turn-2 prompt-cache read, and streaming from an
actual Vercel build. Those are the owner's live re-run once this is deployed.

## Deploy (owner-approved per action; run by the owner or the lead agent on that approval)

Both functions read Supabase's own auto-injected `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — those are reserved names
the CLI will refuse to let you set yourself; every other Edge Function gets
them automatically once deployed to the project.

```sh
# From the repo root, once linked to career-coach-nextgen (ref ivunfotoggdxbjouumdk):
supabase functions deploy ten-model-proxy --project-ref ivunfotoggdxbjouumdk
supabase functions deploy ten-delete-account --project-ref ivunfotoggdxbjouumdk

# Secrets ten-model-proxy needs (never printed, never committed):
supabase secrets set TEN_OPENROUTER_API_KEY=<the existing OpenRouter key, shared with the live app> \
  --project-ref ivunfotoggdxbjouumdk
supabase secrets set TEN_APP_ORIGIN=<the production Vercel origin, e.g. https://ten.example.com> \
  --project-ref ivunfotoggdxbjouumdk
```

`ten-delete-account` needs no extra secret beyond the auto-injected three —
it never calls OpenRouter and never needs the app origin beyond CORS, which
also reads `TEN_APP_ORIGIN` (set it once; both functions share it).

**Deploy order for § 13 — the site deploys BEFORE this function** (see
`apps/web/README.md`'s own "Deploy order for § 13" for the full three-step
sequence: site → proxy → setting). Deploying the proxy before the § 13
site build would 400 every call from whatever OLD site build is still
live, since it never sent a `model` field at all and this version of the
proxy no longer fills one in.

Preconditions, in this order (per § 8 and the migration's own header; the
same rule — the owner's explicit approval per action, run by the owner or
the lead agent on that approval, never by another agent role):

1. `supabase/migrations/20260923000000_ten_beta_init.sql` applied (creates
   `ten_ws_files`, `ten_gate_log`, `ten_usage_ledger`, the `ten-workspaces`
   bucket, and every `ten_` function these Edge Functions call).
2. `supabase/migrations/20260924000000_ten_ledger_finish_reason.sql` applied
   (adds `ten_usage_ledger.finish_reason`, docs/design-web-agent.md § 9.6),
   then `NOTIFY pgrst, 'reload schema';` so the API sees the new column.
   This MUST precede deploying a `ten-model-proxy` that writes
   `finish_reason`: otherwise every ledger insert fails, the meter logs the
   row as lost, and every call goes unbilled (balance and the $5/day
   ceiling stop being enforced). Rolling the proxy back with the column in
   place is safe.
3. Auth → URL Configuration → Redirect URLs has the production Vercel URL.
4. The first `credit` row inserted only after spike 3's isolation re-run
   passes on the real project (see the migration's checklist) — until then
   `ten_ws_write`/the bucket policies refuse every write, but the proxy
   itself only needs `ten_balance_for`/`ten_beta_spend_today`/the ledger
   insert, which work with zero members (every call 402s/403s correctly).

## Rollback

```sh
supabase functions delete ten-model-proxy --project-ref ivunfotoggdxbjouumdk
supabase functions delete ten-delete-account --project-ref ivunfotoggdxbjouumdk
supabase secrets unset TEN_OPENROUTER_API_KEY TEN_APP_ORIGIN --project-ref ivunfotoggdxbjouumdk
```

Do **not** revoke `TEN_OPENROUTER_API_KEY`'s underlying OpenRouter key — the
live CareerCoach app uses it too (`docs/design-web-agent.md` § 8).

## What each function does (see `docs/design-web-agent.md` § 8 for the full spec)

**`ten-model-proxy`** — `POST .../ten-model-proxy/chat/completions` (and its
`OPTIONS` preflight); anything else 404s. In order: verifies the caller's
Supabase session (401 otherwise, including the anon/publishable key alone);
checks the 256 KB body cap and beta membership (403); checks the caller's
balance (402 `over_balance`) and the $5/day beta-wide ceiling
(`ten_beta_spend_today()`, 503, shown as `model_error`); rebuilds the
upstream body from an explicit allowlist. **§ 13:** the request's `model`
must be exactly `anthropic/claude-sonnet-5` or `deepseek/deepseek-v4.1-flash`
— anything else, including a missing `model` (the proxy no longer fills
one in), gets 400 `model_not_allowed`, no upstream call, no ledger row.
The allowlist forces `stream: true`, the provider privacy filter
(`require_parameters: true` ADDED for DeepSeek only — Claude's every host
supports tools, DeepSeek's cheapest doesn't), `cache_control` (Claude
only — never sent for DeepSeek, whose hosts cache automatically if at
all), the cost cap (`max_tokens`, 8,192 for both), and rewrites
`plugins: [{ id: "web" }]` to the fixed engine and result cap for either
model — everything else is dropped, and Claude's outgoing body is
byte-identical to the pre-§ 13 single-model proxy (a golden-body test
pins this). Calls the one hard-coded OpenRouter URL with
`TEN_OPENROUTER_API_KEY` (never logged); streams the response back to the
client while metering a `tee()`'d copy in the background (`waitUntil`, a
360 s deadline timed from the request's start), inserting exactly one
`ten_usage_ledger` `'call'` row keyed by the response id, with `model` =
the id THIS proxy sent (never the stream's own, possibly dated-suffixed,
`model` string): a finite reported cost from $0 to 10× that request's
OWN model's ceiling ($0.273112 Claude, $0.043288 DeepSeek — § 13.1's price
table, the dearest no-data-kept tool-capable host per model) is recorded
**as reported** (a cost above the ceiling also logs an anomaly line — no
key or content in it); a missing, non-finite, negative, or
>10×-the-ceiling cost, or the meter deadline, records that model's own
ceiling instead. An upstream 402/5xx maps to 503 `model_error` (the
shared key's own limit, not this user's balance). CORS is restricted to
the production Vercel origin (`TEN_APP_ORIGIN`) and
`http://localhost:5173`.

**`ten-delete-account`** — `POST` only (`OPTIONS` for preflight). Verifies
the caller's session — **signed in only, not membership** (fix round 2: an
ex-member whose credit is spent or gone must still be able to erase their
own data) — then deletes that user's beta data: every Storage object under
`users/{uid}/` (via the Storage API, paged at 1,000 per list/remove call,
list then remove — SQL deletes are refused by `storage.protect_delete` and
would orphan the backend files), their rows in `ten_ws_files` and
`ten_gate_log`, and their `ten_usage_ledger` rows of kind `'credit'` only.
**`'call'` rows are kept** — they're cost records with no file content, and
keeping them holds the beta-wide $5/day ceiling and the user's own cost
history intact against a self-delete. The shared auth user is never
touched. Idempotent: a second call finds nothing left and still returns 200
with a zeroed summary. Returns `{ message, deleted: { storageObjects,
textFiles, gateLogRows, creditRows } }`; `message` also states that the
usage records (amounts only, no content) are kept.
