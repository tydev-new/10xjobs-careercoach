// Tester-owned: workspace Stage 2, "the frame" — docs/design-web-ui.md
// § 5.9 Stage 2's exit and tester checks, measured against § 5.1 (the
// frame), § 5.2 rules 1-2, § 5.3's empty texts, § 5.4 (Continue with Ten),
// § 5.5 (phone) and § 5.6's Stage 2 layouts. Every expected value is read
// from the spec text; written independently of the builder's own
// tests/web/stage2-frame.test.ts.
//
// Two builds, headless Chromium:
//   - the mock preview (VITE_SHOW_MOCK_CONTROLS=1): fixtures, pages, phone;
//   - tests/web/stage2-review/harness.tsx: the REAL RealChatShell (which
//     mounts Frame) on spies — landing, save count, pages never write/send,
//     the new-version notice on another page, the real header at 375px.
//
// Run: node --test tests/web/stage2-review.test.ts
// Screenshots: STAGE2_SHOTS=<dir> (every page, 1440x900 and 375x812).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "../../apps/web/node_modules/playwright/index.mjs";
import { textReply } from "../agent/_openrouter_stub.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const HARNESS = path.join(REPO, "tests/web/stage2-review");
const DOC = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");
const SHOTS = process.env.STAGE2_SHOTS;

// ---------------------------------------------------------------- spec text

const section = (from: string, to: string) => {
  const a = DOC.indexOf(from);
  const b = DOC.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `spec section ${from}`);
  return DOC.slice(a, b);
};
const S51 = section("### 5.1 The frame", "### 5.2 ");
const S53 = section("### 5.3 The pages", "### 5.4 ");
const S55 = section("### 5.5 Phone", "### 5.6 ");
const S56 = section("### 5.6 Visual spec", "### 5.7 ");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** § 5.3's **Empty** text for a page: the first quoted string after "**Empty". */
function emptyText(heading: string): string {
  const a = S53.indexOf(heading);
  assert.ok(a >= 0, heading);
  const e = S53.indexOf("**Empty", a);
  const m = S53.slice(e).match(/"([^"]+)"/);
  assert.ok(m, `empty text under ${heading}`);
  return squash(m![1]);
}
const EMPTY = {
  home: emptyText("#### Home"),
  jobs: emptyText("#### Jobs"),
  applications: emptyText("#### Applications"),
  documents: emptyText("#### Documents"),
};
/** § 5.1's rail order: "five places, **Home, Talk to Ten, Jobs, Applications, Documents**". */
const RAIL_ORDER = DOC.match(/five places, \*\*([^*]+)\*\*/)![1].split(",").map((s) => s.trim());
/** § 5.5's tab order: "Order, left to right: **Home · Jobs · Ten · Applications · Documents**". */
const TAB_ORDER = S55.match(/left to right: \*\*([^*]+)\*\*/)![1].split("·").map((s) => s.trim());
/** § 5.5's viewport meta. */
const VIEWPORT = squash(S55.match(/viewport meta becomes `([^`]+)`/)![1]);
/** The light token values (for computed-style comparisons). */
const TOKENS = new Map<string, string>([...section("```css", "[data-theme=\"dark\"]").matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const px = (name: string) => TOKENS.get(name)!;
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

// ---------------------------------------------------------------- static

test("§ 5.5 'Keyboard up': index.html's viewport meta is § 5.5's", () => {
  const html = readFileSync(path.join(WEB, "index.html"), "utf8");
  const got = html.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? "";
  assert.equal(squash(got).replace(/\s*,\s*/g, ", "), VIEWPORT.replace(/\s*,\s*/g, ", "));
});

