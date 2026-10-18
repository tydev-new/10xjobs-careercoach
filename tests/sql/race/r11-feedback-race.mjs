// Independent review (tester, 2026-10-17) of the feedback SQL, docs/design-feedback.md
// § 10 and § 11 (as amended 2026-10-17, 71991e0: a web note may carry a random id),
// run on REAL Postgres 17 (embedded-postgres: a local cluster in a temp dir,
// 127.0.0.1 only, deleted at the end). PGlite has one connection, so
// tests/sql/r11-feedback.mjs could only read the lock in the function body (§ 17.3
// item 22); this runs many connections at once against each limit.
//   cd tests/sql/race && npm ci && node r11-feedback-race.mjs
// Never touches a real project.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const WT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const MIG_DIR = `${WT}/supabase/migrations`;
const MIG_FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const FEEDBACK_FILE = "20261017000000_ten_feedback.sql";
const MIGS = MIG_FILES.map((f) => readFileSync(`${MIG_DIR}/${f}`, "utf8"));
const FEEDBACK = readFileSync(`${MIG_DIR}/${FEEDBACK_FILE}`, "utf8");
const TEARDOWN = readFileSync(`${WT}/supabase/teardown/ten_beta_teardown.sql`, "utf8");
const STUB = readFileSync(`${WT}/tests/sql/stub.sql`, "utf8");

let fails = 0;
const failed = [];
const out = (t, m, d) => console.log(`[${t}] ${m}${d === undefined ? "" : "  -> " + JSON.stringify(d)}`);
const expect = (m, c, d) => { out(c ? "PASS" : "FAIL", m, d); if (!c) { fails++; failed.push(m); } };
const observe = (m, d) => out("OBSERVED", m, d);

