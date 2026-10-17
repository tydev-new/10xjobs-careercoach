// The feedback skill's script and lib (docs/design-feedback.md § 17.1, items 1 to 10,
// plus the § 13 strings). Run: node --test tests/feedback.test.mjs
//
// Two layers. In-process: the lib's `run` with an injected `fetch` and an
// injected context, so no network and no file. Out-of-process: the real
// command (skills/feedback/scripts/feedback.mjs) as a child, with
// TEN_FEEDBACK_URL pointed at a stub server on 127.0.0.1 and a temp
// XDG_CACHE_HOME. Nothing here can reach production: the stub is the only
// address ever used, and the in-process fetch is a fake.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { webcrypto } from "node:crypto";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FB, MARKS, PAYLOAD_KEYS, PROD_URL, RENDER_LABELS, SKILLS,
  buildFeedback, newInstallationId, parseArgs, redact, renderFeedback, run, sendFeedback,
} from "../skills/feedback/scripts/lib/feedback.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SCRIPT = join(ROOT, "skills", "feedback", "scripts", "feedback.mjs");
const LIB = join(ROOT, "skills", "feedback", "scripts", "lib", "feedback.mjs");
const ID = "3f9c0a7e5b2d4c18a6e0f1b2c3d4e5f6";

// ----------------------------------------------------------------- helpers

/** A fake fetch that records every call and answers with `status` (or throws). */
function fakeFetch(answer = 201) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    if (typeof answer === "function") return answer(url, init);
    return { status: answer, body: null };
  };
  fn.calls = calls;
  return fn;
}

function deps(over = {}) {
  const f = over.fetchImpl ?? fakeFetch(201);
  return {
    env: {},
    fetchImpl: f,
    context: () => ({ version: "0.9.2", installationId: ID }),
    ...over,
    fetchImpl: f,
  };
}

const lastLine = (stdout) => stdout.trimEnd().split("\n").at(-1);

// ----------------------------------------------------------------- 1. the eight keys

test("1. buildFeedback returns exactly the eight keys of section 6, in order", () => {
  const p = buildFeedback(
    { kind: "bug", comment: "the letter check keeps flagging dates that are right", rating: 4, skill: "apply", step: "Tailoring" },
    { version: "0.9.2", host: "local", installationId: ID },
  );
  assert.deepEqual(Object.keys(p), ["kind", "comment", "rating", "skill", "step", "version", "host", "installationId"]);
  assert.deepEqual(Object.keys(p), [...PAYLOAD_KEYS]);
  assert.deepEqual(p, {
    kind: "bug",
    comment: "the letter check keeps flagging dates that are right",
    rating: 4,
    skill: "apply",
    step: "Tailoring",
    version: "0.9.2",
    host: "local",
    installationId: ID,
  });
  // defaults: kind comment, nothing else added
  const q = buildFeedback({ comment: "ok" }, { version: "1.0", host: "local", installationId: ID });
  assert.equal(q.kind, "comment");
  assert.equal(q.rating, null);
  assert.equal(q.skill, "");
  assert.equal(q.step, "");
  // extra input keys never reach the payload
  const r = buildFeedback({ comment: "ok", stage: "deciding", name: "A. Person", extra: 1 }, { version: "1.0", host: "local", installationId: ID });
  assert.deepEqual(Object.keys(r), [...PAYLOAD_KEYS]);
});

test("1b. the web host sends no random id, whatever it is handed", () => {
  const p = buildFeedback({ comment: "ok" }, { version: "web-abc123", host: "web", installationId: ID });
  assert.equal(p.host, "web");
  assert.equal(p.installationId, null);
  const q = buildFeedback({ comment: "ok" }, { version: "1", host: "local", installationId: "not-hex" });
  assert.equal(q.installationId, null);
});

test("1c. the version is 1 to 40 of 0-9 A-Z a-z . + -, else unknown", () => {
  const v = (x) => buildFeedback({ comment: "ok" }, { version: x, host: "local", installationId: ID }).version;
  assert.equal(v("0.9.2"), "0.9.2");
  assert.equal(v("1.0.0-rc.1+build5"), "1.0.0-rc.1+build5");
  assert.equal(v("a".repeat(40)), "a".repeat(40));
  assert.equal(v("a".repeat(41)), "unknown");
  assert.equal(v(""), "unknown");
  assert.equal(v("1 0"), "unknown");
  assert.equal(v(undefined), "unknown");
});

// ----------------------------------------------------------------- 2. redaction

