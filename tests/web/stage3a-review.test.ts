// Tester-owned: workspace Stage 3a, the Documents page — docs/design-web-ui.md
// § 5.9 Stage 3a's exit ("every fixture file listed once in its group,
// `leads.md` absent, sorted by path, the viewer opens `.md`, `.html`
// (sandboxed, print works) and binary; § 5.2 rules 1, 2, 6 and 8"), § 5.3
// "Documents: every file", § 5.4 "Ask Ten about this", § 5.5 (phone), and
// the Documents strings of § 5.3.1 (origin/docs/workspace-labels, PR #22,
// read-only: D1-D15, P1-P3 and the viewer's "a file it can't show" and
// print-button rows — F42/F43 at e2ef443, F44/F45 at 358d6cd, so strings are
// found by their Page and "Where it shows" cells, never by row number). Every
// expected value is read from the
// spec text; written independently of the builder's own
// apps/web/src/workspace/documents.test.ts.
//
// Two builds, headless Chromium:
//   - tests/web/stage3a-review/harness.tsx: the REAL RealChatShell (Frame,
//     DocumentsPage, SidePanel) on the real in-memory WorkspaceStore behind a
//     spy (write/upload throw; list/read counted; list reversed so the page's
//     own sort is what's tested). Binary files are the store's own
//     `binary: true` reads (uploaded bytes), not a mock flag;
//   - the mock preview (VITE_SHOW_MOCK_CONTROLS=1), FixtureStore, for the
//     § 5.7 fixture listing through the picker.
//
// § 5.7's fixture `apps/web/fixtures/workspace-pages.json` is used when it
// exists; until it lands the listing runs on `mvp-journey.json` as a stand-in
// (lead's instruction). Override: STAGE3A_FIXTURE=<name>.
//
// Run: node --test tests/web/stage3a-review.test.ts
// Screenshots: STAGE3A_SHOTS=<dir> (1440x900 and 375x812).
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
import { buildAskTenDraft } from "../../apps/web/src/workspace/ask-ten.ts";
import { matchGateReply } from "../../packages/agent/src/helpers.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const HARNESS = path.join(REPO, "tests/web/stage3a-review");
const DOC = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");
const SHOTS = process.env.STAGE3A_SHOTS;
const FIXTURE = process.env.STAGE3A_FIXTURE ?? (existsSync(path.join(WEB, "fixtures/workspace-pages.json")) ? "workspace-pages" : "mvp-journey");

// ---------------------------------------------------------------- spec text

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** § 5.3.1 lives on main once PR #22 merges; until then, read-only from its branch. */
const LABELS_DOC = (() => {
  if (DOC.includes("#### 5.3.1")) return DOC;
  const g = spawnSync("git", ["show", "origin/docs/workspace-labels:docs/design-web-ui.md"], { cwd: REPO, encoding: "utf8" });
  assert.equal(g.status, 0, "§ 5.3.1 is neither on this branch nor at origin/docs/workspace-labels");
  return g.stdout;
})();
/** § 5.3.1's table rows: # | Page | Where it shows | String. Row numbers
 *  moved between the table's commits (F42/F43 at e2ef443 are F44/F45 at
 *  358d6cd), so a string is found by its Page and "Where it shows" cells,
 *  never by its number. */
