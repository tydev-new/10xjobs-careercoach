// § 8 ten-delete-account (as amended, main 336aae1): needs only a signed-in user
// (not membership), acts only on that user, idempotent. Removes users/{uid}/
// objects through the Storage API (listed and removed page by page), then the
// ten_ws_files, ten_gate_log and 'credit' ledger rows. KEEPS the shared sign-in
// and the 'call' ledger rows, so the daily ceiling and cost history stay intact.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { call, DEL, harness, member, observe, preq, spendTodayIn, t, userJwt } from "./_harness.ts";

const B = "ten-workspaces";

function plant(h: Awaited<ReturnType<typeof harness>>, uid: string, n = 3) {
  for (let i = 0; i < n; i++) {
    h.st.objects.add(`${B}/users/${uid}/ws/documents/cv-${i}.pdf`);
    h.st.wsFiles.push({ user_id: uid, path: `notes/${i}.md` });
    h.st.gateLog.push({ user_id: uid, id: crypto.randomUUID() });
  }
  h.st.objects.add(`${B}/users/${uid}/ws/a/b/c/d/e/deep.docx`);
  h.st.objects.add(`${B}/users/${uid}/ws/.emptyFolderPlaceholder`);
  call(h.st, uid, 0.01);
}

async function del(tok: string) {
  const h = await harness();
  const res = await h.del(preq({}, { url: DEL, token: tok }));
  const txt = await res.text();
  return { res, txt };
}

const rowsOf = (h: Awaited<ReturnType<typeof harness>>, uid: string) => ({
  objects: [...h.st.objects].filter((o) => o.startsWith(`${B}/users/${uid}/`)).length,
  files: h.st.wsFiles.filter((r) => r.user_id === uid).length,
  gates: h.st.gateLog.filter((r) => r.user_id === uid).length,
  credits: h.st.ledger.filter((r) => r.user_id === uid && r.kind === "credit").length,
  calls: h.st.ledger.filter((r) => r.user_id === uid && r.kind === "call").length,
});

t("delete: only the caller's beta data goes; call rows kept; the other user's rows and objects survive; auth users kept", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  const [b] = await member(h);
  plant(h, a);
  plant(h, b);
  // same path under another bucket, and a sibling that shares A's uid as a string prefix
  h.st.objects.add(`avatars/users/${a}/ws/documents/cv-0.pdf`);
  h.st.objects.add(`${B}/users/${a}x/ws/keep.pdf`);
  const bBefore = rowsOf(h, b);
  const bObjects = [...h.st.objects].filter((o) => o.includes(b));
  const { res, txt } = await del(ta);
  assertEquals(res.status, 200, txt);
  assertEquals(rowsOf(h, a), { objects: 0, files: 0, gates: 0, credits: 0, calls: 1 }, "A: career data gone, call rows kept");
  assertEquals(rowsOf(h, b), bBefore, "B untouched");
  for (const o of bObjects) assert(h.st.objects.has(o), `B's object survived: ${o}`);
  assert(h.st.objects.has(`avatars/users/${a}/ws/documents/cv-0.pdf`), "other bucket untouched");
  assert(h.st.objects.has(`${B}/users/${a}x/ws/keep.pdf`), "string-prefix sibling untouched");
  assert(h.st.authUsers.has(a) && h.st.authUsers.has(b), "auth users kept");
  const touched = h.st.requests.map((r) => `${r.method} ${r.path.split("?")[0]}`);
  assertEquals(touched.filter((x) => x.includes("/auth/v1/admin")), []);
  assertEquals(
    [...new Set(touched.filter((x) => x.startsWith("DELETE")))].sort(),
    [
      "DELETE /rest/v1/ten_gate_log",
      "DELETE /rest/v1/ten_usage_ledger",
      "DELETE /rest/v1/ten_ws_files",
      `DELETE /storage/v1/object/${B}`,
    ],
  );
  assertEquals(touched.filter((x) => x.includes("/rpc/")), [], "no SQL/RPC path");
  const iStorage = touched.indexOf(`DELETE /storage/v1/object/${B}`);
  const iRows = touched.findIndex((x) => x.startsWith("DELETE /rest/v1/"));
  assert(iStorage >= 0 && iStorage < iRows, "Storage API removal happens before the row deletes");
  // every row DELETE is scoped to A (and the ledger one to credit rows)
  for (const r of h.st.requests.filter((r) => r.method === "DELETE" && r.path.startsWith("/rest/"))) {
    const q = new URL("http://x" + r.path).searchParams;
    assertEquals(q.getAll("user_id"), [`eq.${a}`], r.path);
    if (r.path.startsWith("/rest/v1/ten_usage_ledger")) assertEquals(q.getAll("kind"), ["eq.credit"], r.path);
  }
});

