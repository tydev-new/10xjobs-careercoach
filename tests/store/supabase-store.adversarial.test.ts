// Tester-owned adversarial cases for SupabaseWorkspaceStore (step 2),
// derived from docs/design-web-agent.md § 2 and the APPLIED migration, run
// over the PGlite stand-in (tests/store/pglite-backend.ts) or, for codes the
// client never lets reach the server, over a raw scripted response.
//
// Tests named "SPEC:" assert the contract's letter where the build is
// expected to disagree; a failure there is a finding, not a flaky test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceError } from "../../packages/agent/src/types.ts";
import { createLocalFolderWorkspaceStore } from "../../packages/agent/src/workspace/local-folder-store.ts";
import { createRootClaudeMd, createSupabaseWorkspaceStore } from "../../apps/web/src/backend/supabase-workspace-store.ts";
import { ANON, SUPABASE_URL, createBackend, type Backend } from "./pglite-backend.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const sha16 = (s: string) => createHash("sha256").update(enc(s)).digest("hex").slice(0, 16);
const PDF = enc("%PDF-1.4 tester fixture\n%%EOF");

let shared: Backend | undefined;
async function be(): Promise<Backend> {
  shared ??= await createBackend();
  return shared;
}
function storeOn(b: Backend, uid: string, fetchImpl: typeof fetch = b.fetchImpl) {
  return createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON, userId: uid, accessToken: async () => `jwt:${uid}`, fetchImpl });
}
async function member(b: Backend) {
  const uid = await b.newUser({ member: true });
  return { uid, store: storeOn(b, uid) };
}
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "RESOLVED";
  } catch (e) {
    return e instanceof WorkspaceError ? `WorkspaceError:${e.code}` : `Error:${(e as Error).message.slice(0, 120)}`;
  }
}

// ---------------------------------------------------------------- A. PT code mapping

test("A1 every WorkspaceError code ten_ws_write raises maps exactly, driven by the real SQL", async () => {
  const b = await be();
  const { uid, store } = await member(b);
  await store.write("plan.md", "v1", null);
  const v1 = (await store.read("plan.md")).version;
  await store.write("plan.md", "v2", v1);
  await store.write("docs.md/inner.md", "x", null);
  await store.upload("documents/cv.pdf", PDF);
  const non = await b.newUser({ member: false });
  const got: Record<string, string> = {
    already_exists: await codeOf(store.write("plan.md", "again", null)),
    version_conflict: await codeOf(store.write("plan.md", "stale", v1)),
    resource_missing: await codeOf(store.write("missing.md", "x", "0000000000000000")),
    "path_conflict (case variant)": await codeOf(store.write("Plan.md", "x", null)),
    "path_conflict (under a text file)": await codeOf(store.write("plan.md/child.md", "x", null)),
    "path_conflict (folder of an existing path)": await codeOf(store.write("docs.md", "x", null)),
    "path_conflict (under a binary)": await codeOf(store.write("documents/cv.pdf/x.md", "x", null)),
    "not_editable (nested CLAUDE.md, server-only)": await codeOf(store.write("notes/CLAUDE.md", "x", null)),
    not_a_member: await codeOf(storeOn(b, non).write("n.md", "x", null)),
    "invalid_ref (zero-width, server-only)": await codeOf(store.write("a\u200Bb.md", "x", null)),
    "invalid_ref (control char, server-only)": await codeOf(store.write("a\u0007b.md", "x", null)),
    "invalid_ref (513 chars, server-only)": await codeOf(store.write("a".repeat(510) + ".md", "x", null)),
  };
  const want: Record<string, string> = {
    already_exists: "WorkspaceError:already_exists",
    version_conflict: "WorkspaceError:version_conflict",
    resource_missing: "WorkspaceError:resource_missing",
    "path_conflict (case variant)": "WorkspaceError:path_conflict",
    "path_conflict (under a text file)": "WorkspaceError:path_conflict",
    "path_conflict (folder of an existing path)": "WorkspaceError:path_conflict",
    "path_conflict (under a binary)": "WorkspaceError:path_conflict",
    "not_editable (nested CLAUDE.md, server-only)": "WorkspaceError:not_editable",
    not_a_member: "WorkspaceError:not_a_member",
    "invalid_ref (zero-width, server-only)": "WorkspaceError:invalid_ref",
    "invalid_ref (control char, server-only)": "WorkspaceError:invalid_ref",
    "invalid_ref (513 chars, server-only)": "WorkspaceError:invalid_ref",
  };
  assert.deepEqual(got, want);
  void uid;
});

