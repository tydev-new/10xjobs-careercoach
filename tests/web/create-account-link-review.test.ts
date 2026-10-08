// Independent review (tester, 2026-10-08) of the create link: design-web-ui.md
// § 1.4, "Amended 2026-10-08 (owner request): a link that opens Create an
// account", proof items 1-11. Written from the doc, not the code.
//
// What runs: the REAL production build of apps/web with the REAL
// @supabase/supabase-js, in headless Chromium, against the repo's local
// stand-in (tests/e2e-real/stand-in.ts: GoTrue + PostgREST over PGlite) and a
// tiny functions server in this file (it answers ten-delete-account with a
// success, so the client's "after an account deletion" path can be walked;
// everything else 404). Nothing leaves 127.0.0.1.
//
// The accepted and rejected addresses, the redirect cases and every expected
// string are READ FROM THE DOC at run time.
//
//   node --test tests/web/create-account-link-review.test.ts
//   REVIEW_SHOTS=<dir> ... also saves the 375px screenshot.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "../../apps/web/node_modules/playwright/index.mjs";
import { createAccountLinkFromUrl } from "../../apps/web/src/backend/auth.ts";
import { ANON_KEY, startStandIn, type StandIn } from "../e2e-real/stand-in.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const UI = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");
const SHOTS = process.env.REVIEW_SHOTS;
const PASSWORD = "correct horse battery"; // the stand-in's password for every account it makes

// ------------------------------------------------------------ the doc
function row(id: string): string {
  const line = UI.split("\n").find((l) => l.startsWith(`| ${id} |`));
  assert.ok(line, `no row ${id} in § 5.3.1`);
  const cell = line.replace(/^\| /, "").replace(/ \|$/, "").split(" | ")[3];
  assert.ok(cell.startsWith("`") && cell.endsWith("`"), `${id}: not one backticked string`);
  return cell.slice(1, -1);
}
const IDS = ["Y6", "Y7", "Y8", "Y9", "Y11", "Y20", "Y24", "Y27", "O1", "O5", "O7", "S9"] as const;
const Y = Object.fromEntries(IDS.map((id) => [id, row(id)])) as Record<(typeof IDS)[number], string>;

