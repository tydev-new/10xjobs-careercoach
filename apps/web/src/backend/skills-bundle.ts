// The build-time SkillBundle (docs/design-web-agent.md § 1: "skills/
// bundled read-only at build time"; plan step 5b item 1: "a SkillBundle
// built at build time from the repo's skills/ (Vite import.meta.glob with
// ?raw...)"). Every text file under the repo's `skills/` tree is inlined
// into the JS bundle as a raw string at BUILD time.
//
// VITE-ONLY FILE: `import.meta.glob` is Vite's own build-time construct —
// this file's top-level glob call is not something `node --test` can even
// import (there is no runtime `import.meta.glob` in plain Node). Nothing
// under apps/web/src/**/*.test.ts imports this file directly; the pure,
// node-testable half (turning the glob's raw key shape into
// packages/agent's `"skills/<path>"` bundle keys) lives in
// skills-bundle-normalize.ts and IS unit-tested there. This file's own
// glob (does it find every real file under skills/, with the right
// content?) is verified by a real `npm run build` + grepping the emitted
// bundle for known skill text — see apps/web/README.md.
import type { SkillBundle } from "../../../../packages/agent/src/types.ts";
import { normalizeGlobBundle } from "./skills-bundle-normalize.ts";

// The pattern is relative to THIS file's directory (apps/web/src/backend),
// four levels up to the repo root, same depth spike 1's own `?raw` imports
// use (spikes/1-browser-loop/src/main.ts). `eager: true` inlines every
// match at build time (no dynamic import, no runtime fetch — the bundle is
// read-only and fully present the moment the app boots, per § 1).
const modules = import.meta.glob("../../../../skills/**/*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function buildSkillBundle(): SkillBundle {
  return normalizeGlobBundle(modules);
}
