// The local-folder WorkspaceStore (§ 2) — a real folder on disk, for the
// headless runner (bin/run.mjs) and Node-side testing.
//
// NODE-ONLY. This file is deliberately NOT reachable from
// packages/agent/src/index.ts (the browser entry point): § 1 says the
// package "imports no window, document, localStorage, node:*, or Supabase
// client", which test/no-forbidden-imports.test.ts enforces by walking
// index.ts's import graph. This adapter is an explicit, opt-in Node
// backend for the runner and tests only — import it by its own path,
// never through the package's main export.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
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

export interface Clock {
  now(): Date;
}

function versionOf(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

export function createLocalFolderWorkspaceStore(
  rootInput: string,
  _clock: Clock = { now: () => new Date() },
): WorkspaceStore {
  const root = path.resolve(rootInput);
  let rootRealPromise: Promise<string> | undefined;
  function getRootReal(): Promise<string> {
    rootRealPromise ??= realpath(root).catch(() => root);
    return rootRealPromise;
  }

  /** Bounds-checks a workspace-relative path against the LOGICAL root
   *  first, then — because a symlink INSIDE the workspace can point
   *  anywhere on disk (M8) — against the REAL, symlink-resolved root
   *  too. `mustExist: true` resolves and checks the target itself (read,
   *  or an update's existence probe); `mustExist: false` resolves and
   *  checks the target's PARENT directory instead (create), so a
   *  symlinked directory can't be used to escape either. */
  async function resolvePath(
    rawPath: string,
    { mustExist }: { mustExist: boolean },
  ): Promise<{ rel: string; abs: string }> {
    const rel = validateRef(rawPath);
    const candidate = path.resolve(root, rel);
    if (candidate !== root && !candidate.startsWith(root + path.sep)) {
      throw new WorkspaceError("outside_workspace", "Resource is outside the workspace.");
    }
    const rootReal = await getRootReal();
    const withinReal = (real: string) => real === rootReal || real.startsWith(rootReal + path.sep);

    if (mustExist) {
      let real: string;
      try {
        real = await realpath(candidate);
      } catch {
        throw new WorkspaceError("resource_missing", `${rel} does not exist.`);
      }
      if (!withinReal(real)) {
        throw new WorkspaceError("outside_workspace", "Resource resolves outside the workspace.");
      }
      return { rel, abs: candidate };
    }

    // may not exist yet — check the parent directory's real path instead.
    const parent = path.dirname(candidate);
    let parentReal: string;
    try {
      parentReal = await realpath(parent);
    } catch {
      parentReal = rootReal; // parent doesn't exist yet; mkdir creates it under the already bounds-checked logical path
    }
    if (!withinReal(parentReal)) {
      throw new WorkspaceError("outside_workspace", "Destination resolves outside the workspace.");
    }
    return { rel, abs: candidate };
  }

  async function infoFor(relPath: string, absPath: string): Promise<FileInfo> {
    const st = await stat(absPath);
    const buf = await readFile(absPath);
    return {
      path: relPath,
      version: versionOf(buf),
      size: st.size,
      updatedAt: st.mtime.toISOString(),
      editable: isEditableExt(relPath) && !isReadOnlyPath(relPath),
    };
  }

  return {
    async list(dir = ""): Promise<FileInfo[]> {
      const startRel = dir ? validateRef(dir) : "";
      const startAbs = startRel ? (await resolvePath(startRel, { mustExist: true })).abs : root;
      const out: FileInfo[] = [];
      async function walk(dirAbs: string, depth: number): Promise<void> {
        if (depth > 3) return;
        let entries;
        try {
          entries = await readdir(dirAbs, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const childAbs = path.join(dirAbs, entry.name);
          // symlinked entries are skipped entirely (never listed, never
          // walked into) — M8: a symlink can't be used to smuggle an
          // outside file or directory into the workspace listing.
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            await walk(childAbs, depth + 1);
            continue;
          }
          if (!entry.isFile()) continue;
          const relPath = path.relative(root, childAbs).split(path.sep).join("/");
          out.push(await infoFor(relPath, childAbs));
        }
      }
      await walk(startAbs, 0);
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },

    async read(rawPath: string): Promise<FileRead> {
      const { rel, abs } = await resolvePath(rawPath, { mustExist: true });
      const buf = await readFile(abs);
      const info = await infoFor(rel, abs);
      if (!isEditableExt(rel)) {
        return { ...info, binary: true, bytes: new Uint8Array(buf) };
      }
      return { ...info, binary: false, content: buf.toString("utf8") };
    },

    async write(rawPath: string, content: string, expectedVersion: string | null): Promise<FileInfo> {
      const relPath = validateRef(rawPath);
      if (isReadOnlyPath(relPath)) {
        throw new WorkspaceError("not_editable", `${relPath} is not writable by the agent.`);
      }
      if (!isEditableExt(relPath)) {
        throw new WorkspaceError("not_editable", `${relPath} is not an editable file type.`);
      }
      assertEditSize(content);
      let exists = true;
      let current: Buffer | null = null;
      let absPath: string;
      try {
        const resolved = await resolvePath(rawPath, { mustExist: true });
        absPath = resolved.abs;
        current = await readFile(absPath);
      } catch (e) {
        if (e instanceof WorkspaceError && e.code === "outside_workspace") throw e;
        exists = false;
        absPath = (await resolvePath(rawPath, { mustExist: false })).abs;
      }
      if (expectedVersion === null) {
        if (exists) throw new WorkspaceError("already_exists", `${relPath} already exists.`);
      } else {
        if (!exists || current === null) throw new WorkspaceError("resource_missing", `${relPath} does not exist.`);
        if (versionOf(current) !== expectedVersion) {
          throw new WorkspaceError("version_conflict", `${relPath} changed since it was read.`);
        }
      }
      await mkdir(path.dirname(absPath), { recursive: true });
      const tmp = `${absPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await writeFile(tmp, content, "utf8");
      await rename(tmp, absPath);
      return infoFor(relPath, absPath);
    },

    async upload(rawPath: string, bytes: Uint8Array): Promise<FileInfo> {
      const relPath = validateRef(rawPath);
      if (isReadOnlyPath(relPath)) {
        throw new WorkspaceError("not_editable", `${relPath} is not writable by the agent.`);
      }
      if (!isUploadExt(relPath)) {
        throw new WorkspaceError("unsupported_type", `${relPath} is not an uploadable file type.`);
      }
      assertUploadSize(bytes);
      let absPath: string;
      try {
        await resolvePath(rawPath, { mustExist: true });
        throw new WorkspaceError("already_exists", `${relPath} already exists.`);
      } catch (e) {
        if (e instanceof WorkspaceError && e.code !== "resource_missing") throw e;
        absPath = (await resolvePath(rawPath, { mustExist: false })).abs;
      }
      await mkdir(path.dirname(absPath), { recursive: true });
      await writeFile(absPath, bytes, { flag: "wx" });
      return infoFor(relPath, absPath);
    },
  };
}
