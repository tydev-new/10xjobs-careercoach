// Tester-owned (JS-only J2 review). docs/design-js-only.md § 2: "the file a
// skill names is the file every host runs" — and § 6 J2's tester checks run
// each command "from another folder" and from `~/.claude/skills`. A command
// must run wherever the skills tree sits: under a symlink (macOS's
// /var -> /private/var, where `mktemp -d` puts every harness workspace), in a
// folder whose name has a space, `%`, `#`, or a non-ASCII letter.
//
// Every one of the seven command files is run with `--help` (argparse's own
// text, stdout, exit 0) from each such location; silence with exit 0 is the
// failure this guards (a command that did nothing and said so to no one).
//
// A second block: render_resume.mjs's toPdf() against a stand-in Chrome
// (never a real browser) that writes a lot to stderr, as a real Chrome can.
// The retired Python drained stderr (communicate()); a child whose stderr
// pipe is never read blocks once the pipe fills, and the render would sit
// until the 90 s timeout and report "did not finish" for a PDF that was
// already written.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS = join(REPO, "skills");
const COMMANDS = [
  "apply/scripts/check_materials.mjs",
  "apply/scripts/proposal_block.mjs",
  "apply/scripts/render_resume.mjs",
  "evaluate/scripts/record_verdict.mjs",
  "search/scripts/update_job.mjs",
  "profile/scripts/check_files.mjs",
  "coach/scripts/check_closeout.mjs",
];

const base = mkdtempSync(join(tmpdir(), "skill-cmd-paths-")); // /var/folders/... on macOS: itself under a symlink
test.after(() => rmSync(base, { recursive: true, force: true }));

function place(name) {
  const d = join(base, name);
  mkdirSync(d, { recursive: true });
  cpSync(SKILLS, join(d, "skills"), { recursive: true });
  return join(d, "skills");
}
const plain = place("plain");
symlinkSync(join(base, "plain"), join(base, "link"));
const LOCATIONS = {
  "the repo's own skills/ (control)": SKILLS,
  "a copy under os.tmpdir() (macOS: /var/folders, beneath the /var -> /private/var symlink)": plain,
  "a symlinked folder": join(base, "link", "skills"),
  "a folder with a space": place("with space"),
  "a folder with %": place("pct%20x"),
  "a folder with #": place("hash#x"),
  "a folder with a non-ASCII letter": place("résumé"),
};

for (const [where, root] of Object.entries(LOCATIONS)) {
  test(`every command prints its help from ${where}`, () => {
    const silent = [];
    for (const c of COMMANDS) {
      const r = spawnSync(process.execPath, [join(root, c), "--help"], { encoding: "utf-8", cwd: base });
      if (r.status !== 0 || !r.stdout.startsWith("usage: ")) silent.push(`${c}: exit=${r.status} stdout=${JSON.stringify(r.stdout.slice(0, 60))}`);
    }
    assert.deepEqual(silent, []);
  });
}

test("render_resume.mjs --md writes the HTML from a symlinked folder (the harness's mktemp -d workspace, script named by absolute path)", () => {
  const ws = join(base, "ws");
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, "r.md"), "# A\n\n## Summary\n\n- x.\n");
  const r = spawnSync(process.execPath, [join(base, "link", "skills", "apply/scripts/render_resume.mjs"), "--md", join(ws, "r.md"), "--html", join(ws, "r.html")], { encoding: "utf-8" });
  assert.match(r.stdout, /^words: 3 {2}-> {2}/);
  assert.ok(existsSync(join(ws, "r.html")), "the HTML was written");
});

// Round 2: c28903b wraps `await main()` inside the guard's try/catch, so an
// error thrown inside main() is swallowed: exit 0, nothing printed. The
// retired Python crashed loudly on the same input (open(html_path, "w") on a
// directory: IsADirectoryError, a traceback, exit 1), and every other command
// turns a crash into Python's traceback shape (lib/traceback.mjs).
test("render_resume.mjs fails loudly when main() throws (--html names a folder), never a silent exit 0", () => {
  const ws = join(base, "crash");
  mkdirSync(join(ws, "adir"), { recursive: true });
  writeFileSync(join(ws, "r.md"), "# A\n\n## Summary\n\n- x.\n");
  const r = spawnSync(process.execPath, [join(SKILLS, "apply/scripts/render_resume.mjs"), "--md", "r.md", "--html", "adir"], { encoding: "utf-8", cwd: ws });
  assert.notEqual(r.status, 0, `exit ${r.status}, stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`);
  assert.ok(r.stderr.length > 0, "the failure is said, on stderr");
});

test("toPdf with a stand-in Chrome that writes 1 MB to stderr returns promptly with the PDF (stderr is drained)", async () => {
  const d = join(base, "chatty");
  mkdirSync(d, { recursive: true });
  const pdf = "%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\n2 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n";
  writeFileSync(join(d, "fixed.pdf"), pdf);
  const stub = join(d, "chrome");
  writeFileSync(stub, `#!/bin/sh
out=
for a in "$@"; do case "$a" in --print-to-pdf=*) out="\${a#--print-to-pdf=}";; esac; done
/bin/cat '${join(d, "fixed.pdf")}' > "$out"
head -c \${STDERR_BYTES:-1048576} /dev/zero | tr '\\0' 'x' >&2
exit 0
`);
  chmodSync(stub, 0o755);
  writeFileSync(join(d, "r.html"), "<html></html>");
  const { toPdf } = await import(pathToFileURL(join(SKILLS, "apply/scripts/render_resume.mjs")).href);
  // control: the same stand-in with 1 KB of stderr renders at once
  process.env.STDERR_BYTES = "1024";
  assert.deepEqual(await toPdf(join(d, "r.html"), join(d, "r0.pdf"), stub, 8000), { ok: true });
  delete process.env.STDERR_BYTES;
  const t0 = Date.now();
  const res = await toPdf(join(d, "r.html"), join(d, "r.pdf"), stub, 8000);
  const ms = Date.now() - t0;
  assert.deepEqual(res, { ok: true }, `after ${ms} ms`);
  assert.ok(ms < 5000, `took ${ms} ms`);
});
