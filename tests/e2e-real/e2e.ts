// Tester-owned e2e for plan step 5b (docs/plan-portable-skills-and-web-agent.md
// § Step 5b, § Goal post), derived from docs/design-web-agent.md (r4 + § 8
// amendments), docs/design-web-ui.md, and the applied migration — not from
// the coder's code.
//
// Drives the PRODUCTION build of apps/web (`npm run build`, the default:
// no mock controls) in real browsers (Playwright), against local stand-ins
// only — NO live Supabase, NO live OpenRouter, no deploy:
//   * stand-in.ts          one Supabase origin: GoTrue (HS256 JWTs, refresh),
//                          PostgREST + Storage over PGlite running the REAL
//                          applied migration (reuses tests/store/pglite-backend.ts),
//                          and a /functions/v1 gateway to ...
//   * functions-host.ts    the REAL supabase/functions/*/index.ts under deno
//                          (--allow-net=127.0.0.1: nothing can leave the box)
//   * stub-openrouter.ts   where openrouter.ai would be: a scripted "model"
//                          answering OpenRouter-shaped SSE
//   * the ATS fetch        Playwright routes boards-api.greenhouse.io to a
//                          stub; every other non-loopback request is aborted
//                          and recorded (asserted empty)
// The checkers really run in the browser (packages/checkers via just-bash);
// their stdout is compared byte for byte with the Python scripts run on the
// same workspace files.
//
// Run from the repo root (needs node >= 22, deno, python3, apps/web and
// tests/store node_modules, Playwright browsers):
//   node tests/e2e-real/e2e.ts            # everything, in chromium, firefox, webkit (~13 min)
//   E2E_BROWSERS=chromium E2E_ONLY=journey,gate node tests/e2e-real/e2e.ts
//   E2E_STRIP_INLINE_FETCH=1   serve the build without index.html's inline
//                              window.fetch bind (is it still needed?)
//   E2E_FETCH_SHIM=1           DIAGNOSTIC only (see newPage)
//   E2E_KEEP=1 keeps the temp dir (builds, failure screenshots);
//   E2E_CONSOLE=1 echoes browser console errors; E2E_STACKS=1 page-error stacks.
// Per-browser sections: journey import gate balance ceiling member delete
// refresh password phone cors setup uploads env; then once: preview. Firefox/WebKit
// need `npx playwright install firefox webkit` in apps/web.
// Exit code 0 = all PASS; one PASS/FAIL line per assertion.
// Also here: upload-errors.test.ts (node --test), the upload messages over PGlite.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-ignore - resolved from apps/web's own install, like tests/web/e2e.mjs
import { chromium, firefox, webkit } from "../../apps/web/node_modules/playwright/index.mjs";
// @ts-ignore
import { unzipSync } from "../../apps/web/node_modules/fflate/esm/index.mjs";
import { ANON_KEY, JWT_SECRET, SERVICE_KEY, startStandIn, verifyJwt, type StandIn } from "./stand-in.ts";
import { startStubOpenRouter, textOfContent, type Scenario, type StubOpenRouter } from "./stub-openrouter.ts";
import { CUT_OFF_MESSAGE, NEXT_TURN_NOTE as CUT_OFF_NOTE } from "../agent/_spec9.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const WEB = path.join(REPO, "apps/web");
const ONLY = (process.env.E2E_ONLY ?? "").split(",").filter(Boolean);
const want = (s: string) => ONLY.length === 0 || ONLY.includes(s);
const SHIM = process.env.E2E_FETCH_SHIM === "1";
// Strips index.html's inline `window.fetch = window.fetch.bind(window)` to
// answer "is the inline script still needed once every capture site uses
// boundFetch()?" (lead ruling 3, fix round 1).
const STRIP_INLINE_FETCH = process.env.E2E_STRIP_INLINE_FETCH === "1";
const BROWSER_LIST = (process.env.E2E_BROWSERS ?? "chromium,firefox,webkit").split(",").filter(Boolean);
let BROWSER = "chromium";
let TAG = "";
let SECTION = "";
const em = (local: string) => `${local}.${BROWSER}@example.com`;

// A canary standing in for the real OpenRouter key: it lives ONLY in the
// deno host's env. If it ever shows up in the bundle, a browser-visible
// response, or a request the browser makes, the key leaked.
const OPENROUTER_CANARY = "sk-or-v1-E2E-CANARY-0a1b2c3d4e5f60718293a4b5c6d7e8f9";
const PASSWORD = "correct horse battery";
const NON_MEMBER = "You're signed in, but this beta is invite-only. Ask the person who invited you to add you.";

// ------------------------------------------------------------------ results
const results: { ok: boolean; name: string; detail: string }[] = [];
function rec(ok: boolean, name0: string, detail = "") {
  const name = TAG ? `[${TAG}] ${name0}` : name0;
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
function eq(actual: unknown, expected: unknown, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  rec(a === e, name, a === e ? "" : `got ${a.slice(0, 400)} want ${e.slice(0, 400)}`);
}

// --------------------------------------------------------------- fixtures
const FX = JSON.parse(readFileSync(path.join(WEB, "fixtures/mvp-journey.json"), "utf8"));
const F: Record<string, string> = FX.files;
const JD_URL = "https://boards.greenhouse.io/acme/jobs/4102938";
const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n% invented persona: Jordan Alvarez (example.com)\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
const TIER0 = readFileSync(path.join(REPO, "skills/profile/templates/workspace-CLAUDE.md"), "utf8");
const cmdOf = (needle: string): string => {
  for (const m of FX.messages) for (const p of m.parts) if (p.type === "tool-bash" && p.input.command.includes(needle)) return p.input.command;
  throw new Error("no fixture command " + needle);
};
const CMD_RECORD = cmdOf("record_verdict.py");
const CMD_CHECK = cmdOf("check_materials.py");
const CMD_RENDER = cmdOf("render_resume.py");
const CMD_CLOSEOUT = cmdOf("check_closeout.py");
const CMD_CHECK_FILES = "python3 profile/scripts/check_files.py --workspace .";
const INITIAL_PLAN = "Goal: an offer by 2026-11-30\nBudget: 45 min/day\n\n## Board\n\nWaiting on you\n\nTo do\n\nDoing\n\nDone";

function scenarios(extra: Scenario[] = []): Scenario[] {
  return [
    ...extra,
    {
      name: "upload+intake",
      match: /here's my resume/,
      steps: [
        { tools: [{ name: "read_file", args: { path: "documents/jordan-alvarez-resume.pdf" } }] },
        { tools: [{ name: "write_file", args: { path: "base-resume.md", content: F["base-resume.md"] } }] },
        {
          tools: [
            { name: "write_file", args: { path: "criteria.md", content: F["criteria.md"] } },
            { name: "write_file", args: { path: "plan.md", content: INITIAL_PLAN } },
          ],
        },
        { tools: [{ name: "bash", args: { command: CMD_CHECK_FILES } }] },
        { text: "Saved your base résumé, targets, and plan. Paste a job posting whenever you've got one." },
      ],
    },
    {
      name: "url->verdict",
      match: /^found this one: /,
      steps: [
        { tools: [{ name: "fetch_job", args: { url: JD_URL, saveTo: "jd-inbox/acme-staff-pm.md" } }] },
        { tools: [{ name: "web_search", args: { query: "Acme Series C funding 2026", maxResults: 4 } }] },
        {
          tools: [
            { name: "write_file", args: { path: "jd-analysis/acme-staff-pm.md", content: F["jd-analysis/acme-staff-pm.md"] } },
            { name: "write_file", args: { path: "company/acme.md", content: F["company/acme.md"] } },
          ],
        },
        { tools: [{ name: "bash", args: { command: CMD_RECORD } }] },
        { text: "Strong Fit, recorded in jobs.md. Want me to tailor a resume and cover letter for this one?" },
      ],
    },
    {
      name: "tailor",
      match: /^yes please$/,
      steps: [
        {
          tools: [
            { name: "read_file", args: { path: "base-resume.md" } },
            { name: "read_file", args: { path: "jd-analysis/acme-staff-pm.md" } },
          ],
        },
        {
          tools: [
            { name: "write_file", args: { path: "applications/acme-staff-pm-resume.md", content: F["applications/acme-staff-pm-resume.md"] } },
            { name: "write_file", args: { path: "applications/acme-staff-pm-cover-letter.md", content: F["applications/acme-staff-pm-cover-letter.md"] } },
          ],
        },
        { tools: [{ name: "bash", args: { command: CMD_CHECK } }] },
        { tools: [{ name: "bash", args: { command: CMD_RENDER } }] },
        { text: "Both files ran through check_materials; the résumé is rendered. The language check has not run." },
      ],
    },
    {
      name: "plan",
      match: /^great, what's next\?$/,
      steps: [
        { tools: [{ name: "read_file", args: { path: "plan.md" } }] },
        { tools: [{ name: "write_file", args: { path: "plan.md", content: F["plan.md"] } }] },
        { tools: [{ name: "bash", args: { command: CMD_CLOSEOUT } }] },
        { text: "That's what's queued in plan.md." },
      ],
    },
    {
      name: "big-run",
      match: /^find me roles at (five|ten) more companies$/,
      steps: [
        {
          tools: [
            {
              name: "estimate_cost",
              args: { action: "Search more companies", steps: 500, webSearches: 5, items: ["Five B2B SaaS companies like Acme", "Staff PM roles only"] },
            },
          ],
        },
        { text: "(stub) SHOULD NOT BE REACHED: the gate ends the turn" },
      ],
    },
    { name: "not-yes", match: /^sure, go ahead$/, steps: [{ text: "I'll wait for your yes before spending." }] },
    { name: "yes", match: /^yes$/, steps: [{ text: "Starting the search now." }] },
    { name: "hello", match: /^hello/, steps: [{ text: "Hi — I'm here." }] },
  ];
}

// ------------------------------------------------------------- utilities
function sha256(s: string | Buffer) {
  return createHash("sha256").update(s).digest("hex");
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 20000, step = 200): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) return undefined;
    await sleep(step);
  }
}

function staticServer(): Promise<{ port: number; setRoot(dir: string): void; close(): Promise<void> }> {
  let root = "";
  const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".wasm": "application/wasm" };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    let p = path.join(root, decodeURIComponent(u.pathname));
    if (!p.startsWith(root) || !existsSync(p) || statSync(p).isDirectory()) p = path.join(root, "index.html");
    res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((r) =>
    srv.listen(0, "127.0.0.1", () =>
      r({ port: (srv.address() as any).port, setRoot: (d) => (root = d), close: () => new Promise<void>((c) => srv.close(() => c())) }),
    ),
  );
}

function build(outDir: string, env: Record<string, string | undefined>): { ok: boolean; out: string; ms: number } {
  if (existsSync(path.join(outDir, "index.html"))) return { ok: true, out: "(cached)", ms: 0 };
  const t0 = Date.now();
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("VITE_") && v !== undefined) cleanEnv[k] = v;
  for (const [k, v] of Object.entries(env)) if (v !== undefined) cleanEnv[k] = v;
  const r = spawnSync("npm", ["run", "build", "--", "--outDir", outDir, "--emptyOutDir"], { cwd: WEB, env: cleanEnv, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? ""), ms: Date.now() - t0 };
}

function bundleText(dir: string): string {
  let s = "";
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|html|css|map|json)$/.test(f)) s += readFileSync(p, "utf8") + "\n";
    }
  };
  walk(dir);
  return s;
}

// ------------------------------------------------------------------ main
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "ten-e2e-real-"));
const standIn: StandIn = await startStandIn();
const stub: StubOpenRouter = await startStubOpenRouter();
stub.setScenarios(scenarios());
const web = await staticServer();
const ORIGIN = `http://127.0.0.1:${web.port}`;

