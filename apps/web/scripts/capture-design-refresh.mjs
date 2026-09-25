// Design-refresh render pass (docs/design-web-ui-refresh.md, agents/
// designer.md's "Render, then look"): plays fixtures end to end against
// a built preview server and saves named screenshots — no assertions
// (that's scripts/verify-screens.mjs's job, unmodified by this file).
// Never live data: every fixture is invented (design-web-ui.md § 4).
//
// Usage: node scripts/capture-design-refresh.mjs <outDir> [prefix]
//   outDir  — where PNGs land (this repo's own apps/web/.gitignore
//             covers .local/screenshots, but the design proposal saves
//             OUTSIDE the repo — see the refresh doc for the real path).
//   prefix  — e.g. "before-" / "after-", prepended to every file name.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, "..");
const PORT = Number(process.env.CAPTURE_PORT ?? 4179);
const BASE_URL = `http://localhost:${PORT}/`;
const OUT_DIR = process.argv[2] ?? process.env.SCREENSHOT_DIR;
const PREFIX = process.argv[3] ?? process.env.SHOT_PREFIX ?? "";

if (!OUT_DIR) {
  console.error("usage: node capture-design-refresh.mjs <outDir> [prefix]");
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });

function shot(name) {
  return join(OUT_DIR, `${PREFIX}${name}.png`);
}

async function waitForPort(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`server did not come up at ${url} within ${timeoutMs}ms`);
}

async function selectFixture(page, id) {
  await page.locator(".fixture-picker select").selectOption(id);
}

async function waitForAvatarLabel(page, substr, timeoutMs = 20000) {
  await page.waitForFunction(
    (needle) => {
      const el = document.querySelector(".avatar");
      return !!el && (el.getAttribute("aria-label") || "").includes(needle);
    },
    substr,
    { timeout: timeoutMs }
  );
}

async function send(page, text) {
  const input = page.locator(".composer-input");
  await input.fill(text);
  await page.locator(".composer-send").click();
}

async function sendAndWait(page, text, expect = "done") {
  await send(page, text);
  await waitForAvatarLabel(page, expect);
}

async function toDark(page) {
  await page.locator(".menu-trigger").click();
  await page.getByRole("menuitem", { name: /switch to dark/i }).click();
}

// Each scene drives a page to one interesting moment, then this shoots it
// at both themes (toggling in place — the conversation itself doesn't
// change) before moving on.
async function shootBothThemes(page, name) {
  await page.screenshot({ path: shot(`${name}-light`), fullPage: false });
  console.log("saved", shot(`${name}-light`));
  await toDark(page);
  await page.waitForTimeout(150); // let the theme transition settle
  await page.screenshot({ path: shot(`${name}-dark`), fullPage: false });
  console.log("saved", shot(`${name}-dark`));
}

