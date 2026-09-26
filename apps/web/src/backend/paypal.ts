// Calls the `ten-paypal` Edge Function (docs/design-web-agent.md § 17.1
// steps 2 and 4; design-web-ui.md § 1.11's Buy-credit dialog). A signed-in
// member only — the function itself enforces that; this module just carries
// the current JWT and reports back exactly what the function returned.
//
// Browser-safe: only `fetch`. No window/document/localStorage/node:*.
import { boundFetch } from "./bound-fetch.ts";

export type PackId = "10" | "20" | "40";

export interface PaypalClientOptions {
  /** The Supabase project URL, e.g. https://xxxx.supabase.co. */
  url: string;
  /** Returns the current session's access token. */
  accessToken: () => Promise<string>;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface CreateOrderResult {
  orderId: string;
}

// § 17.1 step 4's four capture-order outcomes, plus "window_closed" for
// ORDER_NOT_APPROVED (§ 17.2's "no money moved unless the payer approved").
// PayPal's own decimal strings, passed through unparsed (never a JS float —
// see supabase/functions/_shared/paypal.ts's file header for why).
export type CaptureResult =
  | { status: "credited"; grossUsd: string; feeUsd: string; creditedUsd: string }
  | { status: "pending" }
  | { status: "declined" }
  | { status: "window_closed" };

async function postTenPaypal<T>(opts: PaypalClientOptions, path: string, body: unknown): Promise<T> {
  const token = await opts.accessToken();
  const fetchImpl = opts.fetchImpl ?? boundFetch();
  const res = await fetchImpl(`${opts.url.replace(/\/+$/, "")}/functions/v1/ten-paypal${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      responseBody && typeof responseBody === "object" && "error" in responseBody && (responseBody as any).error?.message
        ? String((responseBody as any).error.message)
        : `ten-paypal${path} failed: HTTP ${res.status}`;
    throw new Error(message);
  }
  return responseBody as T;
}

/** § 17.1 step 2: `POST ten-paypal/create-order { pack }`. The amount is
 * never sent from here — only the pack id; the server's own table decides
 * the amount (§ 17.1 test 1: "the amount comes from the table whatever the
 * body adds"). */
export function createPaypalOrder(opts: PaypalClientOptions, pack: PackId): Promise<CreateOrderResult> {
  return postTenPaypal<CreateOrderResult>(opts, "/create-order", { pack });
}

/** § 17.1 step 4: `POST ten-paypal/capture-order { orderId }`. */
export function capturePaypalOrder(opts: PaypalClientOptions, orderId: string): Promise<CaptureResult> {
  return postTenPaypal<CaptureResult>(opts, "/capture-order", { orderId });
}
