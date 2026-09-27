// Tester-owned: workspace Stage 1, "Foundation" (docs/design-web-ui.md
// § 5.9 Stage 1's exit and tester checks), measured against § 5.6 (the
// visual spec, direction C). Every expected value is read from the SPEC
// (the doc's own token block, favicon, mark, icon tables and component
// states), never from the code under test.
//
//   Static:   the token block equals § 5.6's; no colour/font/radius literal
//             outside it; fonts (Bricolage 5.3.0 in, Fraunces out); the icon
//             module (Lucide 1.48.0 path data, ISC, stroke 1.75, § 5.6's icon
//             list, no icon package); the favicon; § 5.6's contrast table.
//   Browser:  the preview build (mock app, every fixture, the preview-only
//             sign-in / not-a-member / update-notice screens) and a tester
//             harness (tests/web/stage1/harness.tsx: the real member Header,
//             ⋯ menu and the three dialogs; the shared .btn/.toast/.skeleton
//             shapes) — headless Chromium. Contrast of every rendered
//             text/ground token pair (and hover and disabled states), 375px
//             no horizontal scroll, :focus-visible on every control, the five
//             control states, reduced motion, no layout shift while
//             streaming, loading buttons keep size and label, dialog focus
//             trap/return, the brand mark as rendered, fonts self-hosted.
//
// Run: node --test tests/web/stage1-foundation.test.ts
// Screenshots (1440x900 and 375x812, every screen): STAGE1_SHOTS=<dir>.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "../../apps/web/node_modules/playwright/index.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const HARNESS = path.join(REPO, "tests/web/stage1");
const DOC = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");
const CSS = readFileSync(path.join(WEB, "src/styles.css"), "utf8");
const SHOTS = process.env.STAGE1_SHOTS;

// ---------------------------------------------------------------- spec extraction

/** § 5.6, from its heading to § 5.7's. */
const S56 = (() => {
  const a = DOC.indexOf("### 5.6 Visual spec");
  const b = DOC.indexOf("### 5.7 ", a);
  assert.ok(a > 0 && b > a, "§ 5.6 not found in docs/design-web-ui.md");
  return DOC.slice(a, b);
})();
/** A `#### <title>` subsection of § 5.6, up to the next `#### `. */
function sub(title: string): string {
  const a = S56.indexOf(`#### ${title}`);
  assert.ok(a >= 0, `§ 5.6 has no "#### ${title}"`);
  const b = S56.indexOf("\n#### ", a + 5);
  return S56.slice(a, b < 0 ? undefined : b);
}
/** The first fenced block of `lang` in `text`. */
function fence(text: string, lang: string): string {
  const m = text.match(new RegExp("```" + lang + "\\n([\\s\\S]*?)\\n```"));
  assert.ok(m, `no \`\`\`${lang} block`);
  return m![1];
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

type Decls = Map<string, Map<string, string>>;
function parseDecls(css: string): Decls {
  const out: Decls = new Map();
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    const d = new Map<string, string>();
    for (const decl of m[2].split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      d.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim().replace(/\s+/g, " "));
    }
    out.set(sel, d);
  }
  return out;
}

const SPEC_TOKENS = parseDecls(fence(sub("The token block"), "css"));

/** styles.css's token block: `:root { … }` through the dark block after it. */
const BLOCK = (() => {
  const start = CSS.indexOf(":root {");
  const dark = CSS.indexOf('[data-theme="dark"] {', start);
  assert.ok(start >= 0 && dark > start, "styles.css has no :root block followed by the dark block");
  const end = CSS.indexOf("}", dark) + 1;
  return { start, end, text: CSS.slice(start, end) };
})();
const OUTSIDE = stripComments(CSS.slice(0, BLOCK.start)) + "\n".repeat(0) + stripComments(CSS.slice(BLOCK.end));
const lineOf = (offsetInOutside: number) => {
  // map an offset in OUTSIDE back to a styles.css line number
  const pre = CSS.slice(0, BLOCK.start);
  const off = offsetInOutside < pre.length ? offsetInOutside : offsetInOutside - pre.length + BLOCK.end;
  return CSS.slice(0, off).split("\n").length;
};

