#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { pathToFileURL } from "node:url";
import { createActiveContextService, createFileActiveSelectionStore, createLocalWorkspaceIdentity } from "./active-context-service.mjs";
import { createLocalWorkspace } from "./workspace-core.mjs";

export function createCareerCoachMcpServer(contextService) {
  const server = new McpServer(
    { name: "careercoach-active-context", version: "0.1.0" },
    {
      instructions: "Call get_active_context once before acting on a visible CareerCoach request. Compare the returned selection label and action with the visible message. If they disagree, stop and ask the user to launch the action again.",
    },
  );
  server.registerTool(
    "get_active_context",
    {
      title: "Get active CareerCoach context",
      description: "Read the current authoritative workspace sources for the one item and action explicitly launched from CareerCoach. Takes no arguments and must be called once before acting.",
    },
    async () => {
      try {
        const context = await contextService.getActiveContext();
        return {
          content: [{ type: "text", text: JSON.stringify(context) }],
          structuredContent: context,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: error.code || "active_context_error", message: error.message }) }],
        };
      }
    },
  );
  return server;
}

async function main() {
  const root = process.env.TEN_WORKSPACE_ROOT;
  if (!root) throw new Error("TEN_WORKSPACE_ROOT is required for the local CareerCoach MCP server.");
  const workspace = createLocalWorkspace(root);
  const identity = await createLocalWorkspaceIdentity(root);
  const contextService = createActiveContextService({
    identity,
    workspace,
    store: createFileActiveSelectionStore(process.env.TEN_STATE_DIR),
  });
  await serveStdio(() => createCareerCoachMcpServer(contextService));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
