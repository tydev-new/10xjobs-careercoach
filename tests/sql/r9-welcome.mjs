// docs/design-web-agent.md § 20.11 (SQL): the FIFTH migration,
// 20261002000000_ten_welcome_credit.sql, applied AFTER the four applied ones
// on the same PGlite stand-in (stub.sql, whose auth.users gains nullable
// email and email_confirmed_at, § 20.10 (2)).
//   node r9-welcome.mjs
// PGlite is one connection, so item 12 (the settings row is locked `for
// update` before the count) is checked by reading the file's function body,
// the README's stated limit; every other item runs.
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const WT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const MIGS = [
  "20260923000000_ten_beta_init.sql",
  "20260924000000_ten_ledger_finish_reason.sql",
  "20260924100000_ten_conversations.sql",
  "20260925000000_ten_paypal_credit.sql",
].map((f) => readFileSync(`${WT}/supabase/migrations/${f}`, "utf8"));
const MIG5_NAME = "20261002000000_ten_welcome_credit.sql";
const MIG5 = readFileSync(`${WT}/supabase/migrations/${MIG5_NAME}`, "utf8");
const TEAR = readFileSync(`${WT}/supabase/teardown/ten_beta_teardown.sql`, "utf8");
const STUB = readFileSync(new URL("./stub.sql", import.meta.url), "utf8");

let fails = 0;
const failed = [];
const out = (t, m, d = "") => console.log(`[${t}] ${m}${d !== "" && d !== undefined ? "  -> " + (typeof d === "string" ? d : JSON.stringify(d)) : ""}`);
const expect = (m, c, d) => { out(c ? "PASS" : "FAIL", m, d); if (!c) { fails++; failed.push(m); } };

