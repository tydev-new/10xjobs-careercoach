// Proves the custom-command dispatch works inside just-bash's Bash shell
// (in Node) with an in-memory filesystem: exactly the command line
//   python3 skills/coach/scripts/check_closeout.py --workspace . ...
// reaches the JS port, and files pre-loaded into the in-memory FS are what
// it reads.
import test from "node:test";
import assert from "node:assert/strict";
import { Bash } from "just-bash";
import { python3Command } from "../src/command.mjs";

const PLAN =
  "Goal: x by 2026-10-01\nBudget: 60 min/day\n\n## Board\nWaiting on you\n" +
  "- the comp floor — criteria.md § Compensation\n" +
  "- warm-path pick: which of the three mutuals to Flo\n" +
  "To do\n- review the Corvid letter (10 min)\n";

test("exact skill command line dispatches to the JS port, in-memory FS", async () => {
  const bash = new Bash({
    customCommands: [python3Command],
    files: { "/home/user/ws/plan.md": PLAN },
    cwd: "/home/user/ws",
  });
  const r = await bash.exec(
    'python3 skills/coach/scripts/check_closeout.py --workspace . --stage applying --asked "which mutual to Flo" --asked "your comp floor"'
  );
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /close-out clean/);
});

test("an unrecognized python3 target still falls through with 127", async () => {
  const bash = new Bash({ customCommands: [python3Command], cwd: "/home/user" });
  const r = await bash.exec("python3 some/other/script.py");
  assert.equal(r.exitCode, 127);
});

test("the command reads whatever plan.md the in-memory FS holds at run time", async () => {
  const bash = new Bash({
    customCommands: [python3Command],
    files: {},
    cwd: "/home/user/ws",
  });
  // No plan.md yet -> the port must report it's missing.
  const r1 = await bash.exec(
    "python3 skills/coach/scripts/check_closeout.py --workspace . --stage applying"
  );
  assert.equal(r1.exitCode, 1);
  assert.match(r1.stdout, /plan\.md does not exist/);

  // A separate just-bash command (echo + redirection) writes plan.md into
  // the SAME in-memory FS — proving the checker and ordinary shell
  // commands share one filesystem, and the checker sees what was written.
  await bash.exec(`cat <<'EOF' > plan.md\n${PLAN}EOF`);
  const r2 = await bash.exec(
    "python3 skills/coach/scripts/check_closeout.py --workspace . --stage applying"
  );
  assert.equal(r2.exitCode, 0);
  assert.match(r2.stdout, /close-out clean/);
});