test("§ 5.1 'app state, not the address bar' and § 5.2 rule 4 'no copy': no router, no history/location writes, no browser storage in the frame's code", () => {
  const pkg = JSON.parse(readFileSync(path.join(WEB, "package.json"), "utf8"));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.deepEqual(deps.filter((d) => /^(react-router(-dom)?|wouter|history|navigo|@tanstack\/(react-)?router|@reach\/router)$/.test(d)), [], "no router package");
  const files = ["src/components/Frame.tsx", "src/components/Rail.tsx", "src/components/TabBar.tsx", "src/components/EmptyPage.tsx", "src/workspace/landing.ts"];
  const bad: string[] = [];
  for (const f of files) {
    const src = readFileSync(path.join(WEB, f), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
    for (const re of [/pushState|replaceState/, /location\.(hash|href|search|pathname)\s*=/, /localStorage|sessionStorage|indexedDB/]) if (re.test(src)) bad.push(`${f}: ${re}`);
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- servers

let browser: Browser;
const servers: Server[] = [];
const tmp: string[] = [];
let mockBase = "";
let realBase = "";
const external: string[] = [];
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function serve(dir: string): Promise<string> {
  const s = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const file = path.join(dir, p === "/" ? "index.html" : p);
    if (!file.startsWith(dir) || !existsSync(file) || lstatSync(file).isDirectory()) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  servers.push(s);
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(s.address() as any).port}/`)));
}

before(async () => {
  const mOut = mkdtempSync(path.join(tmpdir(), "ten-stage2-review-mock-"));
  tmp.push(mOut);
  const b = spawnSync(process.execPath, [path.join(WEB, "node_modules/vite/bin/vite.js"), "build", "--outDir", mOut, "--emptyOutDir", "--logLevel", "error"], { cwd: WEB, encoding: "utf8", env: { ...process.env, VITE_SHOW_MOCK_CONTROLS: "1" } });
  assert.equal(b.status, 0, `mock build failed:\n${b.stdout}\n${b.stderr}`);
  const link = path.join(HARNESS, "node_modules");
  if (!existsSync(link)) symlinkSync("../../../apps/web/node_modules", link);
  const hOut = mkdtempSync(path.join(tmpdir(), "ten-stage2-review-real-"));
  tmp.push(hOut);
  const { build } = (await import(path.join(WEB, "node_modules/vite/dist/node/index.js"))) as typeof import("vite");
  await build({ root: HARNESS, configFile: path.join(WEB, "vite.config.ts"), logLevel: "error", build: { outDir: hOut, emptyOutDir: true } });
  mockBase = await serve(mOut);
  realBase = await serve(hOut);
  browser = await chromium.launch();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
after(async () => {
  await browser?.close();
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 812 };
async function ctxFor(vp: { width: number; height: number }, reducedMotion: "reduce" | "no-preference" = "no-preference"): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: "light", reducedMotion, hasTouch: vp.width < 500 });
  ctx.on("request", (r) => {
    const u = new URL(r.url());
    if (!["127.0.0.1", "localhost"].includes(u.hostname) && !["data:", "blob:", "about:"].includes(u.protocol)) external.push(r.url());
  });
  return ctx;
}
const fx = (n: string) => JSON.parse(readFileSync(path.join(WEB, "fixtures", `${n}.json`), "utf8"));
const firstUserText = (f: string) => fx(f).messages.find((m: any) => m.role === "user").parts.find((p: any) => p.type === "text").text as string;

async function openMock(ctx: BrowserContext, fixture?: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(mockBase);
  await page.locator(".frame").waitFor();
  if (fixture) await page.locator(".fixture-picker select").selectOption(fixture);
  await page.waitForTimeout(100);
  return page;
}
interface Real {
  page: Page;
  proxyHits: number;
  release: () => void;
}
/** The real shell. The model proxy answers "Here's the plan." after `hold`
 *  resolves (so a test can change pages while the turn is running). */
async function openReal(ctx: BrowserContext, seed: "none" | "saved" | "gate", opts: { newerVersion?: boolean; holdTurns?: boolean } = {}): Promise<Real> {
  const page = await ctx.newPage();
  const r: Real = { page, proxyHits: 0, release: () => {} };
  let gate: Promise<void> = Promise.resolve();
  const arm = () => {
    gate = opts.holdTurns ? new Promise<void>((res) => (r.release = res)) : Promise.resolve();
  };
  arm();
  await page.route("**/stub-proxy/**", async (route: Route) => {
    r.proxyHits++;
    await gate;
    arm();
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: textReply("Here's the plan.", 0.001).body() });
  });
  // /version.json echoes this build's own id (no newer version) unless the
  // test asks for a newer one; the id is read from the page itself.
  await page.route("**/version.json", async (route: Route) => {
    const own = await page.evaluate(() => (window as any).__builtId as string).catch(() => "");
    await route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ id: opts.newerVersion ? `newer-than-${own}` : own }) });
  });
  await page.goto(`${realBase}?seed=${seed}`);
  await page.locator(".frame").waitFor();
  await page.waitForTimeout(150);
  return r;
}
const spy = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__spy)));
const title = (page: Page) => page.locator(".app-header-title").innerText();
const shown = (page: Page, sel: string) => page.locator(sel).first().isVisible().catch(() => false);
const avatarState = (page: Page) => page.evaluate(() => (document.querySelector(".avatar")?.className.match(/avatar--([a-z-]+)/) ?? [])[1] ?? null);
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const a = document.querySelector(".avatar");
    return a && !/thinking|working/.test(a.className);
  }, null, { timeout: 60000 });
  await page.waitForTimeout(200);
}
/** Navigate by the place's own visible name (rail on desktop, tab bar on the phone). */
async function go(page: Page, name: string) {
  const nav = page.locator(".rail, .tabbar").filter({ visible: true }).first();
  await nav.getByRole("button", { name: new RegExp(`^${name}\\b`) }).click();
  await page.waitForTimeout(80);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

// ---------------------------------------------------------------- desktop frame

test("§ 5.1 rail: the five places in § 5.1's order plus the wordmark; each opens its page, the header titles it, aria-current follows, the address bar never changes", async () => {
  const ctx = await ctxFor(DESK);
  const page = await openMock(ctx);
  const bad: string[] = [];
  const labels = await page.locator(".rail .rail-item").evaluateAll((els) => els.map((e) => (e.querySelector(".rail-item-label")?.textContent ?? e.textContent ?? "").trim()));
  if (JSON.stringify(labels) !== JSON.stringify(RAIL_ORDER)) bad.push(`rail order ${JSON.stringify(labels)} != § 5.1 ${JSON.stringify(RAIL_ORDER)}`);
  if (!(await page.locator(".rail .wordmark").isVisible())) bad.push("no wordmark in the rail");
  const railW = await page.locator(".rail").evaluate((e) => e.getBoundingClientRect().width);
  if (Math.round(railW) !== parseInt(px("--rail-w"))) bad.push(`rail width ${railW}, --rail-w ${px("--rail-w")}`);
  const href0 = await page.evaluate(() => location.href);
  const hist0 = await page.evaluate(() => history.length);
  for (const name of RAIL_ORDER) {
    await go(page, name);
    const t = await title(page);
    if (t !== name) bad.push(`${name}: header title "${t}"`);
    const cur = await page.locator('.rail [aria-current="page"]').evaluateAll((els) => els.map((e) => (e.querySelector(".rail-item-label")?.textContent ?? "").trim()));
    if (JSON.stringify(cur) !== JSON.stringify([name])) bad.push(`${name}: aria-current on ${JSON.stringify(cur)}`);
    await shot(page, `desk-${name.replace(/\s+/g, "-").toLowerCase()}-1440x900`);
  }
  if ((await page.evaluate(() => location.href)) !== href0) bad.push("the URL changed");
  if ((await page.evaluate(() => history.length)) !== hist0) bad.push("history grew");
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.6 frame header: --header-h high on desktop, the page title only (no brand mark, no visible state word); Ten's avatar keeps § 1.3's hover and name", async () => {
  const ctx = await ctxFor(DESK);
  const page = await openMock(ctx, "gate-moment");
  const bad: string[] = [];
  const h = await page.locator(".app-header").evaluate((e) => e.getBoundingClientRect().height);
  // the mock's dev-only rows can make it taller; the real header is checked below
  const real = await openReal(ctx, "saved");
  const hr = await real.page.locator(".app-header").evaluate((e) => e.getBoundingClientRect().height);
  if (Math.round(hr) !== parseInt(px("--header-h"))) bad.push(`real header ${hr}px, --header-h ${px("--header-h")} (mock ${h}px)`);
  await page.locator(".composer-input").click();
  await page.locator(".composer-input").fill(firstUserText("gate-moment"));
  await page.locator(".composer-input").press("Enter");
  await page.waitForFunction(() => /needs-you/.test(document.querySelector(".avatar")?.className ?? ""), null, { timeout: 60000 });
  const words = await page.locator(".app-header").evaluate((e) => {
    const out: string[] = [];
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement!;
      if (el.closest(".fixture-picker, [aria-hidden=true]") || !el.getClientRects().length) continue;
      if (/\b(idle|thinking|working|needs you|done)\b/i.test(n.textContent ?? "")) out.push((n.textContent ?? "").trim());
    }
    return out;
  });
  if (words.length) bad.push(`visible state word(s) in the header: ${JSON.stringify(words)}`);
  const av = await page.locator(".avatar").evaluate((e) => ({ title: e.getAttribute("title"), label: e.getAttribute("aria-label") }));
  if (!av.title?.includes("evaluate 6 saved roles")) bad.push(`needs-you hover lost: ${JSON.stringify(av)}`);
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.6 'Ten's avatar': the header avatar is the 28px brand mark with its state carried by a ring", async () => {
  const ctx = await ctxFor(DESK);
  const page = await openMock(ctx);
  const m = await page.locator(".avatar").evaluate((e) => {
    const mark = e.querySelector("svg.mark");
    return { mark: !!mark, w: mark?.getAttribute("width") ?? null, html: e.outerHTML.slice(0, 160) };
  });
  await ctx.close();
  assert.ok(m.mark && m.w === "28", `avatar is not the 28px mark: ${m.html}`);
});

test("§ 5.3 empty states: each page shows § 5.3's own words (first sentence then the rest), and one button that only opens Talk to Ten — Home's 'Continue with Ten' focuses the composer, no draft (§ 5.4)", async () => {
  const ctx = await ctxFor(DESK);
  const page = await openMock(ctx);
  const bad: string[] = [];
  await page.locator(".composer-input").fill("my unsent words");
  for (const [name, key, cta] of [["Home", "home", "Continue with Ten"], ["Jobs", "jobs", "Talk to Ten"], ["Applications", "applications", "Talk to Ten"], ["Documents", "documents", "Talk to Ten"]] as const) {
    await go(page, name);
    const pane = page.locator(".frame-page:not(.frame-page--hidden)").first();
    const text = squash(await pane.locator(".page-empty").innerText().catch(() => ""));
    const want = EMPTY[key];
    if (!text.startsWith(want)) bad.push(`${name}: "${text.slice(0, 140)}" — § 5.3 says "${want}"`);
    const buttons = await pane.getByRole("button").evaluateAll((els) => els.map((e) => e.textContent?.trim()));
    if (JSON.stringify(buttons) !== JSON.stringify([cta])) bad.push(`${name}: buttons ${JSON.stringify(buttons)}, want ["${cta}"]`);
    await pane.getByRole("button", { name: cta }).click();
    await page.waitForTimeout(100);
    if ((await title(page)) !== "Talk to Ten") bad.push(`${name}: its button did not open Talk to Ten`);
    const focus = await page.evaluate(() => document.activeElement?.classList.contains("composer-input"));
    if (key === "home" && !focus) bad.push("Continue with Ten: the composer is not focused (§ 5.4)");
    const v = await page.locator(".composer-input").inputValue();
    if (v !== "my unsent words") bad.push(`${name}: the composer's unsent text changed to "${v}"`);
  }
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.1 'The conversation stays mounted' (mock): a turn started in Talk to Ten, left mid-stream for Jobs, finishes; back in Talk to Ten its reply is there, same as without leaving", async () => {
  const f = "mvp-journey";
  const run = async (leave: boolean) => {
    const ctx = await ctxFor(DESK);
    const page = await openMock(ctx, f);
    await page.locator(".composer-input").click();
    await page.locator(".composer-input").fill(firstUserText(f));
    await page.locator(".composer-input").press("Enter");
    let midStream = false;
    if (leave) {
      await page.waitForFunction(() => /thinking|working/.test(document.querySelector(".avatar")?.className ?? ""), null, { timeout: 10000 });
      await go(page, "Jobs");
      midStream = /thinking|working/.test((await avatarState(page)) ?? "");
    }
    await settled(page);
    if (leave) await go(page, "Talk to Ten");
    const replies = await page.locator(".bubble--assistant").allInnerTexts();
    await ctx.close();
    return { replies, midStream };
  };
  const control = await run(false);
  const left = await run(true);
  assert.ok(left.midStream, "the turn was still running when Jobs opened");
  assert.deepEqual(left.replies, control.replies);
});

test("§ 5.1 'A gate while you're elsewhere' (mock): a gate opened while Jobs shows keeps Jobs showing, puts needs-you on the avatar and 'Needs your yes' on Talk to Ten's rail item only (plain, amber, never red); nothing on Jobs approves it; only a typed yes in Talk to Ten does", async () => {
  const ctx = await ctxFor(DESK);
  const page = await openMock(ctx, "gate-moment");
  const bad: string[] = [];
  await page.locator(".composer-input").click();
  await page.locator(".composer-input").fill(firstUserText("gate-moment"));
  await page.locator(".composer-input").press("Enter");
  await go(page, "Jobs");
  await page.waitForFunction(() => /needs-you/.test(document.querySelector(".avatar")?.className ?? ""), null, { timeout: 60000 });
  await page.waitForTimeout(300);
  if ((await title(page)) !== "Jobs") bad.push(`the app switched pages on its own: now "${await title(page)}"`);
  const marks = await page.locator(".rail .rail-item").evaluateAll((els) => els.map((e) => ({ label: e.querySelector(".rail-item-label")?.textContent?.trim(), marker: /Needs your yes/.test(e.textContent ?? "") })));
  const withMarker = marks.filter((m) => m.marker).map((m) => m.label);
  if (JSON.stringify(withMarker) !== JSON.stringify(["Talk to Ten"])) bad.push(`marker on ${JSON.stringify(withMarker)}`);
  const look = await page.locator(".rail-needs-you").evaluate((e) => ({ color: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor }));
  if (look.color !== rgb(px("--amber")) || look.bg !== rgb(px("--amber-soft"))) bad.push(`marker look ${JSON.stringify(look)}`);
  // every control on the Jobs page and every rail item but Talk to Ten
  const pane = page.locator(".frame-page:not(.frame-page--hidden)").first();
  for (const b of await page.locator(".rail .rail-item").all()) {
    const t = (await b.innerText()).trim();
    if (/Talk to Ten/.test(t)) continue;
    await b.click();
    await page.waitForTimeout(50);
  }
  await go(page, "Jobs");
  for (const b of await pane.getByRole("button").all()) {
    await b.click();
    await page.waitForTimeout(80);
    await go(page, "Jobs");
  }
  await go(page, "Talk to Ten");
  if ((await page.locator(".card--gate .badge").innerText()) !== "pending") bad.push("a page or rail control approved the gate");
  await page.locator(".composer-input").click();
  await page.locator(".composer-input").fill("yes");
  await page.locator(".composer-input").press("Enter");
  await settled(page);
  if ((await page.locator(".card--gate .badge").innerText()) !== "approved") bad.push("typed yes in Talk to Ten did not approve");
  if (await shown(page, ".rail-needs-you")) bad.push("the marker stayed after approval");
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.6 viewer: pinned --panel-w on Talk to Ten, Jobs, Applications, Documents ('Nothing open yet.'); on Home only while a file is open; at 761-1100px a drawer over the page (z-index 30) with a close ✕", async () => {
  const bad: string[] = [];
  const ctx = await ctxFor(DESK);
  const page = await openMock(ctx);
  for (const name of RAIL_ORDER) {
    await go(page, name);
    const v = await page.locator(".side-panel").evaluate((e) => ({ vis: e.getClientRects().length > 0 && getComputedStyle(e).display !== "none", w: e.getBoundingClientRect().width, text: e.textContent ?? "" }));
    if (name === "Home") {
      if (v.vis) bad.push(`Home: the viewer shows with no file open ("${v.text.trim().slice(0, 40)}")`);
    } else {
      if (!v.vis) bad.push(`${name}: no pinned viewer`);
      else if (Math.round(v.w) !== parseInt(px("--panel-w"))) bad.push(`${name}: viewer ${v.w}px wide, --panel-w ${px("--panel-w")}`);
      if (v.vis && !/Nothing open yet\./.test(v.text)) bad.push(`${name}: no "Nothing open yet."`);
    }
  }
  await ctx.close();
  const mid = await ctxFor({ width: 900, height: 800 });
  const p2 = await openMock(mid, "mvp-journey");
  const d = await p2.locator(".side-panel").evaluate((e) => ({ pos: getComputedStyle(e).position, z: getComputedStyle(e).zIndex, close: !!e.querySelector("button[aria-label=Close]") }));
  if (!["absolute", "fixed"].includes(d.pos) || d.z !== "30") bad.push(`900px: viewer is ${d.pos} z ${d.z} — § 5.6 says a drawer over the page at z-index 30`);
  await mid.close();
  assert.deepEqual(bad, []);
});

test("Escape closes the top-most first (§ 5.6 'Stacking'): with the ⋯ menu open, Escape closes the menu", async () => {
  const ctx = await ctxFor(DESK);
  const page = await openMock(ctx);
  await page.locator(".menu-trigger").click();
  await page.locator(".menu-panel").waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const open = await page.locator(".menu-panel").count();
  await ctx.close();
  assert.equal(open, 0, "the menu is still open after Escape");
});

// ---------------------------------------------------------------- phone

test("§ 5.5 tab bar at 375px: no rail; five tabs Home · Jobs · Ten · Applications · Documents, each one tap to its page; Ten a 44x30 tile radius 10; tabs >= 44px; a grid row at the frame's foot, never position: fixed", async () => {
  const ctx = await ctxFor(PHONE);
  const page = await openMock(ctx);
  const bad: string[] = [];
  if (await shown(page, ".rail")) bad.push("the rail shows at 375px");
  const labels = await page.locator(".tabbar .tabbar-item").evaluateAll((els) => els.map((e) => (e.querySelector(".tabbar-item-label")?.textContent ?? "").trim()));
  if (JSON.stringify(labels) !== JSON.stringify(TAB_ORDER)) bad.push(`tabs ${JSON.stringify(labels)} != § 5.5 ${JSON.stringify(TAB_ORDER)}`);
  const bar = await page.locator(".tabbar").evaluate((e) => ({ pos: getComputedStyle(e).position, display: getComputedStyle(e).display, bottom: e.getBoundingClientRect().bottom, vh: window.innerHeight }));
  if (bar.pos === "fixed") bad.push("tab bar is position: fixed");
  if (bar.display !== "grid") bad.push(`tab bar display ${bar.display}`);
  if (Math.abs(bar.bottom - bar.vh) > 1) bad.push(`tab bar bottom ${bar.bottom} != viewport ${bar.vh}`);
  const tile = await page.locator(".tabbar-ten-tile").evaluate((e) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, r: getComputedStyle(e).borderRadius }));
  if (Math.round(tile.w) !== 44 || Math.round(tile.h) !== 30 || tile.r !== "10px") bad.push(`Ten tile ${JSON.stringify(tile)}`);
  const small = await page.locator(".tabbar .tabbar-item").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44 || r.width < 44).length);
  if (small) bad.push(`${small} tab(s) under 44px`);
  const titles: Record<string, string> = { Home: "Home", Jobs: "Jobs", Ten: "Talk to Ten", Applications: "Applications", Documents: "Documents" };
  for (const t of TAB_ORDER) {
    await page.locator(".tabbar").getByRole("button", { name: new RegExp(`^${t}`) }).click();
    await page.waitForTimeout(80);
    if ((await title(page)) !== titles[t]) bad.push(`tab ${t}: title "${await title(page)}"`);
    const cur = await page.locator('.tabbar [aria-current="page"]').count();
    if (cur !== 1) bad.push(`tab ${t}: ${cur} current tabs`);
    await shot(page, `phone-${t.toLowerCase()}-375x812`);
  }
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.5 at 375px on every page (mock and real): no horizontal scroll; every button and menu item >= 44px; the real header is 54px with no wordmark", async () => {
  const bad: string[] = [];
  const ctx = await ctxFor(PHONE);
  const checkAll = async (page: Page, who: string) => {
    for (const t of TAB_ORDER) {
      await page.locator(".tabbar").getByRole("button", { name: new RegExp(`^${t}`) }).click();
      await page.waitForTimeout(80);
      const r = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        vw: window.innerWidth,
        small: Array.from(document.querySelectorAll<HTMLElement>("button, [role=menuitem], a[href]"))
          .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility === "visible" && !e.closest(".fixture-picker, .frame-page--hidden"))
          .map((e) => ({ e, r: e.getBoundingClientRect() }))
          .filter(({ r }) => r.height < 44 || r.width < 44)
          .map(({ e, r }) => `${e.className || e.tagName}[${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 20)}] ${Math.round(r.width)}x${Math.round(r.height)}`),
      }));
      if (r.sw > r.vw) bad.push(`${who} ${t}: scrollWidth ${r.sw} > ${r.vw}`);
      for (const s of r.small) bad.push(`${who} ${t}: under 44px: ${s}`);
    }
  };
  await checkAll(await openMock(ctx, "mvp-journey"), "mock");
  const real = await openReal(ctx, "saved");
  await checkAll(real.page, "real");
  const hh = await real.page.locator(".app-header").evaluate((e) => e.getBoundingClientRect().height);
  if (Math.round(hh) !== 54) bad.push(`real header at 375px is ${hh}px, § 5.5 says 54px`);
  if (await shown(real.page, ".wordmark")) bad.push("a wordmark shows at 375px");
  await real.page.locator(".menu-trigger").click();
  const menu = await real.page.locator(".menu-panel").evaluate((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: window.innerWidth - r.right }; });
  if (Math.round(menu.l) !== 8 || Math.round(menu.r) !== 8) bad.push(`⋯ menu at 375px: ${Math.round(menu.l)}px / ${Math.round(menu.r)}px side margins, § 5.5 says 8px spanning the width`);
  await ctx.close();
  assert.deepEqual([...new Set(bad)], []);
});

