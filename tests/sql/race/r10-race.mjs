// The races design-web-agent.md § 20.1 step 4 says the settings row's lock
// prevents, run for real on Postgres 17 (embedded-postgres: a local cluster in
// a temp dir, 127.0.0.1 only, deleted at the end). PGlite has one connection,
// so tests/sql/r9-welcome.mjs could only read the function body (§ 20.11 SQL 12);
// this runs two (and many) connections. Independent tester, open sign-up review.
//   cd tests/sql/race && npm ci && node r10-race.mjs
// Never touches a real project: the cluster is created here and removed at exit.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const WT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const MIGS = [
  "20260923000000_ten_beta_init.sql",
  "20260924000000_ten_ledger_finish_reason.sql",
  "20260924100000_ten_conversations.sql",
  "20260925000000_ten_paypal_credit.sql",
  "20261002000000_ten_welcome_credit.sql",
].map((f) => readFileSync(`${WT}/supabase/migrations/${f}`, "utf8"));
const STUB = readFileSync(`${WT}/tests/sql/stub.sql`, "utf8");

let fails = 0;
const failed = [];
const out = (t, m, d) => console.log(`[${t}] ${m}${d === undefined ? "" : "  -> " + JSON.stringify(d)}`);
const expect = (m, c, d) => { out(c ? "PASS" : "FAIL", m, d); if (!c) { fails++; failed.push(m); } };
const observe = (m, d) => out("OBSERVED", m, d);

