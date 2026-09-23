// Spike 3's isolation cases as a GATING offline test (plan step 2 exit:
// "isolation tests pass (spike 3 turned into CI)"), driven through
// SupabaseWorkspaceStore over the applied migration on PGlite. The live
// counterparts are apps/web/src/backend/live/verify-live.mjs and
// tests/store/live-step2-tester.mjs (manual: they need production keys).
import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceError } from "../../packages/agent/src/types.ts";
import { createSupabaseWorkspaceStore } from "../../apps/web/src/backend/supabase-workspace-store.ts";
import { ANON, SUPABASE_URL, createBackend } from "./pglite-backend.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc("%PDF-1.4 isolation\n%%EOF");

/** tokenUid = whose JWT the requests carry; pathUid = the uid the store
 *  puts into Storage paths (a malicious client can set it to anyone's). */
function store(be: Awaited<ReturnType<typeof createBackend>>, tokenUid: string, pathUid = tokenUid) {
  return createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON, userId: pathUid, accessToken: async () => `jwt:${tokenUid}`, fetchImpl: be.fetchImpl });
}
async function code(p: Promise<unknown>) {
  try {
    await p;
    return "RESOLVED";
  } catch (e) {
    return e instanceof WorkspaceError ? e.code : "Error";
  }
}

test("S1 member B cannot list, read or overwrite member A's text files; B's same-path write is B's own row", async () => {
  const be = await createBackend();
  const A = await be.newUser(), B = await be.newUser();
  const a = store(be, A), b = store(be, B);
  const w = await a.write("plan.md", "A's plan", null);
  assert.deepEqual(await b.list(), []);
  assert.equal(await code(b.read("plan.md")), "resource_missing");
  assert.equal(await code(b.write("plan.md", "B overwrites", w.version)), "resource_missing");
  await b.write("plan.md", "B's plan", null);
  const ra = await a.read("plan.md");
  assert.ok(!ra.binary && ra.content === "A's plan");
});

test("S2 member B cannot list, read or create objects under A's Storage prefix, even by spoofing A's uid in the path", async () => {
  const be = await createBackend();
  const A = await be.newUser(), B = await be.newUser();
  await store(be, A).upload("documents/cv.pdf", PDF);
  const spoof = store(be, B, A); // B's token, A's folder
  assert.deepEqual(await spoof.list(), [], "B listed A's objects");
  assert.equal(await code(spoof.read("documents/cv.pdf")), "resource_missing");
  assert.notEqual(await code(spoof.upload("documents/evil.pdf", PDF)), "RESOLVED", "B created an object in A's folder");
  assert.deepEqual((await store(be, A).list()).map((f) => f.path), ["documents/cv.pdf"]);
});

test("S3 a signed-in non-member can neither write nor read beta data (text or objects)", async () => {
  const be = await createBackend();
  const N = await be.newUser({ member: false });
  const n = store(be, N);
  assert.equal(await code(n.write("n.md", "x", null)), "not_a_member");
  assert.notEqual(await code(n.upload("documents/n.pdf", PDF)), "RESOLVED");
  await be.seedText(N, { "planted.md": "row inserted by the service role" });
  await be.seedObject(N, "documents/planted.pdf", PDF);
  assert.deepEqual(await n.list(), [], "a non-member can read beta rows/objects");
});

test("S4 no session (anon): nothing is readable or writable", async () => {
  const be = await createBackend();
  const A = await be.newUser();
  await store(be, A).write("plan.md", "x", null);
  const anon = createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON, userId: A, accessToken: async () => "anon", fetchImpl: be.fetchImpl });
  assert.notEqual(await code(anon.list()), "RESOLVED", "anon list resolved"); // anon has no grant on ten_ws_files
  assert.notEqual(await code(anon.write("x.md", "x", null)), "RESOLVED");
});
