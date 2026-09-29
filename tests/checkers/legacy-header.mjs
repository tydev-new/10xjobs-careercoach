#!/usr/bin/env node
// Tester check (JS-only J2 review). 9f44e11 renamed the jobs.md header in 62
// cases' `before` files as well (§ 5.5 names only the expected outputs and
// the after files), so no case feeds a writer a pre-J2 jobs.md any more --
// the file every existing workspace holds. This replays every writer case
// whose `before` jobs.md carries the header, with the header put back to its
// pre-J2 wording, on the node path: each must still pass (the writer
// regenerates the header). Cases that leave jobs.md untouched are skipped
// (they expect the file byte-unchanged, legacy text and all).
//
//   node tests/checkers/legacy-header.mjs
import { loadCases, runCase, cleanup } from "./run-cases.mjs";

const NEW = ["update_job.mjs moves", "record_verdict.mjs judges"];
const OLD = ["update_job.py moves", "record_verdict.py judges"];
const back = (s) => s.replace(NEW[0], OLD[0]).replace(NEW[1], OLD[1]);
let n = 0, fail = 0, untouched = 0;
for (const c of loadCases()) {
  const b = c.before?.["jobs.md"];
  const t = typeof b === "string" ? b : b?.text;
  if (!t || !t.includes(NEW[0])) continue;
  const touched = (c.after && "jobs.md" in c.after) || c.expect.some((e) => e.after && "jobs.md" in e.after);
  if (!touched) { untouched++; continue; }
  const c2 = structuredClone(c);
  if (typeof b === "string") c2.before["jobs.md"] = back(t); else c2.before["jobs.md"].text = back(t);
  n++;
  const r = await runCase(c2, "node");
  if (r.diffs.length) { fail++; console.log("FAIL", c.id, r.diffs.join("; ")); }
}
cleanup();
console.log(`legacy-header replays: ${n} writer cases, ${fail} failure(s); ${untouched} cases leave jobs.md untouched (skipped)`);
process.exitCode = fail || !n ? 1 : 0;
