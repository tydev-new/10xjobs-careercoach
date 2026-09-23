# Review — the model-proxy change to the web agent contract

**Reviewer:** architect (independent: authored none of the reviewed text)
**Date:** 2026-09-23 · **PROCESS.md step 5**
**Reviewed:** the uncommitted diff to `docs/design-web-agent.md` (C) against
`HEAD` `714d629`. Cited by line number in the working tree.
**Also read:** `PRINCIPLES.md`, `docs/plan-portable-skills-and-web-agent.md`
(P), `docs/design-web-ui.md` (UI), `apps/web/src`, `apps/web/fixtures`,
`docs/spikes/spike-1-browser-loop.md` (S1), `spikes/3-supabase-isolation/policies.sql`.
**Owner decision under review (2026-09-23):** no per-user OpenRouter keys; one
app key in a Supabase Edge Function `model-proxy`; a `usage_ledger` table; the
beta runs on the owner's existing production Supabase project; Vercel hosts.

**Verdict.** The direction is right and simpler than per-user keys: no
management key, no key in the browser, one money table, a balance derived
once (rule 12). But four things block building on it as written:

- the proxy forwards the client's body "unchanged, except" three fields,
  and OpenRouter has other fields that get around all three (B1);
- the overspend bound is stated more strongly than the design delivers
  (B2, rule 8);
- the production project shares its sign-in with the old app, so
  "invite-only" and `delete_account` mean something different from what C
  says (B3);
- "no existing table or policy changes" is not true of the storage plan,
  and the new objects are neither named nor reversible (B4).

**Can the proxy spike build on this?** Yes, once B1 and B2's wording land in
C (the spike tests exactly those things), and only if whatever the spike
creates in the production project follows B4 (prefixed names and a teardown
script). **Can step 5b build on this?** No — not until B1–B4 are fixed and
the plan and UI doc are brought into line (S1, S2).

---

## BLOCKERS

### B1. The client can get around the model allowlist, the output cap, and the path (rules 5, 7)

**Where:** C:476-480 — "Forwards the body unchanged, except that it forces
`provider` …, refuses any model not on the allowlist …, and caps
`max_tokens` at 4,096." C:471 names only the `/chat/completions` path; the
function's behaviour on any other path is not stated.

**Why it breaks:** a body forwarded "unchanged, except" X, Y, Z lets through
every field nobody thought of. From OpenRouter's current docs (verified
2026-09-23):

- **`models`** (a fallback list) — "Requests are priced using the model that
  was ultimately used" (docs/guides/routing/model-fallbacks). A client that
  sends `model: "anthropic/claude-sonnet-5"` plus `models: ["<any model>"]`
  passes a check that looks only at `model`. (Also `fallbacks` on the
  Messages API.)
- **`max_completion_tokens`** — documented as sharing `max_tokens`
  semantics (docs/api-reference/parameters). Capping `max_tokens` alone
  leaves this one open.
- **`plugins`** / **`web_search_options`** / the `openrouter:web_search`
  server tool — the client chooses the search engine and result count
  (Exa: $0.007 a request, up to $0.015 for Deep Reasoning, $0.001 per
  result past 10; native search is billed by the provider). C:233 says
  `web_search` sends `max_results` ≤ 5, but only the browser enforces that.
- **`reasoning`** / **`reasoning_effort`** — changes how many output
  tokens are spent.
- **`stream: false`** — C:481-485 meter from "the final SSE chunk". A
  non-streamed call has no SSE chunks, and OpenRouter says non-streaming
  calls cannot be cancelled and bill the full response.
