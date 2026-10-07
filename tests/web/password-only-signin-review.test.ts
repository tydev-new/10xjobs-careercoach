// Independent review (tester, 2026-10-07) of "one way to sign in, email and
// password": design-web-ui.md § 1.4's 2026-10-07 amendment ("Proved by" items
// 1-12) and design-web-agent.md § 16.5. Written from the docs, not the code.
//
// What is different from the builder's own tests:
//   - The REAL production build of apps/web with the REAL @supabase/supabase-js
//     (no alias), in headless Chromium, against a small auth server in this
//     file whose answers this file controls. So the sign-in errors travel the
//     whole way: HTTP answer -> supabase-js's own error parsing -> the card.
//   - The same wrong-password answer is sent in every shape an Auth server has
//     used (R4b), to see whether Y12 / Y13 depend on one response shape.
//   - Every request the page makes to the auth server is logged; the run ends
//     by checking none went to /otp or /magiclink, and which paths were used.
//
// Every expected string is read from docs/design-web-ui.md at run time.
// Nothing here touches a network beyond 127.0.0.1.
//
//   node --test tests/web/password-only-signin-review.test.ts
//   REVIEW_SHOTS=<dir> ... also saves the 375px screenshots.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "../../apps/web/node_modules/playwright/index.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const UI = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");
const SHOTS = process.env.REVIEW_SHOTS;

// ------------------------------------------------------------ the doc's copy
/** The `String` cell of a § 5.3.1 row, without its backticks. */
function row(id: string): string {
  const line = UI.split("\n").find((l) => l.startsWith(`| ${id} |`));
  assert.ok(line, `no row ${id} in § 5.3.1`);
  const cell = line.replace(/^\| /, "").replace(/ \|$/, "").split(" | ")[3];
  assert.ok(cell.startsWith("`") && cell.endsWith("`"), `${id}: the String cell is not one backticked string: ${cell}`);
  return cell.slice(1, -1);
}
const IDS = ["Y4", "Y5", "Y6", "Y7", "Y8", "Y9", "Y11", "Y12", "Y13", "Y20", "Y24", "Y25", "Y27", "S9", "O5", "O7"] as const;
const Y = Object.fromEntries(IDS.map((id) => [id, row(id)])) as Record<(typeof IDS)[number], string>;

/** Proof 6's list, read from § 1.4's own item 6. */
const RETIRED = (() => {
  const start = UI.indexOf("6. **Not in the bundle, and not on any rendered sign-in state**");
  const end = UI.indexOf("The check ignores", start);
  assert.ok(start > 0 && end > start, "proof item 6 not found in § 1.4");
  return [...UI.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, " ")).filter((s) => s.length > 3);
})();

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// ------------------------------------------------------------ the auth server
type Shape =
  | "v2024" // header x-supabase-api-version: 2024-01-01 (exposed), body { code, message }
  | "v2024-header-not-exposed" // the same, but CORS does not expose the header to the page
  | "code-no-header" // body { code, message }, no version header
  | "legacy-error_code" // no header, body { code: 400, error_code, msg } (the pre-2024 body)
  | "main-stand-in" // what tests/e2e-real/stand-in.ts answered on origin/main: no header, { error, error_description, code, msg }
  | "oauth-only" // no header, body { error: "invalid_grant", error_description } (no machine code at all)
  | "message-only"; // no header, body { message } only
const RAW = { invalid_credentials: "Invalid login credentials", email_not_confirmed: "Email not confirmed" } as const;
type Kind = keyof typeof RAW;

const auth = {
  shape: "v2024" as Shape,
  kind: "invalid_credentials" as Kind,
  recover: "ok" as "ok" | "429",
  log: [] as { method: string; path: string; search: string; body: string }[],
};
let authServer: Server;
let authUrl = "";

