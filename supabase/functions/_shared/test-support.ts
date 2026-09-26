// Test-only helpers: a local stub OpenRouter server, a local stub Supabase
// server (Auth's /auth/v1/user, PostgREST's rpc/table endpoints, and the
// Storage list/remove API), and a local stub PayPal server (§ 17: OAuth,
// Orders v2, Payments v2 captures, and the webhook signature-verify
// endpoint). Used by handler.test.ts in every function so the "MOCKED
// OpenRouter/PayPal (a local stub server)" and "MOCKED Supabase"
// requirements are met with real HTTP round trips, not just stubbed
// function references. Never imported by index.ts/handler.ts.

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
  /** Consumed one at a time by the NEXT `ten_usage_ledger` POST (§ 17.8
   *  test "a failed credit write"): "fail" answers 503, nothing written;
   *  "commit-then-fail" writes the row but still answers 503 (a lost ack —
   *  a retry then sees its own row as a 409 duplicate). Unset/empty means
   *  every insert just succeeds normally. */
  ledgerInsertPlan: Array<"fail" | "commit-then-fail">;
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
    ledgerInsertPlan: [],
    ...overrides,
  };
}

/** Accepts a JSON number or a JSON numeric string (PayPal's own decimal
 * strings, § 17.6) — mirrors PostgREST casting text to a `numeric` column.
 * Returns null for anything that isn't a finite number either way. */
function parseMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
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
    // the same check constraints as the migrations (usd >= 0, int4 tokens
    // >= 0, § 17.3's paypal-breakdown check, kind in credit/call/refund), so
    // a handler that forwards garbled usage/breakdown without sanitizing it
    // fails here exactly like it would against the real project. § 17.6:
    // PayPal's own decimal strings reach Postgres unparsed — `usd`/
    // `gross_usd`/`fee_usd` are accepted as either a JSON number OR a JSON
    // string (PostgREST casts text to numeric), same as the real column.
    if (url.pathname === "/rest/v1/ten_usage_ledger" && req.method === "POST") {
      if (token !== state.serviceRoleKey) return new Response("forbidden", { status: 403 });
      const step = state.ledgerInsertPlan.shift();
      if (step === "fail") {
        return new Response(JSON.stringify({ code: "XX000", message: "injected: ledger insert failed, nothing written" }), { status: 503 });
      }
      const row = await req.json().catch(() => ({}));
      const rid = row?.request_id as string | undefined;
      if (rid && state.ledgerRequestIds.has(rid)) {
        return new Response(JSON.stringify({ message: "duplicate key value" }), { status: 409 });
      }
      if (row.kind !== undefined && !["credit", "call", "refund"].includes(row.kind)) {
        return new Response(JSON.stringify({ code: "23514", message: "ten_usage_ledger_kind" }), { status: 400 });
      }
      const usd = parseMoney(row.usd);
      if (usd === null || usd < 0) {
        return new Response(JSON.stringify({ code: "23514", message: "ten_usage_ledger_usd" }), { status: 400 });
      }
      // The 20260925000000 migration's ten_usage_ledger_paypal_breakdown
      // check (F9, fix round 2 — a genuine TWO-WAY check): gross_usd/fee_usd
      // set exactly when request_id starts with 'paypal:'; a non-paypal:
      // row (a `paypal-refund:` row included) carrying either is refused
      // just as a paypal: row missing either is.
      {
        const isPaypalRow = typeof rid === "string" && rid.startsWith("paypal:");
        const gross = parseMoney(row.gross_usd);
        const fee = parseMoney(row.fee_usd);
        const grossSet = row.gross_usd !== undefined && row.gross_usd !== null;
        const feeSet = row.fee_usd !== undefined && row.fee_usd !== null;
        const addsUp = gross !== null && fee !== null && Math.abs(usd - (gross - fee)) < 1e-9;
        const bad = isPaypalRow
          ? gross === null || fee === null || row.kind !== "credit" || fee < 0 || !(usd > 0) || !addsUp
          : grossSet || feeSet;
        if (bad) {
          return new Response(JSON.stringify({ code: "23514", message: "ten_usage_ledger_paypal_breakdown" }), { status: 400 });
        }
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
      if (step === "commit-then-fail") {
        return new Response(JSON.stringify({ code: "XX000", message: "injected: committed, response lost" }), { status: 503 });
      }
      return new Response(null, { status: 201 });
    }

    // Table delete: /rest/v1/{table}?[kind=eq.X&]user_id=eq.<uid> — service
    // role only. Unlike the bulk tester harness this mock DOES honor an
    // additional `kind=eq.` filter on ten_usage_ledger, so a delete-account
    // test here can assert 'credit' rows are removed and 'call' rows kept.
    const deleteMatch = url.pathname.match(/^\/rest\/v1\/(ten_ws_files|ten_gate_log|ten_usage_ledger|ten_conversations)$/);
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

    // RPC-less table select: GET /rest/v1/ten_usage_ledger?user_id=eq.<uid>
    // &kind=eq.credit&select=id&limit=1 — service role only. The webhook's
    // own membership-by-uid check (§ 17.1 step 5, isMemberByUid): no caller
    // JWT exists for an arbitrary uid, so this mirrors the real
    // service-role REST select rather than the RPC above.
    if (url.pathname === "/rest/v1/ten_usage_ledger" && req.method === "GET") {
      if (token !== state.serviceRoleKey) return new Response("forbidden", { status: 403 });
      const uid = url.searchParams.get("user_id")?.replace(/^eq\./, "") ?? "";
      const rows = state.members.has(uid) ? [{ id: "row-1" }] : [];
      return new Response(JSON.stringify(rows), { status: 200 });
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

// ---------------------------------------------------------------------------
// Mock PayPal (§ 17): OAuth's client_credentials token endpoint, Orders v2
// (create/read/capture), Payments v2 (read a capture), and the webhook
// signature-verify endpoint — enough surface for ten-paypal and
// ten-paypal-webhook's own handler.test.ts to exercise
// _shared/paypal.ts's real HTTP calls end to end, over real fetch/HTTP
// semantics, the same way startMockSupabase does for Supabase.
// ---------------------------------------------------------------------------

export interface MockPaypalCapture {
  id: string;
  customId: string;
  /** The capture's OWN top-level `amount.value` (§ 17.10's shared check
   *  reads this, not the breakdown's gross_amount — they usually agree,
   *  but a test can set them apart to prove the check reads the right one). */
  amountValue?: string;
  currencyCode: string;
  status: string; // "COMPLETED" | "PENDING" | "DECLINED"
  grossUsd?: string;
  feeUsd?: string;
  netUsd?: string;
  /** § 17.10 — inherited from the order's own invoice_id at capture time. */
  invoiceId?: string;
  /** § 17.10's payee closure — `supplementary_data.related_ids.order_id`,
   *  so the webhook can read the order behind this capture. */
  orderId?: string;
}

export interface MockPaypalOrder {
  id: string;
  customId: string;
  amountValue: string;
  currencyCode: string;
  /** false => capture-order answers ORDER_NOT_APPROVED (§ 17.2: "Ten can
   *  capture only an order the payer approved"). */
  approved: boolean;
  /** § 17.10 — the invoice_id create-order (or a test, for a planted
   *  order) set; captures inherit it. */
  invoiceId?: string;
  /** § 17.10's payee closure — `purchase_units[0].payee.merchant_id`. */
  payeeMerchantId?: string;
  /** Set once captured — a second capture-order call on the same order
   *  then answers ORDER_ALREADY_CAPTURED (§ 17.1 step 4). */
  capture?: MockPaypalCapture;
  /** Overrides the capture this order produces when captured — lets a test
   *  plant PENDING, a bad/missing breakdown, or a non-USD currency without
   *  hand-building the whole MockPaypalCapture every time. */
  captureOverride?: Partial<MockPaypalCapture>;
}

export interface MockPaypalState {
  orders: Record<string, MockPaypalOrder>;
  /** Independent of `orders` — the webhook's own re-fetch
   *  (`GET /v2/payments/captures/{id}`) reads THIS map directly, since a
   *  webhook test's event names a captureId that may never have gone
   *  through this same mock's create/capture-order flow. capture-order
   *  ALSO writes here (mirrors the real API: a captured order's capture is
   *  independently readable by id). */
  captures: Record<string, MockPaypalCapture>;
  nextOrderSeq: number;
  createOrderRequests: Array<Record<string, unknown>>;
  captureRequestIdsSeen: string[];
  oauthFails: boolean;
  /** path-substring -> status: inject a PayPal failure (§ 17.10 "Errors" —
   *  a capture call answering 5xx/timeout/unknown error). Checked before
   *  every route below; the OAuth token endpoint is still reachable so a
   *  test can target exactly one downstream call. */
  fail: Record<string, number>;
  /** path-substring -> never respond at all (fix round 3, owner-approved
   *  timeouts): the mock server holds the connection open forever, so a
   *  test can prove `_shared/paypal.ts`'s own `AbortSignal.timeout(...)`
   *  is what ends the call, not a mocked error response. Pair with a
   *  short `PayPalConfig.timeoutMs` in the test's own config — never the
   *  real 15 s default — so these tests stay fast. */
  hang: Record<string, boolean>;
  /** Controls POST /v1/notifications/verify-webhook-signature:
   *  "SUCCESS"/"FAILURE" answer 200 with that verification_status;
   *  "unavailable" answers 500 (the call itself failing, § 17.1 step 5). */
  verifyWebhookOutcome: "SUCCESS" | "FAILURE" | "unavailable";
  verifyWebhookRequests: Array<Record<string, unknown>>;
  /** § 17.10's payee closure: real PayPal auto-assigns `payee` to the
   *  authenticated merchant account when create-order's own request never
   *  names one (which Ten's own create-order never does) — this is that
   *  account, so a legitimately-created order passes the payee check by
   *  default. A test plants a different one via `ppPlantOrder`'s own
   *  `payeeMerchantId` to model a foreign payee. */
  defaultMerchantId: string;
}

export const MOCK_TEN_MERCHANT_ID = "TEN-MERCHANT-1";

export function freshPaypalState(overrides: Partial<MockPaypalState> = {}): MockPaypalState {
  return {
    orders: {},
    captures: {},
    nextOrderSeq: 1,
    createOrderRequests: [],
    captureRequestIdsSeen: [],
    oauthFails: false,
    fail: {},
    hang: {},
    verifyWebhookOutcome: "SUCCESS",
    verifyWebhookRequests: [],
    defaultMerchantId: MOCK_TEN_MERCHANT_ID,
    ...overrides,
  };
}

function paypalCaptureJson(c: MockPaypalCapture): Record<string, unknown> {
  return {
    id: c.id,
    status: c.status,
    custom_id: c.customId,
    amount: { currency_code: c.currencyCode, value: c.amountValue ?? c.grossUsd ?? "0.00" },
    invoice_id: c.invoiceId,
    supplementary_data: c.orderId ? { related_ids: { order_id: c.orderId } } : undefined,
    seller_receivable_breakdown:
      c.grossUsd !== undefined && c.feeUsd !== undefined && c.netUsd !== undefined
        ? {
            gross_amount: { value: c.grossUsd, currency_code: c.currencyCode },
            paypal_fee: { value: c.feeUsd, currency_code: c.currencyCode },
            net_amount: { value: c.netUsd, currency_code: c.currencyCode },
          }
        : undefined,
  };
}

function paypalOrderJson(o: MockPaypalOrder): Record<string, unknown> {
  return {
    id: o.id,
    status: o.capture ? "COMPLETED" : o.approved ? "APPROVED" : "CREATED",
    purchase_units: [
      {
        custom_id: o.customId,
        amount: { value: o.amountValue, currency_code: o.currencyCode },
        invoice_id: o.invoiceId,
        payee: o.payeeMerchantId !== undefined ? { merchant_id: o.payeeMerchantId } : undefined,
        ...(o.capture ? { payments: { captures: [paypalCaptureJson(o.capture)] } } : {}),
      },
    ],
  };
}

/** Builds the capture a fresh capture-order call on `order` produces —
 *  PayPal's own net_amount = gross_amount − paypal_fee, computed here as
 *  the mock's own convenience default when a test doesn't override it. A
 *  non-COMPLETED override status (PENDING/DECLINED) carries no breakdown by
 *  default, matching real PayPal (§ 17.1 step 4: "no fee breakdown until it
 *  clears"), unless the test explicitly sets one anyway. Inherits the
 *  order's own invoice_id/id (§ 17.10 — a capture's invoice_id and
 *  supplementary_data.related_ids.order_id come from the order it captured). */
function buildCaptureFor(order: MockPaypalOrder): MockPaypalCapture {
  const status = order.captureOverride?.status ?? "COMPLETED";
  const completed = status === "COMPLETED";
  const grossUsd = order.captureOverride?.grossUsd !== undefined ? order.captureOverride.grossUsd : completed ? order.amountValue : undefined;
  const feeUsd = order.captureOverride?.feeUsd !== undefined ? order.captureOverride.feeUsd : completed ? "0.84" : undefined;
  const netUsd =
    order.captureOverride?.netUsd !== undefined
      ? order.captureOverride.netUsd
      : completed && grossUsd !== undefined && feeUsd !== undefined
        ? (Number(grossUsd) - Number(feeUsd)).toFixed(2)
        : undefined;
  return {
    id: order.captureOverride?.id ?? `cap-${order.id}`,
    customId: order.captureOverride?.customId ?? order.customId,
    amountValue: order.captureOverride?.amountValue !== undefined ? order.captureOverride.amountValue : order.amountValue,
    currencyCode: order.captureOverride?.currencyCode ?? order.currencyCode,
    status,
    grossUsd,
    feeUsd,
    netUsd,
    invoiceId: order.captureOverride?.invoiceId !== undefined ? order.captureOverride.invoiceId : order.invoiceId,
    orderId: order.captureOverride?.orderId !== undefined ? order.captureOverride.orderId : order.id,
  };
}

export async function startMockPaypal(state: MockPaypalState): Promise<MockServer> {
  return await serve(async (req) => {
    const url = new URL(req.url);
    for (const [k, on] of Object.entries(state.hang)) {
      if (on && url.pathname.includes(k)) {
        // Return a Response whose BODY never finishes, same shape as
        // startMockOpenRouter's own `hang` option above — the handler's
        // own promise resolves right away (so a graceful server.shutdown()
        // in a test's `finally` never blocks on this), but nothing is ever
        // written to the stream, so the CALLER's own AbortSignal.timeout
        // (fix round 3) is what ends the call, not the mock. Awaiting
        // `new Promise(() => {})` here directly (before returning a
        // Response at all) would instead hang the handler's own promise
        // and deadlock `server.shutdown()` — this must stay a stream.
        const stream = new ReadableStream<Uint8Array>({ start() {} });
        return new Response(stream, { status: 200 });
      }
    }
    for (const [k, status] of Object.entries(state.fail)) {
      if (url.pathname.includes(k)) return Response.json({ name: "INTERNAL_SERVICE_ERROR" }, { status });
    }

    if (url.pathname === "/v1/oauth2/token" && req.method === "POST") {
      if (state.oauthFails) return new Response("oauth failed", { status: 500 });
      return new Response(JSON.stringify({ access_token: "mock-paypal-access-token" }), { status: 200 });
    }

    if (url.pathname === "/v2/checkout/orders" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      state.createOrderRequests.push(body);
      const id = `order-${state.nextOrderSeq++}`;
      const pu = body?.purchase_units?.[0] ?? {};
      state.orders[id] = {
        id,
        customId: String(pu.custom_id ?? ""),
        amountValue: String(pu.amount?.value ?? ""),
        currencyCode: String(pu.amount?.currency_code ?? ""),
        invoiceId: typeof pu.invoice_id === "string" ? pu.invoice_id : undefined,
        payeeMerchantId: typeof pu.payee?.merchant_id === "string" ? pu.payee.merchant_id : state.defaultMerchantId,
        approved: true, // a test flips this to false to simulate ORDER_NOT_APPROVED
      };
      return new Response(JSON.stringify({ id }), { status: 201 });
    }

    const orderMatch = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
    if (orderMatch && req.method === "GET") {
      const order = state.orders[orderMatch[1]];
      if (!order) return new Response(JSON.stringify({ name: "RESOURCE_NOT_FOUND" }), { status: 404 });
      return new Response(JSON.stringify(paypalOrderJson(order)), { status: 200 });
    }

    const captureOrderMatch = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
    if (captureOrderMatch && req.method === "POST") {
      const order = state.orders[captureOrderMatch[1]];
      state.captureRequestIdsSeen.push(req.headers.get("paypal-request-id") ?? "");
      if (!order) return new Response(JSON.stringify({ name: "RESOURCE_NOT_FOUND" }), { status: 404 });
      if (order.capture) {
        return new Response(
          JSON.stringify({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] }),
          { status: 422 },
        );
      }
      if (!order.approved) {
        return new Response(
          JSON.stringify({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] }),
          { status: 422 },
        );
      }
      const capture = buildCaptureFor(order);
      order.capture = capture;
      state.captures[capture.id] = capture;
      return new Response(JSON.stringify(paypalOrderJson(order)), { status: 201 });
    }

    const captureMatch = url.pathname.match(/^\/v2\/payments\/captures\/([^/]+)$/);
    if (captureMatch && req.method === "GET") {
      const capture = state.captures[captureMatch[1]];
      if (!capture) return new Response(JSON.stringify({ name: "RESOURCE_NOT_FOUND" }), { status: 404 });
      return new Response(JSON.stringify(paypalCaptureJson(capture)), { status: 200 });
    }

    if (url.pathname === "/v1/notifications/verify-webhook-signature" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      state.verifyWebhookRequests.push(body);
      if (state.verifyWebhookOutcome === "unavailable") return new Response("verify unavailable", { status: 500 });
      return new Response(JSON.stringify({ verification_status: state.verifyWebhookOutcome }), { status: 200 });
    }

    return new Response("not found", { status: 404 });
  });
}
