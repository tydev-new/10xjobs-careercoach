// Builds a SkillBundle (Readonly<Record<"skills/<path>", text>>) by
// reading a real skills/ folder off disk.
//
// NODE-ONLY, same rule as local-folder-store.ts: not reachable from
// packages/agent/src/index.ts (the browser entry). The real app builds
// its SkillBundle at BUILD time via the bundler's own raw-text imports
// (see spikes/1-browser-loop's `?raw` imports); this Node reader is for
// the headless runner (bin/run.mjs) and this package's own Node tests,
// which need the identical bundle shape without a bundler.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { SkillBundle } from "../types.ts";

export async function buildSkillBundleFromDisk(skillsRoot: string): Promise<SkillBundle> {
  const bundle: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(path.dirname(skillsRoot), abs).split(path.sep).join("/");
      bundle[rel] = await readFile(abs, "utf8").catch(() => ""); // binary templates skipped as text
    }
  }
  await walk(skillsRoot);
  return bundle;
}
