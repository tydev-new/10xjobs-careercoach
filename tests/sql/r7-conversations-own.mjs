// Tester-owned: docs/design-web-agent.md § 11.2 / § 11.9 (i), (ii), (ix) —
// the cases r6-conversations.mjs (coder-added) does not cover, written from
// the spec (6641e1a):
//   - RLS between two MEMBERS (r6's "B reads nothing" is a non-member, so the
//     policy's user_id = auth.uid() half was never the thing refusing);
//   - authenticated can't insert or delete directly (r6 checks update only);
//   - the 1 MB check at the exact byte boundary; version = SQL's sha256
//     prefix of messages::text (value, not only shape);
//   - service-role delete (the ten-delete-account path) and the auth.users
//     cascade (§ 11.7);
//   - the client's 900,000-byte cap vs the server's 1,048,576-byte check on
//     jsonb's OWN text form (§ 11.4 "leaving room for jsonb's own spacing"):
//     an array the client capped must always be accepted.
//   node r7-conversations-own.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { prepareConversationForSave } from "../../packages/agent/src/conversation.ts";
const WT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const MIGS = [
  "20260923000000_ten_beta_init.sql",
  "20260924000000_ten_ledger_finish_reason.sql",
  "20260924100000_ten_conversations.sql",
].map((f) => readFileSync(`${WT}/supabase/migrations/${f}`, "utf8"));
const STUB = readFileSync(new URL("./stub.sql", import.meta.url), "utf8");
const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "bbbbbbbb-0000-0000-0000-000000000002";
let fails = 0;
const out = (t, m, d = "") => console.log(`[${t}] ${m}${d !== "" && d !== undefined ? "  -> " + (typeof d === "string" ? d : JSON.stringify(d)) : ""}`);
const expect = (m, c, d) => { out(c ? "PASS" : "FAIL", m, d); if (!c) fails++; };
const note = (m, d) => out("OBSERVED", m, d);
async function as(db, uid, role, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [uid ? JSON.stringify({ sub: uid, role }) : ""]);
  await db.exec(`set role ${role}`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, e: `${e.code ?? ""} ${e.message}` }; } finally { await db.exec("reset role"); }
}
const save = (db, uid, chatId, messagesText, expected, older = false) =>
  as(db, uid, "authenticated", "select * from public.ten_conversation_save($1,$2::jsonb,$3,$4)", [chatId, messagesText, older, expected]);

const db = new PGlite();
await db.exec(STUB);
await db.exec(`insert into auth.users values ('${A}'),('${B}')`);
for (const m of MIGS) await db.exec(m);
for (const u of [A, B]) await as(db, null, "service_role", "insert into public.ten_usage_ledger (user_id, kind, usd) values ($1,'credit',5)", [u]);

// ---- (i) RLS between two members
{
  const a = await save(db, A, "chat-a", JSON.stringify([{ id: "1", role: "user", parts: [{ type: "text", text: "A-SECRET" }] }]), null);
  const b = await save(db, B, "chat-b", JSON.stringify([{ id: "1", role: "user", parts: [{ type: "text", text: "B-SECRET" }] }]), null);
  expect("two members each create their own row", a.ok && b.ok, [a.e, b.e]);
  const bSees = await as(db, B, "authenticated", "select user_id, messages::text m from public.ten_conversations");
  expect("member B sees exactly one row, B's own", bSees.ok && bSees.rows.length === 1 && bSees.rows[0].user_id === B && !bSees.rows[0].m.includes("A-SECRET"), bSees.rows ?? bSees.e);
  const bById = await as(db, B, "authenticated", "select count(*)::int n from public.ten_conversations where user_id = $1", [A]);
  expect("member B asking for A's row by id gets nothing", bById.ok && bById.rows[0].n === 0, bById.rows ?? bById.e);
  const aVer = (await as(db, A, "authenticated", "select version from public.ten_conversations")).rows[0].version;
  const bOverA = await save(db, B, "chat-a", JSON.stringify([]), aVer);
  expect("B's save using A's chat id and A's version never touches A's row (PT409)", !bOverA.ok && /PT409/.test(bOverA.e), bOverA.e);
  const aStill = await as(db, A, "authenticated", "select messages::text m from public.ten_conversations");
  expect("A's row still holds A's message", aStill.rows[0].m.includes("A-SECRET"), aStill.rows);
  const ins = await as(db, A, "authenticated", "insert into public.ten_conversations (user_id, chat_id, messages, version) values ($1,'x','[]','v')", [A]);
  expect("authenticated cannot insert directly", !ins.ok && /42501/.test(ins.e), ins.e);
  const del = await as(db, A, "authenticated", "delete from public.ten_conversations where user_id = $1", [A]);
  expect("authenticated cannot delete directly", !del.ok && /42501/.test(del.e), del.e);
  const nonMemberRead = await (async () => {
    await as(db, null, "service_role", "delete from public.ten_usage_ledger where user_id = $1 and kind = 'credit'", [B]);
    const r = await as(db, B, "authenticated", "select count(*)::int n from public.ten_conversations");
    await as(db, null, "service_role", "insert into public.ten_usage_ledger (user_id, kind, usd) values ($1,'credit',5)", [B]);
    return r;
  })();
  expect("an ex-member reads nothing, not even their own row", nonMemberRead.ok && nonMemberRead.rows[0].n === 0, nonMemberRead.rows ?? nonMemberRead.e);
}

