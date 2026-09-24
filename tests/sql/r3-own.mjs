// Reviewer's own cases for the fix round (independent of run-r2.mjs).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const WT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");  // the repo root
const MIG = readFileSync(`${WT}/supabase/migrations/20260923000000_ten_beta_init.sql`, "utf8");
const TEAR = readFileSync(`${WT}/supabase/teardown/ten_beta_teardown.sql`, "utf8");
const STUB = readFileSync(new URL("./stub.sql", import.meta.url), "utf8");
const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "bbbbbbbb-0000-0000-0000-000000000002", N = "cccccccc-0000-0000-0000-000000000003";
let fails = 0;
const out = (t, m, d = "") => console.log(`[${t}] ${m}${d !== "" ? "  -> " + (typeof d === "string" ? d : JSON.stringify(d)) : ""}`);
const expect = (m, c, d) => { out(c ? "PASS" : "FAIL", m, d); if (!c) fails++; };
const note = (m, d) => out("OBS", m, d);
async function fresh(pre = "") { const db = new PGlite(); await db.exec(STUB); if (pre) await db.exec(pre); await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${N}')`); return db; }
async function run(db, sql) { try { await db.exec(sql); return { ok: true }; } catch (e) { try { await db.exec("rollback"); } catch {} return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } }
async function as(db, uid, role, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [uid ? JSON.stringify({ sub: uid, role }) : ""]);
  await db.exec(`set role ${role}`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } finally { await db.exec("reset role"); }
}
const credit = (db, ...u) => db.exec(`insert into public.ten_usage_ledger (user_id, kind, usd) values ${u.map((x) => `('${x}','credit',5)`).join(",")}`);
const plant = (db, uid, name) => db.exec(`insert into storage.objects (bucket_id, name, owner) values ('ten-workspaces', '${name}', '${uid}')`);