- **Other paths** — if the function maps its path suffix onto
  `openrouter.ai/api/v1/*` (the natural way to build a pass-through), the
  app key also reaches `/completions`, `/embeddings`, `/responses`,
  `/messages`, `/credits` (the owner's account balance) and
  `/generation`.
- A model suffix such as `:online` gets past any allowlist check that
  matches on a prefix.

**Fix (simpler than the current rule, rule 18):** the proxy **builds** the
upstream body from a short list of fields it accepts. Every other field is
dropped, never forwarded. Suggested list: `messages`, `tools`,
`tool_choice`, `temperature`, `cache_control` (spike 1 needs it: S1:195-201),
and `plugins` narrowed to `[{ id: "web", max_results ≤ 5 }]`. The proxy
**sets** `model` (exact string match against the allowlist),
`max_tokens` = min(client, 4,096), `stream: true`, and `provider`. There is
one upstream URL, hard-coded. Any other path or method returns 404, apart
from `OPTIONS` for CORS. The body has a size cap (see B2).
**Proved by (add to C:528-532 and the spike list C:545-551):** function
tests with a stubbed upstream that assert the **outgoing** body has no
`models`, no `max_completion_tokens`, no `web_search_options`, `stream: true`,
the forced `provider`, and `max_results` ≤ 5, when the client sent the
opposite of each. Plus `POST …/model-proxy/embeddings` → 404, and
`model: "anthropic/claude-sonnet-5:online"` → 400. The spike criterion
"the provider filter forced server-side" (C:550) can't be seen from the
browser. It is proved by this stubbed-upstream test, or live by the provider
named in `GET /api/v1/generation?id=`.

### B2. The overspend bound is stated more strongly than the design delivers (rule 8; rule 5)

**Where:** C:505-508 — "the balance can go below zero by at most the calls
in flight … the one-tab lock … holds that to one capped call per user".
C:486-489 — if the final chunk isn't reached after a disconnect, "that call
is unmetered (the same one-call bound below)". C:522-523 — a cut-off call
"may go unmetered".

**Why it breaks:**

1. **The one-tab lock runs in the browser.** Anyone can copy their session
   JWT from devtools and call the proxy with `curl`, many calls at once. The
   proxy only checks `balance > 0` before each call. So a user with $0.01
   left can start N calls at the same moment. The real bound is N × the
   largest cost of one call, and N has no limit.
2. **"Capped" covers output only.** The input has no cap (C:476-480 say
   nothing about body size). A single call with a very large prompt can
   cost dollars on its own (exact figure UNVERIFIED — Sonnet 5 prices and
   context size are not in C).
3. **"Unmetered on disconnect" can be repeated at will.** A user who stops
   every stream just before its end gets every call for free. That is not
   "one call": it is every call. OpenRouter says that stopping a stream
   "immediately stops model processing and billing" for supported providers
   (docs/api-reference/streaming). So a stopped call is billed for part of
   its run, but the proxy never records that part. And a call routed to a
   provider that doesn't support cancelling (OpenRouter's list includes AWS
   Bedrock and Google) is billed in full while nothing is recorded.

**Fix — two parts. The first is required. The second is the owner's call:**

- **Required — close the free-call hole, and fail closed.** Supabase
  documents `EdgeRuntime.waitUntil`: "The Function instance continues to run
  until the promise provided to `waitUntil` completes"
  (guides/functions/background-tasks). The proxy should split the upstream
  stream in two. One copy goes to the browser. The function reads the other
  copy to the end inside `waitUntil` and then writes the ledger row. If no
  cost can be read, it records the call at its **ceiling** (input tokens
  × input price + 4,096 × output price) rather than at $0. **UNVERIFIED:**
  that the function keeps running after the *browser* disconnects (the
  docs cover "after the response is sent", not a cancelled request). The
  spike must test this: stop the stream mid-way, then check that a row
  appears.
- **Owner's call — a server-side limit on parallel calls, or an honest
  bound.** Either (a) the proxy allows one call in flight per user (for
  example, a pending ledger row plus a partial unique index on `user_id`
  where the call is unsettled; a second call gets 429), or (b) C states
  the true bound: "a signed-in user calling the proxy directly can run
  calls in parallel; the loss is bounded by the app key's OpenRouter
  credit limit". Either way, **give the app key its own OpenRouter credit
  limit**, set by the owner to the credit issued plus a margin. That one
  setting bounds every hole above, needs no code, and is the global backstop
  per-user keys used to give for free. Also cap the request body (for
  example 256 KB, above the ~4,000-word window plus ~3,300 words of
  instructions, C:438-443) so that one call's cost is bounded in dollars
  and C can state that dollar figure.

