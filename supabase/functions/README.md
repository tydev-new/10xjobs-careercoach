# supabase/functions — Ten's two Edge Functions

Contract: `docs/design-web-agent.md` § 8. Built and tested **locally only**
(Deno, mocked OpenRouter and mocked Supabase — see "Tests" below). **Not
deployed by this change.** The owner runs the commands below when ready;
nothing here calls the live OpenRouter key or a production Supabase project.

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

Current result (this change, run 2026-09-23):

```
running 8 tests from ./supabase/functions/ten-delete-account/handler.test.ts
... (8 passed)
running 18 tests from ./supabase/functions/ten-model-proxy/core.test.ts
... (18 passed)
running 29 tests from ./supabase/functions/ten-model-proxy/handler.test.ts
... (29 passed)

ok | 55 passed | 0 failed
```

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

## Deploy (the owner runs these; an agent never does)

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

Preconditions, in this order (per § 8 and the migration's own header — an
agent never runs these either):

1. `supabase/migrations/20260923000000_ten_beta_init.sql` applied (creates
   `ten_ws_files`, `ten_gate_log`, `ten_usage_ledger`, the `ten-workspaces`
   bucket, and every `ten_` function these Edge Functions call).
2. Auth → URL Configuration → Redirect URLs has the production Vercel URL.
3. The first `credit` row inserted only after spike 3's isolation re-run
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
upstream body from an explicit allowlist (forces the model, cost cap,
`stream: true`, the provider privacy filter, `cache_control`, and rewrites
`plugins: [{ id: "web" }]` to the fixed engine and result cap — everything
else is dropped); calls the one hard-coded OpenRouter URL with
`TEN_OPENROUTER_API_KEY` (never logged); streams the response back to the
client while metering a `tee()`'d copy in the background (`waitUntil`),
inserting exactly one `ten_usage_ledger` `'call'` row keyed by the response
id, recording the ~$0.18 ceiling cost if no cost could be parsed. An upstream
402/5xx maps to 503 `model_error` (the shared key's own limit, not this
user's balance). CORS is restricted to the production Vercel origin
(`TEN_APP_ORIGIN`) and `http://localhost:5173`.

**`ten-delete-account`** — `POST` only (`OPTIONS` for preflight). Verifies
the caller's session and membership, then deletes **beta data only** for
that user: every Storage object under `users/{uid}/` (via the Storage API,
list then remove — SQL deletes are refused by `storage.protect_delete` and
would orphan the backend files), then their rows in `ten_ws_files`,
`ten_gate_log`, `ten_usage_ledger`. The shared auth user is never touched.
Returns a summary `{ message, deleted: { storageObjects, textFiles,
gateLogRows, ledgerRows } }`.
