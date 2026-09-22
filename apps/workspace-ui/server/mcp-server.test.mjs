// @vitest-environment node
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createItemRef } from "../shared/active-context.mjs";
import { createActiveContextService, createFileActiveSelectionStore, createLocalWorkspaceIdentity } from "./active-context-service.mjs";
import { createLocalWorkspace } from "./workspace-core.mjs";

const cleanup = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true }))));

it("serves one zero-argument active-context lookup over MCP stdio", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ten-mcp-workspace-"));
  const state = await mkdtemp(path.join(tmpdir(), "ten-mcp-state-"));
  cleanup.push(root, state);
  await mkdir(path.join(root, "documents"));
  await writeFile(path.join(root, "documents", "resume.md"), "# Current resume\n");
  const identity = await createLocalWorkspaceIdentity(root);
  const service = createActiveContextService({ identity, workspace: createLocalWorkspace(root), store: createFileActiveSelectionStore(state) });
  await service.setActiveSelection({ itemRef: createItemRef("resource", "documents/resume.md"), action: "review_resume" });

  const client = new Client({ name: "careercoach-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("server/mcp-server.mjs")],
    env: { ...process.env, TEN_WORKSPACE_ROOT: root, TEN_STATE_DIR: state },
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["get_active_context"]);
    expect(tools.tools[0].inputSchema).toMatchObject({ type: "object" });
    const result = await client.callTool({ name: "get_active_context", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.selection).toMatchObject({ kind: "resource", action: { id: "review_resume" } });
    expect(result.structuredContent.sources[0].content).toContain("Current resume");
  } finally {
    await client.close();
  }
});
