// Tester-owned acceptance tests for docs/design-web-agent.md § 16 (setting
// and resetting a password) and docs/design-web-ui.md § 1.10, written from
// the spec (commit 75dcca1, owner-approved 2026-09-25), not from the code.
// § 16.4's test plan, items 1-8, plus the members-only menu item.
//
// What runs: a PRODUCTION build (apps/web/vite.config.ts) of
// tests/web/password/harness.tsx, which mounts the REAL RealApp (sign-in,
// "Choose a new password", the membership check, not-a-member) with
// `@supabase/supabase-js` aliased to tests/web/password/fake-supabase.ts,
// and the REAL member chat screen (RealChatShell, Header's ⋯ menu,
// SetPasswordDialog) over the same fake. Headless Chromium from apps/web's
// Playwright. Every non-harness request is aborted and recorded.
//
// Every expected line below is read out of design-web-ui.md § 1.10 itself,
// so the tests follow the spec's copy, never the component's.
//
// Run: node --test tests/web/password.test.ts
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "../../apps/web/node_modules/playwright/index.mjs";
import { MIN_PASSWORD_LENGTH, authRedirectFromUrl } from "../../apps/web/src/backend/auth.ts";
import type { FakeCfg } from "./password/fake-supabase.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const HARNESS = path.join(HERE, "password");
const SITE_URL = "https://ten-site.example.app";

// ---------------------------------------------------------------- the spec's copy (ui § 1.10)

const UI = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");
const S110 = UI.slice(UI.indexOf("### 1.10 Passwords"), UI.indexOf("### 1.11")).replace(/\s+/g, " ");
function spec(re: RegExp, what: string): string {
  const m = re.exec(S110);
  if (!m) throw new Error(`§ 1.10 copy not found: ${what}`);
  return m[1];
}
const COPY = {
  tooShort: spec(/Checked before any call: "([^"]+)"/, "too short"),
  mismatch: spec(/Checked before any call: "[^"]+" · "([^"]+)"/, "mismatch"),
  dialogTitle: spec(/\*\*Dialog\.\*\* Title "([^"]+)"/, "dialog title"),
  dialogLine: spec(/\*\*Dialog\.\*\* Title "[^"]+"\. Line: "([^"]+)"/, "dialog line"),
  success: spec(/Success: "([^"]+)" and `Done`/, "success"),
  codeStep: spec(/\*\*Code step\*\* \(only when Supabase asks, C § 16\.1\): "([^"]+)"/, "code step"),
  resent: spec(/After a resend: "([^"]+)"/, "resend"),
  forgotLink: spec(/a link button: "([^"]+)"/, "forgot link"),
  resetTitle: spec(/Title "(Reset your password)"/, "reset title"),
  resetLine: spec(/Title "Reset your password"\. Line: "([^"]+)"/, "reset line"),
  enumSafe: spec(/the same text, character for character: "([^"]+)"/, "enumeration-safe line"),
  resetFail: spec(/Any other failure: "([^"]+)"/, "reset failure"),
  expired: spec(/above the form: "([^"]+)"/, "expired link"),
  recoveryTitle: spec(/\*\*"(Choose a new password)"\*\*/, "recovery title"),
  recoveryLine: spec(/before the chat \(C § 16\.1\)\. Line: "([^"]+)"/, "recovery line"),
};
const TABLE: Record<string, string> = {};
for (const m of UI.slice(UI.indexOf("### 1.10 Passwords"), UI.indexOf("### 1.11")).matchAll(/^\| (.+?) \| "(.+?)" \|$/gm)) TABLE[m[1]] = m[2];
const LINE = {
  notValid: TABLE["`reauthentication_not_valid`"],
  weakLength: TABLE["`weak_password`, reason `length`"],
  weakChars: TABLE["`weak_password`, reason `characters`"],
  weakPwned: TABLE["`weak_password`, reason `pwned`"],
  same: TABLE["`same_password`"],
  tooMany: TABLE["HTTP 429"],
  other: TABLE["anything else"],
};
const withEmail = (s: string, email: string) => s.replace("{email}", email);

test("S0 the § 1.10 copy this suite checks against was found in the spec", () => {
  for (const [k, v] of Object.entries({ ...COPY, ...LINE })) assert.ok(v && v.length > 10, `copy ${k} missing`);
  assert.equal(Object.keys(TABLE).length, 7, `error table rows: ${JSON.stringify(Object.keys(TABLE))}`);
  assert.match(COPY.codeStep, /\{email\}/);
  assert.match(COPY.enumSafe, /\{email\}/);
});

// ---------------------------------------------------------------- build + serve the harness

let server: Server;
let base = "";
let browser: Browser;
let outDir = "";

