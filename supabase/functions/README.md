# supabase/functions — Ten's four Edge Functions

Contract: `docs/design-web-agent.md` § 8, amended by § 13 ("the site's
model is a setting" — the proxy now allows exactly two models, Claude
Sonnet 5 and DeepSeek V4.1 Flash, each with its own per-call ceiling), § 14
(web search's own per-request price), and § 17 (buying credit with PayPal —
`ten-paypal`, `ten-paypal-webhook`, and § 17.4's amendment to
`ten-delete-account`). Built and tested **locally only** (Deno, mocked
OpenRouter/PayPal and mocked Supabase — see "Tests" below). **Not deployed
by this change.** The owner runs the commands below when ready; nothing
here calls the live OpenRouter key, a live PayPal account, or a production
Supabase project. (Note, 2026-09-25: during the 2026-09-23 to 25 beta
setup the lead agent ran some of these steps on the owner's per-action
approval; that exception is closed. Production is owner-only:
`docs/design-web-agent.md` § 15.)

```
supabase/functions/
  _shared/
    cors.ts            allowed-origin list + CORS headers (ten-model-proxy, ten-paypal; NOT the webhook, § 17.1)
    supabase.ts         thin fetch client: Auth, PostgREST RPC/table, Storage API
    paypal.ts            thin PayPal REST client: OAuth token, Orders v2, Payments v2 capture, webhook verify (§ 17)
    paypal-packs.ts       pure: the server-side pack table ($10/$20/$40), the ten:<uid> custom_id shape (§ 17.1/17.3)
    test-support.ts     TEST ONLY — local stub OpenRouter + local stub Supabase + local stub PayPal
  ten-model-proxy/
    core.ts              pure: the request-field allowlist, path match, SSE usage parser
    handler.ts            handleRequest(req, deps, env) — no Deno/Edge-Runtime global
    index.ts              Deno.serve bootstrap; wires real deps from Deno.env
    core.test.ts / handler.test.ts
  ten-delete-account/
    handler.ts / index.ts (same split)
    handler.test.ts
  ten-paypal/
    core.ts               pure: path match, PayPal-Request-Id shape; re-exports paypal-packs.ts
    handler.ts             handleRequest(req, deps, env) — create-order + capture-order (§ 17.1 steps 2, 4)
    index.ts               Deno.serve bootstrap; refuses to start on a bad TEN_PAYPAL_API_BASE or missing client id/secret
    core.test.ts / handler.test.ts
  ten-paypal-webhook/
    handler.ts             handleRequest(req, deps) — PAYMENT.CAPTURE.COMPLETED backup delivery (§ 17.1 step 5)
    index.ts               Deno.serve bootstrap; TEN_PAYPAL_WEBHOOK_ID may be unset at boot (see "Deploy" below)
    handler.test.ts
```

Every `handler.ts` takes every side effect (auth, DB, storage, the upstream
call, `waitUntil`) through an injected `deps` object, so the request logic
is testable with `deno test` and no network to a real project. Only
`index.ts` touches `Deno.env`, `Deno.serve`, and `EdgeRuntime.waitUntil`.

## Tests (run these; nothing here needs a deployed function or a real key)

```
deno test --allow-net supabase/functions/
```

Current result (§ 17 "buying credit with PayPal", run 2026-09-25):

```
running 4 tests from ./supabase/functions/_shared/paypal-packs.test.ts
... (4 passed)
running 11 tests from ./supabase/functions/_shared/paypal.test.ts
... (11 passed)
running 12 tests from ./supabase/functions/ten-delete-account/handler.test.ts
... (12 passed)
running 49 tests from ./supabase/functions/ten-model-proxy/core.test.ts
... (49 passed)
running 50 tests from ./supabase/functions/ten-model-proxy/handler.test.ts
... (50 passed)
running 2 tests from ./supabase/functions/ten-paypal/core.test.ts
... (2 passed)
running 18 tests from ./supabase/functions/ten-paypal/handler.test.ts
... (18 passed)
running 18 tests from ./supabase/functions/ten-paypal-webhook/handler.test.ts
... (18 passed)

ok | 164 passed | 0 failed
```

