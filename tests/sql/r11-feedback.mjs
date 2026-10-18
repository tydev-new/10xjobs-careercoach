// docs/design-feedback.md § 17.3 (SQL): the SIXTH migration,
// 20261017000000_ten_feedback.sql, applied AFTER the five applied ones on the
// same PGlite stand-in (stub.sql).
//   node r11-feedback.mjs
// (r10 is taken by the welcome tester's file; this is the feedback file the
// design calls "r10-feedback".) PGlite is one connection, so item 22 (the
// settings row is locked `for update` before any count) is checked by reading
// the function's body, the README's stated limit; every other item runs.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const WT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const MIGS = [
  "20260923000000_ten_beta_init.sql",
  "20260924000000_ten_ledger_finish_reason.sql",
  "20260924100000_ten_conversations.sql",
  "20260925000000_ten_paypal_credit.sql",
  "20261002000000_ten_welcome_credit.sql",
].map((f) => readFileSync(`${WT}/supabase/migrations/${f}`, "utf8"));
const FB_NAME = "20261017000000_ten_feedback.sql";
const FB = readFileSync(`${WT}/supabase/migrations/${FB_NAME}`, "utf8");
const TEAR = readFileSync(`${WT}/supabase/teardown/ten_beta_teardown.sql`, "utf8");
const STUB = readFileSync(new URL("./stub.sql", import.meta.url), "utf8");

let fails = 0;
const failed = [];
const out = (t, m, d = "") => console.log(`[${t}] ${m}${d !== "" && d !== undefined ? "  -> " + (typeof d === "string" ? d : JSON.stringify(d)) : ""}`);
const expect = (m, c, d) => { out(c ? "PASS" : "FAIL", m, d); if (!c) { fails++; failed.push(m); } };

async function run(db, sql) { try { await db.exec(sql); return { ok: true }; } catch (e) { try { await db.exec("rollback"); } catch {} return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } }
async function as(db, role, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role })]);
  await db.exec(`set role ${role}`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } finally { await db.exec("reset role"); }
}
const svc = (db, sql, p) => as(db, "service_role", sql, p);
const sup = async (db, sql, p = []) => { await db.exec("reset role"); return (await db.query(sql, p)).rows; };
const supTry = async (db, sql, p = []) => { await db.exec("reset role"); try { return { ok: true, rows: (await db.query(sql, p)).rows }; } catch (e) { return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } };

