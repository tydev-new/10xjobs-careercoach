-- Ten web beta: every object the beta adds to the shared production project.
-- Contract: docs/design-web-agent.md § 2 and § 8. Review: docs/reviews/beta-sql-review.md.
-- Reversed by supabase/teardown/ten_beta_teardown.sql. Tested by tests/sql/ (PGlite).
--
-- WHAT THIS FILE TOUCHES. It creates only ten_/ten- named objects. It alters no
-- existing object's definition or grants. On shared objects it ADDS: three
-- policies on storage.objects (two permissive, one RESTRICTIVE pin), two
-- RESTRICTIVE pins on storage.buckets, one row in storage.buckets, and foreign
-- keys to auth.users (Postgres adds internal triggers there; deleting an
-- old-app user then also deletes that user's Ten rows, which is intended).
-- The pins only restrict rows of the ten-workspaces bucket; every other
-- bucket's access is unchanged.
--
-- TARGET: project career-coach-nextgen (ref ivunfotoggdxbjouumdk, Postgres 17).
-- SIGN-UP IS OPEN on this project: anyone on the internet can hold an
-- authenticated session, and membership (public.ten_is_member(), a credit
-- row) is the ONLY barrier between them and beta data. So every ten_ function
-- and policy that writes or reads beta data requires it. The exceptions, each
-- on purpose: the ledger's own-row select and ten_balance() (membership itself
-- lives in the ledger; a non-member sees only their own, empty, sum);
-- ten_is_member() itself; ten_path_ok() (pure, reads nothing); the bucket pins
-- (built-in functions only, so the old app's queries can never error on them).
--
-- BASELINE OBSERVED 2026-09-23 on career-coach-nextgen (owner's read-only queries):
--   * pg_policies for schema storage: ZERO rows (no storage.objects or
--     storage.buckets policies); relrowsecurity = true on both tables.
--   * rolbypassrls: postgres = true, service_role = true,
--     authenticated = false, anon = false. (The definer functions below are
--     owned by postgres and rely on its BYPASSRLS to read storage.objects.)
--
-- WHAT PROTECTS THE BUCKET. The RESTRICTIVE pins (section 5) are ANDed with
-- every permissive policy, now and later, so no storage policy the old app
-- adds after this file can open ten-workspaces. The guard in section 0 is a
-- strict allowlist at apply time: it refuses any storage.objects policy whose
-- expression is not exactly `bucket_id = '<name>'` or `bucket_id = '<name>'
-- AND …` at the top level (false positives such as `bucket_id IN (…)` are
-- refused too; the project has zero storage policies today, so that costs
-- nothing).
--
-- OWNER CHECKLIST, in this order (never an agent; never a real DB from a script):
--   1. Read-only, in the SQL editor; paste names and expressions (no data)
--      into the step 2 record:
--        select tablename, policyname, cmd, roles, permissive, qual, with_check
--          from pg_policies where schemaname = 'storage' order by 1, 2;
--        select relname, relrowsecurity from pg_class
--         where oid in ('storage.objects'::regclass, 'storage.buckets'::regclass);
--        select rolname, rolbypassrls from pg_roles
--         where rolname in ('postgres', 'service_role', 'authenticated', 'anon');
--      Expect the baseline above.
--   2. Apply this file at a quiet time: SQL editor as `postgres`, or
--      `psql -v ON_ERROR_STOP=1 -f <this file>`. It sets a 3 s lock timeout; on
--      a timeout (or any error) the whole transaction rolls back and nothing
--      changes, so simply re-run later.
--   3. Re-run spike 3's isolation tests against the real project.
--   4. Only then insert the first credit row (see the end of this file). Until
--      a credit row exists, no one can write to the new tables or the bucket.
--   Never `supabase link`, `db push` or `db reset --linked` this repo against
--   production; the old app's `db pull`/`db diff` will show these objects as drift.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- 0. Preconditions (an allowlist at apply time; the pins are the lasting protection).
do $$
declare
  p record;
  bad text := '';
  -- The deparsed form of `bucket_id = 'x'` alone, or ANDed at the top level.
  -- Postgres deparses `a AND b` as `((a) AND (b))` and anything else (OR, CASE,
  -- IS DISTINCT FROM, `= false`, …) with a different leading shape.
  ok_shape constant text :=
    '^(\(bucket_id = ''[^'']+''::text\)|\(\(bucket_id = ''[^'']+''::text\) AND .*\))$';
begin
  -- First: a second run must say so, not trip over this file's own pins.
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename like 'ten\_%')
     or exists (select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
                 where n.nspname = 'public' and pr.proname like 'ten\_%')
     or exists (select 1 from storage.buckets where id = 'ten-workspaces')
     or exists (select 1 from pg_policies where policyname like 'ten\_%') then
    raise exception 'ten beta: a ten_ object already exists; run the teardown or inspect first.';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'storage.buckets'::regclass) then
    raise exception 'ten beta: RLS is off on storage.objects or storage.buckets';
  end if;

  for p in select policyname, cmd from pg_policies
            where schemaname = 'storage' and tablename = 'buckets'
              and cmd in ('UPDATE', 'DELETE', 'ALL') loop
    bad := bad || format(' buckets.%s(%s)', p.policyname, p.cmd);
  end loop;

  for p in select policyname, cmd, qual, with_check from pg_policies
            where schemaname = 'storage' and tablename = 'objects' loop
    if (p.qual is null and p.with_check is null)
       or (p.qual is not null and p.qual !~ ok_shape)
       or (p.with_check is not null and p.with_check !~ ok_shape) then
      bad := bad || format(' objects.%s(%s)', p.policyname, p.cmd);
    else
      raise notice 'ten beta: accepted existing policy storage.objects.% (%): % / %',
        p.policyname, p.cmd, coalesce(p.qual, '-'), coalesce(p.with_check, '-');
    end if;
  end loop;

  if bad <> '' then
    raise exception 'ten beta: storage policies not recognised as scoped to one bucket:%. Review with the owner before applying.', bad;
  end if;