const deno: ChildProcess = spawn(
  "deno",
  [
    "run",
    "--allow-net=127.0.0.1",
    "--allow-read",
    path.join(HERE, "functions-host.ts"),
    JSON.stringify({ supabaseUrl: standIn.url, anonKey: ANON_KEY, serviceKey: SERVICE_KEY, openrouterKey: OPENROUTER_CANARY, appOrigin: ORIGIN, stubOpenRouterUrl: stub.url }),
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const denoLog: string[] = [];
const denoPort: number = await new Promise((resolve, reject) => {
  const onData = (b: Buffer) => {
    const s = b.toString();
    denoLog.push(s);
    const m = /LISTENING (\d+)/.exec(s);
    if (m) resolve(Number(m[1]));
  };
  deno.stdout!.on("data", onData);
  deno.stderr!.on("data", (b: Buffer) => denoLog.push(b.toString()));
  deno.on("exit", (c) => reject(new Error("deno exited " + c + "\n" + denoLog.join(""))));
  setTimeout(() => reject(new Error("deno did not start\n" + denoLog.join(""))), 60000);
});
standIn.setFunctionsTarget(`http://127.0.0.1:${denoPort}`);

const prodDir = path.join(tmpRoot, "dist-prod");
const prodEnv = {
  VITE_SUPABASE_URL: standIn.url,
  VITE_SUPABASE_ANON_KEY: ANON_KEY,
  VITE_SITE_URL: ORIGIN,
  // decoys: non-VITE_ secrets present in the BUILD environment must never be inlined
  TEN_OPENROUTER_API_KEY: OPENROUTER_CANARY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
};
const b1 = build(prodDir, prodEnv);
rec(b1.ok, "production build (npm run build) with local stand-in env", b1.ok ? `${b1.ms} ms` : b1.out.slice(-2000));
if (!b1.ok) process.exit(1);
let currentRoot = prodDir;
let servedProdDir = prodDir;
if (STRIP_INLINE_FETCH) {
  // A copy of the production build whose index.html lacks the inline
  // fetch-binding script, served from the same local origin (a
  // route.fulfill()ed document would trip Chromium's loopback-access
  // checks and confound the result).
  servedProdDir = prodDir + "-stripped";
  cpSync(prodDir, servedProdDir, { recursive: true });
  const html = readFileSync(path.join(servedProdDir, "index.html"), "utf8");
  const stripped = html.replace(/<script>\s*if \(typeof window[\s\S]*?<\/script>/, "<!-- inline fetch bind stripped by the e2e -->");
  rec(stripped !== html, "E2E_STRIP_INLINE_FETCH: the inline window.fetch bind was found and stripped from the served index.html");
  writeFileSync(path.join(servedProdDir, "index.html"), stripped);
}
const setRoot = (d: string) => {
  currentRoot = d;
  web.setRoot(d);
};
setRoot(servedProdDir);

// ---- bundle: no secret, no mock controls (step 5b exit 3; Goal post exit 2)
{
  const txt = bundleText(prodDir);
  rec(!txt.includes(OPENROUTER_CANARY), "bundle: the OpenRouter key (canary, present in the build env) is not in the bundle");
  rec(!txt.includes(SERVICE_KEY), "bundle: the service-role key (present in the build env) is not in the bundle");
  rec(!txt.includes(JWT_SECRET), "bundle: no JWT secret");
  rec(!/sk-or-v1-|service_role/.test(txt), "bundle: no sk-or- key shape and no 'service_role' string");
  rec(txt.includes(ANON_KEY) && txt.includes(standIn.url), "bundle: carries only the Supabase URL and anon key (both present, as expected)");
  rec(!txt.includes("Preview: fixture") && !/"Autoplay"|>Autoplay</.test(txt), "bundle: production build has no fixture picker / Autoplay");
  const viteVars = [...new Set(txt.match(/VITE_[A-Z_]+/g) ?? [])];
  rec(true, "bundle: VITE_ names referenced (info)", viteVars.join(", "));
}

// ------------------------------------------------------------ browsers
const browsers: Record<string, any> = { chromium: await chromium.launch() };
const browserTypes: Record<string, any> = { chromium, firefox, webkit };
// Browsers for the no-interception CORS section; Chromium's host resolver
// maps every name but 127.0.0.1 to NOTFOUND so nothing can leave the box.
const noRouteBrowsers: Record<string, any> = {};
async function noRouteBrowser(b: string) {
  noRouteBrowsers[b] ??= await browserTypes[b].launch(b === "chromium" ? { args: ["--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"] } : {});
  return noRouteBrowsers[b];
}
const external: string[] = [];
const atsHits: string[] = [];
const pageErrors: string[] = [];

async function newPage(opts: { browser?: string; viewport?: { width: number; height: number }; noRoute?: boolean; colorScheme?: "light" | "dark"; noGoto?: boolean } = {}) {
  const bname = opts.browser ?? BROWSER;
  // noRoute: no Playwright request interception at all. Chromium answers
  // CORS preflights itself while interception is on (none reach the
  // server), so a real preflight check needs a context without routes.
  const ctx = await (opts.noRoute ? noRouteBrowsers[bname] : browsers[bname]).newContext({ viewport: opts.viewport ?? { width: 1280, height: 860 }, acceptDownloads: true, ...(opts.colorScheme ? { colorScheme: opts.colorScheme } : {}) });
  if (!opts.noRoute) await ctx.route("**/*", async (route: any) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1" || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    if (u.hostname === "boards-api.greenhouse.io") {
      atsHits.push(u.href);
      const jd = F["jd-inbox/acme-staff-pm.md"];
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
        body: JSON.stringify({ title: "Staff PM", company_name: "Acme", location: { name: "Remote (US)" }, content: jd.split("\n\n").map((p) => `<p>${p}</p>`).join("") }),
      });
    }
    external.push(u.href);
    return route.abort();
  });
  if (SHIM) {
    // DIAGNOSTIC ONLY (E2E_FETCH_SHIM=1): works around finding B1 — the store
    // and gate call `o.fetchImpl(...)` with o.fetchImpl = window.fetch, which
    // browsers refuse ("Illegal invocation"). The shim makes window.fetch
    // ignore its receiver so the REST of the app can be exercised. A run
    // with the shim is never the verdict for exit 1.
    await ctx.addInitScript(() => {
      const f = window.fetch;
      (window as any).fetch = function (input: any, init?: any) {
        return f.call(window, input, init);
      };
    });
  }
  const page = await ctx.newPage();
  if (process.env.E2E_CONSOLE) page.on("console", (m: any) => { if (m.type() === "error" || m.type() === "warning") console.log(`  [console ${bname}] ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e: Error) => pageErrors.push(`${bname} [${SECTION}]: ${e.message}${process.env.E2E_STACKS ? "\n      " + String(e.stack ?? "").split("\n").slice(0, 8).join("\n      ") : ""}`));
  await page.addInitScript(() => {
    // The panel iframe is same-origin (allow-same-origin), so the parent can
    // replace its print(): headless Firefox/WebKit otherwise open a modal
    // print dialog that freezes the page. Counts calls so the e2e can assert
    // "Print / Save as PDF" really invoked print() on the rendered résumé.
    (window as any).__printed = [];
    document.addEventListener(
      "load",
      (ev) => {
        const t = ev.target as HTMLIFrameElement;
        if (t && t.tagName === "IFRAME" && t.classList.contains("side-panel-iframe")) {
          try {
            (t.contentWindow as any).print = () => (window as any).__printed.push(t.srcdoc.slice(0, 2000));
          } catch {
            /* cross-origin: leave it */
          }
        }
      },
      true,
    );
    (window as any).__states = new Set();
    setInterval(() => {
      const a = document.querySelector(".avatar");
      if (a) for (const c of a.classList) if (c.startsWith("avatar--")) (window as any).__states.add(c.slice(8));
    }, 10);
  });
  if (!opts.noGoto) await page.goto(ORIGIN + "/");
  return { ctx, page };
}

async function signIn(page: any, email: string) {
  await page.locator(".sign-in-mode-toggle button", { hasText: "Email + password" }).click();
  await page.locator(".sign-in-form input[type=email]").fill(email);
  await page.locator(".sign-in-form input[type=password]").fill(PASSWORD);
  await page.locator(".sign-in-form button[type=submit]").click();
}
async function waitSettled(page: any, ms = 90000) {
  await page.waitForFunction(
    () => {
      const a = document.querySelector(".avatar");
      const i = document.querySelector(".composer-input") as HTMLTextAreaElement | null;
      return a && !/thinking|working/.test(a.className) && i && !i.disabled;
    },
    null,
    { timeout: ms },
  );
  await page.waitForTimeout(250);
}
async function say(page: any, text: string) {
  await page.locator(".composer-input").fill(text);
  await page.locator(".composer-input").press("Enter");
  await page.waitForTimeout(150);
  await waitSettled(page);
}
const lastAssistant = (page: any) => page.locator(".bubble--assistant").last();
async function chip(page: any): Promise<string> {
  return (await page.locator(".balance-chip").textContent())?.trim() ?? "";
}
async function focusRefresh(page: any) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(400);
}
const floorCents = (n: number) => (n <= 0 ? "0.00" : (Math.floor(Math.round(n * 1e6) / 1e4) / 100).toFixed(2));

const db = {
  files: (uid: string) => standIn.sql<{ path: string; content: string }>("select path, content from public.ten_ws_files where user_id = $1 order by path", [uid]),
  objects: (uid: string) => standIn.sql<{ name: string }>("select name from storage.objects where bucket_id = 'ten-workspaces' and name like $1 order by name", [`users/${uid}/%`]),
  ledger: (uid: string) => standIn.sql<{ kind: string; usd: string; request_id: string | null }>("select kind, usd::text as usd, request_id from public.ten_usage_ledger where user_id = $1 order by created_at", [uid]),
  gates: (uid: string) => standIn.sql<any>("select id, chat_id, label, text_hash, gate_line, amount_usd::text as amount_usd, status, typed_text from public.ten_gate_log where user_id = $1 order by created_at", [uid]),
  balance: async (uid: string) => Number((await standIn.sql<{ v: string }>("select public.ten_balance_for($1)::text as v", [uid]))[0].v),
  addCall: (uid: string, usd: number, daysAgo = 2) =>
    standIn.sql("insert into public.ten_usage_ledger (user_id, kind, request_id, model, usd, created_at) values ($1, 'call', $2, 'anthropic/claude-sonnet-5', $3, now() - ($4 || ' days')::interval)", [uid, "seed-" + Math.random(), usd, String(daysAgo)]),
};
const proxyCalls = () => standIn.log.filter((l) => l.path.startsWith("/functions/v1/ten-model-proxy") && l.method === "POST");

function pyRun(files: Record<string, string>, argvCmd: string): { stdout: string; code: number; dir: string } {
  const dir = mkdtempSync(path.join(tmpRoot, "py-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), c);
  }
  // "python3 apply/scripts/x.py args" -> python3 <repo>/skills/apply/scripts/x.py args (cwd = workspace)
  const m = /^python3 (\S+)(.*)$/.exec(argvCmd)!;
  const r = spawnSync("sh", ["-c", `python3 ${JSON.stringify(path.join(REPO, "skills", m[1]))}${m[2]}`], { cwd: dir, encoding: "utf8" });
  return { stdout: r.stdout, code: r.status ?? -1, dir };
}
function toolResultsIn(body: any, toolName: string): any[] {
  const msgs: any[] = body?.messages ?? [];
  const ids = new Set<string>();
  for (const m of msgs) for (const tc of m.tool_calls ?? []) if (tc.function?.name === toolName) ids.add(tc.id);
  return msgs.filter((m) => m.role === "tool" && ids.has(m.tool_call_id)).map((m) => {
    try {
      return JSON.parse(textOfContent(m.content));
    } catch {
      return textOfContent(m.content);
    }
  });
}


const failShots: string[] = [];

// B1 (fix round 1): every fetch capture site in the app is bound. Static
// part: no bare `fetch` handed out as a default or stored on an object in
// the browser-shipped sources (apps/web/src, packages/agent/src,
// packages/checkers/src), tests excluded.
{
  const offenders: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) {
        if (!/node_modules|test-support|^test$/.test(f)) walk(p);
      } else if (/\.(ts|tsx|mjs|js)$/.test(f) && !/\.test\./.test(f)) {
        readFileSync(p, "utf8").split("\n").forEach((line, i) => {
          if (/^\s*(\/\/|\*)/.test(line)) return;
          if (/\?\?\s*fetch\b(?!\s*\()|[:=]\s*fetch\s*[,;)]|typeof fetch\s*=\s*fetch\b/.test(line)) offenders.push(`${path.relative(REPO, p)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
  };
  for (const d of ["apps/web/src", "packages/agent/src", "packages/checkers/src"]) walk(path.join(REPO, d));
  rec(offenders.length === 0, "B1 static: no unbound `fetch` stored/defaulted in browser-shipped sources", offenders.slice(0, 8).join(" | "));
}
if (SHIM) console.log("\n*** E2E_FETCH_SHIM=1: window.fetch is shimmed to ignore its receiver (diagnostic run; see B1) ***");
async function section(name: string, fn: () => Promise<void>) {
  if (!want(name)) return;
  SECTION = `${BROWSER}/${name}`;
  console.log(`\n=== ${name}`);
  try {
    await fn();
  } catch (e) {
    rec(false, `${name}: section threw`, String((e as Error)?.stack ?? e).slice(0, 1500));
    for (const b of Object.values(browsers)) {
      for (const c of b.contexts()) {
        for (const pg of c.pages()) {
          const f = path.join(tmpRoot, `fail-${BROWSER}-${name}-${failShots.length}.png`);
          await pg.screenshot({ path: f, fullPage: true }).catch(() => {});
          failShots.push(f);
          console.log("  screenshot:", f, " root:", ((await pg.locator("#root").textContent().catch(() => "")) ?? "").slice(0, 300));
        }
        await c.close().catch(() => {});
      }
    }
  }
}

let journeyUid = "";
let exportZip: Buffer | undefined;

async function runSuite() {
// ================================================================ JOURNEY
await section("journey", async () => {
  const uid = await standIn.createUser({ email: em("jordan.alvarez.demo") });
  journeyUid = uid;
  const atsAtStart = atsHits.length;
  const hitsAtStart = stub.hits.length;
  const proxyAtStart = proxyCalls().length;
  const { page } = await newPage();
  rec(await page.locator(".sign-in-screen").waitFor({ timeout: 15000 }).then(() => true, () => false), "journey: signed out -> the sign-in screen (design-web-ui § 1.4)");
  await signIn(page, em("jordan.alvarez.demo"));
  await page.locator(".empty-state").waitFor({ timeout: 20000 });
  rec(true, "journey: sign in (password) -> membership check -> first-run state");
  const empty = (await page.locator(".empty-state").textContent()) ?? "";
  rec(empty.includes("I don't have anything of yours yet. Drop in a résumé"), "journey: first-run copy (§ 1.5)", empty.trim());
  const c0 = await until(async () => ((await chip(page)) === "$5.00" ? "$5.00" : false), 8000);
  rec(c0 === "$5.00", "journey: balance chip reads ten_balance() = $5.00 for a fresh member (§ 1.5)", await chip(page));
  const files0 = await db.files(uid);
  eq(files0.map((f) => f.path), ["CLAUDE.md"], "journey: first run created exactly the root CLAUDE.md (§ 7)");
  rec(files0[0]?.content === TIER0, "journey: root CLAUDE.md == bundled skills/profile/templates/workspace-CLAUDE.md, byte for byte");
  rec(!(await page.locator(".fixture-picker").count()) && !(await page.getByText("Autoplay").count()), "journey: no fixture picker / Autoplay on screen");

  // startup: ONE membership check (fix round 1, item 3)
  const checksAtStart = standIn.log.filter((l) => l.path === "/rest/v1/rpc/ten_is_member" && l.origin !== "" && verifyJwt(/^Bearer (.+)$/.exec(l.auth)?.[1] ?? "")?.sub === uid).length;
  rec(checksAtStart === 1, "journey: exactly one membership check at sign-in (no duplicate setup)", String(checksAtStart));

  // ---- upload a résumé PDF (lead ruling 1: § 2 — upload BEFORE sending,
  // then the message carries a `file` part url "workspace:documents/<name>";
  // the package turns it into one text line; the attachment chip shows)
  await page.locator(".composer-attach-input").setInputFiles({ name: "jordan-alvarez-resume.pdf", mimeType: "application/pdf", buffer: PDF_BYTES });
  const up1 = await until(async () => ((await db.objects(uid)).length === 1 ? true : false), 15000);
  rec(!!up1, "journey: attach uploads to documents/<name> before sending");
  const objs = await db.objects(uid);
  eq(objs.map((o) => o.name), [`users/${uid}/ws/documents/jordan-alvarez-resume.pdf`], "journey: the PDF is one Storage object at users/{uid}/ws/documents/…");
  const stored = standIn.backend.objectBytes.get(`users/${uid}/ws/documents/jordan-alvarez-resume.pdf`);
  const upReq = standIn.log.filter((l) => l.method === "POST" && l.path.endsWith(`/users/${uid}/ws/documents/jordan-alvarez-resume.pdf`));
  console.log("  upload request(s):", JSON.stringify(upReq.map((l) => ({ cl: l.cl, got: l.bodyLen, status: l.status }))));
  rec(!!stored && Buffer.from(stored).equals(PDF_BYTES), "journey: stored bytes == uploaded bytes", stored ? `stored ${stored.length} B (sha ${sha256(Buffer.from(stored)).slice(0, 12)}) head ${JSON.stringify(Buffer.from(stored).subarray(0, 24).toString("latin1"))} vs uploaded ${PDF_BYTES.length} B` : "none");
  const composerAfterAttach = await page.locator(".composer-input").inputValue();
  rec(!composerAfterAttach.includes("Attached `documents/"), "journey (ruling 1): attaching does not pre-fill composer text — the file rides as a § 2 file part", JSON.stringify(composerAfterAttach));
  await page.locator(".composer-input").fill("hi, here's my resume");
  const hitsBefore = stub.hits.length;
  await page.locator(".composer-input").press("Enter");
  await waitSettled(page);
  const chipText = (await page.locator(".bubble--user").last().locator(".attachment-chip").allTextContents().catch(() => [])).join(" ");
  rec(chipText.includes("jordan-alvarez-resume.pdf"), "journey (ruling 1): the sent message shows the attachment chip", JSON.stringify(chipText));
  const turnHits = stub.hits.slice(hitsBefore);
  const firstBody = turnHits[0]?.body;
  const lastUserMsg = [...(firstBody?.messages ?? [])].reverse().find((m: any) => m.role === "user");
  rec(textOfContent(lastUserMsg?.content).includes("The candidate attached `documents/jordan-alvarez-resume.pdf`."), "journey (ruling 1): the model sees the package's one text line for the file part (§ 2)", JSON.stringify(textOfContent(lastUserMsg?.content)).slice(0, 200));
  rec(turnHits.length === 5 && turnHits.every((h) => h.scenario === "upload+intake"), "journey/intake: 5 model calls, all through the proxy", turnHits.map((h) => `${h.scenario}#${h.step}`).join(" "));
  const pdfRead = toolResultsIn(turnHits[1]?.body, "read_file")[0];
  rec(pdfRead?.error?.code === "unsupported_type", "journey/intake: read_file on the PDF returns unsupported_type to the model (§ 4)", JSON.stringify(pdfRead));
  rec(!stub.hits.some((h) => JSON.stringify(h.body).includes("%PDF")), "journey/intake: the PDF bytes never reach the model (§ 2)");
  const sys = textOfContent(turnHits[0]?.body?.messages?.[0]?.content);
  rec(turnHits[0]?.body?.messages?.[0]?.role === "system" && sys.includes(TIER0), "journey: the system prompt carries the bundled Tier 0 byte for byte (§ 7)");
  const cf = toolResultsIn(turnHits[4]?.body, "bash").slice(-1)[0];
  const pyCF = pyRun(Object.fromEntries((await db.files(uid)).map((f) => [f.path, f.content])), CMD_CHECK_FILES);
  rec(cf?.stdout === pyCF.stdout && cf?.exitCode === pyCF.code, "journey/intake: check_files in the browser == Python, byte for byte", `js=${JSON.stringify(cf?.stdout)} py=${JSON.stringify(pyCF.stdout)}`);
  eq((await db.files(uid)).map((f) => f.path), ["CLAUDE.md", "base-resume.md", "criteria.md", "plan.md"], "journey/intake: base-resume, criteria, plan written through ten_ws_write");

  // ---- paste a Greenhouse job URL -> verdict
  const h2 = stub.hits.length;
  await say(page, `found this one: ${JD_URL}`);
  const t2 = stub.hits.slice(h2);
  const myAts = atsHits.slice(atsAtStart);
  rec(myAts.length === 1 && myAts[0] === "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4102938", "journey/verdict: fetch_job called the Greenhouse board API (stubbed)", myAts.join(" "));
  rec(t2.some((h) => h.kind === "web_search"), "journey/verdict: web_search went through the proxy with the web plugin");
  const ws = t2.find((h) => h.kind === "web_search");
  eq(ws?.body?.plugins, [{ id: "web", engine: "exa", max_results: 4 }], "journey/verdict: the proxy rewrote the plugin (engine exa, max_results ≤ 5)");
  const wsResult = toolResultsIn(t2[t2.length - 1]?.body, "web_search").slice(-1)[0];
  rec(wsResult?.results?.[0]?.url === "https://news.example.com/acme-series-c", "journey/verdict: web_search results parsed from url_citation annotations", JSON.stringify(wsResult));
  const verdict = page.locator(".card--verdict").last();
  await verdict.waitFor({ timeout: 5000 }).catch(() => {});
  const vText = (await verdict.textContent().catch(() => "")) ?? "";
  rec(/Acme/.test(vText) && /Staff PM/.test(vText) && /Strong Fit/.test(vText), "journey/verdict: verdict card (Acme — Staff PM: Strong Fit)", vText.slice(0, 200));
  rec(vText.includes("8 years of B2B SaaS platform PM experience matches the core ask; partner-API story lines up with their stated ecosystem priority"), "journey/verdict: reason shown word for word from jobs.md");
  const jobsMd = (await db.files(uid)).find((f) => f.path === "jobs.md");
  rec(!!jobsMd && jobsMd.content.includes("Acme") && jobsMd.content.includes("jd-analysis/acme-staff-pm.md"), "journey/verdict: record_verdict wrote the jobs.md row (write-back through ten_ws_write)");
  const jdSaved = (await db.files(uid)).find((f) => f.path === "jd-inbox/acme-staff-pm.md");
  rec(!!jdSaved && jdSaved.content.includes("partner ecosystem"), "journey/verdict: fetch_job saveTo wrote jd-inbox/acme-staff-pm.md");
  await verdict.locator(".card-open-link").first().click();
  await page.waitForTimeout(500);
  rec(((await page.locator(".side-panel-path").textContent()) ?? "").includes("jd-analysis/acme-staff-pm.md"), "journey/verdict: the card opens its ref (jd_file) in the side panel");

  // ---- tailored résumé + letter with checker cards (checkers run in the browser)
  const h3 = stub.hits.length;
  await say(page, "yes please");
  const t3 = stub.hits.slice(h3);
  const checkerCards = page.locator(".card--checker");
  rec((await checkerCards.count()) === 2, "journey/tailor: two checker cards (one per file, § 6.2)", String(await checkerCards.count()));
  const jsCheck = toolResultsIn(t3[3]?.body, "bash").slice(-1)[0];
  const filesNow = Object.fromEntries((await db.files(uid)).map((f) => [f.path, f.content]));
  const pyCheck = pyRun(filesNow, CMD_CHECK);
  rec(jsCheck?.stdout === pyCheck.stdout && jsCheck?.exitCode === pyCheck.code, "journey/tailor: check_materials in the BROWSER == Python on the same files (stdout + exit)", jsCheck?.stdout === pyCheck.stdout ? `exit ${pyCheck.code}` : `js=${JSON.stringify(jsCheck?.stdout)}\npy=${JSON.stringify(pyCheck.stdout)}`);
  const cardTexts = await checkerCards.allTextContents();
  const statusLines = (pyCheck.stdout.match(/^(RESUME|LETTER) \S+: (pass|FAIL) \(\d+ fail, \d+ warn\)/gm) ?? []) as string[];
  rec(statusLines.length === 2 && statusLines.every((l, i) => cardTexts[i]?.includes(l.split(":")[0].split(" ")[1])), "journey/tailor: checker cards name the files the script reported", statusLines.join(" | "));
  const findings = (pyCheck.stdout.match(/^\s+\[(FAIL|WARN)\] .+$/gm) ?? []).map((l) => l.replace(/^\s+\[(FAIL|WARN)\] /, ""));
  rec(findings.every((f) => cardTexts.join("\n").includes(f)), "journey/tailor: every finding shown word for word", `${findings.length} finding(s)`);
  const jsRender = toolResultsIn(t3[4]?.body, "bash").slice(-1)[0];
  const pyRender = pyRun(filesNow, CMD_RENDER);
  rec(jsRender?.stdout?.trim() === pyRender.stdout.trim() && jsRender?.exitCode === 0, "journey/tailor: render_resume in the browser == Python stdout", `js=${JSON.stringify(jsRender?.stdout)} py=${JSON.stringify(pyRender.stdout)}`);
  const doc = page.locator(".card--document").last();
  const docText = (await doc.textContent().catch(() => "")) ?? "";
  const words = /words: (\d+)/.exec(pyRender.stdout)?.[1];
  rec(!!words && docText.includes(`${words} words`), "journey/tailor: document card words == render_resume's count", docText);
  const htmlRow = (await db.files(uid)).find((f) => f.path === "applications/acme-staff-pm-resume.html");
  rec(!!htmlRow && htmlRow.content.includes("Jordan Alvarez"), "journey/tailor: the rendered .html is written to the workspace");
  await doc.getByText("Print / Save as PDF").click();
  await page.waitForTimeout(900);
  const printed: string[] = await page.evaluate(() => (window as any).__printed);
  rec(printed.length === 1 && printed[0].includes("Jordan Alvarez"), "journey/tailor: Print / Save as PDF calls print() on the rendered résumé's iframe", `${printed.length} print() call(s)`);
  const iframe = page.locator(".side-panel-iframe");
  const srcdoc = (await iframe.getAttribute("srcdoc").catch(() => null)) ?? "";
  const sandbox = (await iframe.getAttribute("sandbox").catch(() => null)) ?? "";
  rec(srcdoc.includes("Jordan Alvarez") && srcdoc.includes("Content-Security-Policy") && !sandbox.includes("allow-scripts"), "journey/tailor: Download PDF opens the rendered résumé in the sandboxed, CSP'd iframe (print-to-PDF)", `sandbox="${sandbox}"`);

  // ---- the plan card
  const h4 = stub.hits.length;
  await say(page, "great, what's next?");
  const plan = page.locator(".card--plan").last();
  const planItems = await plan.locator(".plan-items li").allTextContents().catch(() => []);
  const expectItems = F["plan.md"].split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  rec(planItems.length >= 2 && planItems.length <= 4, "journey/plan: plan card with 2–4 items (rule 6)", String(planItems.length));
  rec(expectItems.every((t, i) => (planItems[i] ?? "").includes(t.replace(/`/g, "")) || (planItems[i] ?? "").includes(t)), "journey/plan: items word for word from plan.md, in file order", JSON.stringify(planItems).slice(0, 300));
  rec(((await plan.textContent()) ?? "").includes("applying"), "journey/plan: stage from --stage");
  rec((await db.files(uid)).find((f) => f.path === "plan.md")?.content === F["plan.md"], "journey/plan: 'what's next' written to plan.md");
  void h4;

  // ---- the JWT is what reaches the proxy; the OpenRouter key never leaves the host
  const pc = proxyCalls().slice(proxyAtStart);
  const allUserJwt = pc.every((l) => {
    const tok = /^Bearer (.+)$/.exec(l.auth)?.[1] ?? "";
    const c = verifyJwt(tok);
    return c?.sub === uid && c?.role === "authenticated";
  });
  rec(pc.length > 0 && allUserJwt, "auth: every proxy call carries the user's Supabase session JWT (§ 8)", `${pc.length} calls`);
  rec(pc.every((l) => l.path === "/functions/v1/ten-model-proxy/chat/completions"), "env: VITE_MODEL_PROXY_URL unset -> <SUPABASE_URL>/functions/v1/ten-model-proxy (the default)");
  rec(stub.hits.slice(hitsAtStart).every((h) => h.auth === `Bearer ${OPENROUTER_CANARY}`), "auth: upstream calls carry the host-side OpenRouter key only (never the JWT)");
  rec(stub.hits.every((h) => !JSON.stringify(h.body).includes("eyJ")), "auth: no JWT in any upstream body");
  // Only this section's hits: a later browser's run would otherwise also see
  // the DeepSeek calls an earlier browser's "model" section made on purpose
  // (it failed in firefox/webkit for that reason alone, 2026-09-25).
  const journeyChats = stub.hits.slice(hitsAtStart).filter((h) => h.kind === "chat");
  rec(journeyChats.length > 0 && journeyChats.every((h) => h.body.model === "anthropic/claude-sonnet-5" && h.body.stream === true && h.body.provider?.zdr === true), "proxy: upstream body forced (model, stream, provider zdr)", `${journeyChats.length} chat call(s) this section`);

  // ---- CORS: every preflight's requested headers are all allowed (fix round 1, item 2)
  const pre = standIn.log.filter((l) => l.method === "OPTIONS" && l.path.startsWith("/functions/v1/ten-model-proxy") && l.at >= (pc[0]?.at ?? 0) - 60000);
  const bad = pre.filter((l) => {
    const allowed = (l.acah ?? "").toLowerCase().split(",").map((x) => x.trim());
    return l.acrh.toLowerCase().split(",").map((x) => x.trim()).filter(Boolean).some((h) => !allowed.includes(h)) || l.status !== 204;
  });
  const allOptions = standIn.log.filter((l) => l.method === "OPTIONS").map((l) => l.path);
  if (process.env.E2E_CONSOLE) console.log("  OPTIONS seen so far:", allOptions.length, [...new Set(allOptions)].slice(0, 6).join(" "));
  // Under interception Chromium answers preflights itself (0 reach the
  // server); the "cors" section checks Chromium without interception.
  rec(bad.length === 0 && (BROWSER === "chromium" || pre.length > 0), "CORS (journey, interception on): every proxy preflight that reached the server had all requested headers allowed", `${pre.length} preflight(s); requested: ${[...new Set(pre.map((l) => l.acrh))].join(" / ") || "(no preflight)"}; allowed: ${pre[0]?.acah ?? "-"}`);

  // ---- balance chip from ten_balance(), after metering lands
  const metered = await until(async () => {
    const l = (await db.ledger(uid)).filter((r) => r.kind === "call");
    return l.length === stub.hits.length - hitsAtStart ? l : false;
  }, 15000);
  rec(!!metered, "meter: one ledger call row per proxy call", `${(await db.ledger(uid)).filter((r) => r.kind === "call").length} rows / ${stub.hits.length - hitsAtStart} calls`);
  await focusRefresh(page);
  const bal = await db.balance(uid);
  rec((await chip(page)) === `$${floorCents(bal)}`, "balance chip == ten_balance() rounded down to the cent, refreshed on focus", `chip ${await chip(page)} ledger ${bal}`);

  // ---- export (rule 9) — the zip is the workspace, byte for byte
  await page.locator(".menu-trigger").click();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("menuitem", { name: "Export workspace" }).click()]);
  const zipPath = path.join(tmpRoot, "export-a.zip");
  await dl.saveAs(zipPath);
  exportZip = readFileSync(zipPath);
  const entries = unzipSync(new Uint8Array(exportZip)) as Record<string, Uint8Array>;
  const dbFiles = await db.files(uid);
  const textOk = dbFiles.every((f) => entries[f.path] && Buffer.from(entries[f.path]).toString("utf8") === f.content);
  const binOk = (await db.objects(uid)).every((o) => {
    const rel = o.name.replace(`users/${uid}/ws/`, "");
    return entries[rel] && Buffer.from(entries[rel]).equals(Buffer.from(standIn.backend.objectBytes.get(o.name)!));
  });
  // § 11.7 (amended 2026-09-24): plus .ten/conversation.json, the saved array, when a row exists.
  const savedConv = (await standIn.sql<any>("select messages from public.ten_conversations where user_id = $1", [uid]))[0];
  const expectedCount = dbFiles.length + (await db.objects(uid)).length + (savedConv ? 1 : 0);
  rec(textOk && binOk && Object.keys(entries).filter((k) => !k.endsWith("/")).length === expectedCount, "export: zip == every text row + every object (+ .ten/conversation.json), byte for byte, same folder shape", `${Object.keys(entries).length} entries`);
  const convEntry = entries[".ten/conversation.json"];
  let convParsed: unknown = undefined;
  try { convParsed = convEntry ? JSON.parse(Buffer.from(convEntry).toString("utf8")) : undefined; } catch { convParsed = "UNPARSEABLE"; }
  rec(!!savedConv && JSON.stringify(convParsed) === JSON.stringify(savedConv.messages), "export (§ 11.9 x): .ten/conversation.json parses and equals the saved array", convEntry ? `${convEntry.length} bytes` : "missing");
  const shots = process.env.SHOTS;
  if (shots) await page.screenshot({ path: path.join(shots, "e2e-real-journey.png"), fullPage: true });

  // ---- transcript/avatar sanity
  const states: string[] = await page.evaluate(() => [...(window as any).__states]);
  rec(["idle", "thinking", "working", "done"].every((s) => states.includes(s)), "journey: avatar went idle -> thinking/working -> done from the real stream", states.join(","));
  await page.context().close();
});

// ================================================================ IMPORT
await section("import", async () => {
  if (!(exportZip)) return;
  const uid = await standIn.createUser({ email: em("import.target") });
  const { page } = await newPage();
  await signIn(page, em("import.target"));
  await page.locator(".empty-state").waitFor({ timeout: 20000 });
  const zipPath = path.join(tmpRoot, "export-a.zip");
  await page.locator('input[accept=".zip"]').setInputFiles(zipPath);
  const got = await until(async () => ((await db.files(uid)).length > 3 ? true : false), 20000);
  rec(!!got, "import: the exported zip imports into a fresh workspace (holding only CLAUDE.md)", got ? "" : `import-error: ${(await page.locator(".import-error").textContent().catch(() => "")) ?? ""}`);
  const a = await db.files(journeyUid);
  const b = await db.files(uid);
  eq(b.map((f) => [f.path, sha256(f.content)]), a.map((f) => [f.path, sha256(f.content)]), "import: text files identical to the source workspace");
  const ao = (await db.objects(journeyUid)).map((o) => o.name.replace(`users/${journeyUid}/ws/`, ""));
  const bo = (await db.objects(uid)).map((o) => o.name.replace(`users/${uid}/ws/`, ""));
  eq(bo, ao, "import: binaries identical paths to the source workspace");
  rec(!b.some((f) => f.path.startsWith(".ten/")), "import (§ 11.9 x): .ten/ entries are skipped, never written as files");
  rec((await standIn.sql("select 1 from public.ten_conversations where user_id = $1", [uid])).length === 0, "import (§ 11.9 x): an import starts a new conversation (no row carried over)");
  // import into a now non-empty workspace is refused with a visible message
  await page.locator('input[accept=".zip"]').setInputFiles(zipPath);
  const refused = await until(async () => ((await page.locator(".import-error").count()) ? (await page.locator(".import-error").textContent()) : false), 10000);
  rec(!!refused, "import: a second import into a non-empty workspace is refused, shown to the candidate", String(refused ?? "").slice(0, 160));
  await page.context().close();
});

// ================================================================ SPEND GATE
await section("gate", async () => {
  const uid = await standIn.createUser({ email: em("gate.user") });
  const { page } = await newPage();
  await signIn(page, em("gate.user"));
  await page.locator(".empty-state").waitFor({ timeout: 20000 });
  await say(page, "hello there"); // one measured step, so estimate_cost prices from this chat
  const hBefore = stub.hits.length;
  await say(page, "find me roles at five more companies");
  const t = stub.hits.slice(hBefore);
  rec(t.length === 1, "gate: the gate ends the turn — no model call after estimate_cost opens it", `${t.length} call(s)`);
  const gate = page.locator(".card--gate").last();
  const gText = (await gate.textContent().catch(() => "")) ?? "";
  const gates = await db.gates(uid);
  const row = gates[gates.length - 1];
  rec(row?.status === "pending", "gate: a pending ten_gate_log row", JSON.stringify(row));
  const shownText = (await gate.locator(".gate-text").textContent()) ?? "";
  rec(row?.text_hash === `sha256:${sha256(shownText)}`, "gate: text_hash == sha256 of the text as shown (§ 3)");
  const amount = Number(row?.amount_usd);
  rec(amount > 1.0, "gate: amount over the $1.00 threshold", String(amount));
  const expectedLine = `This costs up to $${(Math.ceil(Math.round(amount * 1e6) / 1e4) / 100).toFixed(2)} — nothing starts until you say yes.`;
  rec(((await gate.locator(".gate-line").textContent()) ?? "") === expectedLine && row?.gate_line === expectedLine, "gate: gate line == gate-grammar.md's spend line, amount filled", expectedLine);
  rec((await gate.locator("button").count()) === 0, "gate: the gate card has no button (rule 7)");
  rec(shownText.startsWith("Search more companies\nFive B2B SaaS companies like Acme\nStaff PM roles only\nEstimated cost: $"), "gate: complete thing = action, items, cost line", JSON.stringify(shownText));
  rec((await page.locator(".card--cost").count()) >= 1, "gate: a cost card shows the range and balance");
  rec((await page.locator(".avatar").getAttribute("class"))?.includes("needs-you") ?? false, "gate: avatar shows needs-you");
  rec(gText.includes("pending"), "gate: status pending on the card");
  // not-yes: stays pending, the model is told it isn't approved
  const hN = stub.hits.length;
  await say(page, "sure, go ahead");
  const tn = stub.hits.slice(hN);
  rec((await db.gates(uid)).slice(-1)[0]?.status === "pending", "gate: 'sure, go ahead' leaves it pending (only an exact typed yes approves)");
  rec(tn.length === 1 && textOfContent(tn[0].body.messages[0].content).includes("still pending"), "gate: the non-approving reply reaches the model with the pending note");
  // yes: approved + logged with the typed text
  const hY = stub.hits.length;
  await say(page, "yes");
  const after = (await db.gates(uid)).slice(-1)[0];
  rec(after?.status === "approved" && after?.typed_text === "yes", "gate: typed 'yes' -> approved, the typed text logged", JSON.stringify(after));
  rec(stub.hits.length - hY === 1 && ((await lastAssistant(page).textContent()) ?? "").includes("Starting the search now."), "gate: the run continues after approval");
  rec(((await page.locator(".card--gate").last().textContent()) ?? "").includes("approved"), "gate: card status approved");
  // leave a pending gate, reload: § 11.6 (amended 2026-09-24) — the chat id is
  // stable, so the pending gate survives and a typed yes still approves it.
  await say(page, "find me roles at ten more companies");
  const pend = (await db.gates(uid)).slice(-1)[0];
  rec(pend?.status === "pending", "gate: a second gate opened (pending) before reload");
  await until(async () => ((await standIn.sql<any>("select messages from public.ten_conversations where user_id = $1", [uid]))[0]?.messages ?? []).some((m: any) => JSON.stringify(m).includes(pend.id)), 10000);
  await page.reload();
  await page.locator(".composer-input").waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  const cardAfter = (await page.locator(`.card--gate[data-gate-id="${pend?.id}"]`).textContent().catch(() => "")) ?? "";
  rec(cardAfter.includes("pending"), "gate (§ 11.9 vi): after a reload the pending gate card is back, still pending", cardAfter.slice(0, 120));
  rec(((await page.locator(".avatar").getAttribute("class")) ?? "").includes("needs-you"), "gate (§ 11.9 vi): …and the avatar shows needs-you");
  rec((await db.gates(uid)).find((g) => g.id === pend?.id)?.status === "pending", "gate (§ 11.6): the reload expired nothing");
  const hR = stub.hits.length;
  await say(page, "yes");
  const approvedAfterReload = (await db.gates(uid)).find((g) => g.id === pend?.id);
  rec(approvedAfterReload?.status === "approved" && approvedAfterReload?.typed_text === "yes", "gate (§ 11.9 vi): a typed yes after the reload approves it", JSON.stringify(approvedAfterReload?.status));
  rec(stub.hits.length - hR === 1 && ((await lastAssistant(page).textContent()) ?? "").includes("Starting the search now."), "gate (§ 11.9 vi): …and the run continues");
  // decline is final
  await say(page, "find me roles at ten more companies");
  const dg = (await db.gates(uid)).slice(-1)[0];
  const hD = stub.hits.length;
  await say(page, "no");
  rec(stub.hits.length === hD, "gate: 'no' declines with NO model call (nothing spent)");
  rec((await db.gates(uid)).find((g) => g.id === dg.id)?.status === "declined", "gate: row declined");
  rec(((await lastAssistant(page).textContent()) ?? "").includes("Declined — nothing started."), "gate: 'Declined — nothing started.'");
  await say(page, "yes");
  rec((await db.gates(uid)).find((g) => g.id === dg.id)?.status === "declined", "gate: a later 'yes' does not reopen/approve a declined gate (decline is final)");
  rec(((await page.locator(`.card--gate[data-gate-id="${dg.id}"]`).textContent()) ?? "").includes("declined"), "gate: the declined card stays declined");
  await page.context().close();
});

// ================================================================ OVER BALANCE
await section("balance", async () => {
  // (a) already at zero -> the proxy's 402 copy, no model reply
  const uid = await standIn.createUser({ email: em("broke.user") });
  await db.addCall(uid, 5.0);
  const { page } = await newPage();
  await signIn(page, em("broke.user"));
  await page.locator(".composer-input").waitFor({ timeout: 20000 });
  const c = await until(async () => ((await chip(page)) !== "—" ? await chip(page) : false), 8000);
  rec(c === "$0.00", "balance: chip reads $0.00 at zero balance", String(c));
  const h0 = stub.hits.length;
  const p0 = proxyCalls().length;
  await say(page, "hello, anyone?");
  rec(proxyCalls().length - p0 === 1, "over_balance: exactly one proxy call (402 is not retried)", `${proxyCalls().length - p0}`);
  const err = page.locator(".card--error").last();
  const errText = (await err.textContent().catch(() => "")) ?? "";
  rec(errText.includes("over_balance") && errText.includes("Your beta credit is used up. Ask the person who invited you for more."), "over_balance: the proxy's 402 sentence is shown (§ 8, § 2.7)", errText);
  rec(stub.hits.length === h0, "over_balance: nothing reached the model");
  rec((await lastAssistant(page).locator("p:not(.card-body):not(.card-meta)").count()) === 0, "over_balance: no model reply after the refusal");
  // (b) mid-run: the balance runs out between steps -> the finished tool stays, error, no reply after
  const uid2 = await standIn.createUser({ email: em("midrun.user") });
  stub.setScenarios(
    scenarios([
      {
        name: "midrun",
        match: /^run the long job$/,
        steps: [
          { tools: [{ name: "list_files", args: {} }], before: async () => void (await db.addCall(uid2, 5.0)) },
          { text: "(stub) SHOULD NOT BE REACHED: the proxy refuses this call" },
        ],
      },
    ]),
  );
  const { page: p2 } = await newPage();
  await signIn(p2, em("midrun.user"));
  await p2.locator(".composer-input").waitFor({ timeout: 20000 });
  const hm = stub.hits.length;
  await say(p2, "run the long job");
  rec(stub.hits.length - hm === 1, "over_balance mid-run: step 1 ran; step 2 was refused before the model", `${stub.hits.length - hm} call(s)`);
  const lastBubble = lastAssistant(p2);
  rec((await lastBubble.locator(".tool-run").count()) === 1, "over_balance mid-run: the finished tool run stays on screen");
  const e2 = (await lastBubble.locator(".card--error").textContent().catch(() => "")) ?? "";
  rec(e2.includes("Your beta credit is used up."), "over_balance mid-run: the 402 copy", e2);
  const bubbleHtml = await lastBubble.innerHTML();
  rec(!bubbleHtml.includes("SHOULD NOT BE REACHED"), "over_balance mid-run: no model text after the refusal");
  await focusRefresh(p2);
  rec((await chip(p2)) === "$0.00", "over_balance mid-run: chip clamps to $0.00 (never negative)", await chip(p2));
  stub.setScenarios(scenarios());
  // chip rounding down
  const uid3 = await standIn.createUser({ email: em("rounding.user") });
  await db.addCall(uid3, 0.433);
  const { page: p3 } = await newPage();
  await signIn(p3, em("rounding.user"));
  await p3.locator(".composer-input").waitFor({ timeout: 20000 });
  const c3 = await until(async () => ((await chip(p3)) !== "—" ? await chip(p3) : false), 8000);
  rec(c3 === "$4.56", "balance: $4.567 shows $4.56 (rounded down to the cent)", String(c3));
  await page.context().close();
  await p2.context().close();
  await p3.context().close();
});

// ================================================================ BETA CEILING
await section("ceiling", async () => {
  const other = await standIn.createUser({ email: em("ceiling.other") });
  const uid = await standIn.createUser({ email: em("ceiling.user") });
  await db.addCall(other, 5.0, 0); // today: the beta-wide $5 is spent
  try {
  const { page } = await newPage();
  await signIn(page, em("ceiling.user"));
  await page.locator(".composer-input").waitFor({ timeout: 20000 });
  const h0 = stub.hits.length;
  const p0 = proxyCalls().length;
  await say(page, "hello, ceiling?");
  const pc = proxyCalls().slice(p0);
  rec(pc.length === 1, "ceiling: one proxy call for one refused step (a 503 ceiling refusal is not retried)", `${pc.length} call(s), statuses ${pc.map((l) => l.status).join(",")}`);
  const errText = (await page.locator(".card--error").last().textContent().catch(() => "")) ?? "";
  rec(errText.includes("model_error") && errText.includes("The beta has reached today's limit. Try again tomorrow."), "ceiling: 503 shown as model_error with the proxy's own sentence", errText);
  rec(!errText.includes("over_balance"), "ceiling: NOT shown as over_balance");
  rec(stub.hits.length === h0, "ceiling: nothing reached the model");
  void uid;
  await page.context().close();
  } finally {
    await standIn.sql("delete from public.ten_usage_ledger where user_id = $1", [other]);
  }
});

// ================================================================ NOT A MEMBER
await section("member", async () => {
  await standIn.createUser({ email: em("not.member"), member: false });
  const { page } = await newPage();
  await signIn(page, em("not.member"));
  await page.locator(".not-a-member-screen").waitFor({ timeout: 20000 });
  const t = (await page.locator(".not-a-member-screen").textContent()) ?? "";
  rec(t.includes(NON_MEMBER), "not-a-member: the contract's sentence (§ 8, design-web-ui § 1.6; lead ruling 5dab77d)", t);
  rec(!(await page.locator(".composer-input").count()) && !(await page.locator(".balance-chip").count()) && !(await page.locator(".avatar").count()), "not-a-member: no composer, no chip, no avatar (§ 1.6)");
  // the proxy refuses a non-member directly (403) even with a valid session
  const status = await page.evaluate(async (u: string) => {
    const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
    const tok = key ? JSON.parse(localStorage.getItem(key)!).access_token : "";
    const r = await fetch(`${u}/functions/v1/ten-model-proxy/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) });
    return [r.status, await r.text()];
  }, standIn.url);
  rec(status[0] === 403 && String(status[1]).includes(NON_MEMBER), "not-a-member: the proxy answers 403 with the same sentence", JSON.stringify(status));
  await page.locator(".not-a-member-screen button", { hasText: "Sign out" }).click();
  await page.locator(".sign-in-screen").waitFor({ timeout: 10000 });
  rec(true, "not-a-member: sign out returns to sign-in");
  await page.context().close();
});

// ================================================================ DELETE BETA DATA
await section("delete", async () => {
  const uid = await standIn.createUser({ email: em("delete.user") });
  const { page } = await newPage();
  await signIn(page, em("delete.user"));
  await page.locator(".empty-state").waitFor({ timeout: 20000 });
  for (const n of [1, 2]) {
    await page.locator(".composer-attach-input").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: PDF_BYTES });
    await until(async () => ((await db.objects(uid)).length === n ? true : false), 15000);
  }
  eq((await db.objects(uid)).map((o) => o.name.replace(`users/${uid}/ws/`, "")), ["documents/cv-2.pdf", "documents/cv.pdf"], "upload: re-attaching the same name lands at …-2.pdf (§ 2)");
  await say(page, "hello there"); // one measured step so the next estimate prices from this chat
  await say(page, "find me roles at five more companies"); // a gate row + call rows
  const before = { files: (await db.files(uid)).length, objs: (await db.objects(uid)).length, gates: (await db.gates(uid)).length, ledger: await db.ledger(uid) };
  rec(before.files >= 1 && before.objs === 2 && before.gates === 1 && before.ledger.some((r) => r.kind === "call"), "delete: seeded workspace, object, gate row, call rows", JSON.stringify({ ...before, ledger: before.ledger.length }));
  rec((await until(async () => ((await standIn.sql("select 1 from public.ten_conversations where user_id = $1", [uid])).length === 1 ? true : false), 10000)) === true, "delete: a saved conversation row exists before the delete");
  await page.locator(".menu-trigger").click();
  await page.getByRole("menuitem", { name: "Delete my beta data" }).click();
  const dlg = page.locator(".delete-confirm-card");
  const dText = (await dlg.textContent()) ?? "";
  rec(dText.includes("your workspace files, your conversation, your gate log, and your credit"), "delete: names the complete thing, incl. your conversation (§ 1.7.1, amended for C § 11.7)");
  rec(
    dText.includes("This deletes your Ten beta data. Your sign-in stays because it's shared with the older app. Unused credit is forfeited. Your usage records, which show only amounts spent and no content, are kept."),
    "delete: C § 8's sentence word for word, incl. the kept-usage sentence (§ 1.7.2)",
  );
  const fnBase = standIn.log.filter((l) => l.path === "/functions/v1/ten-delete-account" && l.method === "POST").length;
  const fnCalls = () => standIn.log.filter((l) => l.path === "/functions/v1/ten-delete-account" && l.method === "POST").length - fnBase;
  const input = dlg.locator("input[type=text]");
  await input.fill("sure");
  await input.press("Enter");
  await page.waitForTimeout(600);
  rec(fnCalls() === 0 && (await dlg.locator("input[type=text]").count()) === 1, "delete: 'sure' does nothing (only an exact typed yes)");
  await input.fill("");
  await dlg.locator("button[type=submit]").click();
  await page.waitForTimeout(400);
  rec(fnCalls() === 0, "delete: clicking the button with no typed yes does nothing");
  rec(!dText.includes("There is no button"), "delete: the copy no longer claims 'there is no button' next to a Submit button (item 8)", dText.slice(0, 300));
  const btnLabels = await dlg.locator("button").allTextContents();
  rec(!btnLabels.some((b) => /^(delete|confirm|yes)/i.test(b.trim())), "delete: no button that confirms by itself", btnLabels.join(" | "));
  await input.fill("yes");
  await input.press("Enter");
  const done = await until(async () => ((await page.getByText("Deleted. You're signed out of Ten").count()) ? true : false), 15000);
  rec(!!done, "delete: typed yes -> the function ran -> the report-back line (§ 1.7.4)");
  const sessionWhenToldSignedOut = await page.evaluate(() => Object.keys(localStorage).some((k) => k.includes("auth-token") && localStorage.getItem(k)));
  rec(!sessionWhenToldSignedOut, "delete: when the report-back says \"You're signed out of Ten\", the session is actually gone (sign-out ordering)", sessionWhenToldSignedOut ? "session still stored until OK is clicked" : "");
  const call = standIn.log.filter((l) => l.path === "/functions/v1/ten-delete-account" && l.method === "POST").slice(-1)[0];
  rec(fnCalls() === 1 && verifyJwt(/^Bearer (.+)$/.exec(call?.auth ?? "")?.[1] ?? "")?.sub === uid && call?.status === 200, "delete: ten-delete-account called once, with the user's JWT, 200", JSON.stringify({ n: fnCalls(), status: call?.status }));
  const afterL = await db.ledger(uid);
  rec((await db.files(uid)).length === 0 && (await db.objects(uid)).length === 0 && (await db.gates(uid)).length === 0, "delete: no text rows, no objects, no gate rows left");
  rec((await standIn.sql("select 1 from public.ten_conversations where user_id = $1", [uid])).length === 0, "delete (§ 11.7): the saved conversation is gone too");
  rec(!afterL.some((r) => r.kind === "credit") && afterL.filter((r) => r.kind === "call").length === before.ledger.filter((r) => r.kind === "call").length, "delete: credit rows gone, call rows kept (§ 8)");
  rec((await standIn.sql("select 1 from auth.users where id = $1", [uid])).length === 1, "delete: the shared sign-in (auth user) is kept");
  if (await page.locator(".delete-confirm-card button", { hasText: "OK" }).count()) await page.locator(".delete-confirm-card button", { hasText: "OK" }).click();
  await page.locator(".sign-in-screen").waitFor({ timeout: 10000 });
  rec(!(await page.evaluate(() => Object.keys(localStorage).some((k) => k.includes("auth-token") && localStorage.getItem(k)))), "delete: session cleared after sign-out");
  rec(true, "delete: OK -> signed out to the sign-in screen");
  await signIn(page, em("delete.user"));
  await page.locator(".not-a-member-screen").waitFor({ timeout: 20000 });
  rec(true, "delete: signing back in -> not a member (the credit is gone)");
  // decline path, fresh user
  const uid2 = await standIn.createUser({ email: em("delete.decline") });
  const { page: p2 } = await newPage();
  await signIn(p2, em("delete.decline"));
  await p2.locator(".empty-state").waitFor({ timeout: 20000 });
  await p2.locator(".menu-trigger").click();
  await p2.getByRole("menuitem", { name: "Delete my beta data" }).click();
  await p2.locator(".delete-confirm-card input[type=text]").fill("no");
  await p2.locator(".delete-confirm-card input[type=text]").press("Enter");
  await p2.waitForTimeout(500);
  rec(((await p2.locator(".delete-confirm-card").textContent()) ?? "").includes("Declined — nothing was deleted.") && (await db.files(uid2)).length === 1, "delete: 'no' declines; nothing deleted");
  await page.context().close();
  await p2.context().close();
});