t("delete: a known deleted path downloads as not-found afterwards", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  plant(h, a);
  const url = `${h.sbUrl}/storage/v1/object/authenticated/${B}/users/${a}/ws/documents/cv-0.pdf`;
  const res0 = await fetch(url, { headers: { authorization: `Bearer ${h.serviceKey}` } });
  await res0.text();
  assertEquals(res0.status, 200);
  await del(ta);
  const res = await fetch(url, { headers: { authorization: `Bearer ${h.serviceKey}` } });
  const txt = await res.text();
  assert(res.status === 404 || (res.status === 400 && txt.includes("not found")), `${res.status} ${txt}`);
});

t("delete: idempotent — second and third calls succeed with nothing left to delete", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  plant(h, a);
  const first = await del(ta);
  assertEquals(first.res.status, 200, first.txt);
  const after1 = rowsOf(h, a);
  for (const n of [2, 3]) {
    const again = await del(ta);
    observe(`delete #${n} -> ${again.res.status} ${again.txt}`);
    assertEquals(again.res.status, 200, again.txt);
    const d = JSON.parse(again.txt).deleted;
    assertEquals([d.storageObjects, d.textFiles, d.gateLogRows], [0, 0, 0]);
    assertEquals(rowsOf(h, a), after1);
  }
});

t("delete: an ex-member (credit removed, data left behind) can delete their own data", async () => {
  const h = await harness();
  h.reset();
  const a = crypto.randomUUID();
  h.st.authUsers.add(a);
  h.st.objects.add(`${B}/users/${a}/ws/cv.pdf`);
  h.st.wsFiles.push({ user_id: a, path: "x.md" });
  h.st.gateLog.push({ user_id: a, id: crypto.randomUUID() });
  call(h.st, a, 0.3);
  const { res, txt } = await del(await userJwt(a));
  assertEquals(res.status, 200, txt);
  assertEquals(rowsOf(h, a), { objects: 0, files: 0, gates: 0, credits: 0, calls: 1 });
});

t("delete: a failure part-way (gate_log delete errors) -> 503 with CORS; a retry completes", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  plant(h, a);
  h.st.fail = { ten_gate_log: 503 };
  const res1 = await h.del(preq({}, { url: DEL, token: ta, origin: "https://ten.example.com" }));
  await res1.text();
  assertEquals(res1.status, 503);
  assertEquals(res1.headers.get("access-control-allow-origin"), "https://ten.example.com");
  h.st.fail = {};
  const second = await del(ta);
  assertEquals(second.res.status, 200, second.txt);
  assertEquals(rowsOf(h, a), { objects: 0, files: 0, gates: 0, credits: 0, calls: 1 });
});

t("delete: a storage listing failure stops before any row is deleted", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  plant(h, a);
  h.st.fail = { "/object/list/": 500 };
  const r = await del(ta);
  assert(r.res.status >= 500);
  h.st.fail = {};
  assertEquals(rowsOf(h, a).files, 3);
  assertEquals(rowsOf(h, a).credits, 1);
});

t("delete: Storage is listed and removed page by page (2,500 objects across folders, remove ≤ 1,000 per call)", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  for (let i = 0; i < 1200; i++) h.st.objects.add(`${B}/users/${a}/ws/f${String(i).padStart(4, "0")}.pdf`);
  for (let i = 0; i < 1300; i++) h.st.objects.add(`${B}/users/${a}/ws/sub/g${String(i).padStart(4, "0")}.pdf`);
  const r = await del(ta);
  assertEquals(r.res.status, 200, r.txt);
  assertEquals(rowsOf(h, a).objects, 0);
  assertEquals(JSON.parse(r.txt).deleted.storageObjects, 2500);
  const removes = h.st.requests.filter((x) => x.method === "DELETE" && x.path.startsWith("/storage/"));
  for (const x of removes) assert(JSON.parse(x.body).prefixes.length <= 1000);
  observe(`2,500 objects -> ${removes.length} remove calls`);
});

t("delete: today's beta-wide spend and the user's call history are unchanged by a delete", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  call(h.st, a, 4.9);
  const before = spendTodayIn(h.st);
  const { res } = await del(ta);
  assertEquals(res.status, 200);
  const after = spendTodayIn(h.st);
  observe(`ten_beta_spend_today before delete ${before.toFixed(2)}, after ${after.toFixed(2)}`);
  assertEquals(after, before);
  assertEquals(rowsOf(h, a).calls, 1);
});

t("delete: GET/PUT/DELETE/PATCH -> 404, nothing deleted; OPTIONS answers without auth", async () => {
  const h = await harness();
  h.reset();
  const [a, ta] = await member(h);
  plant(h, a);
  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    const res = await h.del(preq(undefined, { url: DEL, token: ta, method }));
    await res.body?.cancel();
    assertEquals(res.status, 404, method);
  }
  assertEquals(rowsOf(h, a).files, 3);
  const pre = await h.del(new Request(DEL, { method: "OPTIONS", headers: { origin: "https://ten.example.com" } }));
  assertEquals(pre.headers.get("access-control-allow-origin"), "https://ten.example.com");
});