const PORT = 54000 + Math.floor(Math.random() * 900);
const dir = mkdtempSync(path.join(tmpdir(), "ten-race-"));
const server = new EmbeddedPostgres({
  databaseDir: path.join(dir, "data"), user: "postgres", password: "race", port: PORT, persistent: false,
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "max_connections=100"],
});
let seq = 0;
const uuid = () => `5a5a5a5a-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const conn = async (db) => { const c = new pg.Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: "race", database: db }); await c.connect(); return c; };

// A connection that behaves like PostgREST's for a signed-in caller: role
// authenticated, the JWT's claims in request.jwt.claims (stub.sql's auth.uid()).
async function asUser(db, uid) {
  const c = await conn(db);
  await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  await c.query("set role authenticated");
  return c;
}
async function freshDb(name, cap) {
  const admin = await conn("postgres");
  await admin.query(`create database ${name}`);
  await admin.end();
  const c = await conn(name);
  // The roles are cluster-wide: create them once.
  const roles = (await c.query("select count(*)::int n from pg_roles where rolname in ('anon','authenticated','service_role')")).rows[0].n;
  await c.query(roles === 3 ? STUB.replace(/^create role .*$/gm, "") : STUB);
  for (const m of MIGS) await c.query(m);
  await c.query(`update public.ten_welcome_settings set cap = ${cap}`);
  return c;
}
async function mkUser(admin, email) {
  const id = uuid();
  await admin.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [id, email]);
  return id;
}
const counts = async (admin) => (await admin.query(
  "select (select count(*) from public.ten_usage_ledger where request_id like 'welcome:%')::int welcome, (select count(*) from public.ten_welcome_claims)::int claims")).rows[0];
async function waitingOnLock(admin, pid) {
  for (let i = 0; i < 100; i++) {
    const r = await admin.query("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
    if (r.rows[0]?.wait_event_type === "Lock") return true;
    await new Promise((res) => setTimeout(res, 20));
  }
  return false;
}

let postmasterPid;
try {
  await server.initialise();
  await server.start();
  postmasterPid = Number(readFileSync(path.join(dir, "data", "postmaster.pid"), "utf8").split("\n")[0]);
  const v = await conn("postgres");
  out("INFO", "cluster", { version: (await v.query("show server_version")).rows[0].server_version, port: PORT, postmasterPid });
  await v.end();

  // ---- 1. two accounts racing for the last place (orchestrated interleaving)
  for (const ending of ["commit", "rollback"]) {
    const name = `last_${ending}`;
    const admin = await freshDb(name, 1);
    const a = await mkUser(admin, `a-${ending}@example.com`);
    const b = await mkUser(admin, `b-${ending}@example.com`);
    const ca = await asUser(name, a), cb = await asUser(name, b);
    await ca.query("begin");
    const ra = (await ca.query("select public.ten_claim_welcome() r")).rows[0].r; // holds the settings lock
    const bPid = (await cb.query("select pg_backend_pid() p")).rows[0].p;
    const pb = cb.query("select public.ten_claim_welcome() r");
    const blocked = await waitingOnLock(admin, bPid);
    await ca.query(ending);
    const rb = (await pb).rows[0].r;
    const n = await counts(admin);
    if (ending === "commit") {
      expect("last place, A commits: B waited on the lock", blocked);
      expect("last place, A commits: A granted, B paused", ra.status === "granted" && rb.status === "paused", { ra, rb });
      expect("last place, A commits: one grant, one claim (never past the cap)", n.welcome === 1 && n.claims === 1, n);
    } else {
      expect("last place, A rolls back: B waited on the lock", blocked);
      expect("last place, A rolls back: B takes the place", rb.status === "granted", { ra, rb });
      expect("last place, A rolls back: one grant, one claim", n.welcome === 1 && n.claims === 1, n);
    }
    await ca.end(); await cb.end(); await admin.end();
  }

  // ---- 2. one account's two tabs (orchestrated)
  {
    const name = "two_tabs";
    const admin = await freshDb(name, 100);
    const u = await mkUser(admin, "tabs@example.com");
    const t1 = await asUser(name, u), t2 = await asUser(name, u);
    await t1.query("begin");
    const r1 = (await t1.query("select public.ten_claim_welcome() r")).rows[0].r;
    const p2pid = (await t2.query("select pg_backend_pid() p")).rows[0].p;
    const p2 = t2.query("select public.ten_claim_welcome() r");
    const blocked = await waitingOnLock(admin, p2pid);
    await t1.query("commit");
    const r2 = (await p2).rows[0].r;
    const n = await counts(admin);
    expect("two tabs: the second tab waited on the lock", blocked);
    expect("two tabs: tab 1 granted, tab 2 already_member (§ 20.4: another tab won)", r1.status === "granted" && r2.status === "already_member", { r1, r2 });
    expect("two tabs: one welcome row, one claim", n.welcome === 1 && n.claims === 1, n);
    await t1.end(); await t2.end(); await admin.end();
  }

  // ---- 3. one inbox, two accounts (+tag / gmail dots), orchestrated
  {
    const name = "one_inbox";
    const admin = await freshDb(name, 100);
    const a = await mkUser(admin, "jo.doe@gmail.com");
    const b = await mkUser(admin, "jodoe+ten@googlemail.com");
    const ca = await asUser(name, a), cb = await asUser(name, b);
    await ca.query("begin");
    const ra = (await ca.query("select public.ten_claim_welcome() r")).rows[0].r;
    const bPid = (await cb.query("select pg_backend_pid() p")).rows[0].p;
    const pb = cb.query("select public.ten_claim_welcome() r");
    const blocked = await waitingOnLock(admin, bPid);
    await ca.query("commit");
    const rb = (await pb).rows[0].r;
    const n = await counts(admin);
    expect("one inbox, two accounts at once: B waited, A granted, B already_claimed", blocked && ra.status === "granted" && rb.status === "already_claimed", { blocked, ra, rb });
    expect("one inbox: one grant", n.welcome === 1 && n.claims === 1, n);
    await ca.end(); await cb.end(); await admin.end();
  }

  // ---- 4. a free-for-all: 40 accounts, cap 7, all at once; 10 tabs of one account
  {
    const name = "storm";
    const admin = await freshDb(name, 7);
    const users = [];
    for (let i = 0; i < 40; i++) users.push(await mkUser(admin, `storm${i}@example.com`));
    const conns = await Promise.all(users.map((u) => asUser(name, u)));
    const results = await Promise.all(conns.map((c) => c.query("select public.ten_claim_welcome() r").then((x) => x.rows[0].r.status, (e) => `error ${e.code}`)));
    const tally = results.reduce((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});
    const n = await counts(admin);
    expect("40 accounts at once, cap 7: exactly 7 granted, 33 paused, no error", tally.granted === 7 && tally.paused === 33 && Object.keys(tally).length === 2, tally);
    expect("...and exactly 7 welcome rows and 7 claims", n.welcome === 7 && n.claims === 7, n);
    await Promise.all(conns.map((c) => c.end()));

    await admin.query("update public.ten_welcome_settings set cap = 100");
    const one = await mkUser(admin, "manytabs@example.com");
    const tabs = await Promise.all(Array.from({ length: 10 }, () => asUser(name, one)));
    const tr = await Promise.all(tabs.map((c) => c.query("select public.ten_claim_welcome() r").then((x) => x.rows[0].r.status, (e) => `error ${e.code}`)));
    const tt = tr.reduce((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});
    const rows = (await admin.query("select count(*)::int n from public.ten_usage_ledger where user_id = $1", [one])).rows[0].n;
    expect("10 tabs of one account at once: 1 granted, 9 already_member, no error", tt.granted === 1 && tt.already_member === 9, tt);
    expect("...and that account holds exactly one welcome row", rows === 1, rows);
    await Promise.all(tabs.map((c) => c.end()));
    await admin.end();
  }

  // ---- 5. the isolation level the guarantee rests on (reported, not graded)
  // PostgREST runs RPCs at READ COMMITTED, where each statement inside the
  // plpgsql function takes a fresh snapshot after the lock. Under REPEATABLE
  // READ the second caller's snapshot predates the first commit.
  {
    const name = "iso";
    const admin = await freshDb(name, 1);
    const a = await mkUser(admin, "iso-a@example.com");
    const b = await mkUser(admin, "iso-b@example.com");
    const ca = await asUser(name, a), cb = await asUser(name, b);
    await cb.query("begin isolation level repeatable read");
    await cb.query("select 1"); // take the snapshot now
    await ca.query("select public.ten_claim_welcome() r"); // A grants and commits
    let rb;
    try { rb = (await cb.query("select public.ten_claim_welcome() r")).rows[0].r; await cb.query("commit"); }
    catch (e) { rb = { error: e.code }; await cb.query("rollback"); }
    const n = await counts(admin);
    observe("REPEATABLE READ caller after a committed grant at cap 1 (PostgREST uses READ COMMITTED, so not reachable through the API)", { rb, counts: n });
    await ca.end(); await cb.end(); await admin.end();
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

console.log(`\nrace failures: ${fails}${fails ? "\n  " + failed.join("\n  ") : ""}`);
process.exitCode = fails ? 1 : 0;