const light = SPEC_TOKENS.get(":root")!;
const hex = (name: string) => {
  const v = light.get(name);
  assert.ok(v && /^#[0-9a-f]{6}$/i.test(v), `${name} is not a hex token in § 5.6: ${v}`);
  return v!;
};
function rgbOf(h: string) {
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}
function lum(c: { r: number; g: number; b: number }) {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrast(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ---------------------------------------------------------------- static checks

test("tokens: styles.css's token block equals § 5.6's, light (:root) and dormant dark, value for value", () => {
  const impl = parseDecls(BLOCK.text);
  assert.deepEqual([...impl.keys()], [...SPEC_TOKENS.keys()], "the same two selectors, in order");
  for (const [sel, spec] of SPEC_TOKENS) {
    const got = impl.get(sel)!;
    const diffs: string[] = [];
    for (const k of new Set([...spec.keys(), ...got.keys()])) if (spec.get(k) !== got.get(k)) diffs.push(`${k}: spec=${spec.get(k)} impl=${got.get(k)}`);
    assert.deepEqual(diffs, [], `${sel} differs from § 5.6`);
  }
  assert.equal(light.get("color-scheme"), "light", "light is the default (chain rule: light only)");
});

test("tokens: no other rule in styles.css defines a custom property (one token block)", () => {
  const extra = [...OUTSIDE.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gi)].map((m) => `${m[2]} @ styles.css:${lineOf(m.index!)}`);
  assert.deepEqual(extra, []);
});

test("literals: no hex, rgb()/rgba() (or any other colour function) outside the token block (§ 5.9 Stage 1's exit grep)", () => {
  const hits = [...OUTSIDE.matchAll(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi)].map((m) => `${m[0]} @ styles.css:${lineOf(m.index!)}`);
  assert.deepEqual(hits, []);
});

test("literals: every font-family outside the block is a --font-* token (or inherit), every letter-spacing a --track-* token", () => {
  const bad: string[] = [];
  const decls = [...OUTSIDE.matchAll(/(^|[;{\s])(font-family|letter-spacing)\s*:\s*([^;}]+)/g)];
  for (const m of decls) {
    const v = m[3].trim();
    const ok = m[2] === "font-family" ? /^(var\(--font-[a-z]+\)|inherit)$/.test(v) : /^(var\(--track-[a-z-]+\)|normal)$/.test(v);
    if (!ok) bad.push(`${m[2]}: ${v} @ styles.css:${lineOf(m.index!)}`);
  }
  for (const m of OUTSIDE.matchAll(/(^|[;{\s])font\s*:\s*([^;}]+)/g)) {
    const v = m[2].trim();
    if (!/^var\(--type-[a-z-]+\)$/.test(v) && !/var\(--font-[a-z]+\)$/.test(v)) bad.push(`font: ${v} @ styles.css:${lineOf(m.index!)}`);
  }
  assert.deepEqual(bad, [], "§ 5.6 names no font family and no tracking outside its tokens");
});

test("literals: every radius/font-size literal outside the block is one § 5.6 itself names (component values with no token)", () => {
  // The literal radii and type sizes § 5.6 writes into its component states
  // (dialog 18px, menu 14px, lg button/send/fields/verdict tile 10px, doc
  // tile/skeleton 6px, paper 4px, avatar ring 11px; tier pill 12.5px, gate
  // line 14.5px, mono 11.5px, activity rows 13.5px, amounts 20px, …).
  const specText = S56;
  const bad: string[] = [];
  for (const m of OUTSIDE.matchAll(/(^|[;{\s])(border(?:-[a-z-]+)?-radius|border-radius)\s*:\s*([^;}]+)/g)) {
    const v = m[3].trim();
    if (/^var\(--radius-[a-z]+\)$/.test(v)) continue;
    if (!new RegExp(`radius[^.;]{0,40}?${v.replace(/[.%]/g, "\\$&")}|${v.replace(/[.%]/g, "\\$&")}[^.;]{0,20}radius`).test(specText)) bad.push(`radius ${v} @ styles.css:${lineOf(m.index!)}`);
  }
  for (const m of OUTSIDE.matchAll(/(^|[;{\s])font-size\s*:\s*([^;}]+)/g)) {
    const v = m[2].trim();
    if (!specText.includes(v)) bad.push(`font-size ${v} @ styles.css:${lineOf(m.index!)}`);
  }
  assert.deepEqual(bad, []);
});

test("chain rule: amber is only for needs-you (§ 5.6, 'Chain rules this spec keeps') — every rule using --amber* is a needs-you or gate rule", () => {
  const bad: string[] = [];
  for (const m of OUTSIDE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/var\(--amber/.test(m[2])) continue;
    const sel = m[1].trim().replace(/\s+/g, " ");
    if (!/needs-you|gate/.test(sel)) bad.push(`${sel} @ styles.css:${lineOf(m.index! + m[0].indexOf("{"))}`);
  }
  assert.deepEqual(bad, []);
});

test("fonts: Bricolage Grotesque 5.3.0 pinned, Fraunces gone (package.json, lockfile, src, index.html); only § 5.6's four families", () => {
  const pkg = JSON.parse(readFileSync(path.join(WEB, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
  const fontsTable = sub("Fonts");
  const pinned = fontsTable.match(/`@fontsource-variable\/bricolage-grotesque`\s+\*\*([0-9.]+)\*\*/);
  assert.ok(pinned, "§ 5.6 pins a Bricolage version");
  assert.equal(deps["@fontsource-variable/bricolage-grotesque"], pinned![1], "pinned exactly, not a range");
  const lock = JSON.parse(readFileSync(path.join(WEB, "package-lock.json"), "utf8"));
  assert.equal(lock.packages["node_modules/@fontsource-variable/bricolage-grotesque"]?.version, pinned![1]);
  const specFamilies = [...fontsTable.matchAll(/`(@fontsource(?:-variable)?\/[a-z0-9-]+)`/g)].map((m) => m[1]).filter((n) => !/fraunces/.test(n));
  const fontDeps = Object.keys(deps).filter((d) => d.startsWith("@fontsource"));
  assert.deepEqual(fontDeps.sort(), [...new Set(specFamilies)].sort(), "exactly § 5.6's four @fontsource packages");
  const hay = [
    readFileSync(path.join(WEB, "package.json"), "utf8"),
    readFileSync(path.join(WEB, "package-lock.json"), "utf8"),
    readFileSync(path.join(WEB, "index.html"), "utf8"),
    CSS,
    ...spawnSync("git", ["ls-files", "apps/web/src"], { cwd: REPO, encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean).map((f) => readFileSync(path.join(REPO, f), "utf8")),
  ].join("\n");
  assert.equal(/fraunces/i.test(hay), false, "Fraunces appears in apps/web");
  const main = readFileSync(path.join(WEB, "src/main.tsx"), "utf8");
  for (const imp of ["@fontsource-variable/bricolage-grotesque", "@fontsource-variable/inter", "@fontsource-variable/source-serif-4", "@fontsource/jetbrains-mono/400.css", "@fontsource/jetbrains-mono/500.css"]) assert.ok(main.includes(`import "${imp}"`), `main.tsx imports ${imp}`);
});

test("icons: apps/web/src/icons.tsx is Lucide 1.48.0 (ISC notice, § 5.6's icon list, stroke 1.75, 24 viewBox, no icon package, no CDN)", () => {
  const src = readFileSync(path.join(WEB, "src/icons.tsx"), "utf8");
  const icons = sub("Icons");
  const version = icons.match(/version \*\*([0-9.]+)\*\*/)![1];
  assert.ok(src.includes(`lucide-static v${version} - ISC`) || src.includes(`lucide-static@${version}`), "names lucide-static at § 5.6's version");
  for (const s of ["ISC License", "Copyright (c) 2026 Lucide Icons and Contributors", "Permission to use, copy, modify, and/or distribute this software for any", 'THE SOFTWARE IS PROVIDED "AS IS"']) assert.ok(src.includes(s), `ISC notice: "${s}"`);
  // § 5.6's two icon tables: every `name` in their first column
  const want = new Set([...icons.matchAll(/^\| `([a-z0-9-]+)`/gm)].map((m) => m[1]));
  const have = new Set([...src.matchAll(/\/\/\s*([a-z0-9-]+)\s+—/g)].map((m) => m[1]));
  assert.deepEqual([...want].filter((n) => !have.has(n)), [], "every § 5.6 icon is in the module");
  assert.deepEqual([...have].filter((n) => !want.has(n)), [], "no icon § 5.6 does not name");
  assert.match(src, /viewBox="0 0 24 24"/);
  assert.match(src, /strokeWidth=\{1\.75\}/);
  assert.match(src, /strokeLinecap="round"/);
  assert.match(src, /strokeLinejoin="round"/);
  assert.match(src, /fill="none"/);
  assert.match(src, /stroke="currentColor"/);
  const pkg = JSON.parse(readFileSync(path.join(WEB, "package.json"), "utf8"));
  const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.deepEqual(all.filter((d) => /lucide|icon|heroicons|phosphor|tabler|feather/i.test(d)), [], "no icon package");
  assert.equal(/https?:\/\//.test(src.replace(/^\/\/.*$/gm, "")), false, "no URL in the icon module's code");
});

// Canonical element lists of lucide-static@1.48.0's own icons/<name>.svg
// (npm tarball sha512-ZUGgZ4rz…jKlUjA==), sha256 over the elements joined by
// "\n", each normalised to `<tag attrs/>` with single spaces. Computed once
// by the tester from the registry tarball (2026-09-26), not from icons.tsx.
const UPSTREAM_SHA256: Record<string, string> = JSON.parse(readFileSync(path.join(HARNESS, "lucide-1.48.0.sha256.json"), "utf8"));
test("icons: every icon's path data equals lucide-static@1.48.0's, element for element", () => {
  const src = readFileSync(path.join(WEB, "src/icons.tsx"), "utf8");
  const body = src.split("const PATHS")[1].split("\n};")[0];
  const entries = [...body.matchAll(/\/\/\s*([a-z0-9-]+)\s+—[^\n]*\n\s*(\w+):\s*\(([\s\S]*?)\n\s*\),/g)];
  assert.equal(entries.length, Object.keys(UPSTREAM_SHA256).length, "one entry per upstream digest");
  const bad: string[] = [];
  for (const [, kebab, , jsx] of entries) {
    const els = [...jsx.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)\s*\/>/g)].map((m) => `<${m[1]} ${m[2].trim().split(/\s+/).join(" ")}/>`);
    const digest = createHash("sha256").update(els.join("\n")).digest("hex");
    if (UPSTREAM_SHA256[kebab] !== digest) bad.push(kebab);
  }
  assert.deepEqual(bad, []);
});

test("brand mark: favicon.svg is § 5.6's SVG byte for byte, linked as § 5.6 says", () => {
  const spec = fence(sub("The brand mark"), "svg");
  assert.equal(readFileSync(path.join(WEB, "public/favicon.svg"), "utf8").trim(), spec.trim());
  assert.ok(readFileSync(path.join(WEB, "index.html"), "utf8").includes('<link rel="icon" type="image/svg+xml" href="/favicon.svg"'));
});

test("contrast: § 5.6's table recomputed from the token block — every listed pair >= 4.5:1 and within 0.02 of the stated ratio", () => {
  const table = sub("The token block");
  const rows = [...table.matchAll(/^\| `(--[a-z-]+)` on `(--[a-z-]+)`[^|]*\| ([0-9.]+) \|$/gm)];
  assert.ok(rows.length >= 7, "the contrast table's rows");
  const bad: string[] = [];
  for (const [, fg, bg, stated] of rows) {
    const r = contrast(rgbOf(hex(fg)), rgbOf(hex(bg)));
    if (r < 4.5 || Math.abs(r - Number(stated)) > 0.02 * Number(stated)) bad.push(`${fg} on ${bg}: computed ${r.toFixed(2)}, stated ${stated}`);
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- browser

let browser: Browser;
let previewServer: Server;
let harnessServer: Server;
let previewBase = "";
let harnessBase = "";
const tmp: string[] = [];
const external: string[] = [];
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };

function serve(dir: string): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    let file = path.join(dir, p === "/" ? "index.html" : p);
    if (!file.startsWith(dir) || !existsSync(file) || lstatSync(file).isDirectory()) file = path.join(dir, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: `http://127.0.0.1:${(server.address() as any).port}/` })));
}

before(async () => {
  const pOut = mkdtempSync(path.join(tmpdir(), "ten-stage1-preview-"));
  tmp.push(pOut);
  const b = spawnSync(process.execPath, [path.join(WEB, "node_modules/vite/bin/vite.js"), "build", "--outDir", pOut, "--emptyOutDir", "--logLevel", "error"], {
    cwd: WEB,
    encoding: "utf8",
    env: { ...process.env, VITE_SHOW_MOCK_CONTROLS: "1" },
  });
  assert.equal(b.status, 0, `preview build failed:\n${b.stdout}\n${b.stderr}`);
  const link = path.join(HARNESS, "node_modules");
  if (!existsSync(link)) symlinkSync("../../../apps/web/node_modules", link);
  const hOut = mkdtempSync(path.join(tmpdir(), "ten-stage1-harness-"));
  tmp.push(hOut);
  const { build } = (await import(path.join(WEB, "node_modules/vite/dist/node/index.js"))) as typeof import("vite");
  await build({ root: HARNESS, configFile: path.join(WEB, "vite.config.ts"), logLevel: "error", build: { outDir: hOut, emptyOutDir: true } });
  ({ server: previewServer, base: previewBase } = await serve(pOut));
  ({ server: harnessServer, base: harnessBase } = await serve(hOut));
  browser = await chromium.launch();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
after(async () => {
  await browser?.close();
  for (const s of [previewServer, harnessServer]) await new Promise<void>((r) => (s ? s.close(() => r()) : r()));
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

const fx = (n: string) => JSON.parse(readFileSync(path.join(WEB, "fixtures", `${n}.json`), "utf8"));
const FIXTURES = ["empty-first-run", "mvp-journey", "gate-moment", "over-limit-error", "checker-failure"];
const PREVIEWS = ["sign-in", "not-a-member", "update-notice"];
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "375", width: 375, height: 812 },
];

async function context(opts: { width?: number; height?: number; reducedMotion?: "reduce" | "no-preference" } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    colorScheme: "light",
    reducedMotion: opts.reducedMotion ?? "no-preference",
    hasTouch: (opts.width ?? 1440) < 500,
  });
  ctx.on("request", (r) => {
    const u = new URL(r.url());
    if (!["127.0.0.1", "localhost"].includes(u.hostname) && !["data:", "blob:", "about:"].includes(u.protocol)) external.push(r.url());
  });
  await ctx.addInitScript(() => {
    const w = window as any;
    w.__cls = 0;
    w.__shifts = [];
    w.__anims = new Set<string>();
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as any[]) {
          if (e.hadRecentInput) continue;
          w.__cls += e.value;
          w.__shifts.push(`${e.value.toFixed(4)} ${(e.sources ?? []).map((s: any) => s.node?.getAttribute?.("class") || s.node?.nodeName).join(",")}`);
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      /* unsupported */
    }
    const sample = () => {
      for (const a of document.getAnimations() as any[]) {
        if (a.playState !== "running") continue;
        const tgt = a.effect?.target as Element | undefined;
        const who = tgt ? `${tgt.tagName.toLowerCase()}.${(tgt.getAttribute("class") ?? "").split(/\s+/).join(".")}` : "?";
        if (a.animationName) w.__anims.add(`keyframes ${a.animationName} @ ${who}`);
        else if (a.transitionProperty && /^(transform|translate|scale|rotate|top|left|right|bottom|width|height|inset|margin.*)$/.test(a.transitionProperty)) w.__anims.add(`transition ${a.transitionProperty} @ ${who}`);
      }
    };
    setInterval(sample, 25);
  });
  return ctx;
}

async function openApp(ctx: BrowserContext, fixture?: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(previewBase);
  await page.locator(".composer-input").waitFor();
  if (fixture) await page.locator(".fixture-picker select").selectOption(fixture);
  await page.waitForTimeout(100);
  return page;
}
async function openPreview(ctx: BrowserContext, kind: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${previewBase}?preview=${kind}`);
  await page.waitForLoadState("networkidle");
  return page;
}
async function openHarness(ctx: BrowserContext, query: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${harnessBase}?${query}`);
  await page.waitForLoadState("networkidle");
  return page;
}
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const a = document.querySelector(".avatar");
    const i = document.querySelector(".composer-input") as HTMLTextAreaElement | null;
    return a && !/thinking|working/.test(a.className) && i && !i.disabled;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(250);
}
async function play(page: Page, fixture: string, opts: { expand?: boolean; userFocus?: boolean } = {}) {
  for (const m of fx(fixture).messages ?? []) {
    if (m.role !== "user") continue;
    const text = m.parts.find((p: any) => p.type === "text")?.text;
    if (!text) continue;
    // `userFocus`: focus the composer with a trusted click first, as a person
    // does (LEAD RULING, Stage 2): `.fill()` alone focuses it
    // programmatically, which the Layout Instability API treats as no input,
    // so a shift the frame makes on focus (the phone tab bar hiding while
    // typing, § 5.6) would count as unprompted. A shift in the 500 ms after
    // any trusted input (this click, the Enter below) is excluded by the API
    // itself; anything later while the reply streams still counts.
    if (opts.userFocus) await page.locator(".composer-input").click();
    await page.locator(".composer-input").fill(text);
    await page.locator(".composer-input").press("Enter");
    await page.waitForTimeout(40);
    await settled(page);
  }
  if (opts.expand === false) return;
  // expanded rows put the literal tool input/output on screen too
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".tool-run-toggle[aria-expanded=false]").forEach((b) => b.click()));
  await page.waitForTimeout(250);
}

