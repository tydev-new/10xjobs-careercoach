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
// treated as "missing"). `readFile(p)` returns the text through
// `universalNewlines`, as the ports' own node io does (a lone-CR file
// still splits into lines). `writeFile`
// throws: no page writes (§ 5.2 rule 1).
import type { WorkspaceStore } from "../types.ts";
import { WorkspaceError } from "../types.ts";
import { universalNewlines } from "../../../../skills/profile/scripts/lib/py-text.mjs";

// Lead ruling (Stage 3d review, blocker 1): the REAL store
// (supabase-workspace-store.ts) throws `packages/agent`'s own
// `WorkspaceError` class, not this file's — two different classes with
// the same `{ code }` shape (apps/web/src/types.ts and
// packages/agent/src/types.ts each declare their own). An `instanceof`
// check against only one of them silently treats a genuinely MISSING
// file as an unreadable error on the real store, against § 5.2 rule 6
// ("missing is empty"). `isMissingError` checks by SHAPE (duck-typed:
// any object carrying `code === "resource_missing"`), not by which
// class threw it — the one check every "is this file just missing?"
// site in the workspace/ layer uses, on both classes and both stores.
// Home's own reader adds this identical helper to this same file, word
// for word, so the two builds merge without disagreeing on it.
export function isMissingError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "resource_missing";
}

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
        if (isMissingError(err)) return false;
        throw err;
      }
    },
    async readFile(path: string): Promise<string> {
      const file = await store.read(path);
      if (file.binary) throw new WorkspaceError("unsupported_type", path);
      return universalNewlines(file.content);
    },
    async writeFile(): Promise<void> {
      throw new Error("store-io.ts is read-only: pages never write (design-web-ui.md § 5.2 rule 1)");
    },
  };
}
