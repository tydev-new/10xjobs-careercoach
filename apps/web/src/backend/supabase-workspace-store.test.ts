// Unit tests for SupabaseWorkspaceStore against a FAKE fetch (no network,
// no real Supabase project) — the shared store-test suite covers the
// common WorkspaceStore behavior; these cover the Supabase-specific wiring:
// the PTxxx -> WorkspaceErrorCode mapping, list() merging text + binary,
// and the request shapes sent to PostgREST/Storage. Live isolation, CAS,
// and concurrent-write behavior are proved separately in
// apps/web/src/backend/live/verify-workspace-store.mjs against the real
// project (see the coder's hand-back for that run's output).
import assert from "node:assert/strict";
import test from "node:test";
import { runWorkspaceStoreSuite } from "../../../../packages/agent/test/workspace-store.shared.ts";
import { createRootClaudeMd, createSupabaseWorkspaceStore } from "./supabase-workspace-store.ts";

const SUPABASE_URL = "https://project.supabase.co";
const ANON_KEY = "anon-key";
const USER_ID = "11111111-1111-1111-1111-111111111111";

interface FakeRow {
  path: string;
  content: string;
  version: string;
  updated_at: string;
}

/** A tiny fake ten_ws_files + ten-workspaces bucket, enough to drive the
 *  shared WorkspaceStore suite through the store's real request shapes
 *  (PostgREST-shaped RPC/select, Storage-shaped list/object). */
