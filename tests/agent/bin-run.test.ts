// Tester-owned: bin/run.mjs never prints a key and refuses without one.
// No network: a --import preload replaces fetch, records every request to a
// file, and answers with a canned OpenRouter SSE (or an error). Workspaces
// are fresh temp dirs only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { AGENT, REPO, tmp } from "./_support.ts";

const BIN = path.join(AGENT, "bin/run.mjs");
const KEY = "sk-or-v1-TESTERFAKE-9d1c2b7e4a6f0e3d5c8b1a2f";
const KEY_FRAGMENTS = [KEY, "TESTERFAKE", "9d1c2b7e4a6f0e3d5c8b1a2f"];

function preload(mode: "ok" | "401" | "throw"): { file: string; log: string } {
  const dir = tmp("agent-bin-preload-");
  const log = path.join(dir, "requests.jsonl");
  const file = path.join(dir, "preload.mjs");
  writeFileSync(file, `
import { appendFileSync } from "node:fs";
const sse = (o) => "data: " + JSON.stringify(o) + "\\n\\n";
globalThis.fetch = async (url, init = {}) => {
  const h = new Headers(init.headers || {});
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ url: String(url), auth: h.get("authorization"), body: String(init.body || "") }) + "\\n");
  if (${JSON.stringify(mode)} === "throw") throw new TypeError("fetch failed");
  if (${JSON.stringify(mode)} === "401") return new Response(JSON.stringify({ error: { message: "No auth credentials found", code: 401 } }), { status: 401, headers: { "content-type": "application/json" } });
  const id = "gen-tester";
  const body = [
    sse({ id, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }),
    sse({ id, model: "m", choices: [{ index: 0, delta: { content: "HELLO-FROM-MOCK " }, finish_reason: null }] }),
    sse({ id, model: "m", choices: [{ index: 0, delta: { content: "second-chunk" }, finish_reason: null }] }),
    sse({ id, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }),
    "data: [DONE]\\n\\n",
  ].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};
`);
  return { file, log };
}

function run(extraArgs: string[], env: Record<string, string | undefined>, mode: "ok" | "401" | "throw" = "ok") {
  const p = preload(mode);
  const ws = tmp("agent-bin-ws-");
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "NODE_TEST_CONTEXT" && !/OPENROUTER|TESTER_KEY/.test(k)) e[k] = v;
  for (const [k, v] of Object.entries(env)) if (v !== undefined) e[k] = v;
  const res = spawnSync(process.execPath, ["--import", p.file, BIN, "--workspace", ws, "--skills", path.join(REPO, "skills"), "--model", "anthropic/claude-sonnet-5", "--prompt", "hi", ...extraArgs], { env: e, encoding: "utf8", timeout: 60000 });
  const requests = existsSync(p.log) ? readFileSync(p.log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { ...res, requests, all: `${res.stdout}\n${res.stderr}` };
}

const noKey = (s: string) => KEY_FRAGMENTS.every((f) => !s.includes(f));

test("refuses without OPENROUTER_API_KEY: exit 1, names the variable, makes no request", () => {
  const r = run([], {});
  assert.equal(r.status, 1, r.all);
  assert.match(r.stderr, /OPENROUTER_API_KEY/);
  assert.equal(r.requests.length, 0);
});

test("--key-env names the ONLY variable read: no fallback to OPENROUTER_API_KEY", () => {
  const r = run(["--key-env", "TESTER_KEY_UNSET"], { OPENROUTER_API_KEY: KEY });
  assert.equal(r.status, 1, r.all);
  assert.match(r.stderr, /TESTER_KEY_UNSET/);
  assert.equal(r.requests.length, 0);
  assert.ok(noKey(r.all));
});

test("an empty key variable is refused too", () => {
  const r = run([], { OPENROUTER_API_KEY: "" });
  assert.equal(r.status, 1, r.all);
  assert.equal(r.requests.length, 0);
});

for (const mode of ["ok", "401", "throw"] as const) {
  test(`with a planted key (${mode}): the key reaches only the Authorization header, never stdout/stderr`, () => {
    const r = run([], { OPENROUTER_API_KEY: KEY }, mode);
    assert.ok(r.requests.length >= 1, `a request was made:\n${r.all}`);
    assert.ok(noKey(r.all), `key printed:\n${r.all}`);
    for (const q of r.requests) {
      assert.equal(q.auth, `Bearer ${KEY}`);
      assert.ok(!q.body.includes(KEY), "key not in the request body");
      assert.ok(q.url.startsWith("https://openrouter.ai/"), q.url);
    }
    if (mode === "ok") assert.equal(r.status, 0, r.all);
  });
}

test("with --key-env, the custom variable's value is used and never printed", () => {
  const r = run(["--key-env", "TESTER_KEY"], { TESTER_KEY: KEY }, "401");
  assert.ok(r.requests.length >= 1);
  assert.equal(r.requests[0].auth, `Bearer ${KEY}`);
  assert.ok(noKey(r.all));
});

test("the request carries the no-data-kept provider filter (spike 1)", () => {
  const r = run([], { OPENROUTER_API_KEY: KEY });
  const body = JSON.parse(r.requests[0].body);
  assert.equal(body.provider?.zdr, true, JSON.stringify(body.provider));
  assert.equal(body.provider?.data_collection, "deny");
});

test("the reply text is printed once (not once per streamed snapshot)", () => {
  const r = run([], { OPENROUTER_API_KEY: KEY });
  const n = r.stdout.split("HELLO-FROM-MOCK").length - 1;
  assert.equal(n, 1, `stdout:\n${r.stdout}`);
});
