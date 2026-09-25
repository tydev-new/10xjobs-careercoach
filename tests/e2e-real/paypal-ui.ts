// Tester-owned headless e2e for design-web-ui.md § 1.11 (Buy credit) and
// design-web-agent.md § 17.1 step 1 / § 17.2, derived from the docs:
// members only; opened from the balance chip or the ⋯ menu; the PayPal SDK
// loaded only after the dialog opens (on a pack pick), with intent=capture,
// currency=USD, disable-funding=paylater and the PUBLIC client id; the copy
// word for word; the chip refreshes after a credit; nothing about PayPal
// reaches a non-member.
//
// Drives the PRODUCTION build of apps/web in headless Chromium against local
// stand-ins only: stand-in.ts (GoTrue + PostgREST over PGlite with all FOUR
// migrations), paypal-host.ts (the REAL ten-* index.ts files over a loopback
// PayPal stub). PayPal's JS SDK is replaced by a fake that exposes the
// Buttons callbacks; every other non-loopback request is aborted and recorded.
//
// Run from the repo root:  node tests/e2e-real/paypal-ui.ts
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-ignore - resolved from apps/web's own install
import { chromium } from "../../apps/web/node_modules/playwright/index.mjs";
import { ANON_KEY, SERVICE_KEY, startStandIn, type StandIn } from "./stand-in.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const WEB = path.join(REPO, "apps/web");
const PASSWORD = "correct horse battery";
const PUBLIC_CLIENT_ID = "AcanaryPAYPALclientID-4b1e"; // the harness's PAYPAL_CLIENT_ID; public by design
const SECRET_DECOY = "EcanaryPAYPALsecret-9f3a7c2e1d5b8a6f4c0e2d7b9a1f3c5e";
const WEBHOOK_DECOY = "8PT597110X687430LKGECATA";
const OPENROUTER_CANARY = "sk-or-v1-E2E-CANARY-0a1b2c3d4e5f60718293a4b5c6d7e8f9";

// ---- § 1.11 copy, word for word (from docs/design-web-ui.md)
const INTRO =
  "Credit pays for Ten's work. You pay in PayPal's window; Ten adds what arrives after PayPal's fee, a few percent plus a fixed amount. This is a one-time payment: nothing renews, and Ten never charges you on its own.";
const FOOTER =
  "Paid credit stays if you delete your beta data. The beta has a shared daily limit, so on a busy day Ten can pause until tomorrow even with credit. For a refund, email support@10xjobs.co.";
const CREDITED_10 = "Added $9.16 of credit. PayPal charged $10.00; its fee was $0.84.";
const PENDING = "PayPal is still clearing this payment. The credit is added when it clears.";
const DECLINED = "PayPal declined this payment. No money moved.";
const CLOSED = "No payment was made.";
const CREATE_FAILED = "Couldn't start a payment. No money moved.";
const NOT_CREDITED =
  "Ten couldn't confirm the credit yet. If PayPal took your payment, it's added automatically, usually within minutes. If not by tomorrow, email support@10xjobs.co with PayPal's receipt.";
const OVER_BALANCE = "Your credit is used up. You can buy more from your balance at the top.";

const results: { ok: boolean; name: string; detail: string }[] = [];
function rec(ok: boolean, name: string, detail = "") {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 15000, step = 150): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) return undefined;
    await sleep(step);
  }
}
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- setup
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "ten-e2e-paypal-"));
const standIn: StandIn = await startStandIn();
const db = standIn.backend.db;
await db.exec(readFileSync(path.join(REPO, "supabase/migrations/20260925000000_ten_paypal_credit.sql"), "utf8"));

// The PostgREST insert § 17's functions make (service role), on the same PGlite.
let bridgePlan: string[] = [];
const bridge = http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const r = JSON.parse(body);
  if (bridgePlan.shift() === "fail") {
    res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ code: "XX000", message: "injected" }));
    return;
  }
  try {
    await standIn.sql(
      "insert into public.ten_usage_ledger (user_id, kind, request_id, usd, gross_usd, fee_usd) values ($1,$2,$3,$4::numeric,$5::numeric,$6::numeric)",
      [r.user_id, r.kind, r.request_id, r.usd, r.gross_usd, r.fee_usd],
    );
    res.writeHead(201).end();
  } catch (e: any) {
    const st = e.code === "23505" ? 409 : 400;
    res.writeHead(st, { "content-type": "application/json" }).end(JSON.stringify({ code: e.code, message: e.message }));
  }
});
await new Promise<void>((r) => bridge.listen(0, "127.0.0.1", () => r()));
const bridgeUrl = `http://127.0.0.1:${(bridge.address() as any).port}/ledger`;