test("A2 workspace_full (PT413) at 2,000 text files, driven by the real SQL", async () => {
  const b = await createBackend({ maxRows: null });
  const { uid, store } = await member(b);
  const seed: Record<string, string> = {};
  for (let i = 0; i < 2000; i++) seed[`bulk/f${String(i).padStart(4, "0")}.md`] = "x";
  await b.seedText(uid, seed);
  assert.equal(await codeOf(store.write("one-more.md", "x", null)), "WorkspaceError:workspace_full");
  // an update of an existing file is still allowed at the cap
  const r = await store.read("bulk/f0000.md");
  assert.equal(await codeOf(store.write("bulk/f0000.md", "y", r.version)), "RESOLVED");
});

test("A3 every PT code/message in the migration's table maps from the literal HTTP body (scripted responses)", async () => {
  const table: [number, string, string][] = [
    [409, "already_exists", "already_exists"],
    [409, "version_conflict", "version_conflict"],
    [409, "path_conflict", "path_conflict"],
    [404, "resource_missing", "resource_missing"],
    [403, "not_editable", "not_editable"],
    [403, "not_a_member", "not_a_member"],
    [400, "invalid_ref", "invalid_ref"],
    [415, "unsupported_type", "unsupported_type"],
    [413, "content_too_large", "content_too_large"],
    [413, "workspace_full", "workspace_full"],
  ];
  for (const [status, message, code] of table) {
    const f: typeof fetch = async () =>
      new Response(JSON.stringify({ code: `PT${status}`, message, details: null, hint: null }), { status });
    const s = storeOn({ fetchImpl: f } as Backend, "11111111-1111-1111-1111-111111111111", f);
    assert.equal(await codeOf(s.write("ok.md", "x", null)), `WorkspaceError:${code}`, `PT${status} ${message}`);
  }
  // Not WorkspaceError codes: must surface as a plain Error, never coerced.
  for (const [status, body] of [
    [401, { code: "PT401", message: "not_signed_in" }],
    [400, { code: "PT400", message: "bad_status" }],
    [400, { code: "23514", message: 'new row for relation "ten_ws_files" violates check constraint "ten_ws_files_ext"' }],
    [500, "upstream timeout"],
  ] as [number, unknown][]) {
    const f: typeof fetch = async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    const s = storeOn({ fetchImpl: f } as Backend, "11111111-1111-1111-1111-111111111111", f);
    assert.match(await codeOf(s.write("ok.md", "x", null)), /^Error:/, JSON.stringify(body));
  }
});

test("A4 no session (anon role): the write is refused and not mis-mapped to a WorkspaceError code", async () => {
  const b = await be();
  const s = createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON, userId: "00000000-0000-0000-0000-000000000000", accessToken: async () => "anon", fetchImpl: b.fetchImpl });
  assert.match(await codeOf(s.write("x.md", "x", null)), /^Error:/);
});

// ---------------------------------------------------------------- B. version semantics