before(async () => {
  const link = path.join(HARNESS, "node_modules");
  if (!existsSync(link)) symlinkSync("../../../apps/web/node_modules", link);
  assert.ok(lstatSync(link).isSymbolicLink());
  outDir = mkdtempSync(path.join(tmpdir(), "ten-password-harness-"));
  const { build } = (await import(path.join(REPO, "apps/web/node_modules/vite/dist/node/index.js"))) as typeof import("vite");
  const savedSite = process.env.VITE_SITE_URL;
  process.env.VITE_SITE_URL = SITE_URL;
  try {
    await build({
      root: HARNESS,
      configFile: path.join(REPO, "apps/web/vite.config.ts"),
      logLevel: "error",
      resolve: { alias: { "@supabase/supabase-js": path.join(HARNESS, "fake-supabase.ts") } },
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    if (savedSite === undefined) delete process.env.VITE_SITE_URL;
    else process.env.VITE_SITE_URL = savedSite;
  }
  const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    let file = path.join(outDir, p === "/" ? "index.html" : p);
    if (!file.startsWith(outDir) || !existsSync(file) || lstatSync(file).isDirectory()) file = path.join(outDir, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- one page

interface Opened {
  page: Page;
  /** Playwright-level capture: every request (url + body) and console message */
  requests: string[];
  console: string[];
  external: string[];
  close(): Promise<void>;
}

const RECOVERY_HASH = "#access_token=fake-access-token&expires_in=3600&refresh_token=fake-refresh&token_type=bearer&type=recovery";
const EMAIL = "member@example.com";

async function open(cfg: FakeCfg, opts: { path?: string; viewport?: { width: number; height: number } } = {}): Promise<Opened> {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 860 } });
  const requests: string[] = [];
  const consoleMsgs: string[] = [];
  const external: string[] = [];
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.origin + "/" === base) return route.continue();
    external.push(u.href);
    return route.abort();
  });
  await ctx.addInitScript((c: FakeCfg) => {
    (window as any).__cfg = c;
    (window as any).__calls = [];
    const L: Record<string, string[]> = ((window as any).__leak = {});
    const s = (x: unknown): string => {
      try {
        if (x instanceof Error) return `${x.name} ${x.message} ${x.stack ?? ""}`;
        return typeof x === "string" ? x : JSON.stringify(x);
      } catch {
        return String(x);
      }
    };
    const push = (k: string, v: string) => (L[k] ??= []).push(v);
    for (const m of ["log", "info", "warn", "error", "debug", "trace", "dir", "table"] as const) {
      const o = (console as any)[m];
      (console as any)[m] = function (...a: unknown[]) {
        push("console", a.map(s).join(" "));
        return o.apply(this, a);
      };
    }
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      push("storage", `${k}=${v}`);
      return setItem.call(this, k, v);
    };
    const f = window.fetch;
    window.fetch = function (input: any, init?: any) {
      push("net", `fetch ${s(input?.url ?? input)} ${init?.body ? s(init.body) : ""}`);
      return f.call(window, input, init);
    } as any;
    const xo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...a: any[]) {
      push("net", `xhr ${s(a[1])}`);
      return (xo as any).apply(this, a);
    } as any;
    const xs = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, b?: any) {
      push("net", `xhr-body ${s(b)}`);
      return xs.call(this, b);
    };
    const beacon = navigator.sendBeacon?.bind(navigator);
    if (beacon) navigator.sendBeacon = (u: string | URL, d?: any) => (push("net", `beacon ${s(u)} ${s(d)}`), beacon(u, d));
    for (const m of ["pushState", "replaceState"] as const) {
      const o = history[m];
      history[m] = function (this: History, ...a: any[]) {
        push("history", `${m} ${s(a[2])}`);
        return (o as any).apply(this, a);
      } as any;
    }
    window.addEventListener("hashchange", () => push("history", `hash ${location.href}`));
    window.addEventListener("popstate", () => push("history", `pop ${location.href}`));
  }, cfg);
  const page = await ctx.newPage();
  page.on("request", (r) => requests.push(`${r.method()} ${r.url()} ${r.postData() ?? ""}`));
  page.on("console", (m) => consoleMsgs.push(m.text()));
  await page.goto(base + (opts.path ?? ""));
  return { page, requests, console: consoleMsgs, external, close: () => ctx.close() };
}