let seq = 0;
const uuid = () => `9a9a9a9a-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
async function run(db, sql) { try { await db.exec(sql); return { ok: true }; } catch (e) { try { await db.exec("rollback"); } catch {} return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } }
async function as(db, uid, role, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(uid ? { sub: uid, role } : { role })]);
  await db.exec(`set role ${role}`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } finally { await db.exec("reset role"); }
}
const svc = (db, sql, p) => as(db, null, "service_role", sql, p);
const sup = async (db, sql, p = []) => { await db.exec("reset role"); return (await db.query(sql, p)).rows; };

async function fresh({ cap = null, upTo = 5 } = {}) {
  // upTo 4: the four applied files only; 5: plus the welcome migration
  const db = new PGlite();
  await db.exec(STUB);
  for (const m of MIGS) await db.exec(m);
  if (upTo >= 5) await db.exec(MIG5);
  if (cap !== null) await db.exec(`update public.ten_welcome_settings set cap = ${cap}`);
  return db;
}
// A user with an email and (by default) a confirmation date.
async function mkUser(db, email, { confirmed = true } = {}) {
  const id = uuid();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)", [id, email, confirmed ? "2026-10-01T00:00:00Z" : null]);
  return id;
}
const claim = async (db, uid) => {
  const r = await as(db, uid, "authenticated", "select public.ten_claim_welcome() as r");
  return r.ok ? { ok: true, r: r.rows[0].r } : r;
};
const counts = async (db) => (await sup(db,
  "select (select count(*) from public.ten_usage_ledger where request_id like 'welcome:%')::int welcome, (select count(*) from public.ten_usage_ledger)::int ledger, (select count(*) from public.ten_welcome_claims)::int claims"))[0];

// The expected hash, computed independently with Node's crypto (§ 20.11 SQL 1).
function nodeHash(email) {
  let v = email.trim().toLowerCase();
  const at = v.lastIndexOf("@");
  let local = v.slice(0, at), domain = v.slice(at + 1);
  local = local.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") { local = local.replaceAll(".", ""); domain = "gmail.com"; }
  return createHash("sha256").update(`ten-welcome-v1:${local}@${domain}`, "utf8").digest("hex");
}

// ---- 0. order guard, apply, second run, the four objects
{
  // before the PayPal migration: apply only the first three
  let db = new PGlite();
  await db.exec(STUB);
  for (const m of MIGS.slice(0, 3)) await db.exec(m);
  let r = await run(db, MIG5);
  expect("the order guard refuses without the PayPal migration (no gross_usd on the ledger)", !r.ok && /gross_usd does not exist/.test(r.e), r.e);
  expect("a refused apply changes nothing (no welcome table)", (await sup(db, "select count(*)::int n from pg_tables where tablename like 'ten\\_welcome%'"))[0].n === 0);

  db = new PGlite();
  await db.exec(STUB);
  for (const m of MIGS) await db.exec(m);
  const before = {
    tables: (await sup(db, "select tablename from pg_tables where schemaname='public' and tablename like 'ten\\_%'")).map((x) => x.tablename),
    funcs: (await sup(db, "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'ten\\_%'")).map((x) => x.proname),
    pols: (await sup(db, "select count(*)::int n from pg_policies"))[0].n,
    trig: (await sup(db, "select count(*)::int n from pg_trigger where not tgisinternal"))[0].n,
  };
  r = await run(db, MIG5);
  expect("the fifth migration applies after the four applied ones", r.ok, r.e);
  const after = {
    tables: (await sup(db, "select tablename from pg_tables where schemaname='public' and tablename like 'ten\\_%'")).map((x) => x.tablename),
    funcs: (await sup(db, "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'ten\\_%'")).map((x) => x.proname),
    pols: (await sup(db, "select count(*)::int n from pg_policies"))[0].n,
    trig: (await sup(db, "select count(*)::int n from pg_trigger where not tgisinternal"))[0].n,
  };
  const newTables = after.tables.filter((t) => !before.tables.includes(t)).sort();
  const newFuncs = after.funcs.filter((t) => !before.funcs.includes(t)).sort();
  expect("it adds exactly two tables", JSON.stringify(newTables) === JSON.stringify(["ten_welcome_claims", "ten_welcome_settings"]), newTables);
  expect("it adds exactly two functions: no ceiling function (owner, 2026-10-02: no daily limit)", JSON.stringify(newFuncs) === JSON.stringify(["ten_claim_welcome", "ten_welcome_hash"]), newFuncs);
  expect("it adds no policy and no trigger (§ 20.9: no trigger on auth.users)", after.pols === before.pols && after.trig === before.trig, { before, after });
  r = await run(db, MIG5);
  expect("a second run is refused by its own guard", !r.ok && /already exists/.test(r.e), r.e);
  const fn = await sup(db, "select proname, prosecdef, provolatile, proconfig, pg_get_userbyid(proowner) = current_user as mine from pg_proc where proname in ('ten_claim_welcome','ten_welcome_hash') order by 1");
  const f = Object.fromEntries(fn.map((x) => [x.proname, x]));
  expect("ten_claim_welcome: security definer, search_path '', owned by the applying role", f.ten_claim_welcome.prosecdef && f.ten_claim_welcome.proconfig?.some((c) => /^search_path=("")?$/.test(c) || c === 'search_path=""') && f.ten_claim_welcome.mine, f.ten_claim_welcome);
  expect("ten_welcome_hash is immutable", f.ten_welcome_hash.provolatile === "i", f.ten_welcome_hash.provolatile);
  const s = (await sup(db, "select count(*)::int n, min(cap)::int cap, min(usd)::text usd from public.ten_welcome_settings"))[0];
  expect("the settings row ships at cap 0 and usd 1.00, one row", s.n === 1 && s.cap === 0 && s.usd === "1.00", s);
}

// ---- 1. the hash (§ 20.11 SQL 1)
{
  const db = await fresh();
  const h = async (e) => (await sup(db, "select public.ten_welcome_hash($1) h", [e]))[0].h;
  expect("A.B+x at GoogleMail.com == ab at gmail.com", (await h("A.B+x@GoogleMail.com")) === (await h("ab@gmail.com")));
  expect("a.b+x at example.com == a.b at example.com", (await h("a.b+x@example.com")) === (await h("a.b@example.com")));
  expect("a.b at example.com != ab at example.com (dots count outside gmail)", (await h("a.b@example.com")) !== (await h("ab@example.com")));
  expect("a padded upper-case address == its trimmed lower-case form", (await h("  Foo.Bar@Example.COM \t")) === (await h("foo.bar@example.com")));
  for (const e of ["A.B+x@GoogleMail.com", "ab@gmail.com", "a.b+x@example.com", "  Foo.Bar@Example.COM  ", "x@y@example.com", "j.o+hn+t@gmail.com", "ünï.cöde+z@Example.org", "a.b@googlemail.com", "plain@sub.gmail.com", "d.o.t@gmail.com.au"]) {
    const got = await h(e);
    expect(`hash(${JSON.stringify(e)}) equals Node's sha256 of ten-welcome-v1:<normalised>`, got === nodeHash(e) && /^[0-9a-f]{64}$/.test(got), { got, want: nodeHash(e) });
  }
  expect("a subdomain of gmail.com is NOT gmail (dots kept)", (await h("a.b@sub.gmail.com")) !== (await h("ab@sub.gmail.com")));
  expect("a null email hashes to null", (await sup(db, "select public.ten_welcome_hash(null) h"))[0].h === null);
}