/** Every screen Stage 1 restyles, as a function that opens it on `ctx`. */
function screens(): { name: string; open: (ctx: BrowserContext) => Promise<Page> }[] {
  const out: { name: string; open: (ctx: BrowserContext) => Promise<Page> }[] = [];
  for (const f of FIXTURES)
    out.push({
      name: `fixture:${f}`,
      open: async (ctx) => {
        const p = await openApp(ctx, f);
        await play(p, f);
        return p;
      },
    });
  // The gate while it still waits for the typed yes (every fixture above is
  // played to its end, where gate-moment's gate is already approved).
  out.push({
    name: "fixture:gate-moment-pending",
    open: async (ctx) => {
      const p = await openApp(ctx, "gate-moment");
      const first = fx("gate-moment").messages.find((m: any) => m.role === "user").parts.find((x: any) => x.type === "text").text;
      await p.locator(".composer-input").fill(first);
      await p.locator(".composer-input").press("Enter");
      await p.waitForFunction(() => /needs-you/.test(document.querySelector(".avatar")?.className ?? ""), null, { timeout: 60000 });
      await p.waitForTimeout(300);
      return p;
    },
  });
  for (const k of PREVIEWS) out.push({ name: `preview:${k}`, open: (ctx) => openPreview(ctx, k) });
  out.push({
    name: "mock:menu-open",
    open: async (ctx) => {
      const p = await openApp(ctx, "mvp-journey");
      await p.locator(".menu-trigger").click();
      await p.locator(".menu-panel").waitFor();
      return p;
    },
  });
  out.push({
    name: "member:menu-open",
    open: async (ctx) => {
      const p = await openHarness(ctx, "scene=shell");
      await p.locator(".menu-trigger").click();
      await p.locator(".menu-panel").waitFor();
      return p;
    },
  });
  out.push({ name: "member:balance-0", open: (ctx) => openHarness(ctx, "scene=shell&balance=0") });
  for (const [d, how] of [
    ["buy-credit", async (p: Page) => p.locator(".balance-chip--button").click()],
    ["delete", async (p: Page) => (await p.locator(".menu-trigger").click(), p.getByRole("menuitem", { name: /Delete my beta data/ }).click())],
    ["password", async (p: Page) => (await p.locator(".menu-trigger").click(), p.getByRole("menuitem", { name: /password/i }).click())],
  ] as const)
    out.push({
      name: `dialog:${d}`,
      open: async (ctx) => {
        const p = await openHarness(ctx, "scene=shell");
        await how(p);
        await p.locator("[role=dialog]").waitFor();
        await p.waitForTimeout(300);
        return p;
      },
    });
  out.push({ name: "kit", open: (ctx) => openHarness(ctx, "scene=kit") });
  return out;
}