function makeFakeBackend() {
  const rows = new Map<string, FakeRow>(); // path -> row
  const objects = new Map<string, { bytes: Uint8Array; etag: string; updatedAt: string }>(); // objectPath -> object
  let nextVersion = 1;

  function versionOf(): string {
    return String(nextVersion++);
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    // ---- RPC: ten_ws_write ----
    if (url.includes("/rest/v1/rpc/ten_ws_write")) {
      const args = JSON.parse(String(init?.body)) as { p_path: string; p_content: string; p_expected: string | null };
      const existing = rows.get(args.p_path);
      if (args.p_expected === null) {
        if (existing) {
          return jsonResponse(409, { message: "already_exists" });
        }
        const row: FakeRow = { path: args.p_path, content: args.p_content, version: versionOf(), updated_at: new Date().toISOString() };
        rows.set(args.p_path, row);
        return jsonResponse(201, [{ path: row.path, version: row.version, updated_at: row.updated_at }]);
      }
      if (!existing) {
        return jsonResponse(404, { message: "resource_missing" });
      }
      if (existing.version !== args.p_expected) {
        return jsonResponse(409, { message: "version_conflict" });
      }
      existing.content = args.p_content;
      existing.version = versionOf();
      existing.updated_at = new Date().toISOString();
      return jsonResponse(200, [{ path: existing.path, version: existing.version, updated_at: existing.updated_at }]);
    }

    // ---- select ten_ws_files (list, or a single path) ----
    if (url.includes("/rest/v1/ten_ws_files") && method === "GET") {
      const u = new URL(url);
      const pathFilter = u.searchParams.get("path"); // "eq.<path>" or null
      let out = [...rows.values()];
      if (pathFilter?.startsWith("eq.")) {
        const want = decodeURIComponent(pathFilter.slice(3));
        out = out.filter((r) => r.path === want);
      }
      return jsonResponse(
        200,
        out.map((r) => ({ path: r.path, content: r.content, version: r.version, updated_at: r.updated_at })),
      );
    }

    // ---- Storage: list ----
    if (url.includes(`/storage/v1/object/list/`) && method === "POST") {
      const { prefix } = JSON.parse(String(init?.body)) as { prefix: string };
      const normPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
      const seen = new Map<string, { name: string; id: string | null; updated_at?: string; metadata?: { size: number; eTag: string } }>();
      for (const [objectPath, obj] of objects) {
        if (!objectPath.startsWith(normPrefix)) continue;
        const rest = objectPath.slice(normPrefix.length);
        const [first, ...more] = rest.split("/");
        if (more.length > 0) {
          seen.set(first, { name: first, id: null }); // a "folder" placeholder
        } else {
          seen.set(first, { name: first, id: objectPath, updated_at: obj.updatedAt, metadata: { size: obj.bytes.byteLength, eTag: obj.etag } });
        }
      }
      return jsonResponse(200, [...seen.values()]);
    }

    // ---- Storage: upload (POST) / download (GET) ----
    if (url.includes(`/storage/v1/object/${TEN_WORKSPACES_BUCKET}/`)) {
      const objectPath = decodeURIComponent(url.split(`/storage/v1/object/${TEN_WORKSPACES_BUCKET}/`)[1]);
      if (method === "POST") {
        if (objects.has(objectPath)) {
          // The real shape (confirmed live against production, see the
          // coder's hand-back): an OUTER HTTP 400 with a NESTED
          // statusCode "409" — not a bare HTTP 409.
          return jsonResponse(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists", code: "KeyAlreadyExists" });
        }
        const bytes = new Uint8Array(await (init!.body as Blob).arrayBuffer());
        const etag = `"${versionOf()}"`;
        objects.set(objectPath, { bytes, etag, updatedAt: new Date().toISOString() });
        return jsonResponse(200, { Id: objectPath });
      }
      if (method === "GET") {
        const obj = objects.get(objectPath);
        if (!obj) return new Response("not found", { status: 400 });
        return new Response(new Blob([obj.bytes as unknown as ArrayBuffer]), { status: 200, headers: { etag: obj.etag } });
      }
    }

    throw new Error(`fake fetch: unhandled request ${method} ${url}`);
  };

  return { fetchImpl, rows, objects, versionOf };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const TEN_WORKSPACES_BUCKET = "ten-workspaces";

function makeStore(seed: Record<string, string> = {}) {
  const { fetchImpl, rows, versionOf } = makeFakeBackend();
  for (const [path, content] of Object.entries(seed)) {
    rows.set(path, { path, content, version: versionOf(), updated_at: new Date().toISOString() });
  }
  return createSupabaseWorkspaceStore({
    url: SUPABASE_URL,
    anonKey: ANON_KEY,
    userId: USER_ID,
    accessToken: async () => "fake-jwt",
    fetchImpl,
  });
}

// The shared suite (§ 2's "one store test suite run against the in-memory,
// local-folder, and Supabase stores").
runWorkspaceStoreSuite("supabase (fake backend)", makeStore);

// ---------------------------------------------------------------------
// Supabase-specific: PTxxx -> WorkspaceErrorCode mapping, off the exact
// shapes the migration raises (docs/design-web-agent.md § 2, the
// migration's § 3 comment).
// ---------------------------------------------------------------------

test("not_a_member (PT403) from ten_ws_write maps to WorkspaceError('not_a_member')", async () => {
  const { fetchImpl } = makeFakeBackend();
  const notMemberFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/ten_ws_write")) {
      return jsonResponse(403, { message: "not_a_member" });
    }
    return fetchImpl(input, init);
  };
  const store = createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON_KEY, userId: USER_ID, accessToken: async () => "jwt", fetchImpl: notMemberFetch });
  await assert.rejects(store.write("plan.md", "x", null), (err: any) => err.code === "not_a_member");
});

test("path_conflict (PT409) from ten_ws_write maps to WorkspaceError('path_conflict')", async () => {
  const { fetchImpl } = makeFakeBackend();
  const clashFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/ten_ws_write")) {
      return jsonResponse(409, { message: "path_conflict" });
    }
    return fetchImpl(input, init);
  };
  const store = createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON_KEY, userId: USER_ID, accessToken: async () => "jwt", fetchImpl: clashFetch });
  await assert.rejects(store.write("a/b.md", "x", null), (err: any) => err.code === "path_conflict");
});

test("workspace_full (PT413) from ten_ws_write maps to WorkspaceError('workspace_full')", async () => {
  const { fetchImpl } = makeFakeBackend();
  const fullFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/ten_ws_write")) {
      return jsonResponse(413, { message: "workspace_full" });
    }
    return fetchImpl(input, init);
  };
  const store = createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON_KEY, userId: USER_ID, accessToken: async () => "jwt", fetchImpl: fullFetch });
  await assert.rejects(store.write("z.md", "x", null), (err: any) => err.code === "workspace_full");
});

