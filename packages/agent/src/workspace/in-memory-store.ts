// The in-memory WorkspaceStore (§ 2) — used by the browser (a session
// before the Supabase-backed store lands, step 2) and by every test in
// this package. No node:* import: a Map plus a monotonic per-path
// revision counter for `version` (opaque per the contract).
import {
  type FileInfo,
  type FileRead,
  type WorkspaceStore,
  WorkspaceError,
} from "../types.ts";
import {
  assertEditSize,
  assertUploadSize,
  isEditableExt,
  isReadOnlyPath,
  isUploadExt,
  validateRef,
} from "./path-rules.ts";

interface Entry {
  content: string | null; // null for binary (uploaded) entries
  bytes: Uint8Array | null;
  version: number;
  updatedAt: string;
}

export interface Clock {
  now(): Date;
}

export function createInMemoryWorkspaceStore(
  seed: Record<string, string> = {},
  clock: Clock = { now: () => new Date() },
): WorkspaceStore {
  const files = new Map<string, Entry>();
  for (const [rawPath, content] of Object.entries(seed)) {
    const path = validateRef(rawPath);
    files.set(path, {
      content,
      bytes: null,
      version: 1,
      updatedAt: clock.now().toISOString(),
    });
  }

  function toInfo(path: string, entry: Entry): FileInfo {
    const size = entry.bytes
      ? entry.bytes.byteLength
      : new TextEncoder().encode(entry.content ?? "").byteLength;
    return {
      path,
      version: String(entry.version),
      size,
      updatedAt: entry.updatedAt,
      editable: isEditableExt(path) && !isReadOnlyPath(path),
    };
  }

  return {
    async list(dir = ""): Promise<FileInfo[]> {
      const prefix = dir ? `${validateRef(dir)}/` : "";
      const out: FileInfo[] = [];
      for (const [path, entry] of files) {
        if (prefix && !path.startsWith(prefix)) continue;
        // depth <= 3 from the listed dir: up to 3 directory levels plus
        // the filename itself = 4 path segments allowed (matches
        // workspace-core.mjs's own walk(), which still processes a
        // directory's own files AT depth 3 and only refuses to recurse
        // past it — M7/tester's "both backends list the same files").
        const rest = path.slice(prefix.length);
        if (rest.split("/").length > 4) continue;
        out.push(toInfo(path, entry));
      }
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },

    async read(rawPath: string): Promise<FileRead> {
      const path = validateRef(rawPath);
      const entry = files.get(path);
      if (!entry) throw new WorkspaceError("resource_missing", `${path} does not exist.`);
      const info = toInfo(path, entry);
      if (entry.bytes) {
        return { ...info, binary: true, bytes: entry.bytes };
      }
      return { ...info, binary: false, content: entry.content ?? "" };
    },

    async write(
      rawPath: string,
      content: string,
      expectedVersion: string | null,
    ): Promise<FileInfo> {
      const path = validateRef(rawPath);
      if (isReadOnlyPath(path)) {
        throw new WorkspaceError("not_editable", `${path} is not writable by the agent.`);
      }
      if (!isEditableExt(path)) {
        throw new WorkspaceError("not_editable", `${path} is not an editable file type.`);
      }
      assertEditSize(content);
      const existing = files.get(path);
      if (expectedVersion === null) {
        if (existing) {
          throw new WorkspaceError("already_exists", `${path} already exists.`);
        }
      } else {
        if (!existing) {
          throw new WorkspaceError("resource_missing", `${path} does not exist.`);
        }
        if (String(existing.version) !== expectedVersion) {
          throw new WorkspaceError("version_conflict", `${path} changed since it was read.`);
        }
      }
      const version = (existing?.version ?? 0) + 1;
      const entry: Entry = { content, bytes: null, version, updatedAt: clock.now().toISOString() };
      files.set(path, entry);
      return toInfo(path, entry);
    },

    async upload(rawPath: string, bytes: Uint8Array): Promise<FileInfo> {
      const path = validateRef(rawPath);
      if (isReadOnlyPath(path)) {
        throw new WorkspaceError("not_editable", `${path} is not writable by the agent.`);
      }
      if (!isUploadExt(path)) {
        throw new WorkspaceError("unsupported_type", `${path} is not an uploadable file type.`);
      }
      assertUploadSize(bytes);
      if (files.has(path)) {
        throw new WorkspaceError("already_exists", `${path} already exists.`);
      }
      const entry: Entry = { content: null, bytes, version: 1, updatedAt: clock.now().toISOString() };
      files.set(path, entry);
      return toInfo(path, entry);
    },
  };
}
