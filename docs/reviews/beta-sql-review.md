# Review: the Ten beta SQL, before it touches production

**Reviewer:** architect (independent; I wrote none of the reviewed files)
**Date:** 2026-09-23
**Reviewed:** in this worktree:
- `supabase/migrations/20260923000000_ten_beta_init.sql` (M)
- `supabase/teardown/ten_beta_teardown.sql` (T)
- `docs/design-web-agent.md` § 2, § 3 and § 8 (C; r3 in round 1, r4 in round 2. Line numbers in the round-1 sections were remapped once, before r4; the round-2 section cites r4)

**Context:** `docs/reviews/proxy-change-review.md` (B4: prefixed names, a
teardown) and `docs/spikes/spike-3-supabase-isolation.md` (main checkout).

**Measured against:** PRINCIPLES rules 7, 8, 9, 11, 12 and 18, and the
contract's own "Prevents / Proved by" lines.

## FINAL VERDICT (round 3): YES, safe to apply to `career-coach-nextgen`

**This verdict holds for exactly these files:**

| file | sha1 |
|---|---|
| migration | `1bddd584debd2b3bc3f4ed940a0b61495fbf0d0b` |
| teardown | `bbb1fadec96a1a1681901c0e3a11810c0e4bb2f6` |
| contract | `493a711af949a983c56849fcb3be5c2016fa39ed` |

I checked all three hashes before and after my runs. **If any file changes,
this verdict lapses.**

**The owner follows the migration header's checklist in order:**
1. Run the read-only queries and see the observed baseline.
2. Apply at a quiet time.
3. Re-run spike 3's isolation tests.
4. Only then insert the first credit row.

**What round 3 closed:**
- Every round-2 SHOULD item.
- The owner's $5/day beta ceiling.

**Still open, none of it blocking:**
- NITs only, listed in § "Verification (round 3)".

## Round-2 verdict (superseded by round 3): YES, safe for the owner to apply to production

This covered the migration and the teardown as they stood then:
- migration sha1 `a16a0aa7…`
- teardown sha1 `83331b90…`
- target `career-coach-nextgen` (Postgres 17), with open sign-up

**Conditions.** They are already in the migration's header checklist
(M:24-43):
1. Apply it at a quiet time.
2. Run spike 3's isolation re-run **before the first credit row**.

All four round-1 blockers are fixed, and I checked each one myself
(§ "Verification of fixes").

**What makes it safe to apply today:**
- The migration touches only new `ten_` objects. It is atomic, and it
  gives up after a 3-second lock wait.
- The owner's read-only query found **zero** storage policies, and RLS is
  on for both storage tables. So there is nothing on the project today that
  the guard's remaining gaps could miss.
- A signed-in user who isn't a member can't read or write any beta data,
  apart from the stated exceptions.
- The teardown works once the Storage API step is done.

**Still open, none of it blocking the apply:**
- **R2-S1 (strongest):** add a RESTRICTIVE "pin" on the bucket. The guard
  runs once. Any storage policy the old app adds **later** could reach
  beta files, and I tested five guard bypasses. The pin closes all of
  that. Land it before the first credit row.
- **R2-S2:** refuse zero-width and direction characters in paths.
  `CLA<U+200C>UDE.md` is accepted, and on an HFS+ disk it *is*
  `CLAUDE.md`.
- **R2-S3:** do the NFC check in the database, not only in the client.
- **R2-S4:** refuse a file and a folder with the same name (`plan.md` and
  `plan.md/x.md`).
- **R2-S5:** fix two contract drifts. C:557 still says invoker. C:597
  cites a harness that lives in a session scratchpad.
- **R2-S6:** the shared OpenRouter key can now cut off the live app.
  C:589 claims to prevent that. **Owner decision.**

Round-1 findings follow, unchanged as a record. Their status is in the
verification section at the end.

## Round-1 verdict (superseded): not yet safe to apply to production

The design is sound, and most of it is already right:
- It creates only `ten_`/`ten-` objects.
- It runs in one transaction, and a refused run leaves nothing behind.
- RLS is on for all three tables, and `anon` is revoked.
- Users cannot write the ledger.
- `ten_balance_for` is service-role only.
- The compare-and-swap is one conditional `UPDATE` or an `INSERT … ON CONFLICT DO NOTHING`.
- The path rules are enforced in the database, not just in the client.

I ran all of this. Four things still block applying it:

1. **The teardown can't run on current Supabase.** Supabase's delete guard
   refuses it, and the SQL route would leave the uploaded files behind in
   storage (B1).
2. **The pre-flight guard checks text, not meaning.** A policy that
   *mentions* `bucket_id` but doesn't restrict to one bucket gets through.
   I showed member B reading member A's file after the guard passed (B2).
3. **Anyone signed in to the old app can write into production, with no
   size limit,** through `ten_gate_open` (B3).
4. **No lock timeout.** The transaction can stall the old app's sign-ins
   and Storage while it waits for a lock (B4).

Each fix is small. Once B1–B4 land, and the owner has done the
read-only policy check in B2, I'd expect a yes.

---

## How this was checked

- **No `postgres`, `pg_ctl`, `psql` or docker on this machine.** Instead I
  ran the SQL on **PGlite 0.5.8, which is Postgres 18.3 compiled to WASM**
  (`npm i @electric-sql/pglite`, in the session scratchpad).
- **The stand-in Supabase:**
  - roles `anon`, `authenticated`, and `service_role` (bypassrls);
  - `auth.users` and an `auth.uid()` that reads `request.jwt.claims`;
  - Supabase's public-schema default privileges (grant all to the three roles);
  - `storage.buckets` and `storage.objects` with RLS on, and the column set
    from the `supabase/storage` repo migrations;
  - the **real** `storage.foldername`
    (`migrations/tenant/0060-optimize-existing-functions-again.sql`);
  - the **real** `storage.protect_delete` triggers
    (`migrations/tenant/0055-prevent-direct-deletes.sql`);
  - an "old app" with a `profiles` table and an `avatars` bucket.
- Each case below ran as a real role (`set role authenticated` plus a JWT
  claim).
- **Not executed:** two truly concurrent writers. PGlite has one
  connection, so the race in § 3 is reasoned from Postgres semantics.
- Postgres 18 is newer than Supabase's 15 or 17. Nothing in the files is
  specific to 18: `sha256()` exists since 11 and `gen_random_uuid()` since 13.

**Results: 58 pass/fail checks (5 FAIL) plus 20 recorded observations. Every FAIL, and every observation that matters, is a finding below.**