// 1. Teardown against the current files, Storage API step simulated, triggers ON.
{
  const db = await fresh(); const m = await run(db, MIG); expect("migration applies", m.ok, m.e);
  await db.exec("begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id='ten-workspaces'; delete from storage.buckets where id='ten-workspaces'; commit;");
  const t = await run(db, TEAR); expect("teardown runs after the Storage API step", t.ok, t.e);
  const left = (await db.query("select count(*)::int n from pg_policies where policyname like 'ten\\_%'")).rows[0].n;
  note("ten_ policies left after the teardown attempt", left);
}
// 2. Guard bypasses. Each: does the guard refuse? If not, who can read A's object?
const cases = [
  ["nested parens (legit)", "create policy g on storage.objects for select using ((((bucket_id = 'avatars'))));", false],
  ["CASE that is always true", "create policy g on storage.objects for select using (case when bucket_id = 'avatars' then true else true end);", true],
  ["(bucket_id = 'avatars') = false", "create policy g on storage.objects for select using ((bucket_id = 'avatars') = false);", true],
  ["(bucket_id = 'avatars') IS DISTINCT FROM true", "create policy g on storage.objects for select using ((bucket_id = 'avatars') is distinct from true);", true],
  ["boolean = (auth.uid() is null)", "create policy g on storage.objects for select using ((bucket_id = 'avatars') = (auth.uid() is null));", true],
  ["filter only inside a string literal", "create policy g on storage.objects for select using (coalesce(owner_id, 'bucket_id = ''x''') is not distinct from owner_id or true);", true],
  ["literal-only, no OR", "create policy g on storage.objects for select using (length('bucket_id = ''x''') > 0);", true],
  ["CASE bypass, TO anon (no sign-in at all)", "create policy g on storage.objects for select to anon using (case when bucket_id = 'avatars' then true else true end);", true],
  ["RESTRICTIVE, no bucket filter", "create policy g on storage.objects as restrictive for select using (auth.uid() is not null);", "either"],
  ["RESTRICTIVE, other bucket only", "create policy g on storage.objects as restrictive for select using (bucket_id = 'avatars');", "either"],
  ["IN list (legit)", "create policy g on storage.objects for select using (bucket_id in ('avatars','docs'));", false],
];
for (const [label, pol, unsafe] of cases) {
  const db = await fresh(pol); const m = await run(db, MIG);
  if (!m.ok) { out(unsafe === false ? "NOTE" : "PASS", `guard refuses: ${label}`, m.e.slice(0, 90)); if (unsafe === false) note("  (false positive: a safe policy is refused)", ""); continue; }
  await credit(db, A, B); await plant(db, A, `users/${A}/ws/documents/cv.pdf`);
  const rb = await as(db, B, "authenticated", "select count(*)::int n from storage.objects where bucket_id='ten-workspaces'");
  const ra = await as(db, null, "anon", "select count(*)::int n from storage.objects where bucket_id='ten-workspaces'");
  const rA = await as(db, A, "authenticated", "select count(*)::int n from storage.objects where bucket_id='ten-workspaces'");
  const leak = (rb.rows?.[0]?.n ?? 0) > 0 || (ra.rows?.[0]?.n ?? 0) > 0;
  if (unsafe === true) expect(`guard refuses: ${label}`, false, `APPLIED; B sees ${rb.rows?.[0]?.n}, anon sees ${ra.rows?.[0]?.n} of A's objects`);
  else if (unsafe === false) expect(`guard accepts safe policy: ${label}`, !leak, `B sees ${rb.rows?.[0]?.n}, anon ${ra.rows?.[0]?.n}`);
  else note(`guard accepted ${label}`, `B sees ${rb.rows?.[0]?.n}, anon ${ra.rows?.[0]?.n}, A sees her own: ${rA.rows?.[0]?.n}`);
}
// 3. Path rules: lookalikes, normalization, trailing chars, file/dir collisions.
{
  const db = await fresh(); await run(db, MIG); await credit(db, A);
  const W = (p, c = "x", e = null) => as(db, A, "authenticated", "select * from public.ten_ws_write($1,$2,$3)", [p, c, e]);
  const nfc = "résumé.md", nfd = "résumé.md";
  for (const p of ["CLAUDE.md", "ｃlaude.md", "CLAUDE．md", "сlaude.md", "CLAUDE.md ", "CLAUDE.md.", " CLAUDE.md", "CLA​UDE.md", "CLAUDE.md/x.md", "docs/Claude.MD",
    "sKills/x.md", "ｓkills/x.md", "skills./x.md", "skills /x.md", "plan.md", "plan.md/x.md", nfc, nfd, "report‮txt.md", "CLA\u200cUDE.md", "\ufeffCLAUDE.md", "CLAUDE\u200d.md", "a/./b.md", "./a.md", "a/b/../../CLAUDE.md", "\u0000.md"]) {
    const r = await W(p); note(`write ${JSON.stringify(p)}`, r.ok ? "ACCEPTED" : r.e.slice(0, 70));
  }
  const kel = (await db.query("select lower('SKILLS') l, (select datctype from pg_database where datname = current_database()) c")).rows[0]; note("lower() of Kelvin-sign SKILLS in this DB", kel);
  const nf = (await db.query("select $1::text is nfc normalized a, $2::text is nfc normalized b", [nfc, nfd])).rows[0]; note("server-side IS NFC NORMALIZED works (NFC, NFD)", nf);
  const both = (await db.query("select count(*)::int n from public.ten_ws_files where path in ($1,$2)", [nfc, nfd])).rows[0].n; note("NFC and NFD résumé.md stored as two rows", both);
  // error codes that reach the client as raw constraint names
  const H = "sha256:" + "a".repeat(64);
  for (const [lab, sql, params] of [
    ["gate label 81 chars", "select public.ten_gate_open(gen_random_uuid(),'c',repeat('x',81),$1,'l',1)", [H]],
    ["gate text_hash malformed", "select public.ten_gate_open(gen_random_uuid(),'c','l','sha256:XYZ','l',1)", []],
    ["gate amount 0", "select public.ten_gate_open(gen_random_uuid(),'c','l',$1,'l',0)", [H]],
    ["ws_write null content", "select * from public.ten_ws_write('n.md', null, null)", []],
  ]) { const r = await as(db, A, "authenticated", sql, params); note(`error shape: ${lab}`, r.ok ? "ACCEPTED" : r.e.slice(0, 90)); }
}
// 4. Membership on every ten_ read and write (N = signed in, no credit row).
{
  const db = await fresh(); await run(db, MIG); await credit(db, A);
  await db.exec(`insert into public.ten_ws_files (user_id,path,content,version) values ('${N}','n.md','x','v');
    insert into public.ten_gate_log (id,user_id,chat_id,kind,label,text_hash,gate_line,amount_usd) values (gen_random_uuid(),'${N}','c','spend','l','sha256:${"a".repeat(64)}','g',1);
    insert into public.ten_usage_ledger (user_id,kind,request_id,usd) values ('${N}','call','r1',0.5);`);
  await plant(db, N, `users/${N}/ws/documents/n.pdf`);
  const H = "sha256:" + "a".repeat(64);
  const checks = [
    ["select ten_ws_files", "select count(*)::int n from public.ten_ws_files", (r) => r.ok && r.rows[0].n === 0],
    ["select ten_gate_log", "select count(*)::int n from public.ten_gate_log", (r) => r.ok && r.rows[0].n === 0],
    ["select storage objects (own folder)", "select count(*)::int n from storage.objects where bucket_id='ten-workspaces'", (r) => r.ok && r.rows[0].n === 0],
    ["ten_ws_write", "select * from public.ten_ws_write('a.md','x',null)", (r) => !r.ok && /not_a_member/.test(r.e)],
    ["ten_gate_open", `select public.ten_gate_open(gen_random_uuid(),'c','l','${H}','g',1)`, (r) => !r.ok && /not_a_member/.test(r.e)],
    ["ten_gate_decide", "select public.ten_gate_decide(gen_random_uuid(),'declined','no')", (r) => !r.ok && /not_a_member/.test(r.e)],
    ["ten_gate_expire_other_chats", "select public.ten_gate_expire_other_chats('c')", (r) => !r.ok && /not_a_member/.test(r.e)],
    ["storage insert", `insert into storage.objects (bucket_id,name,owner) values ('ten-workspaces','users/${N}/ws/x.pdf','${N}')`, (r) => !r.ok],
  ];
  for (const [lab, sql, ok] of checks) { const r = await as(db, N, "authenticated", sql); expect(`non-member refused: ${lab}`, ok(r), r.rows ?? r.e); }
  for (const [lab, sql] of [["select own ledger rows (documented exception)", "select count(*)::int n from public.ten_usage_ledger"], ["ten_balance()", "select public.ten_balance() b"], ["ten_object_count()", "select public.ten_object_count() n"], ["ten_is_member()", "select public.ten_is_member() m"]]) {
    const r = await as(db, N, "authenticated", sql); note(`non-member ${lab}`, r.rows ?? r.e);
  }
  for (const f of ["ten_is_member()", "ten_balance()", "ten_object_count()", "ten_balance_for('" + A + "')", "ten_gate_expire_other_chats('c')"]) {
    const r = await as(db, null, "anon", `select public.${f}`); expect(`anon refused: ${f}`, !r.ok, r.e ?? r.rows);
  }
  const r = await as(db, A, "authenticated", `select public.ten_balance_for('${N}') b`); expect("authenticated refused: ten_balance_for", !r.ok, r.e ?? r.rows);
}

