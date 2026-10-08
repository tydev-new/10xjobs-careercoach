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
// C § 20.1: a non-member's claim answers `paused` in the fake (FakeCfg.claim's default); the
// screen is § 5.3.1 O2, read from the table (the old "invite-only" line is retired, C § 20.4).
const O2_PAUSED = (() => {
  const line = UI.split("\n").find((l) => l.startsWith("| O2 |"));
  if (!line) throw new Error("row O2 not found in § 5.3.1");
  return line.replace(/^\| /, "").replace(/ \|$/, "").split(" | ")[3].slice(1, -1);
})();

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
    // "http://x" + url, not a URL resolved against "http://x": a doubled-slash address ("//?signup") would
    // otherwise be read as a host-less network-path reference and throw (CL-10).
    const p = decodeURIComponent(new URL("http://x" + (req.url ?? "/")).pathname.replace(/^\/\/+/, "/"));
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
  await o.page.getByRole("button", { name: COPY.forgotLink }).click();
  await o.page.getByRole("heading", { name: COPY.resetTitle }).waitFor();
  return o;
}
async function sendReset(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await settle(page, 300);
}

// The Sign in view's own submit button: the sign-in screen is showing.
const signInShowing = (page: Page) => page.getByRole("button", { name: "Sign in", exact: true });