// ---- 2. the grant (SQL 2) and 3. idempotency
{
  const db = await fresh({ cap: 100 });
  const u = await mkUser(db, "Grace.Hopper@Example.com");
  const r = await claim(db, u);
  expect("a confirmed user at cap 100 -> granted, usd 1.00", r.ok && r.r.status === "granted" && Number(r.r.usd) === 1, r);
  const rows = await sup(db, "select kind, usd::text, request_id, gross_usd, fee_usd, model, tokens_in, tokens_out, tokens_cached from public.ten_usage_ledger where user_id = $1", [u]);
  expect("exactly one ledger row: credit, 1.00, welcome:<uid>, no gross/fee/model, tokens 0",
    rows.length === 1 && rows[0].kind === "credit" && rows[0].usd === "1.000000" && rows[0].request_id === `welcome:${u}` && rows[0].gross_usd === null && rows[0].fee_usd === null && rows[0].model === null && rows[0].tokens_in + rows[0].tokens_out + rows[0].tokens_cached === 0, rows);
  const mem = (await as(db, u, "authenticated", "select public.ten_is_member() m, public.ten_balance()::text b")).rows[0];
  expect("as that user: ten_is_member() is true and ten_balance() is 1.00", mem.m === true && Number(mem.b) === 1, mem);
  const bf = (await svc(db, "select public.ten_balance_for($1)::text b", [u])).rows[0].b;
  expect("ten_balance_for (the proxy's read) is 1.00", Number(bf) === 1, bf);
  const c = await counts(db);
  expect("one claims row", c.claims === 1 && c.welcome === 1, c);
  const cols = (await sup(db, "select column_name from information_schema.columns where table_schema='public' and table_name='ten_welcome_claims'")).map((x) => x.column_name);
  expect("the claims table's only column is email_hash", cols.length === 1 && cols[0] === "email_hash", cols);
  const stored = (await sup(db, "select email_hash from public.ten_welcome_claims"))[0].email_hash;
  expect("the stored fingerprint is the independently computed hash", stored === nodeHash("Grace.Hopper@Example.com"), stored);
  expect("nothing in the claims table contains the address", !JSON.stringify(await sup(db, "select * from public.ten_welcome_claims")).toLowerCase().includes("hopper"));

  const again = await claim(db, u);
  expect("calling again -> already_member", again.ok && again.r.status === "already_member" && again.r.usd === undefined, again);
  const c2 = await counts(db);
  expect("still one row of each after the second call", c2.welcome === 1 && c2.claims === 1 && c2.ledger === 1, c2);

  const inv = await mkUser(db, "invited@example.com");
  await sup(db, "insert into public.ten_usage_ledger (user_id, kind, usd) values ($1, 'credit', 5.00)", [inv]);
  const ri = await claim(db, inv);
  expect("an invited user ($5 row, null request_id) -> already_member", ri.ok && ri.r.status === "already_member", ri);
  const c3 = await counts(db);
  expect("...with no claims row and no new ledger row", c3.claims === 1 && c3.welcome === 1 && c3.ledger === 2, c3);

  const paid = await mkUser(db, "paid@example.com");
  await sup(db, "insert into public.ten_usage_ledger (user_id, kind, request_id, usd, gross_usd, fee_usd) values ($1, 'credit', 'paypal:CAP1', 9.16, 10.00, 0.84)", [paid]);
  expect("a paid member -> already_member", (await claim(db, paid)).r?.status === "already_member");

  // an invited person who claimed $1 first and is invited later holds both rows
  const both = await mkUser(db, "both@example.com");
  expect("claim first -> granted", (await claim(db, both)).r?.status === "granted");
  await sup(db, "insert into public.ten_usage_ledger (user_id, kind, usd) values ($1, 'credit', 5.00)", [both]);
  const bal = (await as(db, both, "authenticated", "select public.ten_balance()::text b")).rows[0].b;
  expect("welcome first, invited later: both rows stand ($6.00)", Number(bal) === 6, bal);
}

