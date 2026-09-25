// The testable core of ten-paypal-webhook (docs/design-web-agent.md § 17.1
// step 5): PayPal's backup delivery of PAYMENT.CAPTURE.COMPLETED. Every
// side effect (signature verification, the membership check, the capture
// re-fetch, the ledger insert) comes through `WebhookDeps`, so this runs
// under `deno test` against a mocked PayPal API and a mocked Supabase, with
// no `window`/`document`/`localStorage`/`node:` API and no network access
// at import time. index.ts wires the real deps and calls `Deno.serve`.
//
// Deployed with `--no-verify-jwt` (PayPal calls this directly, never a
// signed-in browser) and with NO CORS headers on any response (§ 17.1: "no
// CORS") — a browser could never read this function's response anyway, and
// adding CORS headers would only be misleading about who this is for.

import { breakdownIsSane, customIdFor, packForAmount, uidFromCustomId } from "../_shared/paypal-packs.ts";
import type { CaptureInfo, WebhookHeaders } from "../_shared/paypal.ts";
import type { LedgerCreditRow } from "../_shared/supabase.ts";

// § 17.1 step 5: "Checks, in order: POST, ≤ 64 KB, JSON."
const MAX_BODY_BYTES = 64 * 1024;

export interface WebhookDeps {
  /** `ok: false` covers BOTH "the call to PayPal failed" and "the secret
   *  (TEN_PAYPAL_WEBHOOK_ID) isn't set" — index.ts's wiring folds the
   *  latter into this shape so handler.ts has one branch for "§ 17.1: the
   *  call failing, or the secret unset -> 503, so PayPal retries." */
  verifyWebhookSignature(
    headers: WebhookHeaders,
    event: unknown,
  ): Promise<{ ok: true; verified: boolean } | { ok: false }>;
  isMemberByUid(uid: string): Promise<boolean>;
  /** Rejects with an Error carrying `status` (F7, fix round 2): a 404
   *  (`status === 404`) means PayPal has no such capture at all — handled
   *  distinctly from every other failure, which stays a 503 so PayPal
   *  retries. */
  getCapture(captureId: string): Promise<CaptureInfo>;
  insertLedgerCredit(row: LedgerCreditRow): Promise<void>;
  /** F1 (fix round 2): re-verifies create-order's own HMAC binding (uid +
   *  pack + amount) from the re-fetched capture's own invoice_id, before
   *  ever crediting. Never throws. */
  verifyInvoiceId(invoiceId: string, uid: string, pack: string, amountUsd: string): Promise<boolean>;
  log?: { warn(e: unknown): void; error?(e: unknown): void };
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Same shape as ten-model-proxy/handler.ts's own `readCappedBody`: reads
 * incrementally and aborts as soon as the body exceeds `maxBytes`, without
 * buffering the rest. */
async function readCappedBody(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const body = req.body;
  if (!body) return { ok: true, text: "" };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("body over the size cap").catch(() => {});
      return { ok: false };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { ok: true, text };
}

/** Mirrors ten-paypal/handler.ts's own check — a duplicate `request_id`
 * (409) means this exact capture was already credited (most likely by
 * capture-order winning the race), not an error. */
function isDuplicateRequestId(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { duplicate?: unknown }).duplicate === true;
}

/** F4 (fix round 2): the shared "ALERT paypal breakdown mismatch" line, at
 * error level when available (mirrors ten-model-proxy/handler.ts's own
 * `deps.log?.error` fallback) — no secret in it, capture id/amounts/
 * currency only. */
function alertBreakdownMismatch(deps: WebhookDeps, capture: CaptureInfo): void {
  const alert = {
    msg: "ten-paypal-webhook: ALERT paypal breakdown mismatch",
    captureId: capture.captureId,
    grossUsd: capture.grossUsd,
    feeUsd: capture.feeUsd,
    netUsd: capture.netUsd,
    currencyCode: capture.currencyCode,
  };
  if (deps.log?.error) deps.log.error(alert);
  else deps.log?.warn(alert);
}