end $$;

-- 1. The path rule, one definition (§ 2), used by the table, ten_ws_write and
--    the bucket policy. Relative, NFC, ≤ 512 chars; no leading "/", no segment
--    starting with ".", no "//", backslash or control character; no invisible
--    or format character: Unicode Cf plus U+2028/2029 and the code points HFS+
--    ignores when comparing names (Git, CVE-2014-9390: U+200C–200F,
--    U+202A–202E, U+206A–206F, U+FEFF), all within the ranges below.
create function public.ten_path_ok(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null
     and char_length(p) between 1 and 512
     and p is nfc normalized
     and p !~ '(^/|^\.|/\.|//|\\|[[:cntrl:]])'
     and p !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]';
$$;

-- 2. Tables. RLS on from creation; anon/authenticated get only the grants below.

create table public.ten_usage_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null constraint ten_usage_ledger_kind check (kind in ('credit', 'call')),
  request_id    text unique,                 -- OpenRouter response id; null for credits
  model         text,
  tokens_in     integer not null default 0 constraint ten_usage_ledger_tokens_in check (tokens_in >= 0),
  tokens_out    integer not null default 0 constraint ten_usage_ledger_tokens_out check (tokens_out >= 0),
  tokens_cached integer not null default 0 constraint ten_usage_ledger_tokens_cached check (tokens_cached >= 0),
  usd           numeric(12,6) not null constraint ten_usage_ledger_usd check (usd >= 0),
  created_at    timestamptz not null default now()
);
alter table public.ten_usage_ledger enable row level security;
create index ten_usage_ledger_user_idx on public.ten_usage_ledger (user_id);
-- For the beta-wide daily ceiling (§ 8): today's calls across all users.
create index ten_usage_ledger_call_day_idx on public.ten_usage_ledger (created_at) where kind = 'call';