// ---- 4. unconfirmed
{
  const db = await fresh({ cap: 100 });
  const a = await mkUser(db, "nobody@example.com", { confirmed: false });
  const b = uuid();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, null, now())", [b]);
  const c = uuid();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, '', now())", [c]);
  const d = uuid(); // a valid session for an id that has no auth.users row
  const before = await counts(db);
  for (const [name, uid] of [["null email_confirmed_at", a], ["null email", b], ["blank email", c], ["no auth.users row", d]]) {
    const r = await claim(db, uid);
    expect(`${name} -> unconfirmed`, r.ok && r.r.status === "unconfirmed", r);
  }
  expect("no rows written by any of them", JSON.stringify(await counts(db)) === JSON.stringify(before), await counts(db));
  // the answer comes from the table, not from the token's claims (rule 11)
  const r = await as(db, a, "authenticated", "select public.ten_claim_welcome() r", []);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: a, role: "authenticated", email: "nobody@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" })]);
  await db.exec("set role authenticated");
  const forged = (await db.query("select public.ten_claim_welcome() r")).rows[0].r;
  await db.exec("reset role");
  expect("a token CLAIMING a confirmed email changes nothing: the table decides", r.ok && forged.status === "unconfirmed", forged);
}

// ---- 5. one per inbox; 6. the claim survives deletion
{
  const db = await fresh({ cap: 100 });
  const first = await mkUser(db, "jo.hn@gmail.com");
  expect("the first account -> granted", (await claim(db, first)).r?.status === "granted");
  const before = await counts(db);
  const variants = ["john+promo@googlemail.com", "j.o.h.n@gmail.com", "JOHN@GMAIL.COM", "jo.hn+a+b@gmail.com", "J.o.H.n@GoogleMail.com"];
  for (const e of variants) {
    const u = await mkUser(db, e);
    const r = await claim(db, u);
    expect(`a second account on ${e} -> already_claimed`, r.ok && r.r.status === "already_claimed", r);
  }
  const ex = await mkUser(db, "pat@example.com");
  expect("a non-gmail first account -> granted", (await claim(db, ex)).r?.status === "granted");
  const ex2 = await mkUser(db, "pat+shopping@example.com");
  expect("a +tag on another domain -> already_claimed", (await claim(db, ex2)).r?.status === "already_claimed");
  const dots = await mkUser(db, "p.at@example.com");
  expect("dots outside gmail are a different inbox -> granted", (await claim(db, dots)).r?.status === "granted");
  const after = await counts(db);
  expect("refusals wrote nothing (only the two extra grants did)", after.claims === before.claims + 2 && after.welcome === before.welcome + 2 && after.ledger === before.ledger + 2, { before, after });

  // 6. deleting the first user
  const delRows = (await sup(db, "select count(*)::int n from public.ten_usage_ledger where user_id = $1", [first]))[0].n;
  await sup(db, "delete from auth.users where id = $1", [first]);
  const gone = (await sup(db, "select count(*)::int n from public.ten_usage_ledger where user_id = $1", [first]))[0].n;
  expect("deleting the account removes its ledger rows (on delete cascade)", delRows === 1 && gone === 0, { delRows, gone });
  const claims = (await sup(db, "select email_hash from public.ten_welcome_claims where email_hash = $1", [nodeHash("jo.hn@gmail.com")])).length;
  expect("...and keeps the claims row", claims === 1);
  const reborn = await mkUser(db, "john+again@gmail.com");
  const rr = await claim(db, reborn);
  expect("a new account on the same address -> already_claimed", rr.ok && rr.r.status === "already_claimed", rr);
  const total = (await sup(db, "select count(*)::int n from public.ten_welcome_claims"))[0].n;
  await sup(db, "update public.ten_welcome_settings set cap = $1", [total]);
  const fresh1 = await mkUser(db, "someone.new@example.com");
  const rp = await claim(db, fresh1);
  expect("the old claim still counts toward the cap (cap = claims -> paused)", rp.ok && rp.r.status === "paused", { total, rp });
}

