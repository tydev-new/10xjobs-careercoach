// Tester-owned: workspace Stage 3d, the Applications page — the rendered
// half of docs/design-web-ui.md § 5.9 3d's exit, from the spec:
//   - the page's roles, stages and "Not linked" line match the § 5.7
//     fixture (and § 5.3's "Shows": each entry's files; newest change first);
//   - the detail: the coverage and cut rows equal `proposalRows`' output on
//     the fixture, through § 5.3.1's AP label tables; the two-notes-files
//     line (AP14); the stage steps (one current step, no check marks, no
//     dates; a dismissed row gets none); "Next, from you" equals the plan
//     items whose `ref` matches exactly; an unlinked entry; a row with the
//     wrong cell count (F42); a notes-file read failure (F40, parts 5-6 only);
//   - § 5.2 rules 1, 2, 4, 6, 8; § 5.4 "Role details" and "Ask Ten about
//     this"; § 5.5 at 375px; the empty state (AP16/AP17).
// The pure half is tests/web/stage3d-units.test.ts.
//
// One build: tests/web/stage3d-review/harness.tsx (the REAL RealChatShell on
// the real in-memory store behind a spy). Headless Chromium.
//
// Run: node --test tests/web/stage3d-review.test.ts
// Screenshots: STAGE3D_SHOTS=<dir> (1440x900 and 375x812).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "../../apps/web/node_modules/playwright/index.mjs";
import { textReply } from "../agent/_openrouter_stub.ts";
import { readPlanBoard, splitPlanMinutes } from "../../packages/agent/src/plan-board.ts";
// @ts-expect-error - plain .mjs, no type declarations
import { proposalRows } from "../../skills/apply/scripts/lib/proposal-block.mjs";
// @ts-expect-error - plain .mjs, no type declarations
import { load } from "../../skills/search/scripts/lib/jobs-md.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const HARNESS = path.join(REPO, "tests/web/stage3d-review");
const DOC = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");
const SHOTS = process.env.STAGE3D_SHOTS;
const FIXTURE = JSON.parse(readFileSync(path.join(WEB, "fixtures/workspace-pages.json"), "utf8")).files as Record<string, string>;