const ROWS: { id: string; page: string; where: string; str: string }[] = [];
for (const line of LABELS_DOC.split("\n")) {
  const m = line.match(/^\| ([A-Z]\d+) \| ([^|]+) \| ([^|]+) \| `([^`]*)` \|/);
  if (m) ROWS.push({ id: m[1], page: m[2].trim(), where: m[3].trim(), str: m[4] });
}
const find = (page: RegExp, where: RegExp) => {
  const hits = ROWS.filter((r) => page.test(r.page) && where.test(r.where));
  assert.equal(hits.length, 1, `§ 5.3.1: one row for ${page} / ${where}, found ${JSON.stringify(hits)}`);
  return hits[0].str;
};
/** D2-D12: folder -> label, from the rows' own "group: folder `x`" cell. */
const FOLDER_LABEL = new Map<string, string>();
for (const r of ROWS) {
  const f = r.where.match(/^group: folder `([^`]+)`$/);
  if (r.page === "Documents" && f) FOLDER_LABEL.set(f[1], r.str);
}
const TOP_LABEL = find(/^Documents$/, /^group: files at the top level$/); // D1
const EMPTY_FIRST = find(/^Documents$/, /^empty state, first sentence$/); // D14
const EMPTY_REST = find(/^Documents$/, /^empty state, rest$/); // D15
const NO_PREVIEW = find(/^Viewer/, /^a file it can't show$/); // F42 at e2ef443, F44 at 358d6cd
const PRINT = find(/^Viewer/, /^print button on an `\.html` file$/); // F43 at e2ef443, F45 at 358d6cd
const ASK = find(/Documents/, /^a row, entry, detail or file control$/); // P1
const TALK = find(/Documents/, /^empty state's button$/); // P3
const TURN_LINE = ROWS.find((r) => r.str.startsWith("Ten is working."))!.str; // F34 / F35
const draftFor = (label: string) => find(/Documents/, /^the draft P1 puts/).replace("<label>", label); // P2
/** § 5.3 names the folders by `check_files.py`'s MANIFEST_DIRS. */
const MANIFEST_DIRS = (() => {
  const src = readFileSync(path.join(REPO, "skills/profile/scripts/check_files.py"), "utf8");
  const block = src.slice(src.indexOf("MANIFEST_DIRS = {"), src.indexOf("}", src.indexOf("MANIFEST_DIRS = {")));
  return [...block.matchAll(/"([a-z-]+)":/g)].map((m) => m[1]).sort();
})();
/** § 5.2 rule 6's loud line. */
const RULE6 = squash(DOC.match(/Any other read\s+failure\s+shows\s+"([^"]+)"/)![1]);

// ---------------------------------------------------------------- static

test("§ 5.3.1 D2-D12 cover exactly the folders check_files.py's MANIFEST_DIRS lists (§ 5.3: 'keyed by the folder names check_files.py lists')", () => {
  assert.deepEqual([...FOLDER_LABEL.keys()].sort(), MANIFEST_DIRS);
  assert.equal(TOP_LABEL, "Your records");
  assert.equal(FOLDER_LABEL.get("documents"), "Your uploads");
});

test("§ 5.4 'Ask Ten about this' draft: `About <path>: `; one line, <= 120 characters, a longer label cut to fit; never passes the gate (C § 3), including a file literally named yes", () => {
  const bad: string[] = [];
  for (const p of ["documents/resume.pdf", "plan.md", "yes", "YES.", "yes!", "no", "stop"]) {
    const d = buildAskTenDraft(p);
    if (d !== draftFor(p)) bad.push(`${p}: ${JSON.stringify(d)} != ${JSON.stringify(draftFor(p))}`);
    if (matchGateReply(d, "typed") !== "none") bad.push(`${p}: the draft matches the gate (${matchGateReply(d, "typed")})`);
  }
  for (const n of [111, 112, 113, 200, 511]) {
    const p = `applications/${"a".repeat(n)}.md`;
    const d = buildAskTenDraft(p);
    if (d.length > 120) bad.push(`${n}: ${d.length} characters`);
    if (!d.startsWith("About ") || !d.endsWith(": ")) bad.push(`${n}: lost its "About " / ": " (${JSON.stringify(d.slice(0, 12))}…${JSON.stringify(d.slice(-4))})`);
    if (!p.startsWith(d.slice(6, -2))) bad.push(`${n}: the label is not the path's own start`);
    if (/[\r\n]/.test(d)) bad.push(`${n}: more than one line`);
    if (matchGateReply(d, "typed") !== "none") bad.push(`${n}: matches the gate`);
  }
  assert.deepEqual(bad, []);
});

test("§ 5.4 draft cut on a path with a character outside the BMP (an emoji file name): the cut keeps the draft well-formed text, <= 120 characters", () => {
  const bad: string[] = [];
  for (let n = 100; n <= 115; n++) {
    const p = `documents/${"x".repeat(n)}😀résumé.pdf`;
    const d = buildAskTenDraft(p);
    if (d.length > 120) bad.push(`${n}: ${d.length} UTF-16 units`);
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(d)) bad.push(`${n}: a lone surrogate (half an emoji) in ${JSON.stringify(d.slice(-6))}`);
  }
  assert.deepEqual(bad, []);
});

test("§ 5.2 rule 1 (static half) and rule 4 'no copy': the Documents code calls no write/upload/send and no browser storage", () => {
  const bad: string[] = [];
  for (const f of ["src/components/DocumentsPage.tsx", "src/workspace/documents.ts", "src/workspace/ask-ten.ts"]) {
    const src = readFileSync(path.join(WEB, f), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
    for (const re of [/\.write\(|\.upload\(|\.remove\(|\.delete\(/, /sendMessage|\.send\(|fetch\(/, /localStorage|sessionStorage|indexedDB/]) if (re.test(src)) bad.push(`${f}: ${re}`);
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
const cspBlocked = new Set<string>();
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
  const mOut = mkdtempSync(path.join(tmpdir(), "ten-stage3a-review-mock-"));
  tmp.push(mOut);
  const b = spawnSync(process.execPath, [path.join(WEB, "node_modules/vite/bin/vite.js"), "build", "--outDir", mOut, "--emptyOutDir", "--logLevel", "error"], { cwd: WEB, encoding: "utf8", env: { ...process.env, VITE_SHOW_MOCK_CONTROLS: "1" } });
  assert.equal(b.status, 0, `mock build failed:\n${b.stdout}\n${b.stderr}`);
  const link = path.join(HARNESS, "node_modules");
  if (!existsSync(link)) symlinkSync("../../../apps/web/node_modules", link);
  const hOut = mkdtempSync(path.join(tmpdir(), "ten-stage3a-review-real-"));
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
async function ctxFor(vp: { width: number; height: number }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: "light", reducedMotion: "reduce", hasTouch: vp.width < 500, timezoneId: "America/Los_Angeles" });
  const isExternal = (url: string) => {
    const u = new URL(url);
    return !["127.0.0.1", "localhost"].includes(u.hostname) && !["data:", "blob:", "about:"].includes(u.protocol);
  };
  // Chromium fires "request" even for a load its CSP refuses before it
  // leaves; such a request then fails with errorText "csp". Those are
  // recorded apart: the viewer's CSP doing its job, not a request out.
  ctx.on("requestfailed", (r) => {
    if (isExternal(r.url()) && r.failure()?.errorText === "csp") cspBlocked.add(r.url());
  });
  ctx.on("request", (r) => {
    if (isExternal(r.url())) external.push(r.url());
  });
  return ctx;
}
const fx = (n: string) => JSON.parse(readFileSync(path.join(WEB, "fixtures", `${n}.json`), "utf8"));

/** 03:30Z: its date part is 2026-09-22; a page that localised it in
 *  America/Los_Angeles would show 2026-09-21 instead (§ 5.3: "the date part
 *  of its updatedAt"; § 5.6: "as written, not reformatted"). */
const UPDATED_AT = "2026-09-22T03:30:00.000Z";
const DATE = "2026-09-22";

interface Real {
  page: Page;
  proxyHits: number;
  release: () => void;
}
async function openReal(ctx: BrowserContext, files: Record<string, string>, opts: { seed?: "none" | "saved"; holdTurns?: boolean } = {}): Promise<Real> {
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
  await page.route("**/version.json", async (route: Route) => {
    const own = await page.evaluate(() => (window as any).__builtId as string).catch(() => "");
    await route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ id: own }) });
  });
  await page.route("**/seed.json", (route: Route) => route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ files, seed: opts.seed ?? "saved", updatedAt: UPDATED_AT }) }));
  await page.goto(realBase);
  await page.locator(".frame").waitFor();
  await page.waitForTimeout(150);
  return r;
}
async function openMock(ctx: BrowserContext, fixture: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(mockBase);
  await page.locator(".frame").waitFor();
  await page.locator(".fixture-picker select").selectOption(fixture);
  await page.waitForTimeout(150);
  return page;
}
const spy = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__spy)));
const title = (page: Page) => page.locator(".app-header-title").innerText();
async function go(page: Page, name: string) {
  // a focused composer hides the phone's tab bar (§ 5.5 "Keyboard up"); a
  // candidate's tap elsewhere blurs it first
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const nav = page.locator(".rail, .tabbar").filter({ visible: true }).first();
  const label = name === "Talk to Ten" && (await page.locator(".tabbar").isVisible()) ? "Ten" : name;
  await nav.getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
  await page.waitForTimeout(120);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
const pane = (page: Page) => page.locator(".frame-page:not(.frame-page--hidden):not(.frame-page--talk)").first();

/** What the Documents page shows, read from the DOM by its visible text:
 *  each group's heading, the count beside it, and each row's path and date. */
async function readDocuments(page: Page) {
  await pane(page).locator("section, .page-empty, .page-error-card").first().waitFor({ timeout: 5000 }).catch(() => {});
  return pane(page).evaluate((root) =>
    Array.from(root.querySelectorAll("section")).map((s) => {
      const h = s.querySelector("h2, h3");
      const hText = Array.from(h?.childNodes ?? []).map((n) => (n.textContent ?? "").trim()).filter(Boolean);
      const rows = Array.from(s.querySelectorAll<HTMLElement>(".doc-row, li, [role=listitem]")).filter((e) => !e.parentElement?.closest(".doc-row"));
      return {
        heading: hText,
        rows: rows.map((r) => {
          const open = r.querySelector("button");
          const date = Array.from(r.querySelectorAll("*")).map((e) => (e.childElementCount ? "" : (e.textContent ?? "").trim())).find((t) => /^\d{4}-\d{2}-\d{2}$/.test(t)) ?? null;
          return { path: (open?.textContent ?? "").trim(), date, text: (r.textContent ?? "").trim() };
        }),
      };
    }),
  );
}

/** § 5.3's grouping, from the spec alone. */
function expectedGroups(paths: string[]) {
  const visible = paths.filter((p) => p !== "leads.md");
  const top = visible.filter((p) => !p.includes("/"));
  const folders = [...new Set(visible.filter((p) => p.includes("/")).map((p) => p.split("/")[0]))];
  const out: { label: string; paths: string[] }[] = [];
  if (top.length) out.push({ label: TOP_LABEL, paths: top });
  for (const f of folders) out.push({ label: FOLDER_LABEL.get(f) ?? f, paths: visible.filter((p) => p.split("/")[0] === f && p.includes("/")) });
  return out;
}
const byUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isSortedByPath = (ps: string[]) => {
  const units = [...ps].sort(byUnits);
  const locale = [...ps].sort((a, b) => a.localeCompare(b));
  return JSON.stringify(ps) === JSON.stringify(units) || JSON.stringify(ps) === JSON.stringify(locale);
};

/** Checks the page against § 5.3 for these paths; returns the problems. */
function checkListing(got: Awaited<ReturnType<typeof readDocuments>>, paths: string[], date: string | null): string[] {
  const bad: string[] = [];
  const want = expectedGroups(paths);
  const gotLabels = got.map((g) => g.heading[0]);
  if (JSON.stringify([...gotLabels].sort()) !== JSON.stringify(want.map((w) => w.label).sort())) bad.push(`groups ${JSON.stringify(gotLabels)}, § 5.3 wants ${JSON.stringify(want.map((w) => w.label))}`);
  if (want[0]?.label === TOP_LABEL && gotLabels[0] !== TOP_LABEL) bad.push(`"${TOP_LABEL}" is not first: ${JSON.stringify(gotLabels)}`);
  const seen = new Map<string, number>();
  for (const g of got) {
    const w = want.find((x) => x.label === g.heading[0]);
    const ps = g.rows.map((r) => r.path);
    for (const p of ps) seen.set(p, (seen.get(p) ?? 0) + 1);
    if (!w) continue;
    if (JSON.stringify([...ps].sort()) !== JSON.stringify([...w.paths].sort())) bad.push(`${w.label}: rows ${JSON.stringify(ps)} != ${JSON.stringify(w.paths)}`);
    if (!isSortedByPath(ps)) bad.push(`${w.label}: not sorted by path: ${JSON.stringify(ps)}`);
    if (g.heading[1] !== String(ps.length)) bad.push(`${w.label}: count "${g.heading[1]}" beside ${ps.length} rows`);
    for (const r of g.rows) if (date && r.date !== date) bad.push(`${r.path}: date ${r.date}, want the date part ${date}`);
  }
  for (const p of paths.filter((x) => x !== "leads.md")) if (seen.get(p) !== 1) bad.push(`${p}: listed ${seen.get(p) ?? 0} times, want once`);
  if (seen.has("leads.md")) bad.push("leads.md is listed");
  return bad;
}

// ---------------------------------------------------------------- the § 5.7 fixture

test(`§ 5.9 3a exit on the § 5.7 fixture (${FIXTURE}${FIXTURE === "workspace-pages" ? "" : ", stand-in until workspace-pages.json lands"}), real shell at 1440: every file listed once, in its group, sorted by path, with the date part of its updatedAt; leads.md absent`, async () => {
  const files = fx(FIXTURE).files as Record<string, string>;
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, files);
  await go(r.page, "Documents");
  const got = await readDocuments(r.page);
  await shot(r.page, "documents-1440x900");
  await ctx.close();
  assert.ok(got.length > 0, "no groups rendered");
  assert.deepEqual(checkListing(got, Object.keys(files), DATE), []);
});

