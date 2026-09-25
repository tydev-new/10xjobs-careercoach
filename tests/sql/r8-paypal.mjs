// Independent tester — docs/design-web-agent.md § 17.3 / § 17.5 / § 17.8
// item 7: the FOURTH migration, 20260925000000_ten_paypal_credit.sql,
// applied AFTER the three applied ones, on the same PGlite stand-in.
// Written from the spec (§ 17.3's check, word for word), not the file.
//   node r8-paypal.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const WT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const MIG1 = readFileSync(`${WT}/supabase/migrations/20260923000000_ten_beta_init.sql`, "utf8");
const MIG2 = readFileSync(`${WT}/supabase/migrations/20260924000000_ten_ledger_finish_reason.sql`, "utf8");
const MIG3 = readFileSync(`${WT}/supabase/migrations/20260924100000_ten_conversations.sql`, "utf8");
const MIG4 = readFileSync(`${WT}/supabase/migrations/20260925000000_ten_paypal_credit.sql`, "utf8");
const TEAR = readFileSync(`${WT}/supabase/teardown/ten_beta_teardown.sql`, "utf8");
const STUB = readFileSync(new URL("./stub.sql", import.meta.url), "utf8");
const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "bbbbbbbb-0000-0000-0000-000000000002";
let fails = 0;
const failed = [];
const out = (t, m, d = "") => console.log(`[${t}] ${m}${d !== "" && d !== undefined ? "  -> " + (typeof d === "string" ? d : JSON.stringify(d)) : ""}`);
const expect = (m, c, d) => { out(c ? "PASS" : "FAIL", m, d); if (!c) { fails++; failed.push(m); } };
const note = (m, d) => out("OBSERVED", m, d);
async function fresh() {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(`insert into auth.users values ('${A}'),('${B}')`);
  return db;
}
async function run(db, sql) { try { await db.exec(sql); return { ok: true }; } catch (e) { try { await db.exec("rollback"); } catch {} return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } }
async function as(db, uid, role, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [uid ? JSON.stringify({ sub: uid, role }) : ""]);
  await db.exec(`set role ${role}`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } finally { await db.exec("reset role"); }
}
const svc = (db, sql, p) => as(db, null, "service_role", sql, p);
// PostgREST hands PayPal's decimal strings to Postgres as text; so do we.
const ins = (db, row) =>
  svc(db, "insert into public.ten_usage_ledger (user_id, kind, request_id, usd, gross_usd, fee_usd) values ($1,$2,$3,$4::numeric,$5::numeric,$6::numeric) returning id",
    [row.user_id ?? A, row.kind ?? "credit", row.request_id ?? null, row.usd, row.gross_usd ?? null, row.fee_usd ?? null]);

// ---- 0. order: the fourth file refuses before the init migration
{
  const db = await fresh();
  const r = await run(db, MIG4);
  expect("paypal migration before the init migration is refused", !r.ok && /apply 20260923000000_ten_beta_init\.sql first/.test(r.e), r.e);
}

let DB;
// ---- 1. applies cleanly after the three applied ones; a second run is refused
{
  const db = await fresh();
  expect("init applies", (await run(db, MIG1)).ok);
  expect("finish_reason applies", (await run(db, MIG2)).ok);
  expect("conversations applies", (await run(db, MIG3)).ok);
  const m4 = await run(db, MIG4);
  expect("§ 17.8(7) the paypal migration applies cleanly after the three applied ones", m4.ok, m4.e);
  const again = await run(db, MIG4);
  expect("a second run is refused by its guard", !again.ok && /already exist/.test(again.e), again.e);
  const cols = (await db.query("select column_name, data_type, numeric_precision, numeric_scale, is_nullable from information_schema.columns where table_schema='public' and table_name='ten_usage_ledger' and column_name in ('gross_usd','fee_usd') order by 1")).rows;
  expect("§ 17.3 gross_usd, fee_usd: nullable numeric(12,2)", cols.length === 2 && cols.every((c) => c.data_type === "numeric" && c.numeric_precision === 12 && c.numeric_scale === 2 && c.is_nullable === "YES"), cols);
  DB = db;
}