// ---- 7. the cap
{
  const db = await fresh(); // as applied: cap 0
  const u = await mkUser(db, "early@example.com");
  const r0 = await claim(db, u);
  expect("as applied, cap is 0 -> paused", r0.ok && r0.r.status === "paused", r0);
  expect("...and nothing was written", JSON.stringify(await counts(db)) === JSON.stringify({ welcome: 0, ledger: 0, claims: 0 }), await counts(db));
  await sup(db, "update public.ten_welcome_settings set cap = 2");
  const a = await mkUser(db, "a1@example.com"), b = await mkUser(db, "b1@example.com"), c = await mkUser(db, "c1@example.com");
  expect("cap 2: first grant", (await claim(db, a)).r?.status === "granted");
  expect("cap 2: second grant", (await claim(db, b)).r?.status === "granted");
  const rc = await claim(db, c);
  expect("cap 2: a third address -> paused", rc.ok && rc.r.status === "paused", rc);
  expect("...with no rows for it", JSON.stringify(await counts(db)) === JSON.stringify({ welcome: 2, ledger: 2, claims: 2 }), await counts(db));
  const again = await claim(db, u);
  expect("the earlier refused account is still refused (paused) at the cap", again.r?.status === "paused", again);
  await sup(db, "update public.ten_welcome_settings set cap = 3");
  const rc2 = await claim(db, c);
  expect("raised to 3 -> granted", rc2.ok && rc2.r.status === "granted", rc2);
  await sup(db, "update public.ten_welcome_settings set cap = 0");
  const d = await mkUser(db, "d1@example.com");
  expect("cap back to 0 pauses at once", (await claim(db, d)).r?.status === "paused");
  expect("...and members stay members", (await claim(db, a)).r?.status === "already_member");
  // a missing settings row fails closed
  await sup(db, "delete from public.ten_welcome_settings");
  expect("a missing settings row fails closed (paused)", (await claim(db, d)).r?.status === "paused");
}

