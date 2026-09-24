# tests/sql — the beta SQL harness

Runs `supabase/migrations/20260923000000_ten_beta_init.sql` and
`supabase/teardown/ten_beta_teardown.sql` on **PGlite** (Postgres compiled to
WASM, in-process), against `stub.sql`: a stand-in for Supabase with the
`anon` / `authenticated` / `service_role` roles, `auth.uid()` from a JWT claim,
Supabase's real `storage.foldername` and `storage.protect_delete` code, and an
"old app" (`profiles`, an `avatars` bucket). Nothing here touches a real
database.

```
cd tests/sql
npm install          # @electric-sql/pglite 0.5.8, pinned
node run.mjs         # the round-1 review's cases (unchanged)
node run-r2.mjs      # the fix rounds' cases: guard, CAS, codes, caps, paths, pins, teardown
node r3-own.mjs      # the round-2 review's own cases: guard bypasses, lookalikes, membership, pins
node r4-own.mjs      # the round-3 review's own cases
node r5-finish-reason.mjs  # § 9.6: 20260924000000_ten_ledger_finish_reason.sql applied AFTER the init file
```

Each prints `[PASS]` / `[FAIL]` / `[OBSERVED]` lines and a failure count.

Expected on the current files: `run-r2.mjs` and `r3-own.mjs` 0 failures.
`run.mjs` has 3 expected failures: its teardown tests assume the teardown
deletes from `storage.*` in SQL, which the B1 fix makes impossible on purpose
(the teardown refuses until the bucket is emptied and deleted through the
Storage API; `run-r2.mjs` simulates that step and passes).

Limits: one connection, so parallel writes are reasoned, not run; Postgres 18.3
(PGlite) rather than Supabase's 17; the Storage API step is simulated with
`storage.allow_delete_query`. Not wired into `tests/run.py` yet (it needs
`npm install` first).
