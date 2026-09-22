const adapters = [
  {
    id: "antigravity",
    label: "Antigravity",
    connection: "local-stdio",
    availability: "ready",
    statusLabel: "Local MCP",
  },
  {
    id: "claude-cowork",
    label: "Claude Cowork",
    connection: "desktop-plugin",
    availability: "setup-required",
    statusLabel: "Plugin needed",
  },
  {
    id: "chatgpt-work",
    label: "ChatGPT Work",
    connection: "secure-tunnel",
    availability: "setup-required",
    statusLabel: "Tunnel needed",
  },
];

export const hostAdapters = Object.freeze(adapters.map((adapter) => Object.freeze(adapter)));

export function getHostAdapter(hostId) {
  const adapter = hostAdapters.find((candidate) => candidate.id === hostId);
  if (!adapter) throw new Error(`Unknown CareerCoach host adapter: ${hostId}`);
  return adapter;
}

export function createHostHandoff(hostId, visibleMessage) {
  const adapter = getHostAdapter(hostId);
  const message = typeof visibleMessage === "string" ? visibleMessage.trim() : "";
  if (!message) throw new Error("A visible CareerCoach request is required.");
  return { host: adapter, message };
}