let root = "";
const web = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://x");
  let p = path.join(root, decodeURIComponent(u.pathname));
  if (!p.startsWith(root) || !existsSync(p) || statSync(p).isDirectory()) p = path.join(root, "index.html");
  const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".json": "application/json" };
  res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise<void>((r) => web.listen(0, "127.0.0.1", () => r()));
const ORIGIN = `http://127.0.0.1:${(web.address() as any).port}`;

const deno: ChildProcess = spawn(
  "deno",
  ["run", "--allow-net=127.0.0.1", "--allow-read", path.join(HERE, "paypal-host.ts"), JSON.stringify({ supabaseUrl: standIn.url, anonKey: ANON_KEY, serviceKey: SERVICE_KEY, openrouterKey: OPENROUTER_CANARY, appOrigin: ORIGIN, ledgerBridgeUrl: bridgeUrl })],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const denoLog: string[] = [];
const denoPort: number = await new Promise((resolve, reject) => {
  deno.stdout!.on("data", (b: Buffer) => {
    denoLog.push(b.toString());
    const m = /LISTENING (\d+)/.exec(b.toString());
    if (m) resolve(Number(m[1]));
  });
  deno.stderr!.on("data", (b: Buffer) => denoLog.push(b.toString()));
  deno.on("exit", (c) => reject(new Error("deno exited " + c + "\n" + denoLog.join(""))));
  setTimeout(() => reject(new Error("deno did not start\n" + denoLog.join(""))), 60000);
});
const HOST = `http://127.0.0.1:${denoPort}`;
standIn.setFunctionsTarget(HOST);
const ctl = async (p: string, body?: unknown) => (await fetch(HOST + p, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) })).json();

const dist = path.join(tmpRoot, "dist");
const cleanEnv: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("VITE_") && v !== undefined) cleanEnv[k] = v;
Object.assign(cleanEnv, {
  VITE_SUPABASE_URL: standIn.url,
  VITE_SUPABASE_ANON_KEY: ANON_KEY,
  VITE_SITE_URL: ORIGIN,
  VITE_PAYPAL_CLIENT_ID: PUBLIC_CLIENT_ID,
  // decoys: the function secrets present in the BUILD env must never be inlined
  TEN_PAYPAL_CLIENT_SECRET: SECRET_DECOY,
  TEN_PAYPAL_WEBHOOK_ID: WEBHOOK_DECOY,
  TEN_PAYPAL_CLIENT_ID: "server-side-only-id",
});
const b = spawnSync("npm", ["run", "build", "--", "--outDir", dist, "--emptyOutDir"], { cwd: WEB, env: cleanEnv, encoding: "utf8" });
rec(b.status === 0, "production build with VITE_PAYPAL_CLIENT_ID", b.status === 0 ? "" : (b.stdout + b.stderr).slice(-1500));
if (b.status !== 0) {
  deno.kill();
  bridge.close();
  web.close();
  await standIn.close();
  process.exit(1);
}
root = dist;
{
  let txt = "";
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|html|css|map|json)$/.test(f)) txt += readFileSync(p, "utf8");
    }
  };
  walk(dist);
  rec(txt.includes(PUBLIC_CLIENT_ID), "bundle: carries the public VITE_PAYPAL_CLIENT_ID");
  rec(!txt.includes(SECRET_DECOY) && !txt.includes(WEBHOOK_DECOY) && !txt.includes("server-side-only-id"), "bundle: no PayPal client secret, webhook id or server client id (§ 17.6)");
  rec(!/api-m\.(sandbox\.)?paypal\.com/.test(txt), "bundle: the browser never calls PayPal's REST API directly");
}