function startAuth(): Promise<void> {
  authServer = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const cors: Record<string, string> = {
        "access-control-allow-origin": "*",
        "access-control-expose-headers": auth.shape === "v2024-header-not-exposed" ? "content-length" : "content-length, x-supabase-api-version",
      };
      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...cors, "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": String(req.headers["access-control-request-headers"] ?? "*"), "access-control-max-age": "0" }).end();
        return;
      }
      auth.log.push({ method: req.method ?? "", path: u.pathname, search: u.search, body });
      const send = (status: number, json: unknown, extra: Record<string, string> = {}) => res.writeHead(status, { ...cors, "content-type": "application/json", ...extra }).end(JSON.stringify(json));
      const v2024 = { "x-supabase-api-version": "2024-01-01" };
      if (u.pathname === "/auth/v1/token" && req.method === "POST") {
        const code = auth.kind;
        const message = RAW[code];
        switch (auth.shape) {
          case "v2024":
          case "v2024-header-not-exposed":
            return send(400, { code, message }, v2024);
          case "code-no-header":
            return send(400, { code, message });
          case "legacy-error_code":
            return send(400, { code: 400, error_code: code, msg: message });
          case "main-stand-in":
            return send(400, { error: "invalid_grant", error_description: message, code, msg: message });
          case "oauth-only":
            return send(400, { error: "invalid_grant", error_description: message });
          case "message-only":
            return send(400, { message });
        }
      }
      if (u.pathname === "/auth/v1/signup" && req.method === "POST") {
        const email = String(JSON.parse(body || "{}").email ?? "");
        return send(200, { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "", email, phone: "", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [] });
      }
      if (u.pathname === "/auth/v1/recover" && req.method === "POST") {
        if (auth.recover === "429") return send(429, { code: "over_email_send_rate_limit", message: "email rate limit exceeded" }, v2024);
        return send(200, {});
      }
      return send(404, { code: "not_found", message: `no route ${req.method} ${u.pathname}` }, v2024);
    });
  });
  return new Promise((r) => authServer.listen(0, "127.0.0.1", () => ((authUrl = `http://127.0.0.1:${(authServer.address() as any).port}`), r())));
}

// ------------------------------------------------------------ build + serve the real app
let site: Server;
let ORIGIN = "";
let browser: Browser;
let dist = "";
let BUNDLE = "";
const external: string[] = [];

before(async () => {
  await startAuth();
  dist = mkdtempSync(path.join(tmpdir(), "ten-signin-review-"));
  // the site's port must be known before the build (VITE_SITE_URL is inlined)
  site = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    let file = path.join(dist, p === "/" ? "index.html" : p);
    if (!file.startsWith(dist) || !existsSync(file) || lstatSync(file).isDirectory()) file = path.join(dist, "index.html");
    const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  ORIGIN = `http://127.0.0.1:${(site.address() as any).port}`;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("VITE_") && v !== undefined) env[k] = v;
  Object.assign(env, { VITE_SUPABASE_URL: authUrl, VITE_SUPABASE_ANON_KEY: "review-anon-key", VITE_SITE_URL: ORIGIN });
  const r = spawnSync(process.execPath, [path.join(WEB, "node_modules/vite/bin/vite.js"), "build", "--outDir", dist, "--emptyOutDir", "--logLevel", "error"], { cwd: WEB, encoding: "utf8", env });
  assert.equal(r.status, 0, `vite build failed:\n${r.stdout}\n${r.stderr}`);
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const a = path.join(d, n);
      if (statSync(a).isDirectory()) walk(a);
      else if (/\.(js|html|css)$/.test(n)) BUNDLE += readFileSync(a, "utf8") + "\n";
    }
  };
  walk(dist);
  browser = await chromium.launch();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

after(async () => {
  await browser?.close();
  await new Promise<void>((r) => site?.close(() => r()));
  await new Promise<void>((r) => authServer?.close(() => r()));
  if (dist) rmSync(dist, { recursive: true, force: true });
});

async function open(hash = "", viewport = { width: 1280, height: 860 }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1") return route.continue();
    external.push(u.href);
    return route.abort();
  });
  const page = await ctx.newPage();
  await page.goto(ORIGIN + "/" + hash);
  await page.locator(".sign-in-screen").waitFor({ timeout: 15000 });
  return { ctx, page };
}

/** everything a person could read or hear on the page: visible text, plus name-giving attributes */
const shown = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const attrs = [...document.querySelectorAll("*")].map((e) => ["aria-label", "title", "placeholder", "alt", "value"].map((a) => (e.tagName === "INPUT" && a === "value" ? "" : (e.getAttribute(a) ?? ""))).join(" "));
    return (document.body.innerText + " " + attrs.join(" ")).replace(/\s+/g, " ");
  });