test("B1 text version = sha256(content)[:16], the same as the local-folder store, and consistent across write/read/list", async () => {
  const b = await be();
  const { store } = await member(b);
  const content = "# Plan\nnaïve café 日本語 \u{1F600}\r\n";
  const w = await store.write("plan.md", content, null);
  const r = await store.read("plan.md");
  const l = (await store.list()).find((f) => f.path === "plan.md")!;
  assert.equal(w.version, sha16(content));
  assert.equal(r.version, w.version);
  assert.equal(l.version, w.version);
  const root = await mkdtemp(path.join(tmpdir(), "tester-local-"));
  const local = createLocalFolderWorkspaceStore(root);
  const lw = await local.write("plan.md", content, null);
  assert.equal(lw.version, w.version, "local-folder and Supabase stores disagree on version for the same bytes");
  assert.equal(w.size, enc(content).byteLength);
  assert.equal(l.size, enc(content).byteLength);
});

test("B2 version is content-addressed: an identical rewrite keeps the version; A->B->A revalidates the old token (documented, matches local store)", async () => {
  const b = await be();
  const { store } = await member(b);
  const a = await store.write("n.md", "A", null);
  const same = await store.write("n.md", "A", a.version);
  assert.equal(same.version, a.version);
  const bb = await store.write("n.md", "B", a.version);
  await store.write("n.md", "A", bb.version);
  assert.equal(await codeOf(store.write("n.md", "C", a.version)), "RESOLVED", "ABA: the first token is valid again");
});

test("B3 binary version: upload(), list() and read() report the same version (the object's ETag, § 2)", async () => {
  const b = await be();
  const { store } = await member(b);
  const up = await store.upload("documents/cv.pdf", PDF);
  const listed = (await store.list()).find((f) => f.path === "documents/cv.pdf")!;
  const read = await store.read("documents/cv.pdf");
  assert.equal(listed.version, read.version, "list vs read");
  assert.equal(up.version, listed.version, `upload() returned ${up.version} but list() says ${listed.version}`);
});

// ---------------------------------------------------------------- C. list()

test("C1 list() merges text rows and Storage objects: no duplicates, sorted, dir filter applies to both", async () => {
  const b = await be();
  const { store } = await member(b);
  await store.write("documents/notes.md", "n", null);
  await store.write("plan.md", "p", null);
  await store.write("doc/x.md", "d", null);
  await store.upload("documents/cv.pdf", PDF);
  await store.upload("documents/letters/cover.docx", enc("PK docx"));
  const all = (await store.list()).map((f) => f.path);
  assert.deepEqual(all, [...all].sort((x, y) => x.localeCompare(y)));
  assert.equal(new Set(all).size, all.length, "duplicate paths in list()");
  assert.deepEqual(new Set(all), new Set(["doc/x.md", "documents/cv.pdf", "documents/letters/cover.docx", "documents/notes.md", "plan.md"]));
  const docs = (await store.list("documents")).map((f) => f.path).sort();
  assert.deepEqual(docs, ["documents/cv.pdf", "documents/letters/cover.docx", "documents/notes.md"]);
  const bin = (await store.list()).find((f) => f.path === "documents/cv.pdf")!;
  assert.equal(bin.editable, false);
  assert.equal(bin.size, PDF.byteLength);
});

test("C2 list() depth <= 3 applies the same way to binaries as to text", async () => {
  const b = await be();
  const { store } = await member(b);
  await store.write("one/two/three/ok.md", "x", null);
  await store.write("one/two/three/four/deep.md", "x", null);
  await store.upload("one/two/three/ok.pdf", PDF);
  await store.upload("one/two/three/four/deep.pdf", PDF);
  const paths = (await store.list()).map((f) => f.path);
  assert.ok(paths.includes("one/two/three/ok.md") && paths.includes("one/two/three/ok.pdf"), JSON.stringify(paths));
  assert.ok(!paths.includes("one/two/three/four/deep.md") && !paths.includes("one/two/three/four/deep.pdf"), JSON.stringify(paths));
});

test("C3 SPEC: list() returns every text file up to the 2,000-file cap (PostgREST max_rows is 1,000 on Supabase by default)", async () => {
  const b = await createBackend({ maxRows: 1000 });
  const { uid, store } = await member(b);
  const seed: Record<string, string> = {};
  for (let i = 0; i < 1200; i++) seed[`notes/n${String(i).padStart(4, "0")}.md`] = "x";
  await b.seedText(uid, seed);
  const n = (await store.list()).length;
  assert.equal(n, 1200, `list() returned ${n} of 1200 files`);
});

