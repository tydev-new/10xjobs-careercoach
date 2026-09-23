// Playwright verification: plays mvp-journey and gate-moment end to end
// against a built preview server, asserts the cards render and the gate
// has no button and flips to approved only after a typed "yes", and saves
// screenshots. Reuses spikes/1-browser-loop's pattern (a static/preview
// server + chromium), per plan step 5a's exit criteria.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, "..");
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}/`;
// L5: an argument or SCREENSHOT_DIR env var, else a repo-relative default
// that's gitignored (apps/web/.gitignore) — never a session-scratchpad
// path baked into the script.
const SCREENSHOT_DIR = process.argv[2] ?? process.env.SCREENSHOT_DIR ?? join(WEB_ROOT, ".local/screenshots");

mkdirSync(SCREENSHOT_DIR, { recursive: true });

function shot(name) {
  return join(SCREENSHOT_DIR, `${name}.png`);
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

async function sendAndWait(page, text, { expect = "done" } = {}) {
  const input = page.locator(".composer-input");
  await input.fill(text);
  await page.locator(".composer-send").click();
  await waitForAvatarLabel(page, expect);
}

let failures = 0;
function assertTrue(cond, message) {
  if (!cond) {
    failures++;
    console.log("FAIL", message);
  } else {
    console.log("PASS", message);
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

    // ---------------------------------------------------------------
    // mvp-journey, desktop light — mid-journey (verdict card + panel).
    // ---------------------------------------------------------------
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      await page.goto(BASE_URL);
      await selectFixture(page, "mvp-journey");

      await sendAndWait(page, "hi, here's my resume");
      await sendAndWait(
        page,
        "sure — I'm targeting senior/staff PM roles at B2B SaaS companies, remote US. Goal: offer by end of November. I can do about 45 min a day."
      );
      await sendAndWait(page, "found this one: https://boards.greenhouse.io/acme/jobs/4102938");

      assertTrue(await page.locator("text=Strong Fit").count() > 0, "verdict card shows Strong Fit");
      assertTrue(
        await page.locator(".side-panel-path", { hasText: "jd-analysis" }).count() > 0,
        "side panel opened the verdict's ref (jd-analysis/...)"
      );
      await page.screenshot({ path: shot("desktop-light"), fullPage: false });
      console.log("saved", shot("desktop-light"));

      // Continue to the end of the journey for the plan card, then switch
      // to dark for that screenshot.
      await sendAndWait(page, "yes please");
      await sendAndWait(page, "great, what's next?");
      assertTrue(await page.locator(".card--plan").count() > 0, "plan card rendered at journey's end");
      assertTrue(await page.locator(".card--document").count() > 0, "document card rendered");
      assertTrue(await page.locator(".card--checker").count() >= 2, "two checker cards rendered (resume + letter)");

      // M1: "Print / Save as PDF" — sandboxed with no allow-scripts, and an
      // injected <script> inside the html genuinely does not run.
      await page.locator(".card-open-link", { hasText: "Print / Save as PDF" }).click();
      await page.waitForTimeout(300);
      const sandbox = await page.locator(".side-panel-iframe").getAttribute("sandbox");
      const tokens = (sandbox ?? "").split(/\s+/).filter(Boolean);
      assertTrue(
        !tokens.includes("allow-scripts"),
        `Print/Save-as-PDF iframe sandbox has no allow-scripts (sandbox="${sandbox}")`
      );
      const scriptBlocked = await page.evaluate(() => {
        const iframe = document.querySelector(".side-panel-iframe");
        const win = iframe?.contentWindow;
        if (!win) return "no iframe";
        win.__evil = undefined;
        const doc = iframe.contentDocument;
        const original = doc.body.innerHTML;
        const script = doc.createElement("script");
        script.textContent = "window.__evil = true;";
        doc.body.appendChild(script);
        const ran = win.__evil === true;
        doc.body.innerHTML = original;
        return ran ? "script ran" : "blocked";
      });
      assertTrue(scriptBlocked === "blocked", `an injected <script> in the printed html stays blocked (${scriptBlocked})`);

      await page.locator(".menu-trigger").click();
      await page.getByRole("menuitem", { name: /switch to dark/i }).click();
      await page.screenshot({ path: shot("desktop-dark"), fullPage: false });
      console.log("saved", shot("desktop-dark"));

      await page.close();
    }

    // ---------------------------------------------------------------
    // mvp-journey, phone (375px) — mid-journey, side panel as a sheet.
    // ---------------------------------------------------------------
    {
      const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
      await page.goto(BASE_URL);
      await selectFixture(page, "mvp-journey");

      await sendAndWait(page, "hi, here's my resume");
      await sendAndWait(
        page,
        "sure — I'm targeting senior/staff PM roles at B2B SaaS companies, remote US. Goal: offer by end of November. I can do about 45 min a day."
      );
      await sendAndWait(page, "found this one: https://boards.greenhouse.io/acme/jobs/4102938");

      assertTrue(await page.locator("text=Strong Fit").count() > 0, "phone: verdict card shows Strong Fit");
      const noHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      );
      assertTrue(noHorizontalScroll, "phone: no horizontal scroll at 375px");

      // The side panel is a full-screen sheet on phone, opened from a
      // card's "Open in panel" affordance (design-web-ui.md § 1.2).
      await page.locator(".card--verdict .card-open-link").first().click();
      assertTrue(
        await page.locator(".side-panel--open").count() > 0,
        "phone: the side panel opens as a full-screen sheet"
      );
      assertTrue(
        await page.locator(".side-panel-back").isVisible(),
        "phone: the sheet has a back arrow to close it"
      );

      await page.screenshot({ path: shot("phone"), fullPage: false });
      console.log("saved", shot("phone"));
      await page.close();
    }

    // ---------------------------------------------------------------
    // gate-moment, desktop — no approve button, ever; approved only
    // after an exact typed "yes".
    // ---------------------------------------------------------------
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      await page.goto(BASE_URL);
      await selectFixture(page, "gate-moment");

      await sendAndWait(page, "can you evaluate the 6 roles I saved this week?", {
        expect: "needs-you",
      });
      assertTrue(await page.locator(".card--gate").count() > 0, "gate card rendered");
      assertTrue(
        await page.locator(".card--gate .badge--gate-pending").count() > 0,
        "gate status is pending"
      );

      const approveButtons = await page.getByRole("button", { name: /approve/i }).count();
      assertTrue(approveButtons === 0, "no approve button exists anywhere on the page");

      await page.screenshot({ path: shot("gate-moment-pending"), fullPage: false });
      console.log("saved", shot("gate-moment-pending"));

      // A non-"yes" reply leaves it pending.
      await sendAndWait(page, "wait, what if I only did 5 of them instead of 6?", {
        expect: "needs-you",
      });
      assertTrue(
        await page.locator(".card--gate .badge--gate-pending").count() > 0,
        "gate still pending after a non-yes reply"
      );

      // The exact typed "yes" approves it.
      await sendAndWait(page, "yes", { expect: "done" });
      assertTrue(
        await page.locator(".card--gate .badge--gate-approved").count() > 0,
        "gate flips to approved only after typed yes"
      );

      await page.screenshot({ path: shot("gate-moment-approved"), fullPage: false });
      console.log("saved", shot("gate-moment-approved"));
      await page.close();
    }

    await browser.close();
  } finally {
    server.kill();
  }

  console.log(failures === 0 ? "VERIFY PASS" : `VERIFY FAIL (${failures} assertion(s) failed)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
