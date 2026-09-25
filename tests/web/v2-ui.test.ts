// Tester-owned: the v2 "bolder" UI (docs/design-web-ui-refresh.md, owner-
// chosen 2026-09-24; commit 47e65e8) against design-web-ui.md's rules,
// measured on what RENDERS, not on the token table:
//   - WCAG AA: every text/background pair >= 4.5:1 (>= 3:1 for large text),
//     computed from each text element's rendered colour, its ancestors'
//     opacity (the v2 `.tool-run { opacity: .82 }`), and the backgrounds it
//     sits on — light and dark;
//   - `prefers-reduced-motion: reduce`: no running motion, the state signal
//     kept (refresh doc: "swaps motion for a still state, never removes the
//     signal");
//   - "cards appear only when complete, no layout shift" while streaming;
//   - 375 px: no horizontal scroll; the gate card has no button (rule 7).
// Drives the preview build (the mock app, fixtures) headless in Chromium.
// Run: node --test tests/web/v2-ui.test.ts
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "../../apps/web/node_modules/playwright/index.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const fx = (n: string) => JSON.parse(readFileSync(path.join(WEB, "fixtures", `${n}.json`), "utf8"));
const FIXTURES = ["mvp-journey", "gate-moment", "over-limit-error", "checker-failure"];

let server: Server;
let base = "";
let browser: Browser;
let outDir = "";

before(async () => {
  outDir = mkdtempSync(path.join(tmpdir(), "ten-v2-preview-"));
  const b = spawnSync(process.execPath, [path.join(WEB, "node_modules/vite/bin/vite.js"), "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"], {
    cwd: WEB,
    encoding: "utf8",
    env: { ...process.env, VITE_SHOW_MOCK_CONTROLS: "1" },
  });
  assert.equal(b.status, 0, `preview build failed:\n${b.stdout}\n${b.stderr}`);
  const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };
  server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const file = path.join(outDir, p === "/" ? "index.html" : p);
    if (!file.startsWith(outDir) || !existsSync(file) || lstatSync(file).isDirectory()) return void res.writeHead(404).end();
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

async function open(opts: { colorScheme?: "light" | "dark"; reducedMotion?: "reduce" | "no-preference"; width?: number } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 1280, height: 860 },
    colorScheme: opts.colorScheme ?? "light",
    reducedMotion: opts.reducedMotion ?? "no-preference",
    hasTouch: (opts.width ?? 1280) < 500,
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    (window as any).__cls = 0;
    (window as any).__shifts = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as any[]) {
          if (e.hadRecentInput) continue;
          (window as any).__cls += e.value;
          (window as any).__shifts.push({ v: e.value, nodes: (e.sources ?? []).map((s: any) => (s.node && s.node.className) || s.node?.nodeName || "?") });
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      /* not supported */
    }
    (window as any).__running = [];
    setInterval(() => {
      for (const a of document.getAnimations()) {
        const t = a.effect?.getComputedTiming?.();
        // motion only: a keyframe animation, or a transition of a moving
        // property (a colour fade is not motion)
        const prop = (a as any).transitionProperty as string | undefined;
        const moving = (a as any).animationName !== undefined || (prop !== undefined && /^(transform|translate|scale|rotate|top|left|right|bottom|width|height|inset|margin(-(top|right|bottom|left))?)$/.test(prop));
        if (moving && a.playState === "running" && t && Number(t.duration) > 1) {
          const tgt = (a.effect as any)?.target;
          (window as any).__running.push(`${(a as any).animationName ?? prop}@${tgt?.className ?? tgt?.nodeName}:${Math.round(Number(t.duration))}ms`);
        }
      }
    }, 40);
  });
  await page.goto(base);
  await page.locator(".composer-input").waitFor();
  return page;
}
const select = (page: Page, id: string) => page.locator(".fixture-picker select").selectOption(id);
async function waitSettled(page: Page) {
  await page.waitForFunction(() => {
    const a = document.querySelector(".avatar");
    const i = document.querySelector(".composer-input") as HTMLTextAreaElement | null;
    return a && !/thinking|working/.test(a.className) && i && !i.disabled;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(150);
}
async function playTyped(page: Page, name: string) {
  for (const m of fx(name).messages) {
    if (m.role !== "user") continue;
    await page.locator(".composer-input").fill(m.parts.find((p: any) => p.type === "text").text);
    await page.locator(".composer-input").press("Enter");
    await page.waitForTimeout(50);
    await waitSettled(page);
  }
}
async function expandAllToolRuns(page: Page) {
  // in-page: a toggle re-renders on click, so a Playwright handle can go stale
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".tool-run-toggle[aria-expanded=false]").forEach((b) => b.click()));
  await page.waitForTimeout(150);
}

/** Every visible text element whose rendered contrast is under WCAG AA.
 *  Each element's composited background and opacity are computed once from
 *  its parent's (memoised), so the audit is linear in the DOM. */
