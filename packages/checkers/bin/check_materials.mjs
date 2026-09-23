#!/usr/bin/env node
// Node CLI wrapper around the JS port — spawned exactly like
// `python3 check_materials.py ...` by the parity harness, and usable
// standalone from a shell.
import { run } from "../src/check-materials.mjs";
import { nodeIo } from "../src/io-node.mjs";

const { stdout, stderr, exitCode } = await run(process.argv.slice(2), nodeIo);
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
process.exit(exitCode);