const AMEND = (() => {
  const a = UI.indexOf("**Amended 2026-10-08 (owner request): a link that opens Create an");
  const b = UI.indexOf("### 1.5", a);
  assert.ok(a > 0 && b > a, "the 2026-10-08 amendment was not found in § 1.4");
  return UI.slice(a, b).replace(/\s+/g, " ");
})();
/** the backticked addresses (each starts with `/`) of one numbered proof item */
function itemAddresses(n: number, upTo?: string): string[] {
  const a = AMEND.indexOf(` ${n}. **`);
  const b = AMEND.indexOf(` ${n + 1}. **`, a);
  assert.ok(a > 0 && b > a, `proof item ${n} not found`);
  let text = AMEND.slice(a, b);
  if (upTo) text = text.slice(0, text.indexOf(upTo));
  return [...text.matchAll(/`(\/[^`]*)`/g)].map((m) => m[1]);
}
const ACCEPTED = itemAddresses(1);
const REJECTED = itemAddresses(2, "`/signup` is not served"); // `/signup` is the host's concern, the doc says
const FN_NO = itemAddresses(3); // item 3's extra "no" addresses (each carries a Supabase redirect)
const RETIRED = (() => {
  const start = UI.indexOf("6. **Not in the bundle, and not on any rendered sign-in state**");
  const end = UI.indexOf("The check ignores", start);
  return [...UI.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, " ")).filter((s) => s.length > 3);
})();
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// ------------------------------------------------------------ servers, build, browser
let standIn: StandIn;
let fn: Server;
let site: Server;
let ORIGIN = "";
let browser: Browser;
let dist = "";
const fnLog: { method: string; url: string; headers: string; body: string }[] = [];
let n = 0;
const em = (who: string) => `clr.${who}.${++n}@example.com`;

before(async () => {
  standIn = await startStandIn();
  fn = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": String(req.headers["access-control-request-headers"] ?? "*"), "access-control-allow-methods": "GET, POST, OPTIONS" };
      if (req.method === "OPTIONS") return void res.writeHead(204, cors).end();
      fnLog.push({ method: req.method ?? "", url: req.url ?? "", headers: JSON.stringify(req.headers), body: Buffer.concat(chunks).toString("utf8") });
      if ((req.url ?? "").startsWith("/ten-delete-account") && req.method === "POST")
        return void res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ message: "deleted", deleted: { storageObjects: 0, textFiles: 0, gateLogRows: 0, conversationRows: 0 } }));
      res.writeHead(404, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ error: { message: "review functions server: no such function" } }));
    });
  });
  await new Promise<void>((r) => fn.listen(0, "127.0.0.1", r));
  standIn.setFunctionsTarget(`http://127.0.0.1:${(fn.address() as any).port}`);

  dist = mkdtempSync(path.join(tmpdir(), "ten-create-link-review-"));
  site = createServer((req, res) => {
    const p = decodeURIComponent(new URL((req.url ?? "/").replace(/^\/+/, "/"), "http://x").pathname);
    let file = path.join(dist, p === "/" ? "index.html" : p);
    if (!file.startsWith(dist) || !existsSync(file) || lstatSync(file).isDirectory()) file = path.join(dist, "index.html");
    const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  ORIGIN = `http://127.0.0.1:${(site.address() as any).port}`;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("VITE_") && v !== undefined) env[k] = v;
  Object.assign(env, { VITE_SUPABASE_URL: standIn.url, VITE_SUPABASE_ANON_KEY: ANON_KEY, VITE_SITE_URL: ORIGIN });
  const r = spawnSync(process.execPath, [path.join(WEB, "node_modules/vite/bin/vite.js"), "build", "--outDir", dist, "--emptyOutDir", "--logLevel", "error"], { cwd: WEB, encoding: "utf8", env });
  assert.equal(r.status, 0, `vite build failed:\n${r.stdout}\n${r.stderr}`);
  browser = await chromium.launch();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

after(async () => {
  await browser?.close();
  await new Promise<void>((r) => site?.close(() => r()));
  await new Promise<void>((r) => fn?.close(() => r()));
  await standIn?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

interface Opened {
  ctx: BrowserContext;
  page: Page;
  errors: string[];
  /** every request the context made that did not go to the site's own host */
  away: { url: string; headers: string; body: string }[];
  external: string[];
}
/** A fresh browser context. The init script records, at the start of every document: history.length,
 *  every pushState/replaceState, and whether a sign-in card ever entered the DOM. */
async function fresh(viewport = { width: 1280, height: 860 }): Promise<Opened> {
  const ctx = await browser.newContext({ viewport });
  const o: Opened = { ctx, page: undefined as any, errors: [], away: [], external: [] };
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1") return route.continue();
    o.external.push(u.href);
    return route.abort();
  });
  ctx.on("request", async (r) => {
    if (new URL(r.url()).origin === ORIGIN) return;
    o.away.push({ url: r.url(), headers: JSON.stringify(await r.allHeaders().catch(() => ({}))), body: r.postData() ?? "" });
  });
  await ctx.addInitScript(() => {
    const w = window as any;
    w.__h0 = history.length;
    w.__hist = [] as string[];
    w.__cards = [] as string[];
    for (const m of ["pushState", "replaceState"] as const) {
      const orig = history[m];
      history[m] = function (this: History, ...a: any[]) {
        w.__hist.push(`${m} ${String(a[2])}`);
        return (orig as any).apply(this, a);
      } as any;
    }
    const look = () => {
      const s = document.querySelector(".sign-in-card button[type=submit]");
      if (s) w.__cards.push((s.textContent ?? "").trim());
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
  });
  o.page = await ctx.newPage();
  o.page.on("pageerror", (e) => o.errors.push(e.message));
  return o;
}
async function visit(suffix: string, viewport?: { width: number; height: number }): Promise<Opened> {
  const o = await fresh(viewport);
  await o.page.goto(ORIGIN + suffix);
  return o;
}
const btn = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const emailBox = (page: Page) => page.locator(".sign-in-form input[type=email]");
const passBox = (page: Page) => page.locator(".sign-in-form input[type=password]");
const submit = (page: Page) => page.locator(".sign-in-form button[type=submit]");
/** which view the card is on, and where the address stands */
async function card(page: Page) {
  await page.locator(".sign-in-form").waitFor({ timeout: 15000 });
  return page.evaluate(() => ({
    submit: [...document.querySelectorAll(".sign-in-card button[type=submit]")].map((b) => (b.textContent ?? "").trim()),
    buttons: [...document.querySelectorAll(".sign-in-card button")].map((b) => (b.textContent ?? "").trim()),
    o5: (document.querySelector(".sign-in-invite")?.textContent ?? "").replace(/\s+/g, " ").trim(),
    o7: ((document.querySelector(".sign-in-terms") as HTMLElement | null)?.innerText ?? "").replace(/\s+/g, " ").trim(),
    text: document.body.innerText.replace(/\s+/g, " "),
    path: location.pathname,
    search: location.search,
    hash: location.hash,
    href: location.href,
  }));
}
async function signInAs(page: Page, email: string) {
  await emailBox(page).fill(email);
  await passBox(page).fill(PASSWORD);
  await submit(page).click();
}
async function signOut(page: Page) {
  await page.locator(".menu-trigger").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
}

// ============================================================ the tests

test("L0 the amendment's lists were read from the doc", () => {
  assert.deepEqual(ACCEPTED, ["/?signup", "/?signup=", "/?signup=1", "/?utm_source=x&signup&ref=y", "/?signup=0"]);
  assert.deepEqual(REJECTED, ["/", "/?Signup", "/?sign-up", "/?signup2", "/?create", "/?view=signup", "/#signup"]);
  assert.equal(FN_NO.length, 5, JSON.stringify(FN_NO));
  assert.equal(RETIRED.length, 10);
});

test("L3 proof 3: the pure function answers yes for item 1's addresses, no for item 2's and for item 3's five redirect addresses", () => {
  for (const base of ["https://ten-coach.vercel.app", "http://127.0.0.1:5173"]) {
    for (const a of ACCEPTED) assert.equal(createAccountLinkFromUrl(base + a), true, a);
    for (const a of [...REJECTED, "/signup", ...FN_NO]) assert.equal(createAccountLinkFromUrl(base + a), false, a);
  }
  // "anything after #, or a query key code, type, error, error_code, error_description or access_token": each alone
  for (const k of ["code", "type", "error", "error_code", "error_description", "access_token"]) {
    assert.equal(createAccountLinkFromUrl(`https://ten-coach.vercel.app/?signup&${k}=x`), false, k);
    assert.equal(createAccountLinkFromUrl(`https://ten-coach.vercel.app/?${k}&signup`), false, `${k} first, no value`);
    assert.equal(createAccountLinkFromUrl(`https://ten-coach.vercel.app/?signup#${k}=x`), false, `#${k}`);
  }
  assert.equal(createAccountLinkFromUrl("not an address"), false);
  assert.equal(createAccountLinkFromUrl(""), false);
});

test("L1 proof 1: signed out, every accepted address opens Create an account (`Create account`, Y9, O5, O7; no Y20, no Y27) with a plain address by the time the card shows; a reload opens Sign in", async () => {
  for (const a of ACCEPTED) {
    const o = await visit(a);
    try {
      const c = await card(o.page);
      assert.deepEqual(c.buttons, [Y.Y7, Y.Y9], `${a}: the card's buttons`);
      assert.equal(c.o5, Y.O5, a);
      assert.equal(c.o7, Y.O7, a);
      assert.ok(!c.text.includes(Y.Y20) && !c.text.includes(Y.Y27), `${a}: Y20 or Y27 shows`);
      assert.deepEqual({ path: c.path, search: c.search, hash: c.hash }, { path: "/", search: "", hash: "" }, `${a}: the address`);
      // the first view the card ever had: no Sign in view painted first
      assert.deepEqual([...new Set(await o.page.evaluate(() => (window as any).__cards as string[]))], [Y.Y7], `${a}: the card showed another view first`);
      const low = c.text.toLowerCase();
      assert.deepEqual(RETIRED.filter((s) => low.includes(s.toLowerCase())), [], `${a}: a retired string shows`);
      await o.page.reload();
      assert.deepEqual((await card(o.page)).buttons, [Y.Y20, Y.Y6, Y.Y8], `${a}: after a reload`);
      assert.deepEqual(o.errors, [], a);
    } finally {
      await o.ctx.close();
    }
  }
});

test("L2 proof 2: signed out, every rejected address opens the Sign in view and the address is unchanged; tags with no `signup` stay in the address bar", async () => {
  for (const a of [...REJECTED, "/?utm_source=x&ref=y"]) {
    const o = await visit(a);
    try {
      const c = await card(o.page);
      await o.page.waitForTimeout(250);
      assert.deepEqual(c.buttons, [Y.Y20, Y.Y6, Y.Y8], `${a}: the card's buttons`);
      assert.equal(await o.page.evaluate(() => location.pathname + location.search + location.hash), a, `${a}: the address changed`);
      assert.deepEqual(await o.page.evaluate(() => (window as any).__hist), [], `${a}: the history was written`);
    } finally {
      await o.ctx.close();
    }
  }
});

// Spellings the doc's lists do not name. `want` is what the doc's RULE says ("a key spelled exactly `signup`,
// lower case ... value not read ... any position"; no when "anything after #"); null = the doc does not settle it.
const EDGE: { addr: string; want: "create" | "sign-in" | null; why: string }[] = [
  { addr: "/?signup&signup", want: "create", why: "the key is there (twice)" },
  { addr: "/?SIGNUP", want: "sign-in", why: "another case" },
  { addr: "/?%73ignup", want: null, why: "percent-encoded key: 'spelled exactly' is not defined for an encoded key" },
  { addr: "/?%20signup", want: "sign-in", why: "the key is ' signup', another spelling" },
  { addr: "/? signup", want: "sign-in", why: "the same, as typed" },
  { addr: "/?signup%20", want: "sign-in", why: "the key is 'signup ', another spelling" },
  { addr: "/?signup#", want: null, why: "an empty '#': nothing is 'after #', but the doc's lists do not show it" },
  { addr: "/?signup=1#", want: null, why: "the same with a value" },
  { addr: "/?signup&", want: "create", why: "a trailing & adds no key" },
  { addr: "/?&signup", want: "create", why: "a leading & adds no key" },
  { addr: "/?signup=1&signup=2", want: "create", why: "the value is not read" },
  { addr: "/index.html?signup", want: "create", why: "the query has the key; the path is the host's index page" },
  { addr: "//", want: "sign-in", why: "the control for the next one: the same path without the key" },
  { addr: "//?signup", want: null, why: "a doubled slash path: the doc names only the site address" },
  { addr: "/?signup;x", want: "sign-in", why: "the key is 'signup;x'" },
  { addr: "/?signup[]", want: "sign-in", why: "the key is 'signup[]'" },
  { addr: "/?x=?signup", want: "sign-in", why: "the word inside a value" },
];
for (const e of EDGE) {
  test(`L3b edge: "${e.addr}" (${e.why})`, async (t) => {
    const o = await visit(e.addr);
    try {
      const shown = await o.page.locator(".sign-in-form").waitFor({ timeout: 8000 }).then(() => true, () => false);
      await o.page.waitForTimeout(250);
      const got = shown ? ((await submit(o.page).textContent())?.trim() === Y.Y7 ? "create" : "sign-in") : "NO CARD";
      const href = (await o.page.evaluate(() => location.href)).slice(ORIGIN.length);
      const hist = await o.page.evaluate(() => (window as any).__hist as string[]);
      const line = `EDGE ${JSON.stringify(e.addr)} -> ${got}; address now ${JSON.stringify(href)}; history ${JSON.stringify(hist)}; page errors ${JSON.stringify(o.errors)}; the doc ${e.want ? `says ${e.want}` : "does not settle it"}`;
      t.diagnostic(line);
      console.log("  " + line);
      assert.notEqual(got, "NO CARD", "no sign-in card rendered");
      assert.deepEqual(o.errors, [], "the page threw");
      if (e.want) assert.equal(got, e.want);
      if (got === "create") assert.ok(!href.includes("signup"), `opened Create but the address keeps the key: ${href}`);
      else assert.equal(hist.length, 0, "opened Sign in but the address was rewritten");
    } finally {
      await o.ctx.close();
    }
  });
}

test("L4 proof 4: signed in as a member, `/?signup` shows the workspace and the card never enters the page; the address ends plain; sign out shows Sign in; and the yes is used once: sign in and out again, then delete the account, all in one tab, never Create", async () => {
  const member = em("member");
  await standIn.createUser({ email: member });
  const o = await visit("/");
  try {
    await card(o.page);
    await signInAs(o.page, member);
    await o.page.locator(".composer-input").waitFor({ timeout: 20000 });
    await o.page.goto(ORIGIN + "/?signup&utm_source=x");
    await o.page.locator(".composer-input").waitFor({ timeout: 20000 });
    await o.page.waitForTimeout(400);
    assert.deepEqual(await o.page.evaluate(() => (window as any).__cards), [], "a sign-in card was in the page before the workspace");
    assert.equal(await o.page.evaluate(() => location.pathname + location.search + location.hash), "/", "the address");
    assert.equal(await o.page.evaluate(() => history.length - (window as any).__h0), 0, "a history entry was added");
    await signOut(o.page);
    assert.deepEqual((await card(o.page)).buttons, [Y.Y20, Y.Y6, Y.Y8], "after the first sign-out");
    // again, same tab, no reload
    await signInAs(o.page, member);
    await o.page.locator(".composer-input").waitFor({ timeout: 20000 });
    await signOut(o.page);
    assert.deepEqual((await card(o.page)).buttons, [Y.Y20, Y.Y6, Y.Y8], "after the second sign-out");
    // an account deletion later in the same tab
    await signInAs(o.page, member);
    await o.page.locator(".composer-input").waitFor({ timeout: 20000 });
    await o.page.locator(".menu-trigger").click();
    await o.page.getByRole("menuitem", { name: "Delete my beta data" }).click();
    const input = o.page.locator(".delete-confirm-card input[type=text]");
    await input.fill("yes");
    await input.press("Enter");
    await o.page.getByText("Deleted. You're signed out of Ten").waitFor({ timeout: 15000 });
    assert.equal((await submit(o.page).textContent())?.trim(), Y.Y6, "under the deleted notice");
    await btn(o.page, "OK").click();
    await o.page.waitForTimeout(200);
    assert.deepEqual((await card(o.page)).buttons, [Y.Y20, Y.Y6, Y.Y8], "after the deletion");
    assert.ok(!(await o.page.evaluate(() => (window as any).__cards as string[])).includes(Y.Y7), "Create an account showed at some point in this tab");
    assert.deepEqual(o.errors, []);
  } finally {
    await o.ctx.close();
  }
});

test("L4b used once, from a create-link start: Y9, sign in, sign out in the same tab shows Sign in, not Create; the same after a deletion", async () => {
  const member = em("member");
  await standIn.createUser({ email: member });
  const o = await visit("/?signup");
  try {
    assert.deepEqual((await card(o.page)).buttons, [Y.Y7, Y.Y9]);
    await btn(o.page, Y.Y9).click();
    await signInAs(o.page, member);
    await o.page.locator(".composer-input").waitFor({ timeout: 20000 });
    await signOut(o.page);
    assert.deepEqual((await card(o.page)).buttons, [Y.Y20, Y.Y6, Y.Y8], "after sign-out");
    await signInAs(o.page, member);
    await o.page.locator(".composer-input").waitFor({ timeout: 20000 });
    await o.page.locator(".menu-trigger").click();
    await o.page.getByRole("menuitem", { name: "Delete my beta data" }).click();
    const input = o.page.locator(".delete-confirm-card input[type=text]");
    await input.fill("yes");
    await input.press("Enter");
    await o.page.getByText("Deleted. You're signed out of Ten").waitFor({ timeout: 15000 });
    await btn(o.page, "OK").click();
    await o.page.waitForTimeout(200);
    assert.deepEqual((await card(o.page)).buttons, [Y.Y20, Y.Y6, Y.Y8], "after the deletion");
  } finally {
    await o.ctx.close();
  }
});

test("L4c signed in as a non-member (the claim refused), `/?signup` shows the not-a-member screen, never the card; the address ends plain; sign out shows Sign in", async () => {
  const who = em("nonmember");
  await standIn.createUser({ email: who, member: false });
  await standIn.sql("update public.ten_welcome_settings set cap = 0");
  const o = await visit("/");
  try {
    await card(o.page);
    await signInAs(o.page, who);
    await btn(o.page, "Sign out").waitFor({ timeout: 20000 });
    await o.page.goto(ORIGIN + "/?signup");
    await btn(o.page, "Sign out").waitFor({ timeout: 20000 });
    await o.page.waitForTimeout(300);
    assert.deepEqual(await o.page.evaluate(() => (window as any).__cards), [], "a sign-in card was in the page");
    assert.equal(await o.page.evaluate(() => location.pathname + location.search), "/");
    await btn(o.page, "Sign out").click();
    assert.deepEqual((await card(o.page)).buttons, [Y.Y20, Y.Y6, Y.Y8]);
  } finally {
    await o.ctx.close();
  }
});

test("L5 proof 5: a redirect wins. `?signup&error_code=otp_expired` shows Y27 above Sign in; `?signup#…type=recovery` shows 'Choose a new password'; `?signup#…type=signup` signs in through the real supabase-js (so nothing it needed was stripped) and runs the membership check", async (t) => {
  // an error, in the query and in the hash
  for (const a of ["/?signup&error=access_denied&error_code=otp_expired&error_description=x", "/?signup#error=access_denied&error_code=otp_expired&error_description=x"]) {
    const o = await visit(a);
    try {
      await o.page.getByText(Y.Y27, { exact: true }).waitFor({ timeout: 15000 });
      const c = await card(o.page);
      assert.deepEqual(c.buttons, [Y.Y20, Y.Y6, Y.Y8], a);
      assert.ok(!/error/.test(c.href.slice(ORIGIN.length)), `${a}: the address keeps the error: ${c.href}`);
      t.diagnostic(`after ${a} the address is ${c.href.slice(ORIGIN.length)}`);
      console.log(`  [L5] after ${a} the address is ${JSON.stringify(c.href.slice(ORIGIN.length))}`);
    } finally {
      await o.ctx.close();
    }
  }
  const who = em("redirect");
  await standIn.createUser({ email: who });
  const r = await visit("/?signup" + standIn.pw.recoveryHash(who));
  try {
    await r.page.getByRole("heading", { name: "Choose a new password" }).waitFor({ timeout: 20000 });
    const seen = await r.page.evaluate(() => (window as any).__cards as string[]);
    assert.ok(!seen.includes(Y.Y6) && !seen.includes(Y.Y7), `the Sign in or Create card showed on the way to the recovery screen: ${seen}`);
  } finally {
    await r.ctx.close();
  }
  const t0 = Date.now();
  const s = await visit("/?signup" + standIn.pw.recoveryHash(who).replace("type=recovery", "type=signup"));
  try {
    await s.page.locator(".composer-input").waitFor({ timeout: 20000 });
    assert.ok(standIn.log.filter((l) => l.at >= t0 && l.path === "/rest/v1/rpc/ten_is_member").length >= 1, "the membership check ran");
    assert.deepEqual(await s.page.evaluate(() => (window as any).__cards), [], "a sign-in card showed on the way in");
    const stored = await s.page.evaluate(() => Object.keys(localStorage).filter((k) => /auth-token/.test(k)).length);
    assert.equal(stored, 1, "supabase-js saved the session from the address");
    const where = await s.page.evaluate(() => location.pathname + location.search + location.hash);
    assert.ok(!where.includes("access_token"), `the token stays in the address: ${where}`);
    console.log(`  [L5] after a confirmation link with ?signup, signed in, the address is ${JSON.stringify(where)}`);
    // then: sign out in the same tab shows Sign in (the yes was never taken: a redirect was on the address)
    await signOut(s.page);
    assert.deepEqual((await card(s.page)).buttons, [Y.Y20, Y.Y6, Y.Y8]);
  } finally {
    await s.ctx.close();
  }
  // a code in the query (the PKCE return): signup is not taken, nothing is rewritten
  const p = await visit("/?signup&code=abc");
  try {
    const c = await card(p.page);
    await p.page.waitForTimeout(250);
    assert.deepEqual(c.buttons, [Y.Y20, Y.Y6, Y.Y8]);
    assert.deepEqual(await p.page.evaluate(() => (window as any).__hist), [], "the address with a code was rewritten");
  } finally {
    await p.ctx.close();
  }
});

test("L6 proof 6: cleanup. After `/?utm_source=x&signup&ref=y`, when the card shows: search empty, path unchanged, history length unchanged, replaceState and never pushState; a reload opens Sign in; back and forward never bring Create back", async () => {
  const o = await fresh();
  try {
    await o.page.goto(ORIGIN + "/terms.html"); // a page before, so "back" has somewhere to go
    await o.page.goto(ORIGIN + "/?utm_source=x&signup&ref=y");
    await o.page.locator(".sign-in-form").waitFor({ timeout: 15000 });
    // read at the first moment the card exists
    const at = await o.page.evaluate(() => ({ search: location.search, path: location.pathname, hash: location.hash, added: history.length - (window as any).__h0, hist: (window as any).__hist as string[], view: document.querySelector(".sign-in-card button[type=submit]")?.textContent }));
    assert.deepEqual({ search: at.search, path: at.path, hash: at.hash }, { search: "", path: "/", hash: "" });
    assert.equal(at.added, 0, "history length changed");
    assert.ok(at.hist.length >= 1 && at.hist.every((h) => h === "replaceState /"), `history calls: ${JSON.stringify(at.hist)}`);
    assert.equal(at.view, Y.Y7);
    // forward to another page, then back: the entry is the plain address
    await o.page.goto(ORIGIN + "/privacy.html");
    await o.page.goBack();
    assert.deepEqual((await card(o.page)).buttons, [Y.Y20, Y.Y6, Y.Y8], "back to the cleaned entry");
    assert.equal(await o.page.evaluate(() => location.search), "");
    await o.page.goBack(); // terms.html
    await o.page.goForward();
    assert.deepEqual((await card(o.page)).buttons, [Y.Y20, Y.Y6, Y.Y8], "forward to the cleaned entry");
    await o.page.reload();
    assert.deepEqual((await card(o.page)).buttons, [Y.Y20, Y.Y6, Y.Y8], "a reload");
    assert.equal(await o.page.evaluate(() => location.pathname + location.search + location.hash), "/");
  } finally {
    await o.ctx.close();
  }
});

test("L7-L9 proofs 7, 8, 9 and the welcome claim: from `/?signup&utm_source=TAGMARK1&utm_campaign=TAGMARK2&ref=TAGMARK3`, Y9 and Y8 work, one sign-up goes out with the plain site as its return address, Y24 opens Sign in, the confirmation link signs in and the welcome credit is granted; no TAGMARK in any request away from the site's host, in storage, or in a cookie", async () => {
  const who = em("new");
  await standIn.sql("update public.ten_welcome_settings set cap = 1000");
  const o = await visit("/?signup&utm_source=TAGMARK1&utm_campaign=TAGMARK2&ref=TAGMARK3&utm_medium=TAGMARK4&utm_term=TAGMARK5&utm_content=TAGMARK6");
  const logFrom = standIn.log.length;
  const fnFrom = fnLog.length;
  try {
    assert.deepEqual((await card(o.page)).buttons, [Y.Y7, Y.Y9]);
    await emailBox(o.page).fill(who);
    await btn(o.page, Y.Y9).click();
    const c9 = await card(o.page);
    assert.deepEqual(c9.buttons, [Y.Y20, Y.Y6, Y.Y8], "Y9 opens Sign in with Y20");
    assert.equal(await emailBox(o.page).inputValue(), who, "the typed email is kept");
    await btn(o.page, Y.Y8).click();
    assert.deepEqual((await card(o.page)).buttons, [Y.Y7, Y.Y9], "Y8 returns to Create an account");
    const before = standIn.pw.signups.length;
    await passBox(o.page).fill("Correct-Horse-9");
    await submit(o.page).click();
    await btn(o.page, Y.Y24).waitFor({ timeout: 15000 });
    assert.deepEqual(standIn.pw.signups.slice(before), [{ email: who.toLowerCase(), redirectTo: ORIGIN }], "one sign-up, the place to return to is the site address with no query");
    assert.equal(norm((await o.page.locator(".sign-in-sent").textContent()) ?? ""), Y.Y11.replace("<email>", who));
    await btn(o.page, Y.Y24).click();
    assert.deepEqual((await card(o.page)).buttons, [Y.Y20, Y.Y6, Y.Y8], "Y24 opens Sign in");
    // the confirmation email's link: the plain site address with a session (the stand-in makes the account now)
    await standIn.createUser({ email: who, member: false });
    // opened as an email link opens: in a new tab of the same browser
    const tab = await o.ctx.newPage();
    tab.on("pageerror", (e) => o.errors.push(e.message));
    await tab.goto(ORIGIN + "/" + standIn.pw.recoveryHash(who).replace("type=recovery", "type=signup"));
    await tab.locator(".composer-input").waitFor({ timeout: 20000 });
    const o1 = new RegExp("^" + Y.O1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\$<amount>", "\\$\\d+\\.\\d\\d") + "$");
    await tab.getByText(o1).waitFor({ timeout: 15000 });
    await tab.waitForTimeout(600);
    // ---- the tags
    assert.ok(o.away.length >= 5, `requests away from the site's host were recorded: ${o.away.length}`);
    const hits = o.away.filter((r) => `${r.url}\n${r.headers}\n${r.body}`.includes("TAGMARK"));
    assert.deepEqual(hits.map((r) => r.url), [], "TAGMARK in a request's address, headers or body");
    const inLog = standIn.log.slice(logFrom).filter((l) => JSON.stringify(l).includes("TAGMARK"));
    assert.deepEqual(inLog.map((l) => l.path), [], "TAGMARK in the stand-in's own log");
    assert.deepEqual(fnLog.slice(fnFrom).filter((l) => JSON.stringify(l).includes("TAGMARK")).map((l) => l.url), [], "TAGMARK reached the functions server");
    const keep = () => JSON.stringify({ ls: { ...localStorage }, ss: { ...sessionStorage }, cookie: document.cookie, href: location.href, name: window.name, state: history.state });
    const kept = (await o.page.evaluate(keep)) + (await tab.evaluate(keep));
    assert.ok(/auth-token/.test(kept), "the storage read is live: the session is in it");
    assert.ok(!kept.includes("TAGMARK"), `TAGMARK kept in the page: ${kept.slice(0, 300)}`);
    assert.deepEqual((await o.ctx.cookies()).filter((c) => JSON.stringify(c).includes("TAGMARK")), []);
    assert.deepEqual(o.external, [], "a request left 127.0.0.1");
    assert.deepEqual(o.errors, []);
  } finally {
    await o.ctx.close();
    await standIn.sql("update public.ten_welcome_settings set cap = 0");
  }
});

test("L7b proof 7 (source): outside tests, `utm_` appears nowhere under apps/web/src, `ref` is never asked of the address, document.referrer is never read, and the only readers of the page address are the two pure functions' callers", () => {
  const hits: string[] = [];
  const readers: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const a = path.join(d, name);
      if (statSync(a).isDirectory()) walk(a);
      else if (/\.(ts|tsx|js|jsx|mjs|html)$/.test(name) && !/\.test\./.test(name)) {
        readFileSync(a, "utf8").split("\n").forEach((l, i) => {
          const at = `${path.relative(REPO, a)}:${i + 1}: ${l.trim().slice(0, 110)}`;
          if (/utm_|(get|getAll|has)\(\s*["'`]ref["'`]\s*\)|[?&]ref=|\.ref\b.*location|document\.referrer/.test(l)) hits.push(at);
          if (/location\.(search|href|hash)/.test(l) && !/^\s*(\*|\/\/|\/\*)/.test(l)) readers.push(`${path.relative(REPO, a)}: ${l.trim().slice(0, 110)}`);
        });
      }
    }
  };
  walk(path.join(WEB, "src"));
  assert.deepEqual(hits, []);
  console.log("  [L7b] code that reads the page address:\n    " + readers.join("\n    "));
  // RealApp's two reads (the redirect, the create link) and the dev preview's (mock controls only)
  for (const r of readers) assert.ok(/real\/RealApp\.tsx|src\/main\.tsx|src\/dev-preview\.tsx/.test(r), `an unexpected reader of the address: ${r}`);
});

test("L10 proof 10, 375px: the card the create link opens is, element for element, the card Y8 opens; no horizontal scroll; every field, button and link at least 44px tall; light palette", async () => {
  const phone = { width: 375, height: 812 };
  const canon = (page: Page): Promise<string> =>
    page.evaluate(() => {
      const walk = (x: Node): string =>
        x.nodeType === 3
          ? (x.textContent ?? "")
          : x.nodeType === 1
            ? `<${(x as Element).tagName.toLowerCase()} ${[...(x as Element).attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort().join(" ")}>${[...x.childNodes].map(walk).join("")}</>`
            : "";
      const boxes = [...document.querySelectorAll(".sign-in-card *")].map((e) => {
        const b = e.getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)].join(",");
      });
      return walk(document.querySelector(".app-root")!) + "\n" + boxes.join(" ");
    });
  const a = await visit("/?signup", phone);
  const b = await visit("/", phone);
  try {
    await card(a.page);
    await card(b.page);
    await btn(b.page, Y.Y8).click();
    await btn(b.page, Y.Y7).waitFor();
    const [viaLink, viaY8] = [await canon(a.page), await canon(b.page)];
    assert.equal(viaLink, viaY8, "the two cards differ (markup, attributes or boxes)");
    assert.ok(viaLink.length > 500);
    const fit = await a.page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      W: window.innerWidth,
      theme: document.querySelector("[data-theme]")?.getAttribute("data-theme"),
      small: [...document.querySelectorAll(".sign-in-card button, .sign-in-card input, .sign-in-card a")].filter((e) => e.getBoundingClientRect().height < 44).map((e) => (e.textContent ?? "").trim()),
      focus: document.activeElement?.tagName,
    }));
    assert.ok(fit.scrollW <= fit.W, `horizontal scroll: ${fit.scrollW} > ${fit.W}`);
    assert.deepEqual(fit.small, []);
    assert.equal(fit.theme, "light");
    if (SHOTS) await a.page.screenshot({ path: path.join(SHOTS, "375-create-link.png"), fullPage: true });
  } finally {
    await a.ctx.close();
    await b.ctx.close();
  }
});

