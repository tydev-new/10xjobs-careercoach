// Tester helpers for the § 17 PayPal suites (paypal_capture / paypal_webhook).
// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "jsr:@std/assert@1";
import { harness, HOOK, PAY, ppApprove, preq } from "./_harness.ts";

type H = Awaited<ReturnType<typeof harness>>;

export async function pay(h: H, path: string, body: unknown, tok?: string, o: Record<string, any> = {}) {
  const res = await h.paypal(preq(body, { url: PAY + path, token: tok, ...o }));
  const txt = await res.text();
  let j: any;
  try {
    j = JSON.parse(txt);
  } catch { /* not json */ }
  return { res, status: res.status, txt, j };
}

export const paid = (h: H, uid?: string) =>
  h.st.ledger.filter((r) => typeof r.request_id === "string" && r.request_id.startsWith("paypal:") && (!uid || r.user_id === uid));

/** create-order through ten-paypal, then the payer approves in PayPal's window. */
export async function createApproved(h: H, tok: string, pack = "10"): Promise<string> {
  const r = await pay(h, "/create-order", { pack }, tok);
  assertEquals(r.status, 200, r.txt);
  ppApprove(h.pp, r.j.orderId);
  return r.j.orderId;
}

export async function hook(h: H, event: any, headers: Record<string, string>, which?: (r: Request) => Promise<Response>) {
  const res = await (which ?? h.webhook)(
    new Request(HOOK, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(event) }),
  );
  const txt = await res.text();
  return { res, status: res.status, txt };
}