// ---- 8. the amount
{
  const db = await fresh({ cap: 100 });
  await sup(db, "update public.ten_welcome_settings set usd = 2.50");
  const u = await mkUser(db, "amount@example.com");
  const r = await claim(db, u);
  const row = (await sup(db, "select usd::text u from public.ten_usage_ledger where user_id = $1", [u]))[0];
  expect("usd 2.50 -> the reply carries 2.50", r.ok && r.r.status === "granted" && Number(r.r.usd) === 2.5, r);
  expect("...and the ledger row carries 2.50", Number(row.u) === 2.5, row);
  expect("...as a number in the reply, which prints as 2.50", JSON.stringify(r.r).includes('"usd": 2.50') || JSON.stringify(r.r).includes('"usd":2.5'), JSON.stringify(r.r));
  for (const bad of ["6", "0", "-1", "5.01", "100"]) {
    const x = await run(db, `update public.ten_welcome_settings set usd = ${bad}`);
    expect(`usd ${bad} is refused by the check`, !x.ok && /23514/.test(x.e), x.e);
  }
  const ok5 = await run(db, "update public.ten_welcome_settings set usd = 5");
  expect("usd 5 (the invited starter) is allowed", ok5.ok, ok5.e);
  const neg = await run(db, "update public.ten_welcome_settings set cap = -1");
  expect("cap -1 is refused by the check", !neg.ok && /23514/.test(neg.e), neg.e);
  const two = await run(db, "insert into public.ten_welcome_settings (id, cap, usd) values (false, 1, 1)");
  expect("a second settings row (id false) is refused", !two.ok && /23514/.test(two.e), two.e);
  const dup = await run(db, "insert into public.ten_welcome_settings (id, cap, usd) values (true, 1, 1)");
  expect("a second settings row (id true) is refused (primary key)", !dup.ok && /23505/.test(dup.e), dup.e);
  const hash = await run(db, "insert into public.ten_welcome_claims (email_hash) values ('NOT-A-HASH')");
  expect("the claims table refuses anything but 64 lowercase hex", !hash.ok && /23514/.test(hash.e), hash.e);
}

// ---- 9. access
{
  const db = await fresh({ cap: 100 });
  const u = await mkUser(db, "access@example.com");
  await claim(db, u);
  let r = await as(db, null, "anon", "select public.ten_claim_welcome()");
  expect("anon cannot execute ten_claim_welcome (42501)", !r.ok && /42501/.test(r.e), r.e ?? r.rows);
  for (const [name, sql] of [
    ["ten_welcome_hash", "select public.ten_welcome_hash('a@b.c')"],
  ]) {
    for (const role of ["authenticated", "anon"]) {
      r = await as(db, u, role, sql);
      expect(`${role} cannot execute ${name} (42501)`, !r.ok && /42501/.test(r.e), r.e ?? r.rows);
    }
  }
  for (const t of ["ten_welcome_settings", "ten_welcome_claims"]) {
    for (const [what, sql] of [
      ["select", `select * from public.${t}`],
      ["insert", t === "ten_welcome_claims" ? `insert into public.${t} (email_hash) values (repeat('a', 64))` : `insert into public.${t} (id, cap, usd) values (true, 1, 1)`],
      ["update", t === "ten_welcome_claims" ? `update public.${t} set email_hash = repeat('b', 64)` : `update public.${t} set cap = 1000`],
      ["delete", `delete from public.${t}`],
    ]) {
      for (const role of ["authenticated", "anon"]) {
        r = await as(db, u, role, sql);
        expect(`${role} cannot ${what} ${t} (42501)`, !r.ok && /42501/.test(r.e), r.e ?? r.rows);
      }
    }
  }
  r = await svc(db, "select count(*)::int n from public.ten_welcome_claims");
  expect("the service role can read the claims table", r.ok && r.rows[0].n === 1, r.e ?? r.rows);
  r = await as(db, null, "authenticated", "select public.ten_claim_welcome()");
  expect("an authenticated call with no sub -> PT401 not_signed_in", !r.ok && /PT401/.test(r.e) && /not_signed_in/.test(r.e), r.e ?? r.rows);
  r = await as(db, null, "service_role", "select public.ten_claim_welcome()");
  expect("a service-role call (no auth.uid()) cannot grant anything: PT401", !r.ok && /PT401/.test(r.e), r.e ?? r.rows);
  // acts only on auth.uid(): there is no argument to name another user
  const sig = (await sup(db, "select pg_get_function_arguments(oid) a from pg_proc where proname = 'ten_claim_welcome'"))[0].a;
  expect("ten_claim_welcome takes no argument", sig === "", sig);
  // a definer function can't be used to learn others' claims: reply never carries a hash
  const other = await mkUser(db, "other@example.com", { confirmed: false });
  const ro = await claim(db, other);
  expect("a refusal's reply carries only a status", ro.ok && JSON.stringify(Object.keys(ro.r)) === '["status"]', ro);
}

