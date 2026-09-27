// Builder-owned tests for docs/design-web-ui.md § 5.9 Stage 2's own tester
// checks that the design assigns to the builder (§ 5.1, "One frame for
// both builds"):
//   - the RealChatShell run with a spy conversation store, proving the
//     save count (exactly one save per ended turn, whichever page is
//     open) and the restored-gate landing case;
//   - the new-version notice showing on a page other than Talk to Ten.
// The tester writes its own e2e for the rest of § 5.9 Stage 2 separately.
//
// What runs: a PRODUCTION build (apps/web/vite.config.ts's own `define`
// and version.json plugin) of tests/web/stage2/harness.tsx, which mounts
// the REAL member chat screen (RealChatShell -> Frame -> Rail/TabBar/
// Header/Transcript/Composer) over a real createCoach and the real
// OpenRouter provider. Headless Chromium. Playwright routes answer
// /version.json and the model proxy, and count every request — nothing
// leaves the machine.
//
// Run: node --test tests/web/stage2-frame.test.ts
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page, type Route } from "../../apps/web/node_modules/playwright/index.mjs";
import { textReply } from "../agent/_openrouter_stub.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const HARNESS = path.join(HERE, "stage2");

let server: Server;
let base = "";
let browser: Browser;
let outDir = "";

before(async () => {
  const link = path.join(HARNESS, "node_modules");
  if (!existsSync(link)) symlinkSync("../../../apps/web/node_modules", link);
  assert.ok(lstatSync(link).isSymbolicLink());
  outDir = mkdtempSync(path.join(tmpdir(), "ten-stage2-harness-"));
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

interface Harness {
  page: Page;
  proxyHits: number;
  /** Makes the NEXT /version.json response (and every one after it) name
   *  a different id, so useVersionMonitor finds a newer build (§ 10.4). */
  setVersionMismatched(): void;
}

async function open(opts: { seedGate?: boolean } = {}): Promise<Harness> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const h: Harness = { page, proxyHits: 0, setVersionMismatched: () => {} };
  let mismatched = false;
  h.setVersionMismatched = () => {
    mismatched = true;
  };
  // "same" is resolved LAZILY, at request time, off the harness's own
  // reported builtId (tests/web/version/harness.tsx's own technique) —
  // never a placeholder string, which would always mismatch the real id
  // and falsely trip useVersionMonitor's very first, mount-time check.
  await page.route("**/version.json", async (route: Route) => {
    const builtId = await page.evaluate(() => (window as any).__h?.builtId).catch(() => undefined);
    const id = mismatched ? "0000000-19700101T000000Z" : (builtId ?? "not-mounted-yet");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id }) });
  });
  await page.route("**/stub-proxy/**", async (route: Route) => {
    h.proxyHits++;
    const reply = textReply("Here's the plan.", 0.001);
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: reply.body() });
  });
  const url = opts.seedGate ? `${base}?seedGate=1` : base;
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__h?.builtId);
  await page.locator(".frame").waitFor();
  return h;
}

