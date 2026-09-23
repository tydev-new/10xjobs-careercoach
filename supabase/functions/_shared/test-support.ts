// Test-only helpers: a local stub OpenRouter server and a local stub
// Supabase server (Auth's /auth/v1/user, PostgREST's rpc/table endpoints,
// and the Storage list/remove API). Used by handler.test.ts in both
// functions so the "MOCKED OpenRouter (a local stub server)" and "MOCKED
// Supabase" requirements are met with real HTTP round trips, not just
// stubbed function references. Never imported by index.ts/handler.ts.

export interface MockServer {
  url: string;
  port: number;
  stop(): Promise<void>;
}

function serve(handler: (req: Request) => Response | Promise<Response>): MockServer {
  const server = Deno.serve({ port: 0, onListen: () => {} }, handler);
  const addr = server.addr as Deno.NetAddr;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    async stop() {
      await server.shutdown();
    },
  };
}

// ---------------------------------------------------------------------------
// Mock OpenRouter: streams a scripted SSE body and lets a test inspect the
// exact JSON body the proxy sent it (the "outgoing body" assertions in § 8's
// Proved-by list).
// ---------------------------------------------------------------------------

export interface MockOpenRouterOptions {
  /** SSE chunks to stream back, each already `data: {...}` (or `data: [DONE]`)
   * lines, one write per array entry, newline-terminated by the server. */
  chunks?: string[];
  status?: number;
  /** If set, the response body never ends (until the client/test cancels) —
   * used for the "client disconnect still meters" case. */
  hang?: boolean;
  /** Delay in ms before starting to stream (0 = immediate). */
  delayMs?: number;
}

export async function startMockOpenRouter(
  getOptions: () => MockOpenRouterOptions,
  onRequest?: (body: unknown, headers: Headers) => void,
): Promise<MockServer> {
  return await serve(async (req) => {
    const bodyText = await req.text();
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      // leave undefined
    }
    onRequest?.(parsed, req.headers);

    const opts = getOptions();
    if (opts.status && opts.status !== 200) {
      return new Response(JSON.stringify({ error: "upstream error" }), { status: opts.status });
    }
    if (opts.delayMs) {
      await new Promise((r) => setTimeout(r, opts.delayMs));
    }

    const chunks = opts.chunks ?? [];
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) {
          controller.enqueue(enc.encode(c.endsWith("\n") ? c : c + "\n"));
        }
        if (opts.hang) {
          // Never close: simulates a stalled/aborted upstream. The test is
          // responsible for cancelling the reader/aborting.
          await new Promise(() => {});
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  });
}

// ---------------------------------------------------------------------------
// Mock Supabase: Auth's GET /auth/v1/user, PostgREST's rpc + table
// endpoints, and the Storage list/remove endpoints, enough to exercise both
// functions end to end over real fetch/HTTP semantics.
// ---------------------------------------------------------------------------

export interface MockUser {
  id: string;
  role?: string;
}

export interface MockSupabaseState {
  /** token -> user, or "invalid" behavior if absent. The literal string
   * passed as ANON_KEY never appears as a key here, so using it as a bearer
   * token 404s/401s exactly like the real /auth/v1/user does. */
  users: Record<string, MockUser>;
  members: Set<string>; // user ids
  balances: Record<string, number>; // user id -> balance
  betaSpendToday: number;
  ledgerRequestIds: Set<string>;
  ledgerInserts: Array<Record<string, unknown>>;
  /** kind -> user id -> row count, so tests can plant both 'credit' and
   * 'call' rows and assert which survive a kind-filtered delete. */
  ledgerRowsByKind: Record<string, Record<string, number>>;
  storageObjects: Set<string>; // full object paths, e.g. users/u1/ws/documents/resume.pdf
  /** Seeded row counts, key `${table}:${uid}` -> count; a DELETE consumes
   * (zeroes) the matching entry and returns its prior count. */
  rowCounts: Record<string, number>;
  deletedRows: Record<string, string[]>; // table -> deleted user ids (for assertions)
  anonKey: string;
  serviceRoleKey: string;
}

