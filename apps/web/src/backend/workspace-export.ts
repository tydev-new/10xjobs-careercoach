// Export / import a WorkspaceStore as a zip (docs/design-web-agent.md § 2,
// "Export, import, delete (rule 9)"):
//
//   - Export: a zip in the exact folder shape (entry = path, bytes as stored).
//   - Import: a zip into an EMPTY workspace only; one entry failing the path
//     rules refuses the whole import (blocks zip-slip).
//
// Uses fflate (pinned 0.8.3) — a small, dependency-free, browser-safe zip
// library (no node:* import, works the same in the browser and in Node).
// No window/document/localStorage.
import { unzipSync, zipSync, type Zippable } from "fflate";
import type { FileInfo, WorkspaceStore } from "../../../../packages/agent/src/types.ts";
import { isEditableExt, isUploadExt, validateRef } from "../../../../packages/agent/src/workspace/path-rules.ts";

export interface ImportError {
  path: string; // the zip entry name as given (not validated/normalized)
  reason: string;
}

export class WorkspaceImportError extends Error {
  errors: ImportError[];
  constructor(errors: ImportError[]) {
    super(`workspace import refused: ${errors.map((e) => `${e.path}: ${e.reason}`).join("; ")}`);
    this.name = "WorkspaceImportError";
    this.errors = errors;
  }
}

/** Zip entry names use forward slashes and no leading "./" per the zip
 *  spec; a path is already stored that way (validateRef's own output), so
 *  this is a light normalization pass only. */
function toEntryName(path: string): string {
  return path;
}

/**
 * Export the given store's entire contents (every file `list()` can reach,
 * walking every directory `list()` returns so nothing past depth 3 from
 * the root is silently dropped) as a zip, one entry per file, entry name
 * = path, bytes = the file's own bytes (text encoded UTF-8, binaries as
 * stored). Deterministic entry order (sorted by path) so two exports of
 * the same content produce byte-identical zips modulo fflate's own
 * per-entry mtime field, which is pinned to a fixed date here for that
 * reason (the zip DOS date format only allows 1980-2099, so the epoch
 * itself isn't valid; a real "last modified" isn't part of the
 * WorkspaceStore contract's FileInfo in any exported form, and rule 9's
 * round trip only promises the FILES are byte-identical, not the zip
 * container's timestamps).
 */
// fflate reads the year via the LOCAL calendar, so a UTC midnight right at
// the 1980 boundary can read back as 1979 in a negative-offset timezone;
// picking a date safely mid-range avoids that off-by-one regardless of TZ.
const ZIP_ENTRY_MTIME = new Date(Date.UTC(2000, 0, 2, 12));

export async function exportWorkspace(store: WorkspaceStore): Promise<Uint8Array> {
  const files = await listAllFiles(store);
  const zippable: Zippable = {};
  for (const info of files) {
    const read = await store.read(info.path);
    const bytes = read.binary ? read.bytes : new TextEncoder().encode(read.content);
    zippable[toEntryName(info.path)] = [bytes, { mtime: ZIP_ENTRY_MTIME }];
  }
  return zipSync(zippable, { level: 6 });
}

/** `store.list()` is capped at depth <= 3 from the given dir (§ 2). Real
 *  workspaces are shallow by design (documents/, applications/<company>/,
 *  jd-inbox/, ...), but a single root `list()` call still only reaches 3
 *  levels down; this re-lists from every subdirectory a call surfaces
 *  (each re-list gets its own depth-3 budget from THAT directory), so a
 *  file up to 3 levels below a subdirectory that itself showed up within
 *  the first 3 levels is still found. NOTE: a subtree with no file at or
 *  above depth 3 from its nearest discovered ancestor is, by construction
 *  of the WorkspaceStore contract (list() returns files, never bare
 *  directory placeholders), undiscoverable through this interface at
 *  all — not a gap in this function. */
