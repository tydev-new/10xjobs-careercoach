-- Ten feedback: notes people choose to send to the people building Ten
-- (docs/design-feedback.md § 10). A NEW migration: the five applied files
-- (20260923000000_ten_beta_init.sql, 20260924000000_ten_ledger_finish_reason.sql,
-- 20260924100000_ten_conversations.sql, 20260925000000_ten_paypal_credit.sql,
-- 20261002000000_ten_welcome_credit.sql) are never edited.
--
-- WHAT THIS FILE ADDS (three objects, all `ten_` named; nothing existing is
-- touched; no policy; no trigger on auth.users):
--   public.ten_feedback           one row per note. NO user id, email, address,
--                                  user agent or origin column, so nothing can
--                                  store one
--   public.ten_feedback_settings  one row: open, and the four limits
--   public.ten_feedback_add(...)  the only way in: the limits are counted from
--                                  the table itself, in one locked transaction
--
-- IT SHIPS OPEN, unlike the welcome credit (which shipped closed): a note costs
-- no money, and nothing can write until the ten-feedback Edge Function is
-- deployed anyway. The owner changes any value with one update, no deploy.
--
-- OWNER CHECKLIST (never an agent; § 15, production is owner-only; the full
-- list is docs/design-feedback.md § 16.1 and supabase/functions/README.md):
--   1. Apply this file at a quiet time: SQL editor as `postgres`, or
--      `psql -v ON_ERROR_STOP=1 -f <this file>`. It sets a 3 s lock timeout; on
--      a timeout (or any error, or a failed order guard) the whole transaction
--      rolls back and nothing changes, so simply re-run later. Then:
--        NOTIFY pgrst, 'reload schema';
--   2. Check, read-only:
--        select * from public.ten_feedback_settings;
--        -- expect: open true, 10, 60, 300, 5000
--        select has_table_privilege('anon', 'public.ten_feedback', 'insert'),
--               has_table_privilege('authenticated', 'public.ten_feedback', 'select'),
--               has_function_privilege('anon', 'public.ten_feedback_add(text,text,smallint,text,text,text,text,text)', 'execute');
--        -- expect: false, false, false
--   3. Deploy the function:
--        supabase functions deploy ten-feedback --no-verify-jwt --project-ref ivunfotoggdxbjouumdk
--
-- OWNER QUERIES, read-only (§ 16.3):
--   the newest notes:
--     select created_at, kind, rating, skill, step, host, version,
--            left(installation_id, 8) as install, comment
--       from public.ten_feedback order by created_at desc limit 100;
--   notes per day:
--     select date_trunc('day', created_at) as day, host, kind, count(*)
--       from public.ten_feedback group by 1, 2, 3 order by 1 desc;
--   stop every send at once:        update public.ten_feedback_settings set open = false;
--   make room after reading:        delete from public.ten_feedback where created_at < '<date>';
--   change a limit (each in range): update public.ten_feedback_settings set all_per_hour = 100;
--
-- PRIVACY (§ 10, § 14): a note is not linked to an account, an email or an
-- address, so ten-delete-account is unchanged and a note stays after a person
-- deletes their beta data. Only the database owner and the service role can
-- read the table (RLS on, no policy, every grant revoked from anon,
-- authenticated and public).
--
-- TARGET: project career-coach-nextgen (ref ivunfotoggdxbjouumdk, Postgres 17).
-- Reversed by supabase/teardown/ten_beta_teardown.sql, whose header lists this
-- file and which drops all three objects. Tested by tests/sql/r11-feedback.mjs.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- 0. Order guard (§ 10): none of this file's own objects may exist. (It depends
--    on no earlier migration: it touches no existing object.)
do $$
begin
  if exists (select 1 from pg_tables
              where schemaname = 'public'
                and tablename in ('ten_feedback', 'ten_feedback_settings'))
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ten_feedback_add') then
    raise exception 'ten feedback: one of its objects already exists; run the teardown or inspect first.';
  end if;
end $$;

