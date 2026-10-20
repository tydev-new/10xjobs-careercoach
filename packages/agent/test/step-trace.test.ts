// docs/design-fewer-steps.md § 1.1 "Proved by", items 1-6, plus the refusals
// around them: bin/run.mjs --trace / --turns driven end to end with a scripted
// fetch (test/support/scripted-fetch-preload.mjs) — no model, no network, no
// real key (a planted fake only), workspaces are fresh temp folders only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createTracer, makeMask, shortInput, shortOutput, uiStepCount } from "../bin/trace.mjs";
import { buildResumePdf } from "../../../tests/always-on/make_resume_pdf.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT = path.resolve(HERE, "..");
const REPO = path.resolve(AGENT, "../..");
const BIN = path.join(AGENT, "bin/run.mjs");
const PRELOAD = path.join(HERE, "support/scripted-fetch-preload.mjs");
const MODEL = "deepseek/deepseek-v4.1-flash";
const KEY = "sk-or-v1-STEPTRACEFAKE-3b9e5d7a1c4f8e2a6d0b";
const TEMPLATE = path.join(REPO, "skills/profile/templates/workspace-CLAUDE.md");

const tmp = (p: string) => mkdtempSync(path.join(tmpdir(), p));

/** A fresh workspace the way the site starts: the template CLAUDE.md, nothing else. */
function freshWorkspace(): string {
  const ws = tmp("st-ws-");
  copyFileSync(TEMPLATE, path.join(ws, "CLAUDE.md"));
  return ws;
}

type Item = { text?: string; tools?: { name: string; args?: Record<string, unknown> }[]; cost?: number };

interface Drive {
  status: number | null;
  stdout: string;
  stderr: string;
  requests: { n: number; auth: string | null; body: string; ws: string[] | null }[];
  ws: string;
  trace: string[];
}

function drive(script: Item[], opts: { turns?: unknown[]; fixtures?: string; ws?: string; extra?: string[]; env?: Record<string, string>; key?: boolean } = {}): Drive {
  const dir = tmp("st-run-");
  const scriptFile = path.join(dir, "script.json");
  const log = path.join(dir, "requests.jsonl");
  writeFileSync(scriptFile, JSON.stringify(script));
  const ws = opts.ws ?? freshWorkspace();
  const args = ["--workspace", ws, "--skills", path.join(REPO, "skills"), "--model", MODEL, "--trace"];
  if (opts.turns) {
    const turnsFile = path.join(dir, "turns.json");
    writeFileSync(turnsFile, JSON.stringify(opts.turns));
    args.push("--turns", turnsFile);
    if (opts.fixtures) args.push("--fixtures", opts.fixtures);
  } else {
    args.push("--prompt", "hi");
  }
  args.push(...(opts.extra ?? []));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "NODE_TEST_CONTEXT" && !/OPENROUTER/.test(k)) env[k] = v;
  Object.assign(env, { ST_SCRIPT: scriptFile, ST_LOG: log }, opts.env ?? {});
  if (opts.key !== false) env.OPENROUTER_API_KEY = KEY;
  const res = spawnSync(process.execPath, ["--import", PRELOAD, BIN, ...args], { env, encoding: "utf8", timeout: 120000 });
  const requests = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, requests, ws, trace: res.stderr.split("\n").filter((l) => l.startsWith("[trace]")) };
}

// ------------------------------------------------------------ proof 1, 2, 3

test("1. a two-step canned stream prints exactly one tool= line and one reply line, steps 1 and 2, and no step-count warning", () => {
  const r = drive([{ tools: [{ name: "list_files", args: {} }], cost: 0.001 }, { text: "All set.", cost: 0.002 }]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.trace.length, 2, r.trace.join("\n"));
  assert.match(r.trace[0], /^\[trace\] turn=1 step=1 tool=list_files in=\(all\) out=\d+ files$/);
  assert.equal(r.trace[1], "[trace] turn=1 step=2 reply (8 chars)");
  assert.ok(!r.stderr.includes("WARN"), r.stderr);
  assert.match(r.stderr, /^\[cost\] usd=0\.003000 steps=2$/m);
  assert.equal(r.stderr.trim().split("\n").at(-1), "[cost] usd=0.003000 steps=2");
});

