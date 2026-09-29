#!/usr/bin/env node
// Node CLI wrapper around the JS port — runs standalone from a shell, and
// is the same module the web app's dispatch imports.
import { run } from "./lib/check-materials.mjs";
import { nodeIo } from "../../profile/scripts/lib/io-node.mjs";

const { stdout, stderr, exitCode } = await run(process.argv.slice(2), nodeIo);
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
// process.exitCode (never process.exit()): exit() can cut a piped
// stdout/stderr write off mid-flush before the pipe drains (a real
// hazard any shell pipeline hits) — setting exitCode lets Node finish
// flushing, then exit naturally once the event loop empties.
process.exitCode = exitCode;
