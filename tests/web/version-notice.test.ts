// Tester-owned acceptance tests for docs/design-web-agent.md § 10 (a newer
// version is live) — § 10.4 items (iii) detection, (iv) when, (v) pre-send,
// (vi) UI — and docs/design-web-ui.md § 1.8, written from the spec
// (commit 7574d24), not the code.
//
// What runs: a PRODUCTION build (the real apps/web/vite.config.ts: its
// `define` and version.json plugin) of tests/web/version/harness.tsx, which
// mounts the REAL member chat screen (RealChatShell, useChat, Composer,
// VersionNotice, useVersionMonitor on the real document/window) over a real
// createCoach and the real OpenRouter provider. Headless Chromium
// (apps/web's Playwright). Playwright routes answer /version.json and the
// model proxy, and count every request — nothing leaves the machine.
//
// Run: node --test tests/web/version-notice.test.ts
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page, type Route } from "../../apps/web/node_modules/playwright/index.mjs";
import { sse, textReply, toolReply } from "../agent/_openrouter_stub.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const HARNESS = path.join(HERE, "version");

// ---------------------------------------------------------------- the spec's copy (ui § 1.8)

const UI = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8").replace(/\s+/g, " ");
const S18 = UI.slice(UI.indexOf("### 1.8 A newer version is live"), UI.indexOf("## 2. The card catalog"));
const NOTICE_COPY = S18.match(/Notice, with a `Reload` button: "([^"]+)"/)?.[1] ?? "(§ 1.8 notice copy not found)";
const BLOCKED_COPY = S18.match(/After a blocked send \(C § 10\.3\): "([^"]+)"/)?.[1] ?? "(§ 1.8 blocked copy not found)";

// ---------------------------------------------------------------- build + serve the harness

let server: Server;
let base = "";
let browser: Browser;
let outDir = "";

before(async () => {
  const link = path.join(HARNESS, "node_modules");
  if (!existsSync(link)) symlinkSync("../../../apps/web/node_modules", link);
  assert.ok(lstatSync(link).isSymbolicLink());
  outDir = mkdtempSync(path.join(tmpdir(), "ten-version-harness-"));
  const vite = path.join(REPO, "apps/web/node_modules/vite/bin/vite.js");
  const b = spawnSync(process.execPath, [vite, "build", HARNESS, "--config", path.join(REPO, "apps/web/vite.config.ts"), "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"], { cwd: REPO, encoding: "utf8" });
  assert.equal(b.status, 0, `harness build failed:\n${b.stdout}\n${b.stderr}`);
  const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
  server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const file = path.join(outDir, p === "/" ? "index.html" : p);
    if (!file.startsWith(outDir) || !existsSync(file) || lstatSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
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

type VersionMode =
  | { kind: "same" }
  | { kind: "id"; id: unknown }
  | { kind: "status"; status: number; body?: string }
  | { kind: "reject" }
  | { kind: "badjson" }
  | { kind: "slow"; ms: number; id: string }
  | { kind: "raw"; body: string };

interface Harness {
  page: Page;
  version: { mode: VersionMode; hits: number; cacheHeaders: string[] };
  proxy: { hits: number; bodies: any[]; replies: any[]; delayMs: number };
  builtId: string;
  setVisible(v: boolean): Promise<void>;
  focus(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(opts: { viewport?: { width: number; height: number }; mode?: VersionMode; clock?: boolean; replies?: any[] } = {}): Promise<Harness> {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 800 }, hasTouch: (opts.viewport?.width ?? 1280) < 500 });
  const page = await ctx.newPage();
  const h: Harness = {
    page,
    version: { mode: opts.mode ?? { kind: "same" }, hits: 0, cacheHeaders: [] },
    proxy: { hits: 0, bodies: [], replies: opts.replies ?? [], delayMs: 0 },
    builtId: "",
    async setVisible(v: boolean) {
      await page.evaluate((vis) => {
        (window as any).__vis = vis ? "visible" : "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
      }, v);
    },
    async focus() {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    },
  };
  // document.visibilityState, controllable (headless pages are always "visible");
  // and every /version.json fetch's own `cache` option (Chromium sends no
  // request header for cache: "no-store", so it is observed at the call).
  await page.addInitScript(() => {
    (window as any).__versionFetchInit = [];
    const realFetch = window.fetch;
    window.fetch = function (input: any, init?: any) {
      if (String(input?.url ?? input).includes("version.json")) (window as any).__versionFetchInit.push(init?.cache ?? "(none)");
      return realFetch.call(this, input, init);
    } as any;
    (window as any).__vis = "visible";
    Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => (window as any).__vis });
    Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => (window as any).__vis !== "visible" });
  });
  if (opts.clock) await page.clock.install();
  await page.route("**/version.json", async (route: Route) => {
    h.version.hits++;
    h.version.cacheHeaders.push(route.request().headers()["cache-control"] ?? "");
    const m = h.version.mode;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (m.kind === "same") return json({ id: h.builtId || (await page.evaluate(() => (window as any).__h?.builtId)) });
    if (m.kind === "id") return json({ id: m.id });
    if (m.kind === "status") return route.fulfill({ status: m.status, body: m.body ?? "nope" });
    if (m.kind === "reject") return route.abort("failed");
    if (m.kind === "badjson") return route.fulfill({ status: 200, contentType: "application/json", body: '{"id": "abc' });
    if (m.kind === "raw") return route.fulfill({ status: 200, contentType: "application/json", body: m.body });
    if (m.kind === "slow") {
      await sleep(m.ms);
      return json({ id: m.id }).catch(() => {});
    }
  });
  await page.route("**/stub-proxy/**", async (route: Route) => {
    h.proxy.hits++;
    h.proxy.bodies.push(route.request().postDataJSON());
    if (h.proxy.delayMs) await sleep(h.proxy.delayMs);
    const reply = h.proxy.replies.shift() ?? textReply("Reply from the stub proxy.", 0.001);
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: reply.body() });
  });
  await page.goto(base);
  await page.waitForFunction(() => (window as any).__h?.builtId);
  h.builtId = await page.evaluate(() => (window as any).__h.builtId);
  await page.locator(".composer-input").waitFor();
  return h;
}

