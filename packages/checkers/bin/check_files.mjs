#!/usr/bin/env node
// Node-only by nature (like io-node.mjs) — this is the one place a
// standalone `check_files.mjs` CLI run (no just-bash dispatcher involved)
// computes its own equivalent of Python's `__file__`-based --skills
// default (see src/check-files.mjs's header comment for why the shared
// port itself no longer does this).
//
// This file's own real position on disk is packages/checkers/bin/, not
// skills/<owner>/scripts/ — so the default isn't "two dirnames up from
// here". Instead: find the repo root (three levels up from this file),
// then reconstruct "where check_files.py would be if this checkout's own
// skills/ were the bundle its __file__ pointed at" —
// <repoRoot>/skills/profile/scripts/check_files.py — and hand THAT to
// the port, which does the same two-dirnames-up arithmetic Python does.
// `fileURLToPath` (not a raw `new URL(...).pathname`) is required so a
// repo path containing a space decodes correctly instead of surviving as
// a literal "%20".
import { fileURLToPath } from "node:url";
import { run } from "../src/check-files.mjs";
import { nodeIo } from "../src/io-node.mjs";
import { join, dirname } from "../src/path-util.mjs";
import { CANONICAL_SKILL_PATH } from "../src/dispatch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)); // .../packages/checkers/bin
const REPO_ROOT = dirname(dirname(dirname(HERE))); // bin -> checkers -> packages -> repo root
const invokedScriptPath = join(REPO_ROOT, "skills", CANONICAL_SKILL_PATH["check_files.py"]);
// This CLI's own real disk position never depends on --workspace (unlike
// dispatch.mjs's resolver — see check-files.mjs's header comment).
const resolveInvokedScriptPath = () => invokedScriptPath;

const { stdout, stderr, exitCode } = await run(process.argv.slice(2), nodeIo, resolveInvokedScriptPath);
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
process.exit(exitCode);
