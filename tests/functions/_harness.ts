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
  // § 17.3 (the 20260925000000 migration): numeric(12,2), set on `paypal:`
  // rows. Kept here as integer CENTS so the check is exact.
  gross_cents?: number | null;
  fee_cents?: number | null;
  /** usd as exact micro-dollars (numeric(12,6)). */
  usd_micros?: number;
}
export interface SbState {
  authUsers: Set<string>;
  ledger: LedgerRow[];
  wsFiles: Array<{ user_id: string; path: string }>;
  gateLog: Array<{ user_id: string; id: string }>;
  /** § 11.2 (amended 2026-09-24): ten_conversations, one row per user. */
  conversations: Array<{ user_id: string; chat_id: string; messages: unknown[] }>;
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
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A JSON number or decimal string -> an exact integer at `scale` decimals
 * (Postgres numeric(p,scale) rounds half away from zero); null for null/absent. */
function toScaled(v: unknown, scale: number): number | null | "bad" {
  if (v === null || v === undefined) return null;
  const s = typeof v === "number" ? v.toFixed(12) : typeof v === "string" ? v.trim() : "";
  const m = /^(-)?(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return "bad";
  const frac = (m[3] ?? "").padEnd(scale + 1, "0");
  let n = Number(m[2]) * 10 ** scale + Number(frac.slice(0, scale) || "0");
  if (Number(frac[scale]) >= 5) n += 1;
  return m[1] ? -n : n;
}

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
    conversations: [],
    objects: new Set(),
    now: () => new Date(),
    fail: {},
    requests: [],
    ledgerPlan: [],
    anonKey: "",
    serviceKey: "",
  };
}

