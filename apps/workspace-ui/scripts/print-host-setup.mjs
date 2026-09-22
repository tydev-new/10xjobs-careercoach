#!/usr/bin/env node
import { createHostSetup } from "../server/host-config.mjs";

const hostId = process.argv[2];
const workspaceRoot = process.argv[3];
if (!hostId || !workspaceRoot) {
  console.error("Usage: node scripts/print-host-setup.mjs <host> <absolute-workspace-path>");
  process.exit(1);
}

try {
  console.log(JSON.stringify(createHostSetup(hostId, { workspaceRoot }), null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