test("an unrecognized RPC error message fails loudly (not silently coerced)", async () => {
  const { fetchImpl } = makeFakeBackend();
  const weirdFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/ten_ws_write")) {
      return jsonResponse(500, { message: "totally_unexpected_code" });
    }
    return fetchImpl(input, init);
  };
  const store = createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON_KEY, userId: USER_ID, accessToken: async () => "jwt", fetchImpl: weirdFetch });
  await assert.rejects(store.write("z.md", "x", null), (err: any) => !(err instanceof Object && "code" in err && err.code in {}) && /totally_unexpected_code/.test(err.message));
});

// ---------------------------------------------------------------------
// list() merges text (ten_ws_files) and binary (Storage) sources.
// ---------------------------------------------------------------------

test("list() merges ten_ws_files rows and Storage objects, sorted by path", async () => {
  const { fetchImpl, rows, objects } = makeFakeBackend();
  rows.set("b.md", { path: "b.md", content: "x", version: "1", updated_at: new Date().toISOString() });
  rows.set("a.md", { path: "a.md", content: "y", version: "1", updated_at: new Date().toISOString() });
  objects.set(`users/${USER_ID}/ws/documents/cv.pdf`, { bytes: new Uint8Array([1, 2, 3]), etag: '"e1"', updatedAt: new Date().toISOString() });
  const store = createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON_KEY, userId: USER_ID, accessToken: async () => "jwt", fetchImpl });
  const listed = await store.list();
  assert.deepEqual(
    listed.map((f) => f.path),
    ["a.md", "b.md", "documents/cv.pdf"],
  );
  const pdf = listed.find((f) => f.path === "documents/cv.pdf")!;
  assert.equal(pdf.editable, false);
  assert.equal(pdf.version, "e1");
});

test("upload() then read() round-trips bytes through Storage", async () => {
  const { fetchImpl } = makeFakeBackend();
  const store = createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON_KEY, userId: USER_ID, accessToken: async () => "jwt", fetchImpl });
  const bytes = new TextEncoder().encode("%PDF-1.4 fixture");
  await store.upload("documents/resume.pdf", bytes);
  const read = await store.read("documents/resume.pdf");
  assert.equal(read.binary, true);
  if (read.binary) assert.deepEqual([...read.bytes], [...bytes]);
});

test("write() never calls the network for a read-only or bad-extension path (client pre-check)", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    throw new Error("should not be called");
  };
  const store = createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON_KEY, userId: USER_ID, accessToken: async () => "jwt", fetchImpl });
  await assert.rejects(store.write("CLAUDE.md", "x", "1"), (err: any) => err.code === "not_editable");
  await assert.rejects(store.write("documents/x.pdf", "x", null), (err: any) => err.code === "not_editable");
  assert.equal(called, false);
});

// ---------------------------------------------------------------------
// createRootClaudeMd — § 7's app-owned bypass, NOT part of WorkspaceStore.
// ---------------------------------------------------------------------

test("createRootClaudeMd: creates the row when none exists, and store.write() still refuses it afterward", async () => {
  const { fetchImpl, rows } = makeFakeBackend();
  const opts = { url: SUPABASE_URL, anonKey: ANON_KEY, userId: USER_ID, accessToken: async () => "jwt", fetchImpl };
  const result = await createRootClaudeMd(opts, "guardrails");
  assert.equal(result.created, true);
  assert.equal(result.info?.path, "CLAUDE.md");
  assert.equal(rows.get("CLAUDE.md")?.content, "guardrails");

  // Ordinary store.write() still refuses CLAUDE.md unconditionally — this
  // helper is a separate, app-owned bypass, not a backdoor through the
  // normal WorkspaceStore surface.
  const store = createSupabaseWorkspaceStore(opts);
  await assert.rejects(store.write("CLAUDE.md", "hacked", result.info!.version), (err: any) => err.code === "not_editable");
});

test("createRootClaudeMd: a second call is idempotent (created: false), not an error", async () => {
  const { fetchImpl } = makeFakeBackend();
  const opts = { url: SUPABASE_URL, anonKey: ANON_KEY, userId: USER_ID, accessToken: async () => "jwt", fetchImpl };
  const first = await createRootClaudeMd(opts, "guardrails");
  assert.equal(first.created, true);
  const second = await createRootClaudeMd(opts, "guardrails (a re-run)");
  assert.equal(second.created, false);
  assert.equal(second.info, undefined);
});
