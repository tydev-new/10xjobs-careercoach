// Shared test support: the REAL skills/ bundle off disk (not a fixture),
// via the Node-only reader (src/skills/skill-bundle-fs.ts).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkillBundleFromDisk } from "../src/skills/skill-bundle-fs.ts";
import type { SkillBundle } from "../src/types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");

let cached: SkillBundle | null = null;
export async function loadRealSkillBundle(): Promise<SkillBundle> {
  if (!cached) {
    cached = await buildSkillBundleFromDisk(path.join(REPO_ROOT, "skills"));
  }
  return cached;
}
