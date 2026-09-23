// Node adapter for the checkers' `io` interface (see README.md "The io
// interface"). Only this file, `bin/*.mjs` (Node-only by nature — they are
// CLIs), and the just-bash command adapter touch a real filesystem API. The
// ports under src/*.mjs stay platform-neutral: no node:fs, no node:path.
import { promises as fs } from "node:fs";

export const nodeIo = {
  async exists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  },
  async readFile(path) {
    return fs.readFile(path, "utf-8");
  },
  async writeFile(path, content) {
    await fs.writeFile(path, content, "utf-8");
  },
  async mtimeMs(path) {
    const st = await fs.stat(path);
    return st.mtimeMs;
  },
  async isDir(path) {
    try {
      const st = await fs.stat(path);
      return st.isDirectory();
    } catch {
      return false;
    }
  },
  async readdir(path) {
    try {
      return await fs.readdir(path);
    } catch {
      return [];
    }
  },
};
