// Independent tester's cases for design-web-agent.md § 20 (open sign-up, the
// welcome credit), written from § 20.1 / § 20.2 / § 20.3 / § 20.11 and
// PRINCIPLES rule 9 (amended 2026-10-02), NOT from the builder's r9 file.
//   node r10-welcome-tester.mjs
// PGlite (one connection) on stub.sql, all five migrations in order. The real
// two-connection race is tests/sql/race/r10-race.mjs (real Postgres 17).
//
// Lines:
//   [PASS]/[FAIL]  the spec gives one right answer and the code was checked against it
//   [OBSERVED]     the spec gives no answer (an edge the normalisation rule does
//                  not name); reported for the lead, never counted as a failure
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const WT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const MIGS = [
  "20260923000000_ten_beta_init.sql",
  "20260924000000_ten_ledger_finish_reason.sql",
  "20260924100000_ten_conversations.sql",
  "20260925000000_ten_paypal_credit.sql",
  "20261002000000_ten_welcome_credit.sql",
].map((f) => readFileSync(`${WT}/supabase/migrations/${f}`, "utf8"));
const TEAR = readFileSync(`${WT}/supabase/teardown/ten_beta_teardown.sql`, "utf8");
const STUB = readFileSync(new URL("./stub.sql", import.meta.url), "utf8");

let fails = 0;
const failed = [];
const out = (t, m, d) => console.log(`[${t}] ${m}${d === undefined ? "" : "  -> " + (typeof d === "string" ? d : JSON.stringify(d))}`);
const expect = (m, c, d) => { out(c ? "PASS" : "FAIL", m, d); if (!c) { fails++; failed.push(m); } };
const observe = (m, d) => out("OBSERVED", m, d);