const railItem = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(label) }).first();
async function currentPage(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector(".frame-page:not(.frame-page--hidden)")?.getAttribute("data-page") ?? (document.querySelector(".frame-page--talk:not(.frame-page--hidden)") ? "talk" : null));
}
async function waitIdle(page: Page) {
  await page.waitForFunction(() => {
    const a = document.querySelector(".avatar");
    return a && !/thinking|working/.test(a.className);
  }, null, { timeout: 20000 });
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------- landing

test("landing: no saved conversation and no pending gate -> Talk to Ten, zero saves so far", async () => {
  const h = await open();
  assert.equal(await currentPage(h.page), "talk", "lands on Talk to Ten (§ 5.1: no conversation saved yet)");
  assert.ok(await h.page.locator(".composer-input").isVisible(), "the composer is reachable without navigating");
  assert.equal(await h.page.evaluate(() => (window as any).__h.saveCount()), 0, "nothing saved yet");
  await h.page.context().close();
});

test("landing: a restored conversation with a pending gate -> Talk to Ten (rule 7 beats everything), and the needs-you marker shows", async () => {
  const h = await open({ seedGate: true });
  assert.equal(await currentPage(h.page), "talk", "§ 5.1: 'the restored conversation has a pending gate' lands on Talk to Ten");
  assert.equal(await h.page.locator(".avatar").evaluate((e) => [...e.classList].find((c) => c.startsWith("avatar--"))), "avatar--needs-you");
  assert.ok(await railItem(h.page, "Needs your yes").isVisible(), "the rail's own marker on Talk to Ten");
  assert.ok((await h.page.locator(".frame-page--talk").innerText()).includes("evaluate the role"), "the restored gate card itself is on screen (rule 7: never a yes without the complete thing showing)");
  assert.equal(await h.page.evaluate(() => (window as any).__h.saveCount()), 0, "restoring never itself saves");
  await h.page.context().close();
});

// ---------------------------------------------------------------- save count / mounted conversation

test("§ 5.1 'One frame for both builds': exactly one save per ended turn, and the transcript survives a page change mid-turn", async () => {
  const h = await open();
  await h.page.locator(".composer-input").fill("Evaluate this role for me");
  await h.page.locator(".composer-input").press("Enter");
  // Mid-stream: leave Talk to Ten for Jobs before the turn ends.
  await h.page.waitForTimeout(30);
  await railItem(h.page, "^Jobs$").click();
  assert.equal(await currentPage(h.page), "jobs", "the page changed under the candidate's own click");
  await waitIdle(h.page);
  await h.page.waitForFunction(() => (window as any).__h.saveCount() >= 1, null, { timeout: 20000 });
  await h.page.waitForTimeout(200);
  assert.equal(await h.page.evaluate(() => (window as any).__h.saveCount()), 1, "exactly one save for the one ended turn");
  assert.equal(await currentPage(h.page), "jobs", "still on Jobs — a finished turn never navigates the candidate anywhere (§ 5.1)");
  // Return to Talk to Ten: the reply is there, because the conversation
  // was never unmounted (§ 5.1, "The conversation stays mounted").
  await railItem(h.page, "Talk to Ten").click();
  assert.equal(await currentPage(h.page), "talk");
  assert.ok((await h.page.locator(".transcript").innerText()).includes("Here's the plan."), "the finished reply is on screen with no reload");
  const saved = await h.page.evaluate(() => (window as any).__h.saves[0].messages.length);
  assert.ok(saved >= 2, "the save carried the real, finished turn (user + assistant)");
  await h.page.context().close();
});

test("a turn started on Talk to Ten and left running while Home shows still saves exactly once", async () => {
  const h = await open();
  await railItem(h.page, "^Home$").click();
  assert.equal(await currentPage(h.page), "home");
  // Sending only works from Talk to Ten's own composer (§ 5.2 rule 2) —
  // go back, send, then immediately leave again.
  await railItem(h.page, "Talk to Ten").click();
  await h.page.locator(".composer-input").fill("One more question");
  await h.page.locator(".composer-input").press("Enter");
  await h.page.waitForTimeout(30);
  await railItem(h.page, "^Home$").click();
  await waitIdle(h.page);
  await h.page.waitForFunction(() => (window as any).__h.saveCount() >= 1, null, { timeout: 20000 });
  await h.page.waitForTimeout(200);
  assert.equal(await h.page.evaluate(() => (window as any).__h.saveCount()), 1);
  assert.equal(await currentPage(h.page), "home", "Home stays put — the app never switches pages on its own");
  await h.page.context().close();
});

// ---------------------------------------------------------------- version notice on a non-chat page

test("§ 5.1 'the new-version check runs in the frame': the notice shows on a page other than Talk to Ten, word for word, the same as Talk to Ten's own copy", async () => {
  const h = await open();
  await railItem(h.page, "^Documents$").click();
  assert.equal(await currentPage(h.page), "documents");
  // Talk to Ten's OWN copy is unconditional in RealChatShell's own JSX
  // (unchanged) — it stays in the DOM, hidden, even while another page
  // shows (§ 5.1, "the conversation stays mounted"), so ":visible" is
  // what tells the two copies apart, not plain existence.
  assert.equal(await h.page.locator(".version-notice:visible").count(), 0, "no VISIBLE notice yet");
  h.setVersionMismatched();
  await h.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await h.page.locator(".version-notice:visible").waitFor({ timeout: 5000 });
  assert.equal(await currentPage(h.page), "documents", "still on Documents — the notice doesn't navigate anywhere");
  const text = await h.page.locator(".version-notice-text:visible").innerText();
  assert.ok(text.startsWith("Ten has been updated."), text);
  // Talk to Ten's own copy (unchanged, C § 10, directly above the composer)
  // shows the SAME words — one fact, shown twice, never re-derived.
  await railItem(h.page, "Talk to Ten").click();
  assert.equal(await h.page.locator(".version-notice:visible").count(), 1, "exactly one VISIBLE copy on Talk to Ten too");
  assert.equal(await h.page.locator(".version-notice-text:visible").innerText(), text);
  assert.match(
    await h.page.locator(".version-notice:visible").evaluate((e) => e.nextElementSibling?.className ?? ""),
    /\bcomposer\b/,
    "Talk to Ten's own copy still sits directly above the composer",
  );
  await h.page.context().close();
});
