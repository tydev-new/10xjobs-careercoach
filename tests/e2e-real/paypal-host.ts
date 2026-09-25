// Tester-owned deno host for the § 17 Buy-credit e2e (paypal-ui.ts). Like
// functions-host.ts it serves the REAL deploy entry points, here all four:
// ten-model-proxy, ten-delete-account, ten-paypal, ten-paypal-webhook, with
//   * Deno.env patched to the config below (TEN_PAYPAL_API_BASE is PayPal's
//     real sandbox host, as § 17.6 requires; the fetch wrapper rewrites it);
//   * globalThis.fetch: https://api-m.sandbox.paypal.com -> the loopback PayPal
//     stub from tests/functions/_harness.ts; POST <supabase>/rest/v1/
//     ten_usage_ledger carrying gross_usd -> the e2e's ledger bridge (the
//     stand-in's insert predates § 17's columns; the bridge runs the same
//     insert on the same PGlite with the fourth migration applied); loopback
//     passes; ANY other host throws (run with --allow-net=127.0.0.1).
// Control endpoints for the e2e: /__pp/approve?order=, /__pp/next (POST),
// /__pp/state.
//
// Usage: deno run --allow-net=127.0.0.1 --allow-read paypal-host.ts '<json>'

// deno-lint-ignore-file no-explicit-any
import {
  newPpState,
  PAYPAL_BASE,
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_WEBHOOK_ID,
  paypalHandler,
  ppApprove,
} from "../functions/_harness.ts";

const cfg = JSON.parse(Deno.args[0]) as {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  openrouterKey: string;
  appOrigin: string;
  ledgerBridgeUrl: string;
};

const realFetch = globalThis.fetch;
const realServe = Deno.serve;
const pp = newPpState();
const ppSrv = realServe({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, (req) => paypalHandler(req, pp));
const ppUrl = `http://127.0.0.1:${(ppSrv.addr as Deno.NetAddr).port}`;

globalThis.fetch = (async (input: any, init?: any) => {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (u.origin === PAYPAL_BASE) return realFetch(ppUrl + u.pathname + u.search, init);
  if (u.href === `${cfg.supabaseUrl}/rest/v1/ten_usage_ledger` && init?.method === "POST" && String(init.body).includes("gross_usd")) {
    return realFetch(cfg.ledgerBridgeUrl, init);
  }
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(input, init);
  console.error(`E2E-EXTERNAL-FETCH-REFUSED ${u.href}`);
  throw new TypeError(`paypal host: external fetch refused: ${u.origin}`);
}) as typeof fetch;

const env: Record<string, string> = {
  SUPABASE_URL: cfg.supabaseUrl,
  SUPABASE_ANON_KEY: cfg.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: cfg.serviceKey,
  TEN_OPENROUTER_API_KEY: cfg.openrouterKey,
  TEN_APP_ORIGIN: cfg.appOrigin,
  TEN_PAYPAL_API_BASE: PAYPAL_BASE,
  TEN_PAYPAL_CLIENT_ID: PAYPAL_CLIENT_ID,
  TEN_PAYPAL_CLIENT_SECRET: PAYPAL_CLIENT_SECRET,
  TEN_PAYPAL_WEBHOOK_ID: PAYPAL_WEBHOOK_ID,
};
(Deno.env as any).get = (k: string) => env[k];
(Deno.env as any).toObject = () => ({ ...env });

let captured: any = null;
(Deno as any).serve = (h: any) => {
  captured = typeof h === "function" ? h : h.handler;
  return { finished: Promise.resolve(), shutdown: async () => {}, unref() {}, ref() {}, addr: {} };
};
const fns: Array<[string, any]> = [];
for (const name of ["ten-model-proxy", "ten-delete-account", "ten-paypal-webhook", "ten-paypal"]) {
  await import(`../../supabase/functions/${name}/index.ts`);
  fns.push([name, captured]);
  captured = null;
}
(Deno as any).serve = realServe;

const server = realServe({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/__pp/approve") {
    ppApprove(pp, url.searchParams.get("order")!);
    return Response.json({ ok: true });
  }
  if (url.pathname === "/__pp/next") {
    pp.nextCapture = await req.json();
    return Response.json({ ok: true });
  }
  if (url.pathname === "/__pp/fail") {
    pp.fail = await req.json();
    return Response.json({ ok: true });
  }
  if (url.pathname === "/__pp/state") {
    return Response.json({
      orders: [...pp.orders.values()].map((o) => ({ id: o.id, status: o.status, pu: o.purchase_units[0], capture: o.capture ?? null })),
      hits: pp.hits.map((h) => ({ method: h.method, path: h.path, body: h.body })),
    });
  }
  for (const [name, fn] of fns) {
    if (url.pathname === `/${name}` || url.pathname.startsWith(`/${name}/`)) return fn(req);
  }
  return new Response("no such function", { status: 404 });
});
console.log(`LISTENING ${(server.addr as Deno.NetAddr).port}`);