test("§ 5.5 'Keyboard up': the tab bar hides while the composer has focus and returns on blur", async () => {
  const ctx = await ctxFor(PHONE);
  const page = await openMock(ctx);
  await page.locator(".composer-input").click();
  const hidden = !(await shown(page, ".tabbar"));
  await page.locator(".app-header-title").click();
  await page.waitForTimeout(50);
  const back = await shown(page, ".tabbar");
  await ctx.close();
  assert.deepEqual({ hidden, back }, { hidden: true, back: true });
});

test("§ 5.5 phone marker: with a gate pending, the Ten tab carries an 8px --amber dot with a 2px --bg ring, and its accessible name says 'Needs your yes'", async () => {
  const ctx = await ctxFor(PHONE);
  const r = await openReal(ctx, "gate");
  const bad: string[] = [];
  await r.page.locator(".tabbar").getByRole("button", { name: /^Jobs/ }).click();
  const ten = r.page.locator(".tabbar .tabbar-item--ten");
  const name = await ten.evaluate((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim());
  if (!/Needs your yes/.test(name)) bad.push(`Ten tab name "${name}"`);
  const dot = await r.page.locator(".tabbar-needs-you").evaluate((e) => ({ w: e.getBoundingClientRect().width, bg: getComputedStyle(e).backgroundColor, ring: getComputedStyle(e).boxShadow })).catch(() => null);
  if (!dot) bad.push("no dot");
  else {
    if (Math.round(dot.w) !== 8) bad.push(`dot ${dot.w}px`);
    if (dot.bg !== rgb(px("--amber"))) bad.push(`dot ${dot.bg}`);
    if (!dot.ring.includes("2px") || !dot.ring.includes(rgb(px("--bg")))) bad.push(`dot ring ${dot.ring}`);
  }
  await ctx.close();
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- the real shell (RealChatShell on spies)

test("§ 5.1 'Where the app opens' (real shell): no saved conversation -> Talk to Ten; a saved one -> Home; a restored pending gate -> Talk to Ten, and on another page the avatar is needs-you with the rail marker", async () => {
  const bad: string[] = [];
  for (const [seed, want] of [["none", "Talk to Ten"], ["saved", "Home"], ["gate", "Talk to Ten"]] as const) {
    const ctx = await ctxFor(DESK);
    const r = await openReal(ctx, seed);
    const t = await title(r.page);
    if (t !== want) bad.push(`${seed}: opened on "${t}", § 5.1 says "${want}"`);
    if (seed === "gate") {
      await go(r.page, "Jobs");
      if ((await avatarState(r.page)) !== "needs-you") bad.push(`gate: avatar ${await avatarState(r.page)} on Jobs`);
      if (!(await shown(r.page, ".rail-needs-you"))) bad.push("gate: no rail marker on Jobs");
    }
    const s = await spy(r.page);
    if (s.saves !== 0) bad.push(`${seed}: ${s.saves} save(s) before any turn`);
    await ctx.close();
  }
  assert.deepEqual(bad, []);
});

test("§ 5.1 'One frame for both builds' (real shell, spy store): a turn left running while Jobs, then Home, shows ends with exactly one save per turn, and its reply is in Talk to Ten on return", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, "saved", { holdTurns: true });
  const bad: string[] = [];
  const consoleErrors: string[] = [];
  r.page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
  r.page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));
  await go(r.page, "Talk to Ten");
  for (const [i, away] of [[1, "Jobs"], [2, "Home"]] as const) {
    await r.page.locator(".composer-input").click();
    await r.page.locator(".composer-input").fill(`turn ${i}, please`);
    await r.page.locator(".composer-input").press("Enter");
    await r.page.waitForFunction(() => /thinking|working/.test(document.querySelector(".avatar")?.className ?? ""), null, { timeout: 5000 }).catch(() => {});
    await go(r.page, away);
    const running = /thinking|working/.test((await avatarState(r.page)) ?? "");
    if (!running) bad.push(`turn ${i}: not running when ${away} opened (proxy hits ${r.proxyHits}; composer "${await r.page.locator(".composer-input").inputValue()}"; notices ${JSON.stringify(await r.page.locator(".conversation-notice, .version-notice, .import-error").allInnerTexts())}; console ${JSON.stringify(consoleErrors.slice(-3))})`);
    r.release();
    await settled(r.page);
    await r.page.waitForTimeout(300);
    const s = await spy(r.page);
    if (s.saves !== i) bad.push(`after turn ${i} (ended on ${away}): ${s.saves} saves, want ${i}`);
    if ((await title(r.page)) !== away) bad.push(`turn ${i}: the page changed to "${await title(r.page)}" on its own`);
    await go(r.page, "Talk to Ten");
    const last = (await r.page.locator(".bubble--assistant").allInnerTexts()).at(-1) ?? "";
    if (!last.includes("Here's the plan.")) bad.push(`turn ${i}: reply not in Talk to Ten: "${last.slice(0, 60)}"`);
  }
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.2 rules 1-2 on the frame (real shell, spies): every rail item, tab and page control, on every page, at 1440 and 375 — zero write/upload calls, zero model calls, zero saves", async () => {
  const bad: string[] = [];
  for (const vp of [DESK, PHONE]) {
    const ctx = await ctxFor(vp);
    const r = await openReal(ctx, "saved");
    const nav = vp === DESK ? ".rail" : ".tabbar";
    const names = vp === DESK ? RAIL_ORDER : TAB_ORDER;
    let clicks = 0;
    for (const n of names) {
      await r.page.locator(nav).getByRole("button", { name: new RegExp(`^${n}`) }).click();
      clicks++;
      await r.page.waitForTimeout(60);
      const pane = r.page.locator(".frame-page:not(.frame-page--hidden):not(.frame-page--talk)");
      if (await pane.count()) {
        for (const b of await pane.getByRole("button").all()) {
          await b.click().catch(() => {});
          clicks++;
          await r.page.waitForTimeout(60);
          await r.page.locator(nav).getByRole("button", { name: new RegExp(`^${n}`) }).click();
        }
      }
    }
    await r.page.waitForTimeout(300);
    const s = await spy(r.page);
    if (s.writes.length || s.uploads.length) bad.push(`${vp.width}: write ${JSON.stringify(s.writes)} upload ${JSON.stringify(s.uploads)}`);
    if (r.proxyHits) bad.push(`${vp.width}: ${r.proxyHits} model call(s)`);
    if (s.saves) bad.push(`${vp.width}: ${s.saves} save(s)`);
    if (clicks < names.length + 4) bad.push(`${vp.width}: only ${clicks} clicks`);
    await ctx.close();
  }
  assert.deepEqual(bad, []);
});