const notice = (page: Page) => page.locator(".version-notice");
const noticeText = (page: Page) => page.locator(".version-notice-text").innerText();
async function settle(page: Page, ms = 250) {
  await page.waitForTimeout(ms);
}
async function typeAndSend(page: Page, text: string) {
  await page.locator(".composer-input").fill(text);
  await page.locator(".composer-input").press("Enter");
}
async function waitIdle(page: Page) {
  await page.waitForFunction(() => {
    const t = document.querySelector(".composer-input") as HTMLTextAreaElement | null;
    return t && !t.disabled;
  }, null, { timeout: 20000 });
  await settle(page, 150);
}
const userBubbles = (page: Page) => page.locator(".transcript .msg--user, .transcript [data-role='user']").count();
async function transcriptHas(page: Page, text: string) {
  return (await page.locator(".transcript").innerText().catch(() => "")).includes(text);
}

// ---------------------------------------------------------------- the spec's copy is readable

test("§ 1.8 copy was read from the doc", () => {
  assert.ok(NOTICE_COPY.startsWith("Ten has been updated."), NOTICE_COPY);
  assert.ok(BLOCKED_COPY.startsWith("Not sent:"), BLOCKED_COPY);
});

// ---------------------------------------------------------------- (iii) detection + (v) the send goes through

test("(i)/(iii) the built-in id is the build's id and /version.json is fetched with cache: no-store", async () => {
  const h = await open();
  assert.match(h.builtId, /^([0-9a-f]{7,40}|nogit)-\d{8}T\d{6}Z$/, "the harness build inlined a § 10.1-format id");
  const emitted = JSON.parse(readFileSync(path.join(outDir, "version.json"), "utf8"));
  assert.deepEqual(emitted, { id: h.builtId }, "the running bundle's id IS the id its build wrote to version.json (one value feeds both)");
  await settle(h.page);
  assert.ok(h.version.hits >= 1);
  const modes = await h.page.evaluate(() => (window as any).__versionFetchInit);
  assert.ok(modes.length >= 1 && modes.every((c: string) => c === "no-store"), `every /version.json fetch uses cache: "no-store": ${JSON.stringify(modes)}`);
  await h.page.context().close();
});

