// Spike 3 — Supabase Storage isolation.
//
// Scope (see the coder's task): create ONE private bucket
// `spike3-isolation`, two auth users, attempt the per-user-folder RLS
// policies, run the isolation + version-conflict tests, then clean up
// everything this script created and verify the cleanup.
//
// Credentials: SUPABASE_URL, SUPABASE_ANON_KEY (publishable),
// SUPABASE_SERVICE_ROLE_KEY (secret) — read from the environment only.
// This script never logs a key. Run it with:
//   set -a; . ./.env.local; set +a; node verify.mjs
//
// BLOCKER (recorded, not worked around): creating the Storage RLS policies
// (policies.sql) requires executing SQL against the project's Postgres
// database. That needs a direct DB connection string or a Management API
// personal access token — neither is available from the three keys this
// spike was scoped to. So the policies are never created here, and the
// per-user list/read/write/delete tests run against the bucket's *default*
// (zero-policy, deny-all-to-non-service-role) state instead of the intended
// per-user rule. Those results are reported as BLOCKED, not PASS/FAIL,
// because the rule under test was never actually in effect. Everything that
// does NOT depend on the policies (bucket lifecycle, user lifecycle, the
// If-Match/ETag and updated_at behavior, using the service-role client
// which bypasses RLS) is run for real and reported PASS/FAIL.

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

const BUCKET = "spike3-isolation";
const results = []; // { id, desc, status: "PASS"|"FAIL"|"BLOCKED"|"INFO", detail }

function record(id, desc, status, detail) {
  results.push({ id, desc, status, detail });
  const line = `[${status}] ${id} — ${desc}`;
  console.log(detail !== undefined ? `${line}\n    ${detail}` : line);
}

