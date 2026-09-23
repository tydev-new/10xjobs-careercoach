// Tester-owned stand-in for Supabase, for SupabaseWorkspaceStore's offline
// tests. Unlike the coder's hand-written fake, the SQL here is the REAL
// applied migration (supabase/migrations/20260923000000_ten_beta_init.sql)
// on PGlite, over tests/sql/stub.sql (Supabase roles, auth.uid() from the
// JWT claim, storage.objects + storage.foldername). Only the HTTP layer is
// emulated:
//   - PostgREST: POST /rest/v1/rpc/ten_ws_write, GET /rest/v1/ten_ws_files,
//     run AS `authenticated` with request.jwt.claims = { sub } so RLS and
//     the definer functions behave as in production. A RAISE ... USING
//     ERRCODE 'PTxxx' becomes HTTP xxx with body { code, message, details, hint }
//     (PostgREST's documented mapping). `max_rows` is emulated (Supabase's
//     default is 1000) and can be turned off.
//   - Storage: POST /storage/v1/object/list/<bucket>, POST/GET
//     /storage/v1/object/<bucket>/<path>. Uploads INSERT into storage.objects
//     AS the user, so the migration's insert policy (extension, path rule,
//     skills/, membership, ten_path_clash, 50-object cap) decides. Error
//     bodies follow the Storage API's { statusCode, error, message } shape
//     with an outer HTTP 400 (what the coder reported from the live project;
//     re-checked live by tests/store/live-step2-tester.mjs).
// The bearer token is "jwt:<uid>" (or "anon" for no user).
import { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../..");
const STUB = readFileSync(path.join(REPO, "tests/sql/stub.sql"), "utf8");
const MIG = readFileSync(path.join(REPO, "supabase/migrations/20260923000000_ten_beta_init.sql"), "utf8");

export const BUCKET = "ten-workspaces";

export interface BackendOptions {
  maxRows?: number | null; // PostgREST db-max-rows; Supabase default 1000
  dropSkillsConstraint?: boolean; // only to seed the shared suite's skills/ fixture
}

export interface Backend {
  db: PGlite;
  fetchImpl: typeof fetch;
  newUser(opts?: { member?: boolean }): Promise<string>;
  seedText(uid: string, files: Record<string, string>): Promise<void>;
  seedObject(uid: string, relPath: string, bytes: Uint8Array): Promise<void>;
  calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[];
  objectBytes: Map<string, Uint8Array>;
}

function md5(b: Uint8Array): string {
  return createHash("md5").update(b).digest("hex");
}

export async function createBackend(opts: BackendOptions = {}): Promise<Backend> {
  const maxRows = opts.maxRows === undefined ? 1000 : opts.maxRows;
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(MIG);
  if (opts.dropSkillsConstraint) {
    await db.exec("alter table public.ten_ws_files drop constraint ten_ws_files_not_skills");
  }
  const objectBytes = new Map<string, Uint8Array>(); // object name -> bytes
  const calls: Backend["calls"] = [];

  // PGlite is one connection: serialize every request so a role switch for
  // one request never leaks into another (true parallelism is proved live).
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  }

  async function asUser<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', $1, false)", [
      uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : JSON.stringify({ role: "anon" }),
    ]);
    await db.exec(uid ? "set role authenticated" : "set role anon");
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  }

  function uidFrom(headers: Record<string, string>): string | null {
    const auth = headers["authorization"] ?? "";
    const m = /^Bearer jwt:([0-9a-f-]{36})$/.exec(auth);
    return m ? m[1] : null;
  }

  function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });
  }

  function pgErrorToPostgrest(e: any): Response {
    const code: string = e?.code ?? "XX000";
    let status = 400;
    if (/^PT\d{3}$/.test(code)) status = Number(code.slice(2));
    else if (code === "42501") status = 403; // insufficient_privilege
    else if (code === "23505") status = 409;
    return json(status, { code, message: e?.message ?? String(e), details: e?.detail ?? null, hint: e?.hint ?? null });
  }

  function storageError(statusCode: string, error: string, message: string): Response {
    return json(400, { statusCode, error, message });
  }

  function iso(v: unknown): string {
    return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit | undefined).forEach((v, k) => (headers[k.toLowerCase()] = v));
    let bodyBytes: Uint8Array | undefined;
    let bodyJson: unknown;
    if (init?.body instanceof Blob) bodyBytes = new Uint8Array(await init.body.arrayBuffer());
    else if (typeof init?.body === "string") {
      try {
        bodyJson = JSON.parse(init.body);
      } catch {
        bodyJson = init.body;
      }
    }
    calls.push({ method, url: url.toString(), headers, body: bodyJson ?? (bodyBytes ? `<${bodyBytes.byteLength} bytes>` : undefined) });
    if (!headers["apikey"]) return json(401, { message: "No API key found in request" });
    const uid = uidFrom(headers);

    return serial(async () => {
      // ---------------- PostgREST ----------------
      if (url.pathname === "/rest/v1/rpc/ten_ws_write" && method === "POST") {
        const a = bodyJson as { p_path: string; p_content: string; p_expected: string | null };
        try {
          const r = await asUser(uid, () =>
            db.query<{ path: string; version: string; updated_at: Date }>(
              "select * from public.ten_ws_write($1, $2, $3)",
              [a.p_path, a.p_content, a.p_expected],
            ),
          );
          return json(200, r.rows.map((x) => ({ path: x.path, version: x.version, updated_at: iso(x.updated_at) })));
        } catch (e) {
          return pgErrorToPostgrest(e);
        }
      }
      if (url.pathname === "/rest/v1/rpc/ten_is_member" && method === "POST") {
        try {
          const r = await asUser(uid, () => db.query<{ v: boolean }>("select public.ten_is_member() as v"));
          return json(200, r.rows[0].v);
        } catch (e) {
          return pgErrorToPostgrest(e);
        }
      }
      if (url.pathname === "/rest/v1/ten_ws_files" && method === "GET") {
        const sel = (url.searchParams.get("select") ?? "*").split(",").map((s) => s.trim());
        for (const c of sel) if (!/^[a-z_]+$/.test(c)) return json(400, { message: `bad select ${c}` });
        const pathFilter = url.searchParams.get("path");
        const where: string[] = [];
        const params: unknown[] = [];
        if (pathFilter) {
          if (!pathFilter.startsWith("eq.")) return json(400, { message: "only eq supported in this stand-in" });
          params.push(pathFilter.slice(3));
          where.push(`path = $${params.length}`);
        }
        const sql = `select ${sel.join(", ")} from public.ten_ws_files ${where.length ? "where " + where.join(" and ") : ""} order by path${maxRows ? ` limit ${maxRows}` : ""}`;
        try {
          const r = await asUser(uid, () => db.query<Record<string, unknown>>(sql, params));
          return json(200, r.rows.map((row) => ("updated_at" in row ? { ...row, updated_at: iso(row.updated_at) } : row)));
        } catch (e) {
          return pgErrorToPostgrest(e);
        }
      }

      // ---------------- Storage ----------------
      const listM = /^\/storage\/v1\/object\/list\/([^/]+)$/.exec(url.pathname);
      if (listM && method === "POST") {
        if (listM[1] !== BUCKET) return storageError("404", "Bucket not found", "Bucket not found");
        const b = bodyJson as { prefix?: string; limit?: number; offset?: number };
        const prefix = (b.prefix ?? "").replace(/\/+$/, "");
        const limit = b.limit ?? 100;
        const r = await asUser(uid, () =>
          db.query<{ id: string; name: string; metadata: any; created_at: Date; updated_at: Date }>(
            "select id, name, metadata, created_at, updated_at from storage.objects where bucket_id = $1 and left(name, char_length($2) + 1) = $2 || '/' order by name",
            [BUCKET, prefix],
          ),
        );
        const folders = new Set<string>();
        const out: unknown[] = [];
        for (const o of r.rows) {
          const rest = o.name.slice(prefix.length + 1);
          const slash = rest.indexOf("/");
          if (slash >= 0) {
            const f = rest.slice(0, slash);
            if (!folders.has(f)) {
              folders.add(f);
              out.push({ name: f, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
            }
          } else {
            out.push({ name: rest, id: o.id, updated_at: iso(o.updated_at), created_at: iso(o.created_at), last_accessed_at: iso(o.updated_at), metadata: o.metadata });
          }
        }
        (out as { name: string }[]).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
        return json(200, out.slice(b.offset ?? 0, (b.offset ?? 0) + limit));
      }
      const objM = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(url.pathname);
      if (objM && (method === "POST" || method === "PUT" || method === "GET")) {
        if (objM[1] !== BUCKET) return storageError("404", "Bucket not found", "Bucket not found");
        const name = objM[2].split("/").map(decodeURIComponent).join("/");
        if (method === "GET") {
          const r = await asUser(uid, () =>
            db.query<{ metadata: any; updated_at: Date }>(
              "select metadata, updated_at from storage.objects where bucket_id = $1 and name = $2",
              [BUCKET, name],
            ),
          );
          if (!r.rows.length || !objectBytes.has(name)) return storageError("404", "not_found", "Object not found");
          return new Response(objectBytes.get(name)!.slice(), {
            status: 200,
            headers: {
              "content-type": r.rows[0].metadata?.mimetype ?? "application/octet-stream",
              etag: r.rows[0].metadata?.eTag ?? "",
              "last-modified": new Date(r.rows[0].updated_at).toUTCString(),
            },
          });
        }
        if (!uid) return storageError("403", "Unauthorized", "new row violates row-level security policy");
        const bytes = bodyBytes ?? new Uint8Array();
        if (bytes.byteLength > 10 * 1024 * 1024) return json(413, { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" });
        const mime = headers["content-type"] ?? "";
        const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
        if (!allowed.includes(mime)) return storageError("415", "invalid_mime_type", `mime type ${mime} is not supported`);
        const upsert = headers["x-upsert"] === "true";
        const eTag = `"${md5(bytes)}"`;
        const meta = { eTag, size: bytes.byteLength, mimetype: mime, cacheControl: "max-age=3600", lastModified: new Date().toISOString(), contentLength: bytes.byteLength, httpStatusCode: 200 };
        const id = randomUUID();
        try {
          await asUser(uid, () =>
            db.query(
              upsert
                ? "insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata) values ($1,$2,$3,$4::uuid,$4::text,$5) on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()"
                : "insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata) values ($1,$2,$3,$4::uuid,$4::text,$5)",
              [id, BUCKET, name, uid, JSON.stringify(meta)],
            ),
          );
        } catch (e: any) {
          if (e?.code === "23505") return storageError("409", "Duplicate", "The resource already exists");
          if (e?.code === "42501" || /row-level security/.test(e?.message ?? "")) return storageError("403", "Unauthorized", "new row violates row-level security policy");
          return storageError("500", "internal", e?.message ?? String(e));
        }
        objectBytes.set(name, bytes.slice());
        // The Storage API answers an upload with { Id, Key } and (as far as
        // the coder and this stand-in know) no ETag header; verified live.
        return json(200, { Id: id, Key: `${BUCKET}/${name}` });
      }
      return json(404, { message: `stand-in: no route for ${method} ${url.pathname}` });
    });
  };

  async function newUser({ member = true }: { member?: boolean } = {}): Promise<string> {
    const uid = randomUUID();
    await serial(async () => {
      await db.exec("reset role");
      await db.query("insert into auth.users (id) values ($1)", [uid]);
      if (member) await db.query("insert into public.ten_usage_ledger (user_id, kind, usd) values ($1, 'credit', 5)", [uid]);
    });
    return uid;
  }

  async function seedText(uid: string, files: Record<string, string>) {
    await serial(async () => {
      await db.exec("reset role");
      for (const [p, c] of Object.entries(files)) {
        await db.query(
          "insert into public.ten_ws_files (user_id, path, content, version) values ($1, $2, $3, left(encode(sha256(convert_to($3, 'UTF8')), 'hex'), 16))",
          [uid, p, c],
        );
      }
    });
  }

  async function seedObject(uid: string, relPath: string, bytes: Uint8Array) {
    const name = `users/${uid}/ws/${relPath}`;
    await serial(async () => {
      await db.exec("reset role");
      const meta = { eTag: `"${md5(bytes)}"`, size: bytes.byteLength, mimetype: "application/pdf" };
      await db.query("insert into storage.objects (bucket_id, name, owner, metadata) values ($1,$2,$3,$4)", [BUCKET, name, uid, JSON.stringify(meta)]);
    });
    objectBytes.set(name, bytes.slice());
  }

  return { db, fetchImpl, newUser, seedText, seedObject, calls, objectBytes };
}

export const SUPABASE_URL = "https://stand-in.supabase.test";
export const ANON = "anon-key-stand-in";