// ---- 10. the money checks stay valid
{
  const db = await fresh({ cap: 100 });
  const u = await mkUser(db, "money@example.com");
  let r = await svc(db, "insert into public.ten_usage_ledger (user_id, kind, request_id, usd, gross_usd, fee_usd) values ($1,'credit',$2,1.00,1.00,0.00)", [u, `welcome:${u}`]);
  expect("a welcome: row with gross_usd/fee_usd set is refused (the PayPal check)", !r.ok && /23514/.test(r.e), r.e);
  r = await svc(db, "insert into public.ten_usage_ledger (user_id, kind, request_id, usd, gross_usd) values ($1,'credit',$2,1.00,1.00)", [u, `welcome:${u}`]);
  expect("a welcome: row with gross_usd alone is refused too", !r.ok && /23514/.test(r.e), r.e);
  r = await svc(db, "insert into public.ten_usage_ledger (user_id, kind, request_id, usd) values ($1,'credit',$2,1.00)", [u, `welcome:${u}`]);
  expect("a plain welcome:<uid> credit row is accepted", r.ok, r.e);
  r = await svc(db, "insert into public.ten_usage_ledger (user_id, kind, request_id, usd) values ($1,'credit',$2,1.00)", [u, `welcome:${u}`]);
  expect("a second welcome:<uid> row is refused (unique request_id)", !r.ok && /23505/.test(r.e), r.e);
  const grant = await claim(db, u);
  expect("with the row already there, the function answers already_member and writes nothing", grant.r?.status === "already_member" && (await counts(db)).ledger === 1, grant);
  // a PayPal credit still works beside a welcome row
  r = await svc(db, "insert into public.ten_usage_ledger (user_id, kind, request_id, usd, gross_usd, fee_usd) values ($1,'credit','paypal:AFTER',9.16,10.00,0.84)", [u]);
  expect("a paypal: credit with a correct breakdown is still accepted", r.ok, r.e);
  const bal = (await as(db, u, "authenticated", "select public.ten_balance()::text b")).rows[0].b;
  expect("ten_balance adds the welcome row and the PayPal row (1.00 + 9.16)", Number(bal) === 10.16, bal);
}

// ---- 11. no daily ceiling (owner, 2026-10-02): the split-ceiling functions are not here
{
  const db = await fresh({ cap: 100 });
  const gone = (await sup(db, "select count(*)::int n from pg_proc where proname in ('ten_is_paid','ten_free_spend_today')"))[0].n;
  expect("ten_is_paid and ten_free_spend_today do not exist", gone === 0, gone);
  expect("the migration's code never mentions them (comments aside)", !/ten_is_paid|ten_free_spend_today/.test(MIG5.replace(/--.*$/gm, "")));
  // the applied view of all spend today is untouched and still service-only
  const u = await mkUser(db, "spend@example.com");
  await claim(db, u);
  await sup(db, "insert into public.ten_usage_ledger (user_id, kind, request_id, model, usd) values ($1,'call','g1','m',2.5)", [u]);
  const all = Number((await svc(db, "select public.ten_beta_spend_today()::text s")).rows[0].s);
  expect("ten_beta_spend_today() (applied earlier, unused by the proxy) still sums today's calls", all === 2.5, all);
  const r = await as(db, u, "authenticated", "select public.ten_beta_spend_today()");
  expect("...and a member still cannot call it (42501)", !r.ok && /42501/.test(r.e), r.e ?? r.rows);
  // a welcome row never carries a PayPal breakdown, so it is not a `paypal:` row
  const kinds = (await sup(db, "select count(*)::int n from public.ten_usage_ledger where request_id like 'paypal:%'"))[0].n;
  expect("a welcome grant writes no paypal: row", kinds === 0, kinds);
}

