// The testable core of ten-paypal (docs/design-web-agent.md § 17.1 steps
// 2 and 4, § 17.10): `POST .../create-order` and `POST .../capture-order`.
// Every side effect (auth, membership, the PayPal calls, the ledger insert)
// comes through `PaypalDeps`, so this runs under `deno test` against a
// mocked PayPal API and a mocked Supabase, with no `window`/`document`/
// `localStorage`/`node:` API and no network access at import time.
// index.ts wires the real deps and calls `Deno.serve`.

import { allowedOrigins, corsHeaders } from "../_shared/cors.ts";
import { breakdownIsSane, captureRequestId, customIdFor, packAmountUsd, pathTail, uidFromCustomId } from "./core.ts";
import type { CaptureInfo, CaptureOutcome, OrderInfo } from "../_shared/paypal.ts";
import type { TenOrderCheckResult } from "../_shared/paypal-invoice.ts";
import type { LedgerCreditRow } from "../_shared/supabase.ts";

// § 1.11's one line for "not credited, or no answer from capture" — shared
// by two different 503 CODES (§ 17.10): `unconfirmed` (a capture call that
// answered a 5xx/timeout/unknown error — we don't know if the money moved)
// and `paid_not_credited` (we KNOW it moved; crediting itself failed). The
// payer only ever needs the one honest, non-alarming line either way.
const PAID_NOT_CONFIRMED_TEXT =
  "Ten couldn't confirm the credit yet. If PayPal took your payment, it's added automatically, usually " +
  "within minutes. If not by tomorrow, email support@10xjobs.co with PayPal's receipt.";