| area | result |
|---|---|
| Migration on a clean stand-in | applies |
| Catalog diff (pg_class, pg_proc with ACLs, pg_policies, buckets, default ACLs, schema ACLs) | no existing entry removed or changed. Everything added is `ten_`/`ten-` named. It also adds 6 internal FK triggers on `auth.users` (S7) |
| Second run | refused by the guard; catalog byte-identical |
| Teardown with Supabase's real delete triggers | **FAIL**: `42501 Direct deletion from storage tables is not allowed`. The whole teardown rolled back (B1) |
| Teardown with those triggers switched off | the catalog returns exactly to the pre-migration state, `auth.users` triggers included |
| Guard, old policy `using (true)` / no `bucket_id` | refused |
| Guard, old policy `bucket_id <> 'secret'` | **FAIL**: applied, and member B then read A's `ten-workspaces` object (B2) |
| Guard, old policy `bucket_id = 'avatars' or auth.uid() is not null` | **FAIL**: applied, and B read A's object (B2) |
| Guard, RLS switched off on `storage.objects` | **FAIL**: applied (B2) |
| Compare-and-swap: create / create again / right version / stale version / missing | ok / `already_exists` / ok / `version_conflict` / `resource_missing` |
| `version` | `2cf24dba5fb0a30e` for `"hello"`, the same as `workspace-core.mjs:20-21` `versionOf` |
| Isolation, `ten_ws_files` | B sees none of A's rows. B's `plan.md` is a separate row. Direct INSERT/UPDATE are refused. A non-member gets `not_a_member`. `anon` is refused on the table and the function |
| Path rules | `../x.md`, `a/../x.md`, `/abs.md`, `.hidden.md`, `a/.git/x.md`, `skills/x.md`, `x.exe` and `x.pdf` are refused. **Accepted:** `Skills/x.md`, `claude.md`, `a//b.md`, a path with a newline, `a\..\b.md`. `NOTES.MD` is refused (S2, N3) |
| `CLAUDE.md` | create accepted; update → `not_editable` |
| Size | exactly 2 MB accepted; 2 MB + 1 byte refused |
| Money | the user can't insert or update the ledger. `authenticated` can't run `ten_balance_for`, and `service_role` can. A duplicate `request_id` is rejected. The balance is exact (`4.876544`) |
| Gates | **a non-member's `ten_gate_open` is accepted**, including a 5 MB label (B3). A user approves their own gate by direct RPC with any `typed_text` (S5). Deciding twice → `false`. B can't decide N's gate |
| Storage | A uploads into her own folder. A→B's folder, a non-member, and outside `ws/` are all refused. Update matches 0 rows. **Accepted:** `users/A/ws/plan.md` (a text path), `.hidden/x.pdf`, `ws/skills/x.pdf` (S1) |
| Locks held by the migration | `ShareRowExclusiveLock` on `auth.users` and `AccessExclusiveLock` on `storage.objects`, both until COMMIT (B4) |

---

## BLOCKERS

### B1. The teardown can't run on current Supabase, and its SQL route would leave the files behind (rule 9; C:481-483, C:572)

**Where:**
- T:11 `delete from storage.objects where bucket_id = 'ten-workspaces';`
- T:14 `delete from storage.buckets where id = 'ten-workspaces';`

**Why it breaks:** Supabase Storage now puts a statement-level `BEFORE
DELETE` trigger, `storage.protect_delete`, on **both** `storage.objects`
and `storage.buckets` (`supabase/storage`
`migrations/tenant/0055-prevent-direct-deletes.sql`).
- It raises `42501 Direct deletion from storage tables is not allowed.
  Use the Storage API instead.`
- Because it fires per statement, it raises even when **zero** rows match.
- So T fails at line 11 on every current project, even one with an empty
  bucket.
- T's comment (T:9-10) covers only a non-empty bucket. Line 14 fails too.

Reproduced: T errors, and the whole teardown rolls back. Rolling back
whole is safe, but the owner's way back doesn't work.