const REDACTIONS = [
  ["an email", "write to jane.doe@example.com about it", "jane.doe@example.com", MARKS.email],
  ["an email with a plus", "mail a+b@mail.example.org now", "a+b@mail.example.org", MARKS.email],
  ["a phone with dashes", "call 415-555-0100 please", "415-555-0100", MARKS.phone],
  ["a phone with a bracketed area code", "call (415) 555-0100 please", "555-0100", MARKS.phone],
  ["a phone with dots", "call 212.555.0143 please", "212.555.0143", MARKS.phone],
  ["a phone with a country code", "call +1 415 555 0100 please", "415 555 0100", MARKS.phone],
  ["a LinkedIn profile link", "see https://www.linkedin.com/in/jane-doe-1a2b3c/ for me", "jane-doe-1a2b3c", MARKS.link],
  ["a bare LinkedIn profile link", "see linkedin.com/in/janedoe for me", "janedoe", MARKS.link],
  ["a macOS home folder path", "it read /" + "Users/jane/job-search/profile.md and failed", "jane", MARKS.path],
  ["a Linux home folder path", "it read /" + "home/jane/work/resume.md and failed", "jane", MARKS.path],
];

test("2. redaction: each shape becomes its mark, and the original is absent from the body", async () => {
  for (const [name, text, secret, mark] of REDACTIONS) {
    assert.ok(redact(text).includes(mark), `${name}: mark present`);
    assert.ok(!redact(text).includes(secret), `${name}: original gone from redact()`);
    const f = fakeFetch(201);
    const out = await run(["--comment", text], deps({ fetchImpl: f }));
    assert.equal(out.exitCode, 0, name);
    assert.equal(f.calls.length, 1, name);
    assert.ok(!f.calls[0].init.body.includes(secret), `${name}: original absent from the body`);
    assert.ok(f.calls[0].init.body.includes(mark), `${name}: mark in the body`);
    assert.ok(!out.stdout.includes(secret), `${name}: original absent from what is shown`);
  }
});

test("2b. redaction keeps the words around the mark, and trailing punctuation", () => {
  assert.equal(redact("see /" + "Users/jane/x.md."), "see " + MARKS.path + ".");
  assert.equal(redact("(mail jane@example.com)"), "(mail " + MARKS.email + ")");
  assert.equal(redact("nothing to blank here, 2026-10-17, 3 of 5"), "nothing to blank here, 2026-10-17, 3 of 5");
});

test("2c. redaction runs before the length check and is linear on long input", () => {
  const long = "a".repeat(19000);
  const t0 = Date.now();
  redact(long + "@" + long);
  assert.ok(Date.now() - t0 < 2000, "no catastrophic backtracking");
  const many = Array(60).fill("x@example.com").join(" "); // 60 * 14 = 840 characters, redacted shorter
  const p = buildFeedback({ comment: many }, { version: "1", host: "local", installationId: ID });
  assert.ok(!p.error);
  assert.equal(p.comment.split(MARKS.email).length - 1, 60);
});

// ----------------------------------------------------------------- 3. refusals

test("3. refusals make no fetch call, print their line last, and exit 1", async () => {
  const cases = [
    [[], FB.FB7],
    [["--comment", ""], FB.FB7],
    [["--comment", "   \n  "], FB.FB7],
    [["--kind", "bug", "--rating", "3"], FB.FB8],
    [["--kind", "bug"], FB.FB8],
    [["--kind", "bug", "--comment", " "], FB.FB8],
    [["--comment", "x".repeat(2001)], FB.FB9],
    [["--kind", "bug", "--comment", "y".repeat(5000)], FB.FB9],
    [["--comment", "ok", "--rating", "0"], FB.FB10],
    [["--comment", "ok", "--rating", "6"], FB.FB10],
    [["--comment", "ok", "--rating", "2.5"], FB.FB10],
    [["--comment", "ok", "--rating", "abc"], FB.FB10],
    [["--comment", "ok", "--rating", ""], FB.FB10],
    [["--comment", "ok", "--rating", "-1"], FB.FB10],
    [["--rating", "9"], FB.FB10],
  ];
  for (const [argv, line] of cases) {
    for (const dry of [[], ["--dry-run"]]) {
      const f = fakeFetch(201);
      let touched = 0;
      const out = await run([...argv, ...dry], deps({ fetchImpl: f, context: () => { touched++; return { version: "1", installationId: ID }; } }));
      assert.equal(out.exitCode, 1, JSON.stringify(argv));
      assert.equal(lastLine(out.stdout), line, JSON.stringify(argv));
      assert.equal(out.stdout, line + "\n", "the line is the whole output");
      assert.equal(f.calls.length, 0, `no fetch: ${JSON.stringify(argv)}`);
      assert.equal(touched, 0, `no random id made for a refused call: ${JSON.stringify(argv)}`);
    }
  }
});

