import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeGlobBundle } from "./skills-bundle-normalize.ts";

test("strips everything up to and including the last 'skills/' segment", () => {
  const bundle = normalizeGlobBundle({
    "../../../../skills/apply/SKILL.md": "# Apply",
    "../../../../skills/profile/templates/workspace-CLAUDE.md": "# CLAUDE",
  });
  assert.deepEqual(Object.keys(bundle).sort(), ["skills/apply/SKILL.md", "skills/profile/templates/workspace-CLAUDE.md"]);
  assert.equal(bundle["skills/apply/SKILL.md"], "# Apply");
});

test("also handles an absolute-looking glob key (whatever normalization Vite happens to use)", () => {
  // Not a real home-directory path on purpose (tests/test_invariants.py's
  // no-candidate-data scan flags "/Users/<name>" shapes repo-wide) — any
  // absolute prefix exercises the same "(^|/)skills/" match.
  const bundle = normalizeGlobBundle({
    "/build/repo/skills/coach/SKILL.md": "# Coach",
  });
  assert.equal(bundle["skills/coach/SKILL.md"], "# Coach");
});

test("a key with no 'skills/' segment at all is dropped, not crashed on", () => {
  const bundle = normalizeGlobBundle({ "../../../../other/x.md": "nope" });
  assert.deepEqual(bundle, {});
});

test("a path that merely CONTAINS 'skills' as a substring (not a real segment) is not mis-sliced", () => {
  const bundle = normalizeGlobBundle({ "../../../../not-skills/x.md": "nope" });
  assert.deepEqual(bundle, {});
});

test("the result is frozen (read-only, matching SkillBundle's own contract)", () => {
  const bundle = normalizeGlobBundle({ "../../../../skills/coach/SKILL.md": "# Coach" });
  assert.throws(() => {
    (bundle as any)["skills/coach/SKILL.md"] = "tampered";
  });
});
