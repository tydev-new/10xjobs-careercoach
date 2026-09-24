// Tester-owned deno host for the step 5b real-app e2e: serves the REAL
// deploy entry points supabase/functions/ten-model-proxy/index.ts and
// supabase/functions/ten-delete-account/index.ts (not their handlers with
// hand-built deps — the files the owner deploys), same technique as
// tests/functions/_harness.ts:
//   * Deno.serve is patched only while each index.ts loads, to capture its handler;
//   * Deno.env.get/toObject are patched to the config below (no --allow-env);
//   * globalThis.fetch: https://openrouter.ai/api/v1/chat/completions is
//     rewritten to the e2e's local stub OpenRouter; loopback passes through;
//     ANY other host throws (and the process runs with --allow-net=127.0.0.1).
// Requests arrive from the stand-in gateway with /functions/v1 stripped, as
// Supabase's gateway does: /ten-model-proxy/... and /ten-delete-account.
//
// Usage: deno run --allow-net=127.0.0.1 --allow-read functions-host.ts '<json config>'
// Prints "LISTENING <port>" once ready.

// deno-lint-ignore-file no-explicit-any
const cfg = JSON.parse(Deno.args[0]) as {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  openrouterKey: string;
  appOrigin: string;
  stubOpenRouterUrl: string;
};

const realFetch = globalThis.fetch;
const realServe = Deno.serve;

globalThis.fetch = ((input: any, init?: any) => {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (u.href === "https://openrouter.ai/api/v1/chat/completions") {
    return realFetch(`${cfg.stubOpenRouterUrl}/api/v1/chat/completions`, init);
  }
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(input, init);
  console.error(`E2E-EXTERNAL-FETCH-REFUSED ${u.href}`);
  return Promise.reject(new TypeError(`e2e host: external fetch refused: ${u.origin}`));
}) as typeof fetch;

const env: Record<string, string> = {
  SUPABASE_URL: cfg.supabaseUrl,
  SUPABASE_ANON_KEY: cfg.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: cfg.serviceKey,
  TEN_OPENROUTER_API_KEY: cfg.openrouterKey,
  TEN_APP_ORIGIN: cfg.appOrigin,
};
(Deno.env as any).get = (k: string) => env[k];
(Deno.env as any).toObject = () => ({ ...env });

let captured: ((req: Request) => Response | Promise<Response>) | null = null;
(Deno as any).serve = (h: any) => {
  captured = typeof h === "function" ? h : h.handler;
  return { finished: Promise.resolve(), shutdown: async () => {}, unref() {}, ref() {}, addr: {} };
};
await import("../../supabase/functions/ten-model-proxy/index.ts");
const proxy = captured!;
captured = null;
await import("../../supabase/functions/ten-delete-account/index.ts");
const del = captured!;
(Deno as any).serve = realServe;

const server = realServe({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, (req) => {
  const path = new URL(req.url).pathname;
  if (path.startsWith("/ten-model-proxy")) return proxy(req);
  if (path.startsWith("/ten-delete-account")) return del(req);
  return new Response("no such function", { status: 404 });
});
console.log(`LISTENING ${(server.addr as Deno.NetAddr).port}`);