// ================================================================ SAVED CONVERSATION (C § 11)
// Tester-owned, from docs/design-web-agent.md § 11.9 (iv)–(viii), (x)–(xii)
// and design-web-ui.md § 1.8–1.9 (6641e1a). The real RealApp over the
// stand-in (PGlite running all three applied migrations).
await section("conversation", async () => {
  const UI = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8").replace(/\s+/g, " ");
  const q = (re: RegExp) => UI.match(re)?.[1] ?? `(copy not found: ${re})`;
  const OLDER = q(/\*\*Older turns not kept\*\* \(C § 11\.4\), at the top of the restored transcript: "([^"]+)"/);
  const SAVE_FAILED = q(/\*\*A save failed\*\* \(C § 11\.4\): "([^"]+)"/);
  const STALE = q(/\*\*Stale tab, before a send\*\* \(C § 11\.5; the message is not sent and its text stays in the composer\): "([^"]+)"/);
  const CONFLICT = q(/\*\*Save conflict\*\* \(C § 11\.5\): "([^"]+)"/);
  const LOAD_FAILED = q(/"(Couldn't load your conversation\. Try again in a moment\.)"/);
  const FAILED_SUFFIX = q(/both lines end instead with: "([^"]+)"/);
  const SAVED_SUFFIX = q(/Notice, with a `Reload` button: "Ten has been updated\. Reload to use the new version\. ([^"]+)"/);
  const SENTINEL = "SENTINEL-CONV-7f3a91";
  const consoleLines: string[] = [];
  const watch = (p: any) => p.on("console", (m: any) => consoleLines.push(`${m.type()}: ${m.text()}`));
  const conv = async (uid: string) => (await standIn.sql<any>("select chat_id, messages, older_dropped, version from public.ten_conversations where user_id = $1", [uid]))[0];
  const bubbles = async (p: any) => (await p.locator(".bubble").allTextContents()).map((s: string) => s.trim());
  const textOf = async (p: any, sel: string) => ((await p.locator(sel).first().textContent().catch(() => "")) ?? "").trim();
  const subOf = (l: any) => verifyJwt(/^Bearer (.+)$/.exec(l.auth ?? "")?.[1] ?? "")?.sub;
  const proxyFor = (uid: string) => proxyCalls().filter((l) => subOf(l) === uid).length;
  const plant = (uid: string, chatId: string, messages: unknown[], olderDropped = false) =>
    standIn.sql(
      "insert into public.ten_conversations (user_id, chat_id, messages, older_dropped, version) values ($1, $2, $3::jsonb, $4, left(encode(sha256(convert_to($3::jsonb::text, 'UTF8')), 'hex'), 16))",
      [uid, chatId, JSON.stringify(messages), olderDropped],
    );
  const newerVersion = async (p: any) => {
    await p.route("**/version.json", (r: any) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "zzzzzzz-20990101T000000Z" }) }));
    await p.evaluate(() => window.dispatchEvent(new Event("focus")));
    await p.locator(".version-notice").waitFor({ timeout: 8000 });
  };
  rec(!/copy not found/.test([OLDER, SAVE_FAILED, STALE, CONFLICT, LOAD_FAILED, FAILED_SUFFIX, SAVED_SUFFIX].join("|")), "conversation: every § 1.8/§ 1.9 line was read from the doc", SAVED_SUFFIX);

  // ---- (iv) restore after reload: same messages, same chat id, avatar done, the next request carries them
  {
    const uid = await standIn.createUser({ email: em("conv.user") });
    const { page } = await newPage();
    watch(page);
    await signIn(page, em("conv.user"));
    await page.locator(".empty-state").waitFor({ timeout: 20000 });
    await say(page, "hello there");
    await say(page, "hello again");
    const row = await until(async () => { const r = await conv(uid); return r && r.messages.length === 4 ? r : false; }, 10000);
    rec(!!row, "conversation (iv): two ended turns are saved as one row, 4 messages", JSON.stringify(row ? { chat: row.chat_id, n: row.messages.length } : null));
    rec(true, "conversation (iv): bytes per turn (info, § 11.4 UNVERIFIED 5–20 KB)", `${Math.round(Buffer.byteLength(JSON.stringify(row?.messages ?? [])) / 2)} B/turn for a short text turn`);
    const shown = await bubbles(page);
    const hits0 = stub.hits.length;
    await page.reload();
    await page.locator(".composer-input").waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    eq(await bubbles(page), shown, "conversation (iv): after a reload the same transcript is restored");
    rec(stub.hits.length === hits0, "conversation (iv): restoring makes no model call");
    const av = (await page.locator(".avatar").getAttribute("class")) ?? "";
    rec(av.includes("avatar--done"), "conversation (iv): avatar shows done after a restore", av);
    await say(page, "hello after reload");
    const texts = (stub.hits.slice(-1)[0]?.body?.messages ?? []).map((m: any) => textOfContent(m.content));
    rec(["hello there", "hello again", "Hi — I'm here."].every((s) => texts.some((t: string) => t.includes(s))), "conversation (iv): the next request carries the restored turns");
    const row2 = await until(async () => { const r = await conv(uid); return r && r.messages.length === 6 ? r : false; }, 10000);
    rec(!!row2 && row2.chat_id === row?.chat_id, "conversation (iv): the same chat id after reload (the row was updated, never replaced)", `${row?.chat_id} -> ${row2?.chat_id}`);
    await page.context().close();
  }

  // ---- (v) a cut_off turn, reload: the next turn has its note
  {
    const uid = await standIn.createUser({ email: em("conv.cutoff") });
    await plant(uid, "chat-planted-cutoff", [
      { id: "p-u1", role: "user", metadata: { origin: "typed" }, parts: [{ type: "text", text: "Evaluate all four roles" }] },
      { id: "p-a1", role: "assistant", parts: [{ type: "step-start" }, { type: "text", text: "Writing the verdicts." }, { type: "data-error", data: { code: "cut_off", message: CUT_OFF_MESSAGE, retryable: true } }] },
    ]);
    const { page } = await newPage();
    watch(page);
    await signIn(page, em("conv.cutoff"));
    await page.locator(".composer-input").waitFor({ timeout: 20000 });
    rec(((await page.locator(".card--error").textContent().catch(() => "")) ?? "").includes(CUT_OFF_MESSAGE), "conversation (v): the restored cut_off card shows");
    await say(page, "hello, carry on");
    const sys = textOfContent(stub.hits.slice(-1)[0]?.body?.messages?.[0]?.content);
    rec(sys.trimEnd().endsWith(CUT_OFF_NOTE), "conversation (v): after a restore the next turn's system prompt ends with the § 9.4 cut_off note");
    await page.context().close();
  }

  // ---- (vi) the row owns gate status: approved elsewhere shows approved; a card the cap dropped is expired
  {
    const uid = await standIn.createUser({ email: em("conv.gate") });
    const { page } = await newPage();
    watch(page);
    await signIn(page, em("conv.gate"));
    await page.locator(".empty-state").waitFor({ timeout: 20000 });
    await say(page, "hello there");
    await say(page, "find me roles at five more companies");
    const g = (await db.gates(uid)).slice(-1)[0];
    await until(async () => ((await conv(uid))?.messages ?? []).some((m: any) => JSON.stringify(m).includes(g.id)), 10000);
    await standIn.sql("update public.ten_gate_log set status = 'approved', typed_text = 'yes', decided_at = now() where id = $1", [g.id]);
    await page.reload();
    await page.locator(".composer-input").waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    const card = (await page.locator(`.card--gate[data-gate-id="${g.id}"]`).textContent().catch(() => "")) ?? "";
    rec(card.includes("approved") && !card.includes("pending"), "conversation (vi): a row approved in a turn that was never saved shows approved after reload", card.slice(0, 120));
    rec(!((await page.locator(".avatar").getAttribute("class")) ?? "").includes("needs-you"), "conversation (vi): …and the avatar no longer asks for a yes");
    await page.context().close();

    const uid2 = await standIn.createUser({ email: em("conv.gate.dropped") });
    const gid = randomUUID();
    await standIn.sql(
      "insert into public.ten_gate_log (id, user_id, chat_id, kind, label, text_hash, gate_line, amount_usd) values ($1, $2, 'chat-planted-dropped', 'spend', 'Search more companies', $3, 'This costs up to $2.50 — nothing starts until you say yes.', 2.5)",
      [gid, uid2, "sha256:" + "0".repeat(64)],
    );
    await plant(uid2, "chat-planted-dropped", [
      { id: "d-u9", role: "user", metadata: { origin: "typed" }, parts: [{ type: "text", text: "hello later" }] },
      { id: "d-a9", role: "assistant", parts: [{ type: "text", text: "Hi — I'm here." }] },
    ], true);
    const { page: p2 } = await newPage();
    watch(p2);
    await signIn(p2, em("conv.gate.dropped"));
    await p2.locator(".composer-input").waitFor({ timeout: 20000 });
    const st = (await db.gates(uid2)).find((x) => x.id === gid)?.status;
    rec(st === "expired", "conversation (vi): a pending gate whose card the cap dropped is expired on load (rule 7)", st);
    rec((await textOf(p2, ".conversation-notice--older-dropped")) === OLDER, "conversation (xii): older_dropped shows its § 1.9 line, word for word");
    const first = await p2.evaluate(() => {
      const n = document.querySelector(".conversation-notice--older-dropped");
      const b = document.querySelector(".bubble");
      return !!n && !!b && !!(n.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    rec(first, "conversation (xii): …at the top of the restored transcript");
    await say(p2, "yes");
    rec((await db.gates(uid2)).find((x) => x.id === gid)?.status === "expired", "conversation (vi): a typed yes can't approve the gate whose card was never on screen");
    await p2.context().close();
  }

  // ---- (viii) two tabs: a stale tab's send is not sent; a failed check sends; simultaneous saves -> one wins, the other shows its line
  {
    const uid = await standIn.createUser({ email: em("conv.tabs") });
    const { page: A } = await newPage();
    watch(A);
    await signIn(A, em("conv.tabs"));
    await A.locator(".empty-state").waitFor({ timeout: 20000 });
    await say(A, "hello first");
    await until(async () => ((await conv(uid))?.messages?.length === 2 ? true : false), 10000);
    const { page: B } = await newPage();
    watch(B);
    await signIn(B, em("conv.tabs"));
    await B.locator(".composer-input").waitFor({ timeout: 20000 });
    const { page: C } = await newPage();
    watch(C);
    await signIn(C, em("conv.tabs"));
    await C.locator(".composer-input").waitFor({ timeout: 20000 });
    await say(A, "hello from A");
    await until(async () => ((await conv(uid))?.messages?.length === 4 ? true : false), 10000);
    const n0 = proxyFor(uid);
    await B.locator(".composer-input").fill("hello from B");
    await B.locator(".composer-input").press("Enter");
    await B.waitForTimeout(1500);
    rec(proxyFor(uid) === n0, "conversation (viii): a stale tab's send is not sent (no proxy request)", `${proxyFor(uid) - n0} call(s)`);
    rec((await B.locator(".composer-input").inputValue()) === "hello from B", "conversation (viii): its text stays in the composer, word for word");
    rec((await textOf(B, ".conversation-notice--stale-blocked")) === STALE, "conversation (xii): the stale-tab line, word for word", await textOf(B, ".conversation-notice"));

    await C.route(/\/rest\/v1\/ten_conversations\?select=version/, (r: any) => r.abort());
    await say(C, "hello from C");
    rec(proxyFor(uid) === n0 + 1, "conversation (viii): a failed stale check never blocks — the send goes through");
    await C.waitForTimeout(1200);
    const row = await conv(uid);
    rec(JSON.stringify(row.messages).includes("hello from A") && !JSON.stringify(row.messages).includes("hello from C"), "conversation (viii): the row keeps the winner's history; the stale tab never overwrites or merges");
    rec((await textOf(C, ".conversation-notice--save-conflict")) === CONFLICT, "conversation (xii): the save-conflict line, word for word", await textOf(C, ".conversation-notice"));
    await newerVersion(C);
    const vn = await textOf(C, ".version-notice-text");
    rec(vn.endsWith(FAILED_SUFFIX), "conversation (xii)/ui § 1.8: after a save CONFLICT (this tab's latest reply wasn't saved) the notice ends with the failed-save ending", vn);
    for (const p of [A, B, C]) await p.context().close();
  }

  // ---- a failed save: its line; the notice's failed ending; the next save carries the whole array
  {
    const uid = await standIn.createUser({ email: em("conv.savefail") });
    const { page } = await newPage();
    watch(page);
    await signIn(page, em("conv.savefail"));
    await page.locator(".empty-state").waitFor({ timeout: 20000 });
    await page.route("**/rest/v1/rpc/ten_conversation_save", (r: any) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "injected" }) }));
    await say(page, `hello ${SENTINEL}`);
    await page.waitForTimeout(800);
    rec((await textOf(page, ".conversation-notice--save-failed")) === SAVE_FAILED, "conversation (xii): the save-failed line, word for word", await textOf(page, ".conversation-notice"));
    await newerVersion(page);
    rec((await textOf(page, ".version-notice-text")).endsWith(FAILED_SUFFIX), "conversation (xii)/ui § 1.8: after a failed save the notice ends with the failed-save ending");
    await page.unroute("**/version.json");
    await page.unroute("**/rest/v1/rpc/ten_conversation_save");
    await page.close();
    await page.context().close();
    const { page: p2 } = await newPage();
    watch(p2);
    await signIn(p2, em("conv.savefail"));
    await p2.locator(".empty-state").waitFor({ timeout: 20000 });
    rec(!(await conv(uid)), "conversation: nothing was saved while saves failed");
    await p2.context().close();
  }

  // ---- (xi) logs: the sentinel reaches no console call — failed load, 413, turn error (failed save above)
  {
    const uid = await standIn.createUser({ email: em("conv.logs") });
    await plant(uid, "chat-planted-logs", [
      { id: "l-u1", role: "user", metadata: { origin: "typed" }, parts: [{ type: "text", text: `hello ${SENTINEL}` }] },
      { id: "l-a1", role: "assistant", parts: [{ type: "text", text: `Hi — ${SENTINEL}.` }] },
    ]);
    const { page } = await newPage();
    watch(page);
    await page.route(/\/rest\/v1\/ten_conversations\?select=chat_id/, (r: any) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "injected load failure" }) }));
    await signIn(page, em("conv.logs"));
    await page.locator(".app-shell--config-error").waitFor({ timeout: 20000 });
    const errTxt = ((await page.locator(".app-shell--config-error").textContent()) ?? "").trim();
    rec(errTxt.includes(LOAD_FAILED), "conversation (xii): a failed load goes to the setup error screen with its § 1.9 line", errTxt.slice(0, 120));
    rec((await page.locator(".app-shell--config-error button", { hasText: "Retry" }).count()) === 1 && (await page.locator(".app-shell--config-error button", { hasText: "Sign out" }).count()) === 1, "conversation: …with Retry and Sign out");
    rec((await page.locator(".composer-input").count()) === 0, "conversation: never mounts empty over a saved conversation");
    await page.unroute(/\/rest\/v1\/ten_conversations\?select=chat_id/);
    await page.locator(".app-shell--config-error button", { hasText: "Retry" }).click();
    await page.locator(".composer-input").waitFor({ timeout: 20000 });
    rec((await bubbles(page)).some((b: string) => b.includes(SENTINEL)), "conversation: Retry loads it");
    // a 413 (a message over the proxy's 256 KB) and an upstream turn error
    await page.locator(".composer-input").fill(`hello ${SENTINEL} ` + "x ".repeat(140_000));
    await page.locator(".composer-input").press("Enter");
    await waitSettled(page);
    rec(((await page.locator(".card--error").last().textContent()) ?? "").includes("This turn got too big to send"), "conversation: a 413 shows too_large (§ 12.2)");
    await page.route("**/functions/v1/ten-model-proxy/**", (r: any) => r.fulfill({ status: 503, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: { code: "model_error", message: "The model is temporarily unavailable. Try again." } }) }));
    await say(page, `hello ${SENTINEL} again`);
    await page.context().close();
    const leaked = consoleLines.filter((l) => l.includes(SENTINEL));
    rec(leaked.length === 0, "conversation (xi): the sentinel reached no console call (failed save, failed load, 413, turn error)", leaked.slice(0, 3).join(" | ").slice(0, 400));
    rec(!denoLog.join("").includes(SENTINEL), "conversation (xi): …nor the functions' logs");
  }

  // ---- this tab's own save still in flight is not "another tab" (§ 11.5)
  {
    const uid = await standIn.createUser({ email: em("conv.race") });
    const { page } = await newPage();
    watch(page);
    await signIn(page, em("conv.race"));
    await page.locator(".empty-state").waitFor({ timeout: 20000 });
    await say(page, "hello first");
    await until(async () => ((await conv(uid))?.messages?.length === 2 ? true : false), 10000);
    // the save commits on the server at once; its answer reaches the tab 2.5 s later (a slow network)
    await page.route("**/rest/v1/rpc/ten_conversation_save", async (r: any) => {
      const resp = await r.fetch();
      await sleep(2500);
      await r.fulfill({ response: resp });
    });
    await say(page, "hello second");
    const n0 = proxyFor(uid);
    await page.locator(".composer-input").fill("hello third");
    await page.locator(".composer-input").press("Enter");
    await page.waitForTimeout(3500);
    await waitSettled(page);
    rec(proxyFor(uid) === n0 + 1, "conversation (viii): a send while THIS tab's own save is still in flight is sent (it is not another tab)", `${proxyFor(uid) - n0} call(s); line: ${await textOf(page, ".conversation-notice")}`);
    // § 11.5: the pre-send check runs "under § 10.3's rules (2 s; a failed
    // check never blocks)". An own save that never answers must not hold the
    // candidate's send (or the composer) hostage.
    await page.unroute("**/rest/v1/rpc/ten_conversation_save");
    await page.route("**/rest/v1/rpc/ten_conversation_save", () => new Promise(() => {})); // never answers
    await say(page, "hello fourth");
    const n1 = proxyFor(uid);
    const t0 = Date.now();
    await page.locator(".composer-input").fill("hello fifth");
    await page.locator(".composer-input").press("Enter");
    const sent = await until(async () => (proxyFor(uid) > n1 ? Date.now() - t0 : false), 12000, 100);
    rec(sent !== undefined && sent <= 4000, "conversation (viii): a send while this tab's own save HANGS still goes within the 2 s rule (a failed check never blocks)", sent === undefined ? "not sent within 12 s; composer disabled: " + (await page.locator(".composer-input").isDisabled()) : `${sent} ms`);
    await page.context().close();
  }
});

