// Tester-owned: docs/design-web-agent.md § 9.6 (amended 2026-09-24) — the
// SECOND migration, 20260924000000_ten_ledger_finish_reason.sql, applied
// AFTER the applied 20260923000000_ten_beta_init.sql ("The SQL harness
// applies both files in order"), on the same PGlite stand-in as the other
// runners. § 9.8 (vi): "the column is nullable and refuses 33 characters,
// and teardown leaves no ten_ object".
//   node r5-finish-reason.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const WT = new URL("../../", import.meta.url).pathname.replace(/\/$/, ""); // the repo root
const MIG1 = readFileSync(`${WT}/supabase/migrations/20260923000000_ten_beta_init.sql`, "utf8");
const MIG2 = readFileSync(`${WT}/supabase/migrations/20260924000000_ten_ledger_finish_reason.sql`, "utf8");
const TEAR = readFileSync(`${WT}/supabase/teardown/ten_beta_teardown.sql`, "utf8");
const STUB = readFileSync(new URL("./stub.sql", import.meta.url), "utf8");
const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "bbbbbbbb-0000-0000-0000-000000000002";
let fails = 0;
const out = (t, m, d = "") => console.log(`[${t}] ${m}${d !== "" && d !== undefined ? "  -> " + (typeof d === "string" ? d : JSON.stringify(d)) : ""}`);
const expect = (m, c, d) => { out(c ? "PASS" : "FAIL", m, d); if (!c) fails++; };
const note = (m, d) => out("OBSERVED", m, d);
async function fresh() { const db = new PGlite(); await db.exec(STUB); await db.exec(`insert into auth.users values ('${A}'),('${B}')`); return db; }
async function run(db, sql) { try { await db.exec(sql); return { ok: true }; } catch (e) { try { await db.exec("rollback"); } catch {} return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } }
async function as(db, uid, role, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [uid ? JSON.stringify({ sub: uid, role }) : ""]);
  await db.exec(`set role ${role}`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } finally { await db.exec("reset role"); }
}
// catalog: columns + constraints + everything run-r2.mjs snapshots
const CAT = `select 'col '||c.relname||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') v
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where n.nspname in ('public','storage','auth') and a.attnum>0 and not a.attisdropped
  union all select 'con '||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace in (select oid from pg_namespace where nspname in ('public','storage','auth'))
  union all select 'rel '||n.nspname||'.'||c.relname||':'||c.relkind::text||':'||coalesce(c.relacl::text,'')||':'||c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage','auth')
  union all select 'proc '||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','storage','auth')
  union all select 'pol '||schemaname||'.'||tablename||'.'||policyname||':'||coalesce(qual,'')||':'||coalesce(with_check,'') from pg_policies
  order by 1`;
const cat = async (db) => (await db.query(CAT)).rows.map((r) => r.v);

// ---- 1. order: the second file refuses to run before the first
{
  const db = await fresh();
  const r = await run(db, MIG2);
  expect("finish_reason migration before the init migration is refused", !r.ok && /apply 20260923000000_ten_beta_init\.sql first/.test(r.e), r.e);
}