test("1b. calls made together in one step share the step number", () => {
  const r = drive([
    { tools: [{ name: "list_files", args: { dir: "documents" } }, { name: "list_files", args: { dir: "jd-inbox" } }], cost: 0.001 },
    { text: "Done.", cost: 0.001 },
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.trace.map((l) => l.match(/step=(\d+)/)?.[1]), ["1", "1", "2"], r.trace.join("\n"));
  assert.ok(!r.stderr.includes("WARN"), r.stderr);
});

test("2. a write_file input never shows its content, only the length", () => {
  const SECRET = "SECRET-RESUME-LINE-Jordan-Reyes-185000";
  const content = `# Profile\n${SECRET}\n`;
  const r = drive([{ tools: [{ name: "write_file", args: { path: "profile.md", content } }] }, { text: "Saved." }]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stderr.includes(SECRET), "file content reached the trace");
  assert.ok(r.trace[0].includes(`in=profile.md (${content.length} chars) out=written`), r.trace[0]);
  // and a read of it prints a character count, not the text
  const r2 = drive(
    [{ tools: [{ name: "read_file", args: { path: "profile.md" } }] }, { text: "Read." }],
    { ws: (() => { const w = freshWorkspace(); writeFileSync(path.join(w, "profile.md"), content); return w; })() },
  );
  assert.ok(!r2.stderr.includes(SECRET), "a read's content reached the trace");
  assert.ok(r2.trace[0].endsWith(`in=profile.md out=${content.length} chars`), r2.trace[0]);
});

test("3. a key value planted in a bash command prints as [redacted], and so does an sk- shaped string", () => {
  const SK = "sk-abcdefghijklmnopqrstuvwxyz0123";
  const r = drive([{ tools: [{ name: "bash", args: { command: `echo ${KEY} && echo ${SK}` } }] }, { text: "ok" }]);
  assert.equal(r.status, 0, r.stderr);
  const line = r.trace[0];
  assert.ok(line.includes("tool=bash in=echo [redacted] && echo [redacted]"), line);
  for (const frag of [KEY, "STEPTRACEFAKE", SK, "abcdefghijklmnopqrstuvwxyz"]) assert.ok(!r.stderr.includes(frag), `${frag} printed`);
  assert.ok(!r.stdout.includes("STEPTRACEFAKE"));
  for (const q of r.requests) assert.equal(q.auth, `Bearer ${KEY}`, "the key goes only in the Authorization header");
});

// ------------------------------------------------------------ proof 4 (+ the other refusals)

test("4. --turns with a workspace outside the temp folder exits 2 before any request", () => {
  for (const outside of [REPO, homedir()]) {
    const r = drive([{ text: "x" }], { turns: [{ text: "hi" }], ws: outside });
    assert.equal(r.status, 2, `${outside}: ${r.stderr}`);
    assert.match(r.stderr, /outside the system temp folder/);
    assert.equal(r.requests.length, 0);
  }
});

test("4b. --turns refuses a temp workspace that already holds files besides CLAUDE.md, a symlink out of the temp folder, and the temp folder itself", () => {
  const dirty = freshWorkspace();
  writeFileSync(path.join(dirty, "profile.md"), "# not fresh\n");
  let r = drive([{ text: "x" }], { turns: [{ text: "hi" }], ws: dirty });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /already holds files other than CLAUDE\.md/);
  assert.equal(r.requests.length, 0);

  const holder = tmp("st-link-");
  const link = path.join(holder, "ws-link");
  symlinkSync(REPO, link);
  r = drive([{ text: "x" }], { turns: [{ text: "hi" }], ws: link });
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.requests.length, 0);

  r = drive([{ text: "x" }], { turns: [{ text: "hi" }], ws: tmpdir() });
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.requests.length, 0);
});

test("4c. --turns refuses without the key variable (exit 1, no request); a model off the allowlist is exit 2", () => {
  let r = drive([{ text: "x" }], { turns: [{ text: "hi" }], key: false });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /OPENROUTER_API_KEY/);
  assert.equal(r.requests.length, 0);
  assert.ok(!r.stderr.includes("STEPTRACEFAKE"));

  const dir = tmp("st-model-");
  writeFileSync(path.join(dir, "s.json"), "[]");
  r = { ...drive([{ text: "x" }], { turns: [{ text: "hi" }], extra: ["--model", "openai/gpt-4o"] }) };
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.requests.length, 0);
});

test("4d. --prompt and --turns together, or neither, is a usage error", () => {
  const both = drive([{ text: "x" }], { turns: [{ text: "hi" }], extra: ["--prompt", "also"] });
  assert.equal(both.status, 2, both.stderr);
  assert.equal(both.requests.length, 0);
});

// ------------------------------------------------------------ proof 5, 6