async function noRetired(page: Page, where: string) {
  const t = (await shown(page)).toLowerCase();
  const hits = RETIRED.filter((s) => t.includes(s.toLowerCase()));
  assert.deepEqual(hits, [], `${where}: a retired string shows`);
}
const emailBox = (page: Page) => page.locator(".sign-in-form input[type=email]");
const passBox = (page: Page) => page.locator(".sign-in-form input[type=password]");
const submit = (page: Page) => page.locator(".sign-in-form button[type=submit]");
const btn = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** One wrong-password try; answers the text of the card's error line. */
async function tryWrongPassword(shape: Shape, kind: Kind): Promise<{ line: string; all: string }> {
  auth.shape = shape;
  auth.kind = kind;
  const { ctx, page } = await open();
  try {
    await emailBox(page).fill("someone@example.com");
    await passBox(page).fill("not-the-password");
    await submit(page).click();
    await page.locator(".sign-in-error").waitFor({ timeout: 15000 });
    return { line: norm((await page.locator(".sign-in-error").textContent()) ?? ""), all: await shown(page) };
  } finally {
    await ctx.close();
    auth.shape = "v2024";
    auth.kind = "invalid_credentials";
  }
}

// ============================================================ the tests

test("R0 the rows and proof 6's list were read from the doc", () => {
  for (const id of IDS) assert.ok(Y[id].length >= 5, id);
  assert.equal(RETIRED.length, 10, JSON.stringify(RETIRED));
  assert.match(Y.Y11, /<email>/);
  assert.match(Y.Y25, /<email>/);
});

test("R1 proof 1: Sign in view on load: Email, Password, Y20, `Sign in`, Y8, O5, O7 with its two links, S9; ONE submit button on the page; no .sign-in-mode-toggle, no aria-pressed, no role=tab/switch/radio", async () => {
  const { ctx, page } = await open();
  try {
    const v = await page.evaluate(() => ({
      labels: [...document.querySelectorAll(".sign-in-form label")].map((l) => (l.firstChild?.textContent ?? "").trim()),
      inputs: [...document.querySelectorAll(".sign-in-card input")].map((i) => i.getAttribute("type")),
      submits: [...document.querySelectorAll("button[type=submit], input[type=submit], form button:not([type])")].map((b) => (b.textContent ?? "").trim()),
      cardButtons: [...document.querySelectorAll(".sign-in-card button")].map((b) => (b.textContent ?? "").trim()),
      toggles: document.querySelectorAll(".sign-in-mode-toggle").length,
      pressed: document.querySelectorAll(".sign-in-card [aria-pressed], .sign-in-card [aria-selected], .sign-in-card [role=tab], .sign-in-card [role=switch], .sign-in-card [role=radio], .sign-in-card input[type=radio], .sign-in-card input[type=checkbox], .sign-in-card select").length,
      o5: document.querySelector(".sign-in-invite")?.textContent ?? "",
      o7: (document.querySelector(".sign-in-terms") as HTMLElement | null)?.innerText ?? "",
      links: [...document.querySelectorAll(".sign-in-card a")].map((a) => [(a.textContent ?? "").trim(), a.getAttribute("href")]),
      s9: document.querySelector(".sign-in-local")?.textContent ?? "",
    }));
    assert.deepEqual(v.labels, [Y.Y4, Y.Y5]);
    assert.deepEqual(v.inputs, ["email", "password"]);
    assert.deepEqual(v.submits, [Y.Y6], "one submit button");
    // every button on the card, in order: the forgot link, the submit, the switch. Nothing else.
    assert.deepEqual(v.cardButtons, [Y.Y20, Y.Y6, Y.Y8]);
    assert.equal(v.toggles, 0, ".sign-in-mode-toggle");
    assert.equal(v.pressed, 0, "aria-pressed or another mode control on the card");
    assert.equal(norm(v.o5), Y.O5);
    assert.equal(norm(v.o7), Y.O7);
    assert.deepEqual(v.links, [["terms", "/terms.html"], ["privacy notice", "/privacy.html"]]);
    assert.equal(norm(v.s9), Y.S9);
    // "under the form": the form, then O5, O7, S9
    const tops = await page.evaluate(() => [".sign-in-form", ".sign-in-invite", ".sign-in-terms", ".sign-in-local"].map((s) => document.querySelector(s)!.getBoundingClientRect().top));
    assert.ok(tops.every((t, i) => i === 0 || t > tops[i - 1]), `form, O5, O7, S9 in order: ${tops}`);
    await noRetired(page, "Sign in view");
    assert.equal(auth.log.length, 0, `the signed-out page called the auth server on load: ${JSON.stringify(auth.log)}`);
  } finally {
    await ctx.close();
  }
});