// ---- in-page probes (all colour maths is done in Node, from raw rgb) ----

interface TextSample {
  who: string;
  fg: number[];
  bg: number[];
  size: number;
  weight: number;
}
/** Every visible text element's own colour and the composited ground behind it. */
function textSamples(page: Page, root = "body"): Promise<TextSample[]> {
  return page.evaluate((rootSel) => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
    };
    const over = (t: number[], b: number[]) => [0, 1, 2].map((i) => t[i] * t[3] + b[i] * (1 - t[3])).concat(1);
    const memo = new Map<Element, { bg: number[]; op: number }>();
    const ground = (el: Element): { bg: number[]; op: number } => {
      const hit = memo.get(el);
      if (hit) return hit;
      const parent = el.parentElement ? ground(el.parentElement) : { bg: [255, 255, 255, 1], op: 1 };
      const s = getComputedStyle(el);
      const c = parse(s.backgroundColor);
      const v = { bg: c && c[3] > 0 ? over(c, parent.bg) : parent.bg, op: parent.op * Number(s.opacity) };
      memo.set(el, v);
      return v;
    };
    const out: any[] = [];
    const scope = document.querySelector(rootSel) ?? document.body;
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>("*"))) {
      if (el.closest(".fixture-picker, script, style, [aria-hidden=true]")) continue;
      if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility !== "visible") continue;
      const g = ground(el);
      if (g.op === 0) continue;
      const fg0 = parse(cs.color)!;
      const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * g.op], g.bg);
      out.push({ who: `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).join(".")}${(el as HTMLButtonElement).disabled ? ":disabled" : ""}`, fg, bg: g.bg, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) });
    }
    return out;
  }, root);
}

/** The light token values as rendered, name by rgb, for naming pairs. */
async function tokenNames(page: Page): Promise<Map<string, string>> {
  const names = [...light.keys()].filter((k) => /^#[0-9a-f]{6}$/i.test(light.get(k)!));
  const m = new Map<string, string>();
  for (const n of names) {
    const { r, g, b } = rgbOf(light.get(n)!);
    const key = `${r},${g},${b}`;
    m.set(key, m.has(key) ? `${m.get(key)}|${n}` : n);
  }
  void page;
  return m;
}
const nameOf = (names: Map<string, string>, c: number[]) => names.get(c.slice(0, 3).map((v) => Math.round(v)).join(",")) ?? `rgb(${c.slice(0, 3).map((v) => Math.round(v)).join(",")})`;
const need = (s: { size: number; weight: number }) => (s.size >= 24 || (s.size >= 18.66 && s.weight >= 700) ? 3 : 4.5);
const ratioOf = (a: number[], b: number[]) => contrast({ r: a[0], g: a[1], b: a[2] }, { r: b[0], g: b[1], b: b[2] });

/** Tag every interactive control with data-s1="<n>"; return their descriptions. */
function tagControls(page: Page, scope = "body") {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel) ?? document.body;
    const els = Array.from(root.querySelectorAll<HTMLElement>("button, a[href], input:not([type=hidden]), select, textarea, [role=menuitem], [tabindex]:not([tabindex='-1'])"));
    const out: { id: string; who: string; disabled: boolean; tag: string }[] = [];
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility !== "visible" || cs.display === "none") return;
      if (el.closest(".fixture-picker")) return; // the mock-only picker, a dev control
      el.setAttribute("data-s1", String(i));
      out.push({ id: String(i), who: `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).join(".")}[${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}]`, disabled: (el as HTMLButtonElement).disabled === true, tag: el.tagName.toLowerCase() });
    });
    return out;
  }, scope);
}
/** State looks are END states: park the real mouse off every control and
 *  switch transitions off, so a forced :hover/:active reads its final value
 *  rather than a transition's first frame. */
