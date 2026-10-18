// Preloaded with `node --require` by tests/feedback-review.test.mjs: records every
// path the feedback script asks the file system about, so the test can check
// design-feedback.md § 8.3 ("it never opens a file under its working folder").
// Each call is appended, as one JSON line, to the file named by FS_TRACE.
"use strict";
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const out = process.env.FS_TRACE;
const append = fs.appendFileSync.bind(fs);
const path = require("node:path");
function rec(op, p) {
  if (!out) return;
  try {
    const s = typeof p === "string" ? p : p instanceof URL ? p.pathname : Buffer.isBuffer(p) ? p.toString() : String(p);
    append(out, JSON.stringify({ op, path: path.resolve(s) }) + "\n");
  } catch {
    // never let the trace change what the script does
  }
}
const SYNC = ["openSync", "readFileSync", "existsSync", "statSync", "lstatSync", "readdirSync", "opendirSync", "accessSync", "writeFileSync", "appendFileSync", "mkdirSync", "rmSync", "unlinkSync", "renameSync", "copyFileSync", "readlinkSync", "realpathSync", "createReadStream", "createWriteStream"];
for (const name of SYNC) {
  const orig = fs[name];
  if (typeof orig !== "function") continue;
  fs[name] = function (p, ...rest) {
    if (!(name === "appendFileSync" && p === out)) rec(name, p);
    return orig.call(this, p, ...rest);
  };
}
const ASYNC = ["open", "readFile", "stat", "lstat", "readdir", "opendir", "access", "writeFile", "mkdir"];
for (const name of ASYNC) {
  const orig = fs.promises[name];
  if (typeof orig !== "function") continue;
  fs.promises[name] = function (p, ...rest) {
    rec("promises." + name, p);
    return orig.call(this, p, ...rest);
  };
  const cb = fs[name];
  if (typeof cb === "function") {
    fs[name] = function (p, ...rest) {
      rec(name, p);
      return cb.call(this, p, ...rest);
    };
  }
}
syncBuiltinESMExports();
