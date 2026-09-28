// Node adapter for the checkers' `io` interface (see README.md "The io
// interface"). Only this file, `bin/*.mjs` (Node-only by nature — they are
// CLIs), and the just-bash command adapter touch a real filesystem API. The
// ports under src/*.mjs stay platform-neutral: no node:fs, no node:path.
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { universalNewlines } from "./py-text.mjs";

// TextDecoder({fatal:true}) throws on invalid UTF-8 the way Python's
// open(path, encoding="utf-8").read() does (UnicodeDecodeError) — Node's
// fs.readFile(path, "utf-8") instead silently substitutes U+FFFD, which
// would hide the corpus's `cm-latin1-bytes` case (Python crashes; a
// silent substitution would not). TextDecoder is a standard Web API, not
// Node-only. `ignoreBOM: true` is required too: TextDecoder's DEFAULT
// behavior strips a leading BOM, but Python's "utf-8" codec (as opposed
// to "utf-8-sig") does NOT — a stripped BOM would defeat the `cm-bom-letter`
// case (py-text.mjs's PY_S deliberately does not treat a BOM as
// whitespace, which only matters if the BOM byte is still there to see).
const utf8Strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

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
    const buf = await fs.readFile(path);
    const text = utf8Strict.decode(buf);
    return universalNewlines(text);
  },
  async writeFile(path, content) {
    // render_resume's --html-omitted fallback writes to a fixed path
    // outside the workspace (see render-resume.mjs) — its parent
    // directory won't exist yet on a fresh run, and Python's own
    // tempfile.mkdtemp() equivalent always creates one.
    await fs.mkdir(dirname(path), { recursive: true });
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
