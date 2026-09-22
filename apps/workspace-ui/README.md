# Workspace UI

Host-neutral CareerCoach workspace interface. The same React components run with
synthetic fixtures or a local file-backed workspace provider.

## Run

```bash
npm install
npm run preview
```

Open `http://127.0.0.1:5173`. Do not open `index.html` directly; browsers block
the source modules on `file://`. Direct opening shows the same launch instructions
instead of a blank page.

To use the real local workspace:

```bash
npm run local
```

This serves the UI on `127.0.0.1` and reads `$HOME/job-search`. Set
`TEN_WORKSPACE_ROOT` and run Vite directly to use a different folder.

## Verify

```bash
npm test
npm run build
```

## Resource boundary

- `src/resources/contract.js` defines normalized snapshots and action descriptors.
- `fixture-provider.js` supplies safe preview data; `http-provider.js` supplies the
  same contract from the same-origin local API.
- `server/workspace-core.mjs` lists and projects authoritative files, performs
  version-checked atomic text updates, and handles no-overwrite uploads.
- Hidden paths, parent traversal, outside-workspace symlinks, unsupported formats,
  stale edits, and oversized content are rejected.

MCP, active context, authentication, chat transport, and OpenClaw/WebUI integration
remain outside the resource-provider layer.

## Active context and MCP

Explicit `Ask` actions store one routing pointer outside the career workspace. The
record contains only workspace ID, item reference, and action; source content is
reread when the tool is called. Local identity is bound to the configured canonical
workspace path and operating-system user.

Run the local stdio server with the same workspace root as the UI:

```bash
npm run mcp
```

It exposes one zero-argument tool, `get_active_context`. The transport-independent
resolver lives in `server/active-context-service.mjs`; host behavior is documented
in `mcp/host-instructions.md` and `mcp/hosts.md`. The UI uses one copy-first handoff
for Antigravity, Claude Cowork, and ChatGPT Work. Only Antigravity currently has a
generated local stdio configuration; Cowork packaging and ChatGPT's secure tunnel
remain explicit deployment steps. OpenClaw integration remains the final phase.

Fixture names and content are synthetic. Real workspace content is read at runtime
and is not copied into this package.