Worse, the workaround the trigger's GUC allows
(`set local storage.allow_delete_query = 'true'`) removes the metadata
rows but **not the files in the storage backend**. The candidates' résumés
would outlive "delete". That breaks rule 9 ("it's gone when you delete
it"), which is exactly what the trigger exists to prevent.

**Fix:**
1. Make the Storage API step the teardown's first step, not a fallback.
   With the service role: empty the bucket, then delete it
   (`emptyBucket`/`deleteBucket` in supabase-js, or the Storage REST
   calls). Write it as a short script next to T, or as exact
   dashboard steps.
2. Then T.
   - Start T with a check that **refuses** if the `ten-workspaces` bucket
     or any of its objects still exists.
   - Drop the two policies, the seven functions and the three tables.
   - Delete T:11 and T:14.
3. Re-run the harness: T must pass with the real triggers **on**.

The same trigger governs `ten-delete-account` (S6).

### B2. The pre-flight guard matches the text `bucket_id`, not a filter to one bucket (rules 8, 11; C:483-485)

**Where:**
- M:18-25: the guard refuses when
  `coalesce(qual,'') || coalesce(with_check,'') not like '%bucket_id%'`.
- C:483-485: "The migration refuses to run if any `storage.objects` policy
  lacks a `bucket_id` filter".

**Why it breaks:** a policy passes if the word `bucket_id` appears anywhere
in it. Several common shapes mention the column but still reach the new
bucket:
- `bucket_id <> 'x'`;
- `bucket_id = 'avatars' OR <anything>`;
- `bucket_id IS NOT NULL`;
- `bucket_id LIKE …`;
- `bucket_id` inside a `NOT`.

Reproduced: with an old-app policy `using (bucket_id <> 'secret')`, the
migration applied, and member B then listed
`users/<A>/ws/documents/cv.pdf`. The same happened with an OR'd policy.

Two more gaps:
- The guard doesn't check that RLS is still **on** for `storage.objects`
  (it applied with RLS off).
- It doesn't look at `storage.buckets` policies at all. An old
  `for update`/`for all` policy there would let any signed-in user set
  `ten-workspaces` to `public = true`. That bypasses every object policy
  for downloads.

So the guard is a useful tripwire, but C states it as a guarantee (rule 8).

**Fix (no new machinery):**
1. **Before applying, the owner runs one read-only query** in the SQL
   editor and reads every row:

   ```sql
   select tablename, policyname, cmd, roles, permissive, qual, with_check
     from pg_policies where schemaname = 'storage' order by 1, 2;
   select relname, relrowsecurity from pg_class
    where oid in ('storage.objects'::regclass, 'storage.buckets'::regclass);
   ```

   The bar each row must meet:
   - every `storage.objects` policy has `bucket_id = '<one named bucket>'`
     (or `IN (…named…)`) **ANDed at the top level**, in both `qual` and
     `with_check`;
   - no `storage.buckets` policy allows `UPDATE`, `DELETE` or `ALL`;
   - both tables show `relrowsecurity = true`.

   Paste the output (policy names and expressions only, no data) into the
   step 2 record.
2. **Tighten the guard to match that bar** in the easy cases:
   - refuse if `relrowsecurity` is false on `storage.objects`;
   - refuse any `storage.buckets` policy whose `cmd` is `UPDATE`,
     `DELETE` or `ALL`;
   - refuse any `storage.objects` policy whose text has no
     `bucket_id = '`, or has ` OR `, `<>`, `!=`, `NOT ` or `IS NOT NULL`.

   Have it `raise notice` each policy it accepted, so the run leaves a
   record.
3. **Change C:483-485** to say the guard is a tripwire. The proof is the
   owner's read (step 1) plus the spike 3 re-run with the real policy list
   (C:584-589). Order it: **the isolation re-run passes before the first
   credit row is inserted.**
   - Our insert policy requires membership (M:264), so the bucket holds no
     candidate data until then.
   - That ordering is what actually bounds the risk.

### B3. Anyone signed in to the old app can write unbounded rows into production (C:491-493, C:562 "a non-member … storing")

**Where:**
- M:181-195: `ten_gate_open` checks only that someone is signed in. It
  does not check membership.
- M:54-68: `label`, `text_hash`, `gate_line`, `chat_id` and `typed_text`
  have no length limit.
- M:230-236 grants it to every `authenticated` user.

**Why it breaks:**
- C:491 says "anyone can sign in". The project's sign-in is shared with
  the old app.
- So any signed-up account can call `rpc/ten_gate_open` in a loop and
  write rows of any size into the shared production database.
- Reproduced: a non-member's call was accepted, and so was a 5 MB label.
- C:562 says the design prevents "a non-member spending or storing".

**Fix:**
- Add the same membership check `ten_ws_write` has (M:146-149) to
  `ten_gate_open`.
- Add length checks to the table:
  - `label` ≤ 200 characters (the contract allows 6 words);
  - `text_hash` = 71 characters (`sha256:` + 64 hex);
  - `gate_line` ≤ 300;
  - `chat_id` ≤ 100;
  - `typed_text` ≤ 100 (only `yes`/`no`-type replies are ever stored).
- Test: a non-member's `ten_gate_open` → `not_a_member`; an oversized
  field is refused.

### B4. No lock timeout, so the old app's sign-ins and Storage can stall behind this transaction (production safety)

**Where:**
- M:8 `begin;`, with no `lock_timeout`.
- M:41, 56 and 73 add foreign keys to `auth.users`.
- M:248 and M:257 run `create policy … on storage.objects`.

**Why it breaks:** measured with `pg_locks`, the transaction holds two
locks until COMMIT:
- **`ShareRowExclusiveLock` on `auth.users`**, from the first
  `create table`. This blocks every write to `auth.users`, and sign-ins
  write it.
- **`AccessExclusiveLock` on `storage.objects`**, from the first
  `create policy`.

If any old-app query is running on `storage.objects`:
- `create policy` waits for it;
- every later Storage request from the old app queues behind the waiting
  lock;
- the `auth.users` lock is already held, so the old app's sign-ins stall
  for as long as the wait lasts.

The owner watching the SQL editor sees only "running".

**Fix:** put `set local lock_timeout = '3s';` right after `begin;`, in
both M and T. A busy moment then fails fast and rolls back whole, and
the owner retries. Say in the header: apply at a quiet time.

---

## SHOULD

### S1. The bucket's insert policy doesn't enforce the extension or the path rules (rule 12 "one home per file"; C:98-99, C:113-116)

**Where:** M:257-265. The policy checks the bucket, `users/{uid}/ws/`
and membership, but not the file name.

**Why it matters:**
- The bucket's `allowed_mime_types` (M:242-243) checks the
  **client-declared** Content-Type. It doesn't check the name.
- Reproduced: a member can create:
  - `users/A/ws/plan.md` (as `application/pdf`), which now also exists
    as a `ten_ws_files` row;
  - `ws/.hidden/x.pdf`;
  - `ws/skills/x.pdf`.
- This breaks "each file lives in exactly one place … the two sources
  never overlap" (C:99, C:116). The harm is to the member's own
  workspace, and `list()` becomes ambiguous.

**Fix:** add these to the insert policy's `with check`:

```sql
and lower(name) ~ '\.(pdf|docx)$'
and name !~ '/\.'
and (storage.foldername(name))[4] is distinct from 'skills'
```

The first clause is the extension. The second is no hidden segment
below the prefix. The third applies C:90 to binaries.

Test each one.

### S2. Name comparisons are case-sensitive, but the local store and the export targets are not (C:83 "one list for every backend"; C:458-460)

**Where:**
- M:80: `path ~ '\.(md|txt|json|html)$'`. `workspace-core.mjs:189,209`
  lowercases the extension, so `NOTES.MD` is editable locally and
  refused here.
- M:86: `'^skills/'`.
- M:150: `p_path = 'CLAUDE.md'`.

**Why it matters:** `claude.md` and `Skills/x.md` are accepted.
- The default macOS file system ignores case. A zip holding both
  `CLAUDE.md` and `claude.md` unpacks to one file, and the second one
  written wins.
- So a job post can talk the agent into writing `claude.md`. After an
  export to the local version, that file **is** the workspace
  `CLAUDE.md`.
- That is the persistent injection C:458-460 names, carried out through
  the export.

**Fix:**
- Use `~*` for the extension.
- Compare `lower(path)` for the `skills/` and `CLAUDE.md` rules, and
  refuse any case variant of either.
- Say "case-insensitive" in C § 2's path rules.
- Keep the local store's rule the same.

### S3. Two normal outcomes come back as HTTP 500, and the check violations have auto-generated names (C:79-80 error codes)

**Where:**
- M:172 `version_conflict` uses errcode `40001`.
- M:174 `resource_missing` uses `P0002`.
- M:80-87: the constraints are unnamed. The harness showed the names
  `ten_ws_files_path_check`, `_path_check1`, `_path_check2` and
  `_content_check`.

**Why it matters:**
- PostgREST's documented mapping sends `40*` → 500 and `P0*` → 500
  (`docs/references/errors.rst`, PostgREST main). A normal conflict then
  looks like a server fault in logs and to any retrying wrapper.
- The client has to turn the constraint names into `invalid_ref`,
  `unsupported_type`, `not_editable` and `content_too_large`. Those
  numbered names are fragile.

**Fix:**
- Raise with PostgREST's documented custom codes: `PT409` for
  `version_conflict` and `already_exists`, `PT404` for
  `resource_missing`. Keep the message equal to the `WorkspaceError`
  code.
- Name every constraint, for example `ten_ws_files_ext`,
  `ten_ws_files_path_shape`, `ten_ws_files_not_skills` and
  `ten_ws_files_size`.
- Put the constraint → code table in C § 2, with a store test for each
  row.

### S4. No limit on how much one member can store in the shared database (rule 5; production safety)

**Where:** M:72-88 has a 2 MB cap per file, but no limit on the number
of files or the total.

**Why it matters:** `bash` write-back (C:239-242) sends every changed
file through `ten_ws_write`.
- One injected instruction ("create 200 notes") costs cents of model
  time and writes hundreds of MB into the production database the old
  app shares.
- The bucket has the same gap for 10 MB uploads.

**Fix:** in `ten_ws_write`, refuse when the caller's total would pass a
fixed cap.
- For example 50 MB and 2,000 files, with the code `workspace_full`.
- Reading `octet_length` on text doesn't decompress it, so the check is
  cheap.
- State the cap in C § 2. A matching count cap on objects can wait until
  uploads are in use.

### S5. The gate log is written by the user's own browser; say so (rule 8; C:191-200)

**Where:**
- C:198-200: "`ten_gate_open` inserts, and `ten_gate_decide` moves
  `status` off `pending` exactly once; nothing else writes."
- M:198-211.

**What's true:** any holder of the user's session can open a gate with
any label, amount and hash. They can also mark it `approved` with any
`typed_text`. Reproduced by direct RPC.

**Why that's acceptable:**
- The gate protects the candidate's money **from the model**. The model
  can't call Supabase, and `bash` has no network.
- No server control reads the log: the proxy's stop is the balance plus
  the $20 key limit.
- Users cannot forge the **ledger** (verified).

**Fix:** say this in C § 3.
- The log is the candidate's own record, written by their browser.
- It is not server proof of consent.
- The server-side money controls are the balance check and the key limit.

Also:
- C:200 "nothing else writes" leaves out `ten_gate_expire_other_chats`
  (M:214-219) and the expiry inside `ten_gate_open` (M:191-192). Name
  both.
- Say that `gateId` is a UUID (M:55; C:166 types it as `string`).

### S6. `ten-delete-account` must delete files through the Storage API (rule 9; C:542-547)

C:544 lists "`users/{uid}/` objects" among the things deleted. Because of
B1's trigger, a SQL delete fails. Forcing it with the GUC leaves the files
in the storage backend.

- **Fix in C § 8:** the function lists and removes `users/{uid}/` through
  the Storage API with the service role, then deletes the rows.
- **Test:** after a delete, a service-role `download` of a known path
  returns not-found. Checking that `storage.objects` has no rows is not
  enough.

### S7. Make the header's claim match what the file does (rule 8)

M:6 says "This file changes NO existing table, policy, function, or
setting". What it actually does to shared objects:
- It **adds** two policies to the shared `storage.objects`.
- It adds one row to `storage.buckets`.
- Its foreign keys add six internal triggers to `auth.users`. From then
  on, deleting an old-app user also deletes that user's Ten rows, which
  is intended.

None of these alters an existing object's definition or grants (the
catalog diff shows none). Say it that way.