test("(iii)+(v) same id: no notice, and a send is sent exactly once", async () => {
  const h = await open({ mode: { kind: "same" } });
  await settle(h.page);
  assert.equal(await notice(h.page).count(), 0, "no notice");
  await typeAndSend(h.page, "Is the Acme role worth it?");
  await waitIdle(h.page);
  assert.equal(h.proxy.hits, 1, "exactly one model request");
  assert.ok(await transcriptHas(h.page, "Is the Acme role worth it?"));
  assert.ok(await transcriptHas(h.page, "Reply from the stub proxy."));
  assert.equal(await notice(h.page).count(), 0);
  await h.page.context().close();
});

const IGNORED: Array<[string, VersionMode]> = [
  ["a network rejection", { kind: "reject" }],
  ["a 404", { kind: "status", status: 404 }],
  ["a 500", { kind: "status", status: 500 }],
  ["bad JSON", { kind: "badjson" }],
  ["no id", { kind: "raw", body: JSON.stringify({ version: "zzz" }) }],
  ["an empty id", { kind: "id", id: "" }],
  ["a non-string id", { kind: "id", id: 12345 }],
  ["a JSON null body", { kind: "raw", body: "null" }],
];
for (const [label, mode] of IGNORED) {
  test(`(iii)+(v) ${label}: no notice, nothing blocked, and a send is sent exactly once`, async () => {
    const h = await open({ mode });
    await settle(h.page);
    assert.equal(await notice(h.page).count(), 0, "no notice");
    const before = h.version.hits;
    await typeAndSend(h.page, "Draft my cover letter");
    await waitIdle(h.page);
    assert.ok(h.version.hits > before, "the pre-send check ran");
    assert.equal(h.proxy.hits, 1, "sent once");
    assert.ok(await transcriptHas(h.page, "Draft my cover letter"));
    assert.equal(await notice(h.page).count(), 0);
    await h.page.context().close();
  });
}

test("(iii)+(v) a check over 2 s is ignored even though its (late) id differs: no notice, and the send goes through once", async () => {
  const h = await open({ mode: { kind: "slow", ms: 2600, id: "zzzzzzz-20990101T000000Z" } });
  await h.page.waitForTimeout(2900); // the mount check times out
  assert.equal(await notice(h.page).count(), 0, "no notice after the timed-out mount check");
  const t0 = Date.now();
  await typeAndSend(h.page, "Send me anyway");
  await waitIdle(h.page);
  const took = Date.now() - t0;
  assert.equal(h.proxy.hits, 1, "sent once");
  assert.ok(took < 2600 + 2000, `the send waited for the 2 s timeout, not the slow response (${took} ms)`);
  await h.page.waitForTimeout(800);
  assert.equal(await notice(h.page).count(), 0, "the late response never counts");
  await h.page.context().close();
});

test("(iii) a different id: the notice shows (a rollback counts: differs, not higher)", async () => {
  const h = await open({ mode: { kind: "id", id: "0000000-19700101T000000Z" } });
  await notice(h.page).waitFor({ timeout: 5000 });
  assert.equal(await noticeText(h.page), NOTICE_COPY, "§ 1.8 copy, word for word");
  await h.page.context().close();
});

// ---------------------------------------------------------------- (v) pre-send

const MESSAGE = "Evaluate these two roles:\n  • Acme — Staff PM (remote)\n  • Nimbus — Analytics Lead ✓\nthanks";

test("(v) newer known at load: the send is NOT sent — no sendMessages, no proxy request, text restored word for word, the 'not sent' line shows", async () => {
  const h = await open({ mode: { kind: "id", id: "9999999-20990101T000000Z" } });
  await notice(h.page).waitFor();
  await typeAndSend(h.page, MESSAGE);
  await waitIdle(h.page);
  assert.equal(h.proxy.hits, 0, "no proxy request");
  assert.equal(await h.page.locator(".composer-input").inputValue(), MESSAGE, "the composer holds the text, word for word");
  assert.ok(!(await transcriptHas(h.page, "Nimbus — Analytics Lead")), "no user message was added (sendMessages never called)");
  assert.equal(await noticeText(h.page), BLOCKED_COPY, "the 'not sent' line, word for word");
  await h.page.context().close();
});