async function listAllFiles(store: WorkspaceStore): Promise<FileInfo[]> {
  const seen = new Map<string, FileInfo>();
  const dirsToVisit = [""];
  const visitedDirs = new Set<string>();
  while (dirsToVisit.length) {
    const dir = dirsToVisit.shift()!;
    if (visitedDirs.has(dir)) continue;
    visitedDirs.add(dir);
    const entries = await store.list(dir || undefined);
    const subdirs = new Set<string>();
    for (const info of entries) {
      seen.set(info.path, info);
      // Queue every directory prefix seen (relative to root) so a folder
      // deeper than 3 levels below THIS dir, but reachable by listing one
      // of its own subfolders directly, is still found.
      const parts = info.path.split("/");
      for (let i = 1; i < parts.length; i++) {
        subdirs.add(parts.slice(0, i).join("/"));
      }
    }
    for (const d of subdirs) {
      if (!visitedDirs.has(d)) dirsToVisit.push(d);
    }
  }
  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Import a zip into an EMPTY workspace only (§ 2). Validates every entry
 * against the same path rules every store enforces (validateRef,
 * isEditableExt/isUploadExt) BEFORE writing anything — one bad entry
 * refuses the whole import (blocks zip-slip: a ../ entry, an absolute
 * path, a dotfile segment, or an unsupported extension). Throws
 * `WorkspaceImportError` listing every offending entry if any are found
 * (not just the first), and never partially imports.
 *
 * "Empty workspace only": checked by calling `store.list()` first; a
 * non-empty target throws a plain Error (not WorkspaceImportError, which
 * is reserved for per-entry problems) before touching the zip at all.
 */
export async function importWorkspace(store: WorkspaceStore, zipBytes: Uint8Array): Promise<FileInfo[]> {
  const existing = await store.list();
  if (existing.length > 0) {
    throw new Error("import refused: the workspace is not empty");
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch (e) {
    throw new WorkspaceImportError([{ path: "(zip)", reason: `not a valid zip: ${(e as Error).message}` }]);
  }

  // Directory entries (fflate includes a trailing-"/" pseudo-entry for
  // folders with no zeroed... actually fflate's unzipSync only returns
  // FILE entries, but a hand-built or foreign zip could still carry a
  // "dir/" entry with a name ending in "/" and zero bytes; skip it rather
  // than trying to write a file with a trailing slash.
  const fileEntries = Object.entries(entries).filter(([name]) => !name.endsWith("/"));

  const errors: ImportError[] = [];
  const validated: { path: string; bytes: Uint8Array }[] = [];
  const claimedLower = new Set<string>();

  for (const [name, bytes] of fileEntries) {
    let path: string;
    try {
      path = validateRef(name);
    } catch (e) {
      errors.push({ path: name, reason: (e as Error).message });
      continue;
    }
    // Root CLAUDE.md is never written through the ordinary WorkspaceStore.write()
    // path on ANY backend (path-rules.ts's isReadOnlyPath, unconditionally) — §
    // 7: "the app creates the root CLAUDE.md before the first agent turn," a
    // separate, app-owned step from importing candidate files, and Tier 0 is
    // always the BUNDLED template regardless of the workspace's own copy, so
    // an imported CLAUDE.md's content doesn't change agent behavior either way.
    // Skip it here rather than failing the whole import on a not_editable
    // refusal; the app's own setup step (re)creates it after import.
    if (path === "CLAUDE.md") continue;
    if (!isEditableExt(path) && !isUploadExt(path)) {
      errors.push({ path: name, reason: `unsupported file type: ${path}` });
      continue;
    }
    const lower = path.toLowerCase();
    if (claimedLower.has(lower)) {
      errors.push({ path: name, reason: `case-variant clash with another entry: ${path}` });
      continue;
    }
    claimedLower.add(lower);
    validated.push({ path, bytes });
  }

  if (errors.length > 0) {
    throw new WorkspaceImportError(errors);
  }

  const written: FileInfo[] = [];
  for (const { path, bytes } of validated) {
    if (isEditableExt(path)) {
      const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      written.push(await store.write(path, content, null));
    } else {
      written.push(await store.upload(path, bytes));
    }
  }
  return written;
}