// 5. Proposal check: a RESTRICTIVE pin on the bucket defeats every guard bypass above, now and after apply.
{
  const PIN = `create policy ten_ws_objects_pin on storage.objects as restrictive for all to public
    using (bucket_id <> 'ten-workspaces' or ((storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = (select auth.uid()::text)))
    with check (bucket_id <> 'ten-workspaces' or ((storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = (select auth.uid()::text)));
    create policy ten_bucket_pin_update on storage.buckets as restrictive for update to public using (id <> 'ten-workspaces');
    create policy ten_bucket_pin_delete on storage.buckets as restrictive for delete to public using (id <> 'ten-workspaces');`;
  const db = await fresh(); await run(db, MIG); if (!MIG.includes("ten_ws_objects_pin")) await db.exec(PIN);  // the pin now ships in the migration
  await credit(db, A, B);
  await plant(db, A, `users/${A}/ws/documents/cv.pdf`); await db.exec(`insert into storage.objects (bucket_id,name,owner) values ('avatars','x/${B}.png','${B}')`);
  // an old-app policy added AFTER apply (drift), the worst bypass from section 2, to anon and authenticated
  await db.exec("create policy late_drift on storage.objects for all using (case when bucket_id = 'avatars' then true else true end) with check (true); create policy late_bucket on storage.buckets for all using (true) with check (true);");
  let r = await as(db, B, "authenticated", "select count(*)::int n from storage.objects where bucket_id='ten-workspaces'"); expect("pin: B cannot read A's object despite a later wide-open policy", r.ok && r.rows[0].n === 0, r.rows ?? r.e);
  r = await as(db, null, "anon", "select count(*)::int n from storage.objects where bucket_id='ten-workspaces'"); expect("pin: anon cannot read it either", r.ok && r.rows[0].n === 0, r.rows ?? r.e);
  r = await as(db, A, "authenticated", "select count(*)::int n from storage.objects where bucket_id='ten-workspaces'"); expect("pin: A still reads her own", r.ok && r.rows[0].n === 1, r.rows ?? r.e);
  r = await as(db, B, "authenticated", `insert into storage.objects (bucket_id,name,owner) values ('ten-workspaces','users/${A}/ws/p.pdf','${B}')`); expect("pin: B cannot plant into A's folder", !r.ok, r.e);
  r = await as(db, B, "authenticated", "update storage.buckets set public = true where id = 'ten-workspaces' returning id"); expect("pin: nobody can flip the bucket public", !r.ok || r.rows.length === 0, r.rows ?? r.e);
  r = await as(db, B, "authenticated", "select count(*)::int n from storage.objects where bucket_id='avatars'"); expect("pin: the old app's avatars access is unchanged", r.ok && r.rows[0].n === 1, r.rows ?? r.e);
}
console.log(`\nown-case failures: ${fails}`);
if (fails) process.exitCode = 1; // M-new-3 (fix round 2)
