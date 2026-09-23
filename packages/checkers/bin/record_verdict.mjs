#!/usr/bin/env node
// CHECKER_NOW_ISO (an ISO-8601 UTC instant, e.g. "2026-09-23T12:34:56Z") is
// read ONLY here, for the parity harness: jobs.md timestamps are wall-clock
// (Python's datetime.now(timezone.utc)), so without a frozen clock the two
// engines could each stamp a different second. The just-bash command
// adapter never reads this env var — it always uses the real clock, the
// way the browser and a real Python run both do.
import { run } from "../src/record-verdict.mjs";
import { nodeIo } from "../src/io-node.mjs";

const frozen = process.env.CHECKER_NOW_ISO;
const now = frozen ? () => new Date(frozen) : undefined;

const { stdout, stderr, exitCode } = await run(process.argv.slice(2), nodeIo, now);
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
process.exit(exitCode);
