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
//   node tests/e2e-real/e2e.ts            # everything (4 builds, ~4 min)
//   E2E_ONLY=journey,gate node tests/e2e-real/e2e.ts
//   E2E_FETCH_SHIM=1 node tests/e2e-real/e2e.ts   # DIAGNOSTIC: see newPage()
//   E2E_KEEP=1 keeps the temp dir (builds, failure screenshots)
// Sections: journey import gate balance ceiling member delete refresh phone
// browsers (firefox + webkit: `npx playwright install firefox webkit` in
// apps/web) env preview. Exit code 0 = all PASS; one PASS/FAIL line per assertion.
// Also here: upload-errors.test.ts (node --test), the upload messages over PGlite.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-ignore - resolved from apps/web's own install, like tests/web/e2e.mjs
import { chromium, firefox, webkit } from "../../apps/web/node_modules/playwright/index.mjs";
// @ts-ignore
import { unzipSync } from "../../apps/web/node_modules/fflate/esm/index.mjs";
import { ANON_KEY, JWT_SECRET, SERVICE_KEY, startStandIn, verifyJwt, type StandIn } from "./stand-in.ts";
import { startStubOpenRouter, textOfContent, type Scenario, type StubOpenRouter } from "./stub-openrouter.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const WEB = path.join(REPO, "apps/web");
const ONLY = (process.env.E2E_ONLY ?? "").split(",").filter(Boolean);
const want = (s: string) => ONLY.length === 0 || ONLY.includes(s);
const SHIM = process.env.E2E_FETCH_SHIM === "1";

// A canary standing in for the real OpenRouter key: it lives ONLY in the
// deno host's env. If it ever shows up in the bundle, a browser-visible
// response, or a request the browser makes, the key leaked.
const OPENROUTER_CANARY = "sk-or-v1-E2E-CANARY-0a1b2c3d4e5f60718293a4b5c6d7e8f9";
const PASSWORD = "correct horse battery";

