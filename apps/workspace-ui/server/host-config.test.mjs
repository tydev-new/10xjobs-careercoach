// @vitest-environment node
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createItemRef } from "../shared/active-context.mjs";
import { createActiveContextService, createFileActiveSelectionStore, createLocalWorkspaceIdentity } from "./active-context-service.mjs";
import { createHostSetup } from "./host-config.mjs";
import { createLocalWorkspace } from "./workspace-core.mjs";

const cleanup = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true }))));

describe("external host setup", () => {
  it("generates the documented Antigravity local MCP config", () => {
    const setup = createHostSetup("antigravity", { workspaceRoot: "/career/workspace", nodeExecutable: "/usr/bin/node" });
    expect(setup.configPath).toBe("~/.gemini/config/mcp_config.json");
    expect(setup.config.mcpServers.careercoach).toMatchObject({
      command: "/usr/bin/node",
      env: { TEN_WORKSPACE_ROOT: "/career/workspace" },
    });
    expect(setup.config.mcpServers.careercoach.args[0]).toMatch(/server\/mcp-server\.mjs$/);
  });

  it("keeps hosts requiring packaging or a tunnel out of local stdio config", () => {
    expect(createHostSetup("claude-cowork", { workspaceRoot: "/career/workspace" })).not.toHaveProperty("config");
    expect(createHostSetup("chatgpt-work", { workspaceRoot: "/career/workspace" })).not.toHaveProperty("config");
  });

  it("performs an end-to-end lookup using the generated Antigravity command", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ten-host-workspace-"));
    const state = await mkdtemp(path.join(tmpdir(), "ten-host-state-"));
    cleanup.push(root, state);
    await mkdir(path.join(root, "documents"));
    await writeFile(path.join(root, "documents", "resume.md"), "# Host adapter resume\n");
    const identity = await createLocalWorkspaceIdentity(root);
    const service = createActiveContextService({ identity, workspace: createLocalWorkspace(root), store: createFileActiveSelectionStore(state) });
    await service.setActiveSelection({ itemRef: createItemRef("resource", "documents/resume.md"), action: "review_resume" });

    const definition = createHostSetup("antigravity", { workspaceRoot: root, stateDir: state }).config.mcpServers.careercoach;
    const client = new Client({ name: "antigravity-adapter-test", version: "0.1.0" });
    const transport = new StdioClientTransport({ ...definition, env: { ...process.env, ...definition.env } });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name: "get_active_context", arguments: {} });
      expect(result.structuredContent.sources[0].content).toContain("Host adapter resume");
    } finally {
      await client.close();
    }
  });
});