function rand(n = 8) {
  return crypto.randomBytes(n).toString("hex");
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const userA = {
  email: `spike3-a+${rand()}@example.com`,
  password: crypto.randomBytes(18).toString("base64url"),
};
const userB = {
  email: `spike3-b+${rand()}@example.com`,
  password: crypto.randomBytes(18).toString("base64url"),
};

let bucketCreated = false;
let uidA = null;
let uidB = null;
const objectsWritten = new Set(); // paths written by the service-role client, for cleanup

async function main() {
  // 1. Bucket — fail loud if it already exists, never touch an existing one.
  {
    const { data: existing, error: getErr } = await admin.storage.getBucket(BUCKET);
    if (existing && !getErr) {
      throw new Error(
        `refusing to proceed: bucket "${BUCKET}" already exists (not created by this run, not touching it)`
      );
    }
    const { data, error } = await admin.storage.createBucket(BUCKET, {
      public: false,
    });
    if (error) throw new Error(`createBucket failed: ${error.message}`);
    bucketCreated = true;
    record("bucket-create", `create private bucket "${BUCKET}"`, "PASS", JSON.stringify(data));
  }

  // 2. Two auth users via the admin API.
  {
    const { data: a, error: aErr } = await admin.auth.admin.createUser({
      email: userA.email,
      password: userA.password,
      email_confirm: true,
    });
    if (aErr) throw new Error(`createUser A failed: ${aErr.message}`);
    uidA = a.user.id;

    const { data: b, error: bErr } = await admin.auth.admin.createUser({
      email: userB.email,
      password: userB.password,
      email_confirm: true,
    });
    if (bErr) throw new Error(`createUser B failed: ${bErr.message}`);
    uidB = b.user.id;

    record(
      "users-create",
      "create two auth users via the admin API",
      "PASS",
      `A=${uidA.slice(0, 8)}… B=${uidB.slice(0, 8)}… (uids only, no keys)`
    );
  }

  // 3. RLS policies — BLOCKED. Documented, not applied. See policies.sql.
  record(
    "policies-create",
    "add per-user-folder Storage RLS policies scoped to bucket_id = 'spike3-isolation'",
    "BLOCKED",
    "requires SQL DDL (CREATE POLICY on storage.objects); no DB connection string and no " +
      "Management API personal access token are in .env.local (only SUPABASE_URL, " +
      "SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY). Exact policies drafted in ./policies.sql."
  );

  // 4. Per-user isolation tests, run anyway, against the bucket's actual
  //    (zero-policy) state, to record what really happens. Labeled BLOCKED
  //    because the rule under test (per-user folders) was never installed —
  //    a private bucket with zero Storage policies denies everyone but the
  //    service role, so these responses are the "no policy" baseline, not a
  //    verdict on the per-user rule.
  {
    const clientA = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const clientB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: signInAErr } = await clientA.auth.signInWithPassword(userA);
    const { error: signInBErr } = await clientB.auth.signInWithPassword(userB);
    if (signInAErr || signInBErr) {
      throw new Error(
        `sign-in failed: A=${signInAErr?.message ?? "ok"} B=${signInBErr?.message ?? "ok"}`
      );
    }
    record("signin", "A and B each sign in with their own session (publishable key)", "PASS");

    const pathA = `users/${uidA}/ws/plan.md`;
    const pathB = `users/${uidB}/ws/plan.md`;

    // NOTE: since step 3 (policies-create) is BLOCKED, the bucket has ZERO
    // Storage policies. That means A's own first write below is expected to
    // be refused too (deny-all, not "correctly scoped to A"), so pathA/pathB
    // never come to exist. Every test below is therefore reported BLOCKED,
    // with the raw response recorded for the record — none of them is a
    // meaningful PASS or FAIL of the per-user rule, because the rule was
    // never installed. A downstream "success" (e.g. remove() on a path that
    // was never created returning no error) is BLOCKED too, not a real PASS.

    const aWrite = await clientA.storage.from(BUCKET).upload(pathA, "# A's plan\n", {
      contentType: "text/markdown",
    });
    const aPathExists = !aWrite.error;
    record(
      "a-writes-own",
      "A writes users/{A}/ws/plan.md with A's own session",
      "BLOCKED",
      aWrite.error ? aWrite.error.message : JSON.stringify(aWrite.data)
    );

    const bList = await clientB.storage.from(BUCKET).list(`users/${uidA}/ws`);
    record(
      "b-cannot-list-a",
      "B cannot list users/{A}/ws with B's own session",
      "BLOCKED",
      bList.error ? bList.error.message : `returned ${bList.data?.length ?? 0} entries (pathA existed: ${aPathExists})`
    );

    const bRead = await clientB.storage.from(BUCKET).download(pathA);
    record(
      "b-cannot-read-a",
      "B cannot read A's object with B's own session",
      "BLOCKED",
      bRead.error ? bRead.error.message : `download succeeded (pathA existed: ${aPathExists})`
    );

    const bOverwrite = await clientB.storage.from(BUCKET).update(pathA, "# hijacked\n", {
      contentType: "text/markdown",
    });
    record(
      "b-cannot-overwrite-a",
      "B cannot overwrite A's object with B's own session",
      "BLOCKED",
      bOverwrite.error ? bOverwrite.error.message : `overwrite succeeded (pathA existed: ${aPathExists})`
    );

    const bDelete = await clientB.storage.from(BUCKET).remove([pathA]);
    record(
      "b-cannot-delete-a",
      "B cannot delete A's object with B's own session",
      "BLOCKED",
      bDelete.error
        ? bDelete.error.message
        : `remove() returned no error, data=${JSON.stringify(bDelete.data)} (pathA existed: ${aPathExists}, so this proves nothing either way)`
    );

    const bWriteOwn = await clientB.storage.from(BUCKET).upload(pathB, "# B's plan\n", {
      contentType: "text/markdown",
    });
    const bPathExists = !bWriteOwn.error;
    record(
      "b-writes-own",
      "B can write its own users/{B}/ws/plan.md with B's own session",
      "BLOCKED",
      bWriteOwn.error ? bWriteOwn.error.message : JSON.stringify(bWriteOwn.data)
    );

    const aReadB = await clientA.storage.from(BUCKET).download(pathB);
    record(
      "a-cannot-read-b",
      "A cannot read B's object with A's own session",
      "BLOCKED",
      aReadB.error ? aReadB.error.message : `download succeeded (pathB existed: ${bPathExists})`
    );
  }

  // 5. The contract's UNVERIFIED items: If-Match/ETag on upload, and whether
  //    updated_at changes on overwrite. This does NOT need the per-user
  //    policies — run it with the service-role client, which bypasses RLS,
  //    against its own throwaway path.
  {
    const svcPath = `users/${uidA}/ws/etag-test.md`;
    objectsWritten.add(svcPath);
    const headers = {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "text/markdown",
    };
    const objUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${svcPath}`;

    // create
    const create = await fetch(objUrl, { method: "POST", headers, body: "v1\n" });
    const createBody = await create.text();
    record(
      "etag-create",
      "service-role create (POST, no x-upsert)",
      create.status === 200 ? "PASS" : "FAIL",
      `status=${create.status} body=${createBody}`
    );

    const list1 = await admin.storage.from(BUCKET).list(`users/${uidA}/ws`, {
      search: "etag-test.md",
    });
    const meta1 = list1.data?.[0];
    record(
      "etag-meta-after-create",
      "metadata after create",
      meta1 ? "INFO" : "FAIL",
      JSON.stringify({ updated_at: meta1?.updated_at, eTag: meta1?.metadata?.eTag })
    );

    // create-only semantics: same path, no x-upsert, should be a conflict
    const dupe = await fetch(objUrl, { method: "POST", headers, body: "v2-dupe\n" });
    const dupeBody = await dupe.text();
    record(
      "create-only-conflict",
      "a second create (no x-upsert) on the same path is refused",
      dupe.status === 400 || dupe.status === 409 ? "PASS" : "FAIL",
      `status=${dupe.status} body=${dupeBody}`
    );

    // If-Match with a deliberately WRONG etag, but x-upsert true: does the
    // server honor If-Match (reject with 412), or ignore it (accept)?
    const staleEtag = '"not-the-real-etag"';
    const ifMatchTry = await fetch(objUrl, {
      method: "POST",
      headers: { ...headers, "x-upsert": "true", "If-Match": staleEtag },
      body: "v2-if-match\n",
    });
    const ifMatchBody = await ifMatchTry.text();
    record(
      "if-match-conditional-write",
      "overwrite sent with a deliberately stale If-Match header (contract's UNVERIFIED item)",
      "INFO",
      `status=${ifMatchTry.status} body=${ifMatchBody} — ` +
        (ifMatchTry.status === 200
          ? "If-Match with a WRONG value was NOT honored: the overwrite succeeded anyway."
          : `If-Match appears to have blocked the write (status ${ifMatchTry.status}).`)
    );

    const list2 = await admin.storage.from(BUCKET).list(`users/${uidA}/ws`, {
      search: "etag-test.md",
    });
    const meta2 = list2.data?.[0];
    record(
      "updated-at-on-overwrite",
      "updated_at after the overwrite, compared to after create (contract's UNVERIFIED item)",
      meta1 && meta2
        ? meta1.updated_at !== meta2.updated_at
          ? "INFO (changed)"
          : "INFO (unchanged)"
        : "FAIL",
      JSON.stringify({
        before: meta1?.updated_at,
        after: meta2?.updated_at,
        etag_before: meta1?.metadata?.eTag,
        etag_after: meta2?.metadata?.eTag,
      })
    );
  }
}

async function cleanup() {
  console.log("\n--- cleanup ---");
  const errors = [];

  // Remove every object under the bucket (covers what A, B, and the
  // service-role client wrote), then the bucket itself.
  if (bucketCreated) {
    try {
      const { data: rootA } = await admin.storage.from(BUCKET).list(`users/${uidA}/ws`);
      const { data: rootB } = await admin.storage.from(BUCKET).list(`users/${uidB}/ws`);
      const paths = [
        ...(rootA ?? []).map((f) => `users/${uidA}/ws/${f.name}`),
        ...(rootB ?? []).map((f) => `users/${uidB}/ws/${f.name}`),
      ];
      if (paths.length) {
        const { error } = await admin.storage.from(BUCKET).remove(paths);
        if (error) errors.push(`remove objects: ${error.message}`);
        record("cleanup-objects", `remove ${paths.length} object(s)`, error ? "FAIL" : "PASS", paths.join(", "));
      } else {
        record("cleanup-objects", "remove objects", "PASS", "none found");
      }
    } catch (e) {
      errors.push(`list/remove objects: ${e.message}`);
    }

    try {
      const { error } = await admin.storage.emptyBucket(BUCKET);
      if (error) errors.push(`emptyBucket: ${error.message}`);
    } catch (e) {
      errors.push(`emptyBucket threw: ${e.message}`);
    }

    try {
      const { error } = await admin.storage.deleteBucket(BUCKET);
      if (error) errors.push(`deleteBucket: ${error.message}`);
      record("cleanup-bucket", `delete bucket "${BUCKET}"`, error ? "FAIL" : "PASS", error?.message);
    } catch (e) {
      errors.push(`deleteBucket threw: ${e.message}`);
    }
  }

  if (uidA) {
    const { error } = await admin.auth.admin.deleteUser(uidA);
    if (error) errors.push(`deleteUser A: ${error.message}`);
    record("cleanup-user-a", "delete user A", error ? "FAIL" : "PASS", error?.message);
  }
  if (uidB) {
    const { error } = await admin.auth.admin.deleteUser(uidB);
    if (error) errors.push(`deleteUser B: ${error.message}`);
    record("cleanup-user-b", "delete user B", error ? "FAIL" : "PASS", error?.message);
  }

  // Verify — re-list / re-fetch to prove everything is actually gone.
  {
    const { data, error } = await admin.storage.getBucket(BUCKET);
    const gone = !!error && !data;
    record("verify-bucket-gone", "getBucket() now errors (bucket does not exist)", gone ? "PASS" : "FAIL", error?.message);
  }
  {
    // listUsers and filter by the exact emails we created.
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const remaining = (data?.users ?? []).filter((u) => u.email === userA.email || u.email === userB.email);
    record(
      "verify-users-gone",
      "listUsers() no longer contains spike3-a/spike3-b",
      !error && remaining.length === 0 ? "PASS" : "FAIL",
      error ? error.message : `${remaining.length} remaining`
    );
  }

  if (errors.length) {
    console.error("CLEANUP ERRORS:\n" + errors.join("\n"));
  }
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
    console.log(`${r.status.padEnd(9)} ${r.id}`);
  }
  const hardFails = results.filter((r) => r.status === "FAIL");
  if (mainError || hardFails.length || cleanupErrors.length) {
    console.log(
      `\n${hardFails.length} FAIL, ${results.filter((r) => r.status === "BLOCKED").length} BLOCKED, ${cleanupErrors.length} cleanup error(s).`
    );
    process.exitCode = 1;
  } else {
    console.log("\nAll runnable checks PASS/INFO; the policy step is BLOCKED (see above). Cleanup verified.");
  }
}