test(`§ 5.9 3a exit on the § 5.7 fixture (${FIXTURE}), mock preview (FixtureStore): every file listed once, in its group, sorted by path; leads.md absent`, async () => {
  const files = fx(FIXTURE).files as Record<string, string>;
  const ctx = await ctxFor(DESK);
  const page = await openMock(ctx, FIXTURE);
  await go(page, "Documents");
  const got = await readDocuments(page);
  await ctx.close();
  assert.deepEqual(checkListing(got, Object.keys(files), null), []);
});

// ---------------------------------------------------------------- edge seed

/** Every MANIFEST_DIRS folder once, top-level files, leads.md, two unknown
 *  folders, a nested file, a long path, an html with a planted script and a
 *  beacon, and two uploads (binary through the store's own upload). */
const EVIL_HTML = `<!doctype html><html><body><h1>Résumé</h1><script>parent.__pwned = 1; window.__ran = 1;</script><img src="https://beacon.invalid/px.png"></body></html>`;
const LONG = `applications/${"staff-product-manager-platform-".repeat(5)}resume.md`;
const EDGE: Record<string, string> = {
  "CLAUDE.md": "# guardrails\n",
  "profile.md": "# Profile\n\nReview persona, invented.\n",
  "Zeta.md": "# a capitalised top-level file\n",
  "leads.md": "# Leads\n\n- an unvalidated lead\n",
  "applications/beta-co-resume.html": EVIL_HTML,
  "applications/beta-co-resume.md": "# Résumé\n\n- invented\n",
  "applications/sub/deeper.md": "# nested\n",
  [LONG]: "# long\n",
  "company/beta-co.md": "# Beta Co\n",
  "contacts/beta-co.md": "# Contacts\n",
  "courses/sql.md": "# SQL\n",
  "documents/old-resume.pdf": "%PDF-1.4 invented bytes",
  "documents/references.docx": "PK invented bytes",
  "jd-analysis/beta-co.md": "# Analysis\n",
  "jd-inbox/beta-co.md": "# Posting\n",
  "negotiation/beta-co.md": "# Pay\n",
  "practice/round-1.md": "# Practice\n",
  "prep/beta-co.md": "# Prep\n",
  "stories/launch.md": "# Story\n",
  "zz-notes/misc.md": "# unknown folder\n",
  "aa-scratch/misc.md": "# another unknown folder\n",
};

