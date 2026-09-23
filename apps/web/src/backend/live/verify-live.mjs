// Step 2 live verification — the Supabase-backed WorkspaceStore
// (apps/web/src/backend/supabase-workspace-store.ts) against the REAL
// applied migration (supabase/migrations/20260923000000_ten_beta_init.sql)
// on the owner's production project career-coach-nextgen, per
// docs/design-web-agent.md § 2 and the lead's instructions.
//
// Reuses spikes/3-supabase-isolation/verify.mjs's approach: throwaway
// users (spike2-*@example.com), temporary credit rows via the service
// role, strict cleanup in finally, nothing created/altered in the schema —
// only this script's own throwaway users/rows/objects are touched, and
// cleanup is verified at the end (0 leftovers).
//
// UNLIKE spike 3 (which drove the isolation checks with raw REST calls),
// this script drives THIS SLICE'S OWN CODE — createSupabaseWorkspaceStore()
// from ./supabase-workspace-store.ts — so a pass here proves the actual
// store implementation, not just the SQL underneath it.
//
// Credentials: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
// read from the environment only, never logged. Run from the repo root,
// with the MAIN checkout's git-ignored .env.local (never a real workspace):
//   set -a; . ./.env.local; set +a
//   node apps/web/src/backend/live/verify-live.mjs 2>&1 | \
//     sed -E 's/(sb_(secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]{20,}|https:\/\/[a-z0-9]+\.supabase\.co)/<masked>/g'
//
// Scope: throwaway users A, B, N (spike2-a-*, spike2-b-*, spike2-n-*
// @example.com). A and B get a $5 credit row (service role) so they're
// beta members; N stays a non-member. Nothing else in the schema is
// created or altered.
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { createSupabaseWorkspaceStore } from "../supabase-workspace-store.ts";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("BLOCKED: missing one of SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const BUCKET = "ten-workspaces";
const results = []; // { id, desc, status: "PASS"|"FAIL", detail }
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

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const userA = { email: `spike2-a-${rand()}@example.com`, password: crypto.randomBytes(18).toString("base64url") };
const userB = { email: `spike2-b-${rand()}@example.com`, password: crypto.randomBytes(18).toString("base64url") };
const userN = { email: `spike2-n-${rand()}@example.com`, password: crypto.randomBytes(18).toString("base64url") };

let uidA = null, uidB = null, uidN = null;
let jwtA = null, jwtB = null, jwtN = null;

/** A per-user store built from THIS SLICE'S code, with a fixed (not
 *  refreshing) access token — good enough for a short-lived script. */
function storeFor(userId, accessToken) {
  return createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON_KEY, userId, accessToken: async () => accessToken });
}

