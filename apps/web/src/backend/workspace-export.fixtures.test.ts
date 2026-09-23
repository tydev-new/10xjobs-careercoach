// Step 2 exit: "an import->export round trip byte-identical on
// tests/always-on/fixtures/apply/ (+ fixtures/profile.md, criteria.md),
// and the exported folder works with local Claude Code skills (at least:
// check_files.py passes on it)."
//
// NODE-ONLY (fs, child_process, os) — a test file, never bundled into the
// browser app (apps/web's vite build only bundles what main.tsx reaches).
// The library code under test (workspace-export.ts, supabase-workspace-store.ts)
// stays browser-safe; only this harness touches the filesystem.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { createInMemoryWorkspaceStore } from "../../../../packages/agent/src/workspace/in-memory-store.ts";
import { exportWorkspace, importWorkspace } from "./workspace-export.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../"); // apps/web/src/backend -> repo root
const FIXTURES_APPLY = path.join(REPO_ROOT, "tests/always-on/fixtures/apply");
const FIXTURE_PROFILE = path.join(REPO_ROOT, "tests/always-on/fixtures/profile.md");
const FIXTURE_CRITERIA = path.join(REPO_ROOT, "tests/always-on/fixtures/criteria.md");
const CHECK_FILES_PY = path.join(REPO_ROOT, "skills/profile/scripts/check_files.py");
const SKILLS_DIR = path.join(REPO_ROOT, "skills");

/** Reads every file under `dir` (fixtures/apply/ is at most 2 levels deep —
 *  well within the store's depth<=3 contract), keyed by its path relative
 *  to `dir`, posix-separated. */
function readTreeSync(dir: string): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  function walk(d: string, relPrefix: string) {
    for (const name of readdirSync(d)) {
      const abs = path.join(d, name);
      const rel = relPrefix ? `${relPrefix}/${name}` : name;
      if (statSync(abs).isDirectory()) {
        walk(abs, rel);
      } else {
        out[rel] = new Uint8Array(readFileSync(abs));
      }
    }
  }
  walk(dir, "");
  return out;
}

function loadStep2Fixture(): Record<string, Uint8Array> {
  const tree = readTreeSync(FIXTURES_APPLY);
  tree["profile.md"] = new Uint8Array(readFileSync(FIXTURE_PROFILE));
  tree["criteria.md"] = new Uint8Array(readFileSync(FIXTURE_CRITERIA));
  return tree;
}

test("the step 2 fixture (tests/always-on/fixtures/apply/ + profile.md, criteria.md) exists and is non-empty", () => {
  assert.ok(existsSync(FIXTURES_APPLY), `missing ${FIXTURES_APPLY}`);
  assert.ok(existsSync(FIXTURE_PROFILE), `missing ${FIXTURE_PROFILE}`);
  assert.ok(existsSync(FIXTURE_CRITERIA), `missing ${FIXTURE_CRITERIA}`);
  const tree = loadStep2Fixture();
  assert.ok(Object.keys(tree).length >= 5, `expected several fixture files, got ${Object.keys(tree).length}`);
});

test("import -> export round trip is byte-identical on the step 2 fixture", async () => {
  const original = loadStep2Fixture();

  // "Import: a zip into an EMPTY workspace only" (§ 2) — build the input
  // zip directly with fflate (not via exportWorkspace, which needs an
  // existing store: this zip stands in for a candidate's downloaded folder
  // zipped up for upload).
  const { zipSync } = await import("fflate");
  const zipIn = zipSync(original);

  const store = createInMemoryWorkspaceStore();
  const written = await importWorkspace(store, zipIn);
  assert.equal(written.length, Object.keys(original).length, "every fixture file should have been written");

  const zipOut = await exportWorkspace(store);
  const entriesOut = unzipSync(zipOut);

  assert.deepEqual(Object.keys(entriesOut).sort(), Object.keys(original).sort(), "export should contain exactly the imported paths");
  for (const [rel, bytes] of Object.entries(original)) {
    assert.deepEqual([...entriesOut[rel]], [...bytes], `${rel} is not byte-identical after the round trip`);
  }
});

/** Runs check_files.py against a directory, returning { exitCode, stdout }. */
function runCheckFiles(workspaceDir: string): { exitCode: number; stdout: string } {
  try {
    const stdout = execFileSync("python3", [CHECK_FILES_PY, "--workspace", workspaceDir, "--skills", SKILLS_DIR], {
      encoding: "utf8",
    });
    return { exitCode: 0, stdout };
  } catch (e) {
    const err = e as { status: number; stdout: string };
    return { exitCode: err.status, stdout: err.stdout };
  }
}

