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
// Reads: its arguments; the plugin's plugin.json from ONE known place
// ($CLAUDE_PLUGIN_ROOT, else the repository layout this script sits in:
// <root>/skills/feedback/scripts, never a skills folder inside a `.claude`
// folder, which is where a user-level or a workspace-level install lives); the
// id file. It never searches upward and never opens a file under its working
// folder, so a workspace's own files cannot reach a report.
// Writes: only the id file, $XDG_CACHE_HOME/ten/installation-id (default
// ~/.cache/ten/installation-id): 32 random lowercase hex characters, made
// once. If it can't be written there is no id (null) for the dry run AND the
// send alike, so the id shown is the id sent, and nothing else is written.
//
// Environment (tests and the harness only): TEN_FEEDBACK_URL replaces the
// production address; XDG_CACHE_HOME moves the id file.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
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

/** The plugin's version: $CLAUDE_PLUGIN_ROOT first, else the repository layout
 * this script sits in (<root>/skills/feedback/scripts), else "unknown". A copy
 * made with `cp -r skills/*` lives in a `.claude/skills` folder (the user's, or a
 * workspace's): it gets "unknown" and nothing is looked up. Only paths derived
 * from this script's own location are ever opened, never a search upward, so a
 * file in the working folder can't be read. */
function readVersion(env) {
  const root = env.CLAUDE_PLUGIN_ROOT;
  if (root) {
    const v = versionFrom(join(root, ".claude-plugin", "plugin.json"));
    if (v) return v;
  }
  const skills = dirname(dirname(HERE)); // <root>/skills in the repository layout
  const repoRoot = dirname(skills);
  if (basename(skills) === "skills" && basename(repoRoot) !== ".claude") {
    return versionFrom(join(repoRoot, ".claude-plugin", "plugin.json")) ?? "unknown";
  }
  return "unknown";
}

/** The random id, made once per computer. Never inside a workspace. When it
 * can't be stored the answer is null: a fresh id for this send would not be the
 * id the person saw in the dry run, so there is no id at all. */
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
    return null; // can't be stored: no id, in the dry run and the send alike
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
