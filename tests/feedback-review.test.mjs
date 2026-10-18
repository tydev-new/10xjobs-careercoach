// Independent review (tester, 2026-10-17) of the feedback skill's local script:
// docs/design-feedback.md § 6, § 7, § 8, § 13 and § 17.1, stage 1. Written from
// the doc, not the code.
//
// What is different from tests/feedback.test.mjs: the REAL command
// (`node skills/feedback/scripts/feedback.mjs`), run as a child process with a
// planted workspace as its working folder, sending to a capture server on
// 127.0.0.1 that records method, path, every header and the body; and a
// preloaded tracer (tests/feedback-review/fs-trace.cjs) that records every path
// the script asks the file system about. Expected strings are read from the
// doc (§ 7, § 13) and the phone shape from tests/test_invariants.py at run time.
//
//   node --test tests/feedback-review.test.mjs
//
// Nothing here leaves 127.0.0.1: every run sets TEN_FEEDBACK_URL to a local
// server, and a guard below refuses to run the command without it.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as lib from "../skills/feedback/scripts/lib/feedback.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "skills/feedback/scripts/feedback.mjs");
const TRACE = path.join(REPO, "tests/feedback-review/fs-trace.cjs");
const DOC = readFileSync(path.join(REPO, "docs/design-feedback.md"), "utf8");
const KEYS = ["kind", "comment", "rating", "skill", "step", "version", "host", "installationId"];

// ------------------------------------------------------------ the doc's strings
const S13 = DOC.slice(DOC.indexOf("## 13. Every user-facing string"), DOC.indexOf("## 14."));
const FBDOC = Object.fromEntries(
  [...S13.matchAll(/^\| (FB\d+) \| [^|]+ \| (.+) \|$/gm)].map((m) => [m[1], [...m[2].matchAll(/`([^`]+)`/g)].map((x) => x[1])]),
);
const S7 = DOC.slice(DOC.indexOf("## 7. What they see"), DOC.indexOf("## 8."));
const LABELS_LINE = S7.slice(S7.indexOf("Labels and values, word for word:"), S7.indexOf("Then, in the reply")).replace(/\s+/g, " ");
const DOC_LABELS = [...LABELS_LINE.matchAll(/`([^`]+:)`/g)].map((m) => m[1]);
const PII_PHONE = (() => {
  const line = readFileSync(path.join(REPO, "tests/test_invariants.py"), "utf8").split("\n").find((l) => l.includes("# a phone number"));
  const m = /r"\|(.+?)"\s+#/.exec(line);
  assert.ok(m, "the PII phone shape was not found in tests/test_invariants.py");
  return new RegExp(m[1], "g");
})();
const FORBIDDEN_WORDS = /\bHTTP\b|status|server|endpoint|error|Supabase|\bkey\b|\b\d{3}\b/i;

// ------------------------------------------------------------ a capture server
const seen = [];
let mode = { status: 201 };
let srv;
let URL0 = "";
let srv2;
let URL2 = "";
const seen2 = [];
before(async () => {
  srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, raw: req.rawHeaders, body: Buffer.concat(chunks).toString("utf8") });
      if (mode.hang) return; // never answer
      if (mode.redirect) {
        res.writeHead(mode.redirect, { location: URL2 + "/elsewhere" }).end();
        return;
      }
      res.writeHead(mode.status, { "content-type": "application/json", "x-detail": "server error key 503" }).end(JSON.stringify({ status: "sent", error: "HTTP 500 server error from Supabase endpoint" }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  URL0 = `http://127.0.0.1:${srv.address().port}/functions/v1/ten-feedback`;
  srv2 = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen2.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(201).end("{}");
    });
  });
  await new Promise((r) => srv2.listen(0, "127.0.0.1", r));
  URL2 = `http://127.0.0.1:${srv2.address().port}`;
});
after(async () => {
  srv.closeAllConnections?.();
  srv2.closeAllConnections?.();
  await new Promise((r) => srv.close(() => r()));
  await new Promise((r) => srv2.close(() => r()));
});

const temps = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), p)); temps.push(d); return d; };

