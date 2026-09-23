// Proves the file-name dispatch contract (docs/design-web-agent.md § 5):
// different relative prefixes for the SAME script reach the SAME port, and
// an unported script exits 127 with a clear message.
import test from "node:test";
import assert from "node:assert/strict";
import { Bash } from "just-bash";
import { python3Command } from "../../src/just-bash-command.mjs";

const PLAN =
  "Goal: x by 2026-10-01\nBudget: 60 min/day\n\n## Board\nWaiting on you\n" +
  "- the comp floor — criteria.md § Compensation\n" +
  "To do\n- review the letter (10 min)\n";

test("check_closeout.py dispatches regardless of the relative prefix used to reach it", async () => {
  for (const prefix of ["skills/coach/scripts/", "../coach/scripts/", "scripts/"]) {
    const bash = new Bash({
      customCommands: [python3Command],
      files: { "/home/user/ws/plan.md": PLAN },
      cwd: "/home/user/ws",
    });
    const r = await bash.exec(`python3 ${prefix}check_closeout.py --workspace . --stage applying`);
    assert.equal(r.exitCode, 0, `prefix ${prefix}: ${r.stdout}`);
    assert.match(r.stdout, /close-out clean/);
  }
});

test("an unported script (check_messages.py) exits 127 with a clear message", async () => {
  const bash = new Bash({ customCommands: [python3Command], cwd: "/home/user" });
  const r = await bash.exec("python3 skills/outreach/scripts/check_messages.py --workspace .");
  assert.equal(r.exitCode, 127);
  assert.match(r.stderr, /not available in the web app: check_messages\.py/);
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

test("check_materials.py reached through just-bash's in-memory fs, writer + reader share one fs", async () => {
  const bash = new Bash({
    customCommands: [python3Command],
    files: {
      "/home/user/ws/base-resume.md": "# Base\n\n## Experience\n- did the thing\n",
    },
    cwd: "/home/user/ws",
  });
  await bash.exec(`cat <<'EOF' > resume.md\n# A\n\n## Summary\n\nok.\n\n## Experience\n\n- did the thing\nEOF`);
  const r = await bash.exec("python3 skills/apply/scripts/check_materials.py --workspace . --resume resume.md");
  assert.equal(r.exitCode, 0, r.stdout);
  assert.match(r.stdout, /mechanical checks clean/);
});