test("C4 SPEC: a Storage list failure is an error, not a silently binary-free list()", async () => {
  const b = await be();
  const { uid } = await member(b);
  const s0 = storeOn(b, uid);
  await s0.write("plan.md", "p", null);
  await s0.upload("documents/cv.pdf", PDF);
  const flaky: typeof fetch = async (input, init) =>
    String(input).includes("/storage/v1/object/list/") ? new Response('{"statusCode":"500","error":"internal"}', { status: 500 }) : b.fetchImpl(input, init);
  const s = storeOn(b, uid, flaky);
  const r = await codeOf(s.list());
  assert.notEqual(r, "RESOLVED", "list() resolved without the binary and without an error");
});

// ---------------------------------------------------------------- D. path rules client-side

const CLIENT_SIDE_REFUSALS: [string, string][] = [
  ["../outside.md", "traversal"],
  ["a/../../x.md", "traversal"],
  ["/abs.md", "absolute"],
  ["C:/win.md", "drive-absolute"],
  [".hidden.md", "dot segment"],
  ["a/.git/x.md", "dot segment"],
  ["skills/x.md", "skills/"],
  ["SKILLS/x.md", "skills/ case-insensitive"],
  ["CLAUDE.md", "root CLAUDE.md"],
  ["claude.md", "root CLAUDE.md case variant"],
];
const SPEC_CLIENT_SIDE: [string, string][] = [
  ["notes/CLAUDE.md", "any CLAUDE.md (§ 2)"],
  ["a\u200Bb.md", "zero-width (Cf)"],
  ["a\u202Eb.md", "RTL override (Cf)"],
  ["a\u0007b.md", "control char"],
  ["a".repeat(510) + ".md", "> 512 chars"],
];
// § 2 says "no //, backslash"; the client normalizes both to "/" instead of
// refusing (same as the local stores). Checked separately in D5.

test("D1 the path rules path-rules.ts enforces are refused before any network call", async () => {
  const b = await be();
  const { uid } = await member(b);
  let n = 0;
  const spy: typeof fetch = async (i, init) => {
    n++;
    return b.fetchImpl(i, init);
  };
  const s = storeOn(b, uid, spy);
  for (const [p, why] of CLIENT_SIDE_REFUSALS) {
    const before = n;
    const c = await codeOf(s.write(p, "x", null));
    assert.match(c, /^WorkspaceError:(invalid_ref|outside_workspace|not_editable)$/, `${why}: ${c}`);
    assert.equal(n, before, `${why}: reached the network`);
  }
});

test("D2 SPEC: the rest of § 2's one path-rule list is also applied client-side (refused or normalized with no round trip)", async () => {
  const b = await be();
  const { uid } = await member(b);
  const reached: string[] = [];
  let n = 0;
  const spy: typeof fetch = async (i, init) => {
    n++;
    return b.fetchImpl(i, init);
  };
  const s = storeOn(b, uid, spy);
  for (const [p, why] of SPEC_CLIENT_SIDE) {
    const before = n;
    const c = await codeOf(s.write(p, "x", null));
    if (n !== before) reached.push(`${why} -> ${c}`);
  }
  assert.deepEqual(reached, [], "rules only the server enforces");
});

test("D3 SPEC: an NFD path is normalized to NFC by the client (§ 2: 'the client normalizes; the server refuses other forms')", async () => {
  const b = await be();
  const { store } = await member(b);
  const nfd = "notes/cafe\u0301.md";
  const c = await codeOf(store.write(nfd, "x", null));
  assert.equal(c, "RESOLVED", `write(NFD) -> ${c}`);
  const paths = (await store.list()).map((f) => f.path);
  assert.ok(paths.includes("notes/caf\u00e9.md"));
});

