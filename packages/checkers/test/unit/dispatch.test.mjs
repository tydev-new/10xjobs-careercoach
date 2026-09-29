// Proves the file-name dispatch contract (docs/design-web-agent.md § 5;
// docs/design-js-only.md § 3.5, J2): different relative prefixes for the
// SAME script reach the SAME port via "node", an unported script exits
// 127 with a clear message, and "python3" only points at the equivalent
// "node" command.
import test from "node:test";
import assert from "node:assert/strict";
import { Bash } from "just-bash";
import { nodeCommand, python3Command } from "../../src/just-bash-command.mjs";

const PLAN =
  "Goal: x by 2026-10-01\nBudget: 60 min/day\n\n## Board\nWaiting on you\n" +
  "- the comp floor — criteria.md § Compensation\n" +
  "To do\n- review the letter (10 min)\n";

test("check_closeout.mjs dispatches regardless of the relative prefix used to reach it", async () => {
  for (const prefix of ["skills/coach/scripts/", "../coach/scripts/", "scripts/"]) {
    const bash = new Bash({
      customCommands: [nodeCommand],
      files: { "/home/user/ws/plan.md": PLAN },
      cwd: "/home/user/ws",
    });
    const r = await bash.exec(`node ${prefix}check_closeout.mjs --workspace . --stage applying`);
    assert.equal(r.exitCode, 0, `prefix ${prefix}: ${r.stdout}`);
    assert.match(r.stdout, /close-out clean/);
  }
});

test("an unported script (check_messages.mjs) exits 127 with a clear message", async () => {
  const bash = new Bash({ customCommands: [nodeCommand], cwd: "/home/user" });
  const r = await bash.exec("node skills/outreach/scripts/check_messages.mjs --workspace .");
  assert.equal(r.exitCode, 127);
  assert.match(r.stderr, /not available in the web app: check_messages\.mjs/);
});

test("`node -e ...`, `-p` and `--eval` exit 127, not a crash", async () => {
  for (const flag of ["-e", "-p", "--eval"]) {
    const bash = new Bash({ customCommands: [nodeCommand], cwd: "/home/user" });
    const r = await bash.exec(`node ${flag} "console.log(1)"`);
    assert.equal(r.exitCode, 127, flag);
    assert.match(r.stderr, new RegExp(`not available in the web app: \\${flag}`));
  }
});

test("bare `node` with no script argument exits 127, not a crash", async () => {
  const bash = new Bash({ customCommands: [nodeCommand], cwd: "/home/user" });
  const r = await bash.exec("node");
  assert.equal(r.exitCode, 127);
  assert.match(r.stderr, /not available in the web app/);
});

test("check_materials.mjs reached through just-bash's in-memory fs, writer + reader share one fs", async () => {
  const bash = new Bash({
    customCommands: [nodeCommand],
    files: {
      "/home/user/ws/base-resume.md": "# Base\n\n## Experience\n- did the thing\n",
    },
    cwd: "/home/user/ws",
  });
  await bash.exec(`cat <<'EOF' > resume.md\n# A\n\n## Summary\n\nok.\n\n## Experience\n\n- did the thing\nEOF`);
  const r = await bash.exec("node skills/apply/scripts/check_materials.mjs --workspace . --resume resume.md");
  assert.equal(r.exitCode, 0, r.stdout);
  assert.match(r.stdout, /automatic checks clean/);
});

test("python3 <name>.py points at the equivalent node command when <name>.mjs is ported", async () => {
  const bash = new Bash({ customCommands: [python3Command], cwd: "/home/user" });
  const r = await bash.exec("python3 scripts/check_files.py --workspace .");
  assert.equal(r.exitCode, 127);
  assert.match(r.stderr, /^python3 is not available here\. Run the same check with node: node scripts\/check_files\.mjs\n$/);
});

test("python3 <name>.py keeps the caller's own relative prefix, only the extension changes", async () => {
  const bash = new Bash({ customCommands: [python3Command], cwd: "/home/user" });
  const r = await bash.exec("python3 ../profile/scripts/check_files.py --workspace .");
  assert.equal(r.exitCode, 127);
  assert.match(r.stderr, /node \.\.\/profile\/scripts\/check_files\.mjs\n$/);
});

test("python3 <name>.py for an unported script gets the plain unknown-script message, not a node pointer", async () => {
  const bash = new Bash({ customCommands: [python3Command], cwd: "/home/user" });
  const r = await bash.exec("python3 skills/outreach/scripts/check_messages.py --workspace .");
  assert.equal(r.exitCode, 127);
  assert.match(r.stderr, /not available in the web app: check_messages\.py/);
  assert.doesNotMatch(r.stderr, /node /);
});

test("`python3 -c ...` exits 127, not a crash", async () => {
  const bash = new Bash({ customCommands: [python3Command], cwd: "/home/user" });
  const r = await bash.exec(`python3 -c "print(1)"`);
  assert.equal(r.exitCode, 127);
  assert.match(r.stderr, /not available in the web app: -c/);
});

test("bare `python3` with no script argument exits 127, not a crash", async () => {
  const bash = new Bash({ customCommands: [python3Command], cwd: "/home/user" });
  const r = await bash.exec("python3");
  assert.equal(r.exitCode, 127);
  assert.match(r.stderr, /not available in the web app/);
});
