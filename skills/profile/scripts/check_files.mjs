#!/usr/bin/env node
// Node-only by nature (like lib/io-node.mjs) — this is the one place a
// standalone `check_files.mjs` CLI run (no just-bash dispatcher involved)
// computes its own equivalent of Python's `__file__`-based --skills
// default (see lib/check-files.mjs's header comment for why the shared
// port itself no longer does this).
//
// This file's own real position on disk IS skills/profile/scripts/ — its
// own two-dirnames-up gives the skills/ root directly, no repo-root
// reconstruction needed (unlike the pre-move bin/check_files.mjs, whose
// own position was packages/checkers/bin/, a different depth from the
// bundle).
// `fileURLToPath` (not a raw `new URL(...).pathname`) is required so a
// repo path containing a space decodes correctly instead of surviving as
// a literal "%20".
import { fileURLToPath } from "node:url";
import { run } from "./lib/check-files.mjs";
import { nodeIo } from "./lib/io-node.mjs";

const HERE = fileURLToPath(import.meta.url); // .../skills/profile/scripts/check_files.mjs
// This CLI's own real disk position never depends on --workspace (unlike
// dispatch.mjs's resolver — see lib/check-files.mjs's header comment).
const resolveInvokedScriptPath = () => HERE;

const { stdout, stderr, exitCode } = await run(process.argv.slice(2), nodeIo, resolveInvokedScriptPath);
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
// process.exitCode (never process.exit()): exit() can cut a piped
// stdout/stderr write off mid-flush before the pipe drains (a real
// hazard any shell pipeline hits) — setting exitCode lets Node finish
// flushing, then exit naturally once the event loop empties.
process.exitCode = exitCode;