---

## NIT

- **N1. How to apply.** Say exactly how the owner applies M and T:
  - "SQL editor, as `postgres`; or `psql -v ON_ERROR_STOP=1`".
  - Without `ON_ERROR_STOP`, psql keeps going after an error. It is still
    safe, because the aborted transaction turns `commit` into a rollback,
    but the output is confusing.
  - supabase/supabase#41126 reports `CREATE POLICY on storage.objects`
    once failing over a direct connection while working in the SQL
    editor. A maintainer later showed it working over psql. Either way M
    is atomic.

  The file sits in `supabase/migrations/`, which suggests the Supabase
  CLI. Add a line: never `supabase link`, `db push` or `db reset --linked`
  this repo against production. Also note that the old app's
  `db pull`/`db diff` will now show the `ten_` objects as drift.
- **N2.** M:82: `\x00` can never match, because Postgres `text` cannot
  hold a NUL byte. It compiles and does no harm. Keep it as documentation
  or drop it.
- **N3. Accepted paths the local store may treat differently.**
  - `a//b.md` (empty segment);
  - backslashes;
  - control characters and newlines;
  - no length limit on the path;
  - NFC vs NFD (`résumé.md` typed vs from macOS): two rows that look the
    same.

  Refuse `//` and control characters (`[[:cntrl:]]`). Normalize to NFC in
  the client, and say so in C § 2.
- **N4.** `numeric(12,6)` rounds any cost with more decimals. Spike 4's
  "`usd` equal to `total_cost`" (C:592-593) should compare at 6 decimal
  places. Add `check (tokens_* >= 0)`.
- **N5. Two copies of the same logic (rule 12).**
  - The balance formula appears twice (M:118-123, M:126-131). Add a test
    that `ten_balance()` equals `ten_balance_for(auth.uid())` for the
    same user, or keep one definition.
  - The membership test in `ten_ws_write` (M:146-149) copies
    `ten_is_member()`. Calling it would be one definition. It works
    under definer, because `auth.uid()` reads the request setting.
- **N6. `CLAUDE.md` is create-only, and the server can't tell the app
  from the agent.** Before the app's first-run create, the agent could
  create it. It only matters after an export, because Tier 0 comes from
  the bundle. Make it a client order rule, "create `CLAUDE.md` before the
  first agent turn", with one test.
- **N7.** A `gateId` another user already used returns `23505`, which
  reveals that the id exists. With random UUIDs this is negligible.
- **N8.** C:3 still reads "Draft r3".

---

## Contract ↔ SQL cross-check (item 6)

**Matches:**

| contract says | SQL |
|---|---|
| table `ten_ws_files`, key `user_id, path` (C:101-103) | M:72-88 |
| own-row select only (C:103) | M:101-104 |
| all writes through `ten_ws_write` (C:104) | M:135-178 |
| create is insert-or-`already_exists`; update is `where version = expected`, else `version_conflict`/`resource_missing` (C:106-109) | M:154-177 |
| version = sha256 prefix computed in SQL (C:111) | M:141 |
| `updated_at = now()` (C:112) | M:157, M:166 |
| private `ten-workspaces` bucket, `users/{uid}/ws/`, create-only (C:113-115) | M:240-265 |
| 2 MB (C:86) | M:87 |
| 10 MB (C:89) | M:241 |
| `.md .txt .json .html` (C:86) | M:80 |
| only members write (C:117, C:492-493) | M:146-149, M:264 |
| RLS on, `anon` revoked (C:485) | M:51, 69, 89, 91-92 |
| guard: `ten_` object exists → refuse (C:485) | M:27-33 |
| ledger columns, `request_id` unique, `numeric(12,6)` (C:528-530) | M:39-50 |
| users select own; only the service role writes (C:530) | M:97-98, M:104; no write grant or policy |
| `ten_balance()` invoker, no argument (C:533) | M:118-123 |
| `ten_balance_for` service-only (C:534) | M:223-229, M:237 |
| membership = a credit row, checked by `ten_is_member()` (C:491-492) | M:110-115 |
| `ten_gate_log` exists, own rows readable (C:198) | M:54-70, M:99-100 |
| `ten_gate_open` / `ten_gate_decide` exactly once (C:199-200) | M:181-211 |
| a new gate expires the old one (C:181) | M:191-192 |
| a first turn expires older chats' pending gates (C:195-196) | M:214-219 |
| migration and teardown file names (C:481-482) | match |

**Gaps:**
- C:483-485: the guard is stated as a guarantee (B2).
- C:492-493 and C:562: non-members are not refused by `ten_gate_open` (B3).
- C:90-91: writes under `skills/` fail with a check violation, not the
  `not_editable` code (S3). Case variants get through (S2).
