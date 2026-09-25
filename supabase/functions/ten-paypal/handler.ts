// The testable core of ten-paypal (docs/design-web-agent.md § 17.1 steps
// 2 and 4): `POST .../create-order` and `POST .../capture-order`. Every side
// effect (auth, membership, the PayPal calls, the ledger insert) comes
// through `PaypalDeps`, so this runs under `deno test` against a mocked
// PayPal API and a mocked Supabase, with no `window`/`document`/
// `localStorage`/`node:` API and no network access at import time.
// index.ts wires the real deps and calls `Deno.serve`.

import { allowedOrigins, corsHeaders } from "../_shared/cors.ts";
import { breakdownIsSane, captureRequestId, customIdFor, isPackAmount, packAmountUsd, packForAmount, pathTail, uidFromCustomId } from "./core.ts";
import type { CaptureInfo, CaptureOutcome, OrderInfo } from "../_shared/paypal.ts";
import type { LedgerCreditRow } from "../_shared/supabase.ts";

export const MESSAGES = {
  notMember: "You're signed in, but this beta is invite-only. Ask the person who invited you to add you.",
  paypalError: "Couldn't start a payment. No money moved.",
  notTenOrder: "Ten didn't create that payment.",
  paidNotCredited:
    "Ten couldn't confirm the credit yet. If PayPal took your payment, it's added automatically, usually " +
    "within minutes. If not by tomorrow, email support@10xjobs.co with PayPal's receipt.",
} as const;

export interface PaypalDeps {
  verifyUser(token: string): Promise<{ id: string } | null>;
  isMember(token: string): Promise<boolean>;
  createOrder(params: {
    amountUsd: string;
    customId: string;
    invoiceId: string;
    description: string;
  }): Promise<{ orderId: string }>;
  getOrder(orderId: string): Promise<OrderInfo>;
  captureOrder(orderId: string, requestId: string): Promise<CaptureOutcome>;
  insertLedgerCredit(row: LedgerCreditRow): Promise<void>;
  /** F1 (fix round 2): the invoice_id create-order stamps on a fresh order —
   *  bound (HMAC) to uid + pack + amount + a timestamp it carries itself. */
  signInvoiceId(uid: string, pack: string, amountUsd: string): Promise<string>;
  /** F1: re-verifies that binding from an order/capture's OWN invoice_id
   *  (constant-time tag comparison) before capture-order ever captures
   *  anything. Never throws. */
  verifyInvoiceId(invoiceId: string, uid: string, pack: string, amountUsd: string): Promise<boolean>;
  log?: { warn(e: unknown): void; error?(e: unknown): void };
}

function jsonError(status: number, code: string, message: string, cors: HeadersInit): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function json(status: number, body: Record<string, unknown>, cors: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

/** Mirrors ten-model-proxy/handler.ts's own check: a duplicate `request_id`
 * (409) means a row for this exact capture already exists — most likely
 * this capture was already credited by the webhook, a prior attempt, or a
 * parallel call. Not an error: still a "credited" outcome to the caller. */
function isDuplicateRequestId(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { duplicate?: unknown }).duplicate === true;
}

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const text = await req.text();
  if (text.length === 0) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

async function handleCreateOrder(
  req: Request,
  deps: PaypalDeps,
  user: { id: string },
  cors: HeadersInit,
): Promise<Response> {
  const parsed = await readJson(req);
  if (!parsed.ok) return jsonError(400, "bad_request", "Invalid JSON.", cors);
  const body = parsed.body as Record<string, unknown>;
  // § 17.1 step 2: "the pack's amount from the server's table" — whatever
  // the body ALSO carries (an `amount`, a `custom_id`) is ignored outright,
  // never read below. `pack` is the only field this handler looks at.
  const amountUsd = packAmountUsd(body?.pack);
  if (!amountUsd) {
    return jsonError(400, "unknown_pack", "Unknown credit pack.", cors);
  }
  const pack = body.pack as string;
  try {
    const invoiceId = await deps.signInvoiceId(user.id, pack, amountUsd);
    const { orderId } = await deps.createOrder({
      amountUsd,
      customId: customIdFor(user.id),
      invoiceId,
      description: `Ten credit $${pack}`,
    });
    return json(200, { orderId }, cors);
  } catch (e) {
    deps.log?.warn({ msg: "ten-paypal: create-order failed", err: String(e) });
    return jsonError(503, "paypal_error", MESSAGES.paypalError, cors);
  }
}

