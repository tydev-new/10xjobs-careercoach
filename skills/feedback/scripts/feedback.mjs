#!/usr/bin/env node
// The local feedback command (docs/design-feedback.md § 8). Node 18 or later,
// no packages. The rules live in lib/feedback.mjs; this file only supplies
// what a process knows: the arguments, the environment, `fetch`, the plugin
// version, and the random id file.
//
//   node scripts/feedback.mjs [--kind bug|comment] [--comment "<their words>"]
//                             [--rating 1-5] [--skill <name>] [--step "<title>"]
//                             [--dry-run]
//
// Reads: its arguments; $CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json, else the
// first .claude-plugin/plugin.json found walking up from this script; the id
// file. It never opens a file under its working folder.
// Writes: only the id file, $XDG_CACHE_HOME/ten/installation-id (default
// ~/.cache/ten/installation-id): 32 random lowercase hex characters, made
// once. If it can't be written, a fresh id is used for this send and nothing
// else is written.
//
// Environment (tests and the harness only): TEN_FEEDBACK_URL replaces the
// production address; XDG_CACHE_HOME moves the id file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { newInstallationId, run } from "./lib/feedback.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ID_RE = /^[0-9a-f]{32}$/;

function versionFrom(file) {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")).version;
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

/** The plugin's version: $CLAUDE_PLUGIN_ROOT first, else the first
 * .claude-plugin/plugin.json above this script, else "unknown" (a copy made
 * with `cp -r skills/*` has none above it, which is honest, not an error). */
function readVersion(env) {
  const root = env.CLAUDE_PLUGIN_ROOT;
  if (root) {
    const v = versionFrom(join(root, ".claude-plugin", "plugin.json"));
    if (v) return v;
  }
  let dir = HERE;
  for (;;) {
    const file = join(dir, ".claude-plugin", "plugin.json");
    if (existsSync(file)) return versionFrom(file) ?? "unknown";
    const up = dirname(dir);
    if (up === dir) return "unknown";
    dir = up;
  }
}

/** The random id, made once per computer. Never inside a workspace. */
function installationId(env) {
  const cache = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  const file = join(cache, "ten", "installation-id");
  try {
    const have = readFileSync(file, "utf8").trim();
    if (ID_RE.test(have)) return have;
  } catch {
    // none yet
  }
  const fresh = newInstallationId((a) => webcrypto.getRandomValues(a));
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, fresh + "\n", { mode: 0o600 });
  } catch {
    // can't be written: use it for this send only; nothing else is written
  }
  return fresh;
}

// Node 18 prints an "experimental" notice to stderr the first time `fetch` is
// used; this command's contract is that nothing but a crash reaches stderr.
process.removeAllListeners("warning");

const env = process.env;
const { stdout, exitCode } = await run(process.argv.slice(2), {
  env,
  fetchImpl: fetch,
  context: () => ({ version: readVersion(env), installationId: installationId(env) }),
});
process.stdout.write(stdout);
// exitCode, never process.exit(): exit() can cut a piped stdout off mid-flush.
process.exitCode = exitCode;
