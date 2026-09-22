#!/usr/bin/env node
// Node CLI wrapper around the JS port — used for the parity test (spawn
// this exactly like `python3 check_closeout.py ...` and diff stdout/exit
// code byte-for-byte against the real Python script).
import { checkCloseout } from "../src/check-closeout.mjs";
import { nodeIo } from "../src/io-node.mjs";

function parseArgs(argv) {
  const args = { workspace: null, stage: null, asked: [], minutes: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace") args.workspace = argv[++i];
    else if (a === "--stage") args.stage = argv[++i];
    else if (a === "--asked") args.asked.push(argv[++i]);
    else if (a === "--minutes") args.minutes = parseInt(argv[++i], 10);
    else {
      process.stderr.write(`unrecognized argument: ${a}\n`);
      process.exit(2);
    }
  }
  if (!args.workspace) {
    process.stderr.write("--workspace is required\n");
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const { stdout, exitCode } = await checkCloseout(args, nodeIo);
process.stdout.write(stdout);
process.exit(exitCode);