test("R2 proof 2: Create an account view: `Create account`, Y9, O5, O7, S9; Y20 absent; the email is kept, the password and the old error are cleared, both ways", async () => {
  auth.shape = "v2024";
  auth.kind = "invalid_credentials";
  const { ctx, page } = await open();
  try {
    await emailBox(page).fill("kept@example.com");
    await passBox(page).fill("typed-on-sign-in");
    await submit(page).click();
    await page.locator(".sign-in-error").waitFor({ timeout: 15000 });
    await btn(page, Y.Y8).click();
    await btn(page, Y.Y7).waitFor();
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".sign-in-card button")].map((b) => (b.textContent ?? "").trim())), [Y.Y7, Y.Y9], "buttons on Create an account: the submit and Y9 only (no Y20)");
    assert.equal(await emailBox(page).inputValue(), "kept@example.com", "email kept");
    assert.equal(await passBox(page).inputValue(), "", "password cleared on the way to Create an account");
    assert.equal(await page.locator(".sign-in-error").count(), 0, "old error cleared on the way to Create an account");
    assert.ok(!(await shown(page)).includes(Y.Y12), "Y12 still readable on Create an account");
    assert.equal(await page.locator(".sign-in-card [aria-pressed], .sign-in-mode-toggle").count(), 0);
    assert.equal(norm((await page.locator(".sign-in-invite").textContent()) ?? ""), Y.O5);
    assert.equal(norm(await page.locator(".sign-in-terms").innerText()), Y.O7);
    assert.equal(norm((await page.locator(".sign-in-local").textContent()) ?? ""), Y.S9);
    await noRetired(page, "Create an account view");
    // and back: Y9
    await passBox(page).fill("typed-on-create");
    await btn(page, Y.Y9).click();
    await btn(page, Y.Y6).waitFor();
    assert.equal(await emailBox(page).inputValue(), "kept@example.com", "email kept going back");
    assert.equal(await passBox(page).inputValue(), "", "password cleared going back");
    assert.equal(await btn(page, Y.Y20).count(), 1, "Y20 back on Sign in");
  } finally {
    await ctx.close();
  }
});

test("R3 proof 3: `Create account` shows Y11 with the address, Y24 under it, then O5, O7 and S9; one POST /signup with redirect_to = the site; no token or otp request; Y24 returns with the email kept and the password empty", async () => {
  const { ctx, page } = await open();
  try {
    const before = auth.log.length;
    await btn(page, Y.Y8).click();
    await emailBox(page).fill("new.person@example.com");
    await passBox(page).fill("Correct-Horse-9");
    await submit(page).click();
    await btn(page, Y.Y24).waitFor({ timeout: 15000 });
    const reqs = auth.log.slice(before);
    assert.deepEqual(reqs.map((r) => `${r.method} ${r.path}`), ["POST /auth/v1/signup"]);
    assert.equal(new URLSearchParams(reqs[0].search).get("redirect_to"), ORIGIN, "the site address as the place to return to");
    assert.equal(norm((await page.locator(".sign-in-sent").textContent()) ?? ""), Y.Y11.replace("<email>", "new.person@example.com"));
    assert.equal(await page.locator(".sign-in-card form").count(), 0, "in place of the form");
    const tops = await page.evaluate(() => [".sign-in-sent", ".sign-in-link-button", ".sign-in-invite", ".sign-in-terms", ".sign-in-local"].map((s) => document.querySelector(s)?.getBoundingClientRect().top ?? -1));
    assert.ok(tops.every((t, i) => t >= 0 && (i === 0 || t > tops[i - 1])), `Y11, Y24, O5, O7, S9 in order: ${tops}`);
    assert.equal(norm((await page.locator(".sign-in-invite").textContent()) ?? ""), Y.O5);
    assert.equal(norm(await page.locator(".sign-in-terms").innerText()), Y.O7);
    assert.equal(norm((await page.locator(".sign-in-local").textContent()) ?? ""), Y.S9);
    await noRetired(page, "confirmation line");
    await btn(page, Y.Y24).click();
    await btn(page, Y.Y6).waitFor();
    assert.equal(await emailBox(page).inputValue(), "new.person@example.com", "email kept");
    assert.equal(await passBox(page).inputValue(), "", "the new password does not follow to the Sign in view");
    assert.equal(await page.locator(".sign-in-sent").count(), 0);
  } finally {
    await ctx.close();
  }
});

