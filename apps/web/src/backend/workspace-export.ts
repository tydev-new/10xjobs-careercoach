// Export / import a WorkspaceStore as a zip (docs/design-web-agent.md § 2,
// "Export, import, delete (rule 9)"):
//
//   - Export: a zip in the exact folder shape (entry = path, bytes as stored).
//   - Import: a zip into an EMPTY workspace only (or one holding only the
//     app's own root CLAUDE.md, § 7 / fix round 1 M5); one entry failing
//     the path rules refuses the whole import (blocks zip-slip).
//
// Uses fflate (pinned 0.8.3) — a small, dependency-free, browser-safe zip
// library (no node:* import, works the same in the browser and in Node).
// No window/document/localStorage.
//
// Fix round 1 (lead's rulings, independent tester's findings):
//   H1 — there is no user-level delete for ten_ws_files, so an import
//     can't be rolled back once a write lands. Every entry is validated
//     against the FULL path rules (mirroring the SQL exactly, via
//     packages/agent's shared path-rules.ts, L1) and the aggregate/
//     per-entry size and count caps BEFORE any write happens. If a write
//     still fails partway through (a genuine server-side surprise, since
//     the up-front pass can't observe true server state), the failure is
//     WorkspaceImportPartialError, carrying exactly what WAS written —
//     never a silently partial import.
//   H2 — the zip's entries are read from the central directory and
//     size-checked BEFORE inflation (fflate's `unzipSync` filter callback
//     fires with each entry's declared `originalSize` before it decides
//     whether to inflate that entry), so a small zip that claims a huge
//     uncompressed size is refused without ever holding those bytes in
//     memory. Any single entry over its own cap, or a running total over
//     an aggregate cap, or the entry count itself, aborts immediately.
//   M4 — text is decoded with {fatal:true, ignoreBOM:true}: invalid UTF-8
//     is refused (unsupported_type), and a leading BOM is preserved as
//     part of the string (so re-encoding on export reproduces it byte for
//     byte, matching TextEncoder's own BOM behavior).
//   M5 — a workspace holding only the app-created root CLAUDE.md (§ 7:
//     "created at first run or import") still counts as empty for import
//     purposes; a CLAUDE.md entry INSIDE the incoming zip is skipped, with
//     a note in the result, rather than failing the whole import or
//     overwriting the app's own bundle-derived copy.
import { unzipSync, zipSync, type UnzipFileInfo, type Zippable } from "fflate";
import type { FileInfo, WorkspaceStore } from "../../../../packages/agent/src/types.ts";
import {
  MAX_EDIT_BYTES,
  MAX_UPLOAD_BYTES,
  isEditableExt,
  isReadOnlyPath,
  isUploadExt,
  validateRef,
} from "../../../../packages/agent/src/workspace/path-rules.ts";

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

/** H1: thrown only once writing has actually started and a write fails
 *  partway through, after the up-front validation pass already accepted
 *  the whole zip (so this is a genuine server-side surprise — a race with
 *  another write, a cap crossed by something else concurrently, etc., not
 *  a rule this store's own checks should have caught). `written` is
 *  exactly what landed before the failure; there is no rollback. */
export class WorkspaceImportPartialError extends Error {
  written: FileInfo[];
  constructor(message: string, written: FileInfo[], cause: unknown) {
    super(message, { cause });
    this.name = "WorkspaceImportPartialError";
    this.written = written;
  }
}

