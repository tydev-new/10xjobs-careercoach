// Node-only (local-folder-store.ts is Node-only, per its own header
// comment). Each store gets a fresh mkdtemp'd folder seeded with the
// suite's files, so the same shared suite proves the two backends agree.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalFolderWorkspaceStore } from "../src/workspace/local-folder-store.ts";
import { runWorkspaceStoreSuite } from "./workspace-store.shared.ts";

async function makeStore(seed: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "agent-ws-"));
  for (const [rel, content] of Object.entries(seed)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return createLocalFolderWorkspaceStore(root);
}

runWorkspaceStoreSuite("local-folder", makeStore);