test("D4 the server still refuses what the client lets through (defence in depth), mapped to a WorkspaceError", async () => {
  const b = await be();
  const { store } = await member(b);
  for (const [p] of SPEC_CLIENT_SIDE) {
    const c = await codeOf(store.write(p, "x", null));
    assert.match(c, /^WorkspaceError:(invalid_ref|not_editable)$/, `${JSON.stringify(p)} -> ${c}`);
  }
});

// ---------------------------------------------------------------- E. .html is text

test("E1 .html is a text file: written via ten_ws_write, read as text, editable, versioned; upload refuses it", async () => {
  const b = await be();
  const { store } = await member(b);
  const html = "<!doctype html><title>Résumé</title><p>hi</p>";
  const w = await store.write("applications/acme/resume.html", html, null);
  assert.equal(w.version, sha16(html));
  const r = await store.read("applications/acme/resume.html");
  assert.equal(r.binary, false);
  if (!r.binary) assert.equal(r.content, html);
  assert.equal(r.editable, true);
  const l = (await store.list()).find((f) => f.path === "applications/acme/resume.html")!;
  assert.equal(l.editable, true);
  assert.equal(await codeOf(store.write("applications/acme/resume.html", "<p>v2</p>", w.version)), "RESOLVED");
  assert.equal(await codeOf(store.upload("x.html", enc("<p>"))), "WorkspaceError:unsupported_type");
  assert.equal(await codeOf(store.write("R.HTML", "x", null)), "RESOLVED", "extension is case-insensitive");
});

// ---------------------------------------------------------------- F/G. uploads

/** The contract's UI rule (§ 2): upload("documents/<name>"), then -2, -3 on a clash. */
async function uploadWithSuffix(store: ReturnType<typeof createSupabaseWorkspaceStore>, name: string, bytes: Uint8Array) {
  const dot = name.lastIndexOf(".");
  for (let i = 1; i <= 5; i++) {
    const p = `documents/${i === 1 ? name : `${name.slice(0, dot)}-${i}${name.slice(dot)}`}`;
    try {
      return await store.upload(p, bytes);
    } catch (e) {
      if (e instanceof WorkspaceError && e.code === "already_exists") continue;
      throw e;
    }
  }
  throw new Error("no free name");
}

test("F1 upload name clash: the store reports already_exists so the UI's -2, -3 loop works", async () => {
  const b = await be();
  const { store } = await member(b);
  const a = await uploadWithSuffix(store, "cv.pdf", PDF);
  const b2 = await uploadWithSuffix(store, "cv.pdf", enc("%PDF second"));
  const b3 = await uploadWithSuffix(store, "cv.pdf", enc("%PDF third"));
  assert.deepEqual([a.path, b2.path, b3.path], ["documents/cv.pdf", "documents/cv-2.pdf", "documents/cv-3.pdf"]);
});

test("F2 SPEC (known step 5b gap): a case-variant upload clash (CV.pdf vs cv.pdf) is a WorkspaceError the UI can act on", async () => {
  const b = await be();
  const { store } = await member(b);
  await store.upload("documents/cv.pdf", PDF);
  const c = await codeOf(store.upload("documents/CV.pdf", PDF));
  assert.match(c, /^WorkspaceError:(already_exists|path_conflict)$/, `got ${c}`);
});

test("G1 uploads are create-only: POST with no x-upsert; a second upload of the same path is already_exists and the first bytes survive", async () => {
  const b = await be();
  const { store } = await member(b);
  await store.upload("documents/cv.pdf", PDF);
  const up = b.calls.filter((c) => c.method !== "GET" && c.url.includes("/storage/v1/object/ten-workspaces/")).at(-1)!;
  assert.equal(up.method, "POST");
  assert.equal(up.headers["x-upsert"], undefined);
  assert.equal(await codeOf(store.upload("documents/cv.pdf", enc("%PDF evil overwrite"))), "WorkspaceError:already_exists");
  const r = await store.read("documents/cv.pdf");
  assert.ok(r.binary && Buffer.from(r.bytes).equals(Buffer.from(PDF)));
});