// ---------------------------------------------------------------- browser
const browser = await chromium.launch(); // headless
const external: string[] = [];
const sdkLoads: string[] = [];
const FAKE_SDK = `
window.paypal = {
  Buttons(opts) {
    window.__ppOpts = opts;
    return {
      render(el) {
        const b = document.createElement("button");
        b.className = "fake-paypal-button";
        b.textContent = "PayPal (fake)";
        b.onclick = async () => {
          try { window.__orderId = await opts.createOrder(); }
          catch (e) { window.__createErr = String(e); }
        };
        el.appendChild(b);
        return Promise.resolve();
      },
    };
  },
};`;

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const tenPaypal: Array<{ url: string; body: string | null }> = [];
  await ctx.route("**/*", async (route: any) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1" || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    if (u.hostname === "www.paypal.com" && u.pathname === "/sdk/js") {
      sdkLoads.push(u.href);
      return route.fulfill({ status: 200, headers: { "content-type": "text/javascript" }, body: FAKE_SDK });
    }
    external.push(u.href);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("request", (r: any) => {
    if (r.url().includes("/functions/v1/ten-paypal")) tenPaypal.push({ url: r.url(), body: r.postData() });
  });
  await page.goto(ORIGIN + "/");
  return { ctx, page, tenPaypal };
}
async function signIn(page: any, email: string) {
  await page.locator(".sign-in-mode-toggle button", { hasText: "Email + password" }).click();
  await page.locator(".sign-in-form input[type=email]").fill(email);
  await page.locator(".sign-in-form input[type=password]").fill(PASSWORD);
  await page.locator(".sign-in-form button[type=submit]").click();
}
const chipText = async (page: any) => ((await page.locator(".balance-chip").textContent()) ?? "").trim();
const dialog = (page: any) => page.locator('[role=dialog][aria-label="Buy credit"]');
const paypalRows = async (uid: string) =>
  await standIn.sql<any>("select request_id, usd::text usd, gross_usd::text gross, fee_usd::text fee from public.ten_usage_ledger where user_id = $1 and request_id like 'paypal:%'", [uid]);
async function approveAndCapture(page: any, cancel = false) {
  const orderId = await until(async () => (await page.evaluate(() => (window as any).__orderId)) as string | undefined, 10000);
  if (!orderId) return undefined;
  if (cancel) {
    await page.evaluate(() => (window as any).__ppOpts.onCancel({}));
    return orderId;
  }
  await ctl(`/__pp/approve?order=${orderId}`);
  await page.evaluate((id: string) => (window as any).__ppOpts.onApprove({ orderID: id }), orderId);
  return orderId;
}
async function pickAndPay(page: any, pack: string) {
  await page.evaluate(() => {
    delete (window as any).__orderId;
    delete (window as any).__createErr;
  });
  await dialog(page).getByRole("button", { name: `$${pack}`, exact: true }).click();
  await page.locator(".fake-paypal-button").waitFor({ timeout: 10000 });
  await page.locator(".fake-paypal-button").click();
}