-- Written by the user's own browser (§ 3): a record, not server proof of consent.
-- Lengths are capped so a signed-in account cannot store bulk data here:
--   label ≤ 80 (the contract allows 6 words), text_hash = "sha256:" + 64 hex,
--   gate_line ≤ 300 (one sentence), chat_id ≤ 100 (a uuid-ish id),
--   typed_text ≤ 20 (only an exact yes/no reply is ever stored).
create table public.ten_gate_log (
  id          uuid primary key,              -- = gateId
  user_id     uuid not null references auth.users(id) on delete cascade,
  chat_id     text not null constraint ten_gate_log_chat_id check (char_length(chat_id) <= 100),
  kind        text not null constraint ten_gate_log_kind check (kind = 'spend'),
  label       text not null constraint ten_gate_log_label check (char_length(label) <= 80),
  text_hash   text not null constraint ten_gate_log_text_hash check (text_hash ~ '^sha256:[0-9a-f]{64}$'),
  gate_line   text not null constraint ten_gate_log_gate_line check (char_length(gate_line) <= 300),
  amount_usd  numeric(12,6) not null constraint ten_gate_log_amount check (amount_usd > 0 and amount_usd <= 100),
  status      text not null default 'pending'
              constraint ten_gate_log_status check (status in ('pending', 'approved', 'declined', 'expired')),
  typed_text  text constraint ten_gate_log_typed_text check (char_length(typed_text) <= 20),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
alter table public.ten_gate_log enable row level security;
create index ten_gate_log_user_idx on public.ten_gate_log (user_id, status);

-- Text files (§ 2). The rules are checked with stable codes in ten_ws_write;
-- these named constraints are the backstop.
create table public.ten_ws_files (
  user_id    uuid not null references auth.users(id) on delete cascade,
  path       text not null,
  content    text not null,
  version    text not null,
  updated_at timestamptz not null default now(),
  constraint ten_ws_files_pkey primary key (user_id, path),
  constraint ten_ws_files_ext check (path ~* '\.(md|txt|json|html)$'),
  constraint ten_ws_files_path_shape check (public.ten_path_ok(path)),
  constraint ten_ws_files_not_skills check (lower(path) !~ '^skills/'),
  constraint ten_ws_files_claude_md check (
    path = 'CLAUDE.md' or lower(path) !~ '(^|/)claude\.md$'),
  constraint ten_ws_files_size check (octet_length(content) <= 2 * 1024 * 1024)
);
alter table public.ten_ws_files enable row level security;

revoke all on public.ten_usage_ledger, public.ten_gate_log, public.ten_ws_files
  from anon, authenticated, public;

-- 3. Functions. Every refusal raises SQLSTATE PTxxx (PostgREST maps it to HTTP
--    xxx) with the message equal to the client's WorkspaceError / gate code:
--      PT409 already_exists, version_conflict, path_conflict
--      PT404 resource_missing                    PT401 not_signed_in
--      PT403 not_editable, not_a_member          PT400 invalid_ref, bad_status
--      PT415 unsupported_type                    PT413 content_too_large, workspace_full
--    The named constraints (ten_ws_files_*, ten_gate_log_*) are backstops; a
--    constraint name reaching the client is a bug in the pre-checks.

-- Beta membership = has a credit row (§ 8). The one definition.
create function public.ten_is_member() returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.ten_usage_ledger
     where user_id = (select auth.uid()) and kind = 'credit');
$$;

-- Any user's balance: credits minus calls, unrounded. The one formula.
-- Service role only (the proxy); ten_balance() below wraps it for the caller.
create function public.ten_balance_for(p_user uuid) returns numeric
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(case when kind = 'credit' then usd else -usd end), 0)
    from public.ten_usage_ledger
   where user_id = p_user;
$$;