type Call = { fn: string; args: any[] };
const calls = (page: Page): Promise<Call[]> => page.evaluate(() => (window as any).__calls);
const callsOf = async (page: Page, fn: string) => (await calls(page)).filter((c) => c.fn === fn);
const memberChecks = async (page: Page) => (await calls(page)).filter((c) => c.fn === "rpc" && c.args[0] === "ten_is_member").length;
const bodyText = (page: Page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
const settle = (page: Page, ms = 250) => page.waitForTimeout(ms);

async function openDialog(cfg: FakeCfg, viewport?: { width: number; height: number }): Promise<Opened> {
  const o = await open(cfg, { path: "?mode=shell", viewport });
  await o.page.getByRole("button", { name: "Menu" }).click();
  await o.page.getByRole("menuitem", { name: "Set a new password" }).click();
  await o.page.getByRole("dialog").waitFor();
  return o;
}
async function openRecovery(cfg: FakeCfg, viewport?: { width: number; height: number }): Promise<Opened> {
  const o = await open({ signedIn: true, events: [{ event: "INITIAL_SESSION" }, { event: "PASSWORD_RECOVERY", delay: 5 }], ...cfg }, { path: RECOVERY_HASH, viewport });
  await o.page.getByRole("heading", { name: COPY.recoveryTitle }).waitFor();
  return o;
}
async function fill(page: Page, pw: string, again = pw) {
  await page.getByLabel("New password").fill(pw);
  await page.getByLabel("Type it again").fill(again);
}
const save = (page: Page) => page.getByRole("button", { name: "Save password" }).click();

// ================================================================ 1. the form

for (const where of ["dialog", "recovery"] as const) {
  test(`P1 ${where}: a mismatch and a ${MIN_PASSWORD_LENGTH - 1}-character password make no call and show § 1.10's lines`, async () => {
    const o = where === "dialog" ? await openDialog({}) : await openRecovery({});
    try {
      await fill(o.page, "Abcdefg"); // 7
      await save(o.page);
      await settle(o.page);
      assert.ok((await bodyText(o.page)).includes(COPY.tooShort), "too-short line");
      await fill(o.page, "Abcdefgh1", "Abcdefgh2");
      await save(o.page);
      await settle(o.page);
      assert.ok((await bodyText(o.page)).includes(COPY.mismatch), "mismatch line");
      assert.deepEqual(await callsOf(o.page, "updateUser"), [], "no updateUser call");
      assert.deepEqual(await callsOf(o.page, "reauthenticate"), [], "no reauthenticate call");
    } finally {
      await o.close();
    }
  });
}

test("P1b the check before any call still holds in the code step: a mismatch typed there makes no call", async () => {
  const o = await openDialog({ updateUser: "reauth", code: "246810" });
  try {
    await fill(o.page, "Correct-Horse-9");
    await save(o.page);
    await o.page.getByLabel("Code").waitFor();
    const before = (await callsOf(o.page, "updateUser")).length;
    await o.page.getByLabel("Type it again").fill("Something-else-1");
    await o.page.getByLabel("Code").fill("246810");
    await save(o.page);
    await settle(o.page);
    assert.equal((await callsOf(o.page, "updateUser")).length, before, "updateUser was called with two passwords that don't match");
    assert.ok((await bodyText(o.page)).includes(COPY.mismatch), "mismatch line in the code step");
    // a 7-character password typed in the code step: no call either
    await fill(o.page, "Abcdefg");
    await save(o.page);
    await settle(o.page);
    assert.equal((await callsOf(o.page, "updateUser")).length, before, "updateUser was called with a 7-character password");
    assert.ok((await bodyText(o.page)).includes(COPY.tooShort), "too-short line in the code step");
    // and a valid pair with the right code still saves, with the nonce
    await fill(o.page, "Correct-Horse-9");
    await save(o.page);
    await o.page.getByText(COPY.success).waitFor();
    assert.deepEqual((await callsOf(o.page, "updateUser")).at(-1)!.args[0], { password: "Correct-Horse-9", nonce: "246810" });
  } finally {
    await o.close();
  }
});

// ================================================================ 2. secure change off / fresh session

for (const where of ["dialog", "recovery"] as const) {
  test(`P2 ${where}: secure change off (or a fresh session): updateUser once with exactly { password }, then the success line`, async () => {
    const o = where === "dialog" ? await openDialog({ updateUser: "ok" }) : await openRecovery({ updateUser: "ok" });
    try {
      await fill(o.page, "Correct-Horse-9");
      await save(o.page);
      await o.page.getByText(COPY.success).waitFor();
      assert.deepEqual(await callsOf(o.page, "updateUser"), [{ fn: "updateUser", args: [{ password: "Correct-Horse-9" }] }]);
      assert.deepEqual(await callsOf(o.page, "reauthenticate"), []);
      const next = where === "dialog" ? "Done" : "Continue";
      assert.ok(await o.page.getByRole("button", { name: next }).isVisible(), `${next} button`);
      if (where === "dialog") {
        assert.ok((await bodyText(o.page)).includes(COPY.dialogTitle));
        await o.page.getByRole("button", { name: "Done" }).click();
        assert.equal(await o.page.getByRole("dialog").count(), 0, "Done closes the dialog");
        // cleared on success: reopening starts empty
        await o.page.getByRole("button", { name: "Menu" }).click();
        await o.page.getByRole("menuitem", { name: "Set a new password" }).click();
        assert.equal(await o.page.getByLabel("New password").inputValue(), "");
        assert.equal(await o.page.getByLabel("Type it again").inputValue(), "");
      }
    } finally {
      await o.close();
    }
  });
}

// ================================================================ 3. secure change on, older session

for (const where of ["dialog", "recovery"] as const) {
  test(`P3 ${where}: reauthentication_needed -> reauthenticate once -> code step; wrong code keeps the password; Send a new code; right code sends { password, nonce }`, async () => {
    const cfg: FakeCfg = { updateUser: "reauth", code: "246810", email: EMAIL };
    const o = where === "dialog" ? await openDialog(cfg) : await openRecovery(cfg);
    try {
      await fill(o.page, "Correct-Horse-9");
      await save(o.page);
      await o.page.getByLabel("Code").waitFor();
      assert.equal((await callsOf(o.page, "reauthenticate")).length, 1, "reauthenticate once");
      assert.deepEqual((await callsOf(o.page, "updateUser")).map((c) => c.args[0]), [{ password: "Correct-Horse-9" }]);
      assert.ok((await bodyText(o.page)).includes(withEmail(COPY.codeStep, EMAIL)), `code-step line with the email: ${await bodyText(o.page)}`);
      assert.equal(await o.page.getByLabel("Code").getAttribute("autocomplete"), "one-time-code");
      for (const name of ["Save password", "Send a new code"]) assert.ok(await o.page.getByRole("button", { name }).isVisible(), name);
      if (where === "dialog") assert.ok(await o.page.getByRole("button", { name: "Cancel" }).isVisible(), "Cancel in the code step");

      // wrong code
      await o.page.getByLabel("Code").fill("000000");
      await save(o.page);
      await o.page.getByText(LINE.notValid).waitFor();
      assert.equal(await o.page.getByLabel("New password").inputValue(), "Correct-Horse-9", "password kept after a wrong code");
      assert.equal(await o.page.getByLabel("Type it again").inputValue(), "Correct-Horse-9");
      assert.deepEqual((await callsOf(o.page, "updateUser")).at(-1)!.args[0], { password: "Correct-Horse-9", nonce: "000000" });

      // resend
      await o.page.getByRole("button", { name: "Send a new code" }).click();
      await o.page.getByText(withEmail(COPY.resent, EMAIL)).waitFor();
      assert.equal((await callsOf(o.page, "reauthenticate")).length, 2, "Send a new code calls reauthenticate again");

      // right code
      await o.page.getByLabel("Code").fill("246810");
      await save(o.page);
      await o.page.getByText(COPY.success).waitFor();
      const ups = (await callsOf(o.page, "updateUser")).map((c) => c.args[0]);
      assert.deepEqual(ups, [{ password: "Correct-Horse-9" }, { password: "Correct-Horse-9", nonce: "000000" }, { password: "Correct-Horse-9", nonce: "246810" }]);
      assert.equal(await memberChecks(o.page), 0, "no membership check before Continue");
    } finally {
      await o.close();
    }
  });
}

test("P3b recovery from the URL alone (no PASSWORD_RECOVERY event reaches the listener): the code step still names the signed-in email", async () => {
  // With the real client the listener can miss PASSWORD_RECOVERY (it is
  // fired from a setTimeout once the URL is read, possibly before the
  // listener subscribes) — § 16.1 is why the URL is read at all.
  const o = await open({ signedIn: true, events: [{ event: "INITIAL_SESSION" }], updateUser: "reauth", code: "246810", email: EMAIL }, { path: RECOVERY_HASH });
  try {
    await o.page.getByRole("heading", { name: COPY.recoveryTitle }).waitFor();
    await settle(o.page);
    await fill(o.page, "Correct-Horse-9");
    await save(o.page);
    await o.page.getByLabel("Code").waitFor();
    const t = await bodyText(o.page);
    assert.ok(t.includes(withEmail(COPY.codeStep, EMAIL)), `code-step line should name ${EMAIL}; shown: ${t.slice(0, 300)}`);
  } finally {
    await o.close();
  }
});

// ================================================================ 4. every error code

const ERR_CASES: { name: string; error: any; line: string }[] = [
  { name: "weak_password/length", error: { code: "weak_password", status: 422, reasons: ["length"] }, line: LINE.weakLength },
  { name: "weak_password/characters", error: { code: "weak_password", status: 422, reasons: ["characters"] }, line: LINE.weakChars },
  { name: "weak_password/pwned", error: { code: "weak_password", status: 422, reasons: ["pwned"] }, line: LINE.weakPwned },
  { name: "same_password", error: { code: "same_password", status: 422 }, line: LINE.same },
  { name: "HTTP 429", error: { code: "over_request_rate_limit", status: 429 }, line: LINE.tooMany },
  { name: "anything else (500)", error: { code: "unexpected_failure", status: 500 }, line: LINE.other },
  { name: "anything else (network, status 0)", error: { status: 0, name: "AuthRetryableFetchError" }, line: LINE.other },
  { name: "anything else (session missing)", error: { status: 400, name: "AuthSessionMissingError" }, line: LINE.other },
];

for (const where of ["dialog", "recovery"] as const) {
  test(`P4 ${where}: every updateUser error gives its § 1.10 line, never the fake's error.message`, async () => {
    for (const c of ERR_CASES) {
      const raw = `RAW-SUPABASE-TEXT ${c.name}`;
      const cfg: FakeCfg = { updateUser: { error: { ...c.error, message: raw } } };
      const o = where === "dialog" ? await openDialog(cfg) : await openRecovery(cfg);
      try {
        await fill(o.page, "Correct-Horse-9");
        await save(o.page);
        await o.page.getByText(c.line).waitFor({ timeout: 3000 }).catch(() => undefined);
        const t = await bodyText(o.page);
        assert.ok(t.includes(c.line), `${c.name}: expected "${c.line}", shown: ${t.slice(0, 400)}`);
        assert.ok(!t.includes("RAW-SUPABASE"), `${c.name}: raw error.message shown`);
        for (const other of Object.values(LINE)) if (other !== c.line) assert.ok(!t.includes(other), `${c.name}: also shows "${other}"`);
      } finally {
        await o.close();
      }
    }
  });
}

test("P4b reauthentication_not_valid and a 429 from reauthenticate() itself give their lines, never error.message", async () => {
  // the first reauthenticate() succeeds (the code step opens), the resend is rate-limited
  const o = await openDialog({ updateUser: "reauth", code: "246810", reauthenticate: ["ok", { error: { code: "over_email_send_rate_limit", status: 429, message: "RAW-SUPABASE-TEXT resend" } }] });
  try {
    await fill(o.page, "Correct-Horse-9");
    await save(o.page);
    await o.page.getByLabel("Code").fill("111111");
    await save(o.page);
    await o.page.getByText(LINE.notValid).waitFor();
    await o.page.getByRole("button", { name: "Send a new code" }).click();
    await o.page.getByText(LINE.tooMany).waitFor();
    const t = await bodyText(o.page);
    assert.ok(!t.includes("RAW-SUPABASE"), "raw text shown");
  } finally {
    await o.close();
  }
  // the very first reauthenticate() fails: its line shows, still no raw text
  const p = await openDialog({ updateUser: "reauth", reauthenticate: [{ error: { code: "over_email_send_rate_limit", status: 429, message: "RAW-SUPABASE-TEXT first send" } }] });
  try {
    await fill(p.page, "Correct-Horse-9");
    await save(p.page);
    await p.page.getByText(LINE.tooMany).waitFor();
    assert.ok(!(await bodyText(p.page)).includes("RAW-SUPABASE"));
  } finally {
    await p.close();
  }
});

// ================================================================ 5. forgot

async function openForgot(cfg: FakeCfg, viewport?: { width: number; height: number }, pathSuffix = "") {
  const o = await open({ events: [{ event: "INITIAL_SESSION" }], ...cfg }, { viewport, path: pathSuffix });
  await o.page.getByRole("button", { name: "Email + password" }).click();
  await o.page.getByRole("button", { name: COPY.forgotLink }).click();
  await o.page.getByRole("heading", { name: COPY.resetTitle }).waitFor();
  return o;
}
async function sendReset(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await settle(page, 300);
}

test("P5 forgot: the link is in Email + password mode only; the card's title, line and buttons are § 1.10's", async () => {
  const o = await open({ events: [{ event: "INITIAL_SESSION" }] });
  try {
    await o.page.getByRole("button", { name: "Email link" }).waitFor();
    assert.equal(await o.page.getByRole("button", { name: COPY.forgotLink }).count(), 0, "not in Email link mode");
    await o.page.getByRole("button", { name: "Email + password" }).click();
    assert.equal(await o.page.getByRole("button", { name: COPY.forgotLink }).count(), 1, "in Email + password mode");
    await o.page.getByRole("button", { name: COPY.forgotLink }).click();
    const t = await bodyText(o.page);
    assert.ok(t.includes(COPY.resetTitle) && t.includes(COPY.resetLine), t.slice(0, 300));
    assert.equal(await o.page.getByRole("button", { name: "Send reset link" }).count(), 1);
    await o.page.getByRole("button", { name: "Back to sign in" }).click();
    assert.equal(await o.page.getByRole("button", { name: "Email + password" }).count(), 1, "Back to sign in returns");
  } finally {
    await o.close();
  }
});

test("P5b forgot: resetPasswordForEmail(email, { redirectTo: VITE_SITE_URL }); has-account, no-account and 429 render byte-identical text; another error gives the failure line", async () => {
  const email = "someone@example.com";
  const html: Record<string, string> = {};
  const fakes: Record<string, FakeCfg["reset"]> = {
    "has-account": "ok",
    "no-account": "ok", // Supabase answers the same (its password guide)
    "429": { error: { code: "over_email_send_rate_limit", status: 429, message: "RAW-SUPABASE-TEXT 429 for someone@example.com" } },
  };
  for (const [k, reset] of Object.entries(fakes)) {
    const o = await openForgot({ reset });
    try {
      await sendReset(o.page, email);
      assert.deepEqual(await callsOf(o.page, "resetPasswordForEmail"), [{ fn: "resetPasswordForEmail", args: [email, { redirectTo: SITE_URL }] }], k);
      html[k] = await o.page.evaluate(() => document.getElementById("root")!.innerHTML);
      const t = await bodyText(o.page);
      assert.ok(t.includes(withEmail(COPY.enumSafe, email)), `${k}: enumeration-safe line; shown ${t.slice(0, 400)}`);
      assert.ok(!t.includes("RAW-SUPABASE"), k);
    } finally {
      await o.close();
    }
  }
  assert.equal(html["no-account"], html["has-account"], "no-account vs has-account DOM");
  assert.equal(html["429"], html["has-account"], "429 vs success DOM, byte for byte");

  const o = await openForgot({ reset: { error: { code: "unexpected_failure", status: 500, message: "RAW-SUPABASE-TEXT 500" } } });
  try {
    await sendReset(o.page, email);
    const t = await bodyText(o.page);
    assert.ok(t.includes(COPY.resetFail), `failure line; shown ${t.slice(0, 300)}`);
    assert.ok(!t.includes(withEmail(COPY.enumSafe, email)) && !t.includes("RAW-SUPABASE"));
  } finally {
    await o.close();
  }
});

// ================================================================ 6. recovery

test("P6 authRedirectFromUrl: recovery hash, error in the hash, error in the query, none (C § 16.1)", () => {
  assert.equal(authRedirectFromUrl("https://ten.example.app/" + RECOVERY_HASH), "recovery");
  assert.equal(authRedirectFromUrl("https://ten.example.app/?type=recovery"), "recovery");
  assert.equal(authRedirectFromUrl("https://ten.example.app/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"), "link-error");
  assert.equal(authRedirectFromUrl("https://ten.example.app/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"), "link-error");
  assert.equal(authRedirectFromUrl("https://ten.example.app/"), "none");
  assert.equal(authRedirectFromUrl("https://ten.example.app/#access_token=a&expires_in=3600&refresh_token=b&token_type=bearer&type=magiclink"), "none");
  assert.equal(authRedirectFromUrl("https://ten.example.app/#"), "none");
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  // "one number in code": sign-up's minLength uses it
  const signIn = readFileSync(path.join(REPO, "apps/web/src/real/SignIn.tsx"), "utf8");
  assert.ok(signIn.includes("minLength={MIN_PASSWORD_LENGTH}") && !/minLength=\{8\}/.test(signIn));
});

const ORDERS: { name: string; path: string; events: FakeCfg["events"] }[] = [
  { name: "URL + INITIAL_SESSION then PASSWORD_RECOVERY", path: RECOVERY_HASH, events: [{ event: "INITIAL_SESSION" }, { event: "PASSWORD_RECOVERY", delay: 30 }] },
  { name: "URL + PASSWORD_RECOVERY then INITIAL_SESSION", path: RECOVERY_HASH, events: [{ event: "PASSWORD_RECOVERY" }, { event: "INITIAL_SESSION", delay: 30 }] },
  { name: "the URL alone (only INITIAL_SESSION)", path: RECOVERY_HASH, events: [{ event: "INITIAL_SESSION" }] },
  { name: "no URL, PASSWORD_RECOVERY then INITIAL_SESSION", path: "", events: [{ event: "PASSWORD_RECOVERY" }, { event: "INITIAL_SESSION", delay: 30 }] },
];

for (const c of ORDERS) {
  test(`P6 RealApp, ${c.name}: "Choose a new password" shows, ten_is_member is not called and no chat mounts; after save and Continue it is called once`, async () => {
    const o = await open({ signedIn: true, events: c.events, member: false, updateUser: "ok" }, { path: c.path });
    try {
      await o.page.getByRole("heading", { name: COPY.recoveryTitle }).waitFor();
      await settle(o.page, 400);
      const t = await bodyText(o.page);
      assert.ok(t.includes(COPY.recoveryLine), `recovery line; shown ${t.slice(0, 300)}`);
      assert.equal(await memberChecks(o.page), 0, "ten_is_member before Continue");
      assert.equal(await o.page.locator(".composer-input").count(), 0, "no chat mounted");
      assert.equal(await o.page.getByRole("button", { name: "Sign out" }).count(), 1, "Sign out on the recovery screen");
      await fill(o.page, "Correct-Horse-9");
      await save(o.page);
      await o.page.getByRole("button", { name: "Continue" }).waitFor();
      await settle(o.page, 200); // USER_UPDATED arrives here; it must not advance
      assert.equal(await memberChecks(o.page), 0, "no check before Continue, USER_UPDATED included");
      assert.ok((await bodyText(o.page)).includes(COPY.success));
      await o.page.getByRole("button", { name: "Continue" }).click();
      await o.page.getByText("invite-only").waitFor();
      await settle(o.page, 300);
      assert.equal(await memberChecks(o.page), 1, "ten_is_member exactly once after Continue");
    } finally {
      await o.close();
    }
  });
}

test("P6b a PASSWORD_RECOVERY event that follows INITIAL_SESSION (no URL) still leaves 'Choose a new password' on screen", async () => {
  // Edge: a check already in flight when the event arrives must not replace
  // the recovery screen ("in place of every other screen", C § 16.1).
  for (const member of [false, true]) {
    // member=false: the late answer is not-a-member. member=true: the check
    // goes on to the workspace setup, which fails here (no REST behind the
    // fake), so the late screen would be the setup error screen.
    const o = await open({ signedIn: true, member, rpcDelay: 300, updateUser: "ok", events: [{ event: "INITIAL_SESSION" }, { event: "PASSWORD_RECOVERY", delay: 50 }] });
    try {
      await settle(o.page, 1200);
      const t = await bodyText(o.page);
      assert.ok(t.includes(COPY.recoveryTitle) && t.includes(COPY.recoveryLine), `member=${member}: final screen: ${t.slice(0, 200)}`);
      assert.equal(await o.page.locator(".composer-input").count(), 0, "no chat");
      // the flow still completes: save, Continue, one more check, its screen
      await fill(o.page, "Correct-Horse-9");
      await save(o.page);
      await o.page.getByRole("button", { name: "Continue" }).click();
      await settle(o.page, 900);
      assert.equal(await memberChecks(o.page), 2, "the in-flight check, then exactly one after Continue");
      const after = await bodyText(o.page);
      assert.ok(!after.includes(COPY.recoveryTitle), `Continue leaves recovery: ${after.slice(0, 200)}`);
      if (!member) assert.ok(after.includes("invite-only"), after.slice(0, 200));
    } finally {
      await o.close();
    }
  }
});

test("P6c Sign out from the recovery screen signs out and shows sign-in, with no membership check", async () => {
  const o = await openRecovery({ member: true });
  try {
    await fill(o.page, "Correct-Horse-9");
    await o.page.getByRole("button", { name: "Sign out" }).click();
    await o.page.getByRole("button", { name: "Email + password" }).waitFor();
    assert.equal((await callsOf(o.page, "signOut")).length, 1);
    assert.equal(await memberChecks(o.page), 0);
    assert.equal((await callsOf(o.page, "updateUser")).length, 0);
  } finally {
    await o.close();
  }
});

for (const where of ["hash", "query"] as const) {
  test(`P6d an otp_expired link (error in the ${where}) shows the expired line on sign-in and on the reset card; the URL is cleaned so a reload doesn't repeat it`, async () => {
    const err = "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
    const o = await open({ events: [{ event: "INITIAL_SESSION" }] }, { path: where === "hash" ? `#${err}` : `?${err}` });
    try {
      await o.page.getByText(COPY.expired).waitFor();
      await settle(o.page);
      const href = await o.page.evaluate(() => location.href);
      assert.ok(!/error_code|otp_expired|error_description/.test(href), `URL still carries the error: ${href}`);
      await o.page.getByRole("button", { name: "Email + password" }).click();
      await o.page.getByRole("button", { name: COPY.forgotLink }).click();
      // "above the form"
      const order = await o.page.evaluate((expired) => {
        const all = [...document.querySelectorAll("p, form")];
        const i = all.findIndex((e) => e.textContent?.includes(expired));
        const f = all.findIndex((e) => e.tagName === "FORM");
        return { i, f };
      }, COPY.expired);
      assert.ok(order.i >= 0 && order.i < order.f, `expired line above the reset form: ${JSON.stringify(order)}`);
      await o.page.reload();
      await o.page.getByRole("button", { name: "Email link" }).waitFor();
      await settle(o.page);
      assert.ok(!(await bodyText(o.page)).includes(COPY.expired), "reload repeats the expired line");
    } finally {
      await o.close();
    }
  });
}

test("P6e the expired line belongs to the link that came back: after a sign-in and a sign-out in the same tab it is gone", async () => {
  const o = await open({ events: [{ event: "INITIAL_SESSION" }], member: false }, { path: "#error=access_denied&error_code=otp_expired&error_description=x" });
  try {
    await o.page.getByText(COPY.expired).waitFor();
    await o.page.getByRole("button", { name: "Email + password" }).click();
    await o.page.getByLabel("Email").fill(EMAIL);
    await o.page.getByLabel("Password").fill("correct horse battery");
    await o.page.getByRole("button", { name: "Sign in" }).click();
    await o.page.getByText("invite-only").waitFor();
    await o.page.getByRole("button", { name: "Sign out" }).click();
    await o.page.getByRole("button", { name: "Email link" }).waitFor();
    await settle(o.page);
    assert.ok(!(await bodyText(o.page)).includes(COPY.expired), "the expired line shows again after sign-out, with no link involved");
  } finally {
    await o.close();
  }
});

// ================================================================ 7. no leak

const SENTINEL = "Sentinel-PW-7f3a9cQ!";
const SENTINEL_CODE = "918273";

async function leakDump(o: Opened): Promise<string> {
  const inPage = await o.page.evaluate(() =>
    JSON.stringify({
      leak: (window as any).__leak,
      href: location.href,
      ls: { ...localStorage },
      ss: { ...sessionStorage },
      cookie: document.cookie,
      title: document.title,
      historyState: history.state,
    }),
  );
  return inPage + JSON.stringify({ requests: o.requests, console: o.console, external: o.external });
}
function onlyInAuthCalls(all: Call[], needle: string): string[] {
  return all.filter((c) => JSON.stringify(c).includes(needle) && c.fn !== "updateUser").map((c) => c.fn);
}

test("P7 no leak, member dialog (reauth path, wrong code, resend, right code): the sentinel password and code appear only in updateUser's arguments", async () => {
  const o = await openDialog({ updateUser: "reauth", code: SENTINEL_CODE, email: EMAIL });
  try {
    // the fields: hidden, no name, new-password; the form posts
    const attrs = await o.page.evaluate(() =>
      [...document.querySelectorAll("[role=dialog] input")].map((i) => ({ type: i.getAttribute("type"), name: i.getAttribute("name"), ac: i.getAttribute("autocomplete") })),
    );
    assert.deepEqual(attrs, [
      { type: "password", name: null, ac: "new-password" },
      { type: "password", name: null, ac: "new-password" },
    ]);
    await fill(o.page, SENTINEL);
    await o.page.getByRole("button", { name: "Show" }).click();
    assert.deepEqual(await o.page.evaluate(() => [...document.querySelectorAll("[role=dialog] input")].slice(0, 2).map((i) => i.getAttribute("type"))), ["text", "text"], "Show reveals both");
    await o.page.getByRole("button", { name: "Hide" }).click();
    await save(o.page);
    await o.page.getByLabel("Code").fill("000000");
    await save(o.page);
    await o.page.getByText(LINE.notValid).waitFor();
    await o.page.getByRole("button", { name: "Send a new code" }).click();
    await o.page.getByLabel("Code").fill(SENTINEL_CODE);
    await save(o.page);
    await o.page.getByText(COPY.success).waitFor();
    await settle(o.page, 300);
    const all = await calls(o.page);
    assert.ok(all.some((c) => c.fn === "updateUser" && c.args[0].password === SENTINEL && c.args[0].nonce === SENTINEL_CODE), "positive control: the sentinel reached updateUser");
    assert.deepEqual(onlyInAuthCalls(all, SENTINEL), []);
    const dump = await leakDump(o);
    assert.ok(!dump.includes(SENTINEL), `sentinel password found outside Supabase Auth: ${dump.slice(Math.max(0, dump.indexOf(SENTINEL) - 200), dump.indexOf(SENTINEL) + 50)}`);
    assert.ok(!dump.includes(SENTINEL_CODE), "sentinel code found outside Supabase Auth");
    const leak = await o.page.evaluate(() => (window as any).__leak);
    assert.ok(!JSON.stringify(leak.workspace ?? []).includes(SENTINEL) && !JSON.stringify(leak.conversation ?? []).includes(SENTINEL), "workspace / conversation");
    // cleared on success: nothing left in any input
    assert.ok(!(await o.page.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value).join("|"))).includes(SENTINEL));
  } finally {
    await o.close();
  }
});

