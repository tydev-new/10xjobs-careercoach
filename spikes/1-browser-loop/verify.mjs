// Loads the built page in a real headless browser (Playwright/Chromium)
// and asserts the tool loop, the streaming loop, and the intercepted
// request all actually completed — by reading them back out of the DOM
// (rule 11: verify the file/page, not narration).
//
// KEY NOT BAKED (spike-1 rework item 3): the intercept-test key is a
// freshly-generated random string, injected into the page via
// page.addInitScript AFTER dist/ was already built — so it exists only in
// this Node process and in the live page, never in the bundled JS. After
// the run, this script greps dist/ to prove that string (and the env var
// names that would leak a real key) are not present in the build output.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import crypto from "node:crypto";

const DIST = new URL("./dist/", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const server = createServer(async (req, res) => {
  try {
    let path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const full = join(DIST, path);
    const body = await readFile(full);
    res.writeHead(200, { "Content-Type": MIME[extname(full)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

await new Promise((resolve) => server.listen(4173, resolve));
console.log("static server up on :4173 serving", DIST);

// A key that exists ONLY here, generated after the build, never written to
// any file — this is what "runtime, not baked" means in practice.
const INTERCEPT_KEY = `sk-or-v1-RUNTIME-${crypto.randomBytes(16).toString("hex")}`;
const REAL_KEY = process.env.OPENROUTER_API_KEY || null;
// Diagnostic-only: compare with/without the ZDR routing restriction when
// isolating why a live cache read might not show up. Spends 2 extra live
// calls — only ever set deliberately (SPIKE1_NO_ZDR=1), never by default.
const NO_ZDR = process.env.SPIKE1_NO_ZDR === "1";

// Defense in depth: this script never intentionally logs the key, but every
// piece of text printed below is masked anyway before it reaches the
// terminal, in case a usage/metadata object ever echoed it back.
function maskString(s) {
  return s.replace(/sk-or-[A-Za-z0-9_-]+/g, "sk-or-<masked>");
}
function logMasked(...parts) {
  const rendered = parts.map((p) => maskString(typeof p === "string" ? p : JSON.stringify(p)));
  console.log(rendered.join(" "));
}

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

// Runs before ANY page script, including the bundled main.ts — this is
// the "value set in the page after load [of the build]" the rework asked
// for: the build already exists on disk with no key in it; this is what
// supplies one at run time.
await page.addInitScript(
  ([interceptKey, realKey, noZdr]) => {
    window.__OPENROUTER_RUNTIME_KEY__ = interceptKey;
    if (realKey) window.__OPENROUTER_REAL_KEY__ = realKey;
    if (noZdr) window.__SPIKE1_NO_ZDR__ = true;
  },
  [INTERCEPT_KEY, REAL_KEY, NO_ZDR]
);

await page.goto("http://localhost:4173/");
await page.waitForSelector('#done[data-done="true"]', { timeout: 15000 });

const done = await page.$eval("#done", (el) => ({
  text: el.textContent,
  mockPass: el.getAttribute("data-mock-pass"),
  streamPass: el.getAttribute("data-stream-pass"),
  providerPass: el.getAttribute("data-provider-pass"),
  requestPass: el.getAttribute("data-request-pass"),
  uiStreamPass: el.getAttribute("data-ui-stream-pass"),
  realStatus: el.getAttribute("data-real-status"),
  realCacheReadTurn2: el.getAttribute("data-real-cache-read-turn2"),
}));
const resultMock = await page.$eval("#result-mock", (el) => el.textContent);
const resultStream = await page.$eval("#result-stream", (el) => el.textContent);
const resultProvider = await page.$eval("#result-provider", (el) => el.textContent);
const resultRequest = await page.$eval("#result-request", (el) => el.textContent);
const resultUiStream = await page.$eval("#result-ui-stream", (el) => el.textContent);
const resultPromptSize = await page.$eval("#result-prompt-size", (el) => el.textContent);
const resultReal = await page.$eval("#result-real", (el) => el.textContent);

logMasked("DOM #done:", done);
logMasked("DOM #result-mock:", resultMock);
logMasked("DOM #result-stream:", resultStream);
logMasked("DOM #result-provider:", resultProvider);
logMasked("DOM #result-request:", resultRequest);
logMasked("DOM #result-ui-stream:", resultUiStream);
logMasked("DOM #result-prompt-size:", resultPromptSize);
logMasked("DOM #result-real:", resultReal);
if (consoleErrors.length) logMasked("console errors:", consoleErrors);

await browser.close();
server.close();

// --- KEY NOT BAKED check: grep dist/ for anything key-shaped ---------
async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}
const distFiles = await walk(DIST);
// The library itself legitimately references the env var NAME
// "OPENROUTER_API_KEY" as a Node-side fallback-lookup label inside
// @openrouter/ai-sdk-provider's loadApiKey() — that string alone is not a
// leak (no VALUE is attached, and the browser has no process.env to read
// it from). What must NEVER appear is: this run's actual secret VALUES,
// the Vite build-time env var this file used to read
// (VITE_OPENROUTER_API_KEY), or any `import.meta.env` reference (the
// mechanism that would have baked a value in at build time).
const valueNeedles = [INTERCEPT_KEY, ...(REAL_KEY ? [REAL_KEY] : [])];
const buildTimeNeedles = ["VITE_OPENROUTER_API_KEY", "import.meta.env"];
const leaks = [];
for (const f of distFiles) {
  const text = await readFile(f, "utf-8").catch(() => "");
  for (const needle of [...valueNeedles, ...buildTimeNeedles]) {
    if (text.includes(needle)) leaks.push({ file: f, needle: "<redacted — see needle KIND, never printed raw>", kind: needle === REAL_KEY ? "real-key-value" : needle === INTERCEPT_KEY ? "intercept-key-value" : needle });
  }
}
logMasked(
  "KEY NOT BAKED grep:",
  leaks.length === 0
    ? "clean — no secret value and no build-time env mechanism found in dist/ (the library's own OPENROUTER_API_KEY env-var-NAME fallback string is present, which is expected and holds no value)"
    : leaks
);

const ok =
  done.mockPass === "true" &&
  done.streamPass === "true" &&
  done.providerPass === "true" &&
  done.requestPass === "true" &&
  done.uiStreamPass === "true" &&
  leaks.length === 0;
logMasked(ok ? "VERIFY PASS" : "VERIFY FAIL");
logMasked(
  "Live cache criterion (informational — not part of VERIFY PASS/FAIL, since it legitimately BLOCKs without a key):",
  `status=${done.realStatus} cacheReadTurn2=${done.realCacheReadTurn2}`
);
process.exit(ok ? 0 : 1);