export function freshState(overrides: Partial<MockSupabaseState> = {}): MockSupabaseState {
  return {
    users: {},
    members: new Set(),
    balances: {},
    betaSpendToday: 0,
    ledgerRequestIds: new Set(),
    ledgerInserts: [],
    ledgerRowsByKind: {},
    storageObjects: new Set(),
    rowCounts: {},
    deletedRows: {},
    anonKey: "test-anon-key",
    serviceRoleKey: "test-service-role-key",
    ...overrides,
  };
}

function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

export async function startMockSupabase(state: MockSupabaseState): Promise<MockServer> {
  return await serve(async (req) => {
    const url = new URL(req.url);
    const token = bearerToken(req);

    // Auth: GET /auth/v1/user
    if (url.pathname === "/auth/v1/user" && req.method === "GET") {
      const user = token ? state.users[token] : undefined;
      if (!user) return new Response(JSON.stringify({ message: "invalid token" }), { status: 401 });
      return new Response(JSON.stringify(user), { status: 200 });
    }

    // RPC: ten_is_member — as the user (their own JWT).
    if (url.pathname === "/rest/v1/rpc/ten_is_member" && req.method === "POST") {
      const user = token ? state.users[token] : undefined;
      const isMember = !!user && state.members.has(user.id);
      return new Response(JSON.stringify(isMember), { status: 200 });
    }

    // RPC: ten_balance_for — service role only.
    if (url.pathname === "/rest/v1/rpc/ten_balance_for" && req.method === "POST") {
      if (token !== state.serviceRoleKey) return new Response("forbidden", { status: 403 });
      const body = await req.json().catch(() => ({}));
      const uid = body?.p_user as string;
      const bal = state.balances[uid] ?? 0;
      return new Response(JSON.stringify(bal), { status: 200 });
    }

    // RPC: ten_beta_spend_today — service role only.
    if (url.pathname === "/rest/v1/rpc/ten_beta_spend_today" && req.method === "POST") {
      if (token !== state.serviceRoleKey) return new Response("forbidden", { status: 403 });
      return new Response(JSON.stringify(state.betaSpendToday), { status: 200 });
    }

    // Table insert: ten_usage_ledger — service role only; unique request_id;
    // the same check constraints as the migration (usd >= 0, int4 tokens
    // >= 0), so a handler that forwards garbled usage without sanitizing it
    // fails here exactly like it would against the real project.
    if (url.pathname === "/rest/v1/ten_usage_ledger" && req.method === "POST") {
      if (token !== state.serviceRoleKey) return new Response("forbidden", { status: 403 });
      const row = await req.json().catch(() => ({}));
      const rid = row?.request_id as string;
      if (rid && state.ledgerRequestIds.has(rid)) {
        return new Response(JSON.stringify({ message: "duplicate key value" }), { status: 409 });
      }
      if (typeof row.usd !== "number" || !Number.isFinite(row.usd) || row.usd < 0) {
        return new Response(JSON.stringify({ code: "23514", message: "ten_usage_ledger_usd" }), { status: 400 });
      }
      const INT4_MAX = 2147483647;
      for (const k of ["tokens_in", "tokens_out", "tokens_cached"]) {
        const v = row[k];
        if (v !== undefined && (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > INT4_MAX)) {
          return new Response(JSON.stringify({ code: "22P02", message: `invalid integer ${k}` }), { status: 400 });
        }
      }
      if (rid) state.ledgerRequestIds.add(rid);
      state.ledgerInserts.push(row);
      return new Response(null, { status: 201 });
    }

    // Table delete: /rest/v1/{table}?[kind=eq.X&]user_id=eq.<uid> — service
    // role only. Unlike the bulk tester harness this mock DOES honor an
    // additional `kind=eq.` filter on ten_usage_ledger, so a delete-account
    // test here can assert 'credit' rows are removed and 'call' rows kept.
    const deleteMatch = url.pathname.match(/^\/rest\/v1\/(ten_ws_files|ten_gate_log|ten_usage_ledger)$/);
    if (deleteMatch && req.method === "DELETE") {
      if (token !== state.serviceRoleKey) return new Response("forbidden", { status: 403 });
      const table = deleteMatch[1];
      const uid = url.searchParams.get("user_id")?.replace(/^eq\./, "") ?? "";
      const kindFilter = url.searchParams.get("kind")?.replace(/^eq\./, "");
      let count = 0;
      if (table === "ten_usage_ledger") {
        const before = state.ledgerInserts.length;
        state.ledgerInserts = state.ledgerInserts.filter(
          (r) => !(r.user_id === uid && (!kindFilter || r.kind === kindFilter)),
        );
        count = before - state.ledgerInserts.length;
        const seededKind = kindFilter ?? "credit";
        const seededCount = state.ledgerRowsByKind[seededKind]?.[uid] ?? 0;
        if (seededCount > 0) {
          count += seededCount;
          state.ledgerRowsByKind[seededKind][uid] = 0;
        }
      } else {
        const key = `${table}:${uid}`;
        count = state.rowCounts[key] ?? 0;
        state.rowCounts[key] = 0;
      }
      state.deletedRows[table] = [...(state.deletedRows[table] ?? []), uid];
      return new Response(null, { status: 200, headers: { "Content-Range": `*/${count}` } });
    }

    // Storage: POST /storage/v1/object/list/{bucket} — pages honestly at
    // whatever `limit`/`offset` the caller sends (N2), same shape as the
    // real Storage API: never returns fewer than `limit` entries unless
    // that's genuinely everything left.
    const listMatch = url.pathname.match(/^\/storage\/v1\/object\/list\/(.+)$/);
    if (listMatch && req.method === "POST") {
      if (token !== state.serviceRoleKey) return new Response("forbidden", { status: 403 });
      const body = await req.json().catch(() => ({}));
      const prefix = (body?.prefix as string) ?? "";
      const limit = typeof body?.limit === "number" ? body.limit : 100;
      const offset = typeof body?.offset === "number" ? body.offset : 0;
      const norm = prefix ? prefix.replace(/\/$/, "") + "/" : "";
      const seen = new Map<string, boolean>(); // name -> isFolder
      for (const obj of state.storageObjects) {
        if (!obj.startsWith(norm)) continue;
        const rest = obj.slice(norm.length);
        const slash = rest.indexOf("/");
        if (slash === -1) {
          seen.set(rest, false);
        } else {
          seen.set(rest.slice(0, slash), true);
        }
      }
      const entries = [...seen.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .slice(offset, offset + limit)
        .map(([name, isFolder]) => ({ name, id: isFolder ? null : crypto.randomUUID() }));
      return new Response(JSON.stringify(entries), { status: 200 });
    }

    // Storage: DELETE /storage/v1/object/{bucket}  { prefixes: [...] } — at
    // most 1000 paths per call (N2), mirroring the real Storage API's cap.
    const removeMatch = url.pathname.match(/^\/storage\/v1\/object\/(.+)$/);
    if (removeMatch && req.method === "DELETE") {
      if (token !== state.serviceRoleKey) return new Response("forbidden", { status: 403 });
      const body = await req.json().catch(() => ({}));
      const prefixes = (body?.prefixes as string[]) ?? [];
      if (prefixes.length < 1 || prefixes.length > 1000) {
        return new Response(JSON.stringify({ message: "prefixes must have 1..1000 items" }), { status: 400 });
      }
      for (const p of prefixes) state.storageObjects.delete(p);
      return new Response(JSON.stringify(prefixes.map((name) => ({ name }))), { status: 200 });
    }

    return new Response("not found", { status: 404 });
  });
}
