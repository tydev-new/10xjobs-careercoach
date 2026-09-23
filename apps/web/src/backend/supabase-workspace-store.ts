// SupabaseWorkspaceStore — the WorkspaceStore backed by Supabase
// (docs/design-web-agent.md § 2), against the APPLIED migration
// supabase/migrations/20260923000000_ten_beta_init.sql.
//
// - Text files (.md/.txt/.json/.html) are rows in `ten_ws_files`, written
//   through the `ten_ws_write` RPC (compare-and-swap): `p_expected: null`
//   creates, otherwise it's an update gated on the row's current version.
// - Binaries (.pdf/.docx) are objects in the private `ten-workspaces`
//   Storage bucket at `users/{uid}/ws/{path}`, create-only.
// - `list()` merges both sources (§ 2: "which never overlap").
//
// Deliberately raw `fetch` + PostgREST/Storage REST, not `@supabase/supabase-js`
// (§ 2 wants exact PTxxx -> WorkspaceErrorCode mapping off the literal HTTP
// status + body, same as spikes/3-supabase-isolation/verify.mjs's `rpcRaw`/
// `selectRaw`; supabase-js's PostgrestError hides the raw status). This also
// keeps the store trivially unit-testable with a fake `fetch`.
//
// Browser-safe: only `fetch`/`TextEncoder`/`Uint8Array`. No node:*, no
// window/document/localStorage.
import {
  type FileInfo,
  type FileRead,
  type WorkspaceStore,
  WorkspaceError,
  type WorkspaceErrorCode,
} from "../../../../packages/agent/src/types.ts";
import {
  MAX_UPLOAD_BYTES,
  assertEditSize,
  assertUploadSize,
  isEditableExt,
  isReadOnlyPath,
  isUploadExt,
  validateRef,
} from "../../../../packages/agent/src/workspace/path-rules.ts";

export const TEN_WORKSPACES_BUCKET = "ten-workspaces";

