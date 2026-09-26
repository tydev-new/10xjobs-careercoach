-- Ten web beta: buying credit with PayPal (§ 17). Contract:
-- docs/design-web-agent.md § 17.3, § 17.9. A NEW migration — the applied
-- 20260923000000_ten_beta_init.sql, 20260924000000_ten_ledger_finish_reason.sql
-- and 20260924100000_ten_conversations.sql are never edited.
--
-- WHAT THIS FILE TOUCHES. Two `alter table ... add column` on
-- public.ten_usage_ledger (gross_usd, fee_usd, both nullable numeric(12,2)),
-- one new check constraint tying them to a PayPal `request_id`, and widens
-- the existing `ten_usage_ledger_kind` check to also allow `'refund'`.
-- Nothing else: no other table, function, policy, or grant.
--
-- The owner applies it, never an agent, BEFORE deploying `ten-paypal` and
-- `ten-paypal-webhook`, which write `gross_usd`/`fee_usd` — otherwise every
-- credited capture's insert would name unknown columns (PGRST204) and fail.
-- Apply at a quiet time: SQL editor as `postgres`, or
-- `psql -v ON_ERROR_STOP=1 -f <this file>`. It sets a 3 s lock timeout; on a
-- timeout (or any error) the whole transaction rolls back and nothing
-- changes, so simply re-run later. Then `NOTIFY pgrst, 'reload schema';` so
-- PostgREST sees the new columns.
--
-- TARGET: project career-coach-nextgen (ref ivunfotoggdxbjouumdk, Postgres 17),
-- same as the earlier three migrations.
--
-- Reversed by: two new `drop constraint`-free statements are unnecessary —
-- both columns and the wider kind check go with the table when
-- supabase/teardown/ten_beta_teardown.sql drops public.ten_usage_ledger.
-- That file's header now also lists this migration, and it refuses to run
-- while any `paypal:` ledger row exists (§ 17.3's "the teardown refuses
-- while paypal: rows exist, until the owner exports them" — the export
-- query is below). The SQL harness (tests/sql/) applies all four migrations
-- in order.
--
-- OWNER EXPORT QUERY (run before teardown, if any `paypal:` rows exist —
-- no payer name or email is ever stored, so this is amounts and ids only):
--   select id, user_id, request_id, usd, gross_usd, fee_usd, created_at
--     from public.ten_usage_ledger
--    where request_id like 'paypal:%' or request_id like 'paypal-refund:%'
--    order by created_at;

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'ten_usage_ledger') then
    raise exception 'ten beta (paypal credit): public.ten_usage_ledger does not exist; apply 20260923000000_ten_beta_init.sql first.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'ten_usage_ledger'
                and column_name in ('gross_usd', 'fee_usd')) then
    raise exception 'ten beta (paypal credit): public.ten_usage_ledger.gross_usd/fee_usd already exist; run the teardown or inspect first.';
  end if;
end $$;

-- § 17.3: "usd = PayPal's net_amount, plus new nullable gross_usd, fee_usd
-- (numeric(12,2))." PayPal's own decimal strings reach Postgres unparsed
-- (the functions never compute money in float — § 17.6 / the old-app
-- known-issue note this build deliberately does NOT repeat).
alter table public.ten_usage_ledger
  add column gross_usd numeric(12,2),
  add column fee_usd numeric(12,2);

-- § 17.3's check, word for word (fixed round 2, F9 — a genuine TWO-WAY
-- check, not just "a paypal: row without gross/fee is refused"): "a
-- paypal: row without gross_usd and fee_usd is refused, AND SO IS EITHER
-- COLUMN ON ANY OTHER ROW; a paypal: row also needs kind = 'credit',
-- fee_usd >= 0, usd > 0, usd = gross_usd - fee_usd, so a breakdown that
-- doesn't add up is refused." A `paypal-refund:` row (kind 'refund', §
-- 17.5) does NOT start with 'paypal:' (it starts with the different,
-- longer prefix `paypal-refund:`), so it is bound by the SAME "gross/fee
-- must be null" side of this check as any other non-paypal: row — it may
-- never carry a breakdown either.
--
-- Written with `coalesce(... like ..., false)` throughout, not a bare
-- `request_id like 'paypal:%'`: Postgres's three-valued logic makes a bare
-- `NULL like 'paypal:%'` evaluate to NULL, and a CHECK constraint only
-- REJECTS an explicit FALSE — a NULL result is silently treated as passing.
-- A row with `request_id is null` would then slip a stray gross_usd/fee_usd
-- straight past a check written with the bare comparison; wrapping it in
-- `coalesce(..., false)` forces that case to an explicit FALSE so the "set
-- EXACTLY when paypal:" reverse direction is actually enforced.
alter table public.ten_usage_ledger
  add constraint ten_usage_ledger_paypal_breakdown check (
    coalesce(request_id like 'paypal:%', false) = (gross_usd is not null)
    and coalesce(request_id like 'paypal:%', false) = (fee_usd is not null)
    and (
      not coalesce(request_id like 'paypal:%', false)
      or (kind = 'credit' and fee_usd >= 0 and usd > 0 and usd = gross_usd - fee_usd)
    )
  );

-- The refund kind (§ 17.5): "the owner refunds in PayPal, ... then inserts
-- kind 'refund', request_id 'paypal-refund:<refundId>', usd = the amount."
-- `ten_balance_for` already subtracts every non-credit kind (the existing
-- `case when kind = 'credit' then usd else -usd end`), and membership /
-- the day's spend read only `credit` and `call` (unchanged) — so a refund
-- lowers the balance without touching either. No function or policy change.
alter table public.ten_usage_ledger drop constraint ten_usage_ledger_kind;
alter table public.ten_usage_ledger
  add constraint ten_usage_ledger_kind check (kind in ('credit', 'call', 'refund'));

commit;

-- NOT in SQL (the owner does these by hand; supabase/functions/README.md's
-- "Buying credit" section has the full checklist):
--   Edge Functions: ten-paypal, ten-paypal-webhook (--no-verify-jwt)
--   Function secrets: TEN_PAYPAL_CLIENT_ID, TEN_PAYPAL_CLIENT_SECRET,
--     TEN_PAYPAL_API_BASE, TEN_PAYPAL_WEBHOOK_ID
--   Vercel: VITE_PAYPAL_CLIENT_ID, then a fresh site deploy
--   developer.paypal.com: the app's own webhook URL, "Payment capture
--     completed" only
--   The older CareerCoach app's patch (docs/old-app-paypal-ten-prefix.md),
--     applied BEFORE Ten's first live payment
