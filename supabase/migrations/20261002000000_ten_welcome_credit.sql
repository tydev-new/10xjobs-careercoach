-- Ten web beta: open sign-up with a welcome credit (§ 20). Contract:
-- docs/design-web-agent.md § 20.1, § 20.2, § 20.3, § 20.6, § 20.10 (1).
-- A NEW migration: the four applied files
-- (20260923000000_ten_beta_init.sql, 20260924000000_ten_ledger_finish_reason.sql,
-- 20260924100000_ten_conversations.sql, 20260925000000_ten_paypal_credit.sql)
-- are never edited.
--
-- WHAT THIS FILE ADDS (four objects, all `ten_` named, nothing existing is
-- altered; no policy; no trigger on auth.users, § 20.9):
--   public.ten_welcome_settings   one row: cap (ships at 0) and usd (1.00)
--   public.ten_welcome_claims     email_hash only; survives account deletion
--   public.ten_welcome_hash(text) the one hash helper (§ 20.2)
--   public.ten_claim_welcome()    the grant: one transaction, acts only on auth.uid()
-- The ledger, its checks, ten_is_member() and every policy are unchanged: a
-- `welcome:<uid>` credit row carries no gross_usd/fee_usd (the PayPal
-- breakdown check forbids them on non-paypal: rows).
--
-- NO DAILY CEILING (owner, 2026-10-02): the OpenRouter key is a prepaid
-- balance the owner tops up by hand and has no daily limit, so the two
-- "split ceiling" functions of § 20.6 (ten_is_paid, ten_free_spend_today)
-- are NOT part of this file, and ten-model-proxy no longer asks for any
-- day's spend. The applied ten_beta_spend_today() (20260923000000) stays as
-- it is, UNUSED by the proxy: only the owner's read-only view below uses it.
--
-- IT SHIPS CLOSED: cap = 0, so applying this file, deploying ten-model-proxy
-- and deploying the site can happen in any order without granting anyone
-- anything. The owner opens it with one update (§ 20.12).
--
-- OWNER CHECKLIST (never an agent; § 15, production is owner-only):
--   1. The owner has reviewed apps/web/public/terms.html (§ 20.7 item 1).
--   2. Apply this file at a quiet time: SQL editor as `postgres`, or
--      `psql -v ON_ERROR_STOP=1 -f <this file>`. It sets a 3 s lock timeout;
--      on a timeout (or any error, or a failed order guard) the whole
--      transaction rolls back and nothing changes, so simply re-run later.
--      Then:   NOTIFY pgrst, 'reload schema';
--      Check, read-only (expect 0 and 1.00):
--        select cap, usd from public.ten_welcome_settings;
--   3. Deploy ten-model-proxy, deploy the site (§ 20.12 steps 3-4).
--   4. Live check at cap 0 (O2 shows), then:
--        update public.ten_welcome_settings set cap = 1;      -- one test grant
--      then a +tag of the same inbox shows O4. Then open at the chosen cap
--      (§ 20.8 recommends 15 to 20 without auto top-up):
--        update public.ten_welcome_settings set cap = <N>;
--   Pause at once with:        update public.ten_welcome_settings set cap = 0;
--   Raise the cap or change the amount (each grant: > 0 and <= 5 dollars):
--        update public.ten_welcome_settings set cap = 150;
--        update public.ten_welcome_settings set usd = 2.50;
--
-- OWNER QUERIES, read-only (§ 20.8):
--   grants per day, from the ledger (a deleted account's grant drops out of it):
--     select date_trunc('day', created_at) as day, count(*)
--       from public.ten_usage_ledger where request_id like 'welcome:%'
--      group by 1 order by 1;
--   all of Ten's spend today (the applied function; the proxy does not call it):
--     select public.ten_beta_spend_today();
--
-- PRIVACY (§ 20.2, § 20.3, PRINCIPLES rule 9 as amended 2026-10-02): the claims
-- table keeps a one-way fingerprint of an email address, not the address: no
-- email, no user id, no date. It is not anonymous: anyone who can read the
-- table and already has an address can check whether it claimed. Only the
-- database owner and the service role can read it (RLS on, no policy, every
-- grant revoked from anon, authenticated and public). It has no link to the
-- account, so deleting the account leaves it, which is the point: the same
-- inbox can't claim twice and the cap keeps counting the old grant.
--
-- EMAIL CONFIRMATION MUST STAY ON in Supabase Auth ("Confirm email"): with it
-- off, Supabase implicitly confirms every address and step 3 of the claim
-- would check nothing (§ 20.1).
--
-- TARGET: project career-coach-nextgen (ref ivunfotoggdxbjouumdk, Postgres 17).
-- Reversed by supabase/teardown/ten_beta_teardown.sql, whose header lists this
-- file and which drops all four objects. Tested by tests/sql/r9-welcome.mjs.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- 0. Order guard (§ 20.10 (1)): the PayPal migration must be applied (the
--    ledger has gross_usd), and none of this file's own objects may exist.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'ten_usage_ledger'
                    and column_name = 'gross_usd') then
    raise exception 'ten beta (welcome credit): public.ten_usage_ledger.gross_usd does not exist; apply 20260925000000_ten_paypal_credit.sql (and the migrations before it) first.';
  end if;
  if exists (select 1 from pg_tables
              where schemaname = 'public'
                and tablename in ('ten_welcome_settings', 'ten_welcome_claims'))
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and p.proname in ('ten_welcome_hash', 'ten_claim_welcome')) then
    raise exception 'ten beta (welcome credit): one of its objects already exists; run the teardown or inspect first.';
  end if;
