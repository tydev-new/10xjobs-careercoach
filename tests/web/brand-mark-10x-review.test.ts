// Independent review (tester, 2026-10-09) of the brand mark: design-web-ui.md
// § 5.6 "The brand mark", "Amended 2026-10-09 (owner ruling; C30)", proof
// items 1-8; the token block; "One accent: lime"; "Ten's avatar"; § 5.5's Ten
// tab clause. Written from the doc, not the code.
//
// What runs: the REAL production build of apps/web with the real supabase-js,
// in headless Chromium, against the repo's local stand-in (a member with a
// saved conversation, so Ten's turns render with no model call). For proof 6
// and "nothing else changed colour", origin/main is exported with `git archive`
// into a temp dir (no worktree, no ref is touched) and built the same way; those
// tests are skipped, loudly, where origin/main is not available.
//
//   node --test tests/web/brand-mark-10x-review.test.ts
//   REVIEW_SHOTS=<dir> ... saves the screenshots to look at.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "../../apps/web/node_modules/playwright/index.mjs";
import { ANON_KEY, startStandIn, type StandIn } from "../e2e-real/stand-in.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const DOC = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");
const SHOTS = process.env.REVIEW_SHOTS;
const PASSWORD = "correct horse battery";

// ------------------------------------------------------------ the doc
const SECTION = (() => {
  const a = DOC.indexOf("#### The brand mark");
  const b = DOC.indexOf("\n#### ", a + 10);
  assert.ok(a > 0 && b > a, '§ 5.6 "The brand mark" not found');
  return DOC.slice(a, b);
})();
const fence = (lang: string) => {
  const m = SECTION.match(new RegExp("```" + lang + "\\n([\\s\\S]*?)```"));
  assert.ok(m, `no ${lang} fence in "The brand mark"`);
  return m[1].trim();
};
const DOC_MARK = fence("html");
const DOC_MARK_D = /<path fill="var\(--on-brand\)" d="([^"]+)"/.exec(DOC_MARK)![1];
const DOC_FAV = fence("svg");
const DOC_FAV_D = / d="([^"]+)"/.exec(DOC_FAV)![1];
const tokenRow = (name: string) => {
  const m = new RegExp("^\\| `" + name + "` \\| `(#[0-9A-Fa-f]{6})` \\| `(#[0-9A-Fa-f]{6})` \\|", "m").exec(SECTION);
  assert.ok(m, `no token row for ${name}`);
  return { light: m[1], dark: m[2] };
};
const BRAND = tokenRow("--brand");
const ON_BRAND = tokenRow("--on-brand");
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
const TILE = rgb(BRAND.light);
const GLYPH = rgb(ON_BRAND.light);

// ------------------------------------------------------------ builds, servers, browser
let standIn: StandIn;
let fn: Server;
let browser: Browser;
const sites: Server[] = [];
const temps: string[] = [];
let HEAD = { origin: "", dist: "" };
let MAIN: { origin: string; dist: string; src: string } | null = null;
let mainWhy = "";
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

/** One listening static server and one production build of `webDir` into a temp dir, inlining that server's address. */
async function buildAndServe(webDir: string): Promise<{ origin: string; dist: string }> {
  const dist = mkdtempSync(path.join(tmpdir(), "ten-brand-review-"));
  temps.push(dist);
  const site = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    let file = path.join(dist, p === "/" ? "index.html" : p);
    if (!file.startsWith(dist) || !existsSync(file) || lstatSync(file).isDirectory()) file = path.join(dist, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  sites.push(site);
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(site.address() as any).port}`;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("VITE_") && v !== undefined) env[k] = v;
  Object.assign(env, { VITE_SUPABASE_URL: standIn.url, VITE_SUPABASE_ANON_KEY: ANON_KEY, VITE_SITE_URL: origin });
  const r = spawnSync(process.execPath, [path.join(WEB, "node_modules/vite/bin/vite.js"), "build", "--outDir", dist, "--emptyOutDir", "--logLevel", "error"], { cwd: webDir, encoding: "utf8", env });
  assert.equal(r.status, 0, `vite build of ${webDir} failed:\n${r.stdout}\n${r.stderr}`);
  return { origin, dist };
}

before(async () => {
  standIn = await startStandIn();
  fn = createServer((req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": String(req.headers["access-control-request-headers"] ?? "*"), "access-control-allow-methods": "GET, POST, OPTIONS" };
    if (req.method === "OPTIONS") return void res.writeHead(204, cors).end();
    res.writeHead(404, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ error: { message: "review: no functions here" } }));
  });
  await new Promise<void>((r) => fn.listen(0, "127.0.0.1", r));
  standIn.setFunctionsTarget(`http://127.0.0.1:${(fn.address() as any).port}`);
  HEAD = await buildAndServe(WEB);

  // origin/main, exported (never checked out), with this checkout's installed modules linked in
  const src = mkdtempSync(path.join(tmpdir(), "ten-brand-main-"));
  temps.push(src);
  const tar = path.join(src, "main.tar");
  const ar = spawnSync("git", ["-C", REPO, "archive", "--format=tar", "-o", tar, "origin/main"], { encoding: "utf8" });
  if (ar.status !== 0) mainWhy = `origin/main could not be exported: ${ar.stderr.trim()}`;
  else {
    const x = spawnSync("tar", ["-xf", tar, "-C", src], { encoding: "utf8" });
    if (x.status !== 0) mainWhy = `tar failed: ${x.stderr}`;
    else {
      for (const d of ["apps/web", "packages/agent", "packages/checkers"]) if (existsSync(path.join(REPO, d, "node_modules"))) symlinkSync(path.join(REPO, d, "node_modules"), path.join(src, d, "node_modules"));
      MAIN = { ...(await buildAndServe(path.join(src, "apps/web"))), src };
    }
  }
  browser = await chromium.launch();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

after(async () => {
  await browser?.close();
  for (const s of sites) await new Promise<void>((r) => s.close(() => r()));
  await new Promise<void>((r) => fn?.close(() => r()));
  await standIn?.close();
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

const external: string[] = [];
async function open(origin: string, viewport: { width: number; height: number }, opts: { scale?: number; reducedMotion?: "reduce" | "no-preference" } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: opts.scale ?? 1, reducedMotion: opts.reducedMotion ?? "no-preference" });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1") return route.continue();
    external.push(u.href);
    return route.abort();
  });
  const page = await ctx.newPage();
  await page.goto(origin + "/");
  return { ctx, page };
}
const shot = async (target: Page | ReturnType<Page["locator"]>, name: string, extra: Record<string, unknown> = {}) => {
  if (SHOTS) await (target as any).screenshot({ path: path.join(SHOTS, name), ...extra });
};