// ---- 2. § 17.3's check
{
  const db = DB;
  await svc(db, "insert into public.ten_usage_ledger (user_id, kind, usd) values ($1,'credit',5)", [A]);
  let r = await ins(db, { request_id: "paypal:CAP-OK", usd: "9.16", gross_usd: "10.00", fee_usd: "0.84" });
  expect("a paypal: credit whose breakdown adds up is accepted", r.ok, r.e);
  r = await ins(db, { request_id: "paypal:CAP-OK", usd: "9.16", gross_usd: "10.00", fee_usd: "0.84" });
  expect("the same paypal:<captureId> twice is refused (unique request_id: credit once)", !r.ok && /23505/.test(r.e), r.e);
  r = await ins(db, { request_id: "paypal:CAP-BAD1", usd: "9.20", gross_usd: "10.00", fee_usd: "0.84" });
  expect("usd != gross - fee is refused (a breakdown that doesn't add up)", !r.ok && /23514/.test(r.e), r.e);
  r = await ins(db, { request_id: "paypal:CAP-BAD2", usd: "10.00", gross_usd: "10.00", fee_usd: "0.84" });
  expect("usd = gross (the older app's bug: crediting gross) is refused", !r.ok && /23514/.test(r.e), r.e);
  r = await ins(db, { request_id: "paypal:CAP-BAD3", usd: "9.16" });
  expect("a paypal: row without gross/fee is refused", !r.ok && /23514/.test(r.e), r.e);
  r = await ins(db, { request_id: "paypal:CAP-BAD4", usd: "9.16", gross_usd: "10.00" });
  expect("a paypal: row with gross but no fee is refused", !r.ok && /23514/.test(r.e), r.e);
  r = await ins(db, { request_id: "paypal:CAP-BAD5", usd: "10.50", gross_usd: "10.00", fee_usd: "-0.50" });
  expect("fee_usd < 0 is refused", !r.ok && /23514/.test(r.e), r.e);
  r = await ins(db, { request_id: "paypal:CAP-BAD6", usd: "0", gross_usd: "0.84", fee_usd: "0.84" });
  expect("usd = 0 is refused (usd > 0)", !r.ok && /23514/.test(r.e), r.e);
  r = await ins(db, { kind: "call", request_id: "paypal:CAP-BAD7", usd: "9.16", gross_usd: "10.00", fee_usd: "0.84" });
  expect("a paypal: row of kind 'call' is refused", !r.ok && /23514/.test(r.e), r.e);
  r = await ins(db, { kind: "refund", request_id: "paypal:CAP-BAD8", usd: "9.16", gross_usd: "10.00", fee_usd: "0.84" });
  expect("a paypal: row of kind 'refund' is refused (paypal: rows are credits)", !r.ok && /23514/.test(r.e), r.e);
  r = await ins(db, { request_id: "paypal:CAP-FEE0", usd: "10.00", gross_usd: "10.00", fee_usd: "0.00" });
  expect("a zero fee (fee_usd >= 0) is accepted", r.ok, r.e);
  // "set exactly when request_id starts with paypal:" — the other direction.
  r = await ins(db, { kind: "credit", request_id: null, usd: "5", gross_usd: "5.00", fee_usd: "0.00" });
  expect("§ 17.3 'set EXACTLY when paypal:': a non-paypal credit carrying gross/fee is refused", !r.ok && /23514/.test(r.e), r.ok ? "accepted" : r.e);
  r = await ins(db, { kind: "call", request_id: "gen-123", usd: "0.01", gross_usd: "0.01", fee_usd: "0.00" });
  expect("§ 17.3 'set EXACTLY when paypal:': a call row carrying gross/fee is refused", !r.ok && /23514/.test(r.e), r.ok ? "accepted" : r.e);
  r = await ins(db, { kind: "refund", request_id: "paypal-refund:R1x", usd: "1", fee_usd: "0.10" });
  expect("§ 17.3 'set EXACTLY when paypal:': a refund row carrying fee_usd is refused", !r.ok && /23514/.test(r.e), r.ok ? "accepted" : r.e);
  r = await ins(db, { kind: "call", request_id: "gen-124", usd: "0.01", gross_usd: "0.01" });
  expect("§ 17.10(6) either column alone on another row is refused (gross only, on a call)", !r.ok && /23514/.test(r.e), r.ok ? "accepted" : r.e);
  r = await ins(db, { kind: "credit", request_id: null, usd: "5", fee_usd: "0.00" });
  expect("§ 17.10(6) either column alone on another row is refused (fee only, on a starter credit)", !r.ok && /23514/.test(r.e), r.ok ? "accepted" : r.e);
  // case/lookalike: the prefix is literal
  r = await ins(db, { request_id: "PAYPAL:CAP-X", usd: "9.16" });
  note("'PAYPAL:' (upper case) with no breakdown", r.ok ? "accepted (not the paypal: prefix)" : r.e);
  // existing checks survive the migration
  r = await svc(db, "insert into public.ten_usage_ledger (user_id, kind, usd) values ($1,'bogus',1)", [A]);
  expect("the widened kind check still refuses an unknown kind", !r.ok && /23514/.test(r.e), r.e);
  r = await svc(db, "insert into public.ten_usage_ledger (user_id, kind, usd) values ($1,'credit',-1)", [A]);
  expect("usd >= 0 still enforced", !r.ok && /23514/.test(r.e), r.e);
  r = await ins(db, { request_id: "paypal:CAP-HALFCENT", usd: "9.165", gross_usd: "10.005", fee_usd: "0.840" });
  note("a sub-cent gross (numeric(12,2) rounds gross to 10.01, usd keeps 9.165)", r.ok ? "accepted" : r.e);
}