test("G2 upload size and type are checked client-side (0 bytes, >10 MB, .md, skills/)", async () => {
  const b = await be();
  const { store } = await member(b);
  assert.equal(await codeOf(store.upload("documents/empty.pdf", new Uint8Array())), "WorkspaceError:upload_too_large");
  assert.equal(await codeOf(store.upload("documents/big.pdf", new Uint8Array(10 * 1024 * 1024 + 1))), "WorkspaceError:upload_too_large");
  assert.equal(await codeOf(store.upload("documents/x.md", enc("x"))), "WorkspaceError:unsupported_type");
  assert.equal(await codeOf(store.upload("skills/x.pdf", PDF)), "WorkspaceError:not_editable");
});

test("G3 (known step 5b gap, confirm the description) non-member / 50-object cap / path clash uploads surface as a generic Error", async () => {
  const b = await be();
  const non = await b.newUser({ member: false });
  const obs: Record<string, string> = {};
  obs.nonMember = await codeOf(storeOn(b, non).upload("documents/cv.pdf", PDF));
  const { uid, store } = await member(b);
  for (let i = 0; i < 50; i++) await b.seedObject(uid, `documents/f${i}.pdf`, PDF);
  obs.cap = await codeOf(store.upload("documents/f50.pdf", PDF));
  const m2 = await member(b);
  await m2.store.write("plan.md", "x", null);
  obs.clash = await codeOf(m2.store.upload("plan.md/x.pdf", PDF));
  for (const [k, v] of Object.entries(obs)) assert.match(v, /^Error:upload failed: HTTP 400 .*403/, `${k}: ${v}`);
});

// ---------------------------------------------------------------- misc

test("H1 createRootClaudeMd creates root CLAUDE.md once (create-only), and write() still can't touch it", async () => {
  const b = await be();
  const { uid, store } = await member(b);
  const opts = { url: SUPABASE_URL, anonKey: ANON, userId: uid, accessToken: async () => `jwt:${uid}`, fetchImpl: b.fetchImpl };
  assert.equal((await createRootClaudeMd(opts, "# guardrails")).created, true);
  assert.equal((await createRootClaudeMd(opts, "# other")).created, false);
  const r = await store.read("CLAUDE.md");
  assert.ok(!r.binary && r.content === "# guardrails");
  assert.equal(r.editable, false);
  assert.equal(await codeOf(store.write("CLAUDE.md", "hacked", r.version)), "WorkspaceError:not_editable");
});

test("H2 read() of a path with PostgREST-special characters reads exactly that row", async () => {
  const b = await be();
  const { store } = await member(b);
  const weird = "notes/a,b (c) & d=e%f+g #h ?i*.md";
  await store.write(weird, "weird", null);
  await store.write("notes/a.md", "plain", null);
  const r = await store.read(weird);
  assert.ok(!r.binary && r.content === "weird");
});

test("D5 '//' and backslash are normalized client-side to one '/' (never reach the server raw)", async () => {
  const b = await be();
  const { store } = await member(b);
  const w = await store.write("a//b.md", "x", null);
  assert.equal(w.path, "a/b.md");
  assert.equal(await codeOf(store.write("a\\b.md", "y", null)), "WorkspaceError:already_exists");
});

test("D6 cross-backend: the in-memory store accepts paths the Supabase server refuses (nested CLAUDE.md, Cf, control, >512)", async () => {
  const { createInMemoryWorkspaceStore } = await import("../../packages/agent/src/workspace/in-memory-store.ts");
  const mem = createInMemoryWorkspaceStore();
  const accepted: string[] = [];
  for (const [p, why] of SPEC_CLIENT_SIDE) if ((await codeOf(mem.write(p, "x", null))) === "RESOLVED") accepted.push(why);
  assert.deepEqual(accepted, [], "in-memory store accepted these; the Supabase server refuses them");
});
