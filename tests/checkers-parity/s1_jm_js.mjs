#!/usr/bin/env node
// Tester-owned helper for tests/test_search_s1_tester.py: drives the JS
// port of jobs_md (packages/checkers/src/jobs-md.mjs) through the real Node
// io adapter, so the Python test can compare its bytes with jobs_md.py's.
//
//   echo '{"op":"save","ws":"/tmp/x","rows":[...],"notes":"..."}' | node s1_jm_js.mjs
//   echo '{"op":"roundtrip","ws":"/tmp/x"}' | node s1_jm_js.mjs     # load() then save()
//
// The clock is frozen at 2026-09-23T12:34:56Z (the Python side freezes
// jobs_md.now_iso to the same instant). Prints the loaded rows as JSON on
// "roundtrip" so the caller can check what load() returned.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const jm = await import(pathToFileURL(join(ROOT, "packages", "checkers", "src", "jobs-md.mjs")).href);
const { nodeIo } = await import(pathToFileURL(join(ROOT, "packages", "checkers", "src", "io-node.mjs")).href);
const { restoreLineSeparators } = await import(pathToFileURL(join(ROOT, "packages", "checkers", "src", "py-text.mjs")).href);

const now = () => new Date("2026-09-23T12:34:56Z");
const req = JSON.parse(readFileSync(0, "utf-8"));
if (req.op === "save") {
  const opts = { now };
  if (req.notes !== undefined && req.notes !== null) opts.notes = req.notes;
  await jm.save(nodeIo, req.ws, req.rows, opts);
} else if (req.op === "roundtrip") {
  const rows = await jm.load(nodeIo, req.ws);
  // what a caller outside the checkers sees: the sentinels swapped back
  const shown = JSON.parse(restoreLineSeparators(JSON.stringify(rows)));
  await jm.save(nodeIo, req.ws, rows, { now });
  process.stdout.write(JSON.stringify(shown));
} else {
  process.stderr.write(`unknown op ${req.op}\n`);
  process.exit(2);
}