/** Runs the real command. Refuses to run without a loopback TEN_FEEDBACK_URL. */
function cli(args, { cwd, env = {}, script = SCRIPT, trace } = {}) {
  const e = { PATH: process.env.PATH, HOME: env.HOME ?? tmp("fb-home-"), XDG_CACHE_HOME: env.XDG_CACHE_HOME ?? tmp("fb-cache-"), TEN_FEEDBACK_URL: URL0, ...env };
  assert.match(e.TEN_FEEDBACK_URL, /^http:\/\/127\.0\.0\.1:\d+\//, "refusing to run the command without a loopback URL");
  if (trace) e.FS_TRACE = trace;
  const argv = trace ? ["--require", TRACE, script, ...args] : [script, ...args];
  return new Promise((resolve) => {
    const p = spawn(process.execPath, argv, { cwd: cwd ?? tmp("fb-cwd-"), env: e });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => resolve({ code, stdout, stderr, last: stdout.trimEnd().split("\n").pop() }));
  });
}
const lastReq = () => seen[seen.length - 1];
/** The eight value lines of a rendering, as { label: value }. */
function parseRendering(text) {
  const lines = text.trimEnd().split("\n");
  const at = lines.indexOf(lib.FB.FB1);
  assert.ok(at >= 0, `no FB1 in: ${text}`);
  return lines.slice(at + 1, at + 9).map((l) => { const i = l.indexOf(": "); return [l.slice(0, i + 1), l.slice(i + 2)]; });
}
/** § 7's mapping from a body value to its shown text. */
function shownValue(key, v) {
  if (key === "kind") return v === "bug" ? "bug report" : "comment";
  if (key === "rating") return v === null ? "none" : `${v} of 5`;
  if (key === "host") return v === "web" ? "the Ten website" : "your computer";
  if (key === "installationId") return v === null ? "none" : `${v} (made once on this computer; not linked to your name or email)`;
  return v === "" || v === null ? "none" : String(v);
}

// ============================================================ strings

test("S1 FB1 and FB3-FB13 are the doc's § 13 words, FB14 its four marks, and the eight labels § 7's", () => {
  assert.equal(Object.keys(FBDOC).length, 14, JSON.stringify(Object.keys(FBDOC)));
  for (const id of ["FB1", "FB3", "FB4", "FB5", "FB6", "FB7", "FB8", "FB9", "FB10", "FB11", "FB12", "FB13"]) {
    assert.equal(FBDOC[id].length, 1, id);
    assert.equal(lib.FB[id], FBDOC[id][0], id);
  }
  assert.deepEqual(Object.values(lib.MARKS), FBDOC.FB14);
  assert.deepEqual(DOC_LABELS, ["Kind:", "Your words:", "Rating:", "Skill:", "Step:", "Ten version:", "Sent from:", "Random id:"]);
  assert.deepEqual(KEYS.map((k) => lib.RENDER_LABELS[k]), DOC_LABELS);
  // the gate line as it lands in gate-grammar
  const gg = readFileSync(path.join(REPO, "skills/coach/references/gate-grammar.md"), "utf8").replace(/\s+/g, " ");
  assert.ok(gg.includes(`Feedback to the Ten team: "${FBDOC.FB3[0]}"`), "gate-grammar's line is not FB3 word for word");
});