test("§ 5.3 Documents on a seed with every MANIFEST_DIRS folder (real shell, 1440): § 5.3.1's D1-D13 labels, unknown folders under their own name, 'Your records' first, leads.md absent, each file once, sorted by path", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, EDGE);
  await go(r.page, "Documents");
  const got = await readDocuments(r.page);
  await ctx.close();
  const bad = checkListing(got, Object.keys(EDGE), DATE);
  for (const [f, label] of FOLDER_LABEL) if (!got.some((g) => g.heading[0] === label)) bad.push(`no "${label}" group for ${f}/`);
  assert.deepEqual(bad, []);
});

test("§ 5.3 Documents 'Empty' on a workspace with no turn yet (real shell): D14 then D15, and P3's one button, which only opens Talk to Ten; no list call is a write", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, {}, { seed: "none" });
  await go(r.page, "Documents");
  const text = squash(await pane(r.page).locator(".page-empty").innerText().catch(() => ""));
  const buttons = await pane(r.page).getByRole("button").evaluateAll((els) => els.map((e) => e.textContent?.trim()));
  await pane(r.page).getByRole("button", { name: TALK }).click();
  await r.page.waitForTimeout(150);
  const t = await title(r.page);
  const s = await spy(r.page);
  await ctx.close();
  assert.ok(text.startsWith(`${EMPTY_FIRST} ${EMPTY_REST}`), `empty state "${text}", § 5.3.1 D14+D15 "${EMPTY_FIRST} ${EMPTY_REST}"`);
  assert.deepEqual(buttons, [TALK]);
  assert.equal(t, "Talk to Ten");
  assert.deepEqual([s.writes, s.uploads, r.proxyHits], [[], [], 0]);
});

