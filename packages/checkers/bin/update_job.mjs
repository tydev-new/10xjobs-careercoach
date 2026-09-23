#!/usr/bin/env node
// CHECKER_NOW_ISO — see bin/record_verdict.mjs's comment; same reason.
import { run } from "../src/update-job.mjs";
import { nodeIo } from "../src/io-node.mjs";

const frozen = process.env.CHECKER_NOW_ISO;
const now = frozen ? () => new Date(frozen) : undefined;

const { stdout, stderr, exitCode } = await run(process.argv.slice(2), nodeIo, now);
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
process.exit(exitCode);
