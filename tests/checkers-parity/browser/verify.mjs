// Tester-owned browser proof: builds this page with Vite, runs all seven
// ports through the python3 dispatch in headless Chromium, runs the SAME
// commands in Node, and diffs the two (timestamps masked: both use a real clock).
//   node tests/checkers-parity/browser/verify.mjs <outDir>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const PKG = join(HERE, "..", "..", "..", "packages", "checkers");
const OUT = process.argv[2];
execFileSync("node", [join(PKG, "node_modules", "vite", "bin", "vite.js"), "build", HERE, "--outDir", OUT, "--emptyOutDir", "--config", join(HERE, "vite.config.mjs")], { stdio: "inherit" });
const { chromium } = await import(pathToFileURL(join(PKG, "node_modules", "playwright", "index.mjs")).href);
const { Bash } = await import(pathToFileURL(join(PKG, "node_modules", "just-bash", "dist", "bundle", "index.js")).href);
const { python3Command } = await import(pathToFileURL(join(PKG, "src", "just-bash-command.mjs")).href);
const { runAll } = await import(pathToFileURL(join(HERE, "cases.mjs")).href);
const server = createServer(async (req, res) => {
  try { const p = req.url === "/" ? "/index.html" : req.url.split("?")[0]; const b = await readFile(join(OUT, p));
    res.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript" }[extname(p)] || "application/octet-stream" }); res.end(b);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4191, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await page.goto("http://localhost:4191/");
await page.waitForSelector('#done:not([data-done="no"])', { timeout: 30000 });
const state = await page.$eval("#done", (el) => el.dataset.done);
const text = await page.$eval("#done", (el) => el.textContent);
const hasNodeGlobals = await page.evaluate(() => typeof process !== "undefined" || typeof require !== "undefined");
await browser.close(); server.close();
if (state !== "ok") { console.log("BROWSER ERROR", text, errs); process.exit(1); }
const inBrowser = JSON.parse(text);
const inNode = await runAll(Bash, python3Command);
const MASK = (s) => s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00/g, "<TS>").replace(/updated \d{4}-\d{2}-\d{2}/g, "updated <D>");
let bad = 0;
inBrowser.forEach((b, i) => {
  const n = inNode[i];
  const same = b.exitCode === n.exitCode && MASK(b.stdout) === MASK(n.stdout) && b.stderr === n.stderr;
  if (!same) bad++;
  console.log(`[${same ? "SAME" : "DIFF"}] exit=${b.exitCode} ${b.cmd.slice(0, 90)}`);
  if (!same) console.log({ browser: b, node: n });
});
console.log(`page errors: ${errs.length ? errs.join(" | ") : "none"}; process/require defined in page: ${hasNodeGlobals}`);
console.log(`${inBrowser.length - bad}/${inBrowser.length} browser == node`);
console.log(JSON.stringify(inBrowser.map((r) => ({ cmd: r.cmd.split(" ").slice(0, 2).join(" "), exit: r.exitCode, out: r.stdout.slice(0, 160), err: r.stderr })), null, 1));
process.exit(bad || errs.length ? 1 : 0);