test("(v) newer deployed AFTER load, found only by the pre-send check: not sent, text restored, 'not sent' line", async () => {
  const h = await open({ mode: { kind: "same" } });
  await settle(h.page);
  assert.equal(await notice(h.page).count(), 0);
  h.version.mode = { kind: "id", id: "abcdef0-20990101T000000Z" }; // a deploy; no focus, no poll yet
  await typeAndSend(h.page, MESSAGE);
  await waitIdle(h.page);
  assert.equal(h.proxy.hits, 0, "no proxy request");
  assert.equal(await h.page.locator(".composer-input").inputValue(), MESSAGE);
  assert.equal(await noticeText(h.page), BLOCKED_COPY);
  await h.page.context().close();
});

test("(v) the composer is disabled while the pre-send check runs, as while a turn is submitted", async () => {
  const h = await open({ mode: { kind: "same" } });
  await settle(h.page);
  h.version.mode = { kind: "slow", ms: 1200, id: h.builtId };
  await typeAndSend(h.page, "hello there");
  await h.page.waitForTimeout(300);
  assert.equal(h.proxy.hits, 0, "nothing sent before the check answers");
  assert.ok(await h.page.locator(".composer-input").isDisabled(), "disabled during the check");
  await waitIdle(h.page);
  assert.equal(h.proxy.hits, 1, "then sent once");
  await h.page.context().close();
});

test("(v) a typed 'yes' at a pending gate with a newer id: not sent, and the gate stays pending", async () => {
  const BIG = { action: "Evaluate six saved roles", steps: 500, webSearches: 6, items: ["Acme — Staff PM", "Nimbus — Analytics Lead"] };
  const h = await open({ mode: { kind: "same" }, replies: [toolReply("estimate_cost", BIG, 0.001)] });
  await settle(h.page);
  await typeAndSend(h.page, "Evaluate all six saved roles");
  await waitIdle(h.page);
  assert.equal(h.proxy.hits, 1);
  const pendingBefore = await h.page.evaluate(() => (window as any).__h.pending());
  assert.ok(pendingBefore, "precondition: a spend gate is pending");
  h.version.mode = { kind: "id", id: "1234567-20990101T000000Z" };
  await typeAndSend(h.page, "yes");
  await waitIdle(h.page);
  assert.equal(h.proxy.hits, 1, "no proxy request for the yes");
  assert.equal(await h.page.locator(".composer-input").inputValue(), "yes", "the yes is back in the composer");
  const pendingAfter = await h.page.evaluate(() => (window as any).__h.pending());
  assert.ok(pendingAfter && pendingAfter.gateId === pendingBefore.gateId, "the gate is still pending");
  assert.equal(await noticeText(h.page), BLOCKED_COPY);
  await h.page.context().close();
});

// ---------------------------------------------------------------- (iv) when (fake timers)

/** Advances the page's fake clock, then lets the (real) route handler see
 *  any request the fired timers started. */
async function advance(h: Harness, ms: number) {
  await h.page.clock.runFor(ms);
  await sleep(200);
}