test("R4 proof 4, the shape Supabase answers supabase-js today (version header + code): invalid_credentials is Y12 and email_not_confirmed is Y13, through the real supabase-js; Supabase's message is not on the page", async () => {
  for (const kind of ["invalid_credentials", "email_not_confirmed"] as const) {
    const r = await tryWrongPassword("v2024", kind);
    assert.equal(r.line, kind === "invalid_credentials" ? Y.Y12 : Y.Y13, kind);
    assert.ok(!r.all.toLowerCase().includes(RAW[kind].toLowerCase()), `${kind}: Supabase's own message is on the page`);
    const t = r.all.toLowerCase();
    assert.deepEqual(RETIRED.filter((s) => t.includes(s.toLowerCase())), [], `${kind} error state`);
  }
});

// § 1.4: "Errors on this card come from § 5.3.1, never Supabase's own text ... Y12 and Y13 are how a
// locked-out person finds the way in." The map reads error.code only. These ask what a person sees when the
// same refusal arrives in another shape. Each is run and reported; see the reviewer's hand-back for the reading.
const OTHER_SHAPES: Shape[] = ["v2024-header-not-exposed", "code-no-header", "legacy-error_code", "main-stand-in", "oauth-only", "message-only"];
for (const shape of OTHER_SHAPES) {
  test(`R4b a wrong password answered in the shape "${shape}" still shows Y12 (and an unconfirmed email Y13), never Supabase's message`, { todo: shape === "legacy-error_code" ? false : 'FINDING (tester, 2026-10-07): in this shape the card shows Supabase\'s own words ("Invalid login credentials", "Email not confirmed"), because signInErrorText reads error.code alone and supabase-js sets it only from a readable 2024 version header or from error_code' }, async (t) => {
    const seen: string[] = [];
    let bad = 0;
    for (const kind of ["invalid_credentials", "email_not_confirmed"] as const) {
      const r = await tryWrongPassword(shape, kind);
      const want = kind === "invalid_credentials" ? Y.Y12 : Y.Y13;
      seen.push(`${kind} -> ${r.line === want ? (kind === "invalid_credentials" ? "Y12" : "Y13") : JSON.stringify(r.line)}`);
      if (r.line !== want) bad++;
    }
    t.diagnostic(`SHAPE ${shape}: ${seen.join("; ")}`);
    console.log(`  [R4b] ${shape}: ${seen.join("; ")}`);
    assert.equal(bad, 0, seen.join("; "));
  });
}

test("R8 proof 8: Y20 needs no mode click; has-account, no-account and 429 all render Y25 byte for byte; the reset uses POST /recover (never /otp) with redirect_to = the site; `Back to sign in` returns to the Sign in view; the card shows no Y27, O5, O7 or S9", async () => {
  const lines: string[] = [];
  const before = auth.log.length;
  for (const mode of ["ok", "ok", "429"] as const) {
    auth.recover = mode;
    const { ctx, page } = await open("#error=access_denied&error_code=otp_expired&error_description=x");
    try {
      await emailBox(page).fill("member@example.com");
      await btn(page, Y.Y20).click();
      await page.getByRole("heading", { name: "Reset your password" }).waitFor();
      const card = norm(await page.evaluate(() => document.body.innerText));
      for (const id of ["Y27", "O5", "O7", "S9"] as const) assert.ok(!card.includes(Y[id]), `${id} on the reset card`);
      await noRetired(page, "reset card");
      await page.getByRole("button", { name: "Send reset link" }).click();
      await page.locator(".sign-in-sent, .sign-in-error").waitFor({ timeout: 15000 });
      lines.push((await page.locator(".sign-in-card").innerText()) ?? "");
      await noRetired(page, "reset card, after sending");
      await btn(page, Y.Y24).click();
      await btn(page, Y.Y6).waitFor();
      assert.equal(await btn(page, Y.Y20).count(), 1, "back on the Sign in view");
    } finally {
      await ctx.close();
      auth.recover = "ok";
    }
  }
  assert.equal(lines[0], lines[1]);
  assert.equal(lines[0], lines[2], "the 429 answer reads differently from a success");
  assert.ok(norm(lines[0]).includes(Y.Y25.replace("<email>", "member@example.com")), `Y25 word for word: ${lines[0]}`);
  const reqs = auth.log.slice(before);
  assert.deepEqual([...new Set(reqs.map((r) => `${r.method} ${r.path}`))], ["POST /auth/v1/recover"], "the reset flow's only auth request");
  assert.equal(reqs.length, 3);
  for (const r of reqs) assert.equal(new URLSearchParams(r.search).get("redirect_to"), ORIGIN);
});

