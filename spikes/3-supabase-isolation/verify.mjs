// Spike 3, re-run — Supabase isolation against the REAL migration.
//
// Runs after supabase/migrations/20260923000000_ten_beta_init.sql was
// applied to the owner's production project career-coach-nextgen (the
// OWNER CHECKLIST's step 3: "Re-run spike 3's isolation tests against the
// real project"). Unlike the first pass (see git history / the prior
// docs/spikes/spike-3-supabase-isolation.md), this run does NOT create a
// throwaway bucket or draft policies — it tests the real `ten-workspaces`
// bucket, `ten_ws_files`, `ten_usage_ledger`, `ten_gate_log` tables and the
// `ten_*` RPC functions the migration created, with three throwaway auth
// users signed in with their OWN sessions (never the service role, except
// for setup/cleanup).
//
// Credentials: SUPABASE_URL, SUPABASE_ANON_KEY (publishable),
// SUPABASE_SERVICE_ROLE_KEY (secret) — read from the environment only, never
// logged. Run with:
//   set -a; . ../../.env.local; set +a
//   node verify.mjs 2>&1 | sed -E 's/(sb_(secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]{20,}|https:\/\/[a-z0-9]+\.supabase\.co)/<masked>/g'
//
// Scope: exactly 3 throwaway auth users (A, B, N). A and B get a $5 credit
// ledger row (service role) so they are beta members; N stays a
// non-member. No table, policy, function or bucket is created or altered by
// this script — only rows/objects/users this script itself creates, all
// removed in cleanup().

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    "BLOCKED: missing one of SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in the environment."
  );
  process.exit(1);
}

const BUCKET = "ten-workspaces";

