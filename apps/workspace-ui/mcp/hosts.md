# External host setup

CareerCoach uses one copy-first handoff for every external host. An `Ask` action
sets the active selection, then copies the exact visible request. It does not open
an application, insert text, create a second CareerCoach conversation, or expose a
context ID.

## Google Antigravity

Antigravity supports local stdio MCP servers. Print a ready-to-merge configuration:

```bash
npm run host:setup -- antigravity "$HOME/job-search"
```

Merge the returned `careercoach` entry into
`~/.gemini/config/mcp_config.json`, restart Antigravity, and confirm that
`get_active_context` is listed. The command and workspace paths are absolute so
Antigravity does not depend on its launch directory.

Official reference: [Getting Started with Google Antigravity](https://codelabs.developers.google.com/getting-started-google-antigravity)

## Claude Cowork

The copy handoff is ready. Local MCP access in Cowork must be delivered as a
desktop plugin/extension and enabled in a desktop Cowork task. A server manually
added to `claude_desktop_config.json` is not treated as Cowork setup. Packaging and
installation remain an explicit deployment step so CareerCoach does not silently
change Claude configuration.

Official references: [Claude Cowork architecture](https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview), [Use plugins in Claude](https://support.claude.com/en/articles/13837440-use-plugins-in-claude)

## ChatGPT Work

The copy handoff is ready. ChatGPT Work requires the local MCP to be made available
through OpenAI's Secure MCP Tunnel and registered in developer mode. Keep the
zero-argument `get_active_context` contract unchanged; the tunnel is transport,
not another context store.

Official references: [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [Build plugins](https://developers.openai.com/plugins/build/plugins)

## Host instructions

For all hosts, use the shared instructions in `host-instructions.md`: call the tool
once, compare the returned label and action with the pasted request, and stop on a
mismatch.