let seq = 0;
/** A member with a saved conversation that has two of Ten's turns, signed in on `origin`. */
async function member(origin: string, viewport: { width: number; height: number }, opts: { scale?: number; reducedMotion?: "reduce" | "no-preference" } = {}) {
  const email = `brand.review.${++seq}@example.com`;
  const uid = await standIn.createUser({ email });
  const messages = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Hello, this is the brand review." }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "Hi. This is Ten's first turn." }] },
    { id: "u2", role: "user", parts: [{ type: "text", text: "And another." }] },
    { id: "a2", role: "assistant", parts: [{ type: "text", text: "This is Ten's second turn." }] },
  ];
  await standIn.sql("insert into public.ten_conversations (user_id, chat_id, messages, older_dropped, version) values ($1, 'review-chat', $2::jsonb, false, 'v1')", [uid, JSON.stringify(messages)]);
  const o = await open(origin, viewport, opts);
  await o.page.locator(".sign-in-form input[type=email]").fill(email);
  await o.page.locator(".sign-in-form input[type=password]").fill(PASSWORD);
  await o.page.locator(".sign-in-form button[type=submit]").click();
  await o.page.locator(".avatar").first().waitFor({ timeout: 20000 });
  return o;
}
async function openTalk(page: Page, phone = false) {
  await page.locator(phone ? ".tabbar-item--ten" : ".rail-item", phone ? {} : { hasText: "Ten" }).first().click();
  await page.locator(".bubble--assistant").first().waitFor({ timeout: 15000 });
}

/** every drawn mark on the page */
const marks = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("svg.mark")].map((m) => {
      const rect = m.querySelector("rect")!;
      const p = m.querySelector("path");
      const b = m.getBoundingClientRect();
      return {
        where: m.closest(".avatar") ? "header avatar" : m.closest(".rail") ? "rail" : m.closest(".sign-in-card") ? "sign-in" : m.closest(".bubble--assistant") ? "turn" : "other",
        shown: m.getClientRects().length > 0,
        box: [Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10],
        viewBox: m.getAttribute("viewBox"),
        children: [...m.children].map((c) => c.tagName.toLowerCase()),
        rx: rect.getAttribute("rx"),
        tile: getComputedStyle(rect).fill,
        glyph: p ? getComputedStyle(p).fill : "",
        d: p?.getAttribute("d") ?? "",
        rule: p ? getComputedStyle(p).fillRule : "",
        role: m.getAttribute("role"),
        label: m.getAttribute("aria-label"),
      };
    }),
  );
function isNewTile(m: Awaited<ReturnType<typeof marks>>[number], px: number, at: string) {
  assert.deepEqual(m.box, [px, px], `${at}: size`);
  assert.equal(m.viewBox, "0 0 32 32", at);
  assert.deepEqual(m.children, ["rect", "path"], `${at}: the mark's shapes (no ellipse, no second rect)`);
  assert.equal(m.rx, "8.5", at);
  assert.equal(m.tile, TILE, `${at}: the tile's computed fill`);
  assert.equal(m.glyph, GLYPH, `${at}: the glyph's computed fill`);
  assert.equal(m.d, DOC_MARK_D, `${at}: the path is not the doc's`);
  assert.equal(m.rule, "nonzero", `${at}: fill-rule`);
  assert.equal(m.role, "img", at);
  assert.equal(m.label, "Ten", at);
}