async function runViewport(browser, width, height, label) {
  const viewport = { width, height };

  // ---- verdict: a verdict card in the transcript. ----
  {
    const page = await browser.newPage({ viewport });
    await page.goto(BASE_URL);
    await selectFixture(page, "mvp-journey");
    await sendAndWait(page, "hi, here's my resume");
    await sendAndWait(
      page,
      "sure — I'm targeting senior/staff PM roles at B2B SaaS companies, remote US. Goal: offer by end of November. I can do about 45 min a day."
    );
    await sendAndWait(page, "found this one: https://boards.greenhouse.io/acme/jobs/4102938");
    await shootBothThemes(page, `${label}-verdict`);
    await page.close();
  }

  // ---- mid-stream: screenshot WHILE a turn with tool calls is still
  // streaming — no card yet, tool rows appearing, no layout shift. ----
  {
    const page = await browser.newPage({ viewport });
    await page.goto(BASE_URL);
    await selectFixture(page, "mvp-journey");
    await sendAndWait(page, "hi, here's my resume");
    await sendAndWait(
      page,
      "sure — I'm targeting senior/staff PM roles at B2B SaaS companies, remote US. Goal: offer by end of November. I can do about 45 min a day."
    );
    await send(page, "found this one: https://boards.greenhouse.io/acme/jobs/4102938");
    await waitForAvatarLabel(page, "working").catch(() => {});
    await page.waitForTimeout(200);
    await shootBothThemes(page, `${label}-midstream`);
    await page.close();
  }

  // ---- the spend gate, pending. ----
  {
    const page = await browser.newPage({ viewport });
    await page.goto(BASE_URL);
    await selectFixture(page, "gate-moment");
    await sendAndWait(page, "can you evaluate the 6 roles I saved this week?", "needs-you");
    await shootBothThemes(page, `${label}-gate`);
    await page.close();
  }

  // ---- an error card (over_balance, the proxy's own pre-flight refusal). ----
  {
    const page = await browser.newPage({ viewport });
    await page.goto(BASE_URL);
    await selectFixture(page, "over-limit-error");
    await sendAndWait(page, "can you evaluate all 8 roles I saved this week?", "done").catch(() => {});
    await page.waitForTimeout(300);
    await shootBothThemes(page, `${label}-error`);
    await page.close();
  }

  // ---- the side panel open on a document (the tailored résumé, serif). ----
  {
    const page = await browser.newPage({ viewport });
    await page.goto(BASE_URL);
    await selectFixture(page, "mvp-journey");
    await sendAndWait(page, "hi, here's my resume");
    await sendAndWait(
      page,
      "sure — I'm targeting senior/staff PM roles at B2B SaaS companies, remote US. Goal: offer by end of November. I can do about 45 min a day."
    );
    await sendAndWait(page, "found this one: https://boards.greenhouse.io/acme/jobs/4102938");
    await sendAndWait(page, "yes please");
    const openDocument = () => page.locator(".card--document .card-open-link").first().click();
    await openDocument();
    await page.waitForTimeout(150);
    await page.screenshot({ path: shot(`${label}-document-light`), fullPage: false });
    console.log("saved", shot(`${label}-document-light`));
    // At 375px the side panel is a full-screen sheet (design-web-ui.md
    // § 1.2) — it covers the header's menu trigger, so the theme toggle
    // has to happen with the sheet closed, then the document reopened.
    const onPhone = width <= 480;
    if (onPhone) await page.locator(".side-panel-back").click();
    await toDark(page);
    if (onPhone) {
      await openDocument();
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: shot(`${label}-document-dark`), fullPage: false });
    console.log("saved", shot(`${label}-document-dark`));
    await page.close();
  }

  // ---- empty / first-run state. ----
  {
    const page = await browser.newPage({ viewport });
    await page.goto(BASE_URL);
    await selectFixture(page, "empty-first-run");
    await page.waitForSelector(".empty-state");
    await shootBothThemes(page, `${label}-empty`);
    await page.close();
  }
}

const PREVIEW_SELECTOR = {
  "sign-in": ".sign-in-screen",
  "not-a-member": ".not-a-member-screen",
  "update-notice": ".update-notice",
};

async function runSignInScreens(browser, width, height, label, kinds = ["sign-in", "not-a-member"]) {
  for (const kind of kinds) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(`${BASE_URL}?preview=${kind}&theme=${theme}`);
      await page.waitForSelector(PREVIEW_SELECTOR[kind]);
      await page.screenshot({ path: shot(`${label}-${kind}-${theme}`), fullPage: false });
      console.log("saved", shot(`${label}-${kind}-${theme}`));
      await page.close();
    }
  }
}

async function main() {
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT)], {
    cwd: WEB_ROOT,
    stdio: "pipe",
  });
  server.stdout.on("data", (d) => process.stdout.write(`[preview] ${d}`));
  server.stderr.on("data", (d) => process.stderr.write(`[preview] ${d}`));

  try {
    await waitForPort(BASE_URL);
    const browser = await chromium.launch();

    await runViewport(browser, 1440, 900, "1440");
    await runViewport(browser, 375, 812, "375");
    // The BEFORE pass (this codebase's own commit) predates the
    // ?preview= sign-in harness (src/dev-preview.tsx) — only the AFTER
    // pass sets INCLUDE_SIGNIN=1.
    if (process.env.INCLUDE_SIGNIN === "1") {
      const kinds = ["sign-in", "not-a-member", "update-notice"];
      await runSignInScreens(browser, 1440, 900, "1440", kinds);
      await runSignInScreens(browser, 375, 812, "375", kinds);
    }

    await browser.close();
  } finally {
    server.kill();
  }
  console.log("CAPTURE DONE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
