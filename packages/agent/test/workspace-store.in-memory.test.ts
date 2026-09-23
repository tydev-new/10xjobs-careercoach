import { createInMemoryWorkspaceStore } from "../src/workspace/in-memory-store.ts";
import { runWorkspaceStoreSuite } from "./workspace-store.shared.ts";

runWorkspaceStoreSuite("in-memory", (seed) => createInMemoryWorkspaceStore(seed));