// ================================================================ LIGHT THEME ALWAYS (owner ruling, 2026-09-24)
// Tester-owned, from design-web-ui.md's dated amendment (e750910): the real
// app renders the v2 LIGHT palette on every screen whatever the OS says,
// color-scheme light from the first paint, and no theme item in its menu
// (rule 8). Every page here emulates prefers-color-scheme: dark.
/** Mean luminance (0–255) of a PNG screenshot region, decoded with zlib. */
function meanLuma(png: Buffer): number {
  let p = 8;
  let w = 0, h = 0, ct = 0;
  const idat: Buffer[] = [];
  while (p < png.length) {
    const len = png.readUInt32BE(p);
    const type = png.toString("ascii", p + 4, p + 8);
    const data = png.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : 3;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      const v = raw[y * (stride + 1) + 1 + x];
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[y * stride + x] = (v + pred) & 0xff;
    }
  }
  let sum = 0;
  for (let i = 0; i < out.length; i += bpp) sum += 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
  return sum / (w * h);
}
await section("theme", async () => {
  const LIGHT_BG = "rgb(247, 242, 234)"; // v2 light --bg, design-web-ui-refresh.md's v2 token table
  const probe = async (p: any, label: string, opts: { root?: boolean; clip?: string } = {}) => {
    const s = await p.evaluate(() => {
      const r = document.querySelector(".app-root") as HTMLElement | null;
      return {
        theme: r?.getAttribute("data-theme") ?? null,
        bg: r ? getComputedStyle(r).getPropertyValue("--bg").trim() : getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
        scheme: getComputedStyle(document.documentElement).colorScheme,
        matchesDark: matchMedia("(prefers-color-scheme: dark)").matches,
      };
    });
    // a dialog sits over a dimming backdrop by design: measure the dialog itself
    const box = opts.clip ? await p.locator(opts.clip).boundingBox() : null;
    const luma = meanLuma(await p.screenshot({ clip: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : { x: 0, y: 0, width: 1280, height: 860 } }));
    rec(s.matchesDark, `theme: ${label} — the page really is under prefers-color-scheme: dark`);
    if (opts.root !== false) rec(s.theme === "light", `theme: ${label} renders data-theme="light"`, String(s.theme));
    rec(s.bg.toLowerCase() === "#f7f2ea", `theme: ${label} uses the light tokens (--bg #f7f2ea)`, s.bg);
    rec(/\blight\b/.test(s.scheme) && !/\bdark\b/.test(s.scheme), `theme: ${label} has native color-scheme light`, s.scheme);
    rec(luma > 200, `theme: ${label} paints light (mean screen luminance ${luma.toFixed(0)}/255)`, luma.toFixed(1));
  };

  // first paint, before React mounts: hold the JS bundle back
  {
    const { page } = await newPage({ colorScheme: "dark", noGoto: true });
    await page.route(/\/assets\/.*\.js$/, async (r: any) => { await sleep(2500); await r.continue(); });
    await page.goto(ORIGIN + "/", { waitUntil: "commit" });
    await page.waitForTimeout(900);
    const mounted = await page.evaluate(() => (document.getElementById("root")?.children.length ?? 0) > 0);
    rec(!mounted, "theme: precondition — the probe runs before React mounts");
    await probe(page, "the first paint (before mount)", { root: false });
    rec((await page.locator('meta[name="color-scheme"]').getAttribute("content")) === "light", "theme: index.html declares <meta name=color-scheme content=light>");
    await page.context().close();
  }
  // loading (the membership check held for 3 s)
  {
    await standIn.createUser({ email: em("theme.loading") });
    const { page } = await newPage({ colorScheme: "dark" });
    await page.route("**/rest/v1/rpc/ten_is_member", async (r: any) => { await sleep(3000); await r.continue(); });
    await signIn(page, em("theme.loading"));
    await page.locator(".app-shell--loading").waitFor({ timeout: 10000 });
    const hasRoot = (await page.locator(".app-root").count()) > 0;
    rec(true, "theme: loading screen has a data-theme root (info; its colours come from :root either way)", String(hasRoot));
    await probe(page, "the loading screen", { root: hasRoot });
    await page.context().close();
  }
  // sign-in, member chat + menu, delete confirm
  {
    await standIn.createUser({ email: em("theme.member") });
    const { page } = await newPage({ colorScheme: "dark" });
    await page.locator(".sign-in-screen").waitFor({ timeout: 20000 });
    await probe(page, "the sign-in screen");
    await signIn(page, em("theme.member"));
    await page.locator(".composer-input").waitFor({ timeout: 20000 });
    await probe(page, "the member chat");
    await page.locator(".menu-trigger").click();
    const items = (await page.getByRole("menuitem").allTextContents()).map((s: string) => s.trim());
    rec(!items.some((t: string) => /switch to (dark|light)/i.test(t)) && items.length > 0, "theme: the real app's menu has no theme item (rule 8)", items.join(" | "));
    await page.getByRole("menuitem", { name: "Delete my beta data" }).click();
    await page.locator(".delete-confirm-card").waitFor();
    await probe(page, "the delete confirmation", { clip: ".delete-confirm-card" });
    await page.context().close();
  }
  // not-a-member
  {
    await standIn.createUser({ email: em("theme.nonmember"), member: false });
    const { page } = await newPage({ colorScheme: "dark" });
    await signIn(page, em("theme.nonmember"));
    await page.locator(".not-a-member-screen").waitFor({ timeout: 20000 });
    await probe(page, "the not-a-member screen");
    await page.context().close();
  }
  // setup error (the conversation load fails)
  {
    await standIn.createUser({ email: em("theme.error") });
    const { page } = await newPage({ colorScheme: "dark" });
    await page.route(/\/rest\/v1\/ten_conversations\?select=chat_id/, (r: any) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "injected" }) }));
    await signIn(page, em("theme.error"));
    await page.locator(".app-shell--config-error").waitFor({ timeout: 20000 });
    await probe(page, "the setup error screen");
    await page.context().close();
  }
  // a host data-theme="dark" on <html> is ignored too
  {
    await standIn.createUser({ email: em("theme.host") });
    const { page } = await newPage({ colorScheme: "dark", noGoto: true });
    await page.addInitScript(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.goto(ORIGIN + "/");
    await signIn(page, em("theme.host"));
    await page.locator(".composer-input").waitFor({ timeout: 20000 });
    const t = await page.evaluate(() => document.querySelector(".app-root")?.getAttribute("data-theme"));
    rec(t === "light", "theme: a host data-theme=\"dark\" on <html> does not change the real app", String(t));
    await page.context().close();
  }
});

