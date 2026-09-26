// Independent tester — docs/design-web-agent.md § 17.6: "The functions refuse
// to start unless the base is https://api-m.sandbox.paypal.com or
// https://api-m.paypal.com." Loads fresh copies of both REAL index.ts files
// under a patched env; Deno.serve is stubbed so nothing listens.

// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "jsr:@std/assert@1";
import { harness, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, t } from "./_harness.ts";

async function boot(load: () => Promise<unknown>, env: Record<string, string | undefined>) {
  await harness(); // the shared harness owns the fetch guard; build it first
  const savedGet = (Deno.env as any).get;
  const savedObj = (Deno.env as any).toObject;
  const savedServe = (Deno as any).serve;
  let served = false;
  (Deno.env as any).get = (k: string) => env[k];
  (Deno.env as any).toObject = () => ({ ...env });
  (Deno as any).serve = () => {
    served = true;
    return { finished: Promise.resolve(), shutdown: async () => {}, unref() {}, ref() {}, addr: {} };
  };
  try {
    await load();
    return { ok: true, served };
  } catch (e) {
    return { ok: false, served, err: String(e) };
  } finally {
    (Deno.env as any).get = savedGet;
    (Deno.env as any).toObject = savedObj;
    (Deno as any).serve = savedServe;
  }
}

const base = (api: string | undefined) => ({
  SUPABASE_URL: "http://127.0.0.1:1",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  TEN_APP_ORIGIN: "https://ten.example.com",
  TEN_PAYPAL_API_BASE: api,
  TEN_PAYPAL_CLIENT_ID: PAYPAL_CLIENT_ID,
  TEN_PAYPAL_CLIENT_SECRET: PAYPAL_CLIENT_SECRET,
  TEN_PAYPAL_WEBHOOK_ID: PAYPAL_WEBHOOK_ID,
});

// Literal specifiers: deno pre-loads them, so no --allow-read is needed.
const CASES: Array<[string, string, string | undefined, () => Promise<unknown>]> = [
  ["ten-paypal", "bad", undefined, () => import("../../supabase/functions/ten-paypal/index.ts?boot-bad0")],
  ["ten-paypal", "bad", "", () => import("../../supabase/functions/ten-paypal/index.ts?boot-bad1")],
  ["ten-paypal", "bad", "http://api-m.sandbox.paypal.com", () => import("../../supabase/functions/ten-paypal/index.ts?boot-bad2")],
  ["ten-paypal", "bad", "https://api-m.sandbox.paypal.com/", () => import("../../supabase/functions/ten-paypal/index.ts?boot-bad3")],
  ["ten-paypal", "bad", "https://api-m.paypal.com.evil.example", () => import("../../supabase/functions/ten-paypal/index.ts?boot-bad4")],
  ["ten-paypal", "bad", "https://evil.example", () => import("../../supabase/functions/ten-paypal/index.ts?boot-bad5")],
  ["ten-paypal", "bad", "http://127.0.0.1:9999", () => import("../../supabase/functions/ten-paypal/index.ts?boot-bad6")],
  ["ten-paypal", "bad", "https://api.paypal.com", () => import("../../supabase/functions/ten-paypal/index.ts?boot-bad7")],
  ["ten-paypal", "bad", " https://api-m.paypal.com", () => import("../../supabase/functions/ten-paypal/index.ts?boot-bad8")],
  ["ten-paypal", "good", "https://api-m.sandbox.paypal.com", () => import("../../supabase/functions/ten-paypal/index.ts?boot-good0")],
  ["ten-paypal", "good", "https://api-m.paypal.com", () => import("../../supabase/functions/ten-paypal/index.ts?boot-good1")],
  ["ten-paypal", "nosecret", "https://api-m.paypal.com", () => import("../../supabase/functions/ten-paypal/index.ts?boot-nosecret")],
  ["ten-paypal-webhook", "bad", undefined, () => import("../../supabase/functions/ten-paypal-webhook/index.ts?boot-bad0")],
  ["ten-paypal-webhook", "bad", "", () => import("../../supabase/functions/ten-paypal-webhook/index.ts?boot-bad1")],
  ["ten-paypal-webhook", "bad", "http://api-m.sandbox.paypal.com", () => import("../../supabase/functions/ten-paypal-webhook/index.ts?boot-bad2")],
  ["ten-paypal-webhook", "bad", "https://api-m.sandbox.paypal.com/", () => import("../../supabase/functions/ten-paypal-webhook/index.ts?boot-bad3")],
  ["ten-paypal-webhook", "bad", "https://api-m.paypal.com.evil.example", () => import("../../supabase/functions/ten-paypal-webhook/index.ts?boot-bad4")],
  ["ten-paypal-webhook", "bad", "https://evil.example", () => import("../../supabase/functions/ten-paypal-webhook/index.ts?boot-bad5")],
  ["ten-paypal-webhook", "bad", "http://127.0.0.1:9999", () => import("../../supabase/functions/ten-paypal-webhook/index.ts?boot-bad6")],
  ["ten-paypal-webhook", "bad", "https://api.paypal.com", () => import("../../supabase/functions/ten-paypal-webhook/index.ts?boot-bad7")],
  ["ten-paypal-webhook", "bad", " https://api-m.paypal.com", () => import("../../supabase/functions/ten-paypal-webhook/index.ts?boot-bad8")],
  ["ten-paypal-webhook", "good", "https://api-m.sandbox.paypal.com", () => import("../../supabase/functions/ten-paypal-webhook/index.ts?boot-good0")],
  ["ten-paypal-webhook", "good", "https://api-m.paypal.com", () => import("../../supabase/functions/ten-paypal-webhook/index.ts?boot-good1")],
  ["ten-paypal-webhook", "nosecret", "https://api-m.paypal.com", () => import("../../supabase/functions/ten-paypal-webhook/index.ts?boot-nosecret")],
  ["ten-paypal-webhook", "nohook", "https://api-m.paypal.com", () => import("../../supabase/functions/ten-paypal-webhook/index.ts?boot-nohook")],
];

t("§ 17.6 both PayPal functions refuse to start on any base but PayPal's two hosts; start on either", async () => {
  const problems: string[] = [];
  for (const [fn, kind, api, load] of CASES) {
    const env: Record<string, string | undefined> = base(api);
    if (kind === "nosecret") env.TEN_PAYPAL_CLIENT_SECRET = undefined;
    if (kind === "nohook") env.TEN_PAYPAL_WEBHOOK_ID = undefined;
    const r = await boot(load, env);
    const want = kind === "good" || kind === "nohook";
    if (want && !(r.ok && r.served)) problems.push(`${fn} ${kind} ${JSON.stringify(api)} did not start: ${(r as any).err ?? ""}`);
    if (!want && (r.ok || r.served)) problems.push(`${fn} ${kind} ${JSON.stringify(api)} STARTED`);
    if (!want && String((r as any).err ?? "").includes(PAYPAL_CLIENT_SECRET)) problems.push(`${fn} ${kind}: the refusal names the secret`);
  }
  assertEquals(problems, []);
});