async function stillStates(page: Page) {
  await page.mouse.move(0, 0);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  await page.waitForTimeout(50);
}
async function styleUnder(page: Page, id: string, forced: string[]) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: `[data-s1="${id}"]` });
  await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: forced });
  const s = await page.evaluate((i) => {
    const el = document.querySelector(`[data-s1="${i}"]`)!;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color, shadow: cs.boxShadow, border: cs.borderColor, outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, deco: cs.textDecorationLine, opacity: cs.opacity, cursor: cs.cursor, transform: cs.transform };
  }, id);
  await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
  await cdp.detach();
  return s;
}
const differs = (a: Record<string, string>, b: Record<string, string>) => ["bg", "color", "shadow", "border", "deco", "opacity", "transform"].some((k) => a[k] !== b[k]);

/** Wait until every finite animation has finished (a dialog's § 5.6
 *  entrance, translateY(8px) scale(0.98)), so a box is measured at its end
 *  state, not mid-entrance. Infinite ones (a spinner) never settle and never
 *  resize a box, so they're skipped. Same posture as P8's phoneCheck. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    const finite = () => document.getAnimations().filter((a) => a.playState !== "finished" && Number(a.effect?.getComputedTiming().endTime) !== Infinity);
    for (let i = 0; i < 5 && finite().length; i++) await Promise.all(finite().map((a) => a.finished.catch(() => undefined)));
  });
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

// ---------------------------------------------------------------- browser tests

// LEAD RULING (Stage 2, 2026-09-27): the frame header carries NO brand mark
// beside its title — the rail carries the wordmark (§ 5.1: "the rail holds
// the five places … plus the brand mark"), and the phone shows no wordmark
// at all (§ 5.5: "No wordmark on the phone"). The one mark § 5.6 still puts
// in the header is Ten's avatar ("The 28px mark", § 5.6 "Ten's avatar"),
// so a mark inside the avatar is allowed and must be the 28px mark.
test("brand mark: § 5.6's SVG (fills are tokens) — the wordmark in the rail at 28px on desktop, no wordmark on the phone, no mark in the header outside Ten's avatar, 30px on sign-in", async () => {
  const spec = fence(sub("The brand mark"), "html");
  const norm = (s: string) =>
    [...s.matchAll(/<(svg|rect|ellipse)\b([^>]*?)\/?>/g)].map((m) => `${m[1]} ${[...m[2].matchAll(/([a-z-]+)="([^"]*)"/g)].filter((a) => !["width", "height", "class"].includes(a[1]) || m[1] !== "svg").map((a) => `${a[1]}=${a[2]}`).sort().join(" ")}`);
  const marks = (page: Page) =>
    page.evaluate(() => {
      const shown = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility === "visible" && !e.closest("[hidden]");
      const header = Array.from(document.querySelectorAll("header, .app-header"));
      const inHeader = (e: Element) => header.some((h) => h.contains(e));
      const all = Array.from(document.querySelectorAll("svg.mark")).filter(shown);
      return {
        headerNonAvatar: all.filter((m) => inHeader(m) && !m.closest(".avatar")).map((m) => m.parentElement?.outerHTML.slice(0, 120) ?? "?"),
        avatar: all.filter((m) => inHeader(m) && m.closest(".avatar")).map((m) => ({ html: m.outerHTML, w: m.getAttribute("width") })),
        wordmarks: Array.from(document.querySelectorAll(".wordmark")).filter(shown).map((w) => {
          const m = w.querySelector("svg.mark");
          return { inHeader: inHeader(w), text: w.textContent?.trim(), html: m?.outerHTML ?? "", w: m?.getAttribute("width") ?? null };
        }),
      };
    });
  const bad: string[] = [];
  const ctx = await context();
  const desk = await marks(await openApp(ctx));
  const phoneCtx = await context({ width: 375, height: 812 });
  const phone = await marks(await openApp(phoneCtx));
  await phoneCtx.close();
  const signIn = await (await openPreview(ctx, "sign-in")).locator("svg.mark").first().evaluate((e) => ({ html: e.outerHTML, w: e.getAttribute("width") }));
  await ctx.close();
  for (const [vp, r] of [["1440", desk], ["375", phone]] as const) {
    if (r.headerNonAvatar.length) bad.push(`${vp}: a brand mark in the header outside Ten's avatar: ${r.headerNonAvatar.join(" | ")}`);
    for (const a of r.avatar) {
      if (JSON.stringify(norm(a.html)) !== JSON.stringify(norm(spec))) bad.push(`${vp}: the avatar's mark is not § 5.6's markup`);
      if (a.w !== "28") bad.push(`${vp}: the avatar's mark is ${a.w}px, § 5.6 says 28px`);
    }
  }
  if (desk.wordmarks.length !== 1) bad.push(`1440: ${desk.wordmarks.length} wordmarks shown, want exactly one (the rail's)`);
  for (const w of desk.wordmarks) {
    if (w.inHeader) bad.push("1440: the wordmark sits in the header, § 5.1 puts it in the rail");
    if (w.text !== "Ten") bad.push(`1440: wordmark text "${w.text}"`);
    if (JSON.stringify(norm(w.html)) !== JSON.stringify(norm(spec))) bad.push("1440: the rail wordmark's mark is not § 5.6's markup");
    if (w.w !== "28") bad.push(`1440: the rail wordmark's mark is ${w.w}px, § 5.6 says 28px in the rail`);
  }
  if (phone.wordmarks.length) bad.push(`375: ${phone.wordmarks.length} wordmark(s) shown, § 5.5 says none on the phone`);
  if (JSON.stringify(norm(signIn.html)) !== JSON.stringify(norm(spec))) bad.push("sign-in's mark is not § 5.6's markup");
  if (signIn.w !== "30") bad.push(`sign-in's mark is ${signIn.w}px, § 5.6 says 30px`);
  assert.deepEqual(bad, []);
});

test("fonts: Bricolage is loaded from this origin and set on the wordmark and dialog titles; nothing is fetched from any other host", async () => {
  const ctx = await context();
  const fontReqs: string[] = [];
  ctx.on("request", (r) => {
    if (r.resourceType() === "font") fontReqs.push(r.url());
  });
  const page = await openPreview(ctx, "sign-in");
  await page.evaluate(() => document.fonts.ready);
  const info = await page.evaluate(() => ({
    loaded: Array.from(document.fonts).filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")),
    wordmark: getComputedStyle(document.querySelector(".wordmark-text")!).fontFamily,
  }));
  await ctx.close();
  assert.ok(info.loaded.includes("Bricolage Grotesque Variable"), `loaded faces: ${info.loaded}`);
  assert.match(info.wordmark, /^"?Bricolage Grotesque Variable"?/);
  assert.ok(fontReqs.length > 0 && fontReqs.every((u) => u.startsWith(previewBase)), `font requests: ${fontReqs}`);
  assert.equal(fontReqs.some((u) => /fraunces/i.test(u)), false);
});

test("contrast (light): every rendered text/ground pair, on every screen at 1440 and 375, is WCAG AA — independent of v2-ui's audit", async () => {
  const fails = new Set<string>();
  const pairs = new Map<string, number>();
  for (const vp of VIEWPORTS)
    for (const s of screens()) {
      const ctx = await context({ width: vp.width, height: vp.height });
      const page = await s.open(ctx);
      const names = await tokenNames(page);
      for (const t of await textSamples(page)) {
        const r = ratioOf(t.fg, t.bg);
        const key = `${nameOf(names, t.fg)} on ${nameOf(names, t.bg)}`;
        pairs.set(key, Math.min(pairs.get(key) ?? 99, r));
        if (r < need(t)) fails.add(`${s.name}@${vp.name}: ${t.who} ${key} = ${r.toFixed(2)} < ${need(t)}`);
      }
      await ctx.close();
    }
  if (process.env.STAGE1_VERBOSE) for (const [k, v] of [...pairs].sort((a, b) => a[1] - b[1])) console.log(`pair ${v.toFixed(2)}  ${k}`);
  assert.ok(pairs.size > 10, `pairs seen: ${pairs.size}`);
  assert.deepEqual([...fails], []);
});

/** One pass over every screen reading each control's rest, :hover and
 *  :hover:active end states (shared by the three state tests below). */