end $$;

-- 1. The settings row (§ 20.2): exactly one row, and the one home of both
--    values (rule 12). cap = how many grants may exist in total, counted from
--    the claims table; usd = each grant's amount, at most the $5 invited
--    starter so a typo can't grant $100.
create table public.ten_welcome_settings (
  id  boolean primary key default true constraint ten_welcome_settings_one_row check (id),
  cap integer not null constraint ten_welcome_settings_cap check (cap >= 0),
  usd numeric(12,2) not null constraint ten_welcome_settings_usd check (usd > 0 and usd <= 5)
);
alter table public.ten_welcome_settings enable row level security;
insert into public.ten_welcome_settings (id, cap, usd) values (true, 0, 1.00);

-- 2. The claims table (§ 20.2): the fingerprint and nothing else. 64 lowercase
--    hex characters (sha256).
create table public.ten_welcome_claims (
  email_hash text primary key constraint ten_welcome_claims_hash check (email_hash ~ '^[0-9a-f]{64}$')
);
alter table public.ten_welcome_claims enable row level security;

revoke all on public.ten_welcome_settings, public.ten_welcome_claims
  from anon, authenticated, public;

-- 3. The hash (§ 20.2), one helper. Lower-case and trim; split at the LAST '@';
--    drop everything from the first '+' in the local part; for gmail.com and
--    googlemail.com also drop every '.' in the local part and use gmail.com;
--    sha256 of 'ten-welcome-v1:' || local || '@' || domain over the UTF-8
--    bytes, as 64 lowercase hex characters. Built-in functions only.
create function public.ten_welcome_hash(p_email text) returns text
language plpgsql immutable strict set search_path = '' as $$
declare
  v_email  text := lower(regexp_replace(p_email, '^[[:space:]]+|[[:space:]]+$', '', 'g'));
  v_local  text;
  v_domain text;
