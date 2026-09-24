// Reviewer's round-3 cases, independent of tests/sql/*.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const WT = "/Users/yongtian/Documents/PROJECTS/10xjobs-careercoach/.claude/worktrees/agent-af786d047289be04c";
const MIG = readFileSync(`${WT}/supabase/migrations/20260923000000_ten_beta_init.sql`, "utf8");
const TEAR = readFileSync(`${WT}/supabase/teardown/ten_beta_teardown.sql`, "utf8");
const STUB = readFileSync(`${WT}/tests/sql/stub.sql`, "utf8");
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
const plant = (db, uid, rel) => db.exec(`insert into storage.objects (bucket_id, name, owner) values ('ten-workspaces', 'users/${uid}/ws/${rel}', '${uid}')`);
const count = async (db, uid, role, bucket = "ten-workspaces") => { const r = await as(db, uid, role, "select count(*)::int n from storage.objects where bucket_id=$1", [bucket]); return r.ok ? r.rows[0].n : r.e; };

// 1. Guard allowlist: new bypass attempts. Each unsafe one must be refused.
for (const [label, pol, unsafe] of [
  ["AND then OR at top", "create policy g on storage.objects for select using ((bucket_id = 'avatars' and true) or true);", true],
  ["AND-first then = false", "create policy g on storage.objects for select using ((bucket_id = 'avatars' and true) = false);", true],
  ["quote-smuggled literal", "create policy g on storage.objects for select using (bucket_id = 'a''::text) AND (true');", true],
  ["NOT around AND", "create policy g on storage.objects for select using (not (bucket_id = 'avatars' and false));", true],
  ["sub-select", "create policy g on storage.objects for select using ((select bucket_id = 'avatars'));", true],
  ["COALESCE", "create policy g on storage.objects for select using (coalesce(bucket_id = 'avatars', true));", true],
  ["function wrapper", "create policy g on storage.objects for select using (pg_catalog.bool_or_dummy_missing is null);", "skip"],
  ["collation on the literal (safe, refused?)", "create policy g on storage.objects for select using (bucket_id = 'avatars' collate \"C\");", false],
  ["AND with an inner OR (safe)", "create policy g on storage.objects for select using (bucket_id = 'avatars' and (owner = auth.uid() or true));", false],
  ["scoped to ten-workspaces itself, TO anon", "create policy g on storage.objects for select to anon using (bucket_id = 'ten-workspaces');", "pin"],
  ["scoped to ten-workspaces, insert WITH CHECK, authenticated", "create policy g on storage.objects for insert to authenticated with check (bucket_id = 'ten-workspaces');", "pin"],
  ["buckets policy FOR SELECT (not checked)", "create policy g on storage.buckets for select using (true);", false],
]) {
  if (unsafe === "skip") continue;
  const db = await fresh(pol); const m = await run(db, MIG);
  if (!m.ok) { out(unsafe === true ? "PASS" : "NOTE", `guard refuses: ${label}`, m.e.slice(0, 80)); continue; }
  if (unsafe === true) { expect(`guard refuses: ${label}`, false, "APPLIED"); continue; }
  await credit(db, A, B); await plant(db, A, "documents/cv.pdf");
  const b = await count(db, B, "authenticated"), an = await count(db, null, "anon");
  if (unsafe === "pin") {
    expect(`accepted (${label}); the pin still stops B and anon`, b === 0 && an === 0, `B ${b}, anon ${an}`);
    const ins = await as(db, B, "authenticated", `insert into storage.objects (bucket_id,name,owner) values ('ten-workspaces','users/${A}/ws/documents/x.pdf','${B}')`);
    expect(`  and B cannot plant into A's folder`, !ins.ok, ins.e);
  } else expect(`guard accepts safe: ${label}`, b === 0 && an === 0, `B ${b}, anon ${an}`);
}