/** F4 (fix round 2): logs the shared "ALERT paypal breakdown mismatch" line
 * (no secrets — capture id, amounts and currency only) at error level when
 * available, falling back to warn (mirrors ten-model-proxy/handler.ts's own
 * `deps.log?.error` fallback). Shared wording so both this function and the
 * webhook's own alert read identically in the logs. */
function alertBreakdownMismatch(deps: PaypalDeps, capture: CaptureInfo, where: string): void {
  const alert = {
    msg: `${where}: ALERT paypal breakdown mismatch`,
    captureId: capture.captureId,
    grossUsd: capture.grossUsd,
    feeUsd: capture.feeUsd,
    netUsd: capture.netUsd,
    currencyCode: capture.currencyCode,
  };
  if (deps.log?.error) deps.log.error(alert);
  else deps.log?.warn(alert);
}

async function handleCaptureOrder(
  req: Request,
  deps: PaypalDeps,
  user: { id: string },
  cors: HeadersInit,
): Promise<Response> {
  const parsed = await readJson(req);
  if (!parsed.ok) return jsonError(400, "bad_request", "Invalid JSON.", cors);
  const body = parsed.body as Record<string, unknown>;
  const orderId = body?.orderId;
  if (typeof orderId !== "string" || orderId.length === 0) {
    return jsonError(400, "bad_request", "Missing orderId.", cors);
  }

  // § 17.1 step 4: "Reads the order first: unless custom_id is ten:<caller>
  // (403) and the amount a pack in USD (400), nothing is captured."
  let order: OrderInfo;
  try {
    order = await deps.getOrder(orderId);
  } catch (e) {
    deps.log?.warn({ msg: "ten-paypal: capture-order pre-read failed", err: String(e) });
    return jsonError(503, "paypal_error", MESSAGES.paypalError, cors);
  }
  // F6 (fix round 2): the strict `ten:<lowercase-uuid>` shape, not a loose
  // string compare — a lookalike custom_id (wrong case, trailing text, a
  // bare UUID) never parses to a uid at all, so it mismatches the caller's
  // own uid the same way a genuinely different owner's order would (403
  // either way — this function has no separate "malformed" status to give
  // a possible attacker, only "not yours").
  if (uidFromCustomId(order.customId) !== user.id) {
    return jsonError(403, "not_your_order", "That payment isn't yours.", cors);
  }
  if (!isPackAmount(order.amountValue, order.currencyCode)) {
    return jsonError(400, "bad_amount", "That payment doesn't match a credit pack.", cors);
  }
  // F1 (fix round 2, lead ruling): re-verify create-order's own HMAC binding
  // (uid + pack + amount + the timestamp the invoice_id itself carries)
  // BEFORE ever calling PayPal's capture endpoint — an order the browser
  // created directly against PayPal's own API (never through create-order)
  // has no way to produce a tag that verifies, even if its custom_id reads
  // exactly ten:<a real member's uid> (the independent tester's own "SPEC
  // GAP" case). Invalid or missing -> 403 not_ten_order, no capture call.
  const pack = packForAmount(order.amountValue);
  if (!pack || !(await deps.verifyInvoiceId(order.invoiceId, user.id, pack, order.amountValue))) {
    deps.log?.warn({ msg: "ten-paypal: ALERT invoice tag failed to verify — not Ten's own order", orderId });
    return jsonError(403, "not_ten_order", MESSAGES.notTenOrder, cors);
  }

  let outcome: CaptureOutcome;
  try {
    outcome = await deps.captureOrder(orderId, captureRequestId(orderId));
  } catch (e) {
    // F2 (fix round 2): a transport failure calling capture itself must
    // NEVER be read as "declined, no money moved" — PayPal may already
    // have captured the money and simply failed to answer (§ 1.11's "no
    // answer from capture"); the webhook is the backup either way.
    deps.log?.warn({ msg: "ten-paypal: capture call failed", err: String(e) });
    return jsonError(503, "paid_not_credited", MESSAGES.paidNotCredited, cors);
  }

  let capture: CaptureInfo;
  if (outcome.kind === "captured") {
    capture = outcome.capture;
  } else if (outcome.kind === "already_captured") {
    // § 17.1 step 4: "ORDER_ALREADY_CAPTURED → read the order's capture."
    // Money already moved at PayPal by definition of this outcome, so a
    // re-read failure here is "not confirmed yet" too (F2), never
    // "couldn't start a payment" (nothing here is starting one).
    let reread: OrderInfo;
    try {
      reread = await deps.getOrder(orderId);
    } catch (e) {
      deps.log?.warn({ msg: "ten-paypal: already-captured re-read failed", err: String(e) });
      return jsonError(503, "paid_not_credited", MESSAGES.paidNotCredited, cors);
    }
    if (!reread.capture) {
      deps.log?.warn({ msg: "ten-paypal: ORDER_ALREADY_CAPTURED but re-read order carries no capture", orderId });
      return jsonError(503, "paid_not_credited", MESSAGES.paidNotCredited, cors);
    }
    capture = reread.capture;
  } else if (outcome.kind === "not_approved") {
    // § 17.2: "Ten can capture only an order the payer approved (else
    // ORDER_NOT_APPROVED)." ui § 1.11: "Window closed: 'No payment was made.'"
    return json(200, { status: "window_closed" }, cors);
  } else {
    // F2: a PayPal 5xx or any other unrecognized capture answer — never
    // "declined" (that would tell the payer "No money moved" when we
    // genuinely don't know). The webhook is the backup that finds out.
    deps.log?.warn({ msg: "ten-paypal: capture answered an error", status: outcome.status, message: outcome.message });
    return jsonError(503, "paid_not_credited", MESSAGES.paidNotCredited, cors);
  }

  // Defense in depth: the capture's OWN custom_id is re-checked even though
  // the pre-capture order check above already passed (mirrors the older
  // app's own capture-order route).
  if (uidFromCustomId(capture.customId) !== user.id) {
    deps.log?.warn({ msg: "ten-paypal: capture custom_id mismatch after capture", orderId });
    return jsonError(403, "not_your_order", "That payment isn't yours.", cors);
  }

  if (capture.status === "PENDING") {
    // § 17.1 step 4: "PENDING -> 'pending' (no fee breakdown until it clears)."
    return json(200, { status: "pending" }, cors);
  }
  if (capture.status !== "COMPLETED") {
    return json(200, { status: "declined" }, cors);
  }

  if (!breakdownIsSane(capture)) {
    // § 17.8 test 6 / F4 (fix round 2): "a breakdown that doesn't add up,
    // non-USD, no net_amount: no row, an alert." The migration's check
    // constraint is the backstop if this guard is ever wrong; this alert
    // fires first, at error level, with no secret in it.
    alertBreakdownMismatch(deps, capture, "ten-paypal");
    return jsonError(503, "paid_not_credited", MESSAGES.paidNotCredited, cors);
  }

  const row: LedgerCreditRow = {
    user_id: user.id,
    kind: "credit",
    request_id: `paypal:${capture.captureId}`,
    usd: capture.netUsd,
    gross_usd: capture.grossUsd,
    fee_usd: capture.feeUsd,
  };
  try {
    await deps.insertLedgerCredit(row);
  } catch (e) {
    if (!isDuplicateRequestId(e)) {
      deps.log?.warn({ msg: "ten-paypal: ledger credit insert failed", err: String(e), captureId: capture.captureId });
      return jsonError(503, "paid_not_credited", MESSAGES.paidNotCredited, cors);
    }
    // Already credited (this capture's own retry, or the webhook beat us
    // here) — § 17.8 test 3, "one row" either way.
  }

  return json(
    200,
    { status: "credited", grossUsd: capture.grossUsd, feeUsd: capture.feeUsd, creditedUsd: capture.netUsd },
    cors,
  );
}