for (const where of ["#", "?"] as const) {
  test(`R9 proof 9: a page opened with error_code=otp_expired in the ${where === "#" ? "hash" : "query"} shows Y27 above the Sign in form, the address loses the error, and Y27 is absent on Create an account, the confirmation line and the reset card`, async () => {
    const { ctx, page } = await open(`${where}error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    try {
      await page.getByText(Y.Y27, { exact: true }).waitFor({ timeout: 15000 });
      await page.waitForTimeout(300);
      const href = await page.evaluate(() => location.href);
      assert.ok(!/error|otp_expired/.test(href.slice(ORIGIN.length)), `the address still carries the error: ${href}`);
      const pos = await page.evaluate((y27) => {
        const line = [...document.querySelectorAll(".sign-in-card *")].find((e) => e.children.length === 0 && (e.textContent ?? "").trim() === y27)!;
        return { line: line.getBoundingClientRect().bottom, form: document.querySelector(".sign-in-form")!.getBoundingClientRect().top };
      }, Y.Y27);
      assert.ok(pos.line <= pos.form, `Y27 above the form: ${JSON.stringify(pos)}`);
      await noRetired(page, "expired-link state");
      await btn(page, Y.Y8).click();
      await btn(page, Y.Y7).waitFor();
      assert.ok(!(await shown(page)).includes(Y.Y27), "Y27 on Create an account");
      await emailBox(page).fill("x@example.com");
      await passBox(page).fill("Correct-Horse-9");
      await submit(page).click();
      await btn(page, Y.Y24).waitFor({ timeout: 15000 });
      assert.ok(!(await shown(page)).includes(Y.Y27), "Y27 beside the confirmation line");
      await btn(page, Y.Y24).click();
      await btn(page, Y.Y20).click();
      await page.getByRole("heading", { name: "Reset your password" }).waitFor();
      assert.ok(!(await shown(page)).includes(Y.Y27), "Y27 on the reset card");
      await page.reload();
      await page.locator(".sign-in-screen").waitFor();
      await page.waitForTimeout(300);
      assert.ok(!(await shown(page)).includes(Y.Y27), "a reload repeats Y27");
    } finally {
      await ctx.close();
    }
  });
}

test("R11 proof 11, 375px: Sign in, Create an account, the confirmation line and the reset card have no horizontal scroll; every field, button and link is at least 44px tall; nothing on the card is cut off at the right edge; light palette", async () => {
  auth.shape = "v2024";
  const { ctx, page } = await open("", { width: 375, height: 812 });
  const problems: string[] = [];
  const check = async (state: string) => {
    const r = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      W: window.innerWidth,
      theme: document.querySelector("[data-theme]")?.getAttribute("data-theme") ?? null,
      controls: [...document.querySelectorAll(".sign-in-card button, .sign-in-card input, .sign-in-card a")].map((e) => {
        const b = e.getBoundingClientRect();
        return { name: (e.textContent || (e as HTMLInputElement).type).trim().slice(0, 40), h: Math.round(b.height * 10) / 10, left: Math.round(b.left), right: Math.round(b.right) };
      }),
      overflowing: [...document.querySelectorAll(".sign-in-card *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5 || e.getBoundingClientRect().left < -0.5).map((e) => `${e.tagName}.${e.className}`),
    }));
    if (r.scrollW > r.W || r.bodyScrollW > r.W) problems.push(`${state}: horizontal scroll (${r.scrollW}/${r.bodyScrollW} > ${r.W})`);
    for (const c of r.controls) if (c.h < 44) problems.push(`${state}: "${c.name}" is ${c.h}px tall`);
    if (r.overflowing.length) problems.push(`${state}: outside the screen: ${r.overflowing.join(", ")}`);
    if (r.theme !== "light") problems.push(`${state}: data-theme=${r.theme}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `375-${state.replace(/\W+/g, "-")}.png`), fullPage: true });
    return r.controls.map((c) => c.name);
  };
  try {
    assert.deepEqual(await check("1 sign in"), ["email", "password", Y.Y20, Y.Y6, Y.Y8, "terms", "privacy notice"]);
    // the Sign in view with Y27 above it and Y12 in it: the tallest the card gets
    await emailBox(page).fill("someone-with-a-very-long-address-indeed@a-long-domain-name.example.com");
    await passBox(page).fill("not-the-password");
    await submit(page).click();
    await page.locator(".sign-in-error").waitFor({ timeout: 15000 });
    await check("1b sign in with Y12");
    await btn(page, Y.Y8).click();
    await btn(page, Y.Y7).waitFor();
    assert.deepEqual(await check("2 create an account"), ["email", "password", Y.Y7, Y.Y9, "terms", "privacy notice"]);
    await passBox(page).fill("Correct-Horse-9");
    await submit(page).click();
    await btn(page, Y.Y24).waitFor({ timeout: 15000 });
    assert.deepEqual(await check("3 confirmation line"), [Y.Y24, "terms", "privacy notice"]);
    await btn(page, Y.Y24).click();
    await btn(page, Y.Y20).click();
    await page.getByRole("heading", { name: "Reset your password" }).waitFor();
    assert.deepEqual(await check("4 reset card"), ["email", "Send reset link", Y.Y24]);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await page.locator(".sign-in-sent").waitFor({ timeout: 15000 });
    await check("4b reset card with Y25");
  } finally {
    await ctx.close();
  }
  const x = await open("#error=access_denied&error_code=otp_expired&error_description=x", { width: 375, height: 812 });
  try {
    await x.page.getByText(Y.Y27, { exact: true }).waitFor();
    await check2(x.page);
  } finally {
    await x.ctx.close();
  }
  async function check2(p: Page) {
    const r = await p.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, W: window.innerWidth, small: [...document.querySelectorAll(".sign-in-card button, .sign-in-card input, .sign-in-card a")].filter((e) => e.getBoundingClientRect().height < 44).map((e) => (e.textContent ?? "").trim()) }));
    if (r.scrollW > r.W) problems.push(`5 expired link: horizontal scroll ${r.scrollW} > ${r.W}`);
    if (r.small.length) problems.push(`5 expired link: under 44px: ${r.small.join(", ")}`);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, "375-5-expired-link.png"), fullPage: true });
  }
  assert.deepEqual(problems, []);
});

