// Independent tester's harness for supabase/functions (docs/design-web-agent.md § 8).
//
// Drives the REAL deploy entry points (ten-model-proxy/index.ts,
// ten-delete-account/index.ts) in-process:
//   * Deno.serve is patched only while each index.ts loads, to capture its handler;
//   * Deno.env.get/toObject are patched to a fake env (no --allow-env needed);
//   * globalThis.fetch is wrapped: https://openrouter.ai/... is rewritten to a
//     loopback stub, loopback passes through, ANY other host throws. No live call
//     can leave this process (run with --allow-net=127.0.0.1 to enforce it twice);
//   * globalThis.EdgeRuntime.waitUntil collects the metering promises so a test
//     can await them.
//
// The Supabase stub models the applied migration (20260923000000_ten_beta_init.sql),
// not the code under test: membership = a credit row in the ledger; balance =
// credits - calls; spend today = calls since UTC midnight; the ledger's check
// constraints (usd >= 0, numeric(12,6), int4 token counts >= 0, unique request_id,
// FK to auth.users) are enforced; JWTs are HS256-verified like GoTrue/PostgREST
// (signature, exp, sub required for /auth/v1/user). Storage follows storage-api:
// list normalises the prefix to a folder, default limit 100, remove takes
// { prefixes } (max 1000).

// deno-lint-ignore-file no-explicit-any

export const JWT_SECRET = "tester-jwt-secret-at-least-32-chars-long!!";
export const OPENROUTER_KEY = "sk-or-v1-CANARY-7f3c9e2a1b4d6e8f0a2c4e6b8d0f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f";
export const PROD_ORIGIN = "https://ten.example.com";
export const MODEL = "anthropic/claude-sonnet-5";