// ---- 3. users can't insert, update or delete ledger rows (paid or not)
{
  const db = DB;
  let r = await as(db, A, "authenticated", "insert into public.ten_usage_ledger (user_id, kind, request_id, usd, gross_usd, fee_usd) values ($1,'credit','paypal:SELF',9.16,10,0.84)", [A]);
  expect("§ 17.8(7) a member cannot insert a paypal: credit", !r.ok && /42501/.test(r.e), r.e);
  r = await as(db, A, "authenticated", "insert into public.ten_usage_ledger (user_id, kind, usd) values ($1,'credit',100)", [A]);
  expect("a member cannot insert any credit", !r.ok && /42501/.test(r.e), r.e);
  r = await as(db, A, "authenticated", "insert into public.ten_usage_ledger (user_id, kind, usd) values ($1,'refund',1)", [A]);
  expect("a member cannot insert a refund", !r.ok && /42501/.test(r.e), r.e);
  r = await as(db, null, "anon", "insert into public.ten_usage_ledger (user_id, kind, usd) values ($1,'credit',100)", [A]);
  expect("anon cannot insert", !r.ok && /42501/.test(r.e), r.e);
  r = await as(db, A, "authenticated", "update public.ten_usage_ledger set usd = 1000 where user_id = $1 returning id", [A]);
  expect("a member cannot raise their own credit", !r.ok || r.rows.length === 0, r.rows ?? r.e);
  r = await as(db, A, "authenticated", "delete from public.ten_usage_ledger where user_id = $1 returning id", [A]);
  expect("a member cannot delete their own ledger rows", !r.ok || r.rows.length === 0, r.rows ?? r.e);
  r = await as(db, A, "authenticated", "select request_id, usd::text, gross_usd::text, fee_usd::text from public.ten_usage_ledger where request_id = 'paypal:CAP-OK'");
  note("A reads their own paypal row (select-own policy)", r.rows ?? r.e);
  r = await as(db, B, "authenticated", "select count(*)::int n from public.ten_usage_ledger where user_id = $1", [A]);
  expect("B reads none of A's paid rows", r.ok && r.rows[0].n === 0, r.rows ?? r.e);
}