// ---------------------------------------------------------------- § 5.2 rule 8: one viewer

async function openRow(page: Page, p: string) {
  await pane(page).locator(".doc-row", { hasText: p }).first().getByRole("button").first().click();
  await page.waitForTimeout(250);
}

test("§ 5.2 rule 8 from Documents (real shell, 1440): the one viewer opens .md through MarkdownView, .html in the sandboxed iframe with its CSP (a planted script and beacon stay dead) and a working print button (§ 5.3.1 'Print / Save as PDF'), and an upload as 'This file can\'t be previewed here.'", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, EDGE);
  const page = r.page;
  const bad: string[] = [];
  await go(page, "Documents");
  const viewers = await page.locator(".side-panel, [aria-label='File preview']").count();
  if (viewers !== 1) bad.push(`${viewers} viewers in the DOM, § 5.2 rule 8 wants one`);

  await openRow(page, "profile.md");
  const md = await page.locator(".side-panel").evaluate((e) => ({ path: e.querySelector(".side-panel-path")?.textContent, md: !!e.querySelector(".markdown-view"), text: e.textContent ?? "" }));
  if (md.path !== "profile.md" || !md.md || !md.text.includes("Review persona")) bad.push(`.md: ${JSON.stringify(md).slice(0, 160)}`);
  await shot(page, "documents-viewer-md-1440x900");

  await openRow(page, "applications/beta-co-resume.html");
  const html = await page.locator(".side-panel").evaluate((e) => {
    const f = e.querySelector("iframe");
    return { sandbox: f?.getAttribute("sandbox") ?? null, srcdoc: f?.getAttribute("srcdoc") ?? "", buttons: Array.from(e.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim()) };
  });
  if (html.sandbox === null) bad.push(".html: no sandboxed iframe");
  else if (html.sandbox.split(/\s+/).includes("allow-scripts")) bad.push(`.html: sandbox "${html.sandbox}" allows scripts`);
  if (!/Content-Security-Policy[^>]*default-src 'none'/.test(html.srcdoc)) bad.push(".html: no default-src 'none' CSP before the file's own content");
  if (!html.buttons.includes(PRINT)) bad.push(`.html: no "${PRINT}" button (F43); buttons ${JSON.stringify(html.buttons)}`);
  await page.waitForTimeout(300);
  const ran = await page.evaluate(() => {
    const f = document.querySelector<HTMLIFrameElement>(".side-panel iframe");
    const w = f?.contentWindow as any;
    // the same injected-script probe verify:screens runs from the conversation
    const doc = f?.contentDocument;
    let injected = "no iframe";
    if (w && doc) {
      w.__evil = undefined;
      const s = doc.createElement("script");
      s.textContent = "window.__evil = true;";
      doc.body.appendChild(s);
      injected = w.__evil === true ? "ran" : "blocked";
      s.remove();
    }
    return { planted: (window as any).__pwned === 1 || w?.__ran === 1, injected };
  });
  if (ran.planted) bad.push(".html: the file's own <script> ran");
  if (ran.injected !== "blocked") bad.push(`.html: an injected <script> ${ran.injected}`);
  await page.evaluate(() => {
    (window as any).__printed = 0;
    const w = document.querySelector<HTMLIFrameElement>(".side-panel iframe")?.contentWindow as any;
    if (w) w.print = () => (window as any).__printed++;
  });
  await page.locator(".side-panel").getByRole("button", { name: PRINT }).click();
  await page.waitForTimeout(100);
  const printed = await page.evaluate(() => (window as any).__printed);
  if (printed !== 1) bad.push(`print: the iframe's print() ran ${printed} times after one click on "${PRINT}"`);
  await shot(page, "documents-viewer-html-1440x900");

  for (const up of ["documents/old-resume.pdf", "documents/references.docx"]) {
    await openRow(page, up);
    const b = await page.locator(".side-panel").evaluate((e) => ({ path: e.querySelector(".side-panel-path")?.textContent, text: e.textContent ?? "", iframe: !!e.querySelector("iframe"), pre: !!e.querySelector("pre") }));
    if (b.path !== up || !b.text.includes(NO_PREVIEW) || b.iframe || b.pre || b.text.includes("invented bytes")) bad.push(`binary ${up}: ${JSON.stringify(b).slice(0, 200)}`);
    if (b.text.includes(PRINT)) bad.push(`binary ${up}: a print button`);
  }
  await shot(page, "documents-viewer-binary-1440x900");
  const s = await spy(page);
  const opened = ["profile.md", "applications/beta-co-resume.html", "documents/old-resume.pdf", "documents/references.docx"];
  const strayReads = s.reads.filter((p: string) => !opened.includes(p));
  if (strayReads.length) bad.push(`reads beyond the files opened: ${JSON.stringify(strayReads)} (§ 5.3 "Reads: store.list(); read() for the file being viewed")`);
  if (s.writes.length || s.uploads.length || r.proxyHits || s.saves) bad.push(`writes ${s.writes} uploads ${s.uploads} model calls ${r.proxyHits} saves ${s.saves}`);
  await ctx.close();
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- § 5.2 rule 6