/** Plants the user's one saved conversation (§ 11.2). */
export function conversation(st: SbState, uid: string, chatId = `chat-${uid.slice(0, 8)}`) {
  st.conversations = st.conversations.filter((c) => c.user_id !== uid);
  st.conversations.push({ user_id: uid, chat_id: chatId, messages: [{ role: "user", parts: [{ type: "text", text: "CONVERSATION-CANARY" }] }] });
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
      const cols = new Set(["id", "user_id", "kind", "request_id", "model", "tokens_in", "tokens_out", "tokens_cached", "usd", "finish_reason", "created_at", "gross_usd", "fee_usd"]);
      for (const k of Object.keys(row)) if (!cols.has(k)) return pgErr(400, "PGRST204", `Could not find the '${k}' column`);
      if (typeof row.user_id !== "string" || !UUID_RE.test(row.user_id)) return pgErr(400, "22P02", `invalid input syntax for type uuid: "${row.user_id}"`);
      if (!st.authUsers.has(row.user_id)) return pgErr(409, "23503", "violates foreign key constraint");
      if (row.kind !== "credit" && row.kind !== "call" && row.kind !== "refund") return pgErr(400, "23514", "ten_usage_ledger_kind");
      // PostgREST passes a JSON string to a numeric column as its text; Postgres parses it exactly.
      const usdMicros = toScaled(row.usd, 6);
      if (usdMicros === "bad") return pgErr(400, "22P02", `invalid input syntax for type numeric: "${row.usd}"`);
      const grossCents = toScaled(row.gross_usd, 2);
      const feeCents = toScaled(row.fee_usd, 2);
      if (grossCents === "bad" || feeCents === "bad") return pgErr(400, "22P02", "invalid input syntax for type numeric");
      if (typeof row.usd === "string") row.usd = Number(row.usd);
      // § 17.3's check, as the migration enforces it: paypal: rows carry
      // gross and fee, kind credit, fee >= 0, usd > 0, usd = gross - fee.
      if (typeof row.request_id === "string" && row.request_id.startsWith("paypal:")) {
        const okBreakdown = grossCents !== null && feeCents !== null && row.kind === "credit" && feeCents >= 0 &&
          usdMicros !== null && usdMicros > 0 && usdMicros === (grossCents - feeCents) * 10000;
        if (!okBreakdown) return pgErr(400, "23514", "violates check constraint ten_usage_ledger_paypal_breakdown");
      }
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
        gross_cents: grossCents,
        fee_cents: feeCents,
        usd_micros: usdMicros ?? undefined,
      });
      if (step === "commit-then-fail") return pgErr(503, "XX000", "injected: committed, response lost");
      return new Response(null, { status: 201 });
    }
    if (url.pathname === "/rest/v1/ten_usage_ledger" && req.method === "GET") {
      if (r.role === "anon") return pgErr(401, "42501", "permission denied for table ten_usage_ledger");
      const filters: Array<[string, string]> = [];
      let limit = Infinity;
      for (const [col, expr] of url.searchParams) {
        if (col === "select" || col === "order") continue;
        if (col === "limit") {
          limit = Number(expr);
          continue;
        }
        if (!["id", "user_id", "kind", "request_id"].includes(col)) return pgErr(400, "42703", `column ten_usage_ledger.${col} does not exist`);
        if (!expr.startsWith("eq.")) return pgErr(400, "PGRST100", `stub supports eq only: ${col}=${expr}`);
        const v = expr.slice(3);
        if ((col === "user_id" || col === "id") && !UUID_RE.test(v)) return pgErr(400, "22P02", `invalid input syntax for type uuid: "${v}"`);
        filters.push([col, v]);
      }
      let rows = st.ledger.filter((x) => filters.every(([c, v]) => String((x as any)[c]) === v));
      if (!svc) rows = rows.filter((x) => x.user_id === r.sub && isMemberIn(st, r.sub!));
      return Response.json(rows.slice(0, limit).map((x) => ({ id: x.id })));
    }
    const del = url.pathname.match(/^\/rest\/v1\/(ten_ws_files|ten_gate_log|ten_usage_ledger|ten_conversations)$/);
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
        // § 11.7: ten-delete-account deletes the caller's row by user_id.
        ten_conversations: ["user_id"],
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
      } else if (del[1] === "ten_conversations") {
        const before = st.conversations.length;
        st.conversations = st.conversations.filter((x) => !match(x));
        n = before - st.conversations.length;
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

// ---------------------------------------------------------- PayPal stub ----
// A loopback model of the PayPal REST calls § 17 names, from PayPal's docs:
// oauth2 client_credentials; Orders v2 create / get / capture (capture needs
// an APPROVED order, else 422 ORDER_NOT_APPROVED; a second capture 422
// ORDER_ALREADY_CAPTURED unless it repeats the same PayPal-Request-Id, which
// returns the same capture); Payments v2 GET capture; and the webhook
// signature postback. Fees follow a 3.49% + $0.49 schedule (§ 1.11's example:
// $10 -> fee $0.84, net $9.16). Nothing in here reaches paypal.com.
export const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";
export const PAYPAL_CLIENT_ID = "AcanaryPAYPALclientID-4b1e";
export const PAYPAL_CLIENT_SECRET = "EcanaryPAYPALsecret-9f3a7c2e1d5b8a6f4c0e2d7b9a1f3c5e";
export const PAYPAL_WEBHOOK_ID = "8PT597110X687430LKGECATA";
export const PAYPAL_TOKEN = "A21AAcanaryACCESStoken-77d2e";
/** § 17.10: Ten's own PayPal account (non-secret). PayPal fills an order's
 * payee with the caller's account when the order names none, so the stub's
 * orders default to this payee. */
export const PAYPAL_MERCHANT_ID = "TENMERCHANT7Q2";
export const FOREIGN_MERCHANT_ID = "OTHERMERCHANT9";

// ---- § 17.10 signed invoice_id, the tester's own implementation of the spec
// (checked against a Python HMAC vector in paypal_r2.test.ts).
const te = new TextEncoder();
async function hmacRaw(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, te.encode(msg)));
}
const hexOf = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function tagHash(secret: string, uid: string, pack: string, amount: string, t: string, n: string): Promise<string> {
  const key = await hmacRaw(te.encode(secret), "ten-invoice-v1");
  return hexOf(await hmacRaw(key, `v1|${uid}|${pack}|${amount}|${t}|${n}`)).slice(0, 32);
}
export async function mintTag(
  uid: string,
  pack = "10",
  o: { secret?: string; amount?: string; t?: string; n?: string } = {},
): Promise<string> {
  const amount = o.amount ?? `${pack}.00`;
  const t = o.t ?? String(Math.floor(Date.now() / 1000));
  const n = o.n ?? hexOf(crypto.getRandomValues(new Uint8Array(8)));
  return `ten-${uid.slice(0, 8)}-${t}-${n}-${await tagHash(o.secret ?? PAYPAL_CLIENT_SECRET, uid, pack, amount, t, n)}`;
}
export const TAG_RE = /^ten-[0-9a-f]{8}-[0-9]{10}-[0-9a-f]{16}-[0-9a-f]{32}$/;

