// bin/run.mjs: must refuse to run without an explicit key env var, and
// must never print it. Exercised as a real subprocess (not imported —
// it calls main() on load and would process.exit()).
//
// M11 (fix round 2): ZERO real network requests — a `--import` preload
// replaces `globalThis.fetch` before bin/run.mjs's own module even loads
// (same technique as tests/agent/bin-run.test.ts), so even the tests
// that DO supply a key never reach the real network. Workspaces are
// fresh mkdtemp dirs, never a literal "/tmp" path.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const BIN = path.resolve(HERE, "../bin/run.mjs");

function tmp(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** A `--import` preload that replaces `globalThis.fetch` with a stub:
 *  records every request to a log file, and answers with a canned
 *  OpenRouter-shaped SSE stream — no socket is ever opened. */
function preload(): { file: string; log: string } {
  const dir = tmp("agent-bin-preload-");
  const log = path.join(dir, "requests.jsonl");
  const file = path.join(dir, "preload.mjs");
  writeFileSync(
    file,
    `
import { appendFileSync } from "node:fs";
const sse = (o) => "data: " + JSON.stringify(o) + "\\n\\n";
globalThis.fetch = async (url, init = {}) => {
  const h = new Headers(init.headers || {});
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ url: String(url), auth: h.get("authorization"), body: String(init.body || "") }) + "\\n");
  const id = "gen-coder-test";
  const body = [
    sse({ id, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }),
    sse({ id, model: "m", choices: [{ index: 0, delta: { content: "stub reply" }, finish_reason: null }] }),
    sse({ id, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
    "data: [DONE]\\n\\n",
  ].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};
`,
  );
  return { file, log };
}

function run(extraArgs: string[], env: Record<string, string | undefined> = {}) {
  const p = preload();
  const workspace = tmp("agent-bin-ws-");
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete e[k];
    else e[k] = v;
  }
  const res = spawnSync(
    process.execPath,
    [
      "--import",
      p.file,
      BIN,
      "--workspace",
      workspace,
      "--skills",
      path.join(REPO, "skills"),
      "--model",
      "anthropic/claude-sonnet-5",
      "--prompt",
      "hi",
      ...extraArgs,
    ],
    { cwd: path.resolve(HERE, ".."), env: e, encoding: "utf8", timeout: 15000 },
  );
  return { ...res, requestLog: p.log };
}

test("refuses to run without the named key env var set (default OPENROUTER_API_KEY)", () => {
  const res = run([], { OPENROUTER_API_KEY: undefined });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /OPENROUTER_API_KEY/);
  assert.doesNotMatch(res.stdout, /sk-or-/);
});

test("refuses with a missing required argument (usage error, exit 2)", () => {
  // fails at arg-parsing, before any fetch could happen — no preload needed.
  const res = spawnSync(process.execPath, [BIN, "--workspace", tmp("agent-bin-ws-")], {
    cwd: path.resolve(HERE, ".."),
    env: { ...process.env },
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /--skills is required/);
});

test("a --key-env pointing at an unset variable also refuses, naming that variable", () => {
  const res = run(["--key-env", "MY_CUSTOM_KEY"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /MY_CUSTOM_KEY/);
});

test("never prints the key value, even with a real (stubbed-network) run", () => {
  const SECRET = "sk-or-v1-TOTALLY-FAKE-NOT-REAL-SECRET-VALUE";
  const res = run([], { OPENROUTER_API_KEY: SECRET });
  assert.doesNotMatch(res.stdout, /TOTALLY-FAKE-NOT-REAL-SECRET-VALUE/);
  assert.doesNotMatch(res.stderr, /TOTALLY-FAKE-NOT-REAL-SECRET-VALUE/);
  assert.equal(res.status, 0, res.stderr);
});