const results = []; // { id, desc, status: "PASS"|"FAIL"|"INFO", detail }
function record(id, desc, status, detail) {
  results.push({ id, desc, status, detail });
  const line = `[${status}] ${id} — ${desc}`;
  console.log(detail !== undefined ? `${line}\n    ${detail}` : line);
}
function pass(cond, id, desc, detail) {
  record(id, desc, cond ? "PASS" : "FAIL", detail);
  return cond;
}
function rand(n = 6) {
  return crypto.randomBytes(n).toString("hex");
}
function sha256hex(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const userA = { email: `spike3-a+${rand()}@example.com`, password: crypto.randomBytes(18).toString("base64url") };
const userB = { email: `spike3-b+${rand()}@example.com`, password: crypto.randomBytes(18).toString("base64url") };
const userN = { email: `spike3-n+${rand()}@example.com`, password: crypto.randomBytes(18).toString("base64url") };

let uidA = null, uidB = null, uidN = null;
let jwtA = null, jwtB = null, jwtN = null;
let clientA, clientB, clientN, clientAnon;
const uploadedObjects = new Set(); // paths this script wrote to the bucket, for cleanup

// Raw REST calls so we can assert the literal HTTP status the migration's
// PTxxx SQLSTATE convention maps to (PostgREST: a SQLSTATE 'PTxxx' becomes
// HTTP status xxx), which supabase-js's PostgrestError does not expose.
async function rpcRaw(jwt, fnName, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${jwt || ANON_KEY}`,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function selectRaw(jwt, table, query = "select=*") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt || ANON_KEY}` },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function main() {
  // 0. Preconditions: the real bucket must already exist (created by the
  // migration); this script must never create it.
  {
    const { data, error } = await admin.storage.getBucket(BUCKET);
    if (error || !data) {
      throw new Error(`precondition failed: bucket "${BUCKET}" does not exist (${error?.message}). Migration not applied?`);
    }
    record("precondition-bucket-exists", `bucket "${BUCKET}" already exists (from the migration, not created here)`, "PASS", JSON.stringify({ id: data.id, public: data.public }));
  }

  // 1. Three throwaway auth users via the admin API.
  {
    const a = await admin.auth.admin.createUser({ email: userA.email, password: userA.password, email_confirm: true });
    if (a.error) throw new Error(`createUser A failed: ${a.error.message}`);
    uidA = a.data.user.id;
    const b = await admin.auth.admin.createUser({ email: userB.email, password: userB.password, email_confirm: true });
    if (b.error) throw new Error(`createUser B failed: ${b.error.message}`);
    uidB = b.data.user.id;
    const n = await admin.auth.admin.createUser({ email: userN.email, password: userN.password, email_confirm: true });
    if (n.error) throw new Error(`createUser N failed: ${n.error.message}`);
    uidN = n.data.user.id;
    record("users-create", "create 3 throwaway auth users via the admin API", "PASS", `A=${uidA.slice(0, 8)}… B=${uidB.slice(0, 8)}… N=${uidN.slice(0, 8)}… (uids only, no keys)`);
  }

  // 2. Credit rows for A and B only (service role). N stays a non-member.
  {
    const insA = await admin.from("ten_usage_ledger").insert({ user_id: uidA, kind: "credit", usd: 5.0 });
    const insB = await admin.from("ten_usage_ledger").insert({ user_id: uidB, kind: "credit", usd: 5.0 });
    pass(!insA.error && !insB.error, "credit-rows", "insert a $5 credit row for A and B (service role); N stays non-member", JSON.stringify({ aErr: insA.error?.message, bErr: insB.error?.message }));
  }

  // 3. Sign in as A, B, N with their OWN sessions (publishable key), plus an
  // anon client that never signs in.
  {
    clientA = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    clientB = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    clientN = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    clientAnon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const sA = await clientA.auth.signInWithPassword(userA);
    const sB = await clientB.auth.signInWithPassword(userB);
    const sN = await clientN.auth.signInWithPassword(userN);
    if (sA.error || sB.error || sN.error) {
      throw new Error(`sign-in failed: A=${sA.error?.message ?? "ok"} B=${sB.error?.message ?? "ok"} N=${sN.error?.message ?? "ok"}`);
    }
    jwtA = sA.data.session.access_token;
    jwtB = sB.data.session.access_token;
    jwtN = sN.data.session.access_token;
    record("signin", "A, B, N each sign in with their own session (publishable key)", "PASS");
  }

  // ===================== ten_ws_files / ten_ws_write =====================

  // A creates plan.md.
  {
    const r = await rpcRaw(jwtA, "ten_ws_write", { p_path: "plan.md", p_content: "# A's plan\n", p_expected: null });
    pass(r.status === 200 || r.status === 201, "ws-a-create", "A creates plan.md via ten_ws_write (create)", `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  // B cannot read A's row via select.
  {
    const r = await selectRaw(jwtB, "ten_ws_files", `select=path,content&user_id=eq.${uidA}`);
    const rows = Array.isArray(r.body) ? r.body : [];
    pass(r.status === 200 && rows.length === 0, "ws-b-cannot-select-a", "B's select of A's ten_ws_files row returns 0 rows", `status=${r.status} rows=${JSON.stringify(r.body)}`);
  }

  // B's write to 'plan.md' creates B's own row, not A's; A's content unchanged.
  {
    const r = await rpcRaw(jwtB, "ten_ws_write", { p_path: "plan.md", p_content: "# B's plan\n", p_expected: null });
    const bOk = r.status === 200 || r.status === 201;
    // Use the service role directly (bypasses RLS) to prove A's row is unchanged.
    const svc = await fetch(`${SUPABASE_URL}/rest/v1/ten_ws_files?select=user_id,path,content&user_id=eq.${uidA}&path=eq.plan.md`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const svcBody = await svc.json();
    const aUnchanged = Array.isArray(svcBody) && svcBody.length === 1 && svcBody[0].content === "# A's plan\n";
    pass(bOk && aUnchanged, "ws-b-write-own-not-a", "B's write to 'plan.md' creates B's own row; A's row unchanged", `bStatus=${r.status} bBody=${JSON.stringify(r.body)} aRowNow=${JSON.stringify(svcBody)}`);
  }

  // Stale expectedVersion -> PT409 version_conflict.
  {
    const r = await rpcRaw(jwtA, "ten_ws_write", { p_path: "plan.md", p_content: "# A's plan v2\n", p_expected: "0000000000000000" });
    pass(r.status === 409 && r.body?.message === "version_conflict", "ws-stale-version", "A stale expectedVersion -> PT409 version_conflict", `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  // Missing file -> PT404 resource_missing.
  {
    const r = await rpcRaw(jwtA, "ten_ws_write", { p_path: "does-not-exist.md", p_content: "x", p_expected: "0000000000000000" });
    pass(r.status === 404 && r.body?.message === "resource_missing", "ws-missing-file", "A writes a missing file with an expectedVersion -> PT404 resource_missing", `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  // Create twice -> PT409 already_exists.
  {
    const r = await rpcRaw(jwtA, "ten_ws_write", { p_path: "plan.md", p_content: "dup", p_expected: null });
    pass(r.status === 409 && r.body?.message === "already_exists", "ws-create-twice", "A creates 'plan.md' again (no expectedVersion) -> PT409 already_exists", `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  // Path rules.
  {
    const cases = [
      { path: "skills/x.md", status: 403, message: "not_editable", label: "skills/x.md" },
      { path: "sub/CLAUDE.md", status: 403, message: "not_editable", label: "claude.md in a subfolder" },
      { path: "../x.md", status: 400, message: "invalid_ref", label: "../x.md" },
      { path: ".hidden.md", status: 400, message: "invalid_ref", label: ".hidden.md" },
      { path: "zero​width.md", status: 400, message: "invalid_ref", label: "a zero-width char" },
      { path: "café.md", status: 400, message: "invalid_ref", label: "NFD-normalized path" },
    ];
    for (const c of cases) {
      const r = await rpcRaw(jwtA, "ten_ws_write", { p_path: c.path, p_content: "x", p_expected: null });
      pass(r.status === c.status && r.body?.message === c.message, `ws-path-rule-${c.label.replace(/[^a-z0-9]+/gi, "-")}`, `path rule: ${c.label} -> PT${c.status} ${c.message}`, `status=${r.status} body=${JSON.stringify(r.body)}`);
    }
  }

  // N (non-member): PT403 not_a_member on write, 0 rows on select.
  {
    const w = await rpcRaw(jwtN, "ten_ws_write", { p_path: "n.md", p_content: "x", p_expected: null });
    pass(w.status === 403 && w.body?.message === "not_a_member", "ws-n-write", "N (non-member) write -> PT403 not_a_member", `status=${w.status} body=${JSON.stringify(w.body)}`);
    const s = await selectRaw(jwtN, "ten_ws_files", "select=path");
    const rows = Array.isArray(s.body) ? s.body : [];
    pass(s.status === 200 && rows.length === 0, "ws-n-select", "N (non-member) select -> 0 rows", `status=${s.status} rows=${JSON.stringify(s.body)}`);
  }

  // anon (publishable key, no session): refused.
  {
    const w = await rpcRaw(null, "ten_ws_write", { p_path: "anon.md", p_content: "x", p_expected: null });
    pass(w.status >= 400, "ws-anon-write", "anon (no session) write is refused", `status=${w.status} body=${JSON.stringify(w.body)}`);
    const s = await selectRaw(null, "ten_ws_files", "select=path");
    const rows = Array.isArray(s.body) ? s.body : [];
    pass(s.status >= 400 || rows.length === 0, "ws-anon-select", "anon (no session) select is refused or returns 0 rows", `status=${s.status} body=${JSON.stringify(s.body)}`);
  }

  // ===================== Storage: ten-workspaces bucket =====================

  const miniPdf = Buffer.from(
    "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
    "utf8"
  );
  const cvPathA = `users/${uidA}/ws/documents/cv.pdf`;

  // A uploads a tiny valid PDF.
  {
    const r = await clientA.storage.from(BUCKET).upload(cvPathA, miniPdf, { contentType: "application/pdf" });
    if (!r.error) uploadedObjects.add(cvPathA);
    pass(!r.error, "st-a-upload", "A uploads users/{A}/ws/documents/cv.pdf (tiny valid PDF)", r.error ? r.error.message : JSON.stringify(r.data));
  }

  // B cannot list, download, or overwrite it.
  {
    const l = await clientB.storage.from(BUCKET).list(`users/${uidA}/ws/documents`);
    const lEntries = l.data?.length ?? 0;
    pass(!!l.error || lEntries === 0, "st-b-cannot-list-a", "B cannot list users/{A}/ws/documents", l.error ? l.error.message : `entries=${lEntries}`);

    const d = await clientB.storage.from(BUCKET).download(cvPathA);
    pass(!!d.error, "st-b-cannot-download-a", "B cannot download A's cv.pdf", d.error ? d.error.message : "download succeeded (BAD)");

    const u = await clientB.storage.from(BUCKET).update(cvPathA, miniPdf, { contentType: "application/pdf" });
    pass(!!u.error, "st-b-cannot-overwrite-a", "B cannot overwrite A's cv.pdf", u.error ? u.error.message : "overwrite succeeded (BAD)");
  }

  // B uploading into A's folder (a different filename) is refused.
  {
    const hackPath = `users/${uidA}/ws/documents/hack.pdf`;
    const r = await clientB.storage.from(BUCKET).upload(hackPath, miniPdf, { contentType: "application/pdf" });
    if (!r.error) uploadedObjects.add(hackPath);
    pass(!!r.error, "st-b-cannot-upload-into-a", "B uploading a new file into A's folder is refused", r.error ? r.error.message : "upload succeeded (BAD)");
  }

  // .md upload is refused (binaries only).
  {
    const mdPath = `users/${uidA}/ws/documents/note.md`;
    const r = await clientA.storage.from(BUCKET).upload(mdPath, Buffer.from("# note\n"), { contentType: "text/markdown" });
    if (!r.error) uploadedObjects.add(mdPath);
    pass(!!r.error, "st-md-refused", "A uploading a .md file to the bucket is refused (binaries only)", r.error ? r.error.message : "upload succeeded (BAD)");
  }

  // N (non-member) can't upload.
  {
    const nPath = `users/${uidN}/ws/documents/cv.pdf`;
    const r = await clientN.storage.from(BUCKET).upload(nPath, miniPdf, { contentType: "application/pdf" });
    if (!r.error) uploadedObjects.add(nPath);
    pass(!!r.error, "st-n-cannot-upload", "N (non-member) cannot upload to their own folder", r.error ? r.error.message : "upload succeeded (BAD)");
  }

  // anon can't list or download.
  {
    const l = await clientAnon.storage.from(BUCKET).list(`users/${uidA}/ws/documents`);
    const lEntries = l.data?.length ?? 0;
    pass(!!l.error || lEntries === 0, "st-anon-cannot-list", "anon cannot list users/{A}/ws/documents", l.error ? l.error.message : `entries=${lEntries}`);

    const d = await clientAnon.storage.from(BUCKET).download(cvPathA);
    pass(!!d.error, "st-anon-cannot-download", "anon cannot download A's cv.pdf", d.error ? d.error.message : "download succeeded (BAD)");
  }

  // A can read their own.
  {
    const d = await clientA.storage.from(BUCKET).download(cvPathA);
    const okBytes = !d.error && d.data && d.data.size === miniPdf.length;
    pass(okBytes, "st-a-can-read-own", "A can read their own cv.pdf", d.error ? d.error.message : `size=${d.data?.size}`);
  }

  // ===================== Ledger =====================

  // A sees only their own rows.
  {
    const r = await selectRaw(jwtA, "ten_usage_ledger", "select=user_id,kind,usd");
    const rows = Array.isArray(r.body) ? r.body : [];
    const allOwn = rows.length > 0 && rows.every((row) => row.user_id === uidA);
    pass(r.status === 200 && allOwn, "ledger-a-own-rows", "A sees only their own ten_usage_ledger rows", `status=${r.status} rows=${JSON.stringify(rows)}`);
  }

  // ten_balance() = 5 for A, 0 for N.
  {
    const rA = await rpcRaw(jwtA, "ten_balance", {});
    const rN = await rpcRaw(jwtN, "ten_balance", {});
    pass(rA.status === 200 && Number(rA.body) === 5, "ledger-balance-a", "ten_balance() = 5 for A", `status=${rA.status} body=${JSON.stringify(rA.body)}`);
    pass(rN.status === 200 && Number(rN.body) === 0, "ledger-balance-n", "ten_balance() = 0 for N", `status=${rN.status} body=${JSON.stringify(rN.body)}`);
  }

  // A can't call ten_balance_for or ten_beta_spend_today (service-only).
  {
    const r1 = await rpcRaw(jwtA, "ten_balance_for", { p_user: uidA });
    pass(r1.status >= 400, "ledger-a-cannot-balance-for", "A cannot call ten_balance_for (service-role only)", `status=${r1.status} body=${JSON.stringify(r1.body)}`);
    const r2 = await rpcRaw(jwtA, "ten_beta_spend_today", {});
    pass(r2.status >= 400, "ledger-a-cannot-spend-today", "A cannot call ten_beta_spend_today (service-role only)", `status=${r2.status} body=${JSON.stringify(r2.body)}`);
  }

  // A can't insert ledger rows.
  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ten_usage_ledger`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${jwtA}`, Prefer: "return=representation" },
      body: JSON.stringify({ user_id: uidA, kind: "credit", usd: 100 }),
    });
    pass(res.status >= 400, "ledger-a-cannot-insert", "A cannot insert a ten_usage_ledger row directly", `status=${res.status} body=${await res.text()}`);
  }

  // ===================== Gate =====================

  const gateId = crypto.randomUUID();
  const chatId = `spike3-chat-${rand()}`;
  const gateArgs = {
    p_id: gateId,
    p_chat: chatId,
    p_label: "Spike 3 test gate",
    p_text_hash: `sha256:${sha256hex("spike 3 test gate text")}`,
    p_gate_line: "This costs up to $1.00 — nothing starts until you say yes.",
    p_amount: 1.0,
  };

  // A can ten_gate_open their own.
  {
    const r = await rpcRaw(jwtA, "ten_gate_open", gateArgs);
    pass(r.status === 200 || r.status === 204, "gate-a-open", "A can ten_gate_open", `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  // B can't decide A's gate (returns false; the gate stays pending).
  {
    const r = await rpcRaw(jwtB, "ten_gate_decide", { p_id: gateId, p_status: "approved", p_typed: "yes" });
    const notDecided = r.status === 200 && r.body === false;
    const svc = await fetch(`${SUPABASE_URL}/rest/v1/ten_gate_log?select=status&id=eq.${gateId}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    const svcBody = await svc.json();
    const stillPending = Array.isArray(svcBody) && svcBody[0]?.status === "pending";
    pass(notDecided && stillPending, "gate-b-cannot-decide-a", "B cannot decide A's gate (returns false; gate stays pending)", `decideStatus=${r.status} decideBody=${JSON.stringify(r.body)} rowNow=${JSON.stringify(svcBody)}`);
  }

  // A can ten_gate_decide their own.
  {
    const r = await rpcRaw(jwtA, "ten_gate_decide", { p_id: gateId, p_status: "approved", p_typed: "yes" });
    pass(r.status === 200 && r.body === true, "gate-a-decide", "A can ten_gate_decide their own gate", `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  // N gets not_a_member on ten_gate_open.
  {
    const r = await rpcRaw(jwtN, "ten_gate_open", { ...gateArgs, p_id: crypto.randomUUID(), p_chat: `${chatId}-n` });
    pass(r.status === 403 && r.body?.message === "not_a_member", "gate-n-not-a-member", "N (non-member) ten_gate_open -> PT403 not_a_member", `status=${r.status} body=${JSON.stringify(r.body)}`);
  }
}

async function cleanup() {
  console.log("\n--- cleanup ---");
  const errors = [];

  // Remove every object this script uploaded (service role), including any
  // that "should have been refused" attempts might have left behind (they
  // shouldn't have, but re-list to be sure rather than trust the in-memory set).
  try {
    const allPaths = new Set(uploadedObjects);
    for (const uid of [uidA, uidB, uidN]) {
      if (!uid) continue;
      const { data } = await admin.storage.from(BUCKET).list(`users/${uid}/ws/documents`);
      for (const f of data ?? []) allPaths.add(`users/${uid}/ws/documents/${f.name}`);
    }
    if (allPaths.size) {
      const { error } = await admin.storage.from(BUCKET).remove([...allPaths]);
      if (error) errors.push(`remove objects: ${error.message}`);
      record("cleanup-objects", `remove ${allPaths.size} object(s) from ${BUCKET}`, error ? "FAIL" : "PASS", [...allPaths].join(", "));
    } else {
      record("cleanup-objects", `remove objects from ${BUCKET}`, "PASS", "none found");
    }
  } catch (e) {
    errors.push(`list/remove objects: ${e.message}`);
  }

  // Delete the 3 auth users. ten_usage_ledger, ten_gate_log, ten_ws_files
  // rows cascade (FK ... on delete cascade).
  for (const [label, uid] of [["a", uidA], ["b", uidB], ["n", uidN]]) {
    if (!uid) continue;
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) errors.push(`deleteUser ${label}: ${error.message}`);
    record(`cleanup-user-${label}`, `delete user ${label.toUpperCase()}`, error ? "FAIL" : "PASS", error?.message);
  }

  // Verify: 0 objects left under any of the 3 uids, 0 ten_ rows for those
  // uids, the 3 users gone.
  {
    let remainingObjects = 0;
    for (const uid of [uidA, uidB, uidN]) {
      if (!uid) continue;
      const { data } = await admin.storage.from(BUCKET).list(`users/${uid}/ws`, { limit: 1000 });
      remainingObjects += data?.length ?? 0;
      const { data: docs } = await admin.storage.from(BUCKET).list(`users/${uid}/ws/documents`, { limit: 1000 });
      remainingObjects += docs?.length ?? 0;
    }
    record("verify-objects-gone", `0 objects left in ${BUCKET} for A/B/N`, remainingObjects === 0 ? "PASS" : "FAIL", `remaining=${remainingObjects}`);
  }
  {
    let remainingRows = 0;
    for (const table of ["ten_ws_files", "ten_usage_ledger", "ten_gate_log"]) {
      for (const uid of [uidA, uidB, uidN]) {
        if (!uid) continue;
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=user_id&user_id=eq.${uid}`, {
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        });
        const body = await res.json();
        remainingRows += Array.isArray(body) ? body.length : 0;
      }
    }
    record("verify-ten-rows-gone", "0 ten_ rows left for A/B/N (cascade on user delete)", remainingRows === 0 ? "PASS" : "FAIL", `remaining=${remainingRows}`);
  }
  {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const remaining = (data?.users ?? []).filter((u) => [userA.email, userB.email, userN.email].includes(u.email));
    record("verify-users-gone", "the 3 throwaway users are gone", !error && remaining.length === 0 ? "PASS" : "FAIL", error ? error.message : `${remaining.length} remaining`);
  }

  if (errors.length) console.error("CLEANUP ERRORS:\n" + errors.join("\n"));
  return errors;
}

let mainError = null;
try {
  await main();
} catch (e) {
  mainError = e;
  console.error(`MAIN FAILED: ${e.message}`);
} finally {
  const cleanupErrors = await cleanup();
  console.log("\n--- summary ---");
  for (const r of results) {
    console.log(`${r.status.padEnd(6)} ${r.id}`);
  }
  const hardFails = results.filter((r) => r.status === "FAIL");
  if (mainError || hardFails.length || cleanupErrors.length) {
    console.log(`\n${hardFails.length} FAIL, ${cleanupErrors.length} cleanup error(s).`);
    process.exitCode = 1;
  } else {
    console.log("\nAll checks PASS. Cleanup verified.");
  }
}