test("the exported step 2 fixture works with local Claude Code skills: check_files.py sees the SAME result as on the raw fixture (parity — the export layer introduces no new failures)", async () => {
  const original = loadStep2Fixture();
  const { zipSync } = await import("fflate");
  const zipIn = zipSync(original);
  const store = createInMemoryWorkspaceStore();
  await importWorkspace(store, zipIn);
  const zipOut = await exportWorkspace(store);
  const entriesOut = unzipSync(zipOut);

  const exportedDir = mkdtempSync(path.join(tmpdir(), "ten-export-fixture-"));
  const rawDir = mkdtempSync(path.join(tmpdir(), "ten-raw-fixture-"));
  try {
    for (const [rel, bytes] of Object.entries(entriesOut)) {
      const abs = path.join(exportedDir, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, bytes);
    }
    for (const [rel, bytes] of Object.entries(original)) {
      const abs = path.join(rawDir, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, bytes);
    }

    const onRaw = runCheckFiles(rawDir);
    const onExported = runCheckFiles(exportedDir);

    // The mechanism (import -> export) must not change check_files.py's
    // verdict at all versus running it on the fixture folder directly.
    assert.equal(onExported.exitCode, onRaw.exitCode, `exit code differs: raw=${onRaw.exitCode} exported=${onExported.exitCode}\nraw stdout:\n${onRaw.stdout}\nexported stdout:\n${onExported.stdout}`);
    assert.equal(onExported.stdout, onRaw.stdout, "check_files.py output differs between the raw fixture and the round-tripped export");

    // KNOWN GAP (see the coder's hand-back): the raw fixture itself does
    // NOT pass check_files.py today (profile.md/criteria.md are invented
    // personas for the LLM-judged always-on harness, not schema-conformant
    // files) — so `onRaw.exitCode` is 1, not 0, independent of anything
    // this slice builds. This test proves PARITY (no NEW failures from
    // export/import), which is the part within this slice's control.
    console.log(`check_files.py on the raw fixture: exit ${onRaw.exitCode}`);
    console.log(`check_files.py on the round-tripped export: exit ${onExported.exitCode} (same as raw: ${onExported.exitCode === onRaw.exitCode})`);
  } finally {
    rmSync(exportedDir, { recursive: true, force: true });
    rmSync(rawDir, { recursive: true, force: true });
  }
});

test("check_files.py passes on a MINIMAL schema-conformant workspace round-tripped through import/export (proves the mechanism itself, independent of the fixture's own content)", async () => {
  // A tiny, schema-conformant workspace built from the schemas
  // check_files.py itself reads (skills/profile/references/schema.md) —
  // not the step 2 fixture, which is intentionally NOT schema-conformant
  // (see the test above and the hand-back).
  const conformant: Record<string, string> = {
    "profile.md": [
      "# Profile\n\n",
      "## Snapshot\n- x\n\n",
      "## Experience\n- x\n\n",
      "## Intake findings\n\n",
      "### Positioning strengths\n- x\n\n",
      "### Likely interviewer concerns\n- x\n\n",
      "### Career-narrative gaps\n- x\n\n",
      "### Story seeds\n- x\n\n",
      "## Interview history\n\n",
      "## Constraints\n\n",
      "## Application defaults\n\n",
    ].join(""),
    "criteria.md": [
      "# Criteria\n\n",
      "## Targets\n- x\n\n",
      "## Level\n- x\n\n",
      "## Geo\n- x\n\n",
      "## Compensation\n- x\n\n",
      "## Dealbreakers\n- x\n\n",
      "## Target companies\n- x\n\n",
      "## Retired\n\n",
    ].join(""),
  };
  const original: Record<string, Uint8Array> = {};
  for (const [p, c] of Object.entries(conformant)) original[p] = new TextEncoder().encode(c);

  const { zipSync } = await import("fflate");
  const zipIn = zipSync(original);
  const store = createInMemoryWorkspaceStore();
  await importWorkspace(store, zipIn);
  const zipOut = await exportWorkspace(store);
  const entriesOut = unzipSync(zipOut);

  const exportedDir = mkdtempSync(path.join(tmpdir(), "ten-export-minimal-"));
  try {
    for (const [rel, bytes] of Object.entries(entriesOut)) {
      const abs = path.join(exportedDir, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, bytes);
    }
    const result = runCheckFiles(exportedDir);
    assert.equal(result.exitCode, 0, `check_files.py should pass on a schema-conformant round-tripped workspace:\n${result.stdout}`);
  } finally {
    rmSync(exportedDir, { recursive: true, force: true });
  }
});