let seq = 0;
const uuid = () => `7e7e7e7e-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

async function fresh(cap = 100) {
  const db = new PGlite();
  await db.exec(STUB);
  for (const m of MIGS) await db.exec(m);
  await db.exec(`update public.ten_welcome_settings set cap = ${cap}`);
  return db;
}
const sup = async (db, sql, p = []) => { await db.exec("reset role"); return (await db.query(sql, p)).rows; };
async function as(db, claims, role, sql, p = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  await db.exec(`set role ${role}`);
  try { return { ok: true, rows: (await db.query(sql, p)).rows }; }
  catch (e) { return { ok: false, e: `${e.code ?? ""} ${e.message}` }; }
  finally { await db.exec("reset role"); }
}
async function mkUser(db, email, confirmed = "2026-10-01T00:00:00Z") {
  const id = uuid();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)", [id, email, confirmed]);
  return id;
}
const claim = async (db, uid, extra = {}) => {
  const r = await as(db, { sub: uid, role: "authenticated", ...extra }, "authenticated", "select public.ten_claim_welcome() r");
  return r.ok ? r.rows[0].r : { error: r.e };
};
const counts = async (db) => (await sup(db,
  "select (select count(*) from public.ten_usage_ledger where request_id like 'welcome:%')::int welcome, (select count(*) from public.ten_usage_ledger)::int ledger, (select count(*) from public.ten_welcome_claims)::int claims"))[0];

// § 20.2's rule, written out by the tester (not copied from the migration).
function specHash(email) {
  let v = email.toLowerCase().replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, "");
  const at = v.lastIndexOf("@");
  let local = at < 0 ? v : v.slice(0, at);
  let domain = at < 0 ? "" : v.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") { local = local.split(".").join(""); domain = "gmail.com"; }
  return createHash("sha256").update(`ten-welcome-v1:${local}@${domain}`, "utf8").digest("hex");
}

// ---------------------------------------------------------------- 1. hash
{
  const db = await fresh();
  const h = async (e) => (await sup(db, "select public.ten_welcome_hash($1) h", [e]))[0].h;

  // Same inbox by § 20.2's rule -> must be equal.
  const same = [
    ["ab@gmail.com", "AB@GMAIL.COM"],
    ["ab@gmail.com", ".a.b.@gmail.com"],                // leading/trailing dots, gmail
    ["ab@gmail.com", "a..b@googlemail.com"],            // doubled dots + googlemail
    ["ab@gmail.com", "ab+@gmail.com"],                  // empty tag
    ["ab@gmail.com", "a.b+c.d+e@GoogleMail.Com"],       // dots inside the tag, two tags
    ["ab@gmail.com", "\t ab@gmail.com \n"],             // tab/newline padding
    ["ab@example.com", "ab+x@example.com"],             // +tag on any domain
    ["ab@example.com", "AB+X@EXAMPLE.COM"],
  ];
  for (const [a, b] of same) {
    const [ha, hb] = [await h(a), await h(b)];
    expect(`one inbox, one hash: ${JSON.stringify(a)} == ${JSON.stringify(b)}`, ha === hb && ha === specHash(a), { ha, hb });
  }

  // Genuinely different inboxes -> must differ (nothing over-merged).
  const differ = [
    ["ab@gmail.com", "ab@gmail.co"],
    ["ab@gmail.com", "ab@sub.gmail.com"],
    ["ab@gmail.com", "ab@gmail.com.au"],
    ["ab@gmail.com", "ab@mail.gmail.com"],
    ["a.b@outlook.com", "ab@outlook.com"],               // dots count outside gmail
    ["ab@example.com", "ab@example.org"],
    ["a_b@gmail.com", "ab@gmail.com"],
    ["a-b@gmail.com", "ab@gmail.com"],
    ["ab@gmail.com", "аb@gmail.com"],               // Cyrillic a lookalike in the local part
    ["ab@gmail.com", "ab@gmаil.com"],               // Cyrillic a lookalike in the domain
    ["ab@gmail.com", "ａｂ@gmail.com"],          // fullwidth ab
    ["ab@example.com", "ab@ex+ample.com"],               // '+' in the domain is not a tag
    ["ab@gmail.com", "ab@googlemail.co"],
  ];
  for (const [a, b] of differ) {
    const [ha, hb] = [await h(a), await h(b)];
    expect(`different inboxes stay different: ${JSON.stringify(a)} != ${JSON.stringify(b)}`, ha !== hb, { ha, hb });
  }

  // Every adversarial form hashes to exactly what § 20.2's rule says (tester's own
  // implementation), so the edges below are the RULE's behaviour, not a code slip.
  const adversarial = [
    "\"ab\"@gmail.com", "\"a.b\"@example.com", "x@y@gmail.com", "x@y@googlemail.com", "a+b@c@gmail.com",
    "@gmail.com", "+x@gmail.com", "+x@example.com", "+y@example.com", "ab@", "noatsign", "ab@gmail.com.",
    "аb@gmail.com", "ab@gmаil.com", "ａｂ@gmail.com", "ÄB@example.com",
  ];
  for (const e of adversarial) {
    const got = await h(e);
    expect(`hash(${JSON.stringify(e)}) follows § 20.2 step by step`, got === specHash(e) && /^[0-9a-f]{64}$/.test(got), { got, want: specHash(e) });
  }

  // Edges the rule doesn't name. Reported, not graded.
  const pair = async (a, b) => (await h(a)) === (await h(b));
  observe("quoted local part \"ab\"@gmail.com vs ab@gmail.com (one inbox under RFC 5321) -> same hash?", await pair("\"ab\"@gmail.com", "ab@gmail.com"));
  observe("trailing-dot domain ab@gmail.com. vs ab@gmail.com (one inbox in DNS) -> same hash?", await pair("ab@gmail.com.", "ab@gmail.com"));
  observe("empty local after the tag: +x@example.com vs +y@example.com -> same hash?", await pair("+x@example.com", "+y@example.com"));
  observe("a+b@c@gmail.com vs a@gmail.com (split at last @, then the tag) -> same hash?", await pair("a+b@c@gmail.com", "a@gmail.com"));
  observe("non-ASCII case: ÄB@example.com vs äb@example.com -> same hash? (lower() follows the DB's ctype)", await pair("ÄB@example.com", "äb@example.com"));
  observe("NBSP padding: 'ab@gmail.com\\u00a0' vs 'ab@gmail.com' -> same hash?", await pair("ab@gmail.com ", "ab@gmail.com"));
}

// ---------------------------------------------- 2. the claim, adversarial
{
  const db = await fresh(100);
  // A JWT for a uid with no auth.users row: nothing to read -> unconfirmed, nothing written.
  const ghost = uuid();
  let r = await claim(db, ghost, { email: "ghost@example.com", email_confirmed_at: "2026-10-01" });
  expect("a token whose sub has no auth.users row -> unconfirmed (the table decides), no rows", r.status === "unconfirmed" && (await counts(db)).ledger === 0, r);

  // Whitespace-only email -> unconfirmed.
  const blank = await mkUser(db, "   ");
  r = await claim(db, blank);
  expect("an all-blank email -> unconfirmed, no rows", r.status === "unconfirmed" && (await counts(db)).claims === 0, r);

  // Confirmed in the future still counts as confirmed (a timestamp is a timestamp); a confirmed user -> granted.
  const u1 = await mkUser(db, "Pat.Lee@GMail.com");
  r = await claim(db, u1);
  expect("confirmed gmail user -> granted 1", r.status === "granted" && Number(r.usd) === 1, r);
  const row = (await sup(db, "select kind, usd::text usd, request_id, model, tokens_in, tokens_out, gross_usd, fee_usd from public.ten_usage_ledger where user_id = $1", [u1]))[0];
  expect("the welcome row is welcome:<lowercase uid>, credit, 1.000000, no model/gross/fee", row.kind === "credit" && row.usd === "1.000000" && row.request_id === `welcome:${u1.toLowerCase()}` && row.model === null && row.gross_usd === null && row.fee_usd === null && row.tokens_in === 0 && row.tokens_out === 0, row);

  // The same inbox through every trick § 20 names -> already_claimed, nothing written.
  for (const e of ["patlee@gmail.com", "p.a.t.l.e.e+ten@googlemail.com", " PATLEE@GMAIL.COM ", "pat.lee+1@gmail.com"]) {
    const before = await counts(db);
    const u = await mkUser(db, e);
    const x = await claim(db, u);
    const after = await counts(db);
    expect(`second account ${JSON.stringify(e)} on the claimed inbox -> already_claimed, nothing written`, x.status === "already_claimed" && JSON.stringify(before) === JSON.stringify(after), { x, before, after });
  }

  // The same account changes its address afterwards: still a member, the new inbox is NOT burnt.
  await sup(db, "update auth.users set email = 'new.inbox@example.com' where id = $1", [u1]);
  r = await claim(db, u1);
  expect("a member who changed their email -> already_member (no second grant)", r.status === "already_member", r);
  const u2 = await mkUser(db, "new.inbox@example.com");
  r = await claim(db, u2);
  expect("...and a different account on that new inbox can still claim (only a grant leaves a claims row)", r.status === "granted", r);

  // An unconfirmed account that later confirms: no claims row was left by the refusal.
  const u3 = await mkUser(db, "later@example.com", null);
  r = await claim(db, u3);
  expect("unconfirmed -> unconfirmed", r.status === "unconfirmed", r);
  await sup(db, "update auth.users set email_confirmed_at = now() where id = $1", [u3]);
  r = await claim(db, u3);
  expect("after confirming -> granted (the refusal burnt nothing)", r.status === "granted", r);

  // A JWT that tries to steer the function: extra claims never matter.
  const u4 = await mkUser(db, "steer@example.com", null);
  r = await claim(db, u4, { email: "someone-else@example.com", email_confirmed_at: "2026-10-01T00:00:00Z", email_verified: true, user_metadata: { email_verified: true } });
  expect("an unconfirmed user whose token claims a confirmed email -> unconfirmed", r.status === "unconfirmed", r);

  // A non-uuid sub is an error, not a grant.
  const bad = await as(db, { sub: "not-a-uuid", role: "authenticated" }, "authenticated", "select public.ten_claim_welcome() r");
  expect("a non-uuid sub is refused with an error, nothing written", !bad.ok, bad.e ?? bad.rows);
}

// ----------------------------------------------------------- 3. cap at 0, 1, N
{
  const db = await fresh(0);
  const a = await mkUser(db, "c0@example.com");
  expect("cap 0 -> paused", (await claim(db, a)).status === "paused");
  expect("cap 0 wrote nothing", (await counts(db)).ledger === 0);

  await sup(db, "update public.ten_welcome_settings set cap = 1");
  expect("cap 1: the first address -> granted", (await claim(db, a)).status === "granted");
  const b = await mkUser(db, "c1@example.com");
  expect("cap 1: the second address -> paused", (await claim(db, b)).status === "paused");
  // A claimed inbox at a full cap says already_claimed, not paused (§ 20.1 step 5 before 6).
  const a2 = await mkUser(db, "c0+again@example.com");
  expect("at a full cap, a second account on a claimed inbox -> already_claimed (step 5 before step 6)", (await claim(db, a2)).status === "already_claimed");

  await sup(db, "update public.ten_welcome_settings set cap = 5");
  for (let i = 2; i <= 5; i++) {
    const u = await mkUser(db, `cn${i}@example.com`);
    expect(`cap 5: grant ${i}`, (await claim(db, u)).status === "granted");
  }
  const over = await mkUser(db, "cn6@example.com");
  expect("cap 5: the sixth -> paused", (await claim(db, over)).status === "paused");
  expect("exactly 5 welcome rows and 5 claims at cap 5", JSON.stringify(await counts(db)) === JSON.stringify({ welcome: 5, ledger: 5, claims: 5 }), await counts(db));

  // Lowering the cap below what's granted pauses; nothing is taken back.
  await sup(db, "update public.ten_welcome_settings set cap = 2");
  const late = await mkUser(db, "late@example.com");
  expect("cap lowered under the grants -> paused, earlier grants untouched", (await claim(db, late)).status === "paused" && (await counts(db)).welcome === 5);

  // usd bounds as numeric(12,2): what actually lands.
  for (const [v, ok] of [["0.01", true], ["5.00", true], ["5.01", false], ["0", false], ["-0.01", false], ["1e2", false], ["NaN", false]]) {
    let res;
    try { await sup(db, `update public.ten_welcome_settings set usd = '${v}'::numeric`); res = true; } catch { res = false; }
    expect(`usd ${v} ${ok ? "accepted" : "refused"}`, res === ok, res);
  }
  // Rounding at numeric(12,2): 5.004 rounds to 5.00 (inside the bound), 0.004 rounds to 0.00 (refused).
  let r1; try { await sup(db, "update public.ten_welcome_settings set usd = 5.004"); r1 = (await sup(db, "select usd::text u from public.ten_welcome_settings"))[0].u; } catch (e) { r1 = `refused ${e.code}`; }
  expect("usd 5.004 is stored as 5.00 (never above $5)", r1 === "5.00", r1);
  let r2; try { await sup(db, "update public.ten_welcome_settings set usd = 0.004"); r2 = "accepted"; } catch (e) { r2 = `refused ${e.code}`; }
  expect("usd 0.004 rounds to 0.00 and is refused", /refused 23514/.test(r2), r2);
  let r3; try { await sup(db, "update public.ten_welcome_settings set cap = null"); r3 = "accepted"; } catch (e) { r3 = `refused ${e.code}`; }
  expect("cap null is refused (not null)", /refused 23502/.test(r3), r3);
}

// ------------------------------------- 4. access from the client's two roles
{
  const db = await fresh(100);
  const u = await mkUser(db, "acc@example.com");
  const priv = await sup(db, `select r.rolname,
      has_function_privilege(r.rolname, 'public.ten_claim_welcome()', 'execute') claim,
      has_function_privilege(r.rolname, 'public.ten_welcome_hash(text)', 'execute') hash,
      has_table_privilege(r.rolname, 'public.ten_welcome_settings', 'select') s_sel,
      has_table_privilege(r.rolname, 'public.ten_welcome_settings', 'update') s_upd,
      has_table_privilege(r.rolname, 'public.ten_welcome_claims', 'select') c_sel,
      has_table_privilege(r.rolname, 'public.ten_welcome_claims', 'insert') c_ins,
      has_table_privilege(r.rolname, 'public.ten_welcome_claims', 'delete') c_del,
      has_table_privilege(r.rolname, 'public.ten_welcome_claims', 'truncate') c_trunc
    from pg_roles r where r.rolname in ('anon','authenticated','service_role') order by 1`);
  const p = Object.fromEntries(priv.map((x) => [x.rolname, x]));
  expect("anon: no execute on either function, no privilege on either table",
    !p.anon.claim && !p.anon.hash && !p.anon.s_sel && !p.anon.s_upd && !p.anon.c_sel && !p.anon.c_ins && !p.anon.c_del && !p.anon.c_trunc, p.anon);
  expect("authenticated: execute on the claim only; nothing on the hash or either table",
    p.authenticated.claim && !p.authenticated.hash && !p.authenticated.s_sel && !p.authenticated.s_upd && !p.authenticated.c_sel && !p.authenticated.c_ins && !p.authenticated.c_del && !p.authenticated.c_trunc, p.authenticated);
  const pub = (await sup(db, "select count(*)::int n from information_schema.routine_privileges where routine_name in ('ten_claim_welcome','ten_welcome_hash') and grantee = 'PUBLIC'"))[0].n;
  expect("PUBLIC holds no execute on either function", pub === 0, pub);
  // § 20.1 says execute is "granted to authenticated only"; the service role keeps
  // Supabase's default-privilege grant. Reported (it can't grant anything: no auth.uid()).
  observe("service_role still has EXECUTE on ten_claim_welcome (default privileges; § 20.1 reads 'granted to authenticated only')", p.service_role.claim);

  // The claims fingerprint can't be reached through any member-readable view or function.
  await claim(db, u);
  const viaLedger = await as(db, { sub: u, role: "authenticated" }, "authenticated", "select request_id from public.ten_usage_ledger");
  expect("a member sees their own welcome:<uid> ledger row (own-row read, unchanged)", viaLedger.ok && viaLedger.rows.some((x) => x.request_id === `welcome:${u}`), viaLedger);
  const viaClaims = await as(db, { sub: u, role: "authenticated" }, "authenticated", "select * from public.ten_welcome_claims");
  expect("...but not the claims table (42501)", !viaClaims.ok && /42501/.test(viaClaims.e), viaClaims.e ?? viaClaims.rows);
  const viaSettings = await as(db, { role: "anon" }, "anon", "select cap from public.ten_welcome_settings");
  expect("anon cannot read the cap (42501): no signed-out 'are grants open?' read (§ 20.9)", !viaSettings.ok && /42501/.test(viaSettings.e), viaSettings.e ?? viaSettings.rows);
  // RLS on with no policy even if a later grant slips in: grant select back and the table still shows nothing.
  await sup(db, "grant select on public.ten_welcome_claims to authenticated");
  const slipped = await as(db, { sub: u, role: "authenticated" }, "authenticated", "select count(*)::int n from public.ten_welcome_claims");
  expect("RLS is the second wall: a stray grant still shows an authenticated reader zero rows", slipped.ok && slipped.rows[0].n === 0, slipped);
  const rls = await sup(db, "select relname, relrowsecurity from pg_class where relname in ('ten_welcome_settings','ten_welcome_claims') order by 1");
  expect("RLS on for both tables", rls.every((x) => x.relrowsecurity), rls);
  const pol = (await sup(db, "select count(*)::int n from pg_policies where tablename in ('ten_welcome_settings','ten_welcome_claims')"))[0].n;
  expect("no policy on either table", pol === 0, pol);
  // search_path '' on BOTH functions (the hash too).
  const cfg = await sup(db, "select proname, proconfig, prosecdef from pg_proc where proname in ('ten_claim_welcome','ten_welcome_hash') order by 1");
  expect("both functions pin search_path to ''", cfg.every((x) => (x.proconfig ?? []).some((c) => /^search_path=(""|)$/.test(c))), cfg);
  expect("only the claim is security definer", cfg.find((x) => x.proname === "ten_claim_welcome").prosecdef && !cfg.find((x) => x.proname === "ten_welcome_hash").prosecdef, cfg);
}

// ---------------------- 5. a search_path hijack can't redirect the definer
{
  const db = await fresh(100);
  // An attacker-controlled schema with lookalike objects, first on the path.
  await db.exec("reset role; create schema evil; grant usage, create on schema evil to authenticated;");
  await db.exec("create table evil.ten_usage_ledger (user_id uuid, kind text); grant all on evil.ten_usage_ledger to authenticated;");
  await db.exec("create function evil.sha256(bytea) returns bytea language sql as $$ select '\\x00'::bytea $$; grant execute on function evil.sha256(bytea) to authenticated;");
  const u = await mkUser(db, "path@example.com");
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: u, role: "authenticated" })]);
  await db.exec("set role authenticated");
  await db.exec("set search_path = evil, public, pg_catalog");
  let r;
  try { r = (await db.query("select public.ten_claim_welcome() r")).rows[0].r; } catch (e) { r = { error: e.message }; }
  await db.exec("reset role"); await db.exec("reset search_path");
  const evilRows = (await sup(db, "select count(*)::int n from evil.ten_usage_ledger"))[0].n;
  const realRow = (await sup(db, "select count(*)::int n from public.ten_usage_ledger where user_id = $1", [u]))[0].n;
  const stored = (await sup(db, "select email_hash from public.ten_welcome_claims"))[0]?.email_hash;
  expect("a caller's search_path can't redirect the grant: the real ledger gets the row, the lookalike none, the hash is the real sha256",
    r.status === "granted" && evilRows === 0 && realRow === 1 && stored === specHash("path@example.com"), { r, evilRows, realRow, stored });
}

// ----------------------------------- 6. deletion keeps the fingerprint only
{
  const db = await fresh(100);
  const u = await mkUser(db, "gone@gmail.com");
  await claim(db, u);
  await sup(db, "delete from auth.users where id = $1", [u]);
  const cols = (await sup(db, "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='ten_welcome_claims'"));
  expect("rule 9 (amended): the only thing kept is email_hash, a text fingerprint", cols.length === 1 && cols[0].column_name === "email_hash", cols);
  const left = (await sup(db, "select count(*)::int n from public.ten_usage_ledger where request_id = $1", [`welcome:${u}`]))[0].n;
  expect("the welcome row went with the account", left === 0, left);
  const anyEmail = (await sup(db, "select count(*)::int n from public.ten_welcome_claims where email_hash like '%@%' or email_hash ilike '%gone%'"))[0].n;
  expect("the kept row holds no readable address", anyEmail === 0, anyEmail);
  const fk = (await sup(db, "select count(*)::int n from pg_constraint where conrelid = 'public.ten_welcome_claims'::regclass and contype = 'f'"))[0].n;
  expect("no foreign key links the fingerprint to an account", fk === 0, fk);
  // The settings row has no PII either.
  const scols = (await sup(db, "select column_name from information_schema.columns where table_schema='public' and table_name='ten_welcome_settings' order by 1")).map((x) => x.column_name);
  expect("the settings row is id, cap and usd only", JSON.stringify(scols) === JSON.stringify(["cap", "id", "usd"]), scols);
  const back = await mkUser(db, "g.o.n.e+back@googlemail.com");
  expect("a new account on the same inbox (dotted, tagged, googlemail) -> already_claimed", (await claim(db, back)).status === "already_claimed");
}

// ------------------------------------------- 7. the money checks still hold
{
  const db = await fresh(100);
  const u = await mkUser(db, "money@example.com");
  await claim(db, u);
  const tryIns = async (sql) => { try { await sup(db, sql); return "accepted"; } catch (e) { return `refused ${e.code}`; } };
  expect("a welcome: credit with fee_usd alone is refused (PayPal breakdown check)",
    /refused 23514/.test(await tryIns(`insert into public.ten_usage_ledger (user_id, kind, usd, request_id, fee_usd) values ('${u}', 'credit', 1, 'welcome:x-${u}', 0.1)`)));
  expect("a paypal: credit with no breakdown is still refused",
    /refused 23514/.test(await tryIns(`insert into public.ten_usage_ledger (user_id, kind, usd, request_id) values ('${u}', 'credit', 9.16, 'paypal:ORDER1')`)));
  expect("the user cannot write a welcome row themselves (users never insert ledger rows)",
    !(await as(db, { sub: u, role: "authenticated" }, "authenticated", `insert into public.ten_usage_ledger (user_id, kind, usd, request_id) values ('${u}', 'credit', 5, 'welcome:${u}2')`)).ok);
  // A member spends the welcome balance; the claim is not a refill.
  await sup(db, `insert into public.ten_usage_ledger (user_id, kind, usd, request_id, model) values ('${u}', 'call', 1.2, 'gen-1', 'deepseek/deepseek-v4.1-flash')`);
  const bal = await as(db, { sub: u, role: "authenticated" }, "authenticated", "select public.ten_balance()::text b");
  const again = await claim(db, u);
  expect("a member at a negative balance calling the claim again -> already_member, no refill", again.status === "already_member" && (await counts(db)).welcome === 1, { again, bal: bal.rows?.[0] });
}

// ---------------------------------------------------------- 8. teardown
{
  const db = await fresh(100);
  const u = await mkUser(db, "td@example.com");
  await claim(db, u);
  // The teardown refuses until the bucket is emptied via the Storage API; simulate that step as the README says.
  await db.exec("reset role; begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id = 'ten-workspaces'; delete from storage.buckets where id = 'ten-workspaces'; commit;");
  let ok = true, err;
  try { await db.exec(TEAR); } catch (e) { ok = false; err = e.message; }
  expect("the teardown runs after a grant", ok, err);
  const left = await sup(db, "select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'ten\\_welcome%')::int rels, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('ten_claim_welcome','ten_welcome_hash'))::int funcs");
  expect("nothing of the welcome migration is left (tables, their indexes, functions)", left[0].rels === 0 && left[0].funcs === 0, left[0]);
  const users = (await sup(db, "select count(*)::int n from auth.users"))[0].n;
  expect("the shared auth users are untouched by the teardown", users === 1, users);
}

console.log(`\ntester r10 failures: ${fails}${fails ? "\n  " + failed.join("\n  ") : ""}`);
process.exitCode = fails ? 1 : 0;
