import { normalizeSnapshot } from "./contract";

async function request(path, options) {
  const response = await fetch(`/api/workspace${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Workspace request failed.");
  return body;
}

export const httpWorkspaceProvider = {
  async getSnapshot() { return normalizeSnapshot(await request("/snapshot")); },
  async readResource(ref) { return request(`/resource?ref=${encodeURIComponent(ref)}`); },
  async updateResource(ref, content, expectedVersion) {
    return request("/resource", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, content, expectedVersion }),
    });
  },
  async uploadResource(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return request("/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, base64: btoa(binary) }),
    });
  },
  async setActiveSelection(selection) {
    return request("/active-selection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection),
    });
  },
};