// ---- (ii) version value and the exact 1 MB boundary
{
  const cur = await as(db, A, "authenticated", "select version, left(encode(sha256(convert_to(messages::text, 'UTF8')), 'hex'), 16) want from public.ten_conversations");
  expect("version = the first 16 hex of sha256(messages::text)", cur.ok && cur.rows[0].version === cur.rows[0].want, cur.rows);
  const sized = (n) => {
    // a jsonb array whose ::text form is exactly n bytes: ["xxx..."] -> 4 bytes of frame
    return JSON.stringify(["x".repeat(n - 4)]);
  };
  const len = async (t) => (await db.query("select octet_length($1::jsonb::text)::int n", [t])).rows[0].n;
  const at = sized(1_048_576), over = sized(1_048_577);
  expect("fixture sizes are exact", (await len(at)) === 1_048_576 && (await len(over)) === 1_048_577, [await len(at), await len(over)]);
  let v = cur.rows[0].version;
  const okAt = await save(db, A, "chat-a", at, v);
  expect("exactly 1,048,576 bytes is accepted", okAt.ok, okAt.e);
  v = okAt.ok ? okAt.rows[0].version : v;
  const tooBig = await save(db, A, "chat-a", over, v);
  expect("1,048,577 bytes is PT413 conversation_too_large", !tooBig.ok && /PT413/.test(tooBig.e) && /conversation_too_large/.test(tooBig.e), tooBig.e);
}

// ---- § 11.4: what the client caps at 900,000 bytes always fits the server's 1 MB check
{
  // Realistic small-key JSON (list_files outputs, card props, gate/status parts)
  // is where jsonb's ", " and ": " spacing grows the text most.
  const files = (n) => Array.from({ length: n }, (_, i) => ({ path: `jd-inbox/r${i}.md`, size: 1000 + i, updatedAt: "2026-09-24T12:00:00Z" }));
  const turnOf = (i) => [
    { id: `u${i}`, role: "user", metadata: { origin: "typed" }, parts: [{ type: "text", text: `what's in the inbox ${i}?` }] },
    { id: `a${i}`, role: "assistant", parts: [
      { type: "step-start" },
      { type: "tool-list_files", toolCallId: `c${i}`, state: "output-available", input: { dir: "jd-inbox" }, output: { files: files(60) } },
      { type: "data-card", data: { card: "cost", props: { action: "x", lowUsd: 0.1, highUsd: 0.2, balanceUsd: 4.2, needsGate: false, method: "m" } } },
      { type: "data-gate-status", data: { gateId: `g${i}`, status: "approved" } },
      { type: "text", text: "Here they are.", state: "done" },
    ] },
  ];
  const all = Array.from({ length: 400 }, (_, i) => turnOf(i)).flat();
  const { messages, droppedAnyTurn } = prepareConversationForSave(all);
  const clientBytes = new TextEncoder().encode(JSON.stringify(messages)).byteLength;
  const serverBytes = (await db.query("select octet_length($1::jsonb::text)::int n", [JSON.stringify(messages)])).rows[0].n;
  note("client-capped bytes vs jsonb::text bytes", { clientBytes, serverBytes, growth: +(serverBytes / clientBytes).toFixed(3), droppedAnyTurn });
  const v = (await as(db, A, "authenticated", "select version from public.ten_conversations")).rows[0].version;
  const r = await save(db, A, "chat-a", JSON.stringify(messages), v, droppedAnyTurn);
  expect("a conversation the client capped at 900,000 bytes is accepted by the 1 MB check", r.ok, r.e);
}

// ---- (ix)/§ 11.7: the service-role delete and the auth.users cascade
{
  const svc = await as(db, null, "service_role", "delete from public.ten_conversations where user_id = $1", [B]);
  expect("the service role can delete a user's row (ten-delete-account's path)", svc.ok, svc.e);
  const gone = await as(db, null, "service_role", "select count(*)::int n from public.ten_conversations where user_id = $1", [B]);
  expect("…and it is gone", gone.rows[0].n === 0, gone.rows);
  await db.exec(`delete from auth.users where id = '${A}'`);
  const cascade = await as(db, null, "service_role", "select count(*)::int n from public.ten_conversations where user_id = $1", [A]);
  expect("deleting the auth user cascades to the conversation row (an old-app account delete)", cascade.rows[0].n === 0, cascade.rows);
}

console.log(`\nr7 (conversations, tester's own) failures: ${fails}`);
if (fails) process.exitCode = 1;