test("§ 5.1 'The new-version check runs in the frame' (real shell): the notice shows on a page other than Talk to Ten, word for word Talk to Ten's own", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, "saved", { newerVersion: true });
  await r.page.waitForTimeout(500);
  const home = (await r.page.locator(".frame-page:not(.frame-page--hidden)").first().locator(".version-notice-text").innerText().catch(() => "")).trim();
  await go(r.page, "Talk to Ten");
  const talk = (await r.page.locator(".frame-page--talk .version-notice-text").innerText().catch(() => "")).trim();
  await ctx.close();
  assert.ok(talk.length > 20, `Talk to Ten's notice: "${talk}"`);
  assert.equal(home, talk);
});

test("every page at 1440 and 375 (mock, gate pending so the marker shows): text is WCAG AA on its ground, and every control Tab reaches shows § 5.6's focus ring", async () => {
  const lum = (c: number[]) => {
    const f = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a: number[], b: number[]) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const focus = rgb(px("--focus"));
  const bad = new Set<string>();
  let sampled = 0;
  let reached = 0;
  for (const vp of [DESK, PHONE]) {
    const ctx = await ctxFor(vp);
    const page = await openMock(ctx, "gate-moment");
    await page.locator(".composer-input").click();
    await page.locator(".composer-input").fill(firstUserText("gate-moment"));
    await page.locator(".composer-input").press("Enter");
    await page.waitForFunction(() => /needs-you/.test(document.querySelector(".avatar")?.className ?? ""), null, { timeout: 60000 });
    await page.locator(".app-header-title").click();
    for (const name of vp === DESK ? RAIL_ORDER : TAB_ORDER) {
      await page.locator(vp === DESK ? ".rail" : ".tabbar").getByRole("button", { name: new RegExp(`^${name}`) }).click();
      await page.waitForTimeout(80);
      const samples = await page.evaluate(() => {
        const parse = (c: string) => (c.match(/rgba?\(([^)]+)\)/)?.[1] ?? "0,0,0,0").split(/[ ,/]+/).filter(Boolean).map(Number);
        const over = (t: number[], b: number[]) => [0, 1, 2].map((k) => t[k] * (t[3] ?? 1) + b[k] * (1 - (t[3] ?? 1)));
        const ground = (el: Element) => {
          const chain: Element[] = [];
          for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e);
          let g = [255, 255, 255];
          for (const e of chain) {
            const c = parse(getComputedStyle(e).backgroundColor);
            if ((c[3] ?? 1) > 0) g = over(c, g);
          }
          return g;
        };
        const out: any[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(".rail *, .tabbar *, .app-header *, .frame-page:not(.frame-page--hidden):not(.frame-page--talk) *"))) {
          if (el.closest(".fixture-picker, [aria-hidden=true]")) continue;
          if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())) continue;
          if (!el.getClientRects().length || getComputedStyle(el).visibility !== "visible") continue;
          const cs = getComputedStyle(el);
          out.push({ who: `${el.className}[${(el.textContent ?? "").trim().slice(0, 20)}]`, fg: over(parse(cs.color), ground(el)), bg: ground(el), size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) });
        }
        return out;
      });
      sampled += samples.length;
      for (const s of samples) {
        const need = s.size >= 24 || (s.size >= 18.66 && s.weight >= 700) ? 3 : 4.5;
        const r = ratio(s.fg, s.bg);
        if (r < need) bad.add(`${vp.width} ${name}: ${s.who} ${r.toFixed(2)} < ${need}`);
      }
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const seen = new Set<string>();
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab");
        const f = await page.evaluate((fr) => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body || el.closest(".fixture-picker, .frame-page--talk")) return null;
          const cs = getComputedStyle(el);
          return { id: `${el.className}[${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 20)}]`, ok: cs.outlineStyle === "solid" && cs.outlineWidth === "2px" && cs.outlineOffset === "2px" && cs.outlineColor === fr };
        }, focus);
        if (!f) continue;
        if (seen.has(f.id)) break;
        seen.add(f.id);
        reached++;
        if (!f.ok) bad.add(`${vp.width} ${name}: no § 5.6 ring on ${f.id}`);
      }
    }
    await ctx.close();
  }
  assert.ok(sampled > 40 && reached > 20, `vacuous: ${sampled} text samples, ${reached} focus stops`);
  assert.deepEqual([...bad], []);
});

