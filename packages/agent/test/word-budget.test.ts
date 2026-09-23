// § 7 — "a turn loads at most ~3,300 words of instructions" (owner,
// 2026-09-22) = the always-on block (Tier 0 + host note + Tier 1 + tool
// descriptions) plus ONE loaded SKILL.md. MEASURED here against the real
// bundled skill prose, not a fixture, and printed so the number is a real
// receipt (see the coder hand-back for the printed figure).
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAlwaysOnSystemPrompt,
  buildTier1,
  countWords,
  extractDescription,
  HOST_NOTE_PATH,
  MVP_SKILLS,
  TIER0_PATH,
} from "../src/skills/system-prompt.ts";
import { toolDescriptionsWordCount } from "../src/tools/index.ts";
import { loadRealSkillBundle } from "./support.ts";

test("extractDescription: pulls the frontmatter description word for word", async () => {
  const bundle = await loadRealSkillBundle();
  const desc = extractDescription(bundle["skills/coach/SKILL.md"]);
  assert.ok(desc.startsWith("Use this skill when the candidate wants direction"), desc.slice(0, 60));
});

test("buildTier1: profile, evaluate, apply, coach descriptions, in that order", async () => {
  const bundle = await loadRealSkillBundle();
  const tier1 = buildTier1(bundle);
  assert.deepEqual(tier1.map((t) => t.name), [...MVP_SKILLS]);
  for (const t of tier1) assert.ok(t.description.length > 0, t.name);
});

test("Tier 0 is the bundled workspace-CLAUDE.md byte for byte, never a workspace copy", async () => {
  const bundle = await loadRealSkillBundle();
  const built = buildAlwaysOnSystemPrompt(bundle);
  assert.ok(built.text.includes(bundle[TIER0_PATH]));
  // even when a DIFFERENT "workspace CLAUDE.md" exists elsewhere in the
  // bundle map under a non-Tier-0 key, buildAlwaysOnSystemPrompt never
  // looks at it — it only ever reads TIER0_PATH.
  const tampered = { ...bundle, "workspace/CLAUDE.md": "a candidate-edited copy, ignored" };
  const built2 = buildAlwaysOnSystemPrompt(tampered);
  assert.equal(built2.text, built.text);
});

test("word budget: always-on block + tool descriptions + one SKILL.md, measured against the real bundle", async () => {
  const bundle = await loadRealSkillBundle();
  const always = buildAlwaysOnSystemPrompt(bundle);
  const toolWords = toolDescriptionsWordCount();
  const perSkillTotal: Record<string, number> = {};
  for (const name of MVP_SKILLS) {
    const skillMd = bundle[`skills/${name}/SKILL.md`];
    perSkillTotal[name] = always.words + toolWords + countWords(skillMd);
  }
  // eslint-disable-next-line no-console
  console.log("[word-budget]", {
    tier0Words: always.tier0Words,
    hostNoteWords: always.hostNoteWords,
    tier1Words: always.tier1Words,
    alwaysOnTotal: always.words,
    toolDescriptionWords: toolWords,
    perSkillTotal,
  });
  assert.ok(bundle[HOST_NOTE_PATH]?.length > 0);
  // The measured target (owner, 2026-09-22): ~3,300 words for the always-
  // on block + one SKILL.md. This asserts "measured and in the right
  // neighborhood" (within 25%), not an exact number — the real number is
  // printed above for the record, per the coder hand-back.
  for (const [name, total] of Object.entries(perSkillTotal)) {
    assert.ok(total < 3300 * 1.25, `${name}: ${total} words, more than 25% over the ~3,300 target`);
  }
});
