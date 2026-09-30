// Tester-owned (issue #33 prerequisite, branch fix/headless-real-scripts):
// the headless runner (packages/agent/bin/run.mjs) must hand the model the
// same skill bundle and the same script behaviour as the web app
// (apps/web/src/real/deps.ts), so a headless measurement of the
// plain-replies rule (docs/design-plain-replies.md § 4, "The web host")
// sees the checker output where raw status names leak.
//
// Derived from the web app's own wiring, not the coder's test:
//  - the bundle: the web app's REAL import.meta.glob (apps/web/src/backend/
//    skills-bundle.ts), evaluated by Vite itself in SSR mode (no browser
//    build), vs. the disk reader bin/run.mjs uses;
//  - the scripts: bin/run.mjs end to end with a --import preload that
//    replaces fetch (NO network, NO real key — a planted fake), scripting
//    an OpenRouter tool call to `bash`, then reading the tool result the
//    runner sent back to the "model" in the second request.
// Workspaces are fresh temp copies of a repo fixture only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildSkillBundleFromDisk } from "../../packages/agent/src/skills/skill-bundle-fs.ts";
import { AGENT, REPO, tmp } from "./_support.ts";

const WEB = path.join(REPO, "apps/web");
const BIN = path.join(AGENT, "bin/run.mjs");
const FIXTURE = path.join(REPO, "tests/always-on/fixtures/apply");
const FAKE_KEY = "sk-or-v1-TESTERFAKE-headless-parity-0000";

// ------------------------------------------------------------ 1. bundle parity

