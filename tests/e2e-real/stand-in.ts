// Tester-owned Supabase stand-in for the step 5b real-app e2e (plan step 5b;
// docs/design-web-agent.md § 2, § 3, § 8). ONE local HTTP origin that plays
// the Supabase project the production build is pointed at:
//
//   /auth/v1/*        GoTrue: password grant, refresh_token grant, /user,
//                     /logout. Tokens are HS256 JWTs (like GoTrue), so
//                     supabase-js decodes and refreshes them for real.
//   /rest/v1/*        PostgREST over PGlite running the REAL applied
//                     migration (supabase/migrations/20260923000000_ten_beta_init.sql)
//                     on tests/sql/stub.sql — the role comes from the JWT
//                     (anon / authenticated / service_role) exactly as
//                     PostgREST does it, so RLS, grants and the definer
//                     functions decide. ten_ws_write, ten_is_member and
//                     ten_ws_files GET are delegated to tests/store/pglite-backend.ts
//                     (reused, not copied); the rest (ten_balance, the gate
//                     RPCs, ten_gate_log reads, the service-role calls the
//                     Edge Functions make) are added here.
//   /storage/v1/*     Storage API: user upload/list/get delegated to
//                     pglite-backend.ts (the insert policy decides); the
//                     service-role list/remove ten-delete-account uses.
//   /functions/v1/*   reverse-proxied, streaming, to the deno host running
//                     the REAL supabase/functions/*/index.ts (functions-host.ts).
//                     Like Supabase's gateway, it strips /functions/v1 and adds
//                     NO CORS of its own: the function's own CORS decides.
//
// Every request is logged (method, path, Authorization, Origin) so the e2e
// can assert who called what with which token. Never touches a real
// project: it binds 127.0.0.1 only.
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import { createBackend, type Backend } from "../store/pglite-backend.ts";

export const JWT_SECRET = "e2e-real-jwt-secret-at-least-32-characters!!";

function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString("base64url");
}
export function signJwt(payload: Record<string, unknown>): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
export function verifyJwt(token: string): Record<string, any> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const sig = createHmac("sha256", JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  if (sig !== parts[2]) return null;
  try {
    const body = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof body.exp === "number" && body.exp * 1000 < Date.now()) return null;
    return body;
  } catch {
    return null;
  }
}

const FAR = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
export const ANON_KEY = signJwt({ role: "anon", iss: "supabase-e2e", exp: FAR });
export const SERVICE_KEY = signJwt({ role: "service_role", iss: "supabase-e2e", exp: FAR });

export interface LoggedRequest {
  at: number;
  method: string;
  path: string;
  search: string;
  auth: string;
  apikey: string;
  origin: string;
  /** Access-Control-Request-Headers on a preflight */
  acrh: string;
  /** Access-Control-Allow-Headers on the function's response */
  acah?: string;
  /** declared Content-Length / Transfer-Encoding, and bytes actually received */
  cl?: string;
  bodyLen?: number;
  status?: number;
}

export interface StandIn {
  url: string;
  port: number;
  backend: Backend;
  log: LoggedRequest[];
  /** tokens issued per uid, oldest first */
  issued: Map<string, string[]>;
  createUser(opts: { email: string; member?: boolean; expiresIn?: number }): Promise<string>;
  sql<T = any>(query: string, params?: unknown[]): Promise<T[]>;
  setFunctionsTarget(url: string): void;
  close(): Promise<void>;
}

interface AuthUser {
  id: string;
  email: string;
  expiresIn: number;
}

