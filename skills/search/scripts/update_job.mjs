#!/usr/bin/env node
// CHECKER_NOW_ISO — see evaluate/scripts/record_verdict.mjs's comment;
// same reason.
import { run } from "./lib/update-job.mjs";
import { nodeIo } from "../../profile/scripts/lib/io-node.mjs";

const frozen = process.env.CHECKER_NOW_ISO;
const now = frozen ? () => new Date(frozen) : undefined;

const { stdout, stderr, exitCode } = await run(process.argv.slice(2), nodeIo, now);
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
// process.exitCode (never process.exit()): exit() can cut a piped
// stdout/stderr write off mid-flush before the pipe drains (a real
// hazard any shell pipeline hits) — setting exitCode lets Node finish
// flushing, then exit naturally once the event loop empties.
process.exitCode = exitCode;