test("5. a two-turn file sends the first turn's assistant message inside the second request's messages; each turn has its own cost line, the total last", () => {
  const r = drive(
    [{ text: "FIRST-REPLY-TEXT", cost: 0.01 }, { text: "SECOND-REPLY-TEXT", cost: 0.02 }],
    { turns: [{ text: "first question" }, { text: "second question" }] },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.requests.length, 2);
  assert.ok(!r.requests[0].body.includes("FIRST-REPLY-TEXT"));
  assert.ok(r.requests[1].body.includes("first question"), "the first user message is in the history");
  assert.ok(r.requests[1].body.includes("FIRST-REPLY-TEXT"), "the first assistant message is in the history");
  assert.ok(r.requests[1].body.includes("second question"));
  const cost = r.stderr.split("\n").filter((l) => l.startsWith("[cost]"));
  assert.deepEqual(cost, ["[cost] turn=1 usd=0.010000 steps=1", "[cost] turn=2 usd=0.020000 steps=1", "[cost] usd=0.030000 steps=2"]);
  assert.equal(r.stderr.trim().split("\n").at(-1), "[cost] usd=0.030000 steps=2");
  assert.match(r.stdout, /=== turn 1 ===\nFIRST-REPLY-TEXT\n=== turn 2 ===\nSECOND-REPLY-TEXT\n/);
  assert.deepEqual(r.trace.map((l) => l.match(/turn=(\d+) step=(\d+)/)?.slice(1).join(".")), ["1.1", "2.1"]);
});

test("6. an attach turn uploads documents/<name> and its request carries the 'The candidate attached' line", () => {
  const fixtures = tmp("st-fx-");
  const pdf = buildResumePdf("# ALEX CHEN\nOakland, CA\n");
  writeFileSync(path.join(fixtures, "resume.pdf"), pdf);
  const r = drive(
    [{ text: "Hello." }, { text: "Got it." }],
    { turns: [{ text: "I'm looking for FDE job" }, { text: "here's my resume", attach: "resume.pdf" }], fixtures },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.requests[0].ws?.includes("documents/resume.pdf"), "not there before the upload turn");
  assert.deepEqual(r.requests[0].ws, ["CLAUDE.md"], "turn 1 starts from the site's state: CLAUDE.md only");
  assert.ok(r.requests[1].ws?.includes("documents/resume.pdf"), "uploaded before the second request");
  assert.ok(r.requests[1].body.includes("The candidate attached `documents/resume.pdf`."), "the existing conversion line");
  assert.ok(!r.requests[1].body.includes("%PDF"), "the bytes are never sent to the model");
  assert.deepEqual(new Uint8Array(readFileSync(path.join(r.ws, "documents/resume.pdf"))), pdf, "stored byte for byte, where the site stores it");
});

test("6b. an attach that is already there (a second upload of the same name) stops the run with an error, not a silent overwrite", () => {
  const fixtures = tmp("st-fx-");
  writeFileSync(path.join(fixtures, "resume.pdf"), buildResumePdf("x\n"));
  const r = drive([{ text: "a" }, { text: "b" }, { text: "c" }], { turns: [{ text: "one", attach: "resume.pdf" }, { text: "two", attach: "resume.pdf" }], fixtures });
  assert.notEqual(r.status, 0, "the second upload must fail");
  assert.equal(r.requests.length, 1, "no request after the failed upload");
});

// ------------------------------------------------------------ the cost stop

test("the run stops above $1: [stop] line, exit 4, and the next turn is never sent", () => {
  // (the coach's own spend gate pauses a single turn that is about to pass its
  // allowance; this is the run-level cap across turns)
  const steps: Item[] = [{ text: "A", cost: 0.55 }, { text: "B", cost: 0.55 }, { text: "C", cost: 0.55 }];
  const r = drive(steps, { turns: [{ text: "one" }, { text: "two" }, { text: "THIRD-TURN-MARKER" }] });
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /^\[stop\] the run's reported cost passed \$1\.00 \(so far \$1\.1000\)/m);
  assert.equal(r.requests.length, 2, "the third turn was never asked");
  assert.ok(!r.requests.some((q) => q.body.includes("THIRD-TURN-MARKER")));
  assert.equal(r.stderr.trim().split("\n").at(-1), "[cost] usd=1.100000 steps=2", "the total cost line is still last");
});

test("--max-usd moves the line", () => {
  const steps: Item[] = [{ tools: [{ name: "list_files", args: {} }], cost: 0.3 }, { text: "Done.", cost: 0.3 }];
  const ok = drive(steps, { turns: [{ text: "go" }] });
  assert.equal(ok.status, 0, ok.stderr);
  const low = drive(steps, { turns: [{ text: "go" }], extra: ["--max-usd", "0.2"] });
  assert.equal(low.status, 4, low.stderr);
});

// ------------------------------------------------------------ the pure parts

