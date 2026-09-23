-- Spike 3 — proposed Storage RLS policies for the `spike3-isolation` bucket.
--
-- NOT APPLIED by verify.mjs. Applying CREATE POLICY requires executing SQL
-- against the project's Postgres database, which needs either a direct
-- Postgres connection string (DB password) or a Supabase Management API
-- personal access token (sbp_...). Neither is present in .env.local, which
-- this spike was scoped to (SUPABASE_URL, SUPABASE_ANON_KEY,
-- SUPABASE_SERVICE_ROLE_KEY only). See docs/spikes/spike-3-supabase-isolation.md
-- for the blocker writeup.
--
-- Scoped ONLY to bucket_id = 'spike3-isolation'; every policy name is
-- prefixed spike3_ so it is unambiguous to find and drop later. Implements
-- design-web-agent.md § 2: objects at users/{uid}/ws/{path}; a user may
-- list/read/write only under their own users/{uid}/.
--
-- storage.foldername(name) splits the object key on '/' and returns every
-- segment except the final (file) segment. For "users/<uid>/ws/plan.md" that
-- is {users, <uid>, ws}, so [1] = 'users' and [2] = the uid.

create policy "spike3_select_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'spike3-isolation'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
);

create policy "spike3_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'spike3-isolation'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
);

create policy "spike3_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'spike3-isolation'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
)
with check (
  bucket_id = 'spike3-isolation'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
);

create policy "spike3_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'spike3-isolation'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
);

-- Teardown (used once the isolation tests can actually run against these):
-- drop policy "spike3_select_own" on storage.objects;
-- drop policy "spike3_insert_own" on storage.objects;
-- drop policy "spike3_update_own" on storage.objects;
-- drop policy "spike3_delete_own" on storage.objects;
