# Spike 3 — Supabase isolation, re-run against the applied migration

**Code:** `spikes/3-supabase-isolation/` · **Date:** 2026-09-23 · **Node:** v25.6.0
**Versions:** `@supabase/supabase-js@2.58.0`

**Run against:** the owner's production Supabase project `career-coach-nextgen`
(ref `ivunfotoggdxbjouumdk`), immediately after
`supabase/migrations/20260923000000_ten_beta_init.sql` was applied (owner,
2026-09-23) — this is the OWNER CHECKLIST's step 3 in that file: "Re-run spike
3's isolation tests against the real project." Credentials came only from the
repo's git-ignored `.env.local`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
(publishable, `sb_publishable_…`), `SUPABASE_SERVICE_ROLE_KEY` (secret,
`sb_secret_…`).

## Status: PASS

Every isolation test below is a real **PASS** against the live project, on
the real `ten-workspaces` bucket, `ten_ws_files`, `ten_usage_ledger`,
`ten_gate_log` tables and the `ten_*` RPC functions the migration created —
not a throwaway bucket, not a draft policy file. This supersedes the first
pass (2026-09-23, earlier the same day), which was **BLOCKED** because the
migration had not been applied yet and this spike had no path to run
`CREATE POLICY` itself (see git history for that run's output; its
UNVERIFIED-item findings on `If-Match`/`updated_at` are unchanged and
restated below since they came from the service-role client, independent of
the per-user policies).

Unlike the first pass, this run creates **nothing** structural: the bucket,
tables, functions and policies all already exist from the migration. This
run only creates 3 throwaway auth users, a $5 credit ledger row each for two
of them, and a handful of rows/objects under those 3 users — all removed in
`cleanup()`, verified by re-querying afterward.

## Scope

Exactly 3 throwaway auth users, created via the admin API:

- **A** (`spike3-a+<rand>@example.com`) — given a $5 `credit` ledger row (service role): a beta member.
- **B** (`spike3-b+<rand>@example.com`) — given a $5 `credit` ledger row (service role): a beta member.
- **N** (`spike3-n+<rand>@example.com`) — no ledger row: **not** a member.

No table, function, policy or bucket was created or altered. All three tests
below run with each user's **own session** (`signInWithPassword`, publishable
key) except the credit-row insert, the pre/post-cleanup verification, and the
service-role reads used only to prove another user's row was untouched
(never used to perform the action under test).

## Results — `ten_ws_files` (RPC `ten_ws_write` + table select)

| Test | Result |
|---|---|
| A creates `plan.md` (`ten_ws_write`, create) | **PASS** — `200`, returns `path/version/updated_at` |
| B's select of A's row returns 0 rows | **PASS** — `200`, `[]` |
| B's write to `plan.md` creates B's own row, not A's; A's row unchanged | **PASS** — B's write `200` (its own `user_id, path` row); service-role read of A's row afterward: unchanged content |
| Stale `expectedVersion` → PT409 `version_conflict` | **PASS** — `409 {"message":"version_conflict"}` |
| Missing file with an `expectedVersion` → PT404 `resource_missing` | **PASS** — `404 {"message":"resource_missing"}` |
| Create twice (no `expectedVersion` on an existing path) → PT409 `already_exists` | **PASS** — `409 {"message":"already_exists"}` |
| Path rule: `skills/x.md` → PT403 `not_editable` | **PASS** |
| Path rule: `claude.md` in a subfolder → PT403 `not_editable` | **PASS** |
| Path rule: `../x.md` → PT400 `invalid_ref` | **PASS** |
| Path rule: `.hidden.md` → PT400 `invalid_ref` | **PASS** |
| Path rule: a zero-width char (U+200B) → PT400 `invalid_ref` | **PASS** |
| Path rule: an NFD-normalized path (`e` + combining acute, not precomposed) → PT400 `invalid_ref` | **PASS** |
| N (non-member): write → PT403 `not_a_member` | **PASS** |
| N (non-member): select → 0 rows | **PASS** |
| anon (publishable key, no session): write refused | **PASS** — `401`, `42501 permission denied for function ten_ws_write` (no `execute` grant to `anon`) |
| anon (publishable key, no session): select refused | **PASS** — `401`, `42501 permission denied for table ten_ws_files` (no `select` grant to `anon`) |