test("P7b no leak, Cancel and sign-out clear the form; the recovery screen's save leaves the sentinel only in updateUser", async () => {
  const d = await openDialog({ updateUser: "ok" });
  try {
    await fill(d.page, SENTINEL);
    await d.page.getByRole("button", { name: "Cancel" }).click();
    await d.page.getByRole("button", { name: "Menu" }).click();
    await d.page.getByRole("menuitem", { name: "Set a new password" }).click();
    assert.equal(await d.page.getByLabel("New password").inputValue(), "", "Cancel clears the password");
    assert.ok(!(await leakDump(d)).includes(SENTINEL));
  } finally {
    await d.close();
  }
  const r = await openRecovery({ updateUser: "reauth", code: SENTINEL_CODE, member: false });
  try {
    await fill(r.page, SENTINEL);
    await save(r.page);
    await r.page.getByLabel("Code").fill(SENTINEL_CODE);
    await save(r.page);
    await r.page.getByRole("button", { name: "Continue" }).click();
    await r.page.getByText("invite-only").waitFor();
    const all = await calls(r.page);
    assert.deepEqual(onlyInAuthCalls(all, SENTINEL), []);
    const dump = await leakDump(r);
    assert.ok(!dump.includes(SENTINEL) && !dump.includes(SENTINEL_CODE), "sentinel outside Supabase Auth (recovery)");
  } finally {
    await r.close();
  }
  // sign-out from the recovery screen mid-typing
  const s = await openRecovery({});
  try {
    await fill(s.page, SENTINEL);
    await s.page.getByRole("button", { name: "Sign out" }).click();
    await s.page.getByRole("button", { name: "Email + password" }).waitFor();
    assert.ok(!(await leakDump(s)).includes(SENTINEL));
    assert.ok(!(await s.page.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value).join("|"))).includes(SENTINEL));
  } finally {
    await s.close();
  }
});

