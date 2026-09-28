// Tester-owned (JS-only J2 review). The Chrome-safety tests of the deleted
// tests/test_render_resume.py, ported to render_resume.mjs's toPdf(). J1's
// coverage map marked them N/A ("the JS port never invokes Chrome"); J2 gave
// render_resume.mjs the Chrome path (docs/design-js-only.md § 6 J2), so the
// N/A no longer holds and nothing else in tests/run.py guarded them
// (tests/always-on/probe_guards.sh covers three, outside run.py).
//
// Receipts: 2026-09-26 Chrome-hang incident (headless Chrome reached for the
// caller's default profile and hung; an uncaught timeout crashed the script;
// the agent under test then pkill'd every Chrome on the machine). Independent
// review 2026-09-27: kill the whole process group, default under the agent
// Bash tool's 120 s, no "another Chrome window" hint.
//
// Every "chrome" here is a /bin/sh stand-in passed explicitly (an explicit
// argument always wins over RENDER_RESUME_CHROME and findChrome()), so no
// real browser can ever be launched; the no-Chrome case sets
// RENDER_RESUME_CHROME_PATH_ONLY=1 and an empty PATH in a child process.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RR = join(REPO, "skills", "apply", "scripts", "render_resume.mjs");
const { toPdf } = await import(pathToFileURL(RR).href);

const d = mkdtempSync(join(tmpdir(), "rr-topdf-"));
test.after(() => rmSync(d, { recursive: true, force: true }));
let n = 0;
function stub(body) {
  const p = join(d, `chrome-${++n}`);
  writeFileSync(p, `#!/bin/sh\n${body}`);
  chmodSync(p, 0o755);
  return p;
}
function html() {
  const p = join(d, `r-${++n}.html`);
  writeFileSync(p, "<html></html>");
  return p;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("toPdf gives Chrome its own fresh --user-data-dir and removes it afterwards", async () => {
  const seen = join(d, "argv.txt");
  const pdf = join(d, "own-profile.pdf");
  const c = stub(`for a in "$@"; do echo "$a" >> '${seen}'; done\necho ok > '${pdf}'\n`);
  assert.deepEqual(await toPdf(html(), pdf, c), { ok: true });
  const lines = readFileSync(seen, "utf-8").split("\n");
  const prof = lines.filter((l) => l.startsWith("--user-data-dir="));
  assert.equal(prof.length, 1, lines.join("\n"));
  const dir = prof[0].slice("--user-data-dir=".length);
  assert.match(dir, /render-resume-chrome-profile-/);
  assert.ok(!existsSync(dir), "the profile dir must be removed after the call");
});

test("a timeout is reported plainly, cuts the wait short, and leaves no PDF", async () => {
  const pdf = join(d, "timeout.pdf");
  const t0 = Date.now();
  const r = await toPdf(html(), pdf, stub("sleep 30\n"), 1000);
  const ms = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.match(r.err, /did not finish within 1s/);
  assert.match(r.err, /stopped/);
  assert.ok(ms < 15000, `took ${ms} ms`);
  assert.ok(!existsSync(pdf));
});

test("a timeout kills Chrome's whole process group, its helper children too", async () => {
  const helper = join(d, "helper-sleeper");
  symlinkSync("/bin/sleep", helper);
  const pidFile = join(d, "helper.pid");
  await toPdf(html(), join(d, "group.pdf"), stub(`'${helper}' 60 &\necho $! > '${pidFile}'\nwait\n`), 1000);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(existsSync(pidFile), "the stand-in never recorded its helper's pid");
  const pid = Number(readFileSync(pidFile, "utf-8").trim());
  const still = alive(pid);
  if (still) process.kill(pid, "SIGKILL"); // our own helper only, by the pid it recorded
  assert.ok(!still, `helper ${pid} outlived the timeout: only Chrome's own top PID was killed`);
});

test("the default timeout is under the agent Bash tool's 120 s", () => {
  const src = readFileSync(RR, "utf-8");
  const m = src.match(/export async function toPdf\([^)]*timeoutMs = ([\d_]+)\)/);
  assert.ok(m, "toPdf's default timeout parameter");
  assert.ok(Number(m[1].replace(/_/g, "")) < 120_000, m[1]);
});

test("the timeout message never points at another Chrome window", () => {
  assert.ok(!readFileSync(RR, "utf-8").includes("another Chrome window"));
});

test("no Chrome found: the unchanged message, no PDF (a child process with an empty PATH and PATH_ONLY)", () => {
  const pdf = join(d, "none.pdf");
  const code = `const { toPdf } = await import(${JSON.stringify(pathToFileURL(RR).href)});
console.log(JSON.stringify(await toPdf(${JSON.stringify(html())}, ${JSON.stringify(pdf)})));`;
  const env = { PATH: join(d, "empty-path"), RENDER_RESUME_CHROME_PATH_ONLY: "1", HOME: d };
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf-8", env });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.err, /no Chrome\/Chromium found/);
  assert.ok(!existsSync(pdf));
});

test("the page target is reported, not enforced, by default: over target without --strict exits 0 and says never trim silently", () => {
  const pdf2 = "%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count 2 >>\nendobj\n2 0 obj\n<< /Type /Page >>\nendobj\n3 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n";
  writeFileSync(join(d, "two.pdf"), pdf2);
  const c = stub(`out=\nfor a in "$@"; do case "$a" in --print-to-pdf=*) out="\${a#--print-to-pdf=}";; esac; done\n/bin/cat '${join(d, "two.pdf")}' > "$out"\n`);
  writeFileSync(join(d, "r.md"), "# A\n\n## Summary\n\n- x.\n");
  const env = { ...process.env, RENDER_RESUME_CHROME: c };
  const base = ["--md", join(d, "r.md"), "--html", join(d, "o.html"), "--pdf", join(d, "o.pdf"), "--pages", "1"];
  const r = spawnSync(process.execPath, [RR, ...base], { encoding: "utf-8", env, cwd: d });
  assert.match(r.stdout, /pages: 2 \(target 1\) {2}← OVER/, r.stdout);
  assert.match(r.stdout, /never trim silently/);
  assert.equal(r.status, 0, "strict must be opt-in, not the default");
  const s = spawnSync(process.execPath, [RR, ...base, "--strict"], { encoding: "utf-8", env, cwd: d });
  assert.equal(s.status, 1);
});
