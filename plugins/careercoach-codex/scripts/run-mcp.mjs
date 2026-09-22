import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import path from "node:path";

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), "..");
const serverPath = path.resolve(pluginRoot, "../../apps/workspace-ui/server/mcp-server.mjs");
const workspaceRoot = process.env.CAREERCOACH_WORKSPACE_ROOT || path.join(homedir(), "job-search");

const child = spawn(process.execPath, [serverPath], {
  env: { ...process.env, TEN_WORKSPACE_ROOT: workspaceRoot },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