try {
  // ---- a member: nothing PayPal until the dialog opens
  const uid = await standIn.createUser({ email: "buyer@example.com", member: true });
  const { page, tenPaypal, ctx } = await newPage();
  await signIn(page, "buyer@example.com");
  await page.locator(".composer-input").waitFor({ timeout: 20000 });
  await until(async () => (await chipText(page)) === "$5.00");
  await page.waitForTimeout(800);
  rec(sdkLoads.length === 0, "§ 17.1(1) a signed-in member's page loads no PayPal SDK before the dialog opens", sdkLoads.join(", "));
  rec((await page.locator('script[src*="paypal"]').count()) === 0, "no PayPal <script> in the page before the dialog opens");
  rec((await page.locator("button.balance-chip").count()) === 1, "§ 1.11 the balance chip is a button for a member");

  // open from the chip
  await page.locator("button.balance-chip").click();
  await dialog(page).waitFor({ timeout: 5000 });
  const dText = norm((await dialog(page).textContent()) ?? "");
  rec(dText.includes("Buy credit"), "§ 1.11 title 'Buy credit'");
  rec(dText.includes(INTRO), "§ 1.11 intro word for word", dText.slice(0, 400));
  rec(dText.includes(FOOTER), "§ 1.11 footer word for word (refund contact support@10xjobs.co)", dText.slice(-400));
  const packs = (await dialog(page).locator("button").allTextContents()).map((s: string) => s.trim());
  rec(["$10", "$20", "$40"].every((p) => packs.includes(p)) && !packs.includes("$5"), "§ 17 packs $10, $20, $40 (no $5)", packs.join(" | "));
  rec((await dialog(page).locator("input").count()) === 0, "§ 17.1 no amount field: the client chooses a pack, never an amount");
  rec(sdkLoads.length === 0, "OBSERVED-as-check: opening the dialog alone loads no SDK (it loads on a pack pick, § 17.1(1) 'loaded only then')", `${sdkLoads.length} load(s)`);
  await page.keyboard.press("Escape");
  rec((await dialog(page).count()) === 0, "§ 1.11 Esc closes the dialog");

  // open from the ⋯ menu
  await page.locator(".menu-trigger").click();
  await page.getByRole("menuitem", { name: "Buy credit" }).click();
  await dialog(page).waitFor({ timeout: 5000 });
  rec(true, "§ 1.11 'Buy credit' in the ⋯ menu opens the same dialog");

  // pick $10 -> the SDK with the § 17.1 parameters, once
  await pickAndPay(page, "10");
  rec(sdkLoads.length === 1, "the SDK loads once, after a pack pick", sdkLoads.join(", "));
  const q = new URL(sdkLoads[0] ?? "https://x/").searchParams;
  rec(q.get("client-id") === PUBLIC_CLIENT_ID && q.get("currency") === "USD" && q.get("intent") === "capture" && q.get("disable-funding") === "paylater", "§ 17.1(1) SDK: public client-id, currency=USD, intent=capture, disable-funding=paylater", sdkLoads[0]);
  rec(!/vault=true|commit=false|components=.*(card-fields|messages)/.test(sdkLoads[0] ?? ""), "SDK: no vault, no Pay Later messages", sdkLoads[0]);
  const orderId = await approveAndCapture(page);
  const create = tenPaypal.find((r) => r.url.endsWith("/ten-paypal/create-order"));
  rec(create?.body === JSON.stringify({ pack: "10" }), "§ 17.1(2) the browser sends only { pack } to create-order", create?.body ?? "(none)");
  const res = await until(async () => {
    const t = norm((await dialog(page).textContent()) ?? "");
    return t.includes("Added") || t.includes("couldn't") || t.includes("declined") ? t : undefined;
  });
  rec(!!res && res.includes(CREDITED_10), "§ 1.11 credited copy with the reply's numbers", res?.slice(0, 300));
  const capture = tenPaypal.find((r) => r.url.endsWith("/ten-paypal/capture-order"));
  rec(capture?.body === JSON.stringify({ orderId }), "§ 17.1(4) the browser sends only { orderId } to capture-order", capture?.body ?? "(none)");
  const chip2 = await until(async () => ((await chipText(page)) === "$14.16" ? "$14.16" : undefined), 8000);
  rec(chip2 === "$14.16", "§ 1.11 the chip refreshes: $5.00 + net $9.16", await chipText(page));
  const rows = await paypalRows(uid);
  rec(rows.length === 1 && Number(rows[0].usd) === 9.16 && rows[0].gross === "10.00" && rows[0].fee === "0.84", "§ 17.3 one paypal: row, usd = net, gross/fee recorded", JSON.stringify(rows));
  await dialog(page).getByRole("button", { name: "Close" }).first().click();
  rec((await dialog(page).count()) === 0, "§ 1.11 Close shuts the dialog");

  // outcomes, each from a fresh open
  const outcome = async (label: string, pack: string, want: string, prep: () => Promise<void>, cancel = false) => {
    await page.locator("button.balance-chip").click();
    await dialog(page).waitFor({ timeout: 5000 });
    await prep();
    await pickAndPay(page, pack);
    const created = await until(async () => (await page.evaluate(() => (window as any).__orderId ?? (window as any).__createErr)) as string | undefined, 8000);
    if (created && !String(created).startsWith("Error")) await approveAndCapture(page, cancel);
    const t = await until(async () => {
      const s = norm((await dialog(page).textContent()) ?? "");
      return s.includes(want) ? s : undefined;
    }, 10000);
    rec(!!t, `§ 1.11 ${label}: "${want.slice(0, 60)}…"`, t ? "" : norm((await dialog(page).textContent()) ?? "").slice(0, 400));
    await page.keyboard.press("Escape");
  };
  await outcome("window closed", "20", CLOSED, async () => {}, true);
  await outcome("pending", "20", PENDING, async () => void (await ctl("/__pp/next", { status: "PENDING" })));
  await outcome("declined", "20", DECLINED, async () => void (await ctl("/__pp/next", { status: "DECLINED", breakdown: null })));
  await outcome("not credited (the credit write failed)", "20", NOT_CREDITED, async () => void (bridgePlan = ["fail"]));
  await outcome("create-order failed", "40", CREATE_FAILED, async () => void (await ctl("/__pp/fail", { "/v2/checkout/orders": 500 })));
  await ctl("/__pp/fail", {});
  // § 17.10: a capture 5xx is "couldn't confirm", never "declined"
  await outcome("capture answered 500 (unconfirmed)", "10", NOT_CREDITED, async () => void (await ctl("/__pp/fail", { "/capture": 500 })));
  await ctl("/__pp/fail", {});
  rec((await paypalRows(uid)).length === 1, "no outcome but 'credited' wrote a row");
  rec(sdkLoads.length === 1, "the SDK script is loaded once per page, not per open", `${sdkLoads.length}`);
  await ctx.close();

  // ---- over_balance points at the chip (the one pointer, § 17.2)
  const broke = await standIn.createUser({ email: "broke@example.com", member: true });
  await standIn.sql("insert into public.ten_usage_ledger (user_id, kind, request_id, usd) values ($1,'call',$2,5)", [broke, "gen-broke-1"]);
  // keep today's beta-wide ceiling out of this: date the call yesterday
  await standIn.sql("update public.ten_usage_ledger set created_at = now() - interval '2 days' where request_id = 'gen-broke-1'");
  const p2 = await newPage();
  await signIn(p2.page, "broke@example.com");
  await p2.page.locator(".composer-input").waitFor({ timeout: 20000 });
  await p2.page.locator(".composer-input").fill("hello");
  await p2.page.locator(".composer-input").press("Enter");
  const err = await until(async () => ((await p2.page.locator(".card--error").count()) ? ((await p2.page.locator(".card--error").last().textContent()) ?? "") : undefined), 20000);
  rec(!!err && err.includes("over_balance") && err.includes(OVER_BALANCE), "§ 1.11 over_balance copy word for word", err ?? "");
  rec((await p2.page.locator(".card--error button, .card--error a").filter({ hasText: /buy|credit|paypal/i }).count()) === 0, "§ 17.2 the error card has no buy button or link (the pointer is copy only)");
  rec((await dialog(p2.page).count()) === 0 && sdkLoads.length === 1, "§ 17.2 an over_balance card opens no dialog and loads no SDK by itself");
  await p2.page.locator("button.balance-chip").click();
  rec((await dialog(p2.page).count()) === 1, "the chip the copy points to opens Buy credit");
  await p2.ctx.close();

  // ---- a non-member never sees any of it
  await standIn.createUser({ email: "outsider@example.com", member: false });
  const p3 = await newPage();
  const before = sdkLoads.length;
  await signIn(p3.page, "outsider@example.com");
  await p3.page.locator(".not-a-member-screen").waitFor({ timeout: 20000 });
  await p3.page.waitForTimeout(800);
  const body = (await p3.page.locator("body").textContent()) ?? "";
  rec(!/buy credit|paypal/i.test(body), "§ 1.11 a non-member sees no Buy credit / PayPal", body.slice(0, 200));
  rec((await p3.page.locator("button.balance-chip").count()) === 0 && (await dialog(p3.page).count()) === 0, "a non-member has no chip button and no dialog");
  rec(sdkLoads.length === before && p3.tenPaypal.length === 0, "a non-member's page loads no SDK and calls no ten-paypal");
  await p3.ctx.close();

  rec(external.length === 0, "no other non-loopback request left the browser", external.slice(0, 5).join(", "));
  rec(!denoLog.join("").includes("E2E-EXTERNAL-FETCH-REFUSED"), "the functions made no external call");
  rec(!denoLog.join("").includes(SECRET_DECOY), "function logs carry no client secret");
} finally {
  await browser.close();
  deno.kill();
  bridge.close();
  web.close();
  await standIn.close();
  if (!process.env.E2E_KEEP) rmSync(tmpRoot, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\npaypal-ui: ${results.length - failed.length} PASS, ${failed.length} FAIL`);
if (failed.length) {
  for (const f of failed) console.log(`  FAIL ${f.name}`);
  process.exitCode = 1;
}
