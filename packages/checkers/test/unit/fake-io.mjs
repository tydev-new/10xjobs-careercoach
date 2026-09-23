// A tiny in-memory `io` for fast unit tests — no real filesystem, no
// tempdir cleanup. Mirrors the io interface documented in README.md.
import { join, dirname } from "../../src/path-util.mjs";

// `dirs`: paths that exist as EMPTY directories even though no file lives
// under them yet (mirrors a real filesystem's mkdir(ws) happening before
// any file is written into it — see check-files.mjs's checkStrays, which
// now distinguishes "workspace doesn't exist" from "workspace exists and
// is empty").
export function makeFakeIo(initialFiles = {}, dirs = []) {
  const files = new Map(); // normalized path -> content string
  const mtimes = new Map(); // normalized path -> epoch ms
  const knownDirs = new Set(dirs.map((d) => norm(d)));
  for (const [p, content] of Object.entries(initialFiles)) {
    files.set(norm(p), content);
    mtimes.set(norm(p), Date.now());
  }

  function norm(p) {
    return join(".", p).replace(/^\.\//, "");
  }
  function dirsOf(p) {
    const dirs = new Set();
    let d = dirname(norm(p));
    while (d && d !== ".") {
      dirs.add(d);
      d = dirname(d);
    }
    return dirs;
  }

  return {
    async exists(p) {
      const n = norm(p);
      if (files.has(n)) return true;
      for (const f of files.keys()) if (dirsOf(f).has(n)) return true;
      return false;
    },
    async readFile(p) {
      const n = norm(p);
      if (!files.has(n)) throw new Error(`ENOENT: ${p}`);
      return files.get(n);
    },
    async writeFile(p, content) {
      const n = norm(p);
      files.set(n, content);
      mtimes.set(n, Date.now());
    },
    async mtimeMs(p) {
      const n = norm(p);
      if (!mtimes.has(n)) throw new Error(`ENOENT: ${p}`);
      return mtimes.get(n);
    },
    setMtime(p, ms) {
      mtimes.set(norm(p), ms);
    },
    async isDir(p) {
      const n = norm(p);
      if (files.has(n)) return false;
      for (const f of files.keys()) if (dirsOf(f).has(n)) return true;
      return n === "." || n === "" || knownDirs.has(n);
    },
    async readdir(p) {
      const n = norm(p) === "." ? "" : norm(p);
      const names = new Set();
      for (const f of files.keys()) {
        if (n === "" ? true : f === n || f.startsWith(n + "/")) {
          const rel = n === "" ? f : f.slice(n.length + 1);
          if (!rel) continue;
          names.add(rel.split("/")[0]);
        }
      }
      const isKnownDir = n === "" || n === "." || knownDirs.has(n);
      if (names.size === 0 && !isKnownDir && ![...files.keys()].some((f) => f === n || f.startsWith(n + "/"))) {
        throw new Error(`ENOENT: ${p}`);
      }
      return [...names];
    },
  };
}