-- The caller's own balance: a definer wrapper that passes auth.uid(), so it
-- takes no argument and can show no one else's.
create function public.ten_balance() returns numeric
language sql stable security definer set search_path = '' as $$
  select public.ten_balance_for((select auth.uid()));
$$;

-- Beta-wide spend today (UTC day), all users. Service role only: the proxy
-- refuses to forward once this reaches the daily ceiling (§ 8).
create function public.ten_beta_spend_today() returns numeric
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(usd), 0)
    from public.ten_usage_ledger
   where kind = 'call'
     and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');
$$;

-- Caller's object count in the bucket (for the insert policy's cap).
create function public.ten_object_count() returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from storage.objects
   where bucket_id = 'ten-workspaces'
     and (storage.foldername(name))[2] = (select auth.uid()::text)
     and public.ten_is_member();
$$;

-- True if creating p_path (a workspace-relative path) would clash with the
-- caller's existing files or objects (§ 2), compared case-insensitively:
-- a parent folder of p_path is a file; p_path is a folder of an existing
-- path; or a case variant of p_path exists. Any of these breaks the export
-- round trip on a case-insensitive disk.
create function public.ten_path_clash(p_path text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_l text := lower(p_path);
  v_parts text[] := string_to_array(lower(p_path), '/');
  v_parents text[] := '{}';
  v_prefix text := 'users/' || (select auth.uid())::text || '/ws/';
begin
  if v_uid is null or not public.ten_is_member() then
    return false;
  end if;
  if array_length(v_parts, 1) > 1 then
    select array_agg(array_to_string(v_parts[1:i], '/'))
      into v_parents
      from generate_series(1, array_length(v_parts, 1) - 1) i;
  end if;
  return exists (
           select 1 from public.ten_ws_files f
            where f.user_id = v_uid
              and (lower(f.path) = any (v_parents)
                   or left(lower(f.path), char_length(v_l) + 1) = v_l || '/'
                   or (lower(f.path) = v_l and f.path <> p_path)))
      or exists (
           select 1 from storage.objects o
            where o.bucket_id = 'ten-workspaces'
              and left(o.name, char_length(v_prefix)) = v_prefix
              and (lower(substr(o.name, char_length(v_prefix) + 1)) = any (v_parents)
                   or left(lower(substr(o.name, char_length(v_prefix) + 1)), char_length(v_l) + 1) = v_l || '/'
                   or (lower(substr(o.name, char_length(v_prefix) + 1)) = v_l
                       and substr(o.name, char_length(v_prefix) + 1) <> p_path)));
end $$;

-- The compare-and-swap write (§ 2). Definer, but acts only on auth.uid().
-- p_expected null = create (already_exists if the path exists).
-- Per-user cap: 2,000 files and 50 MB of text (workspace_full), exact under
-- parallel writes because one member's writes take turns (advisory lock).
create function public.ten_ws_write(p_path text, p_content text, p_expected text)
returns table (path text, version text, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_new text := left(encode(sha256(convert_to(p_content, 'UTF8')), 'hex'), 16);
  v_files bigint;
  v_bytes bigint;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  if not public.ten_is_member() then
    raise exception 'not_a_member' using errcode = 'PT403';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ten_ws:' || v_uid::text, 0));

  if not public.ten_path_ok(p_path) then
    raise exception 'invalid_ref' using errcode = 'PT400';
  end if;
  if lower(p_path) ~ '^skills/'
     or (lower(p_path) ~ '(^|/)claude\.md$' and not (p_path = 'CLAUDE.md' and p_expected is null)) then
    raise exception 'not_editable' using errcode = 'PT403';  -- root CLAUDE.md is create-only
  end if;
  if p_path !~* '\.(md|txt|json|html)$' then
    raise exception 'unsupported_type' using errcode = 'PT415';
  end if;
  if p_content is null or octet_length(p_content) > 2 * 1024 * 1024 then
    raise exception 'content_too_large' using errcode = 'PT413';
  end if;

  select count(*), coalesce(sum(octet_length(f.content)), 0) into v_files, v_bytes
    from public.ten_ws_files f
   where f.user_id = v_uid and f.path <> p_path;
  if v_files >= 2000 or v_bytes + octet_length(p_content) > 50 * 1024 * 1024 then
    raise exception 'workspace_full' using errcode = 'PT413';
  end if;

  if p_expected is null then
    if public.ten_path_clash(p_path) then
      raise exception 'path_conflict' using errcode = 'PT409';
    end if;
    return query
      insert into public.ten_ws_files as f (user_id, path, content, version, updated_at)
      values (v_uid, p_path, p_content, v_new, now())
      on conflict on constraint ten_ws_files_pkey do nothing
      returning f.path, f.version, f.updated_at;
    if not found then
      raise exception 'already_exists' using errcode = 'PT409';
    end if;
  else
    return query
      update public.ten_ws_files as f
         set content = p_content, version = v_new, updated_at = now()
       where f.user_id = v_uid and f.path = p_path and f.version = p_expected
      returning f.path, f.version, f.updated_at;
    if not found then
      if exists (select 1 from public.ten_ws_files f2
                  where f2.user_id = v_uid and f2.path = p_path) then
        raise exception 'version_conflict' using errcode = 'PT409';
      else
        raise exception 'resource_missing' using errcode = 'PT404';
      end if;
    end if;
  end if;
end $$;

-- Opens a spend gate (§ 3); members only. Expires any other pending gate in the chat.
create function public.ten_gate_open(
  p_id uuid, p_chat text, p_label text, p_text_hash text, p_gate_line text, p_amount numeric)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  if not public.ten_is_member() then
    raise exception 'not_a_member' using errcode = 'PT403';
  end if;
  update public.ten_gate_log set status = 'expired', decided_at = now()
   where user_id = v_uid and chat_id = p_chat and status = 'pending';
  insert into public.ten_gate_log (id, user_id, chat_id, kind, label, text_hash, gate_line, amount_usd)
  values (p_id, v_uid, p_chat, 'spend', p_label, p_text_hash, p_gate_line, p_amount);
end $$;

-- Moves a gate off pending exactly once (§ 3); members only. False if not pending.
create function public.ten_gate_decide(p_id uuid, p_status text, p_typed text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  if not public.ten_is_member() then
    raise exception 'not_a_member' using errcode = 'PT403';
  end if;
  if p_status not in ('approved', 'declined', 'expired') then
    raise exception 'bad_status' using errcode = 'PT400';
  end if;
  update public.ten_gate_log
     set status = p_status, typed_text = p_typed, decided_at = now()
   where id = p_id and user_id = v_uid and status = 'pending';
  return found;
end $$;

-- Expires the caller's pending gates from other chats (a reload starts a new chat, § 3).
create function public.ten_gate_expire_other_chats(p_chat text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.ten_is_member() then
    raise exception 'not_a_member' using errcode = 'PT403';
  end if;
  update public.ten_gate_log set status = 'expired', decided_at = now()
   where user_id = (select auth.uid()) and chat_id <> p_chat and status = 'pending';
end $$;

-- Function grants: nothing for anon/public; members call the user functions;
-- ten_balance_for and ten_beta_spend_today are service-role only.
revoke all on function
  public.ten_path_ok(text),
  public.ten_is_member(), public.ten_balance(), public.ten_balance_for(uuid),
  public.ten_beta_spend_today(), public.ten_object_count(), public.ten_path_clash(text),
  public.ten_ws_write(text, text, text),
  public.ten_gate_open(uuid, text, text, text, text, numeric),
  public.ten_gate_decide(uuid, text, text),
  public.ten_gate_expire_other_chats(text)
  from public, anon, authenticated;
grant execute on function
  public.ten_path_ok(text),
  public.ten_is_member(), public.ten_balance(), public.ten_object_count(),
  public.ten_path_clash(text),
  public.ten_ws_write(text, text, text),
  public.ten_gate_open(uuid, text, text, text, text, numeric),
  public.ten_gate_decide(uuid, text, text),
  public.ten_gate_expire_other_chats(text)
  to authenticated;
grant execute on function public.ten_balance_for(uuid), public.ten_beta_spend_today()
  to service_role;

-- 4. Read policies (after the functions they call): own rows only, members
--    only (except the ledger, see the header). No insert/update/delete
--    policies; writes go through the functions above or the service role.

create policy ten_usage_ledger_select_own on public.ten_usage_ledger
  for select to authenticated using (user_id = (select auth.uid()));
create policy ten_gate_log_select_own on public.ten_gate_log
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.ten_is_member()));
create policy ten_ws_files_select_own on public.ten_ws_files
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.ten_is_member()));

