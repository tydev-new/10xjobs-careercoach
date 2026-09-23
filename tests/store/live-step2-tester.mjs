// Tester-owned LIVE checks for step 2 against the production project
// (career-coach-nextgen), complementing apps/web/src/backend/live/verify-live.mjs.
//
// Scope and safety (same discipline as spike 3 / verify-live):
//   - creates three throwaway auth users tester2-{a,b,n}-<rand>@example.com;
//     A and B get a $5 credit row (service role), N stays a non-member;
//   - touches ONLY rows whose user_id is one of those three uids and objects
//     under users/<those uids>/ws/; never lists, reads or changes anyone else's
//     rows or objects (no listUsers; deletion is verified per uid);
//   - cleanup in finally: remove every object under users/<uid>/ (recursive
//     walk via the service role), delete the users (ten_ rows cascade), then
//     verify 0 objects, 0 rows, users gone. Never creates or alters schema.
// Keys come from the environment only and are never printed. Run:
//   set -a; . <main>/.env.local; set +a
//   node tests/store/live-step2-tester.mjs 2>&1 | sed -E '<mask>'
import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const req = createRequire(path.join(REPO, "apps/web/package.json"));
const { createClient } = req("@supabase/supabase-js");
const { createSupabaseWorkspaceStore } = await import(path.join(REPO, "apps/web/src/backend/supabase-workspace-store.ts"));
const { exportWorkspace } = await import(path.join(REPO, "apps/web/src/backend/workspace-export.ts"));
const { checkMembership } = await import(path.join(REPO, "apps/web/src/backend/auth.ts"));
const { unzipSync } = req("fflate");

const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) {
  console.error("BLOCKED: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(2);
}
const BUCKET = "ten-workspaces";
const results = [];
const rec = (id, ok, detail = "") => {
  results.push({ id, status: ok === null ? "OBSERVED" : ok ? "PASS" : "FAIL" });
  console.log(`[${ok === null ? "OBSERVED" : ok ? "PASS" : "FAIL"}] ${id}${detail ? `\n    ${detail}` : ""}`);
};
const rand = () => crypto.randomBytes(5).toString("hex");
const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL_, SERVICE, noSession);
const users = { a: null, b: null, n: null };
const creds = {};
const enc = (s) => new TextEncoder().encode(s);
const sha16 = (s) => crypto.createHash("sha256").update(enc(s)).digest("hex").slice(0, 16);
const codeOf = async (p) => {
  try {
    await p;
    return "RESOLVED";
  } catch (e) {
    return e?.code ? `WorkspaceError:${e.code}` : `Error:${String(e?.message).slice(0, 140)}`;
  }
};

async function signIn(k) {
  const c = createClient(URL_, ANON, noSession);
  const r = await c.auth.signInWithPassword(creds[k]);
  if (r.error) throw new Error(`sign-in ${k}: ${r.error.message}`);
  return { client: c, token: r.data.session.access_token };
}
const storeFor = (uid, token) => createSupabaseWorkspaceStore({ url: URL_, anonKey: ANON, userId: uid, accessToken: async () => token });