export async function startStandIn(): Promise<StandIn> {
  const backend = await createBackend({});
  const db = backend.db;
  const log: LoggedRequest[] = [];
  const users = new Map<string, AuthUser>(); // email -> user
  const byId = new Map<string, AuthUser>();
  const refresh = new Map<string, string>(); // refresh token -> uid
  const issued = new Map<string, string[]>();
  let functionsTarget = "";

  // ONE lock for every DB touch (PGlite is one connection; a role switch
  // must never leak between requests). Delegated backend calls run under it.
  let chain: Promise<unknown> = Promise.resolve();
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  }

  async function asRole<T>(role: "anon" | "authenticated" | "service_role", sub: string | null, fn: () => Promise<T>): Promise<T> {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(sub ? { sub, role } : { role })]);
    await db.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  }

  function issueSession(u: AuthUser) {
    const now = Math.floor(Date.now() / 1000);
    const access = signJwt({
      sub: u.id,
      role: "authenticated",
      aud: "authenticated",
      email: u.email,
      iat: now,
      exp: now + u.expiresIn,
      session_id: randomUUID(),
    });
    const rt = randomUUID();
    refresh.set(rt, u.id);
    const list = issued.get(u.id) ?? [];
    list.push(access);
    issued.set(u.id, list);
    return {
      access_token: access,
      token_type: "bearer",
      expires_in: u.expiresIn,
      expires_at: now + u.expiresIn,
      refresh_token: rt,
      user: userJson(u),
    };
  }
  function userJson(u: AuthUser) {
    return {
      id: u.id,
      aud: "authenticated",
      role: "authenticated",
      email: u.email,
      email_confirmed_at: "2026-09-01T00:00:00Z",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    };
  }

  function claimsOf(req: http.IncomingMessage): { ok: true; role: "anon" | "authenticated" | "service_role"; sub: string | null; token: string } | { ok: false } {
    const h = String(req.headers["authorization"] ?? "");
    const tok = /^Bearer\s+(.+)$/i.exec(h)?.[1] ?? String(req.headers["apikey"] ?? "");
    if (!tok) return { ok: true, role: "anon", sub: null, token: "" };
    const c = verifyJwt(tok);
    if (!c) return { ok: false };
    const role = c.role === "service_role" ? "service_role" : c.role === "authenticated" ? "authenticated" : "anon";
    return { ok: true, role, sub: typeof c.sub === "string" ? c.sub : null, token: tok };
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const entry: LoggedRequest = {
      at: Date.now(),
      method: req.method ?? "GET",
      path: url.pathname,
      search: url.search,
      auth: String(req.headers["authorization"] ?? ""),
      apikey: String(req.headers["apikey"] ?? ""),
      origin: String(req.headers["origin"] ?? ""),
      acrh: String(req.headers["access-control-request-headers"] ?? ""),
    };
    log.push(entry);

    // ---- Edge Functions: pass through, no gateway CORS ----
    if (url.pathname.startsWith("/functions/v1/")) {
      const target = new URL(url.pathname.slice("/functions/v1".length) + url.search, functionsTarget);
      const headers = { ...req.headers, host: target.host };
      const up = http.request(target, { method: req.method, headers }, (ur) => {
        entry.status = ur.statusCode;
        entry.acah = String(ur.headers["access-control-allow-headers"] ?? "");
        res.writeHead(ur.statusCode ?? 502, ur.headers);
        ur.pipe(res);
      });
      up.on("error", (e) => {
        entry.status = 502;
        res.writeHead(502);
        res.end(String(e));
      });
      req.pipe(up);
      return;
    }

    const cors: Record<string, string> = {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "content-range, content-length, etag, x-total-count",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(200, {
        ...cors,
        "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers": String(req.headers["access-control-request-headers"] ?? "*"),
        "access-control-max-age": "0",
      });
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    entry.cl = String(req.headers["content-length"] ?? (req.headers["transfer-encoding"] ? "te:" + req.headers["transfer-encoding"] : ""));
    entry.bodyLen = raw.length;
    const send = (status: number, body: unknown, extra: Record<string, string> = {}) => {
      entry.status = status;
      if (status === 204) {
        res.writeHead(204, { ...cors, ...extra });
        res.end();
        return;
      }
      res.writeHead(status, { "content-type": "application/json", ...cors, ...extra });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    const jsonBody = (): any => {
      try {
        return raw.length ? JSON.parse(raw.toString("utf8")) : {};
      } catch {
        return {};
      }
    };

    try {
      // ---------------- GoTrue ----------------
      if (url.pathname === "/auth/v1/token" && req.method === "POST") {
        const grant = url.searchParams.get("grant_type");
        const b = jsonBody();
        if (grant === "password") {
          const u = users.get(String(b.email ?? "").toLowerCase());
          if (!u || b.password !== "correct horse battery") return send(400, { error: "invalid_grant", error_description: "Invalid login credentials", code: "invalid_credentials", msg: "Invalid login credentials" });
          return send(200, issueSession(u));
        }
        if (grant === "refresh_token") {
          const uid = refresh.get(String(b.refresh_token ?? ""));
          if (!uid) return send(400, { error: "invalid_grant", error_description: "Invalid Refresh Token", code: "refresh_token_not_found" });
          refresh.delete(String(b.refresh_token));
          return send(200, issueSession(byId.get(uid)!));
        }
        return send(400, { error: "unsupported_grant_type" });
      }
      if (url.pathname === "/auth/v1/user" && req.method === "GET") {
        const c = claimsOf(req);
        if (!c.ok || c.role !== "authenticated" || !c.sub || !byId.has(c.sub)) return send(401, { code: 401, msg: "invalid JWT" });
        return send(200, userJson(byId.get(c.sub)!));
      }
      if (url.pathname === "/auth/v1/logout") return send(204, null);
      if (url.pathname.startsWith("/auth/v1/")) return send(404, { msg: "stand-in: no auth route " + url.pathname });

      // ---------------- PostgREST / Storage ----------------
      if (!req.headers["apikey"]) return send(401, { message: "No API key found in request" });
      const c = claimsOf(req);
      if (!c.ok) return send(401, { code: "PGRST301", message: "JWT expired", details: null, hint: null });

      const pgErr = (e: any) => {
        const code: string = e?.code ?? "XX000";
        let status = 400;
        if (/^PT\d{3}$/.test(code)) status = Number(code.slice(2));
        else if (code === "42501") status = c.role === "anon" ? 401 : 403;
        else if (code === "23505") status = 409;
        return send(status, { code, message: e?.message ?? String(e), details: e?.detail ?? null, hint: null });
      };

      // Delegated to tests/store/pglite-backend.ts (user-scoped; its token
      // format is "jwt:<uid>", so the verified JWT's sub is translated).
      const delegated =
        (url.pathname === "/rest/v1/rpc/ten_ws_write" && req.method === "POST") ||
        (url.pathname === "/rest/v1/rpc/ten_is_member" && req.method === "POST") ||
        (url.pathname === "/rest/v1/ten_ws_files" && req.method === "GET" && c.role !== "service_role") ||
        (/^\/storage\/v1\/object\/(list\/)?ten-workspaces/.test(url.pathname) && c.role !== "service_role" && req.method !== "DELETE");
      if (delegated) {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
        headers["authorization"] = c.role === "authenticated" && c.sub ? `Bearer jwt:${c.sub}` : "Bearer anon";
        const isJson = String(req.headers["content-type"] ?? "").includes("json");
        const body = req.method === "GET" ? undefined : isJson ? raw.toString("utf8") : new Blob([raw]);
        const r = await locked(() => backend.fetchImpl(`http://stand-in${url.pathname}${url.search}`, { method: req.method, headers, body }));
        const buf = Buffer.from(await r.arrayBuffer());
        entry.status = r.status;
        const outHeaders: Record<string, string> = { ...cors };
        r.headers.forEach((v, k) => (outHeaders[k] = v));
        res.writeHead(r.status, outHeaders);
        res.end(buf);
        return;
      }

      // ---- RPCs not in the reused backend ----
      const rpcM = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
      if (rpcM && req.method === "POST") {
        const fn = rpcM[1];
        const a = jsonBody();
        const calls: Record<string, { sql: string; args: unknown[]; void?: boolean }> = {
          ten_balance: { sql: "select public.ten_balance() as v", args: [] },
          ten_balance_for: { sql: "select public.ten_balance_for($1) as v", args: [a.p_user] },
          ten_beta_spend_today: { sql: "select public.ten_beta_spend_today() as v", args: [] },
          ten_gate_open: {
            sql: "select public.ten_gate_open($1,$2,$3,$4,$5,$6) as v",
            args: [a.p_id, a.p_chat, a.p_label, a.p_text_hash, a.p_gate_line, a.p_amount],
            void: true,
          },
          ten_gate_decide: { sql: "select public.ten_gate_decide($1,$2,$3) as v", args: [a.p_id, a.p_status, a.p_typed] },
          ten_gate_expire_other_chats: { sql: "select public.ten_gate_expire_other_chats($1) as v", args: [a.p_chat], void: true },
        };
        const call = calls[fn];
        if (!call) return send(404, { code: "PGRST202", message: `stand-in: no rpc ${fn}` });
        try {
          const rows = await locked(() => asRole(c.role, c.sub, () => db.query<{ v: unknown }>(call.sql, call.args)));
          if (call.void) return send(204, null);
          const v = rows.rows[0]?.v;
          // PostgREST renders numeric as a JSON number.
          return send(200, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
        } catch (e) {
          return pgErr(e);
        }
      }

      // ---- ten_gate_log reads (gate.ts pending()) ----
      if (url.pathname === "/rest/v1/ten_gate_log" && req.method === "GET") {
        const sel = (url.searchParams.get("select") ?? "*").split(",").map((s) => s.trim());
        for (const s of sel) if (!/^[a-z_]+$/.test(s) && s !== "*") return send(400, { message: "bad select" });
        const where: string[] = [];
        const params: unknown[] = [];
        for (const col of ["chat_id", "status", "id"]) {
          const f = url.searchParams.get(col);
          if (!f) continue;
          if (!f.startsWith("eq.")) return send(400, { message: "stand-in: only eq." });
          params.push(f.slice(3));
          where.push(`${col} = $${params.length}`);
        }
        const order = url.searchParams.get("order") === "created_at.desc" ? "order by created_at desc" : "order by created_at";
        const limit = Number(url.searchParams.get("limit") ?? "1000");
        try {
          const rows = await locked(() =>
            asRole(c.role, c.sub, () => db.query<any>(`select ${sel.join(", ")} from public.ten_gate_log ${where.length ? "where " + where.join(" and ") : ""} ${order} limit ${limit}`, params)),
          );
          return send(200, rows.rows.map((r: any) => ({ ...r, amount_usd: r.amount_usd === undefined ? undefined : Number(r.amount_usd) })));
        } catch (e) {
          return pgErr(e);
        }
      }

      // ---- service role: ledger insert (the proxy's meter) ----
      if (url.pathname === "/rest/v1/ten_usage_ledger" && req.method === "POST") {
        const r = jsonBody();
        try {
          await locked(() =>
            asRole(c.role, c.sub, () =>
              db.query(
                "insert into public.ten_usage_ledger (user_id, kind, request_id, model, tokens_in, tokens_out, tokens_cached, usd) values ($1,$2,$3,$4,$5,$6,$7,$8)",
                [r.user_id, r.kind, r.request_id, r.model, r.tokens_in, r.tokens_out, r.tokens_cached, r.usd],
              ),
            ),
          );
          return send(201, "");
        } catch (e) {
          return pgErr(e);
        }
      }

      // ---- service role: row deletes (ten-delete-account) ----
      const delM = /^\/rest\/v1\/(ten_ws_files|ten_gate_log|ten_usage_ledger)$/.exec(url.pathname);
      if (delM && req.method === "DELETE") {
        const params: unknown[] = [];
        const where: string[] = [];
        for (const [k, v] of url.searchParams) {
          if (!["user_id", "kind"].includes(k) || !v.startsWith("eq.")) return send(400, { message: "stand-in: unsupported filter " + k });
          params.push(v.slice(3));
          where.push(`${k} = $${params.length}`);
        }
        if (!where.length) return send(400, { message: "refusing an unfiltered delete" });
        try {
          const r = await locked(() => asRole(c.role, c.sub, () => db.query(`delete from public.${delM[1]} where ${where.join(" and ")}`, params)));
          return send(204, null, { "content-range": `*/${r.affectedRows ?? 0}` });
        } catch (e) {
          return pgErr(e);
        }
      }

      // ---- service role: Storage list / remove ----
      if (url.pathname === "/storage/v1/object/list/ten-workspaces" && req.method === "POST" && c.role === "service_role") {
        const b = jsonBody();
        const prefix = String(b.prefix ?? "").replace(/\/+$/, "");
        const limit = Number(b.limit ?? 100);
        const offset = Number(b.offset ?? 0);
        const rows = await locked(() =>
          asRole("service_role", null, () =>
            db.query<{ id: string; name: string; metadata: any }>(
              "select id, name, metadata from storage.objects where bucket_id = 'ten-workspaces' and left(name, char_length($1) + 1) = $1 || '/' order by name",
              [prefix],
            ),
          ),
        );
        const seen = new Set<string>();
        const out: any[] = [];
        for (const o of rows.rows) {
          const rest = o.name.slice(prefix.length + 1);
          const slash = rest.indexOf("/");
          if (slash >= 0) {
            const f = rest.slice(0, slash);
            if (!seen.has(f)) {
              seen.add(f);
              out.push({ name: f, id: null, metadata: null });
            }
          } else out.push({ name: rest, id: o.id, metadata: o.metadata });
        }
        out.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
        return send(200, out.slice(offset, offset + limit));
      }
      if (url.pathname === "/storage/v1/object/ten-workspaces" && req.method === "DELETE") {
        if (c.role !== "service_role") return send(400, { statusCode: "403", error: "Unauthorized", message: "stand-in: remove is service-role only here" });
        const prefixes: string[] = jsonBody().prefixes ?? [];
        const removed = await locked(async () => {
          await db.exec("reset role");
          await db.query("select set_config('storage.allow_delete_query', 'true', false)");
          try {
            const r = await db.query<{ name: string }>("delete from storage.objects where bucket_id = 'ten-workspaces' and name = any($1) returning name", [prefixes]);
            return r.rows.map((x) => x.name);
          } finally {
            await db.query("select set_config('storage.allow_delete_query', 'false', false)");
          }
        });
        for (const n of removed) backend.objectBytes.delete(n);
        return send(200, removed.map((name) => ({ name })));
      }

      return send(404, { message: `stand-in: no route for ${req.method} ${url.pathname}` });
    } catch (e) {
      return send(500, { message: String(e) });
    }
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as any).port as number;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    backend,
    log,
    issued,
    async createUser({ email, member = true, expiresIn = 3600 }) {
      const id = await locked(() => backend.newUser({ member }));
      const u = { id, email: email.toLowerCase(), expiresIn };
      users.set(u.email, u);
      byId.set(id, u);
      return id;
    },
    sql<T = any>(query: string, params: unknown[] = []) {
      return locked(async () => {
        await db.exec("reset role");
        const r = await db.query<T>(query, params);
        return r.rows;
      });
    },
    setFunctionsTarget(u: string) {
      functionsTarget = u;
    },
    close() {
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
}
