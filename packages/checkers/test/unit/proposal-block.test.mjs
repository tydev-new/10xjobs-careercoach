// Mirrors tests/test_proposal_block.py against the JS port's run() (this
// script's Python tests are all CLI-level — there's no separate pure
// function to unit test without going through the file); the real Python
// byte-for-byte diff lives in test/parity.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { run } from "../../src/proposal-block.mjs";
import { makeFakeIo } from "./fake-io.mjs";

const BASE = "# Base\n## Experience\n- Set up scheduled job monitoring with alerting on failed overnight loads.\n- Built tested dbt models with peer review.\n";
const COV =
  "## Coverage\n| requirement | status | evidence | decision |\n|---|---|---|---|\n" +
  "| Orchestrate scheduled data workflows | have | monitoring bullet | answered |\n" +
  "| Tested dbt models | have | dbt bullet | answered |\n" +
  "| A/B testing | gap | none | open |\n";
const SEL =
  "## Selection\n| # | role | bullet | in/out | source | words | why |\n|---|---|---|---|---|---|---|\n" +
  "| 1 | A | one | in | base | 5 | lead |\n" +
  "| 2 | A | two | out | base | 6 | weakest |\n" +
  "| 3 | A | three | out | base | 7 | next |\n" +
  "| 4 | A | four | out | base | 8 | furthest |\n";

async function runIt(appText, base = BASE) {
  const io = makeFakeIo({ "/ws/base-resume.md": base, "/ws/applications/x.md": appText });
  return run(["--workspace", "/ws", "--application", "applications/x.md"], io);
}

test("prints the cut list, short, with why", async () => {
  const r = await runIt(COV + SEL);
  const body = r.stdout.split("--- paste")[0];
  assert.match(body, /Cut — 3 of 4 bullets/);
  assert.match(body, /1\. A — two — \*weakest\*/);
  assert.ok(!body.includes("| in |"), "the table stays in the file");
  assert.match(body, /A\/B testing/);
  assert.match(body, /Gaps/);
  assert.match(body, /Otherwise this is the version\./);
});

test("a `have` row missing their word WARNs; near-vocabulary does not", async () => {
  const r = await runIt(COV + SEL);
  assert.match(r.stdout, /Orchestrate/);
  assert.match(r.stdout, /WARN/);
  assert.ok(!r.stdout.includes('"Tested dbt models"'));
});

test("out rows in base order WARN", async () => {
  const r = await runIt(COV + SEL);
  assert.match(r.stdout, /base order/);
});

test("an out row without why FAILs", async () => {
  const bad = SEL.replace("| 2 | A | two | out | base | 6 | weakest |", "| 2 | A | two | out | base | — | — |");
  const r = await runIt(COV + bad);
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /nobody can weigh/);
});

test("a missing selection table FAILs", async () => {
  const r = await runIt(COV);
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /no selection table/);
});
