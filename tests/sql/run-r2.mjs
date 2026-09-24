import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const WT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");  // the repo root
const MIG = readFileSync(`${WT}/supabase/migrations/20260923000000_ten_beta_init.sql`, "utf8");
const TEAR = readFileSync(`${WT}/supabase/teardown/ten_beta_teardown.sql`, "utf8");
const STUB = readFileSync(new URL("./stub.sql", import.meta.url), "utf8");
const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "bbbbbbbb-0000-0000-0000-000000000002", N = "cccccccc-0000-0000-0000-000000000003";
let failures = 0;
const log = (tag, msg, extra = "") => console.log(`[${tag}] ${msg}${extra ? "  -> " + extra : ""}`);
async function fresh(oldPolicy = "create policy avatars_read on storage.objects for select using (bucket_id = 'avatars');") {
  const db = new PGlite(); await db.exec(STUB); if (oldPolicy) await db.exec(oldPolicy);
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${N}')`); return db;
}
async function run(db, sql) { try { const r = await db.exec(sql); return { ok: true, r }; } catch (e) { try { await db.exec("rollback"); } catch {} return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } }
async function as(db, uid, role, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [uid ? JSON.stringify({ sub: uid, role }) : ""]);
  await db.exec(`set role ${role}`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, e: `${e.code ?? ""} ${e.message}` }; }
  finally { await db.exec("reset role"); }
}
function expect(name, cond, detail) { log(cond ? "PASS" : "FAIL", name, typeof detail === "string" ? detail : JSON.stringify(detail)); if (!cond) failures++; }
function note(name, detail) { log("OBSERVED", name, typeof detail === "string" ? detail : JSON.stringify(detail)); }
const SNAP = `select 'rel' k, n.nspname||'.'||c.relname||':'||c.relkind::text||':'||coalesce(c.relacl::text,'')||':'||c.relrowsecurity::text v from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage','auth')
 union all select 'proc', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','storage','auth')
 union all select 'pol', schemaname||'.'||tablename||'.'||policyname||':'||coalesce(qual,'')||':'||coalesce(with_check,'') from pg_policies
 union all select 'bucket', id from storage.buckets
 union all select 'defacl', defaclrole::regrole::text||':'||defaclobjtype::text||':'||defaclacl::text from pg_default_acl
 union all select 'nsp', nspname||':'||coalesce(nspacl::text,'') from pg_namespace order by 1,2`;
const snap = async (db) => (await db.query(SNAP)).rows.map((r) => r.k + " " + r.v);