begin
  if position('@' in v_email) = 0 then
    v_local := v_email;
    v_domain := '';
  else
    v_local  := substring(v_email from '^(.*)@[^@]*$');
    v_domain := substring(v_email from '^.*@([^@]*)$');
  end if;
  v_local := split_part(v_local, '+', 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local  := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  return encode(sha256(convert_to('ten-welcome-v1:' || v_local || '@' || v_domain, 'UTF8')), 'hex');
end $$;

-- 4. The grant (§ 20.1). Definer (owned by whoever applies this file: postgres
--    in the SQL editor), acts only on auth.uid(). One transaction, in this order.
create function public.ten_claim_welcome() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := (select auth.uid());
  v_email     text;
  v_confirmed timestamptz;
  v_cap       integer;
  v_usd       numeric;
  v_hash      text;
begin
  -- 1. Signed in.
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;

  -- 2. Already a member (the same test as ten_is_member(): any credit row, an
  --    invited starter, a paid row or an earlier welcome). Nothing is written.
  if exists (select 1 from public.ten_usage_ledger where user_id = v_uid and kind = 'credit') then
    return jsonb_build_object('status', 'already_member');
  end if;

  -- 3. A confirmed email, read from the table, not from the token's claims
  --    (rule 11). No email (an anonymous or phone account) or no confirmation date.
  select u.email, u.email_confirmed_at into v_email, v_confirmed
    from auth.users u where u.id = v_uid;
  if v_email is null or btrim(v_email) = '' or v_confirmed is null then
    return jsonb_build_object('status', 'unconfirmed');
  end if;

  -- 4. Lock the settings row. Each claim waits here for the one before it, so
  --    two claims can't both see 99 grants and both take the 100th, and one
  --    account's two tabs can't both grant. A missing row (the owner deleted
  --    it) fails closed as paused.
  select s.cap, s.usd into v_cap, v_usd
    from public.ten_welcome_settings s where s.id for update;
  if not found then
    return jsonb_build_object('status', 'paused');
  end if;

  -- 4b. Re-check membership now that the lock is held: if this account's other
  --     tab won the race while this call waited, this call is `already_member`
  --     (§ 20.4: "another tab won"), not `already_claimed`.
  if exists (select 1 from public.ten_usage_ledger where user_id = v_uid and kind = 'credit') then
    return jsonb_build_object('status', 'already_member');
  end if;

  -- 5. One per inbox.
  v_hash := public.ten_welcome_hash(v_email);
  if exists (select 1 from public.ten_welcome_claims c where c.email_hash = v_hash) then
    return jsonb_build_object('status', 'already_claimed');
  end if;

  -- 6. The cap, counted from the claims table (deleted accounts still count).
  if (select count(*) from public.ten_welcome_claims) >= v_cap then
    return jsonb_build_object('status', 'paused');
  end if;

  -- 7. Grant: the hash, then one ledger row (no model, tokens 0, gross_usd
  --    and fee_usd null). The ledger's unique request_id refuses a second
  --    welcome:<uid> row even if this function is later changed.
  insert into public.ten_welcome_claims (email_hash) values (v_hash);
  insert into public.ten_usage_ledger (user_id, kind, usd, request_id)
  values (v_uid, 'credit', v_usd, 'welcome:' || lower(v_uid::text));
  return jsonb_build_object('status', 'granted', 'usd', v_usd);
end $$;

-- 5. Grants (§ 20.1, § 20.2): the claim to authenticated only; the hash to
--    neither anon nor authenticated.
revoke all on function public.ten_welcome_hash(text), public.ten_claim_welcome()
  from public, anon, authenticated;
grant execute on function public.ten_claim_welcome() to authenticated;

commit;

-- NOT in SQL (the owner does these by hand; supabase/functions/README.md and
-- design-web-agent.md § 20.12 have the full checklist):
--   NOTIFY pgrst, 'reload schema';
--   supabase functions deploy ten-model-proxy --no-verify-jwt --project-ref ivunfotoggdxbjouumdk
--   apps/web/scripts/deploy-prod.sh
--   update public.ten_welcome_settings set cap = 1;   -- then the chosen cap, to open
