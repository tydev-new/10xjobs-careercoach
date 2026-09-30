// Every Deps field bin/run.mjs builds EXCEPT the model (which needs the
// key and so stays in run.mjs's main()). Split out so a test can build
// the headless runner's actual wiring with no model and no key
// (test/headless-real-scripts.test.ts) instead of a copy of it.
//
// NODE-ONLY: local-folder-store.ts and skill-bundle-fs.ts read the disk.
// Not reachable from src/index.ts (the browser entry).
//
// `scripts` is the SAME real ScriptRunner the web app uses
// (apps/web/src/backend/script-runner.ts — just-bash + the skills' ported
// checkers via packages/checkers/src/just-bash-command.mjs), imported from
// there rather than copied, so a headless run executes `node scripts/...`
// checker commands exactly as the web app does (one implementation).
import path from "node:path";

import { createInMemoryGate } from "../src/gate.ts";
import { createLocalFolderWorkspaceStore } from "../src/workspace/local-folder-store.ts";
import { buildSkillBundleFromDisk } from "../src/skills/skill-bundle-fs.ts";
import { createRealScriptRunner } from "../../../apps/web/src/backend/script-runner.ts";

/**
 * @param {{ workspaceDir: string, skillsDir: string, balance?: number,
 *           logger?: { info(e: object): void, warn(e: object): void, error(e: object): void } }} opts
 */
export async function buildHeadlessDeps(opts) {
  const balance = opts.balance ?? 5;
  return {
    workspace: createLocalFolderWorkspaceStore(path.resolve(opts.workspaceDir)),
    skills: await buildSkillBundleFromDisk(path.resolve(opts.skillsDir)),
    gate: createInMemoryGate(),
    balance: async () => balance,
    fetch: globalThis.fetch,
    clock: { now: () => new Date() },
    scripts: createRealScriptRunner(),
    logger: opts.logger ?? {
      info: (e) => console.error("[agent:info]", JSON.stringify(e)),
      warn: (e) => console.error("[agent:warn]", JSON.stringify(e)),
      error: (e) => console.error("[agent:error]", JSON.stringify(e)),
    },
  };
}
