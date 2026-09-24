-- Ten web beta: cut-off replies (§ 9, amended 2026-09-24). Contract:
-- docs/design-web-agent.md § 9.6. A NEW migration — the applied
-- 20260923000000_ten_beta_init.sql is never edited.
--
-- WHAT THIS FILE TOUCHES. One `alter table ... add column` on
-- public.ten_usage_ledger, adding a single nullable column with a check
-- constraint. Nothing else: no other table, function, policy, or grant.
--
-- The owner applies it, never an agent, BEFORE deploying the proxy that
-- writes the column — otherwise every insert would name an unknown column
-- (PGRST204) and fail. Apply at a quiet time: SQL editor as `postgres`, or
-- `psql -v ON_ERROR_STOP=1 -f <this file>`. It sets a 3 s lock timeout; on a
-- timeout (or any error) the whole transaction rolls back and nothing
-- changes, so simply re-run later.
--
-- TARGET: project career-coach-nextgen (ref ivunfotoggdxbjouumdk, Postgres 17),
-- same as 20260923000000_ten_beta_init.sql.
--
-- Reversed by: no new statement in supabase/teardown/ten_beta_teardown.sql
-- (the column goes with the table when that file drops
-- public.ten_usage_ledger) — its header names both migration files, and the
-- SQL harness (tests/sql/) applies both, in order.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'ten_usage_ledger') then
    raise exception 'ten beta (finish_reason): public.ten_usage_ledger does not exist; apply 20260923000000_ten_beta_init.sql first.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'ten_usage_ledger'
                and column_name = 'finish_reason') then
    raise exception 'ten beta (finish_reason): public.ten_usage_ledger.finish_reason already exists; run the teardown or inspect first.';
  end if;
end $$;

-- § 9.6: "Column: ten_usage_ledger.finish_reason text, nullable, with
-- check (finish_reason is null or char_length(finish_reason) <= 32)."
-- Null for every row today (credit rows always; call rows until the
-- redeployed proxy starts writing it) — a plain `add column` with no
-- `not null`/`default` needs no table rewrite and holds the lock for the
-- shortest possible time.
alter table public.ten_usage_ledger
  add column finish_reason text
  constraint ten_usage_ledger_finish_reason check (finish_reason is null or char_length(finish_reason) <= 32);

commit;