test("3b. exactly 2000 characters is fine; the count is characters, not UTF-16 units", async () => {
  const f = fakeFetch(201);
  const ok = await run(["--comment", "x".repeat(2000)], deps({ fetchImpl: f }));
  assert.equal(ok.exitCode, 0);
  const emoji = await run(["--comment", "\u{1F600}".repeat(2000), "--dry-run"], deps({ fetchImpl: f }));
  assert.equal(emoji.exitCode, 0, "2000 astral characters are 2000 characters");
  const over = await run(["--comment", "\u{1F600}".repeat(2001), "--dry-run"], deps({ fetchImpl: f }));
  assert.equal(lastLine(over.stdout), FB.FB9);
});

test("3c. 2,001 characters that redact down to 2,000 or fewer are accepted (the check is after redaction)", async () => {
  const f = fakeFetch(201);
  const text = "x".repeat(1900) + " jane.doe@example.com plus more words here";
  assert.ok(text.length > 1900);
  const out = await run(["--comment", text, "--dry-run"], deps({ fetchImpl: f }));
  assert.equal(out.exitCode, 0);
});

test("3d. a bad call (unknown flag, missing value, unknown kind) is refused with a model-facing line and no fetch", async () => {
  for (const argv of [["--bogus", "1"], ["--comment"], ["--kind", "praise", "--comment", "x"], ["stray"], ["--rating"]]) {
    const f = fakeFetch(201);
    const out = await run(argv, deps({ fetchImpl: f }));
    assert.equal(out.exitCode, 1, JSON.stringify(argv));
    assert.equal(f.calls.length, 0);
    assert.ok(out.stdout.trim().length > 0);
  }
  assert.deepEqual(parseArgs(["--comment=a=b", "--dry-run"]), { flags: { comment: "a=b" }, dryRun: true });
});

// ----------------------------------------------------------------- 4. dry run