test("S2 voice: scan_voice.py --reply over every line the person can see (FB1, FB3-FB10, FB14, a full rendering of each host) finds no HARD hit", () => {
  const d = tmp("fb-voice-");
  const f = path.join(d, "reply.md");
  const local = lib.renderFeedback({ kind: "bug", comment: "the letter check keeps flagging dates that are right", rating: 4, skill: "apply", step: "Tailoring", version: "0.9.2", host: "local", installationId: "3f9c0a7e5b2d4c18a6e0f1b2c3d4e5f6" });
  const web = lib.renderFeedback({ kind: "comment", comment: "", rating: 5, skill: "", step: "", version: "abc123", host: "web", installationId: null });
  const text = [local, web, ...["FB3", "FB4", "FB5", "FB6", "FB7", "FB8", "FB9", "FB10", "FB11", "FB12", "FB13"].map((k) => lib.FB[k]), Object.values(lib.MARKS).join(" ")].join("\n\n") + "\n";
  writeFileSync(f, text);
  const r = spawnSync("python3", [path.join(REPO, "tests/always-on/scan_voice.py"), "--reply", f], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  console.log(`  [S2] scan_voice: ${JSON.stringify(r.stdout)}`);
  assert.deepEqual(r.stdout.split("\n").filter((l) => l.startsWith("HARD")), []);
});

// ============================================================ the payload, end to end

test("P1 the real command: the body is exactly the eight keys in order, nothing else; no Authorization, apikey or cookie header; nothing from the environment rides along; the dry run and the send show the same eight lines, and each equals the body's value byte for byte", async () => {
  const ENV_SENTINEL = "ENVSENTINEL7781";
  const cases = [
    ["--kind", "bug", "--comment", "the letter check keeps flagging dates that are right", "--skill", "apply", "--step", "Tailoring"],
    ["--comment", "  spaces   and\ttabs\nand a line break  ", "--rating", "3"],
    ["--rating", "5"],
    ["--comment", "Rating: 1 of 5\nSkill: apply\nnone", "--skill", "nonsense", "--step", "a/b"],
    ["--kind=comment", "--comment=émoji 😀 and CJK 漢字", "--rating=2", "--skill=coach", "--step=Full evaluation"],
  ];
  for (const args of cases) {
    const env = { USER: ENV_SENTINEL, LOGNAME: ENV_SENTINEL, HOSTNAME: ENV_SENTINEL, ANTHROPIC_API_KEY: ENV_SENTINEL, OPENROUTER_API_KEY: ENV_SENTINEL, SUPABASE_ANON_KEY: ENV_SENTINEL };
    const cache = tmp("fb-cache-");
    const dry = await cli([...args, "--dry-run"], { env: { ...env, XDG_CACHE_HOME: cache } });
    const n0 = seen.length;
    mode = { status: 201 };
    const sent = await cli(args, { env: { ...env, XDG_CACHE_HOME: cache } });
    assert.equal(dry.code, 0, dry.stdout);
    assert.equal(sent.code, 0, sent.stdout);
    assert.equal(dry.stderr + sent.stderr, "", "something reached stderr");
    assert.equal(seen.length, n0 + 1, "one request per send");
    const req = lastReq();
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/functions/v1/ten-feedback");
    const body = JSON.parse(req.body);
    assert.deepEqual(Object.keys(body), KEYS, "the body's keys");
    assert.equal(req.body, JSON.stringify(body), "the body is plain JSON of the eight keys (no padding, nothing appended)");
    for (const h of ["authorization", "apikey", "cookie", "x-client-info"]) assert.ok(!(h in req.headers), `header ${h} was sent`);
    assert.equal(req.headers["content-type"], "application/json");
    assert.ok(!JSON.stringify(req).includes(ENV_SENTINEL), `an environment value rode along: ${JSON.stringify(req.headers)}`);
    // the dry run's lines, the send's lines and the body agree
    assert.deepEqual(parseRendering(sent.stdout), parseRendering(dry.stdout), `${args}: the send showed something else than the dry run`);
    const shown = parseRendering(dry.stdout);
    KEYS.forEach((k, i) => {
      assert.equal(shown[i][0], lib.RENDER_LABELS[k], `${k}: label`);
      assert.equal(shown[i][1], shownValue(k, body[k]), `${args}: ${k} shown "${shown[i][1]}" but sent ${JSON.stringify(body[k])}`);
    });
    assert.equal(dry.stdout.trimEnd().split("\n").length, 9, "FB1 and eight lines, nothing else");
    assert.equal(sent.last, lib.FB.FB4);
  }
});

test("P2 nothing from the workspace reaches the request: a planted workspace with sentinels in every usual file is the working folder; no sentinel is in the request; no file in it changes; the script reads nothing in it", async () => {
  const ws = tmp("fb-ws-");
  const S = { name: "Zebulon Quartermaine", email: "zeb.q.sentinel@quartz-mail.test", phone: "212.555.0199", employer: "Fictorial Dynamics", salary: "SALARY-417k-SENTINEL", path: "SENTINEL-PATH-9931" };
  writeFileSync(path.join(ws, "profile.md"), `# ${S.name}\n${S.email} · ${S.phone}\nNow at ${S.employer}, floor ${S.salary}\n`);
  writeFileSync(path.join(ws, "jobs.md"), `| ${S.employer} | Senior | ${S.salary} |\n`);
  writeFileSync(path.join(ws, "plan.md"), `- [ ] write to ${S.name}\n`);
  writeFileSync(path.join(ws, "criteria.md"), `floor ${S.salary}\n`);
  writeFileSync(path.join(ws, "CLAUDE.md"), `Workspace of ${S.name}\n`);
  writeFileSync(path.join(ws, ".env"), `TOKEN=${S.path}\n`);
  mkdirSync(path.join(ws, "applications", S.path), { recursive: true });
  writeFileSync(path.join(ws, "applications", S.path, "cover-letter.md"), `Dear ${S.employer},\n`);
  mkdirSync(path.join(ws, ".claude"), { recursive: true });
  writeFileSync(path.join(ws, ".claude", "settings.json"), JSON.stringify({ env: { TEN_FEEDBACK_URL: "https://ivunfotoggdxbjouumdk.supabase.co/x", NOTE: S.name } }));
  const snapshot = () => {
    const out = {};
    const walk = (d) => { for (const n of readdirSync(d)) { const a = path.join(d, n); const st = statSync(a); if (st.isDirectory()) walk(a); else out[path.relative(ws, a)] = createHash("sha256").update(readFileSync(a)).digest("hex") + ":" + st.mtimeMs; } };
    walk(ws);
    return out;
  };
  const before = snapshot();
  const trace = path.join(tmp("fb-trace-"), "trace.jsonl");
  const n0 = seen.length;
  mode = { status: 201 };
  const words = "the cover letter for Acme came out wrong";
  const dry = await cli(["--kind", "bug", "--skill", "apply", "--comment", words, "--dry-run"], { cwd: ws, trace });
  const sent = await cli(["--kind", "bug", "--skill", "apply", "--comment", words], { cwd: ws, trace });
  assert.equal(dry.code + sent.code, 0, dry.stdout + sent.stdout);
  assert.equal(seen.length, n0 + 1);
  const req = JSON.stringify(lastReq());
  for (const [k, v] of Object.entries(S)) assert.ok(!req.includes(v), `${k} from the workspace is in the request`);
  for (const f of ["profile.md", "jobs.md", "plan.md", "cover-letter", "CLAUDE"]) assert.ok(!JSON.parse(lastReq().body).comment.includes(f));
  assert.equal(JSON.parse(lastReq().body).comment, words);
  assert.deepEqual(snapshot(), before, "a workspace file changed, appeared or went");
  const touched = readFileSync(trace, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const real = (p) => { try { return require("node:fs").realpathSync(p); } catch { return p; } };
  void real;
  const inWs = touched.filter((t) => t.path === ws || t.path.startsWith(ws + path.sep) || t.path.startsWith(path.join("/private", ws) + path.sep));
  console.log(`  [P2] the script touched ${touched.length} paths; in the workspace: ${JSON.stringify(inWs)}`);
  console.log(`  [P2] every path touched: ${JSON.stringify([...new Set(touched.map((t) => `${t.op} ${t.path.replace(REPO, "<repo>")}`))])}`);
  assert.deepEqual(inWs, [], "the script asked about a path under its working folder");
});

test("P2b the in-workspace layout (skills copied into <workspace>/.claude/skills, as the t22 runner and a project-scoped install do): the version search walks up through the workspace, and a workspace's own .claude-plugin/plugin.json is read and its version sent", { todo: "FINDING (tester, 2026-10-17): § 8.3 says the script 'never opens a file under its working folder'; with the skills inside the workspace, readVersion walks up from the script and reads <workspace>/.claude-plugin/plugin.json, whose version (up to 40 of [0-9A-Za-z.+-]) is sent" }, async () => {
  const ws = tmp("fb-ws2-");
  mkdirSync(path.join(ws, ".claude", "skills"), { recursive: true });
  cpSync(path.join(REPO, "skills/feedback"), path.join(ws, ".claude/skills/feedback"), { recursive: true });
  mkdirSync(path.join(ws, ".claude-plugin"));
  writeFileSync(path.join(ws, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "ZebulonQuartermaine-417k" }));
  writeFileSync(path.join(ws, "profile.md"), "# Zebulon Quartermaine\n");
  const trace = path.join(tmp("fb-trace-"), "trace.jsonl");
  const n0 = seen.length;
  mode = { status: 201 };
  const r = await cli(["--comment", "it works"], { cwd: ws, script: path.join(ws, ".claude/skills/feedback/scripts/feedback.mjs"), trace });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(seen.length, n0 + 1);
  const body = JSON.parse(lastReq().body);
  const touched = readFileSync(trace, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((t) => t.path.startsWith(ws) || t.path.startsWith("/private" + ws));
  console.log(`  [P2b] version sent: ${JSON.stringify(body.version)}; reads under the workspace: ${JSON.stringify(touched.filter((t) => !t.path.includes("/.claude/skills/feedback/scripts/feedback.mjs") && !t.path.includes("/lib/")))}`);
  assert.notEqual(body.version, "ZebulonQuartermaine-417k", "a string from a workspace file was sent as the version");
  assert.deepEqual(touched.filter((t) => t.op === "readFileSync" && t.path.endsWith("plugin.json")), [], "a plugin.json under the working folder was read");
});

// ============================================================ redaction

const REQUIRED = {
  email: ["jane.doe@gmail.com", "jane.doe+ten@gmail.com", "JANE.DOE@GMAIL.COM", "a@b.co", "first.last@mail.sub.domain.co.uk", "user_name-1@x-y.io", "x%y@z.org", "mailto:jo@x.com", "https://x.com/?e=jo@x.com&a=1", "write to jo@x.com.", "<jo@x.com>"],
  phone: ["(415) 555-0100", "415-555-0100", "415.555.0100", "415 555 0100", "+1 415 555 0100", "+1-415-555-0100", "1-800-555-0199", "https://example.com/call/415-555-0100", "tel:415-555-0100"],
  link: ["linkedin.com/in/jane-doe", "https://www.linkedin.com/in/jane-doe/", "http://uk.linkedin.com/in/JaneDoe", "LinkedIn.com/in/jane"],
  path: ["/Users/alex/job-search/profile.md", "/home/alex/job-search", "see /Users/alex/x.md, then"],
};
test("R1 every form the doc requires is blanked to its FB14 mark (email; the PII phone shape, read from test_invariants.py; a LinkedIn profile link; a macOS or Linux home path), through the real command, and the original is not in the body", async () => {
  for (const [kind, list] of Object.entries(REQUIRED)) {
    for (const s of list) {
      if (kind === "phone") assert.ok(new RegExp(PII_PHONE.source).test(s), `not the PII phone shape: ${s}`);
      const comment = `before ${s} after`;
      const out = lib.redact(comment);
      const mark = lib.MARKS[kind];
      assert.ok(out.includes(mark), `${kind} "${s}" -> "${out}"`);
      const core = kind === "email" ? /[^\s<>?=&:]+@[^\s<>?&]+?(?=[.>]?(\s|&|$))/.exec(s)[0] : kind === "phone" ? new RegExp(PII_PHONE.source).exec(s)[0] : kind === "link" ? s.replace(/^.*?linkedin\.com\/in\//i, "") .replace(/\/$/, "") : s.replace(/^see /, "").replace(/, then$/, "");
      assert.ok(!out.includes(core), `${kind} "${s}": "${core}" survives in "${out}"`);
    }
  }
  // and once through the real command, all at once
  const all = Object.values(REQUIRED).flat().join(" | ");
  const n0 = seen.length;
  mode = { status: 201 };
  const r = await cli(["--comment", all]);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(seen.length, n0 + 1);
  const body = JSON.parse(lastReq().body);
  for (const s of ["jane.doe", "gmail", "415", "555-0100", "jane-doe", "/Users/alex", "/home/alex"]) assert.ok(!body.comment.toLowerCase().includes(s.toLowerCase()), `"${s}" survived: ${body.comment}`);
  assert.equal(parseRendering(r.stdout)[1][1], body.comment, "the shown words are the redacted words");
});

// Forms the doc does not require (its phone shape is test_invariants.py's, a North American one) — each is
// run and its outcome printed; the hand-back reads them.
const BEYOND = [
  ["intl UK landline", "+44 20 7946 0958"], ["intl UK mobile", "+44 7700 900123"], ["UK national", "07700 900123"],
  ["France", "+33 6 12 34 56 78"], ["Germany", "+49 30 12345678"], ["India", "+91 98765 43210"], ["China", "+86 138 0013 8000"],
  ["US no separators", "4155550100"], ["US E.164", "+14155550100"], ["US (415)555-0100", "(415)555-0100"],
  ["phone in a wa.me link", "https://wa.me/14155550100"], ["tel: E.164", "tel:+14155550100"],
  ["email local part over 64", `${"a".repeat(70)}@gmail.com`], ["email with an apostrophe", "o'brien@gmail.com"],
  ["IDN email", "jürgen@müller.de"], ["obfuscated email", "jo at gmail dot com"],
  ["Windows home path", "C:\\Users\\alex\\job-search"], ["tilde path", "~/job-search/profile.md"],
  ["home path with a space", "/Users/alex smith/job-search"], ["unicode LinkedIn slug", "linkedin.com/in/jürgen-müller"],
  ["LinkedIn company page", "linkedin.com/company/acme"], ["a date", "2026-10-17"], ["a version", "0.9.2"], ["a price", "$150,000"],
];
test("R2 characterization: forms beyond the doc's shapes, each run through the redaction and printed (no assertion but that nothing throws)", (t) => {
  const rows = BEYOND.map(([what, s]) => { const out = lib.redact(`x ${s} y`); return `${what}: ${JSON.stringify(s)} -> ${JSON.stringify(out)}`; });
  for (const r of rows) { t.diagnostic(r); console.log("  [R2] " + r); }
});

test("R3 an email whose local part is over 64 characters, or holds an apostrophe, leaves part of its address in the body", { todo: "FINDING (tester, 2026-10-17): the email pattern has no left boundary, so it matches only the last 64 characters of a long local part, or the part after an apostrophe; the rest of the address is sent" }, () => {
  for (const s of [`${"zebulonquartermaine".repeat(4)}@gmail.com`, "o'brien.sentinel@gmail.com"]) {
    const out = lib.redact(`mail ${s} now`);
    assert.equal(out, `mail ${lib.MARKS.email} now`, `"${s}" -> "${out}"`);
  }
});

// ============================================================ the builder's three choices

test("C1 whitespace: line breaks, tabs and runs of spaces in the words are collapsed to one space before anything is shown or sent (so § 7's one line per field holds), and the shown text is the sent text", async () => {
  const n0 = seen.length;
  mode = { status: 201 };
  const r = await cli(["--comment", "line one\nRating: 5 of 5\r\n\tSkill: apply   end"]);
  const body = JSON.parse(seen[n0].body);
  assert.equal(body.comment, "line one Rating: 5 of 5 Skill: apply end");
  assert.equal(parseRendering(r.stdout)[1][1], body.comment);
  assert.equal(r.stdout.trimEnd().split("\n").length, 10, "FB1, eight lines, the result line");
});

test("C2 the 20,000-character pre-cut: words that would be 2,000 characters or fewer after redaction and the whitespace collapse are refused with FB9 ('over 2,000 characters') when the raw text is over 20,000", { todo: "FINDING (tester, 2026-10-17): § 8.4 counts after redaction; the lib refuses anything over 20,000 raw characters first, so a note that would be short after redaction or the whitespace collapse is refused with FB9, a line that is then untrue" }, async () => {
  const spaces = "hello" + " ".repeat(20001) + "world";
  assert.equal(lib.buildFeedback({ comment: spaces }, { host: "local" }).comment, "hello world", "20,001 spaces between two words");
  const emails = Array.from({ length: 70 }, (_, i) => `${"x".repeat(60)}${i}@${"d".repeat(240)}.com`).join(" ");
  assert.ok(emails.length > 20000);
  const b = lib.buildFeedback({ comment: emails }, { host: "local" });
  assert.ok(!b.error, `seventy long emails: ${JSON.stringify(b.error)}`);
});

test("C3 an unwritable cache folder: the dry run and the send each make a fresh id, so the id the person saw is not the id that went", { todo: "FINDING (tester, 2026-10-17): § 8.3 'a fresh id is used for this send' and § 5.8 'the only text this skill ever sends is the rendering the candidate saw' disagree when the id file can't be written: the dry run shows one id and the send carries another" }, async () => {
  const blocker = path.join(tmp("fb-cache-ro-"), "not-a-dir");
  writeFileSync(blocker, "a file where the cache folder should be\n");
  const dry = await cli(["--comment", "hello", "--dry-run"], { env: { XDG_CACHE_HOME: blocker } });
  const n0 = seen.length;
  mode = { status: 201 };
  const sent = await cli(["--comment", "hello"], { env: { XDG_CACHE_HOME: blocker } });
  assert.equal(sent.code, 0);
  assert.equal(seen.length, n0 + 1);
  const shownId = parseRendering(dry.stdout)[7][1].split(" ")[0];
  const sentId = JSON.parse(lastReq().body).installationId;
  console.log(`  [C3] dry run showed ${shownId}; the send carried ${sentId}`);
  assert.ok(/^[0-9a-f]{32}$/.test(sentId));
  assert.equal(readFileSync(blocker, "utf8"), "a file where the cache folder should be\n", "the blocker file was written");
  assert.equal(sentId, shownId, "the id shown is not the id sent");
});

test("C4 the id file is made once, 32 lowercase hex, mode 600, under XDG_CACHE_HOME/ten; the dry run makes it too; it is never under the working folder", async () => {
  const cache = tmp("fb-cache-");
  const cwd = tmp("fb-cwd-");
  await cli(["--comment", "a", "--dry-run"], { env: { XDG_CACHE_HOME: cache }, cwd });
  const file = path.join(cache, "ten", "installation-id");
  assert.ok(existsSync(file));
  const id = readFileSync(file, "utf8").trim();
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  mode = { status: 201 };
  await cli(["--comment", "a"], { env: { XDG_CACHE_HOME: cache }, cwd });
  assert.equal(JSON.parse(lastReq().body).installationId, id);
  assert.deepEqual(readdirSync(cwd), []);
  // with XDG_CACHE_HOME unset, the default is HOME/.cache/ten
  const home = tmp("fb-home-");
  const r = await cli(["--comment", "a", "--dry-run"], { env: { HOME: home, XDG_CACHE_HOME: "" }, cwd });
  assert.equal(r.code, 0);
  assert.ok(existsSync(path.join(home, ".cache", "ten", "installation-id")), "the default place");
});

// ============================================================ the command line and the send

test("A1 refusals: FB7, FB8, FB9, FB10 and the model-facing lines; exit 1; the line last; no request; nothing on stderr", async () => {
  const n0 = seen.length;
  const cases = [
    [[], lib.FB.FB7], [["--comment", "   "], lib.FB.FB7], [["--kind", "bug", "--rating", "4"], lib.FB.FB8],
    [["--comment", "x".repeat(2001)], lib.FB.FB9], [["--comment", "😀".repeat(2001)], lib.FB.FB9],
    [["--rating", "0"], lib.FB.FB10], [["--rating", "6"], lib.FB.FB10], [["--rating", "2.5"], lib.FB.FB10], [["--rating", "five"], lib.FB.FB10], [["--rating", ""], lib.FB.FB10],
    [["--kind", "praise", "--comment", "x"], lib.BAD_KIND], [["--colour", "x"], lib.USAGE], [["--comment"], lib.USAGE],
  ];
  for (const [args, line] of cases) {
    const r = await cli(args);
    assert.equal(r.code, 1, `${args}: exit`);
    assert.equal(r.last, line, `${args}`);
    assert.equal(r.stderr, "", `${args}: stderr`);
  }
  assert.equal(seen.length, n0, "a refusal made a request");
  // exactly 2,000 characters, and 2,000 emoji (code points), go
  for (const c of ["x".repeat(2000), "😀".repeat(2000)]) assert.equal((await cli(["--comment", c, "--dry-run"])).code, 0);
});

test("A2 answers through the real command: 201 FB4 exit 0; 429 FB5; 200, 202, 204, 400, 401, 413, 500, 503, a closed port and a hang past 15 s FB6; exit 1; the server's own words never shown; nothing on stderr", async () => {
  const table = [[201, lib.FB.FB4, 0], [429, lib.FB.FB5, 1], ...[200, 202, 204, 400, 401, 404, 413, 500, 503].map((s) => [s, lib.FB.FB6, 1])];
  for (const [status, line, code] of table) {
    mode = { status };
    const r = await cli(["--comment", "hello"]);
    assert.equal(r.last, line, `HTTP ${status}`);
    assert.equal(r.code, code, `HTTP ${status}: exit`);
    assert.equal(r.stderr, "");
    const said = r.stdout.split("\n").filter((l) => l.trim() && !l.startsWith("Random id:") && !l.startsWith("Ten version:"));
    for (const l of said) assert.ok(!FORBIDDEN_WORDS.test(l), `HTTP ${status}: "${l}"`);
  }
  // a closed port
  const closed = await cli(["--comment", "hello"], { env: { TEN_FEEDBACK_URL: "http://127.0.0.1:9/x/" } });
  assert.deepEqual([closed.last, closed.code, closed.stderr], [lib.FB.FB6, 1, ""]);
  // a server that never answers: the 15-second timeout
  mode = { hang: true };
  const t0 = Date.now();
  const hung = await cli(["--comment", "hello"]);
  const took = Date.now() - t0;
  mode = { status: 201 };
  srv.closeAllConnections?.();
  assert.deepEqual([hung.last, hung.code, hung.stderr], [lib.FB.FB6, 1, ""]);
  assert.ok(took >= 14500 && took < 25000, `the hang ended after ${took} ms`);
});

test("A3 the send follows a redirect: a 307 from the configured address re-posts the whole note to wherever it points", { todo: "FINDING (tester, 2026-10-17): sendFeedback uses fetch's default redirect: 'follow', so a 307/308 answer sends the note on to another address (the doc is silent; the harness guard checks only the configured URL)" }, async () => {
  const n2 = seen2.length;
  mode = { redirect: 307 };
  const r = await cli(["--comment", "redirect me"]);
  mode = { status: 201 };
  console.log(`  [A3] after a 307 the command said ${JSON.stringify(r.last)}; the second address got ${seen2.length - n2} request(s): ${JSON.stringify(seen2.slice(n2))}`);
  assert.equal(seen2.length - n2, 0, "the note reached a second address");
});

test("A4 an empty value: `--comment --dry-run` takes '--dry-run' as the words and SENDS instead of showing", { todo: "FINDING (tester, 2026-10-17): parseArgs takes the next argument as a flag's value even when it is another flag, so a dry run with an empty --comment value sends the note '--dry-run'" }, async () => {
  const n0 = seen.length;
  mode = { status: 201 };
  const r = await cli(["--comment", "--dry-run"]);
  console.log(`  [A4] exit ${r.code}, last line ${JSON.stringify(r.last)}, requests ${seen.length - n0}`);
  assert.equal(seen.length - n0, 0, "a command with --dry-run in it sent a note");
});

test("A5 the production address is the doc's constant, used only when TEN_FEEDBACK_URL is unset or empty (checked on the lib, never sent)", async () => {
  assert.equal(lib.PROD_URL, /`(https:\/\/ivunfotoggdxbjouumdk\.supabase\.co\/functions\/v1\/ten-feedback)`/.exec(DOC)[1]);
  const urls = [];
  const fake = async (u) => { urls.push(u); return { status: 201 }; };
  for (const env of [{}, { TEN_FEEDBACK_URL: "" }, { TEN_FEEDBACK_URL: "http://127.0.0.1:1/x" }]) {
    await lib.run(["--comment", "x"], { env, fetchImpl: fake, context: () => ({ version: "1", installationId: null }) });
  }
  assert.deepEqual(urls, [lib.PROD_URL, lib.PROD_URL, "http://127.0.0.1:1/x"]);
});

test("A6 every kind of call to the real command either prints a rendering or a refusal: no crash on odd input (a lone surrogate, NUL-free control characters, a 19,999-character comment, a step of 60 emoji)", async () => {
  const odd = [["--comment", "a\u0001b\u007fc\u200bd"], ["--comment", "x".repeat(1999) + "😀"], ["--comment", "ok", "--step", "😀".repeat(60)], ["--comment", "ok", "--step", "😀".repeat(61)], ["--comment", "ok", "--step", "line\u2028sep"]];
  for (const args of odd) {
    const r = await cli([...args, "--dry-run"]);
    assert.equal(r.stderr, "", `${args}`);
    assert.ok([0, 1].includes(r.code), `${args}: exit ${r.code}`);
  }
  const st = parseRendering((await cli(["--comment", "ok", "--step", "😀".repeat(60), "--dry-run"])).stdout)[4][1];
  assert.equal(st, "😀".repeat(60), "60 characters (code points) is allowed");
  assert.equal(parseRendering((await cli(["--comment", "ok", "--step", "😀".repeat(61), "--dry-run"])).stdout)[4][1], "none");
  void chmodSync;
});