export interface PpCapture {
  id: string;
  status: string;
  amount: { currency_code: string; value: string };
  custom_id: string;
  invoice_id: string;
  seller_receivable_breakdown?: any;
  [k: string]: unknown;
}
export interface PpOrder {
  id: string;
  status: string; // CREATED | APPROVED | COMPLETED
  purchase_units: any[];
  capture?: PpCapture;
  requestId?: string;
}
export interface PpState {
  orders: Map<string, PpOrder>;
  captures: Map<string, PpCapture>;
  hits: Array<{ method: string; path: string; headers: Headers; body: any; bodyText: string }>;
  /** path-substring -> status: inject a PayPal failure */
  fail: Record<string, number>;
  /** the next capture's status and breakdown override */
  nextCapture: { status?: string; breakdown?: any | null; currency?: string; customId?: string };
  /** signatures this stub issued: transmission id -> { sig, event JSON } */
  issued: Map<string, { sig: string; eventJson: string }>;
  /** capture calls are held until released (race tests) */
  captureGate?: Promise<void>;
  /** path-substring -> a transport failure (the fetch itself rejects, e.g. a timeout) */
  throwOn?: Record<string, string>;
}
export function newPpState(): PpState {
  return { orders: new Map(), captures: new Map(), hits: [], fail: {}, nextCapture: {}, issued: new Map() };
}

export function feeFor(gross: string): { fee: string; net: string } {
  const g = Math.round(Number(gross) * 100);
  const f = Math.round(g * 0.0349 + 49);
  return { fee: (f / 100).toFixed(2), net: ((g - f) / 100).toFixed(2) };
}
export function breakdownFor(gross: string, currency = "USD") {
  const { fee, net } = feeFor(gross);
  return {
    gross_amount: { currency_code: currency, value: gross },
    paypal_fee: { currency_code: currency, value: fee },
    net_amount: { currency_code: currency, value: net },
  };
}
const ppId = (prefix: string) => prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 15).toUpperCase();

function ppErr(status: number, name: string, issue?: string): Response {
  return Response.json(
    { name, message: name, debug_id: "dbg" + Date.now(), details: issue ? [{ issue, description: issue }] : [] },
    { status },
  );
}
function orderView(o: PpOrder) {
  const pu = o.purchase_units.map((u, i) =>
    i === 0 && o.capture ? { ...u, payments: { captures: [o.capture] } } : u
  );
  return { id: o.id, status: o.status, intent: "CAPTURE", purchase_units: pu };
}

/** Plant an order as if created with Ten's (or the older app's) keys. */
export function ppPlantOrder(
  pp: PpState,
  o: { customId: string; value?: string; currency?: string; status?: string; invoiceId?: string; payee?: string | null },
): string {
  const id = ppId("O");
  pp.orders.set(id, {
    id,
    status: o.status ?? "APPROVED",
    purchase_units: [{
      reference_id: "default",
      amount: { currency_code: o.currency ?? "USD", value: o.value ?? "10.00" },
      custom_id: o.customId,
      invoice_id: o.invoiceId ?? `inv-${id}`,
      ...(o.payee === null ? {} : { payee: { merchant_id: o.payee ?? PAYPAL_MERCHANT_ID, email_address: "merchant@example.com" } }),
    }],
  });
  return id;
}
/** The payer approves in PayPal's window. */
export function ppApprove(pp: PpState, orderId: string) {
  const o = pp.orders.get(orderId);
  if (!o) throw new Error(`no order ${orderId}`);
  if (o.status === "CREATED") o.status = "APPROVED";
}
/** A capture's status changes on PayPal's side (e.g. PENDING clears). */
export function ppSetCapture(pp: PpState, captureId: string, patch: Partial<PpCapture>) {
  const c = pp.captures.get(captureId);
  if (!c) throw new Error(`no capture ${captureId}`);
  Object.assign(c, patch);
}

/** A PAYMENT.CAPTURE.COMPLETED (or other) event + the five paypal-* headers,
 * signed by this stub so verify-webhook-signature answers SUCCESS for it. */
export function ppSignedEvent(pp: PpState, resource: any, eventType = "PAYMENT.CAPTURE.COMPLETED"): { event: any; headers: Record<string, string> } {
  const event = {
    id: ppId("WH-"),
    event_version: "1.0",
    create_time: new Date().toISOString(),
    resource_type: "capture",
    resource_version: "2.0",
    event_type: eventType,
    summary: "Payment completed",
    resource,
  };
  const tid = crypto.randomUUID();
  const sig = "sig-" + crypto.randomUUID();
  pp.issued.set(tid, { sig, eventJson: JSON.stringify(event) });
  return {
    event,
    headers: {
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
      "paypal-transmission-id": tid,
      "paypal-transmission-sig": sig,
      "paypal-transmission-time": new Date().toISOString(),
    },
  };
}