// ================================================================ SWITCHABLE MODEL (C § 13)
// Tester-owned, from docs/design-web-agent.md § 13.1–§ 13.6 (approved): the
// real app on the stand-in, the REAL proxy (deno) and the stub upstream, for
// the default build (unset -> Claude), a DeepSeek build, and a mistyped one.
await section("model", async () => {
  const CLAUDE = "anthropic/claude-sonnet-5";
  const DEEPSEEK = "deepseek/deepseek-v4.1-flash";
  const HOSTS: Record<string, string[]> = {
    [CLAUDE]: ["Amazon Bedrock", "Google Vertex AI"],
    [DEEPSEEK]: ["BaseTen", "CoreWeave", "DeepInfra", "DekaLLM", "DigitalOcean", "Fireworks", "Krea", "Makora", "Modal", "Morph", "NextBit", "Novita", "OpenInference", "Parasail", "Phala", "Relace", "Sail Research", "SiliconFlow", "Together", "Venice", "Wafer"],
  };
  const clientBodies = (p: any) => {
    const out: any[] = [];
    p.on("request", (r: any) => {
      if (r.method() === "POST" && r.url().includes("/functions/v1/ten-model-proxy")) {
        try { out.push(r.postDataJSON()); } catch { out.push(null); }
      }
    });
    return out;
  };
  const menuShape = async (p: any) => {
    await p.locator(".menu-trigger").click();
    const shape = await p.evaluate(() => {
      const panel = document.querySelector(".menu-panel")!;
      const kids = [...panel.children] as HTMLElement[];
      const last = kids[kids.length - 1];
      const before = kids[kids.length - 2];
      return {
        lastText: last?.textContent?.trim() ?? "",
        lastTag: last?.tagName ?? "",
        lastRole: last?.getAttribute("role"),
        lastTab: last?.tabIndex ?? null,
        lastFocusable: !!last && (last.matches("a,button,input,select,textarea,[tabindex]") || last.tabIndex >= 0),
        beforeText: before?.textContent?.trim() ?? "",
        beforeHref: before?.getAttribute("href"),
      };
    });
    await p.locator(".menu-trigger").click();
    return shape;
  };
  const privacyCheck = async (p: any, label: string) => {
    const pp = await p.context().newPage();
    const resp = await pp.goto(ORIGIN + "/privacy.html");
    rec(resp?.status() === 200, `model: ${label} — /privacy.html is served from the build`);
    const txt = ((await pp.locator("body").innerText()) ?? "").replace(/\s+/g, " ");
    const missing = ["OpenRouter", "Exa", "2026-09-24", ...HOSTS[CLAUDE], ...HOSTS[DEEPSEEK]].filter((w) => !txt.includes(w));
    rec(missing.length === 0, `model: ${label} — privacy.html names OpenRouter, Exa, the date and every § 13.6 host for both models`, missing.join(", "));
    rec(/DeepSeek's own API/i.test(txt) && /never/i.test(txt), `model: ${label} — privacy.html says DeepSeek's own API is never used`);
    const bg = await pp.evaluate(() => getComputedStyle(document.body).backgroundColor);
    rec(bg === "rgb(247, 242, 234)", `model: ${label} — privacy.html is light-themed (the v2 light --bg)`, bg);
    await pp.close();
  };
  const ledgerModels = async (uid: string) => (await standIn.sql<{ model: string }>("select model from public.ten_usage_ledger where user_id = $1 and kind = 'call' order by created_at", [uid])).map((r) => r.model);
  stub.setScenarios(scenarios([{ name: "model-search", match: /^search acme funding$/, steps: [{ tools: [{ name: "web_search", args: { query: "Acme Series C funding", maxResults: 3 } }] }, { text: "Found it." }] }]));

  // ---- the default build: VITE_COACH_MODEL unset -> Claude
  {
    const uid = await standIn.createUser({ email: em("model.claude") });
    const { page } = await newPage({ colorScheme: "dark" });
    const bodies = clientBodies(page);
    await signIn(page, em("model.claude"));
    await page.locator(".composer-input").waitFor({ timeout: 20000 });
    const m = await menuShape(page);
    rec(m.lastText === "Model: Claude Sonnet 5", "model: unset setting -> the menu's last line is 'Model: Claude Sonnet 5', word for word", m.lastText);
    rec(!m.lastFocusable && m.lastRole !== "menuitem" && !["A", "BUTTON"].includes(m.lastTag), "model: the Model line is plain text, not a focusable control", JSON.stringify(m));
    rec(m.beforeText === "Privacy" && m.beforeHref === "/privacy.html", "model: a Privacy link to /privacy.html sits just above it", JSON.stringify({ t: m.beforeText, h: m.beforeHref }));
    const h0 = stub.hits.length;
    await say(page, "search acme funding");
    const ups = stub.hits.slice(h0);
    rec(bodies.length >= 2 && bodies.every((b) => b?.model === CLAUDE), "model: every browser request (chat + web search) names Claude", JSON.stringify(bodies.map((b) => b?.model)));
    rec(bodies.every((b) => !JSON.stringify(b).includes("cache_control")), "model: the site sets no cache_control itself (§ 13.2)");
    rec(ups.some((h) => h.kind === "web_search") && ups.every((h) => h.body?.model === CLAUDE), "model: the proxy sent Claude upstream for the chat and the search", JSON.stringify(ups.map((h) => [h.kind, h.body?.model])));
    rec(ups.every((h) => JSON.stringify(h.body?.cache_control) === '{"type":"ephemeral"}' && JSON.stringify(h.body?.provider) === '{"data_collection":"deny","zdr":true}'), "model: Claude's upstream keeps the proxy's cache_control and provider exactly as before", JSON.stringify(ups.map((h) => [h.body?.cache_control, h.body?.provider])));
    const lm = await until(async () => { const r = await ledgerModels(uid); return r.length >= 2 ? r : false; }, 10000);
    rec(!!lm && lm.every((x) => x === CLAUDE), "model: every ledger row names Claude", JSON.stringify(lm));
    await privacyCheck(page, "default build");
    await page.context().close();
  }

  // ---- a DeepSeek build (the setting with spaces around it)
  const dsDir = path.join(tmpRoot, "dist-deepseek");
  const bd = build(dsDir, { ...prodEnv, VITE_COACH_MODEL: `  ${DEEPSEEK} ` });
  rec(bd.ok, "model: production build with VITE_COACH_MODEL = DeepSeek", bd.ok ? `${bd.ms} ms` : bd.out.slice(-800));
  if (bd.ok) {
    setRoot(dsDir);
    try {
      const uid = await standIn.createUser({ email: em("model.deepseek") });
      const { page } = await newPage();
      const bodies = clientBodies(page);
      await signIn(page, em("model.deepseek"));
      await page.locator(".composer-input").waitFor({ timeout: 20000 });
      const m = await menuShape(page);
      rec(m.lastText === "Model: DeepSeek V4.1 Flash (testing)", "model: DeepSeek -> 'Model: DeepSeek V4.1 Flash (testing)', word for word, last", m.lastText);
      rec(m.beforeText === "Privacy", "model: Privacy just above it");
      const h0 = stub.hits.length;
      await say(page, "search acme funding");
      const ups = stub.hits.slice(h0);
      rec(bodies.length >= 2 && bodies.every((b) => b?.model === DEEPSEEK), "model: the chat request and the web-search request both name DeepSeek", JSON.stringify(bodies.map((b) => b?.model)));
      rec(bodies.every((b) => !JSON.stringify(b).includes("cache_control")), "model: no cache_control in any DeepSeek browser request");
      rec(ups.some((h) => h.kind === "web_search") && ups.every((h) => h.body?.model === DEEPSEEK), "model: the proxy sent DeepSeek upstream for the chat and the search", JSON.stringify(ups.map((h) => [h.kind, h.body?.model])));
      rec(ups.every((h) => !("cache_control" in (h.body ?? {})) && JSON.stringify(h.body?.provider) === '{"data_collection":"deny","zdr":true,"require_parameters":true}'), "model: DeepSeek's upstream: no cache_control; provider = deny + zdr + require_parameters", JSON.stringify(ups.map((h) => [h.body?.cache_control, h.body?.provider])));
      rec(ups.every((h) => h.body?.max_tokens <= 8192), "model: max_tokens ≤ 8,192 on DeepSeek too");
      const lm = await until(async () => { const r = await ledgerModels(uid); return r.length >= 2 ? r : false; }, 10000);
      rec(!!lm && lm.every((x) => x === DEEPSEEK), "model: every ledger row names DeepSeek", JSON.stringify(lm));
      await privacyCheck(page, "DeepSeek build");
      await page.context().close();
    } finally {
      setRoot(servedProdDir);
    }
  }

  // ---- a mistyped setting: the config screen, never a silent fallback, no model call
  const badDir = path.join(tmpRoot, "dist-badmodel");
  const bb = build(badDir, { ...prodEnv, VITE_COACH_MODEL: "deepseek/deepseek-v4.1-flsh" });
  rec(bb.ok, "model: production build with a mistyped VITE_COACH_MODEL (the build itself succeeds)", bb.ok ? "" : bb.out.slice(-800));
  if (bb.ok) {
    setRoot(badDir);
    try {
      const { page } = await newPage();
      const reqs: string[] = [];
      page.on("request", (r: any) => { if (!r.url().startsWith(ORIGIN)) reqs.push(r.url()); });
      await page.locator(".app-shell--config-error").waitFor({ timeout: 15000 });
      const t = ((await page.locator(".app-shell--config-error").textContent()) ?? "").trim();
      rec(t.includes("VITE_COACH_MODEL"), "model: a mistyped setting shows the configuration screen naming VITE_COACH_MODEL", t);
      rec((await page.locator(".sign-in-form, .composer-input").count()) === 0, "model: …and nothing else mounts (no sign-in, no chat)");
      await page.waitForTimeout(800);
      rec(reqs.length === 0, "model: …and it makes no network call at all (no model call, no Supabase)", reqs.join(" | "));
      await page.context().close();
    } finally {
      setRoot(servedProdDir);
    }
  }
  stub.setScenarios(scenarios());
});

// ================================================================ JWT REFRESH
await section("refresh", async () => {
  // expires_in 95 s: supabase-js refreshes when <= 3 ticks (90 s) remain,
  // so a refresh fires within one 30 s tick of sign-in (and every tick after).
  const uid = await standIn.createUser({ email: em("refresh.user"), expiresIn: 95 });
  const { page } = await newPage();
  await signIn(page, em("refresh.user"));
  await page.locator(".composer-input").waitFor({ timeout: 20000 });
  await say(page, "hello before refresh");
  const firstCount = standIn.issued.get(uid)?.length ?? 0;
  const bubblesBefore = await page.locator(".bubble").count();
  const refreshed = await until(async () => ((standIn.issued.get(uid)?.length ?? 0) > firstCount ? true : false), 70000, 500);
  rec(!!refreshed, "refresh: supabase-js refreshed the session (a new JWT was issued)", `${standIn.issued.get(uid)?.length} token(s)`);
  await page.waitForTimeout(2500);
  const memberChecks = standIn.log.filter((l) => l.path === "/rest/v1/rpc/ten_is_member" && l.origin !== "" && verifyJwt(/^Bearer (.+)$/.exec(l.auth)?.[1] ?? "")?.sub === uid).length;
  rec(memberChecks === 1, "refresh: no re-setup on TOKEN_REFRESHED (ten_is_member() called once, at sign-in)", String(memberChecks));
  const bubblesAfter = await page.locator(".bubble").count().catch(() => 0);
  rec(bubblesAfter === bubblesBefore && bubblesBefore >= 2, "refresh: the transcript survives a TOKEN_REFRESHED (the chat is not torn down)", `bubbles before ${bubblesBefore} after ${bubblesAfter}`);
  await page.locator(".composer-input").waitFor({ timeout: 20000 });
  const n = proxyCalls().length;
  await say(page, "hello after refresh");
  const latest = standIn.issued.get(uid)!.slice(-1)[0];
  const used = proxyCalls().slice(n).map((l) => /^Bearer (.+)$/.exec(l.auth)?.[1]);
  rec(used.length > 0 && used.every((t) => t === latest || standIn.issued.get(uid)!.indexOf(t!) >= firstCount), "refresh: the proxy call after a refresh carries a refreshed JWT, not the first one", `${used.length} call(s)`);
  await page.context().close();
});

// ================================================================ PASSWORDS (C § 16, ui § 1.10)
await section("password", async () => {
  const pw = standIn.pw;
  const S1 = `Sentinel-${BROWSER}-Recover9!`;
  const S2 = `Sentinel-${BROWSER}-Menu9!`;
  const S3 = `Sentinel-${BROWSER}-Secure9!`;
  const sentinels = [S1, S2, S3];
  const codesUsed: string[] = [];
  const reqs: { method: string; url: string; body: string }[] = [];
  const consoleMsgs: string[] = [];
  const snapshots: string[] = [];
  const open = async (url: string, viewport?: { width: number; height: number }) => {
    const { page } = await newPage({ noGoto: true, viewport });
    page.on("request", (r: any) => reqs.push({ method: r.method(), url: r.url(), body: r.postData() ?? "" }));
    page.on("console", (m: any) => consoleMsgs.push(m.text()));
    await page.goto(url);
    return page;
  };
  const snap = async (page: any) => snapshots.push(await page.evaluate(() => JSON.stringify({ ls: { ...localStorage }, ss: { ...sessionStorage }, href: location.href, cookie: document.cookie })));
  const signInWith = async (page: any, email: string, password: string) => {
    await page.locator(".sign-in-mode-toggle button", { hasText: "Email + password" }).click();
    await page.locator(".sign-in-form input[type=email]").fill(email);
    await page.locator(".sign-in-form input[type=password]").fill(password);
    await page.locator(".sign-in-form button[type=submit]").click();
  };
  const memberChecksSince = (t: number) => standIn.log.filter((l) => l.at >= t && l.method === "POST" && l.path === "/rest/v1/rpc/ten_is_member").length;
  const fillPw = async (page: any, p: string) => {
    await page.getByLabel("New password").fill(p);
    await page.getByLabel("Type it again").fill(p);
    await page.getByRole("button", { name: "Save password" }).click();
  };
  const SUCCESS = "Password saved. Use it next time you sign in, here or in the older app.";
  const email = em("pw.reset");
  const uid = await standIn.createUser({ email });

  // ---- forgot: POST /recover with redirect_to = VITE_SITE_URL; success, no account and 429 read the same
  let page = await open(ORIGIN + "/");
  await page.locator(".sign-in-mode-toggle button", { hasText: "Email + password" }).click();
  const cardAfterReset = async (addr: string) => {
    await page.getByRole("button", { name: "Forgot or never set a password?" }).click();
    await page.getByLabel("Email").fill(addr);
    await page.getByRole("button", { name: "Send reset link" }).click();
    const html = await until(async () => {
      const t = (await page.locator(".sign-in-card").textContent()) ?? "";
      return t.includes("If an account exists for") || t.includes("Couldn't send") ? await page.locator(".sign-in-card").innerHTML() : false;
    }, 15000);
    await page.getByRole("button", { name: "Back to sign in" }).click();
    return String(html ?? "");
  };
  const nRec = pw.recovers.length;
  const hasHtml = await cardAfterReset(email);
  const r0 = pw.recovers[nRec];
  eq({ email: r0?.email, redirectTo: r0?.redirectTo, exists: r0?.exists }, { email, redirectTo: ORIGIN, exists: true }, "password: forgot -> POST /auth/v1/recover with the email and redirect_to = VITE_SITE_URL (C § 16.1)");
  rec(hasHtml.includes(`If an account exists for ${email}, a link to choose a new password should arrive within a few minutes.`), "password: forgot -> the § 1.10 enumeration-safe line", hasHtml.slice(0, 200));
  const nobody = em("pw.nobody");
  const noHtml = await cardAfterReset(nobody);
  rec(pw.recovers.at(-1)?.exists === false && noHtml.replaceAll(nobody, "{e}") === hasHtml.replaceAll(email, "{e}"), "password: forgot for an address with no account renders the same card, byte for byte (email aside)");
  pw.recoverRateLimited = true;
  const limitedHtml = await cardAfterReset(email);
  pw.recoverRateLimited = false;
  rec(limitedHtml === hasHtml, "password: forgot answered 429 renders the success card byte for byte (C § 16.2 enumeration)", limitedHtml === hasHtml ? "" : limitedHtml.slice(0, 300));
  await page.context().close();

  // ---- the recovery link, opened in a different browser context (implicit flow: any browser)
  let t0 = Date.now();
  page = await open(ORIGIN + "/" + pw.recoveryHash(email));
  const recShown = await page.getByRole("heading", { name: "Choose a new password" }).waitFor({ timeout: 20000 }).then(() => true, () => false);
  await page.waitForTimeout(1500);
  rec(recShown && memberChecksSince(t0) === 0 && (await page.locator(".composer-input").count()) === 0, "password: a recovery link shows 'Choose a new password', with no ten_is_member call and no chat (C § 16.1)", `shown=${recShown} checks=${memberChecksSince(t0)}`);
  const hrefAfter = await page.evaluate(() => location.href);
  rec(!/access_token|refresh_token|type=recovery/.test(hrefAfter), "password: the recovery link's tokens are gone from the URL", hrefAfter);
  await fillPw(page, S1);
  const saved1 = await page.getByText(SUCCESS).waitFor({ timeout: 15000 }).then(() => true, () => false);
  await page.waitForTimeout(500);
  rec(saved1 && pw.passwordOf(email) === S1 && memberChecksSince(t0) === 0, "password: recovery save -> PUT /auth/v1/user saved it; still no membership check before Continue", `saved=${saved1} checks=${memberChecksSince(t0)}`);
  await snap(page);
  await page.getByRole("button", { name: "Continue" }).click();
  const chat1 = await page.locator(".composer-input").waitFor({ timeout: 20000 }).then(() => true, () => false);
  await page.waitForTimeout(500);
  rec(chat1 && memberChecksSince(t0) === 1, "password: Continue runs the membership check once and a member reaches the chat", `chat=${chat1} checks=${memberChecksSince(t0)}`);

  // ---- the menu: 'Set a new password' above Sign out; secure change off
  await page.getByRole("button", { name: "Menu" }).click();
  const items = await page.locator("[role=menu] [role=menuitem]").allTextContents();
  const iSet = items.findIndex((t: string) => t.trim() === "Set a new password");
  rec(iSet >= 0 && items[iSet + 1]?.trim() === "Sign out", "password: the member ⋯ menu has 'Set a new password' directly above Sign out", items.join(" | "));
  await page.getByRole("menuitem", { name: "Set a new password" }).click();
  const putsBefore = reqs.filter((r) => r.method === "PUT" && r.url.endsWith("/auth/v1/user")).length;
  await fillPw(page, S2);
  const saved2 = await page.getByText(SUCCESS).waitFor({ timeout: 15000 }).then(() => true, () => false);
  const puts = reqs.filter((r) => r.method === "PUT" && r.url.endsWith("/auth/v1/user")).slice(putsBefore);
  const putBody = (() => {
    try {
      const b = JSON.parse(puts[0]?.body ?? "{}");
      return { password: b.password, nonce: b.nonce, email: b.email };
    } catch {
      return {};
    }
  })();
  rec(saved2 && puts.length === 1 && pw.passwordOf(email) === S2, "password: menu, secure change off -> one PUT /auth/v1/user, saved", `puts=${puts.length}`);
  eq(putBody, { password: S2 }, "password: menu, secure change off -> the PUT body carries only the password (no nonce, no email)");
  await page.getByRole("button", { name: "Done" }).click();

  // ---- secure change on, session older than 24 h: code step, wrong code, resend, right code
  pw.secureChange = true;
  pw.staleSessions.add(uid);
  const reauths = () => standIn.log.filter((l) => l.method === "GET" && l.path === "/auth/v1/reauthenticate").length;
  const ra0 = reauths();
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Set a new password" }).click();
  await fillPw(page, S3);
  const codeStep = await page.getByLabel("Code").waitFor({ timeout: 15000 }).then(() => true, () => false);
  const dlg = async () => ((await page.locator("[role=dialog]").textContent()) ?? "").replace(/\s+/g, " ");
  rec(codeStep && reauths() - ra0 === 1 && (await dlg()).includes(`we emailed a 6-digit code to ${email}.`), "password: secure change on -> reauthentication_needed -> one GET /reauthenticate -> the code step names the email", `reauth=${reauths() - ra0} ${(await dlg()).slice(0, 160)}`);
  await page.getByLabel("Code").fill("000000");
  codesUsed.push("000000");
  await page.getByRole("button", { name: "Save password" }).click();
  const wrong = await page.getByText("That code didn't work.", { exact: false }).waitFor({ timeout: 15000 }).then(() => true, () => false);
  rec(wrong && (await page.getByLabel("New password").inputValue()) === S3 && pw.passwordOf(email) === S2, "password: a wrong code -> its § 1.10 line, the password kept, nothing saved");
  await page.getByRole("button", { name: "Send a new code" }).click();
  const resent = await page.getByText(`A new code is on its way to ${email}. Use the newest one.`).waitFor({ timeout: 15000 }).then(() => true, () => false);
  rec(resent && reauths() - ra0 === 2, "password: Send a new code -> a second GET /reauthenticate and the resend line", `reauth=${reauths() - ra0}`);
  const code = pw.codes.get(uid)!.at(-1)!;
  codesUsed.push(code);
  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Save password" }).click();
  const saved3 = await page.getByText(SUCCESS).waitFor({ timeout: 15000 }).then(() => true, () => false);
  const lastPut = reqs.filter((r) => r.method === "PUT" && r.url.endsWith("/auth/v1/user")).at(-1);
  const lastBody = (() => {
    try {
      const b = JSON.parse(lastPut?.body ?? "{}");
      return { password: b.password, nonce: b.nonce };
    } catch {
      return {};
    }
  })();
  rec(saved3 && pw.passwordOf(email) === S3, "password: the right code -> saved");
  eq(lastBody, { password: S3, nonce: code }, "password: the right code's PUT body is { password, nonce }");
  pw.secureChange = false;
  pw.staleSessions.delete(uid);
  await page.getByRole("button", { name: "Done" }).click();
  await snap(page);
  await page.context().close();

  // ---- the new password signs in; the old one no longer does
  page = await open(ORIGIN + "/");
  await signInWith(page, email, PASSWORD);
  const oldRefused = await page.locator(".sign-in-error").waitFor({ timeout: 10000 }).then(() => true, () => false);
  await page.locator(".sign-in-form input[type=password]").fill(S3);
  await page.locator(".sign-in-form button[type=submit]").click();
  const newWorks = await page.locator(".composer-input").waitFor({ timeout: 20000 }).then(() => true, () => false);
  rec(oldRefused && newWorks, "password: after the change the old password is refused and the new one signs in", `old refused=${oldRefused} new works=${newWorks}`);
  await snap(page);
  await page.context().close();

  // ---- a reload during recovery goes on to the app signed in (nothing stored)
  t0 = Date.now();
  page = await open(ORIGIN + "/" + pw.recoveryHash(email));
  await page.getByRole("heading", { name: "Choose a new password" }).waitFor({ timeout: 20000 });
  // let the client finish clearing the hash (a same-document navigation):
  // WebKit cancels a reload that races it ("Navigation canceled by policy check")
  await until(async () => !(await page.evaluate(() => location.hash.includes("access_token"))), 10000);
  await page.waitForTimeout(1000);
  await page.reload().catch(async () => {
    await page.waitForTimeout(1000);
    await page.reload();
  });
  const afterReload = await page.locator(".composer-input").waitFor({ timeout: 20000 }).then(() => true, () => false);
  rec(afterReload && (await page.getByRole("heading", { name: "Choose a new password" }).count()) === 0, "password: a reload during recovery goes on to the app, signed in (C § 16.1: nothing is stored)");
  await snap(page);
  await page.context().close();

  // ---- an expired / used link: the line, then the URL is cleaned
  page = await open(ORIGIN + "/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  const EXPIRED = "That email link has expired or was already used. Ask for a new one below.";
  const expShown = await page.getByText(EXPIRED).waitFor({ timeout: 15000 }).then(() => true, () => false);
  await page.waitForTimeout(500);
  const expHref = await page.evaluate(() => location.href);
  rec(expShown && !/error_code|otp_expired/.test(expHref), "password: an otp_expired link shows the expired line and the URL loses the error", expHref);
  await page.reload();
  await page.locator(".sign-in-screen").waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  rec((await page.getByText(EXPIRED).count()) === 0, "password: a reload doesn't repeat the expired line");
  await page.context().close();

  // ---- 375px: the recovery screen
  page = await open(ORIGIN + "/" + pw.recoveryHash(email), { width: 375, height: 812 });
  await page.getByRole("heading", { name: "Choose a new password" }).waitFor({ timeout: 20000 });
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  rec(sw[0] <= sw[1], "password: the recovery screen has no horizontal scroll at 375px", JSON.stringify(sw));
  await page.context().close();

  // ---- no leak: every sentinel and code only in Supabase Auth request bodies
  const authBody = (r: { method: string; url: string }) =>
    r.url.startsWith(standIn.url + "/auth/v1/") && ((r.method === "PUT" && r.url.endsWith("/auth/v1/user")) || (r.method === "POST" && r.url.includes("/auth/v1/token?grant_type=password")));
  const secrets = [...sentinels, ...codesUsed.filter((c) => c !== "000000")];
  const leaks: string[] = [];
  for (const s of secrets) {
    for (const r of reqs) {
      if (r.url.includes(s)) leaks.push(`URL ${r.method} ${r.url}`);
      if (r.body.includes(s) && !authBody(r)) leaks.push(`body ${r.method} ${r.url}`);
    }
    for (const m of consoleMsgs) if (m.includes(s)) leaks.push(`console: ${m.slice(0, 120)}`);
    for (const x of snapshots) if (x.includes(s)) leaks.push(`storage/url snapshot`);
    for (const l of standIn.log) if ((l.path + l.search).includes(s)) leaks.push(`stand-in URL ${l.method} ${l.path}`);
  }
  const positive = reqs.filter((r) => authBody(r) && sentinels.some((s) => r.body.includes(s))).length;
  rec(positive >= 4 && leaks.length === 0, "password: no leak — the passwords and the code appear only in Supabase Auth request bodies (PUT /user, the password grant); never a URL, the console or storage (C § 16.2)", `auth bodies with a sentinel: ${positive}; leaks: ${[...new Set(leaks)].slice(0, 6).join(" | ")}`);
});

// ================================================================ PHONE (375px)
await section("phone", async () => {
  await standIn.createUser({ email: em("phone.user") });
  const { page } = await newPage({ viewport: { width: 375, height: 812 } });
  await signIn(page, em("phone.user"));
  await page.locator(".empty-state").waitFor({ timeout: 20000 });
  await say(page, "hello from a phone");
  const last = (await lastAssistant(page).textContent().catch(() => "")) ?? "";
  rec(last.includes("Hi — I'm here."), "phone: a turn at 375px", last.slice(0, 120));
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  rec(sw <= 375, "phone: no horizontal scroll at 375px", String(sw));
  await page.context().close();
});

// ================================================================ CORS without interception (item 2)
await section("cors", async () => {
  await noRouteBrowser(BROWSER);
  await standIn.createUser({ email: em("cors.user") });
  const t0 = Date.now();
  const { page } = await newPage({ noRoute: true });
  await signIn(page, em("cors.user"));
  await page.locator(".composer-input").waitFor({ timeout: 20000 });
  await say(page, "hello, real preflight");
  const last = (await lastAssistant(page).textContent().catch(() => "")) ?? "";
  const pre = standIn.log.filter((l) => l.at >= t0 && l.method === "OPTIONS" && l.path.startsWith("/functions/v1/ten-model-proxy"));
  const bad = pre.filter((l) => {
    const allowed = (l.acah ?? "").toLowerCase().split(",").map((x) => x.trim());
    return l.status !== 204 || l.acrh.toLowerCase().split(",").map((x) => x.trim()).filter(Boolean).some((h) => !allowed.includes(h));
  });
  rec(last.includes("Hi — I'm here.") && pre.length > 0 && bad.length === 0, "CORS (no interception): a real preflight reaches the proxy and every requested header is allowed; the turn streams", `${pre.length} preflight(s); requested: ${[...new Set(pre.map((l) => l.acrh))].join(" / ")}; allowed: ${pre[0]?.acah ?? "-"}; reply: ${last.slice(0, 60)}`);
  await page.context().close();
});

// ================================================================ SETUP ERRORS (fix round 1, item 4)
await section("setup", async () => {
  // Force each post-sign-in setup step to fail; expect a plain error screen
  // with Retry and Sign out (never blank), then Retry recovers.
  for (const fn of ["ten_is_member", "ten_ws_write", "ten_balance"]) {
    await standIn.createUser({ email: em(`setup.${fn.replace(/_/g, "")}`) });
    const { page } = await newPage();
    const url = `${standIn.url}/rest/v1/rpc/${fn}`;
    await page.route(url, (r: any) => r.fulfill({ status: 500, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify({ code: "XX000", message: "stand-in: forced failure" }) }));
    await signIn(page, em(`setup.${fn.replace(/_/g, "")}`));
    const shown = await page.locator(".app-shell--config-error").waitFor({ timeout: 15000 }).then(() => true, () => false);
    const text = ((await page.locator(".app-shell--config-error p").allTextContents().catch(() => [])) ?? []).join(" ").trim();
    rec(shown && text.length > 0, `setup: a failing ${fn} -> an error screen, not blank`, text.slice(0, 200));
    const buttons = await page.locator(".app-shell--config-error button").allTextContents();
    rec(buttons.includes("Retry") && buttons.includes("Sign out"), `setup: ${fn} failure offers Retry and Sign out`, buttons.join(" | "));
    rec(!/HTTP|\{|failed:|rpc|ten_[a-z_]+\(/.test(text), `setup: ${fn} failure message is plain (no raw error text)`, text.slice(0, 200));
    await page.unroute(url);
    await page.locator(".app-shell--config-error button", { hasText: "Retry" }).click();
    const recovered = await page.locator(".empty-state").waitFor({ timeout: 15000 }).then(() => true, () => false);
    rec(recovered, `setup: Retry after the ${fn} failure reaches the chat`);
    await page.context().close();
  }
  // Sign out from the error screen
  await standIn.createUser({ email: em("setup.signout") });
  const { page } = await newPage();
  await page.route(`${standIn.url}/rest/v1/rpc/ten_is_member`, (r: any) => r.fulfill({ status: 500, headers: { "access-control-allow-origin": "*" }, body: "{}" }));
  await signIn(page, em("setup.signout"));
  await page.locator(".app-shell--config-error").waitFor({ timeout: 15000 });
  await page.locator(".app-shell--config-error button", { hasText: "Sign out" }).click();
  rec(await page.locator(".sign-in-screen").waitFor({ timeout: 10000 }).then(() => true, () => false), "setup: Sign out from the error screen returns to sign-in");
  await page.context().close();
});

// ================================================================ UPLOAD ERRORS via the UI (item 7)
await section("uploads", async () => {
  const attachErr = async (page: any) =>
    until(async () => ((await page.locator(".composer-attach-error").count()) ? ((await page.locator(".composer-attach-error").textContent()) ?? "") : false), 15000);
  // case-variant clash
  const u1 = await standIn.createUser({ email: em("upload.clash") });
  await standIn.backend.seedObject(u1, "documents/CV.pdf", PDF_BYTES);
  let { page } = await newPage();
  await signIn(page, em("upload.clash"));
  await page.locator(".composer-input").waitFor({ timeout: 20000 });
  await page.locator(".composer-attach-input").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: PDF_BYTES });
  eq(await attachErr(page), "cv.pdf clashes with an existing file or folder (a name that only differs by capitalization counts as a clash).", "upload: a case-variant clash reads the path_conflict message");
  await page.context().close();
  // the 50-object cap
  const u2 = await standIn.createUser({ email: em("upload.cap") });
  for (let i = 0; i < 50; i++) await standIn.backend.seedObject(u2, `documents/f${i}.pdf`, PDF_BYTES);
  ({ page } = await newPage());
  await signIn(page, em("upload.cap"));
  await page.locator(".composer-input").waitFor({ timeout: 20000 });
  await page.locator(".composer-attach-input").setInputFiles({ name: "one-more.pdf", mimeType: "application/pdf", buffer: PDF_BYTES });
  eq(await attachErr(page), "Your workspace is at its file limit. Remove something before uploading more.", "upload: the 51st object reads the workspace-full message");
  await page.context().close();
  // membership lost mid-session
  const u3 = await standIn.createUser({ email: em("upload.lapsed") });
  ({ page } = await newPage());
  await signIn(page, em("upload.lapsed"));
  await page.locator(".composer-input").waitFor({ timeout: 20000 });
  await standIn.sql("delete from public.ten_usage_ledger where user_id = $1 and kind = 'credit'", [u3]);
  await page.locator(".composer-attach-input").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: PDF_BYTES });
  eq(await attachErr(page), NON_MEMBER, "upload: membership lost mid-session reads the non-member sentence");
  await page.context().close();
});

// ================================================================ ENV HANDLING
await section("env", async () => {
  const noEnvDir = path.join(tmpRoot, "dist-noenv");
  const b = build(noEnvDir, {});
  rec(b.ok, "env: a production build with no VITE_ env still builds", `${b.ms} ms`);
  setRoot(noEnvDir);
  const { page } = await newPage();
  await page.waitForTimeout(1500);
  const t = (await page.locator("#root").textContent()) ?? "";
  rec(t.includes("Ten isn't configured") && t.includes("VITE_SUPABASE_URL") && t.includes("VITE_SUPABASE_ANON_KEY"), "env: missing Supabase vars -> a plain config-error screen, not blank", t.trim().slice(0, 200));
  await page.context().close();

  const noSiteDir = path.join(tmpRoot, "dist-nosite");
  const b2 = build(noSiteDir, { VITE_SUPABASE_URL: standIn.url, VITE_SUPABASE_ANON_KEY: ANON_KEY });
  rec(b2.ok, "env: build without VITE_SITE_URL", `${b2.ms} ms`);
  setRoot(noSiteDir);
  const errsBefore = pageErrors.length;
  const { page: p2 } = await newPage();
  await p2.waitForTimeout(2500);
  const t2 = ((await p2.locator("#root").textContent()) ?? "").trim();
  rec(t2.includes("VITE_SITE_URL"), "env: VITE_SITE_URL is required -> missing it names it on a config screen (README: required)", `body=${JSON.stringify(t2.slice(0, 200))} pageerrors=${JSON.stringify(pageErrors.slice(errsBefore)).slice(0, 300)}`);
  await p2.context().close();
  setRoot(servedProdDir);
});

}

for (const b of BROWSER_LIST) {
  BROWSER = b;
  TAG = b;
  exportZip = undefined;
  if (!browsers[b]) {
    try {
      browsers[b] = await browserTypes[b].launch();
    } catch (e) {
      rec(false, `${b}: launch (npx playwright install ${b} in apps/web)`, String(e).slice(0, 200));
      continue;
    }
  }
  console.log(`\n######## ${b}`);
  await runSuite();
}
TAG = "";
BROWSER = "chromium";

// ================================================================ PREVIEW BUILD
await section("preview", async () => {
  const prevDir = path.join(tmpRoot, "dist-preview");
  const b = build(prevDir, { VITE_SHOW_MOCK_CONTROLS: "1" });
  rec(b.ok, "preview: npm run build with VITE_SHOW_MOCK_CONTROLS=1", `${b.ms} ms`);
  const txt = bundleText(prevDir);
  rec(txt.includes("Preview: fixture"), "preview: the preview bundle still has the mock's fixture picker");
  setRoot(prevDir);
  // async spawn: this process also serves the build (a sync spawn would block it)
  const r: { status: number | null; stdout: string } = await new Promise((resolve) => {
    const c = spawn("node", [path.join(REPO, "tests/web/e2e.mjs"), ORIGIN + "/"], { cwd: REPO, env: { ...process.env, SHOTS: tmpRoot } });
    let out = "";
    c.stdout.on("data", (b) => (out += b));
    c.stderr.on("data", (b) => (out += b));
    c.on("exit", (code) => resolve({ status: code, stdout: out }));
  });
  const fails = (r.stdout.match(/^FAIL .*$/gm) ?? []) as string[];
  const passes = (r.stdout.match(/^PASS /gm) ?? []).length;
  if (r.status !== 0 && !fails.length) console.log(r.stdout.slice(-1500));
  rec(r.status === 0 && fails.length === 0, "preview: tests/web/e2e.mjs (the 5a mock e2e) against the preview build", `${passes} pass, ${fails.length} fail${fails.length ? ": " + fails.join(" | ").slice(0, 600) : ""}`);
  setRoot(servedProdDir);
});

// ------------------------------------------------------------------ wrap up
rec(external.length === 0, "network: no browser request left 127.0.0.1 except the stubbed ATS API", external.slice(0, 5).join(" "));
rec(!denoLog.join("").includes("E2E-EXTERNAL-FETCH-REFUSED"), "network: the functions never tried a non-loopback fetch");
const responsesWithKey = standIn.log.filter((l) => l.auth.includes(OPENROUTER_CANARY) || l.apikey.includes(OPENROUTER_CANARY));
rec(responsesWithKey.length === 0, "secrets: the OpenRouter key never appears on any request through the Supabase origin");
const browserSvc = standIn.log.filter((l) => l.origin && (l.auth.includes(SERVICE_KEY) || l.apikey.includes(SERVICE_KEY)));
rec(browserSvc.length === 0, "secrets: no browser (Origin-bearing) request ever carries the service-role key");
if (pageErrors.length) console.log("page errors:\n  " + pageErrors.slice(0, 40).join("\n  "));

for (const b of [...Object.values(browsers), ...Object.values(noRouteBrowsers)]) await b.close();
deno.kill();
await stub.close();
await standIn.close();
await web.close();
if (!process.env.E2E_KEEP) rmSync(tmpRoot, { recursive: true, force: true });
else console.log("kept", tmpRoot);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  "));
  process.exit(1);
}
process.exit(0);
