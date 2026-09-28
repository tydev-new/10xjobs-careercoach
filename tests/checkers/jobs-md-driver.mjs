#!/usr/bin/env node
// The `node` path for jobs_md's expected-output cases (run-cases.mjs): the
// job list library has no command of its own, so a case runs one library
// operation. The Python side is run-cases.mjs's PY_JM; both print compact
// JSON with sorted keys so the bytes compare.
//
//   node jobs-md-driver.mjs roundtrip <ws>                 # load(), print rows, save()
//   node jobs-md-driver.mjs save <ws> <rowsJson> <notesJson>
//
// CHECKER_NOW_ISO freezes the clock, as it does for
// skills/evaluate/scripts/record_verdict.mjs. J2 (docs/design-js-only.md
// § 2) moved the library under skills/search/scripts/lib/ and the shared
// helpers under skills/profile/scripts/lib/ — the imports below point
// there.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEARCH_LIB = join(ROOT, "skills", "search", "scripts", "lib");
const PROFILE_LIB = join(ROOT, "skills", "profile", "scripts", "lib");
const jm = await import(pathToFileURL(join(SEARCH_LIB, "jobs-md.mjs")).href);
const { nodeIo } = await import(pathToFileURL(join(PROFILE_LIB, "io-node.mjs")).href);
const { restoreLineSeparators } = await import(pathToFileURL(join(PROFILE_LIB, "py-text.mjs")).href);

const frozen = process.env.CHECKER_NOW_ISO;
const now = frozen ? () => new Date(frozen) : () => new Date();
const sorted = (v) =>
  Array.isArray(v) ? v.map(sorted)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]))
      : v;

const [op, ws, rowsJson, notesJson] = process.argv.slice(2);
if (op === "roundtrip") {
  const rows = await jm.load(nodeIo, ws);
  // what a caller outside the library sees: the line-separator sentinels swapped back
  const shown = JSON.parse(restoreLineSeparators(JSON.stringify(rows)));
  process.stdout.write(JSON.stringify(sorted(shown)) + "\n");
  await jm.save(nodeIo, ws, rows, { now });
} else if (op === "save") {
  const opts = { now };
  const notes = JSON.parse(notesJson);
  if (notes !== null) opts.notes = notes;
  await jm.save(nodeIo, ws, JSON.parse(rowsJson), opts);
} else {
  process.stderr.write(`unknown op ${op}\n`);
  process.exitCode = 2;
}