// ---- 2. applied in order: one column, one constraint, nothing else
{
  const db = await fresh();
  const m1 = await run(db, MIG1); expect("init migration applies", m1.ok, m1.e);
  const before = await cat(db);
  const m2 = await run(db, MIG2); expect("finish_reason migration applies after it", m2.ok, m2.e);
  const after = await cat(db);
  const added = after.filter((x) => !before.includes(x)), removed = before.filter((x) => !after.includes(x));
  note("added", added);
  expect("nothing existing changed or removed", removed.length === 0, removed);
  expect("exactly: the column and its check", added.length === 2
    && added.some((x) => x === "col ten_usage_ledger.finish_reason:text:false:")
    && added.some((x) => /^con ten_usage_ledger\.ten_usage_ledger_finish_reason:CHECK \(\(\(finish_reason IS NULL\) OR \(char_length\(finish_reason\) <= 32\)\)\)$/.test(x)), added);

  const again = await run(db, MIG2);
  expect("a second run is refused by its guard", !again.ok && /already exists/.test(again.e), again.e);
  expect("the refused run changed nothing", JSON.stringify(await cat(db)) === JSON.stringify(after));

  // nullable; ≤ 32 chars; 33 refused (service role, the only writer)
  const ins = (rid, fr) => as(db, null, "service_role", "insert into public.ten_usage_ledger (user_id, kind, request_id, usd, finish_reason) values ($1,'call',$2,0.01,$3)", [A, rid, fr]);
  await as(db, null, "service_role", "insert into public.ten_usage_ledger (user_id, kind, usd) values ($1,'credit',5)", [A]);
  const nul = await ins("r-null", null); expect("null accepted", nul.ok, nul.e);
  const omitted = await as(db, null, "service_role", "insert into public.ten_usage_ledger (user_id, kind, request_id, usd) values ($1,'call','r-omit',0.01) returning finish_reason", [A]);
  expect("omitted -> null (no default, nullable)", omitted.ok && omitted.rows[0].finish_reason === null, omitted.rows ?? omitted.e);
  const len = await ins("r-length", "length"); expect("'length' accepted", len.ok, len.e);
  const b32 = await ins("r-32", "x".repeat(32)); expect("32 characters accepted", b32.ok, b32.e);
  const b33 = await ins("r-33", "x".repeat(33)); expect("33 characters refused by ten_usage_ledger_finish_reason", !b33.ok && /23514/.test(b33.e) && /ten_usage_ledger_finish_reason/.test(b33.e), b33.e);
  const mb = await ins("r-mb", "é".repeat(32)); expect("32 multibyte characters accepted (char_length, not bytes)", mb.ok, mb.e);
  const own = await as(db, A, "authenticated", "select request_id, finish_reason from public.ten_usage_ledger where kind='call' order by request_id");
  expect("a member reads their own finish_reason values", own.ok && own.rows.some((r) => r.finish_reason === "length"), own.rows ?? own.e);
  const other = await as(db, B, "authenticated", "select count(*)::int n from public.ten_usage_ledger");
  expect("another user still sees none of them", other.ok && other.rows[0].n === 0, other.rows ?? other.e);
  const userIns = await as(db, A, "authenticated", "insert into public.ten_usage_ledger (user_id, kind, usd, finish_reason) values ($1,'call',0,'stop')", [A]);
  expect("users still cannot insert ledger rows", !userIns.ok, userIns.e);
  const bal = await as(db, A, "authenticated", "select public.ten_balance() b");
  expect("the balance formula is untouched by the column", bal.ok && Math.abs(Number(bal.rows[0].b) - (5 - 0.01 * 5)) < 1e-9, bal.rows ?? bal.e);

  // ---- 3. teardown after both files: no ten_ object left
  const t0 = await run(db, TEAR); expect("teardown refuses before the Storage API step", !t0.ok && /Storage API first/.test(t0.e), t0.e);
  await db.exec("begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id='ten-workspaces'; delete from storage.buckets where id='ten-workspaces'; commit;");
  const t = await run(db, TEAR); expect("teardown runs after both migrations (triggers ON)", t.ok, t.e);
  const left = (await db.query("select (select count(*) from pg_policy where polname like 'ten\\_%')::int p, (select count(*) from pg_proc where proname like 'ten\\_%')::int f, (select count(*) from pg_class where relname like 'ten\\_%')::int c, (select count(*) from pg_constraint where conname like 'ten\\_%')::int k")).rows[0];
  expect("nothing ten_ remains (policies, functions, relations, constraints)", left.p === 0 && left.f === 0 && left.c === 0 && left.k === 0, left);
}

// ---- 4. the file's own promises
expect("3 s lock timeout", MIG2.includes("set local lock_timeout = '3s'"));
expect("one transaction", /^\s*begin;/m.test(MIG2) && /^\s*commit;\s*$/m.test(MIG2));
const stmts = MIG2.replace(/--.*$/gm, "").replace(/do \$\$[\s\S]*?\$\$;/g, "").split(";").map((s) => s.trim()).filter(Boolean);
const ddl = stmts.filter((s) => !/^(begin|commit|set local)/i.test(s));
expect("exactly one DDL statement, an alter table … add column", ddl.length === 1 && /^alter table public\.ten_usage_ledger\s+add column finish_reason text/i.test(ddl[0]), ddl);
expect("the teardown header names both migration files", TEAR.slice(0, 1200).includes("20260923000000_ten_beta_init.sql") && TEAR.slice(0, 1200).includes("20260924000000_ten_ledger_finish_reason.sql"));

console.log(`\nr5 (finish_reason migration) failures: ${fails}`);
if (fails) process.exitCode = 1;