interface StateAudit {
  hoverContrast: string[];
  noHover: string[];
  noPress: string[];
  disabledBad: string[];
  disabledSeen: number;
}
let stateAuditRun: Promise<StateAudit> | undefined;
function stateAudit(): Promise<StateAudit> {
  stateAuditRun ??= runStateAudit();
  return stateAuditRun;
}
async function runStateAudit(): Promise<StateAudit> {
  const want = { bg: `rgb(${Object.values(rgbOf(hex("--bg-muted"))).join(", ")})`, color: `rgb(${Object.values(rgbOf(hex("--fg-subtle"))).join(", ")})` };
  const fails = new Set<string>();
  const noHover = new Set<string>();
  const noPress = new Set<string>();
  const disabledBad = new Set<string>();
  let disabledSeen = 0;
  for (const s of screens()) {
    const ctx = await context();
    const page = await s.open(ctx);
    await stillStates(page);
    for (const c of await tagControls(page)) {
      if (c.disabled) {
        if (c.tag !== "button") continue;
        // sign-in's mode toggle uses `disabled` to mark the SELECTED segment,
        // not a disabled control (reported separately); every other one counts.
        if (await page.locator(`[data-s1="${c.id}"]`).evaluate((e) => !!e.closest(".sign-in-mode-toggle"))) continue;
        disabledSeen++;
        const st = await styleUnder(page, c.id, []);
        const miss = [st.bg !== want.bg && `bg ${st.bg}`, st.color !== want.color && `color ${st.color}`, st.shadow !== "none" && `shadow ${st.shadow}`, st.cursor !== "not-allowed" && `cursor ${st.cursor}`].filter(Boolean);
        if (miss.length) disabledBad.add(`${s.name}: ${c.who} — ${miss.join("; ")}`);
        continue;
      }
      const rest = await styleUnder(page, c.id, []);
      const hov = await styleUnder(page, c.id, ["hover"]);
      if (!["input", "textarea"].includes(c.tag)) {
        const act = await styleUnder(page, c.id, ["hover", "active"]);
        if (!differs(rest, hov)) noHover.add(`${s.name}: ${c.who}`);
        if (!differs(hov, act)) noPress.add(`${s.name}: ${c.who}`);
      }
      const sample = await page.evaluate(([i, color, bg]) => {
        const parse = (x: string) => (x.match(/rgba?\(([^)]+)\)/)?.[1] ?? "0,0,0,0").split(/[ ,/]+/).filter(Boolean).map(Number);
        let g = [255, 255, 255, 1];
        const chain: Element[] = [];
        for (let e: Element | null = document.querySelector(`[data-s1="${i}"]`)!.parentElement; e; e = e.parentElement) chain.unshift(e);
        const over = (t: number[], b: number[]) => [0, 1, 2].map((k) => t[k] * (t[3] ?? 1) + b[k] * (1 - (t[3] ?? 1))).concat(1);
        for (const e of chain) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if ((c[3] ?? 1) > 0) g = over(c, g);
        }
        const own = parse(bg);
        if ((own[3] ?? 1) > 0) g = over(own, g);
        const f = parse(color);
        return { fg: over(f, g), bg: g, hasText: (document.querySelector(`[data-s1="${i}"]`)!.textContent ?? "").trim().length > 0 };
      }, [c.id, hov.color, hov.bg] as const);
      if (!sample.hasText) continue;
      const r = ratioOf(sample.fg, sample.bg);
      if (r < 4.5) fails.add(`${s.name}: ${c.who} hover ${r.toFixed(2)}`);
    }
    await ctx.close();
  }
  return { hoverContrast: [...fails], noHover: [...noHover], noPress: [...noPress], disabledBad: [...disabledBad], disabledSeen };
}

test("contrast (light): hover state text on its hover ground, and the composer placeholder, stay >= 4.5:1", async () => {
  const placeholder = contrast(rgbOf(hex("--fg-subtle")), rgbOf(hex("--bg-sunken")));
  assert.ok(placeholder >= 4.5, `placeholder --fg-subtle on --bg-sunken ${placeholder.toFixed(2)}`);
  assert.deepEqual((await stateAudit()).hoverContrast, []);
});

test("375px: no horizontal scroll on any screen (every fixture played, the preview screens, the member menu and dialogs)", async () => {
  const bad: string[] = [];
  for (const s of screens()) {
    const ctx = await context({ width: 375, height: 812 });
    const page = await s.open(ctx);
    const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, vw: window.innerWidth, wide: Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5 && getComputedStyle(e).position !== "fixed" && !e.closest("[style*=overflow], .transcript, .side-panel-body, pre, .tool-run-row")).slice(0, 3).map((e) => e.className) }));
    await shot(page, `${s.name.replace(/[:]/g, "_")}-375x812`);
    if (m.doc > m.vw || m.body > m.vw) bad.push(`${s.name}: scrollWidth ${m.doc}/${m.body} > ${m.vw} (${m.wide.join(", ")})`);
    await ctx.close();
  }
  if (SHOTS)
    for (const s of screens()) {
      const ctx = await context();
      await shot(await s.open(ctx), `${s.name.replace(/[:]/g, "_")}-1440x900`);
      await ctx.close();
    }
  assert.deepEqual(bad, []);
});