export interface ImportResult {
  written: FileInfo[];
  /** Human-readable notes about entries that were accepted but not
   *  written verbatim (currently: a skipped CLAUDE.md, M5). */
  notes: string[];
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
 * container's timestamps). `store.list()` itself pages through every row
 * (H3, packages/agent's Supabase store), so this never silently truncates
 * past a single PostgREST page either.
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

// ---------------------------------------------------------------------
// import — aggregate caps mirroring § 2 exactly: 2,000 text files, 50 MB
// of text; 50 binary objects (<= 500 MB at the 10 MB/file cap). The
// 2,050 entry-count cap (H2) is the sum, checked directly too as a cheap
// first guard against a zip with very many tiny/empty entries.
// ---------------------------------------------------------------------

const MAX_TEXT_FILES = 2000;
const MAX_TEXT_BYTES_TOTAL = 50 * 1024 * 1024;
const MAX_OBJECTS = 50;
const MAX_ENTRIES = MAX_TEXT_FILES + MAX_OBJECTS; // 2,050

interface AdmittedEntry {
  path: string;
  zipName: string; // the raw name fflate indexes `entries` by
  editable: boolean;
}

// ---------------------------------------------------------------------
// M-new-2 / I7 (fix round 2): the central directory's declared sizes
// (checked in the filter, above) can be forged relative to the entry's
// ACTUAL data — a STORED entry's real bytes are whatever its compressed-
// size field says (untouched by a lie about originalSize alone, I6); a
// DEFLATEd entry's real bytes are silently truncated to the (lied,
// smaller) declared size, since fflate allocates its output buffer to
// exactly `originalSize` and does not itself check a CRC (I7). So the
// SECOND pass below re-checks every admitted entry's ACTUAL inflated
// byte length against the same per-entry/aggregate caps, and its CRC32
// against the central directory's own declared value (read here,
// independently of fflate's internal parse) — before any write.
// ---------------------------------------------------------------------

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Reads each entry's declared CRC32 straight from the zip's CENTRAL
 *  DIRECTORY (the same authoritative source fflate itself reads size and
 *  compression method from) — independent of, and not trusting, fflate's
 *  own internal bookkeeping. Malformed input returns whatever was parsed
 *  before the parse gave up; a missing entry is then treated as "no
 *  declared CRC found" by the caller, which refuses rather than skips. */
function readCentralDirectoryCrcs(zip: Uint8Array): Map<string, number> {
  const map = new Map<string, number>();
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let e = zip.length - 22;
  for (; e >= 0 && dv.getUint32(e, true) !== 0x06054b50; e--) {
    if (zip.length - e > 65558) return map;
  }
  if (e < 0) return map;
  let count = dv.getUint16(e + 10, true);
  let o = dv.getUint32(e + 16, true);
  // ZIP64 locator/record, mirroring fflate's own unzipSync.
  if (e - 20 >= 0 && dv.getUint32(e - 20, true) === 0x07064b50) {
    const ze = Number(dv.getBigUint64(e - 12, true));
    if (ze + 4 <= zip.length && dv.getUint32(ze, true) === 0x06064b50) {
      count = Number(dv.getBigUint64(ze + 32, true));
      o = Number(dv.getBigUint64(ze + 48, true));
    }
  }
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let i = 0; i < count && o + 46 <= zip.length; i++) {
    if (dv.getUint32(o, true) !== 0x02014b50) break; // malformed; the byte-length/decode checks still catch a bad entry
    const declaredCrc = dv.getUint32(o + 16, true);
    const nlen = dv.getUint16(o + 28, true);
    const elen = dv.getUint16(o + 30, true);
    const clen = dv.getUint16(o + 32, true);
    const name = decoder.decode(zip.subarray(o + 46, o + 46 + nlen));
    map.set(name, declaredCrc);
    o += 46 + nlen + elen + clen;
  }
  return map;
}

/**
 * Import a zip into an EMPTY workspace, or one holding only the app's own
 * root CLAUDE.md (§ 2, M5). Validates every entry against the SAME shared
 * path rules every store enforces (packages/agent/path-rules.ts, mirroring
 * the SQL exactly, L1), the extension/size caps, and the aggregate caps —
 * ALL of it before any byte is inflated (H2) and before any write happens
 * (H1) — so one bad entry, or the zip as a whole being over a cap, refuses
 * the WHOLE import and writes nothing. `WorkspaceImportError` lists every
 * offending entry found in the up-front pass (H2's central-directory
 * check throws on the FIRST violation it reaches, so that list may hold
 * just one entry for a very large zip — inflating the rest to keep
 * checking would defeat the point).
 *
 * "Empty (or CLAUDE.md-only) workspace only": checked by calling
 * `store.list()` first; anything else throws a plain `Error` (not
 * `WorkspaceImportError`, which is reserved for per-entry problems)
 * before touching the zip at all.
 */
export async function importWorkspace(store: WorkspaceStore, zipBytes: Uint8Array): Promise<ImportResult> {
  const existing = await store.list();
  const isEmptyOrClaudeMdOnly = existing.length === 0 || (existing.length === 1 && existing[0].path === "CLAUDE.md");
  if (!isEmptyOrClaudeMdOnly) {
    throw new Error("import refused: the workspace is not empty");
  }

  const notes: string[] = [];
  const admitted: AdmittedEntry[] = [];
  const claimedLower = new Map<string, string>(); // lower(path) -> path, for a readable clash message
  // I9 (fix round 2): the pre-check must treat an EXISTING root CLAUDE.md
  // (the M5 case) as an already-claimed FILE for clash purposes too, so
  // e.g. "CLAUDE.md/x.md" is refused up front (a WorkspaceImportError,
  // nothing written) rather than passing the pre-check and failing
  // mid-write on the server's own ten_path_clash (a WorkspaceImportPartialError).
  if (existing.length === 1) claimedLower.set("claude.md", "CLAUDE.md");
  let entryCount = 0;
  let textFileCount = 0;
  let totalTextBytes = 0;
  let totalObjects = 0;

  function fail(zipName: string, reason: string): never {
    throw new WorkspaceImportError([{ path: zipName, reason }]);
  }

  function checkClash(path: string, zipName: string): void {
    const lower = path.toLowerCase();
    for (const [otherLower, otherPath] of claimedLower) {
      if (otherLower === lower) fail(zipName, `path_conflict: case-variant clash with another entry (or the workspace's existing CLAUDE.md): ${otherPath}`);
      if (lower.startsWith(`${otherLower}/`)) fail(zipName, `path_conflict: nested under an existing file (another entry, or the workspace's existing CLAUDE.md): ${otherPath}`);
      if (otherLower.startsWith(`${lower}/`)) fail(zipName, `path_conflict: is a folder of another entry in this import: ${otherPath}`);
    }
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes, {
      // H2: called with each entry's CENTRAL-DIRECTORY metadata (name,
      // originalSize) BEFORE fflate decides whether to inflate it — every
      // check here runs off that metadata (plus running totals), so an
      // oversized entry, or one that would cross an aggregate cap, is
      // refused without ever being inflated. Throwing here aborts
      // unzipSync entirely (fflate does not catch filter's exceptions).
      filter(file: UnzipFileInfo): boolean {
        const zipName = file.name;
        if (zipName.endsWith("/")) return false; // a directory pseudo-entry; nothing to inflate or write

        entryCount++;
        if (entryCount > MAX_ENTRIES) fail(zipName, `workspace_full: the import has more than ${MAX_ENTRIES} entries`);

        let path: string;
        try {
          path = validateRef(zipName);
        } catch (e) {
          return fail(zipName, (e as Error).message);
        }

        if (path === "CLAUDE.md") {
          // M5: the app owns this file (§ 7); skip it — with a note —
          // rather than refusing the whole import or overwriting the
          // bundle-derived copy the app is responsible for.
          notes.push("CLAUDE.md in the import was skipped: the app's own copy is authoritative (§ 7).");
          return false;
        }
        if (isReadOnlyPath(path)) {
          return fail(zipName, `not_editable: ${path} is not writable by the agent`);
        }

        const editable = isEditableExt(path);
        const uploadable = isUploadExt(path);
        if (!editable && !uploadable) {
          return fail(zipName, `unsupported_type: ${path} is not an editable or uploadable file type`);
        }

        if (editable) {
          if (file.originalSize > MAX_EDIT_BYTES) {
            return fail(zipName, `content_too_large: ${path} is over ${MAX_EDIT_BYTES} bytes`);
          }
          textFileCount++;
          if (textFileCount > MAX_TEXT_FILES) {
            return fail(zipName, `workspace_full: the import has more than ${MAX_TEXT_FILES} text files`);
          }
          totalTextBytes += file.originalSize;
          if (totalTextBytes > MAX_TEXT_BYTES_TOTAL) {
            return fail(zipName, `workspace_full: the import's text totals more than ${MAX_TEXT_BYTES_TOTAL} bytes`);
          }
        } else {
          if (file.originalSize === 0 || file.originalSize > MAX_UPLOAD_BYTES) {
            return fail(zipName, `upload_too_large: ${path} must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes`);
          }
          totalObjects++;
          if (totalObjects > MAX_OBJECTS) {
            return fail(zipName, `workspace_full: the import has more than ${MAX_OBJECTS} binary objects`);
          }
        }

        checkClash(path, zipName);
        claimedLower.set(path.toLowerCase(), path);
        admitted.push({ path, zipName, editable });
        return true;
      },
    });
  } catch (e) {
    if (e instanceof WorkspaceImportError) throw e;
    throw new WorkspaceImportError([{ path: "(zip)", reason: `not a valid zip: ${(e as Error).message}` }]);
  }

