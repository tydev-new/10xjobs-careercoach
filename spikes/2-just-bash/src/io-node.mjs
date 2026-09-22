// Node adapter for check-closeout.mjs's `io` interface. Only this file
// (and bin/check_closeout.mjs, which is Node-only by nature — it's a CLI)
// touches node:fs. The core port stays platform-neutral.
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
  async mtimeMs(path) {
    const st = await fs.stat(path);
    return st.mtimeMs;
  },
};