test("L12 regressions: `/` opens Sign in with nothing written to the history; an expired link shows Y27 and loses the error; a recovery link shows 'Choose a new password'; a wrong password from a create-link start still shows its line on Sign in only", async () => {
  const p = await visit("/");
  try {
    assert.deepEqual((await card(p.page)).buttons, [Y.Y20, Y.Y6, Y.Y8]);
    assert.deepEqual(await p.page.evaluate(() => (window as any).__hist), []);
  } finally {
    await p.ctx.close();
  }
  const x = await visit("/#error=access_denied&error_code=otp_expired&error_description=x");
  try {
    await x.page.getByText(Y.Y27, { exact: true }).waitFor({ timeout: 15000 });
    await x.page.waitForTimeout(250);
    assert.equal(await x.page.evaluate(() => location.pathname + location.search + location.hash), "/");
    assert.deepEqual((await card(x.page)).buttons, [Y.Y20, Y.Y6, Y.Y8]);
  } finally {
    await x.ctx.close();
  }
  const who = em("recover");
  await standIn.createUser({ email: who });
  const r = await visit("/" + standIn.pw.recoveryHash(who));
  try {
    await r.page.getByRole("heading", { name: "Choose a new password" }).waitFor({ timeout: 20000 });
  } finally {
    await r.ctx.close();
  }
});

test("L11 proof 11, last: over this whole file the stand-in got no request for a sign-in link", () => {
  const otp = standIn.log.filter((l) => /\/otp$|\/magiclink$/.test(l.path));
  assert.deepEqual(otp.map((l) => `${l.method} ${l.path}`), []);
  assert.ok(standIn.log.length > 60, `the log is live: ${standIn.log.length}`);
  console.log(`  [L11] the stand-in log holds ${standIn.log.length} requests; auth paths: ${[...new Set(standIn.log.filter((l) => l.path.startsWith("/auth/")).map((l) => `${l.method} ${l.path}`))].sort().join(", ")}`);
});
