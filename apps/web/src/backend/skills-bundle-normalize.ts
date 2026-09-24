// The pure, Node-testable half of skills-bundle.ts: turns whatever
// key-shape Vite's `import.meta.glob` happened to produce into the
// SkillBundle key shape packages/agent expects ("skills/<path>"). Split
// out of skills-bundle.ts because that file's own top-level
// `import.meta.glob(...)` call is Vite-only syntax `node --test` cannot
// execute at all (not even to import the module) — this file has no such
// call, so it's the part actually covered by a node --test unit test; the
// glob's own file-discovery is verified separately by a real `vite build`
// (see apps/web/README.md).
import type { SkillBundle } from "../../../../packages/agent/src/types.ts";

// Segment-aware ("skills/" preceded by the string start or a "/", never a
// mid-word match like "not-skills/") so a repo path that merely CONTAINS
// "skills" as a substring elsewhere never gets mis-sliced.
const SKILLS_SUFFIX_RE = /(?:^|\/)skills\/(.+)$/;

export function normalizeGlobBundle(rawModules: Record<string, string>): SkillBundle {
  const bundle: Record<string, string> = {};
  for (const [key, content] of Object.entries(rawModules)) {
    const m = SKILLS_SUFFIX_RE.exec(key);
    if (!m) continue; // defensive: every configured glob key matches "skills/**/*"
    bundle[`skills/${m[1]}`] = content;
  }
  return Object.freeze(bundle);
}