export const MESSAGES = {
  notMember: "You're signed in, but this beta is invite-only. Ask the person who invited you to add you.",
  paypalError: "Couldn't start a payment. No money moved.",
  notTenOrder: "Ten didn't create that payment.",
  unconfirmed: PAID_NOT_CONFIRMED_TEXT,
  paidNotCredited: PAID_NOT_CONFIRMED_TEXT,
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
  /** § 17.10: the invoice_id create-order stamps on a fresh order —
   *  ten-<U>-<T>-<N>-<H>, HMAC-bound to uid + pack + amount + T + N. */
  signInvoiceId(uid: string, pack: string, amountUsd: string): Promise<string>;
  /** § 17.10's ONE shared check — customId shape, amount-is-a-pack, the
   *  payee's merchant_id, and the invoice_id's HMAC tag, all re-verified
   *  (constant time) from the order/capture resource itself before capture-
   *  order ever captures anything. Never throws. */
  checkTenOrder(input: {
    customId: string;
    invoiceId: string;
    amountValue: string;
    currencyCode: string;
    payeeMerchantId: string;
  }): Promise<TenOrderCheckResult>;
  /** § 17.10 (lead ruling, 2026-09-25): whether TEN_PAYPAL_MERCHANT_ID is
   *  set. Unset -> refuse, never skip the payee check: both routes answer
   *  503 before calling PayPal at all, not a boot-time crash (index.ts
   *  still starts so the OTHER Edge Functions on the same project aren't
   *  taken down by one missing setting). */
  merchantConfigured: boolean;
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
  // § 17.10: "the setting unset -> refuse, never skip: create-order ...
  // answer 503 before calling PayPal" — checked first, before even
  // reading the body, so no PayPal call is ever reached.
  if (!deps.merchantConfigured) {
    deps.log?.warn({ msg: "ten-paypal: TEN_PAYPAL_MERCHANT_ID not set — refusing create-order" });
    return jsonError(503, "paypal_error", MESSAGES.paypalError, cors);
  }
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

/** F4/§ 17.10: logs the shared "ALERT paypal breakdown mismatch" line (no
 * secrets — capture id, amounts and currency only) at error level when
 * available, falling back to warn (mirrors ten-model-proxy/handler.ts's own
 * `deps.log?.error` fallback). Shared wording so both this function and the
 * webhook's own alert read identically in the logs. */
function alertBreakdownMismatch(deps: PaypalDeps, capture: CaptureInfo): void {
  const alert = {
    msg: "ten-paypal: ALERT paypal breakdown mismatch",
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
  // § 17.10: "capture-order ... answer[s] 503 before calling PayPal" when
  // TEN_PAYPAL_MERCHANT_ID isn't set — checked first, before the order
  // read, so the payee check is never silently skipped.
  if (!deps.merchantConfigured) {
    deps.log?.warn({ msg: "ten-paypal: TEN_PAYPAL_MERCHANT_ID not set — refusing capture-order" });
    return jsonError(503, "paypal_error", MESSAGES.paypalError, cors);
  }
  const parsed = await readJson(req);
  if (!parsed.ok) return jsonError(400, "bad_request", "Invalid JSON.", cors);
  const body = parsed.body as Record<string, unknown>;
  const orderId = body?.orderId;
  if (typeof orderId !== "string" || orderId.length === 0) {
    return jsonError(400, "bad_request", "Missing orderId.", cors);
  }

  // § 17.1 step 4 / § 17.10: "Reads the order first: unless it passes §
  // 17.10's check (403 not_ten_order) and its uid is the caller's (403),
  // nothing is captured."
  let order: OrderInfo;
  try {
    order = await deps.getOrder(orderId);
  } catch (e) {
    deps.log?.warn({ msg: "ten-paypal: capture-order pre-read failed", err: String(e) });
    return jsonError(503, "paypal_error", MESSAGES.paypalError, cors);
  }
  const check = await deps.checkTenOrder({
    customId: order.customId,
    invoiceId: order.invoiceId,
    amountValue: order.amountValue,
    currencyCode: order.currencyCode,
    payeeMerchantId: order.payeeMerchantId,
  });
  if (!check.ok) {
    // § 17.10: not a valid Ten-created order at all (a forged/foreign
    // custom_id, a non-pack amount, the wrong payee, or an invoice_id whose
    // tag doesn't verify) — never even a hint of WHY, to a possible attacker.
    deps.log?.warn({ msg: "ten-paypal: ALERT § 17.10 check failed — not Ten's own order", orderId });
    return jsonError(403, "not_ten_order", MESSAGES.notTenOrder, cors);
  }
  if (check.uid !== user.id) {
    // A genuinely Ten-created order, just not this caller's own.
    return jsonError(403, "not_your_order", "That payment isn't yours.", cors);
  }

  let outcome: CaptureOutcome;
  try {
    outcome = await deps.captureOrder(orderId, captureRequestId(orderId));
  } catch (e) {
    // § 17.10 "Errors": a transport failure calling capture itself must
    // NEVER be read as "declined, no money moved" — PayPal may already
    // have captured the money and simply failed to answer (§ 1.11's "no
    // answer from capture"); the webhook is the backup either way.
    deps.log?.warn({ msg: "ten-paypal: capture call failed", err: String(e) });
    return jsonError(503, "unconfirmed", MESSAGES.unconfirmed, cors);
  }

  let capture: CaptureInfo;
  if (outcome.kind === "captured") {
    capture = outcome.capture;
  } else if (outcome.kind === "already_captured") {
    // § 17.1 step 4: "ORDER_ALREADY_CAPTURED → read the order's capture."
    // § 17.10 excludes this one outcome from "unconfirmed" — money already
    // moved at PayPal by definition, so a re-read failure here is "paid,
    // not yet credited", never "couldn't start a payment" or "unconfirmed".
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
    // § 17.10: "A capture call answering 5xx, timing out, or with any error
    // other than ORDER_ALREADY_CAPTURED -> 503 unconfirmed ... never
    // 'declined'." The webhook is the backup that finds out either way.
    deps.log?.warn({ msg: "ten-paypal: capture answered an error", status: outcome.status, message: outcome.message });
    return jsonError(503, "unconfirmed", MESSAGES.unconfirmed, cors);
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
  // § 17.10 tests: "DECLINED or FAILED: declined." Any OTHER non-COMPLETED
  // status this defensive branch has never seen from PayPal is treated the
  // same way — still never "unconfirmed" (the capture call itself DID
  // answer, just not with a completed capture).
  if (capture.status !== "COMPLETED") {
    return json(200, { status: "declined" }, cors);
  }

  if (!breakdownIsSane(capture)) {
    // § 17.8 test 6 / § 17.10 "Errors and the breakdown": "no row and an
    // ALERT log line; capture-order answers 503 paid_not_credited."
    alertBreakdownMismatch(deps, capture);
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