async function webGlobBundle(): Promise<Record<string, string>> {
  const vite: any = await import(path.join(WEB, "node_modules/vite/dist/node/index.js"));
  const server = await vite.createServer({
    root: WEB,
    configFile: false,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const mod = await server.ssrLoadModule("/src/backend/skills-bundle.ts");
    return { ...mod.buildSkillBundle() };
  } finally {
    await server.close();
  }
}

test("bundle parity: the web app's own glob (run by Vite) and bin/run.mjs's disk reader yield the same keys AND contents over the real skills/", async () => {
  const web = await webGlobBundle();
  const disk = await buildSkillBundleFromDisk(path.join(REPO, "skills"));
  const wk = Object.keys(web).sort();
  const dk = Object.keys(disk).sort();
  assert.ok(wk.length > 20, `web glob found ${wk.length} files`);
  assert.deepEqual(
    { onlyWeb: wk.filter((k) => !(k in disk)), onlyDisk: dk.filter((k) => !(k in web)) },
    { onlyWeb: [], onlyDisk: [] },
  );
  for (const k of wk) assert.equal(disk[k], web[k], `content differs: ${k}`);
  assert.deepEqual(dk.filter((k) => k.includes("__pycache__") || k.endsWith(".pyc")), []);
});

// The same exclusions over a synthetic tree, using Vite's own glob engine
// (tinyglobby) with the options Vite 8's transformGlobImport passes
// (dot: false, expandDirectories: false, ignore **/node_modules/**,
// extglob: false) and the three patterns skills-bundle.ts declares.
async function viteGlobKeys(root: string): Promise<string[]> {
  const { glob }: any = await import(path.join(WEB, "node_modules/tinyglobby/dist/index.mjs"));
  const files: string[] = await glob(["skills/**/*", "!skills/**/__pycache__/**", "!skills/**/*.pyc"], {
    cwd: root,
    dot: false,
    expandDirectories: false,
    ignore: ["**/node_modules/**"],
    extglob: false,
  });
  return files.map((f) => f.split(path.sep).join("/")).sort();
}

function syntheticTree(extra?: (skills: string) => void): string {
  const root = tmp("headless-parity-tree-");
  const s = path.join(root, "skills");
  const put = (rel: string, body = "x") => {
    mkdirSync(path.dirname(path.join(s, rel)), { recursive: true });
    writeFileSync(path.join(s, rel), body);
  };
  put("a/SKILL.md");
  put("a/scripts/check.mjs");
  put("a/scripts/__pycache__/check.cpython-311.pyc");
  put("a/scripts/stray.pyc");
  put("a/.hidden");
  put("a/.dotdir/inside.md");
  extra?.(s);
  return root;
}

test("bundle parity (synthetic): __pycache__/, *.pyc, dotfiles and dot-dirs are excluded identically", async () => {
  const root = syntheticTree();
  const disk = Object.keys(await buildSkillBundleFromDisk(path.join(root, "skills"))).sort();
  assert.deepEqual(disk, await viteGlobKeys(root));
  assert.deepEqual(disk, ["skills/a/SKILL.md", "skills/a/scripts/check.mjs"]);
});

test("bundle parity (synthetic): a node_modules/ dir under skills/ — Vite ignores it", { todo: "FINDING (low): skill-bundle-fs.ts has no node_modules exclusion; Vite's glob ignores **/node_modules/**. No node_modules under skills/ today." }, async () => {
  const root = syntheticTree((s) => {
    mkdirSync(path.join(s, "a/node_modules/pkg"), { recursive: true });
    writeFileSync(path.join(s, "a/node_modules/pkg/index.js"), "x");
  });
  const disk = Object.keys(await buildSkillBundleFromDisk(path.join(root, "skills"))).sort();
  assert.deepEqual(disk, await viteGlobKeys(root));
});

test("bundle parity (synthetic): a symlinked file under skills/ — Vite follows it", { todo: "FINDING (low): skill-bundle-fs.ts drops symlinked files (Dirent.isFile() is false); Vite's glob includes them. No symlinks under skills/ today." }, async () => {
  const root = syntheticTree((s) => symlinkSync(path.join(s, "a/SKILL.md"), path.join(s, "a/link.md")));
  const disk = Object.keys(await buildSkillBundleFromDisk(path.join(root, "skills"))).sort();
  assert.deepEqual(disk, await viteGlobKeys(root));
});

// ------------------------------------------------------------ 2. end to end through bin/run.mjs

/** A fetch replacement: request 1 answers with ONE OpenRouter tool call to
 *  `bash` running `command`; every later request answers with plain text.
 *  Every request body is recorded, so the test reads exactly what the
 *  runner sent the model. */
function preload(command: string): { file: string; log: string } {
  const dir = tmp("headless-parity-preload-");
  const log = path.join(dir, "requests.jsonl");
  const file = path.join(dir, "preload.mjs");
  writeFileSync(file, `
import { appendFileSync, readFileSync, existsSync } from "node:fs";
const LOG = ${JSON.stringify(log)};
const sse = (o) => "data: " + JSON.stringify(o) + "\\n\\n";
globalThis.fetch = async (url, init = {}) => {
  const n = existsSync(LOG) ? readFileSync(LOG, "utf8").split("\\n").filter(Boolean).length : 0;
  appendFileSync(LOG, JSON.stringify({ url: String(url), body: String(init.body || "") }) + "\\n");
  const id = "gen-parity-" + n;
  const chunks = n === 0
    ? [
        sse({ id, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_parity_1", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: ${JSON.stringify(command)} }) } }] }, finish_reason: null }] }),
        sse({ id, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cost: 0.0001 } }),
      ]
    : [
        sse({ id, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "DONE-FROM-MOCK" }, finish_reason: null }] }),
        sse({ id, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cost: 0.0001 } }),
      ];
  return new Response(chunks.join("") + "data: [DONE]\\n\\n", { status: 200, headers: { "content-type": "text/event-stream" } });
};
`);
  return { file, log };
}

function runHeadless(command: string, env: Record<string, string | undefined> = { OPENROUTER_API_KEY: FAKE_KEY }, model = "anthropic/claude-sonnet-5") {
  const ws = tmp("headless-parity-ws-");
  cpSync(FIXTURE, ws, { recursive: true });
  const p = preload(command);
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "NODE_TEST_CONTEXT" && !/OPENROUTER/.test(k)) e[k] = v;
  for (const [k, v] of Object.entries(env)) if (v !== undefined) e[k] = v;
  const res = spawnSync(process.execPath, ["--import", p.file, BIN, "--workspace", ws, "--skills", path.join(REPO, "skills"), "--model", model, "--prompt", "mark Nimbus as applied"], { env: e, encoding: "utf8", timeout: 90000 });
  const requests = existsSync(p.log) ? readFileSync(p.log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { ...res, ws, requests, all: `${res.stdout}\n${res.stderr}` };
}

/** The `tool` message(s) the runner sent back to the model. */
function toolResults(body: string): string[] {
  const msgs = JSON.parse(body).messages as Array<{ role: string; content: unknown }>;
  return msgs.filter((m) => m.role === "tool").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
}

test("e2e: a checker whose stdout carries a raw status name (update_job's `stage -> Applied`) reaches the model's tool result through bin/run.mjs", () => {
  // record_verdict first (the fixture's jobs.md holds no row in the
  // jobs-md schema yet), then the stage change — one bash call, as a
  // skill would chain them.
  const r = runHeadless(
    'node scripts/record_verdict.mjs --workspace . --company "Nimbus Robotics" --title "Analytics Engineer" --verdict investable_stretch --score 72 --reasons "fixture" && ' +
      'node scripts/update_job.mjs --workspace . --company "Nimbus Robotics" --title "Analytics Engineer" --stage Applied',
  );
  assert.equal(r.status, 0, r.all);
  assert.equal(r.requests.length, 2, `expected tool-call round trip:\n${r.all}`);
  const results = toolResults(r.requests[1].body);
  assert.equal(results.length, 1, JSON.stringify(results));
  const out = results[0];
  assert.match(out, /updated: Nimbus Robotics — Analytics Engineer — stage -> Applied/, out);
  assert.doesNotMatch(out, /not available in the web app/, out);
  assert.doesNotMatch(out, /"exitCode":127/, out);
  assert.match(out, /"exitCode":0/, out);
  // the write-back reached the temp workspace folder (the web app's
  // WorkspaceStore.write path), and only the temp copy
  assert.match(out, /investable_stretch/, out); // the verdict's raw name, too
  const after = readFileSync(path.join(r.ws, "jobs.md"), "utf8");
  assert.match(after, /Applied/);
  assert.notEqual(after, readFileSync(path.join(FIXTURE, "jobs.md"), "utf8"));
  assert.match(r.stdout, /DONE-FROM-MOCK/);
  assert.ok(!r.all.includes(FAKE_KEY), "key printed");
});

test("e2e: a still-unported python command exits the same way the web runner does (python3 pointer, not a 127 stub)", () => {
  const r = runHeadless("python3 scripts/update_job.py --help");
  assert.equal(r.status, 0, r.all);
  assert.equal(r.requests.length, 2, r.all);
  const out = toolResults(r.requests[1].body)[0];
  assert.doesNotMatch(out, /not available in the web app: python3/, out);
  assert.match(out, /node/, out);
});

test("e2e: no key → refusal before any deps are built: no request, fixture workspace copy untouched", () => {
  const r = runHeadless('node scripts/update_job.mjs --workspace . --company "Nimbus Robotics" --title "Analytics Engineer" --stage Applied', {});
  assert.equal(r.status, 1, r.all);
  assert.match(r.stderr, /OPENROUTER_API_KEY/);
  assert.equal(r.requests.length, 0);
  assert.equal(readFileSync(path.join(r.ws, "jobs.md"), "utf8"), readFileSync(path.join(FIXTURE, "jobs.md"), "utf8"));
});

// ------------------------------------------------------------ 3. model-request parity (the issue names a DeepSeek measurement)

test("model parity: a headless DeepSeek request carries what ten-model-proxy sends upstream for DeepSeek (require_parameters, no cache_control, max_tokens cap)", () => {
  const r = runHeadless("echo hi", { OPENROUTER_API_KEY: FAKE_KEY }, "deepseek/deepseek-v4.1-flash");
  assert.ok(r.requests.length >= 1, r.all);
  const body = JSON.parse(r.requests[0].body);
  assert.equal(body.provider?.require_parameters, true, JSON.stringify(body.provider));
  assert.equal(body.cache_control, undefined, JSON.stringify(body.cache_control));
  assert.equal(body.max_tokens, 8192);
});
