import path from "node:path";
import { fileURLToPath } from "node:url";
import { getHostAdapter } from "../shared/host-adapters.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createLocalMcpServerDefinition({
  workspaceRoot,
  stateDir,
  nodeExecutable = process.execPath,
  serverPath = path.join(appRoot, "server", "mcp-server.mjs"),
}) {
  if (!path.isAbsolute(workspaceRoot || "")) throw new Error("workspaceRoot must be an absolute path.");
  const env = { TEN_WORKSPACE_ROOT: workspaceRoot };
  if (stateDir) env.TEN_STATE_DIR = stateDir;
  return { command: nodeExecutable, args: [serverPath], env };
}

export function createHostSetup(hostId, options) {
  const host = getHostAdapter(hostId);
  if (host.connection === "local-stdio") {
    return {
      host,
      configPath: "~/.gemini/config/mcp_config.json",
      config: { mcpServers: { careercoach: createLocalMcpServerDefinition(options) } },
    };
  }
  if (host.connection === "desktop-plugin") {
    return { host, setup: "Install the CareerCoach local MCP as a Claude desktop plugin, then enable it in the Cowork task." };
  }
  return { host, setup: "Expose the CareerCoach MCP through OpenAI's Secure MCP Tunnel, then add it in ChatGPT developer mode." };
}