async function fresh({ withFeedback = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  for (const m of MIGS) await db.exec(m);
  if (withFeedback) await db.exec(FB);
  return db;
}

const ID_A = "a".repeat(32);
const ID_B = "b".repeat(32);
const SQL_ADD = "select public.ten_feedback_add($1, $2, $3::smallint, $4, $5, $6, $7, $8) as r";
const good = (o = {}) => ({ kind: "comment", comment: "hello", rating: null, skill: "", step: "", version: "0.9.2", host: "local", id: null, ...o });
const args = (o) => [o.kind, o.comment, o.rating, o.skill, o.step, o.version, o.host, o.id];
async function add(db, o = {}) {
  const r = await svc(db, SQL_ADD, args(good(o)));
  return r.ok ? { ok: true, status: r.rows[0].r.status, r: r.rows[0].r } : r;
}
const count = async (db) => (await sup(db, "select count(*)::int n from public.ten_feedback"))[0].n;
const setting = (db, set) => sup(db, `update public.ten_feedback_settings set ${set}`);
const backdate = (db, interval) => sup(db, `update public.ten_feedback set created_at = created_at - interval '${interval}'`);

// ---- 0. apply, the objects it adds, the order guard
{
  let db = await fresh({ withFeedback: false });
  const snap = async () => ({
    tables: (await sup(db, "select tablename from pg_tables where schemaname='public' and tablename like 'ten\\_%'")).map((x) => x.tablename),
    funcs: (await sup(db, "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'ten\\_%'")).map((x) => x.proname),
    pols: (await sup(db, "select count(*)::int n from pg_policies"))[0].n,
    trig: (await sup(db, "select count(*)::int n from pg_trigger where not tgisinternal"))[0].n,
    ledgerCols: (await sup(db, "select count(*)::int n from information_schema.columns where table_name = 'ten_usage_ledger'"))[0].n,
  });
  const before = await snap();
  let r = await run(db, FB);
  expect("the sixth migration applies after the five applied ones", r.ok, r.e);
  const after = await snap();
  const newTables = after.tables.filter((t) => !before.tables.includes(t)).sort();
  const newFuncs = after.funcs.filter((t) => !before.funcs.includes(t)).sort();
  expect("it adds exactly two tables", JSON.stringify(newTables) === JSON.stringify(["ten_feedback", "ten_feedback_settings"]), newTables);
  expect("it adds exactly one function", JSON.stringify(newFuncs) === JSON.stringify(["ten_feedback_add"]), newFuncs);
  expect("it touches no existing object: same policies, same triggers, same ledger columns, no existing table or function removed",
    after.pols === before.pols && after.trig === before.trig && after.ledgerCols === before.ledgerCols
    && before.tables.every((t) => after.tables.includes(t)) && before.funcs.every((t) => after.funcs.includes(t)), { before, after });
  r = await run(db, FB);
  expect("a second apply is refused by the order guard", !r.ok && /already exists/.test(r.e), r.e);
  expect("a refused apply changes nothing", JSON.stringify(await snap()) === JSON.stringify(after));

  // the guard refuses on EACH of its own objects (and leaves nothing behind)
  for (const [label, seed, leftover] of [
    ["ten_feedback", "create table public.ten_feedback (x int)", "ten_feedback_settings"],
    ["ten_feedback_settings", "create table public.ten_feedback_settings (x int)", "ten_feedback"],
    ["ten_feedback_add", "create function public.ten_feedback_add() returns int language sql as $$ select 1 $$", "ten_feedback"],
  ]) {
    const d = await fresh({ withFeedback: false });
    await d.exec(seed);
    const rr = await run(d, FB);
    expect(`the order guard refuses when ${label} already exists`, !rr.ok && /already exists/.test(rr.e), rr.e);
    expect(`...and the refused apply created nothing (no ${leftover})`, (await sup(d, "select count(*)::int n from pg_tables where tablename = $1", [leftover]))[0].n === 0);
  }

  db = await fresh();
  const cols = (await sup(db, "select column_name from information_schema.columns where table_schema='public' and table_name='ten_feedback' order by ordinal_position")).map((c) => c.column_name);
  expect("the notes table has exactly the ten columns of § 10.1, in order",
    JSON.stringify(cols) === JSON.stringify(["id", "created_at", "kind", "comment", "rating", "skill", "step", "version", "host", "installation_id"]), cols);
  expect("no user id, email, address, user agent or origin column can exist", !cols.some((c) => /user|email|addr|ip|agent|origin|account/.test(c)), cols);
  const scols = (await sup(db, "select column_name from information_schema.columns where table_schema='public' and table_name='ten_feedback_settings' order by ordinal_position")).map((c) => c.column_name);
  expect("the settings table has the six columns of § 10.2", JSON.stringify(scols) === JSON.stringify(["id", "open", "per_install_per_hour", "all_per_hour", "all_per_day", "max_rows"]), scols);
  const s = await sup(db, "select * from public.ten_feedback_settings");
  expect("the settings row ships open: true, 10, 60, 300, 5000, and it is the only row",
    s.length === 1 && s[0].id === true && s[0].open === true && s[0].per_install_per_hour === 10 && s[0].all_per_hour === 60 && s[0].all_per_day === 300 && s[0].max_rows === 5000, s);
  const f = (await sup(db, "select prosecdef, proconfig, pg_get_userbyid(proowner) = current_user as mine, prorettype::regtype::text as ret from pg_proc where proname = 'ten_feedback_add'"))[0];
  expect("ten_feedback_add: security definer, search_path '', returns jsonb, owned by the applying role",
    f.prosecdef && f.proconfig?.some((c) => c === 'search_path=""' || /^search_path=("")?$/.test(c)) && f.mine && f.ret === "jsonb", f);
  const idx = (await sup(db, "select indexdef from pg_indexes where tablename = 'ten_feedback' and indexname <> 'ten_feedback_pkey'")).map((x) => x.indexdef);
  expect("indexes on created_at and on (installation_id, created_at) where the id is not null",
    idx.some((d) => /\(created_at\)$/.test(d)) && idx.some((d) => /\(installation_id, created_at\)/.test(d) && /WHERE \(installation_id IS NOT NULL\)/i.test(d)), idx);
}

// ---- 17. a send as the service role
{
  const db = await fresh();
  const r = await add(db, { kind: "bug", comment: "the letter check keeps flagging dates that are right", rating: 4, skill: "apply", step: "Tailoring", version: "0.9.2", host: "local", id: ID_A });
  expect("as the service role, ten_feedback_add -> sent", r.ok && r.status === "sent" && Object.keys(r.r).join() === "status", r);
  const rows = await sup(db, "select kind, comment, rating, skill, step, version, host, installation_id, created_at, id from public.ten_feedback");
  expect("exactly one row, with every value as sent", rows.length === 1 && rows[0].kind === "bug" && rows[0].rating === 4 && rows[0].skill === "apply" && rows[0].step === "Tailoring"
    && rows[0].installation_id === ID_A && rows[0].host === "local" && rows[0].version === "0.9.2" && rows[0].created_at && rows[0].id, rows);
  const w = await add(db, { kind: "comment", comment: "", rating: 5, host: "web", version: "web-1a2b3c", id: null });
  expect("a web note (rating only, no id) -> sent", w.ok && w.status === "sent", w);
  expect("two rows now", (await count(db)) === 2);
}

// ---- 18. nobody else can use either table or the function
{
  const db = await fresh();
  await add(db);
  for (const role of ["anon", "authenticated"]) {
    const ex = await as(db, role, SQL_ADD, args(good()));
    expect(`${role} cannot execute ten_feedback_add (42501)`, !ex.ok && /^42501/.test(ex.e), ex.e);
    for (const table of ["ten_feedback", "ten_feedback_settings"]) {
      for (const [verb, sql] of [
        ["select", `select * from public.${table}`],
        ["insert", table === "ten_feedback"
          ? "insert into public.ten_feedback (kind, comment, version, host) values ('comment', 'x', '1', 'local')"
          : "insert into public.ten_feedback_settings (id) values (false)"],
        ["update", table === "ten_feedback" ? "update public.ten_feedback set comment = 'y'" : "update public.ten_feedback_settings set open = false"],
        ["delete", `delete from public.${table}`],
      ]) {
        const x = await as(db, role, sql);
        expect(`${role} cannot ${verb} ${table} (42501)`, !x.ok && /^42501/.test(x.e), x.e);
      }
    }
  }
  const p = (await sup(db, `select
      has_table_privilege('anon', 'public.ten_feedback', 'insert') a1,
      has_table_privilege('authenticated', 'public.ten_feedback', 'select') a2,
      has_function_privilege('anon', 'public.ten_feedback_add(text,text,smallint,text,text,text,text,text)', 'execute') a3,
      has_function_privilege('authenticated', 'public.ten_feedback_add(text,text,smallint,text,text,text,text,text)', 'execute') a4,
      has_function_privilege('service_role', 'public.ten_feedback_add(text,text,smallint,text,text,text,text,text)', 'execute') a5`))[0];
  expect("the owner's read-only check of § 16.1 step 2 reads false, false, false (and the service role can execute)", p.a1 === false && p.a2 === false && p.a3 === false && p.a4 === false && p.a5 === true, p);
  const rls = await sup(db, "select relname, relrowsecurity from pg_class where relname in ('ten_feedback', 'ten_feedback_settings') order by 1");
  expect("RLS is on for both tables", rls.length === 2 && rls.every((x) => x.relrowsecurity), rls);
  expect("and neither table has a policy", (await sup(db, "select count(*)::int n from pg_policies where tablename in ('ten_feedback', 'ten_feedback_settings')"))[0].n === 0);
  const read = await svc(db, "select count(*)::int n from public.ten_feedback");
  expect("the service role can still read the table", read.ok && read.rows[0].n === 1, read);
}

// ---- 19. each check of § 10.1 refuses its bad value, directly and through the function
{
  const db = await fresh();
  const base = good({ id: null });
  const bad = [
    ["kind outside bug/comment", { kind: "praise" }, "ten_feedback_kind"],
    ["a comment of 2,001 characters", { comment: "x".repeat(2001) }, "ten_feedback_comment"],
    ["a rating of 0", { rating: 0 }, "ten_feedback_rating"],
    ["a rating of 6", { rating: 6 }, "ten_feedback_rating"],
    ["an upper-case skill", { skill: "Apply" }, "ten_feedback_skill"],
    ["a skill starting with a digit", { skill: "1apply" }, "ten_feedback_skill"],
    ["a skill of 31 characters", { skill: "a".repeat(31) }, "ten_feedback_skill"],
    ["a skill with an underscore", { skill: "job_search" }, "ten_feedback_skill"],
    ["a step of 61 characters", { step: "x".repeat(61) }, "ten_feedback_step"],
    ["a step with @", { step: "a@b" }, "ten_feedback_step"],
    ["a step with /", { step: "a/b" }, "ten_feedback_step"],
    ["a step with a backslash", { step: "a\\b" }, "ten_feedback_step"],
    ["a step with a line break", { step: "a\nb" }, "ten_feedback_step"],
    ["a step with a carriage return", { step: "a\rb" }, "ten_feedback_step"],
    ["an empty version", { version: "" }, "ten_feedback_version"],
    ["a version of 41 characters", { version: "v".repeat(41) }, "ten_feedback_version"],
    ["a version with a space", { version: "1 0" }, "ten_feedback_version"],
    ["a version with an underscore", { version: "1_0" }, "ten_feedback_version"],
    ["a host outside local/web", { host: "mobile" }, "ten_feedback_host"],
    ["an upper-case install id", { id: "A".repeat(32) }, "ten_feedback_installation"],
    ["an install id of 31 characters", { id: "a".repeat(31) }, "ten_feedback_installation"],
    ["a non-hex install id", { id: "g".repeat(32) }, "ten_feedback_installation"],
    ["a bug with no words", { kind: "bug", comment: "", rating: 3 }, "ten_feedback_bug_words"],
    ["no words and no rating", { comment: "", rating: null }, "ten_feedback_words"],
  ];
  for (const [label, over, name] of bad) {
    const o = { ...base, ...over };
    const direct = await supTry(db,
      "insert into public.ten_feedback (kind, comment, rating, skill, step, version, host, installation_id) values ($1, $2, $3::smallint, $4, $5, $6, $7, $8)", args(o));
    expect(`direct insert: ${label} is refused by ${name} (23514)`, !direct.ok && /^23514/.test(direct.e) && direct.e.includes(name), direct.e);
    const viaFn = await add(db, o);
    expect(`through the function: ${label} raises, not a status`, !viaFn.ok && /^23514/.test(viaFn.e), viaFn);
  }
  expect("none of them wrote a row", (await count(db)) === 0);
  // and the boundary values are accepted
  for (const [label, over] of [
    ["a comment of exactly 2,000 characters", { comment: "x".repeat(2000) }],
    ["a rating of 1", { rating: 1, comment: "" }],
    ["a rating of 5", { rating: 5, comment: "" }],
    ["a skill of exactly 30 characters", { skill: "a" + "b".repeat(29) }],
    ["a hyphenated skill", { skill: "job-search" }],
    ["an empty skill and step", { skill: "", step: "" }],
    ["a step of exactly 60 characters", { step: "x".repeat(60) }],
    ["a version of exactly 40 characters", { version: "1".repeat(40) }],
    ["a version with . + -", { version: "1.2.3-rc.1+b5" }],
    ["a web note with no id", { host: "web", id: null }],
    ["a web note with an opaque browser id (owner ruling 2026-10-17: same as the local id)", { host: "web", id: ID_A }],
    ["a local note with no id", { host: "local", id: null }],
    ["a comment note with a rating and words", { rating: 3 }],
  ]) {
    const d = await fresh();
    const r = await add(d, { ...base, ...over });
    expect(`accepted: ${label}`, r.ok && r.status === "sent", r);
  }
}

// ---- 20. the limits
{
  // per install: the 11th send from one id in an hour is limited; another id still sends
  let db = await fresh();
  let sent = 0;
  for (let i = 0; i < 10; i++) if ((await add(db, { id: ID_A })).status === "sent") sent++;
  expect("at the shipped settings, the first 10 sends from one id are sent", sent === 10);
  let r = await add(db, { id: ID_A });
  expect("the 11th send from the same id in an hour -> limited", r.ok && r.status === "limited", r);
  expect("...and writes no row", (await count(db)) === 10);
  r = await add(db, { id: ID_B });
  expect("another id still gets sent", r.ok && r.status === "sent", r);
  r = await add(db, { host: "web", id: null });
  expect("a send with no id (the web) is not held by the per-install limit", r.ok && r.status === "sent", r);
  await backdate(db, "2 hours");
  r = await add(db, { id: ID_A });
  expect("a row back-dated past the hour no longer counts against the id", r.ok && r.status === "sent", r);

  // all_per_hour
  db = await fresh();
  await setting(db, "all_per_hour = 3");
  const ids = ["1", "2", "3", "4"].map((c) => c.repeat(32));
  for (let i = 0; i < 3; i++) await add(db, { id: ids[i] });
  r = await add(db, { id: ids[3] });
  expect("all_per_hour reached -> limited, whatever new id is invented", r.status === "limited", r);
  expect("...and writes no row", (await count(db)) === 3);
  await backdate(db, "2 hours");
  r = await add(db, { id: ids[3] });
  expect("rows back-dated past the hour no longer count toward all_per_hour", r.status === "sent", r);

  // all_per_day
  db = await fresh();
  await setting(db, "all_per_day = 3");
  for (let i = 0; i < 3; i++) await add(db, { id: ids[i] });
  await backdate(db, "2 hours"); // out of the hour window, inside the day
  r = await add(db, { id: ids[3] });
  expect("all_per_day reached (rows 2 hours old) -> limited", r.status === "limited", r);
  expect("...and writes no row", (await count(db)) === 3);
  await backdate(db, "23 hours"); // now 25 hours old
  r = await add(db, { id: ids[3] });
  expect("rows older than 24 hours no longer count toward all_per_day", r.status === "sent", r);

  // max_rows: rows count however old they are
  db = await fresh();
  await setting(db, "max_rows = 2");
  await add(db, { id: ids[0] });
  await add(db, { id: ids[1] });
  await backdate(db, "40 days");
  r = await add(db, { id: ids[2] });
  expect("max_rows reached (rows 40 days old) -> limited", r.status === "limited", r);
  expect("...and writes no row", (await count(db)) === 2);
  await sup(db, "delete from public.ten_feedback where installation_id = $1", [ids[0]]);
  r = await add(db, { id: ids[2] });
  expect("the owner deleting a read row makes room", r.status === "sent", r);

  // open = false
  db = await fresh();
  await setting(db, "open = false");
  r = await add(db, { id: ID_A });
  expect("open = false -> closed", r.ok && r.status === "closed", r);
  expect("...and writes no row", (await count(db)) === 0);
  await setting(db, "open = true");
  r = await add(db, { id: ID_A });
  expect("open = true again -> sent, no deploy", r.status === "sent", r);

  // zero limits close their door
  for (const [col, id] of [["per_install_per_hour", ID_A], ["all_per_hour", ID_A], ["all_per_day", ID_A], ["max_rows", ID_A]]) {
    const d = await fresh();
    await setting(d, `${col} = 0`);
    const x = await add(d, { id });
    expect(`${col} = 0 -> limited`, col === "per_install_per_hour" ? x.status === "limited" : x.status === "limited", x);
  }

  // a deleted settings row fails closed
  db = await fresh();
  await sup(db, "delete from public.ten_feedback_settings");
  r = await add(db, { id: ID_A });
  expect("a deleted settings row fails closed", r.ok && r.status === "closed", r);
  expect("...and writes no row", (await count(db)) === 0);

  // order of checks: closed beats limited
  db = await fresh();
  await setting(db, "open = false, max_rows = 0");
  r = await add(db);
  expect("closed is answered before limited", r.status === "closed", r);
}

// ---- 21. the settings row
{
  const db = await fresh();
  let r = await supTry(db, "insert into public.ten_feedback_settings (id) values (true)");
  expect("a second row (same key) is refused", !r.ok && /^23505/.test(r.e), r.e);
  r = await supTry(db, "insert into public.ten_feedback_settings (id) values (false)");
  expect("a row with id false is refused by the one-row check", !r.ok && /^23514/.test(r.e) && r.e.includes("ten_feedback_settings_one_row"), r.e);
  for (const [col, lo, hi] of [["per_install_per_hour", 100, 100], ["all_per_hour", 1000, 1000], ["all_per_day", 10000, 10000], ["max_rows", 50000, 50000]]) {
    for (const v of [-1, hi + 1]) {
      const x = await supTry(db, `update public.ten_feedback_settings set ${col} = ${v}`);
      expect(`${col} = ${v} is refused`, !x.ok && /^23514/.test(x.e), x.e);
    }
    for (const v of [0, hi]) {
      const x = await supTry(db, `update public.ten_feedback_settings set ${col} = ${v}`);
      expect(`${col} = ${v} is accepted`, x.ok, x.e);
    }
    await supTry(db, `update public.ten_feedback_settings set ${col} = ${col === "max_rows" ? 5000 : col === "all_per_day" ? 300 : col === "all_per_hour" ? 60 : 10}`);
  }
  r = await supTry(db, "update public.ten_feedback_settings set open = null");
  expect("open cannot be null", !r.ok && /^23502/.test(r.e), r.e);
}

// ---- 22. the lock, by reading the function (PGlite runs one connection)
{
  const m = FB.match(/create function public\.ten_feedback_add[\s\S]*?end \$\$;/);
  const body = m[0].replace(/--.*$/gm, "");
  const lock = body.search(/for update/i);
  const firstCount = body.search(/count\(\*\)/i);
  const firstInsert = body.search(/insert into/i);
  expect("the settings row is selected `for update`", lock > 0 && /from public\.ten_feedback_settings/.test(body.slice(0, lock)));
  expect("the lock comes before any count and before the insert", lock < firstCount && lock < firstInsert, { lock, firstCount, firstInsert });
  expect("the counts are all of the table itself (no counter outside the rows)", !/ten_feedback_counters|pg_advisory|set_config/i.test(body));
  expect("every name in the function is schema-qualified (search_path is empty)", !/\b(from|into|update|join)\s+(?!public\.)ten_/i.test(body));
}

// ---- 23. the file's own promises, the teardown
{
  const code = FB.replace(/--.*$/gm, "");
  expect("one transaction", /^\s*begin;/m.test(FB) && /^\s*commit;\s*$/m.test(FB));
  expect("3 s lock timeout", FB.includes("set local lock_timeout = '3s'"));
  expect("no policy, no trigger, nothing on auth.users, nothing existing altered or dropped",
    !/create\s+policy|create\s+trigger|auth\.users|drop\s+(table|function)|alter\s+table\s+(?!public\.ten_feedback(_settings)?\s+enable)/i.test(code));
  expect("the header carries the owner queries of § 16.3 and the reload line",
    FB.includes("order by created_at desc limit 100") && FB.includes("group by 1, 2, 3 order by 1 desc") && FB.includes("set open = false") && FB.includes("delete from public.ten_feedback where created_at <") && FB.includes("NOTIFY pgrst, 'reload schema'"));
  expect("it ships open, with the shipped limits as the column defaults", /open\s+boolean not null default true/.test(code) && /per_install_per_hour integer not null default 10/.test(code) && /all_per_hour\s+integer not null default 60/.test(code) && /all_per_day\s+integer not null default 300/.test(code) && /max_rows\s+integer not null default 5000/.test(code));

  const db = await fresh();
  await add(db);
  await db.exec("begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id='ten-workspaces'; delete from storage.buckets where id='ten-workspaces'; commit;");
  const t = await run(db, TEAR);
  expect("the teardown runs after all six migrations", t.ok, t.e);
  const left = (await sup(db,
    "select (select count(*) from pg_policy where polname like 'ten\\_%')::int p, (select count(*) from pg_proc where proname like 'ten\\_%')::int f, (select count(*) from pg_class where relname like 'ten\\_%')::int c"))[0];
  expect("nothing ten_ remains: both feedback tables and the function are gone", left.p === 0 && left.f === 0 && left.c === 0, left);
  expect("the teardown header names the sixth file and its three objects",
    TEAR.slice(0, 2600).includes(FB_NAME) && ["ten_feedback", "ten_feedback_settings", "ten_feedback_add"].every((n) => TEAR.slice(0, 2600).includes(n)));
  const old = await fresh({ withFeedback: false });
  await old.exec("begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id='ten-workspaces'; delete from storage.buckets where id='ten-workspaces'; commit;");
  const t2 = await run(old, TEAR);
  expect("the teardown also runs when the feedback migration was never applied", t2.ok, t2.e);
}

console.log(`\nr11 (feedback migration) failures: ${fails}`);
if (fails) { console.log("failed:\n  " + failed.join("\n  ")); process.exitCode = 1; }
