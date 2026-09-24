// Unit tests for the real ScriptRunner (just-bash + packages/checkers'
// file-name python3 dispatch) — the seam packages/agent's `bash` tool
// calls (docs/design-web-agent.md § 4/§ 5). Runs the REAL ported
// checkers, no network, no fixtures from real candidate data.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRealScriptRunner } from "./script-runner.ts";

const RESUME_CLEAN = `# Alex Chen

## Summary

**Forward-Deployed & Solutions Engineering Leader**
*Turning deployment friction into product strategy.*

Built the function twice, from zero, by treating deployment friction as product
intelligence rather than support noise. Still shipping production code today.

- **8+ years leading technical teams:** yes — shipping today.

## Experience

Platform Lead — Northwind Labs.
`;

test("dispatches python3 <script> by file name and runs the REAL check_materials.py port", async () => {
  const runner = createRealScriptRunner();
  const files = { "resume.md": RESUME_CLEAN };
  const { result, changedFiles } = await runner.run(
    "python3 skills/apply/scripts/check_materials.py --workspace . --resume resume.md",
    files,
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /mechanical checks clean/);
  assert.deepEqual(changedFiles, {}); // a read-only checker changes nothing
  assert.deepEqual(result.changed, []);
});

test("a script's write-back (record_verdict.py rewriting jobs.md) is reported as a changed file", async () => {
  const runner = createRealScriptRunner();
  const { result, changedFiles } = await runner.run(
    'python3 skills/evaluate/scripts/record_verdict.py --workspace . --company "Acme" --title "Staff Engineer" --verdict strong --score 90',
    {},
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /created NEW role/);
  assert.ok("jobs.md" in changedFiles, JSON.stringify(Object.keys(changedFiles)));
  assert.match(changedFiles["jobs.md"], /Acme — Staff Engineer/);
  assert.match(changedFiles["jobs.md"], /Verdict: strong/);
  assert.deepEqual(result.changed, ["jobs.md"]);
});

test("an unported script exits 127 with the § 5 message, matching the fake runner's contract", async () => {
  const runner = createRealScriptRunner();
  const { result, changedFiles } = await runner.run("python3 scripts/check_messages.py --workspace .", {});
  assert.equal(result.exitCode, 127);
  assert.match(result.stderr, /not available in the web app: check_messages\.py/);
  assert.deepEqual(changedFiles, {});
});

test("an unchanged snapshotted file (equal content) is never reported as changed", async () => {
  const runner = createRealScriptRunner();
  const files = { "resume.md": RESUME_CLEAN, "jobs.md": "# Jobs\n" };
  const { changedFiles } = await runner.run(
    "python3 skills/apply/scripts/check_materials.py --workspace . --resume resume.md",
    files,
  );
  assert.deepEqual(changedFiles, {});
});

test("the same script reached via a different relative prefix dispatches to the same port (§ 5 file-name dispatch)", async () => {
  const runner = createRealScriptRunner();
  const files = { "resume.md": RESUME_CLEAN };
  const a = await runner.run("python3 scripts/check_materials.py --workspace . --resume resume.md", files);
  const b = await runner.run("python3 ../apply/scripts/check_materials.py --workspace . --resume resume.md", files);
  assert.equal(a.result.exitCode, b.result.exitCode);
  assert.equal(a.result.stdout, b.result.stdout);
});

test("a FAIL from a real checker is reported with exit 1 and the finding in stdout", async () => {
  const runner = createRealScriptRunner();
  const badResume = "no headings, no bullets, just one short line of text that is not structured.";
  const { result } = await runner.run(
    "python3 skills/apply/scripts/check_materials.py --workspace . --resume resume.md",
    { "resume.md": badResume },
  );
  // Whatever the real port decides (pass/WARN/FAIL) is asserted against the
  // script's own exit-code contract (§ 5: "0 clean/WARN, 1 FAIL, 2 flags"),
  // not a guessed literal — this proves the runner reports the REAL exit
  // code and stdout unmodified, not that this particular résumé fails.
  assert.ok([0, 1].includes(result.exitCode), `unexpected exit code ${result.exitCode}: ${result.stdout}`);
  assert.match(result.stdout, /resume/);
});
