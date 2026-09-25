// § 13.2's "One list, one reader" + § 13.5 (x) "Agreement: a test fails
// if the proxy table's ids and coach-model.ts's ids differ."
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CLAUDE_COACH_MODEL, COACH_MODELS, DEEPSEEK_COACH_MODEL, coachModelFor } from "./coach-model.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("coach-model.ts holds exactly the two § 13 ids, Claude first", () => {
  assert.deepEqual(
    COACH_MODELS.map((m) => m.id),
    ["anthropic/claude-sonnet-5", "deepseek/deepseek-v4.1-flash"],
  );
  assert.equal(CLAUDE_COACH_MODEL.id, "anthropic/claude-sonnet-5");
  assert.equal(DEEPSEEK_COACH_MODEL.id, "deepseek/deepseek-v4.1-flash");
});

test("the menu names, word for word (§ 13.3)", () => {
  assert.equal(CLAUDE_COACH_MODEL.name, "Claude Sonnet 5");
  assert.equal(DEEPSEEK_COACH_MODEL.name, "DeepSeek V4.1 Flash (testing)");
});

test("coachModelFor: exact id match only, no suffix/case tolerance", () => {
  assert.equal(coachModelFor(CLAUDE_COACH_MODEL.id), CLAUDE_COACH_MODEL);
  assert.equal(coachModelFor(DEEPSEEK_COACH_MODEL.id), DEEPSEEK_COACH_MODEL);
  assert.equal(coachModelFor("anthropic/claude-sonnet-5:online"), undefined);
  assert.equal(coachModelFor("DeepSeek/deepseek-v4.1-flash"), undefined);
  assert.equal(coachModelFor("openai/gpt-4o"), undefined);
  assert.equal(coachModelFor(""), undefined);
});

// ---- § 13.5 (x): the proxy's own allowlist must hold the SAME ids -------
// coach-model.ts has "no imports" (§ 13.2), so the agreement is checked
// from OUTSIDE it: this test reads BOTH this module's ids and the proxy's
// MODEL_IDS export directly. core.ts itself has no imports either, so a
// plain relative import works under Node's own TypeScript support (no
// jsr:/Deno-only syntax in that file).
test("§ 13.5 (x): coach-model.ts's ids match supabase/functions/ten-model-proxy/core.ts's MODEL_IDS exactly", async () => {
  const core = await import("../../../../supabase/functions/ten-model-proxy/core.ts");
  const proxyIds = [...(core.MODEL_IDS as readonly string[])].slice().sort();
  const siteIds = COACH_MODELS.map((m) => m.id).slice().sort();
  assert.deepEqual(siteIds, proxyIds, `site ids ${JSON.stringify(siteIds)} vs proxy ids ${JSON.stringify(proxyIds)}`);
});

test("coach-model.ts has no imports (§ 13.2, word for word)", () => {
  const src = readFileSync(path.join(REPO, "apps/web/src/backend/coach-model.ts"), "utf8");
  const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
  assert.deepEqual(importLines, [], "coach-model.ts must hold no imports");
});