// ---------------------------------------------------------------- § 5.4 amended (2026-09-27)

const composerFocused = (page: Page) => page.evaluate(() => !!document.activeElement?.closest(".composer"));

test("§ 5.4 (amended) 'Proved by': Continue with Ten — at 1440px the composer is focused; at 375px it is not, and the tab bar still shows (mock and real shell)", async () => {
  const bad: string[] = [];
  for (const [who, open] of [
    ["mock", async (ctx: BrowserContext) => openMock(ctx)],
    ["real", async (ctx: BrowserContext) => (await openReal(ctx, "saved")).page],
  ] as const) {
    for (const vp of [DESK, PHONE]) {
      const ctx = await ctxFor(vp);
      const page = await open(ctx);
      if ((await title(page)) !== "Home") await go(page, vp === DESK ? "Home" : "Home");
      await page.locator(".frame-page:not(.frame-page--hidden)").first().getByRole("button", { name: "Continue with Ten" }).click();
      await page.waitForTimeout(400);
      const t = await title(page);
      const focused = await composerFocused(page);
      const bar = await shown(page, ".tabbar");
      if (t !== "Talk to Ten") bad.push(`${who}@${vp.width}: Continue with Ten opened "${t}"`);
      if (vp === DESK && !focused) bad.push(`${who}@1440: the composer is not focused`);
      if (vp === PHONE && focused) bad.push(`${who}@375: the composer is focused`);
      if (vp === PHONE && !bar) bad.push(`${who}@375: the tab bar is hidden`);
      await ctx.close();
    }
  }
  assert.deepEqual(bad, []);
});