test("trace.mjs: the short input and output of every tool, never contents", () => {
  assert.equal(shortInput("load_skill", { name: "profile" }), "profile");
  assert.equal(shortInput("read_file", { path: "documents/resume.pdf" }), "documents/resume.pdf");
  assert.equal(shortInput("write_file", { path: "plan.md", content: "abc" }), "plan.md (3 chars)");
  assert.equal(shortInput("list_files", {}), "(all)");
  assert.equal(shortInput("list_files", { dir: "documents" }), "documents");
  assert.equal(shortInput("bash", { command: "node a.mjs\nnode b.mjs" }), "node a.mjs⏎node b.mjs");
  assert.equal(shortInput("bash", { command: "x".repeat(300) }).length, 160);
  assert.equal(shortInput("web_search", { query: "q".repeat(200) }).length, 80);
  assert.equal(shortInput("fetch_job", { url: "https://boards.greenhouse.io/acme/jobs/12?token=SECRET", saveTo: "jd-inbox/a.md" }), "boards.greenhouse.io/acme/jobs/12 saveTo=jd-inbox/a.md");
  assert.equal(shortInput("estimate_cost", { action: "tailor", steps: 3, webSearches: 0 }), "tailor");
  assert.equal(shortInput("check_language", { files: ["a.md", "b.md"] }), "a.md,b.md");
  assert.equal(shortInput("list_board", { boards: [{}, {}] }), "2 companies");
  assert.equal(shortInput("add_roles", { roles: [{}, {}, {}] }), "3 companies");
  const done = (output: unknown) => ({ state: "output-available", output });
  assert.equal(shortOutput("load_skill", done({ path: "skills/x/SKILL.md", content: "BODY" })), "ok");
  assert.equal(shortOutput("load_skill", done({ error: { code: "resource_missing", message: "m" } })), "resource_missing");
  assert.equal(shortOutput("read_file", done({ path: "a", content: "12345", readOnly: false })), "5 chars");
  assert.equal(shortOutput("read_file", done({ path: "a", text: "1234567", extracted: true })), "7 chars");
  assert.equal(shortOutput("write_file", done({ path: "a", written: true })), "written");
  assert.equal(shortOutput("write_file", done({ error: { code: "not_editable", message: "m" } })), "not_editable");
  assert.equal(shortOutput("list_files", done({ files: [{}, {}] })), "2 files");
  assert.equal(shortOutput("bash", done({ stdout: "ok\n", stderr: "", exitCode: 0 })), "exit=0 clean");
  assert.equal(shortOutput("bash", done({ stdout: "a\nFAIL: plan.md has no Board\nb", stderr: "", exitCode: 1 })), "exit=1 FAIL: plan.md has no Board");
  assert.equal(shortOutput("bash", done({ stdout: "", stderr: `WARN ${"w".repeat(200)}`, exitCode: 0 })).length, "exit=0 ".length + 80);
  assert.equal(shortOutput("web_search", done({ results: [{}, {}, {}] })), "3 results");
  assert.equal(shortOutput("estimate_cost", done({ needsGate: false })), "needsGate=false");
  assert.equal(shortOutput("fetch_job", done({ board: "b", text: "BODY" })), "ok");
  assert.equal(shortOutput("check_language", done({ report: "R", usd: 0.01 })), "ok");
  assert.equal(shortOutput("add_roles", { state: "output-error", errorText: "boom" }), "boom");
});

test("trace.mjs: ' out=' inside a field cannot confuse the scorer's split", () => {
  assert.ok(!shortInput("bash", { command: "echo a out=b" }).includes(" out="));
});

test("trace.mjs: makeMask masks the key value and sk- shapes, and leaves short values and ordinary text alone", () => {
  const mask = makeMask(["abcd1234efgh5678", "short"]);
  assert.equal(mask("key=abcd1234efgh5678!"), "key=[redacted]!");
  assert.equal(mask("a short word"), "a short word");
  assert.equal(mask("sk-or-v1-0123456789abcdefABCDEF"), "[redacted]");
  assert.equal(mask("sk-tooshort"), "sk-tooshort");
});

test("trace.mjs: a tracer walks a canned message into steps, and counts the step-start parts", () => {
  const lines: string[] = [];
  const t = createTracer({ turn: 3, emit: (l: string) => lines.push(l) });
  const message = {
    parts: [
      { type: "step-start" },
      { type: "tool-list_files", toolCallId: "a", state: "output-available", input: {}, output: { files: [] } },
      { type: "tool-bash", toolCallId: "b", state: "input-available", input: { command: "ls" } },
      { type: "step-start" },
      { type: "tool-bash", toolCallId: "b", state: "output-available", input: { command: "ls" }, output: { stdout: "", stderr: "", exitCode: 0 } },
      { type: "step-start" },
      { type: "text", text: "Hello there" },
    ],
  };
  t.update({ parts: message.parts.slice(0, 3) });
  t.update(message);
  assert.equal(t.finish(message), 3);
  assert.deepEqual(lines, [
    "[trace] turn=3 step=1 tool=list_files in=(all) out=0 files",
    "[trace] turn=3 step=2 tool=bash in=ls out=exit=0 clean",
    "[trace] turn=3 step=3 reply (11 chars)",
  ]);
  assert.equal(uiStepCount(message), 3);
});
