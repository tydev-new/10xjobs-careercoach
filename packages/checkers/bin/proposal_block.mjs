#!/usr/bin/env node
import { run } from "../src/proposal-block.mjs";
import { nodeIo } from "../src/io-node.mjs";

const { stdout, stderr, exitCode } = await run(process.argv.slice(2), nodeIo);
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
process.exit(exitCode);