grant select on public.ten_usage_ledger, public.ten_gate_log, public.ten_ws_files
  to authenticated;

-- 5. Storage: one private bucket for binaries (.pdf/.docx), create-only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ten-workspaces', 'ten-workspaces', false, 10 * 1024 * 1024,
        array['application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

-- Members read and create only under users/{their uid}/ws/. No update policy
-- (create-only) and no delete policy (ten-delete-account and the teardown use
-- the Storage API with the service role). Insert also enforces the binary
-- extension (so text paths never land here: one home per file), the path rule
-- (ten_path_ok), nothing under ws/skills/, no file/folder or case clash, and
-- at most 50 objects per user (≤ 500 MB at the 10 MB file limit).
create policy ten_ws_objects_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ten-workspaces'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = (select auth.uid()::text)
    and (storage.foldername(name))[3] = 'ws'
    and public.ten_is_member()
  );

create policy ten_ws_objects_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ten-workspaces'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = (select auth.uid()::text)
    and (storage.foldername(name))[3] = 'ws'
    and name ~* '\.(pdf|docx)$'
    and public.ten_path_ok(regexp_replace(name, '^users/[^/]+/ws/', ''))
    and lower(name) !~ '^users/[^/]+/ws/skills/'
    and public.ten_is_member()
    and not public.ten_path_clash(regexp_replace(name, '^users/[^/]+/ws/', ''))
    and public.ten_object_count() < 50
  );