// 2. Pins against later drift, all commands, anon errors, other buckets.
{
  const db = await fresh(); const m = await run(db, MIG); expect("migration applies", m.ok, m.e);
  await credit(db, A, B); await plant(db, A, "documents/cv.pdf");
  await db.exec(`insert into storage.buckets (id,name,public) values ('docs','docs',false);
    insert into storage.objects (bucket_id,name,owner) values ('avatars','x/${B}.png','${B}'),('docs','d/${N}.pdf','${N}');`);
  await db.exec(`create policy drift_all on storage.objects for all to public using (true) with check (true);
    create policy drift_b on storage.buckets for all to public using (true) with check (true);`);
  expect("drift: B reads none of A's", (await count(db, B, "authenticated")) === 0);
  expect("drift: anon reads none, no error", (await count(db, null, "anon")) === 0);
  expect("drift: non-member reads none", (await count(db, N, "authenticated")) === 0);
  expect("drift: A reads her own", (await count(db, A, "authenticated")) === 1);
  expect("drift: other buckets fully open as the later policy says (avatars, anon)", (await count(db, null, "anon", "avatars")) === 1);
  expect("drift: other buckets (docs, B)", (await count(db, B, "authenticated", "docs")) === 1);
  let r = await as(db, null, "anon", "select bucket_id, count(*)::int n from storage.objects group by 1 order by 1"); expect("anon scan across all buckets does not error", r.ok, r.rows ?? r.e);
  r = await as(db, B, "authenticated", `update storage.objects set name = 'users/${B}/ws/documents/stolen.pdf' where bucket_id='ten-workspaces' returning name`); expect("drift: B cannot move A's object into B's folder", r.ok && r.rows.length === 0, r.rows ?? r.e);
  r = await as(db, B, "authenticated", `update storage.objects set bucket_id='ten-workspaces', name='users/${A}/ws/documents/p.pdf' where bucket_id='avatars' returning name`); expect("drift: B cannot move an avatar into A's folder", !r.ok || r.rows.length === 0, r.rows ?? r.e);
  r = await as(db, A, "authenticated", `update storage.objects set name='users/${B}/ws/documents/gift.pdf' where bucket_id='ten-workspaces' returning name`); expect("drift: A cannot move her own object into B's folder", !r.ok || r.rows.length === 0, r.rows ?? r.e);
  r = await as(db, B, "authenticated", "update storage.buckets set public = true where id='ten-workspaces' returning id"); expect("drift: bucket cannot go public", !r.ok || r.rows.length === 0, r.rows ?? r.e);
  r = await as(db, null, "anon", "update storage.buckets set public = true where id='ten-workspaces' returning id"); expect("drift: anon cannot make it public", !r.ok || r.rows.length === 0, r.rows ?? r.e);
  r = await as(db, B, "authenticated", "update storage.buckets set public = true where id='docs' returning id"); expect("drift: other buckets still follow the later policy", r.ok && r.rows.length === 1, r.rows ?? r.e);
  r = await as(db, null, "anon", `insert into storage.objects (bucket_id,name) values ('avatars','anon/new.png') returning name`); expect("drift: anon insert into avatars works (pin does not error)", r.ok, r.e);
  const pins = (await db.query("select polname, pg_get_expr(polqual, polrelid) q, pg_get_expr(polwithcheck, polrelid) w from pg_policy where polname like 'ten\\_%pin%' order by 1")).rows;
  const funcs = pins.flatMap((p) => ((p.q ?? "") + (p.w ?? "")).match(/[a-z_\.]+\(/g) ?? []);
  note("functions called in the pins", [...new Set(funcs)]);
  expect("pins call no ten_ function", !funcs.some((f) => f.includes("ten_")));
}

// 3. ten_path_ok: every Cf / ignorable class, NFC, and ordinary non-ASCII.
{
  const db = await fresh(); await run(db, MIG);
  const bad = [0xad, 0x600, 0x61c, 0x6dd, 0x70f, 0x890, 0x8e2, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202e, 0x2060, 0x2064, 0x2066, 0x206a, 0x206f, 0xfeff, 0xfff9, 0x110bd, 0x13430, 0x1343f, 0x1bca0, 0x1d173, 0xe0001, 0xe0041, 0x7f, 0x85, 0x9f];
  const leaks = [];
  for (const cp of bad) { const p = `a${String.fromCodePoint(cp)}b.md`; const r = await db.query("select public.ten_path_ok($1) ok", [p]); if (r.rows[0].ok) leaks.push(cp.toString(16)); }
  expect(`ten_path_ok refuses all ${bad.length} format/ignorable/control code points tried`, leaks.length === 0, leaks);
  const good = ["résumé.md", "履歴書.md", "notes 😀.md", "ملف.md", "a⁥b.md", "café/plan.md", "a️b.md"];
  for (const p of good) { const r = await db.query("select public.ten_path_ok($1) ok", [p]); note(`ten_path_ok ${JSON.stringify(p)}`, r.rows[0].ok); }
  const nfd = "résumé.md"; let r = await db.query("select public.ten_path_ok($1) ok", [nfd]); expect("NFD refused", r.rows[0].ok === false);
  r = await db.query("select public.ten_path_ok(null) a, public.ten_path_ok('') b, public.ten_path_ok(repeat('a',509)||'.md') c, public.ten_path_ok(repeat('a',510)||'.md') d");
  expect("null, empty, 512 ok, 513 refused", r.rows[0].a === false && r.rows[0].b === false && r.rows[0].c === true && r.rows[0].d === false, r.rows[0]);
  const nonAsciiCode = MIG.split("\n").filter((l) => !/^\s*--/.test(l) && /[^\x00-\x7f]/.test(l));
  expect("no non-ASCII byte outside comments in the migration", nonAsciiCode.length === 0, nonAsciiCode);
  r = await as(db, null, "anon", "select public.ten_path_ok('a.md')"); expect("anon cannot call ten_path_ok", !r.ok, r.e);
}

// 4. ten_path_clash across table and bucket, cases, and codes.
{
  const db = await fresh(); await run(db, MIG); await credit(db, A, B);
  const W = (uid, p, c = "x", e = null) => as(db, uid, "authenticated", "select * from public.ten_ws_write($1,$2,$3)", [p, c, e]);
  const O = (uid, rel) => as(db, uid, "authenticated", "insert into storage.objects (bucket_id,name,owner) values ('ten-workspaces',$1,$2) returning name", [`users/${uid}/ws/${rel}`, uid]);
  await W(A, "plan.md"); await W(A, "Notes/a.md"); await W(A, "x.md/y.md"); await O(A, "documents/CV.pdf"); await O(A, "doc.md/z.pdf");
  const cases = [
    ["text under a text file", () => W(A, "plan.md/x.md"), /path_conflict/],
    ["text under a text file, other case", () => W(A, "PLAN.md/x.md"), /path_conflict/],
    ["text case variant of a text file", () => W(A, "Plan.md"), /path_conflict/],
    ["text that is a folder of a text path", () => W(A, "x.md"), /path_conflict/],
    ["text that is a folder of an object path", () => W(A, "doc.md"), /path_conflict/],
    ["text that is a folder of an object path, other case", () => W(A, "DOC.md"), /path_conflict/],
    ["same path again (right code)", () => W(A, "plan.md"), /already_exists/],
    ["object under a text file", () => O(A, "plan.md/q.pdf"), /row-level security/],
    ["object case variant of an object", () => O(A, "documents/cv.pdf"), /row-level security/],
    ["B is not blocked by A's names", () => W(B, "plan.md/x.md"), null],
    ["B object not blocked by A's objects", () => O(B, "documents/cv.pdf"), null],
    ["folder case variant (Notes vs notes)", () => W(A, "notes/b.md"), "obs"],
  ];
  for (const [lab, f, want] of cases) { const r = await f(); if (want === "obs") note(lab, r.ok ? "ACCEPTED" : r.e); else if (want === null) expect(lab, r.ok, r.e); else expect(lab, !r.ok && want.test(r.e), r.ok ? "ACCEPTED" : r.e); }
  let r = await as(db, N, "authenticated", "select public.ten_path_clash('plan.md') c"); expect("non-member ten_path_clash -> false", r.ok && r.rows[0].c === false, r.rows ?? r.e);
  r = await as(db, B, "authenticated", "select public.ten_path_clash('plan.md/x.md') c"); expect("B cannot probe A's names", r.ok && r.rows[0].c === false, r.rows ?? r.e);
  r = await as(db, A, "authenticated", "select public.ten_path_clash($1) c", ["%/_"]); expect("LIKE wildcards are not special", r.ok && r.rows[0].c === false, r.rows ?? r.e);
}

// 5. ten_beta_spend_today: grants, UTC boundary, index use.
{
  const db = await fresh(); await run(db, MIG); await credit(db, A);
  await db.exec(`insert into public.ten_usage_ledger (user_id,kind,request_id,usd,created_at) values
    ('${A}','call','y1',1.0, date_trunc('day', now() at time zone 'utc') at time zone 'utc' - interval '1 second'),
    ('${A}','call','t1',0.25, date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
    ('${A}','call','t2',0.5, now())`);
  for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    await db.exec(`set timezone = '${tz}'`);
    const r = await as(db, null, "service_role", "select public.ten_beta_spend_today() s"); expect(`spend today = 0.75 with session TimeZone ${tz}`, r.ok && Number(r.rows[0].s) === 0.75, r.rows ?? r.e);
  }
  await db.exec("reset timezone");
  for (const [who, uid, role] of [["authenticated member", A, "authenticated"], ["anon", null, "anon"]]) { const r = await as(db, uid, role, "select public.ten_beta_spend_today() s"); expect(`${who} cannot call ten_beta_spend_today`, !r.ok, r.e ?? r.rows); }
  await db.exec(`insert into public.ten_usage_ledger (user_id,kind,request_id,usd,created_at) select '${A}','call','bulk'||g, 0.001, now() - (g||' minutes')::interval from generate_series(1,20000) g; analyze public.ten_usage_ledger;`);
  const plan = (await db.query("explain select coalesce(sum(usd),0) from public.ten_usage_ledger where kind = 'call' and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')")).rows.map((x) => x["QUERY PLAN"]).join(" | ");
  note("plan of the function's query (20k call rows)", plan);
  expect("uses the partial call-day index", /ten_usage_ledger_call_day_idx/.test(plan), plan);
}

// 6. Teardown with everything populated, triggers ON after the API step; catalog clean.
{
  const db = await fresh(); const m = await run(db, MIG); await credit(db, A);
  await as(db, A, "authenticated", "select * from public.ten_ws_write('plan.md','x',null)"); await plant(db, A, "documents/cv.pdf");
  const t0 = await run(db, TEAR); expect("teardown refuses before the API step", !t0.ok && /Storage API first/.test(t0.e), t0.e);
  await db.exec("begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id='ten-workspaces'; delete from storage.buckets where id='ten-workspaces'; commit;");
  const t = await run(db, TEAR); expect("teardown runs (triggers ON)", t.ok, t.e);
  const left = (await db.query("select (select count(*) from pg_policy where polname like 'ten\\_%')::int p, (select count(*) from pg_proc where proname like 'ten\\_%')::int f, (select count(*) from pg_class where relname like 'ten\\_%')::int c")).rows[0];
  expect("nothing ten_ remains (policies, functions, relations incl. indexes)", left.p === 0 && left.f === 0 && left.c === 0, left);
}
console.log(`\nround-3 own-case failures: ${fails}`);
if (fails) process.exitCode = 1; // M-new-3 (fix round 2)
