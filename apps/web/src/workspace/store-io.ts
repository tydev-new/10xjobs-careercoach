// A read-only `io` adapter over the app's own WorkspaceStore (C § 2), for
// the ported checker scripts under skills/*/scripts/lib (design-web-ui.md
// § 5.3, Jobs' "Reads" — the jobs_md port's `load(io, workspace)`,
// skills/search/scripts/lib/jobs-md.mjs since PR #24's js-only J2 switch;
// Home's pipeline counts reuse the same adapter, C § 18's own note that
// "the Jobs page reuses the port's load()"). No window/document/
// localStorage/Node-only API: this runs in the browser.
//
// `exists(p)` is true when `read(p)` succeeds and false on
// `resource_missing` (any other error is thrown, so design-web-ui.md
// § 5.2 rule 6 — "unreadable is loud" — can show it, never silently
// treated as "missing"). `readFile(p)` returns the text. `writeFile`
// throws: no page writes (§ 5.2 rule 1).
import type { WorkspaceStore } from "../types.ts";
import { WorkspaceError } from "../types.ts";

export interface ReadOnlyIo {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export function storeIo(store: WorkspaceStore): ReadOnlyIo {
  return {
    async exists(path: string): Promise<boolean> {
      try {
        await store.read(path);
        return true;
      } catch (err) {
        if (err instanceof WorkspaceError && err.code === "resource_missing") return false;
        throw err;
      }
    },
    async readFile(path: string): Promise<string> {
      const file = await store.read(path);
      if (file.binary) throw new WorkspaceError("unsupported_type", path);
      return file.content;
    },
    async writeFile(): Promise<void> {
      throw new Error("store-io.ts is read-only: pages never write (design-web-ui.md § 5.2 rule 1)");
    },
  };
}