-- The pins (R2-S1): RESTRICTIVE, so they are ANDed with every permissive
-- policy, including any the old app adds later. Built-in functions only, so
-- no role (anon included) can hit a permission error through them, and rows
-- of every other bucket pass untouched.
create policy ten_ws_objects_pin on storage.objects
  as restrictive for all to public
  using (bucket_id <> 'ten-workspaces'
         or ((storage.foldername(name))[1] = 'users'
             and (storage.foldername(name))[2] = (select auth.uid()::text)))
  with check (bucket_id <> 'ten-workspaces'
         or ((storage.foldername(name))[1] = 'users'
             and (storage.foldername(name))[2] = (select auth.uid()::text)));
create policy ten_bucket_pin_update on storage.buckets
  as restrictive for update to public using (id <> 'ten-workspaces');
create policy ten_bucket_pin_delete on storage.buckets
  as restrictive for delete to public using (id <> 'ten-workspaces');

commit;

-- NOT in SQL (the owner does these by hand; the teardown lists their reversal):
--   Edge Functions: ten-model-proxy, ten-delete-account
--   Function secret: TEN_OPENROUTER_API_KEY = the owner's EXISTING OpenRouter
--     key, shared with the live CareerCoach app ($20 limit, daily reset)
--   Auth > URL Configuration > Redirect URLs: add the Vercel production URL
--     (leave the Site URL unchanged)
--   AFTER checklist step 3 only — starter credit per invited user (service role):
--     insert into public.ten_usage_ledger (user_id, kind, usd) values ('<uid>', 'credit', 5.00);