// ---------------------------------------------------------------- JWT ----
const enc = new TextEncoder();
function b64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}
async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
export async function signJwt(payload: Record<string, unknown>, secret = JWT_SECRET, alg = "HS256"): Promise<string> {
  const head = b64url(JSON.stringify({ alg, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  if (alg === "none") return `${head}.${body}.`;
  const sig = b64url(await hmac(secret, `${head}.${body}`));
  return `${head}.${body}.${sig}`;
}
export async function verifyJwt(token: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let head: any, body: any;
  try {
    head = JSON.parse(b64urlDecode(parts[0]));
    body = JSON.parse(b64urlDecode(parts[1]));
  } catch {
    return null;
  }
  if (head.alg !== "HS256") return null;
  const sig = b64url(await hmac(JWT_SECRET, `${parts[0]}.${parts[1]}`));
  if (sig !== parts[2]) return null;
  if (typeof body.exp === "number" && body.exp * 1000 < Date.now()) return null;
  return body;
}
const hour = 3600;
export const userJwt = (sub: string, extra: Record<string, unknown> = {}) =>
  signJwt({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + hour, ...extra });

// -------------------------------------------------------- Supabase stub ----
export interface LedgerRow {
  id: string;
  user_id: string;
  kind: string;
  request_id: string | null;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  tokens_cached: number;
  usd: number;
  created_at: Date;
  // § 9.6 (docs/design-web-agent.md, amended 2026-09-24; the
  // 20260924000000 migration): nullable, ≤ 32 chars.
  finish_reason: string | null;
}
export interface SbState {
  authUsers: Set<string>;
  ledger: LedgerRow[];
  wsFiles: Array<{ user_id: string; path: string }>;
  gateLog: Array<{ user_id: string; id: string }>;
  objects: Set<string>; // `${bucket}/${name}`
  now: () => Date;
  /** path-substring -> status: inject a PostgREST/Storage failure */
  fail: Record<string, number>;
  requests: Array<{ method: string; path: string; auth: string; body: string }>;
  /** Scripted outcomes for successive ledger inserts: "fail" = 503, nothing written;
   * "commit-then-fail" = the row is written but the response is a 503 (a lost ack). */
  ledgerPlan: Array<"ok" | "fail" | "commit-then-fail">;
  anonKey: string;
  serviceKey: string;
}

const INT4_MAX = 2147483647;

function pgErr(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message, details: null, hint: null }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function role(req: Request, st: SbState): Promise<{ role: string; sub?: string } | Response> {
  const h = req.headers.get("authorization") ?? "";
  const tok = h.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!tok) return { role: "anon" };
  const c = await verifyJwt(tok);
  if (!c) return pgErr(401, "PGRST301", "JWT invalid or expired");
  void st;
  return { role: String(c.role), sub: typeof c.sub === "string" ? c.sub : undefined };
}

export function newState(): SbState {
  return {
    authUsers: new Set(),
    ledger: [],
    wsFiles: [],
    gateLog: [],
    objects: new Set(),
    now: () => new Date(),
    fail: {},
    requests: [],
    ledgerPlan: [],
    anonKey: "",
    serviceKey: "",
  };
}

export function credit(st: SbState, uid: string, usd = 5) {
  st.authUsers.add(uid);
  st.ledger.push({
    id: crypto.randomUUID(),
    user_id: uid,
    kind: "credit",
    request_id: null,
    model: null,
    tokens_in: 0,
    tokens_out: 0,
    tokens_cached: 0,
    usd,
    finish_reason: null,
    created_at: st.now(),
  });
}
export function call(st: SbState, uid: string, usd: number, at?: Date, rid?: string) {
  st.ledger.push({
    id: crypto.randomUUID(),
    user_id: uid,
    kind: "call",
    request_id: rid ?? crypto.randomUUID(),
    model: MODEL,
    tokens_in: 0,
    tokens_out: 0,
    tokens_cached: 0,
    usd,
    finish_reason: null,
    created_at: at ?? st.now(),
  });
}
export const isMemberIn = (st: SbState, uid: string) => st.ledger.some((r) => r.user_id === uid && r.kind === "credit");
export const balanceIn = (st: SbState, uid: string) =>
  st.ledger.filter((r) => r.user_id === uid).reduce((a, r) => a + (r.kind === "credit" ? r.usd : -r.usd), 0);
export function spendTodayIn(st: SbState): number {
  const n = st.now();
  const midnight = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  return st.ledger.filter((r) => r.kind === "call" && r.created_at.getTime() >= midnight).reduce((a, r) => a + r.usd, 0);
}
export const callRows = (st: SbState) => st.ledger.filter((r) => r.kind === "call");

function validInt(v: unknown): boolean {
  return v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= INT4_MAX);
}

async function supabaseHandler(req: Request, st: SbState): Promise<Response> {
  const url = new URL(req.url);
  const bodyText = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
  st.requests.push({ method: req.method, path: url.pathname + url.search, auth: req.headers.get("authorization") ?? "", body: bodyText });
  for (const [k, s] of Object.entries(st.fail)) {
    if (url.pathname.includes(k)) return pgErr(s, "XX000", `injected failure on ${k}`);
  }
  const json = () => {
    try {
      return bodyText ? JSON.parse(bodyText) : {};
    } catch {
      return undefined;
    }
  };

  // GoTrue: GET /auth/v1/user — verifies signature + exp, requires sub and an existing user.
  if (url.pathname === "/auth/v1/user" && req.method === "GET") {
    if (req.headers.get("apikey") !== st.anonKey) return pgErr(401, "no_api_key", "No API key found in request");
    const tok = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    const c = await verifyJwt(tok);
    if (!c) return pgErr(403, "bad_jwt", "invalid JWT: unable to parse or verify signature");
    if (typeof c.sub !== "string") return pgErr(403, "bad_jwt", "invalid claim: missing sub claim");
    if (!st.authUsers.has(c.sub)) return pgErr(403, "user_not_found", "User from sub claim in JWT does not exist");
    return Response.json({ id: c.sub, aud: "authenticated", role: "authenticated", email: `${c.sub}@x.test` });
  }

  if (url.pathname.startsWith("/rest/v1/")) {
    const r = await role(req, st);
    if (r instanceof Response) return r;
    const svc = r.role === "service_role";

    if (url.pathname === "/rest/v1/rpc/ten_is_member" && req.method === "POST") {
      if (r.role !== "authenticated" && !svc) return pgErr(401, "42501", "permission denied for function ten_is_member");
      return Response.json(r.sub ? isMemberIn(st, r.sub) : false);
    }
    if (url.pathname === "/rest/v1/rpc/ten_balance_for" && req.method === "POST") {
      if (!svc) return pgErr(r.role === "anon" ? 401 : 403, "42501", "permission denied for function ten_balance_for");
      const b = json();
      return Response.json(balanceIn(st, b?.p_user));
    }
    if (url.pathname === "/rest/v1/rpc/ten_beta_spend_today" && req.method === "POST") {
      if (!svc) return pgErr(r.role === "anon" ? 401 : 403, "42501", "permission denied for function ten_beta_spend_today");
      return Response.json(spendTodayIn(st));
    }
    if (url.pathname === "/rest/v1/ten_usage_ledger" && req.method === "POST") {
      if (!svc) return pgErr(r.role === "anon" ? 401 : 403, "42501", "permission denied for table ten_usage_ledger");
      const step = st.ledgerPlan.shift() ?? "ok";
      if (step === "fail") return pgErr(503, "XX000", "injected: ledger insert failed, nothing written");
      const row = json();
      if (!row || typeof row !== "object") return pgErr(400, "PGRST102", "Empty or invalid json");
      const cols = new Set(["id", "user_id", "kind", "request_id", "model", "tokens_in", "tokens_out", "tokens_cached", "usd", "finish_reason", "created_at"]);
      for (const k of Object.keys(row)) if (!cols.has(k)) return pgErr(400, "PGRST204", `Could not find the '${k}' column`);
      if (!st.authUsers.has(row.user_id)) return pgErr(409, "23503", "violates foreign key constraint");
      if (row.kind !== "credit" && row.kind !== "call") return pgErr(400, "23514", "ten_usage_ledger_kind");
      for (const k of ["tokens_in", "tokens_out", "tokens_cached"]) {
        if (!validInt(row[k])) return pgErr(400, "22P02", `invalid input for integer column ${k}: ${row[k]}`);
      }
      if (typeof row.usd !== "number") return pgErr(400, "23502", "null value in column usd");
      if (Math.abs(row.usd) >= 1e6) return pgErr(400, "22003", "numeric field overflow");
      if (row.usd < 0) return pgErr(400, "23514", "violates check constraint ten_usage_ledger_usd");
      if (row.finish_reason != null && (typeof row.finish_reason !== "string" || row.finish_reason.length > 32)) {
        return pgErr(400, "23514", "violates check constraint ten_usage_ledger_finish_reason");
      }
      if (row.request_id != null && st.ledger.some((x) => x.request_id === row.request_id)) {
        return pgErr(409, "23505", "duplicate key value violates unique constraint");
      }
      st.ledger.push({
        id: crypto.randomUUID(),
        user_id: row.user_id,
        kind: row.kind,
        request_id: row.request_id ?? null,
        model: row.model ?? null,
        tokens_in: row.tokens_in ?? 0,
        tokens_out: row.tokens_out ?? 0,
        tokens_cached: row.tokens_cached ?? 0,
        usd: Math.round(row.usd * 1e6) / 1e6,
        finish_reason: row.finish_reason ?? null,
        created_at: st.now(),
      });
      if (step === "commit-then-fail") return pgErr(503, "XX000", "injected: committed, response lost");
      return new Response(null, { status: 201 });
    }
    const del = url.pathname.match(/^\/rest\/v1\/(ten_ws_files|ten_gate_log|ten_usage_ledger)$/);
    if (del && req.method === "DELETE") {
      if (!svc) return pgErr(403, "42501", "permission denied");
      // PostgREST semantics: every `col=op.value` query param is a filter and
      // all of them are ANDed. This stub implements `eq` only and refuses any
      // other operator or an unknown column rather than guessing. A DELETE
      // with no filter is refused (Supabase enables pg-safeupdate for the API).
      const COLS: Record<string, string[]> = {
        ten_usage_ledger: ["id", "user_id", "kind", "request_id", "model"],
        ten_ws_files: ["user_id", "path"],
        ten_gate_log: ["id", "user_id"],
      };
      const filters: Array<[string, string]> = [];
      for (const [col, expr] of url.searchParams) {
        if (col === "select" || col === "order" || col === "limit") continue;
        if (!COLS[del[1]].includes(col)) return pgErr(400, "42703", `column ${del[1]}.${col} does not exist`);
        if (!expr.startsWith("eq.")) return pgErr(400, "PGRST100", `stub supports eq only: ${col}=${expr}`);
        filters.push([col, expr.slice(3)]);
      }
      if (filters.length === 0) return pgErr(400, "21000", "DELETE requires a WHERE clause");
      const match = (row: Record<string, unknown>) => filters.every(([c, v]) => String(row[c]) === v);
      let n = 0;
      if (del[1] === "ten_usage_ledger") {
        const before = st.ledger.length;
        st.ledger = st.ledger.filter((x) => !match(x as unknown as Record<string, unknown>));
        n = before - st.ledger.length;
      } else if (del[1] === "ten_ws_files") {
        const before = st.wsFiles.length;
        st.wsFiles = st.wsFiles.filter((x) => !match(x));
        n = before - st.wsFiles.length;
      } else {
        const before = st.gateLog.length;
        st.gateLog = st.gateLog.filter((x) => !match(x));
        n = before - st.gateLog.length;
      }
      return new Response(null, { status: 204, headers: { "Content-Range": `*/${n}` } });
    }
    return pgErr(404, "PGRST202", "not found");
  }

  if (url.pathname.startsWith("/storage/v1/")) {
    const r = await role(req, st);
    if (r instanceof Response) return r;
    const svc = r.role === "service_role";
    const list = url.pathname.match(/^\/storage\/v1\/object\/list\/([^/]+)$/);
    if (list && req.method === "POST") {
      if (!svc) return pgErr(403, "42501", "list requires service role in this stub");
      const b = json() ?? {};
      let prefix: string = b.prefix ?? "";
      if (prefix.length > 0 && !prefix.endsWith("/")) prefix += "/"; // storage-api: prefix is a folder
      const limit = typeof b.limit === "number" ? b.limit : 100;
      const offset = typeof b.offset === "number" ? b.offset : 0;
      const seen = new Map<string, boolean>();
      for (const key of st.objects) {
        const [bucket, ...rest] = key.split("/");
        if (bucket !== list[1]) continue;
        const name = rest.join("/");
        if (!name.startsWith(prefix)) continue;
        const tail = name.slice(prefix.length);
        const i = tail.indexOf("/");
        if (i === -1) seen.set(tail, false);
        else seen.set(tail.slice(0, i), true);
      }
      const entries = [...seen.entries()]
        .sort((a, b2) => (a[0] < b2[0] ? -1 : 1))
        .slice(offset, offset + limit)
        .map(([name, folder]) => ({ name, id: folder ? null : crypto.randomUUID() }));
      return Response.json(entries);
    }
    const rm = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)$/);
    if (rm && req.method === "DELETE") {
      if (!svc) return pgErr(403, "42501", "remove requires service role in this stub");
      const b = json() ?? {};
      const ps: string[] = Array.isArray(b.prefixes) ? b.prefixes : [];
      if (ps.length < 1 || ps.length > 1000) return pgErr(400, "InvalidRequest", "prefixes must have 1..1000 items");
      const out = [];
      for (const p of ps) if (st.objects.delete(`${rm[1]}/${p}`)) out.push({ name: p });
      return Response.json(out);
    }
    const get = url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/);
    if (get && req.method === "GET") {
      const key = `${get[1]}/${decodeURIComponent(get[2])}`;
      if (!st.objects.has(key)) return pgErr(400, "404", "Object not found");
      return new Response("bytes");
    }
    return pgErr(404, "404", "not found");
  }
  return pgErr(404, "404", "not found");
}