function contrastAudit(page: Page) {
  return page.evaluate(() => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    };
    const over = (top: any, bottom: any) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const lum = (c: any) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a: any, b: any) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const unparsed = new Set<string>();
    const memo = new Map<Element, { bg: any; opacity: number }>();
    const info = (el: Element): { bg: any; opacity: number } => {
      const hit = memo.get(el);
      if (hit) return hit;
      const parent = el.parentElement ? info(el.parentElement) : { bg: { r: 255, g: 255, b: 255, a: 1 }, opacity: 1 };
      const s = getComputedStyle(el);
      const c = parse(s.backgroundColor);
      if (!c && s.backgroundColor) unparsed.add(s.backgroundColor);
      const v = { bg: c && c.a > 0 ? over(c, parent.bg) : parent.bg, opacity: parent.opacity * Number(s.opacity) };
      memo.set(el, v);
      return v;
    };
    const bad: string[] = [];
    let checked = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (el.closest(".fixture-picker, [aria-hidden=true], script, style, :disabled")) continue;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
      if (!own) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility !== "visible") continue;
      const { bg, opacity } = info(el);
      if (opacity === 0) continue;
      const fg0 = parse(cs.color);
      if (!fg0) {
        unparsed.add(cs.color);
        continue;
      }
      const fg = over({ ...fg0, a: fg0.a * opacity }, bg);
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      const got = ratio(fg, bg);
      checked++;
      if (got < need) bad.push(`${(el.className || el.tagName).toString().slice(0, 40)} ${got.toFixed(2)} < ${need} (opacity ${opacity.toFixed(2)})`);
    }
    return { bad: Array.from(new Set(bad)), checked, unparsed: Array.from(unparsed) };
  });
}

// ------------------------------------------------------------------ contrast

for (const scheme of ["light", "dark"] as const) {
  test(`v2 contrast (${scheme}): every rendered text/background pair meets WCAG AA (4.5:1, large 3:1), tool rows expanded`, async () => {
    const page = await open({ colorScheme: scheme });
    const all: string[] = [];
    let checked = 0;
    for (const f of ["mvp-journey", "gate-moment", "over-limit-error"]) {  // every card kind between them
      await select(page, f);
      await playTyped(page, f);
      await expandAllToolRuns(page);
      const r = await contrastAudit(page);
      checked += r.checked;
      assert.deepEqual(r.unparsed.filter((c) => !/^(transparent|)$/.test(c)), [], "every colour is measurable");
      all.push(...r.bad.map((b) => `[${f}] ${b}`));
    }
    assert.ok(checked > 50, `audited ${checked} text elements`);
    assert.deepEqual([...new Set(all)], [], `${scheme}: pairs under AA`);
    await page.context().close();
  });
}

// ------------------------------------------------------------------ motion

test("v2 reduced motion: no running animation or transition during a whole turn; the avatar still signals its state", async () => {
  const page = await open({ reducedMotion: "reduce" });
  await page.evaluate(() => ((window as any).__states = new Set<string>()));
  await page.evaluate(() => setInterval(() => {
    const a = document.querySelector(".avatar");
    if (a) for (const c of a.classList) if (c.startsWith("avatar--")) (window as any).__states.add(c.slice(8));
  }, 10));
  await select(page, "mvp-journey");
  await playTyped(page, "mvp-journey");
  const running: string[] = await page.evaluate(() => (window as any).__running);
  const states: string[] = await page.evaluate(() => [...(window as any).__states]);
  assert.deepEqual([...new Set(running)], [], "no motion under prefers-reduced-motion: reduce");
  assert.ok(states.includes("working") || states.includes("thinking"), `the state signal is kept (${states})`);
  await page.context().close();
});

test("v2 motion (control): with no preference the avatar pulse and card entry do animate (the probe sees motion)", async () => {
  const page = await open();
  await select(page, "mvp-journey");
  await playTyped(page, "mvp-journey");
  const running: string[] = await page.evaluate(() => (window as any).__running);
  assert.ok(running.length > 0, "motion is observable when allowed");
  await page.context().close();
});

// ------------------------------------------------------------------ layout shift

test("v2 streaming: no layout shift while a turn streams (cards appear only when complete)", async () => {
  const page = await open();
  await select(page, "mvp-journey");
  await playTyped(page, "mvp-journey");
  const cls: number = await page.evaluate(() => (window as any).__cls);
  const shifts = await page.evaluate(() => (window as any).__shifts);
  assert.ok(cls < 0.01, `cumulative layout shift ${cls.toFixed(4)}: ${JSON.stringify(shifts).slice(0, 400)}`);
  await page.context().close();
});

// ------------------------------------------------------------------ 375 px, gate

test("v2 at 375 px: no horizontal scroll on any fixture; the gate card has no button or input (typed yes only)", async () => {
  const page = await open({ width: 375 });
  for (const f of FIXTURES) {
    await select(page, f);
    await playTyped(page, f);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(sw <= iw, `${f}: scrollWidth ${sw} > ${iw}`);
  }
  await select(page, "gate-moment");
  await playTyped(page, "gate-moment");
  assert.ok((await page.locator(".card--gate").count()) >= 1);
  assert.equal(await page.locator(".card--gate button, .card--gate [role=button], .card--gate input").count(), 0);
  await page.context().close();
});
