// Issue #33: bin/run.mjs's headless path runs the skills' REAL ported
// checkers (the web app's ScriptRunner), not a stub that exits 127 — so a
// headless measurement sees the checker output a skill turns into a reply.
//
// NO model call, no key, no network: builds the runner's actual deps via
// bin/headless-deps.mjs (the same function bin/run.mjs's main() calls),
// on a fresh temp COPY of a fixture workspace, and invokes the `bash`
// tool with the commands the skills' own prose uses.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildHeadlessDeps } from "../bin/headless-deps.mjs";
import { CardBuilder } from "../src/cards.ts";
import { createTools, type ToolContext } from "../src/tools/index.ts";
import { VersionTracker } from "../src/tools/version-tracker.ts";
import type { Deps, ScriptRunner } from "../src/types.ts";
import { normalizeGlobBundle } from "../../../apps/web/src/backend/skills-bundle-normalize.ts";
import { REPO_ROOT } from "./support.ts";

const FIXTURE = path.join(REPO_ROOT, "tests/always-on/fixtures/apply");
const SILENT = { info() {}, warn() {}, error() {} };

async function headless() {
  const ws = mkdtempSync(path.join(tmpdir(), "agent-headless-ws-"));
  cpSync(FIXTURE, ws, { recursive: true });
  const built = await buildHeadlessDeps({ workspaceDir: ws, skillsDir: path.join(REPO_ROOT, "skills"), logger: SILENT });
  // Record the snapshot the tool hands the runner, then delegate to the
  // REAL runner unchanged.
  const snapshots: Array<Readonly<Record<string, string>>> = [];
  const real: ScriptRunner = built.scripts;
  const scripts: ScriptRunner = {
    run: (command, files) => {
      snapshots.push(files);
      return real.run(command, files);
    },
  };
  const deps: Deps = { ...built, scripts, model: {} as any };
  const ctx: ToolContext = {
    chatId: "headless-test",
    writer: { write: () => {} } as any,
    versionTracker: new VersionTracker(),
    cardBuilder: new CardBuilder(),
    turnState: { measuredSteps: [], spentSoFarUsd: 0 },
    gateGrammarMd: built.skills["skills/coach/references/gate-grammar.md"],
    idFor: () => "gate-1",
  };
  const tools = createTools(deps, ctx);
  const bash = (command: string) => (tools.bash.execute as any)({ command }, {});
  return { ws, bash, snapshots, skills: built.skills };
}

test("headless bash: evaluate's `node scripts/record_verdict.mjs` runs the real checker and writes jobs.md back to the workspace folder", async () => {
  const h = await headless();
  const fixtureJobs = readFileSync(path.join(FIXTURE, "jobs.md"), "utf8");
  const out = await h.bash(
    'node scripts/record_verdict.mjs --workspace . --company "Nimbus Robotics" --title "Analytics Engineer" --verdict investable_stretch --score 72 --reasons "fixture"',
  );
  assert.notEqual(out.exitCode, 127, `stub-shaped exit: ${out.stderr}`);
  assert.equal(out.exitCode, 0, out.stderr);
  assert.doesNotMatch(out.stderr, /not available in the web app/);
  assert.match(out.stdout, /recorded .*Nimbus Robotics — Analytics Engineer → investable_stretch \(72\)/);
  assert.deepEqual(out.changed, ["jobs.md"]);
  const onDisk = readFileSync(path.join(h.ws, "jobs.md"), "utf8");
  assert.match(onDisk, /### Nimbus Robotics — Analytics Engineer/);
  assert.match(onDisk, /Verdict: investable_stretch/);
  // the fixture itself is never touched — only the temp copy
  assert.equal(readFileSync(path.join(FIXTURE, "jobs.md"), "utf8"), fixtureJobs);
});

test("headless bash: apply's `node scripts/check_materials.mjs` returns the real checker report", async () => {
  const h = await headless();
  const out = await h.bash("node scripts/check_materials.mjs --workspace . --resume base-resume.md");
  assert.notEqual(out.exitCode, 127, `stub-shaped exit: ${out.stderr}`);
  assert.equal(out.exitCode, 0, out.stderr);
  assert.match(out.stdout, /RESUME base-resume\.md: pass/);
  assert.deepEqual(out.changed, []);
});

test("headless snapshot shape = web shape: workspace files at their relative paths + the skill bundle under skills/", async () => {
  const h = await headless();
  await h.bash("node scripts/check_materials.mjs --workspace . --resume base-resume.md");
  const keys = Object.keys(h.snapshots[0]);
  for (const k of ["jobs.md", "base-resume.md", "voice.md", "skills/apply/scripts/check_materials.mjs", "skills/evaluate/scripts/record_verdict.mjs", "skills/coach/SKILL.md"]) {
    assert.ok(keys.includes(k), `snapshot missing ${k}`);
  }
  assert.deepEqual(keys.filter((k) => k.startsWith("/") || k.startsWith("./") || k.includes("__pycache__") || k.endsWith(".pyc")), []);
  // The web app's bundle keys come from normalizeGlobBundle over Vite's
  // glob keys (apps/web/src/backend/skills-bundle.ts globs
  // "../../../../skills/**/*"): the same files yield the same keys as the
  // disk reader bin/run.mjs uses.
  const globShaped = Object.fromEntries(Object.entries(h.skills).map(([k, v]) => [`../../../../${k}`, v]));
  assert.deepEqual(Object.keys(normalizeGlobBundle(globShaped)).sort(), Object.keys(h.skills).sort());
});