/** every visible element that paints the terracotta, by any colour property */
const terracottaUsers = (page: Page, tile: string) =>
  page.evaluate((want) => {
    const props = ["color", "backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outlineColor", "fill", "stroke", "textDecorationColor", "caretColor", "columnRuleColor"] as const;
    const near = (v: string) => {
      const m = /rgba?\((\d+), (\d+), (\d+)/.exec(v);
      const w = /rgb\((\d+), (\d+), (\d+)/.exec(want)!;
      return !!m && Math.abs(+m[1] - +w[1]) <= 12 && Math.abs(+m[2] - +w[2]) <= 12 && Math.abs(+m[3] - +w[3]) <= 12;
    };
    const out: string[] = [];
    for (const e of document.querySelectorAll("*")) {
      for (const pseudo of [null, "::before", "::after"]) {
        const cs = getComputedStyle(e, pseudo);
        if (pseudo && cs.content === "none") continue;
        for (const p of props) {
          const v = (cs as any)[p] as string;
          if (!near(v)) continue;
          if ((p === "fill" || p === "color" || p === "stroke" || p === "caretColor" || p === "textDecorationColor" || p === "outlineColor" || p === "columnRuleColor") && e.closest("svg.mark") && e.tagName.toLowerCase() === "rect" && p === "fill") continue;
          out.push(`${e.tagName.toLowerCase()}.${String((e as any).className?.baseVal ?? e.className)}${pseudo ?? ""} ${p}=${v}`);
        }
      }
    }
    return out;
  }, tile);

// ============================================================ the tests

test("B0 the doc was read whole: path lengths 2672 and 1373, first and last characters as proof 1 says; token rows --brand and --on-brand", () => {
  assert.equal(DOC_MARK_D.length, 2672);
  assert.ok(DOC_MARK_D.startsWith("M10.1 20.4L3.4 20.4") && DOC_MARK_D.endsWith("28.6 19.9Z"));
  assert.equal(DOC_FAV_D.length, 1373);
  assert.ok(DOC_FAV_D.startsWith("M13.3 22.7L3.1 22.7") && DOC_FAV_D.endsWith("23.6 20.3Z"));
  assert.deepEqual(BRAND, { light: "#C15F3C", dark: "#C15F3C" }, "the owner's ruling names #C15F3C");
  assert.deepEqual(ON_BRAND, { light: "#FFFFFF", dark: "#FFFFFF" });
  // the doc's two copies of the tokens (the token block and this section's table) agree
  assert.match(DOC, /--brand: #C15F3C;/);
  assert.match(DOC, /--on-brand: #FFFFFF;/);
});

test("B1 proof 1 (source): BrandMark.tsx carries the doc's d byte for byte and nothing else that draws; favicon.svg is the doc's file byte for byte", () => {
  const src = readFileSync(path.join(WEB, "src/components/BrandMark.tsx"), "utf8");
  const strings = [...src.matchAll(/"(M\d[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(strings, [DOC_MARK_D]);
  assert.equal(src.split(DOC_MARK_D).length - 1, 1);
  const tags = [...src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/<(rect|path|ellipse|circle|line|polygon|polyline|text|g|use|image)\b[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(tags, ['<rect width="32" height="32" rx="8.5" fill="var(--brand)" />', '<path fill="var(--on-brand)" d={MARK_PATH} />']);
  const fav = readFileSync(path.join(WEB, "public/favicon.svg"), "utf8");
  assert.equal(fav.trim(), DOC_FAV);
  assert.equal((fav.match(/<(rect|path|ellipse|circle)\b/g) ?? []).join(","), "<rect,<path");
});

test("B2 proof 2 (source and bundle): --brand and --on-brand have the doc's values, once, light only; #C15F3C and var(--brand) appear nowhere else in apps/web's source, CSS, HTML, public files or the built bundle", () => {
  const css = readFileSync(path.join(WEB, "src/styles.css"), "utf8");
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.deepEqual([...rules.matchAll(/--brand:\s*([^;]+);/g)].map((m) => m[1].trim()), [BRAND.light]);
  assert.deepEqual([...rules.matchAll(/--on-brand:\s*([^;]+);/g)].map((m) => m[1].trim()), [ON_BRAND.light]);
  assert.ok(rules.indexOf("--brand:") < rules.indexOf('[data-theme="dark"]'), "--brand is not in the light block");
  // every file apps/web owns (not node_modules, not a build), tests left out
  const hexHits: string[] = [];
  const varHits: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n === "dist" || n.startsWith(".")) continue;
      const a = path.join(d, n);
      if (statSync(a).isDirectory()) walk(a);
      else if (!/\.test\.(ts|tsx|mjs)$/.test(n) && /\.(ts|tsx|js|jsx|mjs|css|html|svg|json|md)$/.test(n)) {
        readFileSync(a, "utf8").split("\n").forEach((l, i) => {
          if (/c15f3c|193,\s*95,\s*60/i.test(l)) hexHits.push(`${path.relative(WEB, a)}:${i + 1}`);
          if (/var\(\s*--(on-)?brand\b/.test(l)) varHits.push(`${path.relative(WEB, a)}:${i + 1}`);
        });
      }
    }
  };
  walk(WEB);
  const cssLine = css.split("\n").findIndex((l) => /--brand:/.test(l)) + 1;
  assert.deepEqual(hexHits.sort(), ["public/favicon.svg:1", `src/styles.css:${cssLine}`], "where the hex is written");
  assert.equal(varHits.length, 2, `var(--brand) / var(--on-brand) uses: ${varHits}`);
  assert.ok(varHits.every((h) => h.startsWith("src/components/BrandMark.tsx:")), String(varHits));
  // the built bundle
  const built: Record<string, string> = {};
  const walkDist = (d: string) => {
    for (const n of readdirSync(d)) {
      const a = path.join(d, n);
      if (statSync(a).isDirectory()) walkDist(a);
      else if (/\.(js|css|html|svg)$/.test(n)) built[path.relative(HEAD.dist, a)] = readFileSync(a, "utf8");
    }
  };
  walkDist(HEAD.dist);
  const count = (re: RegExp) => Object.fromEntries(Object.entries(built).map(([f, t]) => [f.replace(/-[A-Za-z0-9_-]{8}\./, "."), (t.match(re) ?? []).length]).filter(([, c]) => c));
  const hex = count(/c15f3c|193,\s*95,\s*60/gi);
  assert.deepEqual(Object.keys(hex).sort(), ["favicon.svg", Object.keys(hex).find((k) => k.endsWith(".css"))].sort(), `the hex in the bundle: ${JSON.stringify(hex)}`);
  assert.ok(Object.values(hex).every((c) => c === 1), JSON.stringify(hex));
  const uses = count(/var\(--brand\)/g);
  assert.equal(Object.keys(uses).length, 1, JSON.stringify(uses));
  assert.ok(Object.keys(uses)[0].endsWith(".js") && Object.values(uses)[0] === 1, `var(--brand) in the bundle: ${JSON.stringify(uses)}`);
  assert.deepEqual(Object.values(count(/var\(--on-brand\)/g)), [1]);
  // proof 4 in the bundle: the old mark's numbers and the old favicon's tile are gone
  const js = Object.entries(built).filter(([f]) => f.endsWith(".js")).map(([, t]) => t).join("\n");
  for (const old of ['cx:"19.4"', 'ry:"5.7"', "rx:4.6", 'rx:"4.6"', 'cx:19.4', 'height:"15",rx:"1.8"']) assert.ok(!js.includes(old), `the bundle still has the old mark's ${old}`);
  assert.ok(js.includes(DOC_MARK_D), "the doc's path is in the bundle, whole");
  assert.equal(built["favicon.svg"].trim(), DOC_FAV);
  assert.ok(!/ellipse|#0A0A0B|#C8F03C|stroke/i.test(built["favicon.svg"]));
});

test("B3 proof 3, sign-in on the production build at 1440 and 375: the 30px wordmark's tile is the doc's shape, terracotta with a white glyph; the favicon served is the doc's and index.html links it", async () => {
  for (const [name, vp] of [["1440", { width: 1440, height: 900 }], ["375", { width: 375, height: 812 }]] as const) {
    const o = await open(HEAD.origin, vp, { scale: 2 });
    try {
      await o.page.locator(".sign-in-card svg.mark").waitFor({ timeout: 15000 });
      const list = await marks(o.page);
      assert.equal(list.length, 1, `${name}: marks on sign-in`);
      assert.equal(list[0].where, "sign-in");
      isNewTile(list[0], 30, `sign-in ${name}`);
      assert.equal(await o.page.locator(".sign-in-logo .wordmark-text").textContent(), "Ten", "the word beside it stays Ten");
      assert.deepEqual(await terracottaUsers(o.page, TILE), [], `${name}: something besides the mark's tile is terracotta`);
      await shot(o.page, `signin-${name}.png`, { fullPage: true });
      const link = await o.page.evaluate(() => [...document.querySelectorAll("link[rel~=icon]")].map((l) => [l.getAttribute("rel"), l.getAttribute("type"), l.getAttribute("href")]));
      assert.deepEqual(link, [["icon", "image/svg+xml", "/favicon.svg"]]);
    } finally {
      await o.ctx.close();
    }
  }
  const res = await fetch(HEAD.origin + "/favicon.svg");
  assert.equal(res.headers.get("content-type"), "image/svg+xml");
  assert.equal((await res.text()).trim(), DOC_FAV);
});

test("B3b proof 3, signed in on the production build: the rail wordmark (28px), the header avatar (28px) and the avatar beside EACH of Ten's turns are the new tile; no other mark is on the page; no other element is terracotta", async () => {
  const o = await member(HEAD.origin, { width: 1440, height: 900 }, { scale: 2 });
  try {
    for (const where of ["home", "talk"]) {
      if (where === "talk") await openTalk(o.page);
      const list = (await marks(o.page)).filter((m) => m.shown);
      const by = (w: string) => list.filter((m) => m.where === w);
      assert.equal(by("rail").length, 1, `${where}: rail marks`);
      assert.equal(by("header avatar").length, 1, `${where}: header avatar marks`);
      assert.deepEqual(by("other"), [], `${where}: a mark somewhere unexpected`);
      for (const m of list) isNewTile(m, 28, `${where} / ${m.where}`);
      if (where === "talk") {
        const turns = await o.page.locator(".bubble--assistant").count();
        assert.equal(turns, 2, "Ten's turns in the seeded conversation");
        assert.equal(by("turn").length, turns, "one mark beside each of Ten's turns");
        assert.equal(await o.page.locator(".bubble--assistant .bubble-avatar svg.mark").count(), turns);
      }
      assert.equal(await o.page.locator(".rail .wordmark-text").textContent(), "Ten");
      assert.deepEqual(await terracottaUsers(o.page, TILE), [], `${where}: something besides the mark's tile is terracotta`);
      await shot(o.page, `member-${where}-1440.png`);
    }
    await shot(o.page.locator(".rail-brand"), "rail-wordmark.png");
    await shot(o.page.locator(".bubble--assistant").first(), "turn.png");
  } finally {
    await o.ctx.close();
  }
});

test("B4 proof 4, rendered: on sign-in, Home, the conversation and the phone, no svg anywhere draws an ellipse or a second rect inside a mark, and no mark has a lime or hero fill", async () => {
  const check = async (page: Page, at: string) => {
    const r = await page.evaluate(() => ({
      ellipsesInMarks: document.querySelectorAll("svg.mark ellipse, svg.mark circle, svg.mark rect + rect").length,
      strokes: [...document.querySelectorAll("svg.mark *")].filter((e) => getComputedStyle(e).stroke !== "none").length,
      fills: [...new Set([...document.querySelectorAll("svg.mark *")].map((e) => getComputedStyle(e).fill))],
      lime: getComputedStyle(document.documentElement).getPropertyValue("--lime").trim(),
    }));
    assert.equal(r.ellipsesInMarks, 0, at);
    assert.equal(r.strokes, 0, `${at}: a stroked shape in a mark`);
    assert.deepEqual(r.fills.sort(), [TILE, GLYPH].sort(), `${at}: fills inside marks`);
    assert.equal(r.lime.toUpperCase(), "#C8F03C", `${at}: lime itself is unchanged`);
  };
  const s = await open(HEAD.origin, { width: 1280, height: 860 });
  await s.page.locator(".sign-in-card svg.mark").waitFor();
  await check(s.page, "sign-in");
  await s.ctx.close();
  const m = await member(HEAD.origin, { width: 1280, height: 860 });
  await check(m.page, "home");
  await openTalk(m.page);
  await check(m.page, "conversation");
  await m.ctx.close();
  const p = await member(HEAD.origin, { width: 375, height: 812 });
  await check(p.page, "phone");
  await p.ctx.close();
  // the two static pages ship no mark of any kind
  for (const f of ["terms.html", "privacy.html"]) assert.ok(!/<svg|<img|ellipse|C8F03C|favicon/i.test(readFileSync(path.join(HEAD.dist, f), "utf8")), `${f} carries artwork`);
});

test("B5 proof 5, the accessibility tree: on sign-in the wordmark is one heading named Ten with no image inside it; the header avatar is one image named by its state (F20), never '10x'; nothing on any page is named '10x'", async (t) => {
  const s = await open(HEAD.origin, { width: 1280, height: 860 });
  try {
    await s.page.locator(".sign-in-card svg.mark").waitFor();
    const snap = await s.page.locator(".sign-in-logo").ariaSnapshot();
    t.diagnostic(`sign-in wordmark, accessibility tree: ${JSON.stringify(snap)}`);
    console.log(`  [B5] sign-in wordmark tree: ${JSON.stringify(snap)}`);
    assert.equal(snap.trim(), '- heading "Ten" [level=1]');
    assert.equal(await s.page.getByRole("heading", { name: "Ten", exact: true }).count(), 1);
    assert.equal(await s.page.getByRole("img").count(), 0, "an image is exposed on sign-in (Ten would be heard twice)");
    assert.equal(await s.page.getByText("10x").count(), 0);
    // the mark alone: taken out of its hidden wrapper in the live page, it is an image named Ten
    await s.page.evaluate(() => {
      const m = document.querySelector("svg.mark")!.cloneNode(true) as Element;
      const host = document.createElement("div");
      host.id = "review-mark-alone";
      host.appendChild(m);
      document.body.appendChild(host);
    });
    const alone = await s.page.locator("#review-mark-alone").ariaSnapshot();
    console.log(`  [B5] the mark alone: ${JSON.stringify(alone)}`);
    assert.equal(alone.trim(), '- img "Ten"');
  } finally {
    await s.ctx.close();
  }
  const m = await member(HEAD.origin, { width: 1280, height: 860 });
  try {
    await openTalk(m.page);
    const imgs = await m.page.getByRole("img").evaluateAll((els) => els.map((e) => `${e.tagName.toLowerCase()}.${String((e as any).className?.baseVal ?? e.className)}: ${e.getAttribute("aria-label")}`));
    console.log(`  [B5] images exposed on the conversation page: ${JSON.stringify(imgs)}`);
    const rail = await m.page.locator(".rail").ariaSnapshot();
    console.log(`  [B5] the rail's tree: ${JSON.stringify(rail)}`);
    const whole = await m.page.locator("body").ariaSnapshot();
    assert.ok(!/10x/i.test(whole), "something is named or reads '10x'");
    // the browser's own accessibility tree (Chromium, over CDP): what a screen reader is given
    const cdp = await m.ctx.newCDPSession(m.page);
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    const exposed = nodes.filter((x: any) => !x.ignored).map((x: any) => ({ role: String(x.role?.value ?? ""), name: String(x.name?.value ?? "") }));
    const images = exposed.filter((x: any) => /^(image|img|SvgRoot|graphics-document|graphics-symbol)$/i.test(x.role));
    console.log(`  [B5] Chromium's accessibility tree, images on the conversation page: ${JSON.stringify(images)}`);
    console.log(`  [B5] nodes named exactly "Ten": ${JSON.stringify(exposed.filter((x: any) => x.name === "Ten"))}`);
    // Two images, both in the header: the avatar, named by its state (F20), and inside it the mark alone,
    // named "Ten" (proof 5). The rail's wordmark and the marks beside Ten's turns are hidden, so "Ten" is
    // not heard again for them. (The same on origin/main: Avatar.tsx is untouched by C30.)
    assert.equal(images.length, 2, `images exposed: ${JSON.stringify(images)}`);
    assert.match(images[0].name, /^(idle|thinking|working|needs-you|done)/);
    assert.equal(images[1].name, "Ten", "the mark alone is an image named Ten");
    assert.deepEqual(exposed.filter((x: any) => /10x/i.test(x.name)), [], "a node named 10x");
    assert.equal(await m.page.locator(".avatar").getAttribute("role"), "img");
    assert.match((await m.page.locator(".avatar").getAttribute("aria-label")) ?? "", /^(idle|thinking|working|needs-you|done)/);
  } finally {
    await m.ctx.close();
  }
});

test("B6 proof 6, 375px sign-in against origin/main: every element of the page has the same box in both builds, and the only pixels that differ are inside the mark's 30px box", async (t) => {
  if (!MAIN) return t.skip(mainWhy);
  const grab = async (origin: string, name: string) => {
    const o = await open(origin, { width: 375, height: 812 });
    try {
      await o.page.locator(".sign-in-card svg.mark").waitFor({ timeout: 15000 });
      await o.page.evaluate(() => (document as any).fonts.ready);
      const boxes = await o.page.evaluate(() =>
        [...document.querySelectorAll("body *")].filter((e) => !e.closest("svg.mark") || e.matches("svg.mark")).map((e) => {
          const b = e.getBoundingClientRect();
          return `${e.tagName.toLowerCase()}.${String((e as any).className?.baseVal ?? e.className)} ${b.left.toFixed(2)},${b.top.toFixed(2)} ${b.width.toFixed(2)}x${b.height.toFixed(2)}`;
        }),
      );
      const mark = await o.page.locator("svg.mark").boundingBox();
      const png = await o.page.screenshot({ fullPage: true });
      if (SHOTS) writeFileSync(path.join(SHOTS, `375-signin-${name}.png`), png);
      return { boxes, mark: mark!, png: png.toString("base64"), doc: await o.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]) };
    } finally {
      await o.ctx.close();
    }
  };
  const a = await grab(MAIN.origin, "main");
  const b = await grab(HEAD.origin, "branch");
  assert.ok(a.boxes.length > 20, `elements measured: ${a.boxes.length}`);
  assert.deepEqual(b.boxes, a.boxes, "an element moved or changed size");
  assert.deepEqual(b.doc, a.doc);
  assert.deepEqual([a.mark.width, a.mark.height, b.mark.width, b.mark.height], [30, 30, 30, 30]);
  // pixel diff, done in a page: the bounding box of every differing pixel
  const d = await open(HEAD.origin, { width: 400, height: 400 });
  try {
    const diff = await d.page.evaluate(async ([p1, p2]) => {
      const load = (b64: string) => new Promise<HTMLImageElement>((res) => { const i = new Image(); i.onload = () => res(i); i.src = "data:image/png;base64," + b64; });
      const [i1, i2] = [await load(p1), await load(p2)];
      const px = (i: HTMLImageElement) => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d")!; g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
      const [d1, d2] = [px(i1), px(i2)];
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
      for (let y = 0; y < i1.height; y++) for (let x = 0; x < i1.width; x++) {
        const k = (y * i1.width + x) * 4;
        if (d1[k] !== d2[k] || d1[k + 1] !== d2[k + 1] || d1[k + 2] !== d2[k + 2] || d1[k + 3] !== d2[k + 3]) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
      return { same: i1.width === i2.width && i1.height === i2.height, n, x0, y0, x1, y1 };
    }, [a.png, b.png]);
    console.log(`  [B6] ${a.boxes.length} element boxes equal; differing pixels ${diff.n}, within x ${diff.x0}..${diff.x1}, y ${diff.y0}..${diff.y1}; the mark's box is x ${b.mark.x}..${b.mark.x + 30}, y ${b.mark.y}..${b.mark.y + 30}`);
    assert.ok(diff.same, "the two screenshots differ in size");
    assert.ok(diff.n > 100, "the mark's pixels did change");
    assert.ok(diff.x0 >= Math.floor(b.mark.x) && diff.x1 < Math.ceil(b.mark.x + 30) && diff.y0 >= Math.floor(b.mark.y) && diff.y1 < Math.ceil(b.mark.y + 30), `a pixel outside the mark changed: ${JSON.stringify(diff)}`);
  } finally {
    await d.ctx.close();
  }
});

const STATES = ["idle", "thinking", "working", "needs-you", "done"] as const;
test("B7 proof 7, the avatar's states on the production build: each ring is 3px outside the tile, radius 10.5px, 2px wide, in the doc's token, leaving 1px between tile and ring; the tile is the same in every state; under reduced motion nothing animates", async (t) => {
  const seen: Record<string, any> = {};
  for (const motion of ["no-preference", "reduce"] as const) {
    const o = await member(HEAD.origin, { width: 1280, height: 860 }, { scale: 6, reducedMotion: motion });
    try {
      for (const state of STATES) {
        // the state class is set on the app's own header avatar: statusOf drives it in the app, and no model runs here
        const r = await o.page.evaluate((st) => {
          const av = document.querySelector(".avatar")!;
          av.className = `avatar avatar--${st}`;
          const markEl = av.querySelector(".avatar-mark")!;
          const cs = getComputedStyle(markEl, "::after");
          const root = getComputedStyle(document.documentElement);
          const tok = (n: string) => { const s = document.createElement("span"); s.style.color = `var(${n})`; document.body.appendChild(s); const v = getComputedStyle(s).color; s.remove(); return v; };
          const tile = av.querySelector("svg.mark")!.getBoundingClientRect();
          const rect = av.querySelector("svg.mark rect")!;
          return {
            radius: cs.borderTopLeftRadius, inset: [cs.top, cs.right, cs.bottom, cs.left], width: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth],
            top: cs.borderTopColor, side: cs.borderRightColor, style: cs.borderTopStyle, anim: cs.animationName, opacity: cs.opacity, ringBox: [cs.width, cs.height],
            tile: [tile.width, tile.height], tileFill: getComputedStyle(rect).fill, d: av.querySelector("svg.mark path")!.getAttribute("d")!.length,
            markAnim: getComputedStyle(av.querySelector("svg.mark")!).animationName, markTransform: getComputedStyle(av.querySelector("svg.mark")!).transform,
            tokens: { strong: tok("--border-strong"), fg: tok("--fg"), muted: tok("--fg-muted"), amber: tok("--amber"), green: tok("--green") },
            reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, _r: root.colorScheme,
          };
        }, state);
        seen[`${motion}/${state}`] = r;
        const at = `${state} (${motion})`;
        assert.equal(r.reduced, motion === "reduce");
        assert.equal(r.radius, "10.5px", `${at}: ring radius`);
        assert.deepEqual(r.inset, ["-3px", "-3px", "-3px", "-3px"], `${at}: the ring sits 3px outside the tile`);
        assert.deepEqual(r.width, ["2px", "2px", "2px", "2px"], `${at}: ring width (3px out, 2px wide, so 1px of ground shows)`);
        assert.deepEqual(r.tile, [28, 28], `${at}: the tile`);
        assert.equal(r.tileFill, TILE, `${at}: the tile changed colour`);
        assert.equal(r.d, 2672, at);
        assert.equal(r.markAnim, "none", `${at}: the tile itself animates`);
        assert.equal(r.markTransform, "none", `${at}: the tile is transformed`);
        const T = r.tokens;
        const clear = "rgba(0, 0, 0, 0)";
        if (state === "idle") assert.deepEqual([r.top, r.side], [clear, clear], `${at}: idle has a ring`);
        if (state === "thinking") assert.deepEqual([r.top, r.side], [T.strong, T.strong], at);
        if (state === "needs-you") assert.deepEqual([r.top, r.side], [T.amber, T.amber], at);
        if (state === "done") assert.deepEqual([r.top, r.side], [T.green, T.green], at);
        if (state === "working" && motion === "no-preference") assert.deepEqual([r.top, r.side, r.style], [T.fg, T.strong, "solid"], `${at}: the --fg arc`);
        if (state === "working" && motion === "reduce") assert.deepEqual([r.top, r.side, r.style], [T.muted, T.muted, "dashed"], `${at}: a still dashed --fg-muted ring`);
        if (motion === "reduce") assert.equal(r.anim, "none", `${at}: the ring animates under reduced motion`);
        else {
          if (state === "thinking" || state === "needs-you") assert.equal(r.anim, "avatar-ring-pulse", at);
          if (state === "working") assert.equal(r.anim, "spin", at);
          if (state === "idle" || state === "done") assert.equal(r.anim, "none", at);
        }
        if (state === "done" && motion === "reduce") assert.equal(r.opacity, "0", `${at}: no ring under reduced motion`);
        if (SHOTS) {
          const box = (await o.page.locator(".avatar .avatar-mark").boundingBox())!;
          // `done` fades to nothing; hold it at the start of the fade for the picture taken with motion on
          if (state === "done" && motion === "no-preference") await o.page.addStyleTag({ content: ".avatar--done .avatar-mark::after{opacity:1 !important;transition:none !important}" }).then((h) => o.page.screenshot({ path: path.join(SHOTS, `avatar-${state}-${motion}-held.png`), clip: { x: box.x - 8, y: box.y - 8, width: 44, height: 44 } }).then(() => h.evaluate((e) => (e as Element).remove())));
          await o.page.screenshot({ path: path.join(SHOTS, `avatar-${state}-${motion}.png`), clip: { x: box.x - 8, y: box.y - 8, width: 44, height: 44 }, animations: "disabled" });
        }
      }
    } finally {
      await o.ctx.close();
    }
  }
  t.diagnostic(JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, `${v.top} ${v.style} anim=${v.anim} opacity=${v.opacity}`]))));
});

test("B7b the look: the app's own mark at 24, 28 and 30px and the served favicon at 16 and 32px, at 1x and enlarged without smoothing (pictures to look at); the glyph's ink is where the doc says", async () => {
  const o = await open(HEAD.origin, { width: 900, height: 420 }, { scale: 1 });
  try {
    await o.page.locator(".sign-in-card svg.mark").waitFor();
    // the ink's box, from the browser's own geometry: "x 3.4 to 28.6 and y 11 to 21 of 32"
    const ink = await o.page.evaluate(() => {
      const b = (document.querySelector("svg.mark path") as SVGPathElement).getBBox();
      return [b.x, b.x + b.width, b.y, b.y + b.height].map((v) => Math.round(v * 10) / 10);
    });
    console.log(`  [B7b] the glyph's ink spans x ${ink[0]}..${ink[1]}, y ${ink[2]}..${ink[3]} of 32`);
    assert.deepEqual([ink[0], ink[1]], [3.4, 28.6], "the ink's x span");
    assert.ok(ink[2] >= 11 && ink[2] <= 11.5 && ink[3] >= 20.5 && ink[3] <= 21, `the ink's y span: ${ink}`);
    assert.ok(Math.abs((ink[0] + ink[1]) / 2 - 16) < 0.06, "centred side to side");
    const fav = await o.page.evaluate(async () => {
      const t = await (await fetch("/favicon.svg")).text();
      const host = document.createElement("div");
      host.innerHTML = t;
      document.body.appendChild(host);
      const b = (host.querySelector("path") as SVGPathElement).getBBox();
      host.remove();
      return [b.x, b.x + b.width, b.y, b.y + b.height].map((v) => Math.round(v * 10) / 10);
    });
    console.log(`  [B7b] the favicon's ink spans x ${fav[0]}..${fav[1]}, y ${fav[2]}..${fav[3]} of 32 (the doc: 14 units tall, 3 units of margin each side)`);
    assert.deepEqual([fav[0], fav[1]], [3, 29], "the favicon's 3 units of margin each side");
    assert.ok(Math.abs(fav[3] - fav[2] - 14) <= 0.3, `the favicon's "10" is 14 units tall: ${fav}`);
    if (!SHOTS) return;
    // a sheet built in the live page from the app's own rendered mark (its CSS and tokens) and the served favicon
    await o.page.evaluate(() => {
      const mark = document.querySelector("svg.mark")!;
      const sheet = document.createElement("div");
      sheet.id = "review-sheet";
      sheet.style.cssText = "position:fixed;inset:0;background:#fff;z-index:99999;padding:16px;font:12px system-ui;color:#111;display:grid;grid-template-columns:repeat(5,auto);gap:14px 28px;align-content:start;justify-content:start;align-items:end";
      const cell = (label: string, node: Element) => { const d = document.createElement("div"); const l = document.createElement("div"); l.textContent = label; l.style.marginTop = "6px"; d.append(node, l); sheet.appendChild(d); };
      for (const s of [24, 28, 30]) { const m = mark.cloneNode(true) as SVGElement; m.setAttribute("width", String(s)); m.setAttribute("height", String(s)); cell(`mark ${s}px`, m); }
      for (const s of [16, 32]) { const i = document.createElement("img"); i.src = "/favicon.svg"; i.width = s; i.height = s; cell(`favicon ${s}px`, i); }
      document.body.appendChild(sheet);
    });
    await o.page.waitForTimeout(300);
    await o.page.screenshot({ path: path.join(SHOTS, "sizes-1x.png"), clip: { x: 0, y: 0, width: 420, height: 80 } });
    // the same pixels, enlarged 8 times with no smoothing: what the screen really gets at 1x
    const cells = await o.page.evaluate(() => [...document.querySelectorAll("#review-sheet > div > :first-child")].map((e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }));
    const names = ["mark-24", "mark-28", "mark-30", "favicon-16", "favicon-32"];
    const big = await browser.newContext({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
    const bp = await big.newPage();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const png = await o.page.screenshot({ clip: { x: Math.floor(c.x) - 2, y: Math.floor(c.y) - 2, width: Math.ceil(c.w) + 4, height: Math.ceil(c.h) + 4 } });
      await bp.setContent(`<body style="margin:0;background:#fff"><img id="i" style="image-rendering:pixelated;width:${(Math.ceil(c.w) + 4) * 8}px" src="data:image/png;base64,${png.toString("base64")}"></body>`);
      await bp.locator("#i").screenshot({ path: path.join(SHOTS, `${names[i]}-1x-enlarged-8.png`) });
    }
    await big.close();
  } finally {
    await o.ctx.close();
  }
  // the same sheet at 2x (a phone or a retina laptop)
  const r = await open(HEAD.origin, { width: 900, height: 420 }, { scale: 2 });
  try {
    await r.page.locator(".sign-in-card svg.mark").waitFor();
    await r.page.evaluate(() => {
      const mark = document.querySelector("svg.mark")!;
      const sheet = document.createElement("div");
      sheet.style.cssText = "position:fixed;inset:0;background:#fff;z-index:99999;padding:16px;display:flex;gap:28px;align-items:flex-start;align-content:flex-start";
      for (const s of [24, 28, 30]) { const m = mark.cloneNode(true) as SVGElement; m.setAttribute("width", String(s)); m.setAttribute("height", String(s)); sheet.appendChild(m); }
      for (const s of [16, 32]) { const i = document.createElement("img"); i.src = "/favicon.svg"; i.width = s; i.height = s; sheet.appendChild(i); }
      document.body.appendChild(sheet);
    });
    await r.page.waitForTimeout(300);
    await r.page.screenshot({ path: path.join(SHOTS!, "sizes-2x.png"), clip: { x: 0, y: 0, width: 330, height: 64 } });
  } finally {
    await r.ctx.close();
  }
});

test("B8 nothing else changed colour: against origin/main the built stylesheet differs only by the two brand tokens and the ring's radius; lime is still the lime button's fill; at 375px the Ten tab's tile is --hero with a --lime icon, and --lime with --on-lime when current", async (t) => {
  const p = await member(HEAD.origin, { width: 375, height: 812 }, { scale: 2 });
  try {
    const tok = (n: string) => p.page.evaluate((name) => { const s = document.createElement("span"); s.style.color = `var(${name})`; document.body.appendChild(s); const v = getComputedStyle(s).color; s.remove(); return v; }, n);
    const [hero, lime, onLime] = [await tok("--hero"), await tok("--lime"), await tok("--on-lime")];
    assert.deepEqual([hero, lime, onLime], ["rgb(11, 12, 14)", "rgb(200, 240, 60)", "rgb(10, 10, 11)"], "the doc's --hero #0B0C0E, --lime #C8F03C, --on-lime #0A0A0B");
    const tile = () => p.page.evaluate(() => { const e = document.querySelector(".tabbar-ten-tile")!; const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return { bg: cs.backgroundColor, color: cs.color, size: [b.width, b.height], radius: cs.borderTopLeftRadius, marks: e.querySelectorAll("svg.mark").length, current: e.closest(".tabbar-item")!.getAttribute("aria-current") }; });
    const rest = await tile();
    assert.deepEqual(rest, { bg: hero, color: lime, size: [44, 30], radius: "10px", marks: 0, current: null }, "the Ten tab at rest");
    await shot(p.page.locator(".tabbar"), "phone-tabbar-rest.png");
    await p.page.locator(".tabbar-item--ten").click();
    await p.page.locator(".bubble--assistant").first().waitFor({ timeout: 15000 });
    const cur = await tile();
    assert.deepEqual(cur, { bg: lime, color: onLime, size: [44, 30], radius: "10px", marks: 0, current: "page" }, "the Ten tab when current");
    await shot(p.page.locator(".tabbar"), "phone-tabbar-current.png");
    assert.deepEqual(await terracottaUsers(p.page, TILE), [], "phone: something besides the mark's tile is terracotta");
    await shot(p.page, "phone-talk-375.png");
    // the lime button class still resolves to lime
    const btn = await p.page.evaluate(() => { const b = document.createElement("button"); b.className = "btn btn--lime"; document.body.appendChild(b); const cs = getComputedStyle(b); const v = [cs.backgroundColor, cs.color]; b.remove(); return v; });
    assert.deepEqual(btn, [lime, onLime], ".btn--lime");
  } finally {
    await p.ctx.close();
  }
  if (!MAIN) return t.skip(mainWhy);
  const cssOf = (dist: string) => { const dir = path.join(dist, "assets"); const f = readdirSync(dir).filter((n) => n.endsWith(".css")); assert.equal(f.length, 1); return readFileSync(path.join(dir, f[0]), "utf8"); };
  const head = cssOf(HEAD.dist);
  const main = cssOf(MAIN.dist);
  // undo exactly what the doc says changed; what is left must be main's stylesheet
  const undone = head.replace(/--brand:\s*#c15f3c;/i, "").replace(/--on-brand:\s*#fff(fff)?;/i, "");
  assert.notEqual(undone, head, "the two tokens are in the built stylesheet");
  const split = (s: string) => s.split(/(?<=[;{}])/);
  const [a, b] = [split(main), split(undone)];
  const diffs: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diffs.push(`main: ${String(a[i]).slice(0, 80)} | branch: ${String(b[i]).slice(0, 80)}`);
  console.log(`  [B8] built stylesheet, main vs branch after removing the two tokens: ${a.length} pieces, ${diffs.length} differ: ${JSON.stringify(diffs)}`);
  assert.equal(a.length, b.length, "the stylesheets differ in shape");
  assert.equal(diffs.length, 1, JSON.stringify(diffs.slice(0, 5)));
  assert.match(diffs[0], /border-radius:11px.*border-radius:10\.5px/);
  // and in the source tree, the only apps/web files that differ from main
  const changed = spawnSync("git", ["-C", REPO, "diff", "--name-only", "origin/main", "origin/feat/brand-mark-10x", "--", "apps/web"], { encoding: "utf8" });
  if (changed.status === 0) assert.deepEqual(changed.stdout.trim().split("\n").sort(), ["apps/web/public/favicon.svg", "apps/web/src/components/BrandMark.tsx", "apps/web/src/styles.css"]);
});

test("B9 last: nothing left 127.0.0.1", () => {
  assert.deepEqual(external, []);
});