**Proved by:** a test that stops a stream mid-way and gets one row (actual
cost, or the ceiling); for (a), two parallel calls → one 429; a body over
the cap → 413.

### B3. The production project shares its sign-in with the old app: "invite-only" and `delete_account` don't hold (rule 9; P:36)

**Where:** C:465-467 ("the owner's existing production Supabase project …
no existing table or policy changes"); C:509-512 (`delete_account` deletes
"the auth user"); P:265 ("access is invite-only (Supabase Auth)"); P:36
(the old WebUI's users migrate later, so they live in this project's
`auth.users` today).

**Why it breaks:**

- **Invite-only is a whole-project setting.** Turning off public sign-ups
  also turns them off for the old app. Leaving them on lets anyone sign up
  to the beta. Either way, **every existing old-app user can already sign
  in to the beta** with their current password. The balance keeps them from
  spending (no `credit` row → 402), but they can write to the new Storage
  bucket, and C doesn't say whether that is allowed.
- **`delete_account` would delete the old-app account too.** Deleting the
  shared auth user also deletes the person's old WebUI account. It may also
  cascade into the old app's tables, or fail half-way on a foreign key the
  old app set to `restrict`, leaving a partly deleted account. Rule 9
  promises "gone when you delete it". That promise is about the beta's
  data, not about quietly deleting a second product's account.