async function main() {
  // 0. Precondition: the real bucket must already exist (created by the migration).
  {
    const { data, error } = await admin.storage.getBucket(BUCKET);
    if (error || !data) {
      throw new Error(`precondition failed: bucket "${BUCKET}" does not exist (${error?.message}). Migration not applied?`);
    }
    record("precondition-bucket-exists", `bucket "${BUCKET}" already exists (from the migration, not created here)`, "PASS");
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

  // 3. Sign in as A, B, N with their OWN sessions (publishable/anon key).
  {
    const anonA = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const anonB = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const anonN = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const sA = await anonA.auth.signInWithPassword(userA);
    const sB = await anonB.auth.signInWithPassword(userB);
    const sN = await anonN.auth.signInWithPassword(userN);
    if (sA.error || sB.error || sN.error) {
      throw new Error(`sign-in failed: A=${sA.error?.message ?? "ok"} B=${sB.error?.message ?? "ok"} N=${sN.error?.message ?? "ok"}`);
    }
    jwtA = sA.data.session.access_token;
    jwtB = sB.data.session.access_token;
    jwtN = sN.data.session.access_token;
    record("signin", "A, B, N each sign in with their own session", "PASS");
  }

  const storeA = storeFor(uidA, jwtA);
  const storeB = storeFor(uidB, jwtB);
  const storeN = storeFor(uidN, jwtN);

  // ===================== text files: write/read/list, isolation =====================

  // A creates plan.md through the store.
  {
    const info = await storeA.write("plan.md", "# A's plan\n", null);
    pass(!!info.version, "ws-a-create", "A creates plan.md via store.write() (create)", `version=${info.version}`);
  }

  // B cannot see A's plan.md (list, or a direct read).
  {
    const listedB = await storeB.list();
    pass(!listedB.some((f) => f.path === "plan.md"), "ws-b-cannot-list-a", "B's store.list() does not include A's plan.md", `listed=${JSON.stringify(listedB.map((f) => f.path))}`);
    let bReadFailed = false;
    try {
      await storeB.read("plan.md");
    } catch (e) {
      bReadFailed = e.code === "resource_missing";
    }
    pass(bReadFailed, "ws-b-cannot-read-a", "B's store.read('plan.md') fails resource_missing (sees B's own row space only)", "");
  }

  // B's write to 'plan.md' creates B's own row, not A's; A's content unchanged (verified via service role).
  {
    const infoB = await storeB.write("plan.md", "# B's plan\n", null);
    const svc = await admin.from("ten_ws_files").select("content").eq("user_id", uidA).eq("path", "plan.md");
    const aUnchanged = !svc.error && svc.data?.length === 1 && svc.data[0].content === "# A's plan\n";
    pass(!!infoB.version && aUnchanged, "ws-b-write-own-not-a", "B's write to 'plan.md' creates B's own row; A's row unchanged", `bVersion=${infoB.version} aRowNow=${JSON.stringify(svc.data)}`);
  }

  // N (non-member): store.write -> not_a_member.
  {
    let code = null;
    try {
      await storeN.write("n.md", "x", null);
    } catch (e) {
      code = e.code;
    }
    pass(code === "not_a_member", "ws-n-write", "N (non-member) store.write() -> WorkspaceError('not_a_member')", `code=${code}`);
    const listedN = await storeN.list();
    pass(listedN.length === 0, "ws-n-list", "N (non-member) store.list() -> []", `listed=${JSON.stringify(listedN)}`);
  }

  // ===================== stale write rejected =====================
  {
    const before = await storeA.read("plan.md");
    const after = await storeA.write("plan.md", "# A's plan v2\n", before.version);
    pass(after.version !== before.version, "ws-write-advances-version", "A's write with the CURRENT version succeeds and advances the version", `before=${before.version} after=${after.version}`);

    let staleCode = null;
    try {
      await storeA.write("plan.md", "# A's plan v3 (stale)\n", before.version); // before.version is now STALE
    } catch (e) {
      staleCode = e.code;
    }
    pass(staleCode === "version_conflict", "ws-stale-version", "A's write with a STALE expectedVersion -> WorkspaceError('version_conflict')", `code=${staleCode}`);
    // Content must be UNCHANGED by the rejected stale write.
    const stillV2 = await storeA.read("plan.md");
    pass(!stillV2.binary && stillV2.content === "# A's plan v2\n", "ws-stale-write-no-effect", "the rejected stale write left the content at v2, unchanged", `content=${JSON.stringify(stillV2.binary ? null : stillV2.content)}`);
  }

  // ===================== concurrent write: two parallel writes with the SAME expected version -> exactly one wins =====================
  {
    const before = await storeA.read("plan.md"); // the current (v2-edit) version
    const [r1, r2] = await Promise.allSettled([
      storeA.write("plan.md", "# A's plan — writer 1\n", before.version),
      storeA.write("plan.md", "# A's plan — writer 2\n", before.version),
    ]);
    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    const oneWon = fulfilled.length === 1;
    const otherConflicted = rejected.length === 1 && rejected[0].reason?.code === "version_conflict";
    pass(oneWon && otherConflicted, "ws-concurrent-write-exactly-one-wins", "two parallel writes with the SAME expectedVersion: exactly one succeeds, the other gets version_conflict", `r1=${r1.status}${r1.status === "rejected" ? `(${r1.reason?.code})` : ""} r2=${r2.status}${r2.status === "rejected" ? `(${r2.reason?.code})` : ""}`);
  }

  // ===================== path rules (via store.write, client + server both enforce) =====================
  {
    let claudeCode = null;
    try {
      await storeA.write("CLAUDE.md", "hacked", null);
    } catch (e) {
      claudeCode = e.code;
    }
    pass(claudeCode === "not_editable", "ws-claude-md-refused", "A's store.write('CLAUDE.md') -> not_editable (client pre-check)", `code=${claudeCode}`);

    let skillsCode = null;
    try {
      await storeA.write("skills/x.md", "hacked", null);
    } catch (e) {
      skillsCode = e.code;
    }
    pass(skillsCode === "not_editable", "ws-skills-refused", "A's store.write('skills/x.md') -> not_editable (client pre-check)", `code=${skillsCode}`);
  }

  // ===================== Storage: binaries, isolation, create-only =====================
  const miniPdf = new TextEncoder().encode(
    "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
  );

  {
    const info = await storeA.upload("documents/cv.pdf", miniPdf);
    pass(!!info.version, "st-a-upload", "A uploads documents/cv.pdf through store.upload()", `version=${info.version} size=${info.size}`);
  }

  {
    let bDownloadFailed = false;
    try {
      await storeB.read("documents/cv.pdf");
    } catch (e) {
      bDownloadFailed = e.code === "resource_missing";
    }
    pass(bDownloadFailed, "st-b-cannot-read-a", "B's store.read('documents/cv.pdf') fails resource_missing (cannot read A's object)", "");
  }

  {
    const readBack = await storeA.read("documents/cv.pdf");
    const bytesMatch = readBack.binary && readBack.bytes.length === miniPdf.length;
    pass(bytesMatch, "st-a-read-own", "A reads back its own uploaded bytes, unchanged length", `size=${readBack.binary ? readBack.bytes.length : "n/a"}`);
  }

  {
    let dupCode = null;
    try {
      await storeA.upload("documents/cv.pdf", miniPdf);
    } catch (e) {
      dupCode = e.code;
    }
    pass(dupCode === "already_exists", "st-a-upload-twice", "A uploading the SAME path twice -> already_exists (create-only)", `code=${dupCode}`);
  }

  // ===================== list() merges text + binary =====================
  {
    const listedA = await storeA.list();
    const paths = listedA.map((f) => f.path).sort();
    const hasText = paths.includes("plan.md");
    const hasBinary = paths.includes("documents/cv.pdf");
    pass(hasText && hasBinary, "ws-list-merges-both", "A's store.list() includes both the text row and the Storage object", `paths=${JSON.stringify(paths)}`);
  }
}

async function cleanup() {
  console.log("\n--- cleanup ---");
  const errors = [];

  // Remove every object this script uploaded, re-listed via the service
  // role (not trusting an in-memory set) so an unexpected write is still caught.
  try {
    let allPaths = [];
    for (const uid of [uidA, uidB, uidN]) {
      if (!uid) continue;
      const { data } = await admin.storage.from(BUCKET).list(`users/${uid}/ws/documents`);
      for (const f of data ?? []) allPaths.push(`users/${uid}/ws/documents/${f.name}`);
    }
    if (allPaths.length) {
      const { error } = await admin.storage.from(BUCKET).remove(allPaths);
      if (error) errors.push(`remove objects: ${error.message}`);
      record("cleanup-objects", `remove ${allPaths.length} object(s) from ${BUCKET}`, error ? "FAIL" : "PASS", allPaths.join(", "));
    } else {
      record("cleanup-objects", `remove objects from ${BUCKET}`, "PASS", "none found");
    }
  } catch (e) {
    errors.push(`list/remove objects: ${e.message}`);
  }

  // Delete the 3 auth users. ten_usage_ledger, ten_gate_log, ten_ws_files
  // rows cascade (FK ... on delete cascade, per the migration).
  for (const [label, uid] of [["a", uidA], ["b", uidB], ["n", uidN]]) {
    if (!uid) continue;
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) errors.push(`deleteUser ${label}: ${error.message}`);
    record(`cleanup-user-${label}`, `delete user ${label.toUpperCase()}`, error ? "FAIL" : "PASS", error?.message);
  }

  // Verify: 0 objects left, 0 ten_ rows for those uids, the 3 users gone.
  {
    let remainingObjects = 0;
    for (const uid of [uidA, uidB, uidN]) {
      if (!uid) continue;
      const { data } = await admin.storage.from(BUCKET).list(`users/${uid}/ws/documents`, { limit: 1000 });
      remainingObjects += data?.length ?? 0;
    }
    record("verify-objects-gone", `0 objects left in ${BUCKET} for A/B/N`, remainingObjects === 0 ? "PASS" : "FAIL", `remaining=${remainingObjects}`);
  }
  {
    let remainingRows = 0;
    for (const table of ["ten_ws_files", "ten_usage_ledger", "ten_gate_log"]) {
      for (const uid of [uidA, uidB, uidN]) {
        if (!uid) continue;
        const { data } = await admin.from(table).select("user_id").eq("user_id", uid);
        remainingRows += data?.length ?? 0;
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
