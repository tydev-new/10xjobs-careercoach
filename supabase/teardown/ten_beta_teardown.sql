-- Ten web beta teardown: drops exactly what
-- supabase/migrations/20260923000000_ten_beta_init.sql created, and nothing else.
-- Applied by the OWNER, never by an agent. DESTROYS all beta data (workspace
-- files, ledger, gate log). The shared auth users are NOT touched.
--
-- STEP 1 — THROUGH THE STORAGE API, FIRST (service role key, never in a browser).
-- Supabase refuses direct SQL deletes from storage.objects/buckets
-- (storage.protect_delete), and forcing one would leave the files in the
-- storage backend. So empty and delete the bucket through the API:
--   supabase-js:  const admin = createClient(URL, SERVICE_ROLE_KEY);
--                 await admin.storage.emptyBucket('ten-workspaces');
--                 await admin.storage.deleteBucket('ten-workspaces');
--   REST:         POST   {URL}/storage/v1/bucket/ten-workspaces/empty
--                 DELETE {URL}/storage/v1/bucket/ten-workspaces
--                 (headers: Authorization: Bearer <service role key>, apikey: <same>)
--   emptyBucket works in batches; repeat until the bucket lists no objects.
--
-- STEP 2 — this file: SQL editor as `postgres`, or `psql -v ON_ERROR_STOP=1 -f`.
-- It refuses to run while the bucket or any of its objects still exists.
-- Run at a quiet time; it sets a 3 s lock timeout, and on a timeout nothing
-- changes, so re-run later.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from storage.buckets where id = 'ten-workspaces')
     or exists (select 1 from storage.objects where bucket_id = 'ten-workspaces') then
    raise exception 'ten beta teardown: empty and delete the ten-workspaces bucket through the Storage API first (see header)';
  end if;
end $$;

drop policy if exists ten_ws_objects_select_own on storage.objects;
drop policy if exists ten_ws_objects_insert_own on storage.objects;
drop policy if exists ten_ws_objects_pin on storage.objects;
drop policy if exists ten_bucket_pin_update on storage.buckets;
drop policy if exists ten_bucket_pin_delete on storage.buckets;

-- Tables (their policies, constraints and indexes go with them).
drop table if exists public.ten_ws_files;
drop table if exists public.ten_gate_log;
drop table if exists public.ten_usage_ledger;

-- Functions last: the tables' policies call ten_is_member().
drop function if exists public.ten_gate_expire_other_chats(text);
drop function if exists public.ten_gate_decide(uuid, text, text);
drop function if exists public.ten_gate_open(uuid, text, text, text, text, numeric);
drop function if exists public.ten_ws_write(text, text, text);
drop function if exists public.ten_path_clash(text);
drop function if exists public.ten_object_count();
drop function if exists public.ten_beta_spend_today();
drop function if exists public.ten_balance();
drop function if exists public.ten_balance_for(uuid);
drop function if exists public.ten_is_member();
drop function if exists public.ten_path_ok(text);

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename like 'ten\_%')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname like 'ten\_%')
     or exists (select 1 from pg_policies where policyname like 'ten\_%') then
    raise exception 'ten beta teardown: ten_ objects remain';
  end if;
end $$;

commit;

-- NOT in SQL (the owner reverses these by hand):
--   supabase functions delete ten-model-proxy
--   supabase functions delete ten-delete-account
--   supabase secrets unset TEN_OPENROUTER_API_KEY (do NOT revoke the key: the live
--   CareerCoach app uses it too)
--   Auth > URL Configuration > Redirect URLs: remove the Vercel production URL