export async function handleRequest(
  req: Request,
  deps: PaypalDeps,
  env: Record<string, string | undefined>,
): Promise<Response> {
  const url = new URL(req.url);
  const path = pathTail(url);
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin, allowedOrigins(env));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (path !== "/create-order" && path !== "/capture-order") {
    return new Response("Not found", { status: 404 });
  }
  if (req.method !== "POST") {
    return new Response("Not found", { status: 404 });
  }

  try {
    // § 17.1 steps 2/4: signed in (401), member (403) — checked before
    // routing, identically for both endpoints.
    const authz = req.headers.get("authorization") ?? "";
    const token = authz.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    if (!token) {
      return jsonError(401, "not_signed_in", "Sign in required.", cors);
    }
    const user = await deps.verifyUser(token);
    if (!user) {
      return jsonError(401, "not_signed_in", "Sign in required.", cors);
    }
    const member = await deps.isMember(token);
    if (!member) {
      return jsonError(403, "not_a_member", MESSAGES.notMember, cors);
    }

    if (path === "/create-order") return await handleCreateOrder(req, deps, user, cors);
    return await handleCaptureOrder(req, deps, user, cors);
  } catch (e) {
    deps.log?.warn({ msg: "ten-paypal: unexpected failure, failing closed", err: String(e) });
    return jsonError(503, "paypal_error", MESSAGES.paypalError, cors);
  }
}