test("P5 forgot: Y20 is on the Sign in view with no mode click and not on Create an account; the card's title, line and buttons are § 1.10's", async () => {
  const o = await open({ events: [{ event: "INITIAL_SESSION" }] });
  try {
    await signInShowing(o.page).waitFor();
    assert.equal(await o.page.getByRole("button", { name: COPY.forgotLink }).count(), 1, "on the Sign in view");
    await o.page.getByRole("button", { name: "New here? Create an account" }).click();
    assert.equal(await o.page.getByRole("button", { name: COPY.forgotLink }).count(), 0, "not on Create an account");
    await o.page.getByRole("button", { name: "Already have an account? Sign in" }).click();
    await o.page.getByRole("button", { name: COPY.forgotLink }).click();
    const t = await bodyText(o.page);
    assert.ok(t.includes(COPY.resetTitle) && t.includes(COPY.resetLine), t.slice(0, 300));
    assert.equal(await o.page.getByRole("button", { name: "Send reset link" }).count(), 1);
    await o.page.getByRole("button", { name: "Back to sign in" }).click();
    assert.equal(await signInShowing(o.page).count(), 1, "Back to sign in returns to the Sign in view");
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
  assert.ok(signIn.includes("minLength: MIN_PASSWORD_LENGTH") && !/minLength[=:]\s*\{?8\b/.test(signIn));
  // ...and only on the Create view's field: the spread is guarded by isCreate (Y-7 checks the rendered attribute)
  assert.match(signIn, /\.\.\.\(isCreate \? \{ minLength: MIN_PASSWORD_LENGTH \} : \{\}\)/);
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
      await o.page.getByText(O2_PAUSED).waitFor();
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
      if (!member) assert.ok(after.includes(O2_PAUSED), after.slice(0, 200));
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
    await signInShowing(o.page).waitFor();
    assert.equal((await callsOf(o.page, "signOut")).length, 1);
    assert.equal(await memberChecks(o.page), 0);
    assert.equal((await callsOf(o.page, "updateUser")).length, 0);
  } finally {
    await o.close();
  }
});

for (const where of ["hash", "query"] as const) {
  test(`P6d an otp_expired link (error in the ${where}) shows Y27 above the Sign in view only: not on Create an account, not on the reset card; the URL is cleaned so a reload doesn't repeat it`, async () => {
    const err = "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
    const o = await open({ events: [{ event: "INITIAL_SESSION" }] }, { path: where === "hash" ? `#${err}` : `?${err}` });
    try {
      await o.page.getByText(COPY.expired).waitFor();
      await settle(o.page);
      const href = await o.page.evaluate(() => location.href);
      assert.ok(!/error_code|otp_expired|error_description/.test(href), `URL still carries the error: ${href}`);
      // "above the form"
      const order = await o.page.evaluate((expired) => {
        const all = [...document.querySelectorAll("p, form")];
        const i = all.findIndex((e) => e.textContent?.includes(expired));
        const f = all.findIndex((e) => e.tagName === "FORM");
        return { i, f };
      }, COPY.expired);
      assert.ok(order.i >= 0 && order.i < order.f, `expired line above the Sign in form: ${JSON.stringify(order)}`);
      // not on Create an account, back on Sign in again
      await o.page.getByRole("button", { name: "New here? Create an account" }).click();
      assert.ok(!(await bodyText(o.page)).includes(COPY.expired), "Y27 on Create an account");
      await o.page.getByRole("button", { name: "Already have an account? Sign in" }).click();
      assert.ok((await bodyText(o.page)).includes(COPY.expired), "Y27 back on the Sign in view");
      // not on the reset card (it points to a link that is not on that card)
      await o.page.getByRole("button", { name: COPY.forgotLink }).click();
      await o.page.getByRole("heading", { name: COPY.resetTitle }).waitFor();
      assert.ok(!(await bodyText(o.page)).includes(COPY.expired), "Y27 on the reset card");
      await o.page.reload();
      await signInShowing(o.page).waitFor();
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
    await o.page.getByLabel("Email").fill(EMAIL);
    await o.page.getByLabel("Password").fill("correct horse battery");
    await o.page.getByRole("button", { name: "Sign in" }).click();
    await o.page.getByText(O2_PAUSED).waitFor();
    await o.page.getByRole("button", { name: "Sign out" }).click();
    await signInShowing(o.page).waitFor();
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
    await r.page.getByText(O2_PAUSED).waitFor();
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
    await signInShowing(s.page).waitFor();
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
  const r = await page.evaluate(async (sel) => {
    // Measure the settled layout, not an entrance's first frame: a dialog
    // that pops in with scale(0.98) is momentarily 2% smaller than the
    // controls the candidate actually taps (design-web-ui.md § 5.6,
    // "Dialog"). Every finite animation is awaited to its end; infinite ones
    // (a spinner) never settle and never resize the box, so they're skipped.
    const finite = () => document.getAnimations().filter((a) => a.playState !== "finished" && Number(a.effect?.getComputedTiming().endTime) !== Infinity);
    for (let i = 0; i < 5 && finite().length; i++) await Promise.all(finite().map((a) => a.finished.catch(() => undefined)));
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
    await x.page.getByRole("button", { name: "New here? Create an account" }).click();
    reports.push(await phoneCheck(x.page, ".sign-in-card", "create an account"));
  } finally {
    await x.close();
  }
  // § 1.4 proof 11: the Sign in view, the Create an account view and the confirmation line
  // (a long address must not scroll the page), each field, button and link at least 44px
  const v = await open({ events: [{ event: "INITIAL_SESSION" }] }, { viewport: PHONE });
  try {
    await signInShowing(v.page).waitFor();
    reports.push(await phoneCheck(v.page, ".sign-in-card", "sign-in view"));
    await v.page.getByRole("button", { name: "New here? Create an account" }).click();
    reports.push(await phoneCheck(v.page, ".sign-in-card", "create an account view"));
    await v.page.getByLabel("Email").fill("someone-with-a-very-long-address-indeed@a-long-domain-name.example.com");
    await v.page.getByLabel("Password").fill("Correct-Horse-9");
    await v.page.getByRole("button", { name: "Create account", exact: true }).click();
    await v.page.getByRole("button", { name: "Back to sign in" }).waitFor();
    reports.push(await phoneCheck(v.page, ".sign-in-card", "confirmation line"));
  } finally {
    await v.close();
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
    await n.page.getByText(O2_PAUSED).waitFor();
    assert.ok(!(await bodyText(n.page)).includes("Set a new password"));
    assert.equal(await n.page.getByRole("button", { name: "Menu" }).count(), 0, "§ 1.6's screen is unchanged");
  } finally {
    await n.close();
  }
  const s = await open({ events: [{ event: "INITIAL_SESSION" }] });
  try {
    await signInShowing(s.page).waitFor();
    assert.ok(!(await bodyText(s.page)).includes("Set a new password"));
  } finally {
    await s.close();
  }
});

// ================================================================ 10. one way to sign in (ui § 1.4, 2026-10-07, C29)
//
// Proved-by items 1-4, 6, 9 and 10 against the fake, from the § 5.3.1 rows themselves.
// (Items 5 and 7's source search are tests/web/one-way-sign-in.test.ts; item 3's stand-in half and the
// zero-`POST /otp` count are tests/e2e-real/e2e.ts.)

/** The `String` cell of a § 5.3.1 row, without its backticks. */
function uiRow(id: string): string {
  const line = UI.split("\n").find((l) => l.startsWith(`| ${id} |`));
  if (!line) throw new Error(`row ${id} not found in § 5.3.1`);
  const cell = line.replace(/^\| /, "").replace(/ \|$/, "").split(" | ")[3];
  return cell.slice(1, -1);
}
const Y = Object.fromEntries(["Y4", "Y5", "Y6", "Y7", "Y8", "Y9", "Y11", "Y12", "Y13", "Y20", "Y24", "Y27", "S9", "O5", "O7"].map((id) => [id, uiRow(id)]));
const norm = (x: string) => x.replace(/\s+/g, " ").trim();
// every string that must not show on any sign-in state (proof 6); the check ignores case
const NOT_ON_SCREEN = [
  "Email link", "Email + password", "Send me a link", "Email me a sign-in link", "Use a password instead",
  "Use an email link instead", "for a link to sign in", "Couldn't send the link", "or use an email link instead",
  "Ask for a new one below",
];
/** the text a person could read or hear: visible text plus accessible-name attributes */
const everythingShown = (page: Page) =>
  page.evaluate(() => {
    const attrs = [...document.querySelectorAll("[aria-label],[title],[placeholder],[alt]")].map((e) => ["aria-label", "title", "placeholder", "alt"].map((a) => e.getAttribute(a) ?? "").join(" "));
    return (document.body.innerText + " " + attrs.join(" ")).replace(/\s+/g, " ");
  });
async function noRetiredStrings(page: Page, where: string) {
  const t = (await everythingShown(page)).toLowerCase();
  for (const bad of NOT_ON_SCREEN) assert.ok(!t.includes(bad.toLowerCase()), `${where}: shows "${bad}"`);
}

test("Y-1 Sign in view on load: Email, Password, Y20, `Sign in`, Y8, O5, O7 with its two links, S9; one submit; no toggle, no aria-pressed", async () => {
  const o = await open({ events: [{ event: "INITIAL_SESSION" }] });
  try {
    await signInShowing(o.page).waitFor();
    const shape = await o.page.evaluate(() => ({
      labels: [...document.querySelectorAll(".sign-in-form label")].map((l) => (l.firstChild?.textContent ?? "").trim()),
      types: [...document.querySelectorAll(".sign-in-form input")].map((i) => i.getAttribute("type")),
      submits: [...document.querySelectorAll("button[type=submit]")].map((b) => (b.textContent ?? "").trim()),
      linkButtons: [...document.querySelectorAll(".sign-in-form .sign-in-link-button")].map((b) => (b.textContent ?? "").trim()),
      toggles: document.querySelectorAll(".sign-in-mode-toggle").length,
      pressed: document.querySelectorAll("[aria-pressed]").length,
      o5: document.querySelector(".sign-in-invite")?.textContent ?? "",
      o7: document.querySelector(".sign-in-terms")?.textContent ?? "",
      links: [...document.querySelectorAll(".sign-in-terms a")].map((a) => [a.textContent, a.getAttribute("href")]),
      s9: document.querySelector(".sign-in-local")?.textContent ?? "",
      order: [...document.querySelectorAll(".sign-in-form input, .sign-in-form button")].map((e) => (e.textContent || e.getAttribute("type") || "").trim()),
    }));
    assert.deepEqual(shape.labels, [Y.Y4, Y.Y5]);
    assert.deepEqual(shape.types, ["email", "password"]);
    assert.deepEqual(shape.submits, [Y.Y6]);
    assert.deepEqual(shape.linkButtons, [Y.Y20, Y.Y8]);
    assert.deepEqual(shape.order, ["email", "password", Y.Y20, Y.Y6, Y.Y8], "Email, Password, Y20, Sign in, Y8");
    assert.equal(shape.toggles, 0);
    assert.equal(shape.pressed, 0);
    assert.equal(norm(shape.o5), Y.O5);
    assert.equal(norm(shape.o7), Y.O7);
    assert.deepEqual(shape.links, [["terms", "/terms.html"], ["privacy notice", "/privacy.html"]]);
    assert.equal(norm(shape.s9), Y.S9);
    await noRetiredStrings(o.page, "Sign in view");
  } finally {
    await o.close();
  }
});

test("Y-2 Create an account view (after Y8): `Create account`, Y9, O5, O7; no Y20; the typed email is kept; Y9 returns", async () => {
  const o = await open({ events: [{ event: "INITIAL_SESSION" }] });
  try {
    await o.page.getByLabel("Email").fill("kept@example.com");
    await o.page.getByLabel("Password").fill("typed-on-sign-in");
    await o.page.getByRole("button", { name: Y.Y8 }).click();
    await o.page.getByRole("button", { name: Y.Y7, exact: true }).waitFor();
    assert.deepEqual(await o.page.evaluate(() => [...document.querySelectorAll("button[type=submit]")].map((b) => b.textContent)), [Y.Y7]);
    assert.equal(await o.page.getByRole("button", { name: Y.Y9 }).count(), 1);
    assert.equal(await o.page.getByRole("button", { name: Y.Y20 }).count(), 0, "Y20 absent");
    assert.equal(await o.page.getByRole("button", { name: Y.Y8 }).count(), 0);
    assert.equal(await o.page.getByLabel("Email").inputValue(), "kept@example.com");
    const t = norm(await o.page.evaluate(() => document.body.innerText));
    assert.ok(t.includes(Y.O5) && t.includes(Y.O7) && t.includes(Y.S9), t.slice(0, 400));
    assert.equal(await o.page.locator(".sign-in-mode-toggle, [aria-pressed]").count(), 0);
    await noRetiredStrings(o.page, "Create an account view");
    await o.page.getByRole("button", { name: Y.Y9 }).click();
    await signInShowing(o.page).waitFor();
    assert.equal(await o.page.getByLabel("Email").inputValue(), "kept@example.com", "email kept going back");
    assert.equal(await o.page.getByRole("button", { name: Y.Y20 }).count(), 1, "Y20 back on Sign in");
  } finally {
    await o.close();
  }
});

test("Y-3 `Create account`: Y11 with the address filled in, Y24 under it, O5 and O7 below; one signUp carrying the site address; Y24 returns with the email kept", async () => {
  const o = await open({ events: [{ event: "INITIAL_SESSION" }] });
  try {
    await o.page.getByRole("button", { name: Y.Y8 }).click();
    await o.page.getByLabel("Email").fill("new@example.com");
    await o.page.getByLabel("Password").fill("Correct-Horse-9");
    await o.page.getByRole("button", { name: Y.Y7, exact: true }).click();
    await o.page.getByRole("button", { name: Y.Y24 }).waitFor();
    const signUps = await callsOf(o.page, "signUp");
    assert.deepEqual(signUps.map((c) => c.args), [[{ email: "new@example.com", password: "Correct-Horse-9", options: { emailRedirectTo: SITE_URL } }]]);
    assert.equal((await calls(o.page)).filter((c) => /^signIn/.test(c.fn)).length, 0, "no sign-in call of any kind");
    const sent = norm((await o.page.locator(".sign-in-sent").textContent()) ?? "");
    assert.equal(sent, Y.Y11.replace("<email>", "new@example.com"));
    const order = await o.page.evaluate(() => ["sign-in-sent", "sign-in-link-button", "sign-in-invite", "sign-in-terms"].map((c) => document.querySelector(`.${c}`)?.getBoundingClientRect().top ?? -1));
    assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), `Y11, then Y24, then O5, then O7: ${JSON.stringify(order)}`);
    assert.equal(await o.page.locator("form").count(), 0, "in place of the form");
    const t = norm(await o.page.evaluate(() => document.body.innerText));
    assert.ok(t.includes(Y.O5) && t.includes(Y.O7), "O5 and O7 below");
    await noRetiredStrings(o.page, "confirmation state");
    await o.page.getByRole("button", { name: Y.Y24 }).click();
    await signInShowing(o.page).waitFor();
    assert.equal(await o.page.getByLabel("Email").inputValue(), "new@example.com", "email kept");
  } finally {
    await o.close();
  }
});

test("Y-4 errors: invalid_credentials is Y12 and email_not_confirmed is Y13; the shown text never contains the fake's error.message", async () => {
  for (const [code, line] of [["invalid_credentials", Y.Y12], ["email_not_confirmed", Y.Y13]] as const) {
    const o = await open({ events: [{ event: "INITIAL_SESSION" }], signIn: { error: { code, status: 400, message: `RAW-SUPABASE-TEXT for ${code}: do not show me` } } });
    try {
      await o.page.getByLabel("Email").fill(EMAIL);
      await o.page.getByLabel("Password").fill("wrong-password");
      await signInShowing(o.page).click();
      await o.page.locator(".sign-in-error").waitFor();
      assert.equal(norm((await o.page.locator(".sign-in-error").textContent()) ?? ""), line, code);
      const t = await everythingShown(o.page);
      assert.ok(!t.includes("RAW-SUPABASE"), `${code}: Supabase's own text shown`);
      await noRetiredStrings(o.page, `error ${code}`);
    } finally {
      await o.close();
    }
  }
});

test("Y-5 the reset card shows no Y27, no O5, O7 or S9, and none of the retired strings; nor does the expired-link state", async () => {
  const o = await openForgot({}, undefined, "#error=access_denied&error_code=otp_expired&error_description=x");
  try {
    const t = norm(await o.page.evaluate(() => document.body.innerText));
    assert.ok(!t.includes(Y.Y27) && !t.includes(Y.O5) && !t.includes(Y.S9), t.slice(0, 300));
    await noRetiredStrings(o.page, "reset card");
    await sendReset(o.page, EMAIL);
    await noRetiredStrings(o.page, "reset card, sent");
  } finally {
    await o.close();
  }
  // the expired-link state (Sign in view)
  const x = await open({ events: [{ event: "INITIAL_SESSION" }] }, { path: "#error=access_denied&error_code=otp_expired&error_description=x" });
  try {
    await x.page.getByText(Y.Y27).waitFor();
    await noRetiredStrings(x.page, "expired-link state");
  } finally {
    await x.close();
  }
});

test("Y-6 an old sign-in link still signs in: a valid #access_token=...&type=magiclink goes on to the membership check, no recovery screen, authRedirectFromUrl answers none", async () => {
  assert.equal(authRedirectFromUrl("https://ten.example.app/#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=magiclink"), "none");
  const o = await open({ signedIn: true, member: false, events: [{ event: "INITIAL_SESSION" }] }, { path: "#access_token=fake-access-token&expires_in=3600&refresh_token=fake-refresh&token_type=bearer&type=magiclink" });
  try {
    await o.page.getByText(O2_PAUSED).waitFor();
    assert.equal(await memberChecks(o.page), 1, "the membership check ran");
    assert.equal(await o.page.getByRole("heading", { name: COPY.recoveryTitle }).count(), 0, "no recovery screen");
  } finally {
    await o.close();
  }
});

test("Y-7 a sign-in error does not follow the person to the reset card or back; minLength is on the Create view's password field only", async () => {
  const o = await open({ events: [{ event: "INITIAL_SESSION" }], signIn: { error: { code: "invalid_credentials", status: 400, message: "RAW-SUPABASE-TEXT" } } });
  try {
    await signInShowing(o.page).waitFor();
    assert.equal(await o.page.getByLabel("Password").getAttribute("minlength"), null, "Sign in: an existing shorter password must reach the server");
    await o.page.getByLabel("Email").fill(EMAIL);
    await o.page.getByLabel("Password").fill("short7!");
    await signInShowing(o.page).click();
    await o.page.locator(".sign-in-error").waitFor();
    assert.equal((await callsOf(o.page, "signInWithPassword")).length, 1, "the 7-character password was sent");
    await o.page.getByRole("button", { name: Y.Y20 }).click();
    await o.page.getByRole("heading", { name: COPY.resetTitle }).waitFor();
    await o.page.getByRole("button", { name: Y.Y24 }).click();
    await signInShowing(o.page).waitFor();
    assert.equal(await o.page.locator(".sign-in-error").count(), 0, "the old error is gone after Y20 and Back to sign in");
    // and the same for the error shown on Create then Y9
    await o.page.getByRole("button", { name: Y.Y8 }).click();
    assert.equal(await o.page.getByLabel("Password").getAttribute("minlength"), String(MIN_PASSWORD_LENGTH), "Create: the 8-character floor");
  } finally {
    await o.close();
  }
});

// ================================================================ 11. the create link (ui § 1.4, amended 2026-10-08)
//
// Proved-by items 1, 2, 4, 5, 6, 8 (the fake's half) and 9 against the fake. The pure function
// (item 3) is apps/web/src/backend/auth.test.ts; the stand-in's half (7, 8, 10) is tests/e2e-real/e2e.ts.

const CREATE_ACCEPTED = ["?signup", "?signup=", "?signup=1", "?utm_source=x&signup&ref=y", "?signup=0"];
const CREATE_REJECTED = ["", "?Signup", "?sign-up", "?signup2", "?create", "?view=signup", "#signup"];
const createViewShowing = (page: Page) => page.getByRole("button", { name: "Create account", exact: true });

test("CL-1 each accepted address opens Create an account: `Create account`, Y9, O5, O7; no Y20, no Y27; the query is gone; a reload opens Sign in", async () => {
  for (const q of CREATE_ACCEPTED) {
    const o = await open({ events: [{ event: "INITIAL_SESSION" }] }, { path: q });
    try {
      await createViewShowing(o.page).waitFor();
      assert.equal(await o.page.getByRole("button", { name: Y.Y9 }).count(), 1, `${q}: Y9`);
      assert.equal(await o.page.getByRole("button", { name: Y.Y20 }).count(), 0, `${q}: Y20`);
      assert.equal(await o.page.getByRole("button", { name: Y.Y8 }).count(), 0, `${q}: Y8`);
      const t = norm(await o.page.evaluate(() => document.body.innerText));
      assert.ok(t.includes(Y.O5) && t.includes(Y.O7) && !t.includes(Y.Y27), `${q}: O5, O7, no Y27`);
      await noRetiredStrings(o.page, `create link ${q}`);
      const loc = await o.page.evaluate(() => ({ search: location.search, hash: location.hash, path: location.pathname }));
      assert.deepEqual(loc, { search: "", hash: "", path: "/" }, `${q}: the address is the plain one`);
      await o.page.reload();
      await signInShowing(o.page).waitFor();
      assert.equal(await o.page.getByRole("button", { name: Y.Y8 }).count(), 1, `${q}: a reload opens Sign in, Y8 one tap away`);
    } finally {
      await o.close();
    }
  }
});

test("CL-2 each rejected address opens Sign in, and the address is left as it was", async () => {
  for (const q of CREATE_REJECTED) {
    const o = await open({ events: [{ event: "INITIAL_SESSION" }] }, { path: q });
    try {
      await signInShowing(o.page).waitFor();
      await settle(o.page);
      assert.equal(await createViewShowing(o.page).count(), 0, q);
      const loc = await o.page.evaluate(() => location.search + location.hash);
      assert.equal(loc, q, `${q || "(plain)"}: the address is unchanged`);
    } finally {
      await o.close();
    }
  }
  // tags with no `signup` stay in the address bar, unread
  const t = await open({ events: [{ event: "INITIAL_SESSION" }] }, { path: "?utm_source=x&ref=y" });
  try {
    await signInShowing(t.page).waitFor();
    await settle(t.page);
    assert.equal(await t.page.evaluate(() => location.search), "?utm_source=x&ref=y");
  } finally {
    await t.close();
  }
});

test("CL-4 signed in: `?signup` never shows the card, the address ends plain; signing out afterwards opens Sign in (the real member screen and sign-out are the e2e's)", async () => {
  // a signed-in non-member: the not-a-member screen, then Sign out
  const o = await open({ signedIn: true, member: false, events: [{ event: "INITIAL_SESSION" }] }, { path: "?signup&utm_source=x" });
  try {
    await o.page.getByText(O2_PAUSED).waitFor();
    assert.equal(await createViewShowing(o.page).count(), 0);
    assert.equal(await o.page.evaluate(() => location.search), "", "the address ends as the plain one");
    await o.page.getByRole("button", { name: "Sign out" }).click();
    await signInShowing(o.page).waitFor();
    assert.equal(await createViewShowing(o.page).count(), 0, "the yes was dropped, so Sign in opens");
  } finally {
    await o.close();
  }
  // a signed-in member (the harness has no workspace backend, so only "not the card" is asserted)
  const m = await open({ signedIn: true, member: true, events: [{ event: "INITIAL_SESSION" }] }, { path: "?signup" });
  try {
    await settle(m.page, 1500);
    assert.equal(await createViewShowing(m.page).count(), 0);
    assert.equal(await m.page.locator(".sign-in-screen").count(), 0);
    assert.equal(await m.page.evaluate(() => location.search), "");
  } finally {
    await m.close();
  }
});

test("CL-4b the yes is used once: from `?signup`, signing in and then signing out opens Sign in, not Create", async () => {
  const o = await open({ events: [{ event: "INITIAL_SESSION" }], member: false }, { path: "?signup" });
  try {
    await createViewShowing(o.page).waitFor();
    await o.page.getByRole("button", { name: Y.Y9 }).click();
    await o.page.getByLabel("Email").fill(EMAIL);
    await o.page.getByLabel("Password").fill("correct horse battery");
    await signInShowing(o.page).click();
    await o.page.getByText(O2_PAUSED).waitFor();
    await o.page.getByRole("button", { name: "Sign out" }).click();
    await signInShowing(o.page).waitFor();
    assert.equal(await createViewShowing(o.page).count(), 0);
  } finally {
    await o.close();
  }
});

test("CL-5 a redirect wins over `signup`: an expired link shows Y27 above Sign in; a recovery link shows 'Choose a new password'; a valid sign-up link goes on to the membership check", async () => {
  const err = "error=access_denied&error_code=otp_expired&error_description=x";
  for (const p of [`?signup&${err}`, `?signup#${err}`]) {
    const o = await open({ events: [{ event: "INITIAL_SESSION" }] }, { path: p });
    try {
      await o.page.getByText(Y.Y27).waitFor();
      await signInShowing(o.page).waitFor();
      assert.equal(await createViewShowing(o.page).count(), 0, p);
    } finally {
      await o.close();
    }
  }
  const r = await open(
    { signedIn: true, member: true, events: [{ event: "INITIAL_SESSION" }, { event: "PASSWORD_RECOVERY", delay: 5 }] },
    { path: "?signup" + RECOVERY_HASH },
  );
  try {
    await r.page.getByRole("heading", { name: COPY.recoveryTitle }).waitFor();
    assert.equal(await createViewShowing(r.page).count(), 0);
  } finally {
    await r.close();
  }
  const s = await open({ signedIn: true, member: false, events: [{ event: "INITIAL_SESSION" }] }, { path: "?signup#access_token=fake-access-token&expires_in=3600&refresh_token=fake-refresh&token_type=bearer&type=signup" });
  try {
    await s.page.getByText(O2_PAUSED).waitFor();
    assert.equal(await memberChecks(s.page), 1, "the membership check ran");
    assert.equal(await createViewShowing(s.page).count(), 0);
  } finally {
    await s.close();
  }
});

test("CL-6 tags go nowhere: after create-account from a tagged link, no call, request, storage, cookie or console line holds TAGMARK; the sign-up carries the plain site address", async () => {
  const o = await open({ events: [{ event: "INITIAL_SESSION" }] }, { path: "?signup&utm_source=TAGMARK1&utm_campaign=TAGMARK2&ref=TAGMARK3" });
  try {
    await createViewShowing(o.page).waitFor();
    await o.page.getByLabel("Email").fill("tagged@example.com");
    await o.page.getByLabel("Password").fill("Correct-Horse-9");
    await createViewShowing(o.page).click();
    await o.page.getByRole("button", { name: Y.Y24 }).waitFor();
    const signUps = await callsOf(o.page, "signUp");
    assert.deepEqual(signUps.map((c) => c.args), [[{ email: "tagged@example.com", password: "Correct-Horse-9", options: { emailRedirectTo: SITE_URL } }]], "one sign-up, the plain site address");
    // the page's own request/console/storage/history logs (requests[0] is the navigation itself, which carries the address by definition)
    const inPage = await o.page.evaluate(() => JSON.stringify({ leak: (window as any).__leak, href: location.href, ls: { ...localStorage }, ss: { ...sessionStorage }, cookie: document.cookie, title: document.title, historyState: history.state }));
    const dump = JSON.stringify(await calls(o.page)) + inPage + o.requests.slice(1).join("\n") + o.console.join("\n");
    assert.ok(!dump.includes("TAGMARK"), "TAGMARK found in a call, a later request, a console line or the page's own storage/history log");
    assert.ok(!(await o.page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie)).includes("TAGMARK"));
  } finally {
    await o.close();
  }
});

test("CL-9 from a create-link start: Y9 opens Sign in with the email kept and Y20 showing; Y8 returns to Create; after `Create account`, Y24 opens Sign in", async () => {
  const o = await open({ events: [{ event: "INITIAL_SESSION" }] }, { path: "?signup" });
  try {
    await createViewShowing(o.page).waitFor();
    await o.page.getByLabel("Email").fill("kept@example.com");
    await o.page.getByRole("button", { name: Y.Y9 }).click();
    await signInShowing(o.page).waitFor();
    assert.equal(await o.page.getByLabel("Email").inputValue(), "kept@example.com");
    assert.equal(await o.page.getByRole("button", { name: Y.Y20 }).count(), 1);
    await o.page.getByRole("button", { name: Y.Y8 }).click();
    await createViewShowing(o.page).waitFor();
    await o.page.getByLabel("Password").fill("Correct-Horse-9");
    await createViewShowing(o.page).click();
    await o.page.getByRole("button", { name: Y.Y24 }).click();
    await signInShowing(o.page).waitFor();
    assert.equal(await o.page.getByLabel("Email").inputValue(), "kept@example.com");
  } finally {
    await o.close();
  }
});

test("CL-10 a doubled slash path never blanks the page: `//?signup` opens Create and ends at `/`; `//` opens Sign in; `//#error_code=otp_expired` shows Y27 above Sign in with a clean address; no page error", async () => {
  const run = async (suffix: string) => {
    const o = await open({ events: [{ event: "INITIAL_SESSION" }] }, { path: suffix });
    const errors: string[] = [];
    o.page.on("pageerror", (e) => errors.push(String(e)));
    return { o, errors };
  };
  // `open` navigates to base + path, and base ends with "/", so "/?signup" is the address "//?signup"
  const a = await run("/?signup");
  try {
    await createViewShowing(a.o.page).waitFor({ timeout: 8000 });
    assert.equal(await a.o.page.evaluate(() => location.pathname + location.search + location.hash), "/", "the address ends at /");
    assert.deepEqual(a.errors, []);
    assert.ok(!(await a.o.page.evaluate(() => (window as any).__leak?.history ?? [])).some((h: string) => h.includes("//")), "replaceState was never given a doubled slash");
  } finally {
    await a.o.close();
  }
  const b = await run("/");
  try {
    await signInShowing(b.o.page).waitFor({ timeout: 8000 });
    assert.equal(await createViewShowing(b.o.page).count(), 0);
    assert.deepEqual(b.errors, []);
  } finally {
    await b.o.close();
  }
  const c = await run("/#error=access_denied&error_code=otp_expired&error_description=x");
  try {
    await c.o.page.getByText(Y.Y27).waitFor({ timeout: 8000 });
    await signInShowing(c.o.page).waitFor();
    await settle(c.o.page);
    assert.equal(await c.o.page.evaluate(() => location.pathname + location.search + location.hash), "/", "the address is clean");
    assert.equal(await createViewShowing(c.o.page).count(), 0);
    assert.deepEqual(c.errors, []);
  } finally {
    await c.o.close();
  }
});