// ---- 12. the lock, by review of the file (PGlite runs one connection)
{
  const fn = MIG5.slice(MIG5.indexOf("create function public.ten_claim_welcome()"), MIG5.indexOf("-- 5. The split daily ceiling"));
  const body = fn.replace(/--.*$/gm, "");
  const iLock = body.indexOf("for update");
  const iHash = body.indexOf("public.ten_welcome_hash(");
  const iCount = body.indexOf("count(*) from public.ten_welcome_claims");
  const iInsertClaim = body.indexOf("insert into public.ten_welcome_claims");
  const iInsertLedger = body.indexOf("insert into public.ten_usage_ledger");
  const iEmail = body.indexOf("from auth.users");
  const iMember = body.indexOf("kind = 'credit'");
  expect("the function has one `for update`, on the settings row", (body.match(/for update/g) ?? []).length === 1 && /ten_welcome_settings s where s\.id for update/.test(body));
  expect("order: the lock comes before the hash, the count and both inserts", iLock > 0 && iLock < iHash && iHash < iCount && iCount < iInsertClaim && iInsertClaim < iInsertLedger, { iLock, iHash, iCount, iInsertClaim, iInsertLedger });
  expect("order: the membership test and the email read come before the lock", iMember > 0 && iMember < iEmail && iEmail < iLock, { iMember, iEmail, iLock });
  expect("membership is re-checked after the lock (a racing tab of the same account answers already_member)", body.indexOf("kind = 'credit'", iLock) > iLock);
  expect("the email is read from auth.users, never from the token's claims", !/request\.jwt|current_setting|auth\.jwt\(/.test(body));
}

// ---- 13. the teardown
{
  const db = await fresh({ cap: 100 });
  const u = await mkUser(db, "tear@example.com");
  await claim(db, u);
  await db.exec("begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id='ten-workspaces'; delete from storage.buckets where id='ten-workspaces'; commit;");
  const t = await run(db, TEAR);
  expect("the teardown runs after all five migrations (a welcome row is not a paypal: row)", t.ok, t.e);
  const left = (await sup(db,
    "select (select count(*) from pg_policy where polname like 'ten\\_%')::int p, (select count(*) from pg_proc where proname like 'ten\\_%')::int f, (select count(*) from pg_class where relname like 'ten\\_%')::int c"))[0];
  expect("nothing ten_ remains: both tables and every function are gone", left.p === 0 && left.f === 0 && left.c === 0, left);
  expect("the teardown header names the fifth file and the four objects", TEAR.slice(0, 2200).includes(MIG5_NAME) && ["ten_welcome_settings", "ten_welcome_claims", "ten_welcome_hash", "ten_claim_welcome"].every((n) => TEAR.slice(0, 2200).includes(n)));
  // teardown still works when this migration was never applied
  const old = await fresh({ upTo: 4 });
  await old.exec("begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id='ten-workspaces'; delete from storage.buckets where id='ten-workspaces'; commit;");
  const t2 = await run(old, TEAR);
  expect("the teardown also runs when the welcome migration was never applied", t2.ok, t2.e);
}

// ---- 14. the file's own promises
{
  const code = MIG5.replace(/--.*$/gm, "");
  expect("one transaction", /^\s*begin;/m.test(MIG5) && /^\s*commit;\s*$/m.test(MIG5));
  expect("3 s lock timeout", MIG5.includes("set local lock_timeout = '3s'"));
  expect("no policy, no trigger, nothing on auth.users is created or altered", !/create\s+policy|create\s+trigger|alter\s+table\s+auth\./i.test(code));
  expect("the header carries the owner queries of § 20.8 and § 20.12 (grants per day, all spend today, open, pause)",
    MIG5.includes("where request_id like 'welcome:%'") && MIG5.includes("select public.ten_beta_spend_today();") &&
    MIG5.includes("set cap = 100") && MIG5.includes("set cap = 0") && MIG5.includes("NOTIFY pgrst, 'reload schema'"));
  expect("the claims table has no email, user id or date column", !/create table public\.ten_welcome_claims \([^)]*(user_id|created_at|email\b)/i.test(code.replace(/\s+/g, " ")));
  expect("it ships closed: cap 0 and usd 1.00 are the inserted values", /insert into public\.ten_welcome_settings \(id, cap, usd\) values \(true, 0, 1\.00\)/.test(code));
}

console.log(`\nr9 (welcome credit migration) failures: ${fails}`);
if (fails) { console.log("failed:\n  " + failed.join("\n  ")); process.exitCode = 1; }