test("§ 5.2 rule 6 on Documents' list(): a non-missing failure is loud (rule 6's 'Couldn't read … Try again in a moment.' shape, a Retry button), never the empty state; Retry reads again and shows the files", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, EDGE);
  const page = r.page;
  await page.evaluate(() => ((window as any).__ctl.listFail = true));
  await go(page, "Documents");
  await page.waitForTimeout(200);
  const text = squash(await pane(page).innerText());
  const buttons = await pane(page).getByRole("button").evaluateAll((els) => els.map((e) => e.textContent?.trim()));
  await shot(page, "documents-list-error-1440x900");
  await page.evaluate(() => ((window as any).__ctl.listFail = false));
  await pane(page).getByRole("button", { name: "Retry" }).click().catch(() => {});
  await page.waitForTimeout(250);
  const after = await readDocuments(page);
  await ctx.close();
  const bad: string[] = [];
  const [pre, post] = RULE6.split("<path>");
  if (!(text.startsWith(pre) && text.includes(post))) bad.push(`list failure shows "${text.slice(0, 120)}", not rule 6's "${RULE6}" shape`);
  if (text.includes(EMPTY_FIRST)) bad.push("list failure shows the empty state");
  if (!buttons.includes("Retry")) bad.push(`no Retry button: ${JSON.stringify(buttons)}`);
  if (!after.length) bad.push("Retry did not list the files");
  assert.deepEqual(bad, []);
  console.log(`# the list-failure line as shown: "${text}"`);
});

test("§ 5.2 rule 6 on the file being viewed (Documents 'Reads: … read() for the file being viewed'): a non-missing read failure shows \"Couldn't read <path>. Try again in a moment.\" with Retry — never the viewer's empty 'Nothing open yet.'", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, EDGE);
  const page = r.page;
  await go(page, "Documents");
  await page.evaluate(() => ((window as any).__ctl.readFail = ["profile.md"]));
  await openRow(page, "profile.md");
  await page.waitForTimeout(250);
  const want = RULE6.replace("<path>", "profile.md");
  const everywhere = squash(await page.locator(".frame").innerText());
  const viewer = squash(await page.locator(".side-panel").innerText());
  await shot(page, "documents-read-error-1440x900");
  const retry = page.locator(".frame").getByRole("button", { name: "Retry" });
  const hasRetry = (await retry.count()) > 0;
  let recovered = false;
  if (hasRetry) {
    await page.evaluate(() => ((window as any).__ctl.readFail = []));
    await retry.first().click();
    await page.waitForTimeout(250);
    recovered = (await page.locator(".side-panel .markdown-view").count()) > 0;
  }
  await ctx.close();
  const bad: string[] = [];
  if (!everywhere.includes(want)) bad.push(`no "${want}" anywhere on screen; the viewer shows "${viewer}"`);
  if (/Nothing open yet\./.test(viewer)) bad.push(`the viewer fell back to its empty state: "${viewer}"`);
  if (!hasRetry) bad.push("no Retry button");
  else if (!recovered) bad.push("Retry did not show the file");
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- § 5.4