// -------------------------------------------------------- upstream stub ----
export interface UpstreamHit {
  bodyText: string;
  body: any;
  headers: Headers;
  url: string;
}
export type UpstreamScript = (hit: UpstreamHit) => Response | Promise<Response>;

export function sse(chunks: string[], opts: { hangAfter?: boolean; errorAfter?: boolean; delayMs?: number } = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      for (const ch of chunks) {
        c.enqueue(enc.encode(ch.endsWith("\n\n") ? ch : ch + "\n\n"));
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      if (opts.hangAfter) return; // never closes
      if (opts.errorAfter) {
        c.error(new Error("upstream connection reset"));
        return;
      }
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

export function okStream(id: string, usage: Record<string, unknown> | null = {
  prompt_tokens: 1200,
  completion_tokens: 80,
  cost: 0.012345,
  prompt_tokens_details: { cached_tokens: 1000 },
}): string[] {
  const chunks = [
    `: OPENROUTER PROCESSING`,
    `data: ${JSON.stringify({ id, choices: [{ delta: { content: "Hel" } }] })}`,
    `data: ${JSON.stringify({ id, choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] })}`,
  ];
  if (usage) chunks.push(`data: ${JSON.stringify({ id, choices: [], usage })}`);
  chunks.push("data: [DONE]");
  return chunks;
}

// ------------------------------------------------------------- harness ----
export interface Harness {
  st: SbState;
  sbUrl: string;
  upstreamHits: UpstreamHit[];
  setUpstream(s: UpstreamScript): void;
  proxy: (req: Request) => Promise<Response>;
  del: (req: Request) => Promise<Response>;
  pending: Promise<unknown>[];
  logs: string[];
  anonKey: string;
  serviceKey: string;
  externalAttempts: string[];
  reset(): void;
  drain(): Promise<void>;
  /** serve a captured handler on a real loopback port (for disconnect tests) */
  serveReal(h: (req: Request) => Promise<Response>): { url: string; stop(): Promise<void> };
}

let singleton: Promise<Harness> | null = null;
export function harness(): Promise<Harness> {
  if (!singleton) singleton = build();
  return singleton;
}

async function build(): Promise<Harness> {
  const realServe = Deno.serve.bind(Deno) as typeof Deno.serve;
  const realFetch = globalThis.fetch.bind(globalThis);
  const st = newState();
  st.anonKey = await signJwt({ role: "anon", iss: "supabase", exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400 });
  st.serviceKey = await signJwt({ role: "service_role", iss: "supabase", exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400 });

  const sb = realServe({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, (req) => supabaseHandler(req, st));
  sb.unref();
  const sbUrl = `http://127.0.0.1:${(sb.addr as Deno.NetAddr).port}`;

  const upstreamHits: UpstreamHit[] = [];
  let script: UpstreamScript = () => sse(okStream("gen-default"));
  const up = realServe({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    const bodyText = await req.text();
    let body: any;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = undefined;
    }
    const hit = { bodyText, body, headers: req.headers, url: req.url };
    upstreamHits.push(hit);
    return await script(hit);
  });
  up.unref();
  const upUrl = `http://127.0.0.1:${(up.addr as Deno.NetAddr).port}`;

  const externalAttempts: string[] = [];
  const guardedFetch: typeof fetch = (input: any, init?: any) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (u.href === "https://openrouter.ai/api/v1/chat/completions") {
      return realFetch(`${upUrl}/api/v1/chat/completions`, init);
    }
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(input, init);
    externalAttempts.push(u.href);
    return Promise.reject(new TypeError(`tester harness: external fetch refused: ${u.origin}`));
  };
  globalThis.fetch = guardedFetch;

  const fakeEnv: Record<string, string> = {
    SUPABASE_URL: sbUrl,
    SUPABASE_ANON_KEY: st.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: st.serviceKey,
    TEN_OPENROUTER_API_KEY: OPENROUTER_KEY,
    TEN_APP_ORIGIN: PROD_ORIGIN,
  };
  (Deno.env as any).get = (k: string) => fakeEnv[k];
  (Deno.env as any).toObject = () => ({ ...fakeEnv });

  const pending: Promise<unknown>[] = [];
  (globalThis as any).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => pending.push(p) };

  const logs: string[] = [];
  for (const lvl of ["log", "warn", "error", "info", "debug"] as const) {
    const orig = console[lvl].bind(console);
    (console as any)[lvl] = (...a: unknown[]) => {
      logs.push(`[${lvl}] ` + a.map((x) => (typeof x === "string" ? x : Deno.inspect(x, { depth: 8 }))).join(" "));
      if (Deno.args.includes("--verbose-logs")) orig(...a);
    };
  }

  let captured: ((req: Request) => Promise<Response>) | null = null;
  (Deno as any).serve = (h: any) => {
    captured = typeof h === "function" ? h : h.handler;
    return { finished: Promise.resolve(), shutdown: async () => {}, unref() {}, ref() {}, addr: {} };
  };
  await import("../../supabase/functions/ten-model-proxy/index.ts");
  const proxy = captured!;
  captured = null;
  await import("../../supabase/functions/ten-delete-account/index.ts");
  const del = captured!;
  (Deno as any).serve = realServe;

  const h: Harness = {
    st,
    sbUrl,
    upstreamHits,
    setUpstream: (s) => (script = s),
    proxy,
    del,
    pending,
    logs,
    anonKey: st.anonKey,
    serviceKey: st.serviceKey,
    externalAttempts,
    reset() {
      const fresh = newState();
      Object.assign(st, fresh, { anonKey: st.anonKey, serviceKey: st.serviceKey });
      upstreamHits.length = 0;
      pending.length = 0;
      logs.length = 0;
      script = () => sse(okStream("gen-default"));
    },
    async drain() {
      // settle every metering promise (including ones queued while draining)
      for (let i = 0; i < pending.length; i++) await pending[i].catch(() => {});
    },
    serveReal(fn) {
      const s = realServe({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, fn);
      return { url: `http://127.0.0.1:${(s.addr as Deno.NetAddr).port}`, stop: () => s.shutdown() };
    },
  };
  return h;
}

// ------------------------------------------------------------- helpers ----
export const FN = "http://ivunfotoggdxbjouumdk.supabase.co/ten-model-proxy";
export const DEL = "http://ivunfotoggdxbjouumdk.supabase.co/ten-delete-account";

export function preq(
  body: unknown,
  o: { token?: string; origin?: string; method?: string; raw?: BodyInit; path?: string; url?: string; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers({ "Content-Type": "application/json", ...(o.headers ?? {}) });
  if (o.token !== undefined) headers.set("authorization", `Bearer ${o.token}`);
  if (o.origin !== undefined) headers.set("origin", o.origin);
  const method = o.method ?? "POST";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(o.url ?? `${FN}${o.path ?? "/chat/completions"}`, {
    method,
    headers,
    body: hasBody ? (o.raw ?? (body === undefined ? undefined : JSON.stringify(body))) : undefined,
    // @ts-ignore deno supports duplex for stream bodies
    duplex: "half",
  });
}

export const baseBody = () => ({
  model: MODEL,
  messages: [{ role: "user", content: "hi" }],
  max_tokens: 1000,
});

export function t(name: string, fn: () => Promise<void>, opts: { ignore?: boolean } = {}) {
  Deno.test({ name, fn, sanitizeResources: false, sanitizeOps: false, ignore: opts.ignore });
}

/** Make a signed-in member with a $5 credit; returns [uid, jwt]. */
export async function member(h: Harness, usd = 5): Promise<[string, string]> {
  const uid = crypto.randomUUID();
  credit(h.st, uid, usd);
  return [uid, await userJwt(uid)];
}
export async function nonMember(h: Harness): Promise<[string, string]> {
  const uid = crypto.randomUUID();
  h.st.authUsers.add(uid);
  return [uid, await userJwt(uid)];
}

export async function readAll(res: Response): Promise<string> {
  return await res.text();
}

/** Print an OBSERVED line past the console capture. */
export function observe(...a: unknown[]) {
  Deno.stderr.writeSync(new TextEncoder().encode("OBSERVED " + a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n"));
}