- C:99 and C:116: binaries by extension, no overlap. Not enforced (S1).
- C:200: "nothing else writes" (S5).
- C:544: deleting objects needs the Storage API (S6).
- C:572: "the teardown leaves a scratch project clean" fails today (B1).
- `ten_gate_expire_other_chats` is in the SQL but not named in C (S5).

---

## Open questions for the owner

1. **Is sign-up open on the shared project?** If it is, B3 is exposed to
   the whole internet, not just old-app users.
2. **Which of Studio's roles runs the SQL editor on this project?** This
   review assumes `postgres`, the default. The definer functions will be
   owned by whoever runs M. **UNVERIFIED** from here.
3. **Can you run B2's read-only policy query and share the policy names
   and expressions?** That, not the guard, is what makes applying safe.

## UNVERIFIED

- Behaviour on Supabase's actual Postgres (15 or 17) and actual Storage
  version. Checked on Postgres 18.3 (PGlite) with Supabase's real
  `protect_delete` and `foldername` code, and a hand-built stand-in for
  everything else.
- The two-writer race on `ten_ws_write`. By Postgres read-committed rules,
  the second `UPDATE … where version = expected` waits on the row lock
  and re-checks the new row. It then matches nothing and returns
  `version_conflict`. A concurrent `INSERT … ON CONFLICT DO NOTHING` waits
  and returns no row, so the caller gets `already_exists`. C:132 already
  names the real test: two parallel writes, exactly one wins. It must run
  against a real Postgres.
- Whether Supabase's API gateway limits request body size. B3 holds
  either way, because the calls can simply be repeated.

---

## Verification of fixes (round 2, 2026-09-23)

**Verified files:**
- migration sha1 `a16a0aa75caa3874adc971e23263d8010dbf4765` (written 14:15:24)
- teardown sha1 `83331b90ce48c54a30b5dd63abf73fdf22817dda` (written 14:13:35)
- contract r4 (C)

Line numbers below are for these versions.

### Three harnesses, and what each one proves

All three use the same PGlite stand-in (`stub.sql`), which runs Supabase's
real `protect_delete` and `foldername` code.

- **`run.mjs`**, mine from round 1, unchanged: 55 pass, 3 fail.
  - The 3 failures are the round-1 teardown tests, which expected SQL to
    delete from storage. The B1 fix makes that impossible on purpose: the
    teardown now refuses while the bucket exists. So these failures are
    expected.
- **`run-r2.mjs`**, the architect's: 78 of 78 pass on these files.
  - I read what it asserts:
    - my round-1 cases;
    - the teardown refuses first, then passes with the delete triggers
      **on**, after a simulated Storage API step;
    - the catalog returns exactly to its state before the migration;
    - three more guard cases;
    - gate length caps, PT codes, a nested `CLAUDE.md`, both caps, and
      `ws/Skills/`.
  - Two limits:
    - it checks the lock timeout only by searching the file text;
    - its cap test writes one file at a time, never in parallel.
  - On the architect's **first** fix pass (migration written at 14:12),
    it failed twice. The teardown dropped the functions before the tables,
    and the tables' new policies call `ten_is_member()`, so Postgres
    refused (2BP01). The second pass drops the tables first (T:38-51), and
    that now passes.
- **`r3-own.mjs`**, my own new cases: 6 fail, and all 6 are guard
  bypasses (R2-S1). Everything else passes or is recorded as an
  observation.

### Status of every round-1 finding

| finding | status | evidence |
|---|---|---|
| B1 teardown | **fixed** | T:6-21 does the Storage API step first. T:27-33 refuses while the bucket or any of its objects exists. T:38-51 drops tables before functions. Verified: a refused run changes nothing; after the API step, with the real delete triggers on, it passes and the catalog returns exactly to its pre-migration state |
| B2 guard | **fixed for the apply; one gap left (R2-S1)** | M:55-58: RLS must be on. M:60-64: no bucket UPDATE/DELETE/ALL policies. M:66-78: an objects policy needs `bucket_id = '` and no OR, `<>`, `!=` or NOT. Refuses: `true`, no bucket filter, `<>`, OR, `IS NOT NULL`, RLS off, a buckets `FOR UPDATE` policy, a restrictive policy without a bucket filter. **Still applies, then leaks** (my cases): `CASE WHEN bucket_id='avatars' THEN true ELSE true END`; `(bucket_id='avatars') = false`; `… IS DISTINCT FROM true`; `(bucket_id='avatars') = (auth.uid() IS NULL)`; `length('bucket_id = ''x''') > 0`. The CASE policy written `TO anon` let **anon** (the publishable key, no sign-in) read A's object. One safe policy is refused: `bucket_id IN (…)`. The project has zero storage policies today, so none of these exist yet |
| B3 non-member writes | **fixed** | Every `ten_` write function checks membership (M:213-215, 275-277, 294-296, 311-313). Text lengths are capped (M:118-126). Full audit below |
| B4 lock timeout | **fixed** | M:46-47 and T:24-25: `lock_timeout 3s`, `statement_timeout 60s`. It takes the same two locks as before, but now waits at most 3 s for them |
| S1 bucket name rules | **fixed** | M:382-387. `plan.md`, `.hidden/`, `ws/skills/` and `ws/Skills/` are all refused |
| S2 case | **fixed; unicode gap left (R2-S2)** | `NOTES.MD` is accepted. `claude.md`, `docs/Claude.MD`, `Skills/x.md` and `sKills/` spelled with the Kelvin sign are refused |
| S3 error codes | **fixed; NIT left** | PT409, PT404, PT403, PT415, PT400 and PT413 all confirmed, and constraints are named. Four inputs still come back as raw constraint errors: gate label over 80, malformed `text_hash`, amount 0 (all 23514), and null content (23502) |
| S4 caps | **fixed** | M:231-236 (2,000 files / 50 MB) and M:387 (50 objects). Parallel writes are covered below |
| S5 gate log wording | **fixed** | C:204-209 |
| S6 delete through the Storage API | **fixed** | C:562-566 |
| S7 header | **fixed** | M:5-9 |
| N1 how to apply | **fixed** | M:24-43 |
| N2 `\x00` | **fixed** | replaced by `[[:cntrl:]]` |
| N3 odd paths | **mostly fixed** | `//`, backslash, control characters and the 512-character limit are enforced. NFC is client-only (R2-S3) |
| N4 token checks | **fixed** | `tokens_* >= 0` |
| N5 one definition | **fixed** | One balance formula (`ten_balance_for`, which `ten_balance()` wraps), and membership checked everywhere through `ten_is_member()` |
| N6 `CLAUDE.md` first | **fixed** | C:91-93 |
| N8 draft number | **fixed** | the contract now says r4 |

### Membership audit (sign-up is open)

The test user N is signed in with no credit row. To prove the filters work,
not just that the tables are empty, I first planted rows belonging to N,
as a superuser.

**Refused:**
- Reading `ten_ws_files`, `ten_gate_log`, and N's own objects in the
  bucket: 0 rows each.