test("§ 5.4 (amended): only Continue with Ten focuses the composer — the first load, rail and tab navigation to Talk to Ten, and the other pages' 'Talk to Ten' button never do (1440 and 375)", async () => {
  const bad: string[] = [];
  for (const vp of [DESK, PHONE]) {
    // first load: the mock and the real shell's two Talk to Ten landings
    const c0 = await ctxFor(vp);
    const m = await openMock(c0);
    await m.waitForTimeout(400);
    if (await composerFocused(m)) bad.push(`${vp.width}: mock first load focused the composer`);
    for (const seed of ["none", "gate"] as const) {
      const r = await openReal(c0, seed);
      await r.page.waitForTimeout(400);
      if ((await title(r.page)) !== "Talk to Ten") bad.push(`${vp.width}: real ${seed} did not land on Talk to Ten`);
      if (await composerFocused(r.page)) bad.push(`${vp.width}: real first load (${seed}) focused the composer`);
    }
    // navigation and the other pages' button
    const talkName = vp === DESK ? "Talk to Ten" : "Ten";
    for (const from of ["Jobs", "Applications", "Documents"]) {
      await go(m, from);
      await go(m, talkName);
      await m.waitForTimeout(300);
      if (await composerFocused(m)) bad.push(`${vp.width}: ${vp === DESK ? "rail" : "tab"} ${from} -> ${talkName} focused the composer`);
      if (vp === PHONE && !(await shown(m, ".tabbar"))) bad.push(`375: tab bar hidden after tab ${from} -> Ten`);
      await go(m, from);
      await m.locator(".frame-page:not(.frame-page--hidden)").first().getByRole("button", { name: "Talk to Ten" }).click();
      await m.waitForTimeout(300);
      if ((await title(m)) !== "Talk to Ten") bad.push(`${vp.width}: ${from}'s Talk to Ten button opened "${await title(m)}"`);
      if (await composerFocused(m)) bad.push(`${vp.width}: ${from}'s Talk to Ten button focused the composer`);
    }
    await c0.close();
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- § 5.6 "Messages (Stage 2)"

test("§ 5.6 'Messages (Stage 2)' at 1440 and 375: thread --thread-max wide and centred; each turn a 32px avatar column plus the content, 26px apart; Ten's avatar the 28px mark, yours a 28px --bg-muted circle holding a 15px user icon in --fg-muted; 'Ten'/'You' above each turn in --type-ui at 600; prose in --type-body", async () => {
  const bad: string[] = [];
  const bodyFont = TOKENS.get("--type-body")!.match(/([0-9.]+)px\/([0-9.]+)px/)!;
  const uiFont = TOKENS.get("--type-ui")!.match(/([0-9.]+)px\/([0-9.]+)px/)!;
  for (const vp of [DESK, PHONE]) {
    const ctx = await ctxFor(vp);
    const page = await openMock(ctx, "mvp-journey");
    for (const m of fx("mvp-journey").messages) {
      if (m.role !== "user") continue;
      await page.locator(".composer-input").click();
      await page.locator(".composer-input").fill(m.parts.find((p: any) => p.type === "text").text);
      await page.locator(".composer-input").press("Enter");
      await page.waitForTimeout(40);
      await settled(page);
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(100);
    await shot(page, `messages-${vp.width}x${vp.height}`);
    const g = await page.evaluate(() => {
      const t = document.querySelector(".frame-page--talk .transcript") as HTMLElement;
      const pane = t.parentElement!.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      const turns = Array.from(t.querySelectorAll<HTMLElement>(":scope > .bubble"));
      return {
        thread: { w: tr.width, center: tr.left + tr.width / 2, paneCenter: pane.left + pane.width / 2, paneW: pane.width },
        turns: turns.map((b) => {
          const r = b.getBoundingClientRect();
          const av = b.querySelector(":scope > .bubble-avatar") as HTMLElement | null;
          const role = b.querySelector(":scope > .bubble-role") as HTMLElement | null;
          const content = Array.from(b.children).filter((c) => !c.classList.contains("bubble-avatar")) as HTMLElement[];
          const avR = av?.getBoundingClientRect();
          const avCs = av ? getComputedStyle(av) : null;
          const icon = av?.querySelector("svg");
          const prose = Array.from(b.querySelectorAll<HTMLElement>("p")).find((p) => !p.closest(".card, .tool-run, .bubble-role") && (p.textContent ?? "").trim().length > 20);
          const pcs = prose ? getComputedStyle(prose) : null;
          const rcs = role ? getComputedStyle(role) : null;
          return {
            user: b.classList.contains("bubble--user"),
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            avatar: av ? { left: avR!.left, w: avR!.width, h: avR!.height, mark: av.querySelector("svg.mark")?.getAttribute("width") ?? null, radius: avCs!.borderRadius, bg: avCs!.backgroundColor, color: avCs!.color, iconW: icon?.getAttribute("width") ?? null, first: b.firstElementChild === av } : null,
            contentLeft: Math.min(...content.map((c) => c.getBoundingClientRect().left)),
            role: role ? { text: role.textContent?.trim(), size: rcs!.fontSize, lh: rcs!.lineHeight, weight: rcs!.fontWeight, transform: rcs!.textTransform, top: role.getBoundingClientRect().top } : null,
            prose: pcs ? { size: pcs.fontSize, lh: pcs.lineHeight, family: pcs.fontFamily } : null,
          };
        }),
      };
    });
    const w = vp.width;
    const threadMax = parseInt(px("--thread-max"));
    if (g.thread.w > threadMax + 0.5) bad.push(`${w}: thread ${g.thread.w}px > --thread-max ${threadMax}`);
    if (g.thread.paneW > threadMax && Math.abs(g.thread.w - threadMax) > 0.5) bad.push(`${w}: thread ${g.thread.w}px, not --thread-max wide in a ${g.thread.paneW}px pane`);
    if (Math.abs(g.thread.center - g.thread.paneCenter) > 1) bad.push(`${w}: thread not centred (${g.thread.center} vs ${g.thread.paneCenter})`);
    if (g.turns.length < 6) bad.push(`${w}: only ${g.turns.length} turns rendered`);
    if (g.turns.filter((t) => t.prose).length < 4) bad.push(`${w}: prose measured in only ${g.turns.filter((t) => t.prose).length} turns`);
    g.turns.forEach((t, i) => {
      const who = `${w} turn ${i} (${t.user ? "you" : "Ten"})`;
      if (!t.avatar || !t.avatar.first) return void bad.push(`${who}: no avatar first in the turn`);
      if (Math.round(t.avatar.w) !== 28 || Math.round(t.avatar.h) !== 28) bad.push(`${who}: avatar ${t.avatar.w}x${t.avatar.h}`);
      if (Math.abs(t.avatar.left - t.left) > 0.5) bad.push(`${who}: avatar not at the turn's left edge`);
      if (Math.abs(t.contentLeft - t.left - 32) > 16 || t.contentLeft - t.left < 32) bad.push(`${who}: content starts ${t.contentLeft - t.left}px in, § 5.6 a 32px avatar column`);
      if (t.user) {
        if (!/50%|999px|9999px/.test(t.avatar.radius) && !(parseFloat(t.avatar.radius) >= 14)) bad.push(`${who}: avatar not a circle (${t.avatar.radius})`);
        if (t.avatar.bg !== rgb(px("--bg-muted"))) bad.push(`${who}: avatar ${t.avatar.bg}, want --bg-muted`);
        if (t.avatar.color !== rgb(px("--fg-muted"))) bad.push(`${who}: icon colour ${t.avatar.color}, want --fg-muted`);
        if (t.avatar.iconW !== "15") bad.push(`${who}: user icon ${t.avatar.iconW}px, want 15`);
      } else if (t.avatar.mark !== "28") bad.push(`${who}: Ten's avatar is not the 28px mark`);
      const wantName = t.user ? "You" : "Ten";
      if (!t.role || t.role.text !== wantName || t.role.transform !== "none") bad.push(`${who}: name ${JSON.stringify(t.role)}, want "${wantName}" as written`);
      else {
        if (t.role.size !== `${uiFont[1]}px` || t.role.weight !== "600") bad.push(`${who}: name ${t.role.size}/${t.role.weight}, want --type-ui ${uiFont[1]}px at 600`);
        if (t.role.top > t.top + 1) bad.push(`${who}: the name is not at the top of the turn`);
      }
      if (t.prose && (t.prose.size !== `${bodyFont[1]}px` || t.prose.lh !== `${bodyFont[2]}px` || !/Inter/.test(t.prose.family))) bad.push(`${who}: prose ${JSON.stringify(t.prose)}, want --type-body`);
      if (i > 0) {
        const gap = t.top - g.turns[i - 1].bottom;
        if (Math.abs(gap - 26) > 1) bad.push(`${w} turns ${i - 1}->${i}: ${gap.toFixed(1)}px apart, § 5.6 26px`);
      }
    });
    await ctx.close();
  }
  assert.deepEqual([...new Set(bad)], []);
});

test("no request left this origin in any test above", () => {
  assert.deepEqual([...new Set(external)], []);
});