async function main() {
  for (const k of ["a", "b", "n"]) {
    creds[k] = { email: `tester2-${k}-${rand()}@example.com`, password: crypto.randomBytes(18).toString("base64url") };
    const r = await admin.auth.admin.createUser({ ...creds[k], email_confirm: true });
    if (r.error) throw new Error(`createUser ${k}: ${r.error.message}`);
    users[k] = r.data.user.id;
  }
  const cr = await admin.from("ten_usage_ledger").insert([
    { user_id: users.a, kind: "credit", usd: 5 },
    { user_id: users.b, kind: "credit", usd: 5 },
  ]);
  rec("setup: 3 throwaway users, credit for A and B", !cr.error, cr.error?.message);

  // Two SEPARATE sessions for A (two sign-ins, two JWTs, two clients).
  const a1 = await signIn("a"), a2 = await signIn("a"), b1 = await signIn("b"), n1 = await signIn("n");
  rec("A holds two distinct sessions", a1.token !== a2.token);
  const sA1 = storeFor(users.a, a1.token), sA2 = storeFor(users.a, a2.token), sB = storeFor(users.b, b1.token), sN = storeFor(users.n, n1.token);

  // ---- membership with the user's own session
  rec("checkMembership(A session) = true", (await checkMembership(a1.client)) === true);
  rec("checkMembership(N session) = false", (await checkMembership(n1.client)) === false);
  const anonClient = createClient(URL_, ANON, noSession);
  rec("checkMembership(no session) throws, not 'false'", (await codeOf(checkMembership(anonClient))).startsWith("Error:"));

  // ---- concurrent CAS from two sessions, truly parallel (timed overlap)
  await sA1.write("race.md", "v0", null);
  let rounds = 0, good = 0, overlapped = 0;
  const detail = [];
  for (let i = 0; i < 8; i++) {
    const cur = await sA1.read("race.md");
    const writers = [sA1, sA2, sA1, sA2]; // 4 writers, same expected
    const t = [];
    const settled = await Promise.allSettled(
      writers.map(async (s, j) => {
        const start = performance.now();
        try {
          return await s.write("race.md", `round ${i} writer ${j}`, cur.version);
        } finally {
          t.push([start, performance.now()]);
        }
      }),
    );
    const won = settled.filter((r) => r.status === "fulfilled").length;
    const conflicts = settled.filter((r) => r.status === "rejected" && r.reason?.code === "version_conflict").length;
    const latestStart = Math.max(...t.map((x) => x[0])), earliestEnd = Math.min(...t.map((x) => x[1]));
    if (latestStart < earliestEnd) overlapped++;
    rounds++;
    if (won === 1 && conflicts === 3) good++;
    detail.push(`${won}w/${conflicts}c`);
    const after = await sA2.read("race.md");
    const winner = settled.find((r) => r.status === "fulfilled");
    if (!winner || after.version !== winner.value.version || after.content !== `round ${i} writer ${settled.indexOf(winner)}`) {
      good--;
      detail.push("(stored content != winner)");
    }
  }
  rec(`parallel CAS, 4 writers x 8 rounds over 2 sessions: exactly one wins each round`, good === rounds, detail.join(" "));
  rec(`the 4 requests were in flight at the same time in ${overlapped}/${rounds} rounds`, overlapped === rounds);

  // parallel CREATE of the same new path from two sessions
  {
    let ok = 0;
    for (let i = 0; i < 5; i++) {
      const s = await Promise.allSettled([sA1.write(`new-${i}.md`, "one", null), sA2.write(`new-${i}.md`, "two", null)]);
      if (s.filter((r) => r.status === "fulfilled").length === 1 && s.some((r) => r.reason?.code === "already_exists")) ok++;
    }
    rec("parallel create of one path from 2 sessions: one wins, the other already_exists (5/5)", ok === 5, `${ok}/5`);
  }
  // parallel case-variant creates: at most one may exist afterwards
  {
    const s = await Promise.allSettled([sA1.write("Case.md", "x", null), sA2.write("case.md", "y", null), sA1.write("CASE.md", "z", null)]);
    const listed = (await sA1.list()).filter((f) => f.path.toLowerCase() === "case.md").map((f) => f.path);
    rec("parallel case-variant creates leave exactly one path (advisory lock + ten_path_clash)", listed.length === 1, `${s.map((r) => r.status === "fulfilled" ? "ok" : r.reason?.code).join(",")} -> ${JSON.stringify(listed)}`);
  }
  // parallel upload of one binary path from two sessions
  const pdf = enc("%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
  {
    const s = await Promise.allSettled([sA1.upload("documents/race.pdf", pdf), sA2.upload("documents/race.pdf", enc("%PDF-1.1 other"))]);
    const codes = s.map((r) => (r.status === "fulfilled" ? "ok" : r.reason?.code ?? `Error:${String(r.reason?.message).slice(0, 80)}`));
    rec("parallel upload of one path from 2 sessions: one wins, the other already_exists", codes.filter((c) => c === "ok").length === 1 && codes.includes("already_exists"), JSON.stringify(codes));
  }
  // A and B writing the same path in parallel: separate rows, both succeed
  {
    const s = await Promise.allSettled([sA1.write("shared-name.md", "A", null), sB.write("shared-name.md", "B", null)]);
    const ra = await sA1.read("shared-name.md"), rb = await sB.read("shared-name.md");
    rec("A and B create the same path in parallel: both succeed, each sees only their own", s.every((r) => r.status === "fulfilled") && ra.content === "A" && rb.content === "B");
  }

  // ---- PT mapping live for rules only the server enforces
  {
    await sA1.upload("documents/cv.pdf", pdf);
    const got = {
      "NFD name": await codeOf(sA1.write("notes/café.md", "x", null)),
      "zero-width": await codeOf(sA1.write("notes/a​b.md", "x", null)),
      "nested CLAUDE.md": await codeOf(sA1.write("notes/CLAUDE.md", "x", null)),
      "case variant of race.md": await codeOf(sA1.write("RACE.md", "x", null)),
      "under a binary": await codeOf(sA1.write("documents/cv.pdf/x.md", "x", null)),
      "> 512 chars": await codeOf(sA1.write("a".repeat(510) + ".md", "x", null)),
      "non-member write": await codeOf(sN.write("n.md", "x", null)),
      "anon token write": await codeOf(storeFor(users.a, ANON).write("x.md", "x", null)),
    };
    const want = {
      "NFD name": "WorkspaceError:invalid_ref",
      "zero-width": "WorkspaceError:invalid_ref",
      "nested CLAUDE.md": "WorkspaceError:not_editable",
      "case variant of race.md": "WorkspaceError:path_conflict",
      "under a binary": "WorkspaceError:path_conflict",
      "> 512 chars": "WorkspaceError:invalid_ref",
      "non-member write": "WorkspaceError:not_a_member",
    };
    const bad = Object.entries(want).filter(([k, v]) => got[k] !== v);
    rec("live PT409/403/400 codes map to WorkspaceError through the store", bad.length === 0, JSON.stringify(got));
  }
  // ---- upload refusals (known step 5b gap: generic Error) — record the real shapes
  {
    const obs = {
      duplicate: await codeOf(sA1.upload("documents/cv.pdf", pdf)),
      caseVariant: await codeOf(sA1.upload("documents/CV.pdf", pdf)),
      nonMember: await codeOf(sN.upload("documents/cv.pdf", pdf)),
    };
    rec("upload refusal shapes (duplicate -> already_exists; case variant / non-member -> generic Error, the known 5b gap)", obs.duplicate === "WorkspaceError:already_exists" ? null : false, JSON.stringify(obs));
  }

  // ---- version semantics
  {
    const w = await sA1.write("ver.md", "café \u{1F600}\n", null);
    rec("text version = sha256(content)[:16] (same as local store)", w.version === sha16("café \u{1F600}\n"), `${w.version}`);
    const up = await sA1.upload("documents/ver.pdf", pdf);
    const listed = (await sA1.list()).find((f) => f.path === "documents/ver.pdf");
    const read = await sA1.read("documents/ver.pdf");
    rec("binary version: list() == read()", listed?.version === read.version, `list=${listed?.version} read=${read.version}`);
    rec("binary version: upload() == list() (§ 2: version is the object's ETag)", up.version === listed?.version, `upload=${up.version} list=${listed?.version}`);
    // raw upload response shape, for the record (header names only)
    const raw = await fetch(`${URL_}/storage/v1/object/${BUCKET}/users/${users.a}/ws/documents/raw.pdf`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${a1.token}`, "Content-Type": "application/pdf" },
      body: new Blob([pdf]),
    });
    const hdrs = [...raw.headers.keys()].filter((h) => /etag|last-modified/.test(h));
    const bodyKeys = Object.keys(await raw.json().catch(() => ({})));
    rec("raw Storage upload response", null, `status=${raw.status} etag-ish headers=${JSON.stringify(hdrs)} body keys=${JSON.stringify(bodyKeys)}`);
  }

  // ---- list() merges, and max_rows (last: adds 1,005 rows to A)
  {
    const all = (await sA1.list()).map((f) => f.path);
    rec("list() has text + binary, no duplicates", all.includes("race.md") && all.includes("documents/cv.pdf") && new Set(all).size === all.length, `${all.length} paths`);
    const before = all.filter((p) => !p.includes("/") || !p.startsWith("documents/")).length;
    const rows = [];
    for (let i = 0; i < 1005; i++) {
      const c = `bulk ${i}\n`;
      rows.push({ user_id: users.a, path: `bulk/f${String(i).padStart(4, "0")}.md`, content: c, version: sha16(c) });
    }
    const ins = await admin.from("ten_ws_files").insert(rows);
    if (ins.error) rec("seed 1,005 text rows for A via service role", false, ins.error.message);
    else {
      const cnt = await admin.from("ten_ws_files").select("path", { count: "exact", head: true }).eq("user_id", users.a);
      const listed = (await sA1.list()).filter((f) => !f.path.endsWith(".pdf") && !f.path.endsWith(".docx")).length;
      rec(`list() returns every text row (A has ${cnt.count} rows)`, listed === cnt.count, `list() text entries=${listed}`);
      const zip = unzipSync(await exportWorkspace(sA1));
      rec(`export contains every file (A has ${cnt.count} text rows + objects)`, Object.keys(zip).filter((p) => p.endsWith(".md")).length === cnt.count, `export .md entries=${Object.keys(zip).filter((p) => p.endsWith(".md")).length}`);
      void before;
    }
  }
}

async function listAllObjects(prefix) {
  const out = [];
  const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${prefix}: ${error.message}`);
  for (const e of data ?? []) {
    if (e.id === null) out.push(...(await listAllObjects(`${prefix}/${e.name}`)));
    else out.push(`${prefix}/${e.name}`);
  }
  return out;
}

async function cleanup() {
  console.log("\n--- cleanup ---");
  const errs = [];
  for (const [k, uid] of Object.entries(users)) {
    if (!uid) continue;
    try {
      const objs = await listAllObjects(`users/${uid}`);
      if (objs.length) {
        const { error } = await admin.storage.from(BUCKET).remove(objs);
        if (error) errs.push(`remove ${k}: ${error.message}`);
      }
      console.log(`removed ${objs.length} object(s) for ${k}`);
    } catch (e) {
      errs.push(String(e.message));
    }
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) errs.push(`deleteUser ${k}: ${error.message}`);
  }
  let objectsLeft = 0, rowsLeft = 0, usersLeft = 0;
  for (const uid of Object.values(users)) {
    if (!uid) continue;
    objectsLeft += (await listAllObjects(`users/${uid}`)).length;
    for (const t of ["ten_ws_files", "ten_usage_ledger", "ten_gate_log"]) {
      const r = await admin.from(t).select("user_id", { count: "exact", head: true }).eq("user_id", uid);
      rowsLeft += r.count ?? 0;
    }
    const g = await admin.auth.admin.getUserById(uid);
    if (g.data?.user) usersLeft++;
  }
  rec("cleanup: 0 objects, 0 ten_ rows, 0 users left", objectsLeft === 0 && rowsLeft === 0 && usersLeft === 0 && errs.length === 0, `objects=${objectsLeft} rows=${rowsLeft} users=${usersLeft} errors=${JSON.stringify(errs)}`);
}

let mainErr = null;
try {
  await main();
} catch (e) {
  mainErr = e;
  console.error(`MAIN FAILED: ${e.message}`);
} finally {
  await cleanup();
  const f = results.filter((r) => r.status === "FAIL").length;
  const p = results.filter((r) => r.status === "PASS").length;
  const o = results.filter((r) => r.status === "OBSERVED").length;
  console.log(`\n${p} PASS, ${f} FAIL, ${o} OBSERVED${mainErr ? ", main aborted" : ""}`);
  process.exitCode = f || mainErr ? 1 : 0;
}
