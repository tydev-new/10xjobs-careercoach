// Tester-owned: the composer's upload error messages (apps/web/src/backend/upload-errors.ts,
// plan step 5b item 3: "case clash, the 50-file cap, non-member -> specific
// plain messages, not a generic error") driven through the REAL
// SupabaseWorkspaceStore over the PGlite stand-in running the applied
// migration (tests/store/pglite-backend.ts), whose Storage refusals have the
// live shape: an OUTER HTTP 400 with a nested { statusCode: "403" } body
// (tests/store G3 confirms the store surfaces exactly that).
//
// "SPEC:" cases assert what the candidate is supposed to read; a failure is
// a finding (the known Storage-classification gap, owned by step 2's
// store), not a flaky test. Run: node --test tests/e2e-real/upload-errors.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseWorkspaceStore } from "../../apps/web/src/backend/supabase-workspace-store.ts";
import { uploadWithClashRenumber } from "../../apps/web/src/backend/upload-errors.ts";
import { ANON, SUPABASE_URL, createBackend, type Backend } from "../store/pglite-backend.ts";

const PDF = new TextEncoder().encode("%PDF-1.4 tester fixture\n%%EOF");
const NON_MEMBER = "Ten is in a private beta. Ask the person who invited you for access.";

let shared: Backend | undefined;
async function be(): Promise<Backend> {
  shared ??= await createBackend();
  return shared;
}
function storeOn(b: Backend, uid: string) {
  return createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON, userId: uid, accessToken: async () => `jwt:${uid}`, fetchImpl: b.fetchImpl });
}

test("an exact clash renumbers: cv.pdf, then cv-2.pdf, then cv-3.pdf (§ 2 Uploads)", async () => {
  const b = await be();
  const uid = await b.newUser({ member: true });
  const s = storeOn(b, uid);
  const got = [];
  for (let i = 0; i < 3; i++) got.push((await uploadWithClashRenumber(s, "cv.pdf", PDF)).path);
  assert.deepEqual(got, ["documents/cv.pdf", "documents/cv-2.pdf", "documents/cv-3.pdf"]);
  const fourth = await uploadWithClashRenumber(s, "cv.pdf", PDF);
  assert.equal(fourth.ok, false);
  assert.ok(fourth.message && !/HTTP|\{/.test(fourth.message), `plain message, got ${fourth.message}`);
});

test("client-side refusals map exactly (too large, wrong type)", async () => {
  const b = await be();
  const uid = await b.newUser({ member: true });
  const s = storeOn(b, uid);
  const big = await uploadWithClashRenumber(s, "big.pdf", new Uint8Array(10 * 1024 * 1024 + 1));
  assert.equal(big.message, "big.pdf is over the 10 MB upload limit.");
  const wrong = await uploadWithClashRenumber(s, "notes.txt", PDF);
  assert.equal(wrong.message, "notes.txt isn't a file type Ten can use yet — only .pdf and .docx.");
});

test("SPEC: a member whose credit row is gone (membership lost mid-session) reads the non-member sentence", async () => {
  const b = await be();
  const uid = await b.newUser({ member: false });
  const out = await uploadWithClashRenumber(storeOn(b, uid), "cv.pdf", PDF);
  assert.equal(out.ok, false);
  assert.equal(out.message, NON_MEMBER, `got: ${out.message}`);
});

test("SPEC: the 51st object reads the workspace-full message, not 'check the name'", async () => {
  const b = await be();
  const uid = await b.newUser({ member: true });
  for (let i = 0; i < 50; i++) await b.seedObject(uid, `documents/f${i}.pdf`, PDF);
  const out = await uploadWithClashRenumber(storeOn(b, uid), "one-more.pdf", PDF);
  assert.equal(out.ok, false);
  assert.equal(out.message, "Your workspace is at its file limit. Remove something before uploading more.", `got: ${out.message}`);
});

test("a case-variant clash (CV.pdf vs cv.pdf) mentions capitalization (best-effort 400 branch)", async () => {
  const b = await be();
  const uid = await b.newUser({ member: true });
  const s = storeOn(b, uid);
  await s.upload("documents/cv.pdf", PDF);
  const out = await uploadWithClashRenumber(s, "CV.pdf", PDF);
  assert.equal(out.ok, false);
  assert.match(out.message ?? "", /capitali[sz]ation/, `got: ${out.message}`);
});
