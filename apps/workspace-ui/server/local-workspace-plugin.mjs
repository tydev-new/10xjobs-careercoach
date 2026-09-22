import { WorkspaceError, createLocalWorkspace } from "./workspace-core.mjs";
import { createActiveContextService, createFileActiveSelectionStore, createLocalWorkspaceIdentity } from "./active-context-service.mjs";

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new WorkspaceError(400, "invalid_json", "Request body must be valid JSON."); }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function localWorkspacePlugin(root) {
  const workspace = createLocalWorkspace(root);
  const contextService = createLocalWorkspaceIdentity(root).then((identity) => createActiveContextService({
    identity,
    workspace,
    store: createFileActiveSelectionStore(process.env.TEN_STATE_DIR),
  }));
  return {
    name: "ten-local-workspace",
    configureServer(server) {
      server.middlewares.use("/api/workspace", async (req, res, next) => {
        try {
          const url = new URL(req.url, "http://local");
          if (req.method === "GET" && url.pathname === "/status") return send(res, 200, { mode: "local" });
          if (req.method === "GET" && url.pathname === "/snapshot") return send(res, 200, await workspace.snapshot());
          if (req.method === "GET" && url.pathname === "/resources") return send(res, 200, await workspace.listResources());
          if (req.method === "GET" && url.pathname === "/resource") return send(res, 200, await workspace.readResource(url.searchParams.get("ref")));
          if (req.method === "PUT" && url.pathname === "/resource") {
            const body = await readJson(req);
            return send(res, 200, await workspace.updateResource(body.ref, body.content, body.expectedVersion));
          }
          if (req.method === "POST" && url.pathname === "/upload") return send(res, 201, await workspace.uploadResource(await readJson(req)));
          if (req.method === "POST" && url.pathname === "/active-selection") {
            return send(res, 200, await (await contextService).setActiveSelection(await readJson(req)));
          }
          return next();
        } catch (error) {
          const status = error instanceof WorkspaceError ? error.status : Number(error.status) || 500;
          return send(res, status, { error: error.code || "workspace_error", message: error.message || "Workspace request failed." });
        }
      });
    },
  };
}
