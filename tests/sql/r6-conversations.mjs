// Coder-added (§ 11's own note: "extend the SQL harness only if § 11's test
// plan requires a migration check you can't do otherwise") — docs/design-
// web-agent.md § 11.2/§ 11.9, the THIRD migration,
// 20260924100000_ten_conversations.sql, applied AFTER the applied
// 20260923000000_ten_beta_init.sql and
// 20260924000000_ten_ledger_finish_reason.sql, on the same PGlite stand-in
// as the other runners. § 11.9 (i) RLS, (ii) save (CAS/size/shape), (ix)
// teardown.
//   node r6-conversations.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const WT = new URL("../../", import.meta.url).pathname.replace(/\/$/, ""); // the repo root
const MIG1 = readFileSync(`${WT}/supabase/migrations/20260923000000_ten_beta_init.sql`, "utf8");
const MIG2 = readFileSync(`${WT}/supabase/migrations/20260924000000_ten_ledger_finish_reason.sql`, "utf8");
const MIG3 = readFileSync(`${WT}/supabase/migrations/20260924100000_ten_conversations.sql`, "utf8");
const TEAR = readFileSync(`${WT}/supabase/teardown/ten_beta_teardown.sql`, "utf8");
const STUB = readFileSync(new URL("./stub.sql", import.meta.url), "utf8");
const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "bbbbbbbb-0000-0000-0000-000000000002", N = "cccccccc-0000-0000-0000-000000000003";
let fails = 0;
const out = (t, m, d = "") => console.log(`[${t}] ${m}${d !== "" && d !== undefined ? "  -> " + (typeof d === "string" ? d : JSON.stringify(d)) : ""}`);
const expect = (m, c, d) => { out(c ? "PASS" : "FAIL", m, d); if (!c) fails++; };
const note = (m, d) => out("OBSERVED", m, d);
async function fresh() {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${N}')`);
  return db;
}
async function run(db, sql) { try { await db.exec(sql); return { ok: true }; } catch (e) { try { await db.exec("rollback"); } catch {} return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } }
async function as(db, uid, role, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [uid ? JSON.stringify({ sub: uid, role }) : ""]);
  await db.exec(`set role ${role}`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } finally { await db.exec("reset role"); }
}
async function member(db, uid) {
  await as(db, null, "service_role", "insert into public.ten_usage_ledger (user_id, kind, usd) values ($1,'credit',5)", [uid]);
}
const save = (db, uid, chatId, messages, olderDropped, expected) =>
  as(db, uid, "authenticated", "select * from public.ten_conversation_save($1,$2,$3,$4)", [chatId, JSON.stringify(messages), olderDropped, expected]);

// ---- 0. order: the third file refuses before the first two
{
  const db = await fresh();
  const r = await run(db, MIG3);
  expect("conversations migration before the init migration is refused", !r.ok && /apply 20260923000000_ten_beta_init\.sql first/.test(r.e), r.e);
}

// ---- 1. applied in order, exactly one table + one function + their grants/policy
let SNAPSHOT_DB;
{
  const db = await fresh();
  expect("init migration applies", (await run(db, MIG1)).ok);
  expect("finish_reason migration applies", (await run(db, MIG2)).ok);
  const m3 = await run(db, MIG3);
  expect("conversations migration applies after both", m3.ok, m3.e);
  const again = await run(db, MIG3);
  expect("a second run is refused by its guard", !again.ok && /already exists/.test(again.e), again.e);
  SNAPSHOT_DB = db;
}

// ---- 2. (i) RLS: own row only; a non-member and anon read nothing; no direct writes
{
  const db = SNAPSHOT_DB;
  await member(db, A);
  const ins = await save(db, A, "chat-a", [{ role: "user", parts: [{ type: "text", text: "hi" }] }], false, null);
  expect("A's first save (create) succeeds", ins.ok && ins.rows[0].version, ins.rows ?? ins.e);
  const aReads = await as(db, A, "authenticated", "select chat_id, messages from public.ten_conversations");
  expect("A reads their own row", aReads.ok && aReads.rows.length === 1 && aReads.rows[0].chat_id === "chat-a", aReads.rows ?? aReads.e);

  const bReads = await as(db, B, "authenticated", "select count(*)::int n from public.ten_conversations");
  expect("B (non-member, no credit row) reads none of A's rows", bReads.ok && bReads.rows[0].n === 0, bReads.rows ?? bReads.e);
  // anon has no select grant at all (like ten_ws_files) — a flat permission
  // denial, never even reaching RLS.
  const anonReads = await as(db, null, "anon", "select count(*)::int n from public.ten_conversations");
  expect("anon has no grant to read the table", !anonReads.ok && /42501/.test(anonReads.e), anonReads.e);

  const direct = await as(db, A, "authenticated", "update public.ten_conversations set older_dropped = true where user_id = $1", [A]);
  expect("a member cannot write the table directly (no update policy)", !direct.ok, direct.e);

  await member(db, N);
  const nSave = await save(db, N, "chat-n", [{ role: "user", parts: [] }], false, null);
  expect("N (a member) saving never changes A's row", nSave.ok, nSave.e);
  const aStill = await as(db, A, "authenticated", "select chat_id from public.ten_conversations where user_id = $1", [A]);
  expect("A's row is untouched by N's save", aStill.ok && aStill.rows[0].chat_id === "chat-a", aStill.rows ?? aStill.e);
}

