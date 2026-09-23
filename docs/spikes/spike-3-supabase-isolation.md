# Spike 3 — Supabase Storage isolation

**Code:** `spikes/3-supabase-isolation/` · **Date:** 2026-09-23 · **Node:** v25.6.0
**Versions:** `@supabase/supabase-js@2.58.0`

**Run against:** the owner's production Supabase project (owner decision
2026-09-23). Credentials came only from the repo's git-ignored `.env.local`:
`SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable, `sb_publishable_…`),
`SUPABASE_SERVICE_ROLE_KEY` (secret, `sb_secret_…`). No other Supabase
credential exists in this environment (confirmed: `.env.local` has exactly
these three Supabase lines, no DB password, no Management API personal
access token; no Supabase CLI is installed or linked).

## Status: BLOCKED on one piece — the RLS policies could not be created

Everything that does **not** require executing SQL ran for real against
production and is reported PASS/FAIL below, with real output. The one piece
that needs SQL — creating the per-user-folder Storage RLS policies — is
**BLOCKED**: Supabase only exposes `CREATE POLICY` through the SQL editor,
the Management API (needs a personal access token, `sbp_…`), or a direct
Postgres connection (needs the project's DB password). None of those exist
in `.env.local`, which this spike was scoped to. See "The blocker" below.

Because the policies were never created, the bucket sat at Storage's
**default** state for a private bucket with zero policies: deny every
request except the service role. The per-user isolation tests (A writes,
B cannot list/read/overwrite/delete A's object, B can write its own, A
cannot read B's) ran anyway, against that default state, so the real
denials are recorded — but they are reported **BLOCKED**, not PASS, because
they prove "nobody can do anything without a policy," not "the per-user
folder rule holds." The rule under test was never actually installed.

## Pass criteria (plan step 1, spike 3) and results

| # | Criterion | Result |
|---|---|---|
| — | Create the bucket, fail if it exists | **PASS** |
| — | Create two auth users via the admin API | **PASS** |
| — | Add the per-user-folder Storage RLS policies | **BLOCKED** — no SQL execution path available (see below); exact policies drafted in `policies.sql` |
| 1 | A writes `users/A/ws/plan.md` | **BLOCKED** — refused by the RLS default-deny (no policy exists yet), not by the per-user rule |
| 2 | B cannot list `users/A/ws` | **BLOCKED** — same reason; B's list also returns nothing, but so would A's own |
| 3 | B cannot read A's object | **BLOCKED** — same reason |
| 4 | B cannot overwrite A's object | **BLOCKED** — same reason |
| 5 | B cannot delete A's object | **BLOCKED** — same reason (and A's object never existed to delete, since A's own write above was also refused) |
| 6 | B can write its own object | **BLOCKED** — refused by the same default-deny that blocks everyone until the policies exist |
| 7 | A cannot read B's object | **BLOCKED** — same reason |
| — | Cleanup: objects, bucket, policies, both users deleted; re-list proves it | **PASS** — no policies were created, so nothing to drop there; objects, bucket, and both users are confirmed gone (see output) |

## Design contract's UNVERIFIED items (`docs/design-web-agent.md` § 2)

These do **not** depend on the per-user policies — they were tested for
real, using the service-role client (which bypasses RLS) writing to its own
throwaway path inside the bucket.

| # | Question | Result |
|---|---|---|
| 1 | Does an upload honor `If-Match` (conditional write / version check)? | **NO.** A `POST … x-upsert: true` with a deliberately wrong `If-Match` value still returned `200` and overwrote the object. Supabase Storage has no native conditional-write / optimistic-concurrency support (confirmed independently: Supabase staff, [GitHub Discussion #40482](https://github.com/orgs/supabase/discussions/40482) — "Storage-level locks or conditional writes — not on the immediate roadmap"; the recommended pattern is application-level version tracking in Postgres, which matches design-web-agent.md § 4's "versions are tracked by the package," not by Storage). |
| 2 | Does `updated_at` change on overwrite? | **YES.** `2026-09-23T19:52:43.474Z` → `2026-09-23T19:52:44.053Z` after the overwrite (and the ETag changed too, `4f98f59e…` → `b252903f…`), so `FileInfo.updatedAt`/`version` (§ 2) can key off it. |
| 3 | Create-only semantics (no `x-upsert`) on an existing key | A second `POST` with no `x-upsert` on the same key is refused: `409 Duplicate` / `KeyAlreadyExists`. This is the mechanism `WorkspaceStore.write(path, content, null)` (create) should rely on — not a conditional header. |

**What this means for the design:** the workspace store's `expectedVersion`
compare-and-swap (§ 2) cannot be implemented as a Storage-level conditional
write (no `If-Match` support). Per design-web-agent.md § 2's own fallback —
*"If they don't, step 2 brings a compare-and-swap design to the architect
before building it. A read-then-upload does not meet this contract."* — this
spike confirms that fallback is needed: step 2 needs an architect-approved
compare-and-swap design (e.g., store the version/ETag in a small Postgres
table and gate the Storage write behind a `WHERE version = X` update, the
same pattern Supabase staff recommend) before writing `WorkspaceStore.write`.

## The blocker

Creating `CREATE POLICY` statements on `storage.objects` requires running
SQL against the project's Postgres database. Supabase exposes exactly three
ways to do that, and none is reachable with the credentials in
`.env.local`:

1. **Studio SQL editor** — a human, logged into the dashboard; not scriptable from here.
2. **Management API** (`POST /v1/projects/{ref}/database/query`) — needs a
   **personal access token** (`sbp_…`), a different credential from
   `SUPABASE_SERVICE_ROLE_KEY`. Not present in `.env.local`.
3. **Direct Postgres connection** (`postgres-js`, `pg`, `supabase db push`) —
   needs the project's **database password**, also a different credential.
   Not present in `.env.local`, and no Supabase CLI is linked in this
   environment (`supabase --version` → not found; no `~/.supabase` project
   link; no `supabase/config.toml` in the repo).

`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` only authenticate the
**PostgREST, Storage, and GoTrue HTTP APIs**, which do CRUD on existing
tables/objects and call existing RPC functions — they do not expose a "run
arbitrary DDL" endpoint (verified against Supabase's own docs and the
Storage security guide: uploads are blocked "unless you create an RLS
policy on the storage.objects table," and that policy is created "either
through the Studio UI (Policies section) or by directly executing SQL").
Fabricating a workaround (e.g., installing a general-purpose SQL-exec RPC
function in production to bootstrap the policies) would itself be a new,
security-sensitive capability out of this spike's scope, so it was not
done.

**The exact policies to apply are ready** in
[`spikes/3-supabase-isolation/policies.sql`](../../spikes/3-supabase-isolation/policies.sql)
— four policies (`select`/`insert`/`update`/`delete`), each scoped to
`bucket_id = 'spike3-isolation'` and to `(storage.foldername(name))[1] =
'users' and (storage.foldername(name))[2] = auth.uid()::text`, matching
`users/{uid}/ws/{path}`. They are untested against a live database. **Ask:**
either hand this spike (or step 2) a Postgres connection string / DB
password, or a Management API personal access token, so these can actually
be applied and the seven BLOCKED rows above can be re-run for real; or the
owner runs `policies.sql` once by hand through the Studio SQL editor and
that becomes step 2's starting point.

## Commands and real output

```
$ cd spikes/3-supabase-isolation && npm install
added 15 packages, and audited 16 packages in 4s
found 0 vulnerabilities