export interface SupabaseWorkspaceStoreOptions {
  /** The Supabase project URL, e.g. https://xxxx.supabase.co (no trailing slash needed). */
  url: string;
  /** The anon/publishable key (never a service-role key — this runs in the browser). */
  anonKey: string;
  /** auth.uid() of the signed-in user — used only to build Storage object paths
   *  (`users/{uid}/ws/...`); `ten_ws_files` rows are scoped by RLS off the JWT,
   *  not this value. */
  userId: string;
  /** Returns the current session's access token (JWT); called per request so a
   *  refreshed token is always used. */
  accessToken: () => Promise<string>;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface Internal {
  url: string;
  anonKey: string;
  userId: string;
  accessToken: () => Promise<string>;
  fetchImpl: typeof fetch;
}

function byteSize(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

function extOf(p: string): string {
  const i = p.lastIndexOf(".");
  const slash = p.lastIndexOf("/");
  if (i <= slash) return "";
  return p.slice(i).toLowerCase();
}

const UPLOAD_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function encodeObjectPath(p: string): string {
  return p
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/** Storage ETags come back quoted ("abcd1234"); the local/in-memory stores'
 *  `version` is a bare opaque string, so strip the quotes for parity. */
function normalizeEtag(etag: string): string {
  return etag.replace(/^"|"$/g, "");
}

// ---------------------------------------------------------------------
// PTxxx -> WorkspaceErrorCode (§ 2's "map the PTxxx codes to the
// WorkspaceError codes exactly"). PostgREST turns a `RAISE EXCEPTION
// '<name>' USING ERRCODE = 'PTxxx'` into HTTP status `xxx` with a JSON
// body `{ message: '<name>', code: 'PTxxx', ... }` — the migration's own
// comment (§ 3 there). `<name>` IS the WorkspaceErrorCode string already,
// so this map is the identity map; it exists so an unrecognized message
// (a bug, or a migration drift) fails loudly instead of being silently
// coerced into some code.
//
// NOT mapped: `not_signed_in` (PT401) and `bad_status` (PT400, the gate
// RPCs only) — neither has a WorkspaceErrorCode; `not_signed_in` should
// not happen in normal operation (the store is only used once signed in),
// see the coder's hand-back for this gap.
const PT_MESSAGE_TO_CODE: Readonly<Record<string, WorkspaceErrorCode>> = Object.freeze({
  invalid_ref: "invalid_ref",
  resource_missing: "resource_missing",
  version_conflict: "version_conflict",
  already_exists: "already_exists",
  not_editable: "not_editable",
  content_too_large: "content_too_large",
  unsupported_type: "unsupported_type",
  path_conflict: "path_conflict",
  workspace_full: "workspace_full",
  not_a_member: "not_a_member",
});

function ptMessageOf(body: unknown): string | null {
  if (body && typeof body === "object" && "message" in (body as Record<string, unknown>)) {
    const m = (body as Record<string, unknown>).message;
    return typeof m === "string" ? m : null;
  }
  return null;
}

function throwFromRpcError(fnName: string, status: number, body: unknown): never {
  const msg = ptMessageOf(body);
  if (msg && msg in PT_MESSAGE_TO_CODE) {
    throw new WorkspaceError(PT_MESSAGE_TO_CODE[msg], `${msg} (${fnName}, HTTP ${status})`);
  }
  throw new Error(`${fnName} failed: HTTP ${status} ${msg ?? JSON.stringify(body)}`);
}

async function rpc(
  o: Internal,
  fnName: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const token = await o.accessToken();
  const res = await o.fetchImpl(`${o.url}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: o.anonKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------
// list()
// ---------------------------------------------------------------------

interface TenWsFileRow {
  path: string;
  content: string;
  version: string;
  updated_at: string;
}

// PostgREST's own page cap (Supabase's default db-max-rows is 1000); a
// workspace can hold up to 2,000 text files (§ 2's cap), so one request is
// not enough — fix round 1, H3: "list() and export page through
// ten_ws_files with a stable order (path) until exhausted; never silently
// truncate." `order=path.asc` is explicit (PostgREST gives no ordering
// guarantee without it), and pagination is KEYSET (`path=gt.<cursor>`),
// not offset-based: `path` is part of the row's own primary key
// `(user_id, path)`, so it is a stable, always-advancing cursor — no
// "page N" can ever repeat or skip a row, and (unlike offset) it can't
// silently loop forever against a backend that doesn't honor offset.
const LIST_PAGE_SIZE = 1000;

async function listText(o: Internal, prefix: string): Promise<FileInfo[]> {
  const token = await o.accessToken();
  const out: FileInfo[] = [];
  let cursor: string | null = null;
  for (;;) {
    const pathQuery = cursor ? `&path=gt.${encodeURIComponent(cursor)}` : "";
    const res = await o.fetchImpl(
      `${o.url}/rest/v1/ten_ws_files?select=path,content,version,updated_at&order=path.asc&limit=${LIST_PAGE_SIZE}${pathQuery}`,
      { headers: { apikey: o.anonKey, Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`list (ten_ws_files) failed: HTTP ${res.status} ${await res.text()}`);
    }
    const rows = (await res.json()) as TenWsFileRow[];
    for (const row of rows) {
      if (prefix && !row.path.startsWith(prefix)) continue;
      const rest = prefix ? row.path.slice(prefix.length) : row.path;
      // depth <= 3 from the listed dir, matching in-memory-store.ts's rule.
      if (rest.split("/").length > 4) continue;
      out.push({
        path: row.path,
        version: row.version,
        size: byteSize(row.content),
        updatedAt: row.updated_at,
        editable: isEditableExt(row.path) && !isReadOnlyPath(row.path),
      });
    }
    if (rows.length < LIST_PAGE_SIZE) break; // exhausted
    cursor = rows[rows.length - 1].path;
  }
  return out;
}

interface StorageListEntry {
  name: string;
  id: string | null; // null for a "folder" placeholder entry
  updated_at?: string;
  created_at?: string;
  metadata?: { size?: number; eTag?: string } | null;
}

async function listBinaries(o: Internal, prefix: string): Promise<FileInfo[]> {
  const token = await o.accessToken();
  const base = `users/${o.userId}/ws`;
  const out: FileInfo[] = [];

  async function walk(relDir: string, depth: number): Promise<void> {
    if (depth > 3) return;
    const storagePrefix = relDir ? `${base}/${relDir}` : base;
    const res = await o.fetchImpl(`${o.url}/storage/v1/object/list/${TEN_WORKSPACES_BUCKET}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: o.anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ prefix: storagePrefix, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) {
      // M2 (fix round 1): a failed Storage list is an ERROR, never treated
      // as empty — a prefix with genuinely no objects still answers 200
      // with `[]` (it's a query, not an existence check), so any non-2xx
      // here is a real failure (network, auth, 5xx) that must not be
      // silently swallowed into "no binaries" (a wrong, truncated list()).
      throw new Error(`list (storage) failed: HTTP ${res.status} ${await res.text()}`);
    }
    const entries = (await res.json()) as StorageListEntry[];
    for (const e of entries) {
      const childRel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.id === null) {
        await walk(childRel, depth + 1);
        continue;
      }
      if (!isUploadExt(childRel)) continue; // the bucket policy accepts only .pdf/.docx; skip anything else defensively
      out.push({
        path: childRel,
        version: normalizeEtag(e.metadata?.eTag ?? ""),
        size: e.metadata?.size ?? 0,
        updatedAt: e.updated_at ?? e.created_at ?? new Date(0).toISOString(),
        editable: false,
      });
    }
  }

  await walk(prefix ? prefix.replace(/\/$/, "") : "", 0);
  return out;
}

async function listAll(o: Internal, dir?: string): Promise<FileInfo[]> {
  const startRel = dir ? validateRef(dir) : "";
  const prefix = startRel ? `${startRel}/` : "";
  const [text, bin] = await Promise.all([listText(o, prefix), listBinaries(o, prefix)]);
  return [...text, ...bin].sort((a, b) => a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------
// read()
// ---------------------------------------------------------------------

async function readText(o: Internal, relPath: string): Promise<FileRead> {
  const token = await o.accessToken();
  const res = await o.fetchImpl(
    `${o.url}/rest/v1/ten_ws_files?select=content,version,updated_at&path=eq.${encodeURIComponent(relPath)}`,
    { headers: { apikey: o.anonKey, Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`read (ten_ws_files) failed: HTTP ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as TenWsFileRow[];
  const row = rows[0];
  if (!row) {
    throw new WorkspaceError("resource_missing", `${relPath} does not exist.`);
  }
  return {
    path: relPath,
    version: row.version,
    size: byteSize(row.content),
    updatedAt: row.updated_at,
    editable: isEditableExt(relPath) && !isReadOnlyPath(relPath),
    binary: false,
    content: row.content,
  };
}

async function readBinary(o: Internal, relPath: string): Promise<FileRead> {
  const token = await o.accessToken();
  const objectPath = `users/${o.userId}/ws/${relPath}`;
  const res = await o.fetchImpl(`${o.url}/storage/v1/object/${TEN_WORKSPACES_BUCKET}/${encodeObjectPath(objectPath)}`, {
    headers: { apikey: o.anonKey, Authorization: `Bearer ${token}` },
  });
  if (res.status === 400 || res.status === 404) {
    throw new WorkspaceError("resource_missing", `${relPath} does not exist.`);
  }
  if (!res.ok) {
    throw new Error(`read (storage) failed: HTTP ${res.status} ${await res.text()}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const etag = res.headers.get("etag") ?? "";
  const lastMod = res.headers.get("last-modified");
  return {
    path: relPath,
    version: normalizeEtag(etag),
    size: buf.byteLength,
    updatedAt: lastMod ? new Date(lastMod).toISOString() : new Date(0).toISOString(),
    editable: false,
    binary: true,
    bytes: buf,
  };
}

async function readOne(o: Internal, rawPath: string): Promise<FileRead> {
  const relPath = validateRef(rawPath);
  if (isUploadExt(relPath)) return readBinary(o, relPath);
  return readText(o, relPath);
}

// ---------------------------------------------------------------------
// write() — text only, via ten_ws_write (compare-and-swap)
// ---------------------------------------------------------------------

interface TenWsWriteRow {
  path: string;
  version: string;
  updated_at: string;
}

async function writeOne(
  o: Internal,
  rawPath: string,
  content: string,
  expectedVersion: string | null,
): Promise<FileInfo> {
  const relPath = validateRef(rawPath);
  // Client-side pre-checks, matching the in-memory/local-folder stores
  // (§ 2's one path-rules module) and avoiding a round trip for an
  // obviously-refused write; ten_ws_write enforces the same rules again
  // server-side (never trust the client alone).
  if (isReadOnlyPath(relPath)) {
    throw new WorkspaceError("not_editable", `${relPath} is not writable by the agent.`);
  }
  if (!isEditableExt(relPath)) {
    throw new WorkspaceError("not_editable", `${relPath} is not an editable file type.`);
  }
  assertEditSize(content);

  const { status, body } = await rpc(o, "ten_ws_write", {
    p_path: relPath,
    p_content: content,
    p_expected: expectedVersion,
  });
  if (status !== 200 && status !== 201) {
    throwFromRpcError("ten_ws_write", status, body);
  }
  const row = (Array.isArray(body) ? body[0] : body) as TenWsWriteRow | undefined;
  if (!row) {
    throw new Error(`ten_ws_write returned no row: HTTP ${status} ${JSON.stringify(body)}`);
  }
  return {
    path: row.path,
    version: row.version,
    size: byteSize(content),
    updatedAt: row.updated_at,
    editable: true,
  };
}

// ---------------------------------------------------------------------
// upload() — binaries only, create-only, via Storage
// ---------------------------------------------------------------------

async function uploadOne(o: Internal, rawPath: string, bytes: Uint8Array): Promise<FileInfo> {
  const relPath = validateRef(rawPath);
  if (isReadOnlyPath(relPath)) {
    throw new WorkspaceError("not_editable", `${relPath} is not writable by the agent.`);
  }
  if (!isUploadExt(relPath)) {
    throw new WorkspaceError("unsupported_type", `${relPath} is not an uploadable file type.`);
  }
  assertUploadSize(bytes);

  const token = await o.accessToken();
  const objectPath = `users/${o.userId}/ws/${relPath}`;
  const mime = UPLOAD_MIME[extOf(relPath)] ?? "application/octet-stream";
  // No x-upsert header — create-only is the default. (§ 2 says "a clash is
  // a 409, per spike 3"; L2, fix round 1: confirmed the OUTER status is
  // actually 400, with a nested `statusCode: "409"` in the body — see the
  // duplicate-upload handling below, verified live.)
  const res = await o.fetchImpl(`${o.url}/storage/v1/object/${TEN_WORKSPACES_BUCKET}/${encodeObjectPath(objectPath)}`, {
    method: "POST",
    headers: {
      apikey: o.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": mime,
    },
    // Wrapped in a Blob, with a cast: TS's current lib.dom BlobPart/BodyInit
    // typing only accepts Uint8Array<ArrayBuffer>, not the general
    // Uint8Array<ArrayBufferLike> every plain `new Uint8Array(...)` actually
    // has — a real TS/lib.dom typing gap (SharedArrayBuffer is technically
    // assignable to ArrayBufferLike), not a runtime one; Blob accepts a
    // Uint8Array at runtime regardless of this generic parameter.
    body: new Blob([bytes as unknown as ArrayBuffer]),
  });
  if (res.status === 200 || res.status === 201) {
    // M1 (fix round 1): a binary's version IS its ETag, identical between
    // upload(), list() and read() — the upload response itself carries no
    // ETag header (confirmed live, § 2's header note), only `{ Id, Key }`,
    // so `Id` is NOT a fair stand-in for the version list()/read() will
    // report later. Fetch the object back (the only metadata route this
    // store relies on — no HEAD/info endpoint assumed) so all three agree
    // by construction.
    const etagFromUploadResponse = res.headers.get("etag");
    const version = etagFromUploadResponse
      ? normalizeEtag(etagFromUploadResponse)
      : (await readBinary(o, relPath)).version;
    return {
      path: relPath,
      version,
      size: bytes.byteLength,
      updatedAt: new Date().toISOString(),
      editable: false,
    };
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  // Storage refusals don't carry ten_ws_write's clean PT-code taxonomy —
  // they come straight off storage.objects' RLS policies (§ 2, § 8's
  // header). Confirmed against the LIVE project (the coder's hand-back):
  // a duplicate-path upload comes back as an OUTER HTTP 400 with a NESTED
  // `{ statusCode: "409", error: "Duplicate", code: "KeyAlreadyExists" }`
  // body — not a bare HTTP 409 the way ten_ws_write's PTxxx codes work —
  // so the duplicate check reads the body, not `res.status`. Every other
  // refusal (403 not a member, the RLS violation the caps/path-rules/
  // extension checks baked into the insert policy produce) is reported
  // generically; see the coder's hand-back — this is a real gap vs.
  // "map exactly" that only ten_ws_write's own PT-code path fully closes.
  const nestedStatusCode = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).statusCode : undefined;
  const errorCode = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).code : undefined;
  if (res.status === 409 || nestedStatusCode === "409" || errorCode === "KeyAlreadyExists") {
    throw new WorkspaceError("already_exists", `${relPath} already exists.`);
  }
  throw new Error(`upload failed: HTTP ${res.status} ${JSON.stringify(parsed)}`);
}

// ---------------------------------------------------------------------
// createRootClaudeMd() — the app's own one-time bypass (§ 7: "The app
// creates the workspace CLAUDE.md (create-only) at first run or import,
// for export"). NOT part of WorkspaceStore: `write()` refuses every
// CLAUDE.md write unconditionally (path-rules.ts's isReadOnlyPath, the
// same on every backend) because the AGENT must never write it — this
// helper is for the app's own setup step, never called from a tool.
// Idempotent in effect: if the row already exists (a re-run, or import
// into a workspace that already has one), it resolves with `created:
// false` rather than throwing, since the caller's intent ("make sure
// CLAUDE.md exists") is already satisfied.
// ---------------------------------------------------------------------

export interface CreateRootClaudeMdResult {
  created: boolean;
  info?: FileInfo;
}

export async function createRootClaudeMd(
  opts: SupabaseWorkspaceStoreOptions,
  content: string,
): Promise<CreateRootClaudeMdResult> {
  const o: Internal = {
    url: opts.url.replace(/\/+$/, ""),
    anonKey: opts.anonKey,
    userId: opts.userId,
    accessToken: opts.accessToken,
    fetchImpl: opts.fetchImpl ?? fetch,
  };
  assertEditSize(content);
  const { status, body } = await rpc(o, "ten_ws_write", { p_path: "CLAUDE.md", p_content: content, p_expected: null });
  if (status === 200 || status === 201) {
    const row = (Array.isArray(body) ? body[0] : body) as TenWsWriteRow | undefined;
    if (!row) throw new Error(`ten_ws_write returned no row: HTTP ${status} ${JSON.stringify(body)}`);
    return { created: true, info: { path: row.path, version: row.version, size: byteSize(content), updatedAt: row.updated_at, editable: false } };
  }
  const msg = ptMessageOf(body);
  if (msg === "already_exists") {
    return { created: false };
  }
  throwFromRpcError("ten_ws_write (createRootClaudeMd)", status, body);
}

// ---------------------------------------------------------------------

export function createSupabaseWorkspaceStore(opts: SupabaseWorkspaceStoreOptions): WorkspaceStore {
  const o: Internal = {
    url: opts.url.replace(/\/+$/, ""),
    anonKey: opts.anonKey,
    userId: opts.userId,
    accessToken: opts.accessToken,
    fetchImpl: opts.fetchImpl ?? fetch,
  };
  return {
    list: (dir?: string) => listAll(o, dir),
    read: (path: string) => readOne(o, path),
    write: (path: string, content: string, expectedVersion: string | null) => writeOne(o, path, content, expectedVersion),
    upload: (path: string, bytes: Uint8Array) => uploadOne(o, path, bytes),
  };
}

// Re-exported for tests and the export/import module (avoids re-deriving
// the same size limit in two places).
export { MAX_UPLOAD_BYTES };
