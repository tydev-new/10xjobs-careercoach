-- Ten web beta: keeping the conversation between sign-ins (§ 11, amended
-- 2026-09-24). Contract: docs/design-web-agent.md § 11.2. A NEW migration —
-- the applied 20260923000000_ten_beta_init.sql and
-- 20260924000000_ten_ledger_finish_reason.sql are never edited.
--
-- WHAT THIS FILE TOUCHES. One new table, `public.ten_conversations` (one row
-- per user, RLS on, own-row read only, no insert/update/delete grant), one
-- new security-definer function, `public.ten_conversation_save`, and its
-- own execute grant to `authenticated`. Nothing else: no other table,
-- function, policy, grant, or existing object of any kind.
--
-- TARGET: project career-coach-nextgen (ref ivunfotoggdxbjouumdk, Postgres 17),
-- same as the earlier two migrations. Depends on
-- 20260923000000_ten_beta_init.sql (public.ten_is_member()).
--
-- The owner applies it, never an agent, at a quiet time: SQL editor as
-- `postgres`, or `psql -v ON_ERROR_STOP=1 -f <this file>`. It sets a 3 s lock
-- timeout; on a timeout (or any error) the whole transaction rolls back and
-- nothing changes, so simply re-run later. § 11.8's deploy order: this
-- migration, then `NOTIFY pgrst, 'reload schema';`, then the redeployed
-- `ten-delete-account` (it now also deletes this table's row), then the
-- site release that starts saving (never apart from design-web-ui.md § 1.8's
-- new copy, § 11.8).
--
-- Reversed by: new statements in supabase/teardown/ten_beta_teardown.sql
-- (its header now names all three migration files; the SQL harness
-- (tests/sql/) applies all three, in order).

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- 0. Preconditions: a second run (or a run before the tables/functions this
--    depends on exist) says so, rather than silently half-applying.
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'ten_is_member') then
    raise exception 'ten beta (conversations): public.ten_is_member() does not exist; apply 20260923000000_ten_beta_init.sql first.';
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'ten_conversations')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ten_conversation_save')
     or exists (select 1 from pg_policies where policyname like 'ten\_conversations\_%') then
    raise exception 'ten beta (conversations): a ten_conversations object already exists; run the teardown or inspect first.';
  end if;
end $$;

-- 1. The table (§ 11.2's own column table).
--    - chat_id: set when the row is created, never changed thereafter (the
--      RPC's UPDATE branch filters on it — see below).
--    - messages: the sanitized array packages/agent's conversationToSave
--      produced (§ 11.3); the app, never a tool, ever writes this table (no
--      workspace path reaches it — § 11.2's own "why a table" note).
--    - version: sha256 prefix of messages::text, computed in SQL exactly
--      like ten_ws_write's v_new, so two clients computing "the same
--      content" agree without a round trip.
--    - older_dropped: § 11.4's cap flag (UI § 1.9's "older messages weren't
--      kept" line reads this).
create table public.ten_conversations (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  chat_id       text not null constraint ten_conversations_chat_id check (char_length(chat_id) <= 100),
  messages      jsonb not null constraint ten_conversations_messages_array check (jsonb_typeof(messages) = 'array'),
  older_dropped boolean not null default false,
  version       text not null,
  updated_at    timestamptz not null default now(),
  constraint ten_conversations_size check (octet_length(messages::text) <= 1048576)
);
alter table public.ten_conversations enable row level security;

revoke all on public.ten_conversations from anon, authenticated, public;

-- 2. The one write path (§ 11.2): security definer, acts only on
--    auth.uid()'s own row, members only (PT401/PT403). `p_expected` null
--    inserts (on conflict do nothing — a row already existing, e.g. a
--    concurrent first save from another tab, is "no row changed", the same
--    PT409 as a stale version below — § 11.5's compare-and-swap backstop).
--    Otherwise it updates where version = p_expected AND chat_id =
--    p_chat_id (so a save carrying a chat_id that doesn't match the row's
--    own — should never happen from a correct client, § 11.6's "the chat id
--    is stable" — also fails closed as a conflict, never silently
--    overwriting a different conversation's row). Not an array is PT400
--    invalid_ref; over the 1 MiB cap is PT413 conversation_too_large,
--    checked here (not just the table's backstop constraint) so the client
--    sees the named code, not a raw constraint violation. Returns the new
--    version.
create function public.ten_conversation_save(
  p_chat_id text, p_messages jsonb, p_older_dropped boolean, p_expected text)
returns table (chat_id text, version text, older_dropped boolean, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_new text;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  if not public.ten_is_member() then
    raise exception 'not_a_member' using errcode = 'PT403';
  end if;
  if p_chat_id is null or char_length(p_chat_id) > 100 then
    raise exception 'invalid_ref' using errcode = 'PT400';
  end if;
  if p_messages is null or jsonb_typeof(p_messages) is distinct from 'array' then
    raise exception 'invalid_ref' using errcode = 'PT400';
  end if;
  if octet_length(p_messages::text) > 1048576 then
    raise exception 'conversation_too_large' using errcode = 'PT413';
  end if;

  v_new := left(encode(sha256(convert_to(p_messages::text, 'UTF8')), 'hex'), 16);

  if p_expected is null then
    return query
      insert into public.ten_conversations as c
        (user_id, chat_id, messages, older_dropped, version, updated_at)
      values (v_uid, p_chat_id, p_messages, coalesce(p_older_dropped, false), v_new, now())
      on conflict (user_id) do nothing
      returning c.chat_id, c.version, c.older_dropped, c.updated_at;
  else
    return query
      update public.ten_conversations as c
         set messages = p_messages,
             older_dropped = coalesce(p_older_dropped, false),
             version = v_new,
             updated_at = now()
       where c.user_id = v_uid and c.chat_id = p_chat_id and c.version = p_expected
      returning c.chat_id, c.version, c.older_dropped, c.updated_at;
  end if;

  if not found then
    raise exception 'version_conflict' using errcode = 'PT409';
  end if;
end $$;

revoke all on function public.ten_conversation_save(text, jsonb, boolean, text)
  from public, anon, authenticated;
grant execute on function public.ten_conversation_save(text, jsonb, boolean, text)
  to authenticated;

-- 3. Read policy (after the function it calls): own row only, members only,
--    like ten_ws_files_select_own. No insert/update/delete policy — every
--    write goes through the function above.
create policy ten_conversations_select_own on public.ten_conversations
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.ten_is_member()));

grant select on public.ten_conversations to authenticated;

commit;