- `ten_ws_write`, `ten_gate_open`, `ten_gate_decide`,
  `ten_gate_expire_other_chats`: `PT403 not_a_member`.
- Inserting into the bucket: refused by RLS.
- `ten_object_count()`: 0.

**The stated exceptions, confirmed:**
- N can read their own ledger rows.
- `ten_balance()` returns N's own sum. That is 0 for anyone the proxy has
  never served. My test showed −0.50 only because I planted a `call` row
  for N.
- `ten_is_member()` returns false.
- `ten_balance_for` is refused for `authenticated` and for `anon`.

`anon` is refused on every function. No other `ten_` object is reachable:
the three tables have no insert, update or delete grants or policies
(M:153-154, M:341-351).

NIT: the header says the ledger read is "the one exception" (M:16-17). It
should also name `ten_balance()` and `ten_is_member()`.

### Parallel writes against the caps (reasoned; PGlite has one connection)

`ten_ws_write` first counts the member's files and bytes (M:231-236), then
writes. Nothing locks the member's workspace between those two steps.

- K calls in flight at once from one member all see the same committed
  total, so all of them can pass the check.
- The overshoot is at most K × 2 MB and K files. PostgREST's connection
  pool limits K to tens of calls, so the worst case is tens of MB past
  50 MB, once. After those commit, every later write is refused.
- The bucket cap (M:387) overshoots in the same way, by at most the number
  of uploads in flight × 10 MB.

That is bounded, and acceptable for a beta.

**Exact caps cost one line** at the top of `ten_ws_write`:
`perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));`.
It makes one member's writes take turns and doesn't slow anyone else (NIT).
The compare-and-swap is unaffected: it relies on the row lock and a
re-check, not on this count.

**UNVERIFIED: whether `ten_object_count()` actually counts.** It is
`security definer` and reads `storage.objects`, so it counts only if its
owner, `postgres`, bypasses RLS.
- Secondary sources say `postgres` has BYPASSRLS on Supabase.
- If it doesn't, the count is always 0, and the 50-object cap silently does
  nothing. Nothing else is affected.
- One query settles it:
  `select rolbypassrls from pg_roles where rolname = 'postgres';` should
  return `true`.

### Path rules: lookalike characters and normalization (my cases)

Results as the database stands now:

- **Refused:**
  - updating `CLAUDE.md`, plus `claude.md` and `docs/Claude.MD`;
  - `sKills/` spelled with the Kelvin sign (`lower()` folds it in
    PGlite's C.UTF-8 locale);
  - `CLAUDE.md` with a trailing space or a trailing dot, and `CLAUDE．md`
    with a fullwidth dot (none of these end in `.md`);
  - `a/./b.md`, `./a.md` and `a/b/../../CLAUDE.md`;
  - a NUL character (Postgres can't store one).
- **Accepted:**
  - `ｃlaude.md` (fullwidth c) and `сlaude.md` (Cyrillic с);
  - ` CLAUDE.md` with a leading space;
  - `ｓkills/`, `skills./` and `skills /`;
  - `CLAUDE.md` containing an invisible character: U+200B, U+200C,
    U+200D, or U+FEFF at the start;
  - `report<U+202E>txt.md` (a right-to-left override);
  - `CLAUDE.md/x.md`, and `plan.md/x.md` while a file `plan.md` exists;
  - `résumé.md` in both NFC and NFD, stored as two separate rows.

**What matters.** The only name with power is a root `CLAUDE.md` that
lands on a real disk after an export. That is the injection path C:458-460
names.

**Harmless:**
- Fullwidth letters, Cyrillic letters and a leading space. No mainstream
  file system treats them as the ASCII name. APFS and HFS+ ignore case and
  canonical (NFC/NFD) differences, and NTFS ignores case, but none of them
  treat a lookalike letter as the ASCII one.
- Windows drops a trailing dot or space from a folder name, so `skills./`
  becomes `skills/`. That doesn't matter: the local version's skills live
  in `.claude/skills` (blocked, because it starts with `.`), and the web
  app mounts the bundle only at the exact name `skills/`.

**Not harmless:**
- **HFS+ ignores some characters completely when it compares names:**
  U+200C–200F, U+202A–202E, U+206A–206F and U+FEFF. This is the list Git
  hard-codes for CVE-2014-9390 (`utf8.c`, `next_hfs_char`). So
  `CLA<U+200C>UDE.md`, `<U+FEFF>CLAUDE.md` and `CLAUDE<U+200D>.md`, once
  exported onto an HFS+ disk, **are** `CLAUDE.md` (R2-S2).
  - UNVERIFIED: whether APFS, the macOS default since 2017, does the same.
  - U+202E can also make a name display reversed in the file list.
- **A file and a folder with the same name** (`plan.md` and
  `plan.md/x.md`). A zip holding both can't be unpacked, and the local
  store can't hold both. That breaks the export round trip (rule 9; R2-S4).
- **NFC and NFD:** two rows that look identical. Postgres can refuse the
  non-NFC form: `is nfc normalized` works (verified) (R2-S3).

### New findings (round 2)

**R2-S1 (SHOULD; land it before the first credit row).** The guard runs
once, at apply time. After that, any storage policy the old app adds can
reach beta files; the five bypasses above show how.

The fix is to pin the bucket with RESTRICTIVE policies. Restrictive
policies are ANDed with every permissive policy, so no later policy can
open the bucket. The SQL I tested, using built-in functions only:

```sql
create policy ten_ws_objects_pin on storage.objects as restrictive for all to public
  using (bucket_id <> 'ten-workspaces' or ((storage.foldername(name))[1] = 'users'
         and (storage.foldername(name))[2] = (select auth.uid()::text)))
  with check (bucket_id <> 'ten-workspaces' or ((storage.foldername(name))[1] = 'users'
         and (storage.foldername(name))[2] = (select auth.uid()::text)));
create policy ten_bucket_pin_update on storage.buckets as restrictive for update to public
  using (id <> 'ten-workspaces');
create policy ten_bucket_pin_delete on storage.buckets as restrictive for delete to public
  using (id <> 'ten-workspaces');
```

I then added a wide-open old-app policy *after* the apply: the CASE bypass
on objects for every command, plus a buckets `for all using (true)`
policy. With the pins in place:
- B read 0 of A's objects, and so did `anon`.
- A still read her own.
- B could not plant a file in A's folder.
- Nobody could make the bucket public.
- The old app's `avatars` access was unchanged.

**Keep `ten_` functions out of the pin.** A first version called
`ten_is_member()`. `anon` then got `permission denied for function
ten_is_member` on every query that reached a `ten-workspaces` row. That is
an error the old app could hit. Membership already lives in the permissive
policies.

With the pins in place, the guard can shrink to the RLS-on check
(rule 18). The teardown must drop the three pins too.

**R2-S2 (SHOULD, before export ships).** Refuse
`[​-‏‪-‮⁠-⁯﻿]` in four places:
`ten_ws_write`, `ten_ws_files_path_shape`, the bucket insert policy, and
the local store's rule. They must stay one list (C:83).

**R2-S3 (SHOULD).** Add `p_path is nfc normalized` (else `invalid_ref`) to
`ten_ws_write` and to the path constraint. The client still normalizes
(C:85); the server refuses the other form.

**R2-S4 (SHOULD, before export ships).** In `ten_ws_write`, refuse a path
when:
- one of its parent folders is already a file; or
- it is itself the folder of an existing path.

That is two indexed lookups. Name the rule in C § 2.

**R2-S5 (SHOULD, contract).**
- C:557 still says `ten_balance()` is `security invoker`. M:183-186 is a
  `security definer` wrapper that passes `auth.uid()`. Say that in C.
- C:597 names `run-r2.mjs` as the proof. It lives in a session scratchpad
  outside the repo and will vanish (rule 11). The tester should move it,
  with `stub.sql` and `r3-own.mjs`, under `tests/` and wire it into
  `tests/run.py`.

**R2-S6 (SHOULD, owner decision; not SQL).** The proxy now uses the live
CareerCoach app's key, which has a shared $20-per-day limit (C:485-490,
M:394-395).
- C:487-488 says a busy beta day can cut off the live app.
- But C:589 lists "changes to the old app" under Prevents.
- Both can't be true (rule 8).

The cheapest fix is a daily ceiling for the whole beta in the proxy. Before
each call:
`select coalesce(sum(usd), 0) from public.ten_usage_ledger where kind = 'call' and created_at >= date_trunc('day', now())`
must be under a fixed amount, for example $10. Otherwise return 503. That
keeps the live app's share. Or the owner accepts the risk, and C:589 drops
that clause.

**NITs:**
- Four inputs still return raw constraint errors (the S3 residual above).
- The header's exception list (M:16-17).
- The advisory lock for exact caps.
- `run-r2.mjs` checks the lock timeout by text only.

**UNVERIFIED (round 2):**
- `postgres` BYPASSRLS (the query above settles it).
- How Supabase's locale lowercases non-ASCII letters. Harmless either way.
- Whether APFS ignores the HFS+ characters.
- Real concurrent writes.
- Everything here ran on PGlite 18.3, not Supabase's Postgres 17.


---

## Verification (round 3, 2026-09-23)

**Verified files:**
- migration `1bddd584…` (509 lines)
- teardown `bbb1fade…` (76 lines)
- contract `493a711a…`

In this section, M, T and C refer to these versions.

**Runs:**
- **The harness in `tests/sql/`, as the README says:**
  - `run.mjs`: 55 pass, 3 fail. The 3 are the round-1 tests that delete
    from storage in SQL. They are expected to fail.
  - `run-r2.mjs`: 102 pass, 0 fail.
  - `r3-own.mjs`: 31 pass, 0 fail.
- **My new round-3 cases**, `r4-own.mjs` (in the session scratchpad,
  independent of `tests/sql/`): 56 checks, 0 fail, plus 11 observations.
  - They read `tests/sql/stub.sql`, which is byte-identical to my
    round-1 stub.
  - The tester may copy them into `tests/sql/`.

### The one edit to my `r3-own.mjs`: sound

The diff against my copy has two changes:
1. Line 4 finds the repo root relative to the file instead of a fixed path.
2. Line 114 skips creating the pin when the migration text contains
   `ten_ws_objects_pin`.

Both are sound:
- Creating the pin a second time would fail on the duplicate name.
- The shipped pin (M:487-498) is the same SQL I tested in round 2.
- The skip can't hide a missing pin. If the name ever survived only in a
  comment, the test would run with no pin, and its checks that
  "B / anon read none of A's objects" would **fail** against the
  wide-open later policy.
- A failed apply in that section would crash on `credit()`, which is
  loud, not silent.

### The three RESTRICTIVE pins (M:483-498): verified

- **They use only built-in functions.** Read back from `pg_policy`, they
  call only `storage.foldername()` and `auth.uid()`.
- **A later wide-open policy leaks nothing.** I added old-app policies
  `for all using (true) with check (true)` on both `storage.objects` and
  `storage.buckets`. Then:
  - B, `anon` and a non-member read 0 of A's objects, and A reads her own.
  - B can't move A's object into B's folder.
  - B can't move an avatar into A's folder.
  - A can't move her own object into B's folder.
  - Neither B nor `anon` can make the bucket public.
- **`anon` doesn't error.** A scan across all buckets, and an insert into
  `avatars`, both succeed.
- **Other buckets are unaffected.** `avatars` and a new `docs` bucket
  follow the later policy exactly, including B making `docs` public.

### The guard as an allowlist (M:64-111): verified

The rule: every policy must deparse to `(bucket_id = '<x>'::text)`, or to
`((bucket_id = '<x>'::text) AND …)` at the top level.

**Refused** (my new bypass attempts):
- an AND followed by a top-level OR;
- `(… AND …) = false`;
- a literal that smuggles in `'::text) AND (true`;
- NOT wrapped around an AND;
- a sub-select;
- COALESCE.

All the round-2 bypasses are refused too, through `run-r2.mjs`.

**Accepted, and safe:** an AND containing an inner OR, which is still
scoped to its bucket.

**Accepted, with the pin covering it:** an old policy scoped to
`bucket_id = 'ten-workspaces'` itself.
- The guard can't tell that policy apart from a safe one.
- With the pin in place, B and `anon` still read nothing, and B still
  can't plant a file.

**Refused although safe:** a COLLATE on the literal, and `IN (…)`. Both are
errors in the safe direction, and no such policy exists today.

The guard runs once. The pins are the lasting protection.

### `ten_path_ok` (M:113-126): verified

- **Refuses every code point I tried from each class, 34 in all:**
  - each Unicode Cf range, including U+00AD, the Arabic and Syriac
    formats, U+180E, U+FFF9-FFFB, and the 5- and 6-digit ones (U+110BD,
    U+13430-1343F, U+1BCA0, U+1D173, U+E0001, U+E0041);
  - U+2028 and U+2029;
  - every HFS+-ignored code point;
  - the C0/C1 controls tested (U+007F, U+0085, U+009F).

  Its ranges match the Unicode Cf list exactly, plus U+2028/2029.
- **Accepts ordinary text:** accented letters, CJK, Arabic letters, an
  emoji, a variation selector, and an unassigned code point.
- **Other limits:** NFD is refused; null and empty are refused; 512
  characters are accepted and 513 refused.
- **The code is ASCII-only.** Every non-ASCII byte in M is inside a
  comment. The regex uses `\u`/`\U` escapes, so no invisible character
  hides in the source.
- **Grants:** `anon` can't call it.
- NIT: `is nfc normalized` depends on the server's Unicode version, so a
  major Postgres upgrade could in theory change what an `immutable`
  CHECK constraint accepts. That is the normal Postgres caveat, and it
  needs no action.

### `ten_path_clash` (M:243-279): verified

**Every clash is refused**, with `path_conflict` from `ten_ws_write` and
an RLS refusal in the bucket:
- a text file under a text file, in either case;
- a case variant of a text file;
- a text path that is the folder of an existing text path, or of an
  object path, in either case;
- an object under a text file;
- a case variant of an object.

**What still works as it should:**
- Creating the same path twice still gives `already_exists`, the right
  code.
- User B is never blocked by A's names, and `ten_path_clash` can't be
  used to probe them.
- A non-member always gets `false`.
- LIKE wildcards have no special meaning, because the function compares
  with `left()`, not LIKE.

NIT: a folder case variant (`Notes/a.md`, then `notes/b.md`) is accepted.
On a case-insensitive disk both files land in one folder. No data is
lost, but re-importing changes `b.md`'s folder case.

### The advisory lock (M:301): correct (reasoned)

- **The key** is `hashtextextended('ten_ws:' || uid, 0)`: one 64-bit key
  per member, taken after the membership check.
  - A caller can lock only their own key, so a member can't block anyone
    else.
  - A hash collision between two members would only make their writes
    take turns.
- **It is a transaction-level lock** (`pg_advisory_xact_lock`), released at
  commit or rollback.
  - That is correct behind PostgREST, where each RPC is one transaction.
  - It is also correct behind Supavisor's transaction pooling, where a
    session-level lock would leak.
- **The cap is now exact.** The next writer's count query takes a new
  snapshot after the previous holder has committed, so it sees that write.
- **No deadlock.** `ten_ws_write` is the only `ten_` function that takes an
  advisory lock, and it takes exactly one, first, before touching any rows.
  - After that it takes only the member's own row locks, plus the foreign
    key's share lock on the member's `auth.users` row.
  - An old-app delete of that user waits for it, but nothing waits in the
    other direction, so there is no cycle.
  - Supabase's per-role statement timeout bounds how long queued writes
    can wait.
- **The bucket's 50-object cap is not serialized.** The insert policy takes
  no lock, so it can still overshoot by the number of uploads in flight.
  That is bounded. M:283-284 claims "exact" only for text, which is
  accurate.

### `ten_beta_spend_today` (M:224-232, 145) and the ceiling: verified

- **Service role only:** a member and `anon` both get
  `permission denied`, and `service_role` succeeds.
- **The UTC day boundary:** `date_trunc('day', now() at time zone 'utc')
  at time zone 'utc'` is midnight UTC whatever the session's time zone.
  - Test data: a row one second before midnight is excluded, and a row at
    exactly midnight is included.
  - The result was 0.75 under the session time zones UTC,
    America/Los_Angeles and Pacific/Kiritimati.
- **It uses the index:** with 20,000 call rows, EXPLAIN shows an index
  scan on the partial index `ten_usage_ledger_call_day_idx`, with the
  boundary as the index condition.
- **The ceiling's meaning in C:492-498 holds.**
  - OpenRouter's documentation says daily key limits reset at midnight
    UTC, the same day the beta counts. So "the live app keeps at least
    $15/day" is accurate, less the beta calls in flight.
  - A call's ledger row is written when its stream ends, so every call in
    flight is invisible to the check.
  - The overshoot is therefore at most (calls in flight across the whole
    beta) × the ~$0.18 per-call ceiling. C:497-498 and C:579-580 say so.
- NIT for the proxy step, not SQL: if `ten_beta_spend_today()` fails, the
  proxy should refuse the call (fail closed). Add a stubbed test for it.

### Teardown (T): verified

It refuses until the Storage API step is done. After that, with the real
delete triggers **on**, it runs. It removes:
- the 2 + 3 policies (T:35-39);
- the tables, with their constraints and indexes, including
  `ten_usage_ledger_call_day_idx`;
- then all 11 functions, `ten_path_ok` last (T:47-57).

That order works:
- the tables' `ten_path_ok` constraint goes away with the tables;
- the insert policy, which calls `ten_path_ok` and `ten_path_clash`, is
  dropped first.

Afterwards, zero `ten_` policies, functions or relations remain.
`run-r2.mjs` also confirms the whole catalog matches its state before the
migration.

### Header checklist (M:1-58): complete and in the right order

- It names the target and its Postgres version.
- It states that sign-up is open, and gives the membership rule with every
  exception.
- It records the observed baseline, **including `rolbypassrls = true` for
  `postgres`**. That settles my round-2 UNVERIFIED item:
  `ten_object_count` and `ten_path_clash` can read `storage.objects`.
- Its read-only queries, apply steps, isolation re-run, and "first credit
  row last" come in that order.
- It says how to apply with psql (`ON_ERROR_STOP`), and warns never to use
  the Supabase CLI against production.

C § 2 and § 8 match the SQL:
- the path rules, `path_conflict`, the caps and the pins;
- `ten_balance()` is now correctly described as `security definer`
  (C:571);
- the proof points to `tests/sql/` (C:615-617).

### Remaining NITs (none blocks the apply)

- A folder case variant is accepted (see `ten_path_clash`).
- COLLATE and `IN (…)` are refused although safe (guard).
- The object cap can overshoot slightly under parallel uploads.
- The proxy should fail closed if the spend query errors.
- `tests/sql/` is not wired into `tests/run.py` yet (its README says so).

Round-2 leftovers:
- **Closed:** the header's exception list (M:18-22); null content now
  returns `content_too_large` (M:313).
- **Carried over as a NIT:** a gate label over 80 characters, a malformed
  `text_hash`, or an amount of 0 still returns a raw constraint error
  (23514), not a PT code. `run-r2.mjs` still checks the lock timeout by
  text only.

### UNVERIFIED (round 3)

- Behaviour on Supabase's own Postgres 17 and Storage. All of this ran on
  PGlite 18.3 with the stand-in.
- Real concurrent writes. The lock and cap reasoning above has not been
  run in parallel.
- Whether `anon` can execute `storage.foldername` and `auth.uid()` on the
  real project. The pins need that for `anon` queries not to error. It is
  the Supabase default, and spike 3's re-run exercises it.
- OpenRouter's midnight-UTC reset is from its documentation, not observed.


Sources:
- [supabase/storage 0055-prevent-direct-deletes.sql](https://github.com/supabase/storage/blob/master/migrations/tenant/0055-prevent-direct-deletes.sql)
- [catchupcolumn PR #30 (the delete guard in the wild)](https://github.com/bchen395/catchupcolumn/pull/30)
- [supabase/supabase#41126 (CREATE POLICY on storage.objects)](https://github.com/supabase/supabase/issues/41126)
- [PostgREST errors reference](https://github.com/PostgREST/postgrest/blob/main/docs/references/errors.rst)
- [Supabase: Creating Buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets)
- [Git utf8.c next_hfs_char (HFS+ ignored code points, CVE-2014-9390)](https://github.com/git/git/blob/master/utf8.c)
- [Supabase Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)
- [OpenRouter: update an API key (limit_reset)](https://openrouter.ai/docs/api/api-reference/api-keys/update-keys)
- [OpenRouter: API credit and rate limits](https://openrouter.ai/docs/api_reference/limits)