test("4. --dry-run prints FB1 and the eight lines of section 7 and nothing else; fetch is never called", async () => {
  const f = fakeFetch(201);
  const out = await run(
    ["--kind", "bug", "--skill", "apply", "--step", "Tailoring", "--comment", "the letter check keeps flagging dates that are right", "--dry-run"],
    deps({ fetchImpl: f }),
  );
  assert.equal(out.exitCode, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(
    out.stdout,
    [
      "This is everything that would go to the Ten team:",
      "Kind: bug report",
      "Your words: the letter check keeps flagging dates that are right",
      "Rating: none",
      "Skill: apply",
      "Step: Tailoring",
      "Ten version: 0.9.2",
      "Sent from: your computer",
      `Random id: ${ID} (made once on this computer; not linked to your name or email)`,
    ].join("\n") + "\n",
  );
  assert.equal(out.stdout.trimEnd().split("\n").length, 9);
});

test("4b. the web rendering says the website and no random id", () => {
  const p = buildFeedback({ comment: "ok", rating: 5 }, { version: "web-1", host: "web", installationId: null });
  const lines = renderFeedback(p).split("\n");
  assert.equal(lines.at(-2), "Sent from: the Ten website");
  assert.equal(lines.at(-1), "Random id: none");
  assert.equal(lines[3], "Rating: 5 of 5");
});

// ----------------------------------------------------------------- 5. shown = sent

const TABLE = [
  { input: { comment: "plain words" }, ctx: { version: "0.9.2", host: "local", installationId: ID } },
  { input: { kind: "bug", comment: "broken", rating: 1, skill: "evaluate", step: "Full evaluation" }, ctx: { version: "1.2.3-rc.1", host: "local", installationId: ID } },
  { input: { rating: 3 }, ctx: { version: "unknown", host: "local", installationId: ID } },
  { input: { comment: "web note", rating: 5, skill: "storybank" }, ctx: { version: "web-9f8e7d", host: "web", installationId: null } },
  { input: { comment: "words with: a colon and Rating: inside" }, ctx: { version: "1", host: "local", installationId: ID } },
];

test("5. what is shown is what goes: every body value is on its own line, every line maps to one key", async () => {
  const labelToKey = Object.fromEntries(Object.entries(RENDER_LABELS).map(([k, v]) => [v, k]));
  for (const { input, ctx } of TABLE) {
    const payload = buildFeedback(input, ctx);
    assert.ok(!payload.error);
    const lines = renderFeedback(payload).split("\n");
    assert.equal(lines[0], FB.FB1);
    const rest = lines.slice(1);
    assert.equal(rest.length, 8, "one line per key");
    const seen = new Set();
    for (const line of rest) {
      const label = Object.keys(labelToKey).find((l) => line.startsWith(l + " "));
      assert.ok(label, `line has a known label: ${line}`);
      assert.ok(!seen.has(labelToKey[label]), "one line per key");
      seen.add(labelToKey[label]);
    }
    assert.deepEqual([...seen].sort(), [...PAYLOAD_KEYS].sort());
    // every value in the body appears on its own line
    const by = Object.fromEntries(rest.map((l) => { const lab = Object.keys(labelToKey).find((x) => l.startsWith(x + " ")); return [labelToKey[lab], l.slice(lab.length + 1)]; }));
    if (payload.comment) assert.equal(by.comment, payload.comment);
    else assert.equal(by.comment, "none");
    assert.equal(by.rating, payload.rating === null ? "none" : `${payload.rating} of 5`);
    assert.equal(by.skill, payload.skill || "none");
    assert.equal(by.step, payload.step || "none");
    assert.equal(by.version, payload.version);
    assert.equal(by.host, payload.host === "web" ? "the Ten website" : "your computer");
    assert.equal(by.installationId.startsWith(payload.installationId ?? "none"), true);
    assert.equal(by.kind, payload.kind === "bug" ? "bug report" : "comment");
    // and the body the script posts is that same object
    const f = fakeFetch(201);
    if (ctx.host === "local") {
      const argv = [];
      for (const [k, v] of Object.entries(input)) argv.push("--" + k, String(v));
      const out = await run(argv, deps({ fetchImpl: f, context: () => ({ version: ctx.version, installationId: ctx.installationId }) }));
      assert.equal(f.calls[0].init.body, JSON.stringify(payload), "body is the shown payload, byte for byte");
      assert.equal(out.stdout.split("\n").slice(0, 9).join("\n"), renderFeedback(payload), "the send prints the same rendering");
    }
  }
});

test("5b. one line per field even when the words had line breaks, tabs and runs of spaces", () => {
  const p = buildFeedback({ comment: "first line\nsecond\tline   third\r\n\r\nfourth" }, { version: "1", host: "local", installationId: ID });
  assert.equal(p.comment, "first line second line third fourth");
  assert.equal(renderFeedback(p).split("\n").length, 9);
});

// ----------------------------------------------------------------- 6. the send

test("6. the send: production URL by default, TEN_FEEDBACK_URL when set; body byte for byte; one header; a 15 second timeout", async () => {
  assert.equal(PROD_URL, "https://ivunfotoggdxbjouumdk.supabase.co/functions/v1/ten-feedback");
  const f = fakeFetch(201);
  const asked = [];
  await run(["--comment", "hello"], deps({ fetchImpl: f, makeSignal: (ms) => { asked.push(ms); return new AbortController().signal; } }));
  assert.equal(f.calls[0].url, PROD_URL);
  assert.deepEqual(asked, [15000]);
  const payload = buildFeedback({ comment: "hello" }, { version: "0.9.2", host: "local", installationId: ID });
  assert.equal(f.calls[0].init.body, JSON.stringify(payload));
  assert.equal(f.calls[0].init.method, "POST");
  assert.deepEqual(Object.keys(f.calls[0].init.headers).map((k) => k.toLowerCase()), ["content-type"]);
  assert.equal(f.calls[0].init.headers["content-type"], "application/json");
  for (const bad of ["authorization", "apikey", "cookie"]) {
    assert.ok(!(bad in f.calls[0].init.headers));
  }
  assert.ok(f.calls[0].init.signal);

  const g = fakeFetch(201);
  await run(["--comment", "hello"], deps({ fetchImpl: g, env: { TEN_FEEDBACK_URL: "http://127.0.0.1:9/x" } }));
  assert.equal(g.calls[0].url, "http://127.0.0.1:9/x");
  assert.equal(g.calls.length, 1, "one request per run");
});

test("6b. the real timeout signal is an AbortSignal that fires, and a hung server ends in the failure line", async () => {
  const hang = (_url, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  // AbortSignal.timeout's timer is unref'd by design (Node 18 and later): a real
  // fetch holds a socket open, which keeps the loop alive until it fires. This
  // fake holds nothing, so give the loop something to wait on while it counts down.
  const keepAlive = setInterval(() => {}, 10);
  let out;
  try {
    out = await sendFeedback({ any: 1 }, { fetchImpl: hang, timeoutMs: 30 });
  } finally {
    clearInterval(keepAlive);
  }
  assert.equal(out, "failed");
  const signals = [];
  await sendFeedback({ any: 1 }, { fetchImpl: async (_u, init) => { signals.push(init.signal); return { status: 201 }; } });
  assert.ok(signals[0] instanceof AbortSignal);
});

// ----------------------------------------------------------------- 7. answers

test("7. answers: 201 is FB4 and exit 0; 429 is FB5; 400, 413, 500, 503, a network failure and a timeout are FB6; both exit 1", async () => {
  const FORBIDDEN = /HTTP|status|server|endpoint|error|Supabase|key|\b\d{3}\b/i;
  const table = [
    [201, FB.FB4, 0],
    [429, FB.FB5, 1],
    [400, FB.FB6, 1],
    [413, FB.FB6, 1],
    [500, FB.FB6, 1],
    [503, FB.FB6, 1],
    [200, FB.FB6, 1],
    [401, FB.FB6, 1],
    [new TypeError("fetch failed"), FB.FB6, 1],
    [Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), FB.FB6, 1],
  ];
  for (const [answer, line, code] of table) {
    const f = fakeFetch(answer);
    const out = await run(["--comment", "the dates were wrong", "--rating", "4", "--skill", "apply"], deps({ fetchImpl: f }));
    assert.equal(out.exitCode, code, String(answer));
    assert.equal(lastLine(out.stdout), line, String(answer));
    assert.equal(f.calls.length, 1);
    for (const l of out.stdout.trimEnd().split("\n")) {
      assert.ok(!FORBIDDEN.test(l), `no jargon in: ${l}`);
    }
    // the transcript records what went: the rendering is printed, then the line
    assert.equal(out.stdout.split("\n")[0], FB.FB1);
  }
});

test("7b. the server's own words never reach the output", async () => {
  const f = fakeFetch(() => ({ status: 503, body: null, text: async () => "relation public.ten_feedback does not exist" }));
  const out = await run(["--comment", "hi"], deps({ fetchImpl: f }));
  assert.ok(!out.stdout.includes("relation"));
});

// ----------------------------------------------------------------- 10. skill and step

test("10. a skill not on the list, and a step with @, /, a backslash, a line break or 61 characters, are sent empty and shown as none", () => {
  const ctx = { version: "1", host: "local", installationId: ID };
  const b = (o) => buildFeedback({ comment: "ok", ...o }, ctx);
  for (const s of SKILLS) assert.equal(b({ skill: s }).skill, s);
  assert.equal(SKILLS.length, 10);
  assert.deepEqual([...SKILLS], ["apply", "coach", "evaluate", "feedback", "interview", "learn", "outreach", "profile", "search", "storybank"]);
  for (const s of ["positioning", "Apply", "APPLY", "apply ; rm", "", "applyy", "../apply", "jane"]) {
    const p = b({ skill: s });
    assert.equal(p.skill, "", s);
    assert.ok(renderFeedback(p).split("\n").includes("Skill: none"), s);
  }
  assert.equal(b({ skill: " apply " }).skill, "apply");
  assert.equal(b({ step: "Tailoring" }).step, "Tailoring");
  assert.equal(b({ step: "x".repeat(60) }).step, "x".repeat(60));
  for (const s of ["x".repeat(61), "a@b", "Tailoring/letter", "Tailoring\\letter", "two\nlines", "tab\there", "nul\u0000", "line sep"]) {
    const p = b({ step: s });
    assert.equal(p.step, "", JSON.stringify(s));
    assert.ok(renderFeedback(p).split("\n").includes("Step: none"), JSON.stringify(s));
  }
  // the skill and the step are not redacted into the words: they are dropped
  assert.equal(b({ step: "Call 415-555-0100" }).step, "Call 415-555-0100", "a step is checked by rule, not scrubbed");
});

// ----------------------------------------------------------------- the id helper

test("the random id helper makes 32 lowercase hex characters", () => {
  const id = newInstallationId((a) => webcrypto.getRandomValues(a));
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.notEqual(id, newInstallationId((a) => webcrypto.getRandomValues(a)));
});

// ----------------------------------------------------------------- the real command (child process)

function stubServer(answer = 201) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.statusCode = answer;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: answer === 201 ? "sent" : "busy" }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ seen, url: `http://127.0.0.1:${server.address().port}/functions/v1/ten-feedback`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function cli(args, { env = {}, cwd = ROOT, script = SCRIPT } = {}) {
  return new Promise((resolve) => {
    // a minimal environment: nothing of the developer's own leaks into the child
    const childEnv = { PATH: process.env.PATH, HOME: env.HOME ?? tmpdir(), ...env };
    execFile(process.execPath, [script, ...args], { cwd, env: childEnv, timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

test("the command end to end: dry run, then a send to a local stub, then the same id again", async () => {
  const stub = await stubServer(201);
  const cache = mkdtempSync(join(tmpdir(), "ten-fb-cache-"));
  try {
    const env = { TEN_FEEDBACK_URL: stub.url, XDG_CACHE_HOME: cache };
    const dry = await cli(["--kind", "bug", "--skill", "apply", "--step", "Tailoring", "--comment", "dates flagged wrongly", "--dry-run"], { env });
    assert.equal(dry.code, 0);
    assert.equal(dry.stderr, "");
    assert.equal(stub.seen.length, 0, "a dry run sends nothing");
    const m = /^Random id: ([0-9a-f]{32}) \(made once/m.exec(dry.stdout);
    assert.ok(m, dry.stdout);
    const idFile = join(cache, "ten", "installation-id");
    assert.equal(readFileSync(idFile, "utf8").trim(), m[1]);

    const sent = await cli(["--kind", "bug", "--skill", "apply", "--step", "Tailoring", "--comment", "dates flagged wrongly"], { env });
    assert.equal(sent.code, 0);
    assert.equal(sent.stderr, "");
    assert.equal(lastLine(sent.stdout), FB.FB4);
    assert.equal(stub.seen.length, 1);
    const body = JSON.parse(stub.seen[0].body);
    assert.deepEqual(Object.keys(body), [...PAYLOAD_KEYS]);
    assert.equal(body.installationId, m[1], "the same id on the second run, and the one that was shown");
    assert.equal(body.host, "local");
    assert.equal(body.version, JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8")).version);
    assert.equal(stub.seen[0].method, "POST");
    assert.equal(stub.seen[0].headers["content-type"], "application/json");
    for (const bad of ["authorization", "apikey", "cookie"]) assert.ok(!(bad in stub.seen[0].headers), bad);
    assert.equal(sent.stdout.split("\n").slice(0, 9).join("\n"), dry.stdout.trimEnd(), "the sent rendering is the one that was shown");
  } finally {
    await stub.close();
    rmSync(cache, { recursive: true, force: true });
  }
});

test("8. the random id is made once; with an unwritable cache folder the send still works with a fresh id and writes nothing else", async () => {
  const stub = await stubServer(201);
  const base = mkdtempSync(join(tmpdir(), "ten-fb-id-"));
  try {
    const cache = join(base, "cache");
    const env = { TEN_FEEDBACK_URL: stub.url, XDG_CACHE_HOME: cache };
    await cli(["--comment", "one"], { env });
    await cli(["--comment", "two"], { env });
    const [a, b] = stub.seen.map((s) => JSON.parse(s.body).installationId);
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.equal(a, b, "the same id on the second run");
    assert.equal(readFileSync(join(cache, "ten", "installation-id"), "utf8").trim(), a);
    assert.deepEqual(readdirSync(cache), ["ten"]);
    assert.deepEqual(readdirSync(join(cache, "ten")), ["installation-id"]);

    // unwritable: the cache "folder" is a file, so nothing can be made under it
    const blocked = join(base, "blocked");
    writeFileSync(blocked, "I am a file");
    const before = readdirSync(base).sort();
    stub.seen.length = 0;
    const out = await cli(["--comment", "three"], { env: { TEN_FEEDBACK_URL: stub.url, XDG_CACHE_HOME: blocked } });
    assert.equal(out.code, 0);
    assert.equal(out.stderr, "");
    assert.equal(lastLine(out.stdout), FB.FB4);
    assert.equal(stub.seen.length, 1);
    assert.match(JSON.parse(stub.seen[0].body).installationId, /^[0-9a-f]{32}$/);
    assert.deepEqual(readdirSync(base).sort(), before, "nothing else was written");
    assert.equal(readFileSync(blocked, "utf8"), "I am a file");
  } finally {
    await stub.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("9. it reads no workspace file: a sentinel in profile.md is never in the body and the folder is unchanged", async () => {
  const stub = await stubServer(201);
  const ws = mkdtempSync(join(tmpdir(), "ten-fb-ws-"));
  const cache = mkdtempSync(join(tmpdir(), "ten-fb-cache-"));
  try {
    const SENTINEL = "ZZ-SENTINEL-" + "Jordan-Reyes-Acme-185000";
    writeFileSync(join(ws, "profile.md"), `# Profile\n${SENTINEL}\n`);
    writeFileSync(join(ws, "jobs.md"), `| ${SENTINEL} |\n`);
    mkdirSync(join(ws, "applications"));
    writeFileSync(join(ws, "applications", "acme-resume.md"), SENTINEL);
    const snap = () => readdirSync(ws, { recursive: true }).sort().map((f) => `${f}:${statSync(join(ws, f)).mtimeMs}:${statSync(join(ws, f)).size}`);
    const before = snap();
    const out = await cli(["--kind", "bug", "--comment", "the cover letter came out wrong"], { env: { TEN_FEEDBACK_URL: stub.url, XDG_CACHE_HOME: cache }, cwd: ws });
    assert.equal(out.code, 0);
    assert.equal(stub.seen.length, 1);
    assert.ok(!stub.seen[0].body.includes("SENTINEL"));
    assert.ok(!out.stdout.includes("SENTINEL"));
    assert.deepEqual(snap(), before, "the folder's file list, sizes and times are unchanged");
  } finally {
    await stub.close();
    rmSync(ws, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test("9b. neither source file looks at the working folder or the conversation", () => {
  for (const file of [SCRIPT, LIB]) {
    const text = readFileSync(file, "utf8");
    assert.ok(!/process\.cwd|readdirSync|opendir|glob|readdir\(/.test(text), `${file} lists or resolves the working folder`);
  }
  const cli = readFileSync(SCRIPT, "utf8");
  // the only reads are the plugin file and the id file
  assert.deepEqual([...cli.matchAll(/readFileSync\(([^,)]+)/g)].map((m) => m[1]).sort(), ["file", "file"]);
});

test("a failing server (429 then a closed port) gives the plain lines, exit 1, nothing on stderr", async () => {
  const stub = await stubServer(429);
  const cache = mkdtempSync(join(tmpdir(), "ten-fb-cache-"));
  try {
    const busy = await cli(["--comment", "hi"], { env: { TEN_FEEDBACK_URL: stub.url, XDG_CACHE_HOME: cache } });
    assert.equal(busy.code, 1);
    assert.equal(lastLine(busy.stdout), FB.FB5);
    assert.equal(busy.stderr, "");
  } finally {
    await stub.close();
  }
  // the stub is closed now: that port refuses the connection
  const gone = await cli(["--comment", "hi"], { env: { TEN_FEEDBACK_URL: stub.url, XDG_CACHE_HOME: cache } });
  assert.equal(gone.code, 1);
  assert.equal(lastLine(gone.stdout), FB.FB6);
  assert.equal(gone.stderr, "");
  rmSync(cache, { recursive: true, force: true });
});

test("the version: CLAUDE_PLUGIN_ROOT first; a copy with no plugin.json above it says unknown", async () => {
  const root = mkdtempSync(join(tmpdir(), "ten-fb-plugin-"));
  const copy = mkdtempSync(join(tmpdir(), "ten-fb-copy-"));
  const cache = mkdtempSync(join(tmpdir(), "ten-fb-cache-"));
  try {
    mkdirSync(join(root, ".claude-plugin"));
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "7.8.9" }));
    const viaRoot = await cli(["--comment", "hi", "--dry-run"], { env: { CLAUDE_PLUGIN_ROOT: root, XDG_CACHE_HOME: cache } });
    assert.ok(viaRoot.stdout.includes("Ten version: 7.8.9"), viaRoot.stdout);

    // as `cp -r skills/* ~/.claude/skills/` leaves it: no plugin.json above the script
    cpSync(join(ROOT, "skills", "feedback"), join(copy, "feedback"), { recursive: true });
    const unknown = await cli(["--comment", "hi", "--dry-run"], { env: { XDG_CACHE_HOME: cache }, script: join(copy, "feedback", "scripts", "feedback.mjs") });
    assert.equal(unknown.code, 0, unknown.stderr);
    assert.ok(unknown.stdout.includes("Ten version: unknown"), unknown.stdout);

    // a version that breaks the rule is not sent
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "bad version!" }));
    const bad = await cli(["--comment", "hi", "--dry-run"], { env: { CLAUDE_PLUGIN_ROOT: root, XDG_CACHE_HOME: cache }, script: join(copy, "feedback", "scripts", "feedback.mjs") });
    assert.ok(bad.stdout.includes("Ten version: unknown"), bad.stdout);
  } finally {
    for (const d of [root, copy, cache]) rmSync(d, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------- section 13, section 17.7

function docRows() {
  const text = readFileSync(join(ROOT, "docs", "design-feedback.md"), "utf8");
  const rows = {};
  for (const line of text.split("\n")) {
    const m = /^\| (FB\d+) \|.*?\| `([^`]*)` \|$/.exec(line);
    if (m) rows[m[1]] = m[2];
  }
  return rows;
}

test("13. every fixed line in the lib is the design doc's, word for word (FB1 to FB14)", () => {
  const rows = docRows();
  for (const id of ["FB1", "FB3", "FB4", "FB5", "FB6", "FB7", "FB8", "FB9", "FB10", "FB11", "FB12", "FB13"]) {
    assert.equal(FB[id], rows[id], id);
  }
  const marks = readFileSync(join(ROOT, "docs", "design-feedback.md"), "utf8").match(/^\| FB14 \|.*$/m)[0];
  for (const mark of Object.values(MARKS)) assert.ok(marks.includes("`" + mark + "`"), mark);
  assert.equal(Object.keys(MARKS).length, 4);
});

test("13b. the gate line in gate-grammar is FB3, word for word", () => {
  const text = readFileSync(join(ROOT, "skills", "coach", "references", "gate-grammar.md"), "utf8");
  assert.ok(text.replace(/\s+/g, " ").includes(`Feedback to the Ten team: "${FB.FB3}"`));
});

test("13c. no user-facing line carries a system word (the plain-voice ruling)", () => {
  const SYSTEM = /\b(gate|schema|json|payload|endpoint|server|error|http|api|\.mjs|\.md)\b|§|_/i;
  for (const [id, line] of Object.entries(FB)) {
    if (id === "FB12" || id === "FB13") continue;
    assert.ok(!SYSTEM.test(line), `${id}: ${line}`);
  }
  for (const label of Object.values(RENDER_LABELS)) assert.ok(!/_/.test(label));
});

test("the lib is host-neutral: no node: import, no window, document or localStorage", () => {
  const text = readFileSync(LIB, "utf8");
  assert.ok(!/from\s+["']node:|require\(/.test(text));
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/\b(window|document|localStorage|process|Buffer|require)\b/.test(code), "no host global");
});

test("the skill's own files carry no email, phone, profile link or home path (the repo's PII shapes)", () => {
  const PII = /\/Users\/[A-Za-z]|\/home\/[a-z]+\/|(?<![A-Za-z0-9._%+-])(?!support@10xjobs\.co\b)[A-Za-z0-9._%+-]+@(?!example\.)[A-Za-z0-9.-]+\.[a-z]{2,}|\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b|linkedin\.com\/in\/[A-Za-z0-9-]+/;
  for (const f of [SCRIPT, LIB]) assert.ok(!PII.test(readFileSync(f, "utf8")), f);
});

// ----------------------------------------------------------------- 16. the function's files (review by code)

test("16. the function's files: one database call, in rpc.ts only; no auth call; no forbidden header read", () => {
  const dir = join(ROOT, "supabase", "functions", "ten-feedback");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const file of ["handler.ts", "index.ts", "core.ts"]) {
    const code = strip(readFileSync(join(dir, file), "utf8"));
    assert.ok(!/\bfetch\s*\(/.test(code), `${file} must not call fetch (the one database call lives in rpc.ts)`);
    assert.ok(!/headers\.get\(\s*["'](authorization|apikey|cookie|x-forwarded-for|x-real-ip|user-agent|cf-connecting-ip)/i.test(code), `${file} reads a forbidden header`);
    assert.ok(!/verifyUser|isMember|balanceFor|\/auth\/v1/.test(code), `${file} touches auth`);
  }
  const handler = strip(readFileSync(join(dir, "handler.ts"), "utf8"));
  // the only request headers read: origin (CORS) and content-length (the size cap)
  assert.deepEqual([...handler.matchAll(/headers\.get\(\s*["']([^"']+)["']/g)].map((m) => m[1]).sort(), ["content-length", "origin"]);
  const rpc = strip(readFileSync(join(dir, "rpc.ts"), "utf8"));
  assert.equal((rpc.match(/rest\/v1\//g) ?? []).length, 1, "exactly one PostgREST endpoint");
  assert.ok(rpc.includes("rpc/ten_feedback_add"));
  assert.deepEqual([...handler.matchAll(/^\s{2}(\w+)\??\(/gm)].map((m) => m[1]).filter((n) => ["addFeedback", "logStatus"].includes(n)).sort(), ["addFeedback", "logStatus"]);
});