## Results — Storage (`ten-workspaces` bucket, Storage API)

| Test | Result |
|---|---|
| A uploads `users/{A}/ws/documents/cv.pdf` (tiny valid PDF) | **PASS** |
| B cannot list `users/{A}/ws/documents` | **PASS** — 0 entries |
| B cannot download A's `cv.pdf` | **PASS** — error |
| B cannot overwrite A's `cv.pdf` | **PASS** — "new row violates row-level security policy" (also: no update policy exists at all, create-only for everyone) |
| B uploading a new file into A's folder is refused | **PASS** — same RLS error |
| A uploading a `.md` file to the bucket is refused (binaries only) | **PASS** — "mime type text/markdown is not supported" (bucket's `allowed_mime_types`) |
| N (non-member) cannot upload to their own folder | **PASS** — RLS error (`ten_is_member()` false in the insert policy) |
| anon cannot list `users/{A}/ws/documents` | **PASS** — 0 entries |
| anon cannot download A's `cv.pdf` | **PASS** — error |
| A can read their own `cv.pdf` | **PASS** — downloaded size matches the uploaded bytes (188 bytes) |

## Results — the ledger

| Test | Result |
|---|---|
| A sees only their own `ten_usage_ledger` rows | **PASS** — 1 row, `user_id = A` |
| `ten_balance()` = 5 for A | **PASS** |
| `ten_balance()` = 0 for N | **PASS** |
| A cannot call `ten_balance_for` (service-role only) | **PASS** — `403`, `42501 permission denied for function ten_balance_for` |
| A cannot call `ten_beta_spend_today` (service-role only) | **PASS** — `403`, `42501 permission denied for function ten_beta_spend_today` |
| A cannot insert a ledger row directly | **PASS** — `403`, `42501 permission denied for table ten_usage_ledger` |

## Results — the gate

| Test | Result |
|---|---|
| A can `ten_gate_open` their own | **PASS** — `204` |
| B cannot decide A's gate | **PASS** — `ten_gate_decide` returns `false`; the row is confirmed still `pending` (service-role read) before A decides it |
| A can `ten_gate_decide` their own | **PASS** — returns `true` |
| N (non-member) gets `not_a_member` on `ten_gate_open` | **PASS** — `403 {"message":"not_a_member"}` |

## Cleanup

Verified by re-listing/re-querying, not by trusting the in-memory record of
what this script wrote:

- **Objects:** the uploaded `cv.pdf` (the only object that ever existed —
  every refused upload attempt, being refused, left nothing to clean) removed
  via the Storage API with the service role; re-`list()` of `users/{A,B,N}/ws`
  and `.../documents` afterward: **0 objects**.
- **Users:** the 3 auth users deleted via the admin API; `ten_ws_files`,
  `ten_usage_ledger`, `ten_gate_log` rows are FK `on delete cascade` from
  `auth.users`, confirmed by a direct service-role count of rows for those 3
  `user_id`s afterward: **0 rows** across all three tables.
- **Users gone:** `listUsers()` filtered to the 3 throwaway emails afterward:
  **0 remaining**.

Run twice, independently, back to back (fresh random emails/uids each time,
same masking): both runs produced the identical PASS shape for every one of
the 40 test assertions plus the 7 cleanup/verification checks (47 total).

## Findings carried over from the first (BLOCKED) pass — unchanged

These came from the service-role client bypassing RLS, so they never
depended on the migration being applied, and are unchanged by this re-run
(not re-verified here; see the first pass in git history for the raw output):

- Supabase Storage does not honor `If-Match` — a stale `If-Match` on an
  `x-upsert: true` overwrite still succeeds. Confirmed independently
  ([GitHub Discussion #40482](https://github.com/orgs/supabase/discussions/40482)).
  This is why `ten_ws_write`'s compare-and-swap lives in SQL (`version =
  expected`), not Storage headers — and why binaries in `ten-workspaces` are
  **create-only** (no update policy at all; § 2's `WorkspaceStore.upload` is
  never asked to overwrite).
- `updated_at` changes on a service-role overwrite, and the object's ETag
  changes with it.
- Create-only semantics (no `x-upsert`) on an existing key are enforced by
  Storage itself: a second `POST` with no `x-upsert` is refused `409
  Duplicate` / `KeyAlreadyExists`, independent of any RLS policy.

## Commands and real output

```
$ cd spikes/3-supabase-isolation && npm install
added 15 packages, and audited 16 packages in 567ms
found 0 vulnerabilities

$ set -a; . ../../.env.local; set +a
$ node verify.mjs 2>&1 | sed -E 's/(sb_(secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]{20,}|https:\/\/[a-z0-9]+\.supabase\.co)/<masked>/g'

[PASS] precondition-bucket-exists — bucket "ten-workspaces" already exists (from the migration, not created here)
    {"id":"ten-workspaces","public":false}
[PASS] users-create — create 3 throwaway auth users via the admin API
    A=a8ba23ac… B=e0e13efa… N=8010fbea… (uids only, no keys)
[PASS] credit-rows — insert a $5 credit row for A and B (service role); N stays non-member
    {}
[PASS] signin — A, B, N each sign in with their own session (publishable key)
[PASS] ws-a-create — A creates plan.md via ten_ws_write (create)
    status=200 body=[{"path":"plan.md","version":"9fe20831caa2d735","updated_at":"2026-09-23T22:05:45.956064+00:00"}]
[PASS] ws-b-cannot-select-a — B's select of A's ten_ws_files row returns 0 rows
    status=200 rows=[]
[PASS] ws-b-write-own-not-a — B's write to 'plan.md' creates B's own row; A's row unchanged
    bStatus=200 bBody=[{"path":"plan.md","version":"e8b7f057815e1b59","updated_at":"2026-09-23T22:05:46.361753+00:00"}] aRowNow=[{"user_id":"a8ba23ac-92b0-4ce7-9108-de2bb22dddee","path":"plan.md","content":"# A's plan\n"}]
[PASS] ws-stale-version — A stale expectedVersion -> PT409 version_conflict
    status=409 body={"code":"PT409","details":null,"hint":null,"message":"version_conflict"}
[PASS] ws-missing-file — A writes a missing file with an expectedVersion -> PT404 resource_missing
    status=404 body={"code":"PT404","details":null,"hint":null,"message":"resource_missing"}
[PASS] ws-create-twice — A creates 'plan.md' again (no expectedVersion) -> PT409 already_exists
    status=409 body={"code":"PT409","details":null,"hint":null,"message":"already_exists"}
[PASS] ws-path-rule-skills-x-md — path rule: skills/x.md -> PT403 not_editable
    status=403 body={"code":"PT403","details":null,"hint":null,"message":"not_editable"}
[PASS] ws-path-rule-claude-md-in-a-subfolder — path rule: claude.md in a subfolder -> PT403 not_editable
    status=403 body={"code":"PT403","details":null,"hint":null,"message":"not_editable"}
[PASS] ws-path-rule--x-md — path rule: ../x.md -> PT400 invalid_ref
    status=400 body={"code":"PT400","details":null,"hint":null,"message":"invalid_ref"}
[PASS] ws-path-rule--hidden-md — path rule: .hidden.md -> PT400 invalid_ref
    status=400 body={"code":"PT400","details":null,"hint":null,"message":"invalid_ref"}
[PASS] ws-path-rule-a-zero-width-char — path rule: a zero-width char -> PT400 invalid_ref
    status=400 body={"code":"PT400","details":null,"hint":null,"message":"invalid_ref"}
[PASS] ws-path-rule-NFD-normalized-path — path rule: NFD-normalized path -> PT400 invalid_ref
    status=400 body={"code":"PT400","details":null,"hint":null,"message":"invalid_ref"}
[PASS] ws-n-write — N (non-member) write -> PT403 not_a_member
    status=403 body={"code":"PT403","details":null,"hint":null,"message":"not_a_member"}
[PASS] ws-n-select — N (non-member) select -> 0 rows
    status=200 rows=[]
[PASS] ws-anon-write — anon (no session) write is refused
    status=401 body={"code":"42501","details":null,"hint":null,"message":"permission denied for function ten_ws_write"}
[PASS] ws-anon-select — anon (no session) select is refused or returns 0 rows
    status=401 body={"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT SELECT ON public.ten_ws_files TO anon;","message":"permission denied for table ten_ws_files"}
[PASS] st-a-upload — A uploads users/{A}/ws/documents/cv.pdf (tiny valid PDF)
    {"path":"users/a8ba23ac-92b0-4ce7-9108-de2bb22dddee/ws/documents/cv.pdf","id":"897896a1-e0f4-4957-b9ea-7cb943bf7caf","fullPath":"ten-workspaces/users/a8ba23ac-92b0-4ce7-9108-de2bb22dddee/ws/documents/cv.pdf"}
[PASS] st-b-cannot-list-a — B cannot list users/{A}/ws/documents
    entries=0
[PASS] st-b-cannot-download-a — B cannot download A's cv.pdf
    {}
[PASS] st-b-cannot-overwrite-a — B cannot overwrite A's cv.pdf
    new row violates row-level security policy
[PASS] st-b-cannot-upload-into-a — B uploading a new file into A's folder is refused
    new row violates row-level security policy
[PASS] st-md-refused — A uploading a .md file to the bucket is refused (binaries only)
    mime type text/markdown is not supported
[PASS] st-n-cannot-upload — N (non-member) cannot upload to their own folder
    new row violates row-level security policy
[PASS] st-anon-cannot-list — anon cannot list users/{A}/ws/documents
    entries=0
[PASS] st-anon-cannot-download — anon cannot download A's cv.pdf
    {}
[PASS] st-a-can-read-own — A can read their own cv.pdf
    size=188
[PASS] ledger-a-own-rows — A sees only their own ten_usage_ledger rows
    status=200 rows=[{"user_id":"a8ba23ac-92b0-4ce7-9108-de2bb22dddee","kind":"credit","usd":5}]
[PASS] ledger-balance-a — ten_balance() = 5 for A
    status=200 body=5
[PASS] ledger-balance-n — ten_balance() = 0 for N
    status=200 body=0
[PASS] ledger-a-cannot-balance-for — A cannot call ten_balance_for (service-role only)
    status=403 body={"code":"42501","details":null,"hint":null,"message":"permission denied for function ten_balance_for"}
[PASS] ledger-a-cannot-spend-today — A cannot call ten_beta_spend_today (service-role only)
    status=403 body={"code":"42501","details":null,"hint":null,"message":"permission denied for function ten_beta_spend_today"}
[PASS] ledger-a-cannot-insert — A cannot insert a ten_usage_ledger row directly
    status=403 body={"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT INSERT ON public.ten_usage_ledger TO authenticated;","message":"permission denied for table ten_usage_ledger"}
[PASS] gate-a-open — A can ten_gate_open
    status=204 body=""
[PASS] gate-b-cannot-decide-a — B cannot decide A's gate (returns false; gate stays pending)
    decideStatus=200 decideBody=false rowNow=[{"status":"pending"}]
[PASS] gate-a-decide — A can ten_gate_decide their own gate
    status=200 body=true
[PASS] gate-n-not-a-member — N (non-member) ten_gate_open -> PT403 not_a_member
    status=403 body={"code":"PT403","details":null,"hint":null,"message":"not_a_member"}

--- cleanup ---
[PASS] cleanup-objects — remove 1 object(s) from ten-workspaces
    users/a8ba23ac-92b0-4ce7-9108-de2bb22dddee/ws/documents/cv.pdf
[PASS] cleanup-user-a — delete user A
[PASS] cleanup-user-b — delete user B
[PASS] cleanup-user-n — delete user N
[PASS] verify-objects-gone — 0 objects left in ten-workspaces for A/B/N
    remaining=0
[PASS] verify-ten-rows-gone — 0 ten_ rows left for A/B/N (cascade on user delete)
    remaining=0
[PASS] verify-users-gone — the 3 throwaway users are gone
    0 remaining

--- summary ---
PASS   precondition-bucket-exists
PASS   users-create
PASS   credit-rows
PASS   signin
PASS   ws-a-create
PASS   ws-b-cannot-select-a
PASS   ws-b-write-own-not-a
PASS   ws-stale-version
PASS   ws-missing-file
PASS   ws-create-twice
PASS   ws-path-rule-skills-x-md
PASS   ws-path-rule-claude-md-in-a-subfolder
PASS   ws-path-rule--x-md
PASS   ws-path-rule--hidden-md
PASS   ws-path-rule-a-zero-width-char
PASS   ws-path-rule-NFD-normalized-path
PASS   ws-n-write
PASS   ws-n-select
PASS   ws-anon-write
PASS   ws-anon-select
PASS   st-a-upload
PASS   st-b-cannot-list-a
PASS   st-b-cannot-download-a
PASS   st-b-cannot-overwrite-a
PASS   st-b-cannot-upload-into-a
PASS   st-md-refused
PASS   st-n-cannot-upload
PASS   st-anon-cannot-list
PASS   st-anon-cannot-download
PASS   st-a-can-read-own
PASS   ledger-a-own-rows
PASS   ledger-balance-a
PASS   ledger-balance-n
PASS   ledger-a-cannot-balance-for
PASS   ledger-a-cannot-spend-today
PASS   ledger-a-cannot-insert
PASS   gate-a-open
PASS   gate-b-cannot-decide-a
PASS   gate-a-decide
PASS   gate-n-not-a-member
PASS   cleanup-objects
PASS   cleanup-user-a
PASS   cleanup-user-b
PASS   cleanup-user-n
PASS   verify-objects-gone
PASS   verify-ten-rows-gone
PASS   verify-users-gone

All checks PASS. Cleanup verified.
```

Exit code `0`. Run a second, independent time immediately after (fresh
random emails/uids), same command, same masking — identical PASS shape for
all 47 lines; both runs' `verify-objects-gone` / `verify-ten-rows-gone` /
`verify-users-gone` were PASS.

## What is NOT done

- Step 2 (building `WorkspaceStore` against Supabase, wiring `ten-model-proxy`
  end to end, CI-wiring these isolation tests) is out of this spike's scope.
- This run did not re-verify the `If-Match`/`updated_at`/create-only Storage
  behavior from the first pass (unaffected by the migration, so not repeated
  here; see "Findings carried over" above).
- `policies.sql` (the first pass's drafted, hand-written policy set) was
  **not** what got applied — the real policies are in the migration
  (`ten_ws_objects_select_own`, `ten_ws_objects_insert_own`, the two
  restrictive pins), which additionally enforce `ten_is_member()`, the binary
  extension, the path rules, no-clash, and the 50-object cap; `policies.sql`
  is left as-is in this directory as prior-art context for
  `docs/reviews/proxy-change-review.md`, not as the source of truth.

## Blockers / open questions for the lead

None. Every isolation test in this spike's scope passed against the real
project with real policies. No policy, function, or table needed changing to
make a test pass.
