// stageSteps — design-web-ui.md § 5.3 "Pieces the pages share, The stage
// steps"; § 5.9 3d's own exit: "the stage-steps table (no check marks, no
// dates)". Run: node --test src/workspace/stage-steps.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { STAGE_LABELS, stageSteps } from "./stage-steps.ts";

test("STAGE_LABELS is jobs.md's own five stage words, in the port's own order", () => {
  assert.deepEqual(STAGE_LABELS, ["To Review", "Interested", "Applied", "Interviewing", "Offer"]);
});

for (const stage of ["To Review", "Interested", "Applied", "Interviewing", "Offer"]) {
  test(`stageSteps("${stage}"): exactly one current step, every other step drawn alike`, () => {
    const steps = stageSteps(stage);
    assert.deepEqual(
      steps.map((s) => s.label),
      STAGE_LABELS
    );
    const current = steps.filter((s) => s.current);
    assert.equal(current.length, 1);
    assert.equal(current[0].label, stage);
    // "every other step is drawn the same, before or after it" — no
    // per-position distinction beyond `current` itself (no `done`/`past`
    // flag exists on StageStep at all).
    for (const s of steps) {
      assert.equal(Object.keys(s).sort().join(","), "current,label");
    }
  });
}

test("stageSteps: an unrecognized stage word marks no step current (never a guess)", () => {
  const steps = stageSteps("Somewhere Else");
  assert.equal(steps.filter((s) => s.current).length, 0);
  assert.deepEqual(
    steps.map((s) => s.label),
    STAGE_LABELS
  );
});

test("stageSteps: no check marks and no dates — the return shape carries neither field", () => {
  for (const step of stageSteps("Applied")) {
    assert.ok(!("done" in step));
    assert.ok(!("date" in step));
    assert.ok(!("checked" in step));
  }
});