test("§ 5.4 'Ask Ten about this' on a Documents file (real shell, 1440 and 375): opens Talk to Ten with `About <path>: ` in an empty composer, unfocused; never sends; unsent text is never overwritten", async () => {
  const bad: string[] = [];
  for (const vp of [DESK, PHONE]) {
    const ctx = await ctxFor(vp);
    const r = await openReal(ctx, EDGE);
    const page = r.page;
    await go(page, "Documents");
    const asks = await pane(page).getByRole("button", { name: ASK }).count();
    const rows = await pane(page).locator(".doc-row").count();
    if (asks < 1) bad.push(`${vp.width}: no "${ASK}" control on Documents`);
    const bubbles0 = await page.locator(".bubble--user").count();
    await pane(page).locator(".doc-row", { hasText: "company/beta-co.md" }).getByRole("button", { name: ASK }).click();
    await page.waitForTimeout(300);
    const t = await title(page);
    const v = await page.locator(".composer-input").inputValue();
    const focused = await page.evaluate(() => !!document.activeElement?.closest(".composer"));
    if (t !== "Talk to Ten") bad.push(`${vp.width}: opened "${t}"`);
    if (v !== draftFor("company/beta-co.md")) bad.push(`${vp.width}: composer ${JSON.stringify(v)}, want ${JSON.stringify(draftFor("company/beta-co.md"))}`);
    if (focused) bad.push(`${vp.width}: the composer was focused (§ 5.4: only Continue with Ten focuses it)`);
    if (vp === PHONE && !(await page.locator(".tabbar").isVisible())) bad.push("375: the tab bar is hidden after Ask Ten");
    await shot(page, `ask-ten-draft-${vp.width}`);
    // unsent text kept
    await page.locator(".composer-input").fill("my unsent words");
    await go(page, "Documents");
    await pane(page).locator(".doc-row", { hasText: "stories/launch.md" }).getByRole("button", { name: ASK }).click();
    await page.waitForTimeout(300);
    const kept = await page.locator(".composer-input").inputValue();
    if (kept !== "my unsent words") bad.push(`${vp.width}: unsent text became ${JSON.stringify(kept)}`);
    await page.waitForTimeout(500);
    const s = await spy(page);
    if (r.proxyHits || s.saves || (await page.locator(".bubble--user").count()) !== bubbles0) bad.push(`${vp.width}: a draft was sent (model calls ${r.proxyHits}, saves ${s.saves})`);
    console.log(`# ${vp.width}: ${asks} "${ASK}" controls for ${rows} rows`);
    await ctx.close();
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- § 5.2 rules 1-2

/** Closes the phone's sheet (§ 5.5) if it is up: Escape, then its Back arrow. */
async function closeViewer(page: Page) {
  const back = page.locator(".side-panel-back");
  if (!(await back.isVisible())) return;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  if (await back.isVisible()) await back.click();
  await page.waitForTimeout(80);
}

test("§ 5.2 rules 1-2 on Documents (real shell, spies, 1440 and 375): every control on the page and in the viewer it opens — zero write/upload calls, zero model calls, zero saves", async () => {
  const bad: string[] = [];
  for (const vp of [DESK, PHONE]) {
    const ctx = await ctxFor(vp);
    const r = await openReal(ctx, EDGE);
    const page = r.page;
    await go(page, "Documents");
    let clicks = 0;
    const n = await pane(page).getByRole("button").count();
    for (let i = 0; i < n; i++) {
      if ((await title(page)) !== "Documents") await go(page, "Documents");
      const b = pane(page).getByRole("button").nth(i);
      await b.click().catch(() => {});
      clicks++;
      await page.waitForTimeout(80);
      for (const vb of await page.locator(".side-panel button").all()) {
        const label = ((await vb.getAttribute("aria-label")) ?? (await vb.innerText())).trim();
        if (label === PRINT) {
          await page.evaluate(() => {
            const w = document.querySelector<HTMLIFrameElement>(".side-panel iframe")?.contentWindow as any;
            if (w) w.print = () => {};
          });
        }
        if (label === "Close") continue;
        if (await vb.isVisible()) {
          await vb.click().catch(() => {});
          clicks++;
        }
      }
      await closeViewer(page);
    }
    await page.waitForTimeout(300);
    const s = await spy(page);
    if (s.writes.length || s.uploads.length) bad.push(`${vp.width}: write ${JSON.stringify(s.writes)} upload ${JSON.stringify(s.uploads)}`);
    if (r.proxyHits) bad.push(`${vp.width}: ${r.proxyHits} model call(s)`);
    if (s.saves) bad.push(`${vp.width}: ${s.saves} save(s)`);
    if (clicks < Object.keys(EDGE).length) bad.push(`${vp.width}: only ${clicks} clicks — vacuous`);
    await ctx.close();
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- PRINCIPLES rule 12 / § 5.2 rule 4 "reads when shown, no copy"

test("PRINCIPLES rule 12 (§ 5.2 rule 4's first half): Documents reads list() each time it shows and keeps no copy — a file the agent wrote while another page showed is there on return, with no reload", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, EDGE);
  const page = r.page;
  await go(page, "Documents");
  const n0 = (await spy(page)).lists;
  await go(page, "Home");
  await page.evaluate(() => (window as any).__inner.write("prep/new-sheet.md", "# written by the agent\n", null));
  await go(page, "Documents");
  const got = await readDocuments(page);
  const n1 = (await spy(page)).lists;
  await ctx.close();
  assert.ok(n1 > n0, `no fresh list() on showing Documents again (${n0} -> ${n1})`);
  assert.ok(got.some((g) => g.rows.some((x) => x.path === "prep/new-sheet.md")), "the new file is not listed");
});

// Rule 4's second half and its neutral line are NOT in 3a's exit list (§ 5.9);
// measured and reported, not gating (lead's instruction).
test("§ 5.2 rule 4 (not in 3a's exit): while a turn runs, Documents shows 'Ten is working. This page updates when it finishes.', and at turn end it re-reads (a file written mid-turn shows with no navigation)", { todo: "rule 4 is outside 3a's exit list; reported, not gating" }, async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, EDGE, { holdTurns: true });
  const page = r.page;
  await go(page, "Talk to Ten");
  await page.locator(".composer-input").fill("what's in my files?");
  await page.locator(".composer-input").press("Enter");
  await page.waitForFunction(() => /thinking|working/.test(document.querySelector(".avatar")?.className ?? ""), null, { timeout: 5000 }).catch(() => {});
  await go(page, "Documents");
  const during = squash(await pane(page).innerText());
  await page.evaluate(() => (window as any).__inner.write("prep/mid-turn.md", "# mid turn\n", null));
  r.release();
  await page.waitForFunction(() => !/thinking|working/.test(document.querySelector(".avatar")?.className ?? ""), null, { timeout: 30000 });
  await page.waitForTimeout(400);
  const got = await readDocuments(page);
  await ctx.close();
  const bad: string[] = [];
  if (!during.includes(TURN_LINE)) bad.push("no F34 line while the turn ran");
  if (!got.some((g) => g.rows.some((x) => x.path === "prep/mid-turn.md"))) bad.push("no re-read at turn end");
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- § 5.5 phone

test("§ 5.5 at 375px on Documents: the list alone; a file opens the full-screen sheet (z-index 30, over the header) with a 44x44 back arrow; Back and Escape each close it and return focus to the row that opened it; no horizontal scroll; rows and controls >= 44px", async () => {
  const ctx = await ctxFor(PHONE);
  const r = await openReal(ctx, EDGE);
  const page = r.page;
  const bad: string[] = [];
  await go(page, "Documents");
  await shot(page, "documents-375x812");
  const lay = await page.evaluate(() => {
    const vis = (e: Element | null) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" && (e as HTMLElement).getBoundingClientRect().width > 0 && (e as HTMLElement).getBoundingClientRect().right > 0 && (e as HTMLElement).getBoundingClientRect().left < window.innerWidth;
    const small = Array.from(document.querySelectorAll<HTMLElement>(".frame-page:not(.frame-page--hidden) button, .frame-page:not(.frame-page--hidden) .doc-row"))
      .filter((e) => e.getClientRects().length)
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ e, r }) => r.height < 44 || (e.tagName === "BUTTON" && r.width < 44))
      .map(({ e, r }) => `${e.className}[${(e.textContent ?? "").trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    return { viewer: vis(document.querySelector(".side-panel")), sw: document.documentElement.scrollWidth, vw: window.innerWidth, small };
  });
  if (lay.viewer) bad.push("375: a viewer shows beside the list with no file open");
  if (lay.sw > lay.vw) bad.push(`375: scrollWidth ${lay.sw} > ${lay.vw} (long path ${LONG.length} chars)`);
  for (const s of lay.small) bad.push(`375: under 44px: ${s}`);

  for (const how of ["Back", "Escape"] as const) {
    const opener = pane(page).locator(".doc-row", { hasText: "profile.md" }).getByRole("button").first();
    await opener.click();
    await page.waitForTimeout(250);
    const sheet = await page.locator(".side-panel").evaluate((e) => {
      const r = e.getBoundingClientRect();
      const h = document.querySelector(".app-header")!.getBoundingClientRect();
      const back = e.querySelector(".side-panel-back")!.getBoundingClientRect();
      return { z: getComputedStyle(e).zIndex, top: r.top, left: r.left, w: r.width, headerTop: h.top, back: [Math.round(back.width), Math.round(back.height)], path: e.querySelector(".side-panel-path")?.textContent };
    });
    if (sheet.z !== "30") bad.push(`${how}: sheet z-index ${sheet.z}`);
    if (sheet.top > sheet.headerTop + 1 || sheet.left > 0.5 || Math.round(sheet.w) !== PHONE.width) bad.push(`${how}: sheet at top ${sheet.top} left ${sheet.left} w ${sheet.w} — does not cover the header area`);
    if (sheet.back[0] !== 44 || sheet.back[1] !== 44) bad.push(`${how}: back arrow ${sheet.back}`);
    if (sheet.path !== "profile.md") bad.push(`${how}: sheet shows ${sheet.path}`);
    if (how === "Back") await shot(page, "documents-sheet-375x812");
    if (how === "Back") await page.locator(".side-panel-back").click();
    else await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const closed = !(await page.locator(".side-panel--open").count());
    const onOpener = await opener.evaluate((e) => document.activeElement === e);
    if (!closed) bad.push(`${how}: the sheet did not close`);
    if (!onOpener) bad.push(`${how}: focus is on ${await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`)}, not the row that opened the sheet`);
    await closeViewer(page);
  }
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("no request left this origin in any test above; the planted .html beacon was refused by the viewer's CSP (§ 5.2 rule 8, C § 6.1)", () => {
  console.log(`# refused by CSP before leaving: ${JSON.stringify([...cspBlocked])}`);
  assert.deepEqual([...new Set(external)].filter((u) => !cspBlocked.has(u)), []);
  assert.ok(cspBlocked.has("https://beacon.invalid/px.png"), "the beacon was never attempted, so the CSP went unmeasured");
});