  // Second pass: every admitted entry is now inflated (fflate already did
  // that for entries the filter returned true for). Three checks that can
  // only run on the ACTUAL bytes (not the central directory's declared
  // metadata, which the filter above already used and which can lie,
  // M-new-2/I6/I7): the real byte length against the same per-entry and
  // aggregate caps (recomputed fresh from real lengths — a forged
  // originalSize must not admit real bytes over any cap), the entry's
  // CRC32 against the central directory's own declared value (catches a
  // DEFLATEd entry that decodes short/wrong without fflate itself
  // erroring), and — for text — a strict UTF-8 decode (M4). All of this
  // is still entirely before any write() / upload() call.
  const declaredCrcs = readCentralDirectoryCrcs(zipBytes);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const toWrite: { path: string; content?: string; bytes?: Uint8Array }[] = [];
  let actualTextFiles = 0;
  let actualTextBytes = 0;
  let actualObjects = 0;
  for (const a of admitted) {
    const bytes = entries[a.zipName];

    const declaredCrc = declaredCrcs.get(a.zipName);
    if (declaredCrc === undefined || crc32(bytes) !== declaredCrc) {
      throw new WorkspaceImportError([{ path: a.zipName, reason: `the entry's data does not match its declared CRC32 (corrupt or truncated): ${a.path}` }]);
    }

    if (a.editable) {
      if (bytes.byteLength > MAX_EDIT_BYTES) {
        throw new WorkspaceImportError([{ path: a.zipName, reason: `content_too_large: ${a.path}'s actual size is over ${MAX_EDIT_BYTES} bytes (declared size did not match)` }]);
      }
      actualTextFiles++;
      if (actualTextFiles > MAX_TEXT_FILES) {
        throw new WorkspaceImportError([{ path: a.zipName, reason: `workspace_full: the import has more than ${MAX_TEXT_FILES} text files (by actual size)` }]);
      }
      actualTextBytes += bytes.byteLength;
      if (actualTextBytes > MAX_TEXT_BYTES_TOTAL) {
        throw new WorkspaceImportError([{ path: a.zipName, reason: `workspace_full: the import's actual text totals more than ${MAX_TEXT_BYTES_TOTAL} bytes (declared sizes did not match)` }]);
      }
      let content: string;
      try {
        content = decoder.decode(bytes);
      } catch {
        throw new WorkspaceImportError([{ path: a.zipName, reason: `unsupported_type: ${a.path} is not valid UTF-8` }]);
      }
      toWrite.push({ path: a.path, content });
    } else {
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new WorkspaceImportError([{ path: a.zipName, reason: `upload_too_large: ${a.path}'s actual size must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes (declared size did not match)` }]);
      }
      actualObjects++;
      if (actualObjects > MAX_OBJECTS) {
        throw new WorkspaceImportError([{ path: a.zipName, reason: `workspace_full: the import has more than ${MAX_OBJECTS} binary objects (by actual size)` }]);
      }
      toWrite.push({ path: a.path, bytes });
    }
  }

  // H1: only now, after every entry passed both validation passes, do any
  // writes happen. If one still fails (a genuine server-side surprise —
  // there's no way to roll back a partial import, so this is reported
  // explicitly rather than left silent.
  const written: FileInfo[] = [];
  try {
    for (const w of toWrite) {
      if (w.content !== undefined) {
        written.push(await store.write(w.path, w.content, null));
      } else {
        written.push(await store.upload(w.path, w.bytes!));
      }
    }
  } catch (e) {
    throw new WorkspaceImportPartialError(
      `import failed after writing ${written.length} of ${toWrite.length} entr${toWrite.length === 1 ? "y" : "ies"}: ${(e as Error).message}`,
      written,
      e,
    );
  }

  return { written, notes };
}