-- 1. The notes (§ 10.1). Ten columns; every rule the Edge Function checks is
--    also a check here, so the two cannot disagree silently.
create table public.ten_feedback (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  kind            text not null
                    constraint ten_feedback_kind check (kind in ('bug', 'comment')),
  comment         text not null default ''
                    constraint ten_feedback_comment check (char_length(comment) <= 2000),
  rating          smallint
                    constraint ten_feedback_rating check (rating between 1 and 5),
  skill           text not null default ''
                    constraint ten_feedback_skill check (skill = '' or skill ~ '^[a-z][a-z-]{0,29}$'),
  step            text not null default ''
                    constraint ten_feedback_step check (char_length(step) <= 60 and step !~ '[@/\\\r\n]'),
  version         text not null
                    constraint ten_feedback_version check (version ~ '^[0-9A-Za-z.+-]{1,40}$'),
  host            text not null
                    constraint ten_feedback_host check (host in ('local', 'web')),
  installation_id text
                    constraint ten_feedback_installation check (installation_id ~ '^[0-9a-f]{32}$'),
  constraint ten_feedback_words check (comment <> '' or rating is not null),
  constraint ten_feedback_bug_words check (kind <> 'bug' or comment <> '')
);
create index ten_feedback_created_at on public.ten_feedback (created_at);
create index ten_feedback_install_created on public.ten_feedback (installation_id, created_at)
  where installation_id is not null;
alter table public.ten_feedback enable row level security;

-- 2. The settings row (§ 10.2): exactly one row, the one home of the limits
--    (rule 12). Ships open.
create table public.ten_feedback_settings (
  id                   boolean primary key default true
                         constraint ten_feedback_settings_one_row check (id),
  open                 boolean not null default true,
  per_install_per_hour integer not null default 10
                         constraint ten_feedback_settings_install check (per_install_per_hour between 0 and 100),
  all_per_hour         integer not null default 60
                         constraint ten_feedback_settings_hour check (all_per_hour between 0 and 1000),
  all_per_day          integer not null default 300
                         constraint ten_feedback_settings_day check (all_per_day between 0 and 10000),
  max_rows             integer not null default 5000
                         constraint ten_feedback_settings_rows check (max_rows between 0 and 50000)
);
alter table public.ten_feedback_settings enable row level security;
insert into public.ten_feedback_settings (id) values (true);

revoke all on public.ten_feedback, public.ten_feedback_settings
  from public, anon, authenticated;

-- 3. The only way in (§ 10.3). Definer (owned by whoever applies this file:
--    postgres in the SQL editor). One transaction, in this order. A refusal
--    writes nothing; a check violation raises (the function already validated,
--    so it means the two disagree: a bug, which the caller answers as a plain
--    failure).
create function public.ten_feedback_add(
  p_kind            text,
  p_comment         text,
  p_rating          smallint,
  p_skill           text,
  p_step            text,
  p_version         text,
  p_host            text,
  p_installation_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_open        boolean;
  v_per_install integer;
  v_per_hour    integer;
  v_per_day     integer;
  v_max_rows    integer;
begin
  -- 1. Lock the settings row. Each send waits here for the one before it, so
  --    two sends can't both see room for one. A missing row (the owner deleted
  --    it) fails closed.
  select s.open, s.per_install_per_hour, s.all_per_hour, s.all_per_day, s.max_rows
    into v_open, v_per_install, v_per_hour, v_per_day, v_max_rows
    from public.ten_feedback_settings s where s.id for update;
  if not found then
    return jsonb_build_object('status', 'closed');
  end if;

  -- 2. Closed.
  if not v_open then
    return jsonb_build_object('status', 'closed');
  end if;

  -- 3. The table is full.
  if (select count(*) from public.ten_feedback) >= v_max_rows then
    return jsonb_build_object('status', 'limited');
  end if;

  -- 4. Everyone together, in the last hour and in the last 24 hours.
  if (select count(*) from public.ten_feedback
       where created_at > now() - interval '1 hour') >= v_per_hour
     or (select count(*) from public.ten_feedback
          where created_at > now() - interval '24 hours') >= v_per_day then
    return jsonb_build_object('status', 'limited');
  end if;

  -- 5. One random id, in the last hour.
  if p_installation_id is not null
     and (select count(*) from public.ten_feedback
           where installation_id = p_installation_id
             and created_at > now() - interval '1 hour') >= v_per_install then
    return jsonb_build_object('status', 'limited');
  end if;

  -- 6. Write the note.
  insert into public.ten_feedback
    (kind, comment, rating, skill, step, version, host, installation_id)
  values
    (p_kind, p_comment, p_rating, p_skill, p_step, p_version, p_host, p_installation_id);
  return jsonb_build_object('status', 'sent');
end $$;

-- 4. Grants (§ 10.4): the service role only. RLS is on for both tables with no
--    policy, and every table grant is revoked above.
revoke all on function public.ten_feedback_add(text, text, smallint, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ten_feedback_add(text, text, smallint, text, text, text, text, text)
  to service_role;

commit;

-- NOT in SQL (the owner does these by hand; supabase/functions/README.md and
-- design-feedback.md § 16.1 have the full checklist):
--   NOTIFY pgrst, 'reload schema';
--   supabase functions deploy ten-feedback --no-verify-jwt --project-ref ivunfotoggdxbjouumdk