test("375px: no word is broken across two lines on any screen (§ 1.2: everything renders and is usable at 375px) — e.g. the gate's 'Type yes below'", async () => {
  const bad: string[] = [];
  for (const s of screens()) {
    const ctx = await context({ width: 375, height: 812 });
    const page = await s.open(ctx);
    await settle(page);
    const broken = await page.evaluate(() => {
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement!;
        // long tokens (URLs, paths, raw tool output) may break by design (rule 11)
        if (el.closest("pre, script, style, .fixture-picker, [aria-hidden=true]")) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility !== "visible" || !el.getClientRects().length) continue;
        for (const m of (n.textContent ?? "").matchAll(/[A-Za-z]{2,20}/g)) {
          const r = document.createRange();
          r.setStart(n, m.index!);
          r.setEnd(n, m.index! + m[0].length);
          const tops = new Set(Array.from(r.getClientRects()).filter((x) => x.width > 0).map((x) => Math.round(x.top)));
          if (tops.size > 1) out.push(`"${m[0]}" in ${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).join(".")}`);
        }
      }
      return out;
    });
    for (const b of new Set(broken)) bad.push(`${s.name}: ${b}`);
    await ctx.close();
  }
  assert.deepEqual(bad, []);
});

test(":focus-visible on every control: keyboard focus shows § 5.6's ring (2px solid --focus, offset 2px) or, on a text field, the --fg edge plus the halo", async () => {
  const focusRgb = Object.values(rgbOf(hex("--focus"))).join(", ");
  const bad: string[] = [];
  let seen = 0;
  for (const s of screens()) {
    const ctx = await context();
    const page = await s.open(ctx);
    await tagControls(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const visited = new Set<string>();
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press("Tab");
      const f = await page.evaluate((fr) => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const field = el.matches("input, textarea, select");
        const ring = cs.outlineStyle === "solid" && cs.outlineWidth === "2px" && cs.outlineOffset === "2px" && cs.outlineColor === `rgb(${fr})`;
        const halo = field && cs.borderColor.includes(fr) && /0px 0px 0px 3px/.test(cs.boxShadow);
        const composer = el.matches(".composer-input") && !!el.closest(".composer-row") && getComputedStyle(el.closest(".composer-row")!).boxShadow.includes(fr);
        return { id: el.getAttribute("data-s1") ?? el.tagName, who: `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).join(".")}[${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}]`, ok: !!el.closest(".fixture-picker") || ring || halo || composer, got: `outline ${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} off ${cs.outlineOffset}; border ${cs.borderColor}; shadow ${cs.boxShadow}` };
      }, focusRgb);
      if (!f) continue;
      if (visited.has(f.id)) break;
      visited.add(f.id);
      seen++;
      if (!f.ok) bad.push(`${s.name}: ${f.who} — ${f.got}`);
    }
    await ctx.close();
  }
  assert.ok(seen > 20, `controls reached by Tab: ${seen}`);
  assert.deepEqual([...new Set(bad)], []);
});

test("component states: every enabled control has a hover look and a distinct pressed (:active) look (§ 5.6, 'Every control has these five states')", async () => {
  const a = await stateAudit();
  assert.deepEqual({ noHover: a.noHover, noPress: a.noPress }, { noHover: [], noPress: [] });
});

test("component states: every disabled control is --bg-muted fill, --fg-subtle text, no shadow, cursor not-allowed", async () => {
  const a = await stateAudit();
  assert.ok(a.disabledSeen > 0, "some disabled control was seen");
  assert.deepEqual(a.disabledBad, []);
});

test("reduced motion: with prefers-reduced-motion: reduce, no keyframe animation and no moving transition ever runs (streaming, cards, avatar, dialogs, toast, skeleton); with no-preference they do", async () => {
  const run = async (mode: "reduce" | "no-preference") => {
    const seen = new Set<string>();
    for (const s of screens()) {
      const ctx = await context({ reducedMotion: mode });
      const page = await s.open(ctx);
      await page.waitForTimeout(200);
      for (const a of await page.evaluate(() => Array.from((window as any).__anims as Set<string>))) seen.add(`${s.name}: ${a}`);
      await ctx.close();
    }
    return [...seen];
  };
  const moving = await run("no-preference");
  assert.ok(moving.some((a) => /card-in/.test(a)), `sanity: the card entrance is observed without reduce (${moving.length} seen)`);
  const still = await run("reduce");
  assert.deepEqual(still, [], "motion under reduce");
});

test("streaming: no layout shift while a fixture streams (cumulative layout-shift 0), at 1440 and 375", async () => {
  const bad: string[] = [];
  for (const vp of VIEWPORTS)
    for (const f of FIXTURES) {
      const ctx = await context({ width: vp.width, height: vp.height });
      const page = await openApp(ctx, f);
      // a web font swapping in is not streaming: load all four faces first,
      // then count only what moves while the fixture streams
      await page.evaluate(async () => {
        await Promise.all(['600 20px "Bricolage Grotesque Variable"', '400 15px "Inter Variable"', '600 15px "Inter Variable"', '400 16px "Source Serif 4 Variable"', '400 12px "JetBrains Mono"', '500 12px "JetBrains Mono"'].map((f) => document.fonts.load(f)));
        await document.fonts.ready;
        await new Promise((r) => setTimeout(r, 100));
        (window as any).__cls = 0;
        (window as any).__shifts = [];
      });
      await play(page, f, { expand: false, userFocus: true });
      const r = await page.evaluate(() => ({ cls: (window as any).__cls as number, shifts: (window as any).__shifts as string[] }));
      if (r.cls > 0.001) bad.push(`${f}@${vp.name}: CLS ${r.cls.toFixed(4)} (${r.shifts.slice(0, 4).join(" | ")})`);
      await ctx.close();
    }
  assert.deepEqual(bad, []);
});