export async function handleRequest(req: Request, deps: WebhookDeps): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Not found", { status: 404 });
  }

  try {
    const capped = await readCappedBody(req, MAX_BODY_BYTES);
    if (!capped.ok) {
      return new Response("Payload too large", { status: 413 });
    }
    const raw = capped.text;
    // deno-lint-ignore no-explicit-any
    let event: any;
    try {
      event = raw.length > 0 ? JSON.parse(raw) : {};
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // § 17.1 step 5: "Then PayPal's signature ... with the five paypal-*
    // headers, the event and TEN_PAYPAL_WEBHOOK_ID; anything but SUCCESS ->
    // 401, no credit; the call failing, or the secret unset -> 503, so
    // PayPal retries."
    const headers: WebhookHeaders = {
      authAlgo: req.headers.get("paypal-auth-algo") ?? "",
      certUrl: req.headers.get("paypal-cert-url") ?? "",
      transmissionId: req.headers.get("paypal-transmission-id") ?? "",
      transmissionSig: req.headers.get("paypal-transmission-sig") ?? "",
      transmissionTime: req.headers.get("paypal-transmission-time") ?? "",
    };
    // F8 (fix round 2): any of the five headers missing/empty is refused
    // with 401 directly — never even calls PayPal's verify endpoint (there
    // is nothing for it to check; treating a missing header as "the call
    // failed" would wrongly cost a 503 retry instead of a flat refusal).
    if (Object.values(headers).some((v) => v === "")) {
      return json(401, { error: "bad_signature" });
    }
    const verify = await deps.verifyWebhookSignature(headers, event);
    if (!verify.ok) {
      return json(503, { error: "verify_unavailable" });
    }
    if (!verify.verified) {
      return json(401, { error: "bad_signature" });
    }

    // § 17.1 step 5 filters — each just 200 "ignored" to the caller (PayPal
    // must not be told WHY, and must never be retried for these): "another
    // event type -> 200; resource.custom_id not exactly ten:<uuid> -> 200
    // (the older app's); not a member -> 200 and an alert ('refund by hand')."
    if (event?.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return json(200, { status: "ignored" });
    }
    const resource = event?.resource ?? {};
    const eventCustomId = typeof resource.custom_id === "string" ? resource.custom_id : "";
    const uid = uidFromCustomId(eventCustomId);
    if (!uid) {
      return json(200, { status: "ignored" });
    }
    const captureId = typeof resource.id === "string" ? resource.id : "";
    if (!captureId) {
      return json(200, { status: "ignored" });
    }

    let member: boolean;
    try {
      member = await deps.isMemberByUid(uid);
    } catch (e) {
      deps.log?.warn({ msg: "ten-paypal-webhook: membership check failed", err: String(e) });
      return json(503, { error: "membership_unavailable" });
    }
    if (!member) {
      deps.log?.warn({
        msg: "ten-paypal-webhook: ALERT capture for a non-member uid — refund by hand",
        customId: eventCustomId,
        captureId,
      });
      return json(200, { status: "ignored" });
    }

    // § 17.1 step 5: "Then, still, re-fetch GET /v2/payments/captures/{id}
    // with Ten's keys (failure -> 503): the signature proves PayPal sent
    // the event, the re-fetch proves the capture (rule 11)."
    let capture: CaptureInfo;
    try {
      capture = await deps.getCapture(captureId);
    } catch (e) {
      // F7 (fix round 2): a 404 means PayPal has no such capture at all —
      // an unknown/forged id, never a race with a not-yet-visible capture
      // (PayPal doesn't send this event before the capture itself exists) —
      // so it's ignored, not retried. Every OTHER re-fetch failure (a
      // transient 5xx, a network error) stays a 503, worth PayPal's retry.
      const status = (e as { status?: unknown })?.status;
      if (status === 404) {
        deps.log?.warn({ msg: "ten-paypal-webhook: re-fetch 404 — unknown capture", captureId });
        return json(200, { status: "ignored" });
      }
      deps.log?.warn({ msg: "ten-paypal-webhook: capture re-fetch failed", err: String(e), captureId });
      return json(503, { error: "capture_unavailable" });
    }

    // "It must show the same custom_id, COMPLETED, a USD pack, else 200 and
    // an alert; credit (a failed write -> 503)."
    if (capture.customId !== eventCustomId || capture.customId !== customIdFor(uid) || capture.status !== "COMPLETED") {
      deps.log?.warn({
        msg: "ten-paypal-webhook: ALERT re-fetched capture doesn't match the event",
        captureId,
        status: capture.status,
        customId: capture.customId,
        eventCustomId,
      });
      return json(200, { status: "ignored" });
    }
    if (!breakdownIsSane(capture)) {
      alertBreakdownMismatch(deps, capture);
      return json(200, { status: "ignored" });
    }
    // F1 (fix round 2, lead ruling): re-verify create-order's own HMAC
    // binding from the re-fetched capture's OWN invoice_id before crediting
    // — a forged/foreign capture whose custom_id merely happens to read
    // ten:<uid> has no way to carry a tag that verifies.
    const pack = packForAmount(capture.grossUsd);
    if (!pack || !(await deps.verifyInvoiceId(capture.invoiceId, uid, pack, capture.grossUsd))) {
      deps.log?.warn({ msg: "ten-paypal-webhook: ALERT invoice tag failed to verify — not Ten's own order", captureId });
      return json(200, { status: "ignored" });
    }

    const row: LedgerCreditRow = {
      user_id: uid,
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
        deps.log?.warn({ msg: "ten-paypal-webhook: ledger credit insert failed", err: String(e), captureId });
        return json(503, { error: "credit_failed" });
      }
      // Already credited (capture-order's own insert, or a webhook
      // replay) — § 17.8 test 3, "one row" either way.
    }

    return json(200, { status: "credited" });
  } catch (e) {
    deps.log?.warn({ msg: "ten-paypal-webhook: unexpected failure, failing closed", err: String(e) });
    return json(503, { error: "unavailable" });
  }
}
