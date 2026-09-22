// Parity test: the fixtures are the same ones used by the real repo's
// tests/test_check_closeout.py (mirrored here so this spike has no
// dependency on the parent repo's test layout). For each fixture, run the
// REAL Python script and the JS port's Node CLI against the SAME temp
// workspace and diff stdout + exit code byte-for-byte.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const PY_SCRIPT = join(REPO_ROOT, "skills", "coach", "scripts", "check_closeout.py");
const JS_CLI = join(HERE, "..", "bin", "check_closeout.mjs");

const PLAN =
  "Goal: x by 2026-10-01\nBudget: 60 min/day\n\n## Board\nWaiting on you\n" +
  "- the comp floor — criteria.md § Compensation\n" +
  "- warm-path pick: which of the three mutuals to Flo\n" +
  "To do\n- review the Corvid letter (10 min)\n";

function makeWorkspace(plan, { old = false } = {}) {
  const ws = mkdtempSync(join(tmpdir(), "spike2-parity-"));
  if (plan !== null) {
    const p = join(ws, "plan.md");
    writeFileSync(p, plan);
    if (old) {
      const past = new Date(Date.now() - 3600 * 1000);
      utimesSync(p, past, past);
    }
  }
  return ws;
}

const CASES = [
  {
    name: "clean",
    plan: PLAN,
    args: ["--stage", "applying", "--asked", "which mutual to Flo", "--asked", "your comp floor"],
  },
  { name: "bad_stage_fails", plan: PLAN, args: ["--stage", "planning"] },
  {
    name: "question_without_row_fails",
    plan: PLAN,
    args: ["--stage", "applying", "--asked", "do you want the two-page version"],
  },
  { name: "stale_plan_fails", plan: PLAN, args: ["--stage", "applying"], old: true },
  { name: "missing_plan_fails", plan: null, args: ["--stage", "applying"] },
  {
    name: "stage_auto_inferred",
    plan: PLAN,
    args: ["--asked", "which mutual to Flo", "--asked", "your comp floor"],
  },
];

let failures = 0;
for (const c of CASES) {
  const ws = makeWorkspace(c.plan, { old: c.old });
  const py = spawnSync("python3", [PY_SCRIPT, "--workspace", ws, ...c.args], { encoding: "utf-8" });
  const js = spawnSync("node", [JS_CLI, "--workspace", ws, ...c.args], { encoding: "utf-8" });

  // The "min ago" wording embeds an elapsed-minutes float that can differ
  // by rounding between the two processes' two separate Date.now() calls
  // by at most 1 minute for the stale case; both processes run within
  // milliseconds of each other here so in practice they match exactly.
  const same = py.stdout === js.stdout && py.status === js.status;
  console.log(`[${same ? "PASS" : "FAIL"}] ${c.name}  py.exit=${py.status} js.exit=${js.status}`);
  if (!same) {
    failures++;
    console.log("  --- python stdout ---");
    console.log(py.stdout.replace(/^/gm, "  "));
    console.log("  --- js stdout ---");
    console.log(js.stdout.replace(/^/gm, "  "));
  }
}

console.log(`\n${CASES.length - failures}/${CASES.length} cases byte-identical (stdout + exit code)`);
process.exit(failures ? 1 : 0);