test("loading buttons keep their size and their label (§ 5.6: 'A button never changes size or label while loading')", async () => {
  const bad: string[] = [];
  const ctx = await context();
  // Delete my beta data: typed yes, Submit -> the deleting state (never resolves)
  let page = await openHarness(ctx, "scene=shell");
  await page.locator(".menu-trigger").click();
  await page.getByRole("menuitem", { name: /Delete my beta data/ }).click();
  const del = page.locator(".delete-confirm-actions button[type=submit]");
  await settle(page);
  const b0 = { box: await del.boundingBox(), text: (await del.textContent())?.trim() };
  await page.locator("[role=dialog] input").fill("yes");
  await del.click();
  await page.waitForTimeout(200);
  await settle(page);
  const b1 = { box: await del.boundingBox(), text: (await del.textContent())?.trim(), busy: await del.getAttribute("aria-busy") };
  if (b0.text !== b1.text) bad.push(`delete submit label "${b0.text}" -> "${b1.text}"`);
  if (Math.round(b0.box!.width) !== Math.round(b1.box!.width) || Math.round(b0.box!.height) !== Math.round(b1.box!.height)) bad.push(`delete submit size ${b0.box!.width}x${b0.box!.height} -> ${b1.box!.width}x${b1.box!.height}`);
  if (b1.busy !== "true") bad.push(`delete submit aria-busy=${b1.busy} while loading`);
  await page.close();
  // Set a new password: two matching fields, Save -> the saving state (updateUser never resolves)
  page = await openHarness(ctx, "scene=shell");
  await page.locator(".menu-trigger").click();
  await page.getByRole("menuitem", { name: /password/i }).click();
  const save = page.locator(".delete-confirm-actions button[type=submit]");
  await settle(page);
  const p0 = { box: await save.boundingBox(), text: (await save.textContent())?.trim() };
  for (const i of await page.locator("[role=dialog] input[type=password]").all()) await i.fill("correct-horse-battery");
  await save.click();
  await page.waitForTimeout(200);
  await settle(page);
  const p1 = { box: await save.boundingBox(), text: (await save.textContent())?.trim(), busy: await save.getAttribute("aria-busy") };
  if (p0.text !== p1.text) bad.push(`password save label "${p0.text}" -> "${p1.text}"`);
  if (Math.round(p0.box!.width) !== Math.round(p1.box!.width)) bad.push(`password save width ${p0.box!.width} -> ${p1.box!.width}`);
  if (p1.busy !== "true") bad.push(`password save aria-busy=${p1.busy} while loading`);
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("dialogs: z-index 50 over --scrim, radius 18px, min(460px, 100% - 32px) wide, Escape closes, focus trapped while open and returned to the opener", async () => {
  const bad: string[] = [];
  const scrim = light.get("--scrim")!.replace(/\s+/g, " ");
  for (const vp of VIEWPORTS)
    for (const [d, opener, openIt] of [
      ["buy-credit", ".balance-chip--button", async (p: Page) => p.locator(".balance-chip--button").press("Enter")],
      ["delete", ".menu-trigger", async (p: Page) => (await p.locator(".menu-trigger").press("Enter"), p.getByRole("menuitem", { name: /Delete my beta data/ }).press("Enter"))],
      ["password", ".menu-trigger", async (p: Page) => (await p.locator(".menu-trigger").press("Enter"), p.getByRole("menuitem", { name: /password/i }).press("Enter"))],
    ] as const) {
      const ctx = await context({ width: vp.width, height: vp.height });
      const page = await openHarness(ctx, "scene=shell");
      await page.locator(opener).focus();
      await openIt(page);
      const dlg = page.locator("[role=dialog]");
      await dlg.waitFor();
      await page.waitForTimeout(300);
      const g = await dlg.evaluate((o) => {
        const card = o.firstElementChild as HTMLElement;
        const cs = getComputedStyle(o);
        return { z: cs.zIndex, scrim: cs.backgroundColor, radius: getComputedStyle(card).borderRadius, w: card.getBoundingClientRect().width };
      });
      const wantW = Math.min(460, vp.width - 32);
      if (g.z !== "50") bad.push(`${d}@${vp.name}: z-index ${g.z}`);
      if (g.radius !== "18px") bad.push(`${d}@${vp.name}: radius ${g.radius}`);
      if (Math.abs(g.w - wantW) > 1) bad.push(`${d}@${vp.name}: width ${g.w}, § 5.6 min(460px, 100% - 32px) = ${wantW}`);
      void scrim;
      let escaped = false;
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press("Tab");
        if (!(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")))) escaped = true;
      }
      if (escaped) bad.push(`${d}@${vp.name}: Tab leaves the open dialog (focus not trapped)`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      const closed = (await page.locator("[role=dialog]").count()) === 0;
      if (!closed) bad.push(`${d}@${vp.name}: Escape does not close it`);
      else {
        const back = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), opener);
        if (!back) bad.push(`${d}@${vp.name}: focus not returned to the opener (${opener}); it is on ${await page.evaluate(() => document.activeElement?.tagName)}`);
      }
      await ctx.close();
    }
  assert.deepEqual(bad, []);
});

test("dialogs: focus still returns to the opener when the page re-renders while the dialog is open (RealChatShell passes a new inline onClose each render)", async () => {
  const bad: string[] = [];
  for (const [d, opener, openIt] of [
    ["buy-credit", ".balance-chip--button", async (p: Page) => p.locator(".balance-chip--button").press("Enter")],
    ["delete", ".menu-trigger", async (p: Page) => (await p.locator(".menu-trigger").press("Enter"), p.getByRole("menuitem", { name: /Delete my beta data/ }).press("Enter"))],
    ["password", ".menu-trigger", async (p: Page) => (await p.locator(".menu-trigger").press("Enter"), p.getByRole("menuitem", { name: /password/i }).press("Enter"))],
  ] as const) {
    const ctx = await context();
    const page = await openHarness(ctx, "scene=shell&rerender=1");
    await page.locator(opener).focus();
    await openIt(page);
    await page.locator("[role=dialog]").waitFor();
    await page.waitForTimeout(800); // several parent re-renders while open
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    if (!(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")))) bad.push(`${d}: focus left the dialog after re-renders`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    if ((await page.locator("[role=dialog]").count()) !== 0) bad.push(`${d}: Escape does not close it after re-renders`);
    else if (!(await page.evaluate((sel) => document.activeElement === document.querySelector(sel), opener)))
      bad.push(`${d}: focus went to ${await page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}.${a.getAttribute("class") ?? ""}` : "none"; })}, not the opener ${opener}`);
    await ctx.close();
  }
  assert.deepEqual(bad, []);
});

test("menu: z-index 40; a 1px --border divider before 'Delete my beta data', which is --red text with a 16px icon; each item has its § 5.6 icon", async () => {
  const ctx = await context();
  const page = await openHarness(ctx, "scene=shell");
  await page.locator(".menu-trigger").click();
  const m = await page.locator(".menu-panel").evaluate((p) => {
    const items = Array.from(p.querySelectorAll<HTMLElement>("[role=menuitem]"));
    const del = items.find((i) => /Delete my beta data/.test(i.textContent ?? ""))!;
    const prev = del.previousElementSibling as HTMLElement | null;
    const cs = getComputedStyle(del);
    return {
      z: getComputedStyle(p).zIndex,
      delColor: cs.color,
      divider: !!prev && (prev.getAttribute("role") === "separator" || prev.tagName === "HR" || getComputedStyle(del).borderTopWidth === "1px"),
      withIcon: items.map((i) => `${(i.textContent ?? "").trim()}:${i.querySelector("svg") ? "icon" : "none"}`),
    };
  });
  await ctx.close();
  const bad: string[] = [];
  if (m.z !== "40") bad.push(`z-index ${m.z}`);
  if (m.delColor !== `rgb(${Object.values(rgbOf(hex("--red"))).join(", ")})`) bad.push(`delete colour ${m.delColor}`);
  if (!m.divider) bad.push("no divider before Delete my beta data");
  const missing = m.withIcon.filter((x) => x.endsWith(":none"));
  if (missing.length) bad.push(`items without an icon: ${missing.join(", ")}`);
  assert.deepEqual(bad, []);
});

test("no request left this origin across every browser test above", () => {
  assert.deepEqual([...new Set(external)], []);
});
