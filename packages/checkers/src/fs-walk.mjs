// Directory-walking helpers built only on the `io` interface (exists,
// isDir, readdir) — no glob module (Node-only) and no node:fs. These
// replace the handful of `glob.glob(...)` calls in check_files.py, which
// are the only glob use among the ported scripts.
import { join } from "./path-util.mjs";
import { codePointCompare } from "./py-text.mjs";

// glob.glob(os.path.join(root, "**", "*.<ext>"), recursive=True), then
// sorted() by the caller — glob's recursive `**` walks every subdirectory
// depth-first; the final sort is on the full path string, which is what
// this returns pre-sorted.
export async function walkFilesRecursive(io, root, ext) {
  const out = [];
  async function walk(dir) {
    const names = await io.readdir(dir);
    for (const name of names.slice().sort(codePointCompare)) {
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      if (await io.isDir(p)) {
        await walk(p);
      } else if (name.endsWith(ext)) {
        out.push(p);
      }
    }
  }
  if (await io.isDir(root)) await walk(root);
  out.sort(codePointCompare);
  return out;
}

// glob.glob(os.path.join(dir, "*.<ext>")), sorted() — one level, files only.
// A bare `*` never matches a dotfile in glob (POSIX shell-glob convention,
// which Python's glob module follows) — the corpus's
// `cf-hidden-application-file` case (a `.draft.md` must not be picked up
// as an application).
export async function listFiles(io, dir, ext) {
  if (!(await io.isDir(dir))) return [];
  const names = await io.readdir(dir);
  const out = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    if (ext && !name.endsWith(ext)) continue;
    const p = join(dir, name);
    if (!(await io.isDir(p))) out.push(p);
  }
  out.sort(codePointCompare);
  return out;
}

// glob.glob(os.path.join(root, "*", relPath)), sorted() — one specific
// filename per immediate child directory (used for `*/SKILL.md` and
// `*/references/schema.md`).
export async function listPerChild(io, root, relPath) {
  if (!(await io.isDir(root))) return [];
  const names = await io.readdir(root);
  const out = [];
  for (const name of names.slice().sort(codePointCompare)) {
    const dir = join(root, name);
    if (!(await io.isDir(dir))) continue;
    const p = join(dir, relPath);
    if (await io.exists(p)) out.push(p);
  }
  return out;
}

// os.listdir(path), sorted() — top-level names only (files and dirs).
export async function listDirNames(io, dir) {
  if (!(await io.isDir(dir))) return [];
  const names = await io.readdir(dir);
  return names.slice().sort(codePointCompare);
}