const PORT = 55000 + Math.floor(Math.random() * 900);
const dir = mkdtempSync(path.join(tmpdir(), "ten-fb-race-"));
const server = new EmbeddedPostgres({
  databaseDir: path.join(dir, "data"), user: "postgres", password: "race", port: PORT, persistent: false,
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "max_connections=200"],
});
const conn = async (db) => { const c = new pg.Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: "race", database: db }); await c.connect(); return c; };
async function as(db, role) { const c = await conn(db); await c.query(`set role ${role}`); return c; }
let dbn = 0;
async function freshDb() {
  const name = `fb_${++dbn}`;
  const admin = await conn("postgres");
  await admin.query(`create database ${name} encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  await admin.end();
  const c = await conn(name);
  // Supabase's databases are UTF8; a SQL_ASCII cluster (embedded-postgres' default) counts bytes, not characters
  const enc = (await c.query("select pg_encoding_to_char(encoding) e from pg_database where datname = current_database()")).rows[0].e;
  if (enc !== "UTF8") throw new Error(`database ${name} is ${enc}, not UTF8`);
  const roles = (await c.query("select count(*)::int n from pg_roles where rolname in ('anon','authenticated','service_role')")).rows[0].n;
  await c.query(roles === 3 ? STUB.replace(/^create role .*$/gm, "") : STUB);
  for (const m of MIGS) await c.query(m);
  return { name, admin: c };
}
const ID = (n) => n.toString(16).padStart(32, "0");
const ADD = "select public.ten_feedback_add($1, $2, $3::smallint, $4, $5, $6, $7, $8) r";
const args = (o = {}) => { const a = { kind: "comment", comment: "a note", rating: null, skill: "", step: "", version: "0.9.2", host: "local", id: null, ...o }; return [a.kind, a.comment, a.rating, a.skill, a.step, a.version, a.host, a.id]; };
const add = async (c, o) => (await c.query(ADD, args(o))).rows[0].r.status;
const rows = async (admin) => (await admin.query("select count(*)::int n from public.ten_feedback")).rows[0].n;
const set = (admin, s) => admin.query(`update public.ten_feedback_settings set ${s}`);
async function waitingOnLock(admin, pid) {
  for (let i = 0; i < 150; i++) {
    const r = await admin.query("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
    if (r.rows[0]?.wait_event_type === "Lock") return true;
    await new Promise((res) => setTimeout(res, 20));
  }
  return false;
}
async function errCode(p) { try { await p; return null; } catch (e) { return e.code; } }

let postmasterPid;
try {
  await server.initialise();
  await server.start();
  postmasterPid = Number(readFileSync(path.join(dir, "data", "postmaster.pid"), "utf8").split("\n")[0]);
  const v = await conn("postgres");
  out("INFO", "cluster", { version: (await v.query("show server_version")).rows[0].server_version, port: PORT, postmasterPid, migrations: MIG_FILES });
  await v.end();
  expect("the feedback migration is in the applied set", MIG_FILES.includes(FEEDBACK_FILE));

  // ---- 1. who can touch what (§ 10.4), with Supabase's default privileges in place (stub.sql)
  {
    const { name, admin } = await freshDb();
    for (const role of ["anon", "authenticated"]) {
      const c = await as(name, role);
      const codes = {};
      for (const [what, sql] of [
        ["select feedback", "select * from public.ten_feedback"], ["insert feedback", "insert into public.ten_feedback (kind, comment, version, host) values ('comment','x','1','local')"],
        ["update feedback", "update public.ten_feedback set comment = 'x'"], ["delete feedback", "delete from public.ten_feedback"],
        ["select settings", "select * from public.ten_feedback_settings"], ["update settings", "update public.ten_feedback_settings set open = false"],
        ["insert settings", "insert into public.ten_feedback_settings (id) values (true)"], ["delete settings", "delete from public.ten_feedback_settings"],
        ["execute add", "select public.ten_feedback_add('comment','x',null,'','','1','local',null)"],
      ]) codes[what] = await errCode(c.query(sql));
      expect(`${role}: every table action and the function are refused (42501)`, Object.values(codes).every((x) => x === "42501"), codes);
      await c.end();
    }
    const meta = (await admin.query(`select
      (select relrowsecurity from pg_class where oid = 'public.ten_feedback'::regclass) rls1,
      (select relrowsecurity from pg_class where oid = 'public.ten_feedback_settings'::regclass) rls2,
      (select count(*)::int from pg_policies where tablename in ('ten_feedback','ten_feedback_settings')) policies,
      (select prosecdef from pg_proc where proname = 'ten_feedback_add') definer,
      (select proconfig from pg_proc where proname = 'ten_feedback_add') config,
      (select pg_get_userbyid(proowner) from pg_proc where proname = 'ten_feedback_add') owner,
      (select array_agg(distinct grantee::regrole::text) from pg_proc p, aclexplode(p.proacl) a where p.proname = 'ten_feedback_add' and a.privilege_type = 'EXECUTE') executors,
      (select count(*)::int from pg_proc p, aclexplode(p.proacl) a where p.proname = 'ten_feedback_add' and a.grantee = 0) public_execute`)).rows[0];
    expect("RLS on for both tables, no policy", meta.rls1 && meta.rls2 && meta.policies === 0, meta);
    expect("security definer, search_path '' , owned by postgres", meta.definer === true && JSON.stringify(meta.config) === JSON.stringify(['search_path=""']) && meta.owner === "postgres", meta);
    expect("execute only for the owner and service_role, not PUBLIC", JSON.stringify((meta.executors ?? []).sort()) === JSON.stringify(["postgres", "service_role"]) && meta.public_execute === 0, meta);
    const sr = await as(name, "service_role");
    expect("service_role: the function answers sent", (await add(sr, {})) === "sent");
    await sr.end();
    const cols = (await admin.query("select column_name, data_type from information_schema.columns where table_schema='public' and table_name='ten_feedback' order by ordinal_position")).rows;
    expect("the table's columns are exactly § 10.1's ten", JSON.stringify(cols.map((c) => c.column_name)) === JSON.stringify(["id", "created_at", "kind", "comment", "rating", "skill", "step", "version", "host", "installation_id"]), cols);
    expect("no address column of any kind (no inet/cidr/macaddr type; no ip/addr/agent/origin/user/email name)", !cols.some((c) => /inet|cidr|macaddr/.test(c.data_type) || /ip|addr|agent|origin|user|email/.test(c.column_name)), cols);
    const params = (await admin.query("select pg_get_function_arguments('public.ten_feedback_add'::regproc) a")).rows[0].a;
    expect("the function takes the eight fields and no address", params === "p_kind text, p_comment text, p_rating smallint, p_skill text, p_step text, p_version text, p_host text, p_installation_id text", params);
    await admin.end();
  }

  // ---- 2. the owner changes a value with one update; the row's own checks
  {
    const { name, admin } = await freshDb();
    const s0 = (await admin.query("select * from public.ten_feedback_settings")).rows;
    expect("ships open, 10, 60, 300, 5000, one row", s0.length === 1 && s0[0].open === true && s0[0].per_install_per_hour === 10 && s0[0].all_per_hour === 60 && s0[0].all_per_day === 300 && s0[0].max_rows === 5000, s0);
    const u = await admin.query("update public.ten_feedback_settings set all_per_hour = 100");
    expect("one update changes a limit (one row)", u.rowCount === 1 && (await admin.query("select all_per_hour from public.ten_feedback_settings")).rows[0].all_per_hour === 100);
    const bad = {};
    for (const s of ["per_install_per_hour = -1", "per_install_per_hour = 101", "all_per_hour = 1001", "all_per_day = 10001", "max_rows = 50001", "max_rows = -1", "open = null", "id = false"]) bad[s] = await errCode(admin.query(`update public.ten_feedback_settings set ${s}`));
    expect("every out-of-range value is refused", Object.values(bad).every((c) => c === "23514" || c === "23502"), bad);
    bad.second = await errCode(admin.query("insert into public.ten_feedback_settings (id) values (true)"));
    bad.falseRow = await errCode(admin.query("insert into public.ten_feedback_settings (id) values (false)"));
    expect("a second row is refused", bad.second === "23505" && bad.falseRow === "23514", bad);
    for (const s of ["per_install_per_hour = 0", "per_install_per_hour = 100", "all_per_hour = 1000", "all_per_day = 10000", "max_rows = 50000", "max_rows = 0"]) {
      const c = await errCode(admin.query(`update public.ten_feedback_settings set ${s}`));
      expect(`the edge value ${s} is accepted`, c === null, c);
    }
    // a deleted settings row fails closed
    await admin.query("delete from public.ten_feedback_settings");
    const sr = await as(name, "service_role");
    expect("no settings row: closed, nothing written", (await add(sr, {})) === "closed" && (await rows(admin)) === 0);
    await sr.end(); await admin.end();
  }

  // ---- 3. the table's checks (§ 10.1), through the function, as the service role
  {
    const { name, admin } = await freshDb();
    const sr = await as(name, "service_role");
    const refused = {};
    for (const [what, o] of [
      ["kind praise", { kind: "praise" }], ["comment 2,001", { comment: "x".repeat(2001) }], ["rating 0", { rating: 0 }], ["rating 6", { rating: 6 }],
      ["skill Apply", { skill: "Apply" }], ["skill 31", { skill: "a".repeat(31) }], ["step 61", { step: "s".repeat(61) }], ["step @", { step: "a@b" }], ["step /", { step: "a/b" }],
      ["step backslash", { step: "a\\b" }], ["step LF", { step: "a\nb" }], ["step CR", { step: "a\rb" }], ["version empty", { version: "" }], ["version 41", { version: "1".repeat(41) }],
      ["version space", { version: "1 2" }], ["host other", { host: "phone" }], ["id uppercase", { id: ID(1).toUpperCase().replace(/0/g, "A") }], ["id 31", { id: ID(1).slice(1) }],
      ["no words no rating", { comment: "", rating: null }], ["bug no words", { kind: "bug", comment: "", rating: 3 }],
    ]) refused[what] = await errCode(add(sr, o));
    expect("each § 10.1 check refuses its bad value (23514 / 22P02)", Object.values(refused).every((c) => c === "23514" || c === "22P02" || c === "22003"), refused);
    const ok = {};
    for (const [what, o] of [["2,000 characters", { comment: "x".repeat(2000) }], ["2,000 emoji", { comment: "😀".repeat(2000) }], ["step 'Tailoring' (r and n are letters)", { step: "Tailoring" }], ["step 60 emoji", { step: "😀".repeat(60) }], ["rating only", { comment: "", rating: 5 }], ["step with a tab", { step: "a\tb" }], ["step with U+2028", { step: "a b" }]]) ok[what] = await add(sr, o).catch((e) => e.code);
    expect("valid edge values are written", Object.values(ok).slice(0, 5).every((s) => s === "sent"), ok);
    observe("a step with a tab or U+2028 (not a CR or LF): the table takes it", { tab: ok["step with a tab"], ls: ok["step with U+2028"] });
    const web = await add(sr, { host: "web", id: ID(7) }).catch((e) => e.code);
    expect("a web note with a random id is accepted (amended 2026-10-17, 71991e0 § 10.1)", web === "sent", web);
    await sr.end(); await admin.end();
  }

  // ---- 4. each limit at its boundary, one connection, and the windows
  {
    const { name, admin } = await freshDb();
    const sr = await as(name, "service_role");
    await set(admin, "per_install_per_hour = 3, all_per_hour = 1000, all_per_day = 10000, max_rows = 50000");
    const a = [];
    for (let i = 0; i < 4; i++) a.push(await add(sr, { id: ID(1) }));
    expect("per install: 3 sent, the 4th limited", JSON.stringify(a) === JSON.stringify(["sent", "sent", "sent", "limited"]), a);
    expect("...while another id is sent, and a note with no id is not held by any id's count", (await add(sr, { id: ID(2) })) === "sent" && (await add(sr, { id: null })) === "sent");
    expect("...a refusal wrote nothing", (await rows(admin)) === 5, await rows(admin));
    await admin.query("update public.ten_feedback set created_at = now() - interval '1 hour 1 second' where installation_id = $1", [ID(1)]);
    expect("rows of that id older than an hour no longer count: sent again", (await add(sr, { id: ID(1) })) === "sent");
    await admin.query("update public.ten_feedback set created_at = now() - interval '59 minutes 59 seconds' where installation_id = $1", [ID(1)]);
    await set(admin, "per_install_per_hour = 1");
    expect("a row 59:59 old still counts", (await add(sr, { id: ID(1) })) === "limited");

    await admin.query("delete from public.ten_feedback");
    await set(admin, "per_install_per_hour = 100, all_per_hour = 4");
    const h = [];
    for (let i = 0; i < 5; i++) h.push(await add(sr, { id: ID(100 + i) }));
    expect("all per hour 4: 4 sent from 4 ids, the 5th id limited", JSON.stringify(h) === JSON.stringify(["sent", "sent", "sent", "sent", "limited"]), h);

    await admin.query("update public.ten_feedback set created_at = now() - interval '2 hours'");
    await set(admin, "all_per_day = 6");
    const d = [];
    for (let i = 0; i < 3; i++) d.push(await add(sr, { id: ID(200 + i) }));
    expect("all per day 6: with 4 two-hour-old rows, 2 more are sent, then limited", JSON.stringify(d) === JSON.stringify(["sent", "sent", "limited"]), d);
    await admin.query("update public.ten_feedback set created_at = now() - interval '24 hours 1 second'");
    expect("rows older than 24 hours no longer count for the day", (await add(sr, {})) === "sent");

    await admin.query("update public.ten_feedback set created_at = now() - interval '3 days'");
    const held = await rows(admin);
    await set(admin, `all_per_day = 10000, all_per_hour = 1000, max_rows = ${held + 1}`);
    expect("max rows: one more is sent, then the table is full (whatever the age of its rows)", (await add(sr, {})) === "sent" && (await add(sr, {})) === "limited", { held });
    await set(admin, "open = false, max_rows = 50000");
    const before = await rows(admin);
    expect("closed: closed, nothing written", (await add(sr, {})) === "closed" && (await rows(admin)) === before);
    await set(admin, "open = true, max_rows = 0");
    expect("max_rows 0: limited", (await add(sr, {})) === "limited");
    await sr.end(); await admin.end();
  }

  // ---- 5. the lock, orchestrated: A holds the settings row; B waits; A commits or rolls back
  for (const ending of ["commit", "rollback"]) {
    for (const [limit, sameId] of [["per_install_per_hour = 1", true], ["all_per_hour = 1", false], ["all_per_day = 1", false], ["max_rows = 1", false]]) {
      const { name, admin } = await freshDb();
      await set(admin, `per_install_per_hour = 100, all_per_hour = 1000, all_per_day = 10000, max_rows = 50000`);
      await set(admin, limit);
      const ca = await as(name, "service_role"), cb = await as(name, "service_role");
      await ca.query("begin");
      const ra = await add(ca, { id: ID(1) });
      const bPid = (await cb.query("select pg_backend_pid() p")).rows[0].p;
      const pb = add(cb, { id: sameId ? ID(1) : ID(2) });
      const blocked = await waitingOnLock(admin, bPid);
      await ca.query(ending);
      const rb = await pb;
      const n = await rows(admin);
      const want = ending === "commit" ? ["sent", "limited", 1] : ["sent", "sent", 1];
      expect(`lock, ${limit}, A ${ending}s: B waited on the lock, then ${want[1]}; ${want[2]} row`, blocked && ra === want[0] && rb === want[1] && n === want[2], { blocked, ra, rb, n });
      await ca.end(); await cb.end(); await admin.end();
    }
  }

  // ---- 6. many at once at each limit: never past it
  for (const [label, setting, mk, cap, prefill] of [
    ["per install 10, 60 sends from one id", "per_install_per_hour = 10", () => ({ id: ID(9) }), 10, 0],
    ["all per hour 10, 60 sends from 60 ids", "all_per_hour = 10", (i) => ({ id: ID(1000 + i) }), 10, 0],
    ["all per day 10 (5 rows from two hours ago), 60 sends", "all_per_day = 10", (i) => ({ id: ID(2000 + i) }), 5, 5],
    ["max rows 12 (7 rows from three days ago), 60 sends", "max_rows = 12", (i) => ({ id: ID(3000 + i) }), 5, 7],
    ["all per hour 10, 60 sends with no id", "all_per_hour = 10", () => ({ id: null }), 10, 0],
  ]) {
    const { name, admin } = await freshDb();
    await set(admin, "per_install_per_hour = 100, all_per_hour = 1000, all_per_day = 10000, max_rows = 50000");
    if (prefill) {
      for (let i = 0; i < prefill; i++) await admin.query("insert into public.ten_feedback (kind, comment, version, host, created_at) values ('comment', 'old', '1', 'local', now() - $1::interval)", [label.startsWith("max") ? "3 days" : "2 hours"]);
    }
    await set(admin, setting);
    const cs = await Promise.all(Array.from({ length: 60 }, () => as(name, "service_role")));
    const results = await Promise.all(cs.map((c, i) => add(c, mk(i)).catch((e) => `error ${e.code}`)));
    const sent = results.filter((r) => r === "sent").length;
    const n = await rows(admin);
    expect(`concurrent: ${label}: exactly ${cap} sent, the rest limited, ${prefill + cap} rows`, sent === cap && results.every((r) => r === "sent" || r === "limited") && n === prefill + cap, { sent, rows: n, other: [...new Set(results)] });
    await Promise.all(cs.map((c) => c.end()));
    await admin.end();
  }

  // ---- 7. a caller in REPEATABLE READ (PostgREST uses READ COMMITTED; observed, not required)
  {
    const { name, admin } = await freshDb();
    await set(admin, "all_per_hour = 1");
    const ca = await as(name, "service_role"), cb = await as(name, "service_role");
    await cb.query("begin isolation level repeatable read");
    await cb.query("select 1");
    await ca.query("begin");
    await add(ca, {});
    const pb = add(cb, {}).catch((e) => `error ${e.code}`);
    await ca.query("commit");
    const rb = await pb;
    await cb.query("rollback").catch(() => {});
    observe("REPEATABLE READ caller behind a committed send at all_per_hour 1", { rb, rows: await rows(admin) });
    await ca.end(); await cb.end(); await admin.end();
  }

  // ---- 8. the order guard, the teardown, and a clean re-apply
  {
    const { name, admin } = await freshDb();
    const sr = await as(name, "service_role");
    await add(sr, {});
    await sr.end();
    const again = await errCode(admin.query(FEEDBACK));
    await admin.query("rollback"); // the file opens its own transaction block; psql -v ON_ERROR_STOP would end the session here
    expect("a second apply is refused by the order guard, and the note is still there", again === "P0001" && (await rows(admin)) === 1, again);
    await admin.query("begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id='ten-workspaces'; delete from storage.buckets where id='ten-workspaces'; commit;"); // the teardown's own precondition (its header)
    await admin.query(TEARDOWN);
    const left = (await admin.query("select (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'ten\\_feedback%') rels, (select count(*)::int from pg_proc where proname like 'ten\\_feedback%') procs, (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relname like 'ten\\_%') any_ten")).rows[0];
    expect("the teardown leaves no feedback table, index or function (and no ten_ table at all)", left.rels === 0 && left.procs === 0 && left.any_ten === 0, left);
    let reapply = null;
    try { for (const m of MIGS) await admin.query(m); } catch (e) { reapply = e.message; }
    expect("after the teardown every migration applies again, in order", reapply === null, reapply);
    await admin.end();
  }
} catch (e) {
  fails++; failed.push(`harness error: ${e.message}`);
  console.error(e);
} finally {
  try { await server.stop(); } catch (e) {
    console.error("stop failed; killing the recorded postmaster pid", postmasterPid, e.message);
    if (postmasterPid) try { process.kill(postmasterPid, "SIGTERM"); } catch {}
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nfeedback race failures: ${fails}${fails ? "\n  " + failed.join("\n  ") : ""}`);
process.exitCode = fails ? 1 : 0;
process.exit(fails ? 1 : 0); // explicit: something in the cluster helper reset the exit code to 0 (seen 2026-10-17)