$ set -a; . ../../.env.local; set +a
$ node verify.mjs   # (masked: any sb_secret_/sb_publishable_/eyJ…/*.supabase.co would be <masked>; none appeared)

[PASS] bucket-create — create private bucket "spike3-isolation"
    {"name":"spike3-isolation"}
[PASS] users-create — create two auth users via the admin API
    A=ef5b93d4… B=2de6b152… (uids only, no keys)
[BLOCKED] policies-create — add per-user-folder Storage RLS policies scoped to bucket_id = 'spike3-isolation'
    requires SQL DDL (CREATE POLICY on storage.objects); no DB connection string and no Management API personal access token are in .env.local (only SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY). Exact policies drafted in ./policies.sql.
[PASS] signin — A and B each sign in with their own session (publishable key)
[BLOCKED] a-writes-own — A writes users/{A}/ws/plan.md with A's own session
    new row violates row-level security policy
[BLOCKED] b-cannot-list-a — B cannot list users/{A}/ws with B's own session
    returned 0 entries (pathA existed: false)
[BLOCKED] b-cannot-read-a — B cannot read A's object with B's own session
    {}
[BLOCKED] b-cannot-overwrite-a — B cannot overwrite A's object with B's own session
    new row violates row-level security policy
[BLOCKED] b-cannot-delete-a — B cannot delete A's object with B's own session
    remove() returned no error, data=[] (pathA existed: false, so this proves nothing either way)
