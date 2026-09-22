// Loads the built spike-2 page in real headless Chromium and asserts the
// just-bash dispatch to the JS port completed successfully.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const DIST = new URL("./dist/", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer(async (req, res) => {
  try {
    let path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const body = await readFile(join(DIST, path));
    res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(4174, r));
console.log("static server up on :4174 serving", DIST);

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto("http://localhost:4174/");
await page.waitForSelector('#done[data-done="true"]', { timeout: 15000 });
const done = await page.$eval("#done", (el) => ({ text: el.textContent, pass: el.getAttribute("data-pass") }));
const result = await page.$eval("#result", (el) => el.textContent);

console.log("DOM #done:", done);
console.log("DOM #result:", result);
if (consoleErrors.length) console.log("console errors:", consoleErrors);

await browser.close();
server.close();

const ok = done.pass === "true";
console.log(ok ? "VERIFY PASS" : "VERIFY FAIL");
process.exit(ok ? 0 : 1);