The new coverage (§ 17.8's test plan, the parts this build owns — `tests/sql`
and the SQL-only checks are the independent tester's, not this suite):
create-order's 401/403/400 and that the amount always comes from the
server's pack table, whatever the body also adds; capture-order refuses
another user's order, an older-app (bare-UUID) order, and a non-pack
amount, all with NO capture call; a fresh capture, `ORDER_ALREADY_CAPTURED`
(re-reads the order's own capture), and a replay all credit the SAME
`paypal:<captureId>` row exactly once; `ORDER_NOT_APPROVED` →
`window_closed`, no row; `PENDING` → `"pending"`, no row; a breakdown that
doesn't add up (non-USD, no `net_amount`) → no row, an alert, `503
paid_not_credited`; the outgoing create-order body never mentions
vault/saved/agreement/plan/shipping. The webhook: a bad/missing signature
→ 401; the verify call failing OR `TEN_PAYPAL_WEBHOOK_ID` unset → 503, no
row, no PayPal HTTP call for the unset case; a non-capture event type, a
non-`ten:` `custom_id`, a non-member `ten:` uid, and a re-fetched capture
that doesn't match the event (custom_id, status, breakdown) all → 200
"ignored" (the non-member case also logs an alert, "refund by hand");
valid + member + re-fetched COMPLETED capture → credited once, replayed 3×
or raced against capture-order's own insert stays at one row; no CORS
header on any webhook response.

`deno check supabase/functions/**/*.ts` and `deno lint supabase/functions/`
are also clean.

`--allow-net` is required because the tests spin up local loopback HTTP
servers (`_shared/test-support.ts`, `Deno.serve({ port: 0 }, ...)`) to stand
in for OpenRouter, PayPal, and Supabase — no external network is reached,
and no `TEN_OPENROUTER_API_KEY`, `TEN_PAYPAL_CLIENT_SECRET`, or Supabase
credential is used or needed.

Not covered by these local tests (need a live upstream/project, which this
change explicitly does not touch — see the Step-1 spike-4 note in
`docs/design-web-agent.md`, and § 17.7's owner checklist for PayPal): a
ledger row's `usd` matching OpenRouter's own `GET /api/v1/generation?id=`
accounting, a web-search call's cost matching the key's credit change, a
turn-2 prompt-cache read, streaming from an actual Vercel build, a real
PayPal sandbox capture and its webhook delivery, and `tests/sql`'s own
checks on the new migration (the independent tester's own suite, § 17.8
item 7).

## Deploy (the owner runs these; an agent never does)

All four functions read Supabase's own auto-injected `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — those are reserved names
the CLI will refuse to let you set yourself; every other Edge Function gets
them automatically once deployed to the project.

```sh
# From the repo root, once linked to career-coach-nextgen (ref ivunfotoggdxbjouumdk):
supabase functions deploy ten-model-proxy --project-ref ivunfotoggdxbjouumdk
supabase functions deploy ten-delete-account --project-ref ivunfotoggdxbjouumdk
supabase functions deploy ten-paypal --project-ref ivunfotoggdxbjouumdk
supabase functions deploy ten-paypal-webhook --no-verify-jwt --project-ref ivunfotoggdxbjouumdk

# Secrets ten-model-proxy needs (never printed, never committed):
supabase secrets set TEN_OPENROUTER_API_KEY=<the existing OpenRouter key, shared with the live app> \
  --project-ref ivunfotoggdxbjouumdk
supabase secrets set TEN_APP_ORIGIN=<the production Vercel origin, e.g. https://ten.example.com> \
  --project-ref ivunfotoggdxbjouumdk

# Secrets ten-paypal and ten-paypal-webhook need (§ 17.6, never printed, never
# committed — both functions refuse to start unless TEN_PAYPAL_API_BASE is
# exactly one of PayPal's two real hosts, and unless the client id/secret
# are both set; TEN_PAYPAL_WEBHOOK_ID is the one exception, see § 17.7 below):
supabase secrets set TEN_PAYPAL_CLIENT_ID=<the older app's PayPal REST app client id> \
  TEN_PAYPAL_CLIENT_SECRET=<its secret> \
  TEN_PAYPAL_API_BASE=https://api-m.sandbox.paypal.com \
  --project-ref ivunfotoggdxbjouumdk
```

`ten-delete-account` needs no extra secret beyond the auto-injected three —
it never calls OpenRouter or PayPal and never needs the app origin beyond
CORS, which also reads `TEN_APP_ORIGIN` (set it once; every function that
uses CORS shares it — the webhook does NOT, § 17.1: "no CORS").

**Deploy order for § 13 — the site deploys BEFORE `ten-model-proxy`** (see
`apps/web/README.md`'s own "Deploy order for § 13" for the full three-step
sequence: site → proxy → setting). Deploying the proxy before the § 13
site build would 400 every call from whatever OLD site build is still
live, since it never sent a `model` field at all and this version of the
proxy no longer fills one in.

**Deploy order for § 17 (buying credit) — `ten-delete-account` before
`ten-paypal`, the new copy after it** (§ 17.4): the delete function's
"stops deleting ledger rows" behavior and its new summary copy must both be
live before members can buy credit, so a purchase's row can never be
deleted by an old delete function that still targets `kind=eq.credit`. The
full owner checklist, in order, is § 17.7 below.

Preconditions, in this order (per § 8/§ 17 and each migration's own header —
an agent never runs these either):

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
3. `supabase/migrations/20260925000000_ten_paypal_credit.sql` applied (adds
   `ten_usage_ledger.gross_usd`/`fee_usd`, the paypal-breakdown check, and
   widens the `kind` check to allow `'refund'` — § 17.3), then `NOTIFY
   pgrst, 'reload schema';`. This MUST precede deploying a `ten-paypal` or
   `ten-paypal-webhook` that writes `gross_usd`/`fee_usd`: otherwise every
   credited capture's insert fails (PGRST204, unknown column) and no
   payment is ever credited, though PayPal itself is unaffected (the
   payer's money still moves — only Ten's own credit write fails, § 17.1
   step 4's "A failed credit write → 503 paid_not_credited").
4. Auth → URL Configuration → Redirect URLs has the production Vercel URL.
5. The first `credit` row inserted only after spike 3's isolation re-run
   passes on the real project (see the init migration's checklist) — until
   then `ten_ws_write`/the bucket policies refuse every write, but the
   proxy itself only needs `ten_balance_for`/`ten_beta_spend_today`/the
   ledger insert, which work with zero members (every call 402s/403s
   correctly).
6. The older CareerCoach app's patch
   (`docs/old-app-paypal-ten-prefix.md`) is deployed BEFORE Ten's first
   live payment, so the shared PayPal REST app's webhook stops 500ing (and
   retrying for 3 days) on a `ten:<uuid>` payment.

## Owner checklist for § 17 — buying credit with PayPal (sandbox, then live)

The full sequence, from `docs/design-web-agent.md` § 17.7 (an agent never
runs any of this):

1. Deploy the older-app patch (`docs/old-app-paypal-ten-prefix.md`); a
   `ten:` payment gets 200 "ignored" there, not a 500 retried for 3 days.
2. In PayPal: the account takes USD without manual acceptance (else
   payments sit `PENDING`); unique invoice ids stays on.
3. Apply `20260925000000_ten_paypal_credit.sql`; `NOTIFY pgrst, 'reload
   schema';`.
4. `supabase secrets set TEN_PAYPAL_CLIENT_ID=… TEN_PAYPAL_CLIENT_SECRET=…
   TEN_PAYPAL_API_BASE=https://api-m.sandbox.paypal.com --project-ref
   ivunfotoggdxbjouumdk`.
5. `supabase functions deploy ten-delete-account`, then `ten-paypal`, then
   `ten-paypal-webhook --no-verify-jwt` (same project ref) — this order
   matters (§ 17.4: delete must stop touching ledger rows before a
   purchase can land).
6. developer.paypal.com → the shared app → Webhooks → Add:
   `https://ivunfotoggdxbjouumdk.supabase.co/functions/v1/ten-paypal-webhook`,
   "Payment capture completed" only. Copy the Webhook ID PayPal shows,
   `supabase secrets set TEN_PAYPAL_WEBHOOK_ID=<it> --project-ref
   ivunfotoggdxbjouumdk`, then redeploy `ten-paypal-webhook
   --no-verify-jwt`. Until the id is set, it answers 503 to every delivery
   (by design — see `ten-paypal-webhook/index.ts`'s own comment: this
   function DOES start without the id, unlike a missing client id/secret
   or a bad API base, which refuse to start at all).
7. Vercel: `VITE_PAYPAL_CLIENT_ID`, then deploy the site
   (`apps/web/README.md`).
8. Buy $10: one `paypal:` row, `usd` = net, the chip up by net, the webhook
   delivery 200 with no second row. Live: refund it by hand (§ 17.5).

**Refund contact:** `support@10xjobs.co` (owner, 2026-09-25; shown in
`design-web-ui.md` § 1.11).

## Rollback

```sh
supabase functions delete ten-model-proxy --project-ref ivunfotoggdxbjouumdk
supabase functions delete ten-delete-account --project-ref ivunfotoggdxbjouumdk
supabase functions delete ten-paypal --project-ref ivunfotoggdxbjouumdk
supabase functions delete ten-paypal-webhook --project-ref ivunfotoggdxbjouumdk
supabase secrets unset TEN_OPENROUTER_API_KEY TEN_APP_ORIGIN --project-ref ivunfotoggdxbjouumdk
supabase secrets unset TEN_PAYPAL_CLIENT_ID TEN_PAYPAL_CLIENT_SECRET TEN_PAYPAL_API_BASE TEN_PAYPAL_WEBHOOK_ID \
  --project-ref ivunfotoggdxbjouumdk
```

Do **not** revoke `TEN_OPENROUTER_API_KEY`'s underlying OpenRouter key — the
live CareerCoach app uses it too (`docs/design-web-agent.md` § 8). Also
remove Ten's webhook URL from the shared PayPal app in developer.paypal.com
(the older app's own PayPal REST app is otherwise untouched).

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
would orphan the backend files), and their rows in `ten_ws_files`,
`ten_gate_log`, and `ten_conversations`. **§ 17.4 (amended 2026-09-25): NO
`ten_usage_ledger` row of any kind is ever deleted here any more** — calls
aren't tied to the credit they used, so deleting any credit row (the $5
starter included) could take paid credit with it; a member who deletes
keeps membership and balance, with an empty workspace. The shared auth user
is never touched. Idempotent: a second call finds nothing left and still
returns 200 with a zeroed summary. Returns `{ message, deleted: {
storageObjects, textFiles, gateLogRows, conversationRows } }`; `message`
states that credit, and the usage/payment records (amounts only, no
content), are kept.

**`ten-paypal`** — `POST .../ten-paypal/create-order` and `POST
.../ten-paypal/capture-order` (and their `OPTIONS` preflight); anything else
404s (§ 17.1 steps 2, 4). Both endpoints require a signed-in member (401/403,
checked before routing). **`create-order`**: the pack id (`"10"|"20"|"40"`)
is the only field read from the body — the amount always comes from the
server's own table (`ten-paypal/core.ts`'s `PACKS`, re-exported from
`_shared/paypal-packs.ts`), never the client; creates a PayPal Orders v2
order, `custom_id: "ten:<uid>"`, a fresh `invoice_id`, no vault/saved
method/agreement/plan/shipping field. Unknown pack → 400. **`capture-order`**:
reads the order FIRST — refuses (403) unless `custom_id` is `ten:<caller>`,
refuses (400) unless the amount is a known pack in USD — before ever
capturing anything. Captures with `PayPal-Request-Id:
ten-capture-<orderId>` (PayPal's own idempotency, kept ~6h);
`ORDER_ALREADY_CAPTURED` re-reads the order's own capture instead of
capturing again; `ORDER_NOT_APPROVED` → `{ status: "window_closed" }`
(no money moved — the payer never confirmed in PayPal's window, § 17.2).
A `COMPLETED` capture with a breakdown that checks out (USD, a known pack
amount) credits ONE `ten_usage_ledger` `'credit'` row, `request_id
'paypal:<captureId>'` (unique — a replay or a race with the webhook credits
once), `usd` = PayPal's own `net_amount`, `gross_usd`/`fee_usd` from
`seller_receivable_breakdown` — all passed through as PayPal's own decimal
strings, never parsed to a float (`_shared/paypal.ts`'s file header). A
`PENDING` capture credits nothing yet (`{ status: "pending" }`); anything
else is `{ status: "declined" }`; a breakdown that doesn't check out, or a
failed ledger write, is `503 paid_not_credited` with an alert logged (no
key or content in it). CORS is the same allowlist as `ten-model-proxy`.

**`ten-paypal-webhook`** — `POST` only, **no CORS, no JWT verification**
(deployed `--no-verify-jwt`: PayPal calls this directly, never a signed-in
browser). The backup path for `PAYMENT.CAPTURE.COMPLETED` (§ 17.1 step 5),
for a capture that cleared after the tab closed or a capture-order write
that failed. In order: `POST` only (else 404) → body ≤ 64 KB (else 413) →
valid JSON (else 400) → **PayPal's own signature**, `POST
/v1/notifications/verify-webhook-signature` with the five `paypal-*`
headers, the raw event, and `TEN_PAYPAL_WEBHOOK_ID` — anything but
`SUCCESS` → 401, no credit; the call itself failing OR the secret being
unset → 503 (so PayPal retries; this function deliberately DOES start with
`TEN_PAYPAL_WEBHOOK_ID` unset, since the id can only be obtained AFTER this
function is deployed and registered with PayPal, § 17.7 step 6) → then,
only once signed: another event type, a `custom_id` that isn't exactly
`ten:<uuid>` (the older app's bare-UUID payments), or a `ten:<uid>` for a
non-member all → `200 { status: "ignored" }` (the non-member case also logs
an alert — "refund by hand", since PayPal already took the payer's money) →
**still re-fetches** `GET /v2/payments/captures/{id}` with Ten's OWN keys
(failure → 503) — the signature proves PayPal sent the event, the re-fetch
proves the capture, never the event body's own attacker-influenced fields;
the re-fetched capture must show the SAME `custom_id`, `COMPLETED`, and a
USD pack breakdown, else 200 + an alert, no row → credits the ledger the
same way `ten-paypal`'s capture-order does (same `paypal:<captureId>` key,
so either one landing first makes the other a no-op); a failed credit write
→ 503. `TEN_PAYPAL_API_BASE`/`TEN_PAYPAL_CLIENT_ID`/`TEN_PAYPAL_CLIENT_SECRET`
are required at boot (same refusal as `ten-paypal`) — only
`TEN_PAYPAL_WEBHOOK_ID` is allowed to start unset.
