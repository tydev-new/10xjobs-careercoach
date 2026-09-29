#!/usr/bin/env node
// CHECKER_NOW_ISO (an ISO-8601 UTC instant, e.g. "2026-09-23T12:34:56Z") is
// read ONLY here, for the expected-output cases: jobs.md timestamps are
// wall-clock (datetime.now(timezone.utc) in the retired Python), so
// without a frozen clock a re-run of a case could stamp a different
// second. The just-bash command adapter never reads this env var — it
// always uses the real clock, the way the browser and a real local run
// both do.
import { run } from "./lib/record-verdict.mjs";
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