test('P7c C § 16.2: every password-screen form is method="post" and no field has a name (dialog, recovery, reset card)', async () => {
  const shape = (page: Page, scope: string) =>
    page.evaluate((sel) => [...document.querySelectorAll(`${sel} form`)].map((x) => ({ method: x.getAttribute("method"), names: [...x.querySelectorAll("input")].map((i) => i.getAttribute("name")) })), scope);
  const got: Record<string, unknown> = {};
  const d = await openDialog({});
  try {
    got.dialog = await shape(d.page, "[role=dialog]");
  } finally {
    await d.close();
  }
  const r = await openRecovery({});
  try {
    got.recovery = await shape(r.page, "#root");
  } finally {
    await r.close();
  }
  const f = await openForgot({});
  try {
    got.reset = await shape(f.page, "#root");
  } finally {
    await f.close();
  }
  assert.deepEqual(got, {
    dialog: [{ method: "post", names: [null, null] }],
    recovery: [{ method: "post", names: [null, null] }],
    reset: [{ method: "post", names: [null] }],
  });
});

// ================================================================ 8. 375px

const PHONE = { width: 375, height: 740 };
async function phoneCheck(page: Page, scope: string, label: string) {
  const r = await page.evaluate((sel) => {
    const root = document.querySelector(sel) as HTMLElement | null;
    const small: string[] = [];
    let minH = Infinity;
    let targets = 0;
    if (root)
      for (const e of root.querySelectorAll("button, input, a, [role=menuitem]")) {
        const b = (e as HTMLElement).getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        targets++;
        minH = Math.min(minH, b.height);
        if (b.height < 44 || b.width < 44) small.push(`${e.tagName.toLowerCase()} "${(e.textContent || (e as HTMLInputElement).getAttribute("aria-label") || e.getAttribute("type") || "").trim().slice(0, 40)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
    const overflow: string[] = [];
    if (root)
      for (const e of [root, ...root.querySelectorAll("*")]) {
        const b = (e as HTMLElement).getBoundingClientRect();
        if (b.width > 0 && (b.right > window.innerWidth + 0.5 || b.left < -0.5)) overflow.push(`${e.tagName.toLowerCase()}.${(e as HTMLElement).className} [${Math.round(b.left)}, ${Math.round(b.right)}]`);
      }
    const themed = root?.closest("[data-theme]")?.getAttribute("data-theme") ?? null;
    return { found: !!root, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, small, overflow: overflow.slice(0, 8), themed, targets, minH: Math.round(minH * 10) / 10 };
  }, scope);
  assert.ok(r.found, `${label}: ${scope} not found`);
  return { label, ...r };
}

test("P8 375px: the dialog, the reset card and the recovery screen (form and code steps) have no horizontal scroll, tap targets of at least 44px, and data-theme=\"light\"", async (t) => {
  const reports: any[] = [];
  const d = await openDialog({ updateUser: "reauth" }, PHONE);
  try {
    reports.push(await phoneCheck(d.page, "[role=dialog]", "dialog / form"));
    await fill(d.page, "Correct-Horse-9");
    await save(d.page);
    await d.page.getByLabel("Code").waitFor();
    reports.push(await phoneCheck(d.page, "[role=dialog]", "dialog / code step"));
  } finally {
    await d.close();
  }
  const f = await openForgot({}, PHONE);
  try {
    reports.push(await phoneCheck(f.page, ".sign-in-card", "reset card / form"));
    await sendReset(f.page, "someone-with-a-long-address@example.com");
    reports.push(await phoneCheck(f.page, ".sign-in-card", "reset card / sent"));
  } finally {
    await f.close();
  }
  const x = await open({ events: [{ event: "INITIAL_SESSION" }] }, { viewport: PHONE, path: "#error=access_denied&error_code=otp_expired&error_description=x" });
  try {
    await x.page.getByText(COPY.expired).waitFor();
    reports.push(await phoneCheck(x.page, ".sign-in-card", "sign-in / expired line + forgot link"));
    await x.page.getByRole("button", { name: "Email + password" }).click();
    reports.push(await phoneCheck(x.page, ".sign-in-card", "sign-in / password mode with the forgot link"));
  } finally {
    await x.close();
  }
  const r = await openRecovery({ updateUser: "reauth" }, PHONE);
  try {
    reports.push(await phoneCheck(r.page, ".sign-in-card", "recovery / form"));
    await fill(r.page, "Correct-Horse-9");
    await save(r.page);
    await r.page.getByLabel("Code").waitFor();
    reports.push(await phoneCheck(r.page, ".sign-in-card", "recovery / code step"));
  } finally {
    await r.close();
  }
  const problems: string[] = [];
  for (const rep of reports) t.diagnostic(`${rep.label}: ${rep.targets} targets, smallest ${rep.minH}px tall; scrollWidth ${rep.scrollW}/${rep.clientW}; theme ${rep.themed}`);
  for (const rep of reports) {
    if (rep.scrollW > rep.clientW) problems.push(`${rep.label}: horizontal scroll ${rep.scrollW} > ${rep.clientW}`);
    if (rep.overflow.length) problems.push(`${rep.label}: past the viewport: ${rep.overflow.join("; ")}`);
    if (rep.small.length) problems.push(`${rep.label}: under 44px: ${rep.small.join("; ")}`);
    if (rep.themed !== "light") problems.push(`${rep.label}: data-theme ${rep.themed}`);
  }
  assert.deepEqual(problems, []);
});

test("P8b the new § 1.10 CSS uses only styles.css custom properties for color, spacing, type and radius", () => {
  const css = readFileSync(path.join(REPO, "apps/web/src/styles.css"), "utf8");
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const TOKENED = /^(color|background|background-color|border|border-color|border-radius|padding|margin|gap|font-size|font-weight|font-family|line-height)$/;
  const offenders: string[] = [];
  // every class the § 1.10 screens added (round 1: the expired line; round 2: the secondary button)
  for (const cls of ["sign-in-link-error", "sign-in-secondary-button"]) {
    const blocks = [...css.matchAll(new RegExp(`\\.${cls}(?::[a-z-]+)?\\s*\\{([^}]*)\\}`, "g"))];
    assert.ok(blocks.length, `.${cls} not in styles.css`);
    for (const m of blocks)
      for (const decl of m[1].replace(/\/\*[\s\S]*?\*\//g, "").split(";").map((x) => x.trim()).filter(Boolean)) {
        const [prop, ...rest] = decl.split(":");
        const val = rest.join(":").trim();
        for (const v of val.matchAll(/var\((--[a-z0-9-]+)\)/g)) if (!defined.has(v[1])) offenders.push(`${decl} (undefined ${v[1]})`);
        if (!TOKENED.test(prop.trim())) continue;
        const literal = val.replace(/var\(--[a-z0-9-]+\)/g, "").replace(/\b(solid|none|auto|0)\b/g, "").replace(/(^|\s)1px(\s|$)/g, " ").trim();
        if (literal) offenders.push(`.${cls} ${prop.trim()}: ${val}`);
      }
  }
  assert.deepEqual(offenders, []);
});

// ================================================================ the menu item is members-only

test("P9 the member ⋯ menu has 'Set a new password', enabled, directly above Sign out; it opens the § 1.10 dialog", async () => {
  const o = await open({}, { path: "?mode=shell" });
  try {
    await o.page.getByRole("button", { name: "Menu" }).click();
    const items = await o.page.evaluate(() => [...document.querySelectorAll("[role=menu] [role=menuitem]")].map((e) => ({ t: (e.textContent ?? "").trim(), disabled: (e as HTMLButtonElement).disabled === true })));
    const i = items.findIndex((x) => x.t === "Set a new password");
    assert.ok(i >= 0, JSON.stringify(items));
    assert.equal(items[i].disabled, false);
    assert.equal(items[i + 1]?.t, "Sign out", `above Sign out: ${JSON.stringify(items.map((x) => x.t))}`);
    assert.equal(items.filter((x) => /password/i.test(x.t)).length, 1, "one menu item");
    await o.page.getByRole("menuitem", { name: "Set a new password" }).click();
    const t = await bodyText(o.page);
    assert.ok(t.includes(COPY.dialogTitle) && t.includes(COPY.dialogLine), t.slice(0, 300));
    for (const name of ["Save password", "Cancel"]) assert.equal(await o.page.getByRole("button", { name }).count(), 1, name);
  } finally {
    await o.close();
  }
});

test("P9b a signed-in non-member (and a signed-out visitor) never sees 'Set a new password'", async () => {
  const n = await open({ signedIn: true, member: false, events: [{ event: "INITIAL_SESSION" }] });
  try {
    await n.page.getByText("invite-only").waitFor();
    assert.ok(!(await bodyText(n.page)).includes("Set a new password"));
    assert.equal(await n.page.getByRole("button", { name: "Menu" }).count(), 0, "§ 1.6's screen is unchanged");
  } finally {
    await n.close();
  }
  const s = await open({ events: [{ event: "INITIAL_SESSION" }] });
  try {
    await s.page.getByRole("button", { name: "Email link" }).waitFor();
    assert.ok(!(await bodyText(s.page)).includes("Set a new password"));
  } finally {
    await s.close();
  }
});