test("R5 proof 5 and 6 (bundle): Y12, Y13, Y27, Y20, Y8, Y9 and O5 are whole literals; none of the ten retired strings is in the built JS, HTML or CSS, ignoring case", () => {
  const forms = (s: string) => [s, s.replace(/'/g, "\\'"), s.replace(/'/g, "’"), JSON.stringify(s).slice(1, -1)];
  for (const id of ["Y12", "Y13", "Y27", "Y20", "Y8", "Y9", "O5"] as const) assert.ok(forms(Y[id]).some((v) => BUNDLE.includes(v)), `${id} is not one whole literal in the bundle`);
  const low = BUNDLE.toLowerCase();
  assert.deepEqual(RETIRED.filter((s) => forms(s.toLowerCase()).some((v) => low.includes(v))), []);
});

test("R7 proof 7 (source): no signInWithOtp, signInWithMagicLink, verifyOtp, signInWithOAuth, signInWithIdToken or signInWithSSO anywhere under apps/web/src; nothing there builds an /otp or /magiclink address; the only auth methods called are the card's three plus the session and password ones", () => {
  const banned = /signInWithOtp|signInWithMagicLink|verifyOtp|signInWithOAuth|signInWithIdToken|signInWithSSO|signInAnonymously|\/otp\b|\/magiclink\b/;
  const hits: string[] = [];
  const called = new Set<string>();
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const a = path.join(d, n);
      if (statSync(a).isDirectory()) walk(a);
      else if (/\.(ts|tsx|js|jsx|mjs|html|css|json)$/.test(n)) {
        const s = readFileSync(a, "utf8");
        s.split("\n").forEach((l, i) => banned.test(l) && hits.push(`${path.relative(REPO, a)}:${i + 1}: ${l.trim().slice(0, 120)}`));
        if (!/\.test\./.test(n)) for (const m of s.matchAll(/\.auth\s*\.\s*([A-Za-z]+)\s*\(/g)) called.add(m[1]);
      }
    }
  };
  walk(path.join(WEB, "src"));
  assert.deepEqual(hits, []);
  const allowed = new Set(["signInWithPassword", "signUp", "resetPasswordForEmail", "signOut", "getSession", "onAuthStateChange", "updateUser", "reauthenticate"]);
  assert.deepEqual([...called].filter((c) => !allowed.has(c)), [], `auth methods called under apps/web/src: ${[...called].sort().join(", ")}`);
  for (const c of ["signInWithPassword", "signUp", "resetPasswordForEmail"]) assert.ok(called.has(c), `the search is not vacuous: ${c} has a call site`);
});

test("R12 proof 12 (voice): scan_voice.py --reply over Y11, Y12, Y13 and Y27, as the doc words them, finds no HARD hit", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ten-signin-voice-"));
  try {
    const f = path.join(dir, "reply.md");
    const text = [Y.Y11.replace("<email>", "alex@example.com"), Y.Y12, Y.Y13, Y.Y27].join("\n\n") + "\n";
    writeFileSync(f, text);
    const r = spawnSync("python3", [path.join(REPO, "tests/always-on/scan_voice.py"), "--reply", f], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    console.log(`  [R12] scan_voice output: ${JSON.stringify(r.stdout)}`);
    assert.deepEqual(r.stdout.split("\n").filter((l) => l.startsWith("HARD")), []);
    // the scanner is live: a planted leak is caught, so "no HARD hit" above is not a scanner that never fires
    writeFileSync(f, text + "\nThe check_materials script wrote jobs.md with record_verdict.\n");
    const planted = spawnSync("python3", [path.join(REPO, "tests/always-on/scan_voice.py"), "--reply", f], { encoding: "utf8" });
    assert.ok(planted.stdout.split("\n").some((l) => l.startsWith("HARD")), `the scanner did not flag a planted leak: ${planted.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// C § 16.2 names the 8-character floor for SIGN-UP's field ("`SignIn.tsx`'s sign-up `minLength={8}`"). On
// the Sign in view an existing password is whatever the account already has (the sign-in is shared with the
// older app, C § 8). With the email link gone, a member whose password is shorter than 8 has only Y20 left.
test("R13 the Sign in view sends an existing 7-character password to the server (the 8-character floor is sign-up's)", { todo: "OBSERVED (tester, 2026-10-07; the same on origin/main): the Sign in view's password field carries minLength=8, so the browser blocks the submit with its own bubble and no request is made" }, async () => {
  const { ctx, page } = await open();
  try {
    const before = auth.log.length;
    await emailBox(page).fill("older.member@example.com");
    await passBox(page).fill("seven77");
    await submit(page).click();
    await page.waitForTimeout(1200);
    const sent = auth.log.slice(before).map((l) => `${l.method} ${l.path}`);
    const bubble = await passBox(page).evaluate((e) => (e as HTMLInputElement).validationMessage);
    assert.deepEqual(sent, ["POST /auth/v1/token"], `no sign-in request was made; the browser said: ${JSON.stringify(bubble)}`);
  } finally {
    await ctx.close();
  }
});

test("R7b proof 7 (requests), last: over this whole file's run the auth server got no request for a sign-in link; the paths used are the card's three calls and nothing else; no request left 127.0.0.1", () => {
  const paths = [...new Set(auth.log.map((l) => `${l.method} ${l.path}`))].sort();
  console.log(`  [R7b] ${auth.log.length} auth requests: ${paths.join(", ")}`);
  assert.deepEqual(auth.log.filter((l) => /otp|magiclink|verify/.test(l.path)), []);
  assert.deepEqual(paths, ["POST /auth/v1/recover", "POST /auth/v1/signup", "POST /auth/v1/token"]);
  assert.ok(auth.log.filter((l) => l.path === "/auth/v1/token").every((l) => /grant_type=password/.test(l.search)), "a token request that is not the password grant");
  assert.ok(auth.log.length >= 20, "the log is live");
  assert.deepEqual(external, []);
});