// ------------------------------------------------------------------ results
const results: { ok: boolean; name: string; detail: string }[] = [];
function rec(ok: boolean, name: string, detail = "") {
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
web.setRoot(prodDir);

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
const external: string[] = [];
const atsHits: string[] = [];
const pageErrors: string[] = [];

async function newPage(opts: { browser?: string; viewport?: { width: number; height: number } } = {}) {
  const ctx = await browsers[opts.browser ?? "chromium"].newContext({ viewport: opts.viewport ?? { width: 1280, height: 860 }, acceptDownloads: true });
  await ctx.route("**/*", async (route: any) => {
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
  page.on("pageerror", (e: Error) => pageErrors.push(`${opts.browser ?? "chromium"}: ${e.message}`));
  await page.addInitScript(() => {
    (window as any).__states = new Set();
    setInterval(() => {
      const a = document.querySelector(".avatar");
      if (a) for (const c of a.classList) if (c.startsWith("avatar--")) (window as any).__states.add(c.slice(8));
    }, 10);
  });
  await page.goto(ORIGIN + "/");
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

// B1 mechanism, always run WITHOUT the shim: a store/gate built as
// { fetchImpl: fetch } and called as o.fetchImpl(...) — what
// apps/web/src/backend/supabase-workspace-store.ts and gate.ts do.
{
  const ctx = await browsers.chromium.newContext();
  const pg = await ctx.newPage();
  await pg.goto(ORIGIN + "/");
  const r = await pg.evaluate(async () => {
    const o = { fetchImpl: window.fetch };
    try {
      await o.fetchImpl(location.href);
      return "ok";
    } catch (e) {
      return String((e as Error).message);
    }
  });
  rec(r === "ok", "browser: calling window.fetch as o.fetchImpl(...) (the store's/gate's call shape) works", r);
  await ctx.close();
}
if (SHIM) console.log("\n*** E2E_FETCH_SHIM=1: window.fetch is shimmed to ignore its receiver (diagnostic run; see B1) ***");
async function section(name: string, fn: () => Promise<void>) {
  if (!want(name)) return;
  console.log(`\n=== ${name}`);
  try {
    await fn();
  } catch (e) {
    rec(false, `${name}: section threw`, String((e as Error)?.stack ?? e).slice(0, 1500));
    for (const b of Object.values(browsers)) {
      for (const c of b.contexts()) {
        for (const pg of c.pages()) {
          const f = path.join(tmpRoot, `fail-${name}-${failShots.length}.png`);
          await pg.screenshot({ path: f, fullPage: true }).catch(() => {});
          failShots.push(f);
          console.log("  screenshot:", f, " body:", ((await pg.locator("body").textContent().catch(() => "")) ?? "").slice(0, 300));
        }
        await c.close().catch(() => {});
      }
    }
  }
}

let journeyUid = "";
let exportZip: Buffer | undefined;

// ================================================================ JOURNEY
await section("journey", async () => {
  const uid = await standIn.createUser({ email: "jordan.alvarez.demo@example.com" });
  journeyUid = uid;
  const { page } = await newPage();
  rec(await page.locator(".sign-in-screen").waitFor({ timeout: 15000 }).then(() => true, () => false), "journey: signed out -> the sign-in screen (design-web-ui § 1.4)");
  await signIn(page, "jordan.alvarez.demo@example.com");
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

  // ---- upload a résumé PDF
  await page.locator(".composer-attach-input").setInputFiles({ name: "jordan-alvarez-resume.pdf", mimeType: "application/pdf", buffer: PDF_BYTES });
  await page.waitForFunction(() => (document.querySelector(".composer-input") as HTMLTextAreaElement).value.includes("documents/"), null, { timeout: 15000 });
  const composerAfterAttach = await page.locator(".composer-input").inputValue();
  rec(composerAfterAttach.includes("documents/jordan-alvarez-resume.pdf"), "journey: attach uploads to documents/<name> before sending", composerAfterAttach);
  const objs = await db.objects(uid);
  eq(objs.map((o) => o.name), [`users/${uid}/ws/documents/jordan-alvarez-resume.pdf`], "journey: the PDF is one Storage object at users/{uid}/ws/documents/…");
  const stored = standIn.backend.objectBytes.get(`users/${uid}/ws/documents/jordan-alvarez-resume.pdf`);
  rec(!!stored && Buffer.from(stored).equals(PDF_BYTES), "journey: stored bytes == uploaded bytes");
  // a second attach of the same name -> -2 (§ 2: then -2, -3 on a clash)
  await page.locator(".composer-input").fill("");
  await page.locator(".composer-attach-input").setInputFiles({ name: "jordan-alvarez-resume.pdf", mimeType: "application/pdf", buffer: PDF_BYTES });
  await page.waitForFunction(() => (document.querySelector(".composer-input") as HTMLTextAreaElement).value.includes("documents/"), null, { timeout: 15000 });
  rec((await page.locator(".composer-input").inputValue()).includes("documents/jordan-alvarez-resume-2.pdf"), "journey: re-attaching the same name lands at …-2.pdf", await page.locator(".composer-input").inputValue());
  await page.locator(".composer-input").fill("hi, here's my resume\nAttached `documents/jordan-alvarez-resume.pdf`.");
  const hitsBefore = stub.hits.length;
  await page.locator(".composer-input").press("Enter");
  await waitSettled(page);
  const turnHits = stub.hits.slice(hitsBefore);
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
  rec(atsHits.length === 1 && atsHits[0] === "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4102938", "journey/verdict: fetch_job called the Greenhouse board API (stubbed)", atsHits.join(" "));
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
  await page.waitForTimeout(700);
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
  const pc = proxyCalls();
  const allUserJwt = pc.every((l) => {
    const tok = /^Bearer (.+)$/.exec(l.auth)?.[1] ?? "";
    const c = verifyJwt(tok);
    return c?.sub === uid && c?.role === "authenticated";
  });
  rec(pc.length > 0 && allUserJwt, "auth: every proxy call carries the user's Supabase session JWT (§ 8)", `${pc.length} calls`);
  rec(pc.every((l) => l.path === "/functions/v1/ten-model-proxy/chat/completions"), "env: VITE_MODEL_PROXY_URL unset -> <SUPABASE_URL>/functions/v1/ten-model-proxy (the default)");
  rec(stub.hits.every((h) => h.auth === `Bearer ${OPENROUTER_CANARY}`), "auth: upstream calls carry the host-side OpenRouter key only (never the JWT)");
  rec(stub.hits.every((h) => !JSON.stringify(h.body).includes("eyJ")), "auth: no JWT in any upstream body");
  rec(stub.hits.filter((h) => h.kind === "chat").every((h) => h.body.model === "anthropic/claude-sonnet-5" && h.body.stream === true && h.body.provider?.zdr === true), "proxy: upstream body forced (model, stream, provider zdr)");

  // ---- balance chip from ten_balance(), after metering lands
  const metered = await until(async () => {
    const l = (await db.ledger(uid)).filter((r) => r.kind === "call");
    return l.length === stub.hits.length ? l : false;
  }, 15000);
  rec(!!metered, "meter: one ledger call row per proxy call", `${(await db.ledger(uid)).filter((r) => r.kind === "call").length} rows / ${stub.hits.length} calls`);
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
  const expectedCount = dbFiles.length + (await db.objects(uid)).length;
  rec(textOk && binOk && Object.keys(entries).filter((k) => !k.endsWith("/")).length === expectedCount, "export: zip == every text row + every object, byte for byte, same folder shape", `${Object.keys(entries).length} entries`);
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
  const uid = await standIn.createUser({ email: "import.target@example.com" });
  const { page } = await newPage();
  await signIn(page, "import.target@example.com");
  await page.locator(".empty-state").waitFor({ timeout: 20000 });
  const zipPath = path.join(tmpRoot, "export-a.zip");
  await page.locator('input[accept=".zip"]').setInputFiles(zipPath);
  const got = await until(async () => ((await db.files(uid)).length > 3 ? true : false), 20000);
  rec(!!got, "import: the exported zip imports into a fresh workspace (holding only CLAUDE.md)");
  const a = await db.files(journeyUid);
  const b = await db.files(uid);
  eq(b.map((f) => [f.path, sha256(f.content)]), a.map((f) => [f.path, sha256(f.content)]), "import: text files identical to the source workspace");
  const ao = (await db.objects(journeyUid)).map((o) => o.name.replace(`users/${journeyUid}/ws/`, ""));
  const bo = (await db.objects(uid)).map((o) => o.name.replace(`users/${uid}/ws/`, ""));
  eq(bo, ao, "import: binaries identical paths to the source workspace");
  // import into a now non-empty workspace is refused with a visible message
  await page.locator('input[accept=".zip"]').setInputFiles(zipPath);
  const refused = await until(async () => ((await page.locator(".import-error").count()) ? (await page.locator(".import-error").textContent()) : false), 10000);
  rec(!!refused, "import: a second import into a non-empty workspace is refused, shown to the candidate", String(refused ?? "").slice(0, 160));
  await page.context().close();
});

// ================================================================ SPEND GATE
await section("gate", async () => {
  const uid = await standIn.createUser({ email: "gate.user@example.com" });
  const { page } = await newPage();
  await signIn(page, "gate.user@example.com");
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
  // leave a pending gate, reload (new chat) -> the old pending row expires
  await say(page, "find me roles at ten more companies");
  const pend = (await db.gates(uid)).slice(-1)[0];
  rec(pend?.status === "pending", "gate: a second gate opened (pending) before reload");
  await page.reload();
  await page.locator(".composer-input").waitFor({ timeout: 20000 });
  await say(page, "hello again");
  const expired = (await db.gates(uid)).find((g) => g.id === pend?.id);
  rec(expired?.status === "expired", "gate: a reload starts a new chat; its first turn expires the older chat's pending gate (§ 3)", JSON.stringify(expired?.status));
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
  const uid = await standIn.createUser({ email: "broke.user@example.com" });
  await db.addCall(uid, 5.0);
  const { page } = await newPage();
  await signIn(page, "broke.user@example.com");
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
  const uid2 = await standIn.createUser({ email: "midrun.user@example.com" });
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
  await signIn(p2, "midrun.user@example.com");
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
  const uid3 = await standIn.createUser({ email: "rounding.user@example.com" });
  await db.addCall(uid3, 0.433);
  const { page: p3 } = await newPage();
  await signIn(p3, "rounding.user@example.com");
  await p3.locator(".composer-input").waitFor({ timeout: 20000 });
  const c3 = await until(async () => ((await chip(p3)) !== "—" ? await chip(p3) : false), 8000);
  rec(c3 === "$4.56", "balance: $4.567 shows $4.56 (rounded down to the cent)", String(c3));
  await page.context().close();
  await p2.context().close();
  await p3.context().close();
});

// ================================================================ BETA CEILING
await section("ceiling", async () => {
  const other = await standIn.createUser({ email: "ceiling.other@example.com" });
  const uid = await standIn.createUser({ email: "ceiling.user@example.com" });
  await db.addCall(other, 5.0, 0); // today: the beta-wide $5 is spent
  const { page } = await newPage();
  await signIn(page, "ceiling.user@example.com");
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
  await standIn.sql("delete from public.ten_usage_ledger where user_id = $1", [other]);
  void uid;
  await page.context().close();
});

// ================================================================ NOT A MEMBER
await section("member", async () => {
  await standIn.createUser({ email: "not.member@example.com", member: false });
  const { page } = await newPage();
  await signIn(page, "not.member@example.com");
  await page.locator(".not-a-member-screen").waitFor({ timeout: 20000 });
  const t = (await page.locator(".not-a-member-screen").textContent()) ?? "";
  rec(t.includes("Ten is in a private beta. Ask the person who invited you for access."), "not-a-member: C § 8's sentence", t);
  rec(!(await page.locator(".composer-input").count()) && !(await page.locator(".balance-chip").count()) && !(await page.locator(".avatar").count()), "not-a-member: no composer, no chip, no avatar (§ 1.6)");
  // the proxy refuses a non-member directly (403) even with a valid session
  const status = await page.evaluate(async (u: string) => {
    const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
    const tok = key ? JSON.parse(localStorage.getItem(key)!).access_token : "";
    const r = await fetch(`${u}/functions/v1/ten-model-proxy/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) });
    return [r.status, await r.text()];
  }, standIn.url);
  rec(status[0] === 403 && String(status[1]).includes("private beta"), "not-a-member: the proxy answers 403 to a signed-in non-member", JSON.stringify(status));
  await page.locator(".not-a-member-screen button", { hasText: "Sign out" }).click();
  await page.locator(".sign-in-screen").waitFor({ timeout: 10000 });
  rec(true, "not-a-member: sign out returns to sign-in");
  await page.context().close();
});

// ================================================================ DELETE BETA DATA
await section("delete", async () => {
  const uid = await standIn.createUser({ email: "delete.user@example.com" });
  const { page } = await newPage();
  await signIn(page, "delete.user@example.com");
  await page.locator(".empty-state").waitFor({ timeout: 20000 });
  await page.locator(".composer-attach-input").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: PDF_BYTES });
  await page.waitForFunction(() => (document.querySelector(".composer-input") as HTMLTextAreaElement).value.includes("documents/"), null, { timeout: 15000 });
  await say(page, "hello there"); // one measured step so the next estimate prices from this chat
  await say(page, "find me roles at five more companies"); // a gate row + call rows
  const before = { files: (await db.files(uid)).length, objs: (await db.objects(uid)).length, gates: (await db.gates(uid)).length, ledger: await db.ledger(uid) };
  rec(before.files >= 1 && before.objs === 1 && before.gates === 1 && before.ledger.some((r) => r.kind === "call"), "delete: seeded workspace, object, gate row, call rows", JSON.stringify({ ...before, ledger: before.ledger.length }));
  await page.locator(".menu-trigger").click();
  await page.getByRole("menuitem", { name: "Delete my beta data" }).click();
  const dlg = page.locator(".delete-confirm-card");
  const dText = (await dlg.textContent()) ?? "";
  rec(dText.includes("your workspace files, your gate log, and your credit"), "delete: names the complete thing (§ 1.7.1)");
  rec(
    dText.includes("This deletes your Ten beta data. Your sign-in stays because it's shared with the older app. Unused credit is forfeited. Your usage records, which show only amounts spent and no content, are kept."),
    "delete: C § 8's sentence word for word, incl. the kept-usage sentence (§ 1.7.2)",
  );
  const fnCalls = () => standIn.log.filter((l) => l.path === "/functions/v1/ten-delete-account" && l.method === "POST").length;
  const input = dlg.locator("input[type=text]");
  await input.fill("sure");
  await input.press("Enter");
  await page.waitForTimeout(600);
  rec(fnCalls() === 0 && (await dlg.locator("input[type=text]").count()) === 1, "delete: 'sure' does nothing (only an exact typed yes)");
  await input.fill("");
  await dlg.locator("button[type=submit]").click();
  await page.waitForTimeout(400);
  rec(fnCalls() === 0, "delete: clicking the button with no typed yes does nothing");
  const btnLabels = await dlg.locator("button").allTextContents();
  rec(!btnLabels.some((b) => /^(delete|confirm|yes)/i.test(b.trim())), "delete: no button that confirms by itself", btnLabels.join(" | "));
  await input.fill("yes");
  await input.press("Enter");
  const done = await until(async () => ((await page.getByText("Deleted. You're signed out of Ten").count()) ? true : false), 15000);
  rec(!!done, "delete: typed yes -> the function ran -> the report-back line (§ 1.7.4)");
  const call = standIn.log.find((l) => l.path === "/functions/v1/ten-delete-account" && l.method === "POST");
  rec(fnCalls() === 1 && verifyJwt(/^Bearer (.+)$/.exec(call?.auth ?? "")?.[1] ?? "")?.sub === uid && call?.status === 200, "delete: ten-delete-account called once, with the user's JWT, 200", JSON.stringify({ n: fnCalls(), status: call?.status }));
  const afterL = await db.ledger(uid);
  rec((await db.files(uid)).length === 0 && (await db.objects(uid)).length === 0 && (await db.gates(uid)).length === 0, "delete: no text rows, no objects, no gate rows left");
  rec(!afterL.some((r) => r.kind === "credit") && afterL.filter((r) => r.kind === "call").length === before.ledger.filter((r) => r.kind === "call").length, "delete: credit rows gone, call rows kept (§ 8)");
  rec((await standIn.sql("select 1 from auth.users where id = $1", [uid])).length === 1, "delete: the shared sign-in (auth user) is kept");
  await page.locator(".delete-confirm-card button", { hasText: "OK" }).click();
  await page.locator(".sign-in-screen").waitFor({ timeout: 10000 });
  rec(true, "delete: OK -> signed out to the sign-in screen");
  await signIn(page, "delete.user@example.com");
  await page.locator(".not-a-member-screen").waitFor({ timeout: 20000 });
  rec(true, "delete: signing back in -> not a member (the credit is gone)");
  // decline path, fresh user
  const uid2 = await standIn.createUser({ email: "delete.decline@example.com" });
  const { page: p2 } = await newPage();
  await signIn(p2, "delete.decline@example.com");
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

// ================================================================ JWT REFRESH
await section("refresh", async () => {
  // expires_in 95 s: supabase-js refreshes when <= 3 ticks (90 s) remain,
  // so a refresh fires within one 30 s tick of sign-in (and every tick after).
  const uid = await standIn.createUser({ email: "refresh.user@example.com", expiresIn: 95 });
  const { page } = await newPage();
  await signIn(page, "refresh.user@example.com");
  await page.locator(".composer-input").waitFor({ timeout: 20000 });
  await say(page, "hello before refresh");
  const firstCount = standIn.issued.get(uid)?.length ?? 0;
  const bubblesBefore = await page.locator(".bubble").count();
  const refreshed = await until(async () => ((standIn.issued.get(uid)?.length ?? 0) > firstCount ? true : false), 70000, 500);
  rec(!!refreshed, "refresh: supabase-js refreshed the session (a new JWT was issued)", `${standIn.issued.get(uid)?.length} token(s)`);
  await page.waitForTimeout(2500);
  const memberChecks = standIn.log.filter((l) => l.path === "/rest/v1/rpc/ten_is_member" && verifyJwt(/^Bearer (.+)$/.exec(l.auth)?.[1] ?? "")?.sub === uid).length;
  rec(true, "refresh: ten_is_member() calls for this user so far (info: 1 = checked once at sign-in)", String(memberChecks));
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

// ================================================================ PHONE (375px)
await section("phone", async () => {
  await standIn.createUser({ email: "phone.user@example.com" });
  const { page } = await newPage({ viewport: { width: 375, height: 812 } });
  await signIn(page, "phone.user@example.com");
  await page.locator(".empty-state").waitFor({ timeout: 20000 });
  await say(page, "hello from a phone");
  const last = (await lastAssistant(page).textContent().catch(() => "")) ?? "";
  rec(last.includes("Hi — I'm here."), "phone: a turn at 375px", last.slice(0, 120));
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  rec(sw <= 375, "phone: no horizontal scroll at 375px", String(sw));
  await page.context().close();
});

// ================================================================ OTHER BROWSERS (CORS)
await section("browsers", async () => {
  for (const [name, bt] of [["firefox", firefox], ["webkit", webkit]] as const) {
    try {
      browsers[name] = await bt.launch();
    } catch (e) {
      rec(false, `${name}: launch`, String(e).slice(0, 200));
      continue;
    }
    await standIn.createUser({ email: `${name}.user@example.com` });
    const { page } = await newPage({ browser: name });
    await signIn(page, `${name}.user@example.com`);
    await page.locator(".composer-input").waitFor({ timeout: 30000 });
    await say(page, "hello from another browser");
    const last = (await lastAssistant(page).textContent().catch(() => "")) ?? "";
    const pre = standIn.log.filter((l) => l.method === "OPTIONS" && l.path.startsWith("/functions/v1/ten-model-proxy")).slice(-1)[0];
    rec(last.includes("Hi — I'm here."), `${name}: a model turn streams through the proxy (CORS preflight passes)`, `${last.slice(0, 200)} | last preflight asked for: ${pre?.acrh ?? "(none)"}`);
    await page.context().close();
  }
});

// ================================================================ ENV HANDLING
await section("env", async () => {
  const noEnvDir = path.join(tmpRoot, "dist-noenv");
  const b = build(noEnvDir, {});
  rec(b.ok, "env: a production build with no VITE_ env still builds", `${b.ms} ms`);
  web.setRoot(noEnvDir);
  const { page } = await newPage();
  await page.waitForTimeout(1500);
  const t = (await page.locator("body").textContent()) ?? "";
  rec(t.includes("Ten isn't configured") && t.includes("VITE_SUPABASE_URL") && t.includes("VITE_SUPABASE_ANON_KEY"), "env: missing Supabase vars -> a plain config-error screen, not blank", t.trim().slice(0, 200));
  await page.context().close();

  const noSiteDir = path.join(tmpRoot, "dist-nosite");
  const b2 = build(noSiteDir, { VITE_SUPABASE_URL: standIn.url, VITE_SUPABASE_ANON_KEY: ANON_KEY });
  rec(b2.ok, "env: build without VITE_SITE_URL", `${b2.ms} ms`);
  web.setRoot(noSiteDir);
  const errsBefore = pageErrors.length;
  const { page: p2 } = await newPage();
  await p2.waitForTimeout(2500);
  const t2 = ((await p2.locator("body").textContent()) ?? "").trim();
  rec(t2.includes("VITE_SITE_URL"), "env: VITE_SITE_URL is required -> missing it names it on a config screen (README: required)", `body=${JSON.stringify(t2.slice(0, 200))} pageerrors=${JSON.stringify(pageErrors.slice(errsBefore)).slice(0, 300)}`);
  await p2.context().close();
  web.setRoot(prodDir);
});

// ================================================================ PREVIEW BUILD
await section("preview", async () => {
  const prevDir = path.join(tmpRoot, "dist-preview");
  const b = build(prevDir, { VITE_SHOW_MOCK_CONTROLS: "1" });
  rec(b.ok, "preview: npm run build with VITE_SHOW_MOCK_CONTROLS=1", `${b.ms} ms`);
  const txt = bundleText(prevDir);
  rec(txt.includes("Preview: fixture"), "preview: the preview bundle still has the mock's fixture picker");
  web.setRoot(prevDir);
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
  web.setRoot(prodDir);
});

// ------------------------------------------------------------------ wrap up
rec(external.length === 0, "network: no browser request left 127.0.0.1 except the stubbed ATS API", external.slice(0, 5).join(" "));
rec(!denoLog.join("").includes("E2E-EXTERNAL-FETCH-REFUSED"), "network: the functions never tried a non-loopback fetch");
const responsesWithKey = standIn.log.filter((l) => l.auth.includes(OPENROUTER_CANARY) || l.apikey.includes(OPENROUTER_CANARY));
rec(responsesWithKey.length === 0, "secrets: the OpenRouter key never appears on any request through the Supabase origin");
const browserSvc = standIn.log.filter((l) => l.origin && (l.auth.includes(SERVICE_KEY) || l.apikey.includes(SERVICE_KEY)));
rec(browserSvc.length === 0, "secrets: no browser (Origin-bearing) request ever carries the service-role key");
if (pageErrors.length) console.log("page errors:\n  " + pageErrors.slice(0, 20).join("\n  "));

for (const b of Object.values(browsers)) await b.close();
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
