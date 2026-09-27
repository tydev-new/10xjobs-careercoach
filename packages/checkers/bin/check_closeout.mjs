#!/usr/bin/env node
import { run } from "../src/check-closeout.mjs";
import { nodeIo } from "../src/io-node.mjs";

const { stdout, stderr, exitCode } = await run(process.argv.slice(2), nodeIo);
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
// process.exitCode (never process.exit()): exit() can cut a piped
// stdout/stderr write off mid-flush before the pipe drains (a real
// hazard the parity harness and any shell pipeline both hit) —
// setting exitCode lets Node finish flushing, then exit naturally
// once the event loop empties.
process.exitCode = exitCode;