// ---- 1. production safety: catalog diff
{
  const db = await fresh();
  const before = await snap(db);
  const m = await run(db, MIG); expect("migration applies on a clean stand-in", m.ok, m.e);
  const after = await snap(db);
  const added = after.filter((x) => !before.includes(x)), removed = before.filter((x) => !after.includes(x));
  expect("migration changes no existing catalog entry (removed/changed = none)", removed.length === 0, removed);
  note("migration adds", added.map((x) => x.split(":")[0]));
  const nonTen = added.filter((x) => !/(ten_|ten-)/.test(x));
  expect("every added object is ten_/ten- named", nonTen.length === 0, nonTen);
  const again = await run(db, MIG); expect("second run refused by the guard", !again.ok && /already exists/.test(again.e), again.e);
  const after2 = await snap(db); expect("refused run left the catalog unchanged", JSON.stringify(after2) === JSON.stringify(after));
  const t0 = await run(db, TEAR); expect("teardown refuses while the bucket exists (Storage API step not done)", !t0.ok && /Storage API first/.test(t0.e), t0.e);
  const afterT0 = await snap(db); expect("refused teardown changed nothing", JSON.stringify(afterT0) === JSON.stringify(after));
  // stand-in for the Storage API (emptyBucket + deleteBucket): the API itself is allowed past protect_delete
  await db.exec("begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id='ten-workspaces'; delete from storage.buckets where id='ten-workspaces'; commit;");
  const t = await run(db, TEAR); expect("teardown runs with Supabase's real protect_delete triggers ON (after the API step)", t.ok, t.e);
  const afterT2 = await snap(db);
  const diff = afterT2.filter((x) => !before.includes(x)).concat(before.filter((x) => !afterT2.includes(x)));
  expect("teardown returns the catalog exactly to the pre-migration state", diff.length === 0, diff);
  const lk = MIG.includes("set local lock_timeout = '3s'") && TEAR.includes("set local lock_timeout = '3s'");
  expect("both files set a 3 s lock_timeout", lk);
}
// ---- 1b. guard
for (const [label, pol, shouldRefuse] of [
  ["using (true)", "create policy old_any on storage.objects for select using (true);", true],
  ["auth.role() only", "create policy old_auth on storage.objects for select to authenticated using (auth.uid() is not null);", true],
  ["bucket_id <> 'secret'", "create policy old_neq on storage.objects for select using (bucket_id <> 'secret');", true],
  ["bucket filter OR'd away", "create policy old_or on storage.objects for select using (bucket_id = 'avatars' or auth.uid() is not null);", true],
  ["insert with_check true + update using bucket, check true", "create policy old_upd on storage.objects for update using (bucket_id = 'avatars') with check (true);", true],
  ["RLS disabled on storage.objects", "alter table storage.objects disable row level security;", true],
  ["bucket_id is not null", "create policy old_nn on storage.objects for select using (bucket_id is not null);", true],
  ["buckets policy FOR UPDATE", "create policy old_bu on storage.buckets for update to authenticated using (true);", true],
  ["safe old policy (bucket_id = 'avatars')", "create policy old_ok on storage.objects for select using (bucket_id = 'avatars');", false],
]) {
  const db = await fresh(pol);
  const m = await run(db, MIG);
  const refused = !m.ok;
  expect(`guard refuses an unsafe existing setup: ${label}`, refused === shouldRefuse, refused ? m.e : "APPLIED (guard did not refuse)");
  if (!refused && /old_neq|old_or/.test(pol)) {
    await db.exec(`insert into public.ten_usage_ledger (user_id, kind, usd) values ('${A}','credit',5),('${B}','credit',5)`);
    await db.exec(`insert into storage.objects (bucket_id, name, owner) values ('ten-workspaces', 'users/${A}/ws/documents/cv.pdf', '${A}')`);
    const r = await as(db, B, "authenticated", "select name from storage.objects where bucket_id = 'ten-workspaces'");
    note(`  consequence (${label}): member B reads A's ten-workspaces objects`, r.rows ?? r.e);
  }
  if (!refused && /old_upd/.test(pol)) {
    await db.exec(`insert into public.ten_usage_ledger (user_id, kind, usd) values ('${A}','credit',5)`);
    await db.exec(`insert into storage.objects (bucket_id, name, owner) values ('avatars', 'x/${N}.png', '${N}')`);
    const r = await as(db, N, "authenticated", `update storage.objects set bucket_id='ten-workspaces', name='users/${A}/ws/documents/planted.pdf' where bucket_id='avatars' returning name`);
    note(`  consequence (${label}): a NON-member moves an object into A's ten-workspaces folder`, r.rows ?? r.e);
  }
}
// ---- 2/3. RLS, functions, CAS, path rules
{
  const db = await fresh(); await run(db, MIG);
  await db.exec(`insert into public.ten_usage_ledger (user_id, kind, usd) values ('${A}','credit',5),('${B}','credit',5)`);
  const W = (uid, p, c, e) => as(db, uid, "authenticated", "select * from public.ten_ws_write($1,$2,$3)", [p, c, e]);
  let r = await W(A, "plan.md", "hello", null); expect("A creates plan.md", r.ok, r.e ?? r.rows);
  const v0 = r.rows?.[0]?.version;
  const crypto = await import("node:crypto");
  expect("version = first 16 hex of sha256(UTF-8), same as workspace-core.mjs versionOf", v0 === crypto.createHash("sha256").update("hello").digest("hex").slice(0, 16), v0);
  r = await W(A, "plan.md", "x", null); expect("create on existing -> already_exists", !r.ok && /already_exists/.test(r.e), r.e);
  r = await W(A, "plan.md", "v1", v0); expect("update with current version succeeds", r.ok, r.e);
  r = await W(A, "plan.md", "v2", v0); expect("stale version -> version_conflict", !r.ok && /version_conflict/.test(r.e), r.e);
  r = await W(A, "nope.md", "v2", "abc"); expect("update of missing -> resource_missing", !r.ok && /resource_missing/.test(r.e), r.e);
  r = await as(db, B, "authenticated", "select path from public.ten_ws_files"); expect("B cannot see A's rows", r.ok && r.rows.length === 0, r.rows ?? r.e);
  r = await W(B, "plan.md", "B's own", null); expect("B's create of plan.md makes B's own row (no clash with A)", r.ok, r.e);
  r = await as(db, A, "authenticated", "select user_id, content from public.ten_ws_files"); expect("A still sees only A's row", r.ok && r.rows.length === 1 && r.rows[0].user_id === A, r.rows ?? r.e);
  r = await as(db, A, "authenticated", `update public.ten_ws_files set content='x'`); expect("direct UPDATE by a user refused", !r.ok, r.e);
  r = await as(db, A, "authenticated", `insert into public.ten_ws_files (user_id,path,content,version) values ('${B}','z.md','x','x')`); expect("direct INSERT by a user refused", !r.ok, r.e);
  r = await W(N, "plan.md", "x", null); expect("non-member write refused (not_a_member)", !r.ok && /not_a_member/.test(r.e), r.e);
  r = await as(db, null, "anon", "select * from public.ten_ws_write('a.md','x',null)"); expect("anon cannot execute ten_ws_write", !r.ok, r.e);
  r = await as(db, null, "anon", "select * from public.ten_ws_files"); expect("anon cannot select ten_ws_files", !r.ok, r.e);
  for (const [p, want] of [["../x.md", false], ["a/../x.md", false], ["/abs.md", false], [".hidden.md", false], ["a/.git/x.md", false], ["skills/x.md", false], ["x.exe", false], ["x.pdf", false],
    ["CLAUDE.md", true], ["a//b.md", null], ["Skills/x.md", null], ["claude.md", null], ["NOTES.MD", null], ["a\\..\\b.md", null], ["line\nbreak.md", null], ["résumé.md", null]]) {
    r = await W(A, p, "x", null);
    if (want === null) note(`path ${JSON.stringify(p)} create`, r.ok ? "ACCEPTED" : r.e);
    else expect(`path ${JSON.stringify(p)} create ${want ? "accepted" : "refused"}`, r.ok === want, r.ok ? "accepted" : r.e);
  }
  r = await as(db, A, "authenticated", "select version from public.ten_ws_files where path='CLAUDE.md'");
  const vc = r.rows?.[0]?.version;
  r = await W(A, "CLAUDE.md", "injected", vc); expect("CLAUDE.md update -> not_editable", !r.ok && /not_editable/.test(r.e), r.e);
  r = await W(A, "big.md", "x".repeat(2 * 1024 * 1024 + 1), null); expect("content over 2 MB refused", !r.ok, r.e);
  r = await W(A, "ok2mb.md", "x".repeat(2 * 1024 * 1024), null); expect("content of exactly 2 MB accepted", r.ok, r.e);
  // money
  r = await as(db, A, "authenticated", `insert into public.ten_usage_ledger (user_id,kind,usd) values ('${A}','credit',100)`); expect("user cannot insert a ledger row", !r.ok, r.e);
  r = await as(db, A, "authenticated", `update public.ten_usage_ledger set usd = 1000`); expect("user cannot update ledger", !r.ok, r.e);
  r = await as(db, A, "authenticated", "select public.ten_balance() b"); expect("ten_balance = 5 for A", r.ok && Number(r.rows[0].b) === 5, r.rows ?? r.e);
  r = await as(db, A, "authenticated", `select public.ten_balance_for('${B}') b`); expect("authenticated cannot execute ten_balance_for", !r.ok, r.e);
  r = await as(db, null, "anon", `select public.ten_balance() b`); expect("anon cannot execute ten_balance", !r.ok, r.e);
  r = await as(db, null, "service_role", `select public.ten_balance_for('${B}') b`); expect("service_role can execute ten_balance_for", r.ok && Number(r.rows[0].b) === 5, r.rows ?? r.e);
  await db.exec(`insert into public.ten_usage_ledger (user_id, kind, request_id, usd) values ('${A}','call','gen-1',0.123456)`);
  r = await run(db, `insert into public.ten_usage_ledger (user_id, kind, request_id, usd) values ('${A}','call','gen-1',0.1)`); expect("duplicate request_id rejected", !r.ok, r.e);
  r = await as(db, A, "authenticated", "select public.ten_balance() b"); expect("balance is exact numeric", r.ok && r.rows[0].b === "4.876544", r.rows ?? r.e);
  // gates
  const G = "11111111-2222-3333-4444-555555555555";
  r = await as(db, N, "authenticated", "select public.ten_gate_open($1,'chat1','label','sha256:x','line',1.5)", [G]); note("NON-member calls ten_gate_open", r.ok ? "ACCEPTED (row written)" : r.e);
  r = await as(db, N, "authenticated", "select public.ten_gate_open(gen_random_uuid(),'chat1',repeat('x', 5000000),'h','l',1)"); note("non-member writes a 5 MB label", r.ok ? "ACCEPTED" : r.e);
  const G2 = "22222222-2222-3333-4444-555555555555";
  r = await as(db, A, "authenticated", "select public.ten_gate_open($1,'chat1','Run six roles','sha256:x','This costs up to $2.00',2)", [G2]);
  r = await as(db, A, "authenticated", "select public.ten_gate_decide($1,'approved','yes') d", [G2]); note("user approves own gate by direct RPC with typed_text chosen by the caller", r.rows ?? r.e);
  r = await as(db, A, "authenticated", "select public.ten_gate_decide($1,'declined','no') d", [G2]); expect("decide twice -> false (exactly once)", r.ok && r.rows[0].d === false, r.rows ?? r.e);
  r = await as(db, B, "authenticated", "select public.ten_gate_decide($1,'approved','yes') d", [G]); expect("B cannot decide N's gate", r.ok && r.rows[0].d === false, r.rows ?? r.e);
  r = await as(db, B, "authenticated", "select public.ten_gate_open($1,'c','l','h','g',1)", [G]); note("B reuses N's gateId", r.ok ? "accepted" : r.e);
  r = await as(db, A, "authenticated", `insert into public.ten_gate_log (id,user_id,chat_id,kind,label,text_hash,gate_line,amount_usd) values (gen_random_uuid(),'${A}','c','spend','l','h','g',1)`); expect("direct gate_log insert refused", !r.ok, r.e);
  // storage
  const O = (uid, name) => as(db, uid, "authenticated", "insert into storage.objects (bucket_id,name,owner) values ('ten-workspaces',$1,$2) returning name", [name, uid]);
  r = await O(A, `users/${A}/ws/documents/cv.pdf`); expect("A uploads into own folder", r.ok, r.e);
  r = await O(A, `users/${B}/ws/documents/x.pdf`); expect("A cannot upload into B's folder", !r.ok, r.e);
  r = await O(N, `users/${N}/ws/documents/x.pdf`); expect("non-member cannot upload", !r.ok, r.e);
  r = await O(A, `users/${A}/other/x.pdf`); expect("A cannot upload outside ws/", !r.ok, r.e);
  r = await O(A, `users/${A}/ws/plan.md`); note("A uploads users/A/ws/plan.md into the bucket (text path, overlaps ten_ws_files)", r.ok ? "ACCEPTED" : r.e);
  r = await O(A, `users/${A}/ws/.hidden/x.pdf`); note("A uploads a hidden-segment object", r.ok ? "ACCEPTED" : r.e);
  r = await O(A, `users/${A}/ws/skills/x.pdf`); note("A uploads under ws/skills/", r.ok ? "ACCEPTED" : r.e);
  r = await as(db, B, "authenticated", "select name from storage.objects where bucket_id='ten-workspaces'"); expect("B lists none of A's objects", r.ok && r.rows.length === 0, r.rows ?? r.e);
  r = await as(db, A, "authenticated", "update storage.objects set name = name || '.x' where bucket_id='ten-workspaces' returning name"); expect("A cannot update (create-only)", r.ok && r.rows.length === 0, r.rows ?? r.e);
  r = await as(db, A, "authenticated", "delete from storage.objects where bucket_id='ten-workspaces' returning name"); note("A delete own object", r.rows ?? r.e);
  // r2: gates with valid shapes, caps, codes
  const H = "sha256:" + "a".repeat(64);
  const G3 = "33333333-2222-3333-4444-555555555555";
  r = await as(db, A, "authenticated", "select public.ten_gate_open($1,'chat1','Run six roles',$2,'This costs up to $2.00',2)", [G3, H]); expect("member opens a well-formed gate", r.ok, r.e);
  r = await as(db, A, "authenticated", "select public.ten_gate_open(gen_random_uuid(),'chat1',repeat('x',81),$1,'l',1)", [H]); expect("member label over 80 chars refused", !r.ok, r.e);
  r = await as(db, A, "authenticated", "select public.ten_gate_decide($1,'approved',repeat('y',21)) d", [G3]); expect("typed_text over 20 chars refused", !r.ok, r.e);
  r = await as(db, A, "authenticated", "select public.ten_gate_decide($1,'approved','yes') d", [G3]); expect("member decides own gate once -> true", r.ok && r.rows[0].d === true, r.rows ?? r.e);
  r = await as(db, N, "authenticated", "select public.ten_gate_decide($1,'approved','yes') d", [G3]); expect("non-member ten_gate_decide -> not_a_member", !r.ok && /not_a_member/.test(r.e), r.e);
  r = await W(A, "plan.md", "v3", "stale"); expect("version_conflict carries SQLSTATE PT409", !r.ok && /^PT409/.test(r.e), r.e);
  r = await W(A, "missing.md", "x", "abc"); expect("resource_missing carries SQLSTATE PT404", !r.ok && /^PT404/.test(r.e), r.e);
  r = await W(A, "docs/CLAUDE.md", "x", null); expect("nested claude.md (any case) refused", !r.ok && /not_editable/.test(r.e), r.e);
  r = await W(A, "x.pdf", "x", null); expect("binary ext via ten_ws_write -> unsupported_type PT415", !r.ok && /^PT415/.test(r.e), r.e);
  { let full = null; for (let i = 0; i < 30 && !full; i++) { const q = await W(A, `big${i}.md`, "z".repeat(2 * 1024 * 1024), null); if (!q.ok) full = q.e; } expect("per-user text cap -> workspace_full", /workspace_full/.test(full ?? ""), full ?? "never refused"); }
  { let refusedAt = null; for (let i = 0; i < 60 && refusedAt === null; i++) { const q = await O(A, `users/${A}/ws/documents/f${i}.pdf`); if (!q.ok) refusedAt = i; } expect("bucket cap: at most 50 objects per user", refusedAt !== null && refusedAt <= 50, String(refusedAt)); }
  r = await O(A, `users/${A}/ws/Skills/x.PDF`); expect("bucket refuses ws/Skills/ (case-insensitive)", !r.ok, r.e);
  // r3: open sign-up — every read/write of beta data requires membership
  r = await as(db, N, "authenticated", "select public.ten_gate_expire_other_chats('c')"); expect("non-member ten_gate_expire_other_chats -> not_a_member", !r.ok && /not_a_member/.test(r.e), r.e);
  await db.exec(`insert into public.ten_ws_files (user_id,path,content,version) values ('${N}','planted.md','x','x')`);
  await db.exec(`insert into storage.objects (bucket_id,name,owner) values ('ten-workspaces','users/${N}/ws/planted.pdf','${N}')`);
  r = await as(db, N, "authenticated", "select path from public.ten_ws_files"); expect("non-member cannot read even own ten_ws_files rows", r.ok && r.rows.length === 0, r.rows ?? r.e);
  r = await as(db, N, "authenticated", "select name from storage.objects where bucket_id='ten-workspaces'"); expect("non-member cannot read even own bucket objects", r.ok && r.rows.length === 0, r.rows ?? r.e);
  r = await as(db, A, "authenticated", "select path from public.ten_ws_files where path='plan.md'"); expect("member still reads own rows", r.ok && r.rows.length === 1, r.rows ?? r.e);
  // r4 (round 2 findings): invisible characters, NFC, file/folder and case clashes, daily ceiling, lock
  for (const p of ["CLA\u200cUDE.md", "\ufeffCLAUDE.md", "CLAUDE\u200d.md", "report\u202etxt.md", "a\u00adb.md", "x\u2028y.md", "x\u2060y.md", "x\u{E0041}y.md"]) {
    r = await W(A, p, "x", null); expect(`invisible/format char refused: ${JSON.stringify(p)}`, !r.ok && /invalid_ref/.test(r.e), r.e ?? "accepted");
  }
  r = await W(A, "re\u0301sume\u0301.md", "x", null); expect("non-NFC (NFD) path refused", !r.ok && /invalid_ref/.test(r.e), r.e ?? "accepted");
  r = await W(A, "caf\u00e9.md", "x", null); expect("NFC path accepted", r.ok, r.e);
  r = await W(A, "plan.md/x.md", "x", null); expect("path under an existing file refused (path_conflict)", !r.ok && /path_conflict/.test(r.e), r.e ?? "accepted");
  r = await W(A, "log.md/x.md", "x", null); expect("folder log.md/ created", r.ok, r.e);
  r = await W(A, "log.md", "x", null); expect("file where a folder exists refused (path_conflict)", !r.ok && /path_conflict/.test(r.e), r.e ?? "accepted");
  r = await W(A, "PLAN.md", "x", null); expect("case variant of an existing file refused (path_conflict)", !r.ok && /path_conflict/.test(r.e), r.e ?? "accepted");
  r = await W(A, "documents/cv.pdf/x.md", "x", null); expect("text path under an existing bucket object refused", !r.ok && /path_conflict/.test(r.e), r.e ?? "accepted");
  r = await O(A, `users/${A}/ws/plan.md/x.pdf`); expect("bucket object under an existing text file refused", !r.ok, r.e);
  r = await O(A, `users/${A}/ws/x\u200c.pdf`); expect("bucket name with an invisible char refused", !r.ok, r.e);
  expect("ten_ws_write takes a per-user advisory lock (exact caps)", MIG.includes("pg_advisory_xact_lock(hashtextextended('ten_ws:' || v_uid::text, 0))"));
  await db.exec(`insert into public.ten_usage_ledger (user_id,kind,request_id,usd,created_at) values ('${B}','call','today-b',1.25,now()), ('${A}','call','yday-a',9,now() - interval '2 days')`);
  r = await as(db, null, "service_role", "select public.ten_beta_spend_today() s"); expect("ten_beta_spend_today sums today's calls across users only", r.ok && Number(r.rows[0].s) === 1.373456, r.rows ?? r.e);
  r = await as(db, A, "authenticated", "select public.ten_beta_spend_today() s"); expect("authenticated cannot run ten_beta_spend_today", !r.ok, r.e ?? r.rows);
  // the pin, from the migration: a later wide-open policy still leaks nothing
  await db.exec("create policy late_drift on storage.objects for all using (true) with check (true); create policy late_bucket on storage.buckets for all using (true) with check (true);");
  r = await as(db, B, "authenticated", "select count(*)::int n from storage.objects where bucket_id='ten-workspaces'"); expect("pin: B reads none of A's objects after a later wide-open policy", r.ok && r.rows[0].n === 0, r.rows ?? r.e);
  r = await as(db, null, "anon", "select count(*)::int n from storage.objects where bucket_id='ten-workspaces'"); expect("pin: anon reads none, and gets no error", r.ok && r.rows[0].n === 0, r.rows ?? r.e);
  r = await as(db, B, "authenticated", "update storage.buckets set public = true where id='ten-workspaces' returning id"); expect("pin: the bucket cannot be made public", !r.ok || r.rows.length === 0, r.rows ?? r.e);
  r = await as(db, null, "anon", "select count(*)::int n from storage.objects where bucket_id='avatars'"); expect("pin: other buckets unaffected (anon query runs)", r.ok, r.e);
}
// regex \x00 compiles?
{ const db = new PGlite(); const r = await run(db, "select 'a' !~ '(^/|^\\.|/\\.|\\x00)' as ok"); note("regex with \\x00 compiles", r.ok ? JSON.stringify(r.r[0].rows) : r.e); }
console.log(`\nfailures: ${failures}`);
if (failures) process.exitCode = 1; // M-new-3 (fix round 2)