test("(iv) checks on mount, visible, focus, every 5 min while visible; none while hidden or once newer is known", async () => {
  const h = await open({ mode: { kind: "same" }, clock: true });
  await advance(h, 500);
  assert.equal(h.version.hits, 1, "on mount: one check");

  await h.setVisible(true);
  await advance(h, 100);
  assert.equal(h.version.hits, 2, "on becoming visible");

  await h.focus();
  await advance(h, 100);
  assert.equal(h.version.hits, 3, "on window focus");

  await advance(h, 5 * 60 * 1000);
  assert.equal(h.version.hits, 4, "5 minutes while visible");
  await advance(h, 5 * 60 * 1000);
  assert.equal(h.version.hits, 5, "and again");

  await h.setVisible(false);
  await advance(h, 100);
  assert.equal(h.version.hits, 5, "becoming hidden checks nothing");
  await advance(h, 15 * 60 * 1000);
  assert.equal(h.version.hits, 5, "no polls while hidden");
  await h.focus();
  await advance(h, 100);
  assert.equal(h.version.hits, 5, "a focus event while hidden checks nothing");

  await h.setVisible(true);
  await advance(h, 100);
  assert.equal(h.version.hits, 6, "visible again: one check");

  h.version.mode = { kind: "id", id: "fedcba9-20990101T000000Z" };
  await h.focus();
  await advance(h, 100);
  assert.equal(h.version.hits, 7, "the check that finds newer");
  await notice(h.page).waitFor();

  await h.focus();
  await h.setVisible(true);
  await advance(h, 30 * 60 * 1000);
  assert.equal(h.version.hits, 7, "once newer is known, checks stop (focus, visible, polls)");
  await typeAndSend(h.page, "one more thing");
  await advance(h, 500);
  assert.equal(h.version.hits, 7, "even the pre-send check fetches nothing once newer is known");
  assert.equal(h.proxy.hits, 0, "and the send is blocked");
  await h.page.context().close();
});

// ---------------------------------------------------------------- (vi) UI

test("(vi) hidden during a turn, shown after it ends", async () => {
  const h = await open({ mode: { kind: "same" } });
  await settle(h.page);
  h.proxy.delayMs = 1500;
  await typeAndSend(h.page, "Take your time");
  await h.page.waitForTimeout(300);
  assert.ok(await h.page.locator(".composer-input").isDisabled(), "precondition: a turn is running");
  h.version.mode = { kind: "id", id: "7777777-20990101T000000Z" };
  await h.focus();
  await h.page.waitForTimeout(300);
  assert.equal(await notice(h.page).count(), 0, "hidden while the turn runs");
  await waitIdle(h.page);
  await notice(h.page).waitFor({ timeout: 3000 });
  assert.equal(await noticeText(h.page), NOTICE_COPY, "shown after, with the § 1.8 copy");
  await h.page.context().close();
});

test("(vi) one line above the composer, one Reload button, not dismissible, neutral styling", async () => {
  const h = await open({ mode: { kind: "id", id: "2222222-20990101T000000Z" } });
  await notice(h.page).waitFor();
  const shape = await h.page.evaluate(() => {
    const n = document.querySelector(".version-notice")!;
    const buttons = [...n.querySelectorAll("button, [role=button], a")].map((b) => (b as HTMLElement).innerText.trim());
    const cs = getComputedStyle(n);
    return { next: n.nextElementSibling?.className ?? "", buttons, bg: cs.backgroundColor, color: cs.color, cls: n.className };
  });
  assert.match(shape.next, /\bcomposer\b/, "directly above the composer");
  assert.deepEqual(shape.buttons, ["Reload"], "one action, no close");
  assert.ok(!/error|danger|alert|warn/i.test(shape.cls), `neutral class: ${shape.cls}`);
  const red = (c: string) => { const m = c.match(/\d+/g)?.map(Number) ?? []; return m.length >= 3 && m[0] > 150 && m[1] < 110 && m[2] < 110; };
  assert.ok(!red(shape.bg) && !red(shape.color), `no alarm colour: ${shape.bg} / ${shape.color}`);
  await h.page.context().close();
});

