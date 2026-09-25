// The testable core of ten-paypal (docs/design-web-agent.md § 17.1 steps
// 2 and 4): `POST .../create-order` and `POST .../capture-order`. Every side
// effect (auth, membership, the PayPal calls, the ledger insert) comes
// through `PaypalDeps`, so this runs under `deno test` against a mocked
// PayPal API and a mocked Supabase, with no `window`/`document`/
// `localStorage`/`node:` API and no network access at import time.
// index.ts wires the real deps and calls `Deno.serve`.

import { allowedOrigins, corsHeaders } from "../_shared/cors.ts";
import { captureRequestId, customIdFor, isPackAmount, packAmountUsd, pathTail } from "./core.ts";
import type { CaptureInfo, CaptureOutcome, OrderInfo } from "../_shared/paypal.ts";
import type { LedgerCreditRow } from "../_shared/supabase.ts";

export const MESSAGES = {
  notMember: "You're signed in, but this beta is invite-only. Ask the person who invited you to add you.",
  paypalError: "Couldn't start a payment. No money moved.",
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
  randomId(): string;
  log?: { warn(e: unknown): void };
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
    const { orderId } = await deps.createOrder({
      amountUsd,
      customId: customIdFor(user.id),
      invoiceId: `ten-${deps.randomId()}`,
      description: `Ten credit $${pack}`,
    });
    return json(200, { orderId }, cors);
  } catch (e) {
    deps.log?.warn({ msg: "ten-paypal: create-order failed", err: String(e) });
    return jsonError(503, "paypal_error", MESSAGES.paypalError, cors);
  }
}

/** True once a capture's own breakdown is present AND matches a known pack
 * amount in USD — the § 17.1 step 4 "a breakdown that doesn't add up" guard
 * (the migration's own check constraint is the backstop; this is the
 * pre-insert guard that turns a bad breakdown into an alert, not a 500). */
function breakdownLooksSane(capture: CaptureInfo): capture is CaptureInfo & {
  grossUsd: string;
  feeUsd: string;
  netUsd: string;
} {
  return (
    typeof capture.grossUsd === "string" &&
    typeof capture.feeUsd === "string" &&
    typeof capture.netUsd === "string" &&
    isPackAmount(capture.grossUsd, capture.currencyCode)
  );
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
  const wantCustomId = customIdFor(user.id);

  // § 17.1 step 4: "Reads the order first: unless custom_id is ten:<caller>
  // (403) and the amount a pack in USD (400), nothing is captured."
  let order: OrderInfo;
  try {
    order = await deps.getOrder(orderId);
  } catch (e) {
    deps.log?.warn({ msg: "ten-paypal: capture-order pre-read failed", err: String(e) });
    return jsonError(503, "paypal_error", MESSAGES.paypalError, cors);
  }
  if (order.customId !== wantCustomId) {
    return jsonError(403, "not_your_order", "That payment isn't yours.", cors);
  }
  if (!isPackAmount(order.amountValue, order.currencyCode)) {
    return jsonError(400, "bad_amount", "That payment doesn't match a credit pack.", cors);
  }

  let outcome: CaptureOutcome;
  try {
    outcome = await deps.captureOrder(orderId, captureRequestId(orderId));
  } catch (e) {
    deps.log?.warn({ msg: "ten-paypal: capture failed", err: String(e) });
    return jsonError(503, "paypal_error", MESSAGES.paypalError, cors);
  }

  let capture: CaptureInfo;
  if (outcome.kind === "captured") {
    capture = outcome.capture;
  } else if (outcome.kind === "already_captured") {
    // § 17.1 step 4: "ORDER_ALREADY_CAPTURED → read the order's capture."
    let reread: OrderInfo;
    try {
      reread = await deps.getOrder(orderId);
    } catch (e) {
      deps.log?.warn({ msg: "ten-paypal: already-captured re-read failed", err: String(e) });
      return jsonError(503, "paypal_error", MESSAGES.paypalError, cors);
    }
    if (!reread.capture) {
      deps.log?.warn({ msg: "ten-paypal: ORDER_ALREADY_CAPTURED but re-read order carries no capture", orderId });
      return jsonError(503, "paypal_error", MESSAGES.paypalError, cors);
    }
    capture = reread.capture;
  } else if (outcome.kind === "not_approved") {
    // § 17.2: "Ten can capture only an order the payer approved (else
    // ORDER_NOT_APPROVED)." ui § 1.11: "Window closed: 'No payment was made.'"
    return json(200, { status: "window_closed" }, cors);
  } else {
    deps.log?.warn({ msg: "ten-paypal: capture error", status: outcome.status, message: outcome.message });
    return json(200, { status: "declined" }, cors);
  }

  // Defense in depth: the capture's OWN custom_id is re-checked even though
  // the pre-capture order check above already passed (mirrors the older
  // app's own capture-order route).
  if (capture.customId !== wantCustomId) {
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

  if (!breakdownLooksSane(capture)) {
    // § 17.8 test 6: "a breakdown that doesn't add up, non-USD, no
    // net_amount: no row, an alert." The migration's check constraint is
    // the backstop if this guard is ever wrong; this alert fires first.
    deps.log?.warn({
      msg: "ten-paypal: ALERT completed capture with a breakdown that doesn't check out",
      captureId: capture.captureId,
      grossUsd: capture.grossUsd,
      feeUsd: capture.feeUsd,
      netUsd: capture.netUsd,
      currencyCode: capture.currencyCode,
    });
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