- **Site URL.** In Supabase the Site URL is "the default redirect URL when
  no `redirectTo` is specified" and is "critical for email confirmations
  and password resets" (guides/auth/redirect-urls). C:468 says the Vercel
  URL "is the Auth redirect". If that means the Site URL, it breaks the old
  app's emails. It has to be an entry in the Redirect URLs allow list, and
  the beta must pass `redirectTo` on every invite and sign-in link. The
  email templates are also shared by the whole project (they will carry
  the old app's wording).

**Fix:** C states (1) how the beta decides who is in without a
project-wide switch. The simplest way that reuses what C already has: a
user is in when they have a `credit` row. The proxy already checks this.
Storage writes need the same check, or C accepts that old-app users can
write to the bucket. (2) What `delete_account` deletes. Two options: beta
data only (bucket, `gate_log`, `usage_ledger`), keeping the auth user while
the old app still exists; or everything, with the confirmation naming the
old app. (3) The Vercel URL goes in the Redirect URLs list, not the Site
URL. Choosing between the options in (1) and (2) is the owner's call.
**Proved by:** a test that an old-app user with no credit row gets 402 from
the proxy (and the chosen Storage outcome); a `delete_account` test run
against a copy of the old app's schema that leaves the old app's rows as
decided and never stops half-way.

### B4. "No existing table or policy changes" isn't true of the storage plan, and the new objects are not named (rule 12; production safety)

**Where:** C:466-467; C:97-98 (per-user access rules on the bucket); C:181
(an unnamed database function for `gate_log`); C:497 (an unnamed balance
function); `spikes/3-supabase-isolation/policies.sql:20-58`.

**Why it breaks:**

- Storage access rules live on the **shared** `storage.objects` table. C's
  bucket needs new policies there, so an existing table does gain
  policies. More important: Postgres combines permissive policies with OR.
  **If the old app has any storage policy that doesn't filter by
  `bucket_id`** (for example "authenticated users can read objects"), that
  policy also covers the new bucket. Then user A can read `users/B/…`,
  whatever the new policies say. Spike 3 proves isolation only if it runs
  against the production project's **real** policy list.
- New tables in `public` get Supabase's default grants to
  `anon`/`authenticated`. They are safe only if RLS is switched on in the
  same migration that creates them. New functions in `public` are callable
  by `anon` by default. A `security definer` balance function that takes a
  `uid` argument would show anyone's balance.
- The names can clash. `design-cowork-coaching.md:282-283` records an
  existing "key-gated Supabase edge function" and a staging table in the
  cloud (UNVERIFIED that it is this project). `gate_log`, `usage_ledger`,
  `model-proxy` and `delete_account` are generic names.
- C says nothing on reversal. Supabase CLI migrations only move forward. A
  `db push` from a repo that lacks the production project's migration
  history, or a `db reset` against the linked project, would damage the old
  app.

**Fix:** add one short table to C § 8, "What the beta adds to the production
project", and name every object: the bucket; each `storage.objects`
policy (prefixed, as spike 3 did with `spike3_`); the tables (prefixed, e.g.
`ten_gate_log`, `ten_usage_ledger`); each SQL function, with
`security invoker` and its grants; the two Edge Functions (e.g.
`ten-model-proxy`, `ten-delete-account`); the function secret's name; the
Redirect URL entry. Pair it with a teardown script that drops exactly those.
State two things: RLS is enabled in the creating statement, and `anon` is
revoked on the new tables and functions. Add a precondition: before any
object is created, a list of the old app's `storage.objects` policies is
checked, and any without a `bucket_id` filter goes to the owner.
**Proved by:** spike 3 run on the production project with the real policy
set (A cannot list/read/write B's objects); teardown run on a scratch
project leaves no object behind; a grep of the old app's schema before and
after shows no changes.

---

## SHOULD

### S1. The plan and C still disagree (consistency; rule 12)

The plan still describes per-user keys in ten places:

- P:34 (decision 3's reason: "per-user provisioned keys … without a proxy")
- P:35 (decision 4: "rows only for accounts, balances")
- P:47 and P:56-59 (the architecture diagram: "per-user key", "mint/raise
  the user's OpenRouter key (the only server code in the MVP)" — there are
  now two functions)
- P:91-92 (spike 4 as it was first written), which step 1's exit P:109
  still requires
- P:183-184 (step 5b: "the Edge Function that mints and raises keys")
- P:194 (the 5b exit: "no secret except the user's own OpenRouter key" —
  the new exit is "no secret at all")
- P:232 (the ⋯ menu has "key")
- P:266 ("the $5 starter credit on a capped OpenRouter key")
- P:421-423 (the risk "a user-held OpenRouter key … Rotate it on logout")
- P:427 ("filter (spike 4)")

`docs/README.md:14` still lists C as "key and balance". Replace the P:421
risk with the risks this change brings: the proxy is one point of failure,
and one app key is shared by everyone (B2's credit limit is the mitigation).
The plan has a decision table (P:28-37), so the proxy decision needs a row
there too.

### S2. The UI doc and `apps/web` still show the key model (consistency; rules 8, 12)

- UI:55-58 — the chip "reads the candidate's own key limit directly", and
  the menu has "manage your usage key". `apps/web/src/components/Header.tsx:103`
  still renders "Manage your usage key". With no key, the menu item has
  nothing to manage: delete it.
- UI:206-207 and UI:277, `apps/web/fixtures/over-limit-error.json:4,64,70`
  — "after OpenRouter rejects a call", `errorText` "OpenRouter request
  rejected: credit limit reached (402)". The refusal now comes from the
  proxy, **before** the call. The fixtures' tool outputs are supposed to be
  real (UI § 4), so the `errorText` must be what the proxy actually sends.
  Also, in `over-limit-error.json:70` the model writes a reply **after** the
  402. That can't happen: every model call made after that point is refused
  too. C used to settle this with "What was finished is the model's to say
  next turn, from the files" (HEAD C:361). The diff deleted that clause
  (see S7). The next turn can't happen either until credit is added.
- `apps/web/src/components/ErrorPart.tsx:12` and UI:222 — the
  `over_balance` copy says "Add funds to keep going." C:502-503 says there
  is no payment page, so the user can't add funds. The copy must say what
  they can actually do (rule 8). The designer and the owner write it.
- The chip's source: C:498-500 says the chip reads `deps.balance()` when a
  turn ends and when the window regains focus.
  `apps/web/src/ChatShell.tsx:17-31` reads the latest `cost` card instead.
  These are two sources for one number. 5b's "balance wiring" (P:192)
  should replace the card source, not add a second one.
- Display: `apps/web/src/format.ts:5-9` prints every decimal the number has.
  A ledger sum (for example 4.9981243) would show as "$4.9981243", and a
  balance below zero (B2) as "$-0.03". C or UI should state how many
  decimals the chip shows, which way it rounds (down, so the chip never
  shows more money than the user has), and what a negative balance
  looks like.

### S3. Money details that are missing (rules 5, 8, 12)

- **`usage.cost` and the web plugin (UNVERIFIED, C:486-487).** OpenRouter's
  usage-accounting page does not say whether `usage.cost` includes web
  search charges, and neither does the web-search page ("web search will
  incur extra costs"). `GET /api/v1/generation` returns `total_cost` and
  `num_search_results`. **Fallback to put in C:** the spike makes one
  web-search call and compares `usage.cost` with the change in the app
  key's `GET /api/v1/credits` usage (the ground truth). If the plugin charge
  is missing from `usage.cost`, the proxy adds the plugin's listed price per
  request as a dated constant, the same way `estimate_cost` already does
  (C:251-253).
- **"The correct cost" (C:548) has no reference.** State the reference: a
  row's `usd` equals `total_cost` from `GET /api/v1/generation?id=` for the
  same id.
- **Two metering paths.** The final chunk, with `/generation` as the
  fallback (C:482-486), gives two sources for one fact. With B2's rule
  (read the stream to the end; if no cost can be read, record the ceiling),
  the fallback may not be needed. Pick one path, or say why both are.
- **Column type.** `usd` has no stated type. Use `numeric` (not `float`)
  and state its precision. The balance function should return it
  unrounded, and the UI rounds for display only (S2).
- **The balance function's security mode and name** (C:497) — see B4. It
  should be `security invoker` and filter on the passed `uid`, so a user
  asking for someone else's `uid` sees their own RLS-filtered result (0),
  not the other user's balance.
- **An upstream 402 is not the user's 402.** If the owner's OpenRouter
  account runs dry (or hits B2's app-key limit), OpenRouter answers 402.
  Forwarded as-is, that shows "over_balance" to a user who still has
  credit. The proxy should turn any upstream 402 into a 503, which the loop
  shows as `model_error`. Errors that arrive mid-stream (HTTP 200 with
  `finish_reason: "error"`, per docs/api-reference/streaming) must still
  produce a ledger row.
- **Currency.** OpenRouter credits are in USD, and `cost` is in credits.
  The owner pays a fee when buying credits, so the owner's real cost is
  above the ledger's figure. That matters for pricing (P:196), not for the
  balance. The fee's size is UNVERIFIED.

### S4. JWT check: the gateway also lets the public key through (security)

C:473 says "Verifies the Supabase JWT (401 without one)", and the test
(C:528) is "no JWT → 401". Supabase's docs say the gateway check expects a
user JWT, but "Publishable and secret keys are not JWTs, but the check still
accepts them in the `Authorization` header, so callers that send one there
reach your handler" (guides/functions/auth-headers). The legacy anon key is
a valid JWT with `role: anon`. The browser bundle holds that key
(C:468-469). The balance probably makes this fail safe (no user means no
credit), but the contract should say what it means: **the handler resolves
a signed-in user (`role = authenticated`, a `sub`) and answers 401
otherwise.** The same applies to `delete_account`. Add the tests: the anon
key → 401 and the publishable key → 401, on both functions.

### S5. CORS isn't stated (security)

C § 8 says nothing about CORS. Auth is a bearer token, not a cookie, so
CORS is a second layer rather than the main one. Still, C should name the
allowed origins: the production Vercel URL, plus `localhost` for
development. P:261-262 plans a preview deployment per branch. Previews
have changing URLs, and there is only one Supabase project (the production
one), so a preview that signs in works on real accounts with real money.
The Redirect URLs wildcard (`https://*-<team>.vercel.app/**`, per
Supabase's docs) would allow that. Recommend: previews run the mock
transport only, with no Supabase env. Then neither the CORS list nor the
Redirect URLs list needs a wildcard. **Proved by:** a preflight from an
unlisted origin gets no `Access-Control-Allow-Origin`.

### S6. Time limits: the figures check out, but the "cut off" case is not closed

**Checked against Supabase's limits page (2026-09-23):** wall clock 150 s on
the free plan and 400 s on paid plans; "Maximum CPU Time: 2s (… does not
include async I/O)"; "Request idle timeout: 150s (If an Edge Function
doesn't send a response before the timeout, 504 …)". C:516-519 is accurate.
"Applies only until the first byte" is a fair reading of "doesn't send a
response", not a quote. Memory is 256 MB. The page states **no request-body
limit** (UNVERIFIED — relevant to B2's body cap).

Gaps:

- **Which plan is the production project on?** (open question) It decides
  150 s or 400 s.
- **4,096 tokens "near a minute" (C:521) is UNVERIFIED.** At 30–80 tokens a
  second, 4,096 tokens take 51–137 s, before the time to the first token on
  a prompt of about 15k tokens. On the free plan the slow end is close to
  150 s. B2's `waitUntil` metering also runs inside the same wall clock,
  so a call cut off at the limit loses its row. B2's ceiling rule is what
  closes this, not the cap.
- **A tool call cut off at 4,096 tokens.** A long `write_file` (a full
  `jobs.md`, a storybank) can end with `finish_reason: "length"` in the
  middle of the tool's arguments. C doesn't say what the loop does then.
  Name it (for example `model_error`, retryable, with no write). Add a
  stubbed test for a truncated tool call and one for a stream that ends
  with no `finish` chunk. **UNVERIFIED:** how `ai@7.0.111` surfaces either
  case.
- **CPU:** reading the stream to find `usage` should parse only the last
  `data:` line, not every chunk. That keeps it well inside 2 s.

### S7. Unrelated cuts in the same diff removed contract clauses (PROCESS: patch, verify, commit together)

About half the diff shortens sections that have nothing to do with the
proxy (§§ 2, 3, 4, 5, 6, 7). Most of it keeps the meaning. Two clauses were
lost:

- HEAD C:361 — "What was finished is the model's to say next turn, from the
  files." `apps/web/src/components/ErrorPart.tsx:6-10` cites this clause as
  its reason. Restore it, or change both places on purpose.
- HEAD C:408 — "The model never writes a card." The test at C:413-414 still
  covers it, but it was the rule that sentence stated. It belongs back in
  the § 6.2 intro.

The decision-log entry "Versions tracked by the package; status derived,
not sent" was merged into C:563 and lost its first half. Commit the
shortening separately from the money change, so each can be reviewed and
reverted on its own.

### S8. The spike-1 status in C is out of date (consistency)

C:540-542 says spike 1 is "BLOCKED until the proxy exists (streamed call,
turn-2 cache read, `web_search` annotations …). Still to show without it:
`streamText` → `toUIMessageStream`". The committed spike note already says
PASS for the live streamed call and the turn-2 cache read (S1:56-57, owner
key, 2026-09-23), and PASS for the UI message stream (S1:51). Only the
`web_search` annotations are still open (S1:332-336). C should say "1: pass,
except `web_search` annotations; re-run through the proxy as part of the
proxy spike". The proxy spike list (C:545-551) should add: a turn-2 cache
read **through the proxy**. This shows that `cache_control` survives B1's
list of accepted fields.

### S9. The proxy-spike criteria need more to be testable (C:545-551)

Keep the six. Tighten and add:

- "one ledger row per call, with the correct cost": the reference is
  `generation.total_cost` for the same id (S3).
- "the provider filter forced server-side": proved with a stubbed upstream
  or the generation record's provider (B1).
- Add: the anon key → 401 (S4); a request carrying `models` or
  `max_completion_tokens` → the outgoing body has neither (B1);
  `/embeddings` → 404 (B1); a stream stopped mid-way → a row still written
  (B2); one web-search call's cost checked against the credits change (S3);
  a turn-2 cache read through the proxy (S8).
- Live-call budget: set one before the spike starts, as spike 1 did (S1:59).

---

## NIT

- **N1. The one-tab lock's reason is gone (rule 13; rule 18).** C:505-508
  keeps the Web Locks lock. Its original reason (a reload minted a new key,
  so a second tab broke the first) went with per-user keys. What remains is
  propping up an overspend bound the server doesn't enforce (B2). Either
  give it a reason that still holds, or delete it. If B2(a) goes in, a
  second tab gets 429s, which may be a reason to keep the lock purely for
  the user experience. Say which.
- **N2.** C:509 — "a service-role Edge Function called with the user's
  session" reads as "the user holds the service role". Say it plainly: it
  runs with the service role, and acts only on the user its JWT resolves to.
- **N3.** UI § 1.5 (UI:98-107) shows `$0.00` on first run. Invited users
  start with $5.00 (C:501). The $0 case now applies only to people outside
  the invite list (B3).
- **N4.** C:463-464 — "every model call (the loop, `web_search`,
  `check_language`) goes through it". `estimate_cost`'s price lookup
  (C:253) goes straight to OpenRouter, with no key. Add "the price list is
  fetched directly, with no key" so the claim is exact.
  **UNVERIFIED:** that `GET /api/v1/models` allows browser requests.
- **N5.** S1:354 still advises "take the OpenRouter key as an injected
  value". It is a historical note, but a one-line "superseded by C § 8
  (proxy)" saves the coder a wrong turn.

---

## What is not over-built (rule 18)

Checked and kept:

- the ledger's token columns (`tokens_in/out/cached`, `model`) — they are
  what step 5b's "cost per journey is measured" (P:196) needs;
- `request_id unique` — it makes the ledger write idempotent;
- the starter credit as a row — it deletes the `accounts` table;
- a separate `delete_account` function.

A per-user rate limit is **not** recommended: the balance, B2's app-key
limit, and (if chosen) one call in flight at a time already bound the loss.
The one simplification this review asks for is B1's list of accepted fields.
It is shorter to state and to test than the current "unchanged, except".

---

## Open questions for the owner

1. B2: enforce one call in flight per user on the server, or state the true
   bound and rely on the app key's OpenRouter credit limit? What should that
   limit be?
2. B3: who is "in" the beta (a credit row, or something else), and may
   old-app users write to the new bucket?
3. B3: does `delete_account` delete the shared sign-in (and so the old-app
   account), or the beta's data only?
4. S6: is the production Supabase project on the free plan (150 s) or a
   paid plan (400 s)?
5. S5: do Vercel preview deployments run the mock only, or sign in against
   production?
6. S2: the `over_balance` copy when there is no way to add funds.

## UNVERIFIED (carried, or raised here)

- Whether `usage.cost` includes web plugin charges (neither OpenRouter page
  says).
- Whether an Edge Function keeps running inside `waitUntil` after the
  browser cancels the request.
- Whether `GET /api/v1/generation` data is available as soon as a stream
  ends.
- Sonnet 5's output speed, and so whether 4,096 tokens fit in 150 s with
  room to spare.
- The Edge Function request-body size limit (not on the limits page).
- How `ai@7.0.111` surfaces a truncated tool call or a stream with no
  finish chunk.
- Whether the "key-gated Supabase edge function" in
  `design-cowork-coaching.md:282-283` lives in this production project.
- OpenRouter's credit-purchase fee.

## Sources (fetched 2026-09-23)

- Supabase — Edge Function limits: https://supabase.com/docs/guides/functions/limits
- Supabase — background tasks (`waitUntil`): https://supabase.com/docs/guides/functions/background-tasks
- Supabase — authorization headers: https://supabase.com/docs/guides/functions/auth-headers
- Supabase — redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- OpenRouter — usage accounting: https://openrouter.ai/docs/use-cases/usage-accounting
- OpenRouter — parameters: https://openrouter.ai/docs/api-reference/parameters
- OpenRouter — model fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
- OpenRouter — streaming and cancellation: https://openrouter.ai/docs/api-reference/streaming
- OpenRouter — web search: https://openrouter.ai/docs/features/web-search
- OpenRouter — get a generation: https://openrouter.ai/docs/api-reference/get-a-generation