// ---- 3. (ii) save: CAS, shape, size
{
  const db = SNAPSHOT_DB;
  const dup = await save(db, A, "chat-a", [{ role: "user", parts: [] }], false, null);
  expect("a second null-expected (create) save is PT409 version_conflict", !dup.ok && /PT409/.test(dup.e) && /version_conflict/.test(dup.e), dup.e);

  const cur = await as(db, A, "authenticated", "select version from public.ten_conversations where user_id = $1", [A]);
  const v1 = cur.rows[0].version;
  const stale = await save(db, A, "chat-a", [{ role: "user", parts: [{ type: "text", text: "x" }] }], false, "not-the-real-version");
  expect("a stale expected version is PT409 version_conflict", !stale.ok && /PT409/.test(stale.e) && /version_conflict/.test(stale.e), stale.e);

  const ok2 = await save(db, A, "chat-a", [{ role: "user", parts: [{ type: "text", text: "two" }] }], true, v1);
  expect("the correct expected version updates and returns a new version", ok2.ok && ok2.rows[0].version && ok2.rows[0].version !== v1 && ok2.rows[0].older_dropped === true, ok2.rows ?? ok2.e);

  const badShape = await as(db, A, "authenticated", "select * from public.ten_conversation_save($1,$2,$3,$4)", ["chat-a", JSON.stringify({ not: "an array" }), false, ok2.rows[0].version]);
  expect("a non-array messages value is PT400 invalid_ref", !badShape.ok && /PT400/.test(badShape.e) && /invalid_ref/.test(badShape.e), badShape.e);

  const big = JSON.stringify([{ role: "user", parts: [{ type: "text", text: "x".repeat(1024 * 1024 + 2) }] }]);
  const tooBig = await as(db, A, "authenticated", "select * from public.ten_conversation_save($1,$2,$3,$4)", ["chat-a", big, false, ok2.rows[0].version]);
  expect("over 1,048,576 bytes is PT413 conversation_too_large", !tooBig.ok && /PT413/.test(tooBig.e) && /conversation_too_large/.test(tooBig.e), tooBig.e);

  const nonMember = await save(db, B, "chat-b", [{ role: "user", parts: [] }], false, null);
  expect("a non-member save is PT403 not_a_member", !nonMember.ok && /PT403/.test(nonMember.e) && /not_a_member/.test(nonMember.e), nonMember.e);

  // anon has no execute grant either (like ten_ws_write) — a flat
  // permission denial before the function body's own not_signed_in check
  // ever runs; PostgREST still turns this into 401/403 for the client.
  const anonSave = await as(db, null, "anon", "select * from public.ten_conversation_save($1,$2,$3,$4)", ["chat-x", "[]", false, null]);
  expect("anon has no grant to call the save RPC", !anonSave.ok && /42501/.test(anonSave.e), anonSave.e);

  const wrongChat = await as(db, A, "authenticated", "select * from public.ten_conversation_save($1,$2,$3,$4)", ["not-chat-a", "[]", false, ok2.rows[0].version]);
  expect("a save with the wrong chat_id (even with the right version) is PT409 version_conflict, never a silent overwrite", !wrongChat.ok && /PT409/.test(wrongChat.e), wrongChat.e);

  const versionRow = await as(db, A, "authenticated", "select length(version) l, version ~ '^[0-9a-f]+$' hex from public.ten_conversations where user_id = $1", [A]);
  note("version shape", versionRow.rows);
  expect("version is a lowercase-hex sha256 prefix (same construction as ten_ws_write)", versionRow.ok && versionRow.rows[0].hex && versionRow.rows[0].l === 16, versionRow.rows ?? versionRow.e);
}

// ---- 4. teardown after all three migrations: no ten_ object left
{
  const db = SNAPSHOT_DB;
  await db.exec("begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id='ten-workspaces'; delete from storage.buckets where id='ten-workspaces'; commit;");
  const t = await run(db, TEAR);
  expect("teardown runs after all three migrations", t.ok, t.e);
  const left = (await db.query(
    "select (select count(*) from pg_policy where polname like 'ten\\_%')::int p, (select count(*) from pg_proc where proname like 'ten\\_%')::int f, (select count(*) from pg_class where relname like 'ten\\_%')::int c",
  )).rows[0];
  expect("nothing ten_ remains (policies, functions, relations)", left.p === 0 && left.f === 0 && left.c === 0, left);
}

// ---- 5. the file's own promises
expect("3 s lock timeout", MIG3.includes("set local lock_timeout = '3s'"));
expect("one transaction", /^\s*begin;/m.test(MIG3) && /^\s*commit;\s*$/m.test(MIG3));
expect("the teardown header names all three migration files", TEAR.slice(0, 1400).includes("20260923000000_ten_beta_init.sql") && TEAR.slice(0, 1400).includes("20260924000000_ten_ledger_finish_reason.sql") && TEAR.slice(0, 1400).includes("20260924100000_ten_conversations.sql"));

console.log(`\nr6 (conversations migration) failures: ${fails}`);
if (fails) process.exitCode = 1;