// ---------------------------------------------------------------- spec text (§ 5.3.1)

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const ROWS: { id: string; page: string; where: string; str: string }[] = [];
for (const line of DOC.split("\n")) {
  const m = line.match(/^\| ([A-Z]+\d+) \| ([^|]+) \| ([^|]+) \| `([^`]*)` \|/);
  if (m) ROWS.push({ id: m[1], page: m[2].trim(), where: m[3].trim(), str: m[4] });
}
const find = (page: RegExp, where: RegExp) => {
  const hits = ROWS.filter((r) => page.test(r.page) && where.test(r.where));
  assert.equal(hits.length, 1, `§ 5.3.1: one row for ${page} / ${where}, found ${JSON.stringify(hits)}`);
  return hits[0].str;
};
const AP = {
  notLinked: find(/^Applications$/, /^entry and detail, no linked row$/),
  roleDetails: find(/^Applications$/, /^detail control, opens Jobs at the row$/),
};
const sectionLabels = ROWS.filter((r) => r.page === "Applications" && r.where === "detail section label").map((r) => r.str);
const COVERAGE_LABEL = sectionLabels.find((s) => s.startsWith("What the posting"))!;
const CUT_LABEL = sectionLabels.find((s) => s.startsWith("What Ten cut"))!;
const COL = {
  req: find(/^Applications$/, /^coverage column: the requirement$/),
  ev: find(/^Applications$/, /^coverage column: the evidence$/),
  status: find(/^Applications$/, /^coverage column: the status/),
  decision: find(/^Applications$/, /^coverage column: the decision/),
};
const STATUS: Record<string, string> = {};
const DECISION: Record<string, string> = {};
for (const r of ROWS.filter((x) => x.page === "Applications")) {
  const s = r.where.match(/^coverage status `([^`]+)`/);
  if (s) STATUS[s[1]] = r.str;
  const d = r.where.match(/^coverage decision `([^`]+)`/);
  if (d) DECISION[d[1]] = r.str;
}
const FROM = find(/^Applications$/, /^each cut bullet/); // "From <role>"
const TWO_NOTES = find(/^Applications$/, /^detail, an entry with both notes files$/);
const BACK = find(/^Applications$/, /^phone: back from the detail/);
const EMPTY_FIRST = find(/^Applications$/, /^empty state, first sentence$/);
const EMPTY_REST = find(/^Applications$/, /^empty state, rest$/);
const NEXT = find(/Applications/, /^heading over the matching plan lines$/);
const ASK = find(/Applications/, /^a row, entry, detail or file control$/);
const DRAFT = find(/Applications/, /^the draft P1 puts/); // "About <label>: "
const TALK = find(/Applications/, /^empty state's button$/);
const TURN_LINE = find(/Applications/, /^one neutral line above the page while a turn runs$/);
const READ_ERR = find(/Applications/, /^a file that can't be read/); // "Couldn't read <path>. Try again in a moment."
const RETRY = find(/Applications/, /^the button beside F40$/);
const UNREADABLE = find(/Applications/, /^above lines a reader can't parse/); // "This page couldn't read these lines of <path>:"
const DISMISSED = ROWS.find((r) => r.page.includes("Applications") && r.where.includes("a dismissed entry"))!.str;
const TIER: Record<string, string> = { strong: "Strong Fit", investable_stretch: "Investable Stretch", long_shot: "Long-Shot Stretch", weak: "Weak Fit" }; // § 2.1 / P5-P8
const PRINT = find(/^Viewer/, /^print button on an `\.html` file$/);


test("§ 5.3.1: every Applications string this review checks is found in the table", () => {
  assert.deepEqual(
    [AP.notLinked, AP.roleDetails, COVERAGE_LABEL, CUT_LABEL, COL.req, COL.ev, COL.status, COL.decision, FROM, BACK, EMPTY_FIRST, EMPTY_REST, NEXT, DISMISSED],
    ["Not linked to a role on your job list.", "Role details", "What the posting asks for, and your evidence", "What Ten cut, weakest fit first", "Asked for", "Your evidence", "Status", "Question to you", "From <role>", "Back to Applications", "No applications yet.", "Ask Ten to draft a résumé and letter for a role, and they show here.", "Next, from you", "Dismissed"],
  );
  assert.deepEqual(STATUS, { have: "Covered", "shown-but-unnamed": "Shown, not in their words", gap: "Gap" });
  assert.deepEqual(DECISION, { open: "Not answered yet", answered: "Answered", skipped: "Skipped" });
});

test("§ 5.2 rule 1 (static half) and rule 4 'no copy': the Applications code calls no write/upload/send and no browser storage", () => {
  const bad: string[] = [];
  for (const f of ["src/components/ApplicationsPage.tsx", "src/workspace/applications.ts", "src/workspace/stage-steps.ts", "src/components/StageSteps.tsx"]) {
    const src = readFileSync(path.join(WEB, f), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
    for (const re of [/\.write\(|\.upload\(|\.remove\(|\.delete\(/, /sendMessage|\.send\(|fetch\(/, /localStorage|sessionStorage|indexedDB/]) if (re.test(src)) bad.push(`${f}: ${re}`);
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- servers

let browser: Browser;
const servers: Server[] = [];
const tmp: string[] = [];
let realBase = "";
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
  const link = path.join(HARNESS, "node_modules");
  if (!existsSync(link)) symlinkSync("../../../apps/web/node_modules", link);
  const hOut = mkdtempSync(path.join(tmpdir(), "ten-stage3d-review-real-"));
  tmp.push(hOut);
  const { build } = (await import(path.join(WEB, "node_modules/vite/dist/node/index.js"))) as typeof import("vite");
  await build({ root: HARNESS, configFile: path.join(WEB, "vite.config.ts"), logLevel: "error", build: { outDir: hOut, emptyOutDir: true } });
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
const ctxFor = (vp: { width: number; height: number }): Promise<BrowserContext> =>
  browser.newContext({ viewport: vp, colorScheme: "light", reducedMotion: "reduce", hasTouch: vp.width < 500, timezoneId: "America/Los_Angeles" });

interface Real {
  page: Page;
  proxyHits: number;
  release: () => void;
}
async function openReal(ctx: BrowserContext, files: Record<string, string>, opts: { seed?: "none" | "saved"; holdTurns?: boolean; updatedAtByPath?: Record<string, string> } = {}): Promise<Real> {
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
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: textReply("Done.", 0.001).body() });
  });
  await page.route("**/version.json", async (route: Route) => {
    const own = await page.evaluate(() => (window as any).__builtId as string).catch(() => "");
    await route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ id: own }) });
  });
  await page.route("**/seed.json", (route: Route) =>
    route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ files, seed: opts.seed ?? "saved", updatedAtByPath: opts.updatedAtByPath ?? {} }) }),
  );
  await page.goto(realBase);
  await page.locator(".frame").waitFor();
  await page.waitForTimeout(150);
  return r;
}
const spy = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__spy)));
const title = (page: Page) => page.locator(".app-header-title").innerText();
async function go(page: Page, name: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const nav = page.locator(".rail, .tabbar").filter({ visible: true }).first();
  const label = name === "Talk to Ten" && (await page.locator(".tabbar").isVisible()) ? "Ten" : name;
  await nav.getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
  await page.waitForTimeout(250);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}
const pane = (page: Page) => page.locator(".frame-page:not(.frame-page--hidden):not(.frame-page--talk)").first();
async function closeViewer(page: Page) {
  const back = page.locator(".side-panel-back");
  if (!(await back.isVisible())) return;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  if (await back.isVisible()) await back.click();
  await page.waitForTimeout(80);
}

/** The list pane's entries, by visible text: the entry's first line is its
 *  role label; the rest of its text is read whole. */
async function readEntries(page: Page) {
  await pane(page).locator(".app-entry-row, .page-empty, .page-error-card").first().waitFor({ timeout: 8000 });
  return pane(page)
    .locator(".app-entry-row")
    .evaluateAll((els) =>
      els.map((e) => ({
        label: (e.querySelector(".app-entry-label")?.textContent ?? "").trim(),
        text: (e as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
        buttons: Array.from(e.querySelectorAll("button")).map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim()),
      })),
    );
}
async function choose(page: Page, label: string) {
  await pane(page).locator(".app-entry-row", { hasText: label }).first().locator("button").first().click();
  await page.waitForTimeout(300);
}
const detail = (page: Page) => pane(page).locator(".app-detail").first();
async function readDetail(page: Page) {
  await detail(page).waitFor({ timeout: 8000 });
  await page.waitForTimeout(200);
  return detail(page).evaluate((d) => {
    const txt = (e: Element | null | undefined) => (e ? ((e as HTMLElement).innerText ?? e.textContent ?? "").replace(/\s+/g, " ").trim() : "");
    const steps = d.querySelector(".stage-steps, [aria-label='Stage']");
    return {
      text: txt(d),
      heading: txt(d.querySelector("h2")),
      h3: Array.from(d.querySelectorAll("h3")).map((h) => txt(h)),
      buttons: Array.from(d.querySelectorAll("button")).map((b) => txt(b)),
      steps: steps
        ? {
            items: Array.from(steps.querySelectorAll("li")).map((li) => ({ text: txt(li), current: li.getAttribute("aria-current"), cls: li.className, svg: li.querySelectorAll("svg").length })),
            text: txt(steps),
            html: steps.innerHTML,
          }
        : null,
      coverageHead: Array.from(d.querySelectorAll("table thead th")).map((th) => txt(th)),
      coverage: Array.from(d.querySelectorAll("table tbody tr")).map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => txt(td))),
      cuts: Array.from(d.querySelectorAll("ol:not(.stage-steps) > li")).map((li) => Array.from(li.children).map((c) => txt(c))),
      next: Array.from(d.querySelectorAll(".plan-item")).map((li) => ({ text: txt(li), chip: txt(li.querySelector(".plan-item-chip")), pill: txt(li.querySelector(".plan-item-pill")) })),
    };
  });
}

// ---------------------------------------------------------------- the spec's expectations over the fixture

const memIo = (files: Record<string, string>) => ({ exists: async (p: string) => p in files, readFile: async (p: string) => files[p], writeFile: async () => {} });
const SUFFIXES = ["-resume.html", "-resume.pdf", "-resume.md", "-cover-letter.md", "-application.md", ".md"]; // § 5.3, checked against the doc in stage3d-units
const specKey = (p: string) => {
  const n = p.slice(p.lastIndexOf("/") + 1);
  for (const s of SUFFIXES) if (n.endsWith(s) && n.length > s.length) return n.slice(0, -s.length);
  return null;
};
async function expected(files: Record<string, string>, updatedAt: Record<string, string> = {}) {
  const rows = (await load(memIo(files), "")) as any[];
  const keys = new Map<string, string[]>();
  for (const p of Object.keys(files).filter((x) => x.startsWith("applications/"))) {
    const k = specKey(p) ?? p;
    keys.set(k, [...(keys.get(k) ?? []), p]);
  }
  const out = [...keys].map(([key, paths]) => {
    const row = specKey(paths[0]) === null ? undefined : rows.find((r) => r.analysis_file === `jd-analysis/${key}.md`);
    const notes = paths.filter((p) => p === `applications/${key}.md` || p === `applications/${key}-application.md`);
    const latest = paths.map((p) => updatedAt[p] ?? "").sort().at(-1) ?? "";
    return { key, paths, notes, row, latest, role: row ? `${row.company} — ${row.title}` : notes[0] ?? [...paths].sort()[0] };
  });
  return out.sort((a, b) => (a.latest === b.latest ? 0 : a.latest > b.latest ? -1 : 1));
}
/** Each fixture application file a distinct updatedAt, so § 5.3's order is
 *  observable: juniper newest, then relocation, then fernway (its cover
 *  letter), then novagrid. */
const FIXTURE_TIMES: Record<string, string> = {
  "applications/novagrid-staff-pm-application.md": "2026-09-10T00:00:00.000Z",
  "applications/novagrid-staff-pm-resume.md": "2026-09-11T00:00:00.000Z",
  "applications/novagrid-staff-pm-resume.html": "2026-09-11T00:00:00.000Z",
  "applications/novagrid-staff-pm-cover-letter.md": "2026-09-12T00:00:00.000Z",
  "applications/fernway-senior-pm.md": "2026-09-01T00:00:00.000Z",
  "applications/fernway-senior-pm-resume.md": "2026-09-02T00:00:00.000Z",
  "applications/fernway-senior-pm-cover-letter.md": "2026-09-20T00:00:00.000Z",
  "applications/juniper-analytics-pm-resume.md": "2026-09-25T00:00:00.000Z",
  "applications/relocation-notes.txt": "2026-09-21T00:00:00.000Z",
};

// ---------------------------------------------------------------- the § 5.7 fixture

test("§ 5.9 3d exit on the § 5.7 fixture (real shell, 1440): the page's roles, stages and 'Not linked' line match the fixture, entries newest change first", async () => {
  const want = await expected(FIXTURE, FIXTURE_TIMES);
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FIXTURE, { updatedAtByPath: FIXTURE_TIMES });
  await go(r.page, "Applications");
  const got = await readEntries(r.page);
  const opened = await readDetail(r.page);
  await shot(r.page, "applications-fixture-1440x900");
  await ctx.close();
  const bad: string[] = [];
  // § 5.3: "When Applications opens, the first entry in page order is chosen"
  if (opened.heading !== want[0].role) bad.push(`on open the detail shows "${opened.heading}", want the first entry "${want[0].role}"`);
  if (JSON.stringify(got.map((g) => g.label)) !== JSON.stringify(want.map((w) => w.role))) bad.push(`labels/order ${JSON.stringify(got.map((g) => g.label))}, § 5.3 wants ${JSON.stringify(want.map((w) => w.role))}`);
  for (const w of want) {
    const g = got.find((x) => x.label === w.role);
    if (!g) continue;
    if (w.row) {
      if (!g.text.includes(w.row.stage)) bad.push(`${w.role}: stage "${w.row.stage}" not shown (${g.text})`);
      if (g.text.includes(AP.notLinked)) bad.push(`${w.role}: linked, yet shows "${AP.notLinked}"`);
    } else if (!g.text.includes(AP.notLinked)) bad.push(`${w.role}: no "${AP.notLinked}" (${g.text})`);
    if (!g.buttons.includes(ASK)) bad.push(`${w.role}: no "${ASK}"`);
  }
  assert.deepEqual(bad, []);
});

test("§ 5.3 'Each entry has ... Its files, each opening the viewer' and § 5.6 'Then its files as document rows, then Ask Ten about this' — on every entry of the list, not only in the chosen entry's detail (fixture, 1440)", async () => {
  const want = await expected(FIXTURE, FIXTURE_TIMES);
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FIXTURE, { updatedAtByPath: FIXTURE_TIMES });
  await go(r.page, "Applications");
  const got = await readEntries(r.page);
  await ctx.close();
  const bad: string[] = [];
  for (const w of want) {
    const g = got.find((x) => x.label === w.role);
    for (const p of w.paths) if (!g?.buttons.some((b) => b.includes(p))) bad.push(`${w.role}: entry has no control for ${p}`);
  }
  assert.deepEqual(bad, []);
});

test("§ 5.3 detail on the fixture (real shell, 1440): NovaGrid — header (label, § 2.1 tier, score, Role details), stage steps, all its files; coverage and cut rows equal proposalRows' output through AP's label tables; no 'Next, from you' (its plan lines are under Done)", async () => {
  const text = FIXTURE["applications/novagrid-staff-pm-application.md"];
  const pr = proposalRows(text);
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FIXTURE, { updatedAtByPath: FIXTURE_TIMES });
  await go(r.page, "Applications");
  await choose(r.page, "NovaGrid Energy — Staff PM");
  const d = await readDetail(r.page);
  await shot(r.page, "applications-detail-novagrid-1440x900");
  await ctx.close();
  const bad: string[] = [];
  if (d.heading !== "NovaGrid Energy — Staff PM") bad.push(`heading ${d.heading}`);
  if (!d.text.includes(TIER.strong) || !d.text.includes("88/100")) bad.push(`tier/score missing: ${d.text.slice(0, 200)}`);
  if (!d.buttons.includes(AP.roleDetails)) bad.push(`no "${AP.roleDetails}"`);
  for (const p of ["applications/novagrid-staff-pm-application.md", "applications/novagrid-staff-pm-resume.md", "applications/novagrid-staff-pm-resume.html", "applications/novagrid-staff-pm-cover-letter.md"]) if (!d.buttons.some((b) => b.includes(p))) bad.push(`no file control for ${p}`);
  // stage steps
  if (!d.steps) bad.push("no stage steps");
  else {
    const labels = d.steps.items.map((i) => i.text);
    if (JSON.stringify(labels) !== JSON.stringify(["To Review", "Interested", "Applied", "Interviewing", "Offer"])) bad.push(`steps ${JSON.stringify(labels)}`);
    const cur = d.steps.items.filter((i) => i.current !== null);
    if (cur.length !== 1 || cur[0].text !== "Applied" || cur[0].current !== "step") bad.push(`current ${JSON.stringify(cur)}`);
  }
  // coverage
  if (!d.h3.includes(COVERAGE_LABEL)) bad.push(`no "${COVERAGE_LABEL}" (h3s ${JSON.stringify(d.h3)})`);
  const wantHead = [COL.req, COL.ev, COL.status, COL.decision];
  if (JSON.stringify(d.coverageHead) !== JSON.stringify(wantHead)) bad.push(`coverage columns ${JSON.stringify(d.coverageHead)}, want ${JSON.stringify(wantHead)}`);
  // C § 19 (lead ruling 2026-09-29): the status label keys on `statuses[i]`; outside the table, the cell as written
  const wantCov = pr.coverage.map((c: string[], i: number) => [c[0], c[2], Object.hasOwn(STATUS, pr.statuses[i]) ? STATUS[pr.statuses[i]] : c[1], Object.hasOwn(DECISION, c[3]) ? DECISION[c[3]] : c[3]]);
  if (JSON.stringify(d.coverage) !== JSON.stringify(wantCov)) bad.push(`coverage ${JSON.stringify(d.coverage)}\n  want ${JSON.stringify(wantCov)}`);
  // cuts
  if (!d.h3.includes(CUT_LABEL)) bad.push(`no "${CUT_LABEL}"`);
  const wantCuts = pr.cuts.map((c: string[]) => [FROM.replace("<role>", c[1]), c[2], c[6]]);
  if (JSON.stringify(d.cuts) !== JSON.stringify(wantCuts)) bad.push(`cuts ${JSON.stringify(d.cuts)}\n  want ${JSON.stringify(wantCuts)}`);
  // kept rows are never shown as cuts
  for (const k of pr.kept) if (d.text.includes(k[2])) bad.push(`a kept bullet is shown: ${k[2]}`);
  if (d.h3.includes(NEXT) || d.next.length) bad.push(`"${NEXT}" shows ${JSON.stringify(d.next)} though no Waiting on you / To do line names a NovaGrid file`);
  // § 5.3 "No 'Format checks passed' badge and no word count"
  if (/format checks passed|\b\d+ words\b/i.test(d.text.replace(/the letter is short at \d+ words/g, ""))) bad.push("a format badge or a word count");
  assert.deepEqual(bad, []);
});

test("§ 5.3 detail on the fixture: Fernway — 'Next, from you' equals readPlanBoard's Waiting on you then To do items whose ref is one of its files or its row's Analysis path, each through the plan item (P18 pill); no tables (its notes file has none); stage Interviewing", async () => {
  const board = readPlanBoard(FIXTURE["plan.md"]);
  const refs = new Set([...Object.keys(FIXTURE).filter((p) => p.startsWith("applications/") && specKey(p) === "fernway-senior-pm"), "jd-analysis/fernway-senior-pm.md"]);
  const want = ["Waiting on you", "To do"].flatMap((l) => board.sections.find((s) => s.label === l)?.items.filter((i) => i.ref && refs.has(i.ref)) ?? []);
  assert.ok(want.length >= 2, "the fixture has lines for Fernway");
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FIXTURE, { updatedAtByPath: FIXTURE_TIMES });
  await go(r.page, "Applications");
  await choose(r.page, "Fernway Robotics — Senior PM");
  const d = await readDetail(r.page);
  await shot(r.page, "applications-detail-fernway-1440x900");
  await ctx.close();
  const bad: string[] = [];
  if (!d.h3.includes(NEXT)) bad.push(`no "${NEXT}"`);
  if (JSON.stringify(d.next.map((n) => n.chip)) !== JSON.stringify(want.map((w) => w.ref))) bad.push(`refs ${JSON.stringify(d.next.map((n) => n.chip))}, want ${JSON.stringify(want.map((w) => w.ref))}`);
  want.forEach((w, i) => {
    const split = splitPlanMinutes(w.text);
    const n = d.next[i];
    if (!n) return;
    if (split) {
      if (n.pill !== `${split.minutes} min`) bad.push(`item ${i}: pill "${n.pill}", want "${split.minutes} min"`);
      if (split.why && !n.text.includes(split.why)) bad.push(`item ${i}: why missing`);
    } else if (n.pill) bad.push(`item ${i}: a pill "${n.pill}" on a line with no minutes`);
  });
  if (d.h3.includes(COVERAGE_LABEL) || d.h3.includes(CUT_LABEL) || d.coverage.length) bad.push(`tables shown for a notes file with none: ${JSON.stringify(d.h3)}`);
  const cur = d.steps?.items.filter((i) => i.current === "step").map((i) => i.text);
  if (JSON.stringify(cur) !== JSON.stringify(["Interviewing"])) bad.push(`current step ${JSON.stringify(cur)}`);
  assert.deepEqual(bad, []);
});

test("§ 5.3 detail on the fixture: the unlinked entries (a key with no row; an unknown suffix) show AP1 and then only their files — no steps, no tier, no Role details", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FIXTURE, { updatedAtByPath: FIXTURE_TIMES });
  await go(r.page, "Applications");
  const bad: string[] = [];
  for (const label of ["applications/juniper-analytics-pm-resume.md", "applications/relocation-notes.txt"]) {
    await choose(r.page, label);
    const d = await readDetail(r.page);
    if (d.heading !== label) bad.push(`${label}: heading ${d.heading}`);
    if (!d.text.includes(AP.notLinked)) bad.push(`${label}: no AP1`);
    if (d.steps) bad.push(`${label}: stage steps shown`);
    if (d.buttons.includes(AP.roleDetails)) bad.push(`${label}: Role details shown`);
    if (Object.values(TIER).some((t) => d.text.includes(t))) bad.push(`${label}: a tier shown`);
    if (!d.buttons.some((b) => b.includes(label))) bad.push(`${label}: its file has no control`);
  }
  await shot(r.page, "applications-detail-unlinked-1440x900");
  await ctx.close();
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- edge seed

const COV_H = "| requirement | status | evidence | decision |";
const SEL_H = "| # | role | bullet | in/out | source | words | why |";
const notes = (cov: string[], sel: string[]) => ["# notes", "", "## Coverage", COV_H, "|---|---|---|---|", ...cov, "", "## Selection", SEL_H, "|---|---|---|---|---|---|---|", ...sel, ""].join("\n");
const EDGE_JOBS = [
  "# Pipeline",
  "",
  "## Applied",
  "",
  "### Twofold Inc — Staff PM",
  "- Seen: 2026-09-20T00:00:00+00:00",
  "- Updated: 2026-09-21T00:00:00+00:00",
  "- Analysis: jd-analysis/twofold-pm.md",
  "",
  "### Oddrow Ltd — Product Lead",
  "- Seen: 2026-09-20T00:00:00+00:00",
  "- Updated: 2026-09-21T00:00:00+00:00",
  "- Verdict: weak",
  "- Analysis: jd-analysis/oddrow-lead.md",
  "",
  "## Dismissed",
  "",
  "### Gone Corp — Growth PM",
  "- Seen: 2026-09-20T00:00:00+00:00",
  "- Updated: 2026-09-21T00:00:00+00:00",
  "- Analysis: jd-analysis/gone-pm.md",
  "- Was: Interested",
  "- Dismissed: the team was reorganised away",
  "",
].join("\n");
const EDGE: Record<string, string> = {
  "jobs.md": EDGE_JOBS,
  "plan.md": "Goal: g\nBudget: 20 min/day\n\n## Board\n\nWaiting on you\n- nothing for these\n\nTo do\n- Read it (`applications/gone-pm.md`)\n",
  "applications/twofold-pm.md": notes(["| a | have | x | answered |"], ["| 1 | R | b | out | base | 2 | w |"]),
  "applications/twofold-pm-application.md": notes(["| c | gap | y | open |"], []),
  "applications/oddrow-lead-application.md": notes(
    ["| roadmap | have | owned it | answered |", "| billing | gap | none |", "| odd | maybe-ish | z | later |"],
    ["| 1 | Argent | kept one | in | base | 3 | fine |", "| 2 | Halcyon | cut one | out | base | 3 | weakest |", "| 3 | Halcyon | broken | out | base |"],
  ),
  "applications/gone-pm.md": notes([], []),
  "applications/gone-pm-resume.md": "# résumé\n",
};

test("§ 5.3 detail, edge seed (real shell, 1440): two notes files → AP14 word for word, no tables; wrong cell count → F42 with the path, cells joined by ' | ', never dropped; an unknown status/decision shows as written; a dismissed row → 'Dismissed' and its note, no steps", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, EDGE);
  await go(r.page, "Applications");
  const bad: string[] = [];

  await choose(r.page, "Twofold Inc — Staff PM");
  let d = await readDetail(r.page);
  const two = TWO_NOTES.replace("<a>", "applications/twofold-pm-application.md").replace("<b>", "applications/twofold-pm.md");
  const twoOther = TWO_NOTES.replace("<a>", "applications/twofold-pm.md").replace("<b>", "applications/twofold-pm-application.md");
  if (!d.text.includes(two) && !d.text.includes(twoOther)) bad.push(`two notes files: no AP14 line in "${d.text}"`);
  if (d.h3.includes(COVERAGE_LABEL) || d.h3.includes(CUT_LABEL) || d.coverage.length || d.cuts.length) bad.push("two notes files: a table is shown");
  await shot(r.page, "applications-two-notes-1440x900");

  await choose(r.page, "Oddrow Ltd — Product Lead");
  d = await readDetail(r.page);
  const unread = UNREADABLE.replace("<path>", "applications/oddrow-lead-application.md");
  if (!d.text.includes(unread)) bad.push(`wrong cell count: no "${unread}"`);
  for (const line of ["billing | gap | none", "3 | Halcyon | broken | out | base"]) if (!d.text.includes(line)) bad.push(`unreadable row "${line}" not shown`);
  if (JSON.stringify(d.coverage) !== JSON.stringify([["roadmap", "owned it", "Covered", "Answered"], ["odd", "z", "maybe-ish", "later"]])) bad.push(`coverage ${JSON.stringify(d.coverage)}`);
  if (JSON.stringify(d.cuts) !== JSON.stringify([[FROM.replace("<role>", "Halcyon"), "cut one", "weakest"]])) bad.push(`cuts ${JSON.stringify(d.cuts)}`);
  if (!d.text.includes(TIER.weak)) bad.push("tier Weak Fit missing");
  await shot(r.page, "applications-unreadable-1440x900");

  await choose(r.page, "Gone Corp — Growth PM");
  d = await readDetail(r.page);
  if (d.steps) bad.push("dismissed row: stage steps shown");
  if (!d.text.includes(DISMISSED) || !d.text.includes("the team was reorganised away")) bad.push(`dismissed row: "${DISMISSED}" and its note not both shown: ${d.text.slice(0, 200)}`);
  if (/\bInterested\b/.test(d.text)) bad.push("dismissed row: shows its old stage as if current");
  if (d.h3.includes(COVERAGE_LABEL) || d.h3.includes(CUT_LABEL)) bad.push("dismissed row: an empty table's section is shown");
  if (JSON.stringify(d.next.map((n) => n.chip)) !== JSON.stringify(["applications/gone-pm.md"])) bad.push(`dismissed row: next ${JSON.stringify(d.next)}`);
  const entries = await readEntries(r.page);
  const gone = entries.find((e) => e.label === "Gone Corp — Growth PM");
  if (!gone?.text.includes(DISMISSED) || !gone.text.includes("the team was reorganised away")) bad.push(`dismissed entry in the list: ${gone?.text}`);
  await shot(r.page, "applications-dismissed-1440x900");

  const s = await spy(r.page);
  if (s.writes.length || s.uploads.length || r.proxyHits || s.saves) bad.push(`writes ${s.writes} uploads ${s.uploads} model calls ${r.proxyHits} saves ${s.saves}`);
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.3 part 5 'any other value as written': a status or decision that happens to name an Object property (`constructor`, `toString`, `__proto__`) shows as written, not blank", async () => {
  const files = {
    "jobs.md": EDGE_JOBS,
    "applications/oddrow-lead-application.md": notes(["| proto | constructor | z2 | toString |", "| p2 | __proto__ | z3 | hasOwnProperty |"], []),
  };
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, files);
  const errors: string[] = [];
  r.page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  await go(r.page, "Applications");
  await r.page.waitForTimeout(800);
  const body = squash(await r.page.locator("body").innerText());
  await shot(r.page, "applications-proto-status-1440x900");
  const d = await readDetail(r.page).catch(() => null);
  await ctx.close();
  assert.ok(d, `the detail did not render; page errors ${JSON.stringify(errors)}; the page shows "${body.slice(0, 200)}"`);
  // Round 2: the builder changed this to expect `proto` (the normalised
  // status). Rewritten by the tester: C § 19 (origin/docs/workspace-review-
  // drift, lead ruling 2026-09-29) keys the label table on `statuses`, but
  // "A value outside the table shows as its cell is written" — `__proto__`
  // normalises to `proto`, which is outside the table, so the cell shows
  // `__proto__`, as written.
  assert.deepEqual(d.coverage, [["proto", "z2", "constructor", "toString"], ["p2", "z3", "__proto__", "hasOwnProperty"]]);
});

test("C § 19 ruling on the page: the status label keys on `statuses` (`**gap**`, `` `gap` ``, `Gap` → Gap; `Have` → Covered; `Shown-But-Unnamed` → AP10); a value outside the table shows as its cell is written (`partly`, `**Partly**`)", async () => {
  const rows = [
    "| r1 | **gap** | e1 | open |",
    "| r2 | `gap` | e2 | open |",
    "| r3 | Gap | e3 | open |",
    "| r4 | Have | e4 | answered |",
    "| r5 | Shown-But-Unnamed | e5 | answered |",
    "| r6 | partly | e6 | skipped |",
    "| r7 | **Partly** | e7 | skipped |",
  ];
  const files = { "jobs.md": EDGE_JOBS, "applications/oddrow-lead-application.md": notes(rows, []) };
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, files);
  await go(r.page, "Applications");
  const d = await readDetail(r.page);
  await ctx.close();
  assert.deepEqual(
    d.coverage.map((c) => c[2]),
    [STATUS.gap, STATUS.gap, STATUS.gap, STATUS.have, STATUS["shown-but-unnamed"], "partly", "**Partly**"],
  );
});

test("§ 5.2 rule 6 on Applications: a notes file whose read fails shows F40 with its path and Retry in parts 5-6 only (header, steps and files still show); Retry recovers", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FIXTURE);
  await r.page.evaluate(() => {
    (window as any).__ctl.readFail = ["applications/novagrid-staff-pm-application.md"];
  });
  await go(r.page, "Applications");
  await choose(r.page, "NovaGrid Energy — Staff PM");
  let d = await readDetail(r.page);
  const bad: string[] = [];
  const err = READ_ERR.replace("<path>", "applications/novagrid-staff-pm-application.md");
  if (!d.text.includes(err)) bad.push(`no "${err}"`);
  if (!d.buttons.includes(RETRY)) bad.push("no Retry");
  if (d.heading !== "NovaGrid Energy — Staff PM" || !d.steps || !d.buttons.some((b) => b.includes("novagrid-staff-pm-resume.html"))) bad.push("the header, steps or files are gone with the read failure");
  const errs = (d.text.match(/Couldn't read [^.]+(\.[a-z]+)?\. Try again in a moment\./g) ?? []);
  if (errs.length !== 1) bad.push(`one failing file, ${errs.length} error lines: ${JSON.stringify(errs)} in "${d.text}"`);
  await shot(r.page, "applications-read-error-1440x900");
  await r.page.evaluate(() => ((window as any).__ctl.readFail = []));
  await detail(r.page).getByRole("button", { name: RETRY }).last().click();
  d = await readDetail(r.page);
  if (d.coverage.length !== 4) bad.push(`after Retry: ${d.coverage.length} coverage rows`);
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.2 rule 6 on Applications: jobs.md unreadable → F40 naming jobs.md with Retry, never the entries shown as 'Not linked' and never the empty state", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FIXTURE);
  await r.page.evaluate(() => ((window as any).__ctl.readFail = ["jobs.md"]));
  await go(r.page, "Applications");
  await pane(r.page).locator(".app-entry-row, .page-empty, .page-error-card").first().waitFor({ timeout: 8000 });
  const text = squash(await pane(r.page).innerText());
  await ctx.close();
  const bad: string[] = [];
  if (text.includes(AP.notLinked)) bad.push("entries shown as Not linked over an unreadable jobs.md");
  if (text.includes(EMPTY_FIRST)) bad.push("the empty state over an unreadable jobs.md");
  if (!text.includes(RETRY)) bad.push("no Retry");
  const err = READ_ERR.replace("<path>", "jobs.md");
  if (!text.includes(err)) bad.push(`F40 names no path: shows "${text.slice(0, 120)}", § 5.3.1 F40 wants "${err}"`);
  assert.deepEqual(bad, []);
});

// The seed below simply lacks the file: the store's own read() throws its
// own `resource_missing` (packages/agent's WorkspaceError — the class the
// production Supabase store throws too, supabase-workspace-store.ts:24,344).
test("§ 5.2 rule 6 'Missing is empty' on the real store: a workspace with no plan.md — the detail shows no error and no 'Next, from you'", async () => {
  const files = { ...FIXTURE };
  delete files["plan.md"];
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, files);
  await go(r.page, "Applications");
  await choose(r.page, "Fernway Robotics — Senior PM");
  const d = await readDetail(r.page);
  await shot(r.page, "applications-no-plan-1440x900");
  await ctx.close();
  assert.ok(!/Couldn't read/.test(d.text), `a missing plan.md shown as unreadable: "${d.text}"`);
  assert.ok(!d.buttons.includes(RETRY), "a Retry for a missing file");
});

test("§ 5.2 rule 6 'Missing is empty' on the real store: application files but no jobs.md — every entry is listed as not linked, never an error", async () => {
  const files = Object.fromEntries(Object.entries(FIXTURE).filter(([p]) => p.startsWith("applications/")));
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, files);
  await go(r.page, "Applications");
  await pane(r.page).locator(".app-entry-row, .page-empty, .page-error-card").first().waitFor({ timeout: 8000 });
  const text = squash(await pane(r.page).innerText());
  const entries = await readEntries(r.page).catch(() => []);
  await ctx.close();
  assert.ok(!/Couldn't read/.test(text), `a missing jobs.md shown as unreadable: "${text.slice(0, 160)}"`);
  assert.equal(entries.length, 4);
  for (const e of entries) assert.ok(e.text.includes(AP.notLinked), e.text);
});

test("§ 5.2 rule 6 on Applications: list('applications') failing → an error with Retry, never the empty state; Retry recovers", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FIXTURE);
  await r.page.evaluate(() => ((window as any).__ctl.listFail = true));
  await go(r.page, "Applications");
  await pane(r.page).locator(".app-entry-row, .page-empty, .page-error-card").first().waitFor({ timeout: 8000 });
  const text = squash(await pane(r.page).innerText());
  await r.page.evaluate(() => ((window as any).__ctl.listFail = false));
  await pane(r.page).getByRole("button", { name: RETRY }).click();
  await r.page.waitForTimeout(300);
  const after = await readEntries(r.page);
  await ctx.close();
  assert.ok(!text.includes(EMPTY_FIRST), text);
  assert.ok(/Couldn't read .+\. Try again in a moment\./.test(text), text);
  assert.equal(after.length, 4);
});

test("§ 5.3 Empty (AP16, AP17) on a workspace with no application files: the words, and one Talk to Ten button that only opens Talk to Ten", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, { "jobs.md": EDGE_JOBS });
  await go(r.page, "Applications");
  const text = squash(await pane(r.page).locator(".page-empty").innerText().catch(() => ""));
  const buttons = await pane(r.page).getByRole("button").evaluateAll((els) => els.map((e) => e.textContent?.trim()));
  await pane(r.page).getByRole("button", { name: TALK }).click();
  await r.page.waitForTimeout(150);
  const t = await title(r.page);
  const s = await spy(r.page);
  await ctx.close();
  assert.ok(text.startsWith(`${EMPTY_FIRST} ${EMPTY_REST}`), `empty state "${text}"`);
  assert.deepEqual(buttons, [TALK]);
  assert.equal(t, "Talk to Ten");
  assert.deepEqual([s.writes, s.uploads, r.proxyHits], [[], [], 0]);
});

// ---------------------------------------------------------------- rules 1, 2, 8 and § 5.4

test("§ 5.2 rules 1-2 and § 5.4 on Applications (real shell, spies): every entry, file, chip, Role details and Ask Ten — zero writes/uploads, zero model calls, zero saves; Role details opens Jobs; Ask Ten drafts `About <Company — Title>: ` unsent and never overwrites unsent text", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FIXTURE, { updatedAtByPath: FIXTURE_TIMES });
  const page = r.page;
  const bad: string[] = [];
  await go(page, "Applications");
  const entries = await readEntries(page);
  for (const e of entries) {
    await choose(page, e.label);
    const files = detail(page).locator(".app-detail-files button, .plan-item-chip");
    const n = await files.count();
    for (let i = 0; i < n; i++) {
      await files.nth(i).click();
      await page.waitForTimeout(150);
      await closeViewer(page);
    }
  }
  await choose(page, "NovaGrid Energy — Staff PM");
  await detail(page).getByRole("button", { name: AP.roleDetails }).click();
  await page.waitForTimeout(200);
  if ((await title(page)) !== "Jobs") bad.push(`Role details opened "${await title(page)}", want Jobs`);
  await go(page, "Applications");
  await pane(page).locator(".app-entry-row", { hasText: "NovaGrid Energy — Staff PM" }).getByRole("button", { name: ASK }).click();
  await page.waitForTimeout(200);
  const draft = await page.locator(".composer-input").inputValue();
  const want = DRAFT.replace("<label>", "NovaGrid Energy — Staff PM");
  if ((await title(page)) !== "Talk to Ten") bad.push("Ask Ten did not open Talk to Ten");
  if (draft !== want) bad.push(`draft ${JSON.stringify(draft)}, want ${JSON.stringify(want)}`);
  await page.locator(".composer-input").fill("my unsent words");
  await go(page, "Applications");
  await pane(page).locator(".app-entry-row", { hasText: "Fernway" }).getByRole("button", { name: ASK }).click();
  await page.waitForTimeout(200);
  if ((await page.locator(".composer-input").inputValue()) !== "my unsent words") bad.push("unsent text overwritten");
  // the detail's own Ask Ten, on an unlinked entry: the label is the path
  await page.locator(".composer-input").fill("");
  await go(page, "Applications");
  await choose(page, "applications/relocation-notes.txt");
  await detail(page).getByRole("button", { name: ASK }).click();
  await page.waitForTimeout(200);
  const d2 = await page.locator(".composer-input").inputValue();
  if (d2 !== DRAFT.replace("<label>", "applications/relocation-notes.txt")) bad.push(`detail draft ${JSON.stringify(d2)}`);
  const s = await spy(page);
  if (s.writes.length || s.uploads.length || r.proxyHits || s.saves) bad.push(`writes ${s.writes} uploads ${s.uploads} model calls ${r.proxyHits} saves ${s.saves}`);
  await ctx.close();
  assert.deepEqual(bad, []);
});

const EVIL_HTML = `<!doctype html><html><body><h1>Résumé</h1><script>parent.__pwned = 1; window.__ran = 1;</script></body></html>`;

test("§ 5.2 rule 8 from Applications: the one viewer — .md through MarkdownView, the .html in the sandboxed iframe (a planted script stays dead) with a working print button", async () => {
  const files = { ...FIXTURE, "applications/novagrid-staff-pm-resume.html": EVIL_HTML };
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, files);
  const page = r.page;
  await go(page, "Applications");
  await choose(page, "NovaGrid Energy — Staff PM");
  const bad: string[] = [];
  await detail(page).locator(".app-detail-files button", { hasText: "novagrid-staff-pm-resume.html" }).click();
  await page.waitForTimeout(400);
  const v = await page.locator(".side-panel").evaluate((e) => ({ path: e.querySelector(".side-panel-path")?.textContent, sandbox: e.querySelector("iframe")?.getAttribute("sandbox") ?? null, buttons: Array.from(e.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim()) }));
  if (v.path !== "applications/novagrid-staff-pm-resume.html") bad.push(`viewer shows ${v.path}`);
  if (v.sandbox === null || v.sandbox.split(/\s+/).includes("allow-scripts")) bad.push(`sandbox ${v.sandbox}`);
  if (!v.buttons.includes(PRINT)) bad.push(`no "${PRINT}"`);
  else {
    await page.evaluate(() => {
      (window as any).__printed = 0;
      const w = document.querySelector<HTMLIFrameElement>(".side-panel iframe")?.contentWindow as any;
      if (w) w.print = () => (window as any).__printed++;
    });
    await page.locator(".side-panel").getByRole("button", { name: PRINT }).click();
    if ((await page.evaluate(() => (window as any).__printed)) !== 1) bad.push("print did not reach the iframe");
  }
  if (await page.evaluate(() => (window as any).__pwned)) bad.push("the planted script ran");
  await shot(page, "applications-viewer-html-1440x900");
  await closeViewer(page);
  await detail(page).locator(".app-detail-files button", { hasText: "novagrid-staff-pm-application.md" }).click();
  await page.waitForTimeout(300);
  if (!(await page.locator(".side-panel .markdown-view").count())) bad.push(".md not through MarkdownView");
  await ctx.close();
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- rule 4

test("§ 5.2 rule 4 on Applications: while a turn runs, F35's one neutral line; at turn end the list and the chosen detail re-read with no reload (a file written mid-turn shows)", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FIXTURE, { holdTurns: true, updatedAtByPath: FIXTURE_TIMES });
  const page = r.page;
  await go(page, "Talk to Ten");
  await page.locator(".composer-input").fill("draft the letter");
  await page.locator(".composer-input").press("Enter");
  await page.waitForFunction(() => /thinking|working/.test(document.querySelector(".avatar")?.className ?? ""), null, { timeout: 5000 }).catch(() => {});
  await go(page, "Applications");
  await choose(page, "Fernway Robotics — Senior PM");
  const during = squash(await pane(page).innerText());
  await page.evaluate(() => {
    const inner = (window as any).__inner;
    inner.write("applications/midturn-co-pm-resume.md", "# new\n", null);
    return inner.write(
      "applications/fernway-senior-pm.md",
      "# Fernway\n\n## Coverage\n| requirement | status | evidence | decision |\n|---|---|---|---|\n| hardware cycle | gap | none | open |\n",
      null,
    ).catch(() => inner.read("applications/fernway-senior-pm.md").then((f: any) => inner.write("applications/fernway-senior-pm.md", "# Fernway\n\n## Coverage\n| requirement | status | evidence | decision |\n|---|---|---|---|\n| hardware cycle | gap | none | open |\n", f.version)));
  });
  r.release();
  await page.waitForFunction(() => !/thinking|working/.test(document.querySelector(".avatar")?.className ?? ""), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  const entries = await readEntries(page);
  const d = await readDetail(page);
  const afterText = squash(await pane(page).innerText());
  await ctx.close();
  const bad: string[] = [];
  if (!during.includes(TURN_LINE)) bad.push(`no "${TURN_LINE}" while the turn ran`);
  if (afterText.includes(TURN_LINE)) bad.push("the working line stayed after the turn");
  if (!entries.some((e) => e.label === "applications/midturn-co-pm-resume.md")) bad.push(`the file written mid-turn is not listed: ${JSON.stringify(entries.map((e) => e.label))}`);
  if (JSON.stringify(d.coverage) !== JSON.stringify([["hardware cycle", "none", STATUS.gap, DECISION.open]])) bad.push(`the chosen detail did not re-read its notes file: ${JSON.stringify(d.coverage)}`);
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- § 5.5 phone

test("§ 5.5 at 375px on Applications (fixture): the list alone; an entry opens its detail with AP15 'Back to Applications'; no horizontal scroll on list or detail; controls ≥ 44px; a file opens the full-screen sheet", async () => {
  const ctx = await ctxFor(PHONE);
  const r = await openReal(ctx, FIXTURE, { updatedAtByPath: FIXTURE_TIMES });
  const page = r.page;
  await go(page, "Applications");
  const bad: string[] = [];
  const scroll = () => page.evaluate(() => {
    const over = [document.documentElement, ...Array.from(document.querySelectorAll<HTMLElement>(".frame-page, .applications-page, .applications-list, .applications-detail-pane, .app-detail, .app-coverage-table"))].filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== "auto");
    return { doc: document.documentElement.scrollWidth, over: over.map((e) => `${e.className} ${e.scrollWidth}>${e.clientWidth}`) };
  });
  const small = () => page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".frame-page:not(.frame-page--hidden) button"))
      .filter((b) => b.getClientRects().length && getComputedStyle(b).visibility !== "hidden")
      .map((b) => ({ t: (b.textContent ?? "").trim().slice(0, 40), h: Math.round(b.getBoundingClientRect().height) }))
      .filter((b) => b.h < 44),
  );
  let s = await scroll();
  if (s.doc > PHONE.width || s.over.length) bad.push(`list: horizontal scroll ${JSON.stringify(s)}`);
  const detailVisible = await detail(page).isVisible().catch(() => false);
  if (detailVisible) bad.push("list and detail both show at 375 (§ 5.5: the list alone)");
  for (const b of await small()) bad.push(`list: "${b.t}" ${b.h}px tall`);
  await shot(page, "applications-list-375x812");
  await choose(page, "NovaGrid Energy — Staff PM");
  if (!(await detail(page).isVisible())) bad.push("the entry did not open its detail");
  s = await scroll();
  if (s.doc > PHONE.width || s.over.length) bad.push(`detail: horizontal scroll ${JSON.stringify(s)}`);
  for (const b of await small()) bad.push(`detail: "${b.t}" ${b.h}px tall`);
  await shot(page, "applications-detail-375x812");
  await detail(page).evaluate((e) => e.scrollIntoView({ block: "end" }));
  await detail(page).locator("table").first().scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, "applications-detail-coverage-375x812");
  await detail(page).locator(".app-detail-files button").first().click();
  await page.waitForTimeout(400);
  const sheet = await page.locator(".side-panel").evaluate((e) => ({ z: getComputedStyle(e).zIndex, w: Math.round(e.getBoundingClientRect().width) }));
  if (sheet.z !== "30" || sheet.w !== PHONE.width) bad.push(`not the full-screen sheet: ${JSON.stringify(sheet)}`);
  await shot(page, "applications-sheet-375x812");
  await closeViewer(page);
  const back = detail(page).getByRole("button", { name: BACK });
  if (!(await back.isVisible())) bad.push(`no "${BACK}"`);
  else {
    await back.click();
    await page.waitForTimeout(200);
    if (await detail(page).isVisible()) bad.push(`"${BACK}" did not return to the list`);
  }
  const sp = await spy(page);
  if (sp.writes.length || sp.uploads.length || r.proxyHits) bad.push(`writes ${sp.writes} uploads ${sp.uploads} model calls ${r.proxyHits}`);
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.5: at 1440 the phone's 'Back to Applications' is not shown (list and detail side by side)", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FIXTURE);
  await go(r.page, "Applications");
  await detail(r.page).waitFor();
  const back = await detail(r.page).getByRole("button", { name: BACK }).isVisible();
  const listVisible = await pane(r.page).locator(".applications-list").isVisible();
  await ctx.close();
  assert.equal(back, false);
  assert.equal(listVisible, true);
});

test("§ 5.5 'A long path or URL wraps with overflow-wrap: anywhere' — and only those: no word in the coverage table or the cut list is broken mid-word (fixture, 1440 and 375)", async () => {
  const bad: string[] = [];
  for (const vp of [DESK, PHONE]) {
    const ctx = await ctxFor(vp);
    const r = await openReal(ctx, FIXTURE);
    await go(r.page, "Applications");
    await choose(r.page, "NovaGrid Energy — Staff PM");
    await detail(r.page).locator("table").first().waitFor({ timeout: 8000 });
    const broken = await detail(r.page).evaluate((d) => {
      const out: string[] = [];
      for (const cell of Array.from(d.querySelectorAll("td, th, .app-cut-list p"))) {
        const node = Array.from(cell.childNodes).find((n) => n.nodeType === 3) as Text | undefined;
        if (!node) continue;
        const t = node.data;
        const re = /[^\s\-/]+/g; // a break at a hyphen or slash is a normal break
        let m: RegExpExecArray | null;
        while ((m = re.exec(t))) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const tops = new Set(Array.from(range.getClientRects()).map((q) => Math.round(q.top)));
          if (tops.size > 1) out.push(m[0]);
        }
      }
      return out;
    });
    if (broken.length) bad.push(`${vp.width}px: ${broken.length} words broken mid-word, e.g. ${JSON.stringify(broken.slice(0, 8))}`);
    await ctx.close();
  }
  assert.deepEqual(bad, []);
});