export async function paypalHandler(req: Request, pp: PpState): Promise<Response> {
  const url = new URL(req.url);
  const bodyText = req.method === "GET" ? "" : await req.text();
  let body: any;
  try {
    body = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    body = undefined;
  }
  pp.hits.push({ method: req.method, path: url.pathname, headers: req.headers, body, bodyText });
  for (const [k, st] of Object.entries(pp.fail)) {
    if (url.pathname.includes(k)) return ppErr(st, "INTERNAL_SERVICE_ERROR");
  }
  const authz = req.headers.get("authorization") ?? "";
  if (url.pathname === "/v1/oauth2/token" && req.method === "POST") {
    if (authz !== `Basic ${btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`)}`) return ppErr(401, "invalid_client");
    if (bodyText !== "grant_type=client_credentials") return ppErr(400, "unsupported_grant_type");
    return Response.json({ access_token: PAYPAL_TOKEN, token_type: "Bearer", expires_in: 32400, app_id: "APP-80W284485P519543T" });
  }
  if (authz !== `Bearer ${PAYPAL_TOKEN}`) return ppErr(401, "AUTHENTICATION_FAILURE");

  if (url.pathname === "/v2/checkout/orders" && req.method === "POST") {
    if (!body || body.intent !== "CAPTURE" || !Array.isArray(body.purchase_units)) return ppErr(400, "INVALID_REQUEST");
    const id = ppId("O");
    const pus = structuredClone(body.purchase_units);
    // PayPal names the API caller's account as payee when the request doesn't.
    for (const u of pus) u.payee ??= { merchant_id: PAYPAL_MERCHANT_ID, email_address: "merchant@example.com" };
    pp.orders.set(id, { id, status: "CREATED", purchase_units: pus });
    return Response.json({ id, status: "CREATED", links: [] }, { status: 201 });
  }
  let m = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
  if (m && req.method === "GET") {
    const o = pp.orders.get(decodeURIComponent(m[1]));
    if (!o) return ppErr(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    return Response.json(orderView(o));
  }
  m = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
  if (m && req.method === "POST") {
    if (pp.captureGate) await pp.captureGate;
    const o = pp.orders.get(decodeURIComponent(m[1]));
    if (!o) return ppErr(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    const rid = req.headers.get("paypal-request-id") ?? undefined;
    if (o.capture) {
      if (rid && rid === o.requestId) return Response.json(orderView(o), { status: 201 });
      return ppErr(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_CAPTURED");
    }
    if (o.status !== "APPROVED") return ppErr(422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED");
    const u = o.purchase_units[0];
    const nc = pp.nextCapture;
    pp.nextCapture = {};
    const status = nc.status ?? "COMPLETED";
    const currency = nc.currency ?? u.amount.currency_code;
    const cap: PpCapture = {
      id: ppId("C"),
      status,
      amount: { currency_code: currency, value: u.amount.value },
      custom_id: nc.customId ?? u.custom_id,
      invoice_id: u.invoice_id,
      final_capture: true,
      supplementary_data: { related_ids: { order_id: o.id } },
    };
    const bd = nc.breakdown === undefined ? (status === "COMPLETED" ? breakdownFor(u.amount.value, currency) : null) : nc.breakdown;
    if (bd) cap.seller_receivable_breakdown = bd;
    if (status === "PENDING") (cap as any).status_details = { reason: "RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION" };
    o.capture = cap;
    o.status = "COMPLETED";
    o.requestId = rid;
    pp.captures.set(cap.id, cap);
    return Response.json(orderView(o), { status: 201 });
  }
  m = url.pathname.match(/^\/v2\/payments\/captures\/([^/]+)$/);
  if (m && req.method === "GET") {
    const c = pp.captures.get(decodeURIComponent(m[1]));
    if (!c) return ppErr(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    return Response.json(c);
  }
  if (url.pathname === "/v1/notifications/verify-webhook-signature" && req.method === "POST") {
    const need = ["auth_algo", "cert_url", "transmission_id", "transmission_sig", "transmission_time", "webhook_id", "webhook_event"];
    if (!body || need.some((k) => body[k] === undefined || body[k] === "")) return ppErr(400, "VALIDATION_ERROR");
    const iss = pp.issued.get(body.transmission_id);
    const ok = body.webhook_id === PAYPAL_WEBHOOK_ID && iss !== undefined && iss.sig === body.transmission_sig &&
      iss.eventJson === JSON.stringify(body.webhook_event);
    return Response.json({ verification_status: ok ? "SUCCESS" : "FAILURE" });
  }
  return ppErr(404, "NOT_FOUND");
}

// ------------------------------------------------------------- harness ----
export interface Harness {
  st: SbState;
  sbUrl: string;
  upstreamHits: UpstreamHit[];
  setUpstream(s: UpstreamScript): void;
  proxy: (req: Request) => Promise<Response>;
  del: (req: Request) => Promise<Response>;
  /** § 17: ten-paypal and ten-paypal-webhook, from their real index.ts. */
  paypal: (req: Request) => Promise<Response>;
  webhook: (req: Request) => Promise<Response>;
  /** ten-paypal-webhook loaded with TEN_PAYPAL_WEBHOOK_ID unset. */
  webhookNoId: (req: Request) => Promise<Response>;
  /** both loaded with TEN_PAYPAL_MERCHANT_ID unset (§ 17.10). */
  paypalNoMerchant: (req: Request) => Promise<Response>;
  webhookNoMerchant: (req: Request) => Promise<Response>;
  pp: PpState;
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

  const pp = newPpState();
  const ppSrv = realServe({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, (req) => paypalHandler(req, pp));
  ppSrv.unref();
  const ppUrl = `http://127.0.0.1:${(ppSrv.addr as Deno.NetAddr).port}`;

  const externalAttempts: string[] = [];
  const guardedFetch: typeof fetch = (input: any, init?: any) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (u.href === "https://openrouter.ai/api/v1/chat/completions") {
      return realFetch(`${upUrl}/api/v1/chat/completions`, init);
    }
    if (u.origin === PAYPAL_BASE) {
      for (const [k, name] of Object.entries(pp.throwOn ?? {})) {
        if (u.pathname.includes(k)) return Promise.reject(new DOMException("The operation timed out.", name));
      }
      if (input instanceof Request) return realFetch(new Request(ppUrl + u.pathname + u.search, input), init);
      return realFetch(ppUrl + u.pathname + u.search, init);
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
    TEN_PAYPAL_API_BASE: PAYPAL_BASE,
    TEN_PAYPAL_CLIENT_ID: PAYPAL_CLIENT_ID,
    TEN_PAYPAL_CLIENT_SECRET: PAYPAL_CLIENT_SECRET,
    TEN_PAYPAL_WEBHOOK_ID: PAYPAL_WEBHOOK_ID,
    TEN_PAYPAL_MERCHANT_ID: PAYPAL_MERCHANT_ID,
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
  captured = null;
  await import("../../supabase/functions/ten-paypal/index.ts");
  const paypal = captured!;
  captured = null;
  await import("../../supabase/functions/ten-paypal-webhook/index.ts");
  const webhook = captured!;
  captured = null;
  delete fakeEnv.TEN_PAYPAL_WEBHOOK_ID;
  await import("../../supabase/functions/ten-paypal-webhook/index.ts?no-webhook-id");
  const webhookNoId = captured!;
  fakeEnv.TEN_PAYPAL_WEBHOOK_ID = PAYPAL_WEBHOOK_ID;
  captured = null;
  delete fakeEnv.TEN_PAYPAL_MERCHANT_ID;
  await import("../../supabase/functions/ten-paypal/index.ts?no-merchant-id");
  const paypalNoMerchant = captured!;
  captured = null;
  await import("../../supabase/functions/ten-paypal-webhook/index.ts?no-merchant-id");
  const webhookNoMerchant = captured!;
  fakeEnv.TEN_PAYPAL_MERCHANT_ID = PAYPAL_MERCHANT_ID;
  (Deno as any).serve = realServe;

  const h: Harness = {
    st,
    sbUrl,
    upstreamHits,
    setUpstream: (s) => (script = s),
    proxy,
    del,
    paypal,
    webhook,
    webhookNoId,
    paypalNoMerchant,
    webhookNoMerchant,
    pp,
    pending,
    logs,
    anonKey: st.anonKey,
    serviceKey: st.serviceKey,
    externalAttempts,
    reset() {
      const fresh = newState();
      Object.assign(st, fresh, { anonKey: st.anonKey, serviceKey: st.serviceKey });
      upstreamHits.length = 0;
      Object.assign(pp, newPpState());
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
export const PAY = "http://ivunfotoggdxbjouumdk.supabase.co/functions/v1/ten-paypal";
export const HOOK = "http://ivunfotoggdxbjouumdk.supabase.co/functions/v1/ten-paypal-webhook";

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