for (const theme of ["light", "dark"] as const) {
  test(`(vi) v2 styling (${theme}): the notice's text and Reload label meet WCAG AA (4.5:1) as rendered`, async () => {
    const h = await open({ mode: { kind: "id", id: "6666666-20990101T000000Z" } });
    if (theme === "dark") {
      await h.page.locator(".menu-trigger").click();
      await h.page.getByRole("menuitem", { name: "Switch to dark" }).click();
    }
    await notice(h.page).waitFor();
    const r = await h.page.evaluate(() => {
      const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/)!; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
      const over = (t: any, b: any) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
      const lum = (c: any) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const ratioOf = (el: Element) => {
        const chain: Element[] = [];
        for (let n: Element | null = el; n; n = n.parentElement) chain.unshift(n);
        let bg = { r: 255, g: 255, b: 255, a: 1 };
        let op = 1;
        for (const n of chain) { const s = getComputedStyle(n); const c = parse(s.backgroundColor); if (c.a > 0) bg = over(c, bg); op *= Number(s.opacity); }
        const fg0 = parse(getComputedStyle(el).color);
        const fg = over({ ...fg0, a: fg0.a * op }, bg);
        const [x, y] = [lum(fg), lum(bg)].sort((a, b) => b - a);
        return (x + 0.05) / (y + 0.05);
      };
      return {
        theme: document.querySelector(".app-root")?.getAttribute("data-theme"),
        text: ratioOf(document.querySelector(".version-notice-text")!),
        button: ratioOf(document.querySelector(".version-notice-reload")!),
      };
    });
    assert.equal(r.theme, theme);
    assert.ok(r.text >= 4.5, `notice text ${r.text.toFixed(2)}:1`);
    assert.ok(r.button >= 4.5, `Reload label ${r.button.toFixed(2)}:1`);
    await h.page.context().close();
  });
}

test("(vi) Reload calls location.reload()", async () => {
  const h = await open({ mode: { kind: "id", id: "3333333-20990101T000000Z" } });
  await notice(h.page).waitFor();
  await h.page.evaluate(() => { (window as any).__beforeReload = 1; });
  await Promise.all([h.page.waitForEvent("load"), h.page.locator(".version-notice-reload").click()]);
  const after = await h.page.evaluate(() => ({ marker: (window as any).__beforeReload, nav: (performance.getEntriesByType("navigation")[0] as any)?.type }));
  assert.equal(after.marker, undefined, "a fresh document");
  assert.equal(after.nav, "reload", "navigation type is reload");
  await h.page.context().close();
});

for (const mode of ["newer", "blocked"] as const) {
  test(`(vi) 375 px: the ${mode} notice fits, and Reload is a ≥ 44 px target`, async () => {
    const h = await open({ viewport: { width: 375, height: 812 }, mode: { kind: "id", id: "4444444-20990101T000000Z" } });
    await notice(h.page).waitFor();
    if (mode === "blocked") {
      await typeAndSend(h.page, "hello");
      await waitIdle(h.page);
      assert.equal(await noticeText(h.page), BLOCKED_COPY);
    }
    const m = await h.page.evaluate(() => {
      const n = document.querySelector(".version-notice")!.getBoundingClientRect();
      const b = document.querySelector(".version-notice-reload")!.getBoundingClientRect();
      const t = document.querySelector(".version-notice-text")!;
      return { nLeft: n.left, nRight: n.right, bW: b.width, bH: b.height, bRight: b.right, scrollW: document.documentElement.scrollWidth, textOverflow: t.scrollWidth > (t as HTMLElement).clientWidth + 1 };
    });
    assert.ok(m.nLeft >= 0 && m.nRight <= 375 + 0.5, `notice within 375 px: ${JSON.stringify(m)}`);
    assert.ok(m.bRight <= 375 + 0.5, "Reload on screen");
    assert.ok(m.bH >= 44 && m.bW >= 44, `Reload target ${m.bW}×${m.bH}`);
    assert.ok(m.scrollW <= 375, `no horizontal scroll (${m.scrollW})`);
    assert.ok(!m.textOverflow, "the copy wraps, never clipped");
    await h.page.context().close();
  });
}

test("(vi) the notice alone disables nothing: composer, Send, attach and the menu stay usable", async () => {
  const h = await open({ mode: { kind: "id", id: "5555555-20990101T000000Z" } });
  await notice(h.page).waitFor();
  const input = h.page.locator(".composer-input");
  assert.ok(await input.isEnabled(), "composer enabled");
  await input.fill("draft text");
  assert.ok(await h.page.locator(".composer-send").isEnabled(), "Send enabled");
  assert.ok(await h.page.locator(".composer-attach").isEnabled(), "attach enabled");
  const menu = h.page.locator(".app-header .menu-trigger");
  assert.ok(await menu.isEnabled(), "header menu enabled");
  await h.page.context().close();
});