[BLOCKED] b-writes-own — B can write its own users/{B}/ws/plan.md with B's own session
    new row violates row-level security policy
[BLOCKED] a-cannot-read-b — A cannot read B's object with A's own session
    {}
[PASS] etag-create — service-role create (POST, no x-upsert)
    status=200 body={"Key":"spike3-isolation/users/ef5b93d4-76ec-4865-8230-4b0d79d194cd/ws/etag-test.md","Id":"afa19611-de14-4a38-9d3d-c6735b8174b8"}
[INFO] etag-meta-after-create — metadata after create
    {"updated_at":"2026-09-23T19:52:43.474Z","eTag":"\"4f98f59e877ecb84ff75ef0fab45bac5\""}
[PASS] create-only-conflict — a second create (no x-upsert) on the same path is refused
    status=400 body={"statusCode":"409","error":"Duplicate","message":"The resource already exists","code":"KeyAlreadyExists"}
[INFO] if-match-conditional-write — overwrite sent with a deliberately stale If-Match header (contract's UNVERIFIED item)
    status=200 body={"Key":"spike3-isolation/users/ef5b93d4-76ec-4865-8230-4b0d79d194cd/ws/etag-test.md","Id":"afa19611-de14-4a38-9d3d-c6735b8174b8"} — If-Match with a WRONG value was NOT honored: the overwrite succeeded anyway.
[INFO (changed)] updated-at-on-overwrite — updated_at after the overwrite, compared to after create (contract's UNVERIFIED item)
    {"before":"2026-09-23T19:52:43.474Z","after":"2026-09-23T19:52:44.053Z","etag_before":"\"4f98f59e877ecb84ff75ef0fab45bac5\"","etag_after":"\"b252903fe0406836d33cc339b9c747b5\""}

--- cleanup ---
[PASS] cleanup-objects — remove 1 object(s)
    users/ef5b93d4-76ec-4865-8230-4b0d79d194cd/ws/etag-test.md
[PASS] cleanup-bucket — delete bucket "spike3-isolation"
[PASS] cleanup-user-a — delete user A
[PASS] cleanup-user-b — delete user B
[PASS] verify-bucket-gone — getBucket() now errors (bucket does not exist)
    Bucket not found
[PASS] verify-users-gone — listUsers() no longer contains spike3-a/spike3-b
    0 remaining

--- summary ---
PASS      bucket-create
PASS      users-create
BLOCKED   policies-create
PASS      signin
BLOCKED   a-writes-own
BLOCKED   b-cannot-list-a
BLOCKED   b-cannot-read-a
BLOCKED   b-cannot-overwrite-a
BLOCKED   b-cannot-delete-a
BLOCKED   b-writes-own
BLOCKED   a-cannot-read-b
PASS      etag-create
INFO      etag-meta-after-create
PASS      create-only-conflict
INFO      if-match-conditional-write
INFO (changed) updated-at-on-overwrite
PASS      cleanup-objects
PASS      cleanup-bucket
PASS      cleanup-user-a
PASS      cleanup-user-b
PASS      verify-bucket-gone
PASS      verify-users-gone

All runnable checks PASS/INFO; the policy step is BLOCKED (see above). Cleanup verified.
```

Exit code `0` (no hard FAIL, no cleanup error; the run intentionally treats
a documented BLOCKED as distinct from a FAIL — see `verify.mjs`'s summary
logic).

Also run clean from a second, independent pass before this doc was
finalized (same script, same masking, re-verifying cleanup leaves nothing
behind twice in a row) — output identical in shape, new random uids/emails
each time; both runs' `verify-bucket-gone` / `verify-users-gone` were PASS.

## The exact policies used (for step 2)

See [`policies.sql`](../../spikes/3-supabase-isolation/policies.sql) in
full. Summary: four policies on `storage.objects`, each `to authenticated`,
each scoped with `bucket_id = 'spike3-isolation' and
(storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] =
(select auth.uid()::text)` — one each for `select`, `insert`, `update`
(`using` + `with check`), and `delete`. Policy names are prefixed `spike3_`
so they're unambiguous to find and drop. **These are drafted, not applied**
— see "The blocker."

## Surprises

- Supabase's newer key format is in use on this project:
  `sb_publishable_…` / `sb_secret_…`, not the older `eyJ…` JWT-style anon /
  service-role keys. Functionally they behave the same for this spike
  (publishable = anon-equivalent, secret = service-role-equivalent).
- A private bucket with **zero** Storage policies denies even the bucket
  owner's own writes with an RLS error — "no policy" is not "public read,
  scoped write" or any other reasonable-sounding default; it's deny-all
  except the service role. This matches the docs ("By default Storage does
  not allow any uploads to buckets without RLS policies") but is worth
  restating because it means step 2 cannot ship *any* working upload until
  the SQL is applied — there's no degraded-but-functional middle state.
- `remove()` on a path that was never created returns success with an empty
  array, not an error — a reminder that a "B cannot delete A's object"
  test is only meaningful if A's object provably exists first (this spike's
  script logs `pathA existed: <bool>` next to that result for exactly this
  reason).
- The create-only / overwrite distinction on Supabase Storage's HTTP API is
  driven entirely by the `x-upsert` request header, not by
  `If-None-Match`/`If-Match` — those standard HTTP conditional headers are
  accepted (no error) but silently ignored.

## What is NOT done

- The four RLS policies in `policies.sql` are **not applied** to the
  project. No compare-and-swap design for `WorkspaceStore.write`'s
  `expectedVersion` has been proposed to the architect yet (this spike only
  establishes that Storage itself can't do it).
- The seven per-user isolation assertions (A writes; B blocked on
  list/read/overwrite/delete; B writes own; A blocked reading B) have not
  actually been proven against the real per-user rule — only against the
  default deny-all state. They need to be re-run once the policies exist.
- CI wiring ("isolation tests turned into CI," step 2's exit) is out of this
  spike's scope.

## Blockers / open questions for the lead

1. **Need one of:** a Postgres connection string (DB password) for this
   project, or a Supabase Management API personal access token (`sbp_…`),
   so `policies.sql` can actually be applied and the isolation tests
   re-run for real — or have the owner apply `policies.sql` by hand via the
   Studio SQL editor.
2. **Design follow-up, not a blocker for this spike but flagged per § 2's
   own instruction:** since `If-Match` is not honored, step 2 needs an
   architect-approved compare-and-swap design for `WorkspaceStore.write`'s
   `expectedVersion` before it's built (design-web-agent.md § 2 already
   anticipates this exact outcome and names this as the next step).