// ---- 4. § 17.5 a refund lowers ten_balance(), not ten_beta_spend_today(); membership unchanged
{
  const db = DB;
  const bal = async (uid) => Number((await as(db, uid, "authenticated", "select public.ten_balance() b")).rows[0].b);
  const spend = async () => Number((await svc(db, "select public.ten_beta_spend_today() s")).rows[0].s);
  const mem = async (uid) => (await as(db, uid, "authenticated", "select public.ten_is_member() m")).rows[0].m;
  // B, fresh: section 2's loosely-accepted rows sit on A.
  await svc(db, "insert into public.ten_usage_ledger (user_id, kind, usd) values ($1,'credit',5)", [B]);
  await ins(db, { user_id: B, request_id: "paypal:CAP-B1", usd: "18.93", gross_usd: "20.00", fee_usd: "1.07" });
  await svc(db, "insert into public.ten_usage_ledger (user_id, kind, request_id, usd) values ($1,'call','gen-r8-1',0.25)", [B]);
  const b0 = await bal(B), s0 = await spend();
  note("B's balance before the refund (5 + 18.93 - 0.25)", b0);
  expect("balance counts the paid NET credit", Math.abs(b0 - (5 + 18.93 - 0.25)) < 1e-9, b0);
  const r = await svc(db, "insert into public.ten_usage_ledger (user_id, kind, request_id, usd) values ($1,'refund','paypal-refund:REF-1',9.16)", [B]);
  expect("the owner's refund row (kind refund, paypal-refund:<id>, no breakdown) is accepted", r.ok, r.e);
  const b1 = await bal(B), s1 = await spend();
  expect("§ 17.8(7) a refund lowers ten_balance() by its amount", Math.abs(b0 - 9.16 - b1) < 1e-9, { b0, b1 });
  expect("§ 17.8(7) a refund does not change ten_beta_spend_today()", s1 === s0, { s0, s1 });
  expect("a refund does not change membership", (await mem(B)) === true);
  const bf = Number((await svc(db, "select public.ten_balance_for($1) b", [B])).rows[0].b);
  expect("ten_balance_for (the proxy's read) agrees", Math.abs(bf - b1) < 1e-9, bf);
}

// ---- 5. the teardown refuses while paid rows exist; runs once they're exported and removed
{
  const db = DB;
  await db.exec("begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id='ten-workspaces'; delete from storage.buckets where id='ten-workspaces'; commit;");
  let t = await run(db, TEAR);
  expect("§ 17.3 the teardown refuses while paypal: rows exist", !t.ok && /paypal/.test(t.e), t.e);
  const still = (await db.query("select count(*)::int n from public.ten_usage_ledger")).rows[0].n;
  expect("the refused teardown rolled back whole (ledger intact)", still > 0, still);
  await db.exec("delete from public.ten_usage_ledger where request_id like 'paypal:%'");
  t = await run(db, TEAR);
  expect("the teardown still refuses while a paypal-refund: row exists", !t.ok && /paypal/.test(t.e), t.e);
  await db.exec("delete from public.ten_usage_ledger where request_id like 'paypal-refund:%'");
  t = await run(db, TEAR);
  expect("with paid rows exported and removed, the teardown runs after all four migrations", t.ok, t.e);
  const left = (await db.query(
    "select (select count(*) from pg_policy where polname like 'ten\\_%')::int p, (select count(*) from pg_proc where proname like 'ten\\_%')::int f, (select count(*) from pg_class where relname like 'ten\\_%')::int c",
  )).rows[0];
  expect("nothing ten_ remains", left.p === 0 && left.f === 0 && left.c === 0, left);
}

// ---- 6. the files' own promises
expect("one transaction", /^\s*begin;/m.test(MIG4) && /^\s*commit;\s*$/m.test(MIG4));
expect("3 s lock timeout", MIG4.includes("set local lock_timeout = '3s'"));
expect("no function or policy change (§ 17.3)", !/create\s+(or\s+replace\s+)?function|create\s+policy|alter\s+policy|grant\s/i.test(MIG4.replace(/--.*$/gm, "")));
expect("the teardown header names all four migration files", ["20260923000000_ten_beta_init.sql", "20260924000000_ten_ledger_finish_reason.sql", "20260924100000_ten_conversations.sql", "20260925000000_ten_paypal_credit.sql"].every((f) => TEAR.slice(0, 1600).includes(f)));
expect("§ 17.3 no payer name or email column", !/payer|email|name\b/i.test(MIG4.replace(/--.*$/gm, "").replace(/constraint\s+\w+/gi, "").replace(/column_name|tablename|schemaname|table_name|table_schema/g, "")));

console.log(`\nr8 (paypal migration) failures: ${fails}`);
if (fails) { console.log("failed:\n  " + failed.join("\n  ")); process.exitCode = 1; }
