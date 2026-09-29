// proposalRows — docs/design-web-agent.md § 19 (the restore ruling): the
// Applications page's own reader of an application file's Coverage and
// Selection tables. C § 19's own "Proved by" table test, plus the
// `run()` re-expression's own parity (which run-cases.mjs and
// proposal-block.test.mjs already cover unchanged).
import test from "node:test";
import assert from "node:assert/strict";
import { proposalRows } from "../../../../skills/apply/scripts/lib/proposal-block.mjs";

const COVERAGE_HEADER =
  "## Coverage\n| requirement | status | evidence | decision |\n|---|---|---|---|\n";
const SELECTION_HEADER =
  "## Selection\n| # | role | bullet | in/out | source | words | why |\n|---|---|---|---|---|---|---|\n";

test("both tables present: coverage, cuts and kept all populate, in file order", () => {
  const text =
    COVERAGE_HEADER +
    "| Req one | have | Evidence one | answered |\n" +
    "| Req two | gap | Evidence two | open |\n" +
    "\n" +
    SELECTION_HEADER +
    "| 1 | A | bullet one | in | base | 5 | lead |\n" +
    "| 2 | A | bullet two | out | base | 6 | weakest |\n";

  const rows = proposalRows(text);
  assert.deepEqual(rows.coverage, [
    ["Req one", "have", "Evidence one", "answered"],
    ["Req two", "gap", "Evidence two", "open"],
  ]);
  assert.deepEqual(rows.cuts, [["2", "A", "bullet two", "out", "base", "6", "weakest"]]);
  assert.deepEqual(rows.kept, [["1", "A", "bullet one", "in", "base", "5", "lead"]]);
  assert.deepEqual(rows.unreadable, []);
});

test("a missing ## Coverage header: coverage is null", () => {
  const text = SELECTION_HEADER + "| 1 | A | bullet one | in | base | 5 | lead |\n";
  const rows = proposalRows(text);
  assert.equal(rows.coverage, null);
  assert.deepEqual(rows.kept, [["1", "A", "bullet one", "in", "base", "5", "lead"]]);
  assert.deepEqual(rows.cuts, []);
});

test("a missing ## Selection header: cuts and kept are both null", () => {
  const text = COVERAGE_HEADER + "| Req one | have | Evidence one | answered |\n";
  const rows = proposalRows(text);
  assert.deepEqual(rows.coverage, [["Req one", "have", "Evidence one", "answered"]]);
  assert.equal(rows.cuts, null);
  assert.equal(rows.kept, null);
});

test("a Selection table with no `out` row: cuts is []", () => {
  const text = SELECTION_HEADER + "| 1 | A | bullet one | in | base | 5 | lead |\n";
  const rows = proposalRows(text);
  assert.deepEqual(rows.cuts, []);
  assert.deepEqual(rows.kept, [["1", "A", "bullet one", "in", "base", "5", "lead"]]);
});

test("a row with the wrong cell count: unreadable, not coverage/cuts", () => {
  const text =
    COVERAGE_HEADER +
    "| Req one | have | Evidence one | answered |\n" +
    "| Req two | gap | Evidence two |\n" + // 3 cells, not 4
    SELECTION_HEADER +
    "| 1 | A | bullet one | in | base | 5 | lead |\n" +
    "| 2 | A | bullet two | out | base | 6 |\n"; // 6 cells, not 7

  const rows = proposalRows(text);
  assert.deepEqual(rows.coverage, [["Req one", "have", "Evidence one", "answered"]]);
  assert.deepEqual(rows.cuts, []);
  assert.deepEqual(rows.kept, [["1", "A", "bullet one", "in", "base", "5", "lead"]]);
  assert.deepEqual(rows.unreadable, [
    ["Req two", "gap", "Evidence two"],
    ["2", "A", "bullet two", "out", "base", "6"],
  ]);
});

test("a 7-cell Selection row whose in/out cell is neither in nor out: dropped from cuts and kept, not unreadable (matches run()'s own behaviour)", () => {
  const text = SELECTION_HEADER + "| 1 | A | bullet one | maybe | base | 5 | lead |\n";
  const rows = proposalRows(text);
  assert.deepEqual(rows.cuts, []);
  assert.deepEqual(rows.kept, []);
  assert.deepEqual(rows.unreadable, []);
});

test("a cell written `a \\| b`: the escaped pipe is removed, not kept (matches run()'s own strip)", () => {
  const text = COVERAGE_HEADER + "| Req a \\| b | have | Evidence a \\| b | answered |\n";
  const rows = proposalRows(text);
  assert.deepEqual(rows.coverage, [["Req a  b", "have", "Evidence a  b", "answered"]]);
});

test("CRLF line endings: rows parse the same as LF", () => {
  const text = (COVERAGE_HEADER + "| Req one | have | Evidence one | answered |\n").replace(/\n/g, "\r\n");
  const rows = proposalRows(text);
  assert.deepEqual(rows.coverage, [["Req one", "have", "Evidence one", "answered"]]);
});

test("no tables at all: both null, no unreadable rows", () => {
  const rows = proposalRows("Just some prose.\nNo tables here.\n");
  assert.equal(rows.coverage, null);
  assert.equal(rows.cuts, null);
  assert.equal(rows.kept, null);
  assert.deepEqual(rows.unreadable, []);
});
